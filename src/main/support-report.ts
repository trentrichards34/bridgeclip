import { app, clipboard, shell } from 'electron'
import { closeSync, fstatSync, openSync, readSync } from 'fs'
import { arch, homedir, release } from 'os'
import { getLogFilePath, logger } from './logger'
import { loadSettings, publicSettings } from './settings-store'
import { listJobs } from './job-manager'
import { effectiveSupportTarget } from '../shared/member-prefs'
import { readMemberPrefs } from './member-prefs'

/**
 * "Copy support report": plain text a member pastes into their support chat.
 * It says which keys are saved (yes or no), never the keys, and every line it
 * copies from the log or an error message is redacted first.
 */

export interface ToolCheckSummary {
  python?: boolean
  pythonDeps?: boolean
  pythonError?: string | null
  ffmpeg?: boolean
  ffmpegCaptions?: boolean
  ffprobe?: boolean
  ytdlp?: boolean
  engine?: boolean
  bridgeRunner?: boolean
}

let lastToolCheck: { at: string; result: ToolCheckSummary } | null = null
/** Remember the latest Settings → System check for the report. */
export function recordToolCheck(result: ToolCheckSummary): void {
  lastToolCheck = { at: new Date().toISOString(), result: { ...result } }
}

export interface FailureSummary { what: string; message: string | null; code?: string | null; stage?: string | null; httpStatus?: number | null; at?: string | null }

export interface ReportInput {
  version: string
  platform: string
  osRelease: string
  arch: string
  electron: string
  toolCheck: { at: string; result: ToolCheckSummary } | null
  settings: Record<string, string | boolean>
  failure: FailureSummary | null
  logLines: string[]
}

export interface RedactOptions { secrets?: string[]; home?: string; userData?: string }

