/**
 * Edit my recording's setup: screenshots for the video (a page, an app, a proof post, a before and after). The
 * automatic graphics show them where the member talks about them (a browser or phone frame, a before and after, a
 * light sweep over a proof), with a hand-drawn mark on the part the member boxes here. They are copied into the run
 * when it starts and stay in "My images" on the review screen.
 */
import { ImagePlus, X } from 'lucide-react'
import { EDIT_MAX_SCREENSHOTS } from '../../shared/edit-recording'
import { getApi } from '../lib/ipc'
import { errorMessage, localFileUrl } from '../lib/utils'
import { HighlightPicker } from './ClipLayoutSections'
import { Button } from './ui/Button'

export interface ScreenshotPick { path: string; name: string; box?: [number, number, number, number] }

export function EditScreenshots({ value, onChange, onError, disabledReason }: {
  value: ScreenshotPick[]
  onChange: (value: ScreenshotPick[]) => void
  onError: (message: string | null) => void
  /** Why screenshots can't be added now (a camera + screen reel shows the screen itself), or null. */
  disabledReason: string | null
}): React.JSX.Element {
  const full = value.length >= EDIT_MAX_SCREENSHOTS
  const choose = async (): Promise<void> => {
    onError(null)
    try {
      const picked = await getApi().edit.chooseScreenshots()
      const fresh = picked.filter((p) => !value.some((v) => v.path === p.path))
      if (value.length + fresh.length > EDIT_MAX_SCREENSHOTS) onError(`Add up to ${EDIT_MAX_SCREENSHOTS} screenshots: the first ones are kept.`)
      onChange([...value, ...fresh].slice(0, EDIT_MAX_SCREENSHOTS))
    } catch (err) { onError(errorMessage(err)) }
  }
  return (
    <div className="mt-3 space-y-2" data-testid="edit-screenshots">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Button variant="secondary" icon={<ImagePlus className="h-4 w-4" />} disabled={Boolean(disabledReason) || full} onClick={() => void choose()}>+ Add screenshots</Button>
        <span className="min-w-0 flex-1 text-2xs text-ink-subtle">{disabledReason ?? (value.length
          ? 'Drag on a screenshot to box the part that matters: the graphics circle or underline it.'
          : 'Talking about a website, an app or a result? Add screenshots of it. They show in a browser or phone frame (or as a before and after) where you talk about them.')}</span>
      </div>
      {value.length > 0 && !disabledReason && (
        <ul className="flex flex-wrap gap-3" aria-label="Screenshots for this video">
          {value.map((shot, i) => (
            <li key={shot.path} className="w-28 space-y-1">
              <HighlightPicker src={localFileUrl(shot.path)} name={shot.name} className="w-28" label="drag to box the part that matters" disabled={false}
                value={shot.box ? { x: shot.box[0], y: shot.box[1], w: shot.box[2], h: shot.box[3] } : null}
                onChange={(r) => onChange(value.map((v, k) => k === i ? { ...v, box: r ? [r.x, r.y, r.w, r.h] : undefined } : v))} />
              <div className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-2xs text-ink-muted" title={shot.name}>{shot.name}</span>
                <button type="button" className="rounded p-0.5 text-ink-subtle hover:text-ink" aria-label={`Remove ${shot.name}`} onClick={() => onChange(value.filter((_, k) => k !== i))}><X className="h-3 w-3" /></button>
              </div>
              {shot.box && <button type="button" className="text-2xs text-accent hover:underline" onClick={() => onChange(value.map((v, k) => k === i ? { path: v.path, name: v.name } : v))}>Clear box</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
