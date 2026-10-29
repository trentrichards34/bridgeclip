import { useEffect, useRef, useState } from 'react'
import { Check, Pencil } from 'lucide-react'
import type { ClipArtifact, JobOutput } from '../../shared/job-output'
import { remixEditProblem } from '../../shared/remix'
import { DEFAULT_CAPTION_PRESET, isCaptionPresetId } from '../../shared/caption-presets'
import { DEFAULT_HEADLINE_LOOK, parseHeadlineLook, type HeadlineLook } from '../../shared/headline-look'
import { getApi } from '../lib/ipc'
import { errorMessage } from '../lib/utils'
import { CaptionPresetPicker } from './CaptionPresetPicker'
import { HeadlineLookPicker } from './HeadlineLookPicker'
import { Button } from './ui/Button'
import { Dialog, DialogFooter } from './ui/Dialog'
import { SettingRow } from './ui/SettingRow'
import { Switch } from './ui/Switch'

function startLook(clip: ClipArtifact): HeadlineLook {
  try { return clip.remix_settings?.headline_look ? parseHeadlineLook(clip.remix_settings.headline_look) : DEFAULT_HEADLINE_LOOK } catch { return DEFAULT_HEADLINE_LOOK }
}


/**
 * Re-make a finished Remix video with new hook text, look, captions or box
 * size. It's rebuilt from the parts saved when it was made: no AI cost, and
 * its call to action is added back at the end.
 */
export function RemixEditDialog({ outputDir, clip, inEditor = false, onDone, onClose }: {
  outputDir: string; clip: ClipArtifact; onDone: (output: JobOutput | null, note: string | null) => void; onClose: () => void
  /** The run is open in the clip editor too: its copy of this video is refreshed when the editor opens next. */
  inEditor?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  // Focus moves into the dialog, so Escape and Tab work from the start.
  useEffect(() => { ref.current?.focus() }, [])
  const settings = clip.remix_settings
  const [headline, setHeadline] = useState(settings?.headline || clip.headline || clip.summary || '')
  const [look, setLook] = useState<HeadlineLook>(() => startLook(clip))
  const [captions, setCaptions] = useState(settings?.include_captions ?? true)
  const [preset, setPreset] = useState<string>(settings?.caption_preset && isCaptionPresetId(settings.caption_preset) ? settings.caption_preset : DEFAULT_CAPTION_PRESET)
  // The slider starts at the box as made (clamped to its range); untouched, the saved size is kept.
  const canSplit = clip.editable?.split === true
  const madeSplit = settings?.split ?? null
  const [split, setSplit] = useState<number | null>(canSplit ? Math.min(0.7, Math.max(0.3, madeSplit ?? 0.5)) : null)
  const [splitTouched, setSplitTouched] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The same rule as reviewing a take; the hook text is also the video's title.
  const problem = remixEditProblem({ headline, intro: '', beats: [], close: '' }, 'silent') ?? (headline.length > 200 ? 'Keep the hook text to 200 characters.' : null)

  const save = async (): Promise<void> => {
    setWorking(true); setError(null)
    try {
      const keepSplit = madeSplit !== null && madeSplit >= 0.3 && madeSplit <= 0.7 ? madeSplit : null
      const { output, note } = await getApi().remix.recompose(outputDir, clip.clip_index, { headline: headline.trim(), headlineLook: look, includeCaptions: captions, captionPreset: preset,
        split: canSplit && splitTouched ? split : canSplit ? keepSplit : null })
      onDone(output, note)
      onClose()
    } catch (err) { setError(errorMessage(err, 'The video could not be made again.')) } finally { setWorking(false) }
  }

  return (
    <Dialog ref={ref} aria-label="Edit this video" onBackdropMouseDown={working ? undefined : onClose} panelClassName="max-w-[720px]"
      onKeyDown={(e) => { if (e.key === 'Escape' && !working) onClose() }}>
      <fieldset disabled={working} className="min-w-0 space-y-5 overflow-y-auto p-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink"><Pencil className="h-4 w-4" />Edit this video</h2>
          <p className="mt-1 text-xs text-ink-muted">Change the hook text, captions{split !== null ? ' or the size of the clip box' : ''}. The video is made again from its saved parts in about a minute, with no AI cost{clip.cta ? ', and your call to action is added back at the end' : ''}.</p>
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-ink" htmlFor="remix-edit-hook">Hook text</label>
          <textarea id="remix-edit-hook" rows={2} maxLength={200} value={headline} disabled={working} onChange={(e) => setHeadline(e.target.value.replace(/\s+/g, ' '))}
            className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-ink" />
          <HeadlineLookPicker value={look} onChange={setLook} />
          {look.look === 'none' && <p className="text-2xs text-ink-subtle">Not drawn on the video; still used as its title in your Library.</p>}
        </div>

        {split !== null && (
          <div className="space-y-2">
            <label className="flex items-center justify-between text-sm text-ink">Size of the clip box <span className="text-2xs text-ink-muted">{Math.round(split * 100)}% of the height</span></label>
            <input type="range" aria-label="Size of the clip box" min={30} max={70} step={1} value={Math.round(split * 100)} disabled={working} onChange={(e) => { setSplitTouched(true); setSplit(Number(e.target.value) / 100) }} className="w-full" />
            <div className="flex flex-wrap gap-1">{([['Smaller', 0.4], ['Even', 0.5], ['Bigger', 0.6]] as const).map(([label, value]) => (
              <Button key={label} size="sm" variant={Math.abs(split - value) < 0.005 ? 'secondary' : 'ghost'} disabled={working} onClick={() => { setSplitTouched(true); setSplit(value) }}>{label}</Button>
            ))}</div>
            <p className="text-2xs text-ink-subtle">The rest of the frame is you (or your avatar). With hook text on top, the box tops out a little below 70%.</p>
          </div>
        )}

        <div className="space-y-3">
          <SettingRow title="Captions" description="Word-by-word captions of what’s said."
            control={<Switch label="Captions" checked={captions} disabled={working} onChange={setCaptions} />} />
          {captions && <CaptionPresetPicker value={preset} onChange={setPreset} />}
        </div>
        {inEditor && <p className="text-2xs text-ink-subtle" data-testid="remix-edit-in-editor">This run is also in the clip editor: the editor gets the new version of this video the next time you open it there, and the graphics you added there stay.</p>}
        {problem && <p className="text-2xs text-danger">{problem}</p>}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </fieldset>
      <DialogFooter>
        <Button variant="ghost" disabled={working} onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={<Check className="h-4 w-4" />} loading={working} disabled={working || problem !== null} onClick={() => void save()}>
          {working ? 'Making it again…' : 'Make it again'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
