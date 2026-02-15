import { motion } from 'motion/react'
import { ArrowUp, Battery, Signal, Wifi } from 'lucide-react'

const messages = [
  {
    role: 'user' as const,
    text: "My mom's birthday is next week and I have no idea what to get her",
  },
  {
    role: 'assistant' as const,
    text: 'Last time you mentioned she loves gardening and just redecorated her patio. How about a set of ceramic planters or a gift card to her favorite nursery?',
  },
  {
    role: 'user' as const,
    text: "Oh that's perfect, she'd love that!",
  },
  {
    role: 'assistant' as const,
    text: 'Want me to draft a birthday message for the card too? I know she appreciates the heartfelt ones. \u{1F49B}',
  },
  {
    role: 'user' as const,
    text: 'Yes please \u{1F64F}',
  },
]

export default function ChatMockup() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.3 }}
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
              <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">
                S
                <div className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-[1.5px] border-background bg-emerald-500" />
              </div>
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
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                    msg.role === 'user'
                      ? 'rounded-br-sm bg-[#d5dff0] text-foreground'
                      : 'rounded-bl-sm bg-secondary text-foreground'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
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
