import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import type { UserChannelSetupSummary } from '@/lib/channel-connections'
import { db } from '@/db'
import { provisioningJob, vpsInstance } from '@/db/schema'
import { getUserAccessState } from '@/lib/access-control'
import { safeApiResponse } from '@/lib/api-error'
import {
  getTopupPacks,
  getUserCreditStateSnapshot,
  triggerUserCreditSyncIfStale,
} from '@/lib/credits'
import { getUserChannelSetupSummary } from '@/lib/channel-connections'
import { isTcpPortReachable } from '@/lib/readiness'
import { assertRateLimit } from '@/lib/rate-limit'
import { requireSession } from '@/lib/session'
import { findDeviceTailscaleIp } from '@/lib/tailscale'
import { runVpsSshCommand } from '@/lib/vps-ssh'

const BOOTSTRAP_LOG_TAIL_BYTES = 24_000
const OPENCLAW_GATEWAY_PORT = 18789
const OPENCLAW_PROBE_TIMEOUT_MS = 800
const OPENCLAW_PROBE_CACHE_TTL_MS = 10_000
const BOOTSTRAP_PROBE_COOLDOWN_MS = 30_000
const BOOTSTRAP_TIMEOUT_MS = 10 * 60 * 1000

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

export const Route = createFileRoute('/api/vps/status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await requireSession()

          const rateLimited = assertRateLimit(
            request,
            'vps-status',
            session.user.id,
          )
          if (rateLimited) return rateLimited

          const userId = session.user.id

          triggerUserCreditSyncIfStale(userId)

          const [instanceRow, latestProvisionJob] = await Promise.all([
            db.query.vpsInstance.findFirst({
              where: eq(vpsInstance.userId, userId),
              columns: {
                status: true,
                ipv4Address: true,
                tailscaleIp: true,
                tailscaleHostname: true,
                region: true,
                serverType: true,
                provisionedAt: true,
                updatedAt: true,
              },
            }),
            db.query.provisioningJob.findFirst({
              where: eq(provisioningJob.userId, userId),
              orderBy: (job, { desc }) => desc(job.updatedAt),
              columns: {
                status: true,
                errorMessage: true,
                updatedAt: true,
              },
            }),
          ])

          let instance: typeof instanceRow | null = instanceRow ?? null
          let openClawReady = false
          let bootstrapError: string | null = null
          let vpsFailureReason = normalizeFailureReason(
            latestProvisionJob?.errorMessage,
          )

          if (instance?.status === 'terminated') {
            instance = null
          }

          const vpsProbe = (async () => {
            if (!instance?.ipv4Address) return

            if (
              !instance.tailscaleIp &&
              instance.tailscaleHostname &&
              (instance.status === 'bootstrapping' ||
                instance.status === 'active')
            ) {
              try {
                const discoveredIp = await findDeviceTailscaleIp({
                  hostname: instance.tailscaleHostname,
                })
                if (discoveredIp) {
                  await db
                    .update(vpsInstance)
                    .set({ tailscaleIp: discoveredIp, updatedAt: new Date() })
                    .where(eq(vpsInstance.userId, userId))
                  instance = { ...instance, tailscaleIp: discoveredIp }
                }
              } catch {
                // Tailscale API unavailable — continue without discovery
              }
            }

            openClawReady = instance.ipv4Address
              ? await probeOpenClawGateway(instance.ipv4Address)
              : false

            if (
              !openClawReady &&
              instance.tailscaleIp &&
              (instance.status === 'provisioning' ||
                instance.status === 'bootstrapping')
            ) {
              bootstrapError = await probeBootstrapErrorWithCooldown(
                instance.tailscaleIp,
              )

              if (bootstrapError) {
                await db
                  .update(vpsInstance)
                  .set({
                    status: 'failed',
                    updatedAt: new Date(),
                  })
                  .where(eq(vpsInstance.userId, userId))

                await db
                  .update(provisioningJob)
                  .set({
                    status: 'failed',
                    errorMessage: bootstrapError,
                    updatedAt: new Date(),
                  })
                  .where(eq(provisioningJob.userId, userId))

                instance = {
                  ...instance,
                  status: 'failed',
                }
                vpsFailureReason = bootstrapError
              }
            }

            if (
              !openClawReady &&
              !bootstrapError &&
              instance.status === 'bootstrapping' &&
              Date.now() - new Date(instance.updatedAt).getTime() >
                BOOTSTRAP_TIMEOUT_MS
            ) {
              const timeoutMessage =
                'Your assistant took too long to start and may have encountered an issue. Please retry setup.'

              await db
                .update(vpsInstance)
                .set({
                  status: 'failed',
                  updatedAt: new Date(),
                })
                .where(eq(vpsInstance.userId, userId))

              await db
                .update(provisioningJob)
                .set({
                  status: 'failed',
                  errorMessage: timeoutMessage,
                  updatedAt: new Date(),
                })
                .where(eq(provisioningJob.userId, userId))

              instance = {
                ...instance,
                status: 'failed',
              }
              vpsFailureReason = timeoutMessage
            }

            if (
              openClawReady &&
              (instance.status === 'provisioning' ||
                instance.status === 'bootstrapping')
            ) {
              await db
                .update(vpsInstance)
                .set({
                  status: 'active',
                  provisionedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(vpsInstance.userId, userId))

              instance = {
                ...instance,
                status: 'active',
              }
            }
          })()

          const [, access, credits, channelSetup] = await Promise.all([
            vpsProbe,
            getUserAccessState(userId),
            getUserCreditStateSnapshot(userId),
            getUserChannelSetupSummary(userId),
          ])
          const effectiveChannelSetup = normalizeChannelSetupForCurrentInstance(
            channelSetup,
            instance?.provisionedAt ?? null,
          )

          if (instance?.status === 'failed' && !vpsFailureReason) {
            vpsFailureReason =
              'Assistant setup failed on the server. Please retry provisioning.'
          }

          const topupPacks = getTopupPacks().map((pack) => ({
            id: pack.id,
            label: pack.label,
            credits: pack.credits,
          }))

          return Response.json({
            access,
            credits,
            topupPacks,
            openClawGatewayPort: OPENCLAW_GATEWAY_PORT,
            openClawReady,
            bootstrappingError: bootstrapError,
            vpsFailureReason,
            vps: instance ?? null,
            channelSetup: effectiveChannelSetup,
          })
        } catch (error) {
          return safeApiResponse(error)
        }
      },
    },
  },
})

