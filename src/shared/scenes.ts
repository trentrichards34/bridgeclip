/**
 * Scenes: layout switching on a vertical clip, so graphics get a real stage
 * instead of floating over the face. Three scenes:
 *
 * - face: the normal full-frame framing (the default: any time without a scene is face).
 * - stage: a backdrop fills the frame, the speaker sits in a card along the
 *   bottom (rounded with a margin, or an "arch": full width with big rounded top
 *   corners, flush with the bottom edge) framed head and shoulders around the
 *   speaker's face, the top half is free for graphics and the captions sit between.
 * - visual: the card is off-screen; the whole frame is backdrop (for a big graphic).
 *
 * The clip editor keeps a clip's scenes in SOURCE time (`CandidateEdit.stage_scenes`,
 * like its graphics), so they stay on their words when the cut changes. Main turns
 * them into the engine's `scenes` request field on the finished clip's clock with
 * `outputScenes` (engine: clip_engine/services/stage_scenes.py mirrors this file).
 */

export type SceneKind = 'face' | 'stage' | 'visual'
/**
 * light: soft light gray. dark: charcoal. brand: a light tint of the brand color.
 * grid: lavender to the brand color (purple without one) with a faint square
 * grid. gradient: a soft brand gradient, no grid. solid: the brand color itself (royal blue without one), for
 * white line-art diagrams.
 */
export type SceneBackdrop = 'light' | 'dark' | 'brand' | 'grid' | 'gradient' | 'solid'
/** The speaker card in a stage scene: a rounded card with a margin, or an arch (full width, big rounded top corners, flush with the bottom). */
export type SceneCard = 'rounded' | 'arch'
export const SCENE_KINDS: readonly SceneKind[] = ['face', 'stage', 'visual']
export const SCENE_BACKDROPS: readonly SceneBackdrop[] = ['light', 'dark', 'brand', 'grid', 'gradient', 'solid']
/** The Solid backdrop's color without a brand color (motion-graphics DIAGRAM_PANEL). */
export const SOLID_BACKDROP_COLOR = '#1F4E9C'
export const SCENE_CARDS: readonly SceneCard[] = ['rounded', 'arch']

export interface StageScene {
  scene: SceneKind
  start_ms: number
  end_ms: number
  /** stage / visual: the backdrop (absent: light). Never set on face. */
  backdrop?: SceneBackdrop
  /** stage only: the speaker card's shape (absent: rounded). */
  card?: SceneCard
  /**
   * stage only: false keeps the head inside the card. Absent: the head breaks out above the card's top edge where it
   * can (the engine checks the cut-out and the framing first; depth_fx frame escape).
   */
  escape?: false
  /** The camera move into this scene (and back out to face). Absent: a subtle zoom. */
  transition?: SceneTransition
}

/**
 * How the clip moves into a scene: `slide` (the card slides and the backdrop fades, nothing more), `zoom` (a quick,
 * subtle push through the cut) or `whip` (a fast sideways whip with motion blur). The cut is in the middle of the
 * move; the scene's sound effect lands there (engine depth_fx.scene_transitions).
 */
export type SceneTransition = 'slide' | 'zoom' | 'whip'
export const SCENE_TRANSITIONS: readonly SceneTransition[] = ['slide', 'zoom', 'whip']
export const DEFAULT_SCENE_TRANSITION: SceneTransition = 'zoom'
export const TRANSITION_LABELS: Record<SceneTransition, string> = { slide: 'Slide', zoom: 'Zoom', whip: 'Whip' }
export const TRANSITION_DETAILS: Record<SceneTransition, string> = {
  slide: 'The card slides in. No camera move.',
  zoom: 'A quick, subtle push through the cut.',
  whip: 'A fast sideways whip with motion blur.'
}
/** Output frames of each camera move (engine depth_fx.TRANSITION_FRAMES). */
export const TRANSITION_FRAMES: Record<SceneTransition, number> = { slide: 0, zoom: 8, whip: 10 }

