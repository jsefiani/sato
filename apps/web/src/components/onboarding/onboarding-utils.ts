export type OnboardingStep =
  | 'welcome'
  | 'personalize'
  | 'trial'
  | 'launch'
  | 'chat'
  | 'complete'

export const ONBOARDING_STEPS: Array<OnboardingStep> = [
  'welcome',
  'personalize',
  'trial',
  'launch',
  'chat',
  'complete',
]

export interface PersonalizationData {
  assistantName: string
  communicationStyle: string
  primaryUseCase: string
  additionalContext: string
}

export interface AccessState {
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'requires_payment'
  hasAccess: boolean
  trialEndsAt: string | null
  trialDaysRemaining: number
  subscriptionStatus: string | null
}

export interface VpsStatus {
  status: string
}

export interface CreditState {
  trialCreditsRemaining: number
  monthlyCreditsRemaining: number
  purchasedCreditsRemaining: number
  totalCreditsRemaining: number
  monthlyCreditsGrant: number
  monthlyCycleAnchor: string | null
}

export interface TopupPack {
  id: string
  label: string
  credits: number
}

export type ChannelSetupState =
  | 'disconnected'
  | 'configuring'
  | 'connected'
  | 'error'

export interface ChannelConnectionState {
  channel: string
  setupState: ChannelSetupState
  connected: boolean
  displayName: string | null
}

export interface ChannelSetupSummary {
  channels: Array<ChannelConnectionState>
  connectedChannels: Array<string>
  connectedCount: number
  hasConnectedChannel: boolean
}

export interface SetupState {
  hasPersonalized: boolean
  preferredModel?: string | null
  access: AccessState
  credits: CreditState
  topupPacks: Array<TopupPack>
  openClawReady?: boolean
  bootstrappingError?: string | null
  vpsFailureReason?: string | null
  vps: VpsStatus | null
  channelSetup: ChannelSetupSummary
}

export interface TelegramPairingRequest {
  code: string
  id: string
  createdAt: string | null
  meta?: unknown
}

export interface TelegramState {
  checkedAt: string
  configured: boolean
  enabled: boolean
  running: boolean
  connected: boolean
  probeOk: boolean
  accountId: string | null
  botUsername: string | null
  dmPolicy: string | null
  lastError: string | null
  pairingRequests: Array<TelegramPairingRequest>
}

/**
 * Derives the onboarding step from backend state.
 * Returns the step the user should be at based on what's been accomplished.
 */
export function deriveStep(state: SetupState | null): OnboardingStep {
  if (!state) return 'trial'

  if (!state.access.hasAccess) return 'trial'

  const vps = state.vps
  const noVps =
    !vps ||
    vps.status === 'pending' ||
    vps.status === 'failed' ||
    vps.status === 'terminated' ||
    vps.status === 'cleanup_pending'

  if (noVps) return 'launch'

  if (vps.status === 'provisioning' || vps.status === 'bootstrapping') {
    return 'launch'
  }

  if (vps.status === 'active' && state.openClawReady !== true) {
    return 'launch'
  }

  return 'complete'
}

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step)
}

/**
 * Resolve the step shown in the wizard.
 *
 * We keep `welcome` and `personalize` sticky so users can complete them,
 * but every other step is clamped to backend-derived progress.
 */
export function resolveCurrentStep(
  urlStep: OnboardingStep,
  derivedStep: OnboardingStep,
  hasPersonalized: boolean,
): OnboardingStep {
  if (!hasPersonalized && urlStep !== 'welcome' && urlStep !== 'personalize') {
    return 'welcome'
  }

  if (
    (urlStep === 'welcome' || urlStep === 'personalize') &&
    derivedStep !== 'complete'
  ) {
    return urlStep
  }

  if (stepIndex(urlStep) > stepIndex(derivedStep)) {
    return derivedStep
  }

  return urlStep
}

/**
 * Return a step we should auto-advance to, or null if no auto-advance is needed.
 */
export function getAutoAdvanceStep(
  urlStep: OnboardingStep,
  derivedStep: OnboardingStep,
  hasPersonalized: boolean,
): OnboardingStep | null {
  if (!hasPersonalized && derivedStep === 'complete') {
    if (urlStep === 'welcome' || urlStep === 'personalize') return null
    return 'welcome'
  }

  const targetStep = derivedStep === 'complete' ? 'chat' : derivedStep

  if (urlStep === 'welcome' || urlStep === 'personalize') {
    return null
  }

  if (stepIndex(targetStep) > stepIndex(urlStep)) {
    return targetStep
  }

  return null
}
