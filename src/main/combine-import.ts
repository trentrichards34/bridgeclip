import { createReadStream, createWriteStream, realpathSync } from 'fs'
import { mkdir, open, readdir, rm, stat } from 'fs/promises'
import { basename, extname, join, sep } from 'path'
import { randomUUID } from 'crypto'
import { Transform, type TransformCallback } from 'stream'
import { pipeline } from 'stream/promises'
import { createInflateRaw, crc32 } from 'zlib'
import { COMBINE_MAX_CLIPS, COMBINE_MAX_ZIP_BYTES, COMBINE_MAX_ZIP_ENTRIES, type ImportProgress } from '../shared/combine-clips'
import { EDIT_VIDEO_EXTENSIONS } from '../shared/edit-recording'

// ---------------------------------------------------------------------------
// Combine clips: a .zip of clips (a phone's or a computer's "Compress"), unpacked safely into a folder of its own in
// the output folder (.edit-imports/<id>/). Only video files are taken, each flattened to its own file name: folders
// in the zip, other files, __MACOSX and dotfiles are skipped, links and encrypted entries are refused, and the number
// of clips and the unpacked size are capped (a file can't unpack to more than the zip says: zip bombs stop early).
// Every byte is checked against the zip's CRC. Stored and deflated entries are read; ZIP64 (over 4 GB) too.
// ---------------------------------------------------------------------------

export const IMPORTS_DIR = '.edit-imports'

export interface ZipEntry {
  name: string
  method: number
  flags: number
  crc: number
  compressedSize: number
  size: number
  offset: number
  /** A symbolic link (unix mode in the external attributes). */
  link: boolean
}

export type { ImportProgress }

const EOCD = 0x06054b50, EOCD64 = 0x06064b50, LOCATOR64 = 0x07064b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50
const MAX_CENTRAL_BYTES = 64 * 1024 * 1024

async function readAt(handle: Awaited<ReturnType<typeof open>>, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length)
  let done = 0
  while (done < length) {
    const { bytesRead } = await handle.read(buffer, done, length - done, position + done)
    if (!bytesRead) break
    done += bytesRead
  }
  if (done < length) throw new Error('This .zip is damaged. Make it again, or choose the clips themselves.')
  return buffer
}

/** The entries listed in a zip's central directory (nothing is unpacked). */
export async function readZipEntries(path: string, maxEntries = COMBINE_MAX_ZIP_ENTRIES): Promise<ZipEntry[]> {
  const damaged = (): never => { throw new Error('This .zip is damaged. Make it again, or choose the clips themselves.') }
  const handle = await open(path, 'r')
  try {
    const size = (await handle.stat()).size
    if (size < 22) damaged()
    const tailLength = Math.min(size, 22 + 0xffff)
    const tail = await readAt(handle, size - tailLength, tailLength)
    let at = -1
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === EOCD) { at = i; break }
    if (at < 0) damaged()
    let count = tail.readUInt16LE(at + 10)
    let centralSize = tail.readUInt32LE(at + 12)
    let centralOffset = tail.readUInt32LE(at + 16)
    if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      // ZIP64: the locator sits right before the end record and points at the 64-bit end record.
      const locatorAt = size - tailLength + at - 20
      if (locatorAt < 0) damaged()
      const locator = await readAt(handle, locatorAt, 20)
      if (locator.readUInt32LE(0) !== LOCATOR64) damaged()
      const record = await readAt(handle, Number(locator.readBigUInt64LE(8)), 56)
      if (record.readUInt32LE(0) !== EOCD64) damaged()
      count = Number(record.readBigUInt64LE(32))
      centralSize = Number(record.readBigUInt64LE(40))
      centralOffset = Number(record.readBigUInt64LE(48))
    }
    if (count > maxEntries) throw new Error(`This .zip has over ${maxEntries} files in it. Zip just your clips.`)
    if (centralSize > MAX_CENTRAL_BYTES || centralOffset + centralSize > size) damaged()
    const central = await readAt(handle, centralOffset, centralSize)
    const entries: ZipEntry[] = []
    let p = 0
    for (let n = 0; n < count; n++) {
      if (p + 46 > central.length || central.readUInt32LE(p) !== CENTRAL) damaged()
      const madeBy = central.readUInt16LE(p + 4)
      const flags = central.readUInt16LE(p + 8)
      const method = central.readUInt16LE(p + 10)
      const crc = central.readUInt32LE(p + 16)
      let compressedSize = central.readUInt32LE(p + 20)
      let usize = central.readUInt32LE(p + 24)
      const nameLength = central.readUInt16LE(p + 28), extraLength = central.readUInt16LE(p + 30), commentLength = central.readUInt16LE(p + 32)
      const external = central.readUInt32LE(p + 38)
      let offset = central.readUInt32LE(p + 42)
      const end = p + 46 + nameLength + extraLength + commentLength
      if (end > central.length) damaged()
      const raw = central.subarray(p + 46, p + 46 + nameLength)
      const name = flags & 0x800 ? raw.toString('utf8') : raw.toString('latin1')
      // ZIP64 sizes and offset, for the fields marked 0xFFFFFFFF, in that order.
      let e = p + 46 + nameLength
      const extraEnd = e + extraLength
      while (e + 4 <= extraEnd) {
        const id = central.readUInt16LE(e), length = central.readUInt16LE(e + 2)
        if (id === 0x0001) {
          let q = e + 4
          const next = (): number => { if (q + 8 > e + 4 + length) damaged(); const v = Number(central.readBigUInt64LE(q)); q += 8; return v }
          if (usize === 0xffffffff) usize = next()
          if (compressedSize === 0xffffffff) compressedSize = next()
          if (offset === 0xffffffff) offset = next()
        }
        e += 4 + length
      }
      const unix = madeBy >> 8 === 3
      entries.push({ name, method, flags, crc, compressedSize, size: usize, offset, link: unix && ((external >>> 16) & 0o170000) === 0o120000 })
      p = end
    }
    return entries
  } finally { await handle.close() }
}

