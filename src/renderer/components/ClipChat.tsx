import { getApi } from '../lib/ipc'
import { ChatPanel, type ChatApplyOutcome } from './ChatPanel'
import { CHAT_GRAPHIC_SUGGESTIONS, CHAT_MAX_MESSAGE_CHARS, CHAT_POINT_SUGGESTIONS, CHAT_SELECTED_GRAPHIC_SUGGESTIONS, CHAT_SUGGESTIONS, chatClock, parseChatSteps, type ChatPatch, type ChatStep } from '../../shared/clip-chat'
import { nearestOutputTime, templateInfo, type EditorGraphic } from '../../shared/motion-graphics'
import { candidateEdit, type EditorCandidate } from '../../shared/clip-editor'

/** What applying a chat answer changed, so its card can undo it. */
export interface ChatApplied { clipId: string; before: ChatPatch; afterKey: string }
export type ChatApplyResult = ChatApplyOutcome<ChatApplied>

/** The thread a clip's chat (and its pins on the Output preview) belong to. */
export const clipChatThread = (outputDir: string, candidateId: string): string => `${outputDir}\n${candidateId}`

/** What "here" and "this" mean to the chat: the playhead and the selected graphic, as a note after the member's words. */
export function editorNote(candidate: EditorCandidate, playheadMs: number, selected: EditorGraphic | null): string {
  const at = Math.round(playheadMs)
  return `[Editor: the playhead is at ${at} ms source (${chatClock(nearestOutputTime(candidate, at))} in the clip).${selected ? ` The selected graphic is ${selected.id} (${templateInfo(selected.template).label.toLowerCase()}).` : ' No graphic is selected.'}]`
}

/** The clip editor's Chat tab: the shared chat panel on the open clip (applied through the editor's change()). */
export function ClipChat({ outputDir, candidate, disabledReason, apply, undo, play, playheadMs, selectedGraphic, autoSend }: {
  outputDir: string
  candidate: EditorCandidate
  /** Why editing is off right now (busy, discarded), or null. */
  disabledReason: string | null
  apply: (steps: ChatStep[]) => ChatApplyResult
  undo: (applied: ChatApplied) => string | null
  play: (at: number, seconds: number) => void
  /** Where the playhead is (source ms) and the graphic selected, so "here" and "this" mean them. */
  playheadMs?: number
  selectedGraphic?: EditorGraphic | null
  autoSend?: { id: number; text: string } | null
}): React.JSX.Element {
  const api = getApi().editor
  const selected = selectedGraphic ?? null
  const suggestions = [...CHAT_GRAPHIC_SUGGESTIONS, ...(selected ? CHAT_SELECTED_GRAPHIC_SUGGESTIONS : []), ...CHAT_SUGGESTIONS]
  const withNote = (message: string, pinned: boolean): string => {
    // Pins say where "here" is; without them, the playhead and the selected graphic do.
    if (playheadMs === undefined || pinned) return message
    const note = editorNote(candidate, playheadMs, selected)
    return `${message.slice(0, CHAT_MAX_MESSAGE_CHARS - note.length - 2)}\n\n${note}`
  }
  return <ChatPanel<ChatStep, ChatApplied>
    threadKey={clipChatThread(outputDir, candidate.id)}
    label="Chat about this clip"
    intro="Ask for a change in your own words, like “start with the laugh before she answers”. Changes go through Undo like any edit."
    placeholder="Ask for a change to this clip"
    suggestions={suggestions} autoSend={autoSend}
    disabledReason={disabledReason}
    loadInfo={typeof api.chatInfo === 'function' ? () => api.chatInfo() : undefined}
    ask={(message, points) => api.chat(outputDir, candidateEdit(candidate), withNote(message, points.length > 0), points)}
    point={{ suggestions: CHAT_POINT_SUGGESTIONS, hint: 'To show a spot, use Point on the Output preview, then ask, like “put an arrow here”.' }}
    parseSteps={parseChatSteps}
    isEdit={(s) => Object.keys(s.patch).length > 0}
    replayOf={(steps) => { const s = steps.find((x) => x.tool === 'play' && x.focus_ms !== null); return s ? { at: s.focus_ms!, seconds: s.play_seconds || 3 } : null }}
    apply={apply} undo={undo} play={play}
    onReset={() => { void api.chatReset?.(outputDir, candidate.id).catch(() => {}) }}
    clearTooltip="Start a new chat about this clip. Your edits stay." switchedMessage="You switched clips, so these changes were not made." />
}
