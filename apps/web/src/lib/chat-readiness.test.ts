import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveChatGatewayReadiness } from './chat-readiness'
import { probeOpenClawGateway, waitForOpenClawGateway } from '@/lib/vps-probes'

vi.mock('@/lib/vps-probes', () => ({
  probeOpenClawGateway: vi.fn(),
  waitForOpenClawGateway: vi.fn(),
}))

describe('resolveChatGatewayReadiness', () => {
  beforeEach(() => {
    vi.mocked(probeOpenClawGateway).mockReset()
    vi.mocked(waitForOpenClawGateway).mockReset()
  })

  it('waits and succeeds when restarting state becomes ready', async () => {
    vi.mocked(probeOpenClawGateway).mockResolvedValue(false)
    vi.mocked(waitForOpenClawGateway).mockResolvedValue({
      ready: true,
      attemptsUsed: 4,
      elapsedMs: 3_000,
    })

    const result = await resolveChatGatewayReadiness({
      gatewayHost: '100.64.0.20',
      gatewayAuthToken: 'token-a',
      gatewayState: 'restarting',
      userId: 'user-1',
    })

    expect(result.ready).toBe(true)
    expect(result.waited).toBe(true)
    expect(result.attemptsUsed).toBe(4)
    expect(waitForOpenClawGateway).toHaveBeenCalledTimes(1)
  })

  it('waits and returns not ready when warm-up exceeds timeout', async () => {
    vi.mocked(probeOpenClawGateway).mockResolvedValue(false)
    vi.mocked(waitForOpenClawGateway).mockResolvedValue({
      ready: false,
      attemptsUsed: 90,
      elapsedMs: 90_000,
    })

    const result = await resolveChatGatewayReadiness({
      gatewayHost: '100.64.0.21',
      gatewayAuthToken: 'token-b',
      gatewayState: 'restarting',
      userId: 'user-2',
    })

    expect(result.ready).toBe(false)
    expect(result.waited).toBe(true)
    expect(result.attemptsUsed).toBe(90)
  })

  it('returns immediately when ready state has a successful quick probe', async () => {
    vi.mocked(probeOpenClawGateway).mockResolvedValue(true)

    const result = await resolveChatGatewayReadiness({
      gatewayHost: '100.64.0.22',
      gatewayAuthToken: 'token-c',
      gatewayState: 'ready',
      userId: 'user-3',
    })

    expect(result.ready).toBe(true)
    expect(result.waited).toBe(false)
    expect(result.attemptsUsed).toBe(1)
    expect(waitForOpenClawGateway).not.toHaveBeenCalled()
  })
})
