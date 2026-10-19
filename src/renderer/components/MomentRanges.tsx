import { useRef, useState } from 'react'
import { Clock, ImagePlus, Plus, X } from 'lucide-react'
import {
  formatTimecode, MAX_TIMECODE_IMAGE_BYTES, MOMENT_MAX_RANGES, parseTimecode, rangeAround, rangeProblem, RANGE_PAD_SECONDS, type RangeInput, type TimecodeRead
} from '../../shared/moment-take'
import { getApi } from '../lib/ipc'
import { cn, errorMessage } from '../lib/utils'
import { Button } from './ui/Button'
import { TextInput } from './ui/Field'

/** The first image in a paste or a drop, if any. */
function imageFrom(items: DataTransferItemList | null, files: FileList | null): File | null {
  for (const file of Array.from(files ?? [])) if (file.type.startsWith('image/')) return file
  for (const item of Array.from(items ?? [])) if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile()
  return null
}

/**
 * Moment + my take: up to three time ranges in the long video, typed (37:00 to 42:00) or read from a screenshot of
 * the player (pasted, dropped or chosen). A screenshot's time becomes a range 2:30 either side; the member checks it.
 */
export function MomentRanges({ value, lengthSeconds, disabled, onChange }: {
  value: RangeInput[]
  /** The video's length when known (a file): ranges past it are flagged. */
  lengthSeconds: number | null
  disabled: boolean
  onChange: (value: RangeInput[]) => void
}): React.JSX.Element {
  const [reading, setReading] = useState<number | null>(null)
  const [problem, setProblem] = useState<{ row: number; text: string } | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const rows = value.length ? value : [{ start: '', end: '' }]
  // Read on the latest value, even after an await.
  const latest = useRef(rows)
  latest.current = rows

  const set = (index: number, patch: Partial<RangeInput>): void => onChange(latest.current.map((row, i) => i === index ? { ...row, ...patch } : row))

  /** Ask for the time on a screenshot (one small paid call) and set the range around it. */
  const read = async (index: number, ask: () => Promise<{ read: TimecodeRead | null } | null>): Promise<void> => {
    setProblem(null)
    setReading(index)
    try {
      const result = await ask()
      if (!result) return
      const found = result.read
      if (!found) { setProblem({ row: index, text: 'No time could be read from that screenshot. Type it instead, like 37:12.' }); return }
      const range = rangeAround(found.seconds, lengthSeconds ?? found.lengthSeconds)
      set(index, { start: formatTimecode(range.startS), end: formatTimecode(range.endS), read: found })
    } catch (err) {
      setProblem({ row: index, text: errorMessage(err, 'That screenshot could not be read. Type the time instead.') })
    } finally { setReading(null) }
  }
  const readImage = (index: number, file: Blob): Promise<void> => file.size > MAX_TIMECODE_IMAGE_BYTES
    ? Promise.resolve(setProblem({ row: index, text: 'Use a screenshot under 10 MB.' }))
    : read(index, async () => ({ read: await getApi().remix.readTimecode(new Uint8Array(await file.arrayBuffer())) }))
  const choose = (index: number): Promise<void> => read(index, () => getApi().remix.readTimecodeFile())

  /** A pasted or dropped screenshot fills this row (or, from the list, the first empty row or a new one). */
  const take = (index: number | null, file: File | null): boolean => {
    if (!file || disabled || reading !== null) return false
    const empty = latest.current.findIndex((row) => !row.start.trim() && !row.end.trim())
    const target = index ?? (empty >= 0 ? empty : latest.current.length < MOMENT_MAX_RANGES ? latest.current.length : latest.current.length - 1)
    if (target >= latest.current.length) onChange([...latest.current, { start: '', end: '' }])
    void readImage(target, file)
    return true
  }

  return (
    <div className="space-y-2.5" onPaste={(e) => { if (take(null, imageFrom(e.clipboardData.items, e.clipboardData.files))) e.preventDefault() }}>
      <div className="flex items-start gap-2">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
        <div>
          <span className="block text-sm text-ink">Your time ranges (up to {MOMENT_MAX_RANGES})</span>
          <span className="block text-2xs text-ink-subtle">
            Each range becomes its own video. Type times like 37:00 to 42:00, or paste or drop a screenshot of the player and CreatorClips reads the time
(a range {formatTimecode(RANGE_PAD_SECONDS)} either side of it).
          </span>
        </div>
      </div>
      <div tabIndex={0} role="button" aria-label="Paste or drop a screenshot of the player"
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const empty = latest.current.findIndex((row) => !row.start.trim() && !row.end.trim()); if (empty >= 0) void choose(empty) } }}
        onDragOver={(e) => { if (!disabled) { e.preventDefault(); setDragging(-1) } }} onDragLeave={() => setDragging(null)}
        onDrop={(e) => { e.preventDefault(); setDragging(null); take(null, imageFrom(e.dataTransfer.items, e.dataTransfer.files)) }}
        className={cn('flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 px-3 py-3 text-2xs text-ink-muted outline-none focus-visible:border-accent',
          dragging === -1 && 'border-accent text-ink')}>
        <ImagePlus className="h-3.5 w-3.5" />{reading !== null ? 'Reading the time on your screenshot…' : 'Click here and paste (Ctrl+V or ⌘V), or drop a screenshot of the player, to add a range'}
      </div>
      {rows.map((row, index) => {
        const start = parseTimecode(row.start), end = parseTimecode(row.end)
        const filled = row.start.trim() || row.end.trim()
        const issue = !filled ? null : start === null || end === null ? 'Use times like 37:00 or 1:02:30.' : rangeProblem({ startS: start, endS: end }, lengthSeconds)
        return (
          <div key={index} role="group" aria-label={`Range ${index + 1}`}
            onDragOver={(e) => { if (!disabled) { e.preventDefault(); setDragging(index) } }} onDragLeave={() => setDragging(null)}
            onDrop={(e) => { e.preventDefault(); setDragging(null); take(index, imageFrom(e.dataTransfer.items, e.dataTransfer.files)) }}
            className={cn('glass-tile space-y-2 rounded-xl p-2.5', dragging === index && 'ring-2 ring-accent')}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-16 text-2xs font-medium text-ink-muted">Range {index + 1}</span>
              <TextInput aria-label={`Range ${index + 1} start`} value={row.start} placeholder="37:00" maxLength={12} disabled={disabled} className="w-24"
                onChange={(e) => set(index, { start: e.target.value, read: null })} />
              <span className="text-2xs text-ink-subtle">to</span>
              <TextInput aria-label={`Range ${index + 1} end`} value={row.end} placeholder="42:00" maxLength={12} disabled={disabled} className="w-24"
                onChange={(e) => set(index, { end: e.target.value, read: null })} />
              <Button size="sm" variant="ghost" icon={<ImagePlus className="h-3.5 w-3.5" />} loading={reading === index} disabled={disabled || reading !== null}
                onClick={() => void choose(index)}>{reading === index ? 'Reading the time…' : 'From a screenshot'}</Button>
              {rows.length > 1 && (
                <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} disabled={disabled} aria-label={`Remove range ${index + 1}`}
                  onClick={() => onChange(rows.filter((_, i) => i !== index))}>Remove</Button>
              )}
            </div>
            {row.read && (
              <p className="text-2xs text-ink-muted" data-testid={`range-${index + 1}-read`}>
                Read {row.read.text} from your screenshot{row.read.app ? ` (${row.read.app})` : ''}, so this range is {row.start}–{row.end}. Check it matches, and fix it if not.
                {row.read.costUsd > 0 ? ` Reading it cost $${row.read.costUsd < 0.01 ? row.read.costUsd.toFixed(4) : row.read.costUsd.toFixed(2)}.` : ''}
              </p>
            )}
            {issue && <p className="text-2xs text-danger" role="alert">{issue}</p>}
            {problem?.row === index && <p className="text-2xs text-warning" role="alert">{problem.text}</p>}
          </div>
        )
      })}
      {rows.length < MOMENT_MAX_RANGES && (
        <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} disabled={disabled} onClick={() => onChange([...rows, { start: '', end: '' }])}>Add a range</Button>
      )}
    </div>
  )
}
