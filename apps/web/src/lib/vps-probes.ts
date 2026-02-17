import { isTcpPortReachable } from '@/lib/readiness'

export const OPENCLAW_GATEWAY_PORT = 18789

const OPENCLAW_PROBE_TIMEOUT_MS = 800
const OPENCLAW_PROBE_CACHE_TTL_MS = 10_000

const readinessProbeCache = new Map<
  string,
  {
    value: boolean
    expiresAt: number
    inFlight: Promise<boolean> | null
  }
>()

export async function probeOpenClawGateway(
  ipv4Address: string,
): Promise<boolean> {
  const now = Date.now()
  const cached = readinessProbeCache.get(ipv4Address)

  if (cached) {
    if (cached.expiresAt > now) {
      return cached.value
    }

    if (cached.inFlight) {
      return cached.inFlight
    }
  }

  const inFlight = isTcpPortReachable(
    ipv4Address,
    OPENCLAW_GATEWAY_PORT,
    OPENCLAW_PROBE_TIMEOUT_MS,
  )
    .then((value) => {
      readinessProbeCache.set(ipv4Address, {
        value,
        expiresAt: Date.now() + OPENCLAW_PROBE_CACHE_TTL_MS,
        inFlight: null,
      })
      return value
    })
    .catch(() => {
      readinessProbeCache.set(ipv4Address, {
        value: false,
        expiresAt: Date.now() + OPENCLAW_PROBE_CACHE_TTL_MS,
        inFlight: null,
      })
      return false
    })

  readinessProbeCache.set(ipv4Address, {
    value: cached?.value ?? false,
    expiresAt: cached?.expiresAt ?? 0,
    inFlight,
  })

  return inFlight
}
