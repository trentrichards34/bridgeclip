import { execFile, spawn, type ChildProcess } from 'child_process'
import { constants, closeSync, createWriteStream, fstatSync, lstatSync, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, type Dirent } from 'fs'
import { pipeline } from 'stream/promises'
import { delimiter, dirname, join } from 'path'
import { createHash, randomUUID } from 'crypto'
import { EDITOR_REVISION_CONFLICT, MAX_EDITOR_CANDIDATES, TRANSCRIPT_CLIP_MS, editorFailureMessage, editorProgress, isEditorErrorCode, parseCandidateEdit, parseEditorProject, parseHookIdeas, renderEditKey, type CandidateEdit, type EditorBatch, type EditorCandidate, type EditorErrorCode, type EditorProgressSummary, type EditorProject, type EditorSession, type HookIdea } from '../shared/clip-editor'
import { isCaptionLanguage } from '../shared/caption-language'
import { loadSettings, getSettingsForBridge } from './settings-store'
import { assertAbsolutePath, assertMediaPath, isWithinDirectory, openAuthorizedMedia } from './security'
import { getJobOutput } from './file-manager'
import { getBridgeRunnerPath, getEnginePath, resolvePythonPath, runtimeEnvironment } from './pipeline-runner'
import { resolveBinary } from './tools'
import { logger } from './logger'

type WorkerAction = 'review' | 'export' | 'export-all' | 'scan-cameras' | 'replace-source' | 'suggest-hooks' | 'prepare'
interface EditorOperation { progress?: EditorSession['progress']; action: NonNullable<EditorSession['operation']>; child?: ChildProcess; cancelled?: boolean; abort?: AbortController; batch?: EditorBatch }
const operations = new Map<string, EditorOperation>()

/** Adds a call to action to a newly exported clip (set by the IPC layer, which owns the CTA library). */
type EditorCtaApplier = (run: string, ctaId: string, clipIndex: number) => Promise<void>
let applyExportCta: EditorCtaApplier | null = null
export function onEditorExportCta(applier: EditorCtaApplier): void { applyExportCta = applier }
/** Records what an editor AI call cost in the spending ledger (set by the IPC layer, which owns it). */
type EditorSpendRecorder = (usd: number, label: string) => Promise<unknown>
let recordEditorSpend: EditorSpendRecorder | null = null
export function onEditorSpend(recorder: EditorSpendRecorder): void { recordEditorSpend = recorder }
/** Exports rewrite the run's clips and job_output.json: they wait for other changes to the run (CTA changes, re-makes). */
type RunLock = <T>(run: string, work: () => Promise<T>) => Promise<T>
let runExclusive: RunLock = (_run, work) => work()
export function onEditorRunLock(lock: RunLock): void { runExclusive = lock }

