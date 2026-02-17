import { createFileRoute } from '@tanstack/react-router'
import { and, eq } from 'drizzle-orm'
import {
  getUserChannelSetupSummary,
  normalizeChannelSetupForCurrentInstance,
} from '@/lib/channel-connections'
import { db } from '@/db'
import { auditLog, provisioningJob, user, vpsInstance } from '@/db/schema'
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
import { OPENCLAW_GATEWAY_PORT, probeOpenClawGateway } from '@/lib/vps-probes'
import { verifyVpsBootstrapToken } from '@/lib/vps-bootstrap-token'
import { createId } from '@/lib/ids'

const TAILSCALE_JOIN_TIMEOUT_MS = 3 * 60 * 1000
const BOOTSTRAP_TIMEOUT_MS = 10 * 60 * 1000
const BOOTSTRAP_FAILURE_FALLBACK =
  'Assistant setup failed during server bootstrap. Please retry setup.'

const BOOTSTRAP_CHECKPOINT_EVENTS = new Set([
  'bootstrap_started',
  'tailscale_joined',
  'gateway_ready',
  'bootstrap_warning',
  'bootstrap_completed',
  'bootstrap_failed',
])

const BOOTSTRAP_FAILURE_MESSAGES: Record<string, string> = {
  tailscale_join_failed:
    'Server failed to join the private network during bootstrap.',
  openclaw_onboard_failed:
    'Server joined the private network, but OpenClaw onboarding failed.',
  telegram_plugin_enable_failed:
    'Bootstrap failed while enabling the Telegram plugin.',
  telegram_plugin_missing_after_enable:
    'Bootstrap failed because the Telegram plugin was not enabled.',
  gateway_bind_failed:
    'Bootstrap failed because OpenClaw gateway did not bind on port 18789.',
}

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

          const { provisionedAt, hasPersonalized, ...vpsPayload } = vpsState

          return Response.json({
            ...vpsPayload,
            hasPersonalized,
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
      POST: async ({ request }) => {
        try {
          return await handleBootstrapCheckpoint({ request })
        } catch (error) {
          return safeApiResponse(error, 400)
        }
      },
    },
  },
})

function isBootstrapPhase(status: string): boolean {
  return status === 'provisioning' || status === 'bootstrapping'
}

function isValidBootstrapEvent(event: string): boolean {
  return BOOTSTRAP_CHECKPOINT_EVENTS.has(event)
}

function isValidTailscaleIp(value: string | null): value is string {
  if (!value) {
    return false
  }

  return /^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)
}

function normalizeBootstrapFailure(detail: string): string {
  const mapped = BOOTSTRAP_FAILURE_MESSAGES[detail]
  if (mapped) {
    return mapped
  }

  if (detail) {
    console.error('[vps-bootstrap] Unmapped bootstrap failure detail:', detail)
  }

  return BOOTSTRAP_FAILURE_FALLBACK
}

async function parseBootstrapCheckpointInput(request: Request): Promise<{
  token: string
  event: string
  detail: string
  tailscaleIp: string | null
} | null> {
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!body) {
      return null
    }

    const token = typeof body.token === 'string' ? body.token.trim() : ''
    const event = typeof body.event === 'string' ? body.event.trim() : ''
    const detail = typeof body.detail === 'string' ? body.detail.trim() : ''
    const tailscaleIp =
      typeof body.tailscaleIp === 'string' ? body.tailscaleIp.trim() : ''

    if (!token || !event) {
      return null
    }

    return {
      token,
      event,
      detail,
      tailscaleIp: tailscaleIp || null,
    }
  }

  const formData = await request.formData().catch(() => null)
  if (!formData) {
    return null
  }

  const token = formData.get('token')
  const event = formData.get('event')
  const detail = formData.get('detail')
  const tailscaleIp = formData.get('tailscaleIp')

  const tokenValue = typeof token === 'string' ? token.trim() : ''
  const eventValue = typeof event === 'string' ? event.trim() : ''
  const detailValue = typeof detail === 'string' ? detail.trim() : ''
  const tailscaleIpValue =
    typeof tailscaleIp === 'string' ? tailscaleIp.trim() : ''

  if (!tokenValue || !eventValue) {
    return null
  }

  return {
    token: tokenValue,
    event: eventValue,
    detail: detailValue,
    tailscaleIp: tailscaleIpValue || null,
  }
}

