import { useEffect, useRef, useState } from 'react'
import { Check, Copy, GraduationCap, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { Button } from './ui/Button'
import { Dialog } from './ui/Dialog'
import {
  FRAMEWORK_CRITERIA, HARD_FAIL_LABELS, HOOK_ELEMENTS, HOOK_TYPE_LABELS, STORY_BEATS, type FrameworkGrade, type Grade
} from '../../shared/framework-grade'

const GRADE_TONES: Record<Grade, string> = {
  A: 'bg-emerald-400 text-black',
  B: 'bg-lime-300 text-black',
  C: 'bg-amber-300 text-black',
  D: 'bg-orange-400 text-black',
  F: 'bg-red-500 text-white'
}

/** Compact letter grade chip for the clip thumbnail. */
export function GradeChip({ grade, className }: { grade: FrameworkGrade; className?: string }): React.JSX.Element {
  return (
    <span className={cn('inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-2xs font-bold tabular shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]', GRADE_TONES[grade.grade], className)}
      title={`Framework grade ${grade.grade} (${grade.score.toFixed(1)}/10)`} aria-label={`Framework grade ${grade.grade}, ${grade.score.toFixed(1)} out of 10`}>
      {grade.grade}
      <span className="font-mono font-medium opacity-80">{grade.score.toFixed(1)}</span>
    </span>
  )
}

/** Opens the full breakdown: why the clip got its grade and how to improve it. */
export function GradeDetailsButton({ grade, title }: { grade: FrameworkGrade; title: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1 rounded-md text-2xs text-ink-muted transition-colors hover:text-ink">
        <GraduationCap className="h-3 w-3" aria-hidden="true" />
        Why {grade.grade}? {grade.verdict && <span className="line-clamp-1 text-ink-subtle">· {grade.verdict}</span>}
      </button>
      {open && <GradeDialog grade={grade} title={title} onClose={() => setOpen(false)} />}
    </>
  )
}

function GradeDialog({ grade, title, onClose }: { grade: FrameworkGrade; title: string; onClose: () => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => { ref.current?.focus() }, [])
  const elementsFound = HOOK_ELEMENTS.slice(0, 3).filter(({ key }) => grade.hookElements[key]).length
  return (
    <Dialog ref={ref} aria-label={`Framework grade for ${title}`} onBackdropMouseDown={onClose} panelClassName="max-w-[620px]"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
      <div className="space-y-5 overflow-y-auto p-5">
        <div className="flex items-start gap-3">
          <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl font-black', GRADE_TONES[grade.grade])}>{grade.grade}</span>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Paid Creators framework grade · {grade.score.toFixed(1)}/10</p>
            <h2 className="mt-0.5 text-base font-semibold text-ink">{title}</h2>
            {grade.verdict && <p className="mt-1 text-sm text-ink-muted">{grade.verdict}</p>}
          </div>
          <Button variant="ghost" size="sm" iconOnly aria-label="Close" icon={<X className="h-4 w-4" />} onClick={onClose} />
        </div>

        {grade.hardFails.length > 0 && (
          <div className="rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">
            {grade.hardFails.map((fail) => <p key={fail}>✕ {HARD_FAIL_LABELS[fail]}</p>)}
          </div>
        )}

        <section>
          <h3 className="eyebrow mb-2">Triple Hook · {elementsFound} of 3 elements · {HOOK_TYPE_LABELS[grade.hookType]}</h3>
          <ul className="space-y-1.5">
            {HOOK_ELEMENTS.map(({ key, label }) => {
              const quote = grade.hookElements[key]
              return (
                <li key={key} className="flex gap-2 text-xs">
                  <span className={cn('mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full', quote ? 'bg-emerald-400/90 text-black' : 'bg-white/10 text-ink-subtle')}>
                    {quote ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                  </span>
                  <span className="w-28 shrink-0 font-medium text-ink">{label}</span>
                  <span className={cn('min-w-0', quote ? 'text-ink-muted' : 'text-ink-subtle')}>{quote ? `“${quote}”` : 'Missing'}</span>
                </li>
              )
            })}
          </ul>
        </section>

        <section>
          <h3 className="eyebrow mb-2">Criteria</h3>
          <div className="space-y-1.5">
            {FRAMEWORK_CRITERIA.map(({ key, label, weight }) => {
              const value = grade.scores[key]
              return (
                <div key={key} className="grid grid-cols-[150px_1fr_36px] items-center gap-2 text-xs">
                  <span className="text-ink-muted">{label} <span className="text-ink-subtle">{Math.round(weight * 100)}%</span></span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <span className={cn('block h-full rounded-full', value >= 8 ? 'bg-emerald-400' : value >= 5.5 ? 'bg-amber-300' : 'bg-red-400')} style={{ width: `${value * 10}%` }} />
                  </span>
                  <span className="text-right font-mono tabular text-ink">{value.toFixed(1)}</span>
                </div>
              )
            })}
          </div>
        </section>

        <section>
          <h3 className="eyebrow mb-2">Five-step story</h3>
          <div className="flex flex-wrap gap-1.5">
            {STORY_BEATS.map(({ key, label }) => {
              const optional = key === 'call_to_action'
              return (
                <span key={key} className={cn('rounded-full px-2 py-0.5 text-2xs', grade.storyBeats[key] ? 'bg-emerald-400/20 text-emerald-200' : optional ? 'bg-white/[0.06] text-ink-subtle' : 'bg-white/[0.06] text-ink-subtle line-through')}>
                  {label}{optional && !grade.storyBeats[key] ? ' (optional)' : ''}
                </span>
              )
            })}
          </div>
        </section>

        {(grade.fix || grade.suggestedTitle) && (
          <section className="glass-tile space-y-2 rounded-xl p-3">
            {grade.fix && <p className="text-xs text-ink"><span className="font-medium">To make it stronger:</span> <span className="text-ink-muted">{grade.fix}</span></p>}
            {grade.suggestedTitle && (
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 text-xs"><span className="font-medium text-ink">Suggested hook text:</span> <span className="text-ink-muted">{grade.suggestedTitle}</span></p>
                <Button size="sm" variant="secondary" icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  onClick={() => { void navigator.clipboard?.writeText(grade.suggestedTitle).then(() => setCopied(true)).catch(() => undefined) }}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            )}
          </section>
        )}
      </div>
    </Dialog>
  )
}
