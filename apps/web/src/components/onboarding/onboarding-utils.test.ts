import { describe, expect, it } from 'vitest'
import {
  deriveStep,
  getAutoAdvanceStep,
  resolveCurrentStep,
} from './onboarding-utils'
import type { SetupState } from './onboarding-utils'

const baseState: SetupState = {
  hasPersonalized: true,
  access: {
    status: 'active',
    hasAccess: true,
    trialEndsAt: null,
    trialDaysRemaining: 0,
    subscriptionStatus: 'active',
  },
  credits: {
    trialCreditsRemaining: 0,
    monthlyCreditsRemaining: 0,
    purchasedCreditsRemaining: 0,
    totalCreditsRemaining: 0,
    monthlyCreditsGrant: 0,
    monthlyCycleAnchor: null,
  },
  topupPacks: [],
  openClawReady: true,
  bootstrappingError: null,
  vpsFailureReason: null,
  vps: {
    status: 'active',
  },
  channelSetup: {
    channels: [],
    connectedChannels: [],
    connectedCount: 0,
    hasConnectedChannel: false,
  },
}

describe('deriveStep', () => {
  it('returns complete when VPS is active and OpenClaw is ready', () => {
    expect(deriveStep(baseState)).toBe('complete')
  })

  it('returns launch when VPS is provisioning', () => {
    expect(
      deriveStep({
        ...baseState,
        vps: { ...baseState.vps!, status: 'provisioning' },
      }),
    ).toBe('launch')
  })

  it('returns launch when VPS is active but OpenClaw is not ready', () => {
    expect(
      deriveStep({
        ...baseState,
        openClawReady: false,
      }),
    ).toBe('launch')
  })

  it('returns launch when gateway state is restarting', () => {
    expect(
      deriveStep({
        ...baseState,
        gatewayState: 'restarting',
      }),
    ).toBe('launch')
  })

  it('returns trial when user has no access', () => {
    expect(
      deriveStep({
        ...baseState,
        access: { ...baseState.access, hasAccess: false },
      }),
    ).toBe('trial')
  })

  it('returns trial when state is null', () => {
    expect(deriveStep(null)).toBe('trial')
  })
})

describe('resolveCurrentStep', () => {
  it('keeps welcome sticky before completion', () => {
    expect(resolveCurrentStep('welcome', 'launch', true)).toBe('welcome')
  })

  it('keeps personalize sticky before completion', () => {
    expect(resolveCurrentStep('personalize', 'launch', true)).toBe(
      'personalize',
    )
  })

  it('clamps invalid forward deep links', () => {
    expect(resolveCurrentStep('complete', 'launch', true)).toBe('launch')
  })

  it('keeps current url step when it is valid', () => {
    expect(resolveCurrentStep('launch', 'complete', true)).toBe('launch')
  })

  it('forces welcome when not personalized and urlStep is past personalize', () => {
    expect(resolveCurrentStep('launch', 'launch', false)).toBe('welcome')
    expect(resolveCurrentStep('chat', 'complete', false)).toBe('welcome')
    expect(resolveCurrentStep('trial', 'trial', false)).toBe('welcome')
  })

  it('allows welcome/personalize when not personalized', () => {
    expect(resolveCurrentStep('welcome', 'launch', false)).toBe('welcome')
    expect(resolveCurrentStep('personalize', 'launch', false)).toBe(
      'personalize',
    )
  })
})

describe('getAutoAdvanceStep', () => {
  it('does not auto-advance welcome', () => {
    expect(getAutoAdvanceStep('welcome', 'complete', true)).toBeNull()
  })

  it('does not auto-advance personalize', () => {
    expect(getAutoAdvanceStep('personalize', 'complete', true)).toBeNull()
  })

  it('auto-advances when backend progress is ahead', () => {
    expect(getAutoAdvanceStep('launch', 'complete', true)).toBe('chat')
  })

  it('targets chat when derived step is complete', () => {
    expect(getAutoAdvanceStep('trial', 'complete', true)).toBe('chat')
  })

  it('does not auto-advance when already up to date', () => {
    expect(getAutoAdvanceStep('chat', 'complete', true)).toBeNull()
  })

  it('returns welcome when not personalized and derived is complete', () => {
    expect(getAutoAdvanceStep('launch', 'complete', false)).toBe('welcome')
    expect(getAutoAdvanceStep('trial', 'complete', false)).toBe('welcome')
    expect(getAutoAdvanceStep('chat', 'complete', false)).toBe('welcome')
  })

  it('returns null when not personalized, derived complete, and on welcome/personalize', () => {
    expect(getAutoAdvanceStep('welcome', 'complete', false)).toBeNull()
    expect(getAutoAdvanceStep('personalize', 'complete', false)).toBeNull()
  })
})
