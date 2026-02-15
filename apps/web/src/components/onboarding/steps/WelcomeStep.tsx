import { motion } from 'motion/react'
import { MessageCircle, Shield, Zap } from 'lucide-react'
import { containerVariants, itemVariants } from '../onboarding-animations'
import { useOnboardingContext } from '../onboarding-context'

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

export default function WelcomeStep() {
  const { userName, userImage, handleWelcomeContinue } = useOnboardingContext()
  const firstName = userName.split(' ')[0]

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="flex flex-col items-center text-center"
    >
      <motion.div variants={itemVariants}>
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
        variants={itemVariants}
        className="mt-7 text-4xl font-light tracking-tight text-white"
      >
        Welcome, {firstName}
      </motion.h1>

      <motion.p
        variants={itemVariants}
        className="mt-3 max-w-sm text-[15px] leading-relaxed text-zinc-400"
      >
        Sato gives you a personal AI assistant on its own private and secure
        server. Let's get yours set up.
      </motion.p>

      <motion.div
        variants={itemVariants}
        className="mt-10 grid w-full max-w-sm gap-3"
      >
        {features.map((feature) => (
          <motion.div
            key={feature.title}
            variants={itemVariants}
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
        variants={itemVariants}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={handleWelcomeContinue}
        className="mt-10 h-12 w-full max-w-sm rounded-2xl bg-white text-[15px] font-semibold text-zinc-950 transition-colors hover:bg-zinc-200"
      >
        Create my assistant
      </motion.button>
    </motion.div>
  )
}
