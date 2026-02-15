import { motion } from 'motion/react'
import { ONBOARDING_STEPS } from './onboarding-utils'
import type { OnboardingStep } from './onboarding-utils'

const VISIBLE_STEPS = ONBOARDING_STEPS.filter(
  (s) => s !== 'welcome' && s !== 'chat' && s !== 'complete',
)

interface OnboardingProgressProps {
  currentStep: OnboardingStep
}

export default function OnboardingProgress({
  currentStep,
}: OnboardingProgressProps) {
  const current = (VISIBLE_STEPS as ReadonlyArray<OnboardingStep>).indexOf(
    currentStep,
  )

  return (
    <div className="flex items-center justify-center gap-2.5">
      {VISIBLE_STEPS.map((step, i) => (
        <motion.div
          key={step}
          layout
          className={`rounded-full transition-all duration-500 ${
            i === current
              ? 'h-2 w-10 bg-foreground'
              : i < current
                ? 'h-2 w-2 bg-foreground/50'
                : 'h-2 w-2 bg-secondary'
          }`}
        />
      ))}
    </div>
  )
}
