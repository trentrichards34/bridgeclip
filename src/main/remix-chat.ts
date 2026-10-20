// Remix's Chat panel, on the review of an on-camera remix. One member message
// → one OpenRouter turn (the member's key) with the take's facts (the part of
// their video, the take and its trim, the layout) and the words saved when the
// hook text was written. The model works through the tools in
// shared/remix-chat; every call is checked against a copy of the review
// (chat-engine.ts runs the loop). Main changes nothing here: the review applies
// the steps through its own setters and the same IPC calls its controls use.

import { randomBytes } from 'crypto'
import type { ChatInfo } from '../shared/chat-core'
import type { OpenRouterModel } from '../shared/openrouter-models'
import { isRemixGraphicFormat, parseRemixGraphics } from '../shared/reel-graphics'
import { MAX_POST_CAPTION_CHARS } from '../shared/remix'
import { MAX_HEADLINE_CHARS, REMIX_CHAT_TOOLS, applyRemixChatTool, remixChatContext, type RemixChatFacts, type RemixChatReply, type RemixChatState, type RemixChatStep } from '../shared/remix-chat'
import { CHAT_TIMEOUT_MS, ChatMemory, chatInfoFor, chatMessage, runToolChat } from './chat-engine'
import type { OpenRouterMessage } from './assistant/openrouter-agent'

const MAX_CONTEXT_CHARS = 50_000

const SYSTEM_PROMPT = `You help a creator finish ONE short vertical video in CreatorClips' Remix review: someone else's clip plus the creator on camera, for TikTok, Instagram and YouTube.
The member asks for a change in plain words; you make it with the tools, then answer in one to three short sentences (plain words, US spelling).

Rules:
- Their video's times are source ms; the member's take is ms into the take as recorded (Pause & react: ms into the finished video). Use the word times so cuts land between words.
- "Make my part shorter" or "cut my first sentence" trims the member's take (trim_my_take); "shorten their clip" changes the part of their video (set_their_clip).
- Only change what the member asked for. Don't invent words, numbers or quotes: hook text and graphics use what is said or what the member gives you.
- If a tool returns an error, fix the call and try again, or tell the member why it can't be done.
- Don't say you made a change unless its tool call succeeded.`

export function remixChatInfo(input: { apiKey: boolean; model: string; catalogModel?: OpenRouterModel }): ChatInfo {
  return chatInfoFor(input, 'your video')
}

/** The review's state from the page, checked (throws a plain message). */
export function parseRemixChatState(value: unknown, facts: RemixChatFacts): RemixChatState {
  const raw = (value ?? {}) as Record<string, unknown>
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof raw.draftId !== 'number') throw new Error('Choose a take to chat about.')
  if (typeof raw.headline !== 'string' || raw.headline.length > MAX_HEADLINE_CHARS) throw new Error('Your hook text is too long for the chat. Shorten it and try again.')
  if (typeof raw.postCaption !== 'string' || raw.postCaption.length > MAX_POST_CAPTION_CHARS) throw new Error('Your caption is too long for the chat. Shorten it and try again.')
  if (!isRemixGraphicFormat(facts.format)) throw new Error('The chat works with on-camera remixes.')
  let graphics
  try { graphics = parseRemixGraphics(raw.graphics ?? [], facts.format, facts.takeMs) } catch (error) { throw new Error(`Check your graphics: ${(error as Error).message}`) }
  return { draftId: raw.draftId, headline: raw.headline.replace(/\s+/g, ' ').trim(), postCaption: raw.postCaption, graphics }
}

export interface RemixChatTurnInput {
  apiKey: string
  model: string
  state: RemixChatState
  facts: RemixChatFacts
  words: Parameters<typeof remixChatContext>[2]
  message: string
  history: OpenRouterMessage[]
  signal: AbortSignal
  url?: string
  fetch?: typeof fetch
  onCost?: (usd: number) => void
  newId?: () => string
}

export async function runRemixChat(input: RemixChatTurnInput): Promise<RemixChatReply> {
  let context = remixChatContext(input.state, input.facts, input.words)
  if (context.length > MAX_CONTEXT_CHARS) context = `${context.slice(0, MAX_CONTEXT_CHARS)}\n(trimmed)`
  let state = input.state, facts = input.facts
  const newId = input.newId ?? (() => `g-${randomBytes(5).toString('hex')}`)
  return runToolChat<RemixChatStep>({
    apiKey: input.apiKey, model: input.model, signal: input.signal, url: input.url, fetch: input.fetch, onCost: input.onCost,
    systemPrompt: `${SYSTEM_PROMPT}\n\nThe video right now:\n${context}`,
    history: input.history, message: input.message, tools: REMIX_CHAT_TOOLS,
    apply: (name, args) => {
      const result = applyRemixChatTool(state, facts, name, args, newId)
      state = result.state; facts = result.facts
      return { step: result.step, result: { hook: state.headline, take: facts.takeTrim ?? 'whole', their_part: facts.theirClip ? [facts.theirClip.startMs, facts.theirClip.endMs] : null, graphics: state.graphics.length } }
    }
  })
}

const memory = new ChatMemory(30)

export interface RemixChatDeps {
  /** The take's facts and saved words (from the run in review). */
  facts: (draftId: unknown) => Promise<{ facts: RemixChatFacts; words: Parameters<typeof remixChatContext>[2]; runId: string }>
  apiKey: string
  model: string
  url?: string
  fetch?: typeof fetch
  onCost?: (usd: number) => void
}

/** The `remix:chat` request: checks the take and the page's state, runs the turn, remembers it per take. */
export async function remixChat(value: unknown, message: unknown, deps: RemixChatDeps): Promise<RemixChatReply> {
  if (!deps.apiKey) throw new Error('Add your OpenRouter key in Settings → API keys to chat about your video.')
  const text = chatMessage(message)
  const draftId = (value as { draftId?: unknown } | null)?.draftId
  const { facts, words, runId } = await deps.facts(draftId)
  const state = parseRemixChatState(value, facts)
  const key = `${runId}\n${state.draftId}`
  return memory.exclusive(key, async () => {
    const result = await runRemixChat({ apiKey: deps.apiKey, model: deps.model, url: deps.url, fetch: deps.fetch, onCost: deps.onCost,
      state, facts, words, message: text, history: memory.history(key), signal: AbortSignal.timeout(CHAT_TIMEOUT_MS) })
    memory.remember(key, text, result)
    return result
  })
}

export function resetRemixChat(runId: string, draftId: unknown): void {
  if (typeof draftId !== 'number' || !Number.isInteger(draftId) || draftId < 0 || draftId > 999) throw new Error('Invalid take')
  memory.reset(`${runId}\n${draftId}`)
}
export const remixChatHistory = (runId: string, draftId: number): OpenRouterMessage[] => memory.history(`${runId}\n${draftId}`)
