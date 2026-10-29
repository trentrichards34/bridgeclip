import { app } from 'electron'
import { execFile, spawn, type ChildProcess } from 'child_process'
import { randomBytes, randomUUID } from 'crypto'
import { lstatSync, realpathSync, statSync } from 'fs'
import { access, constants as fsConstants, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, delimiter, dirname, extname, join } from 'path'
import { promisify } from 'util'
import { estimateWordTimings, OPENROUTER_MODELS } from '../shared/avatars'
import {
  BROLL_VIDEO_MAX_RECORDING_BYTES, BROLL_VIDEO_MAX_SECONDS, BROLL_VIDEO_MIN_SECONDS, BROLL_VIDEO_VOICE_EXTENSIONS, brollVideoTitle,
  estimateBrollVideo, parseBrollVideoRequest, pickedShots, scriptSeconds,
  type BrollVideoEstimate, type BrollVideoPhase, type BrollVideoRequest, type BrollVideoShot, type BrollVideoStatus
} from '../shared/broll-video'
import { isLibraryShotRef } from '../shared/broll-library'
import { headlineLookForEngine } from '../shared/headline-look'
import { brollAiSettings, brollRunFields, libraryCatalog, writeRunCatalog } from './broll-library'
import { readCta } from './ctas'
import { cancelEditor, runEditor, withEditorPreparation } from './clip-editor'
import { ScribeUnavailable, transcribeWithScribe } from './edit-recording'
import { logger } from './logger'
import { audioForEngine } from './music'
import { synthesizeSpeech } from './openrouter-media'
import { getBridgeRunnerPath, getEnginePath, resolvePythonPath, runtimeEnvironment, validatePython } from './pipeline-runner'
import { authorizeMedia } from './security'
import { getSettingsForBridge, loadSettings, vocabularyTerms } from './settings-store'
import { resolveBinary } from './tools'

/**
 * B-roll video (sidebar → B-roll video, or the B-roll library's "Make a b-roll video"): the member's voiceover (or
 * their script, voiced) covered start to end with their own b-roll, with captions, hook text and motion graphics.
 *
 * 1. The voice: their file or recording (copied in as AAC), or the script voiced with a preset voice (OpenRouter).
 * 2. Word timings: Scribe through OpenRouter, the app's usual transcription when Scribe can't take it.
 * 3. bridge/broll_video_runner.py plans and lays the shots (one planning call) and writes the run as a clip editor
 *    project: one ready clip covering the whole video.
 * 4. The clip editor's own export bakes it into the Library (clip_00.mp4), so the editor can change everything later.
 * One video at a time. What is paid goes to the spending ledger (B-roll library), also when a run fails part way.
 */

const execFileAsync = promisify(execFile)
/** The voiceover file types (for the file dialog in the IPC layer). */
export { BROLL_VIDEO_VOICE_EXTENSIONS }
export const BROLL_VIDEO_RUN = /^broll-video-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const WORK_FOLDER = '.broll-video'
const CANDIDATE = 'clip-000'
const RECORDING_TTL_MS = 14 * 24 * 60 * 60 * 1000
/** One TTS request is kept under this many characters (split at sentence ends). */
const SPEECH_CHUNK_CHARS = 900

interface Active {
  status: BrollVideoStatus
  abort: AbortController
  cancelled: boolean
  child?: ChildProcess
  folder: string
  recordedUsd: number
}

let active: Active | null = null
let starting = false
let lastStatus: BrollVideoStatus | null = null
let notify: (status: BrollVideoStatus) => void = () => undefined
type SpendRecorder = (usd: number, label: string, runId: string) => unknown
let recordSpend: SpendRecorder = () => undefined
/** Voiceovers chosen in the file dialog or recorded in the app this session: canonical path → the file and its length. */
const voices = new Map<string, { dev: number; ino: number; seconds: number }>()
let swapping: string | null = null

export function onBrollVideoStatus(listener: (status: BrollVideoStatus) => void): void { notify = listener }
export function onBrollVideoSpend(recorder: SpendRecorder): void { recordSpend = recorder }
export function brollVideoStatus(): BrollVideoStatus | null { return active?.status ?? lastStatus }

function finished(phase: BrollVideoPhase): boolean { return phase === 'done' || phase === 'failed' || phase === 'cancelled' }

function update(run: Active, phase: BrollVideoPhase, detail: string, percent: number, patch: Partial<BrollVideoStatus> = {}): void {
  if (finished(run.status.phase) || run.abort.signal.aborted) return
  run.status = { ...run.status, ...patch, phase, detail, percent: Math.max(run.status.percent, Math.min(100, Math.round(percent))) }
  notify(run.status)
}

