/**
 * Custom scenes on Edit my recording (shared/custom-scenes.ts says what they are): the reel is cut into stretches of
 * about 15 s, one plan call picks the hero object, the motif and which stretches become scenes, and each scene is ONE
 * custom graphic (frame 'stage' or 'visual', 15-20 s) through the custom graphics producer: written, rendered in the
 * sandbox, checked, graded and revised. edit-custom-graphics.ts runs them with the pop-ups and puts the kept ones in.
 */
import {
  customGeometry, customLook, stressedWords, type CustomTheme, type SaidIndex, type VisualWorld, type WriterBrief
} from '../shared/custom-graphics'
import {
  DEFAULT_SCENE_AMOUNT, fallbackScenePlan, onScreen, parseScenePlan, sceneBriefLines, sceneEligible, scenePlanSystemPrompt, scenePlanUserPrompt, sceneStretches, sceneTarget, sectionText,
  type SceneAmount, type SceneFrame, type ScenePlan, type SceneStretch
} from '../shared/custom-scenes'
import { CUSTOM_SECTION_MAX_MS } from '../shared/explainer-layout'
import type { TimedWord } from '../shared/motion-graphics'
import type { ModelCall } from './custom-graphics'
import { logger } from './logger'

/** A scene cut short by a filmed screen is kept when this much is left. */
export const SCENE_MIN_KEPT_MS = 7000

/** A reel word with its plan index and whether it was said over a filmed screen. */
export type SceneWord = TimedWord & { index: number; screen?: boolean }

/** One scene to design: its stretch, the plan word it starts on and how long it lasts on the reel. */
export interface PlannedScene {
  stretch: SceneStretch
  word: number
  atMs: number
  durationMs: number
  frame: SceneFrame
  /** Its place among the scenes (0-based). */
  order: number
  /** Over a filmed screen: the screen stays in the card under it (the card 'screen'). */
  screen?: boolean
  /** Back to back with the scene before / after: it hands over directly (no exit, no empty stage between). */
  follows?: boolean
  followed?: boolean
}

/** Scenes this close hand over directly: the first runs to the second's start (a real run showed ~1 s of empty stage between two). */
export const SCENE_HANDOVER_MS = 1500

/** The scene plan call (one per video). Null plan when the answer can't be used (the fallback plan is used instead). */
export async function planScenes(input: { model: string; theme: CustomTheme; stretches: readonly SceneStretch[]; said: SaidIndex; note?: string; amount?: SceneAmount }, call: ModelCall, signal?: AbortSignal): Promise<{ plan: ScenePlan | null; costUsd: number }> {
  const amount = input.amount ?? DEFAULT_SCENE_AMOUNT
  const n = input.stretches.length
  const target = n ? sceneTarget(amount, input.stretches[n - 1].endMs - input.stretches[0].startMs, input.stretches.filter((s) => sceneEligible(s, n)).length) : null
  try {
    const reply = await call({ model: input.model, system: scenePlanSystemPrompt(), user: scenePlanUserPrompt(input.stretches, input.theme, input.note, target), maxTokens: 8000, temperature: 0.4, purpose: 'scenes', signal })
    const plan = parseScenePlan(reply.text, input.stretches, input.said, amount)
    if (!plan) logger.info('scenes.plan.unreadable', { chars: reply.text.length })
    return { plan, costUsd: reply.costUsd }
  } catch (error) {
    if (signal?.aborted) throw error
    logger.info('scenes.plan.failed', { message: String((error as Error)?.message ?? error).slice(0, 200) })
    return { plan: null, costUsd: 0 }
  }
}

/** The reel's stretches from its words (`screen`: said over a filmed screen). */
export function reelStretches(words: readonly SceneWord[], endMs: number): SceneStretch[] {
  return sceneStretches(words.map((w) => ({ word: w.word, start_ms: w.start_ms, end_ms: w.end_ms, screen: w.screen === true })), endMs)
}

