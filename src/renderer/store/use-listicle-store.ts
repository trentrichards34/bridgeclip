import { create } from 'zustand'
import { LISTICLE_DEFAULT_COLOR, LISTICLE_MIN_ITEMS, type ListicleBox, type ListicleItem } from '../../shared/listicle'

/** Avatar Studio's two sides: avatar videos, or Top lists (no avatar needed). */
export type StudioMode = 'avatar' | 'listicle'

export const useStudioMode = create<{ mode: StudioMode; setMode: (mode: StudioMode) => void }>((set) => ({
  mode: 'avatar',
  setMode: (mode) => set({ mode })
}))

export type ListicleVoiceChoice = 'preset' | 'avatar' | 'recorded'

export interface ListicleDraft {
  title: string
  accent: string
  intro: string
  items: ListicleItem[]
  header: string
  /** True once the member typed their own header (a brand change no longer fills it). */
  headerEdited: boolean
  handle: string
  handleEdited: boolean
  accentColor: string
  brandIdentityId: string | null
  voiceChoice: ListicleVoiceChoice
  presetVoice: string
  avatarId: string | null
  /** In-app recordings by part ('intro', '1'..'N'). */
  recordings: Record<string, string>
  captions: boolean
  ctaId: string | null
  update: (patch: Partial<Omit<ListicleDraft, 'update' | 'updateItem' | 'setBox'>>) => void
  updateItem: (index: number, patch: Partial<ListicleItem>) => void
  setBox: (index: number, box: ListicleBox | null) => void
}

export const emptyItem = (): ListicleItem => ({ name: '', line: '', imagePath: null, box: null, script: '', accent: '' })

/** The Top list draft survives navigating away (e.g. to Settings to add a key). */
export const useListicleDraft = create<ListicleDraft>((set) => ({
  title: '', accent: '', intro: '', items: Array.from({ length: LISTICLE_MIN_ITEMS }, emptyItem),
  header: '', headerEdited: false, handle: '', handleEdited: false, accentColor: LISTICLE_DEFAULT_COLOR, brandIdentityId: null,
  voiceChoice: 'preset', presetVoice: 'Brian', avatarId: null, recordings: {}, captions: true, ctaId: null,
  update: (patch) => set(patch),
  updateItem: (index, patch) => set((state) => ({ items: state.items.map((item, i) => i === index ? { ...item, ...patch } : item) })),
  setBox: (index, box) => set((state) => ({ items: state.items.map((item, i) => i === index ? { ...item, box } : item) }))
}))
