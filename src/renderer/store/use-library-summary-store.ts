import { create } from 'zustand'
import { getApi } from '../lib/ipc'
import { errorMessage } from '../lib/utils'
import type { LibrarySummary } from '../../shared/library-summary'

/**
 * The Library at a glance (clip counts by status and a light row per clip),
 * shared by the Library page and the sidebar's "N refining" badge. One request
 * at a time; a refresh asked for meanwhile runs once the current one ends.
 */
interface LibrarySummaryState {
  summary: LibrarySummary | null
  error: string | null
  loading: boolean
  refresh: () => Promise<void>
}

let pending: Promise<void> | null = null
let again = false

export const useLibrarySummaryStore = create<LibrarySummaryState>((set) => ({
  summary: null,
  error: null,
  loading: false,
  refresh: async () => {
    if (pending) { again = true; return pending }
    const api = getApi().history
    // An older main process (before a restart) has no summary: the Library still works without it.
    if (typeof api?.summary !== 'function') return
    const run = async (): Promise<void> => {
      set({ loading: true })
      try {
        do {
          again = false
          try {
            set({ summary: await api.summary(), error: null })
          } catch (cause) {
            set({ error: errorMessage(cause, 'Could not count your clips.') })
          }
        } while (again)
      } finally {
        set({ loading: false })
        pending = null
      }
    }
    pending = run()
    return pending
  }
}))
