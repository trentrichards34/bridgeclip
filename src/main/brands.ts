import { app } from 'electron'
import { execFile } from 'child_process'
import { randomBytes } from 'crypto'
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { extname, join } from 'path'
import { promisify } from 'util'
import {
  DEFAULT_HANDLE_POSITION, LOGO_EXTENSIONS, MAX_LOGO_BYTES, hasBrandMark, parseBrandLook, readBrandLook,
  type BrandLook, type BrandMarkForEngine
} from '../shared/brand-kit'
import { MAX_BRAND_IDENTITY_CHARS, type BrandIdentity } from '../shared/remix'
import { authorizeMedia } from './security'
import { resolveBinary } from './tools'

const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// Brand identities: documents describing what a brand believes, imported from
// outside CreatorClips (e.g. generated in the membership area) or pasted in,
// plus the brand kit (look defaults, handle and logo; see shared/brand-kit.ts).
// Remix, Create and Avatar Studio read them.
// ---------------------------------------------------------------------------

export const BRAND_IDENTITY_EXTENSIONS = ['txt', 'md', 'markdown']
const MAX_IMPORT_BYTES = 1024 * 1024
// The logo is read only as a local still image (no playlists or network fetches).
const IMAGE_GUARD = ['-protocol_whitelist', 'file,pipe,fd', '-format_whitelist', 'image2,png_pipe,jpeg_pipe,webp_pipe']

function brandDir(): string {
  return join(app.getPath('userData'), 'brand-identities')
}

export function brandLogosDir(): string {
  return join(app.getPath('userData'), 'brand-logos')
}

export function isBrandId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{16}$/.test(value)
}

function logoPathOf(look: BrandLook): string | null {
  if (!look.logo) return null
  const path = join(brandLogosDir(), look.logo)
  return existsSync(path) ? path : null
}

function parseBrand(value: unknown): BrandIdentity | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (!isBrandId(raw.id) || typeof raw.name !== 'string' || typeof raw.text !== 'string') return null
  // Older files have no look: the brand reads as before, with an empty kit.
  const look = readBrandLook(raw.look)
  const logoPath = logoPathOf(look)
  if (look.logo && !logoPath) delete look.logo
  if (logoPath) {
    try { authorizeMedia(logoPath) } catch { /* the preview just doesn't show */ }
  }
  return {
    id: raw.id, name: raw.name.slice(0, 120), text: raw.text.slice(0, MAX_BRAND_IDENTITY_CHARS), look,
    ...(logoPath ? { logoPath } : {}),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '', updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : ''
  }
}

