import { useEffect, useId, useMemo, useState } from 'react'
import { ArrowUpRight, BarChart3, CalendarClock, Clapperboard, RefreshCw, RotateCcw, Send, X } from 'lucide-react'
import { getApi } from '../lib/ipc'
import type { Automation } from '../../shared/automations'
import { PostCalendar } from '../components/PostCalendar'
import { Segmented } from '../components/ui/Segmented'
import { Dialog } from '../components/ui/Dialog'
import { AUTOMATION_SELECTED_KEY } from './AutomationsPage'
import { cn, formatRelativeDate, localFileUrl } from '../lib/utils'
import { loadThumbnail } from '../lib/thumbnails'
import { usePostsStore } from '../store/use-posts-store'
import { useSettingsStore } from '../store/use-settings-store'
import { formatCount, scheduleError, scheduleWindow, statsLine, type PostRecord } from '../../shared/zernio-posts'
import { MIN_INSIGHT_POSTS, type PostInsights } from '../../shared/post-insights'
import { PlatformIcon, platformName } from '../components/PlatformIcon'
import { formatScheduled, targetBadge } from '../components/PostDialog'
import { Page as PageColumn } from '../components/ui/Page'
import { PageHeader } from '../components/ui/PageHeader'
import { Panel, PanelHeader } from '../components/ui/Panel'
import { Button } from '../components/ui/Button'
import { Callout } from '../components/ui/Callout'
import { EmptyState } from '../components/ui/EmptyState'
import { WELL } from '../components/ui/Field'
import type { Page } from '../components/Sidebar'

const TITLE = 'Posts'
/** Statuses only change on Zernio's side; the main process decides which posts are worth a request. */
const POLL_MS = 30_000
const RECENT_LIMIT = 10
/** List or calendar, kept for the session (Automations links here with the calendar open). */
export const POSTS_VIEW_KEY = 'bridgeclip.posts.view'
type PostsView = 'list' | 'calendar'

function memberTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function toLocalInput(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function whenText(post: PostRecord): string {
  switch (post.status) {
    case 'scheduled':
      return post.scheduledFor ? `Scheduled for ${formatScheduled(post.scheduledFor, post.timezone)}` : 'Scheduled'
    case 'publishing':
      return 'Publishing…'
    case 'published':
      return `Posted ${formatRelativeDate(post.createdAt)}`
    case 'partial':
      return `Partly posted ${formatRelativeDate(post.createdAt)}`
    case 'failed':
      return `Failed ${formatRelativeDate(post.createdAt)}`
    case 'cancelled':
      return `Canceled · created ${formatRelativeDate(post.createdAt)}`
    case 'missing':
      return 'No longer in your Zernio workspace'
    default:
      return `Saved as a draft in Zernio ${formatRelativeDate(post.createdAt)}`
  }
}

export function PostsPage({ onNavigate }: { onNavigate: (page: Page) => void }): React.JSX.Element {
  const configured = useSettingsStore((s) => s.zernioConfigured)
  return (
    <PageColumn width="narrow">
      {configured ? (
        <PostsList onNavigate={onNavigate} />
      ) : (
        <>
          <PageHeader title={TITLE} />
          <EmptyState
            className="mt-4"
            icon={<Send />}
            title="Connect your social accounts"
            description="Clips you post or schedule from CreatorClips show up here once Zernio is set up in Accounts."
            action={<Button variant="primary" onClick={() => onNavigate('accounts')}>Open Accounts</Button>}
          />
        </>
      )}
    </PageColumn>
  )
}

/** Posts made from CreatorClips: scheduled, failed and recent, with cancel, retry and links. */
function PostsList({ onNavigate }: { onNavigate: (page: Page) => void }): React.JSX.Element {
  const { posts, loaded, refreshing, error, clearError, refresh, refreshStats, statsRefreshing, statsError, insights } = usePostsStore()
  const [showAll, setShowAll] = useState(false)
  const [view, setView] = useState<PostsView>(() => {
    try { return sessionStorage.getItem(POSTS_VIEW_KEY) === 'calendar' ? 'calendar' : 'list' } catch { return 'list' }
  })
  const [automations, setAutomations] = useState<Automation[]>([])
  const [automationsError, setAutomationsError] = useState<string | null>(null)
  const [openPostId, setOpenPostId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const changeView = (next: PostsView): void => {
    setView(next)
    try { sessionStorage.setItem(POSTS_VIEW_KEY, next) } catch { /* Remembering the view is a convenience. */ }
  }

  // The calendar shows automation slots too; they change with the clock and the queues.
  useEffect(() => {
    if (view !== 'calendar') return
    let active = true
    const load = (): void => {
      setNow(Date.now())
      getApi().automations.list()
        .then((list) => { if (active) { setAutomations(list); setAutomationsError(null) } })
        .catch(() => { if (active) setAutomationsError('Automation slots couldn’t be loaded. Posts still show.') })
    }
    load()
    const timer = setInterval(load, 60_000)
    return () => { active = false; clearInterval(timer) }
  }, [view])

  const openAutomation = (id: string): void => {
    try { sessionStorage.setItem(AUTOMATION_SELECTED_KEY, id) } catch { /* The page then opens on its first automation. */ }
    onNavigate('automations')
  }
  const openPost = openPostId ? posts.find((post) => post.id === openPostId) ?? null : null

  useEffect(() => {
    // Stats come after statuses; main spaces out the requests and skips posts asked about recently.
    void usePostsStore.getState().load()
      .then(() => usePostsStore.getState().refresh(false))
      .then(() => usePostsStore.getState().refreshStats(false))
    void usePostsStore.getState().loadInsights()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void usePostsStore.getState().refresh(false).then(() => usePostsStore.getState().refreshStats(false))
    }, POLL_MS)
    const onFocus = (): void => void usePostsStore.getState().refresh(false)
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  const groups = useMemo(() => {
    const scheduled = posts.filter((p) => p.status === 'scheduled').sort((a, b) => (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? ''))
    const attention = posts.filter((p) => p.status === 'failed' || p.status === 'partial' || p.status === 'missing')
    const recent = posts.filter((p) => !scheduled.includes(p) && !attention.includes(p))
    return { scheduled, attention, recent }
  }, [posts])
  const recent = showAll ? groups.recent : groups.recent.slice(0, RECENT_LIMIT)

  return (
    <>
      <PageHeader
        title={TITLE}
        className="items-center"
        actions={
          <div className="flex items-center gap-2">
          <Segmented<PostsView> size="sm" label="Posts view" value={view} onChange={changeView} options={[{ value: 'list', label: 'List' }, { value: 'calendar', label: 'Calendar' }]} />
          <Button
            variant="ghost"
            iconOnly
            aria-label="Refresh posts"
            title="Refresh"
            onClick={() => void refresh(true).then(() => refreshStats(true))}
            disabled={refreshing || statsRefreshing}
            icon={<RefreshCw className={cn('h-3.5 w-3.5', (refreshing || statsRefreshing) && 'animate-spin')} />}
          />
          </div>
        }
      />

      <div className="mt-4 space-y-3">
        {error && (
          <Callout tone="danger" onDismiss={clearError}>
            {error}
          </Callout>
        )}
        {!error && statsError && (
          <Callout tone="warning" onDismiss={clearError}>
            {statsError}
          </Callout>
        )}

        {!loaded ? (
          <Panel padded={false}>
            <p role="status" className="px-4 py-3 text-xs text-ink-muted">Loading your posts…</p>
          </Panel>
        ) : posts.length === 0 && error ? (
          <Panel padded={false} className="flex items-center justify-between gap-3 py-2 pl-4 pr-2.5">
            <p className="text-xs text-ink-muted">Your post history is unavailable right now.</p>
            <Button size="sm" onClick={() => void usePostsStore.getState().load()}>Try again</Button>
          </Panel>
        ) : view === 'calendar' ? (
          <>
            {automationsError && <Callout tone="warning" onDismiss={() => setAutomationsError(null)}>{automationsError}</Callout>}
            <PostCalendar posts={posts} automations={automations} timeZone={memberTimeZone()} now={now} onOpenPost={(post) => setOpenPostId(post.id)} onOpenAutomation={openAutomation} />
          </>
        ) : posts.length === 0 ? (
          <EmptyState
            icon={<Send />}
            title="Nothing posted yet"
            description="Open a run in the Library and choose Post on a clip. Scheduled posts wait here until they go out."
            action={
              <Button icon={<Clapperboard className="h-3.5 w-3.5" />} onClick={() => onNavigate('library')}>
                Open Library
              </Button>
            }
          />
        ) : (
          <>
          {insights && <WhatsWorking insights={insights} />}
          <Panel padded={false} className="overflow-hidden">
            <PostGroup title="Scheduled" posts={groups.scheduled} />
            <PostGroup title="Needs attention" posts={groups.attention} />
            <PostGroup title="Recent" posts={recent} />
            {groups.recent.length > RECENT_LIMIT && (
              <div className="border-t border-white/[0.06] px-2.5 py-1.5">
                <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Show fewer' : `Show all ${groups.recent.length}`}
                </Button>
              </div>
            )}
          </Panel>
          </>
        )}

        {openPost && <PostDetail post={openPost} onClose={() => setOpenPostId(null)} />}
        <p className="px-1 text-2xs text-ink-subtle">Zernio publishes scheduled posts even when CreatorClips is closed. Views and likes come from Zernio, which collects them from each platform from time to time.</p>
      </div>
    </>
  )
}

/** One post from the calendar, with the same actions as the list (reschedule, cancel, retry, links). */
function PostDetail({ post, onClose }: { post: PostRecord; onClose: () => void }): React.JSX.Element {
  const titleId = useId()
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  return (
    <Dialog aria-labelledby={titleId} onBackdropMouseDown={onClose} panelClassName="max-w-[620px]">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
        <h2 id={titleId} className="text-sm font-semibold text-ink">Post</h2>
        <Button variant="ghost" size="sm" iconOnly aria-label="Close" onClick={onClose} icon={<X className="h-4 w-4" />} />
      </div>
      <ul className="py-1">
        <PostRow post={post} />
      </ul>
    </Dialog>
  )
}

function PostGroup({ title, posts }: { title: string; posts: PostRecord[] }): React.JSX.Element | null {
  if (posts.length === 0) return null
  return (
    <section className="border-t border-white/[0.06] first:border-t-0" aria-label={title}>
      <h2 className="eyebrow flex items-center gap-2 px-4 pb-0.5 pt-2">
        {title}
        <span className="rounded-full bg-white/[0.07] px-1.5 py-px font-mono text-[10px] tabular tracking-normal text-ink-muted">{posts.length}</span>
      </h2>
      <ul className="divide-y divide-white/[0.05]">
        {posts.map((post) => <PostRow key={post.id} post={post} />)}
      </ul>
    </section>
  )
}

function PostThumb({ clipPath }: { clipPath: string }): React.JSX.Element {
  const [thumb, setThumb] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    loadThumbnail(clipPath).then((path) => { if (!cancelled) setThumb(path) })
    return () => { cancelled = true }
  }, [clipPath])
  return thumb ? (
    <img
      src={localFileUrl(thumb)}
      alt=""
      draggable={false}
      className="h-10 w-10 shrink-0 rounded-lg object-cover shadow-[0_6px_16px_-8px_rgb(0_0_0/0.7)] ring-1 ring-white/[0.12]"
    />
  ) : (
    <span aria-hidden className="glass-tile flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink-subtle">
      <Clapperboard className="h-3.5 w-3.5" />
    </span>
  )
}

