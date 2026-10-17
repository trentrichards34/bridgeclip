import { create } from 'zustand'
import { pickStyle, type AppPrefsUpdate, type CreateStyle, type MemberPrefs, type RemixFormStyle, type StyleKind } from '../../shared/member-prefs'
import { DEFAULT_PROFILE, type CreatorProfile } from '../../shared/onboarding'
import { getApi } from '../lib/ipc'
import { useDraftStore } from './use-draft-store'
import { useRemixForm } from './use-remix-form-store'

/**
 * The member's setup that sticks: the last Create and Remix style (saved in
 * the main process as they change, applied again at the next start), saved
 * styles, the support link and the notifications switch.
 */
interface MemberPrefsState {
  loaded: boolean
  presets: MemberPrefs['presets']
  supportLink: string
  notifyOnFinish: boolean
  setupChecklistDismissed: boolean
  sampleVideoLink: string
  /** What the member wants to make and where they post; 'new' opens the guided setup. */
  profile: CreatorProfile
  /** Load once at startup: applies the remembered styles, then keeps them saved. */
  load: () => Promise<void>
  savePreset: (kind: StyleKind, name: string) => Promise<void>
  applyPreset: (kind: StyleKind, id: string) => void
  renamePreset: (kind: StyleKind, id: string, name: string) => Promise<void>
  deletePreset: (kind: StyleKind, id: string) => Promise<void>
  saveApp: (update: AppPrefsUpdate) => Promise<void>
  saveProfile: (update: Partial<CreatorProfile>) => Promise<void>
}

/** The current style of a form, in the saved shape. */
export function currentStyle(kind: StyleKind): Partial<CreateStyle> | Partial<RemixFormStyle> {
  return kind === 'create' ? pickStyle('create', useDraftStore.getState()) : pickStyle('remix', useRemixForm.getState())
}

function applyStyle(kind: StyleKind, style: Partial<CreateStyle> | Partial<RemixFormStyle>): void {
  if (kind === 'create') useDraftStore.getState().update(style as Partial<CreateStyle>)
  else useRemixForm.getState().applyStyle(style as Partial<RemixFormStyle>)
}

const SAVE_DELAY_MS = 400
let persisting = false

/** Save each form's style a moment after it changes (only style fields; never links, files or names). */
function startPersisting(): void {
  if (persisting) return
  persisting = true
  for (const kind of ['create', 'remix'] as const) {
    let last = JSON.stringify(currentStyle(kind))
    let timer: ReturnType<typeof setTimeout> | null = null
    const check = (): void => {
      const style = currentStyle(kind)
      const json = JSON.stringify(style)
      if (json === last) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        last = json
        void getApi().prefs.saveLast(kind, style).catch(() => { last = '' })
      }, SAVE_DELAY_MS)
    }
    if (kind === 'create') useDraftStore.subscribe(check)
    else useRemixForm.subscribe(check)
  }
}

let loading: Promise<void> | null = null

export const useMemberPrefsStore = create<MemberPrefsState>((set) => {
  const take = (prefs: MemberPrefs): void => set({ loaded: true, presets: prefs.presets, supportLink: prefs.supportLink, notifyOnFinish: prefs.notifyOnFinish, setupChecklistDismissed: prefs.setupChecklistDismissed, sampleVideoLink: prefs.sampleVideoLink, profile: prefs.profile ?? { ...DEFAULT_PROFILE, onboarding: 'skipped' } })
  return {
    loaded: false,
    presets: { create: [], remix: [] },
    supportLink: '',
    notifyOnFinish: true,
    setupChecklistDismissed: false,
    sampleVideoLink: '',
    profile: { ...DEFAULT_PROFILE },
    load: () => {
      // Optional: a renderer hot-reloaded over an older preload has no prefs bridge.
      if (!getApi().prefs) return Promise.resolve()
      loading ??= getApi().prefs.load().then((prefs) => {
        applyStyle('create', prefs.create)
        applyStyle('remix', prefs.remix)
        take(prefs)
        startPersisting()
      }).catch((error) => { loading = null; throw error })
      return loading
    },
    savePreset: async (kind, name) => take(await getApi().prefs.savePreset(kind, name, currentStyle(kind))),
    applyPreset: (kind, id) => {
      const preset = (useMemberPrefsStore.getState().presets[kind] as { id: string; style: object }[]).find((item) => item.id === id)
      if (preset) applyStyle(kind, preset.style)
    },
    renamePreset: async (kind, id, name) => take(await getApi().prefs.renamePreset(kind, id, name)),
    deletePreset: async (kind, id) => take(await getApi().prefs.deletePreset(kind, id)),
    saveApp: async (update) => take(await getApi().prefs.saveApp(update)),
    saveProfile: async (update) => take(await getApi().prefs.saveProfile(update))
  }
})
