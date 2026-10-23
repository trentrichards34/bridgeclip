// The clip editor's Chat tab. One member message → one OpenRouter turn (the
// member's key) with the clip's state, the words around it and its loud
// moments as context. The model edits through the tools in shared/clip-chat;
// every call is checked against a copy of the clip and an invalid one goes back
// to the model as an error (the generic loop is in chat-engine.ts). Main never
// writes the project: the renderer applies the returned steps through the
// editor's own change() path (undo, autosave and Bake work unchanged).

import { spawn } from 'child_process'
import { constants, statSync } from 'fs'
import { open } from 'fs/promises'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { applyChatTool, chatToolsFor, chatClock, chatPlainText, clipLengthNote, pinSourceMs, type ChatInfo, type ChatProject, type ChatReply, type ChatStep } from '../shared/clip-chat'
import { SCREEN_KIND_LABELS, screenKindOf, screenShareOf } from '../shared/screen-pair'
import { messageWithPoints, parseChatPoints, type ChatPoint } from '../shared/chat-point'
import { editDuration, parseCandidateEdit, type CandidateEdit, type EditorProject } from '../shared/clip-editor'
import { parseGraphics } from '../shared/motion-graphics'
import type { OpenRouterModel } from '../shared/openrouter-models'
import type { OpenRouterMessage } from './assistant/openrouter-agent'
import { CHAT_TIMEOUT_MS, ChatMemory, DEFAULT_CHAT_MODEL, chatEstimateUsd, chatInfoFor, chatMessage, chatModel, runToolChat } from './chat-engine'
import { isWithinDirectory } from './security'

export { DEFAULT_CHAT_MODEL, chatEstimateUsd, chatModel }
/** Words around the clip the model sees, each side. */
export const CHAT_CONTEXT_MS = 60_000
const MAX_CONTEXT_CHARS = 48_000

export function chatInfo(input: { apiKey: boolean; model: string; catalogModel?: OpenRouterModel; modelName?: string }): ChatInfo {
  return chatInfoFor(input, 'this clip')
}

// ── Transcript words ──────────────────────────────────────────────────────
export interface ChatWord { word: string; start_ms: number; end_ms: number }
export interface ChatSegment { start_ms: number; end_ms: number; text: string; speaker: string | null; words: ChatWord[]; events: string[] }

const int = (x: unknown): number | null => typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.round(x) : null
const plain = chatPlainText

/** The run's saved transcript.json segments in [from, to] (with words and sound tags when saved), or null. */
export async function readChatTranscript(run: string, from: number, to: number): Promise<ChatSegment[] | null> {
  const path = join(run, 'transcript.json')
  let data: unknown
  try {
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    try {
      const stat = await handle.stat(), current = statSync(path)
      if (!stat.isFile() || stat.size > 32 * 1024 * 1024 || stat.ino !== current.ino || !isWithinDirectory(path, run)) return null
      data = JSON.parse((await handle.readFile()).toString('utf8'))
    } finally { await handle.close() }
  } catch { return null }
  const segments = (data as { segments?: unknown } | null)?.segments
  if (!Array.isArray(segments) || segments.length > 100000) return null
  const out: ChatSegment[] = []
  for (const raw of segments) {
    if (!raw || typeof raw !== 'object') continue
    const s = raw as Record<string, unknown>
    const start = int(s.start_time_ms), end = int(s.end_time_ms)
    if (start === null || end === null || end < start || end < from || start > to || typeof s.text !== 'string') continue
    const words = (Array.isArray(s.words) ? s.words : []).flatMap((w): ChatWord[] => {
      const x = w as Record<string, unknown> | null
      const ws = int(x?.start_time_ms), we = int(x?.end_time_ms)
      return x && typeof x.word === 'string' && ws !== null && we !== null && we >= ws ? [{ word: plain(x.word, 60), start_ms: ws, end_ms: we }] : []
    }).filter((w) => w.word)
    const events = (Array.isArray(s.audio_events) ? s.audio_events : []).filter((e): e is string => typeof e === 'string').map((e) => plain(e, 40)).filter(Boolean).slice(0, 20)
    out.push({ start_ms: start, end_ms: end, text: plain(s.text, 4000), speaker: typeof s.speaker_label === 'string' ? plain(s.speaker_label, 40) : null, words, events })
    if (out.length > 4000) break
  }
  return out
}

// ── Loud moments (audio cues) ─────────────────────────────────────────────
export interface LoudMoment { start_ms: number; end_ms: number; db_above: number }
const FRAME_MS = 100
const SAMPLE_RATE = 8000
const loudCache = new Map<string, LoudMoment[]>()

