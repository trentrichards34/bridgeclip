import { createHash, randomUUID } from 'crypto'
import { dirname, resolve } from 'path'
import { AUTOMATION_PLATFORMS, type AutomationSourceContext, type MetadataEnhancement } from '../shared/automations'
import type { ClipArtifact, JobOutput } from '../shared/job-output'
import type { PostRecord } from '../shared/zernio-posts'
import { clipPostingStatus, MAX_POSTING_SUMMARY_RUNS, type LibraryClipPostingStatus, type LibraryEnhancementOptions, type LibraryRunPostingCounts } from '../shared/library-posting'
import { loadSettings } from './settings-store'
import { currentRunPath } from './library-folders'
import { getJobOutput, isManuallyPosted } from './file-manager'
import { assertAbsolutePath, assertMediaPath, authorizeMedia, isWithinDirectory, openAuthorizedMedia } from './security'
import { automationMediaMatcher, listAutomations } from './automations'
import { listPosts } from './zernio/posts'
import { completeSourceContext, parseSourceContext, sourceFromOutput } from './automation-source'
import { MIN_INSIGHT_AGE_MS, summarizeInsights, type InsightPost, type PostInsights } from '../shared/post-insights'
import { CAPTION_PRESETS } from '../shared/caption-presets'
import { HEADLINE_LOOKS } from '../shared/headline-look'
import { generateAutomationMetadata, researchAutomationTopic, transcribeAutomationClip } from './automation-metadata'

