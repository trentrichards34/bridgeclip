/**
 * Effects: HyperFrames units (vendored HTML + GSAP, see ./vendor/NOTICE) drawn as ordinary motion graphics.
 *
 * Each unit is compiled at build time (src/shared/fx-html.ts) into its styles, markup and one script function, and
 * runs here inside its own shadow root, so its styles, ids and selectors never reach the page or another unit:
 * the script gets a scoped `document` (the shadow root) and `window` (its variables, its timeline registry), and
 * GSAP selector text is scoped to the shadow root (gsap.context). The unit builds ONE paused GSAP timeline, which
 * `seek(ms)` sets to the frame's time (never the wall clock); CSS animations in it are paused and set the same way,
 * so the offscreen render (graphics-render.ts) and the editor's preview get the same pixels for the same time.
 *
 * The member's look is mapped onto the unit's theme tokens (--brand / --accent / --fg …, themes/CONTRACT.md): the
 * brand color is the accent, ink is light over the video, the display face is a bold sans (or the graphic's own font),
 * the brand font sets only the accent words (spec.accent_font), and every other face is one of the app's bundled fonts. The background stays transparent. Spoken word times (`cue_ms`) become the
 * unit's `cues`, or shift it so its main beat lands on the word (fxTiming).
 */
import { FX_FIT, FX_MIN_TYPE, fitStepLabels, fxAnchorShift, fxBrand, fxFit, fxGlassLeft, fxMarkerFill, fxMinType, wordMarkBox, type Rect } from './fit'
import gsap from 'gsap'
import { CustomEase } from 'gsap/CustomEase'
import './fx.css'
import { FX_MOTION, easeIn } from './motion'
import { fxEffect, fxHasContent, fxMark, fxTiming, fxVariables, type FxEffect, type FxSlot } from '../../../shared/fx-catalog'
import { drawMark, markPath, pushOrigin, pushScale, type Picture } from './media'
import type { GraphicRenderSpec } from '../../../shared/motion-graphics'

gsap.registerPlugin(CustomEase)

export interface FxModule {
  styles: string
  markup: string
  snippet: boolean
  run: (g: typeof gsap, customEase: typeof CustomEase, window: Window, document: Document) => void
}
interface Timeline { totalTime: (t: number, suppressEvents?: boolean) => unknown; pause: () => unknown; kill: () => unknown }
export interface MountedEffect { seek: (ms: number) => void; destroy: () => void; ready: Promise<void> }

// Vendored HyperFrames units, and CreatorClips' own ones remade from HyperFrames blocks so they take variables (./own).
const modules = import.meta.glob(['./vendor/*.html', './own/*.html'], { query: '?fx' }) as Record<string, () => Promise<FxModule>>
/** The compiled unit for an effect, or null when it isn't vendored. */
export function loadEffect(id: string): Promise<FxModule> | null {
  const load = modules[`./vendor/${id}.html`] ?? modules[`./own/${id}.html`]
  return load ? load() : null
}

/** The member's pictures of a render spec, by field. */
function pictureUrls(spec: GraphicRenderSpec): Record<string, string | undefined> {
  return { image: spec.image, image_b: spec.image_b }
}
async function loadPicture(url: string | undefined): Promise<Picture | null> {
  if (!url) return null
  const img = new Image()
  img.decoding = 'async'
  img.src = url
  try { await img.decode() } catch { return null }
  return img.naturalWidth > 0 && img.naturalHeight > 0 ? { url, width: img.naturalWidth, height: img.naturalHeight } : null
}
/** A picture in a unit's slot: it covers the slot (top-aligned for screenshots); `lit` ones catch the unit's light. */
function pictureNode(picture: Picture, slot: FxSlot): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'cc-media'
  wrap.dataset.field = slot.field
  wrap.dataset.align = slot.align ?? 'center'
  if (slot.lit) { wrap.setAttribute('data-lit', ''); wrap.style.setProperty('--lsp-x', '50') }
  const img = document.createElement('img')
  img.src = picture.url; img.alt = ''; img.draggable = false
  img.style.objectPosition = slot.align === 'top' ? '50% 0%' : '50% 50%'
  wrap.appendChild(img)
  return wrap
}

