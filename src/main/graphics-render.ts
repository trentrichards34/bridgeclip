/**
 * Motion graphics → transparent videos the engine layers over a clip.
 *
 * Each graphic is drawn by our own template page (src/renderer/graphics.html)
 * in a hidden, offscreen, sandboxed window: no Node, isolated context, an
 * in-memory session that only loads the app's own page (images arrive as data
 * URLs), no navigation or pop-ups. The page's animation is stepped by time
 * (frame i → i/30 s), never by the wall clock, and each frame is captured as a
 * PNG and piped to FFmpeg, which writes a QuickTime Animation (qtrle, ARGB)
 * .mov: FFmpeg's own decoder reads its alpha reliably (VP9 alpha needs libvpx).
 *
 * Renders are cached in the run's .graphics/ folder under a hash of everything
 * that changes their pixels (template version, words, colors, font, size,
 * band, length and the image's bytes), so a re-bake reuses them.
 */
import { spawn } from 'child_process'
import { createHash, randomUUID } from 'crypto'
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { extname, join } from 'path'
import { BrowserWindow, session, type BrowserWindowConstructorOptions, type Session } from 'electron'
import { is } from '@electron-toolkit/utils'
import { GRAPHIC_FPS, GRAPHICS_VERSION, graphicHasContent, graphicUsesImage, graphicWindow, type GraphicRenderSpec, type GraphicSize } from '../shared/motion-graphics'
import { graphicSpec } from '../shared/graphic-layout'
import type { EditorCandidate, EditorProject } from '../shared/clip-editor'
import { resolveBinary } from './tools'
import { logger } from './logger'

export const GRAPHICS_DIR = '.graphics'
export const GRAPHIC_IMAGES_DIR = 'images'
export const GRAPHIC_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']
export const MAX_GRAPHIC_IMAGE_BYTES = 12 * 1024 * 1024
export const GRAPHICS_PARTITION = 'graphics-render'
const RENDER_FILE = /^[a-f0-9]{64}\.mov$/
const IMAGE_FILE = /^[a-f0-9]{16}\.(png|jpg|webp)$/

/**
 * One rendered graphic for the engine: a file in the run's .graphics/ folder and its OUTPUT-time window.
 * `size`: 'compact' or 'stage' when the graphic isn't the usual card (a stage scene can make room for a stage-size one).
 */
export interface RenderedGraphic { id: string; file: string; start_ms: number; duration_ms: number; size?: GraphicSize }

