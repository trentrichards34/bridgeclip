/**
 * Edit styles for Edit my recording: a few named bundles of pacing and
 * visual choices the member picks on the review screen before the reel is
 * made. Each is our own; none is modeled on a named creator.
 *
 * Pacing is what the cut does (how long a pause may run before it's
 * tightened, whether jump cuts punch in). Cards, pop-ups and extras are what
 * is switched on by default; the member can change each one after picking.
 */

import { parseLookExtras, type LookExtraId } from './look-extras'

export interface EditPacing {
  /** A pause inside kept speech longer than this (seconds) is tightened. */
  maxPause: number
  /** What a tightened pause becomes (seconds). */
  keepPause: number
  /** Jump cuts alternate between a wide and a slightly tighter frame, so the cut doesn't jump. */
  punchOnCuts: boolean
}

export interface EditRecipe {
  id: EditRecipeId
  label: string
  /** One line for the picker. */
  detail: string
  pacing: EditPacing
  /** How many of the planned half-screen cards start on (in the order they play). */
  cards: number
  /** How many of the planned text pop-ups start on. */
  popups: number
  /** Look extras switched on by default (the engine draws them). */
  extras: LookExtraId[]
}

export const EDIT_RECIPE_IDS = ['clean', 'fast', 'story', 'tutorial'] as const
export type EditRecipeId = (typeof EDIT_RECIPE_IDS)[number]
export const DEFAULT_EDIT_RECIPE: EditRecipeId = 'clean'

export const EDIT_RECIPES: readonly EditRecipe[] = [
  {
    id: 'clean', label: 'Clean talking head', detail: 'Natural pauses, a few pop-ups for numbers and key words. The edit as it has always been.',
    pacing: { maxPause: 0.6, keepPause: 0.25, punchOnCuts: false }, cards: 0, popups: 5, extras: []
  },
  {
    id: 'fast', label: 'Fast explainer', detail: 'Tight cuts that punch in, more pop-ups and half-screen cards for lists and numbers.',
    pacing: { maxPause: 0.35, keepPause: 0.12, punchOnCuts: true }, cards: 3, popups: 6, extras: ['keyword_pill', 'progress_bar']
  },
  {
    id: 'story', label: 'Story', detail: 'Slower, with room to breathe. Few pop-ups, one card at most, and accent words in the captions.',
    pacing: { maxPause: 0.9, keepPause: 0.35, punchOnCuts: false }, cards: 1, popups: 2, extras: ['accent_words']
  },
  {
    id: 'tutorial', label: 'Tutorial', detail: 'Steady pace for showing how. Cards for steps, labels on screen recordings and a progress bar.',
    pacing: { maxPause: 0.5, keepPause: 0.2, punchOnCuts: false }, cards: 3, popups: 4, extras: ['broll_tags', 'progress_bar']
  }
]

export function isEditRecipeId(value: unknown): value is EditRecipeId {
  return typeof value === 'string' && (EDIT_RECIPE_IDS as readonly string[]).includes(value)
}

export function editRecipe(id: unknown): EditRecipe {
  return EDIT_RECIPES.find((recipe) => recipe.id === id) ?? EDIT_RECIPES[0]
}

/** A recipe's default extras, as a fresh list. */
export function recipeExtras(id: EditRecipeId): LookExtraId[] {
  return parseLookExtras(editRecipe(id).extras)
}

/** The pacing as the engine reads it (snake case, seconds). */
export function pacingForEngine(pacing: EditPacing): { max_gap: number; short_pause: number; punch_on_cuts: boolean } {
  return { max_gap: pacing.maxPause, short_pause: pacing.keepPause, punch_on_cuts: pacing.punchOnCuts }
}
