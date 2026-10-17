import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Workflow } from 'lucide-react'
import { cn } from '../lib/utils'
import type { Automation, UpcomingState } from '../../shared/automations'
import type { PostRecord, PostStatus } from '../../shared/zernio-posts'
import { calendarItems, calendarRange, dayKey, formatCalendarTime, shiftAnchor, type CalendarItem, type CalendarView } from '../../shared/zernio-calendar'
import { PlatformIcon, platformName } from './PlatformIcon'
import { Button } from './ui/Button'
import { Segmented } from './ui/Segmented'
import { Panel } from './ui/Panel'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** Month cells show this many items, then "+N more" opens the day below. */
const MONTH_CELL_ITEMS = 3

const POST_STATUS: Record<PostStatus, { label: string; tone: string }> = {
  scheduled: { label: 'Scheduled', tone: 'text-accent' },
  publishing: { label: 'Publishing', tone: 'text-accent' },
  published: { label: 'Posted', tone: 'text-success' },
  partial: { label: 'Partly posted', tone: 'text-warning' },
  failed: { label: 'Failed', tone: 'text-danger' },
  cancelled: { label: 'Cancelled', tone: 'text-ink-subtle' },
  missing: { label: 'Missing', tone: 'text-ink-subtle' },
  draft: { label: 'Draft', tone: 'text-ink-subtle' }
}

const SLOT_STATE: Record<UpcomingState, { label: string; tone: string }> = {
  zernio: { label: 'Scheduled with Zernio', tone: 'text-accent' },
  cancelling: { label: 'Cancelling', tone: 'text-warning' },
  app: { label: 'Posts while the app is open', tone: 'text-ink-muted' },
  skipped: { label: 'Skipped', tone: 'text-ink-subtle' },
  uncertain: { label: 'Held for review', tone: 'text-warning' },
  empty: { label: 'No clip ready', tone: 'text-warning' }
}

function itemStatus(item: CalendarItem): { label: string; tone: string } {
  return item.kind === 'post' ? POST_STATUS[item.status] : SLOT_STATE[item.state]
}

function itemTitle(item: CalendarItem): string {
  return item.kind === 'post' ? item.title : item.title ?? item.automationName
}

function itemLabel(item: CalendarItem, timeZone: string): string {
  const where = item.platforms.map(platformName).join(', ')
  const what = item.kind === 'post' ? item.title : `${item.automationName} automation${item.title ? `: ${item.title}` : ''}`
  return `${formatCalendarTime(item.at, timeZone)}, ${what}, ${where}, ${itemStatus(item).label}`
}

