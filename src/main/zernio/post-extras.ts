// Files that go with a post besides the clip: a cover image (a frame of the
// clip, or an image the member chose) and the clip's subtitle file for
// YouTube captions. Each is checked here, then uploaded to Zernio's storage
// like the clip (POST /v1/media/presign, then a PUT).

import { execFile } from 'child_process'
import { constants, existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'fs'
import { mkdtemp, open, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { promisify } from 'util'
import { authorizeMedia, isWithinDirectory, openAuthorizedMedia } from '../security'
import { resolveBinary } from '../tools'
import { putFile } from './posts-upload'
import type { ZernioClient } from './client'
import {
  COVER_IMAGE_EXTENSIONS,
  COVER_IMAGE_MAX_BYTES,
  SUBTITLE_MAX_BYTES,
  coverImageType,
  isSubtitleLanguage,
  subtitleTextError,
  type ClipSubtitles,
  type SubtitleFormat
} from '../../shared/zernio-extras'

const execFileAsync = promisify(execFile)
const MAX_JOB_OUTPUT_BYTES = 20 * 1024 * 1024

// ---- Cover frame ------------------------------------------------------------

/**
 * ffmpeg arguments for one full-size JPEG of `source` at `atMs`. Input
 * protocols and demuxers are limited as elsewhere in the app; `-n` never
 * overwrites, so the output must be a fresh path.
 */
export function coverFrameArgs(source: string, atMs: number, output: string): string[] {
  if (!Number.isInteger(atMs) || atMs < 0) throw new Error('Invalid cover frame time')
  if (!isAbsolute(source) || !isAbsolute(output) || source.includes('\0') || output.includes('\0')) throw new Error('Invalid cover frame path')
  if (extname(output).toLowerCase() !== '.jpg') throw new Error('Cover frames are written as JPEG')
  return [
    '-v', 'error', '-n',
    // Seeking before the input is fast and frame-accurate when decoding.
    '-ss', (atMs / 1000).toFixed(3),
    '-protocol_whitelist', 'file,pipe,fd', '-format_whitelist', 'mov,matroska,webm,avi,flv',
    '-i', source,
    '-frames:v', '1', '-q:v', '2',
    // Keep the clip's size, but never over 1920 on the long side (well under 10 MB).
    '-vf', "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))'",
    output
  ]
}

class CoverFrameError extends Error {}

/** A JPEG of the clip at `atMs` in a new temp folder; `cleanup` removes it. */
export async function extractCoverFrame(clipPath: string, atMs: number): Promise<{ bytes: Buffer; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'creatorclips-cover-'))
  const cleanup = (): Promise<void> => rm(dir, { recursive: true, force: true })
  try {
    const output = join(dir, 'cover.jpg')
    await execFileAsync(resolveBinary('ffmpeg'), coverFrameArgs(realpathSync(clipPath), atMs, output), { timeout: 30_000, maxBuffer: 1024 * 1024 })
    const bytes = existsSync(output) ? readFileSync(output) : Buffer.alloc(0)
    if (bytes.length === 0 || coverImageType(bytes) !== 'image/jpeg') throw new CoverFrameError('Couldn’t take that frame from the clip. Pick another time.')
    if (bytes.length > COVER_IMAGE_MAX_BYTES) throw new CoverFrameError('That frame is too large to use as a cover.')
    return { bytes, cleanup }
  } catch (error) {
    await cleanup()
    // ffmpeg's own message holds the command line; keep it out of the dialog.
    if (error instanceof CoverFrameError) throw new Error(error.message)
    throw new Error('Couldn’t take that frame from the clip. Pick another time.')
  }
}

// ---- Cover image ------------------------------------------------------------

export interface CoverImage { path: string; bytes: Buffer; contentType: 'image/jpeg' | 'image/png'; key: string }

/**
 * An image the member chose in the file dialog (authorized when picked):
 * JPG or PNG by its bytes, not just its name, and at most 10 MB.
 */
export async function readCoverImage(path: string, outputDirectory: string): Promise<CoverImage> {
  const extension = extname(path).slice(1).toLowerCase()
  if (!(COVER_IMAGE_EXTENSIONS as readonly string[]).includes(extension)) throw new Error('Choose a JPG or PNG image for the cover.')
  let opened: Awaited<ReturnType<typeof openAuthorizedMedia>>
  try { opened = await openAuthorizedMedia(path, outputDirectory) } catch { throw new Error('Choose the cover image again.') }
  try {
    if (opened.size > COVER_IMAGE_MAX_BYTES) throw new Error('Cover images can be at most 10 MB.')
    if (opened.size === 0) throw new Error('That cover image is empty.')
    const bytes = await opened.handle.readFile()
    const contentType = coverImageType(bytes)
    if (!contentType) throw new Error('Choose a JPG or PNG image for the cover.')
    const stat = await opened.handle.stat()
    return { path: opened.canonical, bytes, contentType, key: `image:${opened.canonical}:${stat.size}:${stat.mtimeMs}` }
  } finally { await opened.handle.close() }
}

