import { app } from 'electron'
import { execFile } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync, readFileSync, realpathSync } from 'fs'
import { copyFile, link, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import { promisify } from 'util'
import {
  CTA_IMAGE_EXTENSIONS, CTA_VIDEO_EXTENSIONS, IMAGE_CTA_SECONDS, MAX_CTA_VIDEO_SECONDS, MAX_CTAS, cleanCtaName, isCtaId,
  type ClipCta, type CtaKind, type CtaSummary
} from '../shared/ctas'
import { authorizeMedia } from './security'
import { resolveBinary } from './tools'

const execFileAsync = promisify(execFile)

/**
 * The call-to-action library and the step that adds one to the end of a
 * finished clip. Everything runs locally with FFmpeg: no AI cost.
 *
 * A clip keeps its original next to it (clip_NN.original.mp4) the first time a
 * CTA is added, so switching to another CTA or removing it always starts from
 * the clip as it was rendered.
 */
const MAX_UPLOAD_BYTES = 500_000_000
// Member-chosen files are read only as local media (no playlists or network fetches).
const VIDEO_GUARD = ['-protocol_whitelist', 'file,pipe,fd', '-format_whitelist', 'mov,matroska,webm,avi,flv,mpegts']
const IMAGE_GUARD = ['-protocol_whitelist', 'file,pipe,fd', '-format_whitelist', 'image2,png_pipe,jpeg_pipe,webp_pipe']

interface StoredCta { id: string; name: string; kind: CtaKind; seconds: number; file: string; createdAt: string }

export function ctasDir(): string {
  return join(app.getPath('userData'), 'ctas')
}

function ctaDir(id: string): string {
  return join(ctasDir(), id)
}

function readStored(id: string): StoredCta | null {
  if (!isCtaId(id)) return null
  try {
    const raw = JSON.parse(readFileSync(join(ctaDir(id), 'cta.json'), 'utf8')) as Partial<StoredCta>
    if (raw.id !== id || (raw.kind !== 'video' && raw.kind !== 'image') || typeof raw.file !== 'string' || basename(raw.file) !== raw.file) return null
    if (!existsSync(join(ctaDir(id), raw.file))) return null
    const seconds = typeof raw.seconds === 'number' && Number.isFinite(raw.seconds) ? raw.seconds : IMAGE_CTA_SECONDS.default
    return { id, name: cleanCtaName(raw.name) || 'Call to action', kind: raw.kind, seconds, file: raw.file, createdAt: String(raw.createdAt ?? '') }
  } catch { return null }
}

function summary(cta: StoredCta): CtaSummary {
  const path = join(ctaDir(cta.id), cta.file)
  authorizeMedia(path)
  return { id: cta.id, name: cta.name, kind: cta.kind, seconds: cta.seconds, path, createdAt: cta.createdAt }
}

export async function listCtas(): Promise<CtaSummary[]> {
  let ids: string[] = []
  try { ids = await readdir(ctasDir()) } catch { return [] }
  return ids.map(readStored).filter((cta): cta is StoredCta => cta !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(summary)
}

/** The CTA as stored, for adding to clips. Throws a clear message when it was removed. */
export function readCta(id: unknown): StoredCta & { path: string } {
  const cta = typeof id === 'string' ? readStored(id) : null
  if (!cta) throw new Error('That call to action is no longer in your library. Choose another.')
  return { ...cta, path: join(ctaDir(cta.id), cta.file) }
}

async function writeStored(cta: StoredCta): Promise<void> {
  const file = join(ctaDir(cta.id), 'cta.json')
  await writeFile(`${file}.tmp`, JSON.stringify(cta, null, 2))
  await rename(`${file}.tmp`, file)
}

async function mediaInfo(path: string, guard: string[]): Promise<{ width: number; height: number; seconds: number; fps: number; hasAudio: boolean }> {
  const { stdout } = await execFileAsync(resolveBinary('ffprobe'), ['-v', 'error', ...guard,
    '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', path], { timeout: 30_000, maxBuffer: 1024 * 1024 })
  const info = JSON.parse(stdout) as { streams?: { codec_type?: string; width?: number; height?: number; r_frame_rate?: string }[]; format?: { duration?: string } }
  const video = info.streams?.find((stream) => stream.codec_type === 'video')
  const [num, den] = (video?.r_frame_rate ?? '30/1').split('/').map(Number)
  const fps = num > 0 && den > 0 ? num / den : 30
  return {
    width: video?.width ?? 0, height: video?.height ?? 0, seconds: Number(info.format?.duration) || 0,
    fps: Math.min(60, Math.max(15, Math.round(fps * 1000) / 1000)), hasAudio: Boolean(info.streams?.some((stream) => stream.codec_type === 'audio'))
  }
}

async function ffmpeg(args: string[], timeout = 5 * 60_000, signal?: AbortSignal): Promise<void> {
  await execFileAsync(resolveBinary('ffmpeg'), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...args], { timeout, maxBuffer: 4 * 1024 * 1024, signal })
}

/** Add a video or image from the member's computer to the library. */
export async function addCta(source: string, name: unknown): Promise<CtaSummary[]> {
  const extension = extname(source).slice(1).toLowerCase()
  const kind: CtaKind | null = CTA_VIDEO_EXTENSIONS.includes(extension) ? 'video' : CTA_IMAGE_EXTENSIONS.includes(extension) ? 'image' : null
  if (!kind) throw new Error('Choose a video (MP4, MOV, WebM) or an image (JPG, PNG, WebP).')
  const info = await stat(source)
  if (!info.isFile() || info.size > MAX_UPLOAD_BYTES) throw new Error('Choose a file under 500 MB (a CTA is a few seconds).')
  if ((await listCtas()).length >= MAX_CTAS) throw new Error(`Your library holds up to ${MAX_CTAS} calls to action. Remove one first.`)
  const id = randomBytes(8).toString('hex')
  const dir = ctaDir(id)
  await mkdir(dir, { recursive: true })
  const label = cleanCtaName(name) || cleanCtaName(basename(source, extname(source)).replace(/[_-]+/g, ' ')) || 'Call to action'
  try {
    if (kind === 'video') {
      const probe = await mediaInfo(source, VIDEO_GUARD).catch(() => null)
      if (!probe || !probe.width) throw new Error('That video could not be read. Try an MP4 or MOV from your phone.')
      if (probe.seconds && probe.seconds < 1) throw new Error('That video is under a second long.')
      const seconds = Math.min(MAX_CTA_VIDEO_SECONDS, probe.seconds || MAX_CTA_VIDEO_SECONDS)
      // Stored ready to add: upright, at most 1080x1920, 30 fps, loudness evened, stereo 48 kHz.
      const audio = probe.hasAudio ? ['-af', 'loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000', '-ac', '2', '-c:a', 'aac', '-b:a', '192k'] : ['-an']
      await ffmpeg([...VIDEO_GUARD, '-i', source, '-t', seconds.toFixed(2),
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30,setsar=1,format=yuv420p',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', ...audio, '-movflags', '+faststart', join(dir, 'cta.mp4')])
      await writeStored({ id, name: label, kind, seconds: Math.round(seconds * 100) / 100, file: 'cta.mp4', createdAt: new Date().toISOString() })
    } else {
      await ffmpeg([...IMAGE_GUARD, '-i', source, '-frames:v', '1',
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2', join(dir, 'cta.png')], 60_000)
        .catch(() => { throw new Error('That image could not be read. Try a JPG or PNG.') })
      await writeStored({ id, name: label, kind, seconds: IMAGE_CTA_SECONDS.default, file: 'cta.png', createdAt: new Date().toISOString() })
    }
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
  return listCtas()
}

export async function updateCta(id: unknown, patch: unknown): Promise<CtaSummary[]> {
  const cta = readCta(id)
  const raw = (patch ?? {}) as { name?: unknown; seconds?: unknown }
  if (raw.name !== undefined) {
    const name = cleanCtaName(raw.name)
    if (!name) throw new Error('Give the call to action a name.')
    cta.name = name
  }
  if (raw.seconds !== undefined) {
    if (cta.kind !== 'image') throw new Error('A recorded call to action plays for its own length.')
    if (typeof raw.seconds !== 'number' || !Number.isFinite(raw.seconds) || raw.seconds < IMAGE_CTA_SECONDS.min || raw.seconds > IMAGE_CTA_SECONDS.max) {
      throw new Error(`Show an image for ${IMAGE_CTA_SECONDS.min}-${IMAGE_CTA_SECONDS.max} seconds.`)
    }
    cta.seconds = Math.round(raw.seconds * 2) / 2
  }
  await writeStored({ id: cta.id, name: cta.name, kind: cta.kind, seconds: cta.seconds, file: cta.file, createdAt: cta.createdAt })
  return listCtas()
}

export async function removeCta(id: unknown): Promise<CtaSummary[]> {
  if (!isCtaId(id)) throw new Error('Choose a call to action from your library.')
  await rm(ctaDir(id), { recursive: true, force: true })
  return listCtas()
}

/** The untouched render of a clip, kept the first time a CTA is added. */
export function originalPath(clipPath: string): string {
  return join(dirname(clipPath), `${basename(clipPath, '.mp4')}.original.mp4`)
}

const even = (value: number): number => Math.max(2, Math.round(value / 2) * 2)

/** Options for adding a CTA: stop when the run is cancelled, report each clip as it finishes. */
export interface CtaRunOptions { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }

/**
 * Make `clipPath` the original render followed by the CTA (or just the
 * original when `cta` is null). Returns the new duration in milliseconds.
 * The CTA is fitted to the clip's frame at the clip's frame rate, with matching
 * audio: a video over a blurred fill of itself, an image (transparency kept)
 * over a blurred still of the clip's last frame.
 */
export async function renderClipCta(clipPath: string, cta: (StoredCta & { path: string }) | null, signal?: AbortSignal): Promise<number> {
  const original = originalPath(clipPath)
  let created = false
  if (!existsSync(original)) {
    if (!cta) return Math.round((await mediaInfo(clipPath, [])).seconds * 1000)
    // Keep the render as it was. A hard link costs no space; copy where links aren't possible.
    await link(clipPath, original).catch(() => copyFile(clipPath, original))
    created = true
  }
  const temp = join(dirname(clipPath), `.cta-${randomBytes(4).toString('hex')}.mp4`)
  try {
    if (!cta) {
      await copyFile(original, temp)
    } else {
      const clip = await mediaInfo(original, [])
      if (!clip.width || !clip.height) throw new Error('This clip could not be read.')
      const [w, h, fps] = [even(clip.width), even(clip.height), clip.fps]
      const image = cta.kind === 'image'
      const seconds = image ? cta.seconds : Math.min(cta.seconds, MAX_CTA_VIDEO_SECONDS)
      const ctaInfo = image ? { hasAudio: false } : await mediaInfo(cta.path, [])
      const inputs = ['-i', original, ...(image ? ['-loop', '1', '-framerate', String(fps), '-t', seconds.toFixed(2)] : ['-t', seconds.toFixed(2)]), '-i', cta.path,
        // An image is shown over the clip's own last moment, blurred.
        ...(image ? ['-sseof', '-0.3', '-i', original] : [])]
      let next = image ? 3 : 2
      const clipAudio = clip.hasAudio ? '[0:a]' : `[${next++}:a]`
      const ctaAudio = ctaInfo.hasAudio ? '[1:a]' : `[${next++}:a]`
      const extra: string[] = []
      if (!clip.hasAudio) extra.push('-f', 'lavfi', '-t', clip.seconds.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo')
      if (!ctaInfo.hasAudio) extra.push('-f', 'lavfi', '-t', seconds.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo')
      const audio = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo'
      const blur = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=28:2,eq=brightness=-0.15`
      const fit = `scale=${w}:${h}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`
      const visuals = image
        ? [`[2:v]tpad=stop_mode=clone:stop_duration=${seconds.toFixed(3)},trim=duration=${seconds.toFixed(3)},setpts=PTS-STARTPTS,fps=${fps},${blur}[fill]`,
          `[1:v]fps=${fps},format=rgba,${fit}[fit]`]
        : [`[1:v]fps=${fps},split[ca][cb]`, `[ca]${blur}[fill]`, `[cb]${fit}[fit]`]
      const graph = [
        `[0:v]scale=${w}:${h},fps=${fps},setsar=1,format=yuv420p[main]`,
        ...visuals,
        `[fill][fit]overlay=(W-w)/2:(H-h)/2:shortest=1,setsar=1,format=yuv420p,fade=t=in:st=0:d=0.15[end]`,
        `${clipAudio}${audio}[ma]`,
        `${ctaAudio}${audio},atrim=0:${seconds.toFixed(3)},afade=t=in:st=0:d=0.1[ea]`,
        '[main][ma][end][ea]concat=n=2:v=1:a=1[v][a]'
      ].join(';')
      // Long clips take a while to re-encode: allow about four seconds per second of video.
      const timeout = Math.max(10 * 60_000, Math.round((clip.seconds + seconds) * 4_000) + 120_000)
      await ffmpeg([...inputs, ...extra, '-filter_complex', graph, '-map', '[v]', '-map', '[a]',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(fps),
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', temp], timeout, signal)
    }
    if (signal?.aborted) throw new Error('Canceled')
    const seconds = (await mediaInfo(temp, [])).seconds
    await rename(temp, clipPath)
    if (!cta) await rm(original, { force: true })
    return Math.round(seconds * 1000)
  } catch (error) {
    await rm(temp, { force: true })
    // The clip is unchanged: don't leave a copy behind that says it has a call to action.
    if (created) await rm(original, { force: true }).catch(() => undefined)
    if (signal?.aborted) throw new Error('Canceled')
    if (error instanceof Error && /no longer|could not be read/.test(error.message)) throw error
    throw new Error('The call to action could not be added to this clip. Try again, or choose another call to action.')
  }
}

// One CTA change per run at a time (a run's clips and job_output.json are rewritten in place).
const runLocks = new Map<string, Promise<unknown>>()

/**
 * Add (or switch, or remove with null) the CTA on clips of a finished run and
 * record it in job_output.json. `indices` defaults to every clip. A cancelled
 * run stops after the clip in progress; what was done is still recorded.
 */
export function applyRunCta(run: string, ctaId: string | null, indices?: number[], options: CtaRunOptions = {}): Promise<{ failed: number[]; cancelled: boolean }> {
  return withRunLock(run, () => applyRunCtaNow(run, ctaId, indices, options))
}

/** Run `work` while holding the run's lock (no CTA change or other rewrite of its clips meanwhile). */
export function withRunLock<T>(run: string, work: () => Promise<T>): Promise<T> {
  // One lock per folder, however its path was spelled.
  let key = run
  try { key = realpathSync(run) } catch { /* a missing run fails inside `work` */ }
  const next = (runLocks.get(key) ?? Promise.resolve()).catch(() => undefined).then(work)
  runLocks.set(key, next)
  void next.finally(() => { if (runLocks.get(key) === next) runLocks.delete(key) }).catch(() => undefined)
  return next
}

/** applyRunCta for a caller already holding the run's lock (withRunLock). */
export function applyRunCtaInLock(run: string, ctaId: string | null, indices?: number[]): Promise<{ failed: number[]; cancelled: boolean }> {
  return applyRunCtaNow(run, ctaId, indices, {})
}

async function applyRunCtaNow(run: string, ctaId: string | null, indices: number[] | undefined, { signal, onProgress }: CtaRunOptions): Promise<{ failed: number[]; cancelled: boolean }> {
  const cta = ctaId ? readCta(ctaId) : null
  // Leftovers of an interrupted change (the app quit or the run was cancelled mid-clip).
  try { for (const name of await readdir(run)) if (/^\.cta-[a-f0-9]{8}\.mp4$/.test(name)) await rm(join(run, name), { force: true }) } catch { /* run folder unreadable: reported below */ }
  const file = join(run, 'job_output.json')
  const output = JSON.parse(await readFile(file, 'utf8')) as { clips?: Record<string, unknown>[] }
  const targets = (output.clips ?? []).filter((clip) => !indices || indices.includes(clip.clip_index as number))
  const failed: number[] = []
  const changed = new Set<number>()
  let done = 0
  let cancelled = false
  for (const clip of targets) {
    if (signal?.aborted) { cancelled = true; break }
    const index = clip.clip_index as number
    const path = join(run, `clip_${String(index).padStart(2, '0')}.mp4`)
    // "Free up space" removed this clip's original: its call to action is now part of the video.
    if (clip.cta && !existsSync(originalPath(path))) {
      if (indices?.length === 1) throw new Error('This clip’s original was removed to free up space, so its call to action can’t be changed or removed.')
      failed.push(index)
      onProgress?.(++done, targets.length)
      continue
    }
    if (existsSync(path)) {
      try {
        clip.duration_ms = await renderClipCta(path, cta, signal)
        clip.cta = cta ? ({ id: cta.id, name: cta.name, seconds: cta.kind === 'image' ? cta.seconds : Math.min(cta.seconds, MAX_CTA_VIDEO_SECONDS) } satisfies ClipCta) : null
        changed.add(index)
      } catch {
        if (signal?.aborted) { cancelled = true; break }
        failed.push(index)
      }
    }
    onProgress?.(++done, targets.length)
  }
  // Re-read so nothing written meanwhile is lost; only the CTA fields of the changed clips change.
  const latest = JSON.parse(await readFile(file, 'utf8')) as { clips?: Record<string, unknown>[] }
  for (const clip of latest.clips ?? []) {
    const source = targets.find((item) => item.clip_index === clip.clip_index)
    if (source && changed.has(clip.clip_index as number)) {
      clip.duration_ms = source.duration_ms
      clip.cta = source.cta ?? null
    }
  }
  const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temp, JSON.stringify(latest))
  await rename(temp, file)
  return { failed, cancelled }
}
