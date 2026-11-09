import { normalizeVideoSource, twitchSourceError } from './video-source'

/** Most videos one Create submit queues; each becomes its own job with the same settings. */
export const MAX_CREATE_SOURCES = 10

/** Match the main process's HTTP(S) URL requirements before accepting a link. */
export function isValidSourceLink(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname) && !url.username && !url.password && !twitchSourceError(value)
  } catch {
    return false
  }
}

export interface ParsedSources {
  /** Valid links, normalized, in order, without repeats. */
  links: string[]
  /** Links (or text) that can't be used, for the error message. */
  invalid: string[]
}

/**
 * Every video link in pasted or dropped text: one per line, or several on a
 * line separated by spaces, commas or list numbering. `#` lines (uri-list
 * comments) are skipped. Text with no link at all counts as one invalid entry.
 */
export function parseSourceText(text: string): ParsedSources {
  const links: string[] = []
  const invalid: string[] = []
  const lines = String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
  for (const line of lines) {
    const found = line.match(/[a-z][a-z0-9+.-]*:\/\/[^\s,<>"']+/gi)
    if (!found) {
      invalid.push(line)
      continue
    }
    for (const raw of found) {
      const candidate = raw.replace(/[).;\]]+$/, '')
      if (!isValidSourceLink(candidate)) { invalid.push(candidate); continue }
      const link = normalizeVideoSource(candidate)
      if (!links.includes(link)) links.push(link)
    }
  }
  return { links, invalid }
}

/** Add sources to the list, keeping order, dropping repeats and stopping at the limit. */
export function mergeSources(current: readonly string[], added: readonly string[]): { sources: string[]; overLimit: number; duplicates: number } {
  const sources = [...current]
  let overLimit = 0
  let duplicates = 0
  for (const source of added) {
    if (sources.includes(source)) { duplicates++; continue }
    if (sources.length >= MAX_CREATE_SOURCES) { overLimit++; continue }
    sources.push(source)
  }
  return { sources, overLimit, duplicates }
}

/** A short "N videos will be clipped" line for the form. */
export function sourceCountLabel(count: number): string {
  return count === 1 ? '1 video will be clipped' : `${count} videos will be clipped`
}
