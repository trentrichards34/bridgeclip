/**
 * "What changed": the plain list of what the app did on its own, each line with
 * a Restore that puts just that piece back (shared/edit-log.ts works the lines
 * out). Used by the clip editor (Automatic clips), Edit my recording's review and
 * the remix reviews. It fits a 300px inspector: lines wrap, nothing scrolls sideways.
 */
import { useState } from 'react'
import { ChevronDown, History, RotateCcw } from 'lucide-react'
import { remixEditLog, type EditLogLine } from '../../shared/edit-log'
import type { RemixDraft, RemixRecordings } from '../../shared/remix'
import { getApi } from '../lib/ipc'
import { cn, errorMessage } from '../lib/utils'
import { Button } from './ui/Button'

export function EditLog<P>({ lines, onRestore, onUndo, disabled, note, className, variant = 'panel', defaultOpen = true }: {
  lines: EditLogLine<P>[]
  onRestore: (line: EditLogLine<P>) => void
  /** Pages without their own Undo: takes back the last Restore. */
  onUndo?: () => void
  disabled?: boolean
  /** One short line under the list (what Undo does here, or why some lines are missing). */
  note?: string
  className?: string
  /** 'strip': the clip editor's dark inspector; 'panel': a glass tile on a page. */
  variant?: 'strip' | 'panel'
  defaultOpen?: boolean
}): React.JSX.Element | null {
  const [open, setOpen] = useState(defaultOpen)
  if (!lines.length && !onUndo) return null
  return (
    <section data-testid="edit-log" aria-label="What changed"
      className={cn('min-w-0', variant === 'strip' ? 'edit-log-strip border-b border-white/10 px-3 py-2' : 'glass-tile rounded-2xl p-3', className)}>
      <button type="button" className="flex w-full min-w-0 items-center gap-1.5 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <History className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden />
        <span className="text-xs font-semibold text-ink">What changed</span>
        <span className="text-2xs text-ink-subtle">· {lines.length ? `${lines.length} ${lines.length === 1 ? 'thing' : 'things'} the app did` : 'all restored'}</span>
        <ChevronDown className={cn('ml-auto h-3.5 w-3.5 shrink-0 text-ink-muted transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && <>
        <ul className={cn('mt-1.5 space-y-0.5', variant === 'strip' && 'max-h-44 overflow-y-auto overflow-x-hidden')}>
          {lines.map((line) => (
            <li key={line.id} data-log={line.id} className="flex min-w-0 items-start gap-1.5 rounded-md px-1 py-0.5 hover:bg-white/[0.04]">
              <span className="min-w-0 flex-1 break-words pt-1 text-2xs leading-snug text-ink">{line.text}</span>
              {line.restore !== undefined && (
                <Button size="sm" variant="ghost" className="h-6 shrink-0 px-1.5 text-2xs" icon={<RotateCcw className="h-3 w-3" />} disabled={disabled}
                  tooltip={line.restoreHint} aria-label={`Restore: ${line.text}`} onClick={() => onRestore(line)}>Restore</Button>
              )}
            </li>
          ))}
        </ul>
        {!lines.length && <p className="mt-1 text-2xs text-ink-subtle">Everything the app did is restored.</p>}
        {(note || onUndo) && <div className="mt-1 flex flex-wrap items-center gap-2">
          {note && <p className="min-w-0 flex-1 text-2xs text-ink-subtle">{note}</p>}
          {onUndo && <Button size="sm" variant="ghost" className="h-6 px-1.5 text-2xs" disabled={disabled} tooltip="Take back the last Restore." onClick={onUndo}>Undo restore</Button>}
        </div>}
      </>}
    </section>
  )
}

/** A remix take's review: the part of their clip used, your take's trim (Restore uses all of it) and the AI's hook text. */
export function RemixEditLog({ draft, recordings, headline, disabled, onRecordings, onError }: {
  draft: RemixDraft; recordings: RemixRecordings; headline: string; disabled: boolean
  onRecordings: (list: RemixRecordings) => void; onError: (message: string | null) => void
}): React.JSX.Element | null {
  const take = recordings[draft.id]?.reaction
  const lines = remixEditLog({ startMs: draft.startMs, endMs: draft.endMs, take, aiHeadline: draft.headline, headline })
  return <EditLog lines={lines} disabled={disabled} defaultOpen={false} onRestore={(line) => {
    if (line.restore === 'use-whole-take') getApi().remix.takeTrim(draft.id, null, null).then(onRecordings, (e) => onError(errorMessage(e)))
  }} />
}
