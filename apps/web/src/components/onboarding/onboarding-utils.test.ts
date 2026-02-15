import { describe, expect, it } from 'vitest'
import {
  deriveStep,
  getAutoAdvanceStep,
  resolveCurrentStep,
} from './onboarding-utils'
import type { SetupState, TelegramState } from './onboarding-utils'

const baseState: SetupState = {
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
  openClawGatewayPort: 18789,
  openClawReady: true,
  bootstrappingError: null,
  vpsFailureReason: null,
  vps: {
    status: 'active',
    ipv4Address: '127.0.0.1',
    region: 'nbg1',
    serverType: 'cpx22',
  },
  channelSetup: {
    channels: [],
    connectedChannels: [],
    connectedCount: 0,
    hasConnectedChannel: false,
  },
}

const connectedTelegramState: TelegramState = {
  checkedAt: new Date().toISOString(),
  configured: true,
  enabled: true,
  running: true,
  connected: true,
  probeOk: true,
  accountId: 'default',
  botUsername: '@bot',
  dmPolicy: null,
  lastError: null,
  pairingRequests: [],
}

describe('deriveStep', () => {
  it('stays on telegram while a pairing request is pending', () => {
    expect(
      deriveStep(baseState, {
        ...connectedTelegramState,
        pairingRequests: [
          {
            code: 'ABCDEFGH',
            id: 'req_1',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    ).toBe('telegram')
  })

  it('moves to complete only when connected with no pending pairing', () => {
    const stateWithConnectedChannel: SetupState = {
      ...baseState,
      channelSetup: {
        channels: [],
        connectedChannels: ['telegram'],
        connectedCount: 1,
        hasConnectedChannel: true,
      },
    }
    expect(deriveStep(stateWithConnectedChannel, connectedTelegramState)).toBe(
      'complete',
    )
  })
})

describe('resolveCurrentStep', () => {
  it('keeps welcome sticky before completion', () => {
    expect(resolveCurrentStep('welcome', 'launch')).toBe('welcome')
  })

  it('clamps invalid forward deep links', () => {
    expect(resolveCurrentStep('complete', 'launch')).toBe('launch')
  })

  it('keeps current url step when it is valid', () => {
    expect(resolveCurrentStep('launch', 'telegram')).toBe('launch')
  })
})

describe('getAutoAdvanceStep', () => {
  it('does not auto-advance welcome', () => {
    expect(getAutoAdvanceStep('welcome', 'telegram')).toBeNull()
  })

  it('auto-advances when backend progress is ahead', () => {
    expect(getAutoAdvanceStep('launch', 'telegram')).toBe('telegram')
  })

  it('does not auto-skip from launch to complete', () => {
    expect(getAutoAdvanceStep('launch', 'complete')).toBe('telegram')
  })

  it('does not auto-advance when already up to date', () => {
    expect(getAutoAdvanceStep('telegram', 'telegram')).toBeNull()
  })
})
