/**
 * Camera + screen: a talking-head recording and a separate screen recording made at the same time, made into one
 * vertical reel (Edit my recording, "+ Add a screen recording").
 *
 * The engine (screen_pair.py) lines the two up, cuts both like the reviewed edit and puts each kept stretch side by
 * side into one wide video: the camera on the left, the screen (fitted into a square over a blurred copy of itself)
 * on the right. That video is the clip editor's source, and every layout is a crop of it, so the editor switches a
 * stretch between these with the scene model it already has:
 *
 * - screen_top: split, the screen on top and the face below (captions on the line between them);
 * - face_top: split the other way round;
 * - face: the camera alone (fill);
 * - screen: the whole screen fitted over a blurred copy (inset);
 * - bubble: the screen fitted with the face in a round bubble on its lower corner.
 *
 * The crop math mirrors screen_pair.py (scene_for), so a layout switched here looks like one the engine picked.
 */
import type { Crop, EditorScene } from './clip-editor'

export const SCREEN_KINDS = ['screen_top', 'face_top', 'face', 'screen', 'bubble'] as const
export type ScreenKind = (typeof SCREEN_KINDS)[number]
/** The reel's main layout (the member's pick on the review screen). */
export const SCREEN_STYLES = ['screen_top', 'face_top', 'bubble'] as const
export type ScreenStyle = (typeof SCREEN_STYLES)[number]
export const SCREEN_FITS = ['fit', 'cover'] as const
export type ScreenFit = (typeof SCREEN_FITS)[number]

export const SCREEN_KIND_LABELS: Record<ScreenKind, string> = {
  screen_top: 'Screen + me', face_top: 'Me + screen', face: 'Just me', screen: 'Just my screen', bubble: 'Screen + bubble'
}
export const SCREEN_KIND_HINTS: Record<ScreenKind, string> = {
  screen_top: 'Your screen on top, you below',
  face_top: 'You on top, your screen below',
  face: 'Only your camera, full frame',
  screen: 'Only your screen, all of it',
  bubble: 'Your screen with you in a round bubble'
}

/** The screen's part of the height in a split. */
export const SCREEN_SPLIT = { min: 0.3, max: 0.7, default: 0.45 } as const
/** The furthest the two recordings can be apart (ms), either way. */
export const MAX_SCREEN_OFFSET_MS = 30 * 60 * 1000
/** The output frame the crops are cut for. */
const OUT_W = 1080, OUT_H = 1920

/** Where things are in the editor's source (fractions of it), kept with the project. */
export interface ScreenPair {
  camera: Crop
  /** The screen's square region (the screen fitted in it over a blurred copy). */
  screen: Crop
  /** The screen itself inside that region. */
  content: Crop
  /** The speaker's face in the camera region, when one was found. */
  face?: Crop
  style: ScreenStyle
  split: number
  fit: ScreenFit
}

/** The member's choices for the reel (review screen). */
export interface ScreenChoice {
  style: ScreenStyle
  /** The screen's part of the height in a split. */
  split: number
  /** Show all of the screen (fit) or fill its panel (cover). */
  fit: ScreenFit
  /** Ease in slowly on the part of the screen that changes. */
  zoom: boolean
  /** Pick a layout per part (you for the hook and the call to action, the screen alone when it's busy). */
  auto: boolean
}
export const DEFAULT_SCREEN_CHOICE: ScreenChoice = { style: 'screen_top', split: SCREEN_SPLIT.default, fit: 'fit', zoom: true, auto: true }

/** How the screen recording lines up with the camera. */
export interface ScreenSync {
  /** How long after the camera the screen recording started (negative: before). */
  offsetMs: number
  /** audio: by their sound; time: by when each file says it was made; weak: their sound, not clearly; none: no clue. */
  method: 'audio' | 'time' | 'weak' | 'none'
  confidence: number
  cameraSeconds: number
  screenSeconds: number
  screenAudio: boolean
  /** Where the screen recording runs, in camera time (ms), or null when they don't overlap at this offset. */
  overlapMs: [number, number] | null
}

/** A screen recording chosen on the page (checked in main). */
export interface ScreenSource { path: string; name: string; seconds: number }

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const fraction = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1

export function isScreenStyle(value: unknown): value is ScreenStyle { return (SCREEN_STYLES as readonly unknown[]).includes(value) }
export function isScreenKind(value: unknown): value is ScreenKind { return (SCREEN_KINDS as readonly unknown[]).includes(value) }