/** Remove keys, tokens, emails and the member's home folder from text that goes into the report. */
export function redact(text: string, { secrets = [], home = '', userData = '' }: RedactOptions = {}): string {
  let out = text
  for (const secret of secrets.filter((value) => value && value.length >= 6).sort((a, b) => b.length - a.length)) out = out.split(secret).join('[key removed]')
  for (const dir of [userData, home].filter((value) => value && value.length > 1)) {
    out = out.split(dir).join(dir === home ? '~' : '<app data>')
    // Windows paths may appear with forward slashes too.
    if (dir.includes('\\')) out = out.split(dir.replace(/\\/g, '/')).join(dir === home ? '~' : '<app data>')
  }
  return out
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [removed]')
    .replace(/\b(sk|pk|rk)[-_](?:or[-_])?(?:v\d[-_])?[A-Za-z0-9_-]{8,}/g, '[key removed]')
    .replace(/\b((?:api[_-]?key|token|secret|password|authorization|auth|key|access[_-]?token)["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, '$1[removed]')
    .replace(/([?&](?:key|token|sig|signature|api_key|access_token)=)[^&\s"']+/gi, '$1[removed]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email removed]')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[removed]')
    .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, '[removed]')
    .replace(/(\/(?:Users|home)\/)[^/\s"']+/g, '$1~')
    .replace(/([A-Za-z]:\\Users\\)[^\\\s"']+/g, '$1~')
}

const yesNo = (value: unknown): string => value === true ? 'yes' : value === false ? 'no' : 'not checked'

export function buildSupportReport(input: ReportInput, options: RedactOptions = {}): string {
  const lines: string[] = []
  lines.push('CreatorClips support report', `Created: ${new Date().toISOString()}`, '')
  lines.push(`App version: ${input.version}`, `System: ${input.platform} ${input.osRelease} (${input.arch}) · Electron ${input.electron}`, '')
  lines.push('System check:')
  if (!input.toolCheck) lines.push('  Not run yet in this session (Settings → System check → Re-check).')
  else {
    const r = input.toolCheck.result
    const rows: [string, unknown][] = [['Python', r.python], ['Clipping dependencies', r.pythonDeps], ['FFmpeg', r.ffmpeg], ['FFmpeg captions', r.ffmpegCaptions],
      ['FFprobe', r.ffprobe], ['yt-dlp', r.ytdlp], ['Clipping engine', r.engine], ['Video engine', r.bridgeRunner]]
    lines.push(`  Checked: ${input.toolCheck.at}`)
    for (const [name, ok] of rows) lines.push(`  ${name}: ${ok === true ? 'found' : ok === false ? 'missing' : 'not checked'}`)
    if (r.pythonDeps === false && r.pythonError) lines.push(`  Dependencies problem: ${redact(String(r.pythonError).slice(0, 300), options)}`)
  }
  lines.push('', 'Settings:')
  for (const [name, value] of Object.entries(input.settings)) lines.push(`  ${name}: ${typeof value === 'boolean' ? yesNo(value) : redact(value, options)}`)
  lines.push('', 'Last failed job:')
  if (!input.failure) lines.push('  None in this session.')
  else {
    const f = input.failure
    lines.push(`  What: ${f.what}`)
    if (f.at) lines.push(`  When: ${f.at}`)
    lines.push(`  Error: ${f.message ? redact(f.message.slice(0, 1500), options) : 'No error message'}`)
    if (f.code) lines.push(`  Code: ${redact(f.code, options)}${f.stage ? ` · stage ${redact(f.stage, options)}` : ''}${f.httpStatus ? ` · HTTP ${f.httpStatus}` : ''}`)
  }
  lines.push('', `Recent log (last ${input.logLines.length} lines):`)
  if (!input.logLines.length) lines.push('  The log is empty.')
  for (const line of input.logLines) lines.push(redact(line.slice(0, 600), options))
  return lines.join('\n')
}

/** The last `count` lines of a file, reading at most the last 256 KB. */
export function tailLines(path: string, count = 80): string[] {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const size = fstatSync(fd).size
    const length = Math.min(size, 256 * 1024)
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, size - length)
    const lines = buffer.toString('utf8').split(/\r?\n/).filter(Boolean)
    // The first line may be cut in half when the read started mid-file.
    if (length < size) lines.shift()
    return lines.slice(-count)
  } catch { return [] } finally { if (fd !== undefined) closeSync(fd) }
}

/** Other long jobs that can fail (Remix and the other tools), reported by the IPC layer. */
export type FailureSource = () => FailureSummary | null

export function collectSupportReport(jobId: unknown, extraFailures: FailureSource[] = []): string {
  const settings = loadSettings()
  const visible = publicSettings(settings)
  const jobs = listJobs()
  const failed = (typeof jobId === 'string' ? jobs.find((job) => job.id === jobId && job.status === 'failed') : undefined) ??
    jobs.filter((job) => job.status === 'failed').sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))[0]
  const jobFailure: FailureSummary | null = failed ? {
    what: `Clip (${failed.request.workflow === 'review' ? 'Review & edit' : 'Automatic'})`, message: failed.error, code: failed.failureCode, stage: failed.failureStage,
    httpStatus: failed.httpStatus, at: failed.finishedAt
  } : null
  const others = extraFailures.map((source) => { try { return source() } catch { return null } }).filter((item): item is FailureSummary => item !== null)
  const failure = typeof jobId === 'string' && jobFailure ? jobFailure
    : [jobFailure, ...others].filter((item): item is FailureSummary => item !== null).sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))[0] ?? null
  const prefs = readMemberPrefs()
  const input: ReportInput = {
    version: app.getVersion(), platform: process.platform, osRelease: release(), arch: arch(), electron: process.versions.electron ?? '',
    toolCheck: lastToolCheck,
    settings: {
      'OpenRouter key saved': visible.openrouterConfigured,
      'Zernio key saved': visible.zernioConfigured,
      'Pexels key saved': visible.pexelsConfigured,
      'fal.ai key saved': visible.falConfigured,
      'HeyGen key saved': visible.heygenConfigured === true,
      'Jev review': visible.jevEnabled === 'on',
      'Source research': visible.sourceContextWebResearch === 'on',
      'Browser login for social links': visible.downloadLoginBrowser || 'none',
      'Output folder': visible.outputDirectory,
      'Notifications': prefs.notifyOnFinish
    },
    failure,
    logLines: tailLines(getLogFilePath(), 80)
  }
  const secrets = [settings.openrouterApiKey, settings.zernioApiKey, settings.pexelsApiKey, settings.falApiKey, settings.heygenApiKey].filter((value): value is string => typeof value === 'string')
  let userData = ''
  try { userData = app.getPath('userData') } catch { /* not available */ }
  return buildSupportReport(input, { secrets, home: homedir(), userData })
}

/** Copy the report; then open the member's support link or email, or the public issues page when none is set. */
export async function reportIssue(jobId: unknown, open: boolean, extraFailures: FailureSource[] = []): Promise<{ copied: true; opened: 'email' | 'link' | null }> {
  clipboard.writeText(collectSupportReport(jobId, extraFailures))
  logger.info('support.report.copied', { open })
  if (!open) return { copied: true, opened: null }
  const target = effectiveSupportTarget(readMemberPrefs().supportLink)
  await shell.openExternal(target.url)
  return { copied: true, opened: target.kind }
}
