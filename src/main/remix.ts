import { app } from 'electron'
import { execFile, execFileSync, spawn, type ChildProcess } from 'child_process'
import { randomBytes, randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { access, constants as fsConstants, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { delimiter, dirname, extname, join } from 'path'
import { promisify } from 'util'
import { isAvatarId } from '../shared/avatars'
import { isCaptionPresetId } from '../shared/caption-presets'
import {
  estimateRemixCost, isRemixAngle, isRemixHost, isRemixOrder, MAX_BRAND_IDENTITY_CHARS, MAX_CTA_OFFER_CHARS, MAX_REMIXES, MAX_SOURCES, parseRemixDraft, parseRemixEdits, parseRemixOutput,
  normalizeCtaKeyword, REMIX_VOICE_IDS, remixSourceUrl, type BrandIdentity, type RemixDraft, type RemixOutput, type RemixRequest, type RemixStatus
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
export async function readBrandIdentityFile(path: string): Promise<{ name: string; text: string; truncated: boolean }> {
  const extension = extname(path).slice(1).toLowerCase()
  if (!BRAND_IDENTITY_EXTENSIONS.includes(extension)) throw new Error('Choose a .txt or .md file, or paste the text.')
  const info = await stat(path)
  if (!info.isFile() || info.size > MAX_IMPORT_BYTES) throw new Error('That file is too large. Paste the text instead.')
  const text = (await readFile(path, 'utf8')).replace(/\r\n/g, '\n').trim()
  const name = path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '').slice(0, 120) || 'Brand identity'
  return { name, text: text.slice(0, MAX_BRAND_IDENTITY_CHARS), truncated: text.length > MAX_BRAND_IDENTITY_CHARS }
}

// ---------------------------------------------------------------------------
// Remix runs: plan (download, transcribe, write and grade takes) → review
// (the user edits or drops drafts; nothing paid for yet) → render.
// ---------------------------------------------------------------------------

interface RunContext {
  request: RemixRequest
  /** The engine config shared by both phases. */
  config: Record<string, unknown>
  draftIds: Set<number>
  planCostUsd: number
}

interface ActiveRemix { status: RemixStatus; child?: ChildProcess; cancelled: boolean; avatarId: string | null; context: RunContext }

let active: ActiveRemix | null = null
/** A planned run waiting for the user's review (not running, but holds the folder and drafts). */
let reviewing: ActiveRemix | null = null
let lastStatus: RemixStatus | null = null
let notify: (status: RemixStatus) => void = () => undefined

export function onRemixStatus(listener: (status: RemixStatus) => void): void { notify = listener }
export function remixStatus(): RemixStatus | null { return active?.status ?? reviewing?.status ?? lastStatus }

function running(run: ActiveRemix): boolean { return run.status.phase === 'planning' || run.status.phase === 'rendering' }

function publish(run: ActiveRemix, patch: Partial<RemixStatus>): void {
  if (!running(run)) return
  run.status = { ...run.status, ...patch, percent: Math.max(run.status.percent, Math.min(100, Math.round(patch.percent ?? run.status.percent))) }
  notify(run.status)
}

function finish(run: ActiveRemix, patch: Partial<RemixStatus>): void {
  run.status = { ...run.status, ...patch }
  lastStatus = run.status
  if (active === run) active = null
  reviewing = run.status.phase === 'review' ? run : reviewing === run ? null : reviewing
  notify(run.status)
}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.flv'])

export interface ParsedRemix { request: RemixRequest; sourceIsUrl: boolean }

export function parseRemixRequest(value: unknown, outputDirectory: string): ParsedRemix {
  const raw = (value ?? {}) as Record<string, unknown>
  const given = Array.isArray(raw.sources) ? raw.sources : typeof raw.source === 'string' ? [raw.source] : []
  const trimmed = given.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
  // De-duplicate after normalizing, so the same video pasted twice isn't planned twice.
  const sources = [...new Set(trimmed.map((item) => remixSourceUrl(item) ?? item))]
  if (sources.length === 0) throw new Error('Paste a video link or choose a file.')
  if (sources.length > MAX_SOURCES) throw new Error(`Add up to ${MAX_SOURCES} videos per run.`)
  const urls = sources.map(remixSourceUrl)
  const local = sources.filter((_, i) => !urls[i])
  if (local.length > 0) {
    if (sources.length > 1) throw new Error('Use one file at a time, or paste links (one per line) for several videos.')
    try { assertMediaPath(local[0], outputDirectory) } catch { throw new Error('Paste full video links (https://…) or choose the file again.') }
    if (!VIDEO_EXTENSIONS.has(extname(local[0]).toLowerCase())) throw new Error('Choose a video file (MP4, MOV, MKV or WebM).')
  }
  if (!isRemixAngle(raw.angle)) throw new Error('Choose a remix style.')
  const order = raw.order === undefined ? 'moment_first' : raw.order
  if (!isRemixOrder(order)) throw new Error('Choose the order of the video.')
  if (!isRemixHost(raw.host)) throw new Error('Choose how your presenter appears.')
  const avatarId = raw.host === 'voice' ? null : raw.avatarId
  if (raw.host !== 'voice' && !isAvatarId(avatarId)) throw new Error('Choose an avatar, or switch to voice only.')
  const voice = typeof raw.voice === 'string' && REMIX_VOICE_IDS.includes(raw.voice) ? raw.voice : null
  if (!voice) throw new Error('Choose a voice.')
  const brandIdentityId = raw.brandIdentityId === null || raw.brandIdentityId === undefined ? null : raw.brandIdentityId
  if (brandIdentityId !== null && !isBrandId(brandIdentityId)) throw new Error('Choose a brand identity.')
  if (typeof raw.count !== 'number' || !Number.isInteger(raw.count) || raw.count < 1 || raw.count > MAX_REMIXES) throw new Error(`Make between 1 and ${MAX_REMIXES} remixes per video.`)
  if (!isCaptionPresetId(raw.captionPreset)) throw new Error('Choose a caption style.')
  const creator = typeof raw.creator === 'string' ? raw.creator.replace(/\s+/g, ' ').trim() : ''
  if (creator.length > 80) throw new Error('Keep the creator name under 80 characters.')
  if (local.length > 0 && !creator) throw new Error('Add the original creator’s name so the video credits them.')
  if (raw.aiLabelAck !== true) throw new Error('Confirm you’ll turn on the AI-content label when you post.')
  const ctaKeyword = normalizeCtaKeyword(raw.ctaKeyword)
  if (ctaKeyword === null) throw new Error('Use one word for the comment keyword (letters, numbers or a dash), like SALES.')
  const ctaOffer = typeof raw.ctaOffer === 'string' ? raw.ctaOffer.replace(/\s+/g, ' ').trim() : ''
  if (ctaOffer.length > MAX_CTA_OFFER_CHARS) throw new Error(`Keep “what they get” under ${MAX_CTA_OFFER_CHARS} characters.`)
  return {
    sourceIsUrl: local.length === 0,
    request: {
      sources: sources.map((source, i) => urls[i] ?? source), creator: sources.length === 1 ? creator : '', angle: raw.angle, order,
      host: raw.host, avatarId: avatarId as string | null, voice, brandIdentityId,
      count: raw.count, captionPreset: raw.captionPreset, includeCaptions: raw.includeCaptions !== false, aiLabelAck: true,
      ctaKeyword, ctaOffer: ctaKeyword ? ctaOffer : ''
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

function kill(child?: ChildProcess, force = false, sync = false): void {
  if (!child?.pid) return
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
    else if (sync) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 })
    else execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => undefined)
  } catch { /* already exited */ }
}

let starting = false
/** The avatar and cancel request for a run still in its pre-flight checks. */
let pending: { avatarId: string | null; cancelled: boolean } | null = null

/**
 * Avatars a remix needs right now. A run uses its own copy of the photo once
 * it starts, so only a run still in its pre-flight checks needs the original.
 */
export function remixAvatarInUse(): string | null {
  return pending?.avatarId ?? null
}

// Variety guard: how often each creator was remixed recently (platforms flag repetitive reposting).
const LEDGER_DAYS = 7
const LEDGER_LIMIT = 5

function ledgerPath(): string { return join(app.getPath('userData'), 'remix-ledger.json') }

async function readLedger(): Promise<{ creator: string; at: string }[]> {
  try {
    const items = JSON.parse(await readFile(ledgerPath(), 'utf8')) as unknown
    const cutoff = Date.now() - LEDGER_DAYS * 86_400_000
    return Array.isArray(items) ? items.filter((item): item is { creator: string; at: string } =>
      Boolean(item) && typeof item.creator === 'string' && typeof item.at === 'string' && Date.parse(item.at) > cutoff).slice(-2000) : []
  } catch { return [] }
}

async function recordCreators(creators: string[]): Promise<void> {
  try {
    const items = [...await readLedger(), ...creators.filter(Boolean).map((creator) => ({ creator: creator.toLowerCase().slice(0, 120), at: new Date().toISOString() }))]
    await writeFile(ledgerPath(), JSON.stringify(items.slice(-2000)), 'utf8')
  } catch { /* advisory only */ }
}

export async function varietyWarnings(drafts: RemixDraft[]): Promise<string[]> {
  const ledger = await readLedger()
  const counts = new Map<string, number>()
  for (const item of ledger) counts.set(item.creator, (counts.get(item.creator) ?? 0) + 1)
  const warnings: string[] = []
  const planned = new Map<string, number>()
  for (const draft of drafts) if (draft.creator) planned.set(draft.creator, (planned.get(draft.creator) ?? 0) + 1)
  for (const [creator, count] of planned) {
    const total = (counts.get(creator.toLowerCase()) ?? 0) + count
    if (total > LEDGER_LIMIT) warnings.push(`You'd post ${total} remixes of ${creator} this week. Platforms can treat that as repetitive reposting; mix in other creators.`)
  }
  return warnings
}

export async function startRemix(value: unknown): Promise<RemixStatus> {
  if (active || starting) throw new Error('A remix is already being made. Wait for it to finish or cancel it.')
  starting = true
  try {
    const settings = loadSettings()
    const { request } = parseRemixRequest(value, settings.outputDirectory)
    pending = { avatarId: request.avatarId, cancelled: false }
    const brand = request.brandIdentityId ? await readBrandIdentity(request.brandIdentityId) : null
    let photo: string | null = null
    if (request.avatarId) {
      readAvatar(request.avatarId)
      photo = portraitPath(request.avatarId)
      if (!existsSync(photo)) throw new Error('That avatar’s photo is missing. Choose another avatar.')
    }
    // `remix-…` (not a bare id): the Library lists it only once it has finished videos.
    const folder = join(settings.outputDirectory, `remix-${randomUUID()}`)
    await preflight(folder)
    // Only once the new run can start: it replaces takes waiting for review.
    if (reviewing) await discardRemix()
    await cleanupAbandoned(settings.outputDirectory, folder)
    // The run reads its own copy, so editing or deleting the avatar can't break it.
    if (photo) {
      const copy = join(folder, '.presenter.jpg')
      await copyFile(photo, copy)
      photo = copy
    }
    if (pending.cancelled) { await rm(folder, { recursive: true, force: true }); throw new Error('Cancelled before it started.') }
    const context: RunContext = {
      request, draftIds: new Set(), planCostUsd: 0,
      config: {
        sources: request.sources, output_dir: folder, angle: request.angle, order: request.order, count: request.count, host: request.host,
        voice: request.voice, avatar_photo: photo, brand_identity: brand?.text ?? '', brand_name: brand?.name ?? '', creator: request.creator,
        caption_preset: request.captionPreset, include_captions: request.includeCaptions,
        cta_keyword: request.ctaKeyword, cta_offer: request.ctaOffer
      }
    }
    const run: ActiveRemix = {
      cancelled: false, avatarId: request.avatarId, context,
      status: {
        id: randomBytes(6).toString('hex'), phase: 'planning', detail: 'Starting', percent: 1, folder,
        estimateUsd: estimateRemixCost(request.host, request.count * request.sources.length).total,
        drafts: [], outputs: [], costUsd: null, warnings: [], error: null
      }
    }
    active = run
    notify(run.status)
    launch(run, { ...context.config, mode: 'plan' })
    return run.status
  } finally { starting = false; pending = null }
}

/** Render the drafts the user approved (with their edits). */
export async function renderRemix(value: unknown): Promise<RemixStatus> {
  if (active || starting) throw new Error('A remix is already being made. Wait for it to finish or cancel it.')
  const run = reviewing
  if (!run || run.status.phase !== 'review') throw new Error('There is nothing waiting for review. Plan the remixes again.')
  const edits = parseRemixEdits(value, run.context.draftIds)
  reviewing = null
  active = run
  run.cancelled = false
  run.status = { ...run.status, phase: 'rendering', detail: 'Starting', percent: 1, error: null,
    estimateUsd: run.status.drafts.filter((draft) => edits.some((edit) => edit.id === draft.id)).reduce((sum, draft) => sum + draft.estimateUsd, 0) }
  notify(run.status)
  launch(run, { ...run.context.config, mode: 'render', approved: edits })
  return run.status
}

/**
 * Remove what abandoned remix runs left behind (downloaded sources, plans,
 * the presenter copy). Finished videos are never deleted: a folder is only
 * removed when nothing but those leftovers is in it.
 */
export async function cleanupAbandoned(outputDirectory: string, keep: string | null = null): Promise<void> {
  let names: string[] = []
  try { names = await readdir(outputDirectory) } catch { return }
  for (const name of names) {
    if (!/^remix-[0-9a-f-]{36}$/.test(name)) continue
    const folder = join(outputDirectory, name)
    if (folder === keep || folder === active?.status.folder || folder === reviewing?.status.folder) continue
    try {
      await rm(join(folder, '.work'), { recursive: true, force: true })
      await rm(join(folder, '.presenter.jpg'), { force: true })
      if ((await readdir(folder)).length === 0) await rm(folder, { recursive: true, force: true })
    } catch { /* best effort */ }
  }
}

/** Drop a plan waiting for review and its downloaded sources. */
export async function discardRemix(): Promise<boolean> {
  const run = reviewing
  if (!run) return false
  reviewing = null
  await rm(run.status.folder, { recursive: true, force: true }).catch(() => undefined)
  finish(run, { phase: 'cancelled', detail: 'Discarded', drafts: [] })
  return true
}

function launch(run: ActiveRemix, config: Record<string, unknown>): void {
  execute(run, config).catch((error: unknown) => {
    logger.warn('remix.spawn.failed', { message: String(error).slice(0, 300) })
    finish(run, { phase: 'failed', error: 'The clipping engine could not start. Run Settings → System check.' })
  })
}

async function execute(run: ActiveRemix, config: Record<string, unknown>): Promise<void> {
  const settings = loadSettings(), engine = getEnginePath()
  const env: Record<string, string | undefined> = {
    ...runtimeEnvironment(), ...getSettingsForBridge(settings), LAYOUT_VISION_ENABLED: 'false',
    PYTHONPATH: engine, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1'
  }
  const ffmpegPath = resolveBinary('ffmpeg')
  if (ffmpegPath !== 'ffmpeg') env.PATH = `${dirname(ffmpegPath)}${delimiter}${env.PATH ?? ''}`
  const python = resolvePythonPath(engine, settings.pythonPath)
  const request = run.context.request
  logger.info('remix.start', { mode: config.mode, angle: request.angle, host: request.host, videos: request.sources.length, brand: Boolean(request.brandIdentityId) })
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
          if (!run.cancelled) publish(run, { detail: typeof message.detail === 'string' ? message.detail.slice(0, 160) : run.status.detail, percent: message.percent })
        } else if (typeof message.ok === 'boolean') result = message
      } catch { /* ignore non-protocol output */ }
    }
  })
  child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-4000) })
  child.on('error', () => {
    clearTimeout(timer)
    finish(run, { phase: 'failed', error: 'The clipping engine could not start. Run Settings → System check.' })
  })
  child.on('close', () => { void closed() })
  async function closed(): Promise<void> {
    clearTimeout(timer); run.child = undefined
    if (!running(run)) return
    const planning = run.status.phase === 'planning'
    if (run.cancelled) {
      if (planning) await rm(run.status.folder, { recursive: true, force: true }).catch(() => undefined)
      else await rm(join(run.status.folder, '.presenter.jpg'), { force: true }).catch(() => undefined)
      finish(run, { phase: 'cancelled', detail: planning ? 'Cancelled while planning' : 'Cancelled' })
      return
    }
    const warnings = Array.isArray(result?.warnings) ? result.warnings.filter((w): w is string => typeof w === 'string').map((w) => w.slice(0, 400)).slice(0, 12) : []
    const cost = typeof result?.cost_usd === 'number' && Number.isFinite(result.cost_usd) ? result.cost_usd : null
    if (result?.ok === true && planning) {
      const drafts = (Array.isArray(result.drafts) ? result.drafts : []).map(parseRemixDraft).filter((item): item is RemixDraft => item !== null)
      run.context.draftIds = new Set(drafts.map((draft) => draft.id))
      run.context.planCostUsd = cost ?? 0
      logger.info('remix.planned', { drafts: drafts.length, cost })
      finish(run, { phase: 'review', detail: 'Ready for review', percent: 100, drafts, warnings: [...warnings, ...await varietyWarnings(drafts)], costUsd: cost })
    } else if (result?.ok === true) {
      const outputs = (Array.isArray(result.remixes) ? result.remixes : []).map(parseRemixOutput).filter((item): item is RemixOutput => item !== null)
      await recordCreators(outputs.map((output) => output.creator))
      await rm(join(run.status.folder, '.presenter.jpg'), { force: true }).catch(() => undefined)
      logger.info('remix.done', { count: outputs.length, cost })
      finish(run, { phase: 'done', detail: 'Done', percent: 100, outputs, warnings, costUsd: (cost ?? 0) + run.context.planCostUsd })
    } else {
      const message = typeof result?.error === 'string' && result.error !== 'failed' ? result.error.slice(0, 400) : 'The remix could not be made. Check Settings → System check, then try again.'
      logger.warn('remix.failed', { stderr: stderr.slice(-1500) })
      if (planning) await rm(run.status.folder, { recursive: true, force: true }).catch(() => undefined)
      // Nothing was made but the plan is still there: back to review to retry without planning (and paying) again.
      if (!planning && existsSync(join(run.status.folder, '.work', 'plan.json'))) {
        finish(run, { phase: 'review', detail: 'Ready for review', percent: 100, error: message, warnings })
        return
      }
      finish(run, { phase: 'failed', error: message })
    }
  }
  child.stdin.on('error', () => undefined)
  child.stdin.end(JSON.stringify(config))
}

export function cancelRemix(): boolean {
  if (pending) { pending.cancelled = true; return true }
  if (!active) return false
  const run = active
  if (run.cancelled) return true
  run.cancelled = true
  run.status = { ...run.status, detail: 'Cancelling…' }
  notify(run.status)
  kill(run.child)
  // A download or upload in progress can ignore the polite stop; force it shortly after.
  setTimeout(() => { if (run.child) kill(run.child, true) }, 5000).unref()
  return true
}

export function stopRemixForQuit(): void {
  if (active) { active.cancelled = true; kill(active.child, true, true) }
}
