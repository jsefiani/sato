import { createContext, use } from 'react'
import type { ReactNode } from 'react'
import type { OnboardingContextValue } from './use-onboarding'

const OnboardingContext = createContext<OnboardingContextValue | null>(null)

export function OnboardingProvider({
  value,
  children,
}: {
  value: OnboardingContextValue
  children: ReactNode
}) {
  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  )
}

export function useOnboardingContext(): OnboardingContextValue {
  const ctx = use(OnboardingContext)
  if (!ctx) {
    throw new Error(
      'useOnboardingContext must be used within OnboardingProvider',
    )
  }
  return ctx
}
