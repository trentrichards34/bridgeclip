import { DEFAULT_SCENE_AMOUNT, SCENE_AMOUNT_LABELS, SCENE_AMOUNTS, type SceneAmount } from '../../shared/custom-scenes'
import { formatSpendUsd } from '../../shared/spending'
import { Segmented } from './ui/Segmented'

export type SceneAmountEstimates = Record<SceneAmount, { scenes: number; expectedUsd: number; mostUsd: number }>

const DETAILS: Record<SceneAmount, string> = {
  light: 'A few scenes on your strongest teaching parts.',
  standard: 'A scene on most of your teaching parts.',
  full: 'Scenes over all your teaching parts.'
}

/**
 * The Custom graphics skill's Scenes choice (Edit my recording's review): how many 15-20 s scenes the AI designs. Each
 * option shows its estimate for this reel (it changes with the reel's length); every scene gets full quality either way.
 */
export function SceneAmountPicker({ value, estimates, onChange }: { value: SceneAmount | undefined; estimates: SceneAmountEstimates | null | undefined; onChange: (amount: SceneAmount) => void }): React.JSX.Element {
  const chosen = value ?? DEFAULT_SCENE_AMOUNT
  const mine = estimates?.[chosen]
  return (
    <div className="flex flex-col gap-1.5" data-testid="scene-amount">
      <Segmented label="Scenes" size="sm" value={chosen} onChange={onChange}
        options={SCENE_AMOUNTS.map((amount) => ({ value: amount, label: estimates ? `${SCENE_AMOUNT_LABELS[amount]} · ~${formatSpendUsd(estimates[amount].expectedUsd)}` : SCENE_AMOUNT_LABELS[amount] }))} />
      <p className="text-2xs text-ink-subtle" data-testid="scene-amount-detail">
        {DETAILS[chosen]}
        {mine ? ` About ${mine.scenes} scene${mine.scenes === 1 ? '' : 's'} on this reel, about ${formatSpendUsd(mine.expectedUsd)} (at most ${formatSpendUsd(mine.mostUsd)}).` : ''}
        {' '}Every scene gets the same quality; fewer scenes cost less.
      </p>
    </div>
  )
}
