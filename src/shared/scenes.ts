/**
 * Scenes: layout switching on a vertical clip, so graphics get a real stage
 * instead of floating over the face. Three scenes:
 *
 * - face: the normal full-frame framing (the default: any time without a scene is face).
 * - stage: a backdrop fills the frame, the speaker sits in a rounded card along
 *   the bottom, the top ~53% is free for graphics and the captions sit between.
 * - visual: the card is off-screen; the whole frame is backdrop (for a big graphic).
 *
 * The clip editor keeps a clip's scenes in SOURCE time (`CandidateEdit.stage_scenes`,
 * like its graphics), so they stay on their words when the cut changes. Main turns
 * them into the engine's `scenes` request field on the finished clip's clock with
 * `outputScenes` (engine: clip_engine/services/stage_scenes.py mirrors this file).
 */

export type SceneKind = 'face' | 'stage' | 'visual'
export type SceneBackdrop = 'light' | 'dark' | 'brand'
export const SCENE_KINDS: readonly SceneKind[] = ['face', 'stage', 'visual']
export const SCENE_BACKDROPS: readonly SceneBackdrop[] = ['light', 'dark', 'brand']

export interface StageScene {
  scene: SceneKind
  start_ms: number
  end_ms: number
  /** stage / visual: the backdrop (absent: light). Never set on face. */
  backdrop?: SceneBackdrop
}

export const MAX_SCENES = 24
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
  cardSide: 40 / 1080, cardBottom: 40 / 1920, cardHeight: 0.37, cardRadius: 48 / 1080,
  /** Graphics own the frame above this line in a stage scene. */
  stageBottom: 0.53,
  /** Caption center in a visual scene. */
  visualCaptionY: 0.82
} as const

export const SCENE_LABELS: Record<SceneKind, string> = { face: 'Face', stage: 'Stage', visual: 'Visual' }
export const SCENE_DETAILS: Record<SceneKind, string> = {
  face: 'The normal full-frame video.',
  stage: 'A backdrop with you in a card at the bottom. The top is free for graphics.',
  visual: 'Backdrop only, so a graphic can fill the frame.'
}
export const BACKDROP_LABELS: Record<SceneBackdrop, string> = { light: 'Light', dark: 'Dark', brand: 'Brand' }

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
const clean = (s: StageScene): StageScene => s.scene === 'face'
  ? { scene: 'face', start_ms: s.start_ms, end_ms: s.end_ms }
  : { scene: s.scene, start_ms: s.start_ms, end_ms: s.end_ms, ...(s.backdrop && s.backdrop !== 'light' ? { backdrop: s.backdrop } : {}) }
const same = (a: StageScene, b: StageScene): boolean => a.scene === b.scene && (a.backdrop ?? 'light') === (b.backdrop ?? 'light')

/**
 * Validates untrusted scenes (a saved edit, the renderer, the chat): a list of
 * up to 24 scenes in time order, each at least 1.2 s, not overlapping, inside
 * [0, duration]. Throws on anything else.
 */
export function parseScenes(value: unknown, duration = Number.MAX_SAFE_INTEGER): StageScene[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_SCENES) throw new Error(`Add up to ${MAX_SCENES} scenes to a clip.`)
  const scenes = value.map((raw): StageScene => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('A scene is malformed.')
    const s = raw as Record<string, unknown>
    if (Object.keys(s).some((key) => !['scene', 'start_ms', 'end_ms', 'backdrop'].includes(key))) throw new Error('A scene is malformed.')
    if (!isKind(s.scene)) throw new Error('A scene is face, stage or visual.')
    if (s.backdrop !== undefined && !isBackdrop(s.backdrop)) throw new Error('A scene’s backdrop is light, dark or brand.')
    const start = s.start_ms, end = s.end_ms
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration) throw new Error('A scene must be inside the video.')
    if (end - start < MIN_SCENE_MS - 0.5) throw new Error(`A scene lasts at least ${MIN_SCENE_MS / 1000} seconds.`)
    return clean({ scene: s.scene, start_ms: Math.round(start), end_ms: Math.round(end), ...(s.backdrop ? { backdrop: s.backdrop as SceneBackdrop } : {}) })
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
export function setScene(scenes: readonly StageScene[], start: number, end: number, scene: SceneKind, backdrop?: SceneBackdrop, duration?: number): StageScene[] {
  const a = Math.max(0, Math.round(Math.min(start, end))), b = Math.round(Math.min(duration ?? Number.MAX_SAFE_INTEGER, Math.max(start, end)))
  const next = carve(scenes, a, b).filter((s) => s.end_ms - s.start_ms >= MIN_SCENE_MS)
  if (scene !== 'face') next.push(clean({ scene, start_ms: a, end_ms: b, backdrop }))
  return normalizeScenes(next.sort((x, y) => x.start_ms - y.start_ms), { duration, keepFace: false })
}

