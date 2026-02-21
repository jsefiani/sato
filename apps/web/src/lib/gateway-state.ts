export type GatewayState = 'ready' | 'restarting' | 'degraded'

export const GATEWAY_RESTART_GRACE_MS = 8_000
export const GATEWAY_RESTART_TIMEOUT_MS = 5 * 60_000

export function normalizeGatewayState({
  value,
}: {
  value: string | null | undefined
}): GatewayState {
  if (value === 'restarting' || value === 'degraded') {
    return value
  }

  return 'ready'
}

export function resolveGatewayLifecycle({
  gatewayState,
  restartStartedAt,
  probeReady,
  nowMs = Date.now(),
}: {
  gatewayState: string | null | undefined
  restartStartedAt: Date | null
  probeReady: boolean
  nowMs?: number
}): {
  gatewayState: GatewayState
  openClawReady: boolean
  shouldMarkReady: boolean
  shouldMarkDegraded: boolean
} {
  const normalizedState = normalizeGatewayState({ value: gatewayState })

  if (normalizedState === 'degraded') {
    return {
      gatewayState: 'degraded',
      openClawReady: false,
      shouldMarkReady: false,
      shouldMarkDegraded: false,
    }
  }

  if (normalizedState === 'restarting') {
    const restartStartedAtMs = restartStartedAt?.getTime() ?? null

    if (
      restartStartedAtMs !== null &&
      nowMs - restartStartedAtMs > GATEWAY_RESTART_TIMEOUT_MS
    ) {
      return {
        gatewayState: 'degraded',
        openClawReady: false,
        shouldMarkReady: false,
        shouldMarkDegraded: true,
      }
    }

    if (!probeReady) {
      return {
        gatewayState: 'restarting',
        openClawReady: false,
        shouldMarkReady: false,
        shouldMarkDegraded: false,
      }
    }

    if (
      restartStartedAtMs === null ||
      nowMs - restartStartedAtMs < GATEWAY_RESTART_GRACE_MS
    ) {
      return {
        gatewayState: 'restarting',
        openClawReady: false,
        shouldMarkReady: false,
        shouldMarkDegraded: false,
      }
    }

    return {
      gatewayState: 'ready',
      openClawReady: true,
      shouldMarkReady: true,
      shouldMarkDegraded: false,
    }
  }

  return {
    gatewayState: 'ready',
    openClawReady: probeReady,
    shouldMarkReady: false,
    shouldMarkDegraded: false,
  }
}