export const MAX_SCENES = 60
/** The shortest scene the editor makes (a quicker switch reads as a glitch). */
export const MIN_SCENE_MS = 1200
/** A new scene's length. */
export const DEFAULT_SCENE_MS = 3000
/** The card's slide and the backdrop's crossfade, in finished-clip time. */
export const SCENE_TRANSITION_MS = 350
/** Shorter than this after the cut, the engine leaves a scene out. */
export const MIN_RENDER_SCENE_MS = 300

/** Stage geometry as shares of the 9:16 frame (1080 x 1920), the same as the engine's. */
export const STAGE_LAYOUT = {
  /** The card is tall enough for head and shoulders (0.37 cut the head on close selfie footage). */
  cardSide: 40 / 1080, cardBottom: 32 / 1920, cardHeight: 0.42, cardRadius: 48 / 1080,
  /** The arch card's top corners (it is full width, its top where the rounded card's is). */
  archRadius: 120 / 1080,
  /** Graphics own the frame above this line in a stage scene. */
  stageBottom: 0.5,
  /** Caption center in a visual scene. */
  visualCaptionY: 0.82
} as const

export const SCENE_LABELS: Record<SceneKind, string> = { face: 'Face', stage: 'Stage', visual: 'Visual' }
export const SCENE_DETAILS: Record<SceneKind, string> = {
  face: 'The normal full-frame video.',
  stage: 'A backdrop with you in a card at the bottom. The top is free for graphics.',
  visual: 'Backdrop only, so a graphic can fill the frame.'
}
export const BACKDROP_LABELS: Record<SceneBackdrop, string> = { light: 'Light', dark: 'Dark', brand: 'Brand', grid: 'Grid', gradient: 'Gradient', solid: 'Solid' }
export const CARD_LABELS: Record<SceneCard, string> = { rounded: 'Rounded', arch: 'Arch' }

/** The look automatic Stage layouts use: the brand grid with the arch card when there is a brand color, else the grid in the graphics' blue with the rounded card (engine: stage_scenes.auto_look). */
export function autoSceneLook(brand: string | null | undefined): { backdrop: SceneBackdrop; card: SceneCard } {
  return typeof brand === 'string' && /^#[0-9a-f]{6}$/i.test(brand) ? { backdrop: 'grid', card: 'arch' } : { backdrop: 'grid', card: 'rounded' }
}

/**
 * How the captions in a scene's band are drawn on a backdrop (engine: stage_scenes.caption_mode): dark text on
 * the light ones, white words on a color box on grid and gradient, the clip's own captions on dark and solid.
 */
export function sceneCaptionLook(backdrop: SceneBackdrop | undefined): 'dark_text' | 'box' | 'own' {
  const b = backdrop ?? 'light'
  return b === 'grid' || b === 'gradient' ? 'box' : b === 'dark' || b === 'solid' ? 'own' : 'dark_text'
}

/** Where the captions sit in a scene, as a share of the output height (null: the clip's usual place). */
export function sceneCaptionY(scene: SceneKind): number | null {
  if (scene === 'stage') {
    const cardTop = 1 - STAGE_LAYOUT.cardBottom - STAGE_LAYOUT.cardHeight
    return (STAGE_LAYOUT.stageBottom + cardTop) / 2
  }
  return scene === 'visual' ? STAGE_LAYOUT.visualCaptionY : null
}

const isKind = (x: unknown): x is SceneKind => (SCENE_KINDS as readonly unknown[]).includes(x)
const isBackdrop = (x: unknown): x is SceneBackdrop => (SCENE_BACKDROPS as readonly unknown[]).includes(x)
const isCard = (x: unknown): x is SceneCard => (SCENE_CARDS as readonly unknown[]).includes(x)
const isTransition = (x: unknown): x is SceneTransition => (SCENE_TRANSITIONS as readonly unknown[]).includes(x)
const clean = (s: StageScene): StageScene => s.scene === 'face'
  ? { scene: 'face', start_ms: s.start_ms, end_ms: s.end_ms }
  : { scene: s.scene, start_ms: s.start_ms, end_ms: s.end_ms, ...(s.backdrop && s.backdrop !== 'light' ? { backdrop: s.backdrop } : {}),
      ...(s.scene === 'stage' && s.card === 'arch' ? { card: s.card } : {}), ...(s.scene === 'stage' && s.escape === false ? { escape: false as const } : {}),
      ...(s.transition && s.transition !== DEFAULT_SCENE_TRANSITION ? { transition: s.transition } : {}) }
