import { useEffect, useState } from 'react'
import { Pencil, Plus, Star, Trash2 } from 'lucide-react'
import type { BrandIdentity } from '../../shared/remix'
import { CAPTION_PRESETS } from '../../shared/caption-presets'
import { BrandIdentityDialog } from '../components/BrandIdentityDialog'
import { Button } from '../components/ui/Button'
import { Callout } from '../components/ui/Callout'
import { EmptyState } from '../components/ui/EmptyState'
import { Page } from '../components/ui/Page'
import { PageHeader } from '../components/ui/PageHeader'
import { Skeleton } from '../components/ui/Skeleton'
import { useBrands } from '../store/use-brand-store'
import { getApi } from '../lib/ipc'
import { errorMessage, formatRelativeDate, localFileUrl } from '../lib/utils'

/**
 * Brand look: the member's brand identities in one place (the same list
 * Create, Remix and Avatar Studio pick from). Add, edit and delete use the
 * existing brand identity dialog.
 */
export function BrandLookPage(): React.JSX.Element {
  const { brands, loaded, load, setBrands, error: loadError } = useBrands()
  const [editing, setEditing] = useState<BrandIdentity | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void load(true) }, [load])

  const remove = async (id: string): Promise<void> => {
    if (confirmDelete !== id) { setConfirmDelete(id); return }
    setConfirmDelete(null); setError(null)
    try { setBrands(await getApi().brandIdentities.remove(id)) }
    catch (err) { setError(errorMessage(err)) }
  }

  return (
    <Page>
      <PageHeader
        title="Your brand look"
        description="Your niche, voice and look. Picking a brand on Create, Remix or Avatar Studio fills in its look."
        actions={<Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditing('new')}>Add a brand</Button>}
      />

      {(error || loadError) && <Callout tone="danger" className="mt-5" onDismiss={error ? () => setError(null) : undefined}>{error ?? loadError}</Callout>}

      <div className="mt-6">
        {!loaded ? (
          <div aria-busy="true" aria-label="Loading your brands" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[132px] rounded-2xl" />)}
          </div>
        ) : brands.length === 0 ? (
          <EmptyState
            icon={<Star />}
            title="No brand yet"
            description="Add your brand once: titles and hook text are written for your niche and in your voice, and your colors, captions and handle fill in on every tool."
            action={<Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditing('new')}>Add a brand</Button>}
          />
        ) : (
          <ul aria-label="Your brands" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {brands.map((brand) => (
              <BrandCard key={brand.id} brand={brand} confirming={confirmDelete === brand.id}
                onEdit={() => { setConfirmDelete(null); setEditing(brand) }}
                onDelete={() => void remove(brand.id)} />
            ))}
          </ul>
        )}
      </div>

      {editing && <BrandIdentityDialog brand={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onSaved={(list) => { setBrands(list); setEditing(null) }} />}
    </Page>
  )
}

function BrandCard({ brand, confirming, onEdit, onDelete }: { brand: BrandIdentity; confirming: boolean; onEdit: () => void; onDelete: () => void }): React.JSX.Element {
  const look = brand.look ?? {}
  const caption = CAPTION_PRESETS.find((preset) => preset.id === look.captionPreset)?.name
  const details = [
    caption ? `${caption} captions` : null,
    look.handle ? look.handle : null,
    look.ctaKeyword ? `Comment ${look.ctaKeyword}` : null
  ].filter(Boolean) as string[]
  return (
    <li className="glass flex flex-col gap-3 rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/[0.06] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]"
          style={look.color ? { background: look.color } : undefined}>
          {brand.logoPath ? <img src={localFileUrl(brand.logoPath)} alt="" className="h-8 w-8 object-contain" /> : !look.color && <Star className="h-4 w-4 text-tool" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-ink">{brand.name}</h2>
          <p className="mt-0.5 font-mono text-[10px] tabular text-ink-subtle">
            {brand.text.length.toLocaleString()} characters · updated {formatRelativeDate(brand.updatedAt).toLowerCase()}
          </p>
        </div>
      </div>
      <div className="flex min-h-[22px] flex-wrap gap-1.5">
        {look.color && <span className="inline-flex h-[22px] items-center gap-1.5 rounded-md bg-white/[0.06] px-1.5 font-mono text-[10px] uppercase text-ink-muted"><span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: look.color }} />{look.color}</span>}
        {details.map((detail) => <span key={detail} className="inline-flex h-[22px] items-center rounded-md bg-white/[0.06] px-1.5 text-2xs text-ink-muted">{detail}</span>)}
        {!look.color && details.length === 0 && <span className="text-2xs text-ink-faint">No look saved yet</span>}
      </div>
      <div className="mt-auto flex gap-2">
        <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={onEdit} aria-label={`Edit ${brand.name}`}>Edit</Button>
        <Button size="sm" variant={confirming ? 'danger' : 'ghost'} icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onDelete} aria-label={confirming ? `Click again to delete ${brand.name}` : `Delete ${brand.name}`}>
          {confirming ? 'Click again to delete' : 'Delete'}
        </Button>
      </div>
    </li>
  )
}
