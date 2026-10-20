/**
 * Background music and voice cleanup: the built-in tracks, the member's own music library, and the request fields
 * Create, Edit my recording and Remix share (`voiceCleanup`, `music`, `musicTrack`).
 *
 * The built-in tracks are original loops made for CreatorClips (engine/assets/music, made by
 * scripts/music/generate_tracks.py): members can use them in any video, including paid and monetized posts.
 */

export interface MusicTrack {
  id: string
  name: string
  /** One short line on how it sounds. */
  mood: string
  /** Seconds in one loop (it repeats seamlessly under longer videos). */
  seconds: number
}

/** Keep in sync with engine/assets/music/tracks.json (an engine test checks the ids and files). */
export const MUSIC_TRACKS: readonly MusicTrack[] = [
  { id: 'calm-pad', name: 'Calm pad', mood: 'Warm, slow chords. No beat.', seconds: 32 },
  { id: 'upbeat-pulse', name: 'Upbeat pulse', mood: 'Bright and energetic, 120 BPM.', seconds: 32 },
  { id: 'lofi-beat', name: 'Lo-fi beat', mood: 'Mellow, laid-back groove.', seconds: 34.3 },
  { id: 'cinematic-swell', name: 'Cinematic swell', mood: 'Big, slow build. Dramatic.', seconds: 40 }
]

/** The member's own tracks are named `my:<file name>` (the file is in the app's music folder). */
export const OWN_MUSIC_PREFIX = 'my:'
export const MUSIC_EXTENSIONS: readonly string[] = ['.mp3', '.wav', '.m4a']
export const MAX_MUSIC_BYTES = 30 * 1024 * 1024
export const MAX_OWN_TRACKS = 50

/** How far under the voice the music sits while someone talks (dB); it comes up 12 dB in pauses. */
export const DEFAULT_MUSIC_LEVEL_DB = -20
export const MIN_MUSIC_LEVEL_DB = -30
export const MAX_MUSIC_LEVEL_DB = -10

export function isBundledTrackId(value: unknown): boolean {
  return typeof value === 'string' && MUSIC_TRACKS.some((track) => track.id === value)
}

/** A plain file name in the music folder: no folders, no dot-files, a known audio extension. */
export function isOwnMusicName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9 ._()-]*$/.test(value) || value.includes('..')) return false
  const dot = value.lastIndexOf('.')
  return dot > 0 && MUSIC_EXTENSIONS.includes(value.slice(dot).toLowerCase())
}

export function isMusicTrackId(value: unknown): value is string {
  if (typeof value !== 'string') return false
  return isBundledTrackId(value) || (value.startsWith(OWN_MUSIC_PREFIX) && isOwnMusicName(value.slice(OWN_MUSIC_PREFIX.length)))
}

export function ownMusicId(name: string): string {
  return OWN_MUSIC_PREFIX + name
}

/** What a picker shows for a track id ('My music: song.mp3' for the member's own). */
export function musicTrackLabel(id: string | null | undefined): string {
  if (!id) return 'None'
  const bundled = MUSIC_TRACKS.find((track) => track.id === id)
  if (bundled) return bundled.name
  return id.startsWith(OWN_MUSIC_PREFIX) ? id.slice(OWN_MUSIC_PREFIX.length).replace(/\.[^.]+$/, '') : id
}

/** The sound fields on a Create, Edit my recording or Remix request. */
export interface AudioChoice {
  /** Reduce background noise and room echo on the speaker's voice and even its level. Missing: off. */
  voiceCleanup?: boolean
  /** Background music under the video that ducks while someone talks. Needs `musicTrack`. Missing: off. */
  music?: boolean
  /** A built-in track's id or `my:<file name>` for the member's own (see MusicPicker). */
  musicTrack?: string
}

/**
 * The sound fields from untrusted input: booleans, a known track id. Music without a track is an error; a track
 * without music on is dropped. Returns only the fields that are on.
 */
export function parseAudioChoice(raw: Record<string, unknown>): AudioChoice {
  if (raw.voiceCleanup !== undefined && typeof raw.voiceCleanup !== 'boolean') throw new Error('Choose whether to clean up the voice.')
  if (raw.music !== undefined && typeof raw.music !== 'boolean') throw new Error('Choose whether to add music.')
  if (raw.music === true && !isMusicTrackId(raw.musicTrack)) throw new Error('Choose the music to add, or turn music off.')
  if (raw.musicTrack !== undefined && raw.musicTrack !== null && !isMusicTrackId(raw.musicTrack)) throw new Error('Choose the music again.')
  return {
    ...(raw.voiceCleanup === true ? { voiceCleanup: true } : {}),
    ...(raw.music === true ? { music: true, musicTrack: raw.musicTrack as string } : {})
  }
}

/** The member's music settings (Settings → My music). */
export interface MusicSettings {
  /** How far under the voice the music sits while someone talks (dB). */
  levelDb: number
  /** Remix: music also plays under the other creator's clip (off: "Not during their clip"). */
  duringTheirClip: boolean
}

export const DEFAULT_MUSIC_SETTINGS: MusicSettings = { levelDb: DEFAULT_MUSIC_LEVEL_DB, duringTheirClip: false }

export function parseMusicSettings(value: unknown): MusicSettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const level = raw.levelDb ?? DEFAULT_MUSIC_LEVEL_DB
  if (typeof level !== 'number' || !Number.isFinite(level) || level < MIN_MUSIC_LEVEL_DB || level > MAX_MUSIC_LEVEL_DB) {
    throw new Error(`Set the music level between ${MIN_MUSIC_LEVEL_DB} and ${MAX_MUSIC_LEVEL_DB} dB.`)
  }
  if (raw.duringTheirClip !== undefined && typeof raw.duringTheirClip !== 'boolean') throw new Error('Choose whether music plays under their clip.')
  return { levelDb: Math.round(level), duringTheirClip: raw.duringTheirClip === true }
}

export interface OwnMusic {
  id: string
  name: string
  sizeBytes: number
}

/** What Settings → My music and the picker show. */
export interface MusicLibrary {
  tracks: readonly MusicTrack[]
  own: OwnMusic[]
  settings: MusicSettings
}
