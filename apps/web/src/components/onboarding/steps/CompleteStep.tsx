import { motion } from 'motion/react'
import { ExternalLink, MessageCircle, PartyPopper } from 'lucide-react'

interface CompleteStepProps {
  botUsername: string | null
  onGoToDashboard: () => void
}

function Sparkle({ delay, x, y }: { delay: number; x: number; y: number }) {
  return (
    <motion.div
      className="absolute h-1 w-1 rounded-full bg-white"
      initial={{ opacity: 0, scale: 0, x, y }}
      animate={{
        opacity: [0, 1, 0],
        scale: [0, 1.5, 0],
        x: x + (Math.random() - 0.5) * 60,
        y: y - Math.random() * 80,
      }}
      transition={{
        duration: 1.5,
        delay,
        repeat: Infinity,
        repeatDelay: 2.5,
      }}
    />
  )
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.15 },
  },
} as const

const item = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 260, damping: 20 },
  },
}

const sparklePositions = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  delay: i * 0.18,
  x: (Math.random() - 0.5) * 100,
  y: (Math.random() - 0.5) * 50,
}))

export default function CompleteStep({
  botUsername,
  onGoToDashboard,
}: CompleteStepProps) {
  const normalizedBotUsername = botUsername?.replace(/^@+/, '') ?? null
  const botHandle = normalizedBotUsername ? `@${normalizedBotUsername}` : null

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="flex flex-col items-center text-center"
    >
      <motion.div variants={item} className="relative">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white/[0.06]">
          <PartyPopper className="h-9 w-9 text-white" />
        </div>
        {sparklePositions.map((s) => (
          <Sparkle key={s.id} delay={s.delay} x={s.x} y={s.y} />
        ))}
      </motion.div>

      <motion.h1
        variants={item}
        className="mt-8 text-4xl font-light tracking-tight text-white"
      >
        You're all set
      </motion.h1>

      <motion.p
        variants={item}
        className="mt-3 max-w-sm text-[15px] leading-relaxed text-zinc-500"
      >
        Your assistant is running and ready to chat.
        {botHandle ? ' Open Telegram and start a conversation.' : ''}
      </motion.p>

      {normalizedBotUsername && botHandle && (
        <motion.a
          variants={item}
          href={`https://t.me/${normalizedBotUsername}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-2.5 rounded-2xl border border-white/[0.06] bg-zinc-900/50 px-5 py-3 text-sm font-medium text-zinc-300 transition-colors hover:border-white/[0.12] hover:text-white"
        >
          <MessageCircle className="h-4 w-4 text-white/60" />
          Chat with {botHandle}
          <ExternalLink className="h-3 w-3 text-zinc-500" />
        </motion.a>
      )}

      <motion.button
        variants={item}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onGoToDashboard}
        className="mt-8 h-12 w-full max-w-sm rounded-2xl bg-white text-[15px] font-semibold text-zinc-950 transition-colors hover:bg-zinc-200"
      >
        Go to my dashboard
      </motion.button>
    </motion.div>
  )
}