function normalizeChannelSetupForCurrentInstance(
  channelSetup: UserChannelSetupSummary,
  provisionedAt: Date | null,
): UserChannelSetupSummary {
  if (!provisionedAt) {
    return {
      channels: channelSetup.channels.map((channel) =>
        channel.connected
          ? {
              ...channel,
              connected: false,
              setupState: 'disconnected',
            }
          : channel,
      ),
      connectedChannels: [],
      connectedCount: 0,
      hasConnectedChannel: false,
    }
  }

  const provisionedAtMs = provisionedAt.getTime()
  const channels = channelSetup.channels.map((channel) => {
    if (!channel.connected) {
      return channel
    }

    const connectedAtMs = channel.connectedAt
      ? Date.parse(channel.connectedAt)
      : NaN
    if (Number.isNaN(connectedAtMs) || connectedAtMs < provisionedAtMs) {
      return {
        ...channel,
        connected: false,
        setupState: 'disconnected' as const,
      }
    }

    return channel
  })

  const connectedChannels = channels
    .filter((channel) => channel.connected)
    .map((channel) => channel.channel)

  return {
    channels,
    connectedChannels,
    connectedCount: connectedChannels.length,
    hasConnectedChannel: connectedChannels.length > 0,
  }
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

async function probeOpenClawGateway(ipv4Address: string): Promise<boolean> {
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

async function probeBootstrapErrorWithCooldown(
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

function normalizeFailureReason(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const message = value.trim()
  if (!message) {
    return null
  }

  return message
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
