import { app } from 'electron'
import { execFile, spawn, type ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { access, constants as fsConstants, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { delimiter, dirname, extname, join } from 'path'
import { promisify } from 'util'
import { isAvatarId, renderFolderName } from '../shared/avatars'
import { isCaptionPresetId } from '../shared/caption-presets'
import {
  estimateRemixCost, isRemixAngle, isRemixHost, MAX_BRAND_IDENTITY_CHARS, MAX_REMIXES, parseRemixOutput, REMIX_ANGLES, REMIX_VOICE_IDS, remixSourceUrl,
  type BrandIdentity, type RemixOutput, type RemixRequest, type RemixStatus
} from '../shared/remix'
import { portraitPath, readAvatar } from './avatars'
import { logger } from './logger'
import { getBridgeRunnerPath, getEnginePath, resolvePythonPath, runtimeEnvironment, validatePython } from './pipeline-runner'
import { assertMediaPath } from './security'
import { getSettingsForBridge, loadSettings } from './settings-store'
import { resolveBinary } from './tools'

const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// Brand identities: documents describing what a brand believes, imported from
// outside CreatorClips (e.g. generated in the membership area) or pasted in.
// ---------------------------------------------------------------------------

export const BRAND_IDENTITY_EXTENSIONS = ['txt', 'md', 'markdown']
const MAX_IMPORT_BYTES = 1024 * 1024

function brandDir(): string {
  return join(app.getPath('userData'), 'brand-identities')
}

function isBrandId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{16}$/.test(value)
}

function parseBrand(value: unknown): BrandIdentity | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (!isBrandId(raw.id) || typeof raw.name !== 'string' || typeof raw.text !== 'string') return null
  return {
    id: raw.id, name: raw.name.slice(0, 120), text: raw.text.slice(0, MAX_BRAND_IDENTITY_CHARS),
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
  const now = new Date().toISOString()
  const existing = raw.id === undefined || raw.id === null ? null : await readBrandIdentity(raw.id as string)
  const brand: BrandIdentity = { id: existing?.id ?? randomBytes(8).toString('hex'), name, text, createdAt: existing?.createdAt ?? now, updatedAt: now }
  await mkdir(brandDir(), { recursive: true })
  const path = join(brandDir(), `${brand.id}.json`)
  await writeFile(`${path}.tmp`, JSON.stringify(brand, null, 2), 'utf8')
  await rename(`${path}.tmp`, path)
  return listBrandIdentities()
}

export async function removeBrandIdentity(id: unknown): Promise<BrandIdentity[]> {
  if (!isBrandId(id)) throw new Error('Choose a brand identity.')
  await rm(join(brandDir(), `${id}.json`), { force: true })
  return listBrandIdentities()
}

/** Text of a .txt/.md file the user picked, to fill the editor. */
export async function readBrandIdentityFile(path: string): Promise<{ name: string; text: string }> {
  const extension = extname(path).slice(1).toLowerCase()
  if (!BRAND_IDENTITY_EXTENSIONS.includes(extension)) throw new Error('Choose a .txt or .md file, or paste the text.')
  const info = await stat(path)
  if (!info.isFile() || info.size > MAX_IMPORT_BYTES) throw new Error('That file is too large. Paste the text instead.')
  const text = (await readFile(path, 'utf8')).replace(/\r\n/g, '\n').trim()
  const name = path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '').slice(0, 120) || 'Brand identity'
  return { name, text: text.slice(0, MAX_BRAND_IDENTITY_CHARS) }
}

// ---------------------------------------------------------------------------
// Remix runs
// ---------------------------------------------------------------------------

interface ActiveRemix { status: RemixStatus; child?: ChildProcess; cancelled: boolean }

let active: ActiveRemix | null = null
let lastStatus: RemixStatus | null = null
let notify: (status: RemixStatus) => void = () => undefined

export function onRemixStatus(listener: (status: RemixStatus) => void): void { notify = listener }
export function remixStatus(): RemixStatus | null { return active?.status ?? lastStatus }

function publish(run: ActiveRemix, patch: Partial<RemixStatus>): void {
  if (run.status.phase !== 'running') return
  run.status = { ...run.status, ...patch, percent: Math.max(run.status.percent, Math.min(100, Math.round(patch.percent ?? run.status.percent))) }
  notify(run.status)
}

