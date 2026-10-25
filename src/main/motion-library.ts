/**
 * My motion library on disk: the member's app data motion-library/<id>/ (item.json, template.html, still-<i>.png).
 * Written when a custom graphic passes its check (or is retired), read by the producer to reuse one, and listed for
 * the gallery. Every template is checked again (the static contract) before it is filled and run.
 */
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import { MAX_COMPOSITION_CHARS, STILL_COUNT, customStillNames, type CustomMeta, type HeroKind, type CustomFrameKind } from '../shared/custom-graphics'
import { LIBRARY_ID, MAX_LIBRARY_ITEMS, libraryCandidates, libraryTags, parameterize, parseLibraryItem, type LibraryItem, type LibraryStatus, type LibraryView } from '../shared/motion-library'
import { authorizeMedia } from './security'
import { logger } from './logger'

let rootOverride: string | null = null
/** Tests point the library at a folder of their own. */
export function setLibraryRoot(path: string | null): void { rootOverride = path }
function libraryRoot(create = false): string {
  const root = rootOverride ?? join(app.getPath('userData'), 'motion-library')
  if (create) mkdirSync(root, { recursive: true, mode: 0o700 })
  return root
}
function regular(path: string): boolean { try { const s = lstatSync(path); return s.isFile() && !s.isSymbolicLink() } catch { return false } }
function folder(path: string): boolean { try { const s = lstatSync(path); return s.isDirectory() && !s.isSymbolicLink() } catch { return false } }
function writeAtomic(path: string, data: string | Buffer): void {
  const temporary = `${path}.tmp-${randomUUID()}`
  try { writeFileSync(temporary, data, { mode: 0o600, flag: 'wx' }); renameSync(temporary, path) } finally { try { unlinkSync(temporary) } catch { /* moved */ } }
}

export function readLibraryItems(): LibraryItem[] {
  let names: string[]
  try { names = readdirSync(libraryRoot()) } catch { return [] }
  const out: LibraryItem[] = []
  for (const name of names.filter((n) => LIBRARY_ID.test(n)).slice(0, MAX_LIBRARY_ITEMS * 2)) {
    const dir = join(libraryRoot(), name)
    if (!folder(dir) || !regular(join(dir, 'item.json'))) continue
    try { const item = parseLibraryItem(JSON.parse(readFileSync(join(dir, 'item.json'), 'utf8'))); if (item && item.id === name) out.push(item) } catch { /* skipped */ }
  }
  return out
}

export function readLibraryTemplate(id: string): { item: LibraryItem; template: string } | null {
  if (!LIBRARY_ID.test(id)) return null
  const dir = join(libraryRoot(), id)
  if (!folder(dir) || !regular(join(dir, 'template.html')) || !regular(join(dir, 'item.json'))) return null
  try {
    const item = parseLibraryItem(JSON.parse(readFileSync(join(dir, 'item.json'), 'utf8')))
    const template = readFileSync(join(dir, 'template.html'), 'utf8')
    if (!item || item.id !== id || template.length > MAX_COMPOSITION_CHARS) return null
    return { item, template }
  } catch { return null }
}

function writeItem(item: LibraryItem): void { writeAtomic(join(libraryRoot(true), item.id, 'item.json'), JSON.stringify(item, null, 1)) }

/**
 * Keep a custom graphic in the library: passed ones are active (offered again), failed ones retired with the reason.
 * `stills`: its transparent stills (paths in the run) to show in the gallery. Never throws (the video doesn't depend on it).
 */
export function keepInLibrary(input: { id: string; html: string; kind: HeroKind; frame: CustomFrameKind; width: number; height: number; durationMs: number; idea: string; runId: string; stills: string[]; stillData?: Buffer[]; status: LibraryStatus; reason?: string }): void {
  try {
    if (!LIBRARY_ID.test(input.id)) return
    if (readLibraryItems().length >= MAX_LIBRARY_ITEMS && input.status === 'retired') return
    const { template, slots } = parameterize(input.html)
    const dir = join(libraryRoot(true), input.id)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    if (!folder(dir)) return
    const existing = readLibraryTemplate(input.id)?.item
    const item: LibraryItem = existing ? { ...existing, usedIn: [...new Set([...existing.usedIn, input.runId])] } : {
      id: input.id, kind: input.kind, frame: input.frame, width: input.width, height: input.height, durationMs: input.durationMs, slots, tags: libraryTags(input.kind, input.frame, slots),
      idea: input.idea, status: input.status, ...(input.reason ? { reason: input.reason.slice(0, 400) } : {}), usedIn: input.status === 'active' ? [input.runId] : [], createdAt: new Date().toISOString()
    }
    writeAtomic(join(dir, 'template.html'), template)
    input.stills.slice(0, STILL_COUNT).forEach((path, i) => { if (regular(path)) copyFileSync(path, join(dir, `still-${i}.png`)) })
    ;(input.stillData ?? []).slice(0, STILL_COUNT).forEach((bytes, i) => { if (bytes?.length) writeAtomic(join(dir, `still-${i}.png`), bytes) })
    writeItem(item)
  } catch (error) { logger.warn('library.keep.failed', { message: String((error as Error)?.message ?? error).slice(0, 200) }) }
}

/** A library graphic was used in a run (counted once per run). */
export function noteLibraryUse(id: string, runId: string): void {
  const found = readLibraryTemplate(id)
  if (!found) return
  try { writeItem({ ...found.item, usedIn: [...new Set([...found.item.usedIn, runId])] }) } catch { /* the count is a nicety */ }
}

export function setLibraryStatus(id: unknown, status: unknown): LibraryView[] {
  if (typeof id !== 'string' || (status !== 'active' && status !== 'retired')) throw new Error('Choose a graphic in your library.')
  const found = readLibraryTemplate(id)
  if (!found) throw new Error('That graphic is no longer in your library.')
  const { reason: _reason, ...rest } = found.item
  void _reason
  writeItem(status === 'retired' ? { ...found.item, status, reason: found.item.reason ?? 'Retired by you.' } : { ...rest, status })
  return libraryView()
}

/** The gallery's view: newest first, with stills the page may show. */
export function libraryView(): LibraryView[] {
  return readLibraryItems().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((item) => {
    const dir = join(libraryRoot(), item.id)
    const stills: string[] = []
    for (let i = 0; i < STILL_COUNT; i++) { const p = join(dir, `still-${i}.png`); if (regular(p)) { try { stills.push(authorizeMedia(p)) } catch { /* skipped */ } } }
    return { id: item.id, kind: item.kind, frame: item.frame, idea: item.idea, tags: item.tags, status: item.status, reason: item.reason ?? null, uses: item.usedIn.length, stills, slots: item.slots.length, durationMs: item.durationMs, createdAt: item.createdAt }
  })
}

/** The best library graphic to try for a moment (null: none fits its kind, frame and length). */
export function libraryMatch(kind: HeroKind, frame: CustomFrameKind, durationMs: number): { item: LibraryItem; template: string } | null {
  for (const item of libraryCandidates(readLibraryItems(), kind, frame, durationMs)) {
    const found = readLibraryTemplate(item.id)
    if (found) return found
  }
  return null
}

/** The run's stills of a kept composition, to copy into the library. */
export function runStills(customDir: string, meta: Pick<CustomMeta, 'comp'>): string[] {
  return customStillNames(meta.comp).map((name) => join(customDir, name))
}
