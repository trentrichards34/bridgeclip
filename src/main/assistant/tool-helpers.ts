import { basename, join } from 'path'
import type { BrowserWindow } from 'electron'
import type { AppDataScope, AssistantNavigationPage } from '../../shared/assistant'
import type { JobOutput } from '../../shared/job-output'
import { getJobOutput } from '../file-manager'
import { isWebUrl } from '../security'
import { loadSettings } from '../settings-store'
import { AssistantToolError } from './tool-types'

// Helpers shared by the CreatorClips tool sets (bridgeclip-tools, studio-tools).

export type DataScope = AppDataScope
export type AppPage = AssistantNavigationPage

export interface ToolHost {
  getMainWindow: () => BrowserWindow | null
  /** Tell the window that main-side data changed, so open pages reload it. */
  dataChanged: (scope: DataScope) => void
  /** Show a page (and optionally a Library run) in the window. */
  navigate: (page: AppPage, runDir?: string) => void
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** A Library run folder: a clipping job (its id) or a finished Remix run (remix-<id>). */
export const RUN_ID = /^(?:remix-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const ID_PATTERN = '^[A-Za-z0-9_-]{1,64}$'

export const runIdProperty = { type: 'string', description: 'A Library run id: the runId from list_library_runs, or a jobId (they are the same).', pattern: RUN_ID.source }
export const clipIndexProperty = { type: 'integer', minimum: 0, maximum: 999, description: 'clipIndex from get_library_run.' }

export function object(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false }
}

export function seconds(ms: number | null | undefined): number | null {
  return typeof ms === 'number' && Number.isFinite(ms) ? Math.round(ms / 100) / 10 : null
}

export function libraryPath(runId: unknown): string {
  if (typeof runId !== 'string' || !RUN_ID.test(runId)) throw new AssistantToolError('runId must be a run id from list_library_runs.')
  return join(loadSettings().outputDirectory, runId)
}

/** Source shown to the agent: links as-is, local files by name only. */
export function sourceLabel(source: string): string {
  return isWebUrl(source) ? source : basename(source)
}

export async function runOutput(runId: unknown): Promise<{ path: string; output: JobOutput }> {
  const path = libraryPath(runId)
  const output = await getJobOutput(path, loadSettings().outputDirectory)
  if (!output) throw new AssistantToolError('That run has no finished clips in the Library (it may have failed, been deleted, or still be running).')
  return { path, output }
}

export function clipFile(clip: JobOutput['clips'][number]): string {
  return clip.s3_url.startsWith('file://') ? clip.s3_url.slice('file://'.length) : clip.s3_url
}

/** A main-module error as a message the agent can act on (they're written for the member). */
export function toolError(error: unknown): AssistantToolError {
  if (error instanceof AssistantToolError) return error
  const message = error instanceof Error && error.message ? error.message : 'That didn’t work. Try again.'
  // Never pass on local paths from system errors.
  return new AssistantToolError(/(?:^|[\s'"(])(?:\/(?:Users|home|var|private|tmp|Volumes)\/|[A-Za-z]:\\)/.test(message) ? 'That didn’t work because of a file problem. Check the output folder in Settings and try again.' : message)
}

/** Wait until `done()` is true, polling (the status listeners in main have one subscriber: the window). */
export async function pollUntil(done: () => boolean, timeoutMs: number, signal: AbortSignal | undefined, intervalMs = 1000): Promise<void> {
  const end = Date.now() + timeoutMs
  while (!done() && Date.now() < end && !signal?.aborted) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(finish, Math.min(intervalMs, Math.max(0, end - Date.now())))
      function finish(): void { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve() }
      signal?.addEventListener('abort', finish, { once: true })
    })
  }
}