const same = (a: StageScene, b: StageScene): boolean => a.scene === b.scene && (a.backdrop ?? 'light') === (b.backdrop ?? 'light') && (a.card ?? 'rounded') === (b.card ?? 'rounded')
  && (a.escape ?? true) === (b.escape ?? true) && (a.transition ?? DEFAULT_SCENE_TRANSITION) === (b.transition ?? DEFAULT_SCENE_TRANSITION)
/** Whether a stage scene's head may break out of its card (on unless turned off). */
export function sceneEscapes(s: Pick<StageScene, 'scene' | 'escape'>): boolean { return s.scene === 'stage' && s.escape !== false }
/** A scene's camera move. */
export function sceneTransition(s: Pick<StageScene, 'transition'>): SceneTransition { return s.transition ?? DEFAULT_SCENE_TRANSITION }

/**
 * Validates untrusted scenes (a saved edit, the renderer, the chat): a list of
 * up to MAX_SCENES scenes in time order, each at least 1.2 s, not overlapping, inside
 * [0, duration]. Throws on anything else.
 */
export function parseScenes(value: unknown, duration = Number.MAX_SAFE_INTEGER): StageScene[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_SCENES) throw new Error(`Add up to ${MAX_SCENES} scenes to a clip.`)
  const scenes = value.map((raw): StageScene => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('A scene is malformed.')
    const s = raw as Record<string, unknown>
    if (Object.keys(s).some((key) => !['scene', 'start_ms', 'end_ms', 'backdrop', 'card', 'escape', 'transition'].includes(key))) throw new Error('A scene is malformed.')
    if (s.escape !== undefined && s.escape !== false && s.escape !== true) throw new Error('A scene is malformed.')
    if (s.transition !== undefined && !isTransition(s.transition)) throw new Error('A scene’s transition is slide, zoom or whip.')
    if (!isKind(s.scene)) throw new Error('A scene is face, stage or visual.')
    if (s.backdrop !== undefined && !isBackdrop(s.backdrop)) throw new Error('A scene’s backdrop is light, dark, brand, grid, gradient or solid.')
    if (s.card !== undefined && !isCard(s.card)) throw new Error('A scene’s card is rounded or arch.')
    const start = s.start_ms, end = s.end_ms
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration) throw new Error('A scene must be inside the video.')
    if (end - start < MIN_SCENE_MS - 0.5) throw new Error(`A scene lasts at least ${MIN_SCENE_MS / 1000} seconds.`)
    return clean({ scene: s.scene, start_ms: Math.round(start), end_ms: Math.round(end), ...(s.backdrop ? { backdrop: s.backdrop as SceneBackdrop } : {}), ...(s.card ? { card: s.card as SceneCard } : {}),
      ...(s.escape === false ? { escape: false as const } : {}), ...(s.transition ? { transition: s.transition as SceneTransition } : {}) })
  })
  scenes.forEach((s, i) => { if (i > 0 && s.start_ms < scenes[i - 1].end_ms) throw new Error('Scenes can’t overlap.') })
  return scenes
}

/** The scene playing at `t` (on the list's own clock): the one there, or face. */
export function sceneAt(scenes: readonly StageScene[] | undefined, t: number): StageScene {
  const hit = (scenes ?? []).find((s) => t >= s.start_ms && t < s.end_ms)
  return hit ?? { scene: 'face', start_ms: t, end_ms: t }
}

/**
 * Sorted, later scenes winning where two overlap, neighbors with the same scene
 * and backdrop merged, and (with `minMs`) scenes shorter than that dropped.
 */