/** The picture type from its first bytes (PNG, JPEG or WebP), or null. */
export function graphicImageKind(bytes: Uint8Array): 'png' | 'jpg' | 'webp' | null {
  const at = (i: number, ...values: number[]): boolean => values.every((v, k) => bytes[i + k] === v)
  if (bytes.byteLength >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png'
  if (bytes.byteLength >= 3 && at(0, 0xff, 0xd8, 0xff)) return 'jpg'
  if (bytes.byteLength >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp'
  return null
}

function regularFile(path: string): boolean {
  try { const s = lstatSync(path); return s.isFile() && !s.isSymbolicLink() } catch { return false }
}
function graphicsDir(run: string, create = false): string {
  const dir = join(run, GRAPHICS_DIR)
  if (create) mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (lstatSync(dir).isSymbolicLink()) throw new Error('Graphics folder is invalid')
  return dir
}

/**
 * A picture the member chose for a graphic: checked by its bytes (PNG, JPEG or
 * WebP, up to 12 MB) and copied into the run's .graphics/images/ folder under a
 * name made from its content. Returns that name (the graphic's `image` field).
 */
export function importGraphicImage(run: string, file: string): string {
  if (!GRAPHIC_IMAGE_EXTENSIONS.includes(extname(file).slice(1).toLowerCase())) throw new Error('Use a PNG, JPEG or WebP picture.')
  const stat = statSync(file)
  if (!stat.isFile()) throw new Error('Use a PNG, JPEG or WebP picture.')
  if (stat.size > MAX_GRAPHIC_IMAGE_BYTES) throw new Error('Use a picture under 12 MB.')
  const bytes = readFileSync(file)
  if (bytes.byteLength > MAX_GRAPHIC_IMAGE_BYTES) throw new Error('Use a picture under 12 MB.')
  const kind = graphicImageKind(bytes)
  if (!kind) throw new Error('Use a PNG, JPEG or WebP picture.')
  const folder = join(graphicsDir(run, true), GRAPHIC_IMAGES_DIR)
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  if (lstatSync(folder).isSymbolicLink()) throw new Error('Graphics folder is invalid')
  const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${kind}`
  const target = join(folder, name)
  if (!regularFile(target)) {
    const temporary = join(folder, `.tmp-${randomUUID()}`)
    try { writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' }); renameSync(temporary, target) } finally { try { unlinkSync(temporary) } catch { /* moved */ } }
  }
  return name
}

/** A graphic's image as a data URL (the render page loads nothing else), or null when it is missing or invalid. */
export function graphicImageData(run: string, name: string | undefined): { url: string; hash: string } | null {
  if (!name || !IMAGE_FILE.test(name)) return null
  const path = join(run, GRAPHICS_DIR, GRAPHIC_IMAGES_DIR, name)
  if (!regularFile(path) || statSync(path).size > MAX_GRAPHIC_IMAGE_BYTES) return null
  const bytes = readFileSync(path)
  const kind = graphicImageKind(bytes)
  if (!kind) return null
  return { url: `data:image/${kind === 'jpg' ? 'jpeg' : kind};base64,${bytes.toString('base64')}`, hash: createHash('sha256').update(bytes).digest('hex') }
}

/** The cache name of a render: everything that changes its pixels. */
export function graphicCacheKey(spec: GraphicRenderSpec, imageHash?: string): string {
  const { image: _image, ...rest } = spec
  void _image
  const fields = Object.fromEntries(Object.entries(rest.fields).sort(([a], [b]) => a.localeCompare(b)))
  return createHash('sha256').update(JSON.stringify({ v: GRAPHICS_VERSION, fps: GRAPHIC_FPS, ...rest, fields, image: imageHash ?? null })).digest('hex')
}

/** The offscreen window: hidden, transparent, sandboxed, in its own in-memory session. */
export function offscreenWindowOptions(width: number, height: number): BrowserWindowConstructorOptions {
  return {
    show: false, width, height, useContentSize: true, frame: false, transparent: true, backgroundColor: '#00000000',
    enableLargerThanScreen: true, paintWhenInitiallyHidden: true, skipTaskbar: true, focusable: false,
    webPreferences: {
      offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
      javascript: true, images: true, webgl: false, plugins: false, spellcheck: false, devTools: false,
      backgroundThrottling: false, navigateOnDragDrop: false, partition: GRAPHICS_PARTITION
    }
  }
}

function pageLocation(): { url: string; base: string } | { file: string; base: string } {
  const dev = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  if (dev) return { url: `${dev.replace(/\/$/, '')}/graphics.html`, base: `${new URL(dev).origin}/` }
  const file = join(__dirname, '../renderer/graphics.html')
  const dir = join(__dirname, '../renderer/')
  return { file, base: `file://${process.platform === 'win32' ? '/' : ''}${dir.replaceAll('\\', '/')}` }
}

/** Whether the render session may load this URL: the app's own page and its assets, and data URLs. */
export function graphicsRequestAllowed(url: string, base: string): boolean {
  if (url.startsWith('data:')) return true
  try {
    const target = new URL(url), root = new URL(base)
    if (target.protocol === 'file:' && root.protocol === 'file:') return decodeURIComponent(target.pathname).startsWith(decodeURIComponent(root.pathname))
    return target.origin === root.origin && (target.protocol === 'http:' || target.protocol === 'https:') && !target.username && !target.password
  } catch { return false }
}

let configured: Session | null = null
function renderSession(base: string): Session {
  const ses = session.fromPartition(GRAPHICS_PARTITION)
  if (configured === ses) return ses
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !graphicsRequestAllowed(details.url, base) }))
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  configured = ses
  return ses
}

/** A render surface for one batch of graphics. */
export interface GraphicRenderer { render: (spec: GraphicRenderSpec, out: string, cancelled?: () => boolean) => Promise<void>; close: () => void }

