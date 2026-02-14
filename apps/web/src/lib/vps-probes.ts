import { isTcpPortReachable } from '@/lib/readiness'
import { runVpsSshCommand } from '@/lib/vps-ssh'

export const OPENCLAW_GATEWAY_PORT = 18789

const OPENCLAW_PROBE_TIMEOUT_MS = 800
const OPENCLAW_PROBE_CACHE_TTL_MS = 10_000
const BOOTSTRAP_PROBE_COOLDOWN_MS = 30_000
const BOOTSTRAP_LOG_TAIL_BYTES = 24_000

const readinessProbeCache = new Map<
  string,
  {
    value: boolean
    expiresAt: number
    inFlight: Promise<boolean> | null
  }
>()

const bootstrapProbeCache = new Map<
  string,
  {
    value: string | null
    checkedAt: number
    inFlight: Promise<string | null> | null
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

export async function probeBootstrapErrorWithCooldown(
  sshHost: string,
): Promise<string | null> {
  const now = Date.now()
  const cached = bootstrapProbeCache.get(sshHost)

  if (cached) {
    if (cached.inFlight) {
      return cached.inFlight
    }

    if (now - cached.checkedAt < BOOTSTRAP_PROBE_COOLDOWN_MS) {
      return cached.value
    }
  }

  const inFlight = probeBootstrapError(sshHost)
    .then((value) => {
      bootstrapProbeCache.set(sshHost, {
        value,
        checkedAt: Date.now(),
        inFlight: null,
      })
      return value
    })
    .catch(() => {
      const fallback = cached?.value ?? null
      bootstrapProbeCache.set(sshHost, {
        value: fallback,
        checkedAt: Date.now(),
        inFlight: null,
      })
      return fallback
    })

  bootstrapProbeCache.set(sshHost, {
    value: cached?.value ?? null,
    checkedAt: cached?.checkedAt ?? 0,
    inFlight,
  })

  return inFlight
}

async function probeBootstrapError(sshHost: string): Promise<string | null> {
  const [cloudInitResult, bootstrapLogResult] = await Promise.allSettled([
    runVpsSshCommand(sshHost, 'cloud-init status --long 2>/dev/null || true', {
      timeoutMs: 6_000,
      connectTimeoutSeconds: 3,
    }),
    runVpsSshCommand(
      sshHost,
      `tail -c ${BOOTSTRAP_LOG_TAIL_BYTES} /var/log/sato-openclaw-bootstrap.log 2>/dev/null || true`,
      { timeoutMs: 6_000, connectTimeoutSeconds: 3 },
    ),
  ])

  const cloudInitStatus =
    cloudInitResult.status === 'fulfilled' ? cloudInitResult.value : ''
  const bootstrapLog =
    bootstrapLogResult.status === 'fulfilled' ? bootstrapLogResult.value : ''

  return detectBootstrapError(cloudInitStatus, bootstrapLog)
}

function detectBootstrapError(
  cloudInitStatus: string,
  bootstrapLog: string,
): string | null {
  const cloudInitLower = cloudInitStatus.toLowerCase()
  const bootstrapLower = bootstrapLog.toLowerCase()

  if (
    cloudInitLower.includes('runtimeerror(') ||
    cloudInitLower.includes('failed to run module scripts_user') ||
    cloudInitLower.includes('runparts: 1 failures')
  ) {
    if (
      bootstrapLower.includes('openclaw installer') &&
      !bootstrapLower.includes('openclaw binary:')
    ) {
      return 'OpenClaw installation failed before onboarding completed.'
    }

    return 'cloud-init failed while running setup commands on the server.'
  }

  if (cloudInitLower.includes('status: error')) {
    return 'cloud-init reported an error while configuring your server.'
  }

  if (
    bootstrapLower.includes('does not support telegram pairing') ||
    bootstrapLower.includes('unknown channel: telegram')
  ) {
    return 'Installed OpenClaw build is not compatible with Telegram pairing.'
  }

  if (bootstrapLower.includes('gateway failed to bind on port 18789')) {
    return 'OpenClaw gateway failed to start on port 18789.'
  }

  if (
    bootstrapLower.includes('error:') &&
    cloudInitLower.includes('status: done')
  ) {
    return 'Bootstrap script finished with errors.'
  }

  return null
}