export function PostCalendar({ posts, automations, timeZone, now, onOpenPost, onOpenAutomation }: {
  posts: PostRecord[]
  automations: Automation[]
  /** The member's time zone; every day and time shows in it. */
  timeZone: string
  now: number
  onOpenPost: (post: PostRecord) => void
  onOpenAutomation: (automationId: string) => void
}): React.JSX.Element {
  const [view, setView] = useState<CalendarView>(() => {
    try { return sessionStorage.getItem('bridgeclip.posts.calendarView') === 'month' ? 'month' : 'week' } catch { return 'week' }
  })
  const [anchor, setAnchor] = useState(now)
  const [selectedDay, setSelectedDay] = useState(() => dayKey(now, timeZone))
  const range = useMemo(() => calendarRange(view, anchor, now, timeZone), [view, anchor, now, timeZone])
  const byDay = useMemo(() => calendarItems({ posts, automations, start: range.start, end: range.end, now, timeZone }), [posts, automations, range, now, timeZone])
  const zone = useMemo(() => {
    try { return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'long' }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? timeZone } catch { return timeZone }
  }, [timeZone, now])

  const changeView = (next: CalendarView): void => {
    setView(next)
    try { sessionStorage.setItem('bridgeclip.posts.calendarView', next) } catch { /* Remembering the view is a convenience. */ }
  }
  const move = (steps: number): void => setAnchor((current) => shiftAnchor(current, view, steps, timeZone))
  const open = (item: CalendarItem): void => {
    if (item.kind === 'post') onOpenPost(item.post)
    else onOpenAutomation(item.automationId)
  }
  const selected = range.days.find((day) => day.date === selectedDay)
  const selectedItems = selected ? byDay.get(selected.date) ?? [] : []
  const empty = range.days.every((day) => !byDay.get(day.date)?.length)

  return (
    <Panel padded={false} className="overflow-hidden" aria-label="Post calendar">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <Button size="sm" variant="ghost" iconOnly aria-label={view === 'week' ? 'Previous week' : 'Previous month'} onClick={() => move(-1)} icon={<ChevronLeft className="h-3.5 w-3.5" />} />
        <Button size="sm" variant="ghost" onClick={() => { setAnchor(now); setSelectedDay(dayKey(now, timeZone)) }}>Today</Button>
        <Button size="sm" variant="ghost" iconOnly aria-label={view === 'week' ? 'Next week' : 'Next month'} onClick={() => move(1)} icon={<ChevronRight className="h-3.5 w-3.5" />} />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" aria-live="polite">{range.title}</h2>
        <Segmented<CalendarView> size="sm" label="Calendar view" value={view} onChange={changeView} options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
      </div>

      <div className="grid grid-cols-7 border-b border-white/[0.06]" aria-hidden>
        {WEEKDAYS.map((name) => <div key={name} className="px-2 py-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">{name}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {range.days.map((day) => {
          const items = byDay.get(day.date) ?? []
          const shown = view === 'month' ? items.slice(0, MONTH_CELL_ITEMS) : items
          const dayNumber = Number(day.date.slice(8))
          return (
            <div
              key={day.date}
              role="group"
              aria-label={new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric' }).format(day.start + 12 * 3_600_000)}
              className={cn(
                'min-w-0 border-b border-r border-white/[0.05] p-1 [&:nth-child(7n)]:border-r-0',
                view === 'week' ? 'min-h-[180px]' : 'min-h-[92px]',
                !day.inMonth && 'bg-black/20',
                day.date === selectedDay && 'bg-accent/[0.06]'
              )}
            >
              <button
                type="button"
                onClick={() => setSelectedDay(day.date)}
                aria-label={`Show ${new Intl.DateTimeFormat('en-US', { timeZone, month: 'long', day: 'numeric' }).format(day.start + 12 * 3_600_000)}`}
                className={cn(
                  'mb-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-mono text-2xs tabular transition-colors',
                  day.today ? 'bg-accent text-accent-ink' : day.inMonth ? 'text-ink-muted hover:bg-white/[0.08]' : 'text-ink-subtle hover:bg-white/[0.06]'
                )}
              >
                {dayNumber}
              </button>
              <ul className="space-y-0.5">
                {shown.map((item) => <li key={item.key}><CalendarChip item={item} timeZone={timeZone} compact={view === 'month'} onOpen={() => open(item)} /></li>)}
              </ul>
              {items.length > shown.length && (
                <button type="button" onClick={() => setSelectedDay(day.date)} className="mt-0.5 px-1 text-2xs text-ink-muted hover:text-ink">
                  +{items.length - shown.length} more
                </button>
              )}
            </div>
          )
        })}
      </div>

      <section aria-label="Selected day" className="px-4 py-3">
        {selected ? (
          <>
            <h3 className="eyebrow">{new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric' }).format(selected.start + 12 * 3_600_000)}</h3>
            {selectedItems.length === 0 ? (
              <p className="mt-1.5 text-xs text-ink-subtle">Nothing posted or scheduled this day.</p>
            ) : (
              <ul className="mt-1.5 divide-y divide-white/[0.05]">
                {selectedItems.map((item) => (
                  <li key={item.key}>
                    <button type="button" onClick={() => open(item)} aria-label={`Open ${itemLabel(item, timeZone)}`} className="flex w-full items-center gap-3 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-white/[0.04]">
                      <span className="w-16 shrink-0 font-mono text-2xs tabular text-ink">{formatCalendarTime(item.at, timeZone)}</span>
                      <span className="flex shrink-0 items-center gap-0.5">{item.platforms.map((p) => <PlatformIcon key={p} platform={p} className="h-5 w-5 rounded-md [&_svg]:h-3 [&_svg]:w-3" />)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink">{itemTitle(item)}</span>
                        {(item.kind === 'slot' || item.automationName) && (
                          <span className="flex items-center gap-1 text-2xs text-ink-subtle"><Workflow aria-hidden className="h-3 w-3" />{item.automationName} automation</span>
                        )}
                      </span>
                      <span className={cn('shrink-0 text-2xs', itemStatus(item).tone)}>{itemStatus(item).label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-xs text-ink-subtle">Choose a day to see everything on it.</p>
        )}
        <p className="mt-2 text-2xs text-ink-subtle">
          {empty ? 'Nothing in this range. ' : ''}Times are in your time zone ({zone}). Automation slots show what each automation will post next; open one to change it.
        </p>
      </section>
    </Panel>
  )
}

function CalendarChip({ item, timeZone, compact, onOpen }: { item: CalendarItem; timeZone: string; compact: boolean; onOpen: () => void }): React.JSX.Element {
  const status = itemStatus(item)
  const slot = item.kind === 'slot'
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${itemLabel(item, timeZone)}`}
      title={`${itemTitle(item)} · ${status.label}`}
      className={cn(
        'flex w-full min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left text-2xs transition-colors',
        slot ? 'border border-dashed border-white/[0.14] hover:bg-white/[0.05]' : 'bg-white/[0.05] hover:bg-white/[0.09]'
      )}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full bg-current', status.tone)} aria-hidden />
      <span className="shrink-0 font-mono tabular text-ink-muted">{formatCalendarTime(item.at, timeZone).replace(/:00(?= )/, '').replace(' ', '').toLowerCase()}</span>
      {!compact && <span className="flex shrink-0 items-center">{item.platforms.slice(0, 3).map((p) => <PlatformIcon key={p} platform={p} variant="glyph" className="[&_svg]:h-2.5 [&_svg]:w-2.5" />)}</span>}
      <span className="min-w-0 flex-1 truncate text-ink">{itemTitle(item)}</span>
    </button>
  )
}
