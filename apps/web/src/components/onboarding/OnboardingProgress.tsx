import { motion } from 'motion/react'
import { ChevronRight } from 'lucide-react'
import { STEP_REGISTRY } from './onboarding-steps'
import type { OnboardingStep } from './onboarding-utils'

const VISIBLE_STEPS = STEP_REGISTRY.filter((s) => s.showProgress)

interface OnboardingProgressProps {
  currentStep: OnboardingStep
}

export default function OnboardingProgress({
  currentStep,
}: OnboardingProgressProps) {
  const currentIndex = VISIBLE_STEPS.findIndex((s) => s.id === currentStep)
  const progress = currentIndex / VISIBLE_STEPS.length

  const content = (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-1">
        {VISIBLE_STEPS.map((step, i) => (
          <div key={step.id} className="flex items-center gap-1">
            <span className="relative">
              <span
                className={`text-xs tracking-wide ${
                  i < currentIndex
                    ? 'text-foreground/50'
                    : i === currentIndex
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground/40'
                }`}
              >
                {step.label}
              </span>
              {i === currentIndex && (
                <motion.div
                  layoutId="step-underline"
                  className="absolute -bottom-1 left-0 h-0.5 w-full rounded-full bg-foreground"
                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                />
              )}
            </span>
            {i < VISIBLE_STEPS.length - 1 && (
              <ChevronRight className="h-3 w-3 text-muted-foreground/25" />
            )}
          </div>
        ))}
      </div>

      <div className="h-px w-48 rounded-full bg-foreground/10">
        <motion.div
          className="h-px rounded-full bg-foreground/40"
          animate={{ width: `${progress * 100}%` }}
          transition={{ type: 'spring', stiffness: 200, damping: 25 }}
        />
      </div>
    </div>
  )

  if (currentStep === 'welcome') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.5 }}
      >
        {content}
      </motion.div>
    )
  }

  return content
}
