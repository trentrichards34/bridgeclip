import type { CandidateEdit, EditorProject } from '../../shared/clip-editor'
import { captionAnchorAt } from '../../shared/graphic-layout'

/** Manual exports use these same layout anchors (layout_renderer.caption_anchor). */
export function captionAnchor(project: EditorProject, candidate: CandidateEdit, time: number): { y: number; bottom: boolean } {
  return captionAnchorAt(project, candidate, time)
}

