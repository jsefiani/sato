export const OPENCLAW_GATEWAY_PORT = 18789

const OPENCLAW_PROBE_TIMEOUT_MS = 1_500
const OPENCLAW_PROBE_CACHE_TTL_OK_MS = 2_000
const OPENCLAW_PROBE_CACHE_TTL_DOWN_MS = 2_000
const CHAT_READY_STATUSES = new Set([400, 405, 422])

const readinessProbeCache = new Map<
  string,
  {
    value: boolean
    expiresAt: number
    inFlight: Promise<boolean> | null
  }
>()

function cacheKey({
  gatewayHost,
  gatewayAuthToken,
}: {
  gatewayHost: string
  gatewayAuthToken: string
}): string {
  return `${gatewayHost}::${gatewayAuthToken}`
}

function sleep({ ms }: { ms: number }): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function buildGatewayUrl({
  gatewayHost,
  path,
}: {
  gatewayHost: string
  path: string
}): string {
  return `http://${gatewayHost}:${OPENCLAW_GATEWAY_PORT}${path}`
}

function createTimeoutController(): {
  controller: AbortController
  timeoutId: ReturnType<typeof setTimeout>
} {
  const controller = new AbortController()
  const timeoutId = setTimeout(
    () => controller.abort(),
    OPENCLAW_PROBE_TIMEOUT_MS,
  )
  return { controller, timeoutId }
}

async function probeGatewayHttp({
  gatewayHost,
  gatewayAuthToken,
}: {
  gatewayHost: string
  gatewayAuthToken: string
}): Promise<boolean> {
  const modelsRequest = createTimeoutController()

  try {
    const modelsResponse = await fetch(
      buildGatewayUrl({ gatewayHost, path: '/v1/models' }),
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${gatewayAuthToken}`,
        },
        signal: modelsRequest.controller.signal,
      },
    )

    if (!modelsResponse.ok) {
      return false
    }
  } catch {
    return false
  } finally {
    clearTimeout(modelsRequest.timeoutId)
  }

  const chatRequest = createTimeoutController()

  try {
    const chatResponse = await fetch(
      buildGatewayUrl({ gatewayHost, path: '/v1/chat/completions' }),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${gatewayAuthToken}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        signal: chatRequest.controller.signal,
      },
    )

    if (chatResponse.status >= 500) {
      return false
    }

    return CHAT_READY_STATUSES.has(chatResponse.status)
  } catch {
    return false
  } finally {
    clearTimeout(chatRequest.timeoutId)
  }
}

export async function probeOpenClawGateway({
  gatewayHost,
  gatewayAuthToken,
  useCache = true,
}: {
  gatewayHost: string
  gatewayAuthToken: string
  useCache?: boolean
}): Promise<boolean> {
  const now = Date.now()
  const key = cacheKey({ gatewayHost, gatewayAuthToken })
  const cached = readinessProbeCache.get(key)

  if (useCache && cached) {
    if (cached.expiresAt > now) {
      return cached.value
    }

    if (cached.inFlight) {
      return cached.inFlight
    }
  }

  const inFlight = probeGatewayHttp({ gatewayHost, gatewayAuthToken })
    .then((value) => {
      readinessProbeCache.set(key, {
        value,
        expiresAt:
          Date.now() +
          (value
            ? OPENCLAW_PROBE_CACHE_TTL_OK_MS
            : OPENCLAW_PROBE_CACHE_TTL_DOWN_MS),
        inFlight: null,
      })
      return value
    })
    .catch(() => {
      readinessProbeCache.set(key, {
        value: false,
        expiresAt: Date.now() + OPENCLAW_PROBE_CACHE_TTL_DOWN_MS,
        inFlight: null,
      })
      return false
    })

  readinessProbeCache.set(key, {
    value: cached?.value ?? false,
    expiresAt: cached?.expiresAt ?? 0,
    inFlight,
  })

  return inFlight
}

export interface GatewayWaitResult {
  ready: boolean
  attemptsUsed: number
  elapsedMs: number
}

export async function waitForOpenClawGateway({
  gatewayHost,
  gatewayAuthToken,
  attempts,
  intervalMs,
}: {
  gatewayHost: string
  gatewayAuthToken: string
  attempts: number
  intervalMs: number
}): Promise<GatewayWaitResult> {
  const startMs = Date.now()

  for (let i = 0; i < attempts; i++) {
    if (
      await probeOpenClawGateway({
        gatewayHost,
        gatewayAuthToken,
        useCache: false,
      })
    ) {
      return {
        ready: true,
        attemptsUsed: i + 1,
        elapsedMs: Date.now() - startMs,
      }
    }

    if (i < attempts - 1) {
      await sleep({ ms: intervalMs })
    }
  }

  return {
    ready: false,
    attemptsUsed: attempts,
    elapsedMs: Date.now() - startMs,
  }
}
