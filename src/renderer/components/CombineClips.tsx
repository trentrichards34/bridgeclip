import { useState } from 'react'
import { ArrowLeft, ArrowRight, Clapperboard, GripVertical, Layers, ListOrdered, MonitorSmartphone, RotateCcw, Sparkles, User, X } from 'lucide-react'
import { SHOT_LABELS, clipFirstWords, moveClip, removeClip, restoreClip, sameOrder, type EditMode, type ImportProgress } from '../../shared/combine-clips'
import { formatClock, type EditPlan, type EditSource } from '../../shared/edit-recording'
import { cn, localFileUrl } from '../lib/utils'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { ProgressBar } from './ui/ProgressBar'
import { onRadioKeyDown } from './ui/Segmented'
import { SettingRow } from './ui/SettingRow'
import { Switch } from './ui/Switch'

const MODES: { id: EditMode; label: string; detail: string; icon: React.JSX.Element }[] = [
  { id: 'takes', label: 'Retakes of the same thing', detail: 'One recording, or a few takes of the same video. The edit keeps your best take of each line.', icon: <Clapperboard className="h-4 w-4" aria-hidden /> },
  { id: 'combine', label: 'Parts of one video (combine clips)', detail: 'Short clips filmed one after another. They’re joined into one reel, in order.', icon: <Layers className="h-4 w-4" aria-hidden /> }
]

