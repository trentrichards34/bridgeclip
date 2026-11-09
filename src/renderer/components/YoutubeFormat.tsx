import { useState } from 'react'
import { Check, Copy, MonitorPlay, Smartphone, Youtube } from 'lucide-react'
import { chaptersText, suggestFormat, suggestionReason, type Chapter, type EditFormat, type YoutubeChoice } from '../../shared/longform'
import type { EditSource } from '../../shared/edit-recording'
import { ChoiceCards, type ChoiceOption } from './maker/Maker'
import { Button } from './ui/Button'
import { Segmented } from './ui/Segmented'
import { SettingRow } from './ui/SettingRow'

/** Setup: a Reel or a YouTube video, suggested from the recordings (long or landscape: YouTube), switchable. */
export function FormatChoice({ value, sources, onChange, disabled }: {
  value: EditFormat; sources: readonly EditSource[]; onChange: (format: EditFormat) => void; disabled?: boolean
}): React.JSX.Element {
  const suggested = sources.length ? suggestFormat(sources) : null
  const reason = suggestionReason(sources)
  const options: ChoiceOption<EditFormat>[] = [
    { value: 'reel', label: 'Reel (vertical, short)', detail: '9:16 for TikTok, Reels and Shorts. Fast cuts, a big hook, captions on every line.',
      icon: <Smartphone className="h-4 w-4" />, ...(suggested === 'reel' ? { tag: 'Suggested' } : {}) },
    { value: 'youtube', label: 'YouTube video (landscape, long)', detail: '16:9 at 1080p. A branded cold open, then screen-led with captions on key lines, and chapters.',
      icon: <Youtube className="h-4 w-4" />, ...(suggested === 'youtube' ? { tag: 'Suggested' } : {}) }
  ]
  return (
    <div className="mt-4" data-testid="edit-format">
      <p className="mb-2 text-xs font-semibold text-ink">What are you making?</p>
      <ChoiceCards label="What are you making?" value={value} options={options} onChange={onChange} disabled={disabled} />
      {suggested && reason && <p className="mt-2 text-2xs text-ink-subtle">{reason}, so it starts as {suggested === 'youtube' ? 'a YouTube video' : 'a reel'}. You can switch.</p>}
    </div>
  )
}

/** Review: a YouTube video's layout (screen + webcam picture-in-picture when there's a screen recording) and captions. */
export function YoutubeChoicePanel({ value, pair, onChange, disabled }: {
  value: YoutubeChoice; pair: boolean; onChange: (value: YoutubeChoice) => void; disabled?: boolean
}): React.JSX.Element {
  return (
    <section className="mt-5 space-y-3" aria-labelledby="edit-youtube-title" data-testid="edit-youtube">
      <div>
        <h3 id="edit-youtube-title" className="flex items-center gap-1.5 text-sm font-semibold text-ink"><MonitorPlay className="h-4 w-4" aria-hidden />Your YouTube video</h3>
        <p className="text-2xs text-ink-subtle">{pair
          ? 'Your screen fills the frame and your webcam sits beside it as a large rounded card. The first minute or so gets branded cards; after that, graphics only where a number or a key point is said.'
          : 'Your recording fills the 16:9 frame as you filmed it. The first minute or so gets branded cards; after that, graphics only where a number or a key point is said.'}</p>
      </div>
      {pair && (
        <>
          <SettingRow title="Webcam size" description="How big your webcam card is."
            control={<Segmented label="Webcam size" size="sm" value={value.pipSize} onChange={(pipSize) => onChange({ ...value, pipSize })}
              options={[{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }]} />} />
          <SettingRow title="Webcam position" description={value.pipCorner === 'right' ? 'A tall card on the right; your screen fits beside it, nothing covered.' : 'A card in the bottom-right corner, over your screen.'}
            control={<Segmented label="Webcam position" size="sm" value={value.pipCorner} onChange={(pipCorner) => onChange({ ...value, pipCorner })}
              options={[{ value: 'right', label: 'Right side' }, { value: 'bottom_right', label: 'Corner' }]} />} />
        </>
      )}
      <SettingRow title="Captions" description={value.captions === 'key' ? 'Every line in the opening, then only key lines (numbers and strong points), smaller, at the bottom.' : 'Every line, smaller, at the bottom.'}
        control={<Segmented label="Captions on" size="sm" value={value.captions} onChange={(captions) => onChange({ ...value, captions })}
          options={[{ value: 'key', label: 'Key lines' }, { value: 'all', label: 'Every line' }]} />} />
      {disabled && <span className="sr-only">Making your video</span>}
    </section>
  )
}

/** Done: the video's chapters as YouTube reads them, with a copy button for the description. */
export function ChapterList({ chapters }: { chapters: readonly Chapter[] }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const text = chaptersText(chapters)
  const copy = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { setCopied(false) }
  }
  return (
    <div className="glass-tile max-w-md rounded-xl p-3" data-testid="edit-chapters">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-ink">Chapters</p>
        <Button size="sm" variant="secondary" icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy chapters'}
        </Button>
      </div>
      <p className="mt-1 text-2xs text-ink-subtle">Paste these into your YouTube description: YouTube turns them into chapters.</p>
      <ol className="mt-2 space-y-0.5 font-mono text-2xs text-ink" aria-label="Chapters">
        {text.split('\n').map((line) => <li key={line}>{line}</li>)}
      </ol>
    </div>
  )
}