export async function openGraphicRenderer(): Promise<GraphicRenderer> {
  const location = pageLocation()
  renderSession(location.base)
  let window: BrowserWindow | null = null
  let size = ''
  const open = async (width: number, height: number): Promise<BrowserWindow> => {
    if (window && !window.isDestroyed()) {
      // One window per batch: a new size resizes it (making a second window while the first closes can abort its load).
      if (size !== `${width}x${height}`) { window.setContentSize(width, height); size = `${width}x${height}` }
      return window
    }
    const w = new BrowserWindow(offscreenWindowOptions(width, height))
    window = w; size = `${width}x${height}`
    // Offscreen windows start at the screen's size: make the page exactly the output frame.
    w.setContentSize(width, height)
    w.webContents.setFrameRate(60)
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    w.webContents.on('will-navigate', (event) => event.preventDefault())
    w.webContents.on('will-redirect', (event) => event.preventDefault())
    w.webContents.on('will-attach-webview', (event) => event.preventDefault())
    if ('url' in location) await w.loadURL(location.url)
    else await w.loadFile(location.file)
    return w
  }
  return {
    async render(spec, out, cancelled = () => false) {
      const w = await open(spec.width, spec.height)
      const ok = await w.webContents.executeJavaScript(`window.__graphic.load(${JSON.stringify(spec)})`)
      if (ok !== true) throw new Error('The graphic page did not load')
      const frames = Math.max(1, Math.ceil(spec.duration_ms * GRAPHIC_FPS / 1000))
      const ffmpeg = spawn(resolveBinary('ffmpeg'), ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(GRAPHIC_FPS), '-c:v', 'png', '-i', 'pipe:0',
        '-c:v', 'qtrle', '-pix_fmt', 'argb', '-r', String(GRAPHIC_FPS), '-f', 'mov', out], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
      let stderr = ''
      ffmpeg.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-2000) })
      const closed = new Promise<number | null>((resolve, reject) => { ffmpeg.on('error', reject); ffmpeg.on('close', resolve) })
      ffmpeg.stdin.on('error', () => {})
      try {
        for (let i = 0; i < frames; i++) {
          if (cancelled()) throw new Error('Export canceled.')
          await w.webContents.executeJavaScript(`window.__graphic.frame(${(i * 1000 / GRAPHIC_FPS).toFixed(3)})`)
          let image = await w.webContents.capturePage()
          const got = image.getSize()
          // High-DPI screens can capture at twice the size.
          if (got.width !== spec.width || got.height !== spec.height) image = image.resize({ width: spec.width, height: spec.height, quality: 'best' })
          const png = image.toPNG()
          if (!ffmpeg.stdin.write(png)) await new Promise<void>((resolve) => ffmpeg.stdin.once('drain', () => resolve()))
        }
        ffmpeg.stdin.end()
        const code = await closed
        if (code !== 0) throw new Error(`FFmpeg could not write the graphic (${stderr.replace(/\s+/g, ' ').trim().slice(-200)})`)
      } catch (error) {
        ffmpeg.kill('SIGKILL')
        await closed.catch(() => null)
        throw error
      }
    },
    close() { if (window && !window.isDestroyed()) window.destroy(); window = null }
  }
}

/** The render spec and cache key of every drawable graphic on a clip (nothing is rendered). */
export function candidateGraphicJobs(run: string, project: EditorProject, candidate: EditorCandidate, extra: { top?: number } = {}): GraphicJob[] {
  const jobs: GraphicJob[] = []
  for (const g of candidate.graphics ?? []) {
    if (!graphicHasContent(g)) continue
    const spec = graphicSpec(project, candidate, g, extra), window = graphicWindow(candidate, g)
    if (!spec || !window) continue
    const job = graphicJob(run, g.id, spec, window, g.fields.image)
    if (job) jobs.push(job)
  }
  return jobs
}

type RendererFactory = () => Promise<GraphicRenderer>
let makeRenderer: RendererFactory = openGraphicRenderer
/** Tests swap the offscreen window for a fake. */
export function setGraphicRendererFactory(factory: RendererFactory | null): void { makeRenderer = factory ?? openGraphicRenderer }

