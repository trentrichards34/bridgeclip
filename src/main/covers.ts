/**
 * Make my cover (main): finds the speaker's best frames of a finished video in the member's Library (the engine's
 * bridge/cover_runner.py), offers words from the video (its hook, or what was said) and saves the cover the member
 * made next to the video (`clip_00.cover.jpg`), where posting picks it up as the cover (savedCover).
 *
 * Every input is checked: the video must be a video file inside the Library; the cover's bytes must be a JPEG or PNG
 * of a sane size, and go only next to that video.
 */
import { spawn, type ChildProcess } from 'child_process'
import { realpathSync, statSync } from 'fs'
import { readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, delimiter, dirname, extname, isAbsolute, join } from 'path'
import {
  COVER_EXTENSIONS, COVER_FRAME_COUNT, coverFileName, coverFormatFor, coverText, type CoverExtension, type CoverFrame, type CoverSuggestions, type SavedCover
} from '../shared/covers'
import { COVER_IMAGE_MAX_BYTES, coverImageType } from '../shared/zernio-extras'
import { DEFAULT_HEADLINE_LOOK, type HeadlineLook } from '../shared/headline-look'
import { logger } from './logger'
import { getBridgeRunnerPath, getEnginePath, resolvePythonPath, runtimeEnvironment } from './pipeline-runner'
import { isWithinLibrary } from './security'
import { loadSettings } from './settings-store'
import { resolveBinary } from './tools'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv'])
/** The frames the engine wrote, inside the run. */
const FRAMES_DIR = '.covers'
/** The longest a frame search may take (decoding a long video on a slow machine). */
const WORKER_LIMIT_MS = 10 * 60 * 1000
const running = new Map<string, ChildProcess>()

/** The video, checked: an absolute path to a video file inside the Library. Returns its real path and its run folder. */
export function libraryVideo(value: unknown): { video: string; run: string } {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0') || !VIDEO_EXTENSIONS.has(extname(value).toLowerCase())) {
    throw new Error('Choose a video in your Library.')
  }
  let video: string
  try { video = realpathSync(value) } catch { throw new Error('That video is no longer in your Library.') }
  if (!VIDEO_EXTENSIONS.has(extname(video).toLowerCase()) || !statSync(video).isFile() || !isWithinLibrary(video, loadSettings().outputDirectory)) {
    throw new Error('Choose a video in your Library.')
  }
  return { video, run: dirname(video) }
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, 'utf8')
    if (raw.length > 8 * 1024 * 1024) return null
    const value = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null }
}

const text = (value: unknown, max = 400): string => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''

/** The video's headline and hook look, and what was said, from its run (job_output.json, editor-project.json). */
export async function videoWords(video: string, run: string): Promise<{ headline: string; said: string; look: HeadlineLook | null }> {
  const job = await readJson(join(run, 'job_output.json'))
  const clips = Array.isArray(job?.clips) ? job.clips as Record<string, unknown>[] : []
  const name = basename(video)
  const clip = clips.find((c) => typeof c?.s3_url === 'string' && basename(decodeURIComponent(c.s3_url)) === name) ?? (clips.length === 1 ? clips[0] : undefined)
  let headline = text(clip?.headline, 200)
  let said = text(clip?.post_caption, 1200)
  let look: HeadlineLook | null = null
  const project = await readJson(join(run, 'editor-project.json'))
  if (project) {
    const candidates = Array.isArray(project.candidates) ? project.candidates as Record<string, unknown>[] : []
    const wanted = typeof clip?.editor_candidate === 'string' ? clip.editor_candidate : null
    const candidate = candidates.find((c) => c?.id === wanted) ?? candidates[0]
    const hook = candidate?.hook as { text?: unknown; look?: unknown } | null | undefined
    if (hook && typeof hook === 'object') {
      headline = text(hook.text, 200) || headline
      const raw = hook.look as Partial<HeadlineLook> | undefined
      if (raw && typeof raw === 'object' && typeof raw.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color)) {
        look = { ...DEFAULT_HEADLINE_LOOK, ...(typeof raw.font === 'string' ? { font: raw.font } : {}), look: DEFAULT_HEADLINE_LOOK.look, color: raw.color } as HeadlineLook
      }
    }
    const transcript = Array.isArray(project.transcript) ? project.transcript as Record<string, unknown>[] : []
    const spoken = transcript.slice(0, 80).map((s) => text(s?.text, 300)).filter(Boolean).join(' ')
    if (spoken) said = spoken.slice(0, 4000)
  }
  return { headline, said, look }
}