export function normalizeScenes(scenes: readonly StageScene[], options: { duration?: number; minMs?: number; keepFace?: boolean } = {}): StageScene[] {
  const duration = options.duration ?? Number.MAX_SAFE_INTEGER, min = options.minMs ?? 1, keepFace = options.keepFace ?? true
  const placed: StageScene[] = []
  // Later in the list wins: paint each one over what came before.
  for (const s of scenes) {
    const start = Math.max(0, Math.round(s.start_ms)), end = Math.min(duration, Math.round(s.end_ms))
    if (end <= start) continue
    const kept = carve(placed, start, end)
    placed.length = 0
    placed.push(...kept, clean({ ...s, start_ms: start, end_ms: end }))
    placed.sort((a, b) => a.start_ms - b.start_ms)
  }
  const merged: StageScene[] = []
  for (const s of placed) {
    const last = merged.at(-1)
    if (last && same(last, s) && s.start_ms - last.end_ms <= 1) last.end_ms = s.end_ms
    else merged.push({ ...s })
  }
  return merged.filter((s) => s.end_ms - s.start_ms >= min && (keepFace || s.scene !== 'face'))
}

/** The scenes with [start, end) cut out of them (a scene across it is split). */
function carve(scenes: readonly StageScene[], start: number, end: number): StageScene[] {
  return scenes.flatMap((s): StageScene[] => {
    if (s.end_ms <= start || s.start_ms >= end) return [s]
    return [{ ...s, end_ms: start }, { ...s, start_ms: end }].filter((p) => p.end_ms > p.start_ms)
  })
}

/**
 * Set [start, end) to one scene, over whatever was there (the "paint" the lane
 * and the chat use). Pieces of other scenes left under 1.2 s are dropped; face
 * pieces are kept only when `keepFace` (by default face is just "no scene").
 */
export function setScene(scenes: readonly StageScene[], start: number, end: number, scene: SceneKind, backdrop?: SceneBackdrop, duration?: number, card?: SceneCard): StageScene[] {
  const a = Math.max(0, Math.round(Math.min(start, end))), b = Math.round(Math.min(duration ?? Number.MAX_SAFE_INTEGER, Math.max(start, end)))
  const next = carve(scenes, a, b).filter((s) => s.end_ms - s.start_ms >= MIN_SCENE_MS)
  if (scene !== 'face') next.push(clean({ scene, start_ms: a, end_ms: b, backdrop, card }))
  return normalizeScenes(next.sort((x, y) => x.start_ms - y.start_ms), { duration, keepFace: false })
}

/** Change one scene (by index): its kind, backdrop, card or times, kept clear of its neighbors and at least 1.2 s long. */
export function updateScene(scenes: readonly StageScene[], index: number, patch: Partial<StageScene>, bounds: { start: number; end: number }): StageScene[] {
  const s = scenes[index]
  if (!s) return [...scenes]
  const lo = Math.max(bounds.start, scenes[index - 1]?.end_ms ?? -Infinity), hi = Math.min(bounds.end, scenes[index + 1]?.start_ms ?? Infinity)
  let start = Math.round(patch.start_ms ?? s.start_ms), end = Math.round(patch.end_ms ?? s.end_ms)
  if (patch.start_ms !== undefined && patch.end_ms !== undefined) {
    // A move keeps its length.
    const length = Math.min(end - start, hi - lo)
    start = Math.max(lo, Math.min(hi - length, start)); end = start + length
  } else if (patch.start_ms !== undefined) {
    start = Math.max(lo, Math.min(end - MIN_SCENE_MS, start))
  } else if (patch.end_ms !== undefined) {
    end = Math.min(hi, Math.max(start + MIN_SCENE_MS, end))
  }
  if (end - start < MIN_SCENE_MS) return [...scenes]
  const kind = patch.scene ?? s.scene
  const next = clean({ scene: kind, start_ms: start, end_ms: end, backdrop: 'backdrop' in patch ? patch.backdrop : s.backdrop, card: 'card' in patch ? patch.card : s.card,
    escape: 'escape' in patch ? patch.escape : s.escape, transition: 'transition' in patch ? patch.transition : s.transition })
  return scenes.map((x, i) => i === index ? next : x)
}

