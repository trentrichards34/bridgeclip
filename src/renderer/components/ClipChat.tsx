import { getApi } from '../lib/ipc'
import { ChatPanel, type ChatApplyOutcome } from './ChatPanel'
import { CHAT_POINT_SUGGESTIONS, CHAT_SUGGESTIONS, parseChatSteps, type ChatPatch, type ChatStep } from '../../shared/clip-chat'
import { candidateEdit, type EditorCandidate } from '../../shared/clip-editor'

/** What applying a chat answer changed, so its card can undo it. */
export interface ChatApplied { clipId: string; before: ChatPatch; afterKey: string }
export type ChatApplyResult = ChatApplyOutcome<ChatApplied>

/** The thread a clip's chat (and its pins on the Output preview) belong to. */
export const clipChatThread = (outputDir: string, candidateId: string): string => `${outputDir}\n${candidateId}`

/** The clip editor's Chat tab: the shared chat panel on the open clip (applied through the editor's change()). */
export function ClipChat({ outputDir, candidate, disabledReason, apply, undo, play }: {
  outputDir: string
  candidate: EditorCandidate
  /** Why editing is off right now (busy, discarded), or null. */
  disabledReason: string | null
  apply: (steps: ChatStep[]) => ChatApplyResult
  undo: (applied: ChatApplied) => string | null
  play: (at: number, seconds: number) => void
}): React.JSX.Element {
  const api = getApi().editor
  return <ChatPanel<ChatStep, ChatApplied>
    threadKey={clipChatThread(outputDir, candidate.id)}
    label="Chat about this clip"
    intro="Ask for a change in your own words, like “start with the laugh before she answers”. Changes go through Undo like any edit."
    placeholder="Ask for a change to this clip"
    suggestions={CHAT_SUGGESTIONS}
    disabledReason={disabledReason}
    loadInfo={typeof api.chatInfo === 'function' ? () => api.chatInfo() : undefined}
    ask={(message, points) => api.chat(outputDir, candidateEdit(candidate), message, points)}
    point={{ suggestions: CHAT_POINT_SUGGESTIONS, hint: 'To show a spot, use Point on the Output preview, then ask, like “put an arrow here”.' }}
    parseSteps={parseChatSteps}
    isEdit={(s) => Object.keys(s.patch).length > 0}
    replayOf={(steps) => { const s = steps.find((x) => x.tool === 'play' && x.focus_ms !== null); return s ? { at: s.focus_ms!, seconds: s.play_seconds || 3 } : null }}
    apply={apply} undo={undo} play={play}
    onReset={() => { void api.chatReset?.(outputDir, candidate.id).catch(() => {}) }}
    clearTooltip="Start a new chat about this clip. Your edits stay." switchedMessage="You switched clips, so these changes were not made." />
}
