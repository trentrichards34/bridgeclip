/**
 * What every "chat to edit" panel shares (the clip editor's Chat tab, Edit my
 * recording's review and Remix's review): the reply shape, the cost note, the
 * error a tool call throws for the model to fix, and plain-text helpers. Each
 * place keeps its own tools and checks; main runs them through
 * src/main/chat-engine.ts and the page through components/ChatPanel.tsx.
 */

export const CHAT_MAX_MESSAGE_CHARS = 1000
/** Turns (a member message and its answer) the model remembers per thread. */
export const CHAT_MAX_TURNS = 20
/** Tool calls one message may make (edits and play requests). */
export const CHAT_MAX_TOOL_CALLS = 12
/** Model round trips one message may take (each batch of tool calls is one; the last is text-only). */
export const CHAT_MAX_STEPS = 6

/** One checked change: a plain sentence for the change card, plus what the place needs to apply it. */
export interface ChatStepBase { tool: string; summary: string }

export interface ChatReplyOf<Step extends ChatStepBase> {
  /** The model's short answer. */
  reply: string
  steps: Step[]
  /** Set when the request failed; steps made before the failure are still valid. */
  error?: string
}

export interface ChatInfo {
  ready: boolean
  /** Why the chat can't be used, in plain words. */
  reason?: string
  model: string
  /** A cost note based on the model's listed price, or the plain credit note. */
  costNote: string
  /** Per-message estimate in USD, when the model's price is known. */
  estimateUsd: number | null
}

/** A tool call the model should fix; its message goes back to the model. */
export class ChatToolError extends Error {}

export const chatFail = (message: string): never => { throw new ChatToolError(message) }

/** One line of plain text: control characters become spaces, runs of space collapse. */
export function chatPlainText(value: string, max: number): string {
  return value.split('').map((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char).join('').replace(/\s+/g, ' ').trim().slice(0, max)
}

export const chatSeconds = (ms: number): string => `${(Math.round(ms / 100) / 10).toFixed(1)}s`
export function chatClock(ms: number): string {
  const total = Math.max(0, ms) / 1000, m = Math.floor(total / 60), s = total - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

/** Ends a sentence once, after a closing quote if there is one. */
export const chatSentence = (s: string): string => /[.!?]["'”’]?$/.test(s) ? s : `${s}.`

/** The tool's optional `reason`, as words added to a summary (" to include …" or " (…)"). */
export function chatReason(args: Record<string, unknown>): string {
  if (typeof args.reason !== 'string') return ''
  const r = chatPlainText(args.reason, 120).replace(/[.\s]+$/, '')
  return r ? ` ${/^(to|so|for|because|and)\b/i.test(r) ? r : `(${r})`}` : ''
}

/** Text the model gave: one plain line, not empty, at most `max` characters. */
export function chatText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string') chatFail(`${name} must be text.`)
  const clean = chatPlainText(value as string, max + 1)
  if (!clean) chatFail(`${name} can't be empty.`)
  if (clean.length > max) chatFail(`${name} must be at most ${max} characters.`)
  return clean
}

function chatPrice(usd: number): string {
  const cents = usd * 100
  return cents < 0.5 ? 'less than a cent' : cents < 99.5 ? `about ${Math.round(cents)}¢` : `about $${usd.toFixed(2)}`
}

/**
 * "About 1¢ per message" from a per-message estimate; with `mostUsd` (a message that uses every round trip it
 * may), also what one can cost at most when that reads differently.
 */
export function chatCostNote(estimateUsd: number | null, mostUsd?: number | null): string {
  if (estimateUsd === null || !Number.isFinite(estimateUsd) || estimateUsd <= 0) return 'Each message uses your OpenRouter credit.'
  const typical = chatPrice(estimateUsd)
  const most = typeof mostUsd === 'number' && Number.isFinite(mostUsd) && mostUsd > estimateUsd ? chatPrice(mostUsd).replace(/^about /, '') : null
  const start = typical === 'less than a cent' ? 'Each message costs less than a cent' : `Each message costs ${typical}`
  return most && most !== typical.replace(/^about /, '') ? `${start} of your OpenRouter credit, up to ${most} when it makes many changes.` : `${start} of your OpenRouter credit.`
}

/** Steps from another process: each with a tool name and summary (the place checks what they change before use). */
export function parseStepsLoose<Step extends ChatStepBase>(value: unknown, extra: (raw: Record<string, unknown>) => Omit<Step, 'tool' | 'summary'> | null): Step[] {
  if (!Array.isArray(value) || value.length > CHAT_MAX_TOOL_CALLS) return []
  return value.flatMap((raw): Step[] => {
    if (!raw || typeof raw !== 'object') return []
    const s = raw as Record<string, unknown>
    if (typeof s.tool !== 'string' || typeof s.summary !== 'string') return []
    const rest = extra(s)
    return rest ? [{ ...rest, tool: s.tool.slice(0, 40), summary: s.summary.slice(0, 400) } as Step] : []
  })
}
