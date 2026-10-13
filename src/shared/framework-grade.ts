/**
 * Paid Creators framework grade attached to each clip by the engine
 * (engine/clip_engine/services/framework_grader.py). Parsed defensively:
 * it comes from model output saved on disk.
 */

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F'

export const FRAMEWORK_CRITERIA = [
  { key: 'triple_hook', label: 'Triple Hook', weight: 0.25 },
  { key: 'twist', label: 'Twist / false belief', weight: 0.15 },
  { key: 'hook_speed', label: 'Hook speed', weight: 0.15 },
  { key: 'story_arc', label: 'Story arc', weight: 0.15 },
  { key: 'payoff', label: 'Payoff', weight: 0.15 },
  { key: 'specificity', label: 'Specificity & proof', weight: 0.1 },
  { key: 'emotion_stance', label: 'Emotion & stance', weight: 0.05 }
] as const
export type CriterionKey = (typeof FRAMEWORK_CRITERIA)[number]['key']

export const HOOK_ELEMENTS = [
  { key: 'qualifier', label: 'Qualifier' },
  { key: 'main_statement', label: 'Main statement' },
  { key: 'twist', label: 'Twist' },
  { key: 'stakes', label: 'Stakes (bonus)' }
] as const
export type HookElementKey = (typeof HOOK_ELEMENTS)[number]['key']

export const STORY_BEATS = [
  { key: 'hook', label: 'Hook' },
  { key: 'background', label: 'Background' },
  { key: 'conflict', label: 'Conflict' },
  { key: 'resolution', label: 'Resolution' },
  { key: 'call_to_action', label: 'CTA' }
] as const
export type StoryBeatKey = (typeof STORY_BEATS)[number]['key']

export const HARD_FAIL_LABELS: Record<string, string> = {
  no_hook: 'No hook in the first ~15 seconds',
  payoff_cut_off: 'Ends before the payoff',
  opens_on_filler_or_price: 'Opens on filler, a greeting or a price',
  misleading: 'Title or framing overpromises',
  broken_start_or_end: 'Starts or ends mid-sentence'
}

export const HOOK_TYPE_LABELS: Record<string, string> = {
  direct_response: 'Direct response', story: 'Story', challenge: 'Challenge', educational: 'Educational',
  contrarian: 'Contrarian', vulnerability: 'Vulnerability', none: 'No clear hook'
}

export interface FrameworkGrade {
  grade: Grade
  /** Weighted 0-10. */
  score: number
  scores: Record<CriterionKey, number>
  hookElements: Record<HookElementKey, string | null>
  hookType: string
  storyBeats: Record<StoryBeatKey, boolean>
  hardFails: string[]
  verdict: string
  fix: string
  suggestedTitle: string
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

function score(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(10, Math.max(0, value)) : 0
}

export function parseFrameworkGrade(value: unknown): FrameworkGrade | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.grade !== 'string' || !['A', 'B', 'C', 'D', 'F'].includes(raw.grade)) return null
  const scores = (raw.scores && typeof raw.scores === 'object' ? raw.scores : {}) as Record<string, unknown>
  const elements = (raw.hook_elements && typeof raw.hook_elements === 'object' ? raw.hook_elements : {}) as Record<string, unknown>
  const beats = (raw.story_beats && typeof raw.story_beats === 'object' ? raw.story_beats : {}) as Record<string, unknown>
  return {
    grade: raw.grade as Grade,
    score: score(raw.score),
    scores: Object.fromEntries(FRAMEWORK_CRITERIA.map(({ key }) => [key, score(scores[key])])) as Record<CriterionKey, number>,
    hookElements: Object.fromEntries(HOOK_ELEMENTS.map(({ key }) => [key, text(elements[key], 300) || null])) as Record<HookElementKey, string | null>,
    hookType: typeof raw.hook_type === 'string' && raw.hook_type in HOOK_TYPE_LABELS ? raw.hook_type : 'none',
    storyBeats: Object.fromEntries(STORY_BEATS.map(({ key }) => [key, beats[key] === true])) as Record<StoryBeatKey, boolean>,
    hardFails: Array.isArray(raw.hard_fails) ? raw.hard_fails.filter((item): item is string => typeof item === 'string' && item in HARD_FAIL_LABELS).slice(0, 5) : [],
    verdict: text(raw.verdict, 300),
    fix: text(raw.fix, 400),
    suggestedTitle: text(raw.suggested_title, 80)
  }
}

/** Sort key: graded clips by weighted score, ungraded last. */
export function gradeRank(grade: FrameworkGrade | null | undefined): number {
  return grade ? grade.score : -1
}
