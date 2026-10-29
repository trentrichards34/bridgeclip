import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { ArrowUp, CalendarClock, Film, History, Loader2, Scissors, Sparkles, SquarePen, Square, Trash2, Workflow } from 'lucide-react'
import {
  ASSISTANT_PROMPT_MAX_CHARS,
  ASSISTANT_PROVIDERS,
  type AssistantConversationSummary,
  type AssistantProviderId
} from '../../shared/assistant'
import { chosenProvider, useAssistantStore } from '../store/use-assistant-store'
import { ChatList } from '../components/assistant/ChatList'
import { ModelMenu } from '../components/assistant/ModelMenu'
import { ApprovalCard, AssistantReply, UserMessage } from '../components/assistant/MessageView'
import { ProviderLogo } from '../components/brand/ProviderLogo'
import { Button } from '../components/ui/Button'
import { Callout } from '../components/ui/Callout'
import { ActionMenu } from '../components/ui/ActionMenu'
import { ConfirmDialog, type ConfirmRequest } from '../components/ui/ConfirmDialog'
import { cn } from '../lib/utils'

const STARTERS = [
  { title: 'Clip a video', icon: Scissors, prompt: 'Clip the best moments from this video: ' },
  { title: 'Recent clips', icon: Film, prompt: 'Show me my most recent clips and which ones haven’t been posted yet.' },
  { title: 'Build an automation', icon: Workflow, prompt: 'Set up an automation that posts one clip a day to my connected accounts.' },
  { title: 'What’s scheduled?', icon: CalendarClock, prompt: 'What posts are scheduled or queued right now, and did anything fail?' }
]

/** The reading column shared by messages and the composer. */
const COLUMN = 'mx-auto w-full max-w-[760px] px-4 sm:px-6'

