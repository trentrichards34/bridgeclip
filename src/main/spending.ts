import { app } from 'electron'
import { AsyncLocalStorage } from 'async_hooks'
import { createHash } from 'crypto'
import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { OPENROUTER_MODELS, PRICES, type AvatarRenderStatus } from '../shared/avatars'
import type { JobSnapshot } from '../shared/jobs'
import type { RemixStatus } from '../shared/remix'
import {
  cleanLabel, creditProblem, encodeSpendGate, friendlyCreditError, parseLedger, parseSpendEntry, parseSpendLimit, spendGateDecision, summarizeSpend,
  SPEND_GATE_PREFIX, type OpenRouterBalance, type SpendEntry, type SpendKind, type SpendOverview, type SpendProvider
} from '../shared/spending'
import { getJobHistory } from './file-manager'
import { logger } from './logger'
import { onMediaCharge, openRouterBase, type MediaCharge } from './openrouter-media'
import { loadSettings } from './settings-store'

/**
 * The spend ledger: one JSON line per finished paid action, in userData. It
 * holds only the time, kind, provider, amount and a generic label: never keys,
 * prompts, titles or file names. Amounts are what each provider reported, or
 * the app's own estimate where a provider reports none (marked `estimated`).
 */

const MAX_LEDGER_BYTES = 20 * 1024 * 1024
const BALANCE_TTL_MS = 3 * 60_000
const GATE_BALANCE_TIMEOUT_MS = 4000
const OVERRIDE_MS = 60_000

function dir(): string { return join(app.getPath('userData'), 'spending') }
function ledgerPath(): string { return join(dir(), 'ledger.jsonl') }
function statePath(): string { return join(dir(), 'state.json') }

let entries: SpendEntry[] | null = null
let loading: Promise<SpendEntry[]> | null = null
let writes: Promise<void> = Promise.resolve()
const recordedRuns = new Set<string>()
const changeListeners = new Set<() => void>()
const creditListeners = new Set<(provider: SpendProvider) => void>()

