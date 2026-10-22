import { useEffect, useRef, useState } from 'react'
import { CornerDownLeft, Search, Sparkles, UserRound } from 'lucide-react'
import { parseSourceText } from '../../shared/create-sources'
import { cn, isMac, MOD_KEY } from '../lib/utils'
import { useDraftStore } from '../store/use-draft-store'
import { useShellStore } from '../store/use-shell-store'
import { useAccountsStore } from '../store/use-accounts-store'
import type { Page } from './Sidebar'

/** ⌘K focuses the top bar; ⌘J opens Chat (Ctrl on Windows/Linux). */
export const TOP_BAR_FOCUS_KEY = 'k'
export const ASK_KEY = 'j'

/** What the top bar does with its text: links start clips on Create, anything else searches the Library. */
export function topBarIntent(text: string): { kind: 'links'; links: string[] } | { kind: 'search'; query: string } | null {
  const value = text.trim()
  if (!value) return null
  const { links, invalid } = parseSourceText(value)
  if (links.length > 0 && invalid.length === 0) return { kind: 'links', links }
  return { kind: 'search', query: value }
}

function initials(name: string): string {
  const words = name.replace(/^@/, '').split(/[\s._-]+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '').slice(0, 2)).toUpperCase()
}

/**
 * The bar above every page: paste a link to start clips (or search the
 * Library), Ask opens Chat, and the profile chip opens Settings. The strip
 * itself is a window drag handle; its controls opt out.
 */
export function TopBar({ onNavigate }: { onNavigate: (page: Page) => void }): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const account = useAccountsStore((state) => state.accounts[0])
  const name = account?.displayName || account?.username || ''
  const intent = topBarIntent(text)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(isMac ? event.metaKey : event.ctrlKey) || event.altKey || event.shiftKey) return
      const key = event.key.toLowerCase()
      if (key === TOP_BAR_FOCUS_KEY) {
        // A dialog owns the keyboard while it is open.
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
        event.preventDefault()
        input.current?.focus()
        input.current?.select()
      } else if (key === ASK_KEY) {
        event.preventDefault()
        onNavigate('assistant')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onNavigate])

  const start = (): void => {
    if (!intent) { input.current?.focus(); return }
    if (intent.kind === 'links') {
      const draft = useDraftStore.getState()
      // A finished run's confirmation gives way to the new video.
      if (draft.started) draft.startAnother()
      useDraftStore.getState().update({ source: intent.links[0], sources: intent.links.length > 1 ? intent.links : [intent.links[0]] })
      useDraftStore.getState().setStep('video')
      onNavigate('clip')
    } else {
      useShellStore.getState().setLibrarySearch(intent.query)
      onNavigate('library')
    }
    setText('')
    input.current?.blur()
  }

  return (
    <div className="drag relative z-20 flex h-[var(--shell-top)] shrink-0 items-center gap-2.5 pl-4 pr-4 sm:pl-6 xl:pl-8">
      <form
        role="search"
        aria-label="Start or search"
        className="no-drag group/bar flex h-10 min-w-0 max-w-[620px] flex-1 items-center gap-2.5 rounded-xl border border-white/[0.08] bg-surface/85 pl-3.5 pr-1.5 transition-[border-color,box-shadow] duration-150 hover:border-white/[0.14] focus-within:border-accent/70 focus-within:shadow-[0_0_0_3px_rgb(var(--accent)/0.14)]"
        onSubmit={(event) => { event.preventDefault(); start() }}
      >
        <Search aria-hidden className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={2} />
        <input
          ref={input}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Escape') { setText(''); event.currentTarget.blur() } }}
          placeholder="Paste a link to start clips, or search anything"
          aria-label="Start from a link, or search"
          title={`Paste a video link to start clips on Create, or type to search your Library (${MOD_KEY}K)`}
          spellCheck={false}
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-faint focus:outline-none focus-visible:outline-none"
        />
        <kbd aria-hidden className="hidden shrink-0 rounded-[5px] border border-white/[0.08] px-1.5 py-[3px] font-mono text-[10px] leading-none text-ink-faint sm:inline">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
        <button
          type="submit"
          aria-label={intent?.kind === 'search' ? 'Search the Library' : 'Start clips from this link'}
          className={cn(
            'flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors',
            intent ? 'bg-accent text-accent-ink hover:bg-[rgb(var(--accent-button-hover))]' : 'bg-white/[0.07] text-ink-muted hover:bg-white/[0.1] hover:text-ink'
          )}
        >
          {intent?.kind === 'search' ? 'Search' : 'Start'}
          <CornerDownLeft aria-hidden className="h-3 w-3" strokeWidth={2.2} />
        </button>
      </form>

      <div className="no-drag ml-auto flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => onNavigate('assistant')}
          aria-label="Ask the assistant"
          title={`Open Chat (${MOD_KEY}J)`}
          className="flex h-9 items-center gap-2 rounded-[10px] bg-[linear-gradient(135deg,rgb(var(--tool-remix)),rgb(var(--tool-avatar)))] px-3.5 font-semibold text-white shadow-[0_6px_20px_rgb(var(--tool-remix)/0.3)] transition-[filter,box-shadow] duration-150 hover:brightness-110 hover:shadow-[0_8px_24px_rgb(var(--tool-remix)/0.4)]"
        >
          <Sparkles aria-hidden className="h-3.5 w-3.5" strokeWidth={2.2} />
          Ask
          <kbd aria-hidden className="hidden font-mono text-[10px] font-normal opacity-75 sm:inline">{isMac ? '⌘J' : 'Ctrl J'}</kbd>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('settings')}
          aria-label={name ? `Profile: ${name}` : 'Profile'}
          title={name ? `${name} · Settings` : 'Settings'}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-overlay text-xs font-semibold text-ink transition-colors hover:bg-white/[0.12]"
        >
          {name ? initials(name) : <UserRound aria-hidden className="h-4 w-4 text-ink-muted" strokeWidth={2} />}
        </button>
      </div>
    </div>
  )
}
