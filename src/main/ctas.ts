import { app } from 'electron'
import { execFile } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync, readFileSync } from 'fs'
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

async function ffmpeg(args: string[], timeout = 5 * 60_000): Promise<void> {
  await execFileAsync(resolveBinary('ffmpeg'), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...args], { timeout, maxBuffer: 4 * 1024 * 1024 })
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
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-q:v', '2', join(dir, 'cta.jpg')], 60_000)
        .catch(() => { throw new Error('That image could not be read. Try a JPG or PNG.') })
      await writeStored({ id, name: label, kind, seconds: IMAGE_CTA_SECONDS.default, file: 'cta.jpg', createdAt: new Date().toISOString() })
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

/**
 * Make `clipPath` the original render followed by the CTA (or just the
 * original when `cta` is null). Returns the new duration in milliseconds.
 * The CTA is fitted to the clip's frame over a blurred fill of itself, at the
 * clip's frame rate, with matching audio.
 */
export async function renderClipCta(clipPath: string, cta: (StoredCta & { path: string }) | null): Promise<number> {
  const original = originalPath(clipPath)
  if (!existsSync(original)) {
    if (!cta) return Math.round((await mediaInfo(clipPath, [])).seconds * 1000)
    // Keep the render as it was. A hard link costs no space; copy where links aren't possible.
    await link(clipPath, original).catch(() => copyFile(clipPath, original))
  }
  const temp = join(dirname(clipPath), `.cta-${randomBytes(4).toString('hex')}.mp4`)
  try {
    if (!cta) {
      await copyFile(original, temp)
    } else {
      const clip = await mediaInfo(original, [])
      if (!clip.width || !clip.height) throw new Error('This clip could not be read.')
      const [w, h, fps] = [even(clip.width), even(clip.height), clip.fps]
      const seconds = cta.kind === 'image' ? cta.seconds : Math.min(cta.seconds, MAX_CTA_VIDEO_SECONDS)
      const ctaInfo = cta.kind === 'video' ? await mediaInfo(cta.path, []) : { hasAudio: false }
      const inputs = ['-i', original, ...(cta.kind === 'image' ? ['-loop', '1', '-framerate', String(fps), '-t', seconds.toFixed(2)] : ['-t', seconds.toFixed(2)]), '-i', cta.path]
      let silence = 2
      const clipAudio = clip.hasAudio ? '[0:a]' : `[${silence++}:a]`
      const ctaAudio = ctaInfo.hasAudio ? '[1:a]' : `[${silence++}:a]`
      const extra: string[] = []
      if (!clip.hasAudio) extra.push('-f', 'lavfi', '-t', clip.seconds.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo')
      if (!ctaInfo.hasAudio) extra.push('-f', 'lavfi', '-t', seconds.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo')
      const audio = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo'
      const graph = [
        `[0:v]scale=${w}:${h},fps=${fps},setsar=1,format=yuv420p[main]`,
        `[1:v]fps=${fps},split[ca][cb]`,
        `[ca]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=28:2,eq=brightness=-0.15[fill]`,
        `[cb]scale=${w}:${h}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2[fit]`,
        `[fill][fit]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p,fade=t=in:st=0:d=0.15[end]`,
        `${clipAudio}${audio}[ma]`,
        `${ctaAudio}${audio},atrim=0:${seconds.toFixed(3)},afade=t=in:st=0:d=0.1[ea]`,
        '[main][ma][end][ea]concat=n=2:v=1:a=1[v][a]'
      ].join(';')
      await ffmpeg([...inputs, ...extra, '-filter_complex', graph, '-map', '[v]', '-map', '[a]',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(fps),
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', temp], 10 * 60_000)
    }
    const seconds = (await mediaInfo(temp, [])).seconds
    await rename(temp, clipPath)
    if (!cta) await rm(original, { force: true })
    return Math.round(seconds * 1000)
  } catch (error) {
    await rm(temp, { force: true })
    if (error instanceof Error && /no longer|could not be read/.test(error.message)) throw error
    throw new Error('The call to action could not be added to this clip. Try again, or choose another call to action.')
  }
}

/**
 * Add (or switch, or remove with null) the CTA on clips of a finished run and
 * record it in job_output.json. `indices` defaults to every clip.
 */
export async function applyRunCta(run: string, ctaId: string | null, indices?: number[]): Promise<{ failed: number[] }> {
  const cta = ctaId ? readCta(ctaId) : null
  const file = join(run, 'job_output.json')
  const output = JSON.parse(await readFile(file, 'utf8')) as { clips?: Record<string, unknown>[] }
  const failed: number[] = []
  for (const clip of output.clips ?? []) {
    const index = clip.clip_index as number
    if (indices && !indices.includes(index)) continue
    const path = join(run, `clip_${String(index).padStart(2, '0')}.mp4`)
    if (!existsSync(path)) continue
    try {
      clip.duration_ms = await renderClipCta(path, cta)
      clip.cta = cta ? ({ id: cta.id, name: cta.name } satisfies ClipCta) : null
    } catch { failed.push(index) }
  }
  // Re-read so nothing written meanwhile is lost; only the CTA fields change.
  const latest = JSON.parse(await readFile(file, 'utf8')) as { clips?: Record<string, unknown>[] }
  for (const clip of latest.clips ?? []) {
    const changed = output.clips?.find((item) => item.clip_index === clip.clip_index)
    if (changed && (!indices || indices.includes(clip.clip_index as number))) {
      clip.duration_ms = changed.duration_ms
      clip.cta = changed.cta ?? null
    }
  }
  await writeFile(`${file}.cta.tmp`, JSON.stringify(latest))
  await rename(`${file}.cta.tmp`, file)
  return { failed }
}
