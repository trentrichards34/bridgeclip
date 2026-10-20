// The engine behind every "chat to edit" panel (the clip editor's Chat tab,
// Edit my recording's review and Remix's review). One member message → one
// OpenRouter turn on the member's key, with the place's tools. Each tool call
// is checked by the place's `apply` against a working copy; an invalid call
// goes back to the model as an error so it can fix it. Main never writes the
// edit itself: the page applies the returned steps through its own setters
// (with Keep/Undo cards). What OpenRouter reports the turn cost goes to
// `onCost` (the caller records it in the spending ledger). Conversations are
// kept per thread for this app session only.

import { CHAT_MAX_MESSAGE_CHARS, CHAT_MAX_TOOL_CALLS, CHAT_MAX_TURNS, ChatToolError, chatCostNote, type ChatInfo, type ChatReplyOf, type ChatStepBase } from '../shared/chat-core'
import { isModelId, type OpenRouterModel } from '../shared/openrouter-models'
import { runOpenRouterTurn, type OpenRouterMessage, type OpenRouterTool } from './assistant/openrouter-agent'

/** Used when the member hasn't chosen a planning model in Advanced mode: quick, cheap and good with tools. */
export const DEFAULT_CHAT_MODEL = 'google/gemini-3.8-flash'
export const CHAT_TIMEOUT_MS = 120_000
const MAX_HISTORY_CHARS = 30_000
const MAX_REPLY_CHARS = 2_000
/** Rough tokens per message for the price note: context and history in, a short answer and tool calls out, over two steps. */
const ESTIMATE_INPUT_TOKENS = 2 * 9_000
const ESTIMATE_OUTPUT_TOKENS = 700

/** The planning model the member chose in Advanced mode, else the default. */
export function chatModel(create: { clippingMode?: unknown; plannerModel?: unknown } | undefined): string {
  return create?.clippingMode === 'advanced' && isModelId(create.plannerModel) ? create.plannerModel : DEFAULT_CHAT_MODEL
}

/** A per-message estimate from the model's listed token prices, or null when they're unknown. */
export function chatEstimateUsd(model: OpenRouterModel | undefined): number | null {
  if (!model || model.inputPrice === null || model.outputPrice === null) return null
  const usd = ESTIMATE_INPUT_TOKENS * model.inputPrice + ESTIMATE_OUTPUT_TOKENS * model.outputPrice
  return Number.isFinite(usd) && usd > 0 ? usd : null
}

/** Whether the chat can be used, its model and its price note. `what` ends the no-key sentence ("this clip"). */
export function chatInfoFor(input: { apiKey: boolean; model: string; catalogModel?: OpenRouterModel }, what: string): ChatInfo {
  const estimateUsd = chatEstimateUsd(input.catalogModel)
  return {
    ready: input.apiKey,
    ...(input.apiKey ? {} : { reason: `Add your OpenRouter key in Settings → API keys to chat about ${what}.` }),
    model: input.catalogModel?.name ?? input.model,
    costNote: chatCostNote(estimateUsd),
    estimateUsd
  }
}

/** The member's message, checked: plain text up to the limit (throws a plain message). */
export function chatMessage(message: unknown): string {
  if (typeof message !== 'string' || !message.trim() || message.length > CHAT_MAX_MESSAGE_CHARS) throw new Error(`Write a message of up to ${CHAT_MAX_MESSAGE_CHARS} characters.`)
  return message.trim()
}

export interface ToolChatInput<Step extends ChatStepBase> {
  apiKey: string
  model: string
  systemPrompt: string
  history: OpenRouterMessage[]
  message: string
  tools: OpenRouterTool[]
  /** Checks and applies one tool call to the working copy; throws ChatToolError for the model to fix. Returns the step and what the model is told. */
  apply: (name: string, args: Record<string, unknown>) => { step: Step; result: Record<string, unknown> }
  signal: AbortSignal
  url?: string
  fetch?: typeof fetch
  onCost?: (usd: number) => void
  maxToolCalls?: number
}

/** One member message: the model's answer and the checked steps, in order. History is not changed here. */
export async function runToolChat<Step extends ChatStepBase>(input: ToolChatInput<Step>): Promise<ChatReplyOf<Step>> {
  let calls = 0, reply = ''
  const steps: Step[] = []
  const limit = input.maxToolCalls ?? CHAT_MAX_TOOL_CALLS
  const error = await runOpenRouterTurn({
    apiKey: input.apiKey, model: input.model, signal: input.signal, url: input.url, fetch: input.fetch,
    systemPrompt: input.systemPrompt, history: input.history, prompt: input.message, tools: input.tools,
    onText: (text, newParagraph) => { if (reply.length < MAX_REPLY_CHARS) reply += `${newParagraph && reply ? '\n\n' : ''}${text}` },
    onActivity: () => {},
    onCost: input.onCost,
    callTool: async (name, args) => {
      if (++calls > limit) return { text: 'Too many changes for one message. Stop and tell the member what you did.', isError: true }
      try {
        const { step, result } = input.apply(name, args)
        steps.push(step)
        return { text: JSON.stringify({ ok: true, done: step.summary, ...result }) }
      } catch (e) {
        return { text: e instanceof ChatToolError ? e.message : 'That change could not be made.', isError: true }
      }
    }
  })
  const text = reply.replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_REPLY_CHARS)
  if (input.signal.aborted) return { reply: text, steps, error: 'The chat took too long and was stopped. Try again.' }
  // Edits without words are still an answer: the change card says what changed.
  const silent = !text && steps.length > 0 && error?.startsWith('The model ended without replying')
  return { reply: text, steps, ...(error && !silent ? { error } : {}) }
}

/** Per-thread conversations (this app session only), with one message in flight per thread. */
export class ChatMemory {
  private conversations = new Map<string, OpenRouterMessage[]>()
  private inFlight = new Set<string>()

  constructor(private readonly maxThreads = 200) {}

  /** A turn is remembered with the summaries of the edits it made (`kept` filters out look-only steps like play). */
  remember(key: string, message: string, result: ChatReplyOf<ChatStepBase>, kept: (step: ChatStepBase) => boolean = () => true): void {
    const history = this.conversations.get(key) ?? []
    const applied = result.steps.filter(kept).map((s) => s.summary)
    history.push({ role: 'user', content: message },
      { role: 'assistant', content: `${result.reply || '(no answer)'}${applied.length ? `\n[Edits made: ${applied.join(' ')}]` : ''}` })
    while (history.length > CHAT_MAX_TURNS * 2 || (history.length > 2 && history.reduce((n, m) => n + (m.content?.length ?? 0), 0) > MAX_HISTORY_CHARS)) history.splice(0, 2)
    this.conversations.delete(key)
    this.conversations.set(key, history)
    if (this.conversations.size > this.maxThreads) this.conversations.delete(this.conversations.keys().next().value!)
  }

  history(key: string): OpenRouterMessage[] { return [...(this.conversations.get(key) ?? [])] }
  reset(key: string): void { this.conversations.delete(key) }
  resetWhere(test: (key: string) => boolean): void { for (const key of [...this.conversations.keys()]) if (test(key)) this.conversations.delete(key) }

  /** Runs `work` as the only message in flight on this thread. */
  async exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
    if (this.inFlight.has(key)) throw new Error('Wait for the answer to your last message.')
    this.inFlight.add(key)
    try { return await work() } finally { this.inFlight.delete(key) }
  }
}