/** Whether an entry is a clip to take: a video file, not in __MACOSX, not a dotfile (or in a dot folder), not a folder. */
export function isClipEntry(entry: Pick<ZipEntry, 'name'>): boolean {
  const name = entry.name.replace(/\\/g, '/')
  if (!name || name.endsWith('/')) return false
  const parts = name.split('/')
  // Folders are flattened away ("..": harmless here); a dotfile, or anything in a dot folder or __MACOSX, is not a clip.
  if (parts.some((part) => part === '__MACOSX' || (part.startsWith('.') && part !== '.' && part !== '..'))) return false
  return EDIT_VIDEO_EXTENSIONS.includes(extname(parts[parts.length - 1]).slice(1).toLowerCase())
}

/** A file name for an entry: its last part only, plain characters, unique in `taken`. */
export function safeClipName(entryName: string, taken: Set<string>): string {
  const last = entryName.replace(/\\/g, '/').split('/').pop() ?? ''
  // eslint-disable-next-line no-control-regex
  const ext = extname(last), stem = basename(last, extname(last)).replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim().slice(0, 80) || 'clip'
  let name = `${stem}${ext}`, n = 2
  while (taken.has(name.toLowerCase())) name = `${stem} (${n++})${ext}`
  taken.add(name.toLowerCase())
  return name
}

/** Counts bytes and the CRC as they pass, and stops a file that unpacks to more than the zip said. */
class Checked extends Transform {
  crc = 0
  bytes = 0
  constructor(private readonly limit: number, private readonly onBytes: (bytes: number) => void) { super() }
  _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    this.bytes += chunk.length
    if (this.bytes > this.limit) { done(new Error('A clip in this .zip is bigger than the .zip says. Make the .zip again.')); return }
    this.crc = crc32(chunk, this.crc)
    this.onBytes(this.bytes)
    done(null, chunk)
  }
}

/**
 * Unpack the clips of a zip into `folder` (made here, empty). Returns the files written, in the zip's order.
 * Throws with a plain message (and leaves nothing behind) when the zip can't be used.
 */