export function onSpendingChange(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

/** A provider said the credit ran out (the app shows its add-credits banner). */
export function onOutOfCredits(listener: (provider: SpendProvider) => void): () => void {
  creditListeners.add(listener)
  return () => creditListeners.delete(listener)
}

let lastCreditNotice = 0
export function noteCreditProblem(provider: SpendProvider): void {
  if (Date.now() - lastCreditNotice < 5000) return
  lastCreditNotice = Date.now()
  balanceCache = null
  for (const listener of creditListeners) { try { listener(provider) } catch { /* never breaks the caller */ } }
}

async function loadEntries(): Promise<SpendEntry[]> {
  if (entries) return entries
  loading ??= (async () => {
    let text = ''
    try {
      const info = await stat(ledgerPath())
      // An oversized ledger is read from its newest part.
      text = await readFile(ledgerPath(), 'utf8')
      if (info.size > MAX_LEDGER_BYTES) text = text.slice(-MAX_LEDGER_BYTES)
    } catch { /* no ledger yet */ }
    const parsed = parseLedger(text)
    for (const entry of parsed) if (entry.runId) recordedRuns.add(runKey(entry.kind, entry.runId))
    entries = parsed
    return parsed
  })().finally(() => { loading = null })
  return loading
}

function runKey(kind: SpendKind, runId: string): string { return `${kind}:${runId}` }

export interface SpendInput {
  kind: SpendKind
  provider: SpendProvider
  usd: number
  label: string
  runId?: string
  estimated?: boolean
  backfilled?: boolean
  at?: string
}

/** Append one entry. Zero, negative and unreadable amounts are skipped; a run is recorded once per kind when `once` is set. */
export async function recordSpend(input: SpendInput, once = false): Promise<SpendEntry | null> {
  const entry = parseSpendEntry({ ...input, at: input.at ?? new Date().toISOString(), label: cleanLabel(input.label) })
  if (!entry || entry.usd <= 0) return null
  const list = await loadEntries()
  if (once && entry.runId) {
    const key = runKey(entry.kind, entry.runId)
    if (recordedRuns.has(key)) return null
    recordedRuns.add(key)
  } else if (entry.runId) recordedRuns.add(runKey(entry.kind, entry.runId))
  list.push(entry)
  const line = JSON.stringify(entry) + '\n'
  writes = writes.then(async () => {
    await mkdir(dir(), { recursive: true, mode: 0o700 })
    await appendFile(ledgerPath(), line, { encoding: 'utf8', mode: 0o600 })
  }).catch((error: unknown) => { logger.warn('spending.write.failed', { code: (error as NodeJS.ErrnoException)?.code ?? 'unknown' }) })
  await writes
  balanceCache = null
  for (const listener of changeListeners) { try { listener() } catch { /* never breaks recording */ } }
  return entry
}

/** Wait for queued ledger writes (tests, quit). */
export function flushSpending(): Promise<void> { return writes }

// ---------------------------------------------------------------------------
// Backfill: earlier runs whose saved results carry a cost (once, best effort)
// ---------------------------------------------------------------------------

async function backfillOnce(): Promise<void> {
  try {
    const state = JSON.parse(await readFile(statePath(), 'utf8')) as { backfilled?: unknown }
    if (state.backfilled === true) return
  } catch { /* first time */ }
  const outputDirectory = loadSettings().outputDirectory
  try {
    const history = await getJobHistory(outputDirectory)
    for (const run of history) {
      if (run.status !== 'completed' || typeof run.totalCostUsd !== 'number' || run.totalCostUsd <= 0) continue
      const remix = run.jobId.startsWith('remix-')
      await recordSpend({
        kind: remix ? 'remix' : 'create', provider: 'openrouter', usd: run.totalCostUsd, label: remix ? 'Remix videos (earlier run)' : 'Create run (earlier run)',
        runId: run.jobId, backfilled: true, at: run.finishedAt ?? run.date
      }, true)
    }
  } catch (error) {
    logger.warn('spending.backfill.failed', { message: String((error as Error)?.message ?? error).slice(0, 200) })
  }
  try {
    await mkdir(dir(), { recursive: true, mode: 0o700 })
    const temp = `${statePath()}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify({ backfilled: true, at: new Date().toISOString() }), { mode: 0o600 })
    await rename(temp, statePath())
  } catch { /* tried again next time; recordSpend skips runs already recorded */ }
}

export async function spendOverview(now = new Date()): Promise<SpendOverview> {
  await backfillOnce()
  const settings = loadSettings()
  return {
    summary: summarizeSpend(await loadEntries(), now),
    limitUsd: parseSpendLimit(settings.monthlySpendLimitUsd) ?? null,
    openrouterConfigured: Boolean(settings.openrouterApiKey),
    falConfigured: Boolean(settings.falApiKey)
  }
}

export async function monthSpendUsd(now = new Date()): Promise<number> {
  return summarizeSpend(await loadEntries(), now, 0).thisMonthUsd
}

// ---------------------------------------------------------------------------
// OpenRouter balance
// ---------------------------------------------------------------------------

let balanceCache: { keyHash: string; at: number; value: OpenRouterBalance } | null = null

function hash(key: string): string { return createHash('sha256').update(key).digest('hex') }

async function getJson(path: string, key: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const response = await fetchImpl(`${openRouterBase()}${path}`, {
    redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    headers: { Authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://github.com/trentrichards34/bridgeclip', 'X-Title': 'CreatorClips' }
  })
  if (!response.ok) { await response.body?.cancel().catch(() => undefined); return { status: response.status, body: null } }
  const text = await response.text()
  if (text.length > 200_000) return { status: response.status, body: null }
  try {
    const json = JSON.parse(text) as { data?: unknown }
    return { status: response.status, body: json.data && typeof json.data === 'object' ? json.data as Record<string, unknown> : null }
  } catch { return { status: response.status, body: null } }
}

const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null

/**
 * What OpenRouter says is left. GET /credits (account credits minus usage)
 * needs a key allowed to read the account; GET /key gives what is left of
 * this key's own limit, when it has one. The lower known figure is used.
 */
export async function fetchOpenRouterBalance(key: string, options: { timeoutMs?: number; fetch?: typeof fetch } = {}): Promise<OpenRouterBalance> {
  const timeoutMs = options.timeoutMs ?? 10_000
  const fetchImpl = options.fetch ?? fetch
  const [credits, keyInfo] = await Promise.allSettled([getJson('/credits', key, timeoutMs, fetchImpl), getJson('/key', key, timeoutMs, fetchImpl)])
  const creditBody = credits.status === 'fulfilled' ? credits.value.body : null
  const keyBody = keyInfo.status === 'fulfilled' ? keyInfo.value.body : null
  const total = finite(creditBody?.total_credits), used = finite(creditBody?.total_usage)
  const accountRemainingUsd = total !== null && used !== null ? Math.round((total - used) * 10_000) / 10_000 : null
  const keyRemainingUsd = finite(keyBody?.limit_remaining)
  const known = [accountRemainingUsd, keyRemainingUsd].filter((value): value is number => value !== null)
  const remainingUsd = known.length ? Math.min(...known) : null
  let note: string | null = null
  if (remainingUsd === null) {
    const statuses = [credits, keyInfo].map((result) => result.status === 'fulfilled' ? result.value.status : 0)
    note = statuses.includes(401) ? 'OpenRouter rejected the API key, so the balance could not be checked.'
      : statuses.every((status) => status === 0) ? 'OpenRouter could not be reached to check the balance.'
        : keyBody ? 'This key can’t read your account balance and has no spending limit of its own. See your balance on OpenRouter.'
          : 'OpenRouter did not return a balance. See it on OpenRouter.'
  } else if (accountRemainingUsd === null) {
    note = 'This is what’s left of this key’s own spending limit. Your account balance may be lower.'
  }
  return { remainingUsd, accountRemainingUsd, keyRemainingUsd, checkedAt: new Date().toISOString(), note }
}

/** The cached balance (a few minutes), or a fresh one. Null when no OpenRouter key is saved. */
export async function openRouterBalance(force = false, timeoutMs?: number): Promise<OpenRouterBalance | null> {
  const key = loadSettings().openrouterApiKey
  if (!key) return null
  const keyHash = hash(key)
  if (!force && balanceCache && balanceCache.keyHash === keyHash && Date.now() - balanceCache.at < BALANCE_TTL_MS) return balanceCache.value
  const value = await fetchOpenRouterBalance(key, { timeoutMs })
  // Only a real figure is cached: a failed check is retried next time.
  if (value.remainingUsd !== null) balanceCache = { keyHash, at: Date.now(), value }
  return value
}

// ---------------------------------------------------------------------------
// The check before a paid run
// ---------------------------------------------------------------------------

/** IPC channels that start paid work, and so pass the spending check. */
export const GATED_CHANNELS = new Set(['job:start', 'job:startMany', 'job:moreClips', 'remix:start', 'remix:write', 'remix:render', 'remix:anotherMoment', 'remix:talkingPoints', 'remix:readTimecode', 'avatars:render', 'avatars:recreate', 'avatars:generateFaces', 'avatars:restyle', 'avatars:makeReactions', 'avatars:cloneVoice'])
const overrides = new Map<string, number>()

/** "Start anyway" after a low-balance warning: the next call on this channel skips the balance check (never the monthly limit). */
export function allowOnce(channel: unknown): boolean {
  if (typeof channel !== 'string' || !GATED_CHANNELS.has(channel)) throw new Error('Invalid spending override')
  overrides.set(channel, Date.now() + OVERRIDE_MS)
  return true
}

/** Throws the encoded gate when this paid run should not start. An unknown balance never blocks. */
export async function assertSpendAllowed(channel: string, provider: SpendProvider, estimateUsd: number | null, options: { balance?: boolean } = {}): Promise<void> {
  const settings = loadSettings()
  const limitUsd = parseSpendLimit(settings.monthlySpendLimitUsd) ?? null
  const override = (overrides.get(channel) ?? 0) > Date.now()
  let balanceUsd: number | null = null
  if (provider === 'openrouter' && settings.openrouterApiKey && !override && options.balance !== false) {
    try { balanceUsd = (await openRouterBalance(false, GATE_BALANCE_TIMEOUT_MS))?.remainingUsd ?? null } catch { balanceUsd = null }
  }
  let monthUsd = 0
  try { monthUsd = await monthSpendUsd() } catch { /* an unreadable ledger never blocks */ }
  const gate = spendGateDecision({ provider, estimateUsd, monthUsd, limitUsd, balanceUsd })
  if (gate) {
    logger.info('spending.gate', { channel, reason: gate.reason })
    throw new Error(encodeSpendGate(gate))
  }
  if (override) overrides.delete(channel)
}

/** An IPC error with the plain out-of-credits wording (the spending check passes through untouched). */
export function friendlyIpcError(error: unknown): unknown {
  const message = (error as { message?: unknown } | null)?.message
  if (typeof message !== 'string' || message.includes(SPEND_GATE_PREFIX)) return error
  const provider = creditProblem(message)
  if (!provider) return error
  noteCreditProblem(provider)
  return new Error(friendlyCreditError(message))
}

// ---------------------------------------------------------------------------
// Metering: OpenRouter media calls (images, speech, video) inside a paid action
// ---------------------------------------------------------------------------

interface Meter { kind: SpendKind; label: string; usd: number; estimated: boolean }
const meters = new AsyncLocalStorage<Meter>()

/** The cost of one media call: as reported, otherwise from list prices. */
export function mediaChargeUsd(charge: MediaCharge): { usd: number; estimated: boolean } {
  if (typeof charge.usd === 'number' && Number.isFinite(charge.usd) && charge.usd >= 0) return { usd: charge.usd, estimated: false }
  if (charge.what === 'image') return { usd: PRICES.image, estimated: true }
  if (charge.what === 'speech') {
    const rate = charge.model === OPENROUTER_MODELS.cloneTts ? PRICES.cloneTtsPer1000Chars : PRICES.ttsPer1000Chars
    return { usd: ((charge.chars ?? 0) / 1000) * rate, estimated: true }
  }
  const perSecond = charge.model === OPENROUTER_MODELS.scenePro ? PRICES.imageToVideoPerSecond : PRICES.imageToVideoStandardPerSecond
  return { usd: (charge.seconds ?? 5) * perSecond, estimated: true }
}

function onCharge(charge: MediaCharge): void {
  const { usd, estimated } = mediaChargeUsd(charge)
  const meter = meters.getStore()
  if (meter) { meter.usd += usd; meter.estimated ||= estimated; return }
  void recordSpend({ kind: 'avatar', provider: 'openrouter', usd, label: 'AI media', estimated })
}

function flushMeter(meter: Meter): Promise<SpendEntry | null> {
  return recordSpend({ kind: meter.kind, provider: 'openrouter', usd: meter.usd, label: meter.label, estimated: meter.estimated })
}

/** Run a paid action and record what its media calls cost once it settles (failed ones too: they may have spent). */
export async function metered<T>(kind: SpendKind, label: string, work: () => Promise<T>): Promise<T> {
  const meter: Meter = { kind, label, usd: 0, estimated: false }
  try { return await meters.run(meter, work) } finally { await flushMeter(meter).catch(() => null) }
}

// Avatar Studio renders keep running after their start call returns, so their meter is closed by the final status.
const avatarRenders = new Map<string, { meter: Meter; fal: boolean }>()

export async function meteredAvatarRender(fal: boolean, start: () => Promise<AvatarRenderStatus>): Promise<AvatarRenderStatus> {
  const meter: Meter = { kind: 'avatar', label: fal ? 'Avatar recreate' : 'Avatar video', usd: 0, estimated: false }
  const status = await meters.run(meter, start)
  if (status.phase === 'done' || status.phase === 'failed' || status.phase === 'cancelled') { await finishAvatar(status, { meter, fal }); return status }
  avatarRenders.set(status.id, { meter, fal })
  return status
}

async function finishAvatar(status: AvatarRenderStatus, render: { meter: Meter; fal: boolean }): Promise<void> {
  await flushMeter(render.meter)
  // fal.ai reports no cost to the app: a finished recreate is recorded at its estimate.
  if (render.fal && status.phase === 'done' && typeof status.estimatedCostUsd === 'number') {
    await recordSpend({ kind: 'avatar', provider: 'fal', usd: status.estimatedCostUsd, label: 'Avatar recreate', estimated: true })
  }
}

export function trackAvatarStatus(status: AvatarRenderStatus): void {
  const render = avatarRenders.get(status.id)
  if (status.error) { const provider = creditProblem(status.error); if (provider) noteCreditProblem(provider) }
  if (!render || (status.phase !== 'done' && status.phase !== 'failed' && status.phase !== 'cancelled')) return
  avatarRenders.delete(status.id)
  void finishAvatar(status, render).catch(() => undefined)
}

// ---------------------------------------------------------------------------
// Engine runs: Create jobs and Remix (their costs come back with the result)
// ---------------------------------------------------------------------------

export function trackJobSnapshot(snapshot: JobSnapshot): void {
  if (snapshot.status === 'failed' && creditProblem(`${snapshot.error ?? ''} ${snapshot.errorHint ?? ''}`)) noteCreditProblem('openrouter')
  if (snapshot.status !== 'completed' || !snapshot.output) return
  const costs = snapshot.output.metrics?.api_costs as { total_estimated_cost_usd?: unknown; cost_incomplete?: unknown } | undefined
  const usd = finite(costs?.total_estimated_cost_usd)
  if (usd === null || usd <= 0) return
  void recordSpend({ kind: 'create', provider: 'openrouter', usd, label: costs?.cost_incomplete === true ? 'Create run (cost partly reported)' : 'Create run', runId: snapshot.id }, true)
}

const remixRecorded = new Map<string, number>()

export function trackRemixStatus(status: RemixStatus): void {
  if (status.error) { const provider = creditProblem(status.error); if (provider) noteCreditProblem(provider) }
  if (status.phase === 'planning' || status.phase === 'rendering') return
  const total = finite(status.costUsd) ?? 0
  const before = remixRecorded.get(status.id) ?? 0
  if (total <= before + 1e-9) return
  remixRecorded.set(status.id, total)
  if (remixRecorded.size > 50) remixRecorded.delete(remixRecorded.keys().next().value as string)
  const label = status.phase === 'done' ? 'Remix videos' : status.drafts.some((draft) => draft.format === 'image' || draft.format === 'pause_react' ||
    (draft.format === 'moment_take' && draft.headline)) ? 'Remix headline' : 'Remix planning'
  void recordSpend({ kind: 'remix', provider: 'openrouter', usd: total - before, label, runId: basename(status.folder) || undefined })
}

/** Chat replies on OpenRouter report their cost; one entry per message. */
export function recordChatCost(usd: number): void {
  void recordSpend({ kind: 'chat', provider: 'openrouter', usd, label: 'Chat message' })
}

let started = false
export function initSpending(): void {
  if (started) return
  started = true
  onMediaCharge(onCharge)
}

/** Tests: forget everything held in memory. */
export function resetSpendingForTests(): void {
  entries = null; loading = null; balanceCache = null; recordedRuns.clear(); overrides.clear(); avatarRenders.clear(); remixRecorded.clear(); lastCreditNotice = 0
}
