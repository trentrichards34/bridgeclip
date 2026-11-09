import { crc32 } from 'zlib'
import type { FileHandle } from 'fs/promises'

/**
 * A plain .zip of clip files. Video is already compressed, so each file is
 * stored as is ("stored", method 0), streamed from its open handle so a large
 * export never sits in memory. Classic zip limits apply: under 4 GB in all
 * and under 65,535 files; callers check the total first.
 */

export const MAX_ZIP_BYTES = 0xffffffff - 64 * 1024 * 1024

export interface ZipEntry {
  /** Name inside the zip (a file name, no folders). */
  name: string
  /** The open source file, read from position 0; not closed here. */
  handle: FileHandle
  size: number
}

const CHUNK = 1024 * 1024

/** MS-DOS time and date for the zip headers. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  }
}

/** Write every entry into `target` (an empty file opened for writing); returns the bytes written. */
export async function writeZip(target: FileHandle, entries: ZipEntry[], now = new Date()): Promise<number> {
  if (entries.length > 0xfffe) throw new Error('Too many files for one .zip.')
  const total = entries.reduce((sum, entry) => sum + entry.size, 0)
  if (total > MAX_ZIP_BYTES) throw new Error('These clips are over 4 GB together, too big for one .zip. Export them to a folder instead.')
  const { time, date } = dosDateTime(now)
  const central: Buffer[] = []
  let offset = 0
  const write = async (buffer: Buffer): Promise<void> => {
    let done = 0
    while (done < buffer.length) done += (await target.write(buffer, done, buffer.length - done, offset + done)).bytesWritten
    offset += buffer.length
  }

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    // CRC and size are only known after reading, so a first pass computes them; the header is written once, exact.
    let crc = 0
    let size = 0
    const buffer = Buffer.allocUnsafe(CHUNK)
    for (;;) {
      const { bytesRead } = await entry.handle.read(buffer, 0, CHUNK, size)
      if (bytesRead === 0) break
      crc = crc32(buffer.subarray(0, bytesRead), crc)
      size += bytesRead
    }
    if (size > MAX_ZIP_BYTES) throw new Error('A clip is too big for a .zip. Export to a folder instead.')
    const headerOffset = offset
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc >>> 0, 14)
    local.writeUInt32LE(size, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    await write(Buffer.concat([local, name]))
    let copied = 0
    while (copied < size) {
      const { bytesRead } = await entry.handle.read(buffer, 0, Math.min(CHUNK, size - copied), copied)
      if (bytesRead === 0) throw new Error('A clip changed while it was being saved.')
      await write(buffer.subarray(0, bytesRead))
      copied += bytesRead
    }
    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50, 0)
    record.writeUInt16LE(20, 4) // made by
    record.writeUInt16LE(20, 6) // needed
    record.writeUInt16LE(0x0800, 8)
    record.writeUInt16LE(0, 10)
    record.writeUInt16LE(time, 12)
    record.writeUInt16LE(date, 14)
    record.writeUInt32LE(crc >>> 0, 16)
    record.writeUInt32LE(size, 20)
    record.writeUInt32LE(size, 24)
    record.writeUInt16LE(name.length, 28)
    record.writeUInt32LE(headerOffset, 42)
    central.push(record, name)
  }

  const directory = Buffer.concat(central)
  const directoryOffset = offset
  await write(directory)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(directoryOffset, 16)
  await write(end)
  return offset
}

/** A file name safe on macOS and Windows, unique among `taken` (case-insensitive). */
export function uniqueFileName(base: string, ext: string, taken: Set<string>): string {
  const clean = Array.from(base).filter((char) => char.charCodeAt(0) >= 32).join('').replace(/[<>:"/\\|?*]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'clip'
  for (let suffix = 0; ; suffix++) {
    const name = `${clean}${suffix ? ` (${suffix})` : ''}${ext}`
    if (!taken.has(name.toLowerCase())) { taken.add(name.toLowerCase()); return name }
  }
}