/** A new scene at the playhead: `DEFAULT_SCENE_MS` long, fitted into the free time there inside [start, end). Null when there is no room. */
export function newSceneAt(scenes: readonly StageScene[], at: number, bounds: { start: number; end: number }, scene: SceneKind = 'stage', backdrop?: SceneBackdrop, card?: SceneCard): StageScene | null {
  if (scenes.length >= MAX_SCENES) return null
  const t = Math.max(bounds.start, Math.min(bounds.end, Math.round(at)))
  if (scenes.some((s) => t >= s.start_ms && t < s.end_ms)) return null
  const lo = Math.max(bounds.start, ...scenes.filter((s) => s.end_ms <= t).map((s) => s.end_ms))
  const hi = Math.min(bounds.end, ...scenes.filter((s) => s.start_ms > t).map((s) => s.start_ms))
  if (hi - lo < MIN_SCENE_MS) return null
  const length = Math.min(DEFAULT_SCENE_MS, hi - lo)
  const start = Math.max(lo, Math.min(hi - length, t))
  return clean({ scene, start_ms: start, end_ms: start + length, backdrop, card })
}

/** The scenes with `s` added in time order. */
export function withScene(scenes: readonly StageScene[], s: StageScene): StageScene[] {
  return [...scenes, s].sort((a, b) => a.start_ms - b.start_ms)
}

type Timing = { ranges: [number, number][]; video_speed: number }

/**
 * The engine's `scenes` request field: source-time scenes moved onto the finished
 * clip's clock (through the cuts and the export speed). Parts in cut-out footage
 * are dropped; what is left of a scene plays as one stretch. Face is left out
 * (it is the default), and so is anything under 0.3 s.
 */
export function outputScenes(c: Timing & { stage_scenes?: StageScene[] }): StageScene[] {
  const out: StageScene[] = []
  for (const s of c.stage_scenes ?? []) {
    if (s.scene === 'face') continue
    let before = 0, start: number | null = null, kept = 0
    for (const [a, b] of c.ranges) {
      const lo = Math.max(a, s.start_ms), hi = Math.min(b, s.end_ms)
      if (hi > lo) { if (start === null) start = before + lo - a; kept += hi - lo }
      before += b - a
    }
    if (start === null) continue
    const from = Math.round(start / c.video_speed), to = Math.round((start + kept) / c.video_speed)
    if (to - from >= MIN_RENDER_SCENE_MS) out.push(clean({ ...s, start_ms: from, end_ms: to }))
  }
  return normalizeScenes(out, { keepFace: false }).slice(0, MAX_SCENES)
}

/**
 * The narrowest a stage card gets, as a share of the frame's width (engine: stage_scenes.MIN_CARD_SHARE): it stays full
 * width, as in the pro references; a close selfie is framed closer and, only when still too narrow, its sides blurred.
 */
export const MIN_CARD_SHARE = 1
/** The editor preview's card (it has no face boxes): this share of the framed preview's height, from PREVIEW_CARD_TOP down. */
export const PREVIEW_CARD_SPAN = 0.72
export const PREVIEW_CARD_TOP = 0.05

/**
 * The editor preview's card, like the export's: its width (px, at most `cardW`) and the share of the framed frame's
 * height it shows. `sourceShare`: the source's width over the framed frame's (1 when the frame is the whole width).
 * A source narrower than the card at that framing narrows the card to the video (not under MIN_CARD_SHARE of the
 * frame; closer in down to half the frame's height first).
 */