/** The scenes the plan asks for, on the reel's clock: from a stretch's first word to the next stretch's first word. */
export function plannedScenes(stretches: readonly SceneStretch[], plan: ScenePlan, words: readonly SceneWord[], endMs: number): PlannedScene[] {
  const out: PlannedScene[] = []
  stretches.forEach((s, k) => {
    const own = plan.stretches[k]
    if (!own?.scene || !sceneEligible(s, stretches.length)) return
    const first = words.find((w) => w.start_ms >= s.startMs && w.start_ms < s.endMs)
    if (!first) return
    let next = stretches[k + 1] ? words.find((w) => w.start_ms >= stretches[k + 1].startMs)?.start_ms ?? stretches[k + 1].startMs : endMs
    // A screen stretch: the scene sits on the stage with the screen in the card (never covering it). A stretch with only a
    // little screen in it ends before the screen comes in (the screen stays full frame).
    const overScreen = onScreen(s)
    const screen = overScreen ? undefined : words.find((w) => w.screen && w.start_ms > first.start_ms && w.start_ms < next)
    if (screen) next = Math.min(next, screen.start_ms - 300)
    // It ends a little before the next stretch's first word (the move back to the face lands before it is said).
    const durationMs = Math.round(Math.min(CUSTOM_SECTION_MAX_MS, next - first.start_ms - 150, endMs - first.start_ms))
    if (durationMs < SCENE_MIN_KEPT_MS) return
    out.push({ stretch: s, word: first.index, atMs: first.start_ms, durationMs, frame: overScreen ? 'stage' : own.frame, order: 0, ...(overScreen ? { screen: true } : {}) })
  })
  // Back to back: the first runs exactly to the second's start (never overlapping, never an empty stage between).
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i], b = out[i + 1]
    const gap = b.atMs - (a.atMs + a.durationMs)
    if (gap < SCENE_HANDOVER_MS && b.atMs - a.atMs <= CUSTOM_SECTION_MAX_MS) {
      out[i] = { ...a, durationMs: b.atMs - a.atMs, followed: true }
      out[i + 1] = { ...b, follows: true }
    }
  }
  return out.map((s, i) => ({ ...s, order: i }))
}

/** The plan to use: the model's, else ours (every other eligible stretch; Light and Standard: their count). */
export const usablePlan = (plan: ScenePlan | null, stretches: readonly SceneStretch[], amount: SceneAmount = DEFAULT_SCENE_AMOUNT): ScenePlan => plan ?? fallbackScenePlan(stretches, amount)

/** The plan's hero object and motif as the video's world note (what the pop-ups and the beat sheet use). */
export function planWorld(plan: ScenePlan): VisualWorld | null {
  if (!plan.hero || plan.hero.length < 8) return null
  // The motif as one short element (cut at a word), whole in the style line.
  const short = plan.motif.length <= 48 ? plan.motif : plan.motif.slice(0, 48).replace(/\s+\S*$/, '')
  return { idea: plan.hero.slice(0, 220), elements: short ? [short] : [], style: plan.motif ? `Motif: ${plan.motif}`.slice(0, 160) : '', accent: null }
}

/** The writer's brief for one scene. */
export function sceneBrief(input: { scene: PlannedScene; scenes: number; count: number; plan: ScenePlan; words: readonly SceneWord[]; theme: CustomTheme; brandColor?: string | null; font?: string | null; logo?: boolean; world?: VisualWorld | null }): WriterBrief {
  const { scene, words } = input
  const inside = words.filter((w) => w.start_ms >= scene.atMs - 50 && w.start_ms < scene.atMs + scene.durationMs)
  const cues = inside.map((w) => ({ word: w.word, at: Math.round((w.start_ms - scene.atMs) / 10) / 100 }))
  const before = words.filter((w) => w.start_ms >= scene.atMs - 9000 && w.start_ms < scene.atMs).map((w) => w.word).join(' ')
  const after = words.filter((w) => w.start_ms >= scene.atMs + scene.durationMs && w.start_ms < scene.atMs + scene.durationMs + 5000).map((w) => w.word).join(' ')
  const geometry = customGeometry(scene.frame, {})
  const look = customLook({ kind: scene.frame, brandColor: input.brandColor, font: input.font, logo: input.logo, theme: input.theme })
  const lines = sceneBriefLines({ stretch: scene.stretch, count: input.count, scenes: input.scenes, order: scene.order, frame: scene.frame, plan: input.plan, theme: input.theme, durationMs: scene.durationMs, screen: scene.screen === true, follows: scene.follows === true, followed: scene.followed === true })
  return {
    kind: 'process', frame: scene.frame, durationMs: scene.durationMs, geometry, look, cues, before, after, planned: '',
    // A scene builds on more words than a pop-up: every stressed word of the stretch (stressedWords keeps one every ~0.6 s).
    // (The scene's lines carry the hero object and the motif: no world line repeated.)
    stressed: stressedWords(cues, scene.durationMs), scene: lines
  }
}

export { sectionText }