function spend(run: Active, usd: unknown): void {
  if (typeof usd === 'number' && Number.isFinite(usd) && usd > 0 && usd < 1e6) run.status = { ...run.status, costUsd: run.status.costUsd + usd }
}

/** What was paid and not yet recorded goes to the ledger (a failed or cancelled run paid for its calls too). */
function flushSpend(run: Active): void {
  const unrecorded = run.status.costUsd - run.recordedUsd
  if (unrecorded <= 1e-9) return
  run.recordedUsd = run.status.costUsd
  try { recordSpend(unrecorded, 'B-roll video', basename(run.folder)) } catch { /* never breaks the run */ }
}

function kill(child?: ChildProcess, force = false): void {
  if (!child?.pid) return
  try { if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => undefined); else process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM') } catch { /* already exited */ }
}

// ---------------------------------------------------------------------------
// The voiceover: a file the member chose, or a recording made in the app
// ---------------------------------------------------------------------------

export async function mediaSeconds(path: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(resolveBinary('ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path], { timeout: 30_000 })
    const seconds = Number(String(stdout).trim())
    if (Number.isFinite(seconds) && seconds > 0) return seconds
  } catch { /* read the packets below */ }
  // A browser recording (WebM) has no length in its header: its last audio packet's time.
  try {
    const { stdout } = await execFileAsync(resolveBinary('ffprobe'), ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', path],
      { timeout: 60_000, maxBuffer: 32 * 1024 * 1024 })
    const times = String(stdout).split('\n').map((line) => Number(line.trim().split(',')[0])).filter((value) => Number.isFinite(value))
    return times.length ? Math.max(...times) + 0.05 : 0
  } catch { return 0 }
}

async function hasAudio(path: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(resolveBinary('ffprobe'), ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', path], { timeout: 30_000 })
    return String(stdout).trim().length > 0
  } catch { return false }
}

export interface VoiceoverFile { path: string; name: string; seconds: number }

/** A voiceover file the member chose (or recorded): it has sound and is 3 seconds to 3 minutes long. Remembered for the start. */
export async function describeVoiceover(path: string): Promise<VoiceoverFile> {
  const extension = extname(path).slice(1).toLowerCase()
  if (!(BROLL_VIDEO_VOICE_EXTENSIONS as readonly string[]).includes(extension)) throw new Error('Choose an audio or video file for your voiceover: MP3, M4A, WAV, MP4 or MOV.')
  const canonical = realpathSync(path)
  const info = statSync(canonical)
  if (!info.isFile()) throw new Error('Choose an audio or video file for your voiceover.')
  if (!(await hasAudio(canonical))) throw new Error(`“${basename(path)}” has no sound. Choose your voiceover.`)
  const seconds = await mediaSeconds(canonical)
  if (seconds < BROLL_VIDEO_MIN_SECONDS) throw new Error(`“${basename(path)}” could not be read, or it’s under ${BROLL_VIDEO_MIN_SECONDS} seconds.`)
  if (seconds > BROLL_VIDEO_MAX_SECONDS + 1) throw new Error(`“${basename(path)}” is over ${BROLL_VIDEO_MAX_SECONDS / 60} minutes. Use a voiceover of up to ${BROLL_VIDEO_MAX_SECONDS / 60} minutes.`)
  voices.set(canonical, { dev: info.dev, ino: info.ino, seconds })
  // A video or WebM voiceover can be played back on the page.
  try { authorizeMedia(canonical) } catch { /* audio-only formats aren't previewed */ }
  return { path: canonical, name: basename(path), seconds: Math.round(seconds * 10) / 10 }
}

/** The voiceover the request names, as chosen here (the same file, not one swapped in since). */
function chosenVoice(path: string): { path: string; seconds: number } {
  let canonical: string
  try { canonical = realpathSync(path) } catch { throw new Error('Your voiceover file was moved. Choose it again.') }
  const known = voices.get(canonical)
  const info = statSync(canonical)
  if (!known || known.dev !== info.dev || known.ino !== info.ino) throw new Error('Choose your voiceover again with Choose a file.')
  return { path: canonical, seconds: known.seconds }
}

export function recordingsDir(): string { return join(app.getPath('userData'), 'broll-video-recordings') }

async function cleanRecordings(): Promise<void> {
  let names: string[] = []
  try { names = await readdir(recordingsDir()) } catch { return }
  const now = Date.now()
  await Promise.all(names.map(async (name) => {
    const path = join(recordingsDir(), name)
    try { if (now - (await stat(path)).mtimeMs > RECORDING_TTL_MS) await rm(path, { force: true }) } catch { /* ignore */ }
  }))
}

/** A voiceover recorded on the page (the microphone): saved, checked and remembered like a chosen file. */
export async function saveBrollRecording(bytes: unknown, mime: unknown): Promise<VoiceoverFile> {
  if (Object.prototype.toString.call(bytes) !== '[object Uint8Array]') throw new Error('The recording could not be saved. Record it again.')
  const data = bytes as Uint8Array
  if (data.byteLength < 500 || data.byteLength > BROLL_VIDEO_MAX_RECORDING_BYTES) throw new Error('The recording could not be saved. Record it again, a little shorter.')
  void cleanRecordings()
  const extension = typeof mime === 'string' && mime.startsWith('video/mp4') ? 'mp4' : 'webm'
  await mkdir(recordingsDir(), { recursive: true })
  const file = join(recordingsDir(), `voiceover-${randomBytes(6).toString('hex')}.${extension}`)
  await writeFile(`${file}.tmp`, data, { mode: 0o600 })
  await rename(`${file}.tmp`, file)
  try {
    const described = await describeVoiceover(file)
    return { ...described, name: 'Your recording' }
  } catch (error) { await rm(file, { force: true }).catch(() => undefined); throw error }
}

// ---------------------------------------------------------------------------
// Estimate and the spending check
// ---------------------------------------------------------------------------

export interface BrollVideoPlanInfo { estimate: BrollVideoEstimate; seconds: number | null; libraryShots: number; pickedShots: number }

/** What starting would cost (the voiceover's length when it was chosen here, else the script's), and the shots it can use. */
export async function brollVideoEstimate(value: unknown): Promise<BrollVideoPlanInfo> {
  const request = parseBrollVideoRequest(value)
  let seconds: number | null = null
  if (request.voice.kind === 'script') seconds = scriptSeconds(request.voice.script)
  else { try { seconds = chosenVoice(request.voice.path).seconds } catch { seconds = null } }
  const catalog = await libraryCatalog()
  return {
    estimate: estimateBrollVideo(request, seconds ?? 60, request.fillWithAi ? brollAiSettings() : null),
    seconds, libraryShots: catalog.shots.length, pickedShots: pickedShots(catalog.shots, request.broll).length
  }
}

/** The spending check's estimate (always paid: at least the word timings and the plan). */
export function brollVideoSpendCheck(value: unknown): number {
  const request = parseBrollVideoRequest(value)
  let seconds = 60
  if (request.voice.kind === 'script') seconds = scriptSeconds(request.voice.script)
  else { try { seconds = chosenVoice(request.voice.path).seconds } catch { /* checked again at the start */ } }
  return estimateBrollVideo(request, seconds, request.fillWithAi ? brollAiSettings() : null).totalUsd
}

// ---------------------------------------------------------------------------
// Making one
// ---------------------------------------------------------------------------

async function preflight(folder: string): Promise<void> {
  const settings = loadSettings(), engine = getEnginePath()
  for (const tool of ['ffmpeg', 'ffprobe'] as const) {
    try { await execFileAsync(resolveBinary(tool), ['-version'], { timeout: 15_000 }) }
    catch { throw new Error(`${tool === 'ffmpeg' ? 'FFmpeg' : 'FFprobe'} is missing. Run Settings → System check first.`) }
  }
  const python = await validatePython(resolvePythonPath(engine, settings.pythonPath), engine)
  if (!python.ok) throw new Error('The clipping engine is not ready. Run Settings → System check first.')
  try { await mkdir(folder, { recursive: true }); await access(folder, fsConstants.W_OK) }
  catch { throw new Error('The output folder is not writable. Choose another in Settings → Output.') }
}

/** A message while `path` is the run being made or a shot is being swapped (the Library waits), else null. */
export function brollVideoRunBusy(path: string): string | null {
  const real = (value: string): string => { try { return realpathSync(value) } catch { return value } }
  if (active && real(active.folder) === path) return 'Wait for this b-roll video to finish before changing it.'
  if (swapping && real(swapping) === path) return 'Wait for the shot swap to finish.'
  return null
}

export function cancelBrollVideo(): boolean {
  if (!active) return false
  active.cancelled = true
  active.abort.abort()
  kill(active.child)
  // Baking in the clip editor: stop that too (the run stays in the Library, ready to bake from the editor).
  if (active.status.outputDir) { try { cancelEditor(active.status.outputDir) } catch { /* nothing running */ } }
  return true
}

export function stopBrollVideoForQuit(): void {
  if (active) { active.cancelled = true; active.abort.abort(); kill(active.child, true) }
}

export interface BrollVideoStartOptions {
  /** Wraps the run so its paid voice calls are recorded (spending.metered). */
  meter?: <T>(work: () => Promise<T>) => Promise<T>
}

export async function startBrollVideo(value: unknown, options: BrollVideoStartOptions = {}): Promise<BrollVideoStatus> {
  if (active || starting) throw new Error('A b-roll video is already being made. Wait for it to finish or cancel it.')
  const request = parseBrollVideoRequest(value)
  const settings = loadSettings()
  if (!settings.openrouterApiKey) throw new Error('Add your OpenRouter key in Settings → API keys: it listens to your voiceover for the word timings.')
  const voice = request.voice.kind === 'script' ? null : chosenVoice(request.voice.path)
  if (request.ctaId) readCta(request.ctaId)
  const ai = request.fillWithAi ? brollAiSettings() : null
  // The library is read now: clips added since the last video are used.
  const catalog = await libraryCatalog()
  const picked = pickedShots(catalog.shots, request.broll)
  if (!catalog.shots.length && !(ai && ai.maxShots > 0)) throw new Error('Your B-roll library has no shots ready yet. Add clips there and let the AI look at them first.')
  if (!request.broll.all && !picked.length) throw new Error('None of the b-roll you picked is ready to use. Pick other clips, or use your whole library.')
  const folder = join(settings.outputDirectory, `broll-video-${randomUUID()}`)
  starting = true
  try { await preflight(folder) } catch (error) { await rm(folder, { recursive: true, force: true }).catch(() => undefined); throw error } finally { starting = false }
  if (active) throw new Error('A b-roll video is already being made. Wait for it to finish or cancel it.')
  const seconds = voice?.seconds ?? scriptSeconds((request.voice as { script: string }).script)
  const run: Active = {
    abort: new AbortController(), cancelled: false, folder, recordedUsd: 0,
    status: {
      id: randomBytes(8).toString('hex'), phase: 'voice', detail: request.voice.kind === 'script' ? 'Voicing your script' : 'Getting your voiceover ready', percent: 1,
      outputDir: null, outputPath: null, shots: [], error: null, warnings: [], costUsd: 0,
      estimateUsd: estimateBrollVideo(request, seconds, ai).totalUsd, startedAt: new Date().toISOString()
    }
  }
  active = run
  notify(run.status)
  const work = (): Promise<void> => makeVideo(run, request, voice?.path ?? null, request.broll.all ? null : picked)
  void (options.meter ? options.meter(work) : work()).then(() => {
    run.status = { ...run.status, phase: 'done', detail: 'Ready', percent: 100 }
  }).catch(async (error: unknown) => {
    spend(run, (error as { costUsd?: unknown } | null)?.costUsd)
    const cancelled = run.cancelled
    run.status = { ...run.status, phase: cancelled ? 'cancelled' : 'failed', detail: cancelled ? 'Canceled' : 'Failed', error: cancelled ? null : errorMessage(error) }
    if (!cancelled) logger.warn('brollVideo.failed', { message: String((error as Error)?.message ?? error).slice(0, 300) })
    run.abort.abort()
    // A run that never got its editor project leaves nothing behind in the Library.
    if (!run.status.outputDir) await rm(folder, { recursive: true, force: true }).catch(() => undefined)
  }).finally(() => {
    flushSpend(run)
    lastStatus = run.status
    if (active === run) active = null
    notify(run.status)
  })
  return run.status
}

function errorMessage(error: unknown): string {
  const candidate = error as NodeJS.ErrnoException | null
  if (!candidate || typeof candidate.message !== 'string' || !candidate.message || candidate.name === 'AbortError') return 'Your b-roll video could not be made. Try again.'
  if (candidate.code === 'ENOSPC') return 'Your disk is full. Free some space and try again.'
  if (candidate.code || /(?:^|[\s'"(])(?:\/(?:Users|home|var|private|tmp|Volumes)\/|[A-Za-z]:\\)/.test(candidate.message)) return 'Your b-roll video could not be saved. Check the output folder in Settings and try again.'
  return candidate.message.slice(0, 400)
}

async function ffmpeg(args: string[], signal: AbortSignal, failure: string): Promise<void> {
  try {
    await execFileAsync(resolveBinary('ffmpeg'), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...args], { timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024, signal })
  } catch (error) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    logger.warn('brollVideo.ffmpeg.failed', { message: String((error as { stderr?: string }).stderr ?? error).slice(-600) })
    throw new Error(failure)
  }
}

/** A script in pieces of at most SPEECH_CHUNK_CHARS, split after sentences (or words, for a very long sentence). */
export function speechChunks(script: string, limit = SPEECH_CHUNK_CHARS): string[] {
  const sentences = script.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+["”’)]*\s*|[^.!?]+$/g) ?? []
  const chunks: string[] = []
  let current = ''
  const push = (): void => { if (current.trim()) chunks.push(current.trim()); current = '' }
  for (const sentence of sentences) {
    if ((current + sentence).length > limit) push()
    if (sentence.length > limit) {
      for (const word of sentence.split(' ')) { if ((current + ' ' + word).length > limit) push(); current += `${current ? ' ' : ''}${word}` }
    } else current += sentence
  }
  push()
  return chunks
}

/** The voice in the run's work folder as AAC: their file or recording, or the script voiced piece by piece. */
async function readyVoice(run: Active, request: BrollVideoRequest, source: string | null, work: string, key: string): Promise<{ path: string; seconds: number }> {
  const signal = run.abort.signal
  const out = join(work, 'voice.m4a')
  const aac = ['-vn', '-ac', '2', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k']
  if (source) {
    await ffmpeg(['-protocol_whitelist', 'file,pipe,fd', '-i', source, '-map', '0:a:0', ...aac, out], signal, 'No sound could be read from your voiceover. Choose another file.')
  } else {
    const script = (request.voice as { script: string; voice: string }).script
    const voice = (request.voice as { voice: string }).voice.toLowerCase()
    const chunks = speechChunks(script)
    const parts: string[] = []
    for (const [n, chunk] of chunks.entries()) {
      if (chunks.length > 1) update(run, 'voice', `Voicing your script (${n + 1} of ${chunks.length})`, 2 + (n / chunks.length) * 12)
      const raw = join(work, `speech-${n}.mp3`)
      await writeFile(raw, await synthesizeSpeech({ model: OPENROUTER_MODELS.tts, input: chunk, voice }, { key, signal }))
      parts.push(raw)
    }
    // The pieces one after another, a short breath between them.
    const inputs = parts.flatMap((part) => ['-i', part])
    const graph = parts.map((_, k) => `[${k}:a]aresample=48000,aformat=channel_layouts=stereo${k < parts.length - 1 ? ',apad=pad_dur=0.25' : ''}[a${k}]`).join(';') +
      `;${parts.map((_, k) => `[a${k}]`).join('')}concat=n=${parts.length}:v=0:a=1[out]`
    await ffmpeg(['-protocol_whitelist', 'file,pipe,fd', ...inputs, '-filter_complex', graph, '-map', '[out]', ...aac, out], signal, 'Preparing the voice failed. Try again.')
    await Promise.all(parts.map((part) => rm(part, { force: true }).catch(() => undefined)))
  }
  const seconds = await mediaSeconds(out)
  if (seconds < BROLL_VIDEO_MIN_SECONDS) throw new Error('Your voiceover is too short. Use at least 3 seconds.')
  if (seconds > BROLL_VIDEO_MAX_SECONDS + 1) throw new Error(`Your voiceover is over ${BROLL_VIDEO_MAX_SECONDS / 60} minutes. Use a shorter one.`)
  return { path: out, seconds }
}

/** Distinctive words of the script, to help the transcription spell names and terms the way the member wrote them. */
export function scriptKeyterms(script: string): string[] {
  const words = script.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]{2,}/gu) ?? []
  const seen = new Set<string>(), out: string[] = []
  for (const word of words) {
    const key = word.toLowerCase()
    if (seen.has(key) || !(/[A-Z0-9]/.test(word.slice(1)) || /^[A-Z]/.test(word) || word.length >= 8)) continue
    seen.add(key)
    out.push(word.slice(0, 60))
    if (out.length >= 100) break
  }
  return out
}

let encoderCheck: Promise<boolean> | null = null
function hasMp3Encoder(): Promise<boolean> {
  encoderCheck ??= execFileAsync(resolveBinary('ffmpeg'), ['-hide_banner', '-encoders'], { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 })
    .then(({ stdout }) => /\blibmp3lame\b/.test(String(stdout))).catch(() => false)
  return encoderCheck
}

/** Word timings: Scribe first; the app's usual transcription when Scribe can't take this file right now. */
async function listen(run: Active, voice: string, seconds: number, keyterms: string[], key: string): Promise<[string, number, number][]> {
  const signal = run.abort.signal
  // MP3 keeps a long voiceover well under Scribe's size limit; FLAC (always in FFmpeg) otherwise.
  const lame = await hasMp3Encoder()
  const mp3 = join(dirname(voice), lame ? 'listen.mp3' : 'listen.flac')
  try {
    await ffmpeg(['-i', voice, '-ac', '1', '-ar', '16000', ...(lame ? ['-c:a', 'libmp3lame', '-b:a', '48k'] : ['-c:a', 'flac']), mp3], signal, 'The voiceover could not be read.')
    const bytes = new Uint8Array(await readFile(mp3))
    const result = await transcribeWithScribe({ bytes, name: basename(mp3), type: lame ? 'audio/mpeg' : 'audio/flac', seconds }, keyterms, key, { signal })
    spend(run, result.costUsd)
    return result.words
  } catch (error) {
    if (run.cancelled) throw new DOMException('Aborted', 'AbortError')
    if (error instanceof ScribeUnavailable) {
      spend(run, error.costUsd)
      if (error.final) throw new Error(error.message)
    }
    logger.warn('brollVideo.scribe.unavailable', { reason: String((error as Error)?.message ?? error).slice(0, 80) })
  } finally { await rm(mp3, { force: true }).catch(() => undefined) }
  update(run, 'listening', 'Listening with the usual transcription', 22)
  const result = await runEngine(run, 'edit_runner.py', { mode: 'transcribe', output_dir: run.folder, source: voice, src: 0, keyterms }, 30 * 60_000)
  spend(run, result.cost_usd)
  const words = Array.isArray(result.words) ? result.words : []
  return words.flatMap((item): [string, number, number][] => Array.isArray(item) && typeof item[0] === 'string' && Number.isInteger(item[1]) && Number.isInteger(item[2]) ? [[item[0], item[1], item[2]]] : [])
}

function engineEnv(): Record<string, string | undefined> {
  const settings = loadSettings(), engine = getEnginePath()
  const env: Record<string, string | undefined> = { ...runtimeEnvironment(), ...getSettingsForBridge(settings), LAYOUT_VISION_ENABLED: 'false', PYTHONPATH: engine, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' }
  const ffmpegPath = resolveBinary('ffmpeg')
  if (ffmpegPath !== 'ffmpeg') env.PATH = `${dirname(ffmpegPath)}${delimiter}${env.PATH ?? ''}`
  return env
}

/** One engine run; resolves with its result line, rejects with what it said (and what it paid). */
function runEngine(run: Pick<Active, 'abort'> & { child?: ChildProcess }, runner: string, config: Record<string, unknown>, limitMs: number,
  onProgress?: (detail: string, percent: number) => void): Promise<Record<string, unknown>> {
  const settings = loadSettings(), engine = getEnginePath()
  return new Promise((resolve, reject) => {
    const child = spawn(resolvePythonPath(engine, settings.pythonPath), [join(dirname(getBridgeRunnerPath()), runner)],
      { cwd: engine, env: engineEnv(), stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true })
    run.child = child
    const stop = (): void => kill(child)
    run.abort.signal.addEventListener('abort', stop, { once: true })
    let buffer = '', stderr = '', result: Record<string, unknown> | null = null
    const timer = setTimeout(() => kill(child, true), limitMs)
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk)
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
        try {
          const message = JSON.parse(line) as Record<string, unknown>
          if (message.type === 'progress' && typeof message.percent === 'number') onProgress?.(typeof message.detail === 'string' ? message.detail.slice(0, 160) : '', message.percent)
          else if (typeof message.ok === 'boolean') result = message
        } catch { /* not protocol */ }
      }
    })
    child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-4000) })
    child.on('error', () => { clearTimeout(timer); reject(new Error('The clipping engine could not start. Run Settings → System check.')) })
    child.on('close', () => {
      clearTimeout(timer)
      run.abort.signal.removeEventListener('abort', stop)
      run.child = undefined
      if (run.abort.signal.aborted) { reject(Object.assign(new DOMException('Aborted', 'AbortError'), { costUsd: result?.cost_usd })); return }
      if (result?.ok === true) { resolve(result); return }
      logger.warn('brollVideo.engine.failed', { runner, stderr: stderr.slice(-1500) })
      const cost = typeof result?.cost_usd === 'number' && Number.isFinite(result.cost_usd) && result.cost_usd > 0 ? result.cost_usd : 0
      reject(Object.assign(new Error(typeof result?.error === 'string' && result.error !== 'failed' ? result.error.slice(0, 400) : 'Your b-roll video could not be made. Run Settings → System check, then try again.'), { costUsd: cost }))
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(JSON.stringify(config))
  })
}

