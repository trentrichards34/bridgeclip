import lockupUrl from '../../../../resources/creatorclips-logo.svg'
import iconUrl from '../../../../resources/creatorclips-icon-small.svg'
import markUrl from '../../../../resources/creatorclips-mark.svg'
import { cn } from '../../lib/utils'

interface BridgeClipLogoProps {
  /**
   * lockup: CreatorClips emblem + wordmark (artwork is for dark surfaces).
   * icon:   the app icon tile: a lime 9:16 frame with a play button.
   * mark:   the mark alone, for tight spaces such as the collapsed sidebar.
   */
  variant?: 'lockup' | 'icon' | 'mark'
  /** Size by height (e.g. "h-6"); width follows the artwork. */
  className?: string
  alt?: string
}

/**
 * CreatorClips brand artwork. Regenerate the exports with
 * scripts/icon/build-creatorclips-brand.py.
 */
export function BridgeClipLogo({ variant = 'lockup', className, alt = 'CreatorClips' }: BridgeClipLogoProps): React.JSX.Element {
  return (
    <img
      src={variant === 'icon' ? iconUrl : variant === 'mark' ? markUrl : lockupUrl}
      alt={alt}
      draggable={false}
      className={cn('w-auto shrink-0 select-none', className)}
    />
  )
}
