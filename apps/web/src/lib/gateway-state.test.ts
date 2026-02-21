import { describe, expect, it } from 'vitest'
import {
  GATEWAY_RESTART_GRACE_MS,
  resolveGatewayLifecycle,
} from './gateway-state'

describe('resolveGatewayLifecycle', () => {
  it('keeps restarting and not ready when probe is down', () => {
    const result = resolveGatewayLifecycle({
      gatewayState: 'restarting',
      restartStartedAt: new Date(),
      probeReady: false,
      nowMs: Date.now(),
    })

    expect(result.gatewayState).toBe('restarting')
    expect(result.openClawReady).toBe(false)
    expect(result.shouldMarkReady).toBe(false)
    expect(result.shouldMarkDegraded).toBe(false)
  })

  it('keeps restarting before grace window even when probe is up', () => {
    const nowMs = Date.now()
    const result = resolveGatewayLifecycle({
      gatewayState: 'restarting',
      restartStartedAt: new Date(nowMs - (GATEWAY_RESTART_GRACE_MS - 1_000)),
      probeReady: true,
      nowMs,
    })

    expect(result.gatewayState).toBe('restarting')
    expect(result.openClawReady).toBe(false)
    expect(result.shouldMarkReady).toBe(false)
    expect(result.shouldMarkDegraded).toBe(false)
  })

  it('transitions to ready after grace window when probe is up', () => {
    const nowMs = Date.now()
    const result = resolveGatewayLifecycle({
      gatewayState: 'restarting',
      restartStartedAt: new Date(nowMs - (GATEWAY_RESTART_GRACE_MS + 1_000)),
      probeReady: true,
      nowMs,
    })

    expect(result.gatewayState).toBe('ready')
    expect(result.openClawReady).toBe(true)
    expect(result.shouldMarkReady).toBe(true)
    expect(result.shouldMarkDegraded).toBe(false)
  })
})
