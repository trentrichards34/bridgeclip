/**
 * Raw engine or Python error text ("transcribe_audio() missing 1 required
 * positional argument", a traceback, "KeyError: 'x'") means nothing to a
 * member. Such text becomes one plain sentence, with the original kept as the
 * detail for "Report an issue". The plain messages the engine and the app
 * already write pass through unchanged.
 */

export const FRIENDLY_ERROR = 'Something went wrong while making this. Try again; if it keeps happening, use Report an issue.'

const TECHNICAL = [
  /Traceback \(most recent call last\)/,
  /\bFile "[^"]+", line \d+/,
  /\b(?:missing|takes) \d+ (?:required )?positional arguments?\b/,
  /\bgot an unexpected keyword argument\b/,
  /\b(?:has|have) no attribute\b/,
  /'NoneType' object/,
  /\bobject is not (?:subscriptable|callable|iterable)\b/,
  /\b(?:list|string|tuple) index out of range\b/,
  /\b(?:Type|Key|Attribute|Index|Name|Value|Runtime|Assertion|Import|ModuleNotFound|ZeroDivision|Unbound(?:Local)?|NotImplemented|Recursion|OS|JSONDecode|CalledProcess)Error\b[:(]/,
  /\b[A-Za-z_]+(?:\.[A-Za-z_]+)+Error\b/,
  /\b[a-z_][a-z0-9_]*\(\) (?:missing|takes|got)\b/,
  /\bTypeError: /, /\bReferenceError: /, /\bSyntaxError: /,
  /\bERR_[A-Z_]{4,}\b/,
  /\bexit (?:code|status) -?\d+\b/i,
  /\bSIG(?:SEGV|KILL|ABRT|TERM)\b/,
  /\.py\b.*\bline \d+/
]

/** Whether this reads like raw program output rather than a sentence written for the member. */
export function isTechnicalError(message: string): boolean {
  return TECHNICAL.some((pattern) => pattern.test(message))
}

/** The message to show, and the technical detail to tuck away (null when the message is already plain). */
export function friendlyError(message: string | null | undefined): { message: string; detail: string | null } {
  const text = (message ?? '').trim()
  if (!text) return { message: FRIENDLY_ERROR, detail: null }
  return isTechnicalError(text) ? { message: FRIENDLY_ERROR, detail: text } : { message: text, detail: null }
}
