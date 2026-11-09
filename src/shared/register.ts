/**
 * The member's style register: ONE choice (Teaching, Story or Minimal) that sets both how many motion graphics the
 * engine plans (graphics_director.py) and how much sound plays (sound-design.ts, engine sound_design.py). It is
 * remembered with Create's style (member-prefs `register`; unset: the engine reads it from what is said, and sound
 * plays as Teaching), used when Create and Edit my recording plan, and shown again on the review as "Style".
 */
export const REGISTERS = ['teaching', 'story', 'minimal'] as const
export type Register = (typeof REGISTERS)[number]
export const DEFAULT_REGISTER: Register = 'teaching'

/** What each style does to the graphics and the sound, in the member's words. */
export const REGISTER_INFO: Record<Register, { label: string; detail: string }> = {
  teaching: { label: 'Teaching', detail: 'A graphic on each number, list and key point, and a sound on each graphic and scene change. Best for tips and how-tos.' },
  story: { label: 'Story', detail: 'About half as many graphics and a few soft sounds. Personal moments stay on your face. Best for stories.' },
  minimal: { label: 'Minimal', detail: 'Only the hook, the numbers and the call to action get a graphic, with sound on the biggest moments.' }
}

export function isRegister(value: unknown): value is Register {
  return typeof value === 'string' && (REGISTERS as readonly string[]).includes(value)
}

/** Effects that show a number or the call to action (what a Minimal video keeps, with stats, hooks and CTAs). */
const MINIMAL_EFFECTS = ['count-up', 'number-pop-in', 'conic-progress-ring', 'star-rating-fill', 'chart-story', 'decline-chart', 'cta-lockup']
const MINIMAL_TEMPLATES = ['stat', 'headline_pill', 'comment_cta', 'link_cta', 'chapter']

/** Whether an automatic graphic stays in this style (Minimal keeps only numbers, the hook and the call to action). */
export function registerKeeps(g: { template: string; fields: Record<string, string>; origin?: string }, register: Register | undefined): boolean {
  if (register !== 'minimal' || g.origin !== 'auto') return true
  return MINIMAL_TEMPLATES.includes(g.template) || (g.template === 'fx' && MINIMAL_EFFECTS.includes(g.fields.effect ?? ''))
}
