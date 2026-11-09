import { useEffect, useState } from 'react'
import { Archive, Plus, RotateCcw } from 'lucide-react'
import type { LibraryView } from '../../shared/motion-library'
import { getApi } from '../lib/ipc'
import { cn, errorMessage, localFileUrl } from '../lib/utils'
import { Button } from './ui/Button'
import { Segmented } from './ui/Segmented'

const KIND_LABELS: Record<string, string> = { comparison: 'Comparison', process: 'Steps', proof: 'Proof', claim: 'Key line', takeover: 'Takeover', list: 'List' }
const FRAME_LABELS: Record<string, string> = { visual: 'Full screen', stage: 'Stage', card: 'Over you' }

/** The library's tiles move: each shows its stills in turn (coming in, settled, leaving), on one shared clock. */
function useTick(ms: number): number {
  const [tick, setTick] = useState(0)
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), ms); return () => clearInterval(id) }, [ms])
  return tick
}

/**
 * My motion library: every custom graphic that passed its check, as a grid of moving tiles ("used in N videos"),
 * with the retired ones (and why) on their own tab. Add puts one here, filled with the words you say at this spot.
 */
export function MotionLibraryGrid({ onPick, disabled = false, busy = null }: {
  /** Add this library graphic here (absent: the grid is for browsing, retiring and restoring). */
  onPick?: (item: LibraryView) => void
  disabled?: boolean
  /** The library graphic being added right now. */
  busy?: string | null
}): React.JSX.Element {
  const [items, setItems] = useState<LibraryView[] | null>(null)
  const [tab, setTab] = useState<'active' | 'retired'>('active')
  const [error, setError] = useState<string | null>(null)
  const tick = useTick(900)
  useEffect(() => {
    let live = true
    if (typeof getApi().library?.list !== 'function') { setItems([]); return }
    void getApi().library.list().then((list) => { if (live) setItems(list) }).catch((err: unknown) => { if (live) { setItems([]); setError(errorMessage(err)) } })
    return () => { live = false }
  }, [])
  const setStatus = (item: LibraryView, status: 'active' | 'retired'): void => {
    setError(null)
    void getApi().library.setStatus(item.id, status).then(setItems).catch((err: unknown) => setError(errorMessage(err)))
  }
  const shown = (items ?? []).filter((i) => i.status === tab)
  const counts = { active: (items ?? []).filter((i) => i.status === 'active').length, retired: (items ?? []).filter((i) => i.status === 'retired').length }
  return <div className="space-y-3" data-testid="motion-library">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-2xs text-ink-subtle">Every custom graphic that passes its check is kept here, so your next videos can use it again: filled with the words you say, in your look. Ones that never passed are retired.</p>
      <Segmented size="sm" label="Library" value={tab} onChange={setTab} options={[{ value: 'active', label: `My graphics (${counts.active})` }, { value: 'retired', label: `Retired (${counts.retired})` }]} />
    </div>
    {error && <p role="alert" className="text-2xs text-danger">{error}</p>}
    {items === null ? <p className="text-2xs text-ink-subtle">Loading your library…</p>
      : !shown.length ? <p className="graphic-gallery-note">{tab === 'active' ? 'No graphics yet. Turn on Custom graphics in Skills: each one that passes its check lands here.' : 'Nothing retired.'}</p>
        : <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3" role="list" aria-label={tab === 'active' ? 'My graphics' : 'Retired graphics'}>
          {shown.map((item, i) => {
            const still = item.stills.length ? item.stills[(tick + i) % item.stills.length] : null
            return <div key={item.id} role="listitem" className={cn('glass-tile flex min-w-0 flex-col gap-1.5 rounded-xl p-2', item.status === 'retired' && 'opacity-70')} data-testid="library-tile" data-library={item.id}>
              <div className="relative mx-auto overflow-hidden rounded-lg" style={{ width: 132, height: 132 * 16 / 9, background: item.frame === 'card' ? '#2a2f3a' : '#1F4E9C' }}>
                {still && <img src={localFileUrl(still)} alt="" className="absolute inset-0 h-full w-full object-contain" draggable={false} />}
                {item.status === 'retired' && <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 rotate-[-12deg] bg-danger/85 py-0.5 text-center text-xs font-bold tracking-widest text-white">RETIRED</span>}
              </div>
              <p className="text-xs font-medium leading-snug text-ink">{KIND_LABELS[item.kind] ?? item.kind} · {FRAME_LABELS[item.frame] ?? item.frame}</p>
              <p className="text-[10px] text-ink-subtle">{item.status === 'retired' ? item.reason ?? 'Retired.' : `Used in ${item.uses} video${item.uses === 1 ? '' : 's'} · ${(item.durationMs / 1000).toFixed(1)} s`}</p>
              <div className="mt-auto flex flex-wrap gap-1">
                {item.status === 'active' && onPick && <Button size="sm" variant="primary" icon={<Plus size={12} />} loading={busy === item.id} disabled={disabled || busy !== null}
                  aria-label={`Add library graphic: ${KIND_LABELS[item.kind] ?? item.kind}`} tooltip="Your AI fills it with the words you say here, then checks it over your video." onClick={() => onPick(item)}>Add</Button>}
                {item.status === 'active'
                  ? <Button size="sm" variant="ghost" icon={<Archive size={12} />} disabled={busy !== null} onClick={() => setStatus(item, 'retired')}>Retire</Button>
                  : <Button size="sm" variant="ghost" icon={<RotateCcw size={12} />} onClick={() => setStatus(item, 'active')}>Restore</Button>}
              </div>
            </div>
          })}
        </div>}
  </div>
}
