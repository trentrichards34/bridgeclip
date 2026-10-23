import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { LogoSummary } from '../../shared/logos'
import { MAX_LOGOS } from '../../shared/logos'
import { getApi } from '../lib/ipc'
import { cn, errorMessage, localFileUrl } from '../lib/utils'
import { Button } from './ui/Button'

export const LOGOS_HELP = 'Add a logo once and give it the words you say for it. When you say one of them, the logo pops in on a white tile (at most one every 6 seconds, each logo twice a video, never during a personal story). We never draw brand logos ourselves: only the files you add here.'

export interface LogoLibrary {
  logos: LogoSummary[] | null
  adding: boolean
  error: string | null
  add: () => Promise<void>
  update: (id: string, patch: { name?: string; aliases?: string[] }) => Promise<void>
  remove: (id: string) => Promise<void>
}

/** The member's logos, loaded once. */
export function useLogoLibrary(): LogoLibrary {
  const [logos, setLogos] = useState<LogoSummary[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    getApi().logos.list().then((list) => { if (live) setLogos(list) }).catch((err) => { if (live) { setLogos([]); setError(errorMessage(err)) } })
    return () => { live = false }
  }, [])
  const add = async (): Promise<void> => {
    setAdding(true); setError(null)
    try { const list = await getApi().logos.add(); if (list) setLogos(list) } catch (err) { setError(errorMessage(err)) } finally { setAdding(false) }
  }
  const update = async (id: string, patch: { name?: string; aliases?: string[] }): Promise<void> => {
    setError(null)
    try { setLogos(await getApi().logos.update(id, patch)) } catch (err) { setError(errorMessage(err)) }
  }
  const remove = async (id: string): Promise<void> => {
    setError(null)
    try { setLogos(await getApi().logos.remove(id)) } catch (err) { setError(errorMessage(err)) }
  }
  return { logos, adding, error, add, update, remove }
}

export function LogoThumb({ logo, className }: { logo: LogoSummary; className?: string }): React.JSX.Element {
  return <span className={cn('grid shrink-0 place-items-center overflow-hidden rounded-lg bg-white p-1.5', className ?? 'h-11 w-11')}>
    <img src={localFileUrl(logo.path)} alt="" className="max-h-full max-w-full object-contain" />
  </span>
}

/** The My logos list on the Brand look page: each logo with its name, the other words for it, and remove. */
export function MyLogosList({ library }: { library: LogoLibrary }): React.JSX.Element {
  const { logos, adding } = library
  return (
    <div className="space-y-2.5">
      <p className="text-2xs text-ink-muted">{LOGOS_HELP}</p>
      {logos === null ? <div className="glass-tile h-14 animate-pulse rounded-xl" /> : (
        <ul aria-label="Your logos" className="space-y-1.5">
          {logos.map((logo) => <LogoRow key={logo.id} logo={logo} library={library} />)}
          {logos.length === 0 && <li className="glass-tile rounded-xl px-3 py-2.5 text-2xs text-ink-subtle">No logos yet. Add the logos of tools or brands you talk about (PNG, JPEG, WebP or SVG, up to 5 MB).</li>}
        </ul>
      )}
      <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} loading={adding} disabled={adding || logos === null || logos.length >= MAX_LOGOS} onClick={() => void library.add()}>
        {adding ? 'Adding…' : 'Add logo'}
      </Button>
      {library.error && <p role="alert" className="text-2xs text-danger">{library.error}</p>}
    </div>
  )
}

function LogoRow({ logo, library }: { logo: LogoSummary; library: LogoLibrary }): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const aliases = logo.aliases.join(', ')
  return (
    <li className="glass-tile flex flex-wrap items-center gap-3 rounded-xl p-1.5 pr-2.5" aria-label={logo.name}>
      <LogoThumb logo={logo} />
      <span className="flex min-w-0 flex-1 basis-56 flex-wrap gap-1.5">
        <input aria-label={`Name of ${logo.name}`} title="The word you say for it" defaultValue={logo.name} maxLength={40} key={`n-${logo.name}`}
          onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== logo.name) void library.update(logo.id, { name }); else e.target.value = logo.name }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          className="glass-well h-7 w-32 min-w-0 rounded-md px-2 text-xs text-ink focus:border-accent focus:outline-none" />
        <input aria-label={`Other words for ${logo.name}`} placeholder="Other words for it, comma-separated" defaultValue={aliases} maxLength={260} key={`a-${aliases}`}
          onBlur={(e) => { const next = e.target.value.split(',').map((a) => a.trim()).filter(Boolean); if (next.join(', ') !== aliases) void library.update(logo.id, { aliases: next }) }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          className="glass-well h-7 min-w-0 flex-1 basis-40 rounded-md px-2 text-xs text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none" />
      </span>
      <Button size="sm" variant={confirming ? 'danger' : 'ghost'} iconOnly={!confirming} aria-label={confirming ? `Click again to remove ${logo.name}` : `Remove ${logo.name}`}
        icon={<Trash2 className="h-3.5 w-3.5" />} onBlur={() => setConfirming(false)}
        onClick={() => { if (!confirming) { setConfirming(true); return } setConfirming(false); void library.remove(logo.id) }}>
        {confirming ? 'Remove' : undefined}
      </Button>
    </li>
  )
}

/** The clip editor's pick from My logos (for a Logo pop graphic): a row of the member's logos; nothing when they have none. */
export function LogoPickRow({ onPick, label = 'Or use one of My logos' }: { onPick: (logo: LogoSummary) => void; label?: string }): React.JSX.Element | null {
  const [logos, setLogos] = useState<LogoSummary[]>([])
  useEffect(() => {
    let live = true
    getApi().logos.list().then((list) => { if (live) setLogos(list) }).catch(() => { if (live) setLogos([]) })
    return () => { live = false }
  }, [])
  if (!logos.length) return null
  return (
    <div className="space-y-1">
      <p className="text-2xs text-ink-muted">{label}</p>
      <div role="group" aria-label="My logos" className="flex flex-wrap gap-1.5">
        {logos.map((logo) => (
          <button key={logo.id} type="button" title={logo.name} aria-label={`Use ${logo.name}`} onClick={() => onPick(logo)}
            className="rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent hover:opacity-90">
            <LogoThumb logo={logo} className="h-9 w-9" />
          </button>
        ))}
      </div>
    </div>
  )
}
