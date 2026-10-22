import { Activity, BookOpen, Clapperboard, Film, LayoutGrid, Link2, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, Send, Shuffle, SlidersHorizontal, Star, UserRound, Video, Zap, type LucideIcon } from 'lucide-react'
import { cn, isMac, MOD_KEY, sourceLabel } from '../lib/utils'
import { useIsWide, useSidebarExpanded, useSidebarStore } from '../store/use-sidebar-store'
import { useActiveJobs } from '../store/use-job-store'
import { useSetupState } from '../store/use-settings-store'
import { APP_NAME, APP_VERSION } from '../config/brand'
import { BridgeClipLogo } from './brand/BridgeClipLogo'
import { StatusDot } from './ui/Badge'
import { STAGE_LABELS } from './JobProgress'
import { SidebarUpdateButton } from './Updates'
import { useAssistantStore } from '../store/use-assistant-store'

export type Page = 'clip' | 'edit' | 'remix' | 'avatar' | 'library' | 'broll' | 'brollvideo' | 'brand' | 'jobs' | 'assistant' | 'accounts' | 'posts' | 'automations' | 'guides' | 'settings'

/** Each tool's colour (see `--tool-*` in globals.css). */
export type Tool = 'create' | 'edit' | 'remix' | 'avatar' | 'library' | 'jobs' | 'broll' | 'brand' | 'chat' | 'publish' | 'settings'

/** Sidebar groups: Make, Manage, Publish, then Guides and Settings. */
export type NavGroupId = 'make' | 'manage' | 'publish' | 'help'

export interface NavItem { id: Page; label: string; icon: LucideIcon; shortcut: string; group: NavGroupId; tool: Tool }

export const NAV_ITEMS: NavItem[] = [
  { id: 'clip', label: 'Create', icon: Plus, shortcut: '1', group: 'make', tool: 'create' },
  // No number is free: ⌘E (Ctrl+E) for Edit.
  { id: 'edit', label: 'Edit my recording', icon: Video, shortcut: 'E', group: 'make', tool: 'edit' },
  { id: 'remix', label: 'Remix', icon: Shuffle, shortcut: '9', group: 'make', tool: 'remix' },
  { id: 'avatar', label: 'Avatar Studio', icon: UserRound, shortcut: '8', group: 'make', tool: 'avatar' },
  // No shortcut is free: none shown.
  { id: 'brollvideo', label: 'B-roll video', icon: Clapperboard, shortcut: '', group: 'make', tool: 'broll' },
  { id: 'library', label: 'Library', icon: LayoutGrid, shortcut: '2', group: 'manage', tool: 'library' },
  { id: 'jobs', label: 'Jobs', icon: Activity, shortcut: '3', group: 'manage', tool: 'jobs' },
  { id: 'assistant', label: 'Chat', icon: MessageSquare, shortcut: '7', group: 'manage', tool: 'chat' },
  // ⌘B (Ctrl+B): no number is free.
  { id: 'broll', label: 'B-roll library', icon: Film, shortcut: 'B', group: 'manage', tool: 'broll' },
  // No shortcut is free: none shown.
  { id: 'brand', label: 'Brand look', icon: Star, shortcut: '', group: 'manage', tool: 'brand' },
  { id: 'posts', label: 'Posts', icon: Send, shortcut: '5', group: 'publish', tool: 'publish' },
  { id: 'accounts', label: 'Accounts', icon: Link2, shortcut: '4', group: 'publish', tool: 'publish' },
  { id: 'automations', label: 'Automations', icon: Zap, shortcut: '6', group: 'publish', tool: 'publish' },
  { id: 'guides', label: 'Guides', icon: BookOpen, shortcut: '0', group: 'help', tool: 'settings' },
  { id: 'settings', label: 'Settings', icon: SlidersHorizontal, shortcut: ',', group: 'help', tool: 'settings' }
]

const GROUPS: { id: NavGroupId; label: string | null }[] = [
  { id: 'make', label: 'Make' },
  { id: 'manage', label: 'Manage' },
  { id: 'publish', label: 'Publish' },
  { id: 'help', label: null }
]