export async function extractZipClips(zip: string, folder: string, onProgress: (files: ImportProgress[]) => void = () => undefined,
  limits = { clips: COMBINE_MAX_CLIPS, bytes: COMBINE_MAX_ZIP_BYTES }): Promise<string[]> {
  const entries = await readZipEntries(zip)
  const clips = entries.filter(isClipEntry)
  if (clips.some((entry) => entry.link)) throw new Error('This .zip has a link in it instead of a clip. Zip the clips themselves.')
  if (!clips.length) throw new Error('There are no video clips in this .zip (MP4, MOV, WebM, M4V or MKV).')
  if (clips.length > limits.clips) throw new Error(`This .zip has ${clips.length} clips. Use up to ${limits.clips}.`)
  if (clips.some((entry) => entry.flags & 0x1)) throw new Error('This .zip is password-protected. Zip the clips again without a password.')
  if (clips.some((entry) => entry.method !== 0 && entry.method !== 8)) throw new Error('This .zip uses a kind of compression the app can’t read. Zip the clips again.')
  const total = clips.reduce((sum, entry) => sum + entry.size, 0)
  if (total > limits.bytes) throw new Error(`The clips in this .zip add up to over ${Math.round(limits.bytes / 1024 ** 3)} GB. Use fewer clips.`)
  const zipSize = (await stat(zip)).size
  await mkdir(folder, { recursive: true })
  const taken = new Set<string>()
  const names = clips.map((entry) => safeClipName(entry.name, taken))
  const progress: ImportProgress[] = names.map((name) => ({ name, phase: 'waiting', percent: 0 }))
  const written: string[] = []
  const handle = await open(zip, 'r')
  let last = 0
  const report = (force = false): void => { const now = Date.now(); if (force || now - last > 150) { last = now; onProgress(progress.map((item) => ({ ...item }))) } }
  try {
    for (const [n, entry] of clips.entries()) {
      const name = names[n]
      progress[n] = { name, phase: 'copying', percent: 0 }
      report(true)
      const header = await readAt(handle, entry.offset, 30)
      if (header.readUInt32LE(0) !== LOCAL) throw new Error('This .zip is damaged. Make it again, or choose the clips themselves.')
      const start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
      if (start + entry.compressedSize > zipSize) throw new Error('This .zip is damaged. Make it again, or choose the clips themselves.')
      const target = join(folder, name)
      const checked = new Checked(entry.size, (bytes) => { progress[n].percent = entry.size ? Math.min(100, Math.round((bytes / entry.size) * 100)) : 100; report() })
      const input = entry.compressedSize ? createReadStream(zip, { start, end: start + entry.compressedSize - 1 }) : null
      const output = createWriteStream(target, { flags: 'wx', mode: 0o600 })
      if (!input) output.end()
      else if (entry.method === 8) await pipeline(input, createInflateRaw(), checked, output)
      else await pipeline(input, checked, output)
      if (input && (checked.bytes !== entry.size || (checked.crc >>> 0) !== (entry.crc >>> 0))) {
        throw new Error(`“${name}” in this .zip is damaged. Make the .zip again, or choose the clips themselves.`)
      }
      progress[n] = { name, phase: 'checking', percent: 100 }
      report(true)
      written.push(target)
    }
    return written
  } catch (error) {
    await rm(folder, { recursive: true, force: true }).catch(() => undefined)
    throw error
  } finally { await handle.close() }
}

/** A new, empty folder for one import, inside the output folder. */
export function importFolder(outputDirectory: string): string {
  return join(outputDirectory, IMPORTS_DIR, randomUUID())
}

/** Imports not in use (any but `keep`) are removed: unpacked clips are only needed until the reel is made. */
export async function cleanupImports(outputDirectory: string, keep: readonly string[] = []): Promise<void> {
  const root = join(outputDirectory, IMPORTS_DIR)
  let names: string[] = []
  try { names = await readdir(root) } catch { return }
  const real = (path: string): string => { try { return realpathSync(path) } catch { return path } }
  const kept = keep.flatMap((path) => [path, real(path)])
  for (const name of names) {
    const folder = join(root, name)
    if ([folder, real(folder)].some((dir) => kept.some((path) => path === dir || path.startsWith(dir + sep)))) continue
    await rm(folder, { recursive: true, force: true }).catch(() => undefined)
  }
}
