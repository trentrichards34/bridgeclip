import { create } from 'zustand'
import { DEFAULT_BROLL_AI_SETTINGS, type BrollAiSettings, type BrollIndexProgress, type BrollLibraryView } from '../../shared/broll-library'
import { getApi } from '../lib/ipc'
import { errorMessage } from '../lib/utils'

/**
 * My B-roll library in the renderer: the page, Create's and Remix's "B-roll from" choice read it. Main sends
 * "changed" after every change (adding, preparing, indexing, AI shots) and the indexing progress.
 */
interface BrollLibraryState {
  view: BrollLibraryView | null
  loading: boolean
  error: string | null
  progress: BrollIndexProgress | null
  load: () => Promise<void>
  setView: (view: BrollLibraryView) => void
  setAi: (ai: BrollAiSettings) => void
}

let subscribed = false
let reloading: Promise<void> | null = null
let dirty = false

export const useBrollLibrary = create<BrollLibraryState>((set, get) => ({
  view: null,
  loading: false,
  error: null,
  progress: null,
  load: () => {
    const api = getApi()
    if (!subscribed && api.brollLibrary) {
      subscribed = true
      api.brollLibrary.onChanged(() => { void get().load() })
      api.brollLibrary.onProgress((progress) => set({ progress }))
    }
    // One read at a time; a change during it reads once more when it's done.
    if (reloading) { dirty = true; return reloading }
    set({ loading: true })
    reloading = (async () => {
      try {
        do {
          dirty = false
          try {
            const view = await api.brollLibrary.view()
            set({ view, error: null, progress: view.indexing ?? get().progress })
          } catch (error) {
            set({ error: errorMessage(error) })
          }
        } while (dirty)
      } finally {
        set({ loading: false })
        reloading = null
      }
    })()
    return reloading
  },
  setView: (view) => set({ view }),
  setAi: (ai) => set((state) => ({ view: state.view ? { ...state.view, ai } : state.view }))
}))

/** Shots Create and Remix can use, and the AI settings (defaults until the library is read). */
export function useBrollContext(): { usableShots: number; ai: BrollAiSettings; loaded: boolean } {
  const view = useBrollLibrary((state) => state.view)
  return { usableShots: view?.usableShots ?? 0, ai: view?.ai ?? DEFAULT_BROLL_AI_SETTINGS, loaded: view !== null }
}