/** The tool (and its colour) for a page. */
export function toolFor(page: Page): Tool {
  return NAV_ITEMS.find((item) => item.id === page)?.tool ?? 'create'
}

/** The sidebar label for a page. */
export function pageLabel(page: Page): string {
  return NAV_ITEMS.find((item) => item.id === page)?.label ?? ''
}

interface SidebarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
}

/** Shortcut that collapses and expands the sidebar (⌘\ on macOS, Ctrl+\ elsewhere). */
export const SIDEBAR_SHORTCUT_KEY = '\\'

/**
 * Full sidebar (236px), or a 72px icon rail when the user collapses it or the
 * window is narrower than 1024px. Labels stay available to screen readers and
 * as tooltips in the rail.
 */
export function Sidebar({ currentPage, onNavigate }: SidebarProps): React.JSX.Element {
  const expanded = useSidebarExpanded()
  const { ready, missingKeys, toolsOk } = useSetupState()
  const state = ready ? 'ready' : missingKeys.length > 0 ? 'setup needed' : toolsOk === false ? 'check failed' : 'checking'
  return (
    <aside
      id="sidebar"
      className={cn(
        'app-sidebar no-drag relative z-10 flex shrink-0 flex-col overflow-hidden border-r border-white/[0.06] transition-[width] duration-200 ease-out motion-reduce:transition-none',
        expanded ? 'w-[236px] px-3' : 'w-[72px] px-2.5'
      )}
    >
      {/* macOS: the traffic lights sit in this strip. */}
      <div className={cn('drag shrink-0', isMac ? 'h-8' : 'h-3')} />

      <div className={cn('flex items-center gap-2.5 pb-1.5 pt-1', expanded ? 'px-2' : 'flex-col justify-center')}>
        {expanded && <BridgeClipLogo variant="icon" alt="" className="h-7 rounded-lg" />}
        {expanded && (
          <div className="min-w-0 flex-1 whitespace-nowrap">
            <p className="font-display text-[15px] font-bold leading-5 tracking-[-0.01em] text-ink">{APP_NAME}</p>
            <p className="font-mono text-[9px] leading-3 text-ink-faint tabular">v{APP_VERSION} · {state}</p>
          </div>
        )}
        <SidebarToggle rail={!expanded} />
      </div>

      <nav className={cn('-mx-1 min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1 pb-2')} aria-label="Main">
        {GROUPS.map((group) => (
          <NavGroup key={group.id} label={group.label} expanded={expanded}>
            {NAV_ITEMS.filter((item) => item.group === group.id).map((item) => (
              <NavButton key={item.id} item={item} expanded={expanded} active={currentPage === item.id} onNavigate={onNavigate} />
            ))}
          </NavGroup>
        ))}
      </nav>

      <div className="shrink-0 space-y-1.5 pb-3 pt-2">
        {currentPage !== 'jobs' && <ActiveJobsCard expanded={expanded} onOpen={() => onNavigate('jobs')} />}
        <SidebarUpdateButton expanded={expanded} />
        <div className={cn('flex items-center gap-1', !expanded && 'justify-center')}>
          <SetupStatus expanded={expanded} onOpenSettings={() => onNavigate('settings')} />
        </div>
      </div>
    </aside>
  )
}

/**
 * Collapse/expand control. Expanded, it sits at the right of the logo row. In
 * the rail, the app icon is the control and turns into the expand icon on
 * hover or focus. Narrow windows force the rail, so there the icon is only an icon.
 */
