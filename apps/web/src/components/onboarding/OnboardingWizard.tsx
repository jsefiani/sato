import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Sparkles } from 'lucide-react'
import { useOnboarding } from './use-onboarding'
import { OnboardingProvider } from './onboarding-context'
import { getStepConfig } from './onboarding-steps'
import OnboardingProgress from './OnboardingProgress'
import type { OnboardingStep } from './onboarding-utils'

interface OnboardingWizardProps {
  urlStep: OnboardingStep
  onNavigate: (step: OnboardingStep | null) => void
  checkoutStatus?: string
}

export default function OnboardingWizard({
  urlStep,
  onNavigate,
  checkoutStatus,
}: OnboardingWizardProps) {
  const ctx = useOnboarding({ urlStep, onNavigate, checkoutStatus })
  const stepConfig = getStepConfig(ctx.currentStep)
  const urlStepConfig = getStepConfig(urlStep)

  const hasMounted = useRef(false)
  useEffect(() => {
    hasMounted.current = true
  }, [])

  if (
    !ctx.setupState &&
    (stepConfig?.requiresSetupState || urlStepConfig?.requiresSetupState)
  ) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-foreground/4">
          <Sparkles className="h-7 w-7 text-foreground/80" />
        </div>
        <h1 className="mt-6 text-2xl font-light tracking-tight text-foreground">
          Setting things up…
        </h1>
        <p className="mt-2 text-sm text-muted-foreground/80">
          Preparing your assistant…
        </p>
      </div>
    )
  }

  const StepComponent = stepConfig?.component
  if (!StepComponent) return null

  return (
    <OnboardingProvider
      value={{ ...ctx, skipInitialAnimation: !hasMounted.current }}
    >
      <div className="flex flex-1 flex-col px-4 py-12">
        {stepConfig.showProgress && (
          <div className="flex justify-center pt-2 pb-8">
            <OnboardingProgress currentStep={ctx.currentStep} />
          </div>
        )}

        <div className="flex flex-1 items-center justify-center">
          <div
            className={`w-full ${ctx.currentStep === 'chat' ? 'max-w-2xl' : 'max-w-md'}`}
          >
            <AnimatePresence initial={false} mode="wait">
              <motion.div
                key={ctx.currentStep}
                initial={hasMounted.current ? { opacity: 0 } : false}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
              >
                <StepComponent />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </OnboardingProvider>
  )
}
