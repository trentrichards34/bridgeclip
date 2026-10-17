import { create } from 'zustand'
import type { BrandIdentity } from '../../shared/remix'
import { getApi } from '../lib/ipc'
import { errorMessage } from '../lib/utils'

interface BrandState {
  brands: BrandIdentity[]
  loaded: boolean
  error: string | null
  /** Read the list from main (again, with force). */
  load: (force?: boolean) => Promise<void>
  /** A list main just returned (after a save or delete). */
  setBrands: (brands: BrandIdentity[]) => void
}

/** The member's brand identities, shared by Create, Remix and Avatar Studio. */
export const useBrands = create<BrandState>((set, get) => ({
  brands: [],
  loaded: false,
  error: null,
  load: async (force = false) => {
    if (get().loaded && !force) return
    try { set({ brands: await getApi().brandIdentities.list(), loaded: true, error: null }) }
    catch (err) { set({ error: errorMessage(err), loaded: true }) }
  },
  setBrands: (brands) => set({ brands, loaded: true, error: null })
}))
