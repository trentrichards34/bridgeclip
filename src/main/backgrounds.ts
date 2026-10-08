import { app } from 'electron'
import { statSync } from 'fs'
import { copyFile, mkdir, readdir, rm, stat } from 'fs/promises'
import { basename, extname, join } from 'path'
import { BACKGROUND_VIDEO_EXTENSIONS, isBackgroundVideoName } from '../shared/backgrounds'

/**
 * The gameplay background library: looping videos stacked under the speaker.
 * Files are copied into the app's own folder so a job refers to one by name
 * only, and the engine never reads a path the renderer chose.
 */
export function backgroundsDir(): string {
  return join(app.getPath('userData'), 'backgrounds')
}

export async function listBackgrounds(): Promise<string[]> {
  let names: string[]
  try { names = await readdir(backgroundsDir()) }
  catch { return [] }
  return names.filter(isBackgroundVideoName).sort((a, b) => a.localeCompare(b))
}

/** A safe, unique library name for `source`. */
function libraryName(source: string, taken: Set<string>): string {
  const extension = extname(source).toLowerCase()
  const stem = basename(source, extname(source)).replace(/[^A-Za-z0-9 ._-]+/g, '-').replace(/\.{2,}/g, '.').replace(/^[ .-]+|[ .-]+$/g, '').slice(0, 80) || 'background'
  const safeStem = /^[A-Za-z0-9]/.test(stem) ? stem : `bg-${stem}`
  let name = `${safeStem}${extension}`
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${safeStem} (${n})${extension}`
  return name
}

/** Copy chosen videos into the library; returns the updated list. */
export async function addBackgrounds(paths: string[]): Promise<string[]> {
  const dir = backgroundsDir()
  await mkdir(dir, { recursive: true })
  const taken = new Set((await listBackgrounds()).map((name) => name.toLowerCase()))
  for (const path of paths) {
    if (!BACKGROUND_VIDEO_EXTENSIONS.includes(extname(path).toLowerCase())) continue
    if (!(await stat(path)).isFile()) continue
    const name = libraryName(path, taken)
    await copyFile(path, join(dir, name))
    taken.add(name.toLowerCase())
  }
  return listBackgrounds()
}

export async function removeBackground(name: unknown): Promise<string[]> {
  if (!isBackgroundVideoName(name)) throw new Error('Invalid background video')
  await rm(join(backgroundsDir(), name), { force: true })
  return listBackgrounds()
}

/** Absolute path of a library background, for the engine. Throws if it is gone. */
export function resolveBackground(name: string): string {
  if (!isBackgroundVideoName(name)) throw new Error('Invalid background video')
  const path = join(backgroundsDir(), name)
  try {
    if (statSync(path).isFile()) return path
  } catch { /* reported below */ }
  throw new Error(`The background video "${name}" is no longer in your library. Choose another in Format.`)
}
