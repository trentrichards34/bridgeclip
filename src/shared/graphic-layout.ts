/**
 * Where a motion graphic sits on the finished clip, and what it is drawn with.
 * The editor's live preview and main's offscreen render both build their
 * GraphicRenderSpec here, so the preview matches the bake.
 *
 * Rule: a graphic never covers the hook at the top or the captions. "Top" sits
 * just under the hook; "Bottom" sits just above the captions (or near the
 * bottom of the frame when captions are off or high up); "Middle" is centered
 * in the free space between them. The member's handle (an Automatic run's
 * brand mark) is kept clear too: a top corner pushes "Top" down, a bottom
 * corner pushes "Bottom" up.
 */
import { sceneAt, type CandidateEdit, type EditorProject } from './clip-editor'
import { HEADLINE_FONTS, isHexColor } from './headline-look'
import { STAGE_LAYOUT, sceneAt as stageSceneAt } from './scenes'
import { DIAGRAM_ACCENT, graphicWindow, isDiagram, outputTime, type EditorGraphic, type GraphicPlacement, type GraphicRenderSpec, type GraphicSize } from './motion-graphics'

/** The editor's default brand color for graphics (the engine's cards use the same calm blue). */
export const GRAPHIC_DEFAULT_COLOR = '#2F5BFF'

/** The caption block's anchor (manual exports use these: layout_renderer.caption_anchor). `bottom`: y is its bottom edge. */
export function captionAnchorAt(project: Pick<EditorProject, 'aspect_ratio' | 'width' | 'height'>, candidate: Pick<CandidateEdit, 'caption_y' | 'scenes'>, time: number): { y: number; bottom: boolean } {
  if (candidate.caption_y != null) return { y: candidate.caption_y, bottom: false }
  if (project.aspect_ratio === '16:9') return { y: 1 - 100 / 1080, bottom: true }
  const scene = sceneAt(candidate as CandidateEdit, time)
  if (scene.layout === 'split') return { y: .5, bottom: false }
  if (scene.layout === 'fit') {
    const height = Math.min(1920, 1080 * project.height / project.width)
    const bar = (1920 - height) / 2
    if (bar >= 200) return { y: (1920 - Math.floor(bar * .55)) / 1920, bottom: true }
  }
  return { y: 1340 / 1920, bottom: false }
}

/** The output frame for a project's aspect ratio. */
export function outputSize(aspect: EditorProject['aspect_ratio'] | '1:1'): { width: number; height: number } {
  return aspect === '16:9' ? { width: 1920, height: 1080 } : aspect === '1:1' ? { width: 1080, height: 1080 } : { width: 1080, height: 1920 }
}

/** The share of a 9:16 frame the hook takes at the top (the engine's bar is 17–30% tall), or 0 with no hook. */
export function hookShare(candidate: Pick<CandidateEdit, 'hook'>, aspect: EditorProject['aspect_ratio']): number {
  const hook = candidate.hook
  if (aspect !== '9:16' || !hook || hook.look.look === 'none' || hook.text.trim().split(/\s+/).length < 2) return 0
  const lines = Math.min(3, Math.ceil(hook.text.length / 24))
  return Math.min(.3, Math.max(.17, .105 + lines * .038))
}

export interface GraphicFrame {
  aspect: EditorProject['aspect_ratio'] | '1:1'
  /** The hook's share of the height at the top (0: none). */
  hook: number
  /** The captions' anchor, or null when captions are off. */
  captions: { y: number; bottom: boolean } | null
  /** The member's handle in a top or bottom corner (absent: none). */
  handle?: 'top' | 'bottom' | null
  /** Other bands to keep clear (shares of the height): a box with their clip, a split line, a banner. */
  blocked?: [number, number][]
}

/** Share of the height a corner handle takes, with its margin (brand_mark.py: about 4% tall). */
const HANDLE_SHARE = .06

