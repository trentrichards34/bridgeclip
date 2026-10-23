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
 * brand color is the accent, ink is light over the video, the display face follows the hook's font, and every other
 * face is one of the app's bundled fonts. The background stays transparent. Spoken word times (`cue_ms`) become the
 * unit's `cues`, or shift it so its main beat lands on the word (fxTiming).
 */
import gsap from 'gsap'
import { CustomEase } from 'gsap/CustomEase'
import './fx.css'
import { FX_MOTION, easeIn } from './motion'
import { fxEffect, fxTiming, fxVariables, type FxEffect } from '../../../shared/fx-catalog'
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

const modules = import.meta.glob('./vendor/*.html', { query: '?fx' }) as Record<string, () => Promise<FxModule>>
/** The compiled unit for an effect, or null when it isn't vendored. */
export function loadEffect(id: string): Promise<FxModule> | null {
  const load = modules[`./vendor/${id}.html`]
  return load ? load() : null
}

/** The display face per hook font (templates.ts DISPLAY); every other face is bundled too. */
const DISPLAY: Record<string, string> = {
  clean: '"MG Jakarta", "MG Montserrat", sans-serif', serif: '"MG Fraunces", Georgia, serif', condensed: '"MG Anton", Impact, sans-serif',
  marker: '"MG Caveat Brush", cursive', sans_serif_accent: '"MG Jakarta", "MG Montserrat", sans-serif'
}
const FONT_LOADS = ['800 40px "MG Jakarta"', '600 40px "MG Jakarta"', '400 40px "MG Jakarta"', '900 40px "MG Montserrat"', '40px "MG Anton"', '40px "MG Fraunces"', '40px "MG Caveat Brush"',
  'italic 40px "MG Instrument Serif"', '40px "MG Instrument Serif"', '400 40px "MG Mono"', '700 40px "MG Mono"', '800 40px "MG Poppins"']