function parseBox(value: unknown): Crop | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(fraction)) return null
  const [x, y, w, h] = value as number[]
  return w >= 0.01 && h >= 0.01 && x + w <= 1.000001 && y + h <= 1.000001 ? [x, y, w, h] : null
}

/** A project's pair record, checked (null when it isn't one). */
export function parseScreenPair(value: unknown): ScreenPair | null {
  if (!record(value)) return null
  const camera = parseBox(value.camera), screen = parseBox(value.screen), content = parseBox(value.content)
  const face = value.face === undefined ? undefined : parseBox(value.face)
  if (!camera || !screen || !content || face === null || !isScreenStyle(value.style) || (value.fit !== 'fit' && value.fit !== 'cover')) return null
  if (typeof value.split !== 'number' || !Number.isFinite(value.split) || value.split < SCREEN_SPLIT.min || value.split > SCREEN_SPLIT.max) return null
  return { camera, screen, content, ...(face ? { face } : {}), style: value.style, split: value.split, fit: value.fit }
}

/** The review's screen choices from the page, checked; throws with a plain message. */
export function parseScreenChoice(value: unknown): ScreenChoice {
  if (!record(value)) throw new Error('Choose how your screen and camera are shown.')
  if (!isScreenStyle(value.style)) throw new Error('Choose how your screen and camera are shown.')
  if (typeof value.split !== 'number' || !Number.isFinite(value.split) || value.split < SCREEN_SPLIT.min || value.split > SCREEN_SPLIT.max) throw new Error('Choose how much room your screen gets.')
  if (value.fit !== 'fit' && value.fit !== 'cover') throw new Error('Choose whether to show all of your screen.')
  if (typeof value.zoom !== 'boolean' || typeof value.auto !== 'boolean') throw new Error('Choose how your screen and camera are shown.')
  return { style: value.style, split: Math.round(value.split * 100) / 100, fit: value.fit, zoom: value.zoom, auto: value.auto }
}

/** An offset from the page, checked (whole ms within the limit). */
export function parseScreenOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || Math.abs(value) > MAX_SCREEN_OFFSET_MS) throw new Error('Line up your screen recording again.')
  return value
}

/** Where the screen recording runs in camera time (ms) at this offset, or null when they don't overlap (at least a second). */
export function screenOverlap(offsetMs: number, cameraSeconds: number, screenSeconds: number): [number, number] | null {
  const a = Math.max(0, offsetMs), b = Math.min(cameraSeconds * 1000, offsetMs + screenSeconds * 1000)
  return b - a >= 1000 ? [Math.round(a), Math.round(b)] : null
}

/** "starts 2.37 s after your camera" */
export function offsetWords(offsetMs: number): string {
  const s = Math.abs(offsetMs) / 1000
  if (s < 0.005) return 'starts at the same moment as your camera'
  return `starts ${s.toFixed(2)} s ${offsetMs > 0 ? 'after' : 'before'} your camera`
}

// ---------------------------------------------------------------------------
// Crops (mirrors screen_pair.py)
// ---------------------------------------------------------------------------

type Px = [number, number, number, number]
interface Frame { width: number; height: number }

const px = (box: Crop, f: Frame): Px => [box[0] * f.width, box[1] * f.height, box[2] * f.width, box[3] * f.height]
const norm = (box: Px, f: Frame): Crop => [box[0] / f.width, box[1] / f.height, box[2] / f.width, box[3] / f.height].map((n) => Math.round(n * 1e6) / 1e6) as Crop
function clampBox(x: number, y: number, w: number, h: number, bounds: Px): Px {
  const [bx, by, bw, bh] = bounds
  w = Math.min(w, bw); h = Math.min(h, bh)
  return [Math.max(bx, Math.min(bx + bw - w, x)), Math.max(by, Math.min(by + bh - h, y)), w, h]
}
/** Output aspect (width / height) of the top and bottom panels of a split with the top taking `share`. */
export function panelAspects(share: number): [number, number] { return [OUT_W / (OUT_H * share), OUT_W / (OUT_H * (1 - share))] }