/**
 * A chapter header's band: the very top of the frame, where the hook was (the hook hands over to the first chapter).
 * While a chapter is up, other graphics keep below CHAPTER_SHARE.
 */
export const CHAPTER_TOP = .045
export const CHAPTER_HEIGHT = .12
export const CHAPTER_SHARE = .175

/** The band a chapter header sits in (shares of the height): the top of the frame, under a top-corner handle. */
export function chapterBox(frame: Pick<GraphicFrame, 'aspect' | 'handle'>): { top: number; bottom: number } {
  const wide = frame.aspect === '16:9'
  const top = (wide ? .04 : CHAPTER_TOP) + (frame.handle === 'top' ? HANDLE_SHARE : 0)
  return { top, bottom: top + (wide ? .16 : frame.aspect === '1:1' ? .15 : CHAPTER_HEIGHT) }
}

/** On a 9:16 frame a stage-size graphic ends here: the top ~53% is the stage, the speaker sits below. */
export const STAGE_BOTTOM = .53

/**
 * The vertical band (fractions of the height) a graphic with this placement
 * sits in. `size`: 'compact' is a shorter band, 'card' (or unset) the usual
 * one; 'stage' ignores the placement and takes the top of the frame down to
 * STAGE_BOTTOM on 9:16 (under the hook, clear of the captions), or the
 * largest free space on other frames.
 */
export function graphicBox(placement: GraphicPlacement, frame: GraphicFrame, size?: GraphicSize): { top: number; bottom: number } {
  const wide = frame.aspect === '16:9'
  const h = (wide ? .4 : frame.aspect === '1:1' ? .34 : .27) * (size === 'compact' ? .78 : 1)
  // Platform buttons and captions sit along the very top and bottom of the screen.
  const topSafe = (frame.hook ? frame.hook + .02 : wide ? .06 : .08) + (frame.handle === 'top' ? HANDLE_SHARE : 0)
  const bottomSafe = (wide ? .94 : .86) - (frame.handle === 'bottom' ? HANDLE_SHARE : 0)
  const cut = (list: [number, number][], [t, b]: [number, number]): [number, number][] =>
    list.flatMap(([a, z]): [number, number][] => b <= a || t >= z ? [[a, z]] : [[a, t - .01], [b + .01, z]]).filter(([a, z]) => z - a > .01)
  const roomy = (list: [number, number][]): boolean => list.some(([a, b]) => b - a >= Math.min(h, .15))
  const base: [number, number][] = [[topSafe, bottomSafe]]
  const c = frame.captions
  let free = c ? cut(base, c.bottom ? [c.y - .13, c.y] : [c.y - .075, c.y + .075]) : base
  if (frame.blocked?.length) {
    // Bands with something else on screen (their clip's box, a split line) are never covered; in a layout that leaves
    // no room besides, the graphic may sit over the captions' line instead.
    const clear = frame.blocked.reduce(cut, free)
    const over = frame.blocked.reduce(cut, base)
    free = roomy(clear) || !roomy(over) ? (clear.length ? clear : over.length ? over : free) : over
  }
  if (!free.length) free = [[topSafe, Math.max(topSafe + .1, bottomSafe)]]
  const big = free.filter(([a, b]) => b - a >= Math.min(h, .15))
  const pool = big.length ? big : free
  if (size === 'stage') {
    if (frame.aspect !== '9:16') { const [a, b] = [...pool].sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))[0]; return { top: a, bottom: b } }
    // The free space that overlaps the stage most, cut at the stage's bottom (never shorter than 30% of the frame when there is room).
    const span = ([a, b]: [number, number]): number => Math.min(b, STAGE_BOTTOM) - Math.max(a, 0)
    const [a, b] = [...pool].sort((x, y) => span(y) - span(x))[0]
    return { top: a, bottom: Math.min(b, Math.max(STAGE_BOTTOM, a + .22)) }
  }
  if (placement === 'top') { const [a, b] = pool[0]; return { top: a, bottom: Math.min(b, a + h) } }
  if (placement === 'bottom') { const [a, b] = pool[pool.length - 1]; return { top: Math.max(a, b - h), bottom: b } }
  // Middle: centered in the free space that overlaps the frame's middle most.
  const overlap = ([a, b]: [number, number]): number => Math.min(b, .5 + h / 2) - Math.max(a, .5 - h / 2)
  const [a, b] = [...pool].sort((x, y) => overlap(y) - overlap(x) || (y[1] - y[0]) - (x[1] - x[0]))[0]
  if (b - a <= h) return { top: a, bottom: b }
  const center = (a + b) / 2
  return { top: center - h / 2, bottom: center + h / 2 }
}