export function parseShots(value: unknown): BrollVideoShot[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 400).flatMap((raw): BrollVideoShot[] => {
    const item = (raw ?? {}) as Record<string, unknown>
    if (!Number.isInteger(item.slot) || typeof item.start_ms !== 'number' || typeof item.end_ms !== 'number') return []
    return [{ slot: item.slot as number, startMs: item.start_ms, endMs: item.end_ms, shotId: isLibraryShotRef(item.shot_id) ? item.shot_id : null,
      ai: item.ai === true || (typeof item.ai_prompt === 'string' && item.ai_prompt.length > 0), reused: item.reused === true, words: typeof item.words === 'string' ? item.words.slice(0, 200) : '' }]
  })
}

async function makeVideo(run: Active, request: BrollVideoRequest, source: string | null, picked: string[] | null): Promise<void> {
  const settings = loadSettings()
  const key = settings.openrouterApiKey
  const work = join(run.folder, WORK_FOLDER)
  await mkdir(work, { recursive: true, mode: 0o700 })
  // 1. The voice.
  const voice = await readyVoice(run, request, source, work, key)
  if (run.cancelled) throw new DOMException('Aborted', 'AbortError')
  // 2. What is said, with times.
  update(run, 'listening', 'Listening to your voiceover', 16)
  const script = request.voice.kind === 'recording' ? '' : request.voice.script
  const keyterms = [...vocabularyTerms(settings.customVocabulary), ...scriptKeyterms(script)].slice(0, 200)
  let words = await listen(run, voice.path, voice.seconds, keyterms, key)
  const totalMs = Math.round(voice.seconds * 1000)
  if (!words.length && script) words = estimateWordTimings(script, totalMs).map((w) => [w.word, w.startMs, w.endMs])
  if (!words.length) throw new Error('No words were heard in your voiceover. Check that it has sound, then try again.')
  if (run.cancelled) throw new DOMException('Aborted', 'AbortError')
  flushSpend(run)
  // 3. The b-roll: the library as it is now (and the AI settings when filling gaps), then the build.
  update(run, 'planning', 'Planning your b-roll', 26)
  const fields = brollRunFields(request.fillWithAi ? 'library_ai' : 'library', { pexels: false, openrouter: Boolean(key) }, work)
  if ('error' in fields) throw new Error(fields.error.replace(/^B-roll: /, ''))
  let catalogPath = fields.fields.broll_catalog_path as string | undefined
  if (!catalogPath) catalogPath = (await writeRunCatalog(work))?.path ?? undefined
  if (!catalogPath) {
    // AI only (an empty library): an empty catalog.
    catalogPath = join(work, 'broll-catalog.json')
    await writeFile(catalogPath, JSON.stringify({ version: 1, shots: [] }), { mode: 0o600 })
  }
  const look = request.look
  const hookLook = headlineLookForEngine(look.hookLook) ?? look.hookLook
  const firstWords = words.slice(0, 10).map((w) => w[0]).join(' ')
  const title = brollVideoTitle(request, firstWords)
  const audio = audioForEngine(request.audio)
  const result = await runEngine(run, 'broll_video_runner.py', {
    mode: 'build', output_dir: run.folder, voice: voice.path, words: words.slice(0, 4000), total_ms: totalMs, catalog_path: catalogPath,
    shot_ids: picked, allow_ai: request.fillWithAi,
    ...(request.fillWithAi && fields.fields.broll_ai ? { broll_ai: fields.fields.broll_ai, broll_ai_dir: fields.fields.broll_ai_dir } : {}),
    aspect: look.aspect, fade: look.crossfade, title, captions: look.captions, caption_preset: look.captionPreset,
    hook: look.hookText && look.aspect === '9:16' ? { text: look.hookText, look: hookLook } : null, graphics: look.graphics,
    cta_id: request.ctaId, ...(audio ? { audio } : {}), media_id: randomUUID().replaceAll('-', ''), voice_ai: request.voice.kind === 'script'
  }, 3 * 60 * 60_000, (detail, percent) => update(run, percent < 78 ? (percent < 20 ? 'planning' : 'making') : 'finishing', detail || 'Placing your b-roll', 26 + percent * 0.5))
  spend(run, result.cost_usd)
  flushSpend(run)
  const shots = parseShots(result.shots)
  const warnings = Array.isArray(result.warnings) ? result.warnings.filter((w): w is string => typeof w === 'string').map((w) => w.slice(0, 300)).slice(0, 4) : []
  await rm(join(work, 'broll-catalog.json'), { force: true }).catch(() => undefined)
  // The run is in the Library from here on (an editor project), even if the bake below fails.
  run.status = { ...run.status, outputDir: run.folder, shots, warnings }
  if (run.cancelled) throw new DOMException('Aborted', 'AbortError')
  // 4. Bake it with the clip editor (captions, hook text, graphics, music and voice cleanup).
  update(run, 'finishing', look.graphics ? 'Drawing the graphics and captions' : 'Adding the captions', 78)
  try {
    await runEditor(run.folder, 0, CANDIDATE, 'export')
    run.status = { ...run.status, outputPath: join(run.folder, 'clip_00.mp4') }
  } catch (error) {
    if (run.cancelled) throw error
    logger.warn('brollVideo.bake.failed', { message: String((error as Error)?.message ?? error).slice(0, 300) })
    run.status = { ...run.status, warnings: [...warnings, 'Your b-roll is in place, but the finished video couldn’t be made yet. Open it in the editor and press Bake.'].slice(0, 5) }
  }
  await rm(join(run.folder, '.work'), { recursive: true, force: true }).catch(() => undefined)
}