function finish(run: ActiveRemix, patch: Partial<RemixStatus>): void {
  run.status = { ...run.status, ...patch }
  lastStatus = run.status
  if (active === run) active = null
  notify(run.status)
}

export interface ParsedRemix { request: RemixRequest; sourceIsUrl: boolean }

export function parseRemixRequest(value: unknown, outputDirectory: string): ParsedRemix {
  const raw = (value ?? {}) as Record<string, unknown>
  const source = typeof raw.source === 'string' ? raw.source.trim() : ''
  if (!source) throw new Error('Paste a video link or choose a file.')
  const url = remixSourceUrl(source)
  if (!url) {
    try { assertMediaPath(source, outputDirectory) } catch { throw new Error('Paste a full video link (https://…) or choose the file again.') }
  }
  if (!isRemixAngle(raw.angle)) throw new Error('Choose a remix style.')
  if (!isRemixHost(raw.host)) throw new Error('Choose how your presenter appears.')
  const avatarId = raw.host === 'voice' ? null : raw.avatarId
  if (raw.host !== 'voice' && !isAvatarId(avatarId)) throw new Error('Choose an avatar, or switch to voice only.')
  const voice = typeof raw.voice === 'string' && REMIX_VOICE_IDS.includes(raw.voice) ? raw.voice : null
  if (!voice) throw new Error('Choose a voice.')
  const brandIdentityId = raw.brandIdentityId === null || raw.brandIdentityId === undefined ? null : raw.brandIdentityId
  if (brandIdentityId !== null && !isBrandId(brandIdentityId)) throw new Error('Choose a brand identity.')
  if (typeof raw.count !== 'number' || !Number.isInteger(raw.count) || raw.count < 1 || raw.count > MAX_REMIXES) throw new Error(`Make between 1 and ${MAX_REMIXES} remixes.`)
  if (!isCaptionPresetId(raw.captionPreset)) throw new Error('Choose a caption style.')
  const creator = typeof raw.creator === 'string' ? raw.creator.replace(/\s+/g, ' ').trim() : ''
  if (creator.length > 80) throw new Error('Keep the creator name under 80 characters.')
  if (!url && !creator) throw new Error('Add the original creator’s name so the video credits them.')
  if (raw.aiLabelAck !== true) throw new Error('Confirm you’ll turn on the AI-content label when you post.')
  return {
    sourceIsUrl: Boolean(url),
    request: {
      source: url ?? source, creator, angle: raw.angle, host: raw.host, avatarId: avatarId as string | null, voice, brandIdentityId,
      count: raw.count, captionPreset: raw.captionPreset, includeCaptions: raw.includeCaptions !== false, aiLabelAck: raw.aiLabelAck === true
    }
  }
}

async function preflight(folder: string): Promise<void> {
  const settings = loadSettings(), engine = getEnginePath()
  if (!settings.openrouterApiKey) throw new Error('Add your OpenRouter key in Settings → API keys to make remixes.')
  for (const tool of ['ffmpeg', 'ffprobe'] as const) {
    try { await execFileAsync(resolveBinary(tool), ['-version'], { timeout: 15_000 }) }
    catch { throw new Error(`${tool === 'ffmpeg' ? 'FFmpeg' : 'FFprobe'} is missing. Run Settings → System check first.`) }
  }
  const python = await validatePython(resolvePythonPath(engine, settings.pythonPath), engine)
  if (!python.ok) throw new Error('The clipping engine is not ready. Run Settings → System check first.')
  try { await mkdir(folder, { recursive: true }); await access(folder, fsConstants.W_OK) }
  catch { throw new Error('The output folder is not writable. Choose another in Settings → Output.') }
}

function kill(child?: ChildProcess, force = false): void {
  if (!child?.pid) return
  try { if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => undefined); else process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM') } catch { /* already exited */ }
}

let starting = false

