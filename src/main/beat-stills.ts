/**
 * The beat sheet's frames: one still of the source video at a beat's key moment, made with one FFmpeg seek (no
 * render), scaled to the sheet's size and cached in the run's .work/beats/ folder under a hash of the file (path,
 * size, modified time) and the moment. A cached frame comes back at once; new ones are made two at a time, so a
 * sheet fills in as they arrive. The page lays each beat's graphic and scene over its frame (the editor's live
 * graphics renderer), so only the frame is made here.
 */
import { spawn } from 'child_process'
import { createHash, randomUUID } from 'crypto'
import { lstatSync, mkdirSync, renameSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { resolveBinary } from './tools'

/** The frames' height in pixels (enough for a 9:16 card on a high-DPI screen). */
export const BEAT_FRAME_HEIGHT = 640
/** At most this many FFmpeg seeks at once. */
export const BEAT_FRAME_CONCURRENCY = 2
const FRAME_FILE = /^[a-f0-9]{32}\.jpg$/

/** The cache name of a frame: the file as it is on disk and the moment (to 40 ms, one frame at 25 fps). */
export function beatFrameKey(file: string, sizeBytes: number, mtimeMs: number, ms: number): string {
  return createHash('sha256').update(JSON.stringify({ v: 1, file, sizeBytes, mtimeMs: Math.round(mtimeMs), ms: Math.round(ms / 40) * 40, h: BEAT_FRAME_HEIGHT })).digest('hex').slice(0, 32)
}

export type FrameRunner = (file: string, ms: number, out: string) => Promise<void>

/** One FFmpeg seek: the frame at `ms`, scaled to BEAT_FRAME_HEIGHT, as a JPEG (rotation applied). */
export const ffmpegFrame: FrameRunner = (file, ms, out) => new Promise((resolve, reject) => {
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-ss', (Math.max(0, ms) / 1000).toFixed(3), '-i', file, '-frames:v', '1', '-an', '-sn',
    '-vf', `scale=-2:${BEAT_FRAME_HEIGHT}:flags=bilinear`, '-q:v', '5', '-f', 'image2', '-c:v', 'mjpeg', out]
  const child = spawn(resolveBinary('ffmpeg'), args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-400) })
  const timer = setTimeout(() => child.kill('SIGKILL'), 30_000)
  child.on('error', (error) => { clearTimeout(timer); reject(error) })
  child.on('close', (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`The frame could not be read (${stderr.replace(/\s+/g, ' ').trim().slice(-160)})`)) })
})

let active = 0
const waiting: (() => void)[] = []
async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= BEAT_FRAME_CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve))
  active++
  try { return await work() } finally { active--; waiting.shift()?.() }
}
/** Frames being made right now (the same frame asked twice is made once). */
const making = new Map<string, Promise<string>>()

function regularFile(path: string): boolean {
  try { const s = lstatSync(path); return s.isFile() && !s.isSymbolicLink() && s.size > 0 } catch { return false }
}

/** The cached (or newly made) frame of `file` at `ms`, in `dir`: its path. */
export async function beatFrame(dir: string, file: string, ms: number, run: FrameRunner = ffmpegFrame): Promise<string> {
  const stat = statSync(file)
  if (!stat.isFile()) throw new Error('The recording could not be read.')
  const key = beatFrameKey(file, stat.size, stat.mtimeMs, ms)
  const out = join(dir, `${key}.jpg`)
  if (!FRAME_FILE.test(`${key}.jpg`)) throw new Error('Invalid frame')
  if (regularFile(out)) return out
  const pending = making.get(out)
  if (pending) return pending
  const job = slot(async () => {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    if (lstatSync(dir).isSymbolicLink()) throw new Error('The frames folder is invalid.')
    if (regularFile(out)) return out
    const temporary = join(dir, `.tmp-${randomUUID()}.jpg`)
    try {
      await run(file, Math.round(Math.round(ms / 40) * 40), temporary)
      if (!regularFile(temporary)) throw new Error('The frame could not be read.')
      renameSync(temporary, out)
    } finally { try { unlinkSync(temporary) } catch { /* moved */ } }
    return out
  })
  making.set(out, job)
  try { return await job } finally { making.delete(out) }
}
