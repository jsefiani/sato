import { motion } from 'motion/react'
import { Check, CreditCard, Gift } from 'lucide-react'
import { containerVariants, itemVariants } from '../onboarding-animations'
import { useOnboardingContext } from '../onboarding-context'

const included = [
  'Your own private AI assistant',
  'Unlimited conversations',
  'Telegram integration',
  'No credit card required',
]

export default function TrialStep() {
  const { setupState, onNavigate, openCheckout, stripeLoading } =
    useOnboardingContext()

  if (!setupState) return null
  const access = setupState.access
  const hasAccess = access.hasAccess
  const isTrialing = access.status === 'trialing'
  const daysLeft = access.trialDaysRemaining

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="flex flex-col items-center text-center"
    >
      <motion.div
        variants={itemVariants}
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.04]"
      >
        <Gift className="h-7 w-7 text-white/80" />
      </motion.div>

      <motion.h1
        variants={itemVariants}
        className="mt-6 text-3xl font-light tracking-tight text-white"
      >
        {hasAccess ? 'Your free trial' : 'Subscribe to continue'}
      </motion.h1>

      {hasAccess && isTrialing ? (
        <>
          <motion.p
            variants={itemVariants}
            className="mt-3 max-w-sm text-[15px] leading-relaxed text-zinc-500"
          >
            Great news — you have a{' '}
            <span className="font-medium text-white">
              {daysLeft}-day free trial
            </span>
            . Explore everything, no strings attached.
          </motion.p>

          <motion.div
            variants={itemVariants}
            className="mt-8 w-full max-w-sm space-y-2.5"
          >
            {included.map((text) => (
              <div key={text} className="flex items-center gap-3 text-left">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.03]">
                  <Check className="h-3 w-3 text-zinc-300" />
                </div>
                <span className="text-sm text-zinc-400">{text}</span>
              </div>
            ))}
          </motion.div>

          <motion.button
            variants={itemVariants}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onNavigate('launch')}
            className="mt-10 h-12 w-full max-w-sm rounded-2xl bg-white text-[15px] font-semibold text-zinc-950 transition-colors hover:bg-zinc-200"
          >
            Continue
          </motion.button>
        </>
      ) : hasAccess ? (
        <>
          <motion.p
            variants={itemVariants}
            className="mt-3 max-w-sm text-[15px] leading-relaxed text-zinc-500"
          >
            You have an active subscription. Let's continue setting up your
            assistant.
          </motion.p>

          <motion.button
            variants={itemVariants}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onNavigate('launch')}
            className="mt-10 h-12 w-full max-w-sm rounded-2xl bg-white text-[15px] font-semibold text-zinc-950 transition-colors hover:bg-zinc-200"
          >
            Continue
          </motion.button>
        </>
      ) : (
        <>
          <motion.p
            variants={itemVariants}
            className="mt-3 max-w-sm text-[15px] leading-relaxed text-zinc-500"
          >
            Your free trial has ended. Subscribe to keep your assistant running.
          </motion.p>

          <motion.button
            variants={itemVariants}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={openCheckout}
            disabled={stripeLoading}
            className="mt-10 h-12 w-full max-w-sm rounded-2xl bg-white text-[15px] font-semibold text-zinc-950 transition-colors hover:bg-zinc-200 disabled:opacity-60"
          >
            <span className="inline-flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              {stripeLoading ? 'Opening checkout…' : 'Subscribe to continue'}
            </span>
          </motion.button>
        </>
      )}
    </motion.div>
  )
}