/** Change one scene (by index): its kind, backdrop or times, kept clear of its neighbors and at least 1.2 s long. */
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
  const next = clean({ scene: kind, start_ms: start, end_ms: end, backdrop: 'backdrop' in patch ? patch.backdrop : s.backdrop })
  return scenes.map((x, i) => i === index ? next : x)
}

/** A new scene at the playhead: `DEFAULT_SCENE_MS` long, fitted into the free time there inside [start, end). Null when there is no room. */
export function newSceneAt(scenes: readonly StageScene[], at: number, bounds: { start: number; end: number }, scene: SceneKind = 'stage', backdrop?: SceneBackdrop): StageScene | null {
  if (scenes.length >= MAX_SCENES) return null
  const t = Math.max(bounds.start, Math.min(bounds.end, Math.round(at)))
  if (scenes.some((s) => t >= s.start_ms && t < s.end_ms)) return null
  const lo = Math.max(bounds.start, ...scenes.filter((s) => s.end_ms <= t).map((s) => s.end_ms))
  const hi = Math.min(bounds.end, ...scenes.filter((s) => s.start_ms > t).map((s) => s.start_ms))
  if (hi - lo < MIN_SCENE_MS) return null
  const length = Math.min(DEFAULT_SCENE_MS, hi - lo)
  const start = Math.max(lo, Math.min(hi - length, t))
  return clean({ scene, start_ms: start, end_ms: start + length, backdrop })
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

const ease = (p: number): number => { const x = Math.max(0, Math.min(1, p)); return x * x * (3 - 2 * x) }

/**
 * How far into a scene change the finished clip is at output time `t` (the same rules as the
 * render: a change starts at the scene boundary and lasts 350 ms): the backdrop on top and its
 * opacity, the one under it, and how far the card is up (0..1).
 */
export function sceneMix(scenes: readonly StageScene[], t: number): { backdrop: SceneBackdrop | null; under: SceneBackdrop | null; alpha: number; card: number } {
  const at = (ms: number): StageScene | null => scenes.find((s) => ms >= s.start_ms && ms < s.end_ms) ?? null
  const now = at(t)
  // The last boundary at or before t.
  const edges = scenes.flatMap((s) => [s.start_ms, s.end_ms]).filter((e) => e <= t).sort((a, b) => b - a)
  const edge = edges[0] ?? -Infinity, p = edge > 0 ? ease((t - edge) / SCENE_TRANSITION_MS) : 1
  const before = edge > 0 ? at(edge - 1) : now
  const cardNow = now?.scene === 'stage' ? 1 : 0, cardBefore = before?.scene === 'stage' ? 1 : 0
  const card = cardBefore + (cardNow - cardBefore) * p
  const bNow = now ? now.backdrop ?? 'light' : null, bBefore = before ? before.backdrop ?? 'light' : null
  if (bNow) return { backdrop: bNow, under: bBefore && bBefore !== bNow ? bBefore : null, alpha: bBefore === bNow ? 1 : p, card }
  return { backdrop: bBefore, under: null, alpha: bBefore ? 1 - p : 0, card }
}
