import { execFile } from 'child_process'
import { randomBytes, randomUUID } from 'crypto'
import { copyFile, link, lstat, mkdir, readdir, readFile, rename, rm, utimes, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { promisify } from 'util'
import { hookFromScript, MAX_HOOK_CHARS, postCaptionFromScript, type AvatarScript } from '../shared/avatars'
import { logger } from './logger'
import { resolveBinary } from './tools'

const execFileAsync = promisify(execFile)

/**
 * Avatar Studio videos as Library runs. Each finished video is its own run
 * folder in the output folder (`avatar-<uuid>`), with clip_00.mp4 and a
 * job_output.json like Create and Remix runs, so it can be posted, scheduled,
 * banked for automations, given a call to action, or deleted from the Library.
 * The render's working files (script, voiceover, scenes) stay in `.avatar/`.
 */
export const AVATAR_RUN = /^avatar-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** Where renders were saved before they became Library runs. */
export const LEGACY_FOLDER = 'Avatar Studio'
/** Written in an imported legacy folder: it names the Library run made from it, so it is imported once. */
export const IMPORTED_MARKER = '.library-run.json'
export const CLIP_FILE = 'clip_00.mp4'
export const WORK_FOLDER = '.avatar'

export function newAvatarRun(outputDirectory: string): string {
  return join(outputDirectory, `avatar-${randomUUID()}`)
}

export interface AvatarRunInfo {
  /** The video's title in the Library (also the post title when there is no caption). */
  title: string
  /** Hook text drawn at the top, or null. */
  headline: string | null
  /** Ready-to-post caption (the script's own words), or null. */
  postCaption: string | null
  durationMs: number
  /** talking, cinematic or recreate (kept for reference). */
  kind: string
  /** Estimated cost at list prices, when known. */
  estimatedCostUsd?: number | null
  createdAt?: string
}

/** The run's job_output.json content (one clip, made with AI). */
export function avatarJobOutput(run: string, info: AvatarRunInfo): Record<string, unknown> {
  const duration = Math.max(0, Math.round(info.durationMs))
  const title = info.title.replace(/\s+/g, ' ').trim().slice(0, 200) || 'Avatar video'
  return {
    job_id: basename(run), source_video_url: '', source_video_title: `Avatar Studio · ${title}`, source_video_channel: null,
    source_video_duration_seconds: duration / 1000, total_clips: 1,
    clips: [{
      clip_index: 0, s3_url: `file://${join(run, CLIP_FILE)}`, duration_ms: duration, start_time_ms: 0, end_time_ms: duration,
      virality_score: 0, layout_type: '', summary: title, headline: info.headline || null, tags: [], render_fallback: null,
      // An AI presenter and voice: posting starts with the platform's AI label on.
      ai_generated: true, post_caption: info.postCaption?.trim() ? info.postCaption.trim() : null, cta: null
    }],
    transcript_url: null, plan_url: null, processing_time_seconds: 0,
    metrics: {
      ...(typeof info.estimatedCostUsd === 'number' && Number.isFinite(info.estimatedCostUsd) ? { api_costs: { total_estimated_cost_usd: info.estimatedCostUsd } } : {}),
      avatar_studio: info.kind
    },
    created_at: info.createdAt ?? new Date().toISOString()
  }
}

/** Write job_output.json (temp file, then rename). Call inside the run's lock (ctas.withRunLock). */
export async function writeAvatarJobOutput(run: string, info: AvatarRunInfo): Promise<void> {
  const file = join(run, 'job_output.json')
  const temp = join(run, `.job_output-${randomBytes(4).toString('hex')}.json`)
  await writeFile(temp, JSON.stringify(avatarJobOutput(run, info), null, 2))
  await rename(temp, file)
}

export async function videoDurationMs(path: string): Promise<number> {
  const { stdout } = await execFileAsync(resolveBinary('ffprobe'), ['-v', 'error', '-protocol_whitelist', 'file,pipe,fd', '-format_whitelist', 'mov,matroska,webm,avi,flv',
    '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path], { timeout: 30_000 })
  const seconds = Number(stdout.trim())
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Unreadable video')
  return Math.round(seconds * 1000)
}

/** A real file (not a link) directly at `path`, or null. */
async function regularFile(path: string): Promise<{ size: number; mtime: Date } | null> {
  try {
    const stat = await lstat(path)
    return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 ? { size: stat.size, mtime: stat.mtime } : null
  } catch { return null }
}

/** The title from a legacy folder name ("2026-10-13 093105 Stop buying coffee"). */
export function legacyTitle(folder: string): string {
  return folder.replace(/^\d{4}-\d{2}-\d{2} \d{4,6}\s*/, '').trim()
}

function legacyScript(value: unknown): AvatarScript | null {
  const raw = (value ?? {}) as { title?: unknown; scenes?: unknown }
  if (!Array.isArray(raw.scenes)) return null
  const scenes = raw.scenes.slice(0, 20).flatMap((scene) => {
    const narration = (scene as { narration?: unknown } | null)?.narration
    return typeof narration === 'string' && narration.trim() ? [{ narration: narration.replace(/\s+/g, ' ').trim().slice(0, 4000), visual: '', featuresAvatar: true }] : []
  })
  if (!scenes.length) return null
  return { title: typeof raw.title === 'string' ? raw.title.replace(/\s+/g, ' ').trim().slice(0, MAX_HOOK_CHARS) : '', scenes }
}

const imports = new Map<string, Promise<number>>()

/**
 * Bring videos made before Avatar Studio saved to the Library (in
 * `<output>/Avatar Studio/<render>/final.mp4`) into the Library, once each.
 * The originals stay where they are: the video is hard-linked into a new run
 * (no extra space; copied only where links aren't possible) and the legacy
 * folder gets a marker naming the run, so it is never imported twice, even
 * after the run is deleted from the Library. Returns how many were imported.
 */
export function importLegacyAvatarVideos(outputDirectory: string, probe: (path: string) => Promise<number> = videoDurationMs): Promise<number> {
  const running = imports.get(outputDirectory)
  if (running) return running
  const work = importNow(outputDirectory, probe).finally(() => imports.delete(outputDirectory))
  imports.set(outputDirectory, work)
  return work
}

async function importNow(outputDirectory: string, probe: (path: string) => Promise<number>): Promise<number> {
  const legacy = join(outputDirectory, LEGACY_FOLDER)
  try { const stat = await lstat(legacy); if (!stat.isDirectory() || stat.isSymbolicLink()) return 0 } catch { return 0 }
  let names: string[]
  try { names = (await readdir(legacy)).sort() } catch { return 0 }
  let imported = 0
  for (const name of names) {
    const folder = join(legacy, name)
    try {
      const stat = await lstat(folder)
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue
      if (await alreadyImported(outputDirectory, folder)) continue
      let video: string | null = null, file: { size: number; mtime: Date } | null = null
      for (const candidate of ['final.mp4', 'final-no-captions.mp4']) {
        file = await regularFile(join(folder, candidate))
        if (file) { video = join(folder, candidate); break }
      }
      if (!video || !file) continue
      if (await importOne(outputDirectory, folder, name, video, file.mtime, probe)) imported++
    } catch (error) {
      logger.warn('avatar.import.failed', { message: String((error as Error)?.message ?? error).slice(0, 200) })
    }
  }
  return imported
}

async function writeMarker(folder: string, run: string, done: boolean): Promise<void> {
  const file = join(folder, IMPORTED_MARKER)
  const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temp, JSON.stringify({ run, done, at: new Date().toISOString() }, null, 2))
  await rename(temp, file)
}

/**
 * True when this legacy folder was imported (even if the member has since
 * deleted the run). An import interrupted before its run was finished is
 * cleaned up so it starts again.
 */
async function alreadyImported(outputDirectory: string, folder: string): Promise<boolean> {
  const marker = join(folder, IMPORTED_MARKER)
  if (!(await regularFile(marker))) return false
  let record: { run?: unknown; done?: unknown }
  try { record = JSON.parse(await readFile(marker, 'utf8')) as typeof record } catch { return true }
  if (record.done === true || typeof record.run !== 'string' || !AVATAR_RUN.test(record.run)) return true
  const run = join(outputDirectory, record.run)
  if (await regularFile(join(run, 'job_output.json'))) { await writeMarker(folder, record.run, true); return true }
  await rm(run, { recursive: true, force: true })
  return false
}

async function importOne(outputDirectory: string, folder: string, name: string, video: string, made: Date, probe: (path: string) => Promise<number>): Promise<boolean> {
  let durationMs: number
  try { durationMs = await probe(video) } catch { return false }
  let script: AvatarScript | null = null
  let style = 'recreate'
  try {
    const raw = JSON.parse(await readFile(join(folder, 'script.json'), 'utf8')) as Record<string, unknown>
    script = legacyScript(raw)
    if (raw.style === 'talking' || raw.style === 'cinematic') style = raw.style
  } catch { /* a Recreate render has no script */ }
  const run = newAvatarRun(outputDirectory)
  // The marker comes first, so a crash part way can't import the video twice;
  // the run is listed only once job_output.json (written last) exists.
  await writeMarker(folder, basename(run), false)
  try {
    await mkdir(join(run, WORK_FOLDER), { recursive: true })
    const clip = join(run, CLIP_FILE)
    // A hard link costs no space and leaves the original untouched (a CTA replaces the run's file, never edits it).
    await link(video, clip).catch(() => copyFile(video, clip))
    if (script) await writeFile(join(run, WORK_FOLDER, 'script.json'), JSON.stringify(script, null, 2))
    await writeFile(join(run, WORK_FOLDER, 'imported-from.json'), JSON.stringify({ folder: name, video: basename(video) }, null, 2))
    const title = (script ? hookFromScript(script) : '') || legacyTitle(name) || 'Avatar video'
    const temp = join(run, `.job_output-${randomBytes(4).toString('hex')}.json`)
    await writeFile(temp, JSON.stringify(avatarJobOutput(run, { title, headline: null, postCaption: script ? postCaptionFromScript(script) : null, durationMs, kind: style, createdAt: made.toISOString() }), null, 2))
    // The Library dates runs without a run record by job_output.json: keep the original render's date.
    await utimes(temp, made, made)
    await rename(temp, join(run, 'job_output.json'))
  } catch (error) {
    await rm(run, { recursive: true, force: true }).catch(() => undefined)
    await rm(join(folder, IMPORTED_MARKER), { force: true }).catch(() => undefined)
    throw error
  }
  await writeMarker(folder, basename(run), true)
  return true
}
