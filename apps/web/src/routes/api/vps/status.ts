import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import {
  getUserChannelSetupSummary,
  normalizeChannelSetupForCurrentInstance,
} from '@/lib/channel-connections'
import { db } from '@/db'
import { provisioningJob, user, vpsInstance } from '@/db/schema'
import { getOpenClawVersion } from '@/lib/vps-maintenance'
import { getUserAccessState } from '@/lib/access-control'
import { safeApiResponse } from '@/lib/api-error'
import {
  getTopupPacks,
  getUserCreditStateSnapshot,
  triggerUserCreditSyncIfStale,
} from '@/lib/credits'
import { assertRateLimit } from '@/lib/rate-limit'
import { requireSession } from '@/lib/session'
import { findDeviceTailscaleIp } from '@/lib/tailscale'
import {
  OPENCLAW_GATEWAY_PORT,
  probeBootstrapErrorWithCooldown,
  probeOpenClawGateway,
} from '@/lib/vps-probes'

const BOOTSTRAP_TIMEOUT_MS = 10 * 60 * 1000

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

          const [vpsState, access, credits, channelSetup] = await Promise.all([
            computeVpsProbeState({ userId }),
            getUserAccessState(userId),
            getUserCreditStateSnapshot(userId),
            getUserChannelSetupSummary(userId),
          ])

          const { provisionedAt, ...vpsPayload } = vpsState

          return Response.json({
            ...vpsPayload,
            access,
            credits,
            topupPacks: getTopupPacks().map((pack) => ({
              id: pack.id,
              label: pack.label,
              credits: pack.credits,
            })),
            openClawGatewayPort: OPENCLAW_GATEWAY_PORT,
            channelSetup: normalizeChannelSetupForCurrentInstance(
              channelSetup,
              provisionedAt,
            ),
          })
        } catch (error) {
          return safeApiResponse(error)
        }
      },
    },
  },
})

export async function computeVpsProbeState({ userId }: { userId: string }) {
  const userWithVps = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: {},
    with: {
      vpsInstance: {
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
      },
      provisioningJobs: {
        columns: {
          status: true,
          errorMessage: true,
          updatedAt: true,
        },
        orderBy: (job, { desc }) => desc(job.updatedAt),
        limit: 1,
      },
    },
  })

  const instanceRow = userWithVps?.vpsInstance ?? null
  const latestProvisionJob = userWithVps?.provisioningJobs[0] ?? null

  let instance: typeof instanceRow | null = instanceRow
  let openClawReady = false
  let bootstrapError: string | null = null
  let vpsFailureReason = latestProvisionJob?.errorMessage?.trim() || null

  if (instance?.status === 'terminated') {
    instance = null
  }

  if (instance?.ipv4Address) {
    if (
      !instance.tailscaleIp &&
      instance.tailscaleHostname &&
      (instance.status === 'bootstrapping' || instance.status === 'active')
    ) {
      try {
        const discoveredIp = await findDeviceTailscaleIp({
          hostname: instance.tailscaleHostname,
        })
        if (discoveredIp) {
          await db
            .update(vpsInstance)
            .set({ tailscaleIp: discoveredIp })
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
        await markFailed({ userId, reason: bootstrapError })
        instance = { ...instance, status: 'failed' }
        vpsFailureReason = bootstrapError
      }
    }

    if (
      !openClawReady &&
      !bootstrapError &&
      instance.status === 'bootstrapping' &&
      Date.now() - new Date(instance.updatedAt).getTime() > BOOTSTRAP_TIMEOUT_MS
    ) {
      const timeoutMessage =
        'Your assistant took too long to start and may have encountered an issue. Please retry setup.'

      await markFailed({ userId, reason: timeoutMessage })
      instance = { ...instance, status: 'failed' }
      vpsFailureReason = timeoutMessage
    }

    if (
      openClawReady &&
      (instance.status === 'provisioning' ||
        instance.status === 'bootstrapping')
    ) {
      const activationFields: Record<string, unknown> = {
        status: 'active',
        provisionedAt: new Date(),
      }

      const sshHost = instance.tailscaleIp

      if (sshHost) {
        const version = await getOpenClawVersion({ host: sshHost })
        if (version) {
          activationFields.openclawVersion = version
        }
      }

      await db
        .update(vpsInstance)
        .set(activationFields)
        .where(eq(vpsInstance.userId, userId))

      instance = {
        ...instance,
        status: 'active',
      }
    }
  }

  if (instance?.status === 'failed' && !vpsFailureReason) {
    vpsFailureReason =
      'Assistant setup failed on the server. Please retry provisioning.'
  }

  return {
    openClawReady,
    bootstrappingError: bootstrapError,
    vpsFailureReason,
    vps: instance
      ? {
          status: instance.status,
          ipv4Address: instance.ipv4Address,
          region: instance.region,
          serverType: instance.serverType,
        }
      : null,
    provisionedAt: instance?.provisionedAt ?? null,
  }
}

async function markFailed({
  userId,
  reason,
}: {
  userId: string
  reason: string
}) {
  await Promise.all([
    db
      .update(vpsInstance)
      .set({ status: 'failed' })
      .where(eq(vpsInstance.userId, userId)),
    db
      .update(provisioningJob)
      .set({ status: 'failed', errorMessage: reason })
      .where(eq(provisioningJob.userId, userId)),
  ])
}