/**
 * The size a graphic's band is worked out for. Big words take the stage's height (the top of the frame down to
 * about its middle, under the hook): room for two lines that each fill the width, set high so the speaker's head
 * overlaps their lower part.
 */
export function graphicBandSize(graphic: Pick<EditorGraphic, 'template' | 'size'>): GraphicSize | undefined {
  return graphic.template === 'big_words' ? 'stage' : graphic.size
}

/** A graphic's brand color and font: its own color field, else the hook's brand color, else a calm blue; the hook's font. */
export function graphicStyle(candidate: Pick<CandidateEdit, 'hook'>, graphic?: Pick<EditorGraphic, 'fields'> & { template?: string }): { color: string; font: string } {
  const own = graphic?.fields.color
  const look = candidate.hook?.look
  // Diagrams light up in green unless the graphic has its own color (the member can pick the brand color).
  const color = isHexColor(own) ? own.toUpperCase() : graphic?.template && isDiagram(graphic.template) ? DIAGRAM_ACCENT
    : look?.look === 'brand' && isHexColor(look.color) ? look.color.toUpperCase() : GRAPHIC_DEFAULT_COLOR
  const font = look && HEADLINE_FONTS.some((f) => f.id === look.font) ? look.font : 'clean'
  return { color, font }
}

/** Where an Automatic run's handle sits (top or bottom corner), or null. */
export function handleEdge(project: Pick<EditorProject, 'automatic'>): 'top' | 'bottom' | null {
  const mark = project.automatic?.brand_mark
  return mark ? mark.position.startsWith('top') ? 'top' : 'bottom' : null
}

/**
 * What to draw for one graphic on this clip, or null when the cut leaves it
 * (almost) nothing on screen. `image` is filled by the caller (it knows how
 * the page may load the file). `extra.top`: something else drawn at the top
 * the project doesn't describe (an Automatic run's title card), as a share of
 * the height; the graphic stays below it.
 */
/** The face's vertical span (fractions of the height) a placement's box covers. */
function faceCover(box: { top: number; bottom: number }, face: { top: number; bottom: number }): number {
  return Math.max(0, Math.min(box.bottom, face.bottom) - Math.max(box.top, face.top))
}

/**
 * For automatic graphics: the placement that covers the speaker's face least
 * (face = x, y, w, h as fractions of the finished clip's frame). The chosen
 * placement is kept while it covers under a fifth of the face; otherwise the
 * one covering least wins (ties keep the order top, bottom, middle).
 */