/** Checks an image just picked in the file dialog and lets the renderer show it. */
export async function checkPickedCoverImage(path: string, outputDirectory: string): Promise<{ path: string; sizeBytes: number }> {
  const extension = extname(path).slice(1).toLowerCase()
  if (!(COVER_IMAGE_EXTENSIONS as readonly string[]).includes(extension)) throw new Error('Choose a JPG or PNG image for the cover.')
  const canonical = authorizeMedia(path)
  const image = await readCoverImage(canonical, outputDirectory)
  return { path: image.path, sizeBytes: image.bytes.length }
}

// ---- Subtitles --------------------------------------------------------------

export interface FoundSubtitles { path: string; format: SubtitleFormat; language: string | null }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function sameFile(a: string, b: string): boolean {
  try { return realpathSync(a) === realpathSync(b) } catch { return false }
}

function clipEntry(runDir: string, clipPath: string): { clip: Record<string, unknown>; output: Record<string, unknown> } | null {
  const file = join(runDir, 'job_output.json')
  try {
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_JOB_OUTPUT_BYTES) return null
    const output = record(JSON.parse(readFileSync(file, 'utf8')))
    const clips = Array.isArray(output?.clips) ? output.clips : []
    for (const value of clips) {
      const clip = record(value)
      const url = clip?.s3_url
      if (typeof url !== 'string' || !url.startsWith('file://')) continue
      let local: string
      try { local = fileURLToPath(url) } catch { continue }
      if (sameFile(local, clipPath)) return { clip: clip!, output: output! }
    }
  } catch { /* No readable run file: fall back to the file next to the clip. */ }
  return null
}

/**
 * The clip's subtitle file: the path its run recorded (job_output clip field
 * `captions_srt`, absolute or relative to the run folder), else Create's
 * `clip_NN.srt` beside `clip_NN.mp4`. Only a regular file inside the clip's
 * own folder counts.
 */
export function findClipSubtitles(clipPath: string): FoundSubtitles | null {
  let runDir: string
  try { runDir = dirname(realpathSync(clipPath)) } catch { return null }
  const entry = clipEntry(runDir, clipPath)
  const recorded = entry?.clip.captions_srt
  const languageValue = entry?.clip.captions_language ?? entry?.output.caption_language
  const language = isSubtitleLanguage(languageValue) ? languageValue : null
  const candidates: string[] = []
  if (typeof recorded === 'string' && recorded && recorded.length <= 4096 && !recorded.includes('\0')) {
    candidates.push(isAbsolute(recorded) ? recorded : resolve(runDir, recorded))
  }
  candidates.push(join(runDir, `${basename(clipPath, extname(clipPath))}.srt`))
  for (const candidate of candidates) {
    const extension = extname(candidate).toLowerCase()
    if (extension !== '.srt' && extension !== '.vtt') continue
    try {
      const stat = lstatSync(candidate)
      if (!stat.isFile() || stat.isSymbolicLink() || !isWithinDirectory(candidate, runDir)) continue
      return { path: candidate, format: extension === '.vtt' ? 'vtt' : 'srt', language }
    } catch { /* Not there. */ }
  }
  return null
}

export interface SubtitleFile { bytes: Buffer; contentType: 'application/x-subrip' | 'text/vtt'; fileName: string; key: string }

/** Reads and checks a subtitle file found by findClipSubtitles; throws with a readable reason. */
export async function readSubtitles(found: FoundSubtitles): Promise<SubtitleFile> {
  const handle = await open(found.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('The clip’s subtitle file can’t be read.')
    if (stat.size === 0) throw new Error('The clip’s subtitle file is empty.')
    if (stat.size > SUBTITLE_MAX_BYTES) throw new Error('The clip’s subtitle file is over 1 MB, the most Zernio accepts.')
    const bytes = await handle.readFile()
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new Error('The clip’s subtitle file isn’t UTF-8 text.') }
    const problem = subtitleTextError(text, found.format)
    if (problem) throw new Error(problem)
    return {
      bytes,
      contentType: found.format === 'vtt' ? 'text/vtt' : 'application/x-subrip',
      fileName: basename(found.path),
      key: `subtitles:${realpathSync(found.path)}:${stat.size}:${stat.mtimeMs}`
    }
  } finally { await handle.close() }
}

/** What the post dialog shows; a file that fails the checks counts as none. */
export async function describeClipSubtitles(clipPath: string): Promise<ClipSubtitles> {
  const found = findClipSubtitles(clipPath)
  if (!found) return { found: false, fileName: null, language: null }
  try {
    const file = await readSubtitles(found)
    return { found: true, fileName: file.fileName, language: found.language }
  } catch {
    return { found: false, fileName: null, language: null }
  }
}

// ---- Upload -----------------------------------------------------------------

/** Uploads a small file to Zernio's storage and returns its public URL. */
export async function uploadBytes(client: ZernioClient, fileName: string, contentType: string, bytes: Buffer, signal?: AbortSignal): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'creatorclips-upload-'))
  try {
    const file = join(dir, 'file')
    await writeFile(file, bytes, { mode: 0o600, flag: 'wx' })
    const handle = await open(file, constants.O_RDONLY)
    try {
      const size = statSync(file).size
      const { uploadUrl, publicUrl } = await client.presignMedia(fileName, contentType, size)
      await putFile(uploadUrl, handle, { contentType, size, signal })
      return publicUrl
    } finally { await handle.close() }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