export function previewCard(frameW: number, frameH: number, cardW: number, cardH: number, sourceShare: number): { width: number; span: number } {
  const videoW = (span: number): number => Math.max(1, sourceShare) * frameW * cardH / (span * frameH)
  let span = PREVIEW_CARD_SPAN
  if (videoW(span) >= cardW) return { width: cardW, span: Math.min(span, frameW * cardH / (cardW * frameH)) }
  const least = Math.min(cardW, MIN_CARD_SHARE * frameW)
  if (videoW(span) < least) span = Math.max(0.5, Math.max(1, sourceShare) * frameW * cardH / (least * frameH))
  return { width: Math.max(least, Math.min(cardW, videoW(span))), span }
}

/** The hook text never shows over the stage: it fades out as the first stage or visual scene starts, unless that is in the clip's first 2.5 s (engine: stage_scenes.hook_hand_over_s). */
export const STAGE_HOOK_MIN_MS = 2500

/** When (finished clip's clock, ms) the hook hands over to the first stage or visual scene, or null (it keeps its own time). */
export function stageHookEndMs(c: Timing & { stage_scenes?: StageScene[] }): number | null {
  const first = outputScenes(c)[0]
  return first && first.start_ms >= STAGE_HOOK_MIN_MS ? first.start_ms : null
}

const ease = (p: number): number => { const x = Math.max(0, Math.min(1, p)); return x * x * (3 - 2 * x) }

/**
 * How far into a scene change the finished clip is at output time `t` (the same rules as the
 * render: a change starts at the scene boundary and lasts 350 ms): the backdrop on top and its
 * opacity, the one under it, how far the card is up (0..1) and its shape (the stage's shown or last shown).
 */
export function sceneMix(scenes: readonly StageScene[], t: number): { backdrop: SceneBackdrop | null; under: SceneBackdrop | null; alpha: number; card: number; shape: SceneCard } {
  const at = (ms: number): StageScene | null => scenes.find((s) => ms >= s.start_ms && ms < s.end_ms) ?? null
  const now = at(t)
  // The last boundary at or before t.
  const edges = scenes.flatMap((s) => [s.start_ms, s.end_ms]).filter((e) => e <= t).sort((a, b) => b - a)
  const edge = edges[0] ?? -Infinity, p = edge > 0 ? ease((t - edge) / SCENE_TRANSITION_MS) : 1
  const before = edge > 0 ? at(edge - 1) : now
  const cardNow = now?.scene === 'stage' ? 1 : 0, cardBefore = before?.scene === 'stage' ? 1 : 0
  const card = cardBefore + (cardNow - cardBefore) * p
  const shape: SceneCard = (now?.scene === 'stage' ? now.card : before?.scene === 'stage' ? before.card : undefined) ?? 'rounded'
  const bNow = now ? now.backdrop ?? 'light' : null, bBefore = before ? before.backdrop ?? 'light' : null
  if (bNow) return { backdrop: bNow, under: bBefore && bBefore !== bNow ? bBefore : null, alpha: bBefore === bNow ? 1 : p, card, shape }
  return { backdrop: bBefore, under: null, alpha: bBefore ? 1 - p : 0, card, shape }
}

/**
 * The camera move at a scene change around output time `t` (ms): its kind and how far through it is (0..1, the cut at
 * 0.5), or null. Moves sit at each change of scene kind (face, stage, visual), in the style of the scene being entered
 * (or, back to face, of the one being left); none for 'slide' (engine depth_fx.scene_transitions, for the preview).
 */
export function sceneMove(scenes: readonly StageScene[], t: number, fps = 30): { kind: 'zoom' | 'whip'; p: number } | null {
  const kindAt = (ms: number): SceneKind => scenes.find((s) => ms >= s.start_ms && ms < s.end_ms)?.scene ?? 'face'
  for (const s of scenes) {
    for (const [at, owner] of [[s.start_ms, s], [s.end_ms, scenes.find((n) => n.start_ms === s.end_ms) ?? s]] as const) {
      if (kindAt(at - 1) === kindAt(at)) continue
      const kind = sceneTransition(owner)
      if (kind === 'slide') continue
      const half = TRANSITION_FRAMES[kind] / 2 / fps * 1000
      if (Math.abs(t - at) < half) return { kind, p: (t - at + half) / (2 * half) }
    }
  }
  return null
}
