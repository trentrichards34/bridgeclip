// Reads CHANGELOG.md (Keep a Changelog layout) for the in-app changelog and
// the release check that keeps it in step with package.json.

/** Keep a Changelog's change types, in the order a release lists them. */
export const CHANGELOG_CATEGORIES = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'] as const

export const UNRELEASED = 'Unreleased'

/**
 * The last BridgeClip version: CreatorClips is built on BridgeClip by BridgeMind (MIT).
 * CHANGELOG.md keeps only a one-line credit for it (its history is in docs/BRIDGECLIP-HISTORY.md),
 * and the app shows that section as "Earlier versions".
 */
export const BRIDGECLIP_LAST_VERSION = '0.1.19'

function versionParts(version: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  return match ? match.slice(1).map(Number) : null
}

/** Negative when a is older than b, 0 when equal, positive when newer; null when either isn't X.Y.Z. */
export function compareVersions(a: string, b: string): number | null {
  const left = versionParts(a)
  const right = versionParts(b)
  if (!left || !right) return null
  return left.reduce((order, part, index) => order || part - right[index], 0)
}

/** A BridgeClip-era section (0.1.19 or older). */
export function isBridgeClipRelease(version: string): boolean {
  const order = compareVersions(version, BRIDGECLIP_LAST_VERSION)
  return order !== null && order <= 0
}

export interface ChangelogSection {
  heading: string
  items: string[]
}

export interface ChangelogRelease {
  /** `Unreleased` or a version such as `0.1.19`. */
  version: string
  /** `YYYY-MM-DD` for released versions. */
  date: string | null
  /** Paragraphs between the version heading and its first change type. */
  notes: string[]
  sections: ChangelogSection[]
}

export interface ChangelogText {
  kind: 'text' | 'strong' | 'code'
  text: string
}

const RELEASE_HEADING = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?$/
const SECTION_HEADING = /^### (.+)$/
const ITEM = /^[-*] +(.*)$/
const LINK_DEFINITION = /^\[[^\]]+\]: +\S+$/

/**
 * Releases in file order. Text before the first release, link definitions and
 * HTML comments are skipped; wrapped lines join the item or paragraph above.
 */
export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = []
  let release: ChangelogRelease | null = null
  let section: ChangelogSection | null = null
  /** The list whose last entry a wrapped line continues. */
  let open: string[] | null = null

  for (const raw of markdown.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) { open = null; continue }
    const heading = RELEASE_HEADING.exec(line)
    if (heading) {
      release = { version: heading[1].trim(), date: heading[2] ?? null, notes: [], sections: [] }
      releases.push(release)
      section = null
      open = null
      continue
    }
    if (/^#{1,2} /.test(line)) { release = null; continue }
    if (!release || LINK_DEFINITION.test(line)) continue
    const sectionHeading = SECTION_HEADING.exec(line)
    if (sectionHeading) {
      section = { heading: sectionHeading[1].trim(), items: [] }
      release.sections.push(section)
      open = null
      continue
    }
    const item = section && /^[-*] /.test(raw) ? ITEM.exec(line) : null
    if (item && section) {
      section.items.push(item[1])
      open = section.items
    } else if (open) {
      open[open.length - 1] += ` ${line}`
    } else {
      open = section ? section.items : release.notes
      open.push(line)
    }
  }
  return releases
}

export function hasChanges(release: ChangelogRelease): boolean {
  return release.notes.length > 0 || release.sections.some((section) => section.items.length > 0)
}

/** Bold and inline code. Links keep only their text: the app opens a fixed set of URLs. */
export function parseChangelogText(text: string): ChangelogText[] {
  const plain = text.replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
  const parts: ChangelogText[] = []
  let at = 0
  for (const match of plain.matchAll(/\*\*(.+?)\*\*|`([^`]+)`/g)) {
    const index = match.index ?? 0
    if (index > at) parts.push({ kind: 'text', text: plain.slice(at, index) })
    parts.push(match[1] != null ? { kind: 'strong', text: match[1] } : { kind: 'code', text: match[2] })
    at = index + match[0].length
  }
  if (at < plain.length) parts.push({ kind: 'text', text: plain.slice(at) })
  return parts
}

/**
 * "What's new" on launch: 'show' once after an update (the app starts on a newer version than last ran),
 * 'record' when the version should just be remembered (first install, a downgrade, a guided setup still
 * to do, or nothing recorded yet), 'none' when nothing changed.
 */
export function whatsNewOnLaunch(lastSeen: string, current: string, firstRun: boolean): 'show' | 'record' | 'none' {
  if (lastSeen === current) return 'none'
  if (firstRun || !lastSeen) return 'record'
  const order = compareVersions(current, lastSeen)
  return order !== null && order > 0 ? 'show' : 'record'
}