export function placementAvoidingFace(project: Pick<EditorProject, 'aspect_ratio' | 'width' | 'height' | 'automatic'>, candidate: CandidateEdit, graphic: EditorGraphic,
  face: readonly [number, number, number, number] | null | undefined, extra: { top?: number } = {}): GraphicPlacement {
  if (!face || graphic.template === 'highlight' || graphic.size === 'stage') return graphic.placement
  const span = { top: face[1], bottom: face[1] + face[3] }
  if (!(span.bottom > span.top)) return graphic.placement
  const at = Math.max(graphic.at_ms, candidate.ranges[0][0])
  const top = Math.max(0, Math.min(.4, extra.top ?? 0))
  const frame: GraphicFrame = { aspect: project.aspect_ratio, hook: Math.max(hookShare(candidate, project.aspect_ratio), top),
    captions: candidate.captions ? captionAnchorAt(project, candidate, at) : null, handle: handleEdge(project) }
  const cover = (p: GraphicPlacement): number => faceCover(graphicBox(p, frame), span)
  const height = span.bottom - span.top
  if (cover(graphic.placement) < height / 5) return graphic.placement
  return (['top', 'bottom', 'middle'] as const).reduce((best, p) => cover(p) < cover(best) - .005 ? p : best, graphic.placement)
}

export function graphicSpec(project: Pick<EditorProject, 'aspect_ratio' | 'width' | 'height' | 'automatic'>, candidate: CandidateEdit, graphic: EditorGraphic, extra: { top?: number } = {}): GraphicRenderSpec | null {
  const window = graphicWindow(candidate, graphic)
  if (!window) return null
  const { width, height } = outputSize(project.aspect_ratio)
  const at = Math.max(graphic.at_ms, candidate.ranges[0][0])
  const top = Math.max(0, Math.min(.4, extra.top ?? 0))
  // While a chapter header is up, the others keep below it.
  const chapter = graphic.template !== 'chapter' && (candidate.graphics ?? []).some((c) => c.template === 'chapter' && c.at_ms < graphic.at_ms + graphic.duration_ms && graphic.at_ms < c.at_ms + c.duration_ms)
  const frame: GraphicFrame = { aspect: project.aspect_ratio, hook: Math.max(hookShare(candidate, project.aspect_ratio), top, chapter ? CHAPTER_SHARE : 0),
    captions: candidate.captions ? captionAnchorAt(project, candidate, at) : null, handle: handleEdge(project) }
  const fields = { ...graphic.fields }
  delete fields.image
  delete fields.color
  delete fields.item_ms
  delete fields.word_ms
  // Item and word reveal times (source ms from the graphic's start) on the finished clip's clock.
  for (const key of ['item_ms', 'word_ms'] as const) {
    const times = (graphic.fields[key] ?? '').split(/[\s,]+/).filter(Boolean).map(Number)
    if (!times.length || !times.every(Number.isFinite)) continue
    const out = times.map((t) => outputTime(candidate, graphic.at_ms + t))
    if (out.every((t) => t !== null)) fields[key] = out.map((t) => String(Math.max(0, Math.round((t as number) - window.start_ms)))).join('\n')
  }
  let box = graphic.template === 'chapter' ? chapterBox(frame) : graphicBox(graphic.placement, frame, graphicBandSize(graphic))
  const scene = stageSceneAt(candidate.stage_scenes, at)
  // A stage graphic in a Visual scene (the speaker card is away) takes the frame down to just over the captions.
  if (graphic.size === 'stage' && project.aspect_ratio === '9:16' && scene.scene === 'visual') {
    box = { top: box.top, bottom: Math.max(box.bottom, STAGE_LAYOUT.visualCaptionY - .08) }
  }
  // A diagram's white lines need a dark backdrop: over the video or a light backdrop it is drawn on a blue panel.
  if (isDiagram(graphic.template) && !(scene.scene !== 'face' && (scene.backdrop === 'solid' || scene.backdrop === 'dark'))) fields.panel = 'on'
  else delete fields.panel
  // A chapter header over a white hook bar is drawn in dark ink.
  if (graphic.template === 'chapter' && candidate.hook?.look.look === 'white' && hookShare(candidate, project.aspect_ratio) > 0) fields.ink = 'dark'
  else delete fields.ink
  return { template: graphic.template, fields, width, height, duration_ms: window.duration_ms, box, placement: graphic.placement,
    ...graphicStyle(candidate, graphic), ...(graphic.size && graphic.size !== 'card' ? { size: graphic.size } : {}) }
}