function faceCrop(pair: ScreenPair, f: Frame, aspect: number): Px {
  const cam = px(pair.camera, f)
  const w = Math.min(cam[2], cam[3] * aspect), h = w / aspect
  const face = pair.face ? px(pair.face, f) : null
  const fx = face ? face[0] + face[2] / 2 : cam[0] + cam[2] / 2, fy = face ? face[1] + face[3] / 2 : cam[1] + cam[3] * 0.36
  return clampBox(fx - w / 2, fy - h * 0.42, w, h, cam)
}
function bubbleCrop(pair: ScreenPair, f: Frame): Px {
  const cam = px(pair.camera, f)
  const face = pair.face ? px(pair.face, f) : null
  const size = face ? Math.max(cam[2] * 0.45, Math.min(cam[2], face[3] * 2.4)) : cam[2] * 0.8
  const fx = face ? face[0] + face[2] / 2 : cam[0] + cam[2] / 2, fy = face ? face[1] + face[3] / 2 : cam[1] + cam[3] * 0.36
  return clampBox(fx - size / 2, fy - size * 0.45, size, size, cam)
}
function screenCrop(pair: ScreenPair, f: Frame, aspect: number, fit: ScreenFit): Px {
  const content = px(pair.content, f), region = px(pair.screen, f)
  const [cx0, cy0, cw, ch] = content
  if (fit === 'cover') {
    const w = Math.min(cw, ch * aspect), h = w / aspect
    return clampBox(cx0 + cw / 2 - w / 2, cy0 + ch / 2 - h / 2, w, h, content)
  }
  let w = Math.max(cw, ch * aspect), h = w / aspect
  if (h > region[3]) { h = region[3]; w = h * aspect }
  if (w > region[2]) { w = region[2]; h = w / aspect }
  return clampBox(cx0 + cw / 2 - w / 2, cy0 + ch / 2 - h / 2, w, h, region)
}

/** One editor scene for a layout (the screen's share of the height in a split: `share`, else the pair's own). */
export function screenScene(kind: ScreenKind, at_ms: number, pair: ScreenPair, f: Frame, share = pair.split, fit = pair.fit): EditorScene {
  const s = Math.round(Math.max(SCREEN_SPLIT.min, Math.min(SCREEN_SPLIT.max, share)) * 100) / 100
  if (kind === 'screen_top' || kind === 'face_top') {
    const top = kind === 'screen_top' ? s : Math.round((1 - s) * 100) / 100
    const [aTop, aBottom] = panelAspects(top)
    const crops = kind === 'screen_top' ? [screenCrop(pair, f, aTop, fit), faceCrop(pair, f, aBottom)] : [faceCrop(pair, f, aTop), screenCrop(pair, f, aBottom, fit)]
    return { at_ms, layout: 'split', crops: crops.map((c) => norm(c, f)), ...(Math.abs(top - 0.5) > 1e-9 ? { split: top } : {}) }
  }
  if (kind === 'face') return { at_ms, layout: 'fill', crops: [norm(faceCrop(pair, f, OUT_W / OUT_H), f)] }
  if (kind === 'screen') return { at_ms, layout: 'inset', crops: [[...pair.content] as Crop] }
  return { at_ms, layout: 'bubble', crops: [[...pair.content] as Crop, norm(bubbleCrop(pair, f), f)] }
}

const inside = (crop: Crop, box: Crop): boolean => crop[0] >= box[0] - 1e-4 && crop[1] >= box[1] - 1e-4 && crop[0] + crop[2] <= box[0] + box[2] + 1e-4 && crop[1] + crop[3] <= box[1] + box[3] + 1e-4

/** Which of the layouts a scene shows (null: a crop the member set up some other way). */
export function screenKindOf(scene: Pick<EditorScene, 'layout' | 'crops'>, pair: ScreenPair): ScreenKind | null {
  if (scene.layout === 'inset') return 'screen'
  if (scene.layout === 'bubble') return 'bubble'
  if (scene.layout === 'fill') return inside(scene.crops[0], pair.camera) ? 'face' : null
  if (scene.layout === 'split') {
    if (inside(scene.crops[0], pair.screen) && inside(scene.crops[1], pair.camera)) return 'screen_top'
    if (inside(scene.crops[0], pair.camera) && inside(scene.crops[1], pair.screen)) return 'face_top'
  }
  return null
}

/** The screen's share of the height a split scene shows (the pair's own for other layouts). */
export function screenShareOf(scene: Pick<EditorScene, 'layout' | 'crops' | 'split'>, pair: ScreenPair): number {
  const kind = screenKindOf(scene, pair)
  const top = scene.split ?? 0.5
  return kind === 'screen_top' ? top : kind === 'face_top' ? Math.round((1 - top) * 100) / 100 : pair.split
}

