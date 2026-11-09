import { create } from 'zustand'

interface ShellState {
  /** Text searched from the top bar, waiting for the Library page to take it. */
  librarySearch: string
  setLibrarySearch: (query: string) => void
  /** Hands the waiting search to the Library page once, then clears it. */
  takeLibrarySearch: () => string
}

/** State the app frame (sidebar and top bar) hands to pages. */
export const useShellStore = create<ShellState>((set, get) => ({
  librarySearch: '',
  setLibrarySearch: (librarySearch) => set({ librarySearch }),
  takeLibrarySearch: () => {
    const query = get().librarySearch
    if (query) set({ librarySearch: '' })
    return query
  }
}))
