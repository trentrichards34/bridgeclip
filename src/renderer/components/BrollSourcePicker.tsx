import { useEffect, useState } from 'react'
import {
  aiEstimateLine, BROLL_AI_MODELS, brollSourceOptions, effectiveBrollSource, MAX_AI_SHOTS_PER_CLIP, usesAi, usesLibrary,
  type BrollAiSettings, type BrollSource
} from '../../shared/broll-library'
import { getApi } from '../lib/ipc'
import { errorMessage } from '../lib/utils'
import { useBrollContext, useBrollLibrary } from '../store/use-broll-library-store'
import { useSettingsStore } from '../store/use-settings-store'
import { Segmented } from './ui/Segmented'
import { Select } from './ui/Select'

/** Loads the library once for a page that shows the b-roll choice. */
export function useBrollLibraryLoaded(): void {
  useEffect(() => { if (!useBrollLibrary.getState().view) void useBrollLibrary.getState().load() }, [])
}

/** The source a form sends: the member's pick when it can run, otherwise the default (My library when it has clips; never AI unless picked). */
export function useEffectiveBrollSource(picked: BrollSource | null): BrollSource | null {
  const { usableShots } = useBrollContext()
  const pexels = useSettingsStore((s) => s.pexelsConfigured)
  const openrouter = useSettingsStore((s) => s.openrouterConfigured)
  return effectiveBrollSource(picked, { libraryShots: usableShots, pexels, openrouter })
}

/**
 * "B-roll from": My library, Stock (only with a Pexels key), AI-generated, or My library then AI for gaps.
 * Shows what the choice means, and the AI estimate before anything runs.
 */
export function BrollSourcePicker({ value, onChange, onOpenLibrary, disabled = false, current: given, emptyText }: {
  value: BrollSource | null
  onChange: (source: BrollSource) => void
  onOpenLibrary?: () => void
  disabled?: boolean
  /** The source in use when the member hasn't picked one, when the page decides it (null: none). */
  current?: BrollSource | null
  /** Shown when no source is in use. */
  emptyText?: string
}): React.JSX.Element {
  useBrollLibraryLoaded()
  const { usableShots, ai } = useBrollContext()
  const pexels = useSettingsStore((s) => s.pexelsConfigured)
  const openrouter = useSettingsStore((s) => s.openrouterConfigured)
  const options = brollSourceOptions({ libraryShots: usableShots, pexels, openrouter })
  const effective = useEffectiveBrollSource(value)
  const current = given === undefined ? effective : given
  const picked = options.find((option) => option.id === current)
  const noneText = emptyText ?? 'Choose where b-roll comes from. AI shots are made only when you pick them.'
  return (
    <div className="space-y-1.5" data-testid="broll-source">
      <p className="text-xs font-medium text-ink">B-roll from</p>
      <Select size="sm" aria-label="B-roll from" value={current ?? ''} placeholder={noneText} disabled={disabled}
        options={options.map((option) => ({ value: option.id, label: option.label, disabled: option.disabledReason !== null, ...(option.disabledReason ? { detail: option.disabledReason } : {}) }))}
        onChange={(next) => onChange(next as BrollSource)} />
      <p className="text-2xs text-ink-subtle">
        {picked?.detail ?? noneText}
        {current && usesLibrary(current) && ` ${usableShots} shot${usableShots === 1 ? '' : 's'} ready in your library.`}
        {onOpenLibrary && (
          <> <button type="button" className="text-accent hover:underline" onClick={onOpenLibrary}>Open my B-roll library</button></>
        )}
      </p>
      {current && usesAi(current) && <p className="text-2xs text-ink-subtle" data-testid="broll-ai-estimate">AI shots: {aiEstimateLine(ai)} Set the model and limit in Settings → AI b-roll.</p>}
    </div>
  )
}

/** Settings → AI b-roll: video or picture, the model (with its list price) and the limit per clip. */
export function BrollAiSettingsPanel(): React.JSX.Element {
  useBrollLibraryLoaded()
  const { ai } = useBrollContext()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async (next: BrollAiSettings): Promise<void> => {
    setSaving(true); setError(null)
    try { useBrollLibrary.getState().setAi(await getApi().brollLibrary.saveAi(next)) }
    catch (failure) { setError(errorMessage(failure)) }
    finally { setSaving(false) }
  }
  return (
    <div className="space-y-3" data-testid="broll-ai-settings">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink">What AI makes</p>
        <Segmented size="sm" label="What AI makes" value={ai.kind} onChange={(kind) => void save({ ...ai, kind })}
          options={[{ value: 'video', label: 'Video clip' }, { value: 'image', label: 'Picture + slow push-in' }]} />
      </div>
      {ai.kind === 'video' ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink">Video model</p>
          <Select size="sm" aria-label="AI b-roll video model" value={ai.model} disabled={saving} className="min-w-[260px]"
            options={BROLL_AI_MODELS.map((model) => ({ value: model.id, label: model.label,
              detail: model.perSecondUsd === null ? 'price on OpenRouter' : `about $${model.perSecondUsd.toFixed(2)}/s` }))}
            onChange={(model) => void save({ ...ai, model })} />
        </div>
      ) : <p className="text-2xs text-ink-subtle">A picture made with the image model the app already uses, with a slow push-in. Cheaper than a video clip.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink">At most, per clip</p>
        <Select size="sm" aria-label="AI shots per clip" value={String(ai.maxShots)} disabled={saving}
          options={Array.from({ length: MAX_AI_SHOTS_PER_CLIP + 1 }, (_, n) => ({ value: String(n), label: n === 0 ? 'No AI shots' : `${n} AI shot${n === 1 ? '' : 's'}` }))}
          onChange={(count) => void save({ ...ai, maxShots: Number(count) })} />
      </div>
      <p className="text-2xs text-ink-subtle">{aiEstimateLine(ai)} Prices are list prices; what OpenRouter reports is what’s recorded in Spending. AI shots are saved to your B-roll library, tagged “ai”, so you can use them again.</p>
      {error && <p className="text-2xs text-danger" role="alert">{error}</p>}
    </div>
  )
}