export async function listBrandIdentities(): Promise<BrandIdentity[]> {
  let names: string[] = []
  try { names = await readdir(brandDir()) } catch { return [] }
  const items: BrandIdentity[] = []
  for (const name of names) {
    if (!/^[a-f0-9]{16}\.json$/.test(name)) continue
    try {
      const brand = parseBrand(JSON.parse(await readFile(join(brandDir(), name), 'utf8')))
      if (brand) items.push(brand)
    } catch { /* skip unreadable files */ }
  }
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function readBrandIdentity(id: string): Promise<BrandIdentity> {
  if (!isBrandId(id)) throw new Error('Choose a brand identity.')
  try {
    const brand = parseBrand(JSON.parse(await readFile(join(brandDir(), `${id}.json`), 'utf8')))
    if (brand) return brand
  } catch { /* fall through */ }
  throw new Error('That brand identity could not be found. Choose it again.')
}

export async function saveBrandIdentity(value: unknown): Promise<BrandIdentity[]> {
  const raw = (value ?? {}) as Record<string, unknown>
  const name = typeof raw.name === 'string' ? raw.name.replace(/\s+/g, ' ').trim() : ''
  const text = typeof raw.text === 'string' ? raw.text.replace(/\r\n/g, '\n').trim() : ''
  if (name.length < 1 || name.length > 120) throw new Error('Give the brand identity a name (up to 120 characters).')
  if (text.length < 40) throw new Error('Paste the brand identity: what the brand believes, its method and its proof.')
  if (text.length > MAX_BRAND_IDENTITY_CHARS) throw new Error(`Keep the brand identity under ${MAX_BRAND_IDENTITY_CHARS.toLocaleString()} characters.`)
  const look = parseBrandLook(raw.look)
  if (look.logo && !logoPathOf(look)) throw new Error('That logo is missing. Choose it again.')
  const now = new Date().toISOString()
  const existing = raw.id === undefined || raw.id === null ? null : await readBrandIdentity(raw.id as string)
  const brand = { id: existing?.id ?? randomBytes(8).toString('hex'), name, text, look, createdAt: existing?.createdAt ?? now, updatedAt: now }
  await mkdir(brandDir(), { recursive: true })
  const path = join(brandDir(), `${brand.id}.json`)
  await writeFile(`${path}.tmp`, JSON.stringify(brand, null, 2), 'utf8')
  await rename(`${path}.tmp`, path)
  // A replaced or removed logo is no longer needed.
  const previous = existing?.look?.logo
  if (previous && previous !== look.logo) await rm(join(brandLogosDir(), previous), { force: true })
  return listBrandIdentities()
}

export async function removeBrandIdentity(id: unknown): Promise<BrandIdentity[]> {
  if (!isBrandId(id)) throw new Error('Choose a brand identity.')
  const existing = await readBrandIdentity(id).catch(() => null)
  await rm(join(brandDir(), `${id}.json`), { force: true })
  if (existing?.look?.logo) await rm(join(brandLogosDir(), existing.look.logo), { force: true })
  return listBrandIdentities()
}

/**
 * A Create run's brand, read when the run starts (a queued run reads the brand
 * as it is then): its text for the planner, and the handle/logo to draw when
 * `show` is on. Throws a plain message when the brand was deleted. With
 * `folder` (the run's folder) the logo is copied there, like Remix's
 * brandMarkForRun, so replacing or deleting it mid-run can't change the run.
 */
export function brandForJob(id: string, show: boolean | undefined, folder?: string): { name: string; text: string; mark: BrandMarkForEngine | null; color: string | null } {
  let brand: BrandIdentity | null = null
  if (isBrandId(id)) {
    try { brand = parseBrand(JSON.parse(readFileSync(join(brandDir(), `${id}.json`), 'utf8'))) } catch { brand = null }
  }
  if (!brand) throw new Error('That brand identity was deleted. Choose another brand, or no brand, and start again.')
  const look = brand.look ?? {}
  let logo = look.logo ? logoPathOf(look) : null
  if (show && logo && folder) {
    const copy = join(folder, '.brand-logo.png')
    try { mkdirSync(folder, { recursive: true }); copyFileSync(logo, copy); logo = copy } catch { logo = null }
  }
  const mark = show && (look.handle || logo)
    ? { handle: look.handle ?? '', logo_path: logo, position: look.handlePosition ?? DEFAULT_HANDLE_POSITION }
    : null
  return { name: brand.name, text: brand.text, mark, color: look.color ?? null }
}

/** Text of a .txt/.md file the user picked, to fill the editor. */
export async function readBrandIdentityFile(path: string): Promise<{ name: string; text: string; truncated: boolean }> {
  const extension = extname(path).slice(1).toLowerCase()
  if (!BRAND_IDENTITY_EXTENSIONS.includes(extension)) throw new Error('Choose a .txt or .md file, or paste the text.')
  const info = await stat(path)
  if (!info.isFile() || info.size > MAX_IMPORT_BYTES) throw new Error('That file is too large. Paste the text instead.')
  const text = (await readFile(path, 'utf8')).replace(/\r\n/g, '\n').trim()
  const name = path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '').slice(0, 120) || 'Brand identity'
  return { name, text: text.slice(0, MAX_BRAND_IDENTITY_CHARS), truncated: text.length > MAX_BRAND_IDENTITY_CHARS }
}

/**
 * A logo file the member chose in the dialog: checked (type, size, a real
 * image) and stored as a PNG of at most 600×600 in userData/brand-logos.
 * Saved with the brand later; returns its stored name and a preview path.
 */
export async function importBrandLogo(source: string): Promise<{ logo: string; path: string }> {
  const extension = extname(source).slice(1).toLowerCase()
  if (!LOGO_EXTENSIONS.includes(extension)) throw new Error('Choose a PNG, JPG or WebP image for your logo.')
  const info = await stat(source)
  if (!info.isFile()) throw new Error('Choose a PNG, JPG or WebP image for your logo.')
  if (info.size > MAX_LOGO_BYTES) throw new Error('Choose a logo under 5 MB.')
  await mkdir(brandLogosDir(), { recursive: true })
  const logo = `${randomBytes(8).toString('hex')}.png`
  const path = join(brandLogosDir(), logo)
  try {
    await execFileAsync(resolveBinary('ffmpeg'), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...IMAGE_GUARD, '-i', source, '-frames:v', '1',
      '-vf', 'scale=600:600:force_original_aspect_ratio=decrease,format=rgba', path], { timeout: 60_000, maxBuffer: 1024 * 1024 })
    if (!existsSync(path)) throw new Error('no output')
  } catch {
    await rm(path, { force: true })
    throw new Error('That image could not be read. Try a PNG or JPG.')
  }
  authorizeMedia(path)
  return { logo, path }
}

/**
 * The handle/logo the engine draws for this brand, or null when the toggle is
 * off or the brand has neither. The logo is copied into `folder` (the run's
 * own copy, so editing or deleting the brand later can't break re-makes).
 */
export async function brandMarkForRun(brand: BrandIdentity | null, show: boolean | undefined, folder: string | null): Promise<BrandMarkForEngine | null> {
  const look = brand?.look
  if (!show || !look || !hasBrandMark(look)) return null
  let logo = look.logo ? logoPathOf(look) : null
  if (logo && folder) {
    const copy = join(folder, '.brand-logo.png')
    try { await mkdir(folder, { recursive: true }); await copyFile(logo, copy); logo = copy } catch { logo = null }
  }
  if (!look.handle && !logo) return null
  return { handle: look.handle ?? '', logo_path: logo, position: look.handlePosition ?? DEFAULT_HANDLE_POSITION }
}

