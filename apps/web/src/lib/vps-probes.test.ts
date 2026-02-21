import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function response({ status }: { status: number }): Response {
  return new Response(null, { status })
}

async function loadModule() {
  vi.resetModules()
  return await import('./vps-probes')
}

describe('probeOpenClawGateway', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns true when models succeeds and chat endpoint returns validation status', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(response({ status: 200 }))
      .mockResolvedValueOnce(response({ status: 422 }))

    const { probeOpenClawGateway } = await loadModule()

    const ready = await probeOpenClawGateway({
      gatewayHost: '100.64.0.10',
      gatewayAuthToken: 'token-a',
    })

    expect(ready).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns false when chat endpoint responds with server error', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(response({ status: 200 }))
      .mockResolvedValueOnce(response({ status: 503 }))

    const { probeOpenClawGateway } = await loadModule()

    const ready = await probeOpenClawGateway({
      gatewayHost: '100.64.0.11',
      gatewayAuthToken: 'token-a',
    })

    expect(ready).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uses cache key isolation per auth token', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(response({ status: 200 }))
      .mockResolvedValueOnce(response({ status: 400 }))
      .mockResolvedValueOnce(response({ status: 200 }))
      .mockResolvedValueOnce(response({ status: 400 }))

    const { probeOpenClawGateway } = await loadModule()

    const first = await probeOpenClawGateway({
      gatewayHost: '100.64.0.12',
      gatewayAuthToken: 'token-a',
    })
    const second = await probeOpenClawGateway({
      gatewayHost: '100.64.0.12',
      gatewayAuthToken: 'token-a',
    })
    const third = await probeOpenClawGateway({
      gatewayHost: '100.64.0.12',
      gatewayAuthToken: 'token-b',
    })

    expect(first).toBe(true)
    expect(second).toBe(true)
    expect(third).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})

describe('waitForOpenClawGateway', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('waits across retries and reports attempts and elapsed time', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(response({ status: 503 }))
      .mockResolvedValueOnce(response({ status: 200 }))
      .mockResolvedValueOnce(response({ status: 503 }))
      .mockResolvedValueOnce(response({ status: 200 }))
      .mockResolvedValueOnce(response({ status: 422 }))

    const { waitForOpenClawGateway } = await loadModule()

    const result = await waitForOpenClawGateway({
      gatewayHost: '100.64.0.13',
      gatewayAuthToken: 'token-a',
      attempts: 3,
      intervalMs: 1,
    })

    expect(result.ready).toBe(true)
    expect(result.attemptsUsed).toBe(3)
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })
})
