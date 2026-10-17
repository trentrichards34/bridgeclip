/**
 * "Ready to post": clips from every Library run (Create, Remix and Avatar
 * Studio) that are not posted yet. The main process builds the list from the
 * runs' job_output.json files; filtering, sorting and search run here so the
 * renderer and the tests share them.
 */

import type { Grade } from './framework-grade'
import type { LibraryPostingState } from './library-posting'

export type RunKind = 'create' | 'remix' | 'avatar'

export const RUN_KIND_LABELS: Record<RunKind, string> = { create: 'Create', remix: 'Remix', avatar: 'Avatar' }

export interface ReadyClip {
  outputDir: string
  runTitle: string
  kind: RunKind
  /** When the run was made (ISO). */
  runDate: string
  clipIndex: number
  /** The clip's title (its summary), or "Clip N". */
  title: string
  headline: string | null
  postCaption: string | null
  /** Framework grade, when grading ran. */
  grade: Grade | null
  /** Weighted framework score 0-10, when graded. */
  gradeScore: number | null
  viralityScore: number
  durationMs: number
  s3Url: string
  tags: string[]
  aiGenerated: boolean
  /** Never 'posted' here; scheduled, partial, draft and failed clips still count as not posted. */
  state: LibraryPostingState
}

export interface ReadyToPostResult {
  clips: ReadyClip[]
  /** Runs in the Library that have clips. */
  runs: number
  /** Runs whose posting history could not be checked (their clips are left out). */
  unreadableRuns: number
  /** False when no Zernio key is set: only manual "posted" marks were checked. */
  postingHistory: boolean
}

export type MinGrade = 'any' | 'A' | 'B' | 'C'
export type ReadySort = 'newest' | 'best'

export interface ReadyFilters {
  minGrade: MinGrade
  kind: RunKind | 'all'
  sort: ReadySort
  query: string
}

export const DEFAULT_READY_FILTERS: ReadyFilters = { minGrade: 'any', kind: 'all', sort: 'newest', query: '' }

const GRADE_ORDER: Record<Grade, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 }

/** A run folder's kind: Avatar Studio and Remix runs have their own folder names. */
export function runKindOf(folderName: string, title = ''): RunKind {
  if (/^avatar-/.test(folderName) || title.startsWith('Avatar Studio ·')) return 'avatar'
  if (/^remix-/.test(folderName)) return 'remix'
  return 'create'
}

/** True when the clip has a grade at least `min`. Ungraded clips only pass "any". */
export function meetsGrade(grade: Grade | null, min: MinGrade): boolean {
  if (min === 'any') return true
  return grade !== null && GRADE_ORDER[grade] >= GRADE_ORDER[min]
}

/** Framework score when graded, otherwise the planner's virality score, both on 0-10 (as in a run's "Best first"). */
export function readyRank(clip: Pick<ReadyClip, 'gradeScore' | 'viralityScore'>): number {
  return clip.gradeScore ?? clip.viralityScore * 10
}

function matches(clip: ReadyClip, words: string[]): boolean {
  if (!words.length) return true
  const text = [clip.title, clip.headline, clip.postCaption, clip.runTitle, ...clip.tags].filter(Boolean).join(' ').toLowerCase()
  return words.every((word) => text.includes(word))
}

export function filterReadyClips(clips: readonly ReadyClip[], filters: ReadyFilters): ReadyClip[] {
  const words = filters.query.toLowerCase().split(/\s+/).filter(Boolean)
  const list = clips.filter((clip) => (filters.kind === 'all' || clip.kind === filters.kind) && meetsGrade(clip.grade, filters.minGrade) && matches(clip, words))
  const newest = (a: ReadyClip, b: ReadyClip): number => (Date.parse(b.runDate) || 0) - (Date.parse(a.runDate) || 0)
  const best = (a: ReadyClip, b: ReadyClip): number => readyRank(b) - readyRank(a)
  return list.sort((a, b) => (filters.sort === 'best' ? best(a, b) || newest(a, b) : newest(a, b) || best(a, b)) || a.outputDir.localeCompare(b.outputDir) || a.clipIndex - b.clipIndex)
}