async function handleBootstrapCheckpoint({
  request,
}: {
  request: Request
}): Promise<Response> {
  const parsed = await parseBootstrapCheckpointInput(request)
  if (!parsed || !isValidBootstrapEvent(parsed.event)) {
    return Response.json({ error: 'Invalid input' }, { status: 400 })
  }

  const tokenPayload = verifyVpsBootstrapToken({ token: parsed.token })
  if (!tokenPayload) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [instance, job] = await Promise.all([
    db.query.vpsInstance.findFirst({
      where: eq(vpsInstance.userId, tokenPayload.userId),
      columns: {
        status: true,
      },
    }),
    db.query.provisioningJob.findFirst({
      where: and(
        eq(provisioningJob.userId, tokenPayload.userId),
        eq(provisioningJob.requestId, tokenPayload.requestId),
      ),
      columns: {
        id: true,
        status: true,
      },
    }),
  ])

  if (!instance || !job) {
    return Response.json({ ok: true })
  }

  const now = new Date()

  if (parsed.event === 'bootstrap_failed') {
    if (instance.status === 'active') {
      return Response.json({ ok: true })
    }

    const reason = normalizeBootstrapFailure(parsed.detail)

    await Promise.all([
      db
        .update(vpsInstance)
        .set({
          status: 'failed',
          lastUpdatedAt: now,
        })
        .where(eq(vpsInstance.userId, tokenPayload.userId)),
      db
        .update(provisioningJob)
        .set({
          status: 'failed',
          errorMessage: reason,
        })
        .where(eq(provisioningJob.id, job.id)),
    ])

    return Response.json({ ok: true })
  }

  if (parsed.event === 'bootstrap_warning') {
    await db.insert(auditLog).values({
      id: createId(),
      userId: tokenPayload.userId,
      action: 'vps.bootstrap_warning',
      metadata: JSON.stringify({
        requestId: tokenPayload.requestId,
        detail: parsed.detail || 'unknown',
        tailscaleIp: parsed.tailscaleIp,
      }),
      createdAt: now,
    })
  }

  const instanceUpdate: Record<string, unknown> = {
    lastUpdatedAt: now,
  }

  if (isBootstrapPhase(instance.status)) {
    instanceUpdate.status = 'bootstrapping'
  }

  if (
    parsed.event === 'tailscale_joined' &&
    isValidTailscaleIp(parsed.tailscaleIp)
  ) {
    instanceUpdate.tailscaleIp = parsed.tailscaleIp
  }

  const provisioningUpdate: Record<string, unknown> = {}

  if (parsed.event === 'bootstrap_completed') {
    provisioningUpdate.status = 'completed'
    provisioningUpdate.errorMessage = null
  } else if (job.status !== 'failed' && job.status !== 'completed') {
    provisioningUpdate.status = 'bootstrapping'
  }

  const updates: Array<Promise<unknown>> = [
    db
      .update(vpsInstance)
      .set(instanceUpdate)
      .where(eq(vpsInstance.userId, tokenPayload.userId)),
  ]

  if (Object.keys(provisioningUpdate).length > 0) {
    updates.push(
      db
        .update(provisioningJob)
        .set(provisioningUpdate)
        .where(eq(provisioningJob.id, job.id)),
    )
  }

  await Promise.all(updates)

  return Response.json({ ok: true })
}

export async function computeVpsProbeState({ userId }: { userId: string }) {
  const userWithVps = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { assistantName: true, preferredModel: true },
    with: {
      vpsInstance: {
        columns: {
          status: true,
          ipv4Address: true,
          tailscaleIp: true,
          tailscaleHostname: true,
          region: true,
          serverType: true,
          lastUpdatedAt: true,
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

  if (latestProvisionJob?.status === 'failed') {
    bootstrapError =
      latestProvisionJob.errorMessage?.trim() || BOOTSTRAP_FAILURE_FALLBACK
    vpsFailureReason = bootstrapError
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
      !bootstrapError &&
      instance.status === 'bootstrapping' &&
      !instance.tailscaleIp &&
      instance.lastUpdatedAt &&
      Date.now() - new Date(instance.lastUpdatedAt).getTime() >
        TAILSCALE_JOIN_TIMEOUT_MS
    ) {
      const tailscaleTimeoutMessage =
        'Server failed to join the private network. This usually means cloud-init did not run. Please retry setup.'

      await markFailed({ userId, reason: tailscaleTimeoutMessage })
      instance = { ...instance, status: 'failed' }
      bootstrapError = tailscaleTimeoutMessage
      vpsFailureReason = tailscaleTimeoutMessage
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
      bootstrapError = timeoutMessage
      vpsFailureReason = timeoutMessage
    }

    if (
      openClawReady &&
      (isBootstrapPhase(instance.status) || instance.status === 'failed')
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

      await Promise.all([
        db
          .update(vpsInstance)
          .set(activationFields)
          .where(eq(vpsInstance.userId, userId)),
        db
          .update(provisioningJob)
          .set({ status: 'completed', errorMessage: null })
          .where(eq(provisioningJob.userId, userId)),
      ])

      instance = {
        ...instance,
        status: 'active',
      }
      bootstrapError = null
      vpsFailureReason = null
    }
  }

  if (instance?.status === 'failed' && !vpsFailureReason) {
    vpsFailureReason =
      'Assistant setup failed on the server. Please retry provisioning.'
  }

  return {
    hasPersonalized: !!userWithVps?.assistantName,
    preferredModel: userWithVps?.preferredModel ?? null,
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