function SidebarToggle({ rail = false }: { rail?: boolean }): React.JSX.Element {
  const wide = useIsWide()
  const expanded = useSidebarExpanded()
  const toggle = useSidebarStore((s) => s.toggle)
  if (rail && !wide) return <BridgeClipLogo variant="icon" className="h-8 rounded-lg" />
  const label = expanded ? 'Collapse sidebar' : 'Expand sidebar'
  const hint = `${label} (${MOD_KEY}${SIDEBAR_SHORTCUT_KEY})`
  if (!rail && !wide) return <span />
  return (
    <button
      onClick={toggle}
      aria-label={label}
      aria-expanded={expanded}
      aria-controls="sidebar"
      title={hint}
      className={cn(
        'group/toggle relative flex shrink-0 items-center justify-center text-ink-muted transition-colors duration-150 hover:bg-white/[0.06] hover:text-ink',
        rail ? 'h-9 w-9 rounded-[10px]' : 'h-7 w-7 rounded-lg border border-white/[0.08]'
      )}
    >
      {rail ? (
        <>
          <BridgeClipLogo variant="icon" alt="" className="h-8 rounded-lg transition-opacity duration-150 group-hover/toggle:opacity-0 group-focus-visible/toggle:opacity-0" />
          <PanelLeftOpen className="absolute h-4 w-4 opacity-0 transition-opacity duration-150 group-hover/toggle:opacity-100 group-focus-visible/toggle:opacity-100" strokeWidth={1.9} />
        </>
      ) : (
        <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.9} />
      )}
    </button>
  )
}

