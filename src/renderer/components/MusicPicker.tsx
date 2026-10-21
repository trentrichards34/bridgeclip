import { useCallback, useEffect, useRef, useState } from 'react'
import { Music, Pause, Play, Plus, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { getApi } from '../lib/ipc'
import { Button } from './ui/Button'
import { SettingRow } from './ui/SettingRow'
import { Switch } from './ui/Switch'
import { onRadioKeyDown, Segmented } from './ui/Segmented'
import {
  DEFAULT_MUSIC_LEVEL_DB, MUSIC_TRACKS, type MusicLibrary, type MusicSettings
} from '../../shared/music'

/** Settings → My music's volume, in words. Each is a stored level (dB under the voice); Medium is the default. */
export const MUSIC_VOLUMES = [
  { id: 'quiet', label: 'Quiet', levelDb: -26 },
  { id: 'medium', label: 'Medium', levelDb: DEFAULT_MUSIC_LEVEL_DB },
  { id: 'loud', label: 'Loud', levelDb: -14 }
] as const
export type MusicVolume = (typeof MUSIC_VOLUMES)[number]['id']

/** The word for a stored level: the nearest of the three (a level saved earlier stays as it is until changed). */
export function musicVolumeOf(levelDb: number): MusicVolume {
  return MUSIC_VOLUMES.reduce((best, item) => Math.abs(item.levelDb - levelDb) < Math.abs(best.levelDb - levelDb) ? item : best, MUSIC_VOLUMES[1] as (typeof MUSIC_VOLUMES)[number]).id
}

const EMPTY: MusicLibrary = { tracks: MUSIC_TRACKS, own: [], settings: { levelDb: DEFAULT_MUSIC_LEVEL_DB, duringTheirClip: false } }
const RIGHTS = 'Only add music you own or have the rights to use in your videos.'

// One preview plays at a time, app-wide; each track's audio is fetched once and kept as a blob URL.
const previewUrls = new Map<string, string>()
let player: HTMLAudioElement | null = null
let playingId: string | null = null
const listeners = new Set<(id: string | null) => void>()

function setPlaying(id: string | null): void {
  playingId = id
  for (const listener of listeners) listener(id)
}

export function stopMusicPreview(): void {
  player?.pause()
  setPlaying(null)
}

async function togglePreview(id: string): Promise<void> {
  if (playingId === id) {
    stopMusicPreview()
    return
  }
  stopMusicPreview()
  setPlaying(id)
  let url = previewUrls.get(id)
  if (!url) {
    const { mime, data } = await getApi().music.preview(id)
    url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }))
    previewUrls.set(id, url)
  }
  if (playingId !== id) return
  player ??= new Audio()
  player.src = url
  player.loop = true
  player.onended = () => setPlaying(null)
  await player.play()
}

function usePlaying(): string | null {
  const [id, setId] = useState<string | null>(playingId)
  useEffect(() => {
    listeners.add(setId)
    return () => { listeners.delete(setId) }
  }, [])
  return id
}

/** The member's music library (built-in tracks, their own, the settings), kept fresh across pickers. */
function useMusicLibrary(initial?: MusicLibrary): {
  library: MusicLibrary; loaded: boolean; error: string | null; setError: (error: string | null) => void
  update: (action: () => Promise<MusicLibrary>) => Promise<MusicLibrary | null>
} {
  const [library, setLibrary] = useState<MusicLibrary>(initial ?? EMPTY)
  const [loaded, setLoaded] = useState(Boolean(initial))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (initial) return
    let live = true
    getApi().music.list().then((list) => { if (live) { setLibrary(list); setLoaded(true) } })
      .catch(() => { if (live) setError('Could not load your music.') })
    return () => { live = false }
  }, [initial])
  const update = useCallback(async (action: () => Promise<MusicLibrary>): Promise<MusicLibrary | null> => {
    setError(null)
    try {
      const next = await action()
      setLibrary(next)
      setLoaded(true)
      return next
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'That did not work. Try again.')
      return null
    }
  }, [])
  return { library, loaded, error, setError, update }
}

