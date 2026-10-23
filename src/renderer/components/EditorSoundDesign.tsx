import type { CandidateSound } from '../../shared/sound-design'
import { DEFAULT_SOUND_REGISTER, SOUND_REGISTER_INFO, SOUND_REGISTERS } from '../../shared/sound-design'
import { Segmented } from './ui/Segmented'
import { Switch } from './ui/Switch'

/**
 * The clip's sound effects in the clip editor's Captions tab: on or off, and how much plays. The sounds follow the
 * clip's graphics and scenes, so moving a graphic moves its sound; Bake mixes them. Only clips made with sound
 * (edited reels) have the setting.
 */
export function EditorSoundDesign({ value, onChange }: {
  value: CandidateSound | undefined
  onChange: (next: CandidateSound) => void
}): React.JSX.Element | null {
  if (!value) return null
  const register = value.register ?? DEFAULT_SOUND_REGISTER
  return (
    <section className="space-y-2 border-t border-white/10 pt-3" aria-label="Sound effects" data-testid="editor-sound-design">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink">Sound effects</p>
          <p className="text-2xs leading-snug text-ink-subtle">Each lands as its graphic or scene comes in. Mixed when you bake.</p>
        </div>
        <Switch label="Sound effects" checked={value.on} onChange={(on) => onChange({ ...value, on })} />
      </div>
      {value.on && <>
        <Segmented size="sm" label="How much sound" value={register}
          options={SOUND_REGISTERS.map((id) => ({ value: id, label: SOUND_REGISTER_INFO[id].label }))}
          onChange={(next) => onChange({ ...value, register: next })} />
        <p className="text-2xs leading-snug text-ink-subtle">{SOUND_REGISTER_INFO[register].detail}</p>
      </>}
    </section>
  )
}
