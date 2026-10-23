import { useEffect, useRef, useState } from 'react'
import { AudioLines, Check, Clapperboard, Clock3, Eye, Film, Layers, Save, Scissors, Shapes, Sparkles, Wand2, X, type LucideIcon } from 'lucide-react'
import { EDIT_STAGE_LABELS, editStagePlan, type EditProgress, type EditStageId } from '../../shared/edit-progress'
import { formatClock, type EditSource, type EditStatus } from '../../shared/edit-recording'
import { aboutMinutes, clockOf, estimateEdit, recordEditTimings } from '../lib/edit-timings'
import { cn, localFileUrl } from '../lib/utils'
import { StepList, type StepItem } from './StepList'
import { Button } from './ui/Button'
import { Panel } from './ui/Panel'
import { ProgressBar } from './ui/ProgressBar'
import './edit-progress.css'

const ICONS: Record<EditStageId, LucideIcon> = {
  ready: Film, listen: AudioLines, plan: Wand2, review: Eye, graphics: Shapes, cut: Scissors, sound: AudioLines, layers: Layers, save: Save
}

/** What each stage does, said under it while it runs. */
const HINTS: Record<EditStageId, string> = {
  ready: 'Turning each clip upright, checking its framing, brightness and loudness.',
  listen: 'Writing down every word you say, with its timing.',
  plan: 'Reading what you said to pick the hook, the best takes and what to cut.',
  review: 'You check the edit, then make the reel.',
  graphics: 'Drawing the graphics you picked.',
  cut: 'Cutting out retakes and filler words and joining the rest.',
  sound: 'Evening out your voice and adding sound.',
  layers: 'Putting on your hook text, captions, pop-ups and graphics.',
  save: 'Saving the reel to your Library.'
}

/** The page title while it runs (kept as before). */
export function editProgressTitle(status: EditStatus): string {
  return status.phase === 'rendering' ? 'Making your reel' : status.phase === 'planning' ? 'Planning your edit'
    : status.mode === 'combine' ? (status.percent < 45 ? 'Getting your clips ready' : 'Listening to your clips') : 'Listening to your recording'
}

/** A clock that ticks once a second while the run goes. */
export function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  return now
}

type StageState = 'done' | 'current' | 'next'

function stageStates(plan: EditStageId[], progress: EditProgress | undefined, phase: EditStatus['phase']): Map<EditStageId, StageState> {
  const states = new Map<EditStageId, StageState>()
  const current = progress?.stages[progress.stages.length - 1]
  const currentId = current && current.endedAt === null ? current.id : null
  // Before progress was reported (older runs): the phase says roughly where it is.
  const fallback: EditStageId | null = currentId ?? (phase === 'planning' ? 'plan' : phase === 'rendering' ? 'cut' : phase === 'transcribing' ? 'listen' : null)
  const at = fallback ? plan.indexOf(fallback) : -1
  plan.forEach((id, i) => {
    const time = progress?.stages.find((stage) => stage.id === id)
    states.set(id, id === fallback ? 'current' : time?.endedAt != null || (at >= 0 && i < at) ? 'done' : 'next')
  })
  return states
}

/** A clip's picture: its thumbnail once made, else the first frame of the file. */
function ClipPicture({ source, className }: { source: EditSource; className?: string }): React.JSX.Element {
  return source.thumb
    ? <img src={localFileUrl(source.thumb)} alt="" className={cn('h-full w-full object-cover', className)} />
    : <video src={`${localFileUrl(source.path)}#t=0.1`} preload="metadata" muted playsInline aria-hidden tabIndex={-1} className={cn('h-full w-full object-cover', className)} />
}

