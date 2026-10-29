import { create } from 'zustand'
import type { FilmIdea } from '../../shared/edit-recording'
import { localDay } from '../../shared/daily-plan'

/**
 * Today's 3: the day's suggested ideas and the reaction link the member pasted
 * (kept for the day on this computer), whether the card is folded, and the
 * idea handed to Edit my recording when a talking-head item is started.
 */
interface DailyPlanState {
  day: string
  ideas: FilmIdea[]
  reactionLink: string
  folded: boolean
  /** The idea Edit my recording opens its recorder with (taken once). */
  pendingIdea: FilmIdea | null
  setIdeas: (ideas: FilmIdea[]) => void
  setReactionLink: (link: string) => void
  setFolded: (folded: boolean) => void
  handOff: (idea: FilmIdea | null) => void
  takePendingIdea: () => FilmIdea | null
}

const KEY = 'creatorclips.todays-plan'

interface Saved { day: string; ideas: FilmIdea[]; reactionLink: string; folded: boolean }

function read(): Saved {
  const today = localDay(new Date())
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null
    if (raw && typeof raw === 'object') {
      const folded = raw.folded !== false
      if (raw.day === today) return { day: today, ideas: Array.isArray(raw.ideas) ? raw.ideas.slice(0, 10) as FilmIdea[] : [], reactionLink: typeof raw.reactionLink === 'string' ? raw.reactionLink.slice(0, 2000) : '', folded }
      return { day: today, ideas: [], reactionLink: '', folded }
    }
  } catch { /* storage unavailable: start fresh */ }
  return { day: today, ideas: [], reactionLink: '', folded: true }
}

function save(state: Saved): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* storage unavailable: kept for this session only */ }
}

export const useDailyPlan = create<DailyPlanState>((set, get) => {
  const persist = (patch: Partial<Saved>): void => {
    const current = get()
    const today = localDay(new Date())
    // A new day starts with no ideas or link.
    const base = current.day === today ? current : { ...current, day: today, ideas: [], reactionLink: '' }
    const next = { day: today, ideas: base.ideas, reactionLink: base.reactionLink, folded: base.folded, ...patch }
    save(next)
    set(next)
  }
  return {
    ...read(),
    pendingIdea: null,
    setIdeas: (ideas) => persist({ ideas }),
    setReactionLink: (reactionLink) => persist({ reactionLink }),
    setFolded: (folded) => persist({ folded }),
    handOff: (pendingIdea) => set({ pendingIdea }),
    takePendingIdea: () => { const idea = get().pendingIdea; if (idea) set({ pendingIdea: null }); return idea }
  }
})
