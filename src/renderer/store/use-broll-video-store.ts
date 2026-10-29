import { create } from 'zustand'
import { defaultBrollVideoLook, type BrollVideoLook, type BrollVideoStatus, type BrollVoiceKind } from '../../shared/broll-video'
import { getApi } from '../lib/ipc'

/** The voiceover the member chose or recorded (main remembers it; the path is only shown back). */
export interface ChosenVoiceover { path: string; name: string; seconds: number; recorded?: boolean }

export interface BrollVideoDraft {
  title: string
  voiceKind: BrollVoiceKind
  voiceover: ChosenVoiceover | null
  script: string
  presetVoice: string
  /** The whole library, or only the picked items and tags. */
  all: boolean
  itemIds: string[]
  tags: string[]
  fillWithAi: boolean
  look: BrollVideoLook
  voiceCleanup: boolean
  musicTrack: string | null
  ctaId: string | null
  update: (patch: Partial<Omit<BrollVideoDraft, 'update' | 'setLook'>>) => void
  setLook: (patch: Partial<BrollVideoLook>) => void
}

/** The draft survives navigating away (to the B-roll library to add clips, or Settings for a key). */
export const useBrollVideoDraft = create<BrollVideoDraft>((set) => ({
  title: '', voiceKind: 'recording', voiceover: null, script: '', presetVoice: 'Brian',
  all: true, itemIds: [], tags: [], fillWithAi: false, look: defaultBrollVideoLook(),
  voiceCleanup: true, musicTrack: null, ctaId: null,
  update: (patch) => set(patch),
  setLook: (patch) => set((state) => ({ look: { ...state.look, ...patch } }))
}))

/** The request main checks (src/shared/broll-video.ts parseBrollVideoRequest). */
export function brollVideoRequest(draft: Omit<BrollVideoDraft, 'update' | 'setLook'>): Record<string, unknown> {
  const voice = draft.voiceKind === 'script' ? { kind: 'script', script: draft.script, voice: draft.presetVoice }
    : draft.voiceKind === 'both' ? { kind: 'both', path: draft.voiceover?.path ?? '', script: draft.script }
      : { kind: 'recording', path: draft.voiceover?.path ?? '' }
  return {
    title: draft.title, voice, broll: draft.all ? { all: true } : { all: false, itemIds: draft.itemIds, tags: draft.tags },
    fillWithAi: draft.fillWithAi, look: draft.look,
    audio: { voiceCleanup: draft.voiceCleanup, ...(draft.musicTrack ? { music: true, musicTrack: draft.musicTrack } : {}) },
    ctaId: draft.ctaId
  }
}

let subscribed = false
/** The video being made (or the last one), mirrored from main. */
export const useBrollVideoStatus = create<{ status: BrollVideoStatus | null; load: () => Promise<void>; set: (status: BrollVideoStatus | null) => void }>((set) => ({
  status: null,
  set: (status) => set({ status }),
  load: async () => {
    const api = getApi()
    if (!api.brollVideo) return
    if (!subscribed) { subscribed = true; api.brollVideo.onStatus((status) => set({ status })) }
    set({ status: await api.brollVideo.status() })
  }
}))
