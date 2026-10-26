/**
 * The sandbox that runs model-written custom graphics (custom-graphics.ts) and draws their stills and their bake.
 *
 * Threat model. A custom graphic's HTML, CSS and script are written by a language model from a transcript, so they
 * are untrusted code: a prompt-injected transcript, a confused model or a compromised provider could hand us code that
 * tries to read files, call out to the network (to leak what it can see), navigate or open windows, ask for
 * permissions, hang or exhaust the machine, or hide words from our checks. What it may do: draw pixels inside its band
 * for its few seconds, as a pure function of the timeline's time. How that is held:
 * 1. Before anything runs, shared/custom-graphics.checkComposition refuses what is outside the contract (size limit,
 *    an allow-list of tags, no event or source attributes, no URLs, no network/timer/clock/random/storage/eval code,
 *    no CSS that loads or animates by itself). It is a first line, not the boundary (JavaScript can hide names).
 * 2. The boundary: each composition runs alone in a NEW hidden offscreen window (never reused), in its own in-memory
 *    session partition, with sandbox, context isolation, no preload, no Node, no webview, no WebGL, no dev tools,
 *    dialogs off, audio muted, WebRTC kept off non-proxied UDP. The page is served from memory under a host that can't
 *    resolve (.invalid) by this session's own protocol handler; the handler answers only the document, GSAP and our
 *    bundled fonts, and every other request in the session (http, https, ws, file, data documents…) is cancelled
 *    before it leaves. The document carries a Content-Security-Policy (header and meta) of default-src 'none' that
 *    runs only the exact inline scripts we hashed (ours and the composition's one script: no eval, no new scripts),
 *    and allows only our fonts and data: images. Navigation, redirects, new windows, webviews, downloads and every
 *    permission are denied.
 * 3. Time and size: the load and every frame have hard timeouts (a hang or an endless loop crashes and drops the
 *    window), a whole graphic has an overall budget, the DOM size is checked after load, and the bake stops on cancel.
 * 4. Our checks of what it shows (its words, where its ink is, its type size) run in an isolated JavaScript world, so
 *    the composition's script can't patch the DOM methods we read with. The look is then judged on the pixels.
 */
import { spawn } from 'child_process'
import { createHash, randomUUID } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { BrowserWindow, nativeImage, session, type BrowserWindowConstructorOptions, type Session } from 'electron'
import { compositionParts, EXPLAINER_CAPTION_ZONE, lookCss, MAX_COMPOSITION_CHARS, MAX_COMPOSITION_ELEMENTS, SETTLED_STILL, type CustomGeometry, type CustomLook } from '../shared/custom-graphics'
import { GRAPHIC_FPS } from '../shared/motion-graphics'
import { GSAP_SOURCE } from './custom-graphics-assets'
import { getEnginePath } from './pipeline-runner'
import { resolveBinary } from './tools'

export const CUSTOM_PARTITION = 'custom-graphics-sandbox'
export const CUSTOM_HOST = 'graphic.creatorclips.invalid'
const ORIGIN = `https://${CUSTOM_HOST}`
/** Load (parse + the composition's script): a composition that takes longer is dropped. */
export const LOAD_TIMEOUT_MS = 8000
/** One seek + capture. */
export const FRAME_TIMEOUT_MS = 3000
/** A whole graphic (stills, or a 16 s bake at 30 fps). */
export const GRAPHIC_BUDGET_MS = 240_000
const ISOLATED_WORLD = 1207

/** Our bundled fonts under the family names the compositions use (shared CUSTOM_FONT_FAMILIES). */
const FONTS: { family: string; file: string; weight?: string; style?: string }[] = [
  { family: 'CG Montserrat', file: 'Montserrat-ExtraBold.ttf', weight: '100 850' }, { family: 'CG Montserrat', file: 'Montserrat-Black.ttf', weight: '851 1000' },
  { family: 'CG Jakarta', file: 'PlusJakartaSans.ttf', weight: '200 800' }, { family: 'CG Anton', file: 'Anton-Regular.ttf' },
  { family: 'CG Fraunces', file: 'Fraunces72pt-Black.ttf' }, { family: 'CG Caveat Brush', file: 'CaveatBrush-Regular.ttf' },
  { family: 'CG Instrument Serif', file: 'InstrumentSerif-Italic.ttf', style: 'italic' }, { family: 'CG Instrument Serif', file: 'InstrumentSerif-Regular.ttf', style: 'normal' }
]

