import { useEffect, useState } from 'react'
import { Play, Square } from 'lucide-react'
import { Button } from './ui/Button'
import { getApi } from '../lib/ipc'
import { errorMessage } from '../lib/utils'

export type VoiceSampleRequest = { kind: 'avatar'; voice: unknown; avatarId?: string } | { kind: 'remix'; voice: string }

// One sample plays at a time across the app; samples already heard replay from memory.
const urls = new Map<string, string>()
let current: { key: string; audio: HTMLAudioElement; done: () => void } | null = null

function stopCurrent(): void {
  if (!current) return
  current.audio.pause()
  current.done()
  current = null
}

/** A play button that lets the user hear a voice before choosing it. */
export function VoicePreview({ request, name }: { request: VoiceSampleRequest; name: string }): React.JSX.Element {
  const key = JSON.stringify(request)
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle')
  const [error, setError] = useState<string | null>(null)

  // A different voice was picked: stop this one's sample.
  useEffect(() => {
    setError(null)
    return () => { if (current?.key === key) stopCurrent() }
  }, [key])

  const play = async (): Promise<void> => {
    if (state === 'playing') { stopCurrent(); return }
    stopCurrent()
    setError(null)
    setState('loading')
    try {
      let url = urls.get(key)
      if (!url) {
        const bytes = await getApi().voices.sample(request)
        url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/mpeg' }))
        urls.set(key, url)
      }
      const audio = new Audio(url)
      const done = (): void => { setState('idle'); if (current?.audio === audio) current = null }
      audio.onended = done
      audio.onerror = () => { done(); setError('That sample could not be played.') }
      current = { key, audio, done }
      await audio.play()
      setState('playing')
    } catch (err) {
      setState('idle')
      setError(errorMessage(err, 'The sample could not be made.'))
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="md" variant="secondary" loading={state === 'loading'} disabled={state === 'loading'}
        icon={state === 'playing' ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        aria-label={state === 'playing' ? `Stop the ${name} sample` : `Hear ${name}`}
        tooltip={state === 'idle' ? 'Hear a short sample (made once, then free to replay)' : undefined}
        onClick={() => void play()}>
        {state === 'playing' ? 'Stop' : 'Hear it'}
      </Button>
      {error && <p className="max-w-[260px] text-right text-2xs text-danger" role="alert">{error}</p>}
    </div>
  )
}