/** One graphic to draw: what it shows, its cache name and where it plays (output ms). */
export interface GraphicJob { id: string; spec: GraphicRenderSpec; key: string; start_ms: number; duration_ms: number }

/** Renders made outside the clip editor (Edit my recording, Remix) are kept in .graphics/reel/: the editor's sweep never removes them. */
export const REEL_GRAPHICS_DIR = 'reel'

/**
 * A job for a graphic drawn from `spec`. Its picture (Logo pop, Browser window, Icon row) is loaded from the run;
 * null when Logo pop's is missing, or when another template's picture is missing and it has nothing else to show.
 */
export function graphicJob(run: string, id: string, spec: GraphicRenderSpec, window: { start_ms: number; duration_ms: number }, image?: string): GraphicJob | null {
  let imageHash: string | undefined
  if (graphicUsesImage(spec.template) && (image || spec.template === 'logo')) {
    const data = graphicImageData(run, image)
    if (data) {
      spec = { ...spec, image: data.url }
      imageHash = data.hash
    } else if (spec.template === 'logo' || !graphicHasContent({ template: spec.template, fields: spec.fields })) return null
  }
  return { id, spec, key: graphicCacheKey(spec, imageHash), start_ms: window.start_ms, duration_ms: window.duration_ms }
}

/**
 * Render (or reuse) graphics into the run's .graphics/ folder (or a folder in
 * it). Returns what the engine layers over the video, in the jobs' order.
 */
export async function renderGraphicJobs(run: string, jobs: GraphicJob[], cancelled: () => boolean = () => false, sub?: typeof REEL_GRAPHICS_DIR): Promise<RenderedGraphic[]> {
  if (!jobs.length) return []
  let dir = graphicsDir(run, true)
  if (sub) {
    dir = join(dir, sub)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    if (lstatSync(dir).isSymbolicLink()) throw new Error('Graphics folder is invalid')
  }
  let renderer: GraphicRenderer | null = null
  const done: RenderedGraphic[] = []
  try {
    for (const job of jobs) {
      if (cancelled()) throw new Error('Export canceled.')
      const file = `${job.key}.mov`, path = join(dir, file)
      if (!regularFile(path) || statSync(path).size < 64) {
        renderer ??= await makeRenderer()
        const temporary = join(dir, `.tmp-${randomUUID()}.mov`)
        const started = Date.now()
        try {
          await renderer.render(job.spec, temporary, cancelled)
          renameSync(temporary, path)
        } finally { try { unlinkSync(temporary) } catch { /* moved */ } }
        logger.info('graphics.rendered', { template: job.spec.template, ms: Date.now() - started, frames: Math.ceil(job.spec.duration_ms * GRAPHIC_FPS / 1000) })
      }
      done.push({ id: job.id, file, start_ms: job.start_ms, duration_ms: job.duration_ms, ...(job.spec.size ? { size: job.spec.size } : {}) })
    }
  } finally { renderer?.close() }
  return done
}

/**
 * Render (or reuse) every graphic on a clip, before its bake. Returns what the
 * engine layers over the clip; graphics left without words, image or screen
 * time are skipped.
 */
export async function renderCandidateGraphics(run: string, project: EditorProject, candidate: EditorCandidate, cancelled: () => boolean = () => false, extra: { top?: number } = {}): Promise<RenderedGraphic[]> {
  return renderGraphicJobs(run, candidateGraphicJobs(run, project, candidate, extra), cancelled)
}

/** Remove cached renders no clip uses any more (images are kept: undo can bring their graphic back). */
export function sweepGraphicRenders(run: string, project: EditorProject): void {
  let names: string[]
  try { names = readdirSync(join(run, GRAPHICS_DIR)) } catch { return }
  const keep = new Set<string>()
  for (const c of project.candidates) for (const job of candidateGraphicJobs(run, project, c)) keep.add(`${job.key}.mov`)
  for (const name of names) {
    if ((RENDER_FILE.test(name) && !keep.has(name)) || name.startsWith('.tmp-')) {
      try { unlinkSync(join(run, GRAPHICS_DIR, name)) } catch { /* in use on Windows; next time */ }
    }
  }
}
