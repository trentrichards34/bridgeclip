import { lstat, readdir } from 'fs/promises'
import { join } from 'path'
import type { JobOutput } from '../shared/job-output'
import { runKindOf, type ReadyClip, type ReadyToPostResult } from '../shared/ready-to-post'
import { DELETING_RUN_PREFIX, getJobOutput } from './file-manager'
import { readRunRecord } from './run-history'
import { loadSettings } from './settings-store'
import { postingStatusForRuns } from './library-posting'

/**
 * The Ready to post index: every clip in every Library run, read from the
 * runs' job_output.json files. Each run is read again only when its
 * job_output.json (or run record) changes, so hundreds of runs stay quick.
 * Posting status is added on each request (posting history and manual marks
 * change without touching the run).
 */

type IndexedClip = Omit<ReadyClip, 'state'>
interface IndexedRun { outputDir: string; clips: IndexedClip[] }
interface CacheEntry { key: string; run: IndexedRun | null }

const cache = new Map<string, CacheEntry>()
let reads = 0
/** How many job_output.json files were parsed (tests check the cache). */
export function readyIndexReads(): number { return reads }

async function fileKey(path: string): Promise<string> {
  try {
    const stat = await lstat(path)
    return stat.isFile() && !stat.isSymbolicLink() ? `${stat.mtimeMs}:${stat.size}:${stat.ino}` : 'x'
  } catch { return '-' }
}

function indexRun(outputDir: string, folder: string, output: JobOutput, date: string): IndexedRun {
  const kind = runKindOf(folder, output.source_video_title)
  const runTitle = output.source_video_title || 'Untitled video'
  return {
    outputDir,
    clips: output.clips.map((clip) => ({
      outputDir, runTitle, kind, runDate: date, clipIndex: clip.clip_index,
      title: clip.summary?.trim() || `Clip ${clip.clip_index + 1}`,
      headline: clip.headline?.trim() || null,
      postCaption: clip.post_caption ?? null,
      grade: clip.framework?.grade ?? null,
      gradeScore: clip.framework ? clip.framework.score : null,
      viralityScore: clip.virality_score,
      durationMs: clip.duration_ms,
      s3Url: clip.s3_url,
      tags: clip.tags,
      aiGenerated: clip.ai_generated === true
    }))
  }
}

async function readRun(library: string, folder: string): Promise<IndexedRun | null> {
  const outputDir = join(library, folder)
  const outputFile = join(outputDir, 'job_output.json')
  const key = `${await fileKey(outputFile)}|${await fileKey(join(outputDir, 'run-history.json'))}`
  const cached = cache.get(outputDir)
  if (cached && cached.key === key) return cached.run
  let run: IndexedRun | null = null
  if (!key.startsWith('-') && !key.startsWith('x')) {
    reads++
    const output = await getJobOutput(outputDir, library)
    if (output && output.clips.length) {
      const record = readRunRecord(library, folder)
      let date = record?.startedAt ?? (output.created_at && Number.isFinite(Date.parse(output.created_at)) ? output.created_at : null)
      if (!date) { try { date = (await lstat(outputFile)).mtime.toISOString() } catch { date = new Date(0).toISOString() } }
      run = indexRun(outputDir, folder, output, date)
    }
  }
  cache.set(outputDir, { key, run })
  return run
}

/** Every run in the Library with its clips (from the cache when unchanged). */
export async function readyIndex(library = loadSettings().outputDirectory): Promise<IndexedRun[]> {
  let names: string[]
  try {
    names = (await readdir(library, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith(DELETING_RUN_PREFIX))
      .map((entry) => entry.name)
  } catch { return [] }
  const seen = new Set<string>()
  const runs: IndexedRun[] = []
  for (const name of names) {
    seen.add(join(library, name))
    const run = await readRun(library, name)
    if (run) runs.push(run)
  }
  // Forget runs that were deleted or belong to an earlier output folder.
  for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key)
  return runs
}

/** Clips from every run that are not posted yet (posting history and manual marks). */
export async function readyToPost(): Promise<ReadyToPostResult> {
  const library = loadSettings().outputDirectory
  const runs = await readyIndex(library)
  const { statuses, postingHistory } = await postingStatusForRuns(runs.map((run) => ({
    outputDir: run.outputDir, clips: run.clips.map((clip) => ({ clip_index: clip.clipIndex, s3_url: clip.s3Url }))
  })))
  const clips: ReadyClip[] = []
  let unreadableRuns = 0
  for (const run of runs) {
    const list = statuses.get(run.outputDir)
    if (!list) { unreadableRuns++; continue }
    const byClip = new Map(list.map((status) => [status.clipIndex, status]))
    for (const clip of run.clips) {
      const state = byClip.get(clip.clipIndex)?.state ?? 'not_posted'
      if (state !== 'posted') clips.push({ ...clip, state })
    }
  }
  return { clips, runs: runs.length, unreadableRuns, postingHistory }
}