/** Short bursts louder than the talking around them, from 16-bit mono PCM starting at `offsetMs`. */
export function findLoudMoments(pcm: Buffer, offsetMs: number, limit = 15): LoudMoment[] {
  const frame = SAMPLE_RATE * FRAME_MS / 1000, count = Math.floor(pcm.length / 2 / frame)
  const db: number[] = []
  for (let f = 0; f < count; f++) {
    let sum = 0
    for (let i = 0; i < frame; i++) { const v = pcm.readInt16LE((f * frame + i) * 2) / 32768; sum += v * v }
    db.push(10 * Math.log10(sum / frame + 1e-10))
  }
  const voiced = db.filter((d) => d > -60).sort((a, b) => a - b)
  if (voiced.length < 5) return []
  const baseline = voiced[Math.floor(voiced.length / 2)]
  const threshold = Math.max(baseline + 6, -40)
  const events: LoudMoment[] = []
  let current: { start: number; end: number; peak: number } | null = null
  db.forEach((d, f) => {
    if (d >= threshold) {
      if (current && f - current.end <= 2) { current.end = f; current.peak = Math.max(current.peak, d) }
      else { if (current) events.push(toMoment(current)); current = { start: f, end: f, peak: d } }
    }
  })
  if (current) events.push(toMoment(current))
  function toMoment(e: { start: number; end: number; peak: number }): LoudMoment {
    return { start_ms: offsetMs + e.start * FRAME_MS, end_ms: offsetMs + (e.end + 1) * FRAME_MS, db_above: Math.round(e.peak - baseline) }
  }
  return events.sort((a, b) => b.db_above - a.db_above).slice(0, limit).sort((a, b) => a.start_ms - b.start_ms)
}

/** Loud moments of `media` in [from, to]: one cheap FFmpeg decode to 8 kHz mono, cached per file and window. */
export async function loudMoments(media: string, ffmpeg: string, from: number, to: number): Promise<LoudMoment[] | null> {
  let key: string
  try { const s = statSync(media); key = `${media}:${s.size}:${s.mtimeMs}:${Math.floor(from / 1000)}:${Math.ceil(to / 1000)}` } catch { return null }
  const hit = loudCache.get(key)
  if (hit) return hit
  const seconds = Math.max(0.1, (to - from) / 1000)
  const pcm = await new Promise<Buffer | null>((resolve) => {
    const child = spawn(ffmpeg, ['-v', 'error', '-nostdin', '-ss', (from / 1000).toFixed(3), '-t', seconds.toFixed(3), '-i', media, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', '-'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    const chunks: Buffer[] = []
    let size = 0
    const limit = Math.ceil(seconds + 2) * SAMPLE_RATE * 2
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000)
    child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size <= limit) chunks.push(chunk); else child.kill('SIGKILL') })
    child.on('error', () => { clearTimeout(timer); resolve(null) })
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0 && size <= limit ? Buffer.concat(chunks) : null) })
  })
  if (!pcm) return null
  const moments = findLoudMoments(pcm.subarray(0, pcm.length - (pcm.length % 2)), Math.round(from))
  loudCache.set(key, moments)
  if (loudCache.size > 40) loudCache.delete(loudCache.keys().next().value!)
  return moments
}

// ── Context ───────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You edit ONE short-form clip inside CreatorClips' clip editor, for a creator who posts to TikTok, Instagram and YouTube.
The member asks for a change in plain words; you make it with the tools, then answer in one to three short sentences (plain words, US spelling).

