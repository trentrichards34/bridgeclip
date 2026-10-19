import { brandFormPatch, createCtaLine } from '../../shared/brand-kit'
import { normalizeCtaKeyword, type BrandIdentity } from '../../shared/remix'
import type { ClipDraft } from '../store/use-draft-store'
import { BrandPicker } from './BrandIdentityDialog'

/**
 * Create's brand: the niche, voice and offer the AI writes titles and hook text
 * for; picking one fills the style board's look below (its handle and comment
 * keyword are set on the board).
 */
export function CreateBrandSection({ draft, update }: { draft: ClipDraft; update: (patch: Partial<ClipDraft>) => void }): React.JSX.Element {
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
    </section>
  )
}

/** What the comment keyword does on Create, under the board's keyword fields. */
export function CreateKeywordHelp({ draft }: { draft: ClipDraft }): React.JSX.Element {
  const keyword = normalizeCtaKeyword(draft.ctaKeyword)
  return (
    <div className="space-y-1">
      <p className="text-2xs text-ink-subtle">Each clip’s caption ends with it, and “Comment {keyword || 'KEYWORD'}” shows for the last few seconds. Deliver what you promise with an auto-DM tool like ManyChat.</p>
      {keyword === null ? <p className="text-2xs text-danger">One word: letters, numbers or a dash (2–20 characters).</p>
        : keyword && draft.captionLanguage !== 'original'
          ? <p className="text-2xs text-ink-muted">Captions are in another language, so the post caption leaves this English line out. “Comment {keyword}” still shows at the end of the video.</p>
          : keyword ? <p className="text-2xs text-ink-muted">The caption ends with: <span className="text-ink">“{createCtaLine(keyword, draft.ctaOffer)}”</span></p>
            : null}
    </div>
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