function NavGroup({ label, expanded, children }: { label: string | null; expanded: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      {expanded && label
        ? <p aria-hidden className="px-2.5 pb-1.5 pt-4 font-mono text-[10px] uppercase leading-3 tracking-[0.12em] text-ink-faint">{label}</p>
        : <div aria-hidden className={cn(expanded ? 'h-3' : 'mx-2.5 my-3 h-px bg-white/[0.07]')} />}
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}

function NavButton({ item, expanded, active, onNavigate }: {
  item: NavItem
  expanded: boolean
  active: boolean
  onNavigate: (page: Page) => void
}): React.JSX.Element {
  const Icon = item.icon
  const jobs = useActiveJobs()
  const running = jobs.filter((job) => job.status !== 'queued').length
  const approvals = useAssistantStore((state) => state.approvals.length)
  const badge = item.id === 'jobs' && jobs.length > 0 ? jobs.length : item.id === 'assistant' && approvals > 0 ? approvals : null
  const badgeLabel = item.id === 'assistant' ? 'waiting for approval' : 'active'
  // What the badge says in the expanded sidebar: "1 running", "2 queued", "1 waiting".
  const badgeText = item.id === 'assistant' ? `${approvals} waiting` : running > 0 ? `${running} running` : `${jobs.length} queued`
  return (
    <button
      onClick={() => onNavigate(item.id)}
      aria-current={active ? 'page' : undefined}
      aria-label={badge ? `${item.label}, ${badge} ${badgeLabel}` : item.label}
      title={expanded ? undefined : badge ? `${item.label} · ${badge} ${badgeLabel}` : item.label}
      className={cn(
        `tool-${item.tool}`,
        'group relative flex h-9 w-full shrink-0 items-center gap-2.5 rounded-[10px] text-[13px] transition-[background,color] duration-150 ease-out',
        expanded ? 'justify-start px-2.5' : 'justify-center',
        active ? 'bg-white/[0.06] font-semibold text-ink' : 'text-ink-muted hover:bg-white/[0.045] hover:text-ink'
      )}
    >
      {/* Active bar at the sidebar's edge, in the tool's colour. */}
      <span aria-hidden className={cn('absolute bottom-[9px] top-[9px] w-[3px] rounded-r-[3px] transition-colors', expanded ? '-left-3' : '-left-2.5', active ? 'bg-tool' : 'bg-transparent')} />
      <span aria-hidden className={cn(
        'flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg transition-colors',
        active ? 'bg-tool text-canvas' : 'bg-tool/[0.12] text-tool'
      )}>
        <Icon className="h-4 w-4" strokeWidth={2} />
      </span>
      {!expanded && badge && (
        <span aria-hidden className="absolute right-1 top-1 h-2 w-2 rounded-full bg-tool-library shadow-[0_0_0_2px_rgb(var(--sidebar))]" />
      )}
      {expanded && (
        <>
          <span className="flex-1 truncate text-left">{item.label}</span>
          {badge && (
            <span aria-hidden className="shrink-0 whitespace-nowrap font-mono text-[10px] tabular text-tool-library group-hover:hidden">{badgeText}</span>
          )}
          {item.shortcut && (
            <kbd className={cn('hidden shrink-0 font-mono text-[10px] text-ink-faint', 'group-hover:inline')}>
              {MOD_KEY}
              {item.shortcut}
            </kbd>
          )}
        </>
      )}
    </button>
  )
}

/**
 * The running job at a glance: its title, step and progress, and how many
 * others are waiting. Several running jobs show the first and a count.
 */
function ActiveJobsCard({ expanded, onOpen }: { expanded: boolean; onOpen: () => void }): React.JSX.Element | null {
  const jobs = useActiveJobs()
  if (jobs.length === 0) return null
  const running = jobs.filter((job) => job.status !== 'queued')
  const queued = jobs.length - running.length
  const lead = running[0] ?? jobs[0]
  const percent = Math.round(Math.max(0, Math.min(100, lead.status === 'queued' ? 0 : lead.percent)))
  const average = running.length > 0 ? Math.round(running.reduce((sum, job) => sum + job.percent, 0) / running.length) : 0
  const step = STAGE_LABELS[lead.status] ?? 'Working'
  const title = sourceLabel(lead.request.videoUrl)
  const others = [running.length > 1 ? `${running.length - 1} more running` : null, queued > 0 ? `${queued} queued` : null].filter(Boolean).join(' · ')
  const summary = jobs.length === 1 ? step : `${running.length} running${queued > 0 ? ` · ${queued} queued` : ''}`

  if (!expanded) {
    const ring = running.length > 1 ? average : percent
    return (
      <button
        onClick={onOpen}
        aria-label={`${summary}, ${ring}%. Open jobs`}
        title={`${summary} · ${ring}%`}
        className="mx-auto flex h-10 w-10 items-center justify-center rounded-full animate-fade-in"
        style={{ background: `conic-gradient(rgb(var(--accent)) ${ring * 3.6}deg, rgb(255 255 255 / 0.08) 0deg)` }}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar font-mono text-[9px] tabular text-accent">{ring}%</span>
      </button>
    )
  }

  return (
    <button
      onClick={onOpen}
      aria-label={`${summary}, ${running.length > 1 ? average : percent}%. Open jobs`}
      className="group w-full rounded-xl border border-white/[0.07] bg-surface p-3 text-left transition-colors hover:border-white/[0.14] animate-fade-in"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full bg-accent motion-safe:animate-pulse" />
        <span className="truncate text-xs font-medium text-ink" title={lead.request.videoUrl}>{title}</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
        <div className="h-full rounded-full bg-[linear-gradient(90deg,rgb(var(--tool-edit)),rgb(var(--accent)))] transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px] text-ink-subtle">
        <span className="truncate">{step}</span>
        <span className="ml-auto shrink-0 tabular text-ink-muted">{percent}%{others ? ` · ${others}` : ''}</span>
      </div>
    </button>
  )
}

function SetupStatus({ expanded, onOpenSettings }: { expanded: boolean; onOpenSettings: () => void }): React.JSX.Element {
  const { ready, missingKeys, toolsOk } = useSetupState()

  let tone: 'success' | 'warning' | 'danger' | 'idle' = 'success'
  let label = 'Ready to clip'
  // Short enough for the sidebar; the full name is in the tooltip and for screen readers.
  let fullLabel: string | null = null
  if (missingKeys.length > 0) {
    tone = 'warning'
    label = missingKeys.length > 1 ? 'Add your keys' : 'Add your key'
    fullLabel = missingKeys.length > 1 ? `Add your ${missingKeys.join(' and ')} keys` : `Add your ${missingKeys[0]} key`
  } else if (toolsOk === false) {
    tone = 'danger'
    label = 'System check failed'
  } else if (toolsOk === null) {
    tone = 'idle'
    label = 'Checking system…'
  }

  return (
    <button
      onClick={onOpenSettings}
      aria-label={fullLabel ?? label}
      title={fullLabel ?? (expanded ? undefined : label)}
      className={cn(
        'flex h-8 min-w-0 items-center gap-2 rounded-[10px] text-xs transition-colors hover:bg-white/[0.05]',
        expanded ? 'flex-1 justify-start px-2.5' : 'w-9 justify-center',
        ready ? 'text-ink-subtle hover:text-ink-muted' : 'text-ink-muted hover:text-ink'
      )}
    >
      <StatusDot tone={tone} />
      {expanded && <span className="truncate">{label}</span>}
    </button>
  )
}
