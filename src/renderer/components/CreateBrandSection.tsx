import { MessageCircle } from 'lucide-react'
import { brandFormPatch, createCtaLine, hasBrandMark } from '../../shared/brand-kit'
import { MAX_CTA_OFFER_CHARS, normalizeCtaKeyword, type BrandIdentity } from '../../shared/remix'
import { useBrands } from '../store/use-brand-store'
import type { ClipDraft } from '../store/use-draft-store'
import { BrandPicker } from './BrandIdentityDialog'
import { Field, TextInput } from './ui/Field'
import { SettingRow } from './ui/SettingRow'
import { Switch } from './ui/Switch'

/**
 * Create's brand: the niche, voice and offer the AI writes titles and hook text
 * for; picking one fills this step's look. Then the comment-keyword call to
 * action and the on-video handle (Automatic clips).
 */
export function CreateBrandSection({ draft, update }: { draft: ClipDraft; update: (patch: Partial<ClipDraft>) => void }): React.JSX.Element {
  const brand = useBrands((s) => s.brands.find((item) => item.id === draft.brandIdentityId) ?? null)
  const automatic = draft.workflow !== 'review'
  const keyword = normalizeCtaKeyword(draft.ctaKeyword)
  const choose = (next: BrandIdentity | null): void => {
    if (!next) { update({ brandIdentityId: null, showHandle: false }); return }
    // Only on a change of brand: re-picking the same one never overwrites what the member changed since.
    update({ brandIdentityId: next.id, ...brandFormPatch(next.look, draft) })
  }
  return (
    <section aria-labelledby="create-brand-heading" className="glass-tile space-y-3 rounded-xl p-3">
      <div>
        <h3 id="create-brand-heading" className="text-sm font-medium text-ink">Your brand <span className="font-normal text-ink-subtle">(optional)</span></h3>
        <p className="mt-0.5 text-2xs text-ink-subtle">
          Titles and hook text are written for your niche and in your voice. They only use facts from the video, or proof your Brand Identity states. Picking a brand fills in its look below.
        </p>
      </div>
      <BrandPicker value={draft.brandIdentityId} onChange={choose} noneLabel="No brand" noneDetail="Titles in a neutral voice" />
      {automatic && brand && hasBrandMark(brand.look) && (
        <SettingRow title="Show my handle" description={`Puts ${brand.look?.handle ? `“${brand.look.handle}”` : 'your logo'} small in a corner of every clip.`}
          control={<Switch label="Show my handle" checked={draft.showHandle} onChange={(showHandle) => update({ showHandle })} />} />
      )}
      {automatic && (
        <div className="space-y-2 border-t border-white/[0.06] pt-3">
          <div className="flex items-start gap-2">
            <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
            <div>
              <span className="block text-sm text-ink">Comment-keyword call to action (optional)</span>
              <span className="block text-2xs text-ink-subtle">Each clip’s caption ends with it, and “Comment {keyword || 'KEYWORD'}” shows for the last few seconds. Deliver what you promise with an auto-DM tool like ManyChat.</span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Field label="Comment keyword">
              <TextInput aria-label="Comment keyword" value={draft.ctaKeyword} maxLength={20} placeholder="e.g. SALES"
                onChange={(e) => update({ ctaKeyword: e.target.value.toUpperCase().replace(/\s+/g, '') })} />
            </Field>
            <Field label="What they get">
              <TextInput aria-label="What they get" value={draft.ctaOffer} maxLength={MAX_CTA_OFFER_CHARS} disabled={!keyword}
                placeholder="e.g. my free playbook" onChange={(e) => update({ ctaOffer: e.target.value })} />
            </Field>
          </div>
          {keyword === null ? <p className="text-2xs text-danger">One word: letters, numbers or a dash (2–20 characters).</p>
            : keyword && draft.captionLanguage !== 'original'
              ? <p className="text-2xs text-ink-muted">Captions are in another language, so the post caption leaves this English line out. “Comment {keyword}” still shows at the end of the video.</p>
              : keyword ? <p className="text-2xs text-ink-muted">The caption ends with: <span className="text-ink">“{createCtaLine(keyword, draft.ctaOffer)}”</span></p>
                : null}
        </div>
      )}
    </section>
  )
}

/** The request fields for the draft's brand, keyword and handle (Automatic only for the last two). */
export function brandRequestFields(draft: ClipDraft): { brandIdentityId?: string; ctaKeyword?: string; ctaOffer?: string; showHandle?: boolean } {
  const automatic = draft.workflow !== 'review'
  const typed = automatic ? (draft.ctaKeyword ?? '').trim() : ''
  // An invalid keyword is sent as typed, so starting the job says what to fix instead of dropping it.
  const keyword = typed ? normalizeCtaKeyword(typed) ?? typed : ''
  return {
    ...(draft.brandIdentityId ? { brandIdentityId: draft.brandIdentityId } : {}),
    ...(keyword ? { ctaKeyword: keyword, ctaOffer: (draft.ctaOffer ?? '').trim() } : {}),
    ...(automatic && draft.brandIdentityId && draft.showHandle ? { showHandle: true } : {})
  }
}
