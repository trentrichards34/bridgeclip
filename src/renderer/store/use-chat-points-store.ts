import { create } from 'zustand'
import { MAX_CHAT_POINTS, type ChatPoint } from '../../shared/chat-point'

/**
 * Pins the member put on a chat place's preview, per chat thread (a clip, a
 * review, a take), until the next message is sent. `pointing`: the thread
 * whose preview is waiting for a click (null: none).
 */
interface ChatPointsState {
  points: Record<string, ChatPoint[]>
  pointing: string | null
  /** Adds a pin with the lowest free number (no-op at 3). */
  add: (thread: string, point: Omit<ChatPoint, 'n'>) => void
  remove: (thread: string, n: number) => void
  clear: (thread: string) => void
  setPointing: (thread: string | null) => void
}

export const useChatPointsStore = create<ChatPointsState>((set) => ({
  points: {},
  pointing: null,
  add: (thread, point) => set((s) => {
    const list = s.points[thread] ?? []
    if (list.length >= MAX_CHAT_POINTS) return s
    let n = 1
    while (list.some((p) => p.n === n)) n++
    return { points: { ...s.points, [thread]: [...list, { ...point, n }].sort((a, b) => a.n - b.n) } }
  }),
  remove: (thread, n) => set((s) => ({ points: { ...s.points, [thread]: (s.points[thread] ?? []).filter((p) => p.n !== n) } })),
  clear: (thread) => set((s) => {
    if (!s.points[thread]?.length && s.pointing !== thread) return s
    const points = { ...s.points }
    delete points[thread]
    return { points, pointing: s.pointing === thread ? null : s.pointing }
  }),
  setPointing: (pointing) => set({ pointing })
}))

const NONE: ChatPoint[] = []
/** A thread's pins (a stable empty list when there are none). */
export const useThreadPoints = (thread: string | undefined): ChatPoint[] => useChatPointsStore((s) => (thread && s.points[thread]) || NONE)
