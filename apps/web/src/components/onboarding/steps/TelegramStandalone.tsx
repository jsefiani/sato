import { useOnboarding } from '../use-onboarding'
import { OnboardingProvider } from '../onboarding-context'
import TelegramStep from './TelegramStep'
import type { OnboardingStep } from '../onboarding-utils'

interface TelegramStandaloneProps {
  onNavigate: (step: OnboardingStep | null) => void
}

export default function TelegramStandalone({
  onNavigate,
}: TelegramStandaloneProps) {
  const ctx = useOnboarding({ urlStep: 'chat', onNavigate })

  return (
    <OnboardingProvider value={{ ...ctx, skipInitialAnimation: false }}>
      <div className="flex flex-1 flex-col px-4 py-12">
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-md">
            <TelegramStep />
          </div>
        </div>
      </div>
    </OnboardingProvider>
  )
}
