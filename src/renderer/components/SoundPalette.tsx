import { useCallback, useEffect, useState } from 'react'
import { Pause, Play, Plus, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { getApi } from '../lib/ipc'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import {
  MAX_SOUND_SECONDS, SOUND_ACTION_INFO, SOUND_ACTIONS, type SoundAction, type SoundLibrary
} from '../../shared/sound-design'

const RIGHTS = 'Only add sounds you own or have the rights to use in your videos.'
const ACTION_OPTIONS = SOUND_ACTIONS.map((action) => ({ value: action, label: SOUND_ACTION_INFO[action].label }))

// One preview plays at a time; each sound's audio is fetched once and kept as a blob URL.
const previewUrls = new Map<string, string>()
let player: HTMLAudioElement | null = null

function usePreview(): { playing: string | null; failed: string | null; toggle: (id: string) => void; stop: () => void } {
  const [playing, setPlaying] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const stop = useCallback(() => { player?.pause(); setPlaying(null) }, [])
  const toggle = useCallback((id: string) => {
    setFailed(null)
    if (playing === id) { stop(); return }
    player?.pause()
    setPlaying(id)
    void (async () => {
      let url = previewUrls.get(id)
      if (!url) {
        const { mime, data } = await getApi().sounds.preview(id)
        url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }))
        previewUrls.set(id, url)
      }
      player ??= new Audio()
      player.src = url
      player.loop = false
      player.onended = () => setPlaying(null)
      await player.play()
    })().catch(() => { setFailed(id); setPlaying(null) })
  }, [playing, stop])
  useEffect(() => () => { player?.pause() }, [])
  return { playing, failed, toggle, stop }
}

/**
 * Settings → My sounds: the member's own sound effects, each tagged with what it's for (a whoosh, a pop, a click…).
 * When a video needs that sound, theirs plays first. Each has a play button; the tag can be changed or the sound
 * removed.
 */
export function SoundPaletteSettings({ initialLibrary }: { initialLibrary?: SoundLibrary }): React.JSX.Element {
  const [library, setLibrary] = useState<SoundLibrary>(initialLibrary ?? { own: [] })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [skipped, setSkipped] = useState<string[]>([])
  const [action, setAction] = useState<SoundAction>('whoosh')
  const preview = usePreview()

  useEffect(() => {
    if (initialLibrary) return
    let live = true
    getApi().sounds.list().then((list) => { if (live) setLibrary(list) }).catch(() => { if (live) setError('Could not load your sounds.') })
    return () => { live = false }
  }, [initialLibrary])

  const update = async (work: () => Promise<SoundLibrary>): Promise<void> => {
    setError(null)
    try { setLibrary(await work()) } catch (err) {
      setError(err instanceof Error && err.message ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'That did not work. Try again.')
    }
  }

  return (
    <div className="space-y-3" data-testid="my-sounds">
      <div className="space-y-1.5" role="list" aria-label="My sounds">
        {library.own.length === 0 && (
          <p className="glass-tile rounded-xl px-3 py-3 text-xs text-ink-muted">
            No sounds of your own yet. Videos use the built-in sounds. Add yours to make every video sound like you.
          </p>
        )}
        {library.own.map((sound) => {
          const playing = preview.playing === sound.id
          return (
            <div key={sound.id} role="listitem" className="glass-tile flex items-center gap-2.5 rounded-xl px-3 py-2">
              <button type="button" aria-label={playing ? `Stop ${sound.name}` : `Play ${sound.name}`} aria-pressed={playing}
                title={preview.failed === sound.id ? 'This sound could not be played.' : undefined}
                onClick={() => preview.toggle(sound.id)}
                className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors',
                  playing ? 'bg-accent text-accent-ink' : 'bg-white/[0.08] text-ink-muted hover:bg-white/[0.14] hover:text-ink',
                  preview.failed === sound.id && 'text-danger')}>
                {playing ? <Pause className="h-3.5 w-3.5" aria-hidden="true" /> : <Play className="ml-0.5 h-3.5 w-3.5" aria-hidden="true" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink" title={sound.name}>{sound.name}</p>
                <p className="text-2xs text-ink-subtle">{(sound.sizeBytes / 1024).toFixed(0)} KB</p>
              </div>
              <Select size="sm" className="w-32" aria-label={`What ${sound.name} is for`} value={sound.action} options={ACTION_OPTIONS} disabled={busy}
                onChange={(next) => { preview.stop(); void update(() => getApi().sounds.setAction(sound.id, next as SoundAction)) }} />
              <Button size="sm" variant="ghost" disabled={busy} aria-label={`Remove ${sound.name} from my sounds`} icon={<X className="h-3.5 w-3.5" />}
                onClick={() => { preview.stop(); void update(() => getApi().sounds.remove(sound.id)) }}>
                Remove
              </Button>
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xs text-ink-subtle">MP3, WAV, M4A or Ogg, up to 5 MB and {MAX_SOUND_SECONDS} seconds each. {RIGHTS}</p>
        <div className="flex items-center gap-2">
          <Select size="sm" className="w-32" aria-label="What the new sounds are for" value={action} options={ACTION_OPTIONS} onChange={(next) => setAction(next as SoundAction)} />
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} disabled={busy}
            onClick={() => {
              setBusy(true)
              void update(async () => { const result = await getApi().sounds.add(action); setSkipped(result.skipped); return result.library })
                .finally(() => setBusy(false))
            }}>
            Add sounds
          </Button>
        </div>
      </div>
      <p className="text-2xs text-ink-subtle">{SOUND_ACTION_INFO[action].label}: {SOUND_ACTION_INFO[action].detail}</p>
      {skipped.length > 0 && <p className="text-2xs text-warning" role="status">Left out (use MP3, WAV, M4A or Ogg up to 5 MB): {skipped.join(', ')}</p>}
      {error && <p className="text-2xs text-danger" role="alert">{error}</p>}
    </div>
  )
}