/** The display face per hook font (templates.ts DISPLAY); every other face is bundled too. */
const DISPLAY: Record<string, string> = {
  clean: '"MG Jakarta", "MG Montserrat", sans-serif', serif: '"MG Fraunces", Georgia, serif', condensed: '"MG Anton", Impact, sans-serif',
  marker: '"MG Caveat Brush", cursive', sans_serif_accent: '"MG Jakarta", "MG Montserrat", sans-serif'
}
/**
 * The units are set in Inter; the bundled face standing in for it (Plus Jakarta Sans) has a narrower word space, and
 * with the units' tight tracking the words ran together. This restores Inter's word space.
 */
export const WORD_SPACING = '0.08em'
/** The brand font for accent words (spec.accent_font): the hook's own face; the "sans + italic serif" look's italic serif. */
const ACCENT_FACE: Record<string, { family: string; style: string }> = {
  serif: { family: '"MG Fraunces", Georgia, serif', style: 'normal' }, condensed: { family: '"MG Anton", Impact, sans-serif', style: 'normal' },
  marker: { family: '"MG Caveat Brush", cursive', style: 'normal' }, sans_serif_accent: { family: '"MG Instrument Serif", Georgia, serif', style: 'italic' }
}
/** The CSS that sets an effect's accent words (its catalog `accent` selector) in the brand font, or ''. */
export function accentCss(selector: string | undefined, accentFont: string | undefined): string {
  const face = accentFont ? ACCENT_FACE[accentFont] : undefined
  return selector && face ? `${selector} { font-family: ${face.family} !important; font-style: ${face.style} !important; }` : ''
}
const FONT_LOADS = ['800 40px "MG Jakarta"', '600 40px "MG Jakarta"', '400 40px "MG Jakarta"', '900 40px "MG Montserrat"', '40px "MG Anton"', '40px "MG Fraunces"', '40px "MG Caveat Brush"',
  'italic 40px "MG Instrument Serif"', '40px "MG Instrument Serif"', '400 40px "MG Mono"', '700 40px "MG Mono"', '800 40px "MG Poppins"']

