/**
 * Where a motion graphic sits on the finished clip, and what it is drawn with.
 * The editor's live preview and main's offscreen render both build their
 * GraphicRenderSpec here, so the preview matches the bake.
 *
 * Rule: a graphic never covers the hook at the top or the captions. "Top" sits
 * just under the hook; "Bottom" sits just above the captions (or near the
 * bottom of the frame when captions are off or high up); "Middle" is centered
 * in the free space between them.
 */
import { sceneAt, type CandidateEdit, type EditorProject } from './clip-editor'
import { HEADLINE_FONTS, isHexColor } from './headline-look'
import { graphicWindow, type EditorGraphic, type GraphicPlacement, type GraphicRenderSpec } from './motion-graphics'

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
}

/** The vertical band (fractions of the height) a graphic with this placement sits in. */
export function graphicBox(placement: GraphicPlacement, frame: GraphicFrame): { top: number; bottom: number } {
  const wide = frame.aspect === '16:9'
  const h = wide ? .4 : frame.aspect === '1:1' ? .34 : .27
  // Platform buttons and captions sit along the very top and bottom of the screen.
  const topSafe = frame.hook ? frame.hook + .02 : wide ? .06 : .08
  const bottomSafe = wide ? .94 : .86
  let free: [number, number][] = [[topSafe, bottomSafe]]
  if (frame.captions) {
    const c = frame.captions
    const [ct, cb] = c.bottom ? [c.y - .13, c.y] : [c.y - .075, c.y + .075]
    free = free.flatMap(([a, b]): [number, number][] => cb <= a || ct >= b ? [[a, b]] : [[a, ct - .01], [cb + .01, b]]).filter(([a, b]) => b - a > .01)
  }
  if (!free.length) free = [[topSafe, Math.max(topSafe + .1, bottomSafe)]]
  const roomy = free.filter(([a, b]) => b - a >= Math.min(h, .15))
  const pool = roomy.length ? roomy : free
  if (placement === 'top') { const [a, b] = pool[0]; return { top: a, bottom: Math.min(b, a + h) } }
  if (placement === 'bottom') { const [a, b] = pool[pool.length - 1]; return { top: Math.max(a, b - h), bottom: b } }
  // Middle: the free space overlapping the frame's middle most, centered as near the middle as it allows.
  const overlap = ([a, b]: [number, number]): number => Math.min(b, .5 + h / 2) - Math.max(a, .5 - h / 2)
  const [a, b] = [...pool].sort((x, y) => overlap(y) - overlap(x) || (y[1] - y[0]) - (x[1] - x[0]))[0]
  if (b - a <= h) return { top: a, bottom: b }
  const center = Math.max(a + h / 2, Math.min(b - h / 2, .5))
  return { top: center - h / 2, bottom: center + h / 2 }
}

/** A graphic's brand color and font: its own color field, else the hook's brand color, else a calm blue; the hook's font. */
export function graphicStyle(candidate: Pick<CandidateEdit, 'hook'>, graphic?: Pick<EditorGraphic, 'fields'>): { color: string; font: string } {
  const own = graphic?.fields.color
  const look = candidate.hook?.look
  const color = isHexColor(own) ? own.toUpperCase() : look?.look === 'brand' && isHexColor(look.color) ? look.color.toUpperCase() : GRAPHIC_DEFAULT_COLOR
  const font = look && HEADLINE_FONTS.some((f) => f.id === look.font) ? look.font : 'clean'
  return { color, font }
}

/**
 * What to draw for one graphic on this clip, or null when the cut leaves it
 * (almost) nothing on screen. `image` is filled by the caller (it knows how
 * the page may load the file).
 */
export function graphicSpec(project: Pick<EditorProject, 'aspect_ratio' | 'width' | 'height'>, candidate: CandidateEdit, graphic: EditorGraphic): GraphicRenderSpec | null {
  const window = graphicWindow(candidate, graphic)
  if (!window) return null
  const { width, height } = outputSize(project.aspect_ratio)
  const at = Math.max(graphic.at_ms, candidate.ranges[0][0])
  const frame: GraphicFrame = { aspect: project.aspect_ratio, hook: hookShare(candidate, project.aspect_ratio), captions: candidate.captions ? captionAnchorAt(project, candidate, at) : null }
  const fields = { ...graphic.fields }
  delete fields.image
  delete fields.color
  return { template: graphic.template, fields, width, height, duration_ms: window.duration_ms, box: graphicBox(graphic.placement, frame), placement: graphic.placement, ...graphicStyle(candidate, graphic) }
}
