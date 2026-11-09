import { app } from 'electron'
import { randomUUID } from 'crypto'
import { readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { isAbsolute, join, resolve, sep } from 'path'

/**
 * Earlier output folders whose runs stay in the Library after the member picks
 * a new output folder, and where moved runs went (so posting history that names
 * a clip's old path still finds it). Kept apart from settings so a damaged file
 * here never blocks loading settings.
 */
interface FoldersState {
  version: 1
  previous: string[]
  /** [old run path, new run path], newest last. */
  moved: [string, string][]
}

const MAX_PREVIOUS = 20
const MAX_MOVED = 5000
let cached: FoldersState | null = null

function statePath(): string {
  return join(app.getPath('userData'), 'library-folders.json')
}

const validPath = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\0') && isAbsolute(value)

function read(): FoldersState {
  if (cached) return cached
  let state: FoldersState = { version: 1, previous: [], moved: [] }
  try {
    const raw = JSON.parse(readFileSync(statePath(), 'utf8')) as Partial<FoldersState>
    state = {
      version: 1,
      previous: Array.isArray(raw.previous) ? [...new Set(raw.previous.filter(validPath).map((dir) => resolve(dir)))].slice(0, MAX_PREVIOUS) : [],
      moved: Array.isArray(raw.moved) ? raw.moved.filter((pair): pair is [string, string] => Array.isArray(pair) && pair.length === 2 && validPath(pair[0]) && validPath(pair[1])).slice(-MAX_MOVED) : []
    }
  } catch { /* Missing or damaged: no earlier folders. */ }
  cached = state
  return state
}

function write(state: FoldersState): void {
  const path = statePath()
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, JSON.stringify(state), { mode: 0o600, flag: 'wx' })
    renameSync(temp, path)
  } finally { try { unlinkSync(temp) } catch { /* Already renamed. */ } }
  cached = state
}

function same(a: string, b: string): boolean {
  if (resolve(a) === resolve(b)) return true
  try { return realpathSync(a) === realpathSync(b) } catch { return false }
}

/** Earlier output folders still shown in the Library, newest first. */
export function previousOutputFolders(): string[] {
  return [...read().previous]
}

export function isPreviousOutputFolder(dir: string): boolean {
  return read().previous.includes(resolve(dir))
}

export function rememberPreviousFolder(dir: string): void {
  if (!validPath(dir)) return
  const state = read()
  const folder = resolve(dir)
  write({ ...state, previous: [folder, ...state.previous.filter((item) => !same(item, folder))].slice(0, MAX_PREVIOUS) })
}

export function forgetPreviousFolder(dir: string): void {
  const state = read()
  const previous = state.previous.filter((item) => !same(item, dir))
  if (previous.length !== state.previous.length) write({ ...state, previous })
}

/** A run moved from `from` to `to` (both run folders). */
export function recordMovedRun(from: string, to: string): void {
  const state = read()
  write({ ...state, moved: [...state.moved.filter(([old]) => old !== from), [from, to] as [string, string]].slice(-MAX_MOVED) })
}

/** Where a path inside a moved run is now (the path itself when its run never moved). */
export function currentRunPath(path: string): string {
  const moved = read().moved
  if (!moved.length || typeof path !== 'string') return path
  const prefix = path.startsWith('file://') ? 'file://' : ''
  let current = prefix ? path.slice(prefix.length) : path
  // A run can move more than once: follow the chain (bounded).
  for (let hop = 0; hop < 8; hop++) {
    const match = [...moved].reverse().find(([from]) => current === from || current.startsWith(`${from}${sep}`))
    if (!match) break
    current = match[1] + current.slice(match[0].length)
  }
  return prefix + current
}

/** Tests reload state from disk. */
export function resetLibraryFoldersCache(): void { cached = null }