/** Chat with CreatorClips through the user's own Claude Code or Codex. */
export function AssistantPage({ onOpenSettings }: { onOpenSettings: (section?: 'assistant' | 'keys') => void }): React.JSX.Element {
  const store = useAssistantStore()
  const { conversation, activeId, running, approvals, statuses, preferences, draft, sending, error, conversations } = store
  const provider = chosenProvider(store)
  const connected = ASSISTANT_PROVIDERS.filter((id) => statuses[id]?.state === 'connected')
  const checked = ASSISTANT_PROVIDERS.every((id) => statuses[id] !== null)
  const busy = activeId !== null && running.includes(activeId)
  const needsRouterModel = provider === 'openrouter' && !preferences.models.openrouter
  const ready = provider !== null && statuses[provider]?.state === 'connected' && !needsRouterModel
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const closeConfirm = useCallback(() => setConfirm(null), [])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => { void store.init() }, [])
  // Re-check sign-in on each visit: the user may have signed in from a terminal.
  useEffect(() => { void useAssistantStore.getState().refreshStatus(true) }, [])

  const pending = approvals.filter((request) => request.conversationId === activeId)
  const elsewhere = approvals.filter((request) => request.conversationId !== activeId)
  const waiting = useMemo(() => new Set(approvals.map((request) => request.conversationId)), [approvals])

  // Follow the reply while the reader is at the bottom; leave them alone if they scrolled up.
  const onScroll = (): void => {
    const scroller = scrollRef.current
    if (scroller) stickToBottom.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120
  }
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller && stickToBottom.current) scroller.scrollTop = scroller.scrollHeight
  }, [conversation, pending.length])
  useEffect(() => { stickToBottom.current = true }, [activeId])

  const submit = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || busy || sending) return
    stickToBottom.current = true
    if (await store.send(text)) inputRef.current?.focus()
  }
  const newChat = (): void => {
    store.newChat()
    inputRef.current?.focus()
  }
  const confirmDelete = (chat: Pick<AssistantConversationSummary, 'id' | 'title'>): void => setConfirm({
    title: 'Delete this chat?',
    body: <>“{chat.title}” is removed from CreatorClips. Anything the assistant already did (clips, posts, automations) stays.</>,
    confirmLabel: 'Delete chat',
    onConfirm: () => void store.remove(chat.id)
  })
  const chooseModel = (id: AssistantProviderId, model: string): void => {
    void store.setPreferences({ provider: id, models: { ...preferences.models, [id]: model } })
    inputRef.current?.focus()
  }

  const history = conversations.slice(0, 25).map((item) => ({ label: item.title, onSelect: () => void store.open(item.id) }))

  const composer = (
    <Composer
      inputRef={inputRef}
      draft={draft}
      onDraft={store.setDraft}
      onSubmit={() => void submit()}
      onStop={() => void store.stop()}
      busy={busy}
      sending={sending}
      canSend={ready}
      placeholder={
        !checked ? 'Checking your assistants…'
          : !connected.length ? 'Connect Claude, OpenAI or OpenRouter to chat'
            : needsRouterModel ? 'Choose an OpenRouter model below to start'
              : conversation ? 'Reply to CreatorClips…' : 'Ask about your clips, or ask CreatorClips to do something…'
      }
      picker={(
        <ModelMenu
          provider={provider}
          models={preferences.models}
          statuses={statuses}
          onChoose={chooseModel}
          onConnect={(id) => onOpenSettings(id === 'openrouter' ? 'keys' : 'assistant')}
        />
      )}
    />
  )

  const waitingBanner = elsewhere.length > 0 && (
    <div role="status" className="mx-auto mt-3.5 flex w-full max-w-[1100px] flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-warning/30 bg-warning/[0.08] px-3.5 py-2.5">
      <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-warning shadow-[0_0_8px_rgb(var(--warning)/0.6)]" aria-hidden />
      <span className="min-w-0 flex-1 text-sm">
        <span className="font-semibold text-warning">Another chat is waiting for your approval</span>
        <span className="ml-2 truncate text-xs text-ink-muted">{elsewhere[0].title}</span>
      </span>
      <Button size="sm" onClick={() => void store.open(elsewhere[0].conversationId)}>Open it</Button>
    </div>
  )
  const errorCallout = error && <Callout tone="danger" className="mb-3" onDismiss={store.clearError}>{error}</Callout>

  return (
    <div className="flex h-full min-h-0 animate-fade">
      <ChatList
        className="hidden lg:flex"
        conversations={conversations}
        activeId={activeId}
        running={running}
        waiting={waiting}
        onOpen={(id) => void store.open(id)}
        onNew={newChat}
        onDelete={confirmDelete}
      />

      <section aria-label="Conversation" className="flex min-w-0 flex-1 flex-col px-4 sm:px-6 lg:pl-3 xl:pr-8">
        <header className={cn('flex h-11 shrink-0 items-center gap-1', conversation ? 'mt-1.5 border-b border-line' : 'lg:hidden')}>
          <div className="lg:hidden">
            <ActionMenu label="Recent chats" icon={<History className="h-4 w-4" />} actions={history} disabled={history.length === 0} />
          </div>
          <h1 className="min-w-0 flex-1 truncate px-1.5 font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">{conversation?.title}</h1>
          {conversation && (
            <>
              <Button variant="ghost" size="sm" iconOnly aria-label="Delete this chat" tooltip="Delete this chat" icon={<Trash2 className="h-3.5 w-3.5" />} disabled={busy} onClick={() => confirmDelete(conversation)} />
              <Button variant="ghost" size="sm" iconOnly aria-label="New chat" tooltip="New chat" className="lg:hidden" icon={<SquarePen className="h-3.5 w-3.5" />} onClick={newChat} />
            </>
          )}
        </header>
        {waitingBanner}

        {conversation ? (
          <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
            <div className={cn(COLUMN, 'space-y-7 pb-8 pt-6')}>
              {conversation.messages.map((message, index) => message.role === 'user'
                ? <UserMessage key={message.id} message={message} />
                : (
                  <AssistantReply
                    key={message.id}
                    message={message}
                    provider={conversation.provider}
                    model={conversation.model}
                    working={busy && index === conversation.messages.length - 1}
                  />
                ))}
              {pending.map((request) => <ApprovalCard key={request.id} request={request} onAnswer={(allowed) => void store.approve(request.id, allowed)} />)}
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className={cn(COLUMN, 'flex min-h-full flex-col justify-end pb-5 pt-8')}>
              <div className="flex items-start gap-3">
                {provider && connected.length > 0
                  ? <ProviderLogo provider={provider} variant="tile" size="sm" />
                  : (
                    <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-[linear-gradient(135deg,rgb(var(--tool-remix)),rgb(var(--tool-avatar)))] text-white">
                      <Sparkles className="h-3.5 w-3.5" />
                    </span>
                  )}
                <div className="min-w-0 pt-0.5">
                  <h1 className="font-display text-lg font-semibold tracking-[-0.01em] text-ink">What should we make today?</h1>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    Clip a video, review your Library, build an automation or schedule posts. Just ask.
                  </p>
                </div>
              </div>

              {checked && connected.length === 0 ? (
                <div className="glass mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl p-4">
                  <div className="min-w-[220px] flex-1">
                    <p className="text-sm font-semibold text-ink">Connect Claude, OpenAI or OpenRouter to start</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      Chat runs on Claude Code (Claude Pro or Max) or Codex (ChatGPT plan) signed in on this computer, or on any OpenRouter model with your OpenRouter API key.
                    </p>
                  </div>
                  <Button variant="primary" onClick={() => onOpenSettings()}>Connect</Button>
                </div>
              ) : (
                <div className="mt-3.5 flex flex-wrap gap-2 pl-10">
                  {STARTERS.map(({ title, icon: Icon, prompt }) => (
                    <button
                      key={title}
                      type="button"
                      title={prompt}
                      disabled={connected.length === 0}
                      onClick={() => {
                        store.setDraft(prompt)
                        const input = inputRef.current
                        input?.focus()
                        input?.setSelectionRange(prompt.length, prompt.length)
                      }}
                      className="flex h-8 items-center gap-2 rounded-full bg-white/[0.04] px-3.5 text-xs text-ink-muted shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)] transition-colors duration-150 enabled:hover:bg-white/[0.08] enabled:hover:text-ink disabled:opacity-50"
                    >
                      <Icon aria-hidden className="h-3.5 w-3.5 text-tool" />
                      {title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <div className={cn(COLUMN, 'shrink-0 pb-5')}>
          {errorCallout}
          {composer}
        </div>
      </section>

      {confirm && <ConfirmDialog request={confirm} onClose={closeConfirm} />}
    </div>
  )
}

function Composer({ inputRef, draft, onDraft, onSubmit, onStop, busy, sending, canSend, placeholder, picker }: {
  inputRef: RefObject<HTMLTextAreaElement | null>
  draft: string
  onDraft: (draft: string) => void
  onSubmit: () => void
  onStop: () => void
  busy: boolean
  sending: boolean
  canSend: boolean
  placeholder: string
  picker: React.JSX.Element
}): React.JSX.Element {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      onSubmit()
    }
  }
  return (
    <div
      onPointerDown={(event) => {
        // Pressing the composer's padding focuses the text box, as in a text field.
        if (event.target === event.currentTarget) { event.preventDefault(); inputRef.current?.focus() }
      }}
      className={cn(
        'glass cursor-text rounded-2xl p-2 transition-shadow duration-200',
        'focus-within:shadow-[inset_0_0_0_1px_rgb(var(--accent)/0.55),0_0_0_3px_rgb(var(--accent)/0.12),0_18px_48px_-24px_rgb(0_0_0/0.6)]'
      )}
    >
      <textarea
        ref={inputRef}
        autoFocus
        aria-label="Message CreatorClips"
        rows={1}
        maxLength={ASSISTANT_PROMPT_MAX_CHARS}
        value={draft}
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={!canSend}
        className="block max-h-60 min-h-[44px] w-full resize-none bg-transparent px-2 pt-1.5 text-base leading-relaxed text-ink placeholder:text-ink-subtle focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed [field-sizing:content]"
      />
      <div className="flex items-center gap-2 pl-2">
        <span className="hidden min-w-0 flex-1 select-none truncate text-2xs text-ink-subtle md:block">
          Posting, deleting and spending API credit always ask you first
        </span>
        <span className="ml-auto flex min-w-0 items-center gap-1.5 md:ml-0">
          {picker}
          {busy ? (
            <Button variant="secondary" iconOnly aria-label="Stop" tooltip="Stop the reply" className="rounded-full" icon={<Square className="h-3 w-3 fill-current" />} onClick={onStop} />
          ) : (
            <button
              type="button"
              aria-label="Send"
              title="Send (Enter). Shift+Enter starts a new line."
              disabled={!draft.trim() || sending || !canSend}
              onClick={onSubmit}
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-[filter,transform,background] duration-150 active:scale-95 motion-reduce:active:scale-100',
                'enabled:bg-[linear-gradient(135deg,rgb(var(--tool-remix)),rgb(var(--tool-avatar)))] enabled:text-white enabled:shadow-[0_6px_18px_-8px_rgb(var(--tool-remix)/0.8)] enabled:hover:brightness-110',
                'disabled:bg-white/[0.07] disabled:text-ink-faint'
              )}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" strokeWidth={2.4} />}
            </button>
          )}
        </span>
      </div>
    </div>
  )
}
