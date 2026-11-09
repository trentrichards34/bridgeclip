import { COLOR_GRADES, COLOR_GRADE_INFO, isColorGrade, type ColorGrade } from '../../shared/color-grade'
import { Select } from './ui/Select'

/**
 * The color grade for the footage (None, Warm, Cinematic, Film, Cool, Mono). Used on the Edit my recording review
 * and in the clip editor's look area. The graphics, captions and text keep their own colors.
 */
export function ColorGradePicker({ value, onChange, disabled, id }: {
  value: ColorGrade | undefined
  onChange: (grade: ColorGrade) => void
  disabled?: boolean
  id?: string
}): React.JSX.Element {
  const grade = value ?? 'none'
  return (
    <Select size="sm" id={id} aria-label="Color grade" value={grade} disabled={disabled} className="w-36"
      options={COLOR_GRADES.map((g) => ({ value: g, label: COLOR_GRADE_INFO[g].label }))}
      onChange={(next) => { if (isColorGrade(next)) onChange(next) }} />
  )
}
