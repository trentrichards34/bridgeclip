import type { Guide } from '../../shared/onboarding'

/** Each Make page's guide, opened by "How it works" in its header. */
export const PAGE_GUIDES: Readonly<Record<string, Guide['id']>> = {
  clip: 'clips',
  edit: 'edit-recording',
  remix: 'camera-reactions',
  brollvideo: 'broll-video',
  aivideo: 'ai-explainers'
}

let requested: Guide['id'] | null = null

/** A one-shot request for Guides to open at one guide ("How it works" on a Make page). */
export function requestGuide(id: Guide['id']): void {
  requested = id
}

export function takeGuide(): Guide['id'] | null {
  const id = requested
  requested = null
  return id
}

/** The pending request, without taking it. */
export function peekGuide(): Guide['id'] | null {
  return requested
}
