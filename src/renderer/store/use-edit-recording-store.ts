import { create } from 'zustand'
import { DEFAULT_EDIT_LOOK, type EditDecisions, type EditLook } from '../../shared/edit-recording'
import { DEFAULT_EDIT_RECIPE, type EditRecipeId } from '../../shared/edit-recipes'

/**
 * Edit my recording's choices, kept while the member visits other pages (the
 * pages unmount when they leave): the brand and look, and the review's cuts,
 * hook, pop-ups and sounds for the run being reviewed (by its run id).
 */
interface EditRecordingState {
  brandId: string | null
  look: EditLook
  /** The edit style last picked, for the next review. */
  recipe: EditRecipeId
  /** The review's choices for one run; another run's choices are dropped when a new one is saved. */
  review: { runId: string; decisions: EditDecisions } | null
  setBrand: (brandId: string | null, look: EditLook) => void
  setLook: (look: EditLook) => void
  setRecipe: (recipe: EditRecipeId) => void
  saveReview: (runId: string, decisions: EditDecisions) => void
  reviewFor: (runId: string) => EditDecisions | null
}

export const useEditRecordingStore = create<EditRecordingState>((set, get) => ({
  brandId: null,
  look: DEFAULT_EDIT_LOOK,
  recipe: DEFAULT_EDIT_RECIPE,
  review: null,
  setBrand: (brandId, look) => set({ brandId, look }),
  setLook: (look) => set({ look }),
  setRecipe: (recipe) => set({ recipe }),
  saveReview: (runId, decisions) => set({ review: { runId, decisions } }),
  reviewFor: (runId) => {
    const review = get().review
    return review && review.runId === runId ? review.decisions : null
  }
}))