// ---------------------------------------------------------------------------
// After: the shots of a b-roll video, and swapping one
// ---------------------------------------------------------------------------

function brollRunFolder(outputDir: unknown): string {
  const settings = loadSettings()
  if (typeof outputDir !== 'string' || !BROLL_VIDEO_RUN.test(basename(outputDir)) || dirname(outputDir) !== settings.outputDirectory) throw new Error('Only b-roll videos can be changed here.')
  try {
    if (lstatSync(outputDir).isSymbolicLink() || !statSync(outputDir).isDirectory() || realpathSync(outputDir) !== join(realpathSync(settings.outputDirectory), basename(outputDir))) throw new Error('moved')
  } catch { throw new Error('This b-roll video is no longer in your Library.') }
  if (active && active.folder === outputDir) throw new Error('This video is still being made. Wait for it to finish.')
  return outputDir
}

export function isBrollVideoRun(outputDir: unknown): boolean {
  return typeof outputDir === 'string' && BROLL_VIDEO_RUN.test(basename(outputDir))
}

/** The shots of a b-roll video (from its plan), for the swap list. */
export async function brollVideoShots(outputDir: unknown): Promise<BrollVideoShot[]> {
  const folder = brollRunFolder(outputDir)
  try {
    const file = join(folder, 'broll-plan.json')
    if (lstatSync(file).size > 8 * 1024 * 1024) return []
    return parseShots((JSON.parse(await readFile(file, 'utf8')) as { shots?: unknown }).shots)
  } catch { return [] }
}

