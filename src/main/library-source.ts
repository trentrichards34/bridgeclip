import { realpathSync } from 'fs'
import { dirname, isAbsolute, resolve } from 'path'
import { getJobOutput } from './file-manager'
import { loadSettings } from './settings-store'
import { assertMediaPath, authorizeMedia } from './security'

/**
 * Library → "Remix this clip": the clip's video becomes Remix's source file.
 * The run must be a folder directly inside the Library and the clip one of its
 * own; the file is then authorized like one chosen in the file dialog.
 */
export async function libraryClipForRemix(outputDir: unknown, clipIndex: unknown): Promise<{ path: string; creator: string }> {
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
  const canonical = authorizeMedia(path)
  const channel = typeof output.source_video_channel === 'string' ? output.source_video_channel.replace(/\s+/g, ' ').trim() : ''
  return { path: canonical, creator: channel.length <= 80 ? channel : '' }
}
