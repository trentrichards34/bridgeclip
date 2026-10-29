import { app } from 'electron'
import { readdirSync, statSync } from 'fs'
import { copyFile, mkdir, readFile, rename, rm, stat } from 'fs/promises'
import { basename, extname, join } from 'path'
import { randomUUID } from 'crypto'
import {
  MAX_OWN_SOUNDS, MAX_SOUND_BYTES, OWN_SOUND_EXTENSIONS, SOUND_ACTIONS, isOwnSoundName, isSoundAction, parseOwnSoundId,
  type OwnSound, type SoundAction, type SoundLibrary
} from '../shared/sound-design'

/**
 * My sounds: the member's own sound effects, copied into the app's folder, one folder per action
 * (userData/sounds/<action>/<file>). A sound is named by its id (`<action>/<file name>`), so the renderer never names
 * a path; the engine gets the checked paths (soundPaletteForEngine) and uses them before its built-in sounds.
 */
export function soundsDir(): string {
  return join(app.getPath('userData'), 'sounds')
}

function ownSoundsSync(): OwnSound[] {
  const own: OwnSound[] = []
  for (const action of SOUND_ACTIONS) {
    let names: string[]
    try { names = readdirSync(join(soundsDir(), action)) } catch { continue }
    for (const name of names.filter(isOwnSoundName).sort((a, b) => a.localeCompare(b))) {
      try {
        const info = statSync(join(soundsDir(), action, name))
        if (info.isFile() && info.size > 0 && info.size <= MAX_SOUND_BYTES) own.push({ id: `${action}/${name}`, action, name: name.replace(/\.[^.]+$/, ''), sizeBytes: info.size })
      } catch { /* removed meanwhile */ }
    }
  }
  return own
}

async function ownSounds(): Promise<OwnSound[]> {
  return ownSoundsSync()
}

export async function listSounds(): Promise<SoundLibrary> {
  return { own: await ownSounds() }
}

/** A safe name for `source` that no sound in any action folder has yet (so a sound keeps its name when it moves). */
function libraryName(source: string, taken: Set<string>): string {
  const extension = extname(source).toLowerCase()
  const stem = basename(source, extname(source)).replace(/[^A-Za-z0-9 ._()-]+/g, '-').replace(/\.{2,}/g, '.').replace(/^[ .()-]+|[ .()-]+$/g, '').slice(0, 80) || 'sound'
  const safeStem = /^[A-Za-z0-9]/.test(stem) ? stem : `sound-${stem}`
  let name = `${safeStem}${extension}`
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${safeStem} (${n})${extension}`
  return name
}

/** Copy chosen files (MP3, WAV, M4A or Ogg up to 5 MB) in as sounds for `action`. Returns the library and the files left out. */
export async function addSounds(action: unknown, paths: string[]): Promise<{ library: SoundLibrary; added: string[]; skipped: string[] }> {
  if (!isSoundAction(action)) throw new Error('Choose what the sound is for.')
  const dir = join(soundsDir(), action)
  await mkdir(dir, { recursive: true })
  const existing = await ownSounds()
  const taken = new Set(existing.map((item) => item.id.slice(item.id.indexOf('/') + 1).toLowerCase()))
  const added: string[] = []
  const skipped: string[] = []
  for (const path of paths) {
    let info
    try { info = await stat(path) } catch { info = null }
    if (!info?.isFile() || !OWN_SOUND_EXTENSIONS.includes(extname(path).toLowerCase()) || info.size > MAX_SOUND_BYTES || info.size === 0 ||
        existing.length + added.length >= MAX_OWN_SOUNDS) {
      skipped.push(basename(path))
      continue
    }
    const name = libraryName(path, taken)
    const temp = join(dir, `.${randomUUID()}.part`)
    try {
      await copyFile(path, temp)
      await rename(temp, join(dir, name))
    } catch {
      await rm(temp, { force: true })
      skipped.push(basename(path))
      continue
    }
    taken.add(name.toLowerCase())
    added.push(`${action}/${name}`)
  }
  return { library: await listSounds(), added, skipped }
}

/** The "Add sounds" button: the action is checked before the file dialog (`pick`) opens; null from it is a cancel. */
export async function addSoundsFromPicker(action: unknown, pick: () => Promise<string[] | null>): Promise<{ library: SoundLibrary; added: string[]; skipped: string[] }> {
  if (!isSoundAction(action)) throw new Error('Choose what the sound is for.')
  const paths = await pick()
  if (!paths) return { library: await listSounds(), added: [], skipped: [] }
  return addSounds(action, paths.slice(0, 20))
}

function soundFile(id: unknown): { action: SoundAction; name: string; path: string } {
  const parsed = parseOwnSoundId(id)
  if (!parsed) throw new Error('Choose one of your sounds.')
  return { ...parsed, path: join(soundsDir(), parsed.action, parsed.name) }
}

export async function removeSound(id: unknown): Promise<SoundLibrary> {
  await rm(soundFile(id).path, { force: true })
  return listSounds()
}

/** Tag a sound with another action (it moves to that action's folder, keeping its name). */
export async function setSoundAction(id: unknown, action: unknown): Promise<SoundLibrary> {
  const from = soundFile(id)
  if (!isSoundAction(action)) throw new Error('Choose what the sound is for.')
  if (action === from.action) return listSounds()
  const info = await stat(from.path).catch(() => null)
  if (!info?.isFile()) throw new Error('That sound is no longer in your sounds.')
  await mkdir(join(soundsDir(), action), { recursive: true })
  const to = join(soundsDir(), action, from.name)
  if (await stat(to).catch(() => null)) throw new Error('A sound with that name is already there.')
  await rename(from.path, to)
  return listSounds()
}

const MIME: Record<string, string> = { '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' }

/** The sound's bytes for its play button (played from memory: no file path reaches the page). */
export async function soundPreview(id: unknown): Promise<{ mime: string; data: Uint8Array }> {
  const { path } = soundFile(id)
  const info = await stat(path).catch(() => null)
  if (!info?.isFile() || info.size > MAX_SOUND_BYTES) throw new Error('That sound is no longer in your sounds.')
  return { mime: MIME[extname(path).toLowerCase()] ?? 'application/octet-stream', data: new Uint8Array(await readFile(path)) }
}

/** The member's sounds for the engine: [{path, action}] (engine sound_design.palette_of checks each file again). */
export function soundPaletteForEngine(): { path: string; action: SoundAction }[] {
  try {
    return ownSoundsSync().map((sound) => ({ path: join(soundsDir(), sound.id), action: sound.action }))
  } catch {
    return []
  }
}