/** Step 1's choice: retakes of one video, or parts of one video to combine. */
export function ModeChoice({ value, onChange, disabled, className }: { value: EditMode; onChange: (mode: EditMode) => void; disabled?: boolean; className?: string }): React.JSX.Element {
  return (
    <div className={cn('grid gap-2 sm:grid-cols-2', className)} role="radiogroup" aria-label="What did you film?">
      {MODES.map((mode) => {
        const selected = value === mode.id
        return (
          <button key={mode.id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} disabled={disabled} onKeyDown={onRadioKeyDown}
            onClick={() => onChange(mode.id)}
            className={cn('glass-tile glass-tile-hover flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-left disabled:opacity-60', selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
            <span className={cn('mt-0.5', selected ? 'text-accent' : 'text-ink-subtle')}>{mode.icon}</span>
            <span>
              <span className="block text-sm font-medium">{mode.label}</span>
              <span className="block text-2xs text-ink-muted">{mode.detail}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

const PHASES: Record<ImportProgress['phase'], string> = { waiting: 'Waiting', copying: 'Copying out of the .zip', checking: 'Checking', done: 'Ready', failed: 'Left out' }

/** Each file being added: copied out of a .zip, then checked. */
export function ClipImport({ files, className }: { files: ImportProgress[]; className?: string }): React.JSX.Element {
  const done = files.filter((file) => file.phase === 'done' || file.phase === 'failed').length
  return (
    <div className={cn('glass-tile rounded-xl p-3', className)} data-testid="clip-import">
      <p className="text-xs font-medium text-ink" aria-live="polite">Adding your clips · {done} of {files.length} ready</p>
      <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto" aria-label="Clips being added">
        {files.map((file, i) => (
          <li key={`${i}-${file.name}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
            <span className="truncate text-2xs text-ink">{file.name}</span>
            <span className={cn('text-2xs', file.phase === 'failed' ? 'text-danger' : 'text-ink-muted')}>{PHASES[file.phase]}{file.phase === 'copying' ? ` · ${file.percent}%` : ''}</span>
            <ProgressBar className="col-span-2 h-1" value={file.phase === 'copying' ? file.percent * 0.8 : file.phase === 'checking' ? 90 : file.phase === 'waiting' ? 0 : 100} failed={file.phase === 'failed'} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The review's Order strip: each clip with its thumbnail, length, shot type and first words, in the order it plays.
 * Drag a clip to move it, or use its arrow buttons (keyboard); remove a clip, put it back; "Use filming order" and
 * "Let AI order it" (the order the plan suggested, free: it came with the plan).
 */
export function ClipOrder({ plan, sources, order, transitions, onOrder, onTransitions, disabled }: {
  plan: EditPlan; sources: EditSource[]; order: number[]; transitions: boolean
  onOrder: (order: number[]) => void; onTransitions: (on: boolean) => void; disabled?: boolean
}): React.JSX.Element {
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const combine = plan.combine!
  const filmed = sources.map((_, i) => i)
  const removed = filmed.filter((src) => !order.includes(src))
  const aiOrder = combine.aiOrder
  const drop = (target: number): void => {
    if (dragging !== null && dragging !== target) onOrder(moveClip(order, dragging, 0, order.indexOf(target)))
    setDragging(null); setOver(null)
  }
  return (
    <section className="mt-5 space-y-2" aria-labelledby="edit-order-title" data-testid="clip-order">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h3 id="edit-order-title" className="flex items-center gap-1.5 text-sm font-semibold text-ink"><ListOrdered className="h-4 w-4" aria-hidden />Order</h3>
          <p className="text-2xs text-ink-subtle">Your clips play left to right. Drag a clip, or use its arrows, to move it.{aiOrder && combine.orderWhy ? ` The AI’s order: ${combine.orderWhy}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" icon={<RotateCcw className="h-3.5 w-3.5" />} disabled={disabled || sameOrder(order, filmed)} onClick={() => onOrder(filmed)}>Use filming order</Button>
          <Button size="sm" variant="secondary" icon={<Sparkles className="h-3.5 w-3.5" />} disabled={disabled || !aiOrder || sameOrder(order, aiOrder)}
            title={aiOrder ? 'The order the AI suggested with your plan (no extra cost).' : 'The AI didn’t suggest an order this time.'}
            onClick={() => aiOrder && onOrder([...aiOrder])}>Let AI order it</Button>
        </div>
      </div>
      <ol className="flex gap-2 overflow-x-auto pb-2" aria-label="Clip order">
        {order.map((src, k) => {
          const source = sources[src]
          const words = clipFirstWords(plan.words, src)
          return (
            <li key={src} draggable={!disabled}
              onDragStart={(e) => { setDragging(src); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(src)) }}
              onDragOver={(e) => { if (dragging !== null) { e.preventDefault(); setOver(src) } }}
              onDragLeave={() => setOver((current) => current === src ? null : current)}
              onDrop={(e) => { e.preventDefault(); drop(src) }}
              onDragEnd={() => { setDragging(null); setOver(null) }}
              className={cn('glass-tile flex w-[148px] shrink-0 flex-col rounded-xl p-1.5 transition-shadow', dragging === src && 'opacity-50',
                over === src && dragging !== src && 'shadow-[0_0_0_2px_rgb(var(--accent)/0.7)]')}
              data-testid={`clip-order-${k}`} aria-label={`Clip ${src + 1}, plays ${k + 1} of ${order.length}`}>
              <div className="relative aspect-[9/16] w-full overflow-hidden rounded-lg bg-black">
                {source?.thumb
                  ? <img src={localFileUrl(source.thumb)} alt="" className="h-full w-full object-cover" draggable={false} />
                  : <div className="flex h-full items-center justify-center text-2xs text-ink-faint">Clip {src + 1}</div>}
                <span className="absolute left-1 top-1 cursor-grab rounded bg-black/55 p-0.5 text-white/80" aria-hidden><GripVertical className="h-3.5 w-3.5" /></span>
                <span className="absolute right-1 top-1 rounded bg-black/60 px-1 font-mono text-[10px] tabular text-white">{formatClock(source?.seconds ?? 0)}</span>
                {source?.shot && (
                  <Badge className="absolute bottom-1 left-1 bg-black/60 text-white" icon={source.shot === 'screen' ? <MonitorSmartphone className="h-3 w-3" aria-hidden /> : <User className="h-3 w-3" aria-hidden />}>
                    {SHOT_LABELS[source.shot]}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-2xs font-medium text-ink">{k + 1}. Clip {src + 1}</p>
              <p className="line-clamp-2 min-h-[2.4em] text-[10px] leading-tight text-ink-muted" title={source?.name}>{words ? `“${words}…”` : 'No words heard'}</p>
              <div className="mt-1 flex items-center justify-between">
                <span className="flex">
                  <Button size="sm" variant="ghost" aria-label={`Move clip ${src + 1} earlier`} disabled={disabled || k === 0} icon={<ArrowLeft className="h-3.5 w-3.5" />}
                    onClick={() => onOrder(moveClip(order, src, -1))} />
                  <Button size="sm" variant="ghost" aria-label={`Move clip ${src + 1} later`} disabled={disabled || k === order.length - 1} icon={<ArrowRight className="h-3.5 w-3.5" />}
                    onClick={() => onOrder(moveClip(order, src, 1))} />
                </span>
                <Button size="sm" variant="ghost" aria-label={`Remove clip ${src + 1}`} disabled={disabled || order.length === 1} icon={<X className="h-3.5 w-3.5" />}
                  onClick={() => onOrder(removeClip(order, src))} />
              </div>
            </li>
          )
        })}
      </ol>
      {removed.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-2xs text-ink-muted">
          <span>Left out:</span>
          {removed.map((src) => (
            <Button key={src} size="sm" variant="ghost" disabled={disabled} onClick={() => onOrder(restoreClip(order, src))} aria-label={`Put clip ${src + 1} back`}>Clip {src + 1} · Put back</Button>
          ))}
        </p>
      )}
      <SettingRow title="Quick transitions" description="A short dip through black (0.2 s) between clips. Off: clean cuts."
        control={<Switch label="Quick transitions between clips" checked={transitions} disabled={disabled} onChange={onTransitions} />} />
    </section>
  )
}
