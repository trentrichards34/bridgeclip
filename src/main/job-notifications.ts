import { BrowserWindow, Notification } from 'electron'
import type { JobSnapshot } from '../shared/jobs'
import type { RemixStatus } from '../shared/remix'
import type { AvatarRenderStatus } from '../shared/avatars'
import { logger } from './logger'
import { readMemberPrefs } from './member-prefs'

/**
 * A desktop notification when a long job finishes while the member is in
 * another app. Clicking it brings CreatorClips back on the relevant page.
 */

export type NoticePage = 'library' | 'jobs' | 'remix' | 'avatar'
export interface JobNotice { key: string; title: string; body: string; page: NoticePage; runDir?: string; jobId?: string }

export function shouldNotify({ enabled, focused, supported }: { enabled: boolean; focused: boolean; supported: boolean }): boolean {
  return enabled && supported && !focused
}

const short = (text: string, max = 60): string => text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

/** A Create run that just finished (completed or failed; never a cancel). */
export function createNotice(job: JobSnapshot): JobNotice | null {
  const review = job.request.workflow === 'review'
  if (job.status === 'completed') {
    const title = job.output?.source_video_title ? `“${short(job.output.source_video_title)}”` : 'your video'
    return {
      key: `job:${job.id}`, page: 'library', runDir: job.outputDir,
      title: review ? 'Your clips are ready to edit' : 'Your clips are ready',
      body: review ? `The candidates from ${title} are ready in the editor.` : `${plural(job.output?.total_clips ?? 0, 'clip', 'clips')} from ${title}.`
    }
  }
  if (job.status === 'failed') {
    return { key: `job:${job.id}`, page: 'jobs', jobId: job.id, title: 'Clipping failed', body: 'Open CreatorClips to see what went wrong and run it again.' }
  }
  return null
}

/** A Remix run that reached review, finished or failed (only once per phase). */
export function remixNotice(status: RemixStatus): JobNotice | null {
  if (status.phase === 'review') {
    if (status.drafts.some((draft) => draft.format === 'moment_take')) {
      return { key: `remix:${status.id}:review`, page: 'remix', title: 'Your moments are ready', body: `${plural(status.drafts.length, 'moment', 'moments')} found. Record your take on each.` }
    }
    const one = status.drafts.length === 1 && (status.drafts[0].format === 'image' || status.drafts[0].format === 'pause_react')
    return { key: `remix:${status.id}:review`, page: 'remix', title: one ? 'Ready for your take' : 'Your takes are ready to review',
      body: !one ? `${plural(status.drafts.length, 'take', 'takes')} to review before anything is made.`
        : status.drafts[0].format === 'pause_react' ? 'Their video is ready. Record your reaction.' : 'Record yourself talking about the screenshot.' }
  }
  if (status.phase === 'done') {
    return { key: `remix:${status.id}:done`, page: 'remix', title: 'Your remixes are ready', body: `${plural(status.outputs.length, 'video', 'videos')} made. They’re in your Library too.` }
  }
  if (status.phase === 'failed') {
    return { key: `remix:${status.id}:failed`, page: 'remix', title: 'Remix failed', body: 'Open CreatorClips to see what went wrong.' }
  }
  return null
}

export function avatarNotice(status: AvatarRenderStatus): JobNotice | null {
  if (status.phase === 'done') return { key: `avatar:${status.id}:done`, page: 'avatar', title: 'Your avatar video is ready', body: 'Open Avatar Studio to watch it.' }
  if (status.phase === 'failed') return { key: `avatar:${status.id}:failed`, page: 'avatar', title: 'Avatar video failed', body: 'Open Avatar Studio to see what went wrong.' }
  return null
}

/**
 * Remembers what was already announced, so a status sent again (the window
 * reloading, a later update) doesn't notify twice. A Remix "done" right after
 * its review needs a new key, which remixNotice gives it.
 */
export class NoticeTracker {
  private seen = new Set<string>()
  private order: string[] = []
  /** True the first time a notice key is seen. */
  first(key: string): boolean {
    if (this.seen.has(key)) return false
    this.seen.add(key)
    this.order.push(key)
    if (this.order.length > 500) this.seen.delete(this.order.shift() as string)
    return true
  }
}

const tracker = new NoticeTracker()
/** The notifications on screen, so they aren't garbage-collected before a click. */
const live = new Set<Notification>()

export function announce(notice: JobNotice | null, getWindow: () => BrowserWindow | null): void {
  if (!notice || !tracker.first(notice.key)) return
  const window = getWindow()
  let enabled = true
  try { enabled = readMemberPrefs().notifyOnFinish } catch { /* defaults to on */ }
  const focused = Boolean(window && !window.isDestroyed() && window.isFocused())
  // Scripted test runs never show system notifications.
  const supported = process.env.BRIDGECLIP_E2E !== '1' && Notification.isSupported()
  if (!shouldNotify({ enabled, focused, supported })) return
  try {
    const notification = new Notification({ title: notice.title, body: notice.body })
    live.add(notification)
    const forget = (): void => { live.delete(notification) }
    notification.on('close', forget)
    notification.on('click', () => {
      forget()
      const target = getWindow()
      if (!target || target.isDestroyed()) return
      if (target.isMinimized()) target.restore()
      target.show()
      target.focus()
      if (!target.webContents.isDestroyed()) target.webContents.send('app:openPage', { page: notice.page, runDir: notice.runDir ?? null, jobId: notice.jobId ?? null })
    })
    notification.show()
  } catch {
    logger.warn('notifications.show_failed', { page: notice.page })
  }
}
