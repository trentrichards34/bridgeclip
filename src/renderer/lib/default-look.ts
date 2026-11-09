import { useEffect } from 'react'
import type { BrandLook } from '../../shared/brand-kit'
import type { HeadlineLook } from '../../shared/headline-look'
import type { BrandIdentity } from '../../shared/remix'
import { useBrands } from '../store/use-brand-store'
import { useMemberPrefsStore } from '../store/use-member-prefs-store'

/** The default brand look (Brand look → Make default), or null for none (or a deleted one). */
export function defaultBrand(brands: readonly BrandIdentity[] = useBrands.getState().brands, id: string | null = useMemberPrefsStore.getState().defaultBrandId): BrandIdentity | null {
  return id ? brands.find((brand) => brand.id === id) ?? null : null
}

export function useDefaultBrand(): BrandIdentity | null {
  const id = useMemberPrefsStore((state) => state.defaultBrandId)
  const brands = useBrands((state) => state.brands)
  return defaultBrand(brands, id)
}

/** A brand look's hook text look (its color on the tool's own look when it saved no hook look). */
export function brandHeadlineLook(look: BrandLook | undefined, base: HeadlineLook): HeadlineLook {
  if (look?.headlineLook) return { ...look.headlineLook, color: look.color ?? look.headlineLook.color }
  return look?.color ? { ...base, color: look.color } : base
}

/** What each tool's look was last set to from the default (JSON), for this session. */
const seeded = new Map<string, string>()

/** For tests: forget what was seeded. */
export function resetDefaultLookSeeds(): void { seeded.clear() }

/**
 * One step of seeding a tool's look from the default: apply the default's look
 * when the tool's look is still what the app or the default last set (the
 * member hasn't changed it for this video). Returns true when it applied.
 */
export function seedFromDefault<T>(tool: string, current: T, initial: T, target: T, apply: (value: T) => void): boolean {
  const now = JSON.stringify(current)
  const base = seeded.get(tool) ?? JSON.stringify(initial)
  // Changed on this tool: the member's choice for this video stays.
  if (now !== base) return false
  const json = JSON.stringify(target)
  seeded.set(tool, json)
  if (json === now) return false
  apply(target)
  return true
}

/**
 * Starts a tool's look (Edit my recording, Avatar Studio, B-roll video…) from
 * the default brand look, and follows the default when it changes, until the
 * member changes the look on that tool. Picking another look there is for
 * that video only: it never changes the default.
 */
export function useDefaultLookSeed<T>(tool: string, read: () => T, initial: T, fromBrand: (brand: BrandIdentity | null) => T, apply: (value: T) => void): void {
  const prefsLoaded = useMemberPrefsStore((state) => state.loaded)
  const listed = useBrands((state) => state.listed)
  const brand = useDefaultBrand()
  const key = brand ? `${brand.id}:${brand.updatedAt}` : 'none'
  useEffect(() => { void useBrands.getState().load() }, [])
  useEffect(() => {
    if (!prefsLoaded || !listed) return
    seedFromDefault(tool, read(), initial, fromBrand(brand), apply)
    // Only a change of the default (or the first load) seeds again; read/apply/fromBrand are stable in meaning.
  }, [tool, prefsLoaded, listed, key])
}
