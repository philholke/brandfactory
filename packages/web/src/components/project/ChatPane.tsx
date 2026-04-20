import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Send, Square } from 'lucide-react'
import type { AgentMessage } from '@brandfactory/shared'
import { useAgentChat } from '@/agent/useAgentChat'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function ChatPane({ projectId, messages }: { projectId: string; messages: AgentMessage[] }) {
  const { status, send, stop } = useAgentChat(projectId)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedToBottomRef = useRef(true)

  // Autoscroll to bottom when new messages arrive, unless the user has
  // scrolled up. `scrollHeight - scrollTop - clientHeight < 32` is "near the
  // bottom"; we only autoscroll while pinned there.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !pinnedToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [messages, status])

  const submit = () => {
    const text = draft
    if (!text.trim() || status === 'streaming') return
    setDraft('')
    void send(text)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b p-3 text-sm font-medium">Chat</div>
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          pinnedToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32
        }}
        className="flex-1 overflow-y-auto p-4"
      >
        {messages.length === 0 && status === 'idle' ? (
          <p className="text-sm text-muted-foreground">
            Start a conversation to ideate with the agent. It has your brand context loaded.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {status === 'streaming' ? (
              <div className="text-xs text-muted-foreground">Thinking…</div>
            ) : null}
          </div>
        )}
      </div>
      <div className="border-t p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
          className="flex items-end gap-2"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Cmd/Ctrl+Enter submits; Enter inserts a newline.
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder="Message the agent…  (⌘+Enter to send)"
            rows={2}
            className="min-h-[44px] flex-1 resize-y rounded-md border bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={status === 'streaming'}
          />
          {status === 'streaming' ? (
            <Button type="button" variant="outline" size="icon" onClick={stop}>
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="submit" size="icon" disabled={!draft.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          )}
        </form>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: AgentMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        )}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          <div className="prose prose-sm max-w-none break-words dark:prose-invert [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
