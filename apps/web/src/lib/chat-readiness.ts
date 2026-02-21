import { normalizeGatewayState } from '@/lib/gateway-state'
import { probeOpenClawGateway, waitForOpenClawGateway } from '@/lib/vps-probes'

export interface ChatGatewayReadinessResult {
  ready: boolean
  waited: boolean
  attemptsUsed: number
  elapsedMs: number
  gatewayState: 'ready' | 'restarting' | 'degraded'
}

export async function resolveChatGatewayReadiness({
  gatewayHost,
  gatewayAuthToken,
  gatewayState,
  userId,
}: {
  gatewayHost: string
  gatewayAuthToken: string
  gatewayState: string | null | undefined
  userId: string
}): Promise<ChatGatewayReadinessResult> {
  const normalizedGatewayState = normalizeGatewayState({ value: gatewayState })
  const quickProbeReady = await probeOpenClawGateway({
    gatewayHost,
    gatewayAuthToken,
  })
  const shouldWait = normalizedGatewayState === 'restarting' || !quickProbeReady

  if (!shouldWait) {
    return {
      ready: true,
      waited: false,
      attemptsUsed: 1,
      elapsedMs: 0,
      gatewayState: normalizedGatewayState,
    }
  }

  console.info('[chat-readiness] Waiting for gateway warm-up', {
    userId,
    gatewayState: normalizedGatewayState,
  })

  const readiness = await waitForOpenClawGateway({
    gatewayHost,
    gatewayAuthToken,
    attempts: 90,
    intervalMs: 1_000,
  })

  if (readiness.ready) {
    console.info('[chat-readiness] Gateway warm-up complete', {
      userId,
      gatewayState: normalizedGatewayState,
      attemptsUsed: readiness.attemptsUsed,
      elapsedMs: readiness.elapsedMs,
    })
  } else {
    console.warn('[chat-readiness] Timed out waiting for gateway', {
      userId,
      gatewayState: normalizedGatewayState,
      attemptsUsed: readiness.attemptsUsed,
      elapsedMs: readiness.elapsedMs,
    })
  }

  return {
    ready: readiness.ready,
    waited: true,
    attemptsUsed: readiness.attemptsUsed,
    elapsedMs: readiness.elapsedMs,
    gatewayState: normalizedGatewayState,
  }
}
