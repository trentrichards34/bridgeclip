import { app } from 'electron'
import { readFileSync, statSync } from 'fs'
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import { randomUUID } from 'crypto'
import {
  DEFAULT_MUSIC_SETTINGS, MAX_MUSIC_BYTES, MAX_OWN_TRACKS, MUSIC_EXTENSIONS, MUSIC_TRACKS, OWN_MUSIC_PREFIX,
  isBundledTrackId, isMusicTrackId, isOwnMusicName, ownMusicId, parseMusicSettings,
  type AudioChoice, type MusicLibrary, type MusicSettings, type OwnMusic
} from '../shared/music'

/**
 * Background music: the built-in tracks (shipped with the engine) and the member's own music, copied into the app's
 * folder so a run names a track by id and the engine never reads a path the renderer chose. The music settings
 * (level, Remix under their clip) are kept beside the files in settings.json.
 */
export function musicDir(): string {
  return join(app.getPath('userData'), 'music')
}

export function bundledMusicDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'engine', 'assets', 'music') : join(__dirname, '..', '..', 'engine', 'assets', 'music')
}

const SETTINGS_FILE = 'settings.json'

export function readMusicSettings(): MusicSettings {
  try {
    return parseMusicSettings(JSON.parse(readFileSync(join(musicDir(), SETTINGS_FILE), 'utf-8')))
  } catch {
    return { ...DEFAULT_MUSIC_SETTINGS }
  }
}

export async function saveMusicSettings(value: unknown): Promise<MusicLibrary> {
  const settings = parseMusicSettings(value)
  await mkdir(musicDir(), { recursive: true })
  const path = join(musicDir(), SETTINGS_FILE)
  const temp = `${path}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify(settings), 'utf-8')
  await rename(temp, path)
  return listMusic()
}

async function ownTracks(): Promise<OwnMusic[]> {
  let names: string[]
  try { names = await readdir(musicDir()) } catch { return [] }
  const own: OwnMusic[] = []
  for (const name of names.filter(isOwnMusicName).sort((a, b) => a.localeCompare(b))) {
    try {
      const info = await stat(join(musicDir(), name))
      if (info.isFile()) own.push({ id: ownMusicId(name), name: name.replace(/\.[^.]+$/, ''), sizeBytes: info.size })
    } catch { /* removed meanwhile */ }
  }
  return own
}

export async function listMusic(): Promise<MusicLibrary> {
  return { tracks: MUSIC_TRACKS, own: await ownTracks(), settings: readMusicSettings() }
}

/** A safe, unique library name for `source`. */
function libraryName(source: string, taken: Set<string>): string {
  const extension = extname(source).toLowerCase()
  const stem = basename(source, extname(source)).replace(/[^A-Za-z0-9 ._()-]+/g, '-').replace(/\.{2,}/g, '.').replace(/^[ .()-]+|[ .()-]+$/g, '').slice(0, 80) || 'music'
  const safeStem = /^[A-Za-z0-9]/.test(stem) ? stem : `music-${stem}`
  let name = `${safeStem}${extension}`
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${safeStem} (${n})${extension}`
  return name
}

/** Copy chosen files (MP3, WAV, M4A up to 30 MB) into the library. Returns the library and the files left out. */
export async function addMusic(paths: string[]): Promise<{ library: MusicLibrary; added: string[]; skipped: string[] }> {
  const dir = musicDir()
  await mkdir(dir, { recursive: true })
  const existing = await ownTracks()
  const taken = new Set(existing.map((item) => item.id.slice(OWN_MUSIC_PREFIX.length).toLowerCase()))
  const added: string[] = []
  const skipped: string[] = []
  for (const path of paths) {
    let info
    try { info = await stat(path) } catch { info = null }
    if (!info?.isFile() || !MUSIC_EXTENSIONS.includes(extname(path).toLowerCase()) || info.size > MAX_MUSIC_BYTES || info.size === 0 ||
        existing.length + added.length >= MAX_OWN_TRACKS) {
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
    added.push(ownMusicId(name))
  }
  return { library: await listMusic(), added, skipped }
}

export async function removeMusic(id: unknown): Promise<MusicLibrary> {
  if (typeof id !== 'string' || !id.startsWith(OWN_MUSIC_PREFIX) || !isOwnMusicName(id.slice(OWN_MUSIC_PREFIX.length))) throw new Error('Choose one of your tracks.')
  await rm(join(musicDir(), id.slice(OWN_MUSIC_PREFIX.length)), { force: true })
  return listMusic()
}

/** The file of a track id, checked: a built-in track in the engine's folder, or one of the member's own. */
function trackFile(id: string): string {
  if (isBundledTrackId(id)) return join(bundledMusicDir(), `${id}.ogg`)
  const name = id.slice(OWN_MUSIC_PREFIX.length)
  if (!id.startsWith(OWN_MUSIC_PREFIX) || !isOwnMusicName(name)) throw new Error('Choose the music again.')
  return join(musicDir(), name)
}

const MIME: Record<string, string> = { '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' }

/** The track's bytes for the picker's play button (played from memory: no file path reaches the page). */
export async function musicPreview(id: unknown): Promise<{ mime: string; data: Uint8Array }> {
  if (!isMusicTrackId(id)) throw new Error('Choose one of the tracks.')
  const path = trackFile(id)
  const info = await stat(path).catch(() => null)
  if (!info?.isFile() || info.size > MAX_MUSIC_BYTES) throw new Error('That track is no longer in your music.')
  return { mime: MIME[extname(path).toLowerCase()] ?? 'application/octet-stream', data: new Uint8Array(await readFile(path)) }
}

/** The music for the engine: a built-in track by id, or the member's file by its path. Throws when it's gone. */
export function resolveMusic(id: string): { track: string } | { path: string } {
  if (isBundledTrackId(id)) return { track: id }
  const path = trackFile(id)
  try {
    if (statSync(path).isFile()) return { path }
  } catch { /* reported below */ }
  throw new Error(`The music "${id.slice(OWN_MUSIC_PREFIX.length)}" is no longer in your music. Choose another track.`)
}

/**
 * The engine's "audio" options for a request's sound fields (see engine audio_finish.parse_audio), or undefined when
 * both are off. Remix also passes whether music plays under the other creator's clip.
 */
export function audioForEngine(choice: AudioChoice, remix = false): Record<string, unknown> | undefined {
  if (!choice.voiceCleanup && !(choice.music && choice.musicTrack)) return undefined
  const settings = readMusicSettings()
  return {
    voice_cleanup: choice.voiceCleanup === true,
    ...(choice.music && choice.musicTrack ? { music: resolveMusic(choice.musicTrack), music_level_db: settings.levelDb } : {}),
    ...(remix ? { music_during_clip: settings.duringTheirClip } : {})
  }
}
