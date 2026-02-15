import { motion } from 'motion/react'
import { Check, CreditCard, Gift } from 'lucide-react'
import { containerVariants, itemVariants } from '../onboarding-animations'
import { useOnboardingContext } from '../onboarding-context'
import { Button } from '@/components/ui/button'

const included = [
  'Your own private AI assistant',
  'Unlimited conversations',
  'Telegram integration',
  'No credit card required',
]

export default function TrialStep() {
  const {
    setupState,
    onNavigate,
    openCheckout,
    stripeLoading,
    skipInitialAnimation,
  } = useOnboardingContext()

  if (!setupState) return null
  const access = setupState.access
  const hasAccess = access.hasAccess
  const isTrialing = access.status === 'trialing'
  const daysLeft = access.trialDaysRemaining

  return (
    <motion.div
      variants={containerVariants}
      initial={skipInitialAnimation ? false : 'hidden'}
      animate="show"
      className="flex flex-col items-center text-center"
    >
      <motion.div
        variants={itemVariants}
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-foreground/4"
      >
        <Gift className="h-7 w-7 text-foreground/80" />
      </motion.div>

      <motion.h1
        variants={itemVariants}
        className="mt-6 text-3xl font-light tracking-tight text-foreground"
      >
        {hasAccess ? 'Your free trial' : 'Subscribe to continue'}
      </motion.h1>

      {hasAccess && isTrialing ? (
        <>
          <motion.p
            variants={itemVariants}
            className="mt-3 max-w-sm text-[15px] leading-relaxed text-muted-foreground/80"
          >
            Great news — you have a{' '}
            <span className="font-medium text-foreground">
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
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground/3">
                  <Check className="h-3 w-3 text-foreground/80" />
                </div>
                <span className="text-sm text-muted-foreground">{text}</span>
              </div>
            ))}
          </motion.div>

          <motion.div variants={itemVariants} className="mt-10 w-full max-w-sm">
            <Button className="w-full" onClick={() => onNavigate('launch')}>
              Continue
            </Button>
          </motion.div>
        </>
      ) : hasAccess ? (
        <>
          <motion.p
            variants={itemVariants}
            className="mt-3 max-w-sm text-[15px] leading-relaxed text-muted-foreground/80"
          >
            You have an active subscription. Let's continue setting up your
            assistant.
          </motion.p>

          <motion.div variants={itemVariants} className="mt-10 w-full max-w-sm">
            <Button className="w-full" onClick={() => onNavigate('launch')}>
              Continue
            </Button>
          </motion.div>
        </>
      ) : (
        <>
          <motion.p
            variants={itemVariants}
            className="mt-3 max-w-sm text-[15px] leading-relaxed text-muted-foreground/80"
          >
            Your free trial has ended. Subscribe to keep your assistant running.
          </motion.p>

          <motion.div variants={itemVariants} className="mt-10 w-full max-w-sm">
            <Button
              className="w-full"
              onClick={openCheckout}
              disabled={stripeLoading}
            >
              <CreditCard className="h-4 w-4" />
              {stripeLoading ? 'Opening checkout…' : 'Subscribe to continue'}
            </Button>
          </motion.div>
        </>
      )}
    </motion.div>
  )
}