function rgb(hex: string): [number, number, number] {
  const clean = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#2F5BFF'
  return [1, 3, 5].map((i) => parseInt(clean.slice(i, i + 2), 16)) as [number, number, number]
}
const mixRgb = (a: [number, number, number], b: [number, number, number], k: number): string => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(', ')})`

const px = (n: number): string => `${Math.round(n * 10) / 10}px`

/**
 * The theme tokens for a brand color and hook font, the brand as the accent. `tone` is the video's one look (the
 * engine's graphics director sets it on every effect): 'dark' (default) light ink on dark glass over the video,
 * 'light' dark ink on white.
 */
export function fxTokens(color: string, font: string, frame = 1080, tone: 'dark' | 'light' = 'dark'): Record<string, string> {
  const c = rgb(color)
  const light = tone === 'light'
  const brand = fxBrand(c, tone)
  const ink = light
    ? { '--fg': '#0F172A', '--muted': 'rgba(51, 65, 85, 0.78)', '--surface': 'rgba(255, 255, 255, 0.96)', '--border': 'rgba(15, 23, 42, 0.12)' }
    : { '--fg': '#F8FAFC', '--muted': 'rgba(226, 232, 240, 0.74)', '--surface': 'rgba(15, 18, 26, 0.9)', '--border': 'rgba(255, 255, 255, 0.16)' }
  return {
    '--bg': 'transparent', ...ink,
    '--brand': brand, '--brand-deep': light ? brand : fxMarkerFill(c), '--accent': brand, '--accent-2': mixRgb(c, light ? [0, 0, 0] : [255, 255, 255], light ? .25 : .38),
    '--font-display': DISPLAY[font] ?? DISPLAY.clean, '--font-body': '"MG Jakarta", sans-serif', '--font-mono': 'MG Mono, ui-monospace, monospace',
    // Spacing is measured against the whole frame, as in a HyperFrames composition (its theme packs say 1.2cqmin of a
    // 1080-high frame): inside our box `cqmin` would be the band's, and gaps between words would shrink to nothing.
    '--radius': px(frame * .03), '--space-1': px(frame * .012), '--space-2': px(frame * .024), '--space-3': px(frame * .04),
    '--dur-beat': '0.4s', '--ease-standard': 'cubic-bezier(0.215, 0.61, 0.355, 1)', '--ease-emphasis': 'cubic-bezier(0.19, 1, 0.22, 1)'
  }
}

/** Where the unit draws (pixels): its band (inset from the sides) or the whole frame. */
export function fxBox(spec: Pick<GraphicRenderSpec, 'width' | 'height' | 'box' | 'size'>, effect: Pick<FxEffect, 'frame' | 'aspect'>): { x: number; y: number; w: number; h: number } {
  const { width: W, height: H } = spec
  if (effect.frame === 'full') return { x: 0, y: 0, w: W, h: H }
  const top = spec.box.top * H, h = Math.max(40, (spec.box.bottom - spec.box.top) * H)
  const side = Math.min(W, H) * (spec.size === 'compact' ? .1 : spec.size === 'stage' ? .035 : .05)
  // A band across part of the frame (a YouTube side panel or lower third): the effect stays inside it.
  if (spec.box.left !== undefined || spec.box.right !== undefined) {
    const x0 = (spec.box.left ?? 0) * W, x1 = (spec.box.right ?? 1) * W
    const w = Math.round(Math.min(x1 - x0, h * (effect.aspect ?? 2.4)))
    return { x: Math.round(x0 + (x1 - x0 - w) / 2), y: Math.round(top), w, h: Math.round(h) }
  }
  // Never wider than the unit's widest shape (a wide band of a 16:9 frame would stretch a card).
  const w = Math.round(Math.min(W - 2 * side, h * (effect.aspect ?? 2.4)))
  return { x: Math.round((W - w) / 2), y: Math.round(top), w, h: Math.round(h) }
}

export { FX_FIT, FX_MIN_TYPE, fxAnchorShift, fxFit, fxMinType }
/** Effects whose picture pushes in slowly (a page in a browser window). */
const PUSH_IN = new Set(['browser-device-stage'])
const NONE = 'rgba(0, 0, 0, 0)'
const SHAPES = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'image', 'use'])
/**
 * Where the unit draws ink (stage pixels, unscaled): the union of its words, pictures, shapes and filled or bordered
 * boxes that are on screen (not faded out, not cut off by a parent that clips). Null when nothing is drawn.
 */
export function inkBox(root: ShadowRoot, stage: HTMLElement): Rect | null {
  const origin = stage.getBoundingClientRect()
  const k = origin.width / Math.max(1, stage.offsetWidth) || 1
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  type Clip = { l: number; t: number; r: number; b: number }
  const add = (r: DOMRect, clip: Clip): void => {
    if (r.width < .5 || r.height < .5) return
    const l = Math.max(r.left, clip.l), t = Math.max(r.top, clip.t), rr = Math.min(r.right, clip.r), b = Math.min(r.bottom, clip.b)
    if (rr - l < .5 || b - t < .5) return
    x0 = Math.min(x0, l); y0 = Math.min(y0, t); x1 = Math.max(x1, rr); y1 = Math.max(y1, b)
  }
  const visit = (el: Element, clip: Clip, opacity: number): void => {
    if (el.tagName === 'STYLE' || el.tagName === 'SCRIPT' || el.tagName === 'TEMPLATE' || el.tagName === 'defs' || el.tagName === 'clipPath' || el.tagName === 'mask') return
    const cs = getComputedStyle(el)
    if (cs.display === 'none') return
    const alpha = opacity * (parseFloat(cs.opacity) || 0)
    if (alpha < .05) return
    const rect = el.getBoundingClientRect()
    const shown = cs.visibility !== 'hidden'
    const svg = el instanceof SVGElement
    if (shown) {
      const tag = el.tagName.toLowerCase()
      if (svg ? SHAPES.has(tag) : tag === 'img' || tag === 'canvas' || tag === 'video'
        || cs.backgroundColor !== NONE || cs.backgroundImage !== 'none' || (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopColor !== NONE && cs.borderTopStyle !== 'none')) add(rect, clip)
      for (const node of el.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim() || (svg && tag !== 'text')) continue
        const range = document.createRange(); range.selectNodeContents(node)
        add(range.getBoundingClientRect(), clip)
      }
    }
    const clips = !svg && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')
    const inner = clips ? { l: Math.max(clip.l, rect.left), t: Math.max(clip.t, rect.top), r: Math.min(clip.r, rect.right), b: Math.min(clip.b, rect.bottom) } : clip
    for (const child of el.children) visit(child, inner, alpha)
  }
  const all = { l: -Infinity, t: -Infinity, r: Infinity, b: Infinity }
  for (const child of root.children) visit(child, all, 1)
  if (!(x1 > x0 && y1 > y0)) return null
  return { x: (x0 - origin.left) / k, y: (y0 - origin.top) / k, w: (x1 - x0) / k, h: (y1 - y0) / k }
}

/**
 * Raises every word set smaller than `min` frame pixels (once the unit is drawn at `scale`) to `min`, at most 3× its
 * own size (over rounds: fxFit may draw it smaller once its words wrap, and it is raised again). Words in pictures and SVG drawings keep theirs. True when any changed.
 */
export function raiseType(root: ShadowRoot, stage: HTMLElement, min: number, scale: number): boolean {
  const k = stage.getBoundingClientRect().width / Math.max(1, stage.offsetWidth) || 1
  const raise: [HTMLElement, number][] = []
  const seen = new Set<Element>()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement
    if (!el || seen.has(el) || !n.textContent?.trim() || !(el instanceof HTMLElement) || el.closest('style, svg')) continue
    seen.add(el)
    if (!el.offsetWidth) continue
    const size = parseFloat(getComputedStyle(el).fontSize)
    // Drawn size: its font, any transform of the unit's own around it, and the fit.
    const drawn = size * (el.getBoundingClientRect().width / el.offsetWidth / k) * scale
    // Never past 3x the unit's own size (its first size is kept on the element across rounds).
    const own = parseFloat(el.dataset.ccOwnFont ?? '') || size
    if (size > 0 && drawn > 0 && drawn < min * .97 && size < own * 3 - .05) { el.dataset.ccOwnFont = String(own); raise.push([el, Math.min(own * 3, size * min / drawn)]) }
  }
  for (const [el, px] of raise) el.style.setProperty('font-size', `${px.toFixed(1)}px`, 'important')
  return raise.length > 0
}

let measureCanvas: CanvasRenderingContext2D | null = null
/** How wide a text is, and the cap height, in a computed font (canvas metrics: the face's own, as loaded). */
function textMetrics(cs: CSSStyleDeclaration, text: string): { width: number; cap: number } {
  measureCanvas ??= document.createElement('canvas').getContext('2d')
  const size = parseFloat(cs.fontSize) || 16
  if (!measureCanvas) return { width: text.length * size * .25, cap: size * .7 }
  measureCanvas.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
  const cap = measureCanvas.measureText('H').actualBoundingBoxAscent
  return { width: measureCanvas.measureText(text).width, cap: cap > 0 ? cap : size * .7 }
}
/**
 * Places each hand-drawn word mark (catalog `word_mark`) from its word as laid out now: the word's ink box from its
 * text, its baseline from a probe set on it, its cap height from its own face (the brand's accent face included), so a
 * highlight, underline or circle sits on the word whatever its face and size, after the fit raised or scaled it. The
 * word keeps a normal word space either side; it gets a little more only when a circle's overhang needs it.
 */
export function placeWordMarks(root: ShadowRoot, effect: Pick<FxEffect, 'word_mark'>): number {
  const spec = effect.word_mark
  if (!spec) return 0
  let placed = 0
  for (const host of root.querySelectorAll<HTMLElement>(spec.host)) {
    const word = host.querySelector<HTMLElement>(spec.word)
    const mark = host.querySelector<SVGElement>(spec.mark)
    if (!word || !mark || !host.offsetWidth) continue
    const hostRect = host.getBoundingClientRect()
    const k = hostRect.width / Math.max(1, host.offsetWidth) || 1
    const range = document.createRange(); range.selectNodeContents(word)
    const ink = range.getBoundingClientRect()
    const probe = document.createElement('span')
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;'
    word.appendChild(probe)
    const baseline = (probe.getBoundingClientRect().bottom - hostRect.top) / k
    probe.remove()
    const wordCs = getComputedStyle(word)
    const outer = getComputedStyle(host.parentElement ?? host)
    const space = textMetrics(outer, ' ').width + (parseFloat(outer.wordSpacing) || 0)
    // (Letter spacing adds after the last letter too: it is not ink.)
    const tail = parseFloat(wordCs.letterSpacing) || 0
    const { box, margin } = wordMarkBox(host.dataset.markerStyle ?? 'highlight', {
      left: (ink.left - hostRect.left) / k, right: (ink.right - hostRect.left) / k - Math.max(0, tail), baseline, cap: textMetrics(wordCs, 'H').cap
    }, space)
    for (const [key, v] of [['left', box.x], ['top', box.y], ['width', box.w], ['height', box.h]] as const) mark.style.setProperty(key, `${v.toFixed(2)}px`, 'important')
    mark.style.setProperty('bottom', 'auto', 'important'); mark.style.setProperty('right', 'auto', 'important')
    host.style.setProperty('margin-left', `${margin.toFixed(2)}px`, 'important'); host.style.setProperty('margin-right', `${margin.toFixed(2)}px`, 'important')
    placed++
  }
  return placed
}

/** Mounts one effect graphic in `host` (the frame, spec.width × spec.height). */
export function mountEffect(host: HTMLElement, spec: GraphicRenderSpec): MountedEffect {
  const effect = fxEffect(spec.fields.effect)
  const frame = document.createElement('div')
  frame.className = 'fx-frame'
  frame.style.width = `${spec.width}px`; frame.style.height = `${spec.height}px`
  host.appendChild(frame)
  const empty: MountedEffect = { seek: () => {}, destroy: () => frame.remove(), ready: Promise.resolve() }
  const load = effect && loadEffect(effect.id)
  // Without its needed words a unit would fall back to its own sample words: nothing is drawn instead. Its pictures
  // come with the spec (spec.image, spec.image_b), not in its fields: they count as given when the spec has them.
  const given = { ...spec.fields }
  for (const [field, url] of Object.entries(pictureUrls(spec))) if (url) given[field] = field
  if (!effect || !load || !fxHasContent(given)) return empty
  const timing = fxTiming(effect, spec.fields, spec.duration_ms)
  const ownExit = effect.own_exit === true || (effect.fixed?.exit !== undefined && effect.fixed.exit !== 'none')
  const box = fxBox(spec, effect)
  const stage = document.createElement('div')
  const tone = spec.fields.theme === 'light' ? 'light' : 'dark'
  stage.className = `fx-stage${effect.backing === 'glass' && spec.fields.backing !== 'none' ? ' fx-glass' : ''}${tone === 'light' ? ' fx-light' : ''}`
  // The unit's scale is applied only once it is built (apply), so anything it measures while building is unscaled.
  Object.assign(stage.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`, visibility: 'hidden' })
  // The glass keeps its size on a scaled unit (it backs the words, not the box); once built it hugs the drawing (fit).
  if (effect.scale && effect.scale > 1) stage.style.setProperty('--fx-glass-inset', `${((1 - .92 / effect.scale) / 2 * 100).toFixed(2)}% ${((1 - .96 / effect.scale) / 2 * 100).toFixed(2)}%`)
  frame.appendChild(stage)
  const glassy = stage.classList.contains('fx-glass')
  // How the unit is drawn into its box (fxFit): its scale and shift, worked out once it is built.
  let fitted = { scale: effect.scale ?? 1, dx: 0, dy: 0 }
  const shadow = stage.attachShadow({ mode: 'open' })
  const tokens = fxTokens(spec.color, spec.font, Math.min(spec.width, spec.height), tone)
  let timeline: Timeline | null = null
  let context: gsap.Context | null = null
  let pending = -1
  let alive = true
  // The hand-drawn mark over a picture: its strokes and when it draws (seconds into the unit).
  let mark: { paths: SVGPathElement[]; lengths: number[]; at: number } | null = null
  // A screenshot's slow push-in toward the part that matters: the picture's slot.
  let push: HTMLElement | null = null

  const apply = (ms: number): void => {
    // Nothing before the unit's own clock starts (its beat lands on the word `lead` ms in): no empty glass waiting for it.
    const shown = ms >= timing.lead_ms && ms < spec.duration_ms
    stage.style.visibility = shown ? 'visible' : 'hidden'
    if (!shown || !timeline) return
    // The unit's own clock: it starts `lead` ms in (its beat lands on the word) and fades out at the end.
    const local = Math.max(0, ms - timing.lead_ms)
    timeline.pause()
    timeline.totalTime(local / 1000, false)
    for (const animation of shadow.getAnimations()) { animation.pause(); animation.currentTime = local }
    if (mark) drawMark(mark, local / 1000)
    if (push) {
      const k = pushScale(local / 1000, timing.unit_ms / 1000).toFixed(4)
      for (const child of push.children) (child as HTMLElement).style.transform = `scale(${k})`
    }
    // Leave accelerates: the last few frames shrink a little and go (units that leave on their own keep theirs).
    const out = ownExit ? 0 : easeIn(1 - (spec.duration_ms - ms) / FX_MOTION.out_ms)
    // The glass comes in with the unit (one move), not ahead of it.
    const arrive = timing.lead_ms > 0 ? Math.min(1, (ms - timing.lead_ms) / (FX_MOTION.move_s * 1000)) : 1
    stage.style.opacity = String(arrive * (1 - out))
    // The glass goes with the words when they lift off on their own (it never stays behind, empty).
    if (glassy) stage.style.setProperty('--fx-glass-o', String(fxGlassLeft(spec.duration_ms - ms, FX_MOTION.glass_out_ms)))
    stage.style.transform = `scale(${fitted.scale * (1 - (1 - FX_MOTION.out_scale) * out)}) translate(${fitted.dx}px, ${fitted.dy}px)`
  }
  /** The unit's clock set to `local` ms (no scale, no fade: for measuring it). */
  const setClock = (local: number): void => {
    timeline?.pause()
    timeline?.totalTime(local / 1000, false)
    for (const animation of shadow.getAnimations()) { animation.pause(); animation.currentTime = local }
  }

  const ready = (async (): Promise<void> => {
    try { await Promise.all(FONT_LOADS.map((f) => document.fonts.load(f).catch(() => []))) } catch { /* system fonts */ }
    const unit = await load
    // The member's pictures (decoded first, so the unit measures them laid out).
    const urls = pictureUrls(spec)
    const pictures: Record<string, Picture | null> = {}
    for (const slot of effect.media ?? []) pictures[slot.field] = await loadPicture(urls[slot.field])
    if (!alive) return
    // A photo effect takes its picture's shape inside its band (nothing drawn around the picture).
    const first = effect.fit_media ? pictures[effect.media?.[0]?.field ?? ''] : null
    if (first) {
      const ratio = first.width / first.height
      const w = Math.round(Math.min(box.w, box.h * ratio)), h = Math.round(Math.min(box.h, box.w / ratio))
      Object.assign(stage.style, { left: `${box.x + Math.round((box.w - w) / 2)}px`, top: `${box.y + Math.round((box.h - h) / 2)}px`, width: `${w}px`, height: `${h}px` })
    }
    const vars = fxVariables(effect, spec.fields, timing)
    const tokenCss = Object.entries(tokens).map(([k, v]) => `${k}: ${v} !important;`).join(' ')
    // Tokens on the host and re-declared on the unit's roots, as the theme contract's QA harness does.
    shadow.innerHTML = `<style>:host, #root, [data-composition-id] { ${tokenCss} } :host { all: initial; position: absolute; inset: 0; display: block; container-type: size; }
      :where(#root, #root *) { word-spacing: ${WORD_SPACING}; }
      ${effect.css_rules ?? ''}
      ${accentCss(effect.accent, spec.accent_font)}
      .cc-fx-snippet { position: absolute; inset: 0; display: grid; place-items: center; container-type: size; overflow: visible; font-family: var(--font-body); color: var(--fg); }
      ${unit.styles}
      .cc-media { position: absolute; inset: 0; overflow: hidden; }
      .cc-media > img { display: block; width: 100%; height: 100%; object-fit: cover; }
      .cc-mark { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; z-index: 5; }
      .cc-mark path { fill: none; stroke: var(--brand); stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 0.15em 0.3em rgba(0, 0, 0, 0.35)); }</style>${unit.markup}`
    // Pictures in the unit's own slots replace its placeholder; host-level template slots are handed over below.
    const templates = new Map<string, HTMLTemplateElement>()
    for (const slot of effect.media ?? []) {
      const picture = pictures[slot.field]
      if (!picture) continue
      if (slot.template) {
        const tpl = document.createElement('template')
        tpl.content.appendChild(pictureNode(picture, slot))
        templates.set(slot.template, tpl)
        continue
      }
      for (const el of shadow.querySelectorAll<HTMLElement>(slot.selector ?? '')) {
        el.replaceChildren(pictureNode(picture, slot))
        if (getComputedStyle(el).position === 'static') el.style.position = 'relative'
        el.style.overflow = 'hidden'
      }
    }
    const slotDoc = {
      querySelector: (selector: string): HTMLTemplateElement | null => templates.get(/data-slot="([^"]+)"/.exec(selector)?.[1] ?? '') ?? null,
      importNode: <T extends Node>(node: T, deep?: boolean): T => document.importNode(node, deep),
      createElement: (tag: string): HTMLElement => document.createElement(tag)
    }
    const seconds = String(Math.max(0.1, timing.unit_ms / 1000))
    const root = shadow.getElementById('root')
    if (root) {
      root.dataset.duration = seconds
      for (const [key, value] of Object.entries(effect.css ?? {})) root.style.setProperty(key, value, 'important')
    }
    for (const clip of shadow.querySelectorAll<HTMLElement>('[data-duration]')) clip.dataset.duration = seconds
    const registry: Record<string, Timeline> = {}
    const locals: Record<string | symbol, unknown> = {
      __timelines: registry, __hyperframes: { getVariables: () => ({ ...vars }) }, __hfVariables: { ...vars }, __ccMotion: FX_MOTION, __ccFit: { stepLabels: fitStepLabels }, __ccSlotDoc: slotDoc, gsap, CustomEase
    }
    const realFonts = document.fonts
    let ctx: gsap.Context | null = null
    // Font promises resolve inside the unit's scope, so selector text in a deferred build is still scoped.
    const fonts = new Proxy(realFonts, { get: (target, key) => key === 'ready' ? { then: (fn: () => void, fail?: (e: unknown) => void) => target.ready.then(() => { ctx?.add(fn) }, fail) } : Reflect.get(target, key, target) })
    const scopedDocument = new Proxy(document, {
      get(target, key) {
        if (key === 'getElementById') return (id: string) => shadow.getElementById(id)
        if (key === 'querySelector') return (s: string) => shadow.querySelector(s)
        if (key === 'querySelectorAll') return (s: string) => shadow.querySelectorAll(s)
        if (key === 'fonts') return fonts
        const value = Reflect.get(target, key, target)
        return typeof value === 'function' ? value.bind(target) : value
      }
    })
    const scopedWindow = new Proxy(window, {
      get(target, key) {
        if (key in locals) return locals[key]
        if (key === 'document') return scopedDocument
        const value = Reflect.get(target, key, target)
        return typeof value === 'function' && !/^[A-Z]/.test(String(key)) ? value.bind(target) : value
      },
      set(_target, key, value) { locals[key] = value; return true },
      has(target, key) { return key in locals || key in target }
    })
    try {
      ctx = gsap.context(() => unit.run(gsap, CustomEase, scopedWindow, scopedDocument), shadow as unknown as Element)
    } catch (error) {
      console.error(`Effect ${effect.id} failed to build`, error)
    }
    context = ctx
    // Nothing is shown for words that weren't given (a byline without a name, stars without a rating).
    for (const { field, selector } of effect.hide_empty ?? []) {
      if ((spec.fields[field] ?? '').trim()) continue
      for (const el of shadow.querySelectorAll<HTMLElement>(selector)) el.style.setProperty('display', 'none', 'important')
    }
    // A unit may build after its fonts are ready (a promise turn or two).
    for (let i = 0; i < 6 && !Object.keys(registry).length; i++) await new Promise((r) => setTimeout(r, 16))
    timeline = registry[effect.id] ?? Object.values(registry)[0] ?? null
    // Sized to its box: measured once it has settled (most of the way through, before it leaves), the same in the
    // editor and the bake. Photo effects already take their picture's shape; full-frame ones cover the frame.
    if (effect.frame !== 'full' && !effect.fit_media) {
      const settled = Math.max(0, Math.min(timing.unit_ms * .8, timing.unit_ms - 500))
      Object.assign(stage.style, { visibility: 'visible', opacity: '0', transform: 'none' })
      // Measured at two moments (mid-way and settled): a unit whose words change (a line swapped for another, a number
      // counting) is fitted to all of them, not only to the last.
      const measure = (): Rect | null => {
        // The word marks follow their word as it is now (sizes raised, faces loaded).
        setClock(settled)
        placeWordMarks(shadow, effect)
        let out: Rect | null = null
        for (const at of [Math.round(timing.unit_ms * .45), settled]) {
          setClock(at)
          const r = inkBox(shadow, stage)
          if (!r) continue
          if (!out) { out = r; continue }
          const x = Math.min(out.x, r.x), y = Math.min(out.y, r.y)
          out = { x, y, w: Math.max(out.x + out.w, r.x + r.w) - x, h: Math.max(out.y + out.h, r.y + r.h) - y }
        }
        setClock(settled)
        return out
      }
      const size = spec.size === 'stage' || spec.size === 'compact' ? spec.size : 'card'
      let ink = measure()
      const m = Math.min(spec.width, spec.height), glass = stage.classList.contains('fx-glass')
      const pad = { x: glass ? m * .045 : 0, y: glass ? m * .035 : 0 }
      const area = { w: stage.offsetWidth, h: stage.offsetHeight }
      // A card at the top or bottom keeps to that edge of its band (the stage and the middle stay centered).
      const anchor = size === 'stage' ? 'center' : spec.placement === 'top' ? 'top' : spec.placement === 'bottom' ? 'bottom' : 'center'
      fitted = fxFit(ink, area, size, effect.scale ?? 1, pad)
      // Small labels (a chart's axis, a chip, a byline) are set bigger until they read on a phone, then it fits again.
      // Words effects read on a phone: a short line at a cap height of about 54 px (fxMinType).
      const said = (spec.fields.text ?? '').trim().split(/\s+/).filter(Boolean).length
      // Raised for the scale it is drawn at, fitted again (longer words wrap, and the fit may scale it down): again until
      // the words keep their minimum as drawn (a few rounds at most; never past 3x their own size).
      const min = fxMinType(size, effect.group, said) * m / 1080
      for (let round = 0; round < 4 && ink && !effect.own_type && raiseType(shadow, stage, min, fitted.scale); round++) {
        ink = measure()
        fitted = fxFit(ink, area, size, effect.scale ?? 1, pad)
      }
      setClock(settled)
      placeWordMarks(shadow, effect)
      setClock(0)
      Object.assign(stage.style, { visibility: 'hidden', opacity: '' })
      // The glass backs the drawing, with a margin (in frame pixels) around it.
      if (ink && ink.w >= 4) {
        const padX = m * .045 / fitted.scale, padY = m * .035 / fitted.scale
        const l = ink.x + fitted.dx - padX, t = ink.y + fitted.dy - padY
        const r = stage.offsetWidth - (ink.x + ink.w + fitted.dx) - padX, b = stage.offsetHeight - (ink.y + ink.h + fitted.dy) - padY
        stage.style.setProperty('--fx-glass-inset', [t, r, b, l].map((v) => `${Math.round(v)}px`).join(' '))
        // The whole box (the drawing and its glass) moves to its band's edge.
        const shift = fxAnchorShift(ink.h, fitted.scale, area.h, pad.y, anchor)
        if (shift) stage.style.top = `${box.y + shift}px`
      }
    }
    // The member's mark (a circle, an underline, an arrow or a box) on the part of their picture they pointed at.
    const wanted = fxMark(spec.fields)
    const target = wanted && shadow.querySelector<HTMLElement>(`.cc-media[data-field="${wanted.on}"]`)
    const picture = wanted && pictures[wanted.on]
    if (wanted && target && picture) {
      const drawn = markPath(wanted.shape, wanted.box, picture, { w: target.clientWidth, h: target.clientHeight }, target.dataset.align === 'top' ? 'top' : 'center')
      if (drawn) {
        const NS = 'http://www.w3.org/2000/svg'
        const svg = document.createElementNS(NS, 'svg')
        svg.setAttribute('class', 'cc-mark')
        svg.setAttribute('width', String(target.clientWidth)); svg.setAttribute('height', String(target.clientHeight))
        svg.setAttribute('viewBox', `0 0 ${target.clientWidth} ${target.clientHeight}`)
        const paths = drawn.strokes.map((d) => {
          const path = document.createElementNS(NS, 'path')
          path.setAttribute('d', d); path.setAttribute('stroke-width', String(drawn.width))
          svg.appendChild(path)
          return path
        })
        target.appendChild(svg)
        // It draws once the unit has settled (just after its beat), and by mid-way through a short one at the latest.
        mark = { paths, lengths: paths.map((p) => p.getTotalLength() + 2), at: Math.min((effect.sync_s ?? 1) + 0.25, Math.max(0.8, timing.unit_ms / 1000 * 0.45)) }
        drawMark(mark, -1)
      }
    }
    // The browser window pushes in toward the member's box, or the page's headline, so the page reads on a phone.
    if (PUSH_IN.has(effect.id)) {
      const field = effect.media?.[0]?.field ?? 'image'
      const slotEl = shadow.querySelector<HTMLElement>(`.cc-media[data-field="${field}"]`)
      const pic = pictures[field]
      if (slotEl && pic) {
        const region = wanted?.on === field ? wanted.box : null
        const o = pushOrigin(pic, { w: slotEl.clientWidth, h: slotEl.clientHeight }, slotEl.dataset.align === 'top' ? 'top' : 'center', region)
        for (const child of slotEl.children) Object.assign((child as HTMLElement).style, { transformOrigin: `${o.x.toFixed(1)}px ${o.y.toFixed(1)}px`, willChange: 'transform' })
        push = slotEl
      }
    }
    if (!alive) { ctx?.revert(); return }
    apply(pending)
  })()

  return {
    seek(ms) { pending = ms; apply(ms) },
    ready,
    destroy() {
      alive = false
      try { timeline?.kill(); context?.revert() } catch { /* already gone */ }
      frame.remove()
    }
  }
}
