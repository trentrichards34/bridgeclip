// Edit my recording's Chat panel. One member message → one OpenRouter turn
// (the member's key) with the plan's words (kept and cut), takes, hooks, cards,
// pop-ups, sounds, graphics and the look as context. The model edits through
// the tools in shared/edit-chat; every call is checked against a copy of the
// review's choices (chat-engine.ts runs the loop). Main never changes the run:
// the review applies the returned steps through its own setters.

import { randomBytes } from 'crypto'
import { EDIT_CHAT_TOOLS, applyEditChatTool, editChatContext, type EditChatReply, type EditChatStep } from '../shared/edit-chat'
import { parseEditDecisions, reelSeconds, formatClock, type EditDecisions, type EditStatus } from '../shared/edit-recording'
import type { OpenRouterModel } from '../shared/openrouter-models'
import type { ChatInfo } from '../shared/chat-core'
import { CHAT_TIMEOUT_MS, ChatMemory, chatInfoFor, chatMessage, runToolChat } from './chat-engine'
import { messageWithPoints, parseChatPoints, type ChatPoint } from '../shared/chat-point'

const MAX_CONTEXT_CHARS = 60_000

const SYSTEM_PROMPT = `You edit ONE short vertical reel in CreatorClips' "Edit my recording" review, for a creator who posts to TikTok, Instagram and YouTube.
The member recorded themselves talking to camera (maybe in a few takes); the app transcribed it and planned the edit. They ask for a change in plain words; you make it with the tools, then answer in one to three short sentences (plain words, US spelling).

Rules:
- Words are referred to by their index in the transcript (index:word). Cut and keep whole lines or phrases, never half a word.
- Retakes: when they said a line more than once, the later take is usually the keeper. "Remove the second retake" means the second repeat of the line.
- Only change what the member asked for. Don't invent words, numbers or quotes: hook text, pop-ups, cards and graphics use what was said or what the member gives you.
- A graphic starts on a kept word and can't play during a half-screen card.
- If a tool returns an error, fix the call and try again, or tell the member why it can't be done.
- Don't say you made a change unless its tool call succeeded.
- The member may point at the video (pins). "Put an arrow here": add_graphic with template highlight and the pin. "Move the graphic here": update_graphic with the pin. Zooming and blurring part of the video aren't supported here: say so plainly.`

export function editChatInfo(input: { apiKey: boolean; model: string; catalogModel?: OpenRouterModel }): ChatInfo {
  return chatInfoFor(input, 'your edit')
}

export interface EditChatTurnInput {
  apiKey: string
  model: string
  status: EditStatus & { plan: NonNullable<EditStatus['plan']> }
  decisions: EditDecisions
  message: string
  history: ReturnType<ChatMemory['history']>
  signal: AbortSignal
  url?: string
  fetch?: typeof fetch
  onCost?: (usd: number) => void
  newId?: () => string
  /** Pins the member put on the preview with this message (checked). */
  points?: ChatPoint[]
}

/** One member message: the model's answer and the checked changes. */
export async function runEditChat(input: EditChatTurnInput): Promise<EditChatReply> {
  const ctx = { plan: input.status.plan, images: input.status.images ?? [] }
  let context = editChatContext(input.decisions, ctx, input.status.sources)
  if (context.length > MAX_CONTEXT_CHARS) context = `${context.slice(0, MAX_CONTEXT_CHARS)}\n(trimmed)`
  let working = input.decisions
  const newId = input.newId ?? (() => `g-${randomBytes(5).toString('hex')}`)
  const points = input.points ?? []
  return runToolChat<EditChatStep>({
    apiKey: input.apiKey, model: input.model, signal: input.signal, url: input.url, fetch: input.fetch, onCost: input.onCost,
    systemPrompt: `${SYSTEM_PROMPT}\n\nThe edit right now:\n${context}`,
    history: input.history, message: messageWithPoints(input.message, points), tools: EDIT_CHAT_TOOLS,
    apply: (name, args) => {
      const { step, decisions } = applyEditChatTool(working, name, args, ctx, newId, points)
      working = decisions
      return { step, result: { reel: `The reel is now about ${formatClock(reelSeconds(ctx.plan, working))} long.`, cut_words: working.cut.length } }
    }
  })
}

const memory = new ChatMemory(20)

export interface EditChatDeps {
  status: EditStatus | null
  apiKey: string
  model: string
  url?: string
  fetch?: typeof fetch
  onCost?: (usd: number) => void
}

/** The `edit:chat` request: checks the review's choices the page sent against the run's plan, runs the turn, remembers it. */
export async function editRecordingChat(value: unknown, message: unknown, deps: EditChatDeps, pins?: unknown): Promise<EditChatReply> {
  const status = deps.status
  if (!status || status.phase !== 'review' || !status.plan) throw new Error('There is no edit waiting for review.')
  if (!deps.apiKey) throw new Error('Add your OpenRouter key in Settings → API keys to chat about your edit.')
  const text = chatMessage(message)
  const points = parseChatPoints(pins)
  let decisions: EditDecisions
  try { decisions = parseEditDecisions(value, status.plan, status.images ?? []) } catch (error) {
    throw new Error(`Your edit has a choice the chat can’t read (${(error as Error).message.replace(/\.$/, '')}). Fix it and try again.`)
  }
  const key = status.id
  return memory.exclusive(key, async () => {
    const result = await runEditChat({
      apiKey: deps.apiKey, model: deps.model, url: deps.url, fetch: deps.fetch, onCost: deps.onCost,
      status: status as EditChatTurnInput['status'], decisions, message: text, history: memory.history(key), signal: AbortSignal.timeout(CHAT_TIMEOUT_MS), points
    })
    memory.remember(key, messageWithPoints(text, points), result)
    return result
  })
}

export function resetEditChat(runId: unknown): void {
  if (typeof runId !== 'string' || runId.length > 64) throw new Error('Invalid edit')
  memory.reset(runId)
}
export const editChatHistory = (runId: string): ReturnType<ChatMemory['history']> => memory.history(runId)
