import WelcomeStep from './steps/WelcomeStep'
import PersonalizeStep from './steps/PersonalizeStep'
import TrialStep from './steps/TrialStep'
import LaunchStep from './steps/LaunchStep'
import ChatStep from './steps/ChatStep'
import type { OnboardingStep } from './onboarding-utils'
import type { ComponentType } from 'react'

export interface StepConfig {
  id: OnboardingStep
  component: ComponentType
  requiresSetupState: boolean
  showProgress: boolean
}

export const STEP_REGISTRY: Array<StepConfig> = [
  {
    id: 'welcome',
    component: WelcomeStep,
    requiresSetupState: false,
    showProgress: false,
  },
  {
    id: 'personalize',
    component: PersonalizeStep,
    requiresSetupState: false,
    showProgress: true,
  },
  {
    id: 'trial',
    component: TrialStep,
    requiresSetupState: true,
    showProgress: true,
  },
  {
    id: 'launch',
    component: LaunchStep,
    requiresSetupState: true,
    showProgress: true,
  },
  {
    id: 'chat',
    component: ChatStep,
    requiresSetupState: true,
    showProgress: false,
  },
]

export function getStepConfig(stepId: OnboardingStep): StepConfig | undefined {
  return STEP_REGISTRY.find((s) => s.id === stepId)
}