/**
 * Put another library shot in one moment of a b-roll video (`shotId`, or null for the next best match). The video
 * the editor works from is made again with it; the member bakes the clip again in the editor to update the Library.
 */
export async function swapBrollShot(outputDir: unknown, slot: unknown, shotId: unknown): Promise<BrollVideoShot[]> {
  const folder = brollRunFolder(outputDir)
  if (!Number.isInteger(slot) || (slot as number) < 0 || (slot as number) > 999) throw new Error('Choose a shot to swap.')
  if (shotId !== null && shotId !== undefined && !isLibraryShotRef(shotId)) throw new Error('Choose a shot from your library.')
  if (swapping) throw new Error('Another shot is being swapped. Wait for it to finish.')
  // Free up space can remove the voice and shot pieces a swap needs (the video itself stays).
  try { if (!lstatSync(join(folder, WORK_FOLDER, 'voice.m4a')).isFile()) throw new Error('gone') }
  catch { throw new Error('This video’s working files were removed to free up space, so its shots can’t be swapped.') }
  swapping = folder
  try {
    await withEditorPreparation(folder, async (prep) => {
      const project = JSON.parse(await readFile(join(prep.run, 'editor-project.json'), 'utf8')) as { revision?: unknown }
      if (typeof project.revision !== 'number') throw new Error('This video’s editor project could not be read.')
      const work = join(prep.run, WORK_FOLDER)
      const catalog = await writeRunCatalog(work)
      if (!catalog) throw new Error('Your B-roll library has no shots ready to use.')
      const holder: { abort: AbortController; child?: ChildProcess } = { abort: new AbortController() }
      prep.signal.addEventListener('abort', () => holder.abort.abort(), { once: true })
      try {
        await runEngine(holder, 'broll_video_runner.py', { mode: 'swap', output_dir: prep.run, slot, shot_id: shotId ?? null, catalog_path: catalog.path,
          media_id: randomUUID().replaceAll('-', ''), revision: project.revision }, 30 * 60_000,
        (_detail, percent) => prep.setProgress({ phase: 'preview', percent: Math.floor(percent) }))
      } finally { await rm(catalog.path, { force: true }).catch(() => undefined) }
    })
  } finally { swapping = null }
  return brollVideoShots(folder)
}

/** Tests: forget the current run and the chosen voiceovers. */
export function resetBrollVideoForTests(): void { active = null; starting = false; lastStatus = null; voices.clear(); swapping = null }
