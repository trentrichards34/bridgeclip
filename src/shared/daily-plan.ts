/**
 * "Today's 3": three videos to make today (the program's daily habit), picked
 * from the member's goals and what's in their Library: a clip from their
 * latest long video, a reaction, and a talking-head video, with stand-ins when
 * their goals point elsewhere. Items tick off from finished Library runs made
 * today, and the streak counts days in a row with at least one finished run.
 * Everything here is worked out from real runs: nothing is assumed or made up.
 */

import type { GoalId } from './onboarding'

export const DAILY_TARGET = 3
/** A Create run this recent offers "a clip from your latest long video". */
export const RECENT_SOURCE_DAYS = 14

export type PlanKind = 'clip' | 'reaction' | 'talking' | 'listicle' | 'avatar'

/** The Library runs the plan reads (a subset of the history entries). */
export interface PlanRun {
  madeWith?: 'create' | 'remix' | 'avatar' | 'edit' | 'listicle'
  status: string
  date: string
  finishedAt: string | null
  outputDir: string
  videoTitle: string
  sourceUrl?: string
}

const KIND_OF_MAKER: Record<NonNullable<PlanRun['madeWith']>, PlanKind> = {
  create: 'clip', remix: 'reaction', edit: 'talking', listicle: 'listicle', avatar: 'avatar'
}

export function planKindOf(run: PlanRun): PlanKind | null {
  if (run.status !== 'completed') return null
  return KIND_OF_MAKER[run.madeWith ?? 'create'] ?? null
}

/** The local calendar day of a time, as YYYY-MM-DD. */
export function localDay(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function finishedDay(run: PlanRun): string | null {
  const when = run.finishedAt ?? run.date
  const time = Date.parse(when)
  return Number.isFinite(time) ? localDay(new Date(time)) : null
}

/** The goals each kind serves (a member with goals gets the kinds their goals point to first). */
const KIND_GOALS: Record<PlanKind, GoalId[]> = {
  clip: ['clips'],
  reaction: ['camera-reactions', 'ai-reactions', 'article'],
  talking: ['edit-recording'],
  listicle: ['listicle'],
  avatar: ['avatar-videos']
}

/**
 * Today's three kinds. The usual mix is a clip (only when there's a recent long
 * video to clip from), a reaction and a talking-head video; a member's goals
 * put the kinds they chose first, and stand-ins fill the rest.
 */
export function planSlots(goals: readonly GoalId[], hasRecentSource: boolean): PlanKind[] {
  const order: PlanKind[] = ['clip', 'reaction', 'talking', 'listicle', 'avatar']
  const usable = order.filter((kind) => kind !== 'clip' || hasRecentSource)
  const wanted = goals.length ? usable.filter((kind) => KIND_GOALS[kind].some((goal) => goals.includes(goal))) : []
  const picks = [...wanted]
  for (const kind of ['clip', 'reaction', 'talking', 'listicle'] as PlanKind[]) {
    if (picks.length >= DAILY_TARGET) break
    if (usable.includes(kind) && !picks.includes(kind)) picks.push(kind)
  }
  return picks.slice(0, DAILY_TARGET).sort((a, b) => order.indexOf(a) - order.indexOf(b))
}

/** Finished runs made today, by kind. */
export function todayRuns(runs: readonly PlanRun[], now: Date): { total: number; byKind: Partial<Record<PlanKind, number>> } {
  const today = localDay(now)
  const byKind: Partial<Record<PlanKind, number>> = {}
  let total = 0
  for (const run of runs) {
    const kind = planKindOf(run)
    if (!kind || finishedDay(run) !== today) continue
    total++
    byKind[kind] = (byKind[kind] ?? 0) + 1
  }
  return { total, byKind }
}

/**
 * Days in a row with at least one finished Library run, ending today (or
 * yesterday, while today has none yet: the streak is still alive).
 */
export function streakDays(runs: readonly PlanRun[], now: Date): number {
  const days = new Set(runs.filter((run) => planKindOf(run)).map(finishedDay).filter((day): day is string => day !== null))
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (!days.has(localDay(cursor))) cursor.setDate(cursor.getDate() - 1)
  let count = 0
  while (days.has(localDay(cursor))) {
    count++
    cursor.setDate(cursor.getDate() - 1)
  }
  return count
}

/** The latest Create run from the last RECENT_SOURCE_DAYS days that has a source, or null. */
export function recentSource(runs: readonly PlanRun[], now: Date): { url: string; title: string; outputDir: string } | null {
  const since = now.getTime() - RECENT_SOURCE_DAYS * 24 * 60 * 60 * 1000
  const candidates = runs.filter((run) => planKindOf(run) === 'clip' && run.sourceUrl && Date.parse(run.finishedAt ?? run.date) >= since)
    .sort((a, b) => Date.parse(b.finishedAt ?? b.date) - Date.parse(a.finishedAt ?? a.date))
  const run = candidates[0]
  return run?.sourceUrl ? { url: run.sourceUrl, title: run.videoTitle, outputDir: run.outputDir } : null
}

export function streakLabel(days: number): string {
  if (days <= 0) return 'No streak yet. Finish a video today to start one.'
  return days === 1 ? '1 day in a row with a new video' : `${days} days in a row with a new video`
}
