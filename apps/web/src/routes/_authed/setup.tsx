import { useCallback } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { OnboardingStep } from '@/components/onboarding/onboarding-utils'
import DevVpsLogsWidget from '@/components/dev/DevVpsLogsWidget'
import { ONBOARDING_STEPS } from '@/components/onboarding/onboarding-utils'
import OnboardingWizard from '@/components/onboarding/OnboardingWizard'
import TelegramStandalone from '@/components/onboarding/steps/TelegramStandalone'

type UrlStep = OnboardingStep | 'telegram'

const VALID_URL_STEPS = [...ONBOARDING_STEPS, 'telegram'] as const

export const Route = createFileRoute('/_authed/setup')({
  component: SetupPage,
  validateSearch: (
    search: Record<string, unknown>,
  ): { step: UrlStep; checkout?: string } => {
    const raw = search.step
    const checkout = search.checkout
    const step =
      typeof raw === 'string' &&
      (VALID_URL_STEPS as ReadonlyArray<string>).includes(raw)
        ? (raw as UrlStep)
        : 'welcome'
    return {
      step,
      ...(checkout === 'success' || checkout === 'cancelled'
        ? { checkout: checkout as string }
        : {}),
    }
  },
})

function SetupPage() {
  const { step: urlStep, checkout } = Route.useSearch()
  const navigate = useNavigate()

  const handleNavigate = useCallback(
    (step: OnboardingStep | null) => {
      if (step) {
        navigate({ to: '/setup', search: { step } })
        return
      }

      navigate({ to: '/' })
    },
    [navigate],
  )

  if (urlStep === 'telegram') {
    return (
      <>
        <TelegramStandalone onNavigate={handleNavigate} />
        {import.meta.env.DEV ? <DevVpsLogsWidget /> : null}
      </>
    )
  }

  return (
    <>
      <OnboardingWizard
        urlStep={urlStep}
        onNavigate={handleNavigate}
        checkoutStatus={checkout}
      />
      {import.meta.env.DEV ? <DevVpsLogsWidget /> : null}
    </>
  )
}
