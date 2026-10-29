// "What's working": average views of posted clips, grouped by what is known
// about each clip (framework grade, hook look, caption style). Built only
// from views Zernio reported; nothing is shown until there are enough posts.

import type { Grade } from './framework-grade'

/** One posted clip with real views. */
export interface InsightPost {
  views: number
  grade: Grade | null
  /** HeadlineLookStyle id, when the clip records how it was made. */
  hookLook: string | null
  /** Caption preset id, 'none' for no captions, when the clip records it. */
  captionStyle: string | null
}

export interface InsightRow {
  key: string
  label: string
  posts: number
  averageViews: number
}

export interface InsightGroup {
  id: 'grade' | 'hookLook' | 'captionStyle'
  title: string
  rows: InsightRow[]
}

export interface PostInsights {
  /** Posts old enough to count, with views from Zernio. */
  posts: number
  /** More posts with views needed before anything is shown; 0 when there are enough. */
  needed: number
  groups: InsightGroup[]
  /** Why a group is missing, e.g. too few posts with a known caption style. */
  notes: string[]
}

/** Below this many posts with views, averages say more about luck than about the clips. */
export const MIN_INSIGHT_POSTS = 6
/** A row needs at least this many posts. */
export const MIN_ROW_POSTS = 2
/** Posts younger than this are still gaining views, so they aren't counted yet. */
export const MIN_INSIGHT_AGE_MS = 24 * 3_600_000

const GRADE_ORDER = ['A', 'B', 'C', 'D', 'F']

function group(id: InsightGroup['id'], title: string, posts: InsightPost[], keyOf: (post: InsightPost) => string | null,
  labelOf: (key: string) => string, order: (a: string, b: string) => number): InsightGroup | null {
  const buckets = new Map<string, number[]>()
  for (const post of posts) {
    const key = keyOf(post)
    if (key === null) continue
    const list = buckets.get(key) ?? []
    list.push(post.views)
    buckets.set(key, list)
  }
  const rows = [...buckets.entries()]
    .filter(([, views]) => views.length >= MIN_ROW_POSTS)
    .sort(([a], [b]) => order(a, b))
    .map(([key, views]) => ({ key, label: labelOf(key), posts: views.length, averageViews: Math.round(views.reduce((sum, value) => sum + value, 0) / views.length) }))
  // One row alone has nothing to compare with.
  return rows.length >= 2 ? { id, title, rows } : null
}

export function summarizeInsights(posts: InsightPost[], labels: { hookLook: (id: string) => string; captionStyle: (id: string) => string }): PostInsights {
  const usable = posts.filter((post) => Number.isFinite(post.views) && post.views >= 0)
  if (usable.length < MIN_INSIGHT_POSTS) return { posts: usable.length, needed: MIN_INSIGHT_POSTS - usable.length, groups: [], notes: [] }
  const byName = (a: string, b: string): number => a.localeCompare(b)
  const candidates: [InsightGroup['id'], InsightGroup | null, string][] = [
    ['grade', group('grade', 'By framework grade', usable, (post) => post.grade, (key) => `Grade ${key}`, (a, b) => GRADE_ORDER.indexOf(a) - GRADE_ORDER.indexOf(b)), 'grades'],
    ['hookLook', group('hookLook', 'By hook look', usable, (post) => post.hookLook, labels.hookLook, byName), 'hook looks'],
    ['captionStyle', group('captionStyle', 'By caption style', usable, (post) => post.captionStyle, labels.captionStyle, byName), 'caption styles']
  ]
  const groups = candidates.map(([, value]) => value).filter((value): value is InsightGroup => value !== null)
  const notes = candidates.filter(([, value]) => value === null)
    .map(([, , what]) => `Not enough to compare ${what} yet: it needs ${MIN_ROW_POSTS} or more posts for each of two different ${what}.`)
  return { posts: usable.length, needed: 0, groups, notes }
}