/** The member's clips in a row: done ones checked, the current one lit. */
function ClipStrip({ sources, order, current, doneBefore, label }: { sources: EditSource[]; order: number[]; current: number | null; doneBefore: (src: number, i: number) => boolean; label: string }): React.JSX.Element {
  const ref = useRef<HTMLUListElement>(null)
  useEffect(() => {
    const list = ref.current
    const item = list?.querySelector<HTMLElement>('[data-state="current"]')
    if (!list || !item) return
    // Keep the current clip in view (sideways only: never scroll the page).
    const left = item.offsetLeft - list.clientWidth / 2 + item.clientWidth / 2
    list.scrollTo?.({ left: Math.max(0, left), behavior: 'smooth' })
  }, [current])
  return (
    <ul ref={ref} aria-label={label} data-testid="edit-progress-clips" className={cn('-mx-1 flex overflow-x-auto px-1 pb-2 pt-1 [scrollbar-width:none]', order.length > 8 ? 'gap-1.5' : 'gap-2')}>
      {order.map((src, i) => {
        const source = sources[src]
        if (!source) return null
        const state: StageState = src === current ? 'current' : doneBefore(src, i) ? 'done' : 'next'
        return (
          <li key={src} data-state={state} aria-current={state === 'current' ? 'step' : undefined}
            aria-label={`Clip ${src + 1}${state === 'done' ? ', done' : state === 'current' ? ', working on it' : ''}`}
            className={cn('relative shrink-0 transition-opacity duration-200', order.length > 8 ? 'w-[44px]' : 'w-[54px]', state === 'next' && 'opacity-45')}>
            <div className={cn('relative aspect-[9/14] overflow-hidden rounded-lg bg-black ring-1 ring-white/10',
              state === 'current' && 'edit-progress-live ring-2 ring-tool')}>
              <ClipPicture source={source} />
              {state === 'done' && <span className="absolute inset-0 flex items-center justify-center bg-canvas/45"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-success text-canvas"><Check aria-hidden className="h-3 w-3" strokeWidth={3} /></span></span>}
              {state === 'current' && <span aria-hidden className="edit-progress-sweep" />}
            </div>
            <span className={cn('mt-1 block text-center font-mono text-[10px] tabular', state === 'current' ? 'text-tool' : 'text-ink-subtle')}>{src + 1}</span>
          </li>
        )
      })}
    </ul>
  )
}

/** Words coming in, one after another (each new line animates in). */
function Streamed({ text, id }: { text: string; id: string }): React.JSX.Element {
  return (
    <span key={id}>
      {text.split(' ').map((word, i) => (
        <span key={`${id}-${i}`}>{i > 0 ? ' ' : ''}<span className="edit-progress-word" style={{ animationDelay: `${Math.min(i, 24) * 55}ms` }}>{word}</span></span>
      ))}
    </span>
  )
}

function Fact({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'found' }): React.JSX.Element {
  return (
    <li className={cn('glass-tile flex min-w-0 items-start gap-2 rounded-lg px-2.5 py-1.5 text-xs', tone === 'found' ? 'text-ink' : 'text-ink-muted')}>
      <Sparkles aria-hidden className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', tone === 'found' ? 'text-tool' : 'text-ink-subtle')} />
      <span className="min-w-0">{children}</span>
    </li>
  )
}

/** "…" after words cut off mid-sentence (none after a full stop). */
const trail = (text: string): string => (/[.!?]$/.test(text) ? '' : '…')

/** First words heard per clip. */
function HeardList({ heard, bright = false }: { heard: { src: number; text: string }[]; bright?: boolean }): React.JSX.Element | null {
  if (!heard.length) return null
  return (
    <ul className="mt-1.5 space-y-1">
      {heard.map((item) => (
        <li key={item.src} className={cn('flex min-w-0 gap-2 text-xs', bright ? 'text-ink-muted' : 'text-ink-subtle')}>
          <span className="w-12 shrink-0 font-mono text-[10px] leading-[18px] tabular text-ink-subtle">Clip {item.src + 1}</span>
          <span className="min-w-0 truncate">“{item.text}{trail(item.text)}”</span>
        </li>
      ))}
    </ul>
  )
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** What's happening right now, for the current stage. */
function NowPanel({ status, stage }: { status: EditStatus; stage: EditStageId | null }): React.JSX.Element {
  const progress = status.progress
  const sources = status.sources
  const combine = status.mode === 'combine'
  const step = progress?.step ?? null
  const all = sources.map((_, i) => i)
  const heard = progress?.heard ?? []
  const lastHeard = heard[heard.length - 1]
  const found = progress?.found ?? {}
  const label = stage ? EDIT_STAGE_LABELS[stage] : 'Starting'
  let heading = label
  if (stage === 'listen') heading = sources.length > 1 && step ? `Listening to clip ${step.n} of ${step.of}` : combine ? 'Listening to your clips' : 'Listening to your recording'
  else if (stage === 'ready' && step) heading = `Getting clip ${step.n} of ${step.of} ready`
  else if (stage === 'cut' && step && /^Cutting/.test(status.detail)) heading = `Cutting piece ${step.n} of ${step.of}`
  else if (stage === 'cut' && step && combine) heading = `Getting clip ${(progress?.clip ?? step.n - 1) + 1} ready`

  const perClip = stage === 'ready' || stage === 'listen'
  const making = status.phase === 'rendering'
  const order = making && progress?.order?.length ? progress.order : all
  const opening = making ? openingFrame(status) : null

  return (
    <section aria-label="Happening now" data-testid="edit-progress-now" className="glass-tile min-w-0 rounded-xl p-4">
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-tool edit-progress-live" />
        <h3 className="min-w-0 truncate font-display text-[15px] font-semibold text-ink" data-testid="edit-progress-heading">{heading}</h3>
      </div>
      <p className="mt-1 text-xs text-ink-muted">{stage ? HINTS[stage] : 'Starting up.'}</p>

      {(perClip || (making && combine)) && sources.length > 0 && (
        <div className="mt-3">
          <ClipStrip sources={sources} order={order} current={perClip ? progress?.clip ?? (step ? step.n - 1 : null) : progress?.clip ?? null}
            label={making ? 'Your clips, in the reel’s order' : 'Your clips'}
            doneBefore={(src) => perClip ? (step ? src < step.n - 1 : false) || (stage === 'listen' && heard.some((h) => h.src === src))
              : stage === 'cut' ? /^Cutting/.test(status.detail) || (progress?.clip != null && src < progress.clip) : stage !== 'graphics'} />
        </div>
      )}

      {stage === 'listen' && (
        <div className="mt-2 min-h-[52px]" aria-live="polite">
          {lastHeard
            ? <><p className="eyebrow text-ink-subtle">Heard in {sources.length > 1 ? `clip ${lastHeard.src + 1}` : 'your recording'}</p>
              <p className="mt-1 font-display text-[15px] leading-snug text-ink" data-testid="edit-progress-heard">“<Streamed text={lastHeard.text} id={`${lastHeard.src}`} />{trail(lastHeard.text)}”</p>
              <HeardList heard={heard.slice(0, -1).slice(-3).reverse()} /></>
            : <p className="text-xs text-ink-subtle">The first words show here once {sources.length > 1 ? 'a clip is' : 'it’s'} heard.</p>}
        </div>
      )}

      {stage === 'plan' && (
        <ul className="mt-3 grid gap-1.5" aria-live="polite" data-testid="edit-progress-found">
          {(progress?.wordsHeard ?? 0) > 0 && <Fact>Heard {plural(progress!.wordsHeard, 'word')}{sources.length > 1 ? ` in ${plural(sources.length, combine ? 'clip' : 'take')}` : ''}</Fact>}
          {(found.fillers ?? 0) + (found.retakes ?? 0) > 0 && <Fact tone="found">Marked {[found.fillers ? plural(found.fillers, 'filler word') : null, found.retakes ? `${plural(found.retakes, 'word')} of retakes and restarts` : null].filter(Boolean).join(' and ')} to cut</Fact>}
          {found.hook ? <Fact tone="found">Found your hook: “{found.hook}”</Fact> : <Fact>Looking for your strongest hook</Fact>}
          {found.cuts !== undefined && <Fact tone="found">{plural(found.cuts, 'word')} to cut</Fact>}
          {found.popups ? <Fact tone="found">{plural(found.popups, 'pop-up')} planned</Fact> : null}
        </ul>
      )}
      {stage === 'plan' && heard.length > 0 && (
        <div className="mt-3">
          <p className="eyebrow text-ink-subtle">What you said{sources.length > 1 ? ', clip by clip' : ''}</p>
          <HeardList heard={heard.slice(0, 8)} bright />
        </div>
      )}

      {making && (
        <div className="mt-3 flex flex-wrap items-start gap-4">
          {opening && (
            <figure className="w-[96px] shrink-0">
              <div className="relative aspect-[9/16] overflow-hidden rounded-lg bg-black ring-1 ring-white/10">
                <video src={`${localFileUrl(opening.path)}#t=${opening.seconds.toFixed(2)}`} {...(opening.poster ? { poster: localFileUrl(opening.poster) } : {})} preload="auto" muted playsInline aria-hidden tabIndex={-1} className="h-full w-full object-cover" />
                {found.hook && <span className="absolute inset-x-1.5 top-[10%] text-center"><span className="box-decoration-clone rounded bg-black/60 px-1 font-display text-[9px] font-bold leading-[1.5] text-white">{found.hook}</span></span>}
              </div>
              <figcaption className="mt-1 text-center text-[10px] text-ink-subtle">Your opening</figcaption>
            </figure>
          )}
          <ul className="grid min-w-0 flex-1 gap-1.5" data-testid="edit-progress-found">
            {found.hook && <Fact tone="found">Opening on “{found.hook}”</Fact>}
            {found.cuts !== undefined && <Fact tone="found">{found.cuts ? `${plural(found.cuts, 'word')} cut` : 'No words cut'}</Fact>}
            {found.popups ? <Fact tone="found">{plural(found.popups, 'pop-up')}</Fact> : null}
            {found.graphics ? <Fact tone="found">{plural(found.graphics, 'graphic')}</Fact> : null}
            {found.broll && <Fact tone="found">B-roll over your words</Fact>}
            {combine && order.length > 0 && <Fact>{plural(order.length, 'clip')} joined in your order</Fact>}
          </ul>
        </div>
      )}
    </section>
  )
}

/** Where the reel opens: the hook's first word in its clip (the planned frame, not the rendered one). */
function openingFrame(status: EditStatus): { path: string; seconds: number; poster?: string } | null {
  const plan = status.plan
  if (!plan) return null
  const hookText = status.progress?.found.hook
  const hook = plan.hooks.find((item) => hookText && item.text.trim() === hookText) ?? plan.hooks.find((item) => item.id === plan.hook)
  const word = hook ? plan.words[hook.start] : plan.words.find((item) => !item.cut)
  const source = word ? status.sources[word.src] : status.sources[0]
  if (!word || !source) return null
  // The clip's thumbnail shows until the frame itself has loaded.
  return { path: source.proxy ?? source.path, seconds: Math.max(0, word.startMs / 1000 + 0.05), ...(source.thumb ? { poster: source.thumb } : {}) }
}

/**
 * Edit my recording / Combine clips while it runs: the steps of the whole job (done ones with how long they took,
 * the current one lit), what's happening right now (the clips, the words heard, what the plan found, the opening),
 * elapsed time and, once there's something measured to go on, about how long is left.
 */
export function EditProgressView({ status, onCancel }: { status: EditStatus; onCancel: () => void }): React.JSX.Element {
  const now = useNow(true)
  const progress = status.progress
  useEffect(() => { recordEditTimings(status) }, [status])
  const combine = status.mode === 'combine'
  const plan = editStagePlan(combine, progress)
  const states = stageStates(plan, progress, status.phase)
  const current = plan.find((id) => states.get(id) === 'current') ?? null
  const making = status.phase === 'rendering'
  const startedAt = making ? progress?.renderStartedAt ?? null : progress?.startedAt ?? null
  const elapsed = startedAt ? Math.max(0, now - startedAt) : null
  const estimate = estimateEdit(status, now)
  const seconds = status.sources.reduce((sum, source) => sum + source.seconds, 0)
  const what = combine ? plural(status.sources.length, 'clip') : status.sources.length > 1 ? plural(status.sources.length, 'take') : 'your recording'
  const part = making ? 'Making the reel' : 'The edit'
  const firstClip = status.sources.length > 1 && (current === 'ready' || current === 'listen') && (progress?.step?.n ?? 1) <= 1
  const total = estimate.totalMs !== null
    ? `${part} takes ${aboutMinutes(estimate.totalMs)} for ${what} (${formatClock(seconds)} of video), going by ${estimate.basis === 'so-far' ? 'the clips done so far' : 'your earlier edits on this computer'}.`
    : `Timing it as it goes: ${what}, ${formatClock(seconds)} of video.${firstClip ? ' Time left shows once the first clip is done.' : ' Next time, this run’s times give an estimate up front.'}`
  const left = estimate.leftMs !== null ? `${aboutMinutes(estimate.leftMs)} left` : estimate.stageLeftMs !== null ? `this step: ${aboutMinutes(estimate.stageLeftMs)} left` : null

  return (
    <Panel className="mt-5" data-testid="edit-progress">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-5 tracking-[-0.01em] text-ink">{editProgressTitle(status)}</h2>
          <p className="mt-0.5 text-xs text-ink-muted" data-testid="edit-progress-estimate">{total}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {elapsed !== null && <span className="glass-tile inline-flex h-7 items-center gap-1.5 rounded-full px-3 font-mono text-[11px] tabular text-ink-muted"><Clock3 aria-hidden className="h-3.5 w-3.5 text-ink-subtle" />{clockOf(elapsed)} elapsed</span>}
          {left && <span className="inline-flex h-7 items-center rounded-full bg-tool/[0.12] px-3 font-mono text-[11px] tabular text-tool" data-testid="edit-progress-left">{left}</span>}
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(210px,250px)_minmax(0,1fr)]">
        <StepList testId="edit-progress-steps" items={plan.map((id): StepItem => {
          const state = states.get(id) ?? 'next'
          const time = progress?.stages.find((stage) => stage.id === id)
          const took = time && time.endedAt !== null ? time.endedAt - time.startedAt : null
          const running = state === 'current' && time ? Math.max(0, now - time.startedAt) : null
          const note = id === 'review' ? (state === 'done' ? 'Done' : state === 'next' ? 'You' : null)
            : took !== null ? clockOf(took) : running !== null ? clockOf(running) : null
          return { id, label: EDIT_STAGE_LABELS[id], icon: ICONS[id], state, note,
            step: progress?.step && id !== 'cut' ? `${progress.step.n} of ${progress.step.of}` : null }
        })} />
        <NowPanel status={status} stage={current} />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <ProgressBar value={status.percent} className="flex-1" />
        <span className="w-10 shrink-0 text-right font-mono text-xs tabular text-ink-muted">{status.percent}%</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-xs text-ink-muted" aria-live="polite">{status.detail}</p>
        <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={onCancel}>Cancel</Button>
      </div>
      {making && <p className="mt-1 flex items-center gap-1.5 text-2xs text-ink-subtle"><Clapperboard aria-hidden className="h-3 w-3" />The reel is made on this computer: you can keep working in other pages.</p>}
    </Panel>
  )
}