/**
 * Set `kind` from `at` to `until` (or the end) on a clip's scenes: the scene there changes, later ones in the span
 * go, and the layout that was showing at `until` comes back there. Times are source ms.
 */
export function setScreenKind(scenes: EditorScene[], kind: ScreenKind, at: number, until: number | null, end: number, pair: ScreenPair, f: Frame): EditorScene[] {
  const sorted = [...scenes].sort((a, b) => a.at_ms - b.at_ms)
  const at_ms = Math.max(0, Math.round(at))
  const sceneAt = (t: number): EditorScene => [...sorted].reverse().find((s) => s.at_ms <= t) ?? sorted[0]
  const current = sceneAt(at_ms)
  const fresh = screenScene(kind, at_ms <= sorted[0].at_ms ? sorted[0].at_ms : at_ms, pair, f, screenShareOf(current, pair))
  const stop = until === null ? end : Math.round(until)
  const restore = until !== null && stop < end ? { ...structuredClone(sceneAt(stop)), at_ms: stop, transition_ms: undefined } : null
  const next = sorted.filter((s) => s.at_ms < fresh.at_ms || (s.at_ms >= stop && !(restore && Math.abs(s.at_ms - stop) < 1)))
  next.push(fresh)
  if (restore) next.push(restore)
  next.sort((a, b) => a.at_ms - b.at_ms)
  // Movement only between two scenes of the same layout (and split); the switched scene starts with a cut.
  return next.map((s, i) => {
    if (!s.transition_ms) return s
    const prev = next[i - 1]
    const ok = s !== fresh && prev && prev.layout === s.layout && (prev.layout === 'fill' || prev.layout === 'split') && (prev.split ?? 0.5) === (s.split ?? 0.5)
    if (ok) return s
    const copy = { ...s }
    delete copy.transition_ms
    return copy
  })
}

/** Where the round bubble goes on the output (px): over the screen's lower right corner. Mirrors bubble_view in layout_renderer.py. */
export function bubbleRect(content: Crop, source: Frame, out: Frame): { x: number; y: number; d: number; inset: { x: number; y: number; w: number; h: number } } {
  const w = content[2] * source.width, h = content[3] * source.height
  const scale = Math.min(out.width / w, out.height / h)
  const fw = Math.min(out.width, w * scale), fh = Math.min(out.height, h * scale)
  const ix = (out.width - fw) / 2, iy = (out.height - fh) / 2
  const d = Math.round(out.width * 0.34 / 2) * 2
  const cx = out.width - out.width * 0.05 - d / 2
  const cy = Math.min(Math.max(iy + fh, out.height * 0.3), out.height * 0.8)
  return { x: cx - d / 2, y: cy - d / 2, d, inset: { x: ix, y: iy, w: fw, h: fh } }
}

/** The engine's sync result (sync_pair), checked; null when it isn't one. */
export function parseScreenSync(raw: unknown): ScreenSync | null {
  if (!record(raw)) return null
  const num = (v: unknown, lo: number, hi: number): number | null => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null
  const offset = num(raw.offset_ms, -MAX_SCREEN_OFFSET_MS, MAX_SCREEN_OFFSET_MS), confidence = num(raw.confidence, 0, 1)
  const camera = num(raw.camera_seconds, 0, 24 * 3600), screen = num(raw.screen_seconds, 0, 24 * 3600)
  if (offset === null || confidence === null || camera === null || screen === null || !['audio', 'time', 'weak', 'none'].includes(raw.method as string)) return null
  return { offsetMs: Math.round(offset), method: raw.method as ScreenSync['method'], confidence, cameraSeconds: camera, screenSeconds: screen,
    screenAudio: raw.screen_audio === true, overlapMs: screenOverlap(Math.round(offset), camera, screen) }
}

/** One plain sentence on how the two were lined up. */
export function syncWords(sync: Pick<ScreenSync, 'method' | 'offsetMs'>): string {
  const when = offsetWords(sync.offsetMs)
  if (sync.method === 'audio') return `Lined up by sound: your screen recording ${when}.`
  if (sync.method === 'time') return `Your screen recording has no clear match by sound, so it was lined up by when each file was made: it ${when}. Check it with the preview.`
  if (sync.method === 'weak') return `Lined up by sound, but not clearly: your screen recording ${when}. Check it with the preview.`
  return 'Your recordings couldn’t be lined up by sound or by when they were made. Use the slider and the preview to line them up.'
}
