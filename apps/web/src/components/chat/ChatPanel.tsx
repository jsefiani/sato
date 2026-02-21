import { useEffect, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import {
  Conversation,
  Message,
  MessageContent,
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  Response,
} from '@/components/ai-elements'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function ChatPanel() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState('')

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: '/api/vps/chat' }),
    messages: [
      {
        id: 'welcome',
        role: 'assistant',
        parts: [
          {
            type: 'text',
            text: "Hey! I'm your personal assistant. Ask me anything or just say hello — I'm here to help.",
          },
        ],
        createdAt: new Date(),
      },
    ],
  })

  const isLoading = status === 'streaming' || status === 'submitted'
  const rawErrorMessage = error?.message.trim() ?? null
  const chatErrorMessage = rawErrorMessage
    ? rawErrorMessage.includes('Assistant is still restarting')
      ? 'Assistant is restarting; message will work once warm-up finishes.'
      : rawErrorMessage
    : null

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return
    sendMessage({ text: input })
    setInput('')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Conversation ref={scrollRef}>
        {messages.map((message) => {
          const isUser = (message.role as string) === 'user'
          const renderedParts = message.parts.map((part, index) => {
            return isUser ? (
              <span
                key={`${message.id}-${index}`}
                className="whitespace-pre-wrap"
              >
                {part.text}
              </span>
            ) : (
              <Response key={`${message.id}-${index}`}>{part.text}</Response>
            )
          })

          return (
            <Message key={message.id} from={isUser ? 'user' : 'assistant'}>
              <MessageContent>{renderedParts}</MessageContent>
            </Message>
          )
        })}
        {isLoading &&
          (messages[messages.length - 1]?.role as string) === 'user' && (
            <Message from="assistant">
              <MessageContent className="py-3">
                <div className="flex items-center gap-1">
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
                </div>
              </MessageContent>
            </Message>
          )}
      </Conversation>

      {chatErrorMessage && (
        <Alert variant="warning" className="mt-2">
          <AlertDescription>{chatErrorMessage}</AlertDescription>
        </Alert>
      )}

      <PromptInput onSubmit={handleSubmit}>
        <PromptInputTextarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={status !== 'ready'}
          className="min-h-10"
        />
        <PromptInputToolbar>
          <PromptInputSubmit disabled={!input.trim() || status !== 'ready'} />
        </PromptInputToolbar>
      </PromptInput>
    </div>
  )
}