/** The cover saved next to the video (JPG or PNG), or null. */
export async function savedCover(value: unknown): Promise<SavedCover | null> {
  const { video, run } = libraryVideo(value)
  let best: { path: string; sizeBytes: number; mtime: number } | null = null
  for (const ext of COVER_EXTENSIONS) {
    const path = join(run, coverFileName(basename(video), ext))
    try {
      const info = await stat(path)
      if (info.isFile() && info.size > 0 && info.size <= COVER_IMAGE_MAX_BYTES && (!best || info.mtimeMs > best.mtime)) best = { path, sizeBytes: info.size, mtime: info.mtimeMs }
    } catch { /* none */ }
  }
  return best ? { path: best.path, sizeBytes: best.sizeBytes } : null
}

type WorkerFrames = { width: number; height: number; frames: CoverFrame[] }

function parseWorker(value: unknown, framesDir: string): WorkerFrames | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (v.ok !== true || !Number.isInteger(v.width) || !Number.isInteger(v.height) || !Array.isArray(v.frames)) return null
  const frames: CoverFrame[] = []
  for (const f of v.frames.slice(0, 6) as Record<string, unknown>[]) {
    const face = Array.isArray(f?.face) ? f.face : []
    if (!Number.isInteger(f?.at_ms) || typeof f?.path !== 'string' || typeof f?.score !== 'number' || face.length !== 4 ||
        !face.every((n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= -0.5 && n <= 1.5)) continue
    // Only the frames it wrote where it was told to.
    if (dirname(f.path) !== framesDir || !/^frame-\d+\.jpg$/.test(basename(f.path))) continue
    frames.push({ atMs: f.at_ms as number, path: f.path, score: f.score, face: face as CoverFrame['face'] })
  }
  return { width: v.width as number, height: v.height as number, frames }
}

function runWorker(key: string, request: Record<string, unknown>, framesDir: string): Promise<WorkerFrames> {
  const settings = loadSettings(), engine = getEnginePath()
  const env: Record<string, string | undefined> = { ...runtimeEnvironment(), LOCAL_MODE: 'true', PYTHONPATH: engine, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' }
  const ffmpegPath = resolveBinary('ffmpeg')
  if (ffmpegPath !== 'ffmpeg') env.PATH = `${dirname(ffmpegPath)}${delimiter}${env.PATH ?? ''}`
  const python = resolvePythonPath(engine, settings.pythonPath)
  return new Promise((resolve, reject) => {
    const child = spawn(python, [join(dirname(getBridgeRunnerPath()), 'cover_runner.py')], { cwd: engine, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    running.set(key, child)
    let buffer = '', result: WorkerFrames | null = null, failed = false
    const timer = setTimeout(() => child.kill('SIGKILL'), WORKER_LIMIT_MS)
    const consume = (line: string): void => {
      if (!line.trim()) return
      try {
        const value = JSON.parse(line)
        if (value?.type === 'progress') return
        result = parseWorker(value, framesDir)
        if (!result) failed = true
      } catch { failed = true }
    }
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk)
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, end)); buffer = buffer.slice(end + 1) }
      if (buffer.length > 65536) { failed = true; buffer = ''; child.kill() }
    })
    child.stderr.on('data', () => {})
    child.on('error', () => { clearTimeout(timer); running.delete(key); reject(new Error('Could not start the engine. Open Settings and run System check.')) })
    child.on('close', (code) => {
      clearTimeout(timer)
      running.delete(key)
      consume(buffer)
      if (code === 0 && result && !failed) resolve(result)
      else {
        logger.warn('covers.worker.failed', { exitCode: code })
        reject(new Error('Couldn’t look through the video for cover frames. Try again.'))
      }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify(request))
  })
}

