import { useEffect, useId, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { searchLibrary } from '../../shared/broll-library'
import { localFileUrl } from '../lib/utils'
import { useBrollLibrary } from '../store/use-broll-library-store'
import { Button } from './ui/Button'
import { Checkbox } from './ui/Checkbox'
import { Dialog, DialogFooter } from './ui/Dialog'
import { TextInput } from './ui/Field'

/** Choose clips from My B-roll library (searchable), e.g. for React, then my thoughts. */
export function BrollLibraryPicker({ max, onPick, onClose, onOpenLibrary }: {
  max: number
  onPick: (ids: string[]) => void
  onClose: () => void
  onOpenLibrary?: () => void
}): React.JSX.Element {
  const titleId = useId()
  const view = useBrollLibrary((state) => state.view)
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  useEffect(() => { void useBrollLibrary.getState().load() }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const usable = useMemo(() => (view?.items ?? []).filter((item) => item.status === 'ready' && (item.proxyPath || item.originalPath)), [view])
  const shown = useMemo(() => searchLibrary(usable, query), [usable, query])
  const toggle = (id: string, on: boolean): void => setChosen((list) => on ? (list.length >= max ? list : [...list, id]) : list.filter((entry) => entry !== id))
  return (
    <Dialog aria-labelledby={titleId} onBackdropMouseDown={onClose} panelClassName="max-w-[720px]">
      <div className="space-y-3 overflow-y-auto px-5 pb-4 pt-5">
        <h2 id={titleId} className="text-base font-semibold text-ink">Add from my B-roll library</h2>
        <TextInput leading={<Search className="h-3.5 w-3.5" />} placeholder="Search: “coffee”, “desk”, “me”…" aria-label="Search your b-roll" value={query} onChange={(e) => setQuery(e.target.value)} />
        {usable.length === 0 ? (
          <p className="text-sm text-ink-muted">Your B-roll library has no clips ready yet.{onOpenLibrary && <> <button type="button" className="text-tool underline" onClick={onOpenLibrary}>Open my B-roll library</button></>}</p>
        ) : (
          <ul className="grid max-h-[50vh] gap-2 overflow-y-auto sm:grid-cols-2" aria-label="Library clips">
            {shown.map((item) => {
              const on = chosen.includes(item.id)
              const description = item.shots.find((shot) => shot.analysis)?.analysis?.description
              return (
                <li key={item.id} className="flex items-center gap-2 rounded-xl bg-white/[0.04] p-2">
                  <Checkbox label={`Choose ${item.name}`} checked={on} disabled={!on && chosen.length >= max} onChange={(next) => toggle(item.id, next)} />
                  {item.posterPath ? <img src={localFileUrl(item.posterPath)} alt="" className="h-12 w-16 shrink-0 rounded object-cover" /> : <span className="h-12 w-16 shrink-0 rounded bg-black/40" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-ink">{item.name}</span>
                    {description && <span className="line-clamp-2 block text-2xs text-ink-subtle">{description}</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        <p className="text-2xs text-ink-subtle">{chosen.length ? `${chosen.length} chosen` : `Choose up to ${max}.`} Each is copied into this video’s b-roll.</p>
      </div>
      <DialogFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!chosen.length} onClick={() => { onPick(chosen); onClose() }}>{chosen.length ? `Add ${chosen.length}` : 'Add'}</Button>
      </DialogFooter>
    </Dialog>
  )
}
