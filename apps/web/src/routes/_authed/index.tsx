import { useCallback } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { OnboardingStep } from '@/components/onboarding/onboarding-utils'
import NewDashboard from '@/components/dashboard/NewDashboard'
import DevVpsLogsWidget from '@/components/dev/DevVpsLogsWidget'
import { ONBOARDING_STEPS } from '@/components/onboarding/onboarding-utils'
import OnboardingWizard from '@/components/onboarding/OnboardingWizard'

export const Route = createFileRoute('/_authed/')({
  component: HomePage,
  validateSearch: (
    search: Record<string, unknown>,
  ): { step?: OnboardingStep } => {
    const raw = search.step
    if (
      typeof raw === 'string' &&
      ONBOARDING_STEPS.includes(raw as OnboardingStep)
    ) {
      return { step: raw as OnboardingStep }
    }
    return {}
  },
})

function HomePage() {
  const { step: urlStep } = Route.useSearch()
  const navigate = useNavigate()

  const handleNavigate = useCallback(
    (step: OnboardingStep | null) => {
      if (step) {
        navigate({ to: '/', search: { step } })
        return
      }

      navigate({ to: '/', search: {} })
    },
    [navigate],
  )

  return (
    <>
      {urlStep ? (
        <OnboardingWizard urlStep={urlStep} onNavigate={handleNavigate} />
      ) : (
        <NewDashboard />
      )}
      {import.meta.env.DEV ? <DevVpsLogsWidget /> : null}
    </>
  )
}
