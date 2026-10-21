/**
 * Edit my recording's review: spot a pop-up that repeats what a graphic shows
 * at about the same time ("15 billion" as a pop-up while a stat graphic counts
 * up to 15 billion), so the member can turn the pop-up off in one click.
 */

/** How close (seconds) a pop-up and a graphic must be to count as the same moment. */
export const DUPLICATE_WINDOW_SECONDS = 3

export interface DuplicatePopup { id: number; text: string; at: number }
export interface DuplicateShown {
  /** How the review names it ("the stat graphic on “Fifteen”"). */
  label: string
  /** Every bit of text it shows (title, number, items). */
  texts: string[]
  start: number
  end: number
}
export interface DuplicateExtra { popup: number; text: string; other: string }

const words = (text: string): string[] => text.toLowerCase().replace(/[“”"'’]/g, '').split(/[^a-z0-9%$]+/).filter(Boolean)
const numbers = (text: string): string[] => (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, '').replace(/\.0+$/, ''))

/** The pop-up's text is shown by the other too: a number they share, or all of its words in the other's text. */
export function sameExtraText(popup: string, texts: readonly string[]): boolean {
  const mine = words(popup)
  if (!mine.length) return false
  const nums = numbers(popup)
  for (const text of texts) {
    if (nums.length && numbers(text).some((n) => nums.includes(n))) return true
    const theirs = ` ${words(text).join(' ')} `
    if (mine.join('').length >= 3 && theirs.includes(` ${mine.join(' ')} `)) return true
  }
  return false
}

/** Each pop-up that repeats a graphic's text within a few seconds of it (one entry per pop-up). */
export function findDuplicateExtras(popups: readonly DuplicatePopup[], shown: readonly DuplicateShown[], window = DUPLICATE_WINDOW_SECONDS): DuplicateExtra[] {
  const out: DuplicateExtra[] = []
  for (const popup of popups) {
    const match = shown.find((item) => popup.at >= item.start - window && popup.at <= item.end + window && sameExtraText(popup.text, item.texts))
    if (match) out.push({ popup: popup.id, text: popup.text.trim(), other: match.label })
  }
  return out
}
