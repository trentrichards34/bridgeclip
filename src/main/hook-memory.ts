import { app } from 'electron'
import { createHash, randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { open } from 'fs/promises'
import { join } from 'path'
import { MAX_HOOK_TEXT_CHARS } from '../shared/edit-recording'

/**
 * The headline each recording got last time (userData/hook-headlines.json), so making the same video again
 * (Edit my recording, Combine clips) keeps its headline instead of a new one from the AI every run. Keyed by
 * a fingerprint of the source files (size, length, first and last MB), never their paths or names. The member's
 * own changes (review, clip editor, Library) become the saved headline. Capped at the last 500 recordings.
 */

const FILE = 'hook-headlines.json'
const VERSION = 1
export const MAX_HOOK_MEMORY = 500
/** Runs remembered per recording (to find it again from the clip editor or the Library). */
const MAX_RUNS = 8
const SAMPLE_BYTES = 1024 * 1024
const KEY = /^(takes|combine):[0-9a-f]{64}$/
const RUN = /^edit-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export interface HookMemoryEntry { key: string; headline: string; runs: string[]; updatedAt: string }
export interface HookMemory { entries: HookMemoryEntry[] }

/** A headline as saved: one line of plain text, up to the hook text limit; '' when it isn't one. */
export function cleanHeadline(value: unknown): string {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\s+/g, ' ').trim()
  // eslint-disable-next-line no-control-regex
  if (!text || text.length > MAX_HOOK_TEXT_CHARS || /[\u0000-\u001f\u007f<>{}\\]/.test(text)) return ''
  return text
}

/** The saved file, checked: anything malformed is dropped (an unreadable file is an empty memory). */
export function parseHookMemory(raw: unknown): HookMemory {
  const list = raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as { version?: unknown }).version === VERSION ? (raw as { entries?: unknown }).entries : null
  const entries: HookMemoryEntry[] = []
  for (const item of Array.isArray(list) ? list.slice(-MAX_HOOK_MEMORY * 2) : []) {
    if (!item || typeof item !== 'object') continue
    const { key, headline, runs, updatedAt } = item as Record<string, unknown>
    const text = cleanHeadline(headline)
    if (typeof key !== 'string' || !KEY.test(key) || !text || entries.some((entry) => entry.key === key)) continue
    entries.push({ key, headline: text, runs: Array.isArray(runs) ? runs.filter((run): run is string => typeof run === 'string' && RUN.test(run)).slice(-MAX_RUNS) : [],
      updatedAt: typeof updatedAt === 'string' && updatedAt.length <= 40 && Number.isFinite(Date.parse(updatedAt)) ? updatedAt : new Date(0).toISOString() })
  }
  return { entries: entries.slice(-MAX_HOOK_MEMORY) }
}

/** The memory with `headline` saved for `key` (most recent last; the oldest go past the cap). */
export function withHeadline(memory: HookMemory, key: string, headline: string, run: string | null, now = new Date()): HookMemory {
  const text = cleanHeadline(headline)
  if (!KEY.test(key) || !text) return memory
  const old = memory.entries.find((entry) => entry.key === key)
  const runs = [...(old?.runs ?? []).filter((item) => item !== run), ...(run && RUN.test(run) ? [run] : [])].slice(-MAX_RUNS)
  const entries = [...memory.entries.filter((entry) => entry.key !== key), { key, headline: text, runs, updatedAt: now.toISOString() }]
  return { entries: entries.slice(-MAX_HOOK_MEMORY) }
}

function memoryPath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  return join(dir, FILE)
}

function read(): HookMemory {
  try { return parseHookMemory(JSON.parse(readFileSync(memoryPath(), 'utf8'))) } catch { return { entries: [] } }
}

function write(memory: HookMemory): void {
  const path = memoryPath()
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(temp, JSON.stringify({ version: VERSION, entries: memory.entries }), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    renameSync(temp, path)
  } finally {
    if (existsSync(temp)) rmSync(temp, { force: true })
  }
}

/** One file's fingerprint: its size, its length (seconds, to the millisecond) and its first and last MB. */
async function fileFingerprint(path: string, seconds: number): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const hash = createHash('sha256').update(`${size}\n${Math.round(seconds * 1000)}\n`)
    const head = Buffer.alloc(Math.min(SAMPLE_BYTES, size))
    await handle.read(head, 0, head.length, 0)
    hash.update(head)
    if (size > SAMPLE_BYTES) {
      const tail = Buffer.alloc(Math.min(SAMPLE_BYTES, size - SAMPLE_BYTES))
      await handle.read(tail, 0, tail.length, size - tail.length)
      hash.update(tail)
    }
    return hash.digest('hex')
  } finally { await handle.close() }
}

/**
 * The key for a set of recordings made into one video: the same files (in any order, wherever they are, whatever
 * they're called) give the same key. Retakes and combined clips are kept apart. Null when a file can't be read.
 */
export async function sourcesKey(mode: 'takes' | 'combine', sources: { path: string; seconds: number }[]): Promise<string | null> {
  if (!sources.length) return null
  try {
    const prints = await Promise.all(sources.map((source) => fileFingerprint(source.path, source.seconds)))
    return `${mode}:${createHash('sha256').update(prints.sort().join('\n')).digest('hex')}`
  } catch { return null }
}

/** The headline saved for these recordings, or null. */
export function savedHeadline(key: string | null): string | null {
  if (!key) return null
  return read().entries.find((entry) => entry.key === key)?.headline ?? null
}

/** Save the headline a video was made with (an empty one leaves the saved one as it is). Never throws. */
export function rememberHeadline(key: string | null, headline: unknown, run: string | null = null): void {
  if (!key || !cleanHeadline(headline)) return
  try { write(withHeadline(read(), key, headline as string, run)) } catch { /* a headline that can't be saved is only not kept */ }
}

/** The member changed a made video's headline (clip editor, Library): it becomes the saved one for its recordings. */
export function rememberRunHeadline(run: string, headline: unknown): boolean {
  if (!RUN.test(run) || !cleanHeadline(headline)) return false
  try {
    const memory = read()
    const entry = memory.entries.find((item) => item.runs.includes(run))
    if (!entry) return false
    write(withHeadline(memory, entry.key, headline as string, run))
    return true
  } catch { return false }
}