Rules:
- Every time is SOURCE milliseconds (the original video's clock), like the clip's sections. Tools take milliseconds.
- A tool's "done" sentence is what the member sees: its times are clip time (m:ss.s into the finished clip, the clock the editor's playhead shows), not source ms. In your answer, name a moment by its words, or by the clip time from a "done" sentence; never give source ms to the member.
- A graphic always plays inside the clip: one near the end starts earlier (or is shortened) to fit, and a new graphic moves to a free band when another one is in its band then. The "done" sentence says so.
- Use word times from the transcript so cuts land between words, never inside one. Leave about 100-200 ms before the first word and after the last.
- Only change what the member asked for. Don't invent words, numbers or quotes: graphics and hooks use what is said in the clip or what the member gives you.
- Non-word moments (a laugh, a "wowww", applause, a gasp) may only show as a sound tag, a loud moment or a short word like "Wow". When you are not sure which moment the member means, don't edit: say which moment you think it is (its time and what you based it on) and call play on it so they can hear it, then ask them to confirm.
- If a tool returns an error, fix the call and try again, or tell the member why it can't be done.
- Don't say you made a change unless its tool call succeeded.
- The member may point at the video (pins). "Put an arrow here" or "circle this": add_graphic with template highlight and the pin. "Move the graphic here": update_graphic with the pin. "Zoom in on this": set_layout_at with the pin. "Put the hook/caption here" can't move to a point: say where it can go.
- Blurring or hiding part of the video isn't supported here: say so plainly and don't call a tool for it.
- Camera + screen clips: "show only my screen here" is set_screen_layout screen over that part; "just me" is face; "back to the split" is screen_top.
- Scenes (vertical clips): "put me in a card", "give the graphic room" or "show it big" is set_scene (stage or visual) over the graphic's time; "back to my face" is set_scene face.
- The member's message may end with an [Editor: …] note: where the playhead is (source ms) and which graphic is selected. Without a pin, "here" or "now" means the playhead and "this" or "it" means the selected graphic.
- "Add a graphic here": add_graphic at the playhead, with the template that fits what is said there (a number: stat; steps or a list: list, staircase or another diagram; a key phrase: title or big_words), and only words said there.
- "Make this a staircase" (or another template): update_graphic on the selected graphic with template; give items from what is said while it shows when its words don't fit the new template.
- "Put the words behind me": update_graphic with depth behind on the selected graphic (or the text graphic at the playhead); if its template can't go behind, switch it to big_words with up to 3 of its words.
- "Suggest graphics for this clip": add 3 to 5 graphics where they help most, each timed to its words, only words and numbers said in the clip, never covering each other.`

function rangeLabel(segment: { start_ms: number; end_ms: number }, c: CandidateEdit): string {
  const start = c.ranges[0][0], end = c.ranges[c.ranges.length - 1][1]
  const kept = c.ranges.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, segment.end_ms) - Math.max(a, segment.start_ms)), 0)
  if (segment.end_ms <= start) return 'before clip'
  if (segment.start_ms >= end) return 'after clip'
  if (kept <= 0) return 'cut out'
  return kept >= segment.end_ms - segment.start_ms - 1 ? 'in clip' : 'partly in clip'
}

export function buildChatContext(project: Pick<EditorProject, 'title' | 'duration_ms' | 'aspect_ratio' | 'transcript' | 'pair'>, c: CandidateEdit, segments: ChatSegment[] | null, loud: LoudMoment[] | null, windowMs = CHAT_CONTEXT_MS): string {
  const start = c.ranges[0][0], end = c.ranges[c.ranges.length - 1][1]
  const from = Math.max(0, start - windowMs), to = Math.min(project.duration_ms, end + windowMs)
  const lines: string[] = []
  lines.push(`Clip title: "${c.title}" (status ${c.status}). Source video: "${project.title}", ${project.duration_ms} ms long. Output ${project.aspect_ratio}.`)
  const sourceMs = c.ranges.reduce((n, [a, b]) => n + b - a, 0)
  lines.push(`Sections kept (source ms): ${c.ranges.map(([a, b]) => `[${a}, ${b}]`).join(', ')}. ${sourceMs} ms of source at ${c.video_speed}× speed → ${(editDuration(c) / 1000).toFixed(1)} s long.`)
  if (project.pair) {
    const pair = project.pair
    lines.push('This clip is a camera + screen reel: a camera recording and a screen recording, played together. Switch what shows with set_screen_layout.')
    lines.push(`Layouts (each runs until the next): ${c.scenes.map((s) => { const kind = screenKindOf(s, pair); return `${kind ? `${kind} (${SCREEN_KIND_LABELS[kind]})` : `${s.layout} (custom crop)`} from ${s.at_ms} ms${kind === 'screen_top' || kind === 'face_top' ? `, screen ${Math.round(screenShareOf(s, pair) * 100)}% of the height` : ''}` }).join('; ')}.`)
  } else lines.push(`Layouts (each runs until the next): ${c.scenes.map((s) => `${s.layout} from ${s.at_ms} ms${s.layout === 'split' && s.split ? ` (top ${Math.round(s.split * 100)}%)` : ''}`).join('; ')}.`)
  lines.push(c.hook === undefined ? 'Hook text: the run\'s original (not editable here until set).' : c.hook === null ? 'Hook text: none.' : `Hook text: "${c.hook.text}" (look ${c.hook.look.look}, font ${c.hook.look.font}${c.hook.look.look === 'brand' ? `, color ${c.hook.look.color}` : ''}).`)
  lines.push(`Captions: ${c.captions ? `on, style ${c.caption_preset}` : 'off'}. Call to action at the end: ${c.cta_id === undefined ? 'same as the run' : c.cta_id === null ? 'none' : 'one the member chose'}.`)
  const graphics = c.graphics ?? []
  lines.push(graphics.length ? `Graphics: ${graphics.map((g) => `${g.id} ${g.template} at ${g.at_ms} ms for ${g.duration_ms} ms (${g.placement}${g.size && g.size !== 'card' ? `, ${g.size} size` : ''}${g.depth === 'behind' ? ', behind the speaker' : ''}): ${Object.entries(g.fields).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}`).join('; ')}.` : 'Graphics: none.')
  if (project.aspect_ratio === '9:16') {
    const scenes = (c.stage_scenes ?? []).filter((s) => s.scene !== 'face')
    lines.push(scenes.length ? `Scenes (face everywhere else): ${scenes.map((s) => `${s.scene} ${s.start_ms}–${s.end_ms} ms (${s.backdrop ?? 'light'} backdrop${s.scene === 'stage' ? `, ${s.card ?? 'rounded'} card` : ''})`).join('; ')}.` : 'Scenes: face throughout.')
  }
  lines.push('')
  const tags: string[] = []
  if (segments) {
    lines.push(`Transcript from ${from} to ${to} ms. Each line: [where] start–end ms, speaker: word@start_ms …`)
    for (const s of segments) {
      if (s.end_ms < from || s.start_ms > to) continue
      const words = s.words.length ? s.words.map((w) => `${w.word}@${w.start_ms}`).join(' ') : `${s.text} (no word times)`
      lines.push(`[${rangeLabel(s, c)}] ${s.start_ms}–${s.end_ms}${s.speaker ? `, ${s.speaker}` : ''}: ${words}`)
      for (const e of s.events) tags.push(`${e} in the line at ${s.start_ms}–${s.end_ms} ms`)
      for (const w of s.words) if (/^[([].*[)\]]$/.test(w.word)) tags.push(`${w.word} at ${w.start_ms}–${w.end_ms} ms`)
    }
  } else {
    lines.push(`Transcript lines from ${from} to ${to} ms (no word times saved for this run). Each line: [where] start–end ms: text`)
    for (const r of project.transcript) if (r.end_ms >= from && r.start_ms <= to) lines.push(`[${rangeLabel(r, c)}] ${r.start_ms}–${r.end_ms}: ${plain(r.text, 4000)}`)
  }
  lines.push('')
  lines.push(tags.length ? `Sound tags from the transcript: ${tags.slice(0, 60).join('; ')}.` : 'Sound tags from the transcript: none.')
  lines.push(loud === null ? 'Loud moments: not available for this video.'
    : loud.length ? `Loud moments (short bursts louder than the talking around them: maybe a reaction, a laugh, applause or a stressed word): ${loud.map((m) => `${m.start_ms}–${m.end_ms} ms (+${m.db_above} dB, ${chatClock(m.start_ms)})`).join('; ')}.`
      : 'Loud moments: none stand out.')
  return lines.join('\n')
}

// ── One turn ──────────────────────────────────────────────────────────────
export interface ChatTurnInput {
  apiKey: string
  model: string
  project: ChatProject & Pick<EditorProject, 'title' | 'transcript'>
  candidate: CandidateEdit
  message: string
  history: OpenRouterMessage[]
  segments: ChatSegment[] | null
  loud: LoudMoment[] | null
  signal: AbortSignal
  url?: string
  fetch?: typeof fetch
  onCost?: (usd: number) => void
  newId?: () => string
  /** Pins the member put on the Output preview with this message (checked). */
  points?: ChatPoint[]
}

/** One member message: the model's answer and the checked edits. History is not changed here. */
export async function runClipChat(input: ChatTurnInput): Promise<ChatReply> {
  let context = buildChatContext(input.project, input.candidate, input.segments, input.loud)
  if (context.length > MAX_CONTEXT_CHARS) context = buildChatContext(input.project, input.candidate, input.segments, input.loud, CHAT_CONTEXT_MS / 2)
  if (context.length > MAX_CONTEXT_CHARS) context = `${context.slice(0, MAX_CONTEXT_CHARS)}\n(trimmed)`
  let working = input.candidate
  const newId = input.newId ?? (() => `chat-${randomBytes(4).toString('hex')}`)
  const points = input.points ?? []
  return runToolChat<ChatStep>({
    apiKey: input.apiKey, model: input.model, signal: input.signal, url: input.url, fetch: input.fetch, onCost: input.onCost,
    systemPrompt: `${SYSTEM_PROMPT}\n\nThe clip right now:\n${context}`,
    history: input.history, message: chatTurnMessage(input.message, input.candidate, points), tools: chatToolsFor(input.project),
    apply: (name, args) => {
      const { step, candidate } = applyChatTool(working, name, args, input.project, newId, points)
      working = candidate
      return { step, result: { sections: working.ranges, clip: clipLengthNote(working) } }
    }
  })
}

/** The member's words with their pins (the source time each pin's output time falls on, through the clip's cuts and speed). */
export function chatTurnMessage(message: string, c: CandidateEdit, points: readonly ChatPoint[]): string {
  return messageWithPoints(message, points, (p) => pinSourceMs(c, p))
}

// ── Per-clip conversations (this app session only) ───────────────────────
const memory = new ChatMemory()

export function rememberTurn(key: string, message: string, result: ChatReply): void {
  memory.remember(key, message, result, (s) => s.tool !== 'play')
}
export const chatHistory = (key: string): OpenRouterMessage[] => memory.history(key)
export function resetChat(run: string, candidateId: unknown): void {
  if (typeof candidateId !== 'string' || candidateId.length > 64) throw new Error('Invalid clip')
  memory.reset(`${run}\n${candidateId}`)
}

export interface EditorChatDeps {
  /** The run folder and its open editor session (validated by the editor). */
  session: { run: string; project: EditorProject; sourcePath: string; previewPath: string }
  apiKey: string
  model: string
  ffmpeg: string
  url?: string
  onCost?: (usd: number) => void
}

/** The `editor:chat` request: checks the clip the renderer sent, runs the turn, remembers it. */
export async function editorChat(candidate: unknown, message: unknown, deps: EditorChatDeps, pins?: unknown): Promise<ChatReply> {
  const { run, project } = deps.session
  if (project.media_freed) throw new Error('Editor media was freed. This project is read-only.')
  if (!deps.apiKey) throw new Error('Add your OpenRouter key in Settings → API keys to chat about this clip.')
  const text = chatMessage(message)
  const points = parseChatPoints(pins)
  let clip: CandidateEdit
  try {
    clip = parseCandidateEdit(candidate, project.duration_ms, project.transcript.length)
    const graphics = parseGraphics((candidate as { graphics?: unknown }).graphics)
    clip = { ...clip, ...(graphics.length || (candidate as { graphics?: unknown }).graphics !== undefined ? { graphics } : {}) }
  } catch { throw new Error('This clip has an edit the chat can’t read. Undo the last change and try again.') }
  if (!project.candidates.some((c) => c.id === clip.id)) throw new Error('This clip is no longer in the project. Reopen the editor.')
  if (clip.status === 'discarded') throw new Error('Restore this clip to edit it.')
  const key = `${run}\n${clip.id}`
  return memory.exclusive(key, async () => {
    const start = clip.ranges[0][0], end = clip.ranges[clip.ranges.length - 1][1]
    const from = Math.max(0, start - CHAT_CONTEXT_MS), to = Math.min(project.duration_ms, end + CHAT_CONTEXT_MS)
    const [segments, loud] = await Promise.all([
      readChatTranscript(run, from, to),
      deps.session.sourcePath ? loudMoments(deps.session.sourcePath, deps.ffmpeg, from, to).catch(() => null) : Promise.resolve(null)
    ])
    const result = await runClipChat({
      apiKey: deps.apiKey, model: deps.model, url: deps.url, onCost: deps.onCost,
      project: { duration_ms: project.duration_ms, width: project.width, height: project.height, aspect_ratio: project.aspect_ratio, transcriptCount: project.transcript.length, title: project.title, transcript: project.transcript,
        ...(project.pair ? { pair: project.pair } : {}),
        words: (segments ?? []).flatMap((s) => s.words.map((w) => ({ word: w.word, start_ms: w.start_ms, end_ms: w.end_ms }))) },
      candidate: clip, message: text, history: chatHistory(key), segments, loud, signal: AbortSignal.timeout(CHAT_TIMEOUT_MS), points
    })
    // Remembered with its pins, so "the same spot" makes sense in the next message.
    rememberTurn(key, chatTurnMessage(text, clip, points), result)
    return result
  })
}