/** What one composition is drawn with. */
export interface CustomScene {
  /** The composition (already passed checkComposition). */
  html: string
  geometry: CustomGeometry
  look: CustomLook
  durationMs: number
  /** The brand's logo as a data URL (var(--cg-logo)), or none. */
  logo?: string | null
  /** At bake: where the root sits and its scale (shared fitRoot); absent: at its authored place. */
  place?: { x: number; y: number; scale: number }
  /** A full-screen brand card behind it (a YouTube video's), its color. */
  backdrop?: string | null
  /** At bake: the composition's time per finished-clip time (a sped-up export plays it a little faster, so reveals stay on their words). */
  timeScale?: number
}

/** Stills: the composition alone (transparent) and over the video frame (what the grader sees). */
export interface StillsRequest extends CustomScene {
  times: number[]
  /** The video frame at the moment (a JPEG/PNG data URL), drawn behind the composite stills as the scene shows it. */
  frame?: string | null
  /** Size of the saved stills against the frame (0.5: half size). */
  scale: number
  /** Also measure the motion: frame-to-frame change every this many ms over the whole graphic (absent: not measured). */
  motionStepMs?: number
}

export interface StillsResult {
  /** Transparent PNGs of the composition alone, one per time. */
  transparent: Buffer[]
  /** The same moments over the frame, side by side in one JPEG (for the grader and the sheet). */
  composite: Buffer
  /** Every piece of text in the composition (for the words-said check). */
  texts: string[]
  /** What our checks found (empty when nothing). */
  problems: string[]
  /** The motion measure (with motionStepMs): per step, the mean change from the step before (0–1) and whether anything is drawn. */
  motion?: { change: number[]; visible: boolean[] }
}

/** Width the band is shrunk to for the motion measure (cheap, and still sees a few pixels of drift). */
export const MOTION_WIDTH = 180

/**
 * How much two small BGRA bitmaps of the band differ (mean absolute change per channel, 0–1) and how much of the
 * second is drawn at all (alpha coverage, 0–1). Plain loops over a 180 px wide thumbnail: a few ms per step.
 */
export function bitmapChange(previous: Buffer | null, next: Buffer): { change: number; coverage: number } {
  let diff = 0, drawn = 0
  const pixels = next.length >> 2
  for (let i = 0; i < next.length; i += 4) {
    if (next[i + 3] > 8) drawn++
    if (previous) diff += Math.abs(next[i] - previous[i]) + Math.abs(next[i + 1] - previous[i + 1]) + Math.abs(next[i + 2] - previous[i + 2]) + Math.abs(next[i + 3] - previous[i + 3])
  }
  return { change: previous && previous.length === next.length ? diff / (pixels * 4 * 255) : 0, coverage: pixels ? drawn / pixels : 0 }
}

