import { create } from 'zustand'
import type { BrandIdentity } from '../../shared/remix'
import { getApi } from '../lib/ipc'
import { errorMessage } from '../lib/utils'
import { useDraftStore } from './use-draft-store'
import { useRemixForm } from './use-remix-form-store'

interface BrandState {
  brands: BrandIdentity[]
  loaded: boolean
  /** True once main has returned the list: only then is a missing id known to be deleted. */
  listed: boolean
  error: string | null
  /** Read the list from main (again, with force). */
  load: (force?: boolean) => Promise<void>
  /** A list main just returned (after a save or delete). */
  setBrands: (brands: BrandIdentity[]) => void
  /**
   * A brand just added from somewhere other than the page's brand picker (the
   * style board): the picker on screen picks it, the same way choosing it there does.
   */
  pickRequest: { id: string; at: number } | null
  requestPick: (id: string) => void
  clearPick: () => void
}

/** The member's brand identities, shared by Create, Remix and Avatar Studio. */
export const useBrands = create<BrandState>((set, get) => ({
  brands: [],
  loaded: false,
  listed: false,
  error: null,
  load: async (force = false) => {
    if (get().loaded && !force) return
    try { set({ brands: await getApi().brandIdentities.list(), loaded: true, listed: true, error: null }) }
    catch (err) { set({ error: errorMessage(err), loaded: true }) }
  },
  setBrands: (brands) => set({ brands, loaded: true, listed: true, error: null }),
  pickRequest: null,
  requestPick: (id) => set({ pickRequest: { id, at: Date.now() } }),
  clearPick: () => set({ pickRequest: null })
}))

/** How long a pick request waits for a brand picker to take it (none on screen: it lapses). */
export const PICK_REQUEST_MS = 3000

/** An id that a successfully read list no longer has (the brand was deleted). */
export function isStaleBrandId(id: string | null | undefined, state: Pick<BrandState, 'brands' | 'listed'> = useBrands.getState()): boolean {
  return Boolean(id) && state.listed && !state.brands.some((brand) => brand.id === id)
}

/** Create's draft and the Remix form drop a deleted brand (and its handle), so starting never fails on it. */
export function pruneStaleBrands(): void {
  const draft = useDraftStore.getState()
  if (isStaleBrandId(draft.brandIdentityId)) draft.update({ brandIdentityId: null, showHandle: false })
  const remix = useRemixForm.getState()
  if (isStaleBrandId(remix.brandIdentityId)) remix.update({ brandIdentityId: null, showHandle: false })
}

useBrands.subscribe(pruneStaleBrands)
useDraftStore.subscribe((state, before) => { if (state.brandIdentityId !== before.brandIdentityId) pruneStaleBrands() })
useRemixForm.subscribe((state, before) => { if (state.brandIdentityId !== before.brandIdentityId) pruneStaleBrands() })