export async function startRemix(value: unknown): Promise<RemixStatus> {
  if (active || starting) throw new Error('A remix is already being made. Wait for it to finish or cancel it.')
  starting = true
  try {
    const settings = loadSettings()
    const { request } = parseRemixRequest(value, settings.outputDirectory)
    const brand = request.brandIdentityId ? await readBrandIdentity(request.brandIdentityId) : null
    let photo: string | null = null
    if (request.avatarId) {
      readAvatar(request.avatarId)
      photo = portraitPath(request.avatarId)
      if (!existsSync(photo)) throw new Error('That avatar’s photo is missing. Choose another avatar.')
    }
    const angle = REMIX_ANGLES.find((item) => item.id === request.angle)?.label ?? 'Remix'
    const folder = join(settings.outputDirectory, 'Remix', renderFolderName(`${angle} ${request.creator || ''}`.trim(), new Date()))
    await preflight(folder)
    const run: ActiveRemix = {
      cancelled: false,
      status: {
        id: randomBytes(6).toString('hex'), phase: 'running', detail: 'Starting', percent: 1, folder,
        estimateUsd: estimateRemixCost(request.host, request.count).total, outputs: [], costUsd: null, warnings: [], error: null
      }
    }
    active = run
    notify(run.status)
    void execute(run, request, {
      source: request.source, output_dir: folder, angle: request.angle, count: request.count, host: request.host, voice: request.voice,
      avatar_photo: photo, brand_identity: brand?.text ?? '', brand_name: brand?.name ?? '', creator: request.creator,
      caption_preset: request.captionPreset, include_captions: request.includeCaptions
    })
    return run.status
  } finally { starting = false }
}

async function execute(run: ActiveRemix, request: RemixRequest, config: Record<string, unknown>): Promise<void> {
  const settings = loadSettings(), engine = getEnginePath()
  const env: Record<string, string | undefined> = {
    ...runtimeEnvironment(), ...getSettingsForBridge(settings), LAYOUT_VISION_ENABLED: 'false',
    PYTHONPATH: engine, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1'
  }
  const ffmpegPath = resolveBinary('ffmpeg')
  if (ffmpegPath !== 'ffmpeg') env.PATH = `${dirname(ffmpegPath)}${delimiter}${env.PATH ?? ''}`
  const python = resolvePythonPath(engine, settings.pythonPath)
  logger.info('remix.start', { angle: request.angle, host: request.host, count: request.count, brand: Boolean(request.brandIdentityId) })
  const child = spawn(python, [join(dirname(getBridgeRunnerPath()), 'remix_runner.py')], {
    cwd: engine, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true
  })
  run.child = child
  let buffer = '', stderr = ''
  let result: Record<string, unknown> | null = null
  const timer = setTimeout(() => kill(child, true), 3 * 60 * 60_000)
  child.stdout.on('data', (chunk) => {
    buffer += String(chunk)
    let end: number
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
      try {
        const message = JSON.parse(line) as Record<string, unknown>
        if (message.type === 'progress' && typeof message.percent === 'number') {
          publish(run, { detail: typeof message.detail === 'string' ? message.detail.slice(0, 160) : run.status.detail, percent: message.percent })
        } else if (typeof message.ok === 'boolean') result = message
      } catch { /* ignore non-protocol output */ }
    }
  })
  child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-4000) })
  child.on('error', () => {
    clearTimeout(timer)
    finish(run, { phase: 'failed', error: 'The clipping engine could not start. Run Settings → System check.' })
  })
  child.on('close', () => {
    clearTimeout(timer); run.child = undefined
    if (run.status.phase !== 'running') return
    if (run.cancelled) { finish(run, { phase: 'cancelled', detail: 'Cancelled' }); return }
    if (result?.ok === true) {
      const outputs = (Array.isArray(result.remixes) ? result.remixes : []).map(parseRemixOutput).filter((item): item is RemixOutput => item !== null)
      const warnings = Array.isArray(result.warnings) ? result.warnings.filter((w): w is string => typeof w === 'string').map((w) => w.slice(0, 400)).slice(0, 10) : []
      const cost = typeof result.cost_usd === 'number' && Number.isFinite(result.cost_usd) ? result.cost_usd : null
      logger.info('remix.done', { count: outputs.length, cost })
      finish(run, { phase: 'done', detail: 'Done', percent: 100, outputs, warnings, costUsd: cost })
    } else {
      const message = typeof result?.error === 'string' && result.error !== 'failed' ? result.error.slice(0, 400) : 'The remix could not be made. Check Settings → System check, then try again.'
      logger.warn('remix.failed', { stderr: stderr.slice(-1500) })
      finish(run, { phase: 'failed', error: message })
    }
  })
  child.stdin.end(JSON.stringify(config))
}

export function cancelRemix(): boolean {
  if (!active) return false
  active.cancelled = true
  kill(active.child)
  return true
}

export function stopRemixForQuit(): void {
  if (active) { active.cancelled = true; kill(active.child, true) }
}
