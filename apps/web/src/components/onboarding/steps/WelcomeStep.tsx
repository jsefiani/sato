import { motion } from 'motion/react'
import { MessageCircle, Shield, Zap } from 'lucide-react'

interface WelcomeStepProps {
  userName: string
  userImage: string | null
  onContinue: () => void
}

const features = [
  {
    icon: Shield,
    title: 'Completely private',
    description: 'Your own AI on a dedicated server — no one else has access.',
  },
  {
    icon: Zap,
    title: 'Always on',
    description: 'Available 24/7, whenever you need it.',
  },
  {
    icon: MessageCircle,
    title: 'Chat via Telegram',
    description: 'Message your assistant just like texting a friend.',
  },
]

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

export default function WelcomeStep({
  userName,
  userImage,
  onContinue,
}: WelcomeStepProps) {
  const firstName = userName.split(' ')[0]

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="flex flex-col items-center text-center"
    >
      <motion.div variants={item}>
        {userImage ? (
          <img
            src={userImage}
            alt=""
            className="h-20 w-20 rounded-full ring-2 ring-white/20 ring-offset-2 ring-offset-zinc-950"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white text-3xl font-light text-zinc-950">
            {firstName.charAt(0).toUpperCase()}
          </div>
        )}
      </motion.div>

      <motion.h1
        variants={item}
        className="mt-7 text-4xl font-light tracking-tight text-white"
      >
        Welcome, {firstName}
      </motion.h1>

      <motion.p
        variants={item}
        className="mt-3 max-w-sm text-[15px] leading-relaxed text-zinc-400"
      >
        Sato gives you a personal AI assistant on its own private and secure
        server. Let's get yours set up.
      </motion.p>

      <motion.div variants={item} className="mt-10 grid w-full max-w-sm gap-3">
        {features.map((feature) => (
          <motion.div
            key={feature.title}
            variants={item}
            className="flex items-start gap-4 rounded-2xl border border-white/[0.06] bg-zinc-900/50 p-4 text-left backdrop-blur-sm"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.04]">
              <feature.icon className="h-[18px] w-[18px] text-white/80" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-zinc-300">
                {feature.title}
              </p>
              <p className="text-sm text-zinc-500">{feature.description}</p>
            </div>
          </motion.div>
        ))}
      </motion.div>

      <motion.button
        variants={item}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onContinue}
        className="mt-10 h-12 w-full max-w-sm rounded-2xl bg-white text-[15px] font-semibold text-zinc-950 transition-colors hover:bg-zinc-200"
      >
        Create my assistant
      </motion.button>
    </motion.div>
  )
}
