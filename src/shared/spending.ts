// AI spending: what CreatorClips recorded from each provider's reported cost
// (or its own estimate when a provider reports none), plus the checks made
// before a paid run. Pure functions, shared by the main process and the UI.

export const SPEND_KINDS = ['create', 'edit', 'remix', 'avatar', 'chat'] as const
export type SpendKind = (typeof SPEND_KINDS)[number]
export type SpendProvider = 'openrouter' | 'fal' | 'heygen'
export const SPEND_PROVIDERS: readonly SpendProvider[] = ['openrouter', 'fal', 'heygen']
export const SPEND_PROVIDER_LABELS: Record<SpendProvider, string> = { openrouter: 'OpenRouter', fal: 'fal.ai', heygen: 'HeyGen' }

function isProvider(value: unknown): value is SpendProvider {
  return typeof value === 'string' && (SPEND_PROVIDERS as readonly string[]).includes(value)
}

export const SPEND_KIND_LABELS: Record<SpendKind, string> = {
  create: 'Create',
  edit: 'Edit my recording',
  remix: 'Remix',
  avatar: 'Avatar Studio',
  chat: 'Chat'
}

export interface SpendEntry {
  /** ISO time the paid action finished. */
  at: string
  kind: SpendKind
  provider: SpendProvider
  usd: number
  /** A short, generic description such as "Remix videos" (never member content). */
  label: string
  runId?: string
  /** The provider reported no cost, so this is the app's own estimate. */
  estimated?: boolean
  /** Added from an older run's saved cost when the ledger was first created. */
  backfilled?: boolean
}

export interface SpendSummary {
  thisMonthUsd: number
  lastMonthUsd: number
  allTimeUsd: number
  byKind: Record<SpendKind, { thisMonthUsd: number; allTimeUsd: number }>
  /** Newest first. */
  recent: SpendEntry[]
  count: number
}

export interface OpenRouterBalance {
  /** What the gate compares with: the lower of the account and key figures that are known. */
  remainingUsd: number | null
  /** Credits bought minus credits used on the account (needs a key allowed to read it). */
  accountRemainingUsd: number | null
  /** What is left of this key's own spending limit, when it has one. */
  keyRemainingUsd: number | null
  checkedAt: string
  /** Why no balance is shown, in plain words. */
  note: string | null
}

export interface SpendOverview {
  summary: SpendSummary
  /** Monthly limit in USD, or null for none. */
  limitUsd: number | null
  openrouterConfigured: boolean
  falConfigured: boolean
  heygenConfigured: boolean
}

export interface SpendGate {
  reason: 'balance' | 'limit'
  provider: SpendProvider
  message: string
  /** Balance checks can be skipped by the member; the monthly limit can only be raised. */
  canOverride: boolean
  estimateUsd: number | null
}

/** A paid run is blocked on a low balance when no estimate exists and less than this is left. */
export const MIN_BALANCE_USD = 1
export const LIMIT_WARNING_SHARE = 0.8
export const MAX_LIMIT_USD = 100_000
export const MAX_LABEL_CHARS = 60
const MAX_ENTRY_USD = 10_000

/** Text the main process throws so the preload can show the spending check (prefix + JSON). */
export const SPEND_GATE_PREFIX = 'SPEND_GATE '

function money(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_ENTRY_USD
}

export function cleanLabel(value: unknown): string {
  if (typeof value !== 'string') return 'AI request'
  const text = Array.from(value, (char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char)).join('').replace(/\s+/g, ' ').trim()
  return text.slice(0, MAX_LABEL_CHARS) || 'AI request'
}

/** One stored entry, or null when it is unreadable. Unknown fields are dropped. */
export function parseSpendEntry(value: unknown): SpendEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.at !== 'string' || raw.at.length > 40 || !Number.isFinite(Date.parse(raw.at))) return null
  if (!(SPEND_KINDS as readonly unknown[]).includes(raw.kind)) return null
  if (!isProvider(raw.provider)) return null
  if (!money(raw.usd)) return null
  const entry: SpendEntry = { at: new Date(Date.parse(raw.at)).toISOString(), kind: raw.kind as SpendKind, provider: raw.provider, usd: raw.usd, label: cleanLabel(raw.label) }
  if (typeof raw.runId === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(raw.runId)) entry.runId = raw.runId
  if (raw.estimated === true) entry.estimated = true
  if (raw.backfilled === true) entry.backfilled = true
  return entry
}

/** Entries from the JSON-lines ledger; broken or unknown lines are skipped. */
export function parseLedger(text: string): SpendEntry[] {
  const entries: SpendEntry[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const entry = parseSpendEntry(JSON.parse(trimmed))
      if (entry) entries.push(entry)
    } catch { /* a torn or hand-edited line */ }
  }
  return entries
}

/** The calendar month an instant falls in, on this computer's clock (local time). */
function monthKey(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth()
}

