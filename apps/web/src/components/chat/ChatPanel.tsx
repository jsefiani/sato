import { useEffect, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { motion } from 'motion/react'
import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function ChatPanel() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState('')

  const { messages, sendMessage, status } = useChat({
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
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-border/70 bg-card/30 p-4"
      >
        {messages.map((message) => {
          const text = message.parts
            .map((p) => ('text' in p ? p.text : ''))
            .join('')

          if (!text) return null

          const isUser = (message.role as string) === 'user'

          return (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  isUser
                    ? 'bg-foreground text-primary-foreground'
                    : 'bg-secondary/80 text-foreground/90'
                }`}
              >
                {text}
              </div>
            </motion.div>
          )
        })}
        {isLoading &&
          (messages[messages.length - 1]?.role as string) === 'user' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-start"
            >
              <div className="flex items-center gap-1 rounded-2xl bg-secondary/80 px-4 py-3">
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
              </div>
            </motion.div>
          )}
      </div>

      <form onSubmit={handleSubmit} className="mt-3 flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={status !== 'ready'}
          className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-10 w-full min-w-0 rounded-xl border bg-transparent px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:ring-3"
        />
        <Button
          type="submit"
          size="sm"
          disabled={!input.trim() || status !== 'ready'}
          className="h-10 w-10 shrink-0 rounded-xl p-0"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      </form>
    </div>
  )
}
