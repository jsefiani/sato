export type OnboardingStep =
  | 'welcome'
  | 'trial'
  | 'launch'
  | 'telegram'
  | 'complete'

export const ONBOARDING_STEPS: Array<OnboardingStep> = [
  'welcome',
  'trial',
  'launch',
  'telegram',
  'complete',
]

export interface AccessState {
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'requires_payment'
  hasAccess: boolean
  trialEndsAt: string | null
  trialDaysRemaining: number
  subscriptionStatus: string | null
}

export interface VpsStatus {
  status: string
  ipv4Address: string | null
  region: string
  serverType: string
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

export type ChannelHealthState = 'unknown' | 'checking' | 'online' | 'offline'

export interface ChannelConnectionState {
  channel: string
  setupState: ChannelSetupState
  connected: boolean
  connectedAt: string | null
  externalAccountId: string | null
  displayName: string | null
  healthStatus: ChannelHealthState
  lastCheckedAt: string | null
  lastError: string | null
}

export interface ChannelSetupSummary {
  channels: Array<ChannelConnectionState>
  connectedChannels: Array<string>
  connectedCount: number
  hasConnectedChannel: boolean
}

export interface SetupState {
  access: AccessState
  credits: CreditState
  topupPacks: Array<TopupPack>
  openClawGatewayPort?: number
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
export function deriveStep(
  state: SetupState | null,
  _telegramState: TelegramState | null,
): OnboardingStep {
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

  const hasConnectedChannel = state.channelSetup.hasConnectedChannel
  if (!hasConnectedChannel) return 'telegram'

  return 'complete'
}

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step)
}

/**
 * Resolve the step shown in the wizard.
 *
 * We keep `welcome` sticky so users can read the intro screen,
 * but every other step is clamped to backend-derived progress.
 */
export function resolveCurrentStep(
  urlStep: OnboardingStep,
  derivedStep: OnboardingStep,
): OnboardingStep {
  if (urlStep === 'welcome' && derivedStep !== 'complete') {
    return 'welcome'
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
): OnboardingStep | null {
  const targetStep = derivedStep === 'complete' ? 'telegram' : derivedStep

  if (urlStep === 'welcome') {
    return null
  }

  if (stepIndex(targetStep) > stepIndex(urlStep)) {
    return targetStep
  }

  return null
}
