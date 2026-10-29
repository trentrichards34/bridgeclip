import { EDITOR_LOOK_EXTRAS, type CandidateLookExtras } from '../../shared/clip-editor'
import { LOOK_EXTRAS, type LookExtraId } from '../../shared/look-extras'
import { Switch } from './ui/Switch'

/**
 * The clip's look extras in the clip editor's Captions tab: caption styling (keyword pill, accent words) and the
 * layers the bake draws over the clip (progress bar, comment box, zoom, b-roll labels). Each is a switch; Bake draws
 * them. An edited reel starts with the ones picked on its review.
 */
export function EditorLookExtras({ value, captions, onChange }: {
  value: CandidateLookExtras | undefined
  /** Captions are burned in (the caption styles need them). */
  captions: boolean
  onChange: (next: CandidateLookExtras | undefined) => void
}): React.JSX.Element {
  const ids = value?.ids ?? []
  const set = (id: LookExtraId, on: boolean): void => {
    const next = EDITOR_LOOK_EXTRAS.filter((x) => (x === id ? on : ids.includes(x)))
    onChange(next.length || value?.color || value?.keyword ? { ...(value ?? {}), ids: next } : undefined)
  }
  return (
    <section className="space-y-2 border-t border-white/10 pt-3" aria-label="Extras" data-testid="editor-look-extras">
      <p className="text-xs font-medium text-ink">Extras</p>
      <p className="text-2xs text-ink-subtle">Drawn when you bake.</p>
      {LOOK_EXTRAS.filter((extra) => EDITOR_LOOK_EXTRAS.includes(extra.id)).map((extra) => {
        const needsCaptions = extra.id === 'keyword_pill' || extra.id === 'accent_words'
        const noKeyword = extra.id === 'comment_box' && !value?.keyword
        const note = needsCaptions && !captions ? 'Turn on captions to use this.' : noKeyword ? 'Needs a comment keyword: set one in Brand look, then make the reel again.' : extra.detail
        return (
          <div key={extra.id} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-ink">{extra.label}</p>
              <p className="text-2xs leading-snug text-ink-subtle">{note}</p>
            </div>
            <Switch label={extra.label} checked={ids.includes(extra.id)} disabled={(needsCaptions && !captions) || (noKeyword && !ids.includes(extra.id))}
              onChange={(on) => set(extra.id, on)} />
          </div>
        )
      })}
    </section>
  )
}
