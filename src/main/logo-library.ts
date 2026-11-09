import { app, BrowserWindow, session } from 'electron'
import { createHash, randomBytes } from 'crypto'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import {
  LOGO_IMAGE_EXTENSIONS, MAX_LOGOS, MAX_LOGO_BYTES, cleanLogoAliases, cleanLogoName, isLogoId, type LogoSummary
} from '../shared/logos'
import { authorizeMedia } from './security'
import { graphicImageKind, importGraphicImage } from './graphics-render'

/**
 * My logos: the member's logo images, stored once in the app's folder (userData/logos/<id>/: logo.json and the picture,
 * checked by its bytes; an SVG is drawn to a PNG when it is added, so nothing downstream reads SVG). The renderer names a
 * logo only by its id. Runs get copies under the graphics images' content names (importGraphicImage), so the engine's
 * graphics director can pop one in where its name is said (Create) and Edit my recording can pin one to its word.
 */
interface StoredLogo { id: string; name: string; aliases: string[]; file: string; createdAt: string }

export function logosDir(): string {
  return join(app.getPath('userData'), 'logos')
}

function logoDir(id: string): string {
  return join(logosDir(), id)
}

function regularFile(path: string): boolean {
  try { const s = lstatSync(path); return s.isFile() && !s.isSymbolicLink() } catch { return false }
}

function readStored(id: string): StoredLogo | null {
  if (!isLogoId(id)) return null
  try {
    const raw = JSON.parse(readFileSync(join(logoDir(id), 'logo.json'), 'utf8')) as Partial<StoredLogo>
    if (raw.id !== id || typeof raw.file !== 'string' || !/^logo\.(png|jpg|webp)$/.test(raw.file) || !regularFile(join(logoDir(id), raw.file))) return null
    const name = cleanLogoName(raw.name)
    if (!name) return null
    return { id, name, aliases: cleanLogoAliases(raw.aliases, name), file: raw.file, createdAt: String(raw.createdAt ?? '') }
  } catch { return null }
}

function storedLogos(): StoredLogo[] {
  let ids: string[] = []
  try { ids = readdirSync(logosDir()) } catch { return [] }
  return ids.map(readStored).filter((logo): logo is StoredLogo => logo !== null).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function summary(logo: StoredLogo): LogoSummary {
  return { id: logo.id, name: logo.name, aliases: logo.aliases, path: authorizeMedia(join(logoDir(logo.id), logo.file)), createdAt: logo.createdAt }
}

export async function listLogos(): Promise<LogoSummary[]> {
  return storedLogos().map(summary)
}

async function writeStored(logo: StoredLogo): Promise<void> {
  const file = join(logoDir(logo.id), 'logo.json')
  await writeFile(`${file}.tmp`, JSON.stringify(logo, null, 2))
  await rename(`${file}.tmp`, file)
}

/** An SVG's text, checked: an <svg> document under the size cap (scripts never run: it is only drawn as an image). */
export function svgText(bytes: Uint8Array): string | null {
  if (bytes.byteLength > MAX_LOGO_BYTES) return null
  const text = Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '')
  return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text) ? text : null
}

