import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView } from 'motion/react'
import { ArrowUp, Battery, Signal, Wifi } from 'lucide-react'
import SatoAvatar from '@/components/SatoAvatar'

const messages = [
  {
    role: 'assistant' as const,
    text: 'Good morning, Sarah! ☀️ You slept 7h 42m, your best this week.',
  },
  {
    role: 'assistant' as const,
    text: 'Your day:\n10am Design review\n1pm Lunch with Nadia\n4:30 Yoga 🧘',
  },
  {
    role: 'user' as const,
    text: 'Thanks! Anything I should know?',
  },
  {
    role: 'assistant' as const,
    text: "Nadia's birthday is Friday, want me to find a gift? Also, you hit your reading goal this month! 📚",
  },
  {
    role: 'user' as const,
    text: "Wow yes please, you're the best ✨",
  },
]

const timeline: Array<{
  action: 'typing' | 'message'
  index?: number
  at: number
}> = [
  { action: 'typing', at: 300 },
  { action: 'message', index: 0, at: 1300 },
  { action: 'typing', at: 1800 },
  { action: 'message', index: 1, at: 3000 },
  { action: 'message', index: 2, at: 3800 },
  { action: 'typing', at: 4300 },
  { action: 'message', index: 3, at: 5800 },
  { action: 'message', index: 4, at: 6600 },
]

const MESSAGE_HANDOFF_DELAY_MS = 120
const messageTransition = {
  layout: { type: 'spring', stiffness: 320, damping: 34, mass: 0.75 },
  opacity: { duration: 0.22, ease: 'easeOut' },
  y: { type: 'spring', stiffness: 420, damping: 30, mass: 0.7 },
  scale: { type: 'spring', stiffness: 420, damping: 30, mass: 0.7 },
} as const
const typingTransition = {
  layout: { type: 'spring', stiffness: 280, damping: 30, mass: 0.85 },
  duration: 0.28,
  ease: [0.22, 1, 0.36, 1] as const,
} as const

function TypingIndicator() {
  return (
    <motion.div
      layout="position"
      className="flex items-end gap-2 self-start"
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{
        opacity: 0,
        y: 6,
        scale: 0.985,
        transition: { duration: 0.18, ease: 'easeOut' },
      }}
      transition={typingTransition}
      style={{
        transformOrigin: 'left bottom',
        willChange: 'transform, opacity',
      }}
    >
      <SatoAvatar size="md" />
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-secondary px-3.5 py-2.5">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50"
            animate={{ y: [0, -3, 0] }}
            transition={{
              duration: 0.6,
              repeat: Infinity,
              delay: i * 0.15,
              ease: 'easeInOut',
            }}
          />
        ))}
      </div>
    </motion.div>
  )
}

export default function ChatMockup() {
  const [visibleMessages, setVisibleMessages] = useState<Array<number>>([])
  const [showTyping, setShowTyping] = useState(false)
  const showTypingRef = useRef(showTyping)
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true, amount: 0.3 })

  useEffect(() => {
    showTypingRef.current = showTyping
  }, [showTyping])

  useEffect(() => {
    if (!isInView) return

    const timeouts: Array<ReturnType<typeof setTimeout>> = []

    for (const step of timeline) {
      timeouts.push(
        setTimeout(() => {
          if (step.action === 'typing') {
            setShowTyping(true)
            return
          }

          const messageIndex = step.index
          if (messageIndex === undefined) return

          setShowTyping(false)

          const appendMessage = () =>
            setVisibleMessages((prev) =>
              prev.includes(messageIndex) ? prev : [...prev, messageIndex],
            )

          if (showTypingRef.current) {
            timeouts.push(setTimeout(appendMessage, MESSAGE_HANDOFF_DELAY_MS))
            return
          }

          appendMessage()
        }, step.at),
      )
    }

    return () => timeouts.forEach(clearTimeout)
  }, [isInView])

  const isConsecutiveSato = (index: number) =>
    index > 0 &&
    messages[index].role === 'assistant' &&
    messages[index - 1].role === 'assistant'

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 120, damping: 20, delay: 0.3 }}
      className="relative mx-auto w-full max-w-xs"
      style={{ perspective: '1200px' }}
    >
      {/* Thick transparent border (frosted bezel) */}
      <div
        className="rounded-[2.4rem] bg-white/[0.12] p-3 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.3)]"
        style={{
          transform: 'rotateY(-4deg) rotateX(2deg)',
        }}
      >
        {/* Phone body */}
        <div className="overflow-hidden rounded-[1.8rem] border border-border/40 bg-background shadow-sm">
          {/* Status bar */}
          <div className="flex items-center justify-between px-6 pb-1 pt-2.5 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">9:41</span>
            <div className="flex items-center gap-1.5">
              <Signal className="h-3.5 w-3.5" />
              <Wifi className="h-3.5 w-3.5" />
              <Battery className="h-3.5 w-3.5" />
            </div>
          </div>

          {/* Chat header */}
          <div className="border-b border-border/60 px-5 py-3">
            <div className="flex items-center gap-2.5">
              <SatoAvatar size="lg" status="online" />
              <div className="flex flex-col">
                <span className="text-sm font-semibold leading-tight text-foreground">
                  Sato
                </span>
                <span className="text-[11px] leading-tight text-muted-foreground">
                  online
                </span>
              </div>
            </div>
          </div>

          {/* Messages */}
          <div
            className="flex flex-col gap-3 overflow-hidden px-4 py-4"
            style={{ height: '380px' }}
          >
            <AnimatePresence mode="sync">
              {visibleMessages.map((msgIndex) => {
                const msg = messages[msgIndex]
                const isUser = msg.role === 'user'
                const hideAvatar = isConsecutiveSato(msgIndex)

                return (
                  <motion.div
                    key={msgIndex}
                    layout="position"
                    className={`flex items-end gap-2 ${isUser ? 'self-end' : 'self-start'}`}
                    initial={{ opacity: 0, y: 12, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={messageTransition}
                    style={{
                      transformOrigin: isUser ? 'right bottom' : 'left bottom',
                      willChange: 'transform, opacity',
                    }}
                  >
                    {!isUser && <SatoAvatar visible={!hideAvatar} />}
                    <div
                      className={`max-w-[80%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                        isUser
                          ? 'rounded-br-sm bg-[#d5dff0] text-foreground'
                          : 'rounded-bl-sm bg-secondary text-foreground'
                      }`}
                    >
                      {msg.text}
                    </div>
                    {isUser && (
                      <img
                        src="/illustration-user-photo-2.jpg"
                        alt=""
                        className="h-6 w-6 shrink-0 rounded-full object-cover"
                      />
                    )}
                  </motion.div>
                )
              })}

              {showTyping && <TypingIndicator key="typing" />}
            </AnimatePresence>
          </div>

          {/* Input bar */}
          <div className="border-t border-border/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-full border border-border bg-secondary/50 px-3.5 py-2 text-sm text-muted-foreground/50">
                Type a message...
              </div>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground">
                <ArrowUp className="h-4 w-4 text-background" />
              </div>
            </div>
          </div>

          {/* Home indicator */}
          <div className="mx-auto mb-2 mt-1 h-1 w-28 rounded-full bg-foreground/20" />
        </div>
      </div>
    </motion.div>
  )
}