function cents(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

export function summarizeSpend(entries: readonly SpendEntry[], now = new Date(), recentCount = 20): SpendSummary {
  const thisMonth = monthKey(now)
  const byKind = Object.fromEntries(SPEND_KINDS.map((kind) => [kind, { thisMonthUsd: 0, allTimeUsd: 0 }])) as SpendSummary['byKind']
  let thisMonthUsd = 0, lastMonthUsd = 0, allTimeUsd = 0
  for (const entry of entries) {
    const month = monthKey(new Date(entry.at))
    allTimeUsd += entry.usd
    byKind[entry.kind].allTimeUsd += entry.usd
    if (month === thisMonth) { thisMonthUsd += entry.usd; byKind[entry.kind].thisMonthUsd += entry.usd }
    else if (month === thisMonth - 1) lastMonthUsd += entry.usd
  }
  for (const kind of SPEND_KINDS) byKind[kind] = { thisMonthUsd: cents(byKind[kind].thisMonthUsd), allTimeUsd: cents(byKind[kind].allTimeUsd) }
  const recent = [...entries].sort((a, b) => b.at.localeCompare(a.at)).slice(0, recentCount)
  return { thisMonthUsd: cents(thisMonthUsd), lastMonthUsd: cents(lastMonthUsd), allTimeUsd: cents(allTimeUsd), byKind, recent, count: entries.length }
}

/** The saved limit: '' is none; otherwise dollars, up to two decimals. Returns undefined when invalid. */
export function parseSpendLimit(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 && value <= MAX_LIMIT_USD ? Math.round(value * 100) / 100 : undefined
  if (typeof value !== 'string') return undefined
  const text = value.trim().replace(/^\$/, '').replace(/,/g, '')
  if (!text) return null
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(text)) return undefined
  const amount = Number(text)
  return amount > 0 && amount <= MAX_LIMIT_USD ? amount : undefined
}

export function formatSpendUsd(amount: number): string {
  if (amount > 0 && amount < 0.01) return '<$0.01'
  return `$${amount.toFixed(2)}`
}

/**
 * Whether a paid run may start. The monthly limit is checked first and can only
 * be raised; a low OpenRouter balance can be skipped ("Start anyway"). An
 * unknown balance never blocks.
 */
export function spendGateDecision(input: {
  provider: SpendProvider
  estimateUsd: number | null
  monthUsd: number
  limitUsd: number | null
  balanceUsd: number | null
}): SpendGate | null {
  const estimate = input.estimateUsd !== null && Number.isFinite(input.estimateUsd) && input.estimateUsd > 0 ? input.estimateUsd : null
  if (input.limitUsd !== null && (estimate === null ? input.monthUsd >= input.limitUsd : input.monthUsd + estimate > input.limitUsd)) {
    return {
      reason: 'limit', provider: input.provider, canOverride: false, estimateUsd: estimate,
      message: `This would go over your monthly AI spending limit of ${formatSpendUsd(input.limitUsd)}. ` +
        `This month so far: about ${formatSpendUsd(input.monthUsd)}${estimate !== null ? `, and this is estimated at about ${formatSpendUsd(estimate)}` : ''}. ` +
        'To continue, raise or clear the limit in Settings → Spending.'
    }
  }
  if (input.provider === 'openrouter' && input.balanceUsd !== null && Number.isFinite(input.balanceUsd)) {
    const needed = estimate ?? MIN_BALANCE_USD
    if (input.balanceUsd < needed) {
      return {
        reason: 'balance', provider: 'openrouter', canOverride: true, estimateUsd: estimate,
        message: `Your OpenRouter balance is about ${formatSpendUsd(Math.max(0, input.balanceUsd))}, ` +
          `${estimate !== null ? `less than this run’s estimate of about ${formatSpendUsd(estimate)}` : `under ${formatSpendUsd(MIN_BALANCE_USD)}`}. ` +
          'It may stop partway when the credit runs out. Add credits on OpenRouter first, or start anyway.'
      }
    }
  }
  return null
}

export function encodeSpendGate(gate: SpendGate): string {
  return SPEND_GATE_PREFIX + JSON.stringify(gate)
}

/** The gate inside an IPC error message, or null. */
export function decodeSpendGate(message: unknown): SpendGate | null {
  if (typeof message !== 'string') return null
  const at = message.indexOf(SPEND_GATE_PREFIX)
  if (at < 0) return null
  try {
    const raw = JSON.parse(message.slice(at + SPEND_GATE_PREFIX.length)) as Record<string, unknown>
    if ((raw.reason !== 'balance' && raw.reason !== 'limit') || !isProvider(raw.provider) || typeof raw.message !== 'string') return null
    return {
      reason: raw.reason, provider: raw.provider, message: raw.message.slice(0, 600), canOverride: raw.reason === 'balance' && raw.canOverride === true,
      estimateUsd: typeof raw.estimateUsd === 'number' && Number.isFinite(raw.estimateUsd) ? raw.estimateUsd : null
    }
  } catch { return null }
}

export const OUT_OF_CREDITS_MESSAGES: Record<SpendProvider, string> = {
  openrouter: 'Your OpenRouter account is out of credits. Add credits on OpenRouter (Settings → Spending has the link), then try again.',
  fal: 'Your fal.ai balance is empty. Add credits on fal.ai (Settings → Spending has the link), then try again.',
  heygen: 'Your HeyGen balance is too low for this. Add credit on HeyGen (Settings → Spending has the link), then try again.'
}

/** Which provider an error says is out of credit, if any. */
export function creditProblem(text: unknown): SpendProvider | null {
  if (typeof text !== 'string' || !text) return null
  if (/fal\.ai balance|fal\.ai[^.]*\b(?:credits?|balance)\b[^.]*\b(?:empty|insufficient|exhausted|out)\b/i.test(text)) return 'fal'
  if (/HeyGen balance is too low/i.test(text)) return 'heygen'
  if (/out of credits?|insufficient (?:credits?|funds|balance)|credit limit reached|\bstatus(?: code)?:? ?402\b|\(402\)/i.test(text)) return 'openrouter'
  return null
}

/** The same plain message wherever a provider says the credit ran out; other errors unchanged. */
export function friendlyCreditError(text: string): string {
  const provider = creditProblem(text)
  return provider ? OUT_OF_CREDITS_MESSAGES[provider] : text
}