function PostRow({ post }: { post: PostRecord }): React.JSX.Element {
  const busy = usePostsStore((s) => s.busy[post.id])
  const { cancel, reschedule, retry, dismiss, open } = usePostsStore.getState()
  const [confirming, setConfirming] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (editing === null) return
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [editing])

  useEffect(() => {
    if (post.status !== 'scheduled') {
      setEditing(null)
      setConfirming(false)
    }
  }, [post.status])

  const failedTargets = post.targets.filter((t) => t.error)
  const capacity = failedTargets.some((t) => t.platform === 'tiktok' && /capacity/i.test(t.error ?? ''))
  const uploadedAt = Date.parse(post.uploadedAt)
  const editingAt = editing ? new Date(editing).getTime() : NaN
  const editingProblem = editing ? scheduleError(editingAt, now, uploadedAt) : null

  const startEditing = (): void => {
    setConfirming(false)
    const currentNow = Date.now()
    setNow(currentNow)
    const current = post.scheduledFor ? Date.parse(post.scheduledFor) : currentNow + 60 * 60_000
    setEditing(toLocalInput(current))
  }

  const saveSchedule = async (): Promise<void> => {
    if (!editing || editingProblem) return
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    if (await reschedule(post.id, new Date(editingAt).toISOString(), timezone)) setEditing(null)
  }

  let actions: React.ReactNode
  if (post.status === 'scheduled') {
    actions = confirming ? (
      <>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={Boolean(busy)}>Keep</Button>
        <Button size="sm" variant="danger" loading={busy === 'cancel'} onClick={() => void cancel(post.id).then(() => setConfirming(false))}>
          Cancel post
        </Button>
      </>
    ) : (
      <>
        <Button size="sm" variant="ghost" icon={<CalendarClock className="h-3.5 w-3.5" />} onClick={startEditing} disabled={Boolean(busy) || editing !== null}>
          Reschedule
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setConfirming(true) }} disabled={Boolean(busy)}>Cancel</Button>
      </>
    )
  } else if (post.status === 'failed' || post.status === 'partial') {
    actions = (
      <>
        <Button size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} loading={busy === 'retry'} disabled={Boolean(busy) || post.automationRequeued} title={post.automationRequeued ? 'This clip was returned to its automation queue. Run it from Automations.' : undefined} onClick={() => void retry(post.id)}>
          {post.automationRequeued ? 'Returned to queue' : 'Retry'}
        </Button>
        <Button size="sm" variant="ghost" iconOnly aria-label={`Remove “${post.clipTitle}” from the list`} title="Remove from list" disabled={Boolean(busy)} onClick={() => void dismiss(post.id)} icon={<X className="h-3.5 w-3.5" />} />
      </>
    )
  } else if (post.status !== 'publishing') {
    actions = (
      <Button size="sm" variant="ghost" iconOnly aria-label={`Remove “${post.clipTitle}” from the list`} title="Remove from list" disabled={Boolean(busy)} onClick={() => void dismiss(post.id)} icon={<X className="h-3.5 w-3.5" />} />
    )
  }

  return (
    <li className="py-2 pl-4 pr-2.5 transition-colors duration-150 hover:bg-white/[0.02]">
      <div className="flex items-start gap-3">
        <PostThumb clipPath={post.clipPath} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink" title={post.clipTitle}>{post.clipTitle || 'Untitled clip'}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <p className={cn('mr-0.5 text-xs', post.status === 'failed' || post.status === 'missing' ? 'text-danger' : post.status === 'scheduled' ? 'text-accent' : 'text-ink-muted')}>
              {confirming ? <span className="text-ink">Cancel this post? Zernio won’t publish it.</span> : whenText(post)}
            </p>
            {post.targets.map((target, index) => {
              const badge = targetBadge(target, post.status)
              const chip = (
                <>
                  <PlatformIcon platform={target.platform} className="h-4 w-4 rounded-full [&_svg]:h-2.5 [&_svg]:w-2.5" />
                  <span className="max-w-[140px] truncate text-ink">{target.handle ?? platformName(target.platform)}</span>
                  <span className={cn(badge.tone === 'danger' ? 'text-danger' : badge.tone === 'accent' ? 'text-accent' : 'text-ink-subtle')}>· {badge.label}</span>
                </>
              )
              const className = 'inline-flex h-[22px] items-center gap-1.5 rounded-full bg-white/[0.05] pl-[3px] pr-2 text-2xs text-ink-muted shadow-[inset_0_0_0_1px_rgb(255_255_255/0.09),inset_0_1px_0_rgb(255_255_255/0.06)]'
              return target.url ? (
                <button
                  key={`${target.platform}:${target.accountId}`}
                  type="button"
                  onClick={() => open(post.id, index)}
                  title={`Open on ${platformName(target.platform)}`}
                  aria-label={`Open on ${platformName(target.platform)}, ${target.handle ?? 'account'}, ${badge.label}`}
                  className={cn(className, 'transition-[background,box-shadow,color] duration-150 hover:bg-white/[0.09] hover:text-ink hover:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.16),inset_0_1px_0_rgb(255_255_255/0.08)]')}
                >
                  {chip}
                  <ArrowUpRight className="h-3 w-3" />
                </button>
              ) : (
                <span key={`${target.platform}:${target.accountId}`} className={className}>{chip}</span>
              )
            })}
          </div>
          {failedTargets.map((target) => (
            <p key={`${target.platform}:${target.accountId}`} className="mt-1 text-xs text-danger" data-selectable>
              {platformName(target.platform)}: {target.error}
            </p>
          ))}
          {post.status === 'failed' && failedTargets.length === 0 && post.error && (
            <p className="mt-1.5 text-xs text-danger" data-selectable>{post.error}</p>
          )}
          {(post.status === 'published' || post.status === 'partial') && <PostStatsLine post={post} />}
          {capacity && (
            <p className="mt-1 text-xs text-ink-subtle">TikTok direct posting is busy. Retry in a few hours, or post the clip again with “Send to your TikTok inbox” on.</p>
          )}

          {editing !== null && (
            <div className="glass-tile mt-2 rounded-2xl p-2 animate-fade-in">
              <div className="flex flex-wrap items-center gap-2">
                <CalendarClock aria-hidden className="h-4 w-4 text-ink-subtle" />
                <input
                  type="datetime-local"
                  value={editing}
                  min={toLocalInput(scheduleWindow(now, uploadedAt).min)}
                  max={toLocalInput(scheduleWindow(now, uploadedAt).max)}
                  onChange={(e) => setEditing(e.target.value)}
                  aria-label="New publish date and time"
                  aria-invalid={Boolean(editingProblem)}
                  className={cn('h-[30px] rounded-full px-3 font-mono text-xs tabular text-ink [color-scheme:dark] focus:outline-none', WELL)}
                />
                <Button size="sm" variant="primary" loading={busy === 'reschedule'} disabled={Boolean(editingProblem)} onClick={() => void saveSchedule()}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={busy === 'reschedule'}>Cancel</Button>
              </div>
              {editingProblem && <p role="alert" className="mt-2 text-xs text-danger">{editingProblem}</p>}
            </div>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
    </li>
  )
}

function PostStatsLine({ post }: { post: PostRecord }): React.JSX.Element | null {
  const stats = post.stats
  if (!stats) return null
  const total = statsLine(stats.total)
  const perAccount = post.targets.length > 1 ? stats.targets.filter((target) => target.metrics) : []
  const when = `updated ${formatRelativeDate(stats.updatedAt ?? stats.fetchedAt)}`
  if (!total) {
    return (
      <p className="mt-1 text-2xs text-ink-subtle">
        {stats.syncStatus === 'pending' ? 'Zernio is still collecting stats for this post.' : stats.message ?? 'Zernio has no stats for this post yet.'}
      </p>
    )
  }
  return (
    <div className="mt-1 text-2xs text-ink-muted" aria-label="Post stats">
      <p className="flex flex-wrap items-center gap-1.5">
        <BarChart3 aria-hidden className="h-3 w-3 text-ink-subtle" />
        <span className="text-ink">{total}</span>
        <span className="text-ink-subtle">· {when}</span>
      </p>
      {perAccount.length > 1 && (
        <ul className="mt-0.5 space-y-0.5 pl-[18px] text-ink-subtle">
          {perAccount.map((target) => (
            <li key={`${target.platform}:${target.accountId}`}>{platformName(target.platform)}: {statsLine(target.metrics) ?? 'no counts yet'}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Average views by what is known about each clip. Only real stats, with counts. */
function WhatsWorking({ insights }: { insights: PostInsights }): React.JSX.Element | null {
  if (insights.posts === 0 && insights.needed > 0) return null
  return (
    <Panel aria-label="What’s working">
      <PanelHeader
        title="What’s working"
        description={insights.needed > 0
          ? `Post ${insights.needed} more clip${insights.needed === 1 ? '' : 's'} from CreatorClips to compare. This needs views for at least ${MIN_INSIGHT_POSTS} posts that are a day old or more; ${insights.posts} so far.`
          : `Average views per post, from ${insights.posts} posts at least a day old. Clips found in your Library only.`}
      />
      {insights.groups.length > 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {insights.groups.map((group) => {
            const top = Math.max(...group.rows.map((row) => row.averageViews), 1)
            return (
              <section key={group.id} aria-label={group.title} className="glass-tile rounded-2xl p-3">
                <h3 className="eyebrow">{group.title}</h3>
                <ul className="mt-2 space-y-1.5">
                  {group.rows.map((row) => (
                    <li key={row.key} className="text-xs">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-ink">{row.label}</span>
                        <span className="shrink-0 font-mono tabular text-ink">{formatCount(row.averageViews)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]"><span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round((row.averageViews / top) * 100)}%` }} /></span>
                        <span className="shrink-0 text-2xs text-ink-subtle">{row.posts} post{row.posts === 1 ? '' : 's'}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
      {insights.needed === 0 && insights.notes.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-2xs text-ink-subtle">{insights.notes.map((note) => <li key={note}>{note}</li>)}</ul>
      )}
    </Panel>
  )
}
