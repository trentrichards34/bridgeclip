import { useMemo, useState } from 'react'
import { Loader2, Plus, Search, Trash2 } from 'lucide-react'
import type { AssistantConversationSummary } from '../../../shared/assistant'
import { ProviderLogo } from '../brand/ProviderLogo'
import { TextInput } from '../ui/Field'
import { cn } from '../../lib/utils'

const DAY_MS = 24 * 60 * 60 * 1000

/** "Today", "Yesterday", "Oct 19" or "Oct 19, 2025". */
function dayLabel(iso: string, today: number): string {
  const date = new Date(iso)
  const at = date.getTime()
  if (!Number.isFinite(at)) return ''
  if (at >= today) return 'Today'
  if (at >= today - DAY_MS) return 'Yesterday'
  const sameYear = date.getFullYear() === new Date(today).getFullYear()
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(!sameYear && { year: 'numeric' }) })
}

/** Recent chats beside the conversation, newest first, each with its day. */
export function ChatList({ conversations, activeId, running, waiting, onOpen, onNew, onDelete, className }: {
  conversations: AssistantConversationSummary[]
  activeId: string | null
  running: string[]
  /** Chats with an approval waiting. */
  waiting: Set<string>
  onOpen: (id: string) => void
  onNew: () => void
  onDelete: (chat: AssistantConversationSummary) => void
  className?: string
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const chats = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    return conversations
      .filter((chat) => !needle || chat.title.toLowerCase().includes(needle))
      .map((chat) => ({ chat, day: dayLabel(chat.updatedAt, today) }))
  }, [conversations, query])

  return (
    <aside aria-label="Chats" className={cn('w-[250px] shrink-0 flex-col pb-4 pl-4 pr-3 sm:pl-6 xl:pl-8', className)}>
      <button
        type="button"
        onClick={onNew}
        className={cn(
          'flex h-[38px] w-full shrink-0 items-center justify-center gap-1.5 rounded-[11px] text-sm font-semibold text-white',
          'bg-[linear-gradient(135deg,rgb(var(--tool-remix)),rgb(var(--tool-avatar)))] shadow-[0_8px_24px_-12px_rgb(var(--tool-remix)/0.7),inset_0_1px_0_rgb(255_255_255/0.2)]',
          'transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.98] motion-reduce:active:scale-100'
        )}
      >
        <Plus aria-hidden className="h-4 w-4" strokeWidth={2.4} />
        New chat
      </button>
      {conversations.length > 0 && (
        <div className="mt-3">
          <TextInput inputSize="sm" type="search" aria-label="Search chats" placeholder="Search chats" leading={<Search className="h-3.5 w-3.5" />} value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      )}
      <p className="eyebrow px-2.5 pb-1.5 pt-4">Recent</p>
      <nav aria-label="Recent chats" className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {conversations.length === 0 && <p className="px-2.5 pt-1 text-xs leading-relaxed text-ink-subtle">Your chats show up here, so you can pick one up later.</p>}
        {conversations.length > 0 && chats.length === 0 && <p className="px-2.5 pt-1 text-xs text-ink-subtle">No chats match “{query.trim()}”.</p>}
        <ul className="space-y-0.5">
          {chats.map(({ chat, day }) => {
            const active = chat.id === activeId
            const replying = running.includes(chat.id)
            return (
              <li key={chat.id} className="group/chat relative">
                <button
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onOpen(chat.id)}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-[10px] py-2 pl-2.5 pr-8 text-left transition-colors duration-150',
                    active ? 'bg-white/[0.07] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05)]' : 'hover:bg-white/[0.04]'
                  )}
                >
                  <ProviderLogo provider={chat.provider} className="mt-[3px] h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-sm', active ? 'text-ink' : 'text-ink-muted group-hover/chat:text-ink')}>{chat.title}</span>
                    {day && <span className="mt-0.5 block text-2xs text-ink-subtle">{day}</span>}
                  </span>
                </button>
                {/* A chat that's replying can't be deleted, so its status takes the delete button's place. */}
                {waiting.has(chat.id) ? (
                  <span role="img" aria-label="Waiting for your approval" title="Waiting for your approval" className="pointer-events-none absolute right-3 top-1/2 h-[7px] w-[7px] -translate-y-1/2 rounded-full bg-warning shadow-[0_0_8px_rgb(var(--warning)/0.6)]" />
                ) : replying ? (
                  // The wrapper centres the spinner and the icon spins. animate-spin's keyframe
                  // sets `transform`, so on one element it would replace the centring translate.
                  <span role="img" aria-label="Replying" className="pointer-events-none absolute right-2.5 top-1/2 flex -translate-y-1/2">
                    <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin text-tool" />
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={`Delete “${chat.title}”`}
                    title="Delete chat"
                    onClick={() => onDelete(chat)}
                    className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-subtle opacity-0 transition-opacity duration-150 hover:bg-white/[0.08] hover:text-danger focus-visible:opacity-100 group-hover/chat:opacity-100"
                  >
                    <Trash2 aria-hidden className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </nav>
    </aside>
  )
}
