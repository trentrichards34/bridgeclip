import { create } from 'zustand'
import type { VideoGoalId } from '../../shared/onboarding'
import { useRemixForm } from './use-remix-form-store'

/**
 * The guided setup ("Set up your CreatorClips profile") and the first-run
 * guide: a short how-to card shown on the page where the member makes their
 * first video of a kind, until they close it.
 */
interface OnboardingState {
  /** The guided setup is open (it also opens on its own for a new profile). */
  open: boolean
  setOpen: (open: boolean) => void
  /** The first-run guide being followed, if any. */
  guide: VideoGoalId | null
  setGuide: (guide: VideoGoalId | null) => void
}

export const useOnboarding = create<OnboardingState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  guide: null,
  setGuide: (guide) => set({ guide })
}))

/** The page each kind of video is made on. */
export function goalPage(goal: VideoGoalId): 'clip' | 'remix' | 'avatar' {
  return goal === 'clips' ? 'clip' : goal === 'avatar-videos' ? 'avatar' : 'remix'
}

/**
 * Start making a first video of this kind: set up the form for it (Remix's
 * format and presenter), show its guide, and say which page to open.
 */
export function startGoal(goal: VideoGoalId): 'clip' | 'remix' | 'avatar' {
  const remix = useRemixForm.getState()
  if (goal === 'ai-reactions') remix.applyStyle({ format: remix.format === 'image' ? 'commentary' : remix.format, host: remix.host === 'camera' || remix.host === 'lipsync' ? 'still' : remix.host })
  // On camera starts with Pause & react: the simplest way to film a reaction.
  if (goal === 'camera-reactions') remix.applyStyle({ format: 'pause_react', host: 'camera' })
  if (goal === 'article') remix.applyStyle({ format: 'image' })
  useOnboarding.getState().setGuide(goal)
  return goalPage(goal)
}
