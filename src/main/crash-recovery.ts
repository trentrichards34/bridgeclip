/**
 * Crash recovery in the main process: what to say when the window's page
 * process goes away (a blank window otherwise), and a once-per-session notice
 * for an unexpected main-process error (logged either way, never silent).
 */

/** Electron's RenderProcessGoneDetails reasons. */
export type GoneReason = 'clean-exit' | 'abnormal-exit' | 'killed' | 'crashed' | 'oom' | 'launch-failed' | 'integrity-failure' | 'memory-eviction'

/** A page process that ended on purpose (a reload or quit) needs nothing; anything else gets the reload offer. */
export function offerReloadAfter(reason: string): boolean {
  return reason !== 'clean-exit'
}

/** The dialog after the window's page process ended. */
export function rendererGoneMessage(reason: string): { message: string; detail: string; buttons: [string, string] } {
  const memory = reason === 'oom' || reason === 'memory-eviction'
  return {
    message: 'CreatorClips needs to reload',
    detail: (memory
      ? 'The window ran out of memory and stopped. '
      : 'The window stopped unexpectedly. ') +
      'Reload to keep working. If this keeps happening, use Help → Report an Issue.',
    buttons: ['Reload', 'Quit']
  }
}

/** Calls `show` for the first unexpected main-process error only, so a burst of errors is one notice. */
export function onceNotifier(show: () => void): () => boolean {
  let shown = false
  return () => {
    if (shown) return false
    shown = true
    try { show() } catch { /* a notice must never throw from an error handler */ }
    return true
  }
}

export const MAIN_ERROR_NOTICE = {
  message: 'Something went wrong in CreatorClips',
  detail: 'It was saved to the log. If something stops working, quit and reopen CreatorClips. If it keeps happening, use Help → Report an Issue.'
} as const
