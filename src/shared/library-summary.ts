/**
 * The Library at a glance: how many clips are being refined, are ready to bake
 * or are exported, and one light row per clip for the Library's clip grid and
 * the sidebar badge. Read-only: built in main from the runs' job_output.json and
 * editor-project.json files (the editor's part is cached by file identity).
 */
export type LibraryClipStatus = 'refining' | 'ready' | 'exported'

export interface LibraryClipItem {
  outputDir: string
  /** The run's video title. */
  runTitle: string
  /** When the run was made (ISO). */
  date: string
  madeWith?: string
  status: LibraryClipStatus
  /** Exported: the clip's index in job_output.json. Refining and ready: the candidate's index in the editor project. */
  index: number
  title: string
  durationMs: number
  /** 0–10 (the framework grade, else the planner's 0–1 score × 10, which editor clips carry too), or null when the clip has none. */
  score: number | null
  /** Exported clip file (its job_output s3_url), or the editor preview with a moment to show. */
  media: { kind: 'clip'; url: string } | { kind: 'preview'; path: string; ms: number } | null
}

export interface LibrarySummary {
  runs: number
  counts: Record<LibraryClipStatus, number>
  clips: LibraryClipItem[]
  /** More clips than MAX_SUMMARY_CLIPS: the counts are complete, the list is not. */
  truncated: boolean
}

export const MAX_SUMMARY_CLIPS = 2000

export interface SummaryRun {
  outputDir: string; videoTitle: string; date: string; status: string; editorProject?: boolean; madeWith?: string
}
export interface SummaryJobClip {
  clip_index: number; summary?: string | null; duration_ms: number; virality_score: number; s3_url: string
  framework?: { score: number } | null
}
export interface SummaryEditorClip { title: string; status: 'refining' | 'ready' | 'baked' | 'discarded'; durationMs: number; score: number; startMs: number }
export interface SummaryReaders {
  job: (outputDir: string) => Promise<{ clips: SummaryJobClip[] } | null>
  editor: (outputDir: string) => Promise<{ clips: SummaryEditorClip[]; previewPath: string | null } | null>
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const tenth = (n: number): number => Math.round(Math.max(0, Math.min(10, n)) * 10) / 10

/** Exported clips score like their Library card: the framework grade, else the planner's 0–1 score × 10. */
export function exportedScore(clip: Pick<SummaryJobClip, 'virality_score' | 'framework'>): number | null {
  if (clip.framework && finite(clip.framework.score)) return tenth(clip.framework.score)
  return finite(clip.virality_score) && clip.virality_score > 0 ? tenth(clip.virality_score * 10) : null
}

/** Completed runs only, in the order given (the Library's newest first). A run that can't be read is skipped. */
export async function buildLibrarySummary(runs: readonly SummaryRun[], read: SummaryReaders): Promise<LibrarySummary> {
  const counts: Record<LibraryClipStatus, number> = { refining: 0, ready: 0, exported: 0 }
  const clips: LibraryClipItem[] = []
  let truncated = false
  const done = runs.filter((run) => run.status === 'completed')
  const push = (item: LibraryClipItem): void => {
    counts[item.status]++
    if (clips.length < MAX_SUMMARY_CLIPS) clips.push(item)
    else truncated = true
  }
  for (const run of done) {
    const base = { outputDir: run.outputDir, runTitle: run.videoTitle, date: run.date, ...(run.madeWith ? { madeWith: run.madeWith } : {}) }
    if (run.editorProject) {
      const editor = await read.editor(run.outputDir).catch(() => null)
      editor?.clips.forEach((c, index) => {
        if (c.status !== 'refining' && c.status !== 'ready') return
        push({ ...base, status: c.status, index, title: c.title, durationMs: Math.max(0, c.durationMs), score: exportedScore({ virality_score: c.score }),
          media: editor.previewPath ? { kind: 'preview', path: editor.previewPath, ms: Math.max(0, c.startMs) } : null })
      })
    }
    const job = await read.job(run.outputDir).catch(() => null)
    for (const clip of job?.clips ?? []) {
      push({ ...base, status: 'exported', index: clip.clip_index, title: clip.summary?.trim() || `Clip ${clip.clip_index + 1}`,
        durationMs: finite(clip.duration_ms) ? Math.max(0, clip.duration_ms) : 0, score: exportedScore(clip),
        media: clip.s3_url ? { kind: 'clip', url: clip.s3_url } : null })
    }
  }
  return { runs: done.length, counts, clips, truncated }
}