/** The run's own call to action: the one most of its made clips end with. */
async function runCtaId(run: string): Promise<string | null> {
  try {
    const counts = new Map<string, number>()
    for (const clip of (await getJobOutput(run))?.clips ?? []) if (clip.cta?.id) counts.set(clip.cta.id, (counts.get(clip.cta.id) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  } catch { return null }
}

/**
 * The call to action on the Library clip an Automatic clip's export replaces, read before the
 * render (which clears it). Undefined when the editor's choice applies: a clip that adds a new
 * Library clip, a replaced clip that is gone, or a call to action changed in the editor since.
 */
async function libraryClipCta(run: string, candidate: EditorCandidate): Promise<string | null | undefined> {
  if (candidate.library_clip === undefined || candidate.cta_edited) return undefined
  try {
    const clip = (await getJobOutput(run))?.clips?.find((x) => x.clip_index === candidate.library_clip)
    if (!clip) return undefined
    return typeof clip.cta?.id === 'string' ? clip.cta.id : null
  } catch { return undefined }
}

/**
 * After an export: end the new clip with a call to action. A re-baked Automatic clip keeps the
 * one its Library clip had (`libraryCta`, null when it was removed there) unless it was changed in the
 * editor; otherwise the candidate's (or the run's). A failure leaves the clip as rendered.
 */
async function addExportCta(run: string, candidateId: string, libraryCta?: string | null): Promise<void> {
  if (!applyExportCta) return
  try {
    const candidate = readProject(run).candidates.find((c) => c.id === candidateId)
    const index = candidate?.exports.at(-1)
    const ctaId = libraryCta !== undefined && index === candidate?.library_clip ? libraryCta
      : candidate?.cta_id === undefined ? await runCtaId(run) : candidate.cta_id
    if (!candidate || index === undefined || !ctaId) return
    await applyExportCta(run, ctaId, index)
  } catch (error) {
    // The clip stays as rendered; the Library can add the call to action later.
    logger.warn('editor.cta.failed', { message: String((error as Error)?.message ?? error).slice(0, 200) })
  }
}
export function editorBusy(path: string): boolean { return operations.has(realpathSync(path)) }
function runPath(path: unknown): string {
  assertAbsolutePath(path)
  const run = realpathSync(path as string), library = realpathSync(loadSettings().outputDirectory)
  if (dirname(run) !== library || lstatSync(path as string).isSymbolicLink()) throw new Error('Editor project is outside the library')
  return run
}
function readProject(run: string): ReturnType<typeof parseEditorProject> {
  const path = join(run, 'editor-project.json')
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024 || !isWithinDirectory(path, run)) throw new Error('Invalid editor file')
    const data = Buffer.alloc(stat.size + 1)
    let used = 0, count = 0
    do { count = readSync(fd, data, used, data.length - used, null); used += count } while (count && used < data.length)
    if (used !== stat.size) throw new Error('Editor project changed while reading')
    return parseEditorProject(JSON.parse(data.subarray(0, used).toString('utf8')))
  } finally { closeSync(fd) }
}
function writeProject(run: string, project: EditorProject): void {
  const data = JSON.stringify(project)
  if (Buffer.byteLength(data) > 32 * 1024 * 1024) throw new Error('This editor project has too many caption edits to save')
  if (runPath(run) !== run) throw new Error('Editor folder changed')
  const temporary = join(run, `.editor-${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, data, { mode: 0o600, flag: 'wx' })
    renameSync(temporary, join(run, 'editor-project.json'))
  } finally { try { unlinkSync(temporary) } catch { /* Already committed. */ } }
}
function mediaNames(project: EditorProject): { source: string; preview: string } {
  const suffix = project.source_id ? `-${project.source_id}` : ''
  return { source: `editor-source${suffix}.mp4`, preview: `editor-preview${project.preview_id ? `-${project.preview_id}` : suffix}.mp4` }
}

const EDITOR_MEDIA = /^editor-(?:source|preview)(?:-[a-f0-9]{32})?\.mp4(?:\.partial\.mp4)?$/
/**
 * Remove leftovers of killed or cancelled operations: `.editor-*` temp files and
 * folders, and editor media the project does not reference. Runs only while no
 * editor operation owns the run, so nothing here can be in use by a worker.
 */
function sweepEditorFiles(run: string, project?: EditorProject): void {
  if (operations.has(run)) return
  let keep: Set<string> | null = null
  try {
    project ??= readProject(run)
    keep = new Set(project.media_freed ? [] : Object.values(mediaNames(project)))
  } catch { /* Unreadable state: keep all media, still remove temporary entries. */ }
  let entries: Dirent[]
  try { entries = readdirSync(run, { withFileTypes: true }) } catch { return }
  let removed = 0
  for (const entry of entries) {
    const temporary = entry.name.startsWith('.editor-')
    if (!temporary && !(keep && EDITOR_MEDIA.test(entry.name) && !keep.has(entry.name) && (entry.isFile() || entry.isSymbolicLink()))) continue
    try { rmSync(join(run, entry.name), { recursive: temporary && entry.isDirectory(), force: true }); removed++ } catch { /* A playing preview can stay open on Windows; retry next time. */ }
  }
  if (removed) logger.info('editor.sweep', { removed })
}

function mediaSize(paths: string[]): number {
  return paths.reduce((total, file) => { try { return total + statSync(file).size } catch { return total } }, 0)
}
/** A regular file (not a link) directly inside the run. */
function runFile(file: string, run: string): boolean {
  try { const stat = lstatSync(file); return stat.isFile() && !stat.isSymbolicLink() && isWithinDirectory(file, run) } catch { return false }
}
export async function openEditor(path: unknown): Promise<EditorSession> {
  const run = runPath(path)
  if (!(await getJobOutput(run, loadSettings().outputDirectory))?.editor_project) throw new Error('This run has no editor project')
  const project = readProject(run), names = mediaNames(project)
  sweepEditorFiles(run, project)
  const operation = operations.get(run)
  const state = { progress: operation?.progress ? { ...operation.progress } : undefined, operation: operation?.action ?? null, batch: operation?.batch ? { ...operation.batch } : undefined }
  if (project.media_freed) return { project, sourcePath: '', previewPath: '', mediaBytes: 0, ...state, ...(project.automatic ? { mediaMissing: true } : {}) }
  const sourcePath = join(run, names.source), previewPath = join(run, names.preview)
  // A project made from an Automatic run gets its video again (download or the original file) instead of failing.
  if (project.automatic && (!runFile(sourcePath, run) || !runFile(previewPath, run))) return { project, sourcePath: '', previewPath: '', mediaBytes: 0, ...state, mediaMissing: true }
  for (const file of [sourcePath, previewPath]) {
    if (lstatSync(file).isSymbolicLink() || !isWithinDirectory(file, run)) throw new Error('Editor source is missing')
    assertMediaPath(file, loadSettings().outputDirectory)
  }
  return { project, sourcePath, previewPath, mediaBytes: mediaSize([sourcePath, previewPath]), ...state }
}

type ProgressCounts = Omit<EditorProgressSummary, 'operation' | 'batch' | 'progress'>
const progressCache = new Map<string, { mtimeMs: number; size: number; ino: number; summary: ProgressCounts }>()
/**
 * Status counts for Library cards, Jobs rows and editor polling. Unlike
 * openEditor, it sends no project to the renderer and re-reads the project
 * only when its file changes.
 */
export async function readEditorProgress(path: unknown): Promise<EditorProgressSummary> {
  const run = runPath(path)
  const stat = lstatSync(join(run, 'editor-project.json'))
  if (!stat.isFile()) throw new Error('This run has no editor project')
  let summary = progressCache.get(run)
  if (!summary || summary.mtimeMs !== stat.mtimeMs || summary.size !== stat.size || summary.ino !== stat.ino) {
    const project = readProject(run)
    const { remaining, initialCandidate } = editorProgress(project.candidates)
    const counts = { refining: 0, ready: 0, baked: 0, discarded: 0 }
    for (const c of project.candidates) counts[c.status]++
    let previewPath: string | null = project.media_freed ? null : join(run, mediaNames(project).preview)
    try { if (previewPath && (lstatSync(previewPath).isSymbolicLink() || !isWithinDirectory(previewPath, run))) previewPath = null } catch { previewPath = null }
    summary = { mtimeMs: stat.mtimeMs, size: stat.size, ino: stat.ino, summary: {
      total: project.candidates.length, remaining, initialCandidate, counts, previewPath,
      thumbnailMs: project.candidates[initialCandidate].ranges[0][0], mediaFreed: project.media_freed === true } }
    progressCache.delete(run)
    progressCache.set(run, summary)
    if (progressCache.size > 1000) progressCache.delete(progressCache.keys().next().value!)
  }
  const operation = operations.get(run)
  return { ...summary.summary, counts: { ...summary.summary.counts }, operation: operation?.action ?? null,
    ...(operation?.batch ? { batch: { ...operation.batch } } : {}), ...(operation?.progress ? { progress: { ...operation.progress } } : {}) }
}

const ctaChoice = (id: string | null | undefined): string => id === undefined ? 'run' : id ?? 'none'
const bakedHash = (c: CandidateEdit): string => createHash('sha256').update(renderEditKey(c)).digest('hex')
export async function saveEditor(path: unknown, revision: unknown, edits: unknown): Promise<EditorSession> {
  const run = runPath(path)
  if (operations.has(run)) throw new Error('Wait for the current editor operation to finish')
  operations.set(run, { action: 'save' })
  try {
    const { project } = await openEditor(run)
    if (!Number.isSafeInteger(revision) || project.revision !== revision) throw new Error(EDITOR_REVISION_CONFLICT)
    if (project.media_freed) throw new Error('Editor media was freed. This project is read-only.')
    if (!Array.isArray(edits) || edits.length !== project.candidates.length) throw new Error('Invalid candidate edits')
    const clean = edits.map((c) => parseCandidateEdit(c, project.duration_ms, project.transcript.length))
    if (new Set(clean.map((c) => c.id)).size !== clean.length) throw new Error('Duplicate candidates')
    project.candidates = project.candidates.map((c) => {
      const edit = clean.find((e) => e.id === c.id)
      if (!edit) throw new Error('Candidate is missing')
      const next = { ...c, ...edit }
      // A changed call to action is the member's choice: a re-bake keeps it over the Library clip's.
      if (ctaChoice(edit.cta_id) !== ctaChoice(c.cta_id)) next.cta_edited = true
      if (edit.status === 'baked') {
        // Unchanged since its render, or restored to the exact render "Refine again" left.
        const unchanged = c.status === 'baked' ? renderEditKey(edit) === renderEditKey(c) : !!c.baked_hash && c.exports.length > 0 && bakedHash(edit) === c.baked_hash
        if (!unchanged) throw new Error('Only a completed render can mark a clip as baked')
        delete next.baked_hash
      } else if (c.status === 'baked') next.baked_hash = bakedHash(c)
      return next
    })
    project.revision++
    writeProject(run, project)
  } finally { operations.delete(run) }
  return openEditor(run)
}
/** Delete the source and preview once every clip is baked or discarded. The project becomes read-only. */
export async function freeEditorMedia(path: unknown, revision: unknown): Promise<EditorSession> {
  const run = runPath(path)
  if (operations.has(run)) throw new Error('Wait for the current editor operation to finish')
  operations.set(run, { action: 'save' })
  try {
    const { project } = await openEditor(run)
    if (!Number.isSafeInteger(revision) || project.revision !== revision) throw new Error(EDITOR_REVISION_CONFLICT)
    if (editorProgress(project.candidates).remaining) throw new Error('Bake or discard every clip before freeing editor media.')
    if (!project.media_freed) {
      project.media_freed = true
      project.revision++
      writeProject(run, project)
    }
  } finally { operations.delete(run) }
  sweepEditorFiles(run)
  logger.info('editor.mediaFreed')
  return openEditor(run)
}
function stop(child?: ChildProcess, force = false): void {
  if (!child?.pid) return
  try { if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { timeout: 5000, windowsHide: true }, () => {}); else process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM') } catch { /* Already exited. */ }
}
export function stopEditorsForQuit(): void { for (const op of operations.values()) { op.abort?.abort(); stop(op.child, true) } }
export function cancelEditor(path: unknown): void {
  const operation = operations.get(runPath(path))
  if (operation) operation.cancelled = true
  operation?.abort?.abort()
  const child = operation?.child
  stop(child)
  if (child) { const timer = setTimeout(() => stop(child, true), 3000); timer.unref(); child.once('close', () => clearTimeout(timer)) }
}
export async function replaceEditorSource(path: unknown, revision: unknown, replacement: unknown): Promise<EditorSession> {
  assertAbsolutePath(replacement)
  return executeEditor(path, revision, undefined, 'replace-source', replacement)
}
export async function runEditor(path: unknown, revision: unknown, candidateId: unknown, action: unknown): Promise<EditorSession> {
  if (action !== 'review' && action !== 'export' && action !== 'export-all' && action !== 'scan-cameras') throw new Error('Invalid editor operation')
  return executeEditor(path, revision, candidateId, action)
}

/** Worker output can contain private paths and keys: log only a short, redacted tail. */
function safeTail(stderr: string): Record<string, string> {
  const lines = stderr.split(/\r?\n/).map((line) => line
    .replace(/^\d{4}-\d{2}-\d{2} [\d:,.]+ - [\w.]+ - [A-Z]+ - /, '')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]')
    .replace(/\b(?:sk|pk|rk)-[\w-]{8,}/g, '[key]')
    .replace(/\b(?:authorization|api[_ -]?key|token|password|secret|bearer)\b\S*\s*[:=]?\s*\S+/gi, '[redacted]')
    .replace(/(?:[A-Za-z]:)?[\\/][^\s'"]*/g, '[path]')
    .replace(/[^\x20-\x7e]/g, '?').replace(/\s+/g, ' ').trim().slice(0, 160))
    .filter(Boolean).slice(-8)
  return Object.fromEntries(lines.map((line, i) => [`line${i + 1}`, line]))
}
/** Generous for long sources on CPU encoders, yet bounded if a worker hangs. */
const workerLimitMs = (durationMs: number): number => 30 * 60 * 1000 + 3 * durationMs

type WorkerResult = { ok: boolean; error?: unknown } & Record<string, unknown>
/** A failed worker run, with its result line (it can report what paid calls cost before the failure). */
class WorkerFailure extends Error { result?: WorkerResult }
function runWorker(run: string, operation: EditorOperation, action: WorkerAction, env: Record<string, string | undefined>, python: string, limitMs: number, request: Record<string, unknown>): Promise<WorkerResult> {
  const engine = env.PYTHONPATH!
  return new Promise<WorkerResult>((resolve, reject) => {
    const child = spawn(python, [join(dirname(getBridgeRunnerPath()), 'editor_runner.py')],
      { cwd: engine, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true })
    operation.child = child
    let stdout = '', stderr = '', settled = false, protocolFailed = false, timedOut = false
    let result: WorkerResult | undefined
    const consume = (line: string): void => {
      if (!line.trim()) return
      if (line.length > 16384) { protocolFailed = true; stop(child); return }
      try {
        const value = JSON.parse(line)
        if (value?.type === 'progress') {
          const phases = action === 'scan-cameras' ? ['scan', 'preview'] : action === 'prepare' ? ['copy', 'download', 'preview'] : []
          if (phases.includes(value.phase) && typeof value.percent === 'number' && Number.isFinite(value.percent) && value.percent >= 0 && value.percent <= 100) {
            const previous = operation.progress
            if (!previous || phases.indexOf(previous.phase) < phases.indexOf(value.phase) ||
                (previous.phase === value.phase && value.percent >= previous.percent)) {
              operation.progress = { phase: value.phase, percent: Math.floor(value.percent) }
            }
          }
        } else if (typeof value?.ok === 'boolean' && !result) result = value
        else protocolFailed = true
      } catch { protocolFailed = true }
    }
    const timer = setTimeout(() => { timedOut = true; stop(child, true) }, limitMs)
    const finish = (error?: Error): void => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(result!) }
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
      let end: number
      while ((end = stdout.indexOf('\n')) >= 0) { consume(stdout.slice(0, end)); stdout = stdout.slice(end + 1) }
      if (stdout.length > 16384) { protocolFailed = true; stdout = ''; stop(child) }
    })
    // Keep a bounded tail for the log; it is redacted before it is written.
    child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-8192) })
    child.on('error', (error) => {
      logger.error('editor.worker.spawnFailed', { action, errno: (error as NodeJS.ErrnoException).code ?? 'unknown' })
      finish(new Error('Could not start the editor engine. Open Settings and run System check.'))
    })
    child.on('close', (exitCode, signal) => {
      consume(stdout)
      if (exitCode === 0 && !protocolFailed && result?.ok === true) return finish()
      const code: EditorErrorCode | undefined = timedOut ? 'timeout' : operation.cancelled ? 'cancelled' : isEditorErrorCode(result?.error) ? result.error : undefined
      logger.warn('editor.worker.failed', { action, code: code ?? 'unknown', exitCode, signal, protocolFailed, ...safeTail(stderr) })
      const failure = new WorkerFailure(editorFailureMessage(action === 'export-all' ? 'export' : action, code))
      failure.result = result
      finish(failure)
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify(request))
  })
}

const quote = (title: string): string => `“${title.length > 60 ? `${title.slice(0, 59)}…` : title}”`
class BatchError extends Error {}
/** Report a partial "Bake all": what finished, which clips failed and why, and what is still ready. */
function batchFailure(batch: EditorBatch, failed: { title: string; error: Error }[], cancelled: boolean, stoppedBy?: unknown): Error {
  const parts = [`Baked ${batch.completed} of ${batch.total} ready clips.`]
  if (failed.length) {
    const reasons = [...new Set(failed.map((f) => f.error.message))]
    parts.push(`Could not bake ${failed.slice(0, 3).map((f) => quote(f.title)).join(', ')}${failed.length > 3 ? ` and ${failed.length - 3} more` : ''}:`,
      reasons.length === 1 ? reasons[0] : `${reasons[0]} (and other errors)`)
  }
  if (cancelled) parts.push('Batch cancelled.')
  else if (stoppedBy !== undefined) parts.push(`Batch stopped: ${stoppedBy instanceof Error ? stoppedBy.message : 'Export failed.'}`)
  if (batch.completed < batch.total) parts.push('Clips that were not baked are still ready.')
  return new BatchError(parts.join(' '))
}
function workerSetup(settings: ReturnType<typeof loadSettings>): { env: Record<string, string | undefined>; python: string } {
  const engine = getEnginePath()
  const env: Record<string, string | undefined> = { ...runtimeEnvironment(), ...getSettingsForBridge({ ...settings, jevEnabled: 'on' }), PYTHONPATH: engine, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' }
  const ffmpeg = resolveBinary('ffmpeg')
  if (ffmpeg !== 'ffmpeg') env.PATH = `${dirname(ffmpeg)}${delimiter}${env.PATH ?? ''}`
  return { env, python: resolvePythonPath(engine, settings.pythonPath) }
}
async function executeEditor(path: unknown, revision: unknown, candidateId: unknown, action: WorkerAction, replacement?: string): Promise<EditorSession> {
  const run = runPath(path)
  if (operations.has(run) || operations.size >= 2) throw new Error('An editor operation is already running. Try again when it finishes.')
  const operation: EditorOperation = { action, ...(action === 'scan-cameras' ? { progress: { phase: 'scan', percent: 0 } as const } : {}) }
  operations.set(run, operation)
  const sourceId = action === 'replace-source' ? randomUUID().replaceAll('-', '') : undefined
  const previewId = action === 'scan-cameras' ? randomUUID().replaceAll('-', '') : undefined
  let previousPreview: string | undefined
  let previousMedia: string[] = []
  const failed: { title: string; error: Error }[] = []
  try {
    const session = await openEditor(run)
    if (session.project.media_freed) throw new Error('Editor media was freed. This project is read-only.')
    previousPreview = session.previewPath
    if (revision !== session.project.revision || (action !== 'export-all' && action !== 'replace-source' && !session.project.candidates.some((c) => c.id === candidateId))) throw new Error('Project changed. Reopen it and retry.')
    if (sourceId) {
      const media = await openAuthorizedMedia(replacement!, loadSettings().outputDirectory)
      operation.abort = new AbortController()
      try {
        if (operation.cancelled) throw new Error('Source replacement cancelled.')
        await pipeline(media.handle.createReadStream({ autoClose: false }), createWriteStream(join(run, `editor-source-${sourceId}.mp4`), { flags: 'wx', mode: 0o600 }), { signal: operation.abort.signal })
      } finally { await media.handle.close() }
      previousMedia = [session.sourcePath, session.previewPath]
    }
    if (action === 'export' && session.project.candidates.find((c) => c.id === candidateId)!.status !== 'ready') throw new Error('Mark this clip ready before baking it')
    const candidates = action === 'replace-source' ? session.project.candidates.slice(0, 1) : action === 'export-all' ? session.project.candidates.filter((c) => c.status === 'ready') : session.project.candidates.filter((c) => c.id === candidateId)
    if (!candidates.length) throw new Error('Mark at least one clip ready before baking.')
    if (action === 'export-all') operation.batch = { completed: 0, total: candidates.length }
    const settings = loadSettings()
    if (action === 'review' && !settings.openrouterApiKey) throw new Error('Add your OpenRouter key in Settings to run this review.')
    const { env, python } = workerSetup(settings), limitMs = workerLimitMs(session.project.duration_ms)
    for (const candidate of candidates) {
      if (operation.cancelled) break
      try {
        const exporting = action === 'export' || action === 'export-all'
        const work = async (): Promise<void> => {
          const libraryCta = exporting ? await libraryClipCta(run, candidate) : undefined
          let result: WorkerResult
          try {
            result = await runWorker(run, operation, action, env, python, limitMs, { run, library: realpathSync(settings.outputDirectory), revision, candidate_id: candidate.id, action: action === 'export-all' ? 'export' : action, source_id: sourceId, preview_id: previewId })
          } catch (error) {
            // A render that failed after its captions were translated still spent that call; so did a review that failed part way.
            const failedResult = (error as WorkerFailure).result
            if (exporting && failedResult) await recordEditorCost(run, failedResult, 'editor_caption_translation', true)
            if (action === 'review' && failedResult) await recordEditorCost(run, failedResult, 'editor_review')
            throw error
          }
          // The coherence judgments (and any looks at the video's frames) of a review.
          if (action === 'review') await recordEditorCost(run, result, 'editor_review')
          if (exporting) {
            // Translated captions (a clip from an Automatic run in another caption language) cost one OpenRouter call.
            await recordEditorCost(run, result, 'editor_caption_translation', true)
            if (!operation.cancelled) await addExportCta(run, candidate.id, libraryCta)
          }
        }
        if (exporting) await runExclusive(run, work)
        else await work()
        if (operation.batch) operation.batch.completed++
      } catch (error) {
        // One failed clip must not strand the rest of "Bake all".
        if (action !== 'export-all' || operation.cancelled) throw error
        failed.push({ title: candidate.title, error: error as Error })
        operation.batch!.failed = failed.length
      } finally { operation.child = undefined }
      revision = readProject(run).revision
    }
    if (operation.batch && (operation.cancelled || failed.length)) throw batchFailure(operation.batch, failed, !!operation.cancelled)
    if (operation.cancelled) throw new Error(editorFailureMessage(action, 'cancelled'))
  } catch (error) {
    if (operation.batch && !(error instanceof BatchError)) throw batchFailure(operation.batch, failed, !!operation.cancelled, error)
    throw error
  } finally {
    if (previewId) {
      let active: string | undefined, readable = false
      try { active = readProject(run).preview_id; readable = true } catch { /* Preserve media if state is unreadable. */ }
      const stale = !readable ? [] : active === previewId ? (previousPreview ? [previousPreview] : [])
        : [join(run, `editor-preview-${previewId}.mp4`), join(run, `editor-preview-${previewId}.mp4.partial.mp4`)]
      for (const file of stale) { try { unlinkSync(file) } catch { /* A playing preview can remain open on Windows. */ } }
    }
    if (sourceId) {
      // The JSON pointer switches both media files together. Never delete the active pair,
      // including when cancellation/worker exit races with the commit.
      let active: string | undefined, readable = false
      try { active = readProject(run).source_id; readable = true } catch { /* Preserve files if the project cannot be read. */ }
      const stale = !readable ? [] : active === sourceId ? previousMedia : [join(run, `editor-source-${sourceId}.mp4`), join(run, `editor-preview-${sourceId}.mp4`), join(run, `editor-preview-${sourceId}.mp4.partial.mp4`)]
      for (const file of stale) { try { unlinkSync(file) } catch { /* Open previews may remain until a later cleanup on Windows. */ } }
    }
    operations.delete(run)
    try { sweepEditorFiles(run) } catch { /* Cleanup is best effort. */ }
  }
  return openEditor(run)
}
/**
 * Add a clip: one made from transcript lines, or a copy of `sourceId` for A/B
 * testing. Main assigns its id; the new clip starts refining, unreviewed and
 * unexported. A copy keeps its source's score, reason and camera scan.
 */
export async function addEditorCandidate(path: unknown, revision: unknown, candidate: unknown, sourceId?: unknown): Promise<EditorSession> {
  const run = runPath(path)
  if (operations.has(run)) throw new Error('Wait for the current editor operation to finish')
  operations.set(run, { action: 'save' })
  try {
    const { project } = await openEditor(run)
    if (!Number.isSafeInteger(revision) || project.revision !== revision) throw new Error(EDITOR_REVISION_CONFLICT)
    if (project.media_freed) throw new Error('Editor media was freed. This project is read-only.')
    if (project.candidates.length >= MAX_EDITOR_CANDIDATES) throw new Error(`A project can hold up to ${MAX_EDITOR_CANDIDATES} clips. This one is full.`)
    let source: EditorCandidate | undefined
    if (sourceId !== undefined && sourceId !== null) {
      source = typeof sourceId === 'string' ? project.candidates.find((c) => c.id === sourceId) : undefined
      if (!source) throw new Error('The clip to copy is missing. Reopen the editor and try again.')
    }
    const edit = parseCandidateEdit(candidate, project.duration_ms, project.transcript.length)
    if (!source) {
      // From transcript lines: one stretch of the source, 3 seconds to 3 minutes.
      const length = edit.ranges.length === 1 ? edit.ranges[0][1] - edit.ranges[0][0] : -1
      if (length < Math.min(TRANSCRIPT_CLIP_MS.min, project.duration_ms) || length > TRANSCRIPT_CLIP_MS.max) throw new Error('Invalid candidate edits')
    }
    const ids = new Set(project.candidates.map((c) => c.id))
    let id: string
    do id = `clip-${randomUUID().replaceAll('-', '').slice(0, 12)}`; while (ids.has(id))
    const added: EditorCandidate = { ...edit, id, status: 'refining', score: source?.score ?? 0, reason: source?.reason ?? '', review: null, exports: [],
      requires_visual_context: source?.requires_visual_context === true, ...(source?.camera_scan ? { camera_scan: structuredClone(source.camera_scan) } : {}) }
    project.candidates.push(added)
    project.revision++
    writeProject(run, project)
  } finally { operations.delete(run) }
  return openEditor(run)
}

/**
 * Before a bake: how many clips will have their captions translated (one OpenRouter call each),
 * and an estimate from what this run's translations cost so far (null when none is recorded).
 */
export async function editorTranslationEstimate(path: unknown, candidateId: unknown, action: unknown): Promise<{ clips: number; estimateUsd: number | null }> {
  if (action !== 'export' && action !== 'export-all') return { clips: 0, estimateUsd: null }
  const run = runPath(path)
  const project = readProject(run)
  const chosen = action === 'export-all' ? project.candidates.filter((c) => c.status === 'ready') : project.candidates.filter((c) => c.id === candidateId)
  const clips = chosen.filter((c) => c.captions && isCaptionLanguage(c.caption_language)).length
  if (!clips) return { clips: 0, estimateUsd: null }
  const each = await recordedCostEach(run, ['caption_translation', 'editor_caption_translation'])
  return { clips, estimateUsd: each === null ? null : Math.round(each * clips * 1e6) / 1e6 }
}

/**
 * Before an editor review or hook ideas: an estimate from what this run's earlier ones cost
 * (null when none is recorded: the spending check then asks for its minimum balance).
 */
export async function editorCallEstimate(path: unknown, action: 'review' | 'suggest-hooks'): Promise<number | null> {
  const each = await recordedCostEach(runPath(path), [action === 'review' ? 'editor_review' : 'editor_hooks'])
  return each === null ? null : Math.round(each * 1e6) / 1e6
}

/** The average recorded cost of one call in these job_output cost sections, or null. */
async function recordedCostEach(run: string, sections: string[]): Promise<number | null> {
  let usd = 0, attempts = 0
  try {
    const costs = (await getJobOutput(run))?.metrics?.api_costs as Record<string, unknown> | undefined
    for (const section of sections) {
      const entry = costs?.[section] as { estimated_cost_usd?: unknown; attempts?: unknown } | undefined
      const cost = entry?.estimated_cost_usd, count = entry?.attempts
      if (typeof cost === 'number' && Number.isFinite(cost) && cost > 0 && typeof count === 'number' && Number.isFinite(count) && count > 0) { usd += cost; attempts += count }
    }
  } catch { /* no recorded cost: no estimate */ }
  return attempts ? usd / attempts : null
}

/** Record what an editor AI call cost in the run's job_output.json (metrics.api_costs[section]). */
const EDITOR_SPEND_LABELS = { editor_hooks: 'Editor hook ideas', editor_caption_translation: 'Editor caption translation', editor_review: 'Editor review' } as const
async function recordEditorCost(run: string, result: WorkerResult, section: keyof typeof EDITOR_SPEND_LABELS, locked = false): Promise<void> {
  const cost = typeof result.cost_usd === 'number' && Number.isFinite(result.cost_usd) && result.cost_usd >= 0 && result.cost_usd < 1000 ? result.cost_usd : 0
  const incomplete = result.cost_incomplete === true
  const model = typeof result.model === 'string' && /^[\w.:/-]{1,120}$/.test(result.model) ? result.model : undefined
  if (!cost && !incomplete) return
  if (cost && recordEditorSpend) {
    // The spending ledger (Settings → Spending), apart from the run's own cost record.
    try { await recordEditorSpend(cost, EDITOR_SPEND_LABELS[section]) } catch { /* never breaks the editor */ }
  }
  const object = (x: unknown): Record<string, unknown> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {}
  try {
    const work = async (): Promise<void> => {
      const file = join(run, 'job_output.json')
      const stat = lstatSync(file)
      if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error('Invalid job output')
      const output = object(JSON.parse(readFileSync(file, 'utf8')))
      const metrics = object(output.metrics), costs = object(metrics.api_costs), current = object(costs[section])
      const add = (x: unknown, n: number): number => Math.round(((typeof x === 'number' && Number.isFinite(x) ? x : 0) + n) * 1e6) / 1e6
      costs[section] = { ...current, provider: 'openrouter', ...(model ? { model } : {}), estimated_cost_usd: add(current.estimated_cost_usd, cost),
        attempts: add(current.attempts, 1), ...(incomplete || current.cost_incomplete === true ? { cost_incomplete: true } : {}) }
      costs.total_estimated_cost_usd = add(costs.total_estimated_cost_usd, cost)
      if (incomplete) costs.cost_incomplete = true
      metrics.api_costs = costs; output.metrics = metrics
      const temporary = join(run, `.editor-${randomUUID()}.tmp`)
      try {
        writeFileSync(temporary, JSON.stringify(output), { mode: 0o600, flag: 'wx' })
        renameSync(temporary, file)
      } finally { try { unlinkSync(temporary) } catch { /* Already committed. */ } }
    }
    // An export already holds the run's lock.
    if (locked) await work()
    else await runExclusive(run, work)
  } catch (error) {
    // The result is still used; only the cost record is missing.
    logger.warn('editor.cost.notRecorded', { message: String((error as Error)?.message ?? error).slice(0, 200) })
  }
}

/** Hook ideas for one clip, from its own words (OpenRouter, the member's key). The project is not changed. */
export async function suggestEditorHooks(path: unknown, revision: unknown, candidateId: unknown): Promise<{ hooks: HookIdea[] }> {
  const run = runPath(path)
  if (operations.has(run) || operations.size >= 2) throw new Error('An editor operation is already running. Try again when it finishes.')
  const operation: EditorOperation = { action: 'suggest-hooks' }
  operations.set(run, operation)
  try {
    const { project } = await openEditor(run)
    if (project.media_freed) throw new Error('Editor media was freed. This project is read-only.')
    if (revision !== project.revision || typeof candidateId !== 'string' || !project.candidates.some((c) => c.id === candidateId)) throw new Error('Project changed. Reopen it and retry.')
    const settings = loadSettings()
    if (!settings.openrouterApiKey) throw new Error('Add your OpenRouter key in Settings to get hook ideas.')
    const { env, python } = workerSetup(settings)
    let result: WorkerResult
    try {
      result = await runWorker(run, operation, 'suggest-hooks', env, python, 10 * 60 * 1000,
        { run, library: realpathSync(settings.outputDirectory), revision, candidate_id: candidateId, action: 'suggest-hooks' })
    } catch (error) {
      // Paid before it failed: still recorded.
      const failedResult = (error as WorkerFailure).result
      if (failedResult) await recordEditorCost(run, failedResult, 'editor_hooks')
      throw error
    }
    if (operation.cancelled) throw new Error(editorFailureMessage('suggest-hooks', 'cancelled'))
    await recordEditorCost(run, result, 'editor_hooks')
    return { hooks: parseHookIdeas(result.hooks) }
  } finally {
    operation.child = undefined
    operations.delete(run)
  }
}

// Keep IPC's editable surface narrow; no media paths, reviews or export records come from React.
export type { CandidateEdit }

let resumeAfterSave: (() => void) | null = null
/** Closing with unsaved edits: main asked the renderer to save, and resumes the close only after it succeeds. */
export function awaitEditorSaveBeforeClose(resume: () => void): void { resumeAfterSave = resume }
export function editorCloseReady(saved: unknown): void {
  const resume = resumeAfterSave
  resumeAfterSave = null
  if (saved === true && resume) setImmediate(resume)
}

/**
 * Work that prepares a run for the editor (edit-automatic.ts): while it runs,
 * the run counts as busy for the editor (no delete, move, cleanup or other
 * editor operation) and "Cancel" stops it. `worker` runs the engine's
 * "prepare" action with this operation's progress.
 */
export interface EditorPreparation {
  run: string
  signal: AbortSignal
  cancelled: () => boolean
  setProgress: (progress: NonNullable<EditorSession['progress']>) => void
  worker: (request: Record<string, unknown>, durationMs: number) => Promise<Record<string, unknown>>
}
export async function withEditorPreparation<T>(path: unknown, work: (prep: EditorPreparation) => Promise<T>): Promise<T> {
  const run = runPath(path)
  if (operations.has(run) || operations.size >= 2) throw new Error('An editor operation is already running. Try again when it finishes.')
  const operation: EditorOperation = { action: 'prepare', abort: new AbortController() }
  operations.set(run, operation)
  try {
    return await runExclusive(run, () => work({
      run, signal: operation.abort!.signal, cancelled: () => !!operation.cancelled,
      setProgress: (progress) => { operation.progress = { ...progress } },
      worker: async (request, durationMs) => {
        if (operation.cancelled) throw new Error(editorFailureMessage('prepare', 'cancelled'))
        const settings = loadSettings()
        const { env, python } = workerSetup(settings)
        try {
          return await runWorker(run, operation, 'prepare', env, python, workerLimitMs(durationMs),
            { ...request, run, library: realpathSync(settings.outputDirectory), action: 'prepare' })
        } finally { operation.child = undefined }
      }
    }))
  } finally {
    operations.delete(run)
    try { sweepEditorFiles(run) } catch { /* Cleanup is best effort. */ }
  }
}
/** What a running editor operation is doing (also before a run has an editor project). */
export function editorOperationStatus(path: unknown): { operation: EditorSession['operation']; progress?: EditorSession['progress'] } {
  const operation = operations.get(runPath(path))
  return { operation: operation?.action ?? null, ...(operation?.progress ? { progress: { ...operation.progress } } : {}) }
}