function rgb(hex: string): [number, number, number] {
  const clean = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#2F5BFF'
  return [1, 3, 5].map((i) => parseInt(clean.slice(i, i + 2), 16)) as [number, number, number]
}
const lum = ([r, g, b]: [number, number, number]): number => 0.2126 * r + 0.7152 * g + 0.0722 * b
const mixRgb = (a: [number, number, number], b: [number, number, number], k: number): string => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(', ')})`

/** The theme tokens for a brand color and hook font: light ink over the video, the brand as the accent. */
export function fxTokens(color: string, font: string): Record<string, string> {
  const c = rgb(color)
  // On dark glass and over video a very dark brand color is lifted so it still reads.
  const brand = lum(c) >= 90 ? `rgb(${c.join(', ')})` : mixRgb(c, [255, 255, 255], Math.min(.55, (90 - lum(c)) / 160 + .18))
  return {
    '--bg': 'transparent', '--fg': '#F8FAFC', '--muted': 'rgba(226, 232, 240, 0.74)', '--surface': 'rgba(15, 18, 26, 0.9)', '--border': 'rgba(255, 255, 255, 0.16)',
    '--brand': brand, '--accent': brand, '--accent-2': mixRgb(c, [255, 255, 255], .38),
    '--font-display': DISPLAY[font] ?? DISPLAY.clean, '--font-body': '"MG Jakarta", sans-serif', '--font-mono': 'MG Mono, ui-monospace, monospace',
    '--radius': '3cqmin', '--space-1': '1.2cqmin', '--space-2': '2.4cqmin', '--space-3': '4cqmin',
    '--dur-beat': '0.4s', '--ease-standard': 'cubic-bezier(0.215, 0.61, 0.355, 1)', '--ease-emphasis': 'cubic-bezier(0.19, 1, 0.22, 1)'
  }
}

/** Where the unit draws (pixels): its band (inset from the sides) or the whole frame. */
export function fxBox(spec: Pick<GraphicRenderSpec, 'width' | 'height' | 'box' | 'size'>, effect: Pick<FxEffect, 'frame' | 'aspect'>): { x: number; y: number; w: number; h: number } {
  const { width: W, height: H } = spec
  if (effect.frame === 'full') return { x: 0, y: 0, w: W, h: H }
  const top = spec.box.top * H, h = Math.max(40, (spec.box.bottom - spec.box.top) * H)
  const side = Math.min(W, H) * (spec.size === 'compact' ? .1 : spec.size === 'stage' ? .035 : .05)
  // Never wider than the unit's widest shape (a wide band of a 16:9 frame would stretch a card).
  const w = Math.round(Math.min(W - 2 * side, h * (effect.aspect ?? 2.4)))
  return { x: Math.round((W - w) / 2), y: Math.round(top), w, h: Math.round(h) }
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
  if (!effect || !load) return empty
  const timing = fxTiming(effect, spec.fields, spec.duration_ms)
  const ownExit = effect.fixed?.exit !== undefined && effect.fixed.exit !== 'none'
  const box = fxBox(spec, effect)
  const stage = document.createElement('div')
  stage.className = `fx-stage${effect.backing === 'glass' && spec.fields.backing !== 'none' ? ' fx-glass' : ''}`
  Object.assign(stage.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`, visibility: 'hidden',
    ...(effect.scale && effect.scale !== 1 ? { transform: `scale(${effect.scale})` } : {}) })
  // The glass keeps its size on a scaled unit (it backs the words, not the box).
  if (effect.scale && effect.scale > 1) stage.style.setProperty('--fx-glass-inset', `${((1 - .92 / effect.scale) / 2 * 100).toFixed(2)}% ${((1 - .96 / effect.scale) / 2 * 100).toFixed(2)}%`)
  frame.appendChild(stage)
  const shadow = stage.attachShadow({ mode: 'open' })
  const tokens = fxTokens(spec.color, spec.font)
  let timeline: Timeline | null = null
  let context: gsap.Context | null = null
  let pending = -1
  let alive = true

  const apply = (ms: number): void => {
    const shown = ms >= 0 && ms < spec.duration_ms
    stage.style.visibility = shown ? 'visible' : 'hidden'
    if (!shown || !timeline) return
    // The unit's own clock: it starts `lead` ms in (its beat lands on the word) and fades out at the end.
    const local = Math.max(0, ms - timing.lead_ms)
    timeline.pause()
    timeline.totalTime(local / 1000, false)
    for (const animation of shadow.getAnimations()) { animation.pause(); animation.currentTime = local }
    // Leave accelerates: the last few frames shrink a little and go (units that leave on their own keep theirs).
    const out = ownExit ? 0 : easeIn(1 - (spec.duration_ms - ms) / FX_MOTION.out_ms)
    stage.style.opacity = String(1 - out)
    stage.style.transform = `scale(${(effect.scale ?? 1) * (1 - (1 - FX_MOTION.out_scale) * out)})`
  }

  const ready = (async (): Promise<void> => {
    try { await Promise.all(FONT_LOADS.map((f) => document.fonts.load(f).catch(() => []))) } catch { /* system fonts */ }
    const unit = await load
    if (!alive) return
    const vars = fxVariables(effect, spec.fields, timing)
    const tokenCss = Object.entries(tokens).map(([k, v]) => `${k}: ${v} !important;`).join(' ')
    // Tokens on the host and re-declared on the unit's roots, as the theme contract's QA harness does.
    shadow.innerHTML = `<style>:host, #root, [data-composition-id] { ${tokenCss} } :host { all: initial; position: absolute; inset: 0; display: block; container-type: size; }
      .cc-fx-snippet { position: absolute; inset: 0; display: grid; place-items: center; container-type: size; overflow: visible; font-family: var(--font-body); color: var(--fg); }
      ${unit.styles}</style>${unit.markup}`
    const seconds = String(Math.max(0.1, timing.unit_ms / 1000))
    const root = shadow.getElementById('root')
    if (root) {
      root.dataset.duration = seconds
      for (const [key, value] of Object.entries(effect.css ?? {})) root.style.setProperty(key, value)
    }
    for (const clip of shadow.querySelectorAll<HTMLElement>('[data-duration]')) clip.dataset.duration = seconds
    const registry: Record<string, Timeline> = {}
    const locals: Record<string | symbol, unknown> = {
      __timelines: registry, __hyperframes: { getVariables: () => ({ ...vars }) }, __hfVariables: { ...vars }, __ccMotion: FX_MOTION, gsap, CustomEase
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
    // A unit may build after its fonts are ready (a promise turn or two).
    for (let i = 0; i < 6 && !Object.keys(registry).length; i++) await new Promise((r) => setTimeout(r, 16))
    timeline = registry[effect.id] ?? Object.values(registry)[0] ?? null
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