const mediaPath = (value: string): string => resolve(value.replace(/^file:\/\//, ''))
// A run moved to a new output folder: posts still name the clip's old path.
const pathKey = (value: string): string => { const path = mediaPath(currentRunPath(mediaPath(value))); return process.platform === 'win32' ? path.toLowerCase() : path }

async function libraryRun(raw: unknown, library = loadSettings().outputDirectory): Promise<JobOutput> {
  assertAbsolutePath(raw)
  if (!isWithinDirectory(raw, library)) throw new Error('Choose a run in your Library.')
  const output = await getJobOutput(raw, library)
  if (!output) throw new Error('This run is no longer available in the Library.')
  return output
}

async function libraryClip(outputDir: unknown, clipIndex: unknown): Promise<{ output: JobOutput; clip: ClipArtifact; path: string }> {
  const output = await libraryRun(outputDir)
  if (!Number.isSafeInteger(clipIndex)) throw new Error('Choose a clip from this run.')
  const clip = output.clips.find((item) => item.clip_index === clipIndex)
  if (!clip) throw new Error('This clip is no longer in the run.')
  const path = mediaPath(clip.s3_url)
  if (!isWithinDirectory(path, outputDir as string)) throw new Error('The clip is outside its Library run.')
  assertMediaPath(path, loadSettings().outputDirectory)
  return { output, clip, path }
}

// Byte identity recovers old bank copies without guessing from titles or filenames.
const hashes = new Map<string, string>()
async function fingerprint(path: string, library: string): Promise<{ size: number; hash: () => Promise<string> }> {
  const opened = await openAuthorizedMedia(path, library)
  const stats = await opened.handle.stat()
  const key = JSON.stringify([opened.canonical, stats.size, stats.mtimeMs, stats.ctimeMs, stats.ino])
  await opened.handle.close()
  return { size: stats.size, hash: async () => {
    const cached = hashes.get(key)
    if (cached) return cached
    const file = await openAuthorizedMedia(path, library)
    try {
      const current = await file.handle.stat()
      if (JSON.stringify([file.canonical, current.size, current.mtimeMs, current.ctimeMs, current.ino]) !== key) throw new Error('Clip changed while checking its posting history. Try again.')
      const hash = createHash('sha256')
      for await (const chunk of file.handle.createReadStream({ autoClose: false })) hash.update(chunk)
      const after = await file.handle.stat()
      if (after.size !== current.size || after.mtimeMs !== current.mtimeMs || after.ctimeMs !== current.ctimeMs) throw new Error('Clip changed while checking its posting history. Try again.')
      const value = hash.digest('hex')
      if (hashes.size >= 256) hashes.delete(hashes.keys().next().value!)
      hashes.set(key, value)
      return value
    } finally { await file.handle.close() }
  } }
}

type Fingerprint = Awaited<ReturnType<typeof fingerprint>>
/** Everything that is the same for every run: read settings, posts and automation banks once. */
interface PostingContext { library: string; posts: PostRecord[]; origins: Map<string, string>; bankPosts: PostRecord[]; bankFiles: Map<string, Fingerprint> }

async function postingContext(library: string): Promise<PostingContext> {
  const posts = listPosts()
  const origins = new Map(listAutomations().flatMap((automation) => automation.content.filter((item) => item.postId && item.sourceClipPath).map((item) => [item.postId!, pathKey(item.sourceClipPath!)] as const)))
  const isBankFile = automationMediaMatcher()
  const bankPosts = posts.filter((post) => !origins.has(post.id) && isBankFile(post.clipPath))
  const bankFiles = new Map<string, Fingerprint>()
  for (const post of bankPosts) {
    if (bankFiles.has(post.clipPath)) continue
    try { authorizeMedia(post.clipPath); bankFiles.set(post.clipPath, await fingerprint(post.clipPath, library)) } catch { /* A removed bank copy cannot be matched. */ }
  }
  return { library, posts, origins, bankPosts, bankFiles }
}

type RunClips = Pick<ClipArtifact, 'clip_index' | 's3_url'>[]
async function runPostingStatus(outputDir: unknown, library: string, context: PostingContext | null, known?: RunClips): Promise<LibraryClipPostingStatus[]> {
  const output = known ? { clips: known } : await libraryRun(outputDir, library)
  const run = outputDir as string
  const withManualStatus = (status: LibraryClipPostingStatus): LibraryClipPostingStatus =>
    isManuallyPosted(run, status.clipIndex) ? { ...status, state: 'posted', manuallyPosted: true } : status
  if (!context) return output.clips.map((clip) => withManualStatus(clipPostingStatus(clip.clip_index, [])))
  const { posts, origins, bankPosts, bankFiles } = context
  const statuses: LibraryClipPostingStatus[] = []
  for (const clip of output.clips) {
    const path = mediaPath(clip.s3_url)
    if (!isWithinDirectory(path, run)) throw new Error('A clip is outside its Library run.')
    const matches = posts.filter((post) => pathKey(post.clipPath) === pathKey(path) || origins.get(post.id) === pathKey(path))
    if (bankFiles.size) {
      let original: Fingerprint | null = null
      try { original = await fingerprint(path, library) } catch { /* Direct history remains available for removed originals. */ }
      if (original) for (const post of bankPosts) {
        const bank = bankFiles.get(post.clipPath)
        if (bank && bank.size === original.size && await bank.hash() === await original.hash()) matches.push(post)
      }
    }
    statuses.push(withManualStatus(clipPostingStatus(clip.clip_index, matches)))
  }
  return statuses
}

export async function libraryPostingStatus(outputDir: unknown): Promise<LibraryClipPostingStatus[]> {
  const { outputDirectory: library, zernioApiKey: workspaceKey } = loadSettings()
  const statuses = await runPostingStatus(outputDir, library, workspaceKey ? await postingContext(library) : null)
  if (loadSettings().zernioApiKey !== workspaceKey) throw new Error('The posting workspace changed. Refresh the Library.')
  return statuses
}

/**
 * Posted counts for many runs in one request. Settings, post history and the
 * automation banks are read once, instead of once per run and clip.
 */
export async function libraryPostingSummary(outputDirs: unknown): Promise<LibraryRunPostingCounts[]> {
  if (!Array.isArray(outputDirs) || outputDirs.length > MAX_POSTING_SUMMARY_RUNS || !outputDirs.every((dir) => typeof dir === 'string')) {
    throw new Error('Choose runs in your Library.')
  }
  const { outputDirectory: library, zernioApiKey: workspaceKey } = loadSettings()
  const context = workspaceKey ? await postingContext(library) : null
  const results: LibraryRunPostingCounts[] = []
  for (const outputDir of new Set(outputDirs as string[])) {
    try {
      const statuses = await runPostingStatus(outputDir, library, context)
      const posted = statuses.filter((status) => status.state === 'posted').length
      results.push({ outputDir, counts: { posted, notPosted: statuses.length - posted } })
    } catch { results.push({ outputDir, counts: null }) }
  }
  if (loadSettings().zernioApiKey !== workspaceKey) throw new Error('The posting workspace changed. Refresh the Library.')
  return results
}

/**
 * Posting status for many runs whose clips the caller already read from the
 * Library (the Ready to post index). Like the summary, settings, post history
 * and automation banks are read once. A run that cannot be checked maps to null.
 */
export async function postingStatusForRuns(runs: { outputDir: string; clips: RunClips }[]): Promise<{ statuses: Map<string, LibraryClipPostingStatus[] | null>; postingHistory: boolean }> {
  const { outputDirectory: library, zernioApiKey: workspaceKey } = loadSettings()
  const context = workspaceKey ? await postingContext(library) : null
  const statuses = new Map<string, LibraryClipPostingStatus[] | null>()
  for (const run of runs) {
    try { statuses.set(run.outputDir, await runPostingStatus(run.outputDir, library, context, run.clips)) } catch { statuses.set(run.outputDir, null) }
  }
  if (loadSettings().zernioApiKey !== workspaceKey) throw new Error('The posting workspace changed. Refresh the Library.')
  return { statuses, postingHistory: Boolean(workspaceKey) }
}

export async function libraryMetadataSource(outputDir: unknown, clipIndex: unknown): Promise<AutomationSourceContext | null> {
  const { output } = await libraryClip(outputDir, clipIndex)
  return completeSourceContext(sourceFromOutput(output))
}

const enhancing = new Set<string>()
export async function enhanceLibraryMetadata(outputDir: unknown, clipIndex: unknown, raw: unknown): Promise<MetadataEnhancement> {
  if (!raw || typeof raw !== 'object') throw new Error('Choose enhancement options.')
  const options = raw as LibraryEnhancementOptions
  if (!Array.isArray(options.platforms) || !options.platforms.length || options.platforms.length > AUTOMATION_PLATFORMS.length ||
      !options.platforms.every((platform) => AUTOMATION_PLATFORMS.includes(platform)) || new Set(options.platforms).size !== options.platforms.length ||
      typeof options.research !== 'boolean' || (options.notes !== undefined && (typeof options.notes !== 'string' || options.notes.length > 63206)) ||
      (options.facebookFormat !== undefined && !['feed', 'reel'].includes(options.facebookFormat))) throw new Error('Choose valid platforms and enhancement options.')
  const { output, clip, path } = await libraryClip(outputDir, clipIndex)
  const settings = loadSettings()
  if (!settings.openrouterApiKey) throw new Error('Add an OpenRouter key in Settings to enhance metadata.')
  if (enhancing.has(path) || enhancing.size >= 2) throw new Error('Wait for the current metadata enhancement to finish.')
  let source = options.source === undefined ? sourceFromOutput(output) : parseSourceContext(options.source)
  const ensureCurrent = (): void => {
    const current = loadSettings()
    if (current.openrouterApiKey !== settings.openrouterApiKey || current.outputDirectory !== settings.outputDirectory || current.zernioApiKey !== settings.zernioApiKey) throw new Error('Settings changed during enhancement. Try again.')
  }
  enhancing.add(path)
  try {
    source = await completeSourceContext(source); ensureCurrent()
    const transcript = await transcribeAutomationClip(path); ensureCurrent()
    const research = options.research ? await researchAutomationTopic(transcript, source)
      : { status: 'skipped' as const, summary: 'Web research was turned off.', sources: [] }
    ensureCurrent()
    const posts = await generateAutomationMetadata(transcript, clip.summary || 'Untitled clip', options.notes ?? '', options.platforms, { source, research, facebookFormat: options.facebookFormat })
    ensureCurrent()
    return { id: randomUUID(), createdAt: new Date().toISOString(), platforms: options.platforms, source, research, posts }
  } finally { enhancing.delete(path) }
}

/** The Library clip a post was made from: its run is the clip's folder or one of the two above it. */
async function clipForPost(path: string, library: string, runs: Map<string, JobOutput | null>): Promise<ClipArtifact | null> {
  let dir = dirname(mediaPath(path))
  for (let depth = 0; depth < 3 && isWithinDirectory(dir, library); depth++) {
    if (!runs.has(dir)) runs.set(dir, await getJobOutput(dir, library))
    const output = runs.get(dir)
    if (output) return output.clips.find((item) => pathKey(item.s3_url) === pathKey(path)) ?? null
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Average views by framework grade, hook look and caption style, from the
 * stats Zernio reported for posts made from CreatorClips. Only clips found in
 * the Library count (their grade and settings come from the run), and only
 * posts at least a day old, since newer ones are still gaining views.
 */
export async function postPerformanceInsights(): Promise<PostInsights> {
  const { outputDirectory: library, zernioApiKey } = loadSettings()
  if (!zernioApiKey) return summarizeInsights([], { hookLook: String, captionStyle: String })
  const origins = new Map(listAutomations().flatMap((automation) => automation.content.filter((item) => item.postId && item.sourceClipPath).map((item) => [item.postId!, item.sourceClipPath!] as const)))
  const now = Date.now()
  const runs = new Map<string, JobOutput | null>()
  const items: InsightPost[] = []
  for (const post of listPosts()) {
    const views = post.stats?.total?.views
    if (views == null || now - Date.parse(post.createdAt) < MIN_INSIGHT_AGE_MS) continue
    let clip: ClipArtifact | null = null
    try { clip = await clipForPost(origins.get(post.id) ?? post.clipPath, library, runs) } catch { clip = null }
    // Only clips still in the Library: their grade and settings come from the run.
    if (!clip) continue
    const settings = clip.remix_settings ?? null
    items.push({
      views,
      grade: clip.framework?.grade ?? null,
      hookLook: settings?.headline_look?.look ?? null,
      captionStyle: settings ? (settings.include_captions ? settings.caption_preset || null : 'none') : null
    })
  }
  if (loadSettings().zernioApiKey !== zernioApiKey) throw new Error('The posting workspace changed. Refresh Posts.')
  return summarizeInsights(items, {
    hookLook: (id) => HEADLINE_LOOKS.find((look) => look.id === id)?.label ?? id,
    captionStyle: (id) => id === 'none' ? 'No captions' : CAPTION_PRESETS.find((preset) => preset.id === id)?.name ?? id
  })
}
