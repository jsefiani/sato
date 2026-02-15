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
}

export default function OnboardingWizard({
  urlStep,
  onNavigate,
}: OnboardingWizardProps) {
  const ctx = useOnboarding({ urlStep, onNavigate })
  const stepConfig = getStepConfig(ctx.currentStep)

  if (stepConfig?.requiresSetupState && !ctx.setupState) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.04]">
          <Sparkles className="h-7 w-7 text-white/80" />
        </div>
        <h1 className="mt-6 text-2xl font-light tracking-tight text-white">
          Setting things up…
        </h1>
        <p className="mt-2 text-sm text-zinc-500">Preparing your assistant…</p>
      </div>
    )
  }

  const StepComponent = stepConfig?.component
  if (!StepComponent) return null

  return (
    <OnboardingProvider value={ctx}>
      <div className="flex flex-1 flex-col px-4 py-12">
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-md">
            <AnimatePresence mode="wait">
              <motion.div
                key={ctx.currentStep}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
              >
                <StepComponent />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {stepConfig.showProgress && (
          <div className="flex justify-center pb-4">
            <OnboardingProgress currentStep={ctx.currentStep} />
          </div>
        )}
      </div>
    </OnboardingProvider>
  )
}
