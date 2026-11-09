import { create } from 'zustand'
import type { OpenRouterBalance, SpendOverview } from '../../shared/spending'
import { getApi } from '../lib/ipc'
import { errorMessage } from '../lib/utils'

interface SpendingStore {
  overview: SpendOverview | null
  loadError: string | null
  balance: OpenRouterBalance | null
  balanceLoading: boolean
  balanceError: string | null
  load: () => Promise<void>
  /** Cached a few minutes in the main process unless `force`. */
  refreshBalance: (force?: boolean) => Promise<void>
  setLimit: (value: string) => Promise<void>
}

/** Settings → Spending and the app-wide spending notices share this. */
export const useSpendingStore = create<SpendingStore>((set) => ({
  overview: null,
  loadError: null,
  balance: null,
  balanceLoading: false,
  balanceError: null,
  load: async () => {
    // Optional: a renderer hot-reloaded over an older preload has no spending bridge.
    const spending = getApi().spending
    if (!spending) return
    try {
      set({ overview: await spending.overview(), loadError: null })
    } catch (error) {
      set({ loadError: errorMessage(error, 'Could not read the spending record.') })
    }
  },
  refreshBalance: async (force = false) => {
    const spending = getApi().spending
    if (!spending) return
    set({ balanceLoading: true })
    try {
      set({ balance: await spending.balance(force), balanceError: null })
    } catch (error) {
      set({ balanceError: errorMessage(error, 'Could not check the OpenRouter balance.') })
    } finally {
      set({ balanceLoading: false })
    }
  },
  setLimit: async (value) => {
    const overview = await getApi().spending.setLimit(value)
    set({ overview, loadError: null })
  }
}))
