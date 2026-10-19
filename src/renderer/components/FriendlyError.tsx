import { friendlyError } from '../lib/friendly-error'

/** An error in plain words; raw technical text goes under a collapsed "Details" (for Report an issue). */
export function FriendlyError({ error, suffix }: { error: string | null | undefined; suffix?: string }): React.JSX.Element {
  const { message, detail } = friendlyError(error)
  return (
    <>
      {message}{suffix ? ` ${suffix}` : ''}
      {detail && (
        <details className="mt-1.5 text-2xs text-ink-muted">
          <summary className="cursor-pointer">Details</summary>
          <p className="mt-1 whitespace-pre-wrap break-words font-mono" data-selectable>{detail}</p>
        </details>
      )}
    </>
  )
}
