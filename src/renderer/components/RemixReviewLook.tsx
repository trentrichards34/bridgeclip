/**
 * "Look and skills" inside a remix review (you on camera): the settings that change THIS video when it's made —
 * the Skills (captions, zoom, music, voice cleanup) and the captions' and hook text's look. Each change goes to
 * the run in main (remix:setLook) and is remembered as the Remix form's last choice for the next remix.
 */
import { useState } from 'react'
import { ChevronDown, Palette } from 'lucide-react'
import type { RemixStatus } from '../../shared/remix'
import type { RemixLookPatch, RemixReviewLook } from '../../shared/remix-review-look'
import { remixSkillPatch, remixSkillRows } from '../../shared/skills'
import { boardFromLook, LOOK_HOOKS, lookPatch, styleSummary, type BoardStyle } from '../lib/style-board'
import { getApi } from '../lib/ipc'
import { cn, errorMessage } from '../lib/utils'
import { useBrands } from '../store/use-brand-store'
import { useRemixForm } from '../store/use-remix-form-store'
import { SkillsPanel } from './SkillsPanel'
import { previewFrame, StyleBoard } from './StyleBoard'

const BOARD_ROWS = { hooks: LOOK_HOOKS }

export function RemixLookSection({ status, step, disabled, frame, hookText, onError }: {
  status: RemixStatus
  step?: number
  disabled: boolean
  /** A video to preview the look on (their clip or the member's take). */
  frame?: string | null
  hookText?: string
  onError: (message: string | null) => void
}): React.JSX.Element | null {
  const look = status.look
  const brand = useBrands((s) => s.brands.find((item) => item.id === look?.brandIdentityId) ?? null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  // Shown at once; main's answer (the status) follows.
  const [pending, setPending] = useState<RemixReviewLook | null>(null)
  if (!look) return null
  const current = pending ?? look
  const fields = { includeCaptions: current.includeCaptions, captionPreset: current.captionPreset, headlineLook: current.headlineLook, showHandle: false, lookExtras: current.lookExtras }
  const board: BoardStyle = boardFromLook(fields)
  const change = (patch: RemixLookPatch): void => {
    if (!Object.keys(patch).length) return
    const next = { ...current, ...patch, ...(patch.music === false ? { musicTrack: null } : {}) }
    setPending(next); setSaving(true); onError(null)
    getApi().remix.setLook(patch).then(() => {
      // The next remix starts from these too (the form's "last choices").
      const form = useRemixForm.getState()
      form.update({
        ...(patch.includeCaptions !== undefined ? { includeCaptions: patch.includeCaptions } : {}),
        ...(patch.captionPreset !== undefined ? { captionPreset: patch.captionPreset } : {}),
        ...(patch.headlineLook ? { headlineLook: patch.headlineLook } : {}),
        ...(patch.lookExtras ? { lookExtras: patch.lookExtras } : {}),
        ...(patch.music !== undefined ? { music: patch.music } : {}),
        ...(patch.musicTrack !== undefined ? { musicTrack: patch.musicTrack ?? '' } : {}),
        ...(patch.voiceCleanup !== undefined ? { voiceCleanup: patch.voiceCleanup } : {})
      })
    }, (err) => onError(errorMessage(err, 'That could not be changed.'))).finally(() => { setPending(null); setSaving(false) })
  }
  const off = disabled || saving
  const summary = styleSummary(board, BOARD_ROWS)
  return (
    <section className="glass-tile space-y-3 rounded-2xl p-4" aria-label="Look and skills" data-testid="review-look">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-medium text-ink"><Palette className="h-4 w-4" />{step ? `${step} · ` : ''}Look and skills</h3>
        <p className="mt-0.5 text-2xs text-ink-muted">For this video. Your changes are used when you make it.</p>
      </div>
      <fieldset disabled={off} className="space-y-3">
        <SkillsPanel rows={remixSkillRows({ includeCaptions: current.includeCaptions, lookExtras: current.lookExtras, music: current.music, voiceCleanup: current.voiceCleanup })}
          intro="Turn each part on or off for this video."
          onToggle={(id, on) => change(remixSkillPatch({ includeCaptions: current.includeCaptions, lookExtras: current.lookExtras, music: current.music, voiceCleanup: current.voiceCleanup }, id, on) as RemixLookPatch)}
          music={{ track: current.musicTrack, onChange: (track) => { if (track) change({ music: true, musicTrack: track }) } }}
          onMore={(id) => id === 'captions' ? () => setOpen(true) : undefined} />
        <div className="rounded-xl bg-white/[0.03]">
          <button type="button" className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span className="min-w-0">
              <span className="block text-sm text-ink">Captions and hook text look</span>
              <span className="block text-2xs text-ink-subtle" data-testid="review-look-summary">{summary}</span>
            </span>
            <ChevronDown className={cn('mt-0.5 h-4 w-4 shrink-0 text-ink-muted transition-transform', open && 'rotate-180')} aria-hidden />
          </button>
          {open && (
            <div className="px-3 pb-3">
              <StyleBoard value={board} rows={BOARD_ROWS} brand={brand} frame={previewFrame(frame)} hookText={hookText || undefined} title="This video’s look"
                onChange={(patch) => {
                  const out = lookPatch(fields, patch)
                  change({
                    ...(out.includeCaptions !== undefined ? { includeCaptions: out.includeCaptions } : {}),
                    ...(out.captionPreset !== undefined ? { captionPreset: out.captionPreset } : {}),
                    ...(out.headlineLook ? { headlineLook: out.headlineLook } : {})
                  })
                }} />
            </div>
          )}
        </div>
      </fieldset>
    </section>
  )
}