type SvgRasterizer = (svg: string) => Promise<Buffer>
/** Draws an SVG to a PNG (up to 1024 px on its long side) in a hidden, sandboxed window that loads nothing else. */
async function rasterizeInWindow(svg: string): Promise<Buffer> {
  const partition = 'logo-raster'
  const ses = session.fromPartition(partition, { cache: false })
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('data:') && details.url !== 'about:blank' }))
  const w = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, images: true, webgl: false, plugins: false, devTools: false, partition } })
  try {
    await w.loadURL('about:blank')
    const url = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
    const png = await w.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const w0 = img.naturalWidth || 512, h0 = img.naturalHeight || 512, k = 1024 / Math.max(w0, h0)
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k))
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
        resolve(c.toDataURL('image/png'))
      }
      img.onerror = () => reject(new Error('svg'))
      img.src = ${JSON.stringify(url)}
    })`) as string
    if (typeof png !== 'string' || !png.startsWith('data:image/png;base64,')) throw new Error('svg')
    return Buffer.from(png.slice('data:image/png;base64,'.length), 'base64')
  } finally { w.destroy() }
}
let rasterize: SvgRasterizer = rasterizeInWindow
/** Tests swap the window for a fake. */
export function setSvgRasterizer(fn: SvgRasterizer | null): void { rasterize = fn ?? rasterizeInWindow }

/** Add a logo from the member's computer (PNG, JPEG, WebP or SVG up to 5 MB), with its name (else the file's name). */
export async function addLogo(source: string, name?: unknown): Promise<LogoSummary[]> {
  const extension = extname(source).slice(1).toLowerCase()
  if (!LOGO_IMAGE_EXTENSIONS.includes(extension)) throw new Error('Choose a PNG, JPEG, WebP or SVG logo.')
  const info = await stat(source).catch(() => null)
  if (!info?.isFile()) throw new Error('Choose a PNG, JPEG, WebP or SVG logo.')
  if (info.size > MAX_LOGO_BYTES || info.size === 0) throw new Error('Choose a logo file under 5 MB.')
  if (storedLogos().length >= MAX_LOGOS) throw new Error(`You can keep up to ${MAX_LOGOS} logos. Remove one first.`)
  let bytes: Buffer = await readFile(source)
  if (bytes.byteLength > MAX_LOGO_BYTES) throw new Error('Choose a logo file under 5 MB.')
  if (extension === 'svg') {
    const svg = svgText(bytes)
    if (!svg) throw new Error('That SVG could not be read. Try a PNG.')
    try { bytes = await rasterize(svg) } catch { throw new Error('That SVG could not be drawn. Try a PNG.') }
  }
  const kind = graphicImageKind(bytes)
  if (!kind) throw new Error('That picture could not be read. Use a PNG, JPEG, WebP or SVG logo.')
  const label = cleanLogoName(name) || cleanLogoName(basename(source, extname(source)).replace(/[_-]+/g, ' ')) || 'Logo'
  const id = randomBytes(8).toString('hex')
  const dir = logoDir(id)
  await mkdir(dir, { recursive: true })
  try {
    const file = `logo.${kind}`
    await writeFile(join(dir, `${file}.tmp`), bytes)
    await rename(join(dir, `${file}.tmp`), join(dir, file))
    await writeStored({ id, name: label, aliases: [], file, createdAt: new Date().toISOString() })
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
  return listLogos()
}

/** The "Add logo" button: the file dialog (`pick`) opens in main; null from it is a cancel. */
export async function addLogoFromPicker(pick: () => Promise<string | null>): Promise<LogoSummary[] | null> {
  const path = await pick()
  return path ? addLogo(path) : null
}

/** Rename a logo or set the other names it goes by. */
export async function updateLogo(id: unknown, patch: unknown): Promise<LogoSummary[]> {
  const logo = typeof id === 'string' ? readStored(id) : null
  if (!logo) throw new Error('That logo is no longer in your logos.')
  const p = patch && typeof patch === 'object' ? patch as Record<string, unknown> : {}
  const name = p.name === undefined ? logo.name : cleanLogoName(p.name)
  if (!name) throw new Error('Give the logo a name (the word you say for it).')
  const aliases = p.aliases === undefined ? cleanLogoAliases(logo.aliases, name) : cleanLogoAliases(p.aliases, name)
  await writeStored({ ...logo, name, aliases })
  return listLogos()
}

export async function removeLogo(id: unknown): Promise<LogoSummary[]> {
  if (!isLogoId(id)) throw new Error('That logo is no longer in your logos.')
  await rm(logoDir(id), { recursive: true, force: true })
  return listLogos()
}

/** The run's graphics image name a logo gets (importGraphicImage names a picture by its content). */
function graphicName(logo: StoredLogo): string | null {
  try {
    const bytes = readFileSync(join(logoDir(logo.id), logo.file))
    const kind = graphicImageKind(bytes)
    return kind ? `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${kind}` : null
  } catch { return null }
}

/**
 * The member's logos for Create's engine request: each as the graphics image name it will have in the run (copied in
 * by copyLogosIntoRun before the run's graphics are drawn), with the names to listen for.
 */
export function logosForEngine(): { image: string; name: string; aliases: string[] }[] {
  try {
    return storedLogos().flatMap((logo) => { const image = graphicName(logo); return image ? [{ image, name: logo.name, aliases: logo.aliases }] : [] })
  } catch { return [] }
}

/** The member's logos for Edit my recording's plan: by id (its pins become run images once the plan names them). */
export function logosForEdit(): { image: string; name: string; aliases: string[] }[] {
  try { return storedLogos().map((logo) => ({ image: logo.id, name: logo.name, aliases: logo.aliases })) } catch { return [] }
}

/** Copy every logo into the run's graphics images (content-named, so a copy already there is reused). Returns how many. */
export function copyLogosIntoRun(run: string): number {
  let copied = 0
  for (const logo of storedLogos()) {
    try { importGraphicImage(run, join(logoDir(logo.id), logo.file)); copied++ } catch { /* an unreadable logo is left out */ }
  }
  return copied
}

/** One logo into a run (the clip editor's "My logos" pick): its graphics image name. */
export function importLogoIntoRun(run: string, id: unknown): string {
  const logo = typeof id === 'string' ? readStored(id) : null
  if (!logo) throw new Error('That logo is no longer in your logos.')
  return importGraphicImage(run, join(logoDir(logo.id), logo.file))
}

/** A logo's stored picture and name (Edit my recording copies it into the run's images when the plan pins it). */
export function logoFile(id: unknown): { path: string; name: string } | null {
  const logo = typeof id === 'string' ? readStored(id) : null
  const path = logo ? join(logoDir(logo.id), logo.file) : null
  return logo && path && existsSync(path) ? { path, name: logo.name } : null
}