/**
 * The cover choices for a video: the speaker's best frames (from the run's clean editor source when there is one, so
 * no captions or graphics are in the picture), the words offered (the headline, or 3-5 words said for YouTube), the
 * video's hook look, and the cover already saved.
 */
export async function suggestCovers(value: unknown): Promise<CoverSuggestions> {
  const { video, run } = libraryVideo(value)
  if (running.has(video)) throw new Error('Already looking for cover frames in this video.')
  const clean = join(run, 'editor-source.mp4')
  let source = video
  try { if ((await stat(clean)).isFile() && isWithinLibrary(clean, loadSettings().outputDirectory)) source = realpathSync(clean) } catch { /* the video itself */ }
  const framesDir = join(run, FRAMES_DIR)
  await rm(framesDir, { recursive: true, force: true })
  const found = await runWorker(video, { video: source, out_dir: framesDir, count: COVER_FRAME_COUNT }, framesDir)
  // The cover's shape is the video's (a reel's editor source can be landscape: the reel is still 9:16).
  const shape = source === video ? found : await probeShape(video, found)
  const format = coverFormatFor(shape.width, shape.height)
  const words = await videoWords(video, run)
  const frames: CoverFrame[] = []
  for (const frame of found.frames) {
    try {
      const data = await readFile(frame.path)
      if (data.length > 0 && data.length <= COVER_IMAGE_MAX_BYTES && coverImageType(data) === 'image/jpeg') frames.push({ ...frame, data: new Uint8Array(data) })
    } catch { /* left out */ }
  }
  return {
    format, width: found.width, height: found.height, frames,
    headline: words.headline, text: coverText(format, words.headline, words.said), look: words.look, saved: await savedCover(video)
  }
}

/** The finished video's own size (ffprobe), else the frames'. */
async function probeShape(video: string, fallback: { width: number; height: number }): Promise<{ width: number; height: number }> {
  const { execFile } = await import('child_process')
  return new Promise((resolve) => {
    execFile(resolveBinary('ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', video],
      { timeout: 20_000 }, (error, stdout) => {
        const [w, h] = String(stdout ?? '').trim().split(',').map(Number)
        resolve(!error && w > 0 && h > 0 ? { width: w, height: h } : fallback)
      })
  })
}

export function cancelCovers(value: unknown): void {
  try { running.get(libraryVideo(value).video)?.kill() } catch { /* nothing running */ }
}

/** Saves the cover the member made next to the video (replacing the one there); its bytes must be the format named. */
export async function saveCover(value: unknown, bytes: unknown, ext: unknown): Promise<SavedCover> {
  const { video, run } = libraryVideo(value)
  if (ext !== 'jpg' && ext !== 'png') throw new Error('Save the cover as JPG or PNG.')
  const data = bytes instanceof Uint8Array ? Buffer.from(bytes) : bytes instanceof ArrayBuffer ? Buffer.from(new Uint8Array(bytes)) : null
  if (!data || data.length < 100) throw new Error('That cover is empty. Make it again.')
  if (data.length > COVER_IMAGE_MAX_BYTES) throw new Error('That cover is too large (over 10 MB). Try JPG.')
  if (coverImageType(data) !== (ext === 'jpg' ? 'image/jpeg' : 'image/png')) throw new Error('That isn’t a JPG or PNG image.')
  const path = join(run, coverFileName(basename(video), ext as CoverExtension))
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, data, { mode: 0o644 })
  await rename(temp, path)
  // One cover per video: the other format's goes.
  for (const other of COVER_EXTENSIONS) if (other !== ext) await rm(join(run, coverFileName(basename(video), other)), { force: true })
  return { path, sizeBytes: data.length }
}