export interface CustomSandbox {
  stills: (request: StillsRequest) => Promise<StillsResult>
  bake: (scene: CustomScene, out: string, cancelled?: () => boolean) => Promise<void>
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('base64')
const escapeAttr = (text: string): string => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** Runs before the composition: collects its errors. */
const PRE_SCRIPT = 'window.__cgErrors=[];window.addEventListener("error",function(e){window.__cgErrors.push(String(e&&e.message||"error").slice(0,200))});document.addEventListener("securitypolicyviolation",function(e){window.__cgErrors.push(("blocked "+e.violatedDirective+" "+(e.blockedURI||"")).slice(0,200))});'
/** Runs after it: the seek API our main process calls (in the page's world, where the timelines are). */
const POST_SCRIPT = `(function(){var tls=Array.isArray(window.__timelines)?window.__timelines.slice(0,8):[];
var ok=tls.length>0&&tls.every(function(t){return t&&typeof t.seek==='function'&&typeof t.pause==='function'});
if(ok){tls.forEach(function(t){t.pause()});if(window.gsap&&gsap.ticker){gsap.ticker.lagSmoothing(0);gsap.ticker.sleep()}}
window.__cg={ok:ok,errors:(window.__cgErrors||[]).slice(0,5),seek:function(ms){if(!ok)return false;var s=Math.max(0,ms)/1000;for(var i=0;i<tls.length;i++)tls[i].seek(s,false);void document.body.offsetHeight;return true}};})();`

/** The Content-Security-Policy for one composition document: only our GSAP, our hashed inline scripts and our fonts. */
export function customCsp(scripts: string[]): string {
  return ["default-src 'none'", `script-src ${ORIGIN}/gsap.js ${scripts.map((s) => `'sha256-${sha256(s)}'`).join(' ')}`, "style-src 'unsafe-inline'", `font-src ${ORIGIN}/fonts/`,
    'img-src data:', "connect-src 'none'", "media-src 'none'", "frame-src 'none'", "child-src 'none'", "worker-src 'none'", "object-src 'none'", "manifest-src 'none'",
    "base-uri 'none'", "form-action 'none'"].join('; ')
}

/** The page for one composition (and the CSP it is served with). `composite`: draw the video frame behind it. */
export function customDocument(scene: CustomScene, options: { frame?: string | null } = {}): { html: string; csp: string } {
  if (scene.html.length > MAX_COMPOSITION_CHARS) throw new Error('The custom graphic is too large.')
  const parts = compositionParts(scene.html)
  if (!parts) throw new Error('The custom graphic has no root.')
  const g = scene.geometry, r = g.root
  const place = scene.place ?? { x: r.x, y: r.y, scale: 1 }
  const fonts = FONTS.map((f) => `@font-face{font-family:'${f.family}';src:url('${ORIGIN}/fonts/${f.file}') format('truetype');font-weight:${f.weight ?? '100 1000'};font-style:${f.style ?? 'normal'};font-display:block}`).join('')
  const logo = scene.logo && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(scene.logo) ? `--cg-logo:url("${scene.logo}");` : '--cg-logo:none;'
  const frame = options.frame && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(options.frame) ? options.frame : null
  // The scene as the reel shows it, behind the composite stills only: the backdrop, the speaker's card, or the video.
  let bg = ''
  if (frame || g.kind !== 'card') {
    const ground = scene.look.ground === 'video' ? '#000' : scene.look.ground
    if (g.kind === 'visual') bg = `<div id="cg-bg" style="background:${ground}"></div>`
    else if ((g.kind === 'stage' || g.kind === 'explainer') && g.card) bg = `<div id="cg-bg" style="background:${ground}">${frame ? `<img alt="" src="${frame}" style="position:absolute;left:${g.card.x}px;top:${g.card.y}px;width:${g.card.width}px;height:${g.card.height}px;object-fit:cover;object-position:50% 30%;border-radius:${g.kind === 'explainer' ? 0 : 48}px">` : ''}</div>`
    else if (frame) bg = `<div id="cg-bg"><img alt="" src="${frame}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></div>`
  }
  const shell = `html,body{margin:0;padding:0;width:${g.width}px;height:${g.height}px;overflow:hidden;background:transparent}
:root{${lookCss(scene.look)};${logo}}
${fonts}
#cg-bg{position:absolute;inset:0;display:none}
#cg-backdrop{position:absolute;inset:0;background:${scene.backdrop && /^#[0-9a-f]{6}$/i.test(scene.backdrop) ? scene.backdrop : 'transparent'}}
#cg-band{position:absolute;left:${place.x}px;top:${place.y}px;width:${r.width}px;height:${r.height}px;transform:scale(${place.scale});transform-origin:0 0}
#cg-root{position:absolute!important;left:0!important;top:0!important;right:auto!important;bottom:auto!important;width:${r.width}px!important;height:${r.height}px!important;margin:0!important;overflow:hidden!important;transform:none!important;contain:layout paint;font-family:var(--cg-font-body);color:var(--cg-ink);-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
#cg-root *{box-sizing:border-box}`
  const scripts = [PRE_SCRIPT, parts.script, POST_SCRIPT]
  const csp = customCsp(scripts)
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeAttr(csp)}">
<style>${shell}</style><style>${parts.style}</style></head><body>${bg}${scene.backdrop ? '<div id="cg-backdrop"></div>' : ''}<div id="cg-band">${parts.root}</div>
<script>${PRE_SCRIPT}</script><script src="${ORIGIN}/gsap.js"></script><script>${parts.script}</script><script>${POST_SCRIPT}</script></body></html>`
  return { html, csp }
}

// ---------------------------------------------------------------------------
// The session and the window
// ---------------------------------------------------------------------------

/** Documents being served, by token (one per window, removed when it closes). */
const documents = new Map<string, { html: string; csp: string }>()
let fontCache: Map<string, Buffer> | null = null
function fontBytes(name: string): Buffer | null {
  fontCache ??= new Map()
  if (fontCache.has(name)) return fontCache.get(name)!
  if (!FONTS.some((f) => f.file === name)) return null
  const path = join(getEnginePath(), 'assets', 'fonts', name)
  const bytes = existsSync(path) ? readFileSync(path) : null
  if (bytes) fontCache.set(name, bytes)
  return bytes
}

/** What the session answers: the document by its token, GSAP and our fonts; nothing else. */
export function customResponse(url: string): { status: number; type?: string; body?: string | Buffer; csp?: string } {
  let target: URL
  try { target = new URL(url) } catch { return { status: 400 } }
  if (target.protocol !== 'https:' || target.host !== CUSTOM_HOST || target.username || target.password || target.search || target.hash) return { status: 403 }
  const doc = /^\/doc\/([a-f0-9-]{36})\.html$/.exec(target.pathname)
  if (doc) {
    const found = documents.get(doc[1])
    return found ? { status: 200, type: 'text/html; charset=utf-8', body: found.html, csp: found.csp } : { status: 404 }
  }
  if (target.pathname === '/gsap.js') return { status: 200, type: 'text/javascript; charset=utf-8', body: GSAP_SOURCE }
  const font = /^\/fonts\/([A-Za-z0-9-]+\.ttf)$/.exec(target.pathname)
  if (font) { const bytes = fontBytes(font[1]); return bytes ? { status: 200, type: 'font/ttf', body: bytes } : { status: 404 } }
  return { status: 404 }
}

/** Whether the sandbox session lets a request through at all (the protocol handler then answers it). */
export function customRequestAllowed(url: string): boolean {
  try {
    const target = new URL(url)
    return target.protocol === 'https:' && target.host === CUSTOM_HOST && !target.username && !target.password
  } catch { return false }
}

let configured: Session | null = null
function sandboxSession(): Session {
  const ses = session.fromPartition(CUSTOM_PARTITION, { cache: false })
  if (configured === ses) return ses
  ses.protocol.handle('https', async (request) => {
    const answer = customResponse(request.url)
    const headers: Record<string, string> = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' }
    if (answer.type) headers['Content-Type'] = answer.type
    if (answer.csp) headers['Content-Security-Policy'] = answer.csp
    return new Response(answer.body ? (typeof answer.body === 'string' ? answer.body : new Uint8Array(answer.body)) : null, { status: answer.status, headers })
  })
  // Everything else (http, ws, file, other hosts…) is cancelled before it leaves.
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !customRequestAllowed(details.url) }))
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.setDevicePermissionHandler(() => false)
  ses.on('will-download', (event) => event.preventDefault())
  ses.setSpellCheckerEnabled(false)
  configured = ses
  return ses
}

export function sandboxWindowOptions(width: number, height: number): BrowserWindowConstructorOptions {
  return {
    show: false, width, height, useContentSize: true, frame: false, transparent: true, backgroundColor: '#00000000', enableLargerThanScreen: true,
    paintWhenInitiallyHidden: true, skipTaskbar: true, focusable: false,
    webPreferences: {
      offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, javascript: true, images: true, webgl: false, plugins: false,
      spellcheck: false, devTools: false, backgroundThrottling: false, navigateOnDragDrop: false, disableDialogs: true, enableWebSQL: false,
      autoplayPolicy: 'document-user-activation-required', safeDialogs: true, partition: CUSTOM_PARTITION
    }
  }
}

/** Race `work` against a timer; on timeout `onTimeout` runs (it kills the page) and the error is thrown. */
async function timed<T>(work: Promise<T>, ms: number, message: string, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => { onTimeout(); reject(new Error(message)) }, ms) })])
  } finally { if (timer) clearTimeout(timer) }
}

/** One composition in its own window: load it, seek it, capture it, read it; then the window is destroyed. */
async function withPage<T>(scene: CustomScene, frame: string | null | undefined, work: (page: Page) => Promise<T>): Promise<T> {
  sandboxSession()
  const { html, csp } = customDocument(scene, { frame })
  const token = randomUUID()
  documents.set(token, { html, csp })
  const g = scene.geometry
  const w = new BrowserWindow(sandboxWindowOptions(g.width, g.height))
  const kill = (): void => { try { if (!w.isDestroyed()) { w.webContents.forcefullyCrashRenderer(); w.destroy() } } catch { /* gone */ } }
  const started = Date.now()
  try {
    w.setContentSize(g.width, g.height)
    w.webContents.setFrameRate(60)
    w.webContents.setAudioMuted(true)
    w.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    w.webContents.on('will-navigate', (event) => event.preventDefault())
    w.webContents.on('will-frame-navigate', (event) => { if (!event.isMainFrame || event.url !== `${ORIGIN}/doc/${token}.html`) event.preventDefault() })
    w.webContents.on('will-redirect', (event) => event.preventDefault())
    w.webContents.on('will-attach-webview', (event) => event.preventDefault())
    await timed(w.loadURL(`${ORIGIN}/doc/${token}.html`), LOAD_TIMEOUT_MS, 'The custom graphic took too long to load.', kill)
    // The load can settle before the last script ran (a blocked subresource ends loading early): wait for our runtime.
    let state: { ok: boolean; errors: string[]; ready: boolean } = { ok: false, errors: ['no runtime'], ready: false }
    for (let i = 0; i < 40 && !state.ready; i++) {
      if (i) await new Promise((resolve) => setTimeout(resolve, 100))
      state = await timed(w.webContents.executeJavaScript('window.__cg ? { ok: window.__cg.ok, errors: window.__cg.errors, ready: true } : { ok: false, errors: ["no runtime"], ready: false }'), FRAME_TIMEOUT_MS, 'The custom graphic stopped responding.', kill) as typeof state
    }
    if (!state.ok) {
      const seen = state.ready ? '' : await timed(w.webContents.executeJavaScript('JSON.stringify({ state: document.readyState, pre: Array.isArray(window.__cgErrors) ? window.__cgErrors.slice(0, 3) : null, gsap: typeof window.gsap, timelines: Array.isArray(window.__timelines) })'), FRAME_TIMEOUT_MS, 'The custom graphic stopped responding.', kill).catch(() => '') as string
      throw new Error(`The custom graphic's timeline didn't start${state.errors?.length ? ` (${String(state.errors[0]).slice(0, 160)})` : ''}.${seen ? ` ${seen.slice(0, 300)}` : ''}`)
    }
    const count = await timed(w.webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code: 'document.getElementsByTagName("*").length' }]), FRAME_TIMEOUT_MS, 'The custom graphic stopped responding.', kill) as number
    if (typeof count !== 'number' || count > MAX_COMPOSITION_ELEMENTS) throw new Error(`The custom graphic draws too many elements (${count}).`)
    // The frame behind the composite stills (and any data: picture) is decoded before the first capture.
    await timed(w.webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code: 'Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => null))).then(() => document.fonts.ready).then(() => true)' }]), LOAD_TIMEOUT_MS, 'The custom graphic took too long to load.', kill)
    const page: Page = {
      async seek(ms) {
        if (Date.now() - started > GRAPHIC_BUDGET_MS) { kill(); throw new Error('The custom graphic took too long to draw.') }
        const ok = await timed(w.webContents.executeJavaScript(`window.__cg.seek(${Math.max(0, ms).toFixed(3)})`), FRAME_TIMEOUT_MS, 'The custom graphic stopped responding.', kill)
        if (ok !== true) throw new Error('The custom graphic could not be drawn.')
      },
      async capture() {
        // Wait for the page to paint what was just changed (offscreen frames are painted on the next frame).
        await timed(w.webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code: 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))' }]), FRAME_TIMEOUT_MS, 'The custom graphic stopped responding.', kill)
        let image = await timed(w.webContents.capturePage(), FRAME_TIMEOUT_MS, 'The custom graphic stopped responding.', kill)
        const got = image.getSize()
        if (got.width !== g.width || got.height !== g.height) image = image.resize({ width: g.width, height: g.height, quality: 'best' })
        return image
      },
      async captureBand(rect) {
        await timed(w.webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code: 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))' }]), FRAME_TIMEOUT_MS, 'The custom graphic stopped responding.', kill)
        const image = await timed(w.webContents.capturePage(rect), FRAME_TIMEOUT_MS, 'The custom graphic stopped responding.', kill)
        const small = image.resize({ width: MOTION_WIDTH, height: Math.max(1, Math.round(MOTION_WIDTH * rect.height / Math.max(1, rect.width))), quality: 'good' })
        return small.toBitmap()
      },
      async isolated<R>(code: string) { return await timed(w.webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code }]), FRAME_TIMEOUT_MS, 'The custom graphic stopped responding.', kill) as R }
    }
    return await work(page)
  } finally {
    documents.delete(token)
    if (!w.isDestroyed()) w.destroy()
  }
}

interface Page {
  seek: (ms: number) => Promise<void>
  capture: () => Promise<Electron.NativeImage>
  /** The band (frame pixels) shrunk to MOTION_WIDTH wide, as a BGRA bitmap. */
  captureBand: (rect: { x: number; y: number; width: number; height: number }) => Promise<Buffer>
  isolated: <R>(code: string) => Promise<R>
}

/** Our reading of the composition (isolated world): its text, its ink box, words outside its area and the smallest type. */
const READ_CODE = `(() => {
  const root = document.getElementById('cg-root'); if (!root) return null
  const r = root.getBoundingClientRect()
  const hidden = (el) => { if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return true; let o = 1; for (let p = el; p && p !== root.parentElement; p = p.parentElement) o *= Number(getComputedStyle(p).opacity); return o < 0.08 }
  const skip = (el) => !!el.closest('defs,clipPath,mask,pattern,marker,symbol,style,script,title,desc')
  const texts = [], boxes = [], clipped = []; let small = Infinity, smallTop = Infinity
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n
  while ((n = walker.nextNode())) {
    const p = n.parentElement; const t = n.nodeValue.replace(/\\s+/g, ' ').trim()
    if (!p || !t || skip(p)) continue
    texts.push(t.slice(0, 200))
    if (hidden(p)) continue
    const range = document.createRange(); range.selectNodeContents(n)
    let out = false
    for (const b of range.getClientRects()) {
      if (b.width < 1 || b.height < 1) continue
      boxes.push([b.left, b.top, b.width, b.height])
      if (b.left < r.left - 3 || b.right > r.right + 3 || b.top < r.top - 3 || b.bottom > r.bottom + 3) out = true
      // Type in the top 80 px of the area is counted apart (an Explainer section's small section line lives there).
      const size = b.height / 1.25; if (b.bottom <= r.top + 80) { if (size < smallTop) smallTop = size } else if (size < small) small = size
    }
    if (out) clipped.push(t.slice(0, 40))
  }
  for (const el of root.querySelectorAll('*')) {
    if (skip(el) || hidden(el)) continue
    const svgShape = el instanceof SVGGeometryElement || el instanceof SVGUseElement
    const cs = getComputedStyle(el)
    const painted = el instanceof HTMLCanvasElement || (el instanceof HTMLElement && ((cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') || cs.backgroundImage !== 'none' || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0))
    if (!svgShape && !painted) continue
    const b = el.getBoundingClientRect(); if (b.width < 1 && b.height < 1) continue
    boxes.push([b.left, b.top, Math.max(1, b.width), Math.max(1, b.height)])
  }
  return { root: [r.left, r.top, r.width, r.height], texts, boxes: boxes.slice(0, 800), clipped: clipped.slice(0, 6), small: Number.isFinite(small) ? small : 0, smallTop: Number.isFinite(smallTop) ? smallTop : 0 }
})()`

interface Reading { root: [number, number, number, number]; texts: string[]; boxes: [number, number, number, number][]; clipped: string[]; small: number; smallTop?: number }

/** What a reading says is wrong (frame pixels; `face` in frame pixels when the graphic is over the speaker). */
export function readingProblems(reading: Reading, face: CustomGeometry['face'], explainer?: { captions: { top: number; bottom: number } } | null): string[] {
  const problems: string[] = []
  if (!reading.boxes.length) return ['Nothing is visible when the graphic is settled.']
  if (reading.clipped.length) problems.push(`Words run outside the graphic's area and get cut off: ${reading.clipped.map((t) => `“${t}”`).join(', ')}.`)
  // An Explainer section's line at the top may be small (26 px and up); everywhere else every label is 34 px or more.
  const smallest = explainer ? reading.small : Math.min(...[reading.small, reading.smallTop ?? 0].filter((v) => v > 0), Infinity)
  if (Number.isFinite(smallest) && smallest > 0 && smallest < 34) problems.push(`Some words are only about ${Math.round(smallest)} px tall; make every label at least 44 px.`)
  if (explainer && reading.smallTop && reading.smallTop < 24) problems.push(`The section line is only about ${Math.round(reading.smallTop)} px tall; make it 30-34 px.`)
  if (explainer) {
    // The captions' zone stays empty (we draw the captions there).
    const { top, bottom } = explainer.captions
    const inZone = reading.boxes.filter(([, y, , h]) => y < bottom - 2 && y + h > top + 2).length
    if (inZone) problems.push(`Something is drawn in the captions' zone (y ${Math.round(top - reading.root[1])}-${Math.round(bottom - reading.root[1])} of your area); keep it completely empty.`)
  }
  const [rx, ry, rw, rh] = reading.root
  const ink = reading.boxes.reduce((u, [x, y, w, h]) => [Math.min(u[0], x), Math.min(u[1], y), Math.max(u[2], x + w), Math.max(u[3], y + h)], [Infinity, Infinity, -Infinity, -Infinity])
  const sides = [['left', ink[0] - rx], ['right', rx + rw - ink[2]], ['top', ink[1] - ry], ['bottom', ry + rh - ink[3]]] as const
  const tight = sides.filter(([side, gap]) => gap < (side === 'left' || side === 'right' ? 12 : 4)).map(([side]) => side)
  if (tight.length) problems.push(`The drawing touches the ${tight.join(' and ')} edge of its area; keep 48 px from the sides and 28 px from the top and bottom.`)
  if (face) {
    let covered = 0
    for (const [x, y, w, h] of reading.boxes) {
      const ox = Math.max(0, Math.min(x + w, face.x + face.width) - Math.max(x, face.x)), oy = Math.max(0, Math.min(y + h, face.y + face.height) - Math.max(y, face.y))
      covered = Math.max(covered, ox * oy)
    }
    if (covered > face.width * face.height * .12) problems.push('It covers the speaker’s face; keep everything out of the face box.')
  }
  return problems
}

/** A row of JPEG-ready images side by side (the composite stills), as one JPEG. */
function strip(images: Electron.NativeImage[], height: number): Buffer {
  const scaled = images.map((image) => image.resize({ height, quality: 'good' }))
  const widths = scaled.map((s) => s.getSize().width)
  const total = widths.reduce((a, b) => a + b, 0) + 12 * (scaled.length - 1)
  const out = Buffer.alloc(total * height * 4, 0)
  let left = 0
  scaled.forEach((s, k) => {
    const { width } = s.getSize()
    const bitmap = s.toBitmap()
    for (let y = 0; y < height; y++) bitmap.copy(out, (y * total + left) * 4, y * width * 4, (y + 1) * width * 4)
    left += widths[k] + 12
  })
  return nativeImage.createFromBitmap(out, { width: total, height }).toJPEG(82)
}

export function openCustomSandbox(): CustomSandbox {
  return {
    async stills(request) {
      return withPage(request, request.frame, async (page) => {
        const transparent: Buffer[] = [], composite: Electron.NativeImage[] = []
        let texts: string[] = []
        const problems: string[] = []
        const settled = request.times[Math.min(SETTLED_STILL, request.times.length - 1)]
        const scaleTo = { width: Math.round(request.geometry.width * request.scale), height: Math.round(request.geometry.height * request.scale) }
        for (const t of request.times) {
          await page.seek(t)
          await page.isolated('(() => { const b = document.getElementById("cg-bg"); if (b) b.style.display = "none"; return true })()')
          transparent.push((await page.capture()).resize({ ...scaleTo, quality: 'best' }).toPNG())
          await page.isolated('(() => { const b = document.getElementById("cg-bg"); if (b) b.style.display = "block"; return true })()')
          composite.push(await page.capture())
          const g0 = request.geometry
          if (g0.kind === 'explainer' && t !== settled) {
            // An Explainer section moves its whole page: the captions' zone stays empty in every still, not only the settled one.
            const glance = await page.isolated<Reading | null>(READ_CODE)
            if (glance) {
              const top = EXPLAINER_CAPTION_ZONE.top * g0.height, bottom = EXPLAINER_CAPTION_ZONE.bottom * g0.height
              if (glance.boxes.some(([, y, , h]) => y < bottom - 2 && y + h > top + 2) && !problems.some((p) => p.startsWith('Something is drawn in the captions')))
                problems.push(`Something is drawn in the captions' zone (y ${Math.round(top - g0.root.y)}-${Math.round(bottom - g0.root.y)} of your area) at ${(t / 1000).toFixed(1)} s; keep it completely empty all through.`)
            }
          }
          if (t === settled) {
            const reading = await page.isolated<Reading | null>(READ_CODE)
            if (!reading) problems.push('The graphic has no root.')
            else {
              texts = reading.texts
              const g = request.geometry
              problems.push(...readingProblems(reading, g.face, g.kind === 'explainer' ? { captions: { top: EXPLAINER_CAPTION_ZONE.top * g.height, bottom: EXPLAINER_CAPTION_ZONE.bottom * g.height } } : null))
            }
          }
        }
        // Words that appear at other moments count too: every piece of text in the DOM is checked.
        const all = await page.isolated<string[]>(`(() => { const out = []; const w = document.createTreeWalker(document.getElementById('cg-root'), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const p = n.parentElement; if (p && p.closest('style,script,title,desc')) continue; const t = n.nodeValue.replace(/\\s+/g, ' ').trim(); if (t) out.push(t.slice(0, 200)) } return out.slice(0, 300) })()`)
        texts = [...new Set([...texts, ...(Array.isArray(all) ? all.filter((t): t is string => typeof t === 'string') : [])])]
        // The motion check: the band alone (no video behind it), every step over the whole graphic, shrunk and compared.
        let motion: StillsResult['motion']
        const step = request.motionStepMs
        if (step && step >= 40) {
          await page.isolated('(() => { const b = document.getElementById("cg-bg"); if (b) b.style.display = "none"; return true })()')
          const g = request.geometry
          const x = Math.max(0, Math.min(g.width - 1, g.root.x)), y = Math.max(0, Math.min(g.height - 1, g.root.y))
          const rect = { x, y, width: Math.max(1, Math.min(g.width - x, g.root.width)), height: Math.max(1, Math.min(g.height - y, g.root.height)) }
          const change: number[] = [], visible: boolean[] = []
          let previous: Buffer | null = null
          for (let t = 0; t <= request.durationMs; t += step) {
            await page.seek(t)
            const bitmap = await page.captureBand(rect)
            const measured = bitmapChange(previous, bitmap)
            change.push(measured.change); visible.push(measured.coverage > 0.002)
            previous = bitmap
          }
          motion = { change, visible }
        }
        return { transparent, composite: strip(composite, 520), texts, problems, ...(motion ? { motion } : {}) }
      })
    },
    async bake(scene, out, cancelled = () => false) {
      await withPage(scene, null, async (page) => {
        const frames = Math.max(1, Math.ceil(scene.durationMs * GRAPHIC_FPS / 1000))
        const k = scene.timeScale && scene.timeScale >= .5 && scene.timeScale <= 2 ? scene.timeScale : 1
        const ffmpeg = spawn(resolveBinary('ffmpeg'), ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(GRAPHIC_FPS), '-c:v', 'png', '-i', 'pipe:0',
          '-c:v', 'qtrle', '-pix_fmt', 'argb', '-r', String(GRAPHIC_FPS), '-f', 'mov', out], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
        let stderr = ''
        ffmpeg.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-2000) })
        const closed = new Promise<number | null>((resolve, reject) => { ffmpeg.on('error', reject); ffmpeg.on('close', resolve) })
        ffmpeg.stdin.on('error', () => {})
        try {
          for (let i = 0; i < frames; i++) {
            if (cancelled()) throw new Error('Export canceled.')
            await page.seek(i * 1000 / GRAPHIC_FPS * k)
            const png = (await page.capture()).toPNG()
            if (!ffmpeg.stdin.write(png)) await new Promise<void>((resolve) => ffmpeg.stdin.once('drain', () => resolve()))
          }
          ffmpeg.stdin.end()
          const code = await closed
          if (code !== 0) throw new Error(`FFmpeg could not write the custom graphic (${stderr.replace(/\s+/g, ' ').trim().slice(-200)})`)
        } catch (error) {
          ffmpeg.kill('SIGKILL')
          await closed.catch(() => null)
          throw error
        }
      })
    }
  }
}

type SandboxFactory = () => CustomSandbox
let factory: SandboxFactory = openCustomSandbox
/** Tests swap the sandbox for a fake. */
export function setCustomSandboxFactory(next: SandboxFactory | null): void { factory = next ?? openCustomSandbox }
export function customSandbox(): CustomSandbox { return factory() }