function PlayButton({ id, name }: { id: string; name: string }): React.JSX.Element {
  const playing = usePlaying() === id
  const [failed, setFailed] = useState(false)
  return (
    <button
      type="button"
      aria-label={playing ? `Stop ${name}` : `Play ${name}`}
      aria-pressed={playing}
      title={failed ? 'This track could not be played.' : undefined}
      onClick={(event) => {
        event.stopPropagation()
        setFailed(false)
        togglePreview(id).catch(() => { setFailed(true); setPlaying(null) })
      }}
      className={cn(
        'grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors',
        playing ? 'bg-accent text-accent-ink' : 'bg-white/[0.08] text-ink-muted hover:bg-white/[0.14] hover:text-ink',
        failed && 'text-danger'
      )}
    >
      {playing ? <Pause className="h-3.5 w-3.5" aria-hidden="true" /> : <Play className="ml-0.5 h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  )
}

interface MusicPickerProps {
  /** The chosen track's id (a built-in track, or `my:<file>` for the member's own), or null for no music. */
  value: string | null
  onChange: (id: string | null) => void
  /** Tests and stories: the library to show without loading it. */
  initialLibrary?: MusicLibrary
  className?: string
}

/**
 * Background music: None, the built-in tracks (made for CreatorClips, free to use in any video) and the member's
 * own, each with a play button; "My own music…" adds an MP3, WAV or M4A and picks it. Two columns, so it fits a
 * 300 px panel.
 */
export function MusicPicker({ value, onChange, initialLibrary, className }: MusicPickerProps): React.JSX.Element {
  const { library, loaded, error, update } = useMusicLibrary(initialLibrary)
  const [busy, setBusy] = useState(false)
  const [skipped, setSkipped] = useState<string[]>([])

  // A chosen track of their own that was removed (elsewhere) falls back to no music.
  useEffect(() => {
    if (value && loaded && value.startsWith('my:') && !library.own.some((track) => track.id === value)) onChange(null)
  }, [loaded, library, value, onChange])
  useEffect(() => () => stopMusicPreview(), [])

  const addOwn = async (): Promise<void> => {
    setBusy(true)
    try {
      let added: string[] = []
      await update(async () => {
        const result = await getApi().music.add()
        added = result.added
        setSkipped(result.skipped)
        return result.library
      })
      if (added[0]) onChange(added[0])
    } finally { setBusy(false) }
  }

  const options = [
    ...library.tracks.map((track) => ({ id: track.id, name: track.name, detail: track.mood, own: false })),
    ...library.own.map((track) => ({ id: track.id, name: track.name, detail: 'My music', own: true }))
  ]

  return (
    <div className={cn('space-y-2', className)}>
      <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Background music">
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          tabIndex={value === null ? 0 : -1}
          onKeyDown={onRadioKeyDown}
          onClick={() => { stopMusicPreview(); onChange(null) }}
          className={cn('glass-tile glass-tile-hover flex min-h-[3.25rem] items-center rounded-xl px-3 py-2 text-left',
            value === null ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}
        >
          <span className="text-xs font-medium">None</span>
        </button>
        {options.map((option) => {
          const selected = value === option.id
          return (
            <div key={option.id} className="relative min-w-0">
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onKeyDown={onRadioKeyDown}
                onClick={() => onChange(option.id)}
                className={cn('glass-tile glass-tile-hover flex min-h-[3.25rem] w-full min-w-0 flex-col justify-center rounded-xl py-2 pl-3 pr-10 text-left',
                  selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}
              >
                <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
                  {option.own && <Music className="h-3 w-3 shrink-0" aria-hidden="true" />}
                  <span className="truncate" title={option.name}>{option.name}</span>
                </span>
                <span className="mt-0.5 block truncate text-2xs text-ink-subtle" title={option.detail}>{option.detail}</span>
              </button>
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                <PlayButton id={option.id} name={option.name} />
              </div>
            </div>
          )
        })}
        <button
          type="button"
          disabled={busy}
          onClick={() => { void addOwn() }}
          className="glass-tile glass-tile-hover flex min-h-[3.25rem] items-center gap-1.5 rounded-xl border border-dashed border-white/15 px-3 py-2 text-left text-ink-muted hover:text-ink disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="text-xs font-medium">My own music…</span>
        </button>
      </div>
      <p className="text-2xs leading-relaxed text-ink-subtle">
        {value ? 'Plays under the whole video and drops while someone talks.' : 'The built-in tracks are made for CreatorClips and free to use in any video.'}
        {' '}{RIGHTS}
      </p>
      {skipped.length > 0 && (
        <p className="text-2xs text-warning" role="status">Left out (use MP3, WAV or M4A up to 30 MB): {skipped.join(', ')}</p>
      )}
      {error && <p className="text-2xs text-danger" role="alert">{error}</p>}
    </div>
  )
}

/** Settings → My music: the member's own tracks (play, remove, add), how loud music sits, and Remix's choice. */
export function MusicSettingsPanel({ initialLibrary }: { initialLibrary?: MusicLibrary }): React.JSX.Element {
  const { library, error, update } = useMusicLibrary(initialLibrary)
  const [busy, setBusy] = useState(false)
  const [skipped, setSkipped] = useState<string[]>([])
  const saved = useRef(library.settings)
  useEffect(() => { saved.current = library.settings }, [library.settings])
  useEffect(() => () => stopMusicPreview(), [])

  const save = (patch: Partial<MusicSettings>): void => {
    const next = { ...saved.current, ...patch }
    if (next.levelDb === saved.current.levelDb && next.duringTheirClip === saved.current.duringTheirClip) return
    void update(() => getApi().music.saveSettings(next))
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5" role="list" aria-label="My music">
        {library.own.length === 0 && (
          <p className="glass-tile rounded-xl px-3 py-3 text-xs text-ink-muted">
            No music of your own yet. The built-in tracks are always there to pick in Create, Edit my recording and Remix.
          </p>
        )}
        {library.own.map((track) => (
          <div key={track.id} role="listitem" className="glass-tile flex items-center gap-2.5 rounded-xl px-3 py-2">
            <PlayButton id={track.id} name={track.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink" title={track.name}>{track.name}</p>
              <p className="text-2xs text-ink-subtle">{(track.sizeBytes / 1024 / 1024).toFixed(1)} MB</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              aria-label={`Remove ${track.name} from my music`}
              icon={<X className="h-3.5 w-3.5" />}
              onClick={() => { stopMusicPreview(); void update(() => getApi().music.remove(track.id)) }}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xs text-ink-subtle">MP3, WAV or M4A, up to 30 MB each. {RIGHTS}</p>
        <Button
          size="sm"
          icon={<Plus className="h-3.5 w-3.5" />}
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void update(async () => { const result = await getApi().music.add(); setSkipped(result.skipped); return result.library })
              .finally(() => setBusy(false))
          }}
        >
          Add music
        </Button>
      </div>
      {skipped.length > 0 && <p className="text-2xs text-warning" role="status">Left out (use MP3, WAV or M4A up to 30 MB): {skipped.join(', ')}</p>}
      <SettingRow
        title="Music volume"
        description="How loud music plays under your voice while you talk. It comes back up in pauses. Medium suits most videos."
        control={<Segmented size="sm" label="Music volume" value={musicVolumeOf(library.settings.levelDb)}
          options={MUSIC_VOLUMES.map((item) => ({ value: item.id, label: item.label }))}
          onChange={(id) => save({ levelDb: MUSIC_VOLUMES.find((item) => item.id === id)?.levelDb ?? DEFAULT_MUSIC_LEVEL_DB })} />}
      />
      <SettingRow
        title="Music under their clip in Remix"
        description="Off: the music stops while the other creator's clip plays, so their sound stays as it was."
        control={<Switch label="Music under their clip in Remix" checked={library.settings.duringTheirClip} onChange={(on) => save({ duringTheirClip: on })} />}
      />
      {error && <p className="text-2xs text-danger" role="alert">{error}</p>}
    </div>
  )
}
