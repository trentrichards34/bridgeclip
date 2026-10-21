/**
 * The clip editor inspector's tabs on one row: the tabs members use most, then
 * a "More" menu for the rest. When a tab from the menu is open, the menu
 * button shows its name. The menu works with the keyboard (arrows, Home, End,
 * Escape) like the app's other menus.
 */
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '../lib/utils'

export type EditorTab = 'review' | 'framing' | 'captions' | 'hook' | 'transcript' | 'chat' | 'graphics'
export const EDITOR_TAB_LABELS: Record<EditorTab, string> = {
  review: 'Quality check', framing: 'Framing', captions: 'Captions', hook: 'Hook & CTA', transcript: 'Transcript', chat: 'Chat', graphics: 'Graphics'
}
const MAIN_TABS: readonly EditorTab[] = ['captions', 'hook', 'graphics', 'chat']
const MORE_TABS: readonly EditorTab[] = ['framing', 'transcript', 'review']

export function EditorTabs({ tab, onTab }: { tab: EditorTab; onTab: (tab: EditorTab) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const fromEnd = useRef(false)
  const inMore = MORE_TABS.includes(tab)
  const close = (focus: boolean): void => { setOpen(false); if (focus) trigger.current?.focus({ preventScroll: true }) }
  useEffect(() => {
    if (!open) return
    const items = menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    items?.[fromEnd.current ? items.length - 1 : Math.max(0, MORE_TABS.indexOf(tab))]?.focus({ preventScroll: true })
    const outside = (event: PointerEvent): void => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [open, tab])
  return <div className="editor-tabs">
    {MAIN_TABS.map((t) => <button key={t} type="button" aria-pressed={tab === t} onClick={() => onTab(t)} className={cn(tab === t && 'selected')}>{EDITOR_TAB_LABELS[t]}</button>)}
    <button ref={trigger} type="button" className={cn('editor-tabs-more', inMore && 'selected')} aria-haspopup="menu" aria-expanded={open}
      aria-label={inMore ? `${EDITOR_TAB_LABELS[tab]}, more tabs` : 'More tabs'} title="Framing, Transcript and Quality check"
      onClick={() => { fromEnd.current = false; setOpen(!open) }}
      onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); fromEnd.current = e.key === 'ArrowUp'; setOpen(true) } }}>
      <span>{inMore ? EDITOR_TAB_LABELS[tab] : 'More'}</span><ChevronDown size={12} aria-hidden />
    </button>
    {open && <div ref={menu} role="menu" aria-label="More tabs" className="editor-tabs-menu"
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true) } else if (e.key === 'Tab') close(false)
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault()
          const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])
          const index = items.indexOf(document.activeElement as HTMLButtonElement)
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
          items[next]?.focus()
        }
      }}>
      {MORE_TABS.map((t) => <button key={t} type="button" role="menuitemradio" aria-checked={tab === t} onClick={() => { onTab(t); close(true) }}>
        <span>{EDITOR_TAB_LABELS[t]}</span>{tab === t && <Check size={12} aria-hidden />}
      </button>)}
    </div>}
  </div>
}
