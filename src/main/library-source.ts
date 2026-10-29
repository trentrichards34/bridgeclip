import { execFile } from 'child_process'
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync } from 'fs'
import { dirname, isAbsolute, join, resolve } from 'path'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import { getJobOutput } from './file-manager'
import { loadSettings } from './settings-store'
import { assertMediaPath, authorizeMedia, isWithinDirectory } from './security'
import { resolveBinary } from './tools'

const execFileAsync = promisify(execFile)

/** A regular file directly in the run (no links). */
function runFile(path: string, run: string): boolean {
  try { const stat = lstatSync(path); return stat.isFile() && !stat.isSymbolicLink() && isWithinDirectory(path, run) } catch { return false }
}

/** The run's kept copy of the source video (the one the clip editor uses), if it's still there. */
export function keptSource(run: string): string | null {
  let id = ''
  try {
    const project = JSON.parse(readFileSync(join(run, 'editor-project.json'), 'utf8')) as { source_id?: unknown; media_freed?: unknown }
    if (project.media_freed === true) return null
    if (typeof project.source_id === 'string' && /^[a-f0-9]{32}$/.test(project.source_id)) id = project.source_id
  } catch { /* No editor project: look for the plain kept copy. */ }
  for (const name of [id ? `editor-source-${id}.mp4` : '', 'editor-source.mp4']) {
    if (name && runFile(join(run, name), run)) return join(run, name)
  }
  return null
}

/**
 * The clip's moment cut from the source video: no hook text, captions, handle or call to
 * action burned in, so a remix of it doesn't stack a second headline over the first.
 * Kept in the run's .remix-sources folder and reused while it's newer than the source.
 */
async function cleanMoment(run: string, source: string, clipIndex: number, startMs: number, endMs: number): Promise<string> {
  const folder = join(run, '.remix-sources')
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  // Only a real folder in the run: a link put there could point the cut anywhere.
  const kind = lstatSync(folder)
  if (kind.isSymbolicLink() || !kind.isDirectory()) throw new Error('The clean copy\'s folder is not usable.')
  startMs = Math.max(0, startMs)
  if (!(endMs - startMs >= 500)) throw new Error('The moment is too short.')
  const target = join(folder, `clip_${String(clipIndex).padStart(2, '0')}-${Math.round(startMs)}-${Math.round(endMs)}.mp4`)
  try { if (runFile(target, folder) && statSync(target).mtimeMs >= statSync(source).mtimeMs && statSync(target).size > 0) return target } catch { /* Make it again. */ }
  // Its own partial file: two cuts of the same moment at once never write one file.
  const partial = join(folder, `.${randomUUID()}.partial.mp4`)
  try {
    await execFileAsync(resolveBinary('ffmpeg'), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', (startMs / 1000).toFixed(3), '-i', source, '-t', ((endMs - startMs) / 1000).toFixed(3),
      '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', partial], { timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 })
    renameSync(partial, target)
    return target
  } finally { try { unlinkSync(partial) } catch { /* Renamed or never made. */ } }
}

/**
 * Library → "Remix this clip": the clip's video becomes Remix's source file.
 * The run must be a folder directly inside the Library and the clip one of its
 * own; the file is then authorized like one chosen in the file dialog.
 */
export async function libraryClipForRemix(outputDir: unknown, clipIndex: unknown): Promise<{ path: string; creator: string; clean: boolean }> {
  if (typeof outputDir !== 'string' || !isAbsolute(outputDir) || outputDir.includes('\0')) throw new Error('Choose a clip in your Library.')
  if (typeof clipIndex !== 'number' || !Number.isSafeInteger(clipIndex) || clipIndex < 0) throw new Error('Choose a clip in your Library.')
  const library = loadSettings().outputDirectory
  let run: string
  try { run = realpathSync(resolve(outputDir)) } catch { throw new Error('This run is no longer in your Library.') }
  if (dirname(run) !== realpathSync(library)) throw new Error('This run is no longer in your Library.')
  const output = await getJobOutput(run, library)
  const clip = output?.clips.find((item) => item.clip_index === clipIndex)
  if (!output || !clip) throw new Error('This clip is no longer in your Library.')
  const path = clip.s3_url.startsWith('file://') ? clip.s3_url.slice('file://'.length) : clip.s3_url
  try { assertMediaPath(path, library) } catch { throw new Error('This clip’s video file is missing or outside your Library.') }
  if (!/\.(mp4|m4v|mov|mkv|webm|avi|flv)$/i.test(path)) throw new Error('Only video clips can be remixed.')
  const channel = typeof output.source_video_channel === 'string' ? output.source_video_channel.replace(/\s+/g, ' ').trim() : ''
  const creator = channel.length <= 80 ? channel : ''
  // Prefer the moment from the original video: the made clip has its hook text and captions burned in.
  const source = keptSource(run)
  if (source && Number.isFinite(clip.start_time_ms) && Number.isFinite(clip.end_time_ms) && clip.end_time_ms - clip.start_time_ms >= 500) {
    try { return { path: authorizeMedia(await cleanMoment(run, source, clipIndex, clip.start_time_ms, clip.end_time_ms)), creator, clean: true } }
    catch { /* Fall back to the made clip below. */ }
  }
  return { path: authorizeMedia(path), creator, clean: false }
}
