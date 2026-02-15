import { motion } from 'motion/react'
import { Check, CreditCard } from 'lucide-react'
import { containerVariants, itemVariants } from '../onboarding-animations'
import { useOnboardingContext } from '../onboarding-context'
import { Button } from '@/components/ui/button'

const features = [
  'Your own private AI assistant',
  'Unlimited conversations',
  'Telegram integration',
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
      {!hasAccess ? (
        <>
          <motion.h1
            variants={itemVariants}
            className="text-3xl font-light tracking-tight text-foreground"
          >
            Start your trial
          </motion.h1>

          <motion.p
            variants={itemVariants}
            className="mt-3 max-w-sm text-[15px] leading-relaxed text-muted-foreground/80"
          >
            Get full access to your personal AI assistant for 3 days.
          </motion.p>

          <motion.div
            variants={itemVariants}
            className="mt-8 w-full max-w-sm space-y-2.5"
          >
            {features.map((text) => (
              <div key={text} className="flex items-center gap-3 text-left">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground/3">
                  <Check className="h-3 w-3 text-foreground/80" />
                </div>
                <span className="text-sm text-muted-foreground">{text}</span>
              </div>
            ))}
          </motion.div>

          <motion.div variants={itemVariants} className="mt-10 w-full max-w-sm">
            <Button
              className="w-full"
              onClick={openCheckout}
              disabled={stripeLoading}
            >
              <CreditCard />
              {stripeLoading
                ? 'Opening checkout…'
                : 'Start 3-day trial for $1 →'}
            </Button>

            <p className="mt-4 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                Cancel anytime.
              </span>{' '}
              No questions asked!
            </p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              $1 trial fee helps us ensure quality service.
            </p>
          </motion.div>
        </>
      ) : isTrialing ? (
        <>
          <motion.h1
            variants={itemVariants}
            className="text-3xl font-light tracking-tight text-foreground"
          >
            Your trial is active
          </motion.h1>

          <motion.p
            variants={itemVariants}
            className="mt-3 max-w-sm text-[15px] leading-relaxed text-muted-foreground/80"
          >
            <span className="font-medium text-foreground">
              {daysLeft} {daysLeft === 1 ? 'day' : 'days'} remaining.
            </span>{' '}
            After your trial, your plan converts to $29/mo.
          </motion.p>

          <motion.div variants={itemVariants} className="mt-10 w-full max-w-sm">
            <Button className="w-full" onClick={() => onNavigate('launch')}>
              Continue
            </Button>
          </motion.div>
        </>
      ) : (
        <>
          <motion.h1
            variants={itemVariants}
            className="text-3xl font-light tracking-tight text-foreground"
          >
            You're all set
          </motion.h1>

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
      )}
    </motion.div>
  )
}
