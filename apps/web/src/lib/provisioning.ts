import { and, eq, inArray, sql } from 'drizzle-orm'
import bootstrapTemplateRaw from '../../scripts/templates/vps-bootstrap.sh.tmpl?raw'
import type { HetznerLabels } from '@/lib/hetzner'
import { db } from '@/db'
import {
  auditLog,
  provisioningJob,
  user,
  vpsDataEncryption,
  vpsInstance,
} from '@/db/schema'
import {
  deleteUserOpenRouterKey,
  ensureUserOpenRouterApiKey,
} from '@/lib/credits'
import { clearUserChannelConnections } from '@/lib/channel-connections'
import { env } from '@/lib/env'
import {
  assertServerTypeAvailable,
  assertSnapshotAvailable,
  createFirewall,
  createServer,
  deleteFirewall,
  deleteServer,
  listFirewallsByLabels,
  listServersByLabels,
  normalizeHetznerServerType,
  removeFirewallFromServer,
} from '@/lib/hetzner'
import { getGatewayAuthToken } from '@/lib/gateway-auth'
import { createId } from '@/lib/ids'
import { normalizeModel } from '@/lib/models'
import { createEphemeralAuthKey, deleteDeviceByHostname } from '@/lib/tailscale'
import { createDataEncryptionForUser } from '@/lib/vps-data-encryption'
import { createVpsBootstrapToken } from '@/lib/vps-bootstrap-token'

const CLEANUP_ATTEMPTS = 3
const CLEANUP_BACKOFF_MS = 500
const BOOTSTRAP_TEMPLATE = bootstrapTemplateRaw.replace(/\r\n/g, '\n').trimEnd()
const PROVISIONING_TEMPORARY_FAILURE_MESSAGE =
  'Assistant setup is temporarily unavailable. Please retry in a few minutes.'
const PROVISIONING_CLEANUP_PENDING_MESSAGE =
  'Assistant cleanup is taking longer than expected. Please retry shortly.'
const PROVISIONING_APP_URL_UNREACHABLE_MESSAGE =
  'Provisioning requires APP_URL to be reachable from the VPS. Use a public URL (or tunnel URL), not localhost.'
const PROVISION_STARTABLE_INSTANCE_STATUSES = [
  'pending',
  'failed',
  'terminated',
]
const ACTIVE_PROVISIONING_JOB_STATUSES = [
  'started',
  'bootstrapping',
  'cleanup_pending',
]
const PROVISION_LOCK_NAMESPACE = 77801

interface ProvisionInput {
  userId: string
  region?: string
  serverType?: string
  idempotencyKey?: string | null
}

interface CleanupOutcome {
  remainingServerId: string | null
  remainingFirewallId: string | null
  errors: Array<string>
}

interface ProvisioningStartState {
  region: string
  serverType: string
  requestId: string
  jobId: string
}

function buildResourceName(prefix: 'srv' | 'fw', userId: string): string {
  const cleanUser =
    userId
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 8) || 'user'
  const entropy = createId()
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()

  return `sato-${prefix}-${cleanUser}-${entropy}`.slice(0, 63)
}

function buildTailscaleHostname({
  serverName,
}: {
  serverName: string
}): string {
  return `sato-vps-${serverName}`.slice(0, 63)
}

function escapeForSingleQuotedBash(value: string): string {
  return value.replace(/'/g, `'"'"'`)
}

function getBootstrapTemplate(): string {
  return BOOTSTRAP_TEMPLATE
}

function renderBootstrapTemplate({
  bootstrapCheckpointUrl,
  bootstrapCheckpointToken,
  tailscaleAuthKey,
  tailscaleHostname,
  openclawGatewayToken,
  encryptionKeyUrl,
  encryptionUserId,
  encryptionAuthSecret,
  dataVolumeSizeGb,
  preferredModel,
}: {
  bootstrapCheckpointUrl: string
  bootstrapCheckpointToken: string
  tailscaleAuthKey: string
  tailscaleHostname: string
  openclawGatewayToken: string
  encryptionKeyUrl: string
  encryptionUserId: string
  encryptionAuthSecret: string
  dataVolumeSizeGb: number
  preferredModel: string
}): string {
  const replacements = {
    CHECKPOINT_URL: escapeForSingleQuotedBash(bootstrapCheckpointUrl),
    CHECKPOINT_TOKEN: escapeForSingleQuotedBash(bootstrapCheckpointToken),
    TAILSCALE_AUTH_KEY: escapeForSingleQuotedBash(tailscaleAuthKey),
    TAILSCALE_HOSTNAME: escapeForSingleQuotedBash(tailscaleHostname),
    OPENCLAW_GATEWAY_TOKEN: escapeForSingleQuotedBash(openclawGatewayToken),
    ENCRYPTION_KEY_URL: escapeForSingleQuotedBash(encryptionKeyUrl),
    ENCRYPTION_USER_ID: escapeForSingleQuotedBash(encryptionUserId),
    ENCRYPTION_AUTH_SECRET: escapeForSingleQuotedBash(encryptionAuthSecret),
    DATA_VOLUME_SIZE_GB: String(dataVolumeSizeGb),
    PREFERRED_MODEL: escapeForSingleQuotedBash(preferredModel),
  }

  let script = getBootstrapTemplate()
  for (const [key, value] of Object.entries(replacements)) {
    script = script.replaceAll(`{{${key}}}`, value)
  }

  const unresolved = script.match(/{{[A-Z0-9_]+}}/g)
  if (unresolved && unresolved.length > 0) {
    throw new Error(
      `Bootstrap template has unresolved placeholders: ${unresolved.join(', ')}`,
    )
  }

  return script
}

function indentForCloudConfigBlock(content: string): string {
  return content
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n')
}

function buildSnapshotCloudInit({
  openRouterApiKey,
  tailscaleAuthKey,
  tailscaleHostname,
  bootstrapCheckpointUrl,
  bootstrapCheckpointToken,
  openclawGatewayToken,
  encryptionKeyUrl,
  encryptionUserId,
  encryptionAuthSecret,
  dataVolumeSizeGb,
  preferredModel,
}: {
  openRouterApiKey: string
  tailscaleAuthKey: string
  tailscaleHostname: string
  bootstrapCheckpointUrl: string
  bootstrapCheckpointToken: string
  openclawGatewayToken: string
  encryptionKeyUrl: string
  encryptionUserId: string
  encryptionAuthSecret: string
  dataVolumeSizeGb: number
  preferredModel: string
}): string {
  const safeApiKey = escapeForSingleQuotedBash(openRouterApiKey)
  const bootstrapScript = renderBootstrapTemplate({
    bootstrapCheckpointUrl,
    bootstrapCheckpointToken,
    tailscaleAuthKey,
    tailscaleHostname,
    openclawGatewayToken,
    encryptionKeyUrl,
    encryptionUserId,
    encryptionAuthSecret,
    dataVolumeSizeGb,
    preferredModel,
  })

  return [
    '#cloud-config',
    'package_update: false',
    'write_files:',
    '  - path: /etc/sato/openclaw.env',
    '    owner: root:root',
    "    permissions: '0600'",
    '    content: |',
    `      OPENROUTER_API_KEY='${safeApiKey}'`,
    '  - path: /var/lib/sato/bootstrap.sh',
    '    owner: root:root',
    "    permissions: '0700'",
    '    content: |',
    indentForCloudConfigBlock(bootstrapScript),
    'runcmd:',
    "  - /bin/bash -lc '/var/lib/sato/bootstrap.sh > /var/log/sato-openclaw-bootstrap.log 2>&1'",
  ].join('\n')
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

function mapProvisioningErrorMessage(message: string): string {
  const lower = message.toLowerCase()

  if (
    lower.includes('image not found') ||
    lower.includes('hetzner api error') ||
    lower.includes('configured vps snapshot') ||
    lower.includes('configured snapshot') ||
    lower.includes('configured image')
  ) {
    return PROVISIONING_TEMPORARY_FAILURE_MESSAGE
  }

  return message
}

function isUniqueViolationForConstraint({
  error,
  constraints,
}: {
  error: unknown
  constraints: Array<string>
}): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const dbError = error as { code?: string; constraint?: string }
  if (dbError.code !== '23505') {
    return false
  }

  if (!dbError.constraint) {
    return true
  }

  return constraints.includes(dbError.constraint)
}

function resolveIdempotentProvisionResult({
  status,
  errorMessage,
}: {
  status: string
  errorMessage: string | null
}): { status: 'bootstrapping' } {
  if (status === 'failed' || status === 'cleanup_pending') {
    throw new Error(
      errorMessage?.trim() || PROVISIONING_TEMPORARY_FAILURE_MESSAGE,
    )
  }

  return { status: 'bootstrapping' }
}

function sanitizeLabelValue(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 63)

  return sanitized || 'na'
}

function assertProvisioningAppUrlReachable(): void {
  let appUrl: URL
  try {
    appUrl = new URL(env.APP_URL)
  } catch {
    throw new Error(PROVISIONING_APP_URL_UNREACHABLE_MESSAGE)
  }

  const host = appUrl.hostname.trim().toLowerCase()
  const localHosts = new Set(['localhost', '127.0.0.1', '::1'])

  if (localHosts.has(host)) {
    throw new Error(PROVISIONING_APP_URL_UNREACHABLE_MESSAGE)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function isNotFoundError(message: string): boolean {
  return (
    message.includes('Hetzner API error (404)') ||
    message.includes('"code":"not_found"') ||
    message.includes('"code": "not_found"')
  )
}

async function runCleanupWithRetries(
  operation: () => Promise<void>,
): Promise<string | null> {
  let lastError: string | null = null

  for (let attempt = 0; attempt < CLEANUP_ATTEMPTS; attempt += 1) {
    try {
      await operation()
      return null
    } catch (error) {
      const message = getErrorMessage(error)

      if (isNotFoundError(message)) {
        return null
      }

      lastError = message
      if (attempt < CLEANUP_ATTEMPTS - 1) {
        await sleep(CLEANUP_BACKOFF_MS * (attempt + 1))
      }
    }
  }

  return lastError
}

async function cleanupProvisioningResources(
  serverId: string | null,
  firewallId: string | null,
): Promise<CleanupOutcome> {
  let remainingServerId = serverId
  let remainingFirewallId = firewallId
  const errors: Array<string> = []

  if (remainingServerId && remainingFirewallId) {
    await runCleanupWithRetries(async () => {
      await removeFirewallFromServer(
        remainingFirewallId as string,
        remainingServerId as string,
      )
    })
  }

  if (remainingServerId) {
    const cleanupError = await runCleanupWithRetries(async () => {
      await deleteServer(remainingServerId as string)
    })

    if (cleanupError) {
      errors.push(`server: ${cleanupError}`)
    } else {
      remainingServerId = null
    }
  }

  if (remainingFirewallId) {
    const cleanupError = await runCleanupWithRetries(async () => {
      await deleteFirewall(remainingFirewallId as string)
    })

    if (cleanupError) {
      errors.push(`firewall: ${cleanupError}`)
    } else {
      remainingFirewallId = null
    }
  }

  return {
    remainingServerId,
    remainingFirewallId,
    errors,
  }
}

async function cleanupStaleResourcesForUser({
  userId,
  preserveProvisioningStatus = false,
}: {
  userId: string
  preserveProvisioningStatus?: boolean
}): Promise<void> {
  const instanceRows = await db
    .select({
      serverId: vpsInstance.hetznerServerId,
      firewallId: vpsInstance.hetznerFirewallId,
      tailscaleHostname: vpsInstance.tailscaleHostname,
      tailscaleIp: vpsInstance.tailscaleIp,
    })
    .from(vpsInstance)
    .where(eq(vpsInstance.userId, userId))
    .limit(1)

  const instance = instanceRows.at(0)

  if (!instance) {
    return
  }

  if (
    !instance.serverId &&
    !instance.firewallId &&
    !instance.tailscaleHostname &&
    !instance.tailscaleIp
  ) {
    return
  }

  const cleanupErrors: Array<string> = []

  if (instance.tailscaleHostname || instance.tailscaleIp) {
    const tailscaleCleanupError = await runCleanupWithRetries(async () => {
      await deleteDeviceByHostname({
        hostname: instance.tailscaleHostname,
        tailscaleIp: instance.tailscaleIp,
      })
    })

    if (tailscaleCleanupError) {
      cleanupErrors.push(`tailscale: ${tailscaleCleanupError}`)
    }
  }

  const cleanup = await cleanupProvisioningResources(
    instance.serverId,
    instance.firewallId,
  )
  cleanupErrors.push(...cleanup.errors)

  const hasCleanupErrors = cleanupErrors.length > 0

  await db
    .update(vpsInstance)
    .set({
      status: hasCleanupErrors
        ? 'cleanup_pending'
        : preserveProvisioningStatus
          ? 'provisioning'
          : 'pending',
      hetznerServerId: cleanup.remainingServerId,
      hetznerFirewallId: cleanup.remainingFirewallId,
      ipv4Address: null,
      tailscaleIp: hasCleanupErrors ? instance.tailscaleIp : null,
      tailscaleHostname: hasCleanupErrors ? instance.tailscaleHostname : null,
      openclawVersion: null,
      lastUpdatedAt: null,
    })
    .where(eq(vpsInstance.userId, userId))

  if (hasCleanupErrors) {
    console.error(
      '[vps-provision] Failed to clean up stale resources:',
      cleanupErrors.join(' | '),
    )
    throw new Error(PROVISIONING_CLEANUP_PENDING_MESSAGE)
  }
}

async function cleanupOrphanProviderResourcesForUser({
  userId,
}: {
  userId: string
}): Promise<void> {
  const labels: HetznerLabels = {
    app: 'sato',
    sato_user: sanitizeLabelValue(userId),
  }

  const [servers, firewalls] = await Promise.all([
    listServersByLabels({ labels }),
    listFirewallsByLabels({ labels }),
  ])

  if (servers.length === 0 && firewalls.length === 0) {
    return
  }

  const cleanupErrors: Array<string> = []

  for (const server of servers) {
    const cleanupError = await runCleanupWithRetries(async () => {
      await deleteServer(server.id)
    })

    if (cleanupError) {
      cleanupErrors.push(`server:${server.id}: ${cleanupError}`)
    }
  }

  for (const firewall of firewalls) {
    const cleanupError = await runCleanupWithRetries(async () => {
      await deleteFirewall(firewall.id)
    })

    if (cleanupError) {
      cleanupErrors.push(`firewall:${firewall.id}: ${cleanupError}`)
    }
  }

  if (cleanupErrors.length > 0) {
    console.error(
      '[vps-provision] Failed to clean up provider orphans:',
      cleanupErrors.join(' | '),
    )
    throw new Error(PROVISIONING_CLEANUP_PENDING_MESSAGE)
  }
}

async function beginProvisioningSession({
  userId,
  region: requestedRegion,
  serverType: requestedServerType,
  snapshotId,
  idempotencyKey,
}: {
  userId: string
  region?: string
  serverType?: string
  snapshotId: string
  idempotencyKey?: string | null
}): Promise<ProvisioningStartState | { status: 'bootstrapping' }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${PROVISION_LOCK_NAMESPACE}, hashtext(${userId}))`,
    )

    if (idempotencyKey) {
      const previousRequest = await tx.query.provisioningJob.findFirst({
        where: and(
          eq(provisioningJob.userId, userId),
          eq(provisioningJob.idempotencyKey, idempotencyKey),
        ),
        columns: {
          status: true,
          errorMessage: true,
        },
      })

      if (previousRequest) {
        return resolveIdempotentProvisionResult({
          status: previousRequest.status,
          errorMessage: previousRequest.errorMessage,
        })
      }
    }

    const activeJob = await tx.query.provisioningJob.findFirst({
      where: and(
        eq(provisioningJob.userId, userId),
        eq(provisioningJob.type, 'provision'),
        inArray(provisioningJob.status, ACTIVE_PROVISIONING_JOB_STATUSES),
      ),
      columns: {
        status: true,
      },
    })

    if (activeJob) {
      throw new Error('This account already has a VPS instance')
    }

    const instanceRow = await tx.query.vpsInstance.findFirst({
      where: eq(vpsInstance.userId, userId),
      columns: {
        id: true,
        status: true,
        region: true,
        serverType: true,
      },
    })

    const region = (requestedRegion ?? instanceRow?.region ?? 'nbg1')
      .trim()
      .toLowerCase()
    const serverType = normalizeHetznerServerType(
      requestedServerType ?? instanceRow?.serverType ?? 'cpx22',
    )
    const now = new Date()
    const requestId = createId()
    const jobId = createId()
    const instanceId = instanceRow?.id ?? createId()

    if (instanceRow) {
      const updatedRows = await tx
        .update(vpsInstance)
        .set({
          status: 'provisioning',
          region,
          serverType,
          snapshotVersion: snapshotId,
          ipv4Address: null,
          openclawVersion: null,
          lastUpdatedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(vpsInstance.userId, userId),
            inArray(vpsInstance.status, PROVISION_STARTABLE_INSTANCE_STATUSES),
          ),
        )
        .returning({ id: vpsInstance.id })

      if (updatedRows.length === 0) {
        throw new Error('This account already has a VPS instance')
      }
    } else {
      await tx.insert(vpsInstance).values({
        id: instanceId,
        userId,
        region,
        serverType,
        status: 'provisioning',
        hetznerServerId: null,
        hetznerFirewallId: null,
        ipv4Address: null,
        tailscaleIp: null,
        tailscaleHostname: null,
        snapshotVersion: snapshotId,
        openclawVersion: null,
        lastUpdatedAt: null,
        createdAt: now,
      })
    }

    await tx.insert(provisioningJob).values({
      id: jobId,
      userId,
      type: 'provision',
      status: 'started',
      requestId,
      idempotencyKey: idempotencyKey ?? null,
      createdAt: now,
    })

    return {
      region,
      serverType,
      requestId,
      jobId,
    }
  })
}

export async function provisionUserServer(input: ProvisionInput) {
  assertProvisioningAppUrlReachable()
  const snapshotId = env.HETZNER_SNAPSHOT_ID

  let startState: ProvisioningStartState | { status: 'bootstrapping' }
  try {
    startState = await beginProvisioningSession({
      userId: input.userId,
      region: input.region,
      serverType: input.serverType,
      snapshotId,
      idempotencyKey: input.idempotencyKey ?? null,
    })
  } catch (error) {
    if (
      isUniqueViolationForConstraint({
        error,
        constraints: [
          'provisioning_job_user_active_provision_idx',
          'provisioning_job_user_idempotency_idx',
        ],
      })
    ) {
      throw new Error('This account already has a VPS instance')
    }
    throw error
  }

  if ('status' in startState) {
    return startState
  }

  const { region, serverType, requestId, jobId } = startState

  let createdFirewallId: string | null = null
  let createdServerId: string | null = null

  try {
    await clearUserChannelConnections(input.userId)
    await cleanupStaleResourcesForUser({
      userId: input.userId,
      preserveProvisioningStatus: true,
    })
    await cleanupOrphanProviderResourcesForUser({
      userId: input.userId,
    })
    await Promise.all([
      assertServerTypeAvailable(serverType, region),
      assertSnapshotAvailable({ snapshotId }),
    ])

    const [openRouterApiKey, tailscaleAuth, userRow, dataEncryption] =
      await Promise.all([
        ensureUserOpenRouterApiKey(input.userId),
        createEphemeralAuthKey(),
        db.query.user.findFirst({
          where: eq(user.id, input.userId),
          columns: { preferredModel: true },
        }),
        createDataEncryptionForUser({
          userId: input.userId,
        }),
      ])
    const firewallName = buildResourceName('fw', input.userId)
    const serverName = buildResourceName('srv', input.userId)
    const tailscaleHostname = buildTailscaleHostname({ serverName })
    const bootstrapCheckpointToken = createVpsBootstrapToken({
      requestId,
      userId: input.userId,
    })
    const openclawGatewayToken = getGatewayAuthToken({ userId: input.userId })
    const bootstrapCheckpointUrl = new URL(
      '/api/vps/status',
      env.APP_URL,
    ).toString()
    const encryptionKeyUrl = new URL(
      '/api/vps/encryption-key',
      env.APP_URL,
    ).toString()

    const labels: HetznerLabels = {
      app: 'sato',
      sato_user: sanitizeLabelValue(input.userId),
      sato_request: sanitizeLabelValue(requestId),
    }

    const firewallId = await createFirewall({
      name: firewallName,
      labels,
    })
    createdFirewallId = firewallId

    await db
      .update(vpsInstance)
      .set({
        hetznerFirewallId: firewallId,
      })
      .where(eq(vpsInstance.userId, input.userId))

    const userData = buildSnapshotCloudInit({
      openRouterApiKey,
      tailscaleAuthKey: tailscaleAuth.key,
      tailscaleHostname,
      bootstrapCheckpointUrl,
      bootstrapCheckpointToken,
      openclawGatewayToken,
      encryptionKeyUrl,
      encryptionUserId: input.userId,
      encryptionAuthSecret: dataEncryption.unlockAuthSecret,
      dataVolumeSizeGb: env.VPS_DATA_VOLUME_SIZE_GB,
      preferredModel: normalizeModel(userRow?.preferredModel),
    })

    const server = await createServer(
      {
        name: serverName,
        region,
        serverType,
        userData,
        labels,
        image: snapshotId,
      },
      firewallId,
    )
    createdServerId = server.serverId

    await db
      .update(vpsInstance)
      .set({
        status: 'bootstrapping',
        hetznerServerId: server.serverId,
        hetznerFirewallId: firewallId,
        ipv4Address: server.ipv4Address,
        tailscaleHostname,
        provisionedAt: null,
      })
      .where(eq(vpsInstance.userId, input.userId))

    await db
      .update(provisioningJob)
      .set({
        status: 'bootstrapping',
      })
      .where(eq(provisioningJob.id, jobId))

    await db.insert(auditLog).values({
      id: createId(),
      userId: input.userId,
      action: 'vps.provisioned',
      metadata: JSON.stringify({
        serverId: server.serverId,
        firewallId,
        requestId,
        idempotencyKey: input.idempotencyKey ?? null,
        region,
        serverType,
        snapshotId,
      }),
      createdAt: new Date(),
    })

    return {
      status: 'bootstrapping',
    }
  } catch (error) {
    const message = mapProvisioningErrorMessage(getErrorMessage(error))
    const cleanup = await cleanupProvisioningResources(
      createdServerId,
      createdFirewallId,
    )
    const hasCleanupErrors = cleanup.errors.length > 0

    await db
      .update(vpsInstance)
      .set({
        status: hasCleanupErrors ? 'cleanup_pending' : 'failed',
        hetznerServerId: cleanup.remainingServerId,
        hetznerFirewallId: cleanup.remainingFirewallId,
        ipv4Address: null,
      })
      .where(eq(vpsInstance.userId, input.userId))

    const errorMessage = hasCleanupErrors
      ? PROVISIONING_CLEANUP_PENDING_MESSAGE
      : message

    await db
      .update(provisioningJob)
      .set({
        status: hasCleanupErrors ? 'cleanup_pending' : 'failed',
        errorMessage,
      })
      .where(eq(provisioningJob.id, jobId))

    await db.insert(auditLog).values({
      id: createId(),
      userId: input.userId,
      action: 'vps.provisioning_failed',
      metadata: JSON.stringify({
        requestId,
        idempotencyKey: input.idempotencyKey ?? null,
        message,
        rawError: getErrorMessage(error),
        snapshotId,
        cleanupErrors: cleanup.errors,
        cleanupRemainingServerId: cleanup.remainingServerId,
        cleanupRemainingFirewallId: cleanup.remainingFirewallId,
      }),
      createdAt: new Date(),
    })

    throw new Error(errorMessage)
  }
}

export async function destroyUserServer(userId: string): Promise<void> {
  await deleteUserOpenRouterKey(userId)
  await clearUserChannelConnections(userId)

  const instanceRows = await db
    .select({
      serverId: vpsInstance.hetznerServerId,
      firewallId: vpsInstance.hetznerFirewallId,
      tailscaleHostname: vpsInstance.tailscaleHostname,
      tailscaleIp: vpsInstance.tailscaleIp,
    })
    .from(vpsInstance)
    .where(eq(vpsInstance.userId, userId))
    .limit(1)

  const instance = instanceRows.at(0)

  if (!instance) {
    await db
      .delete(vpsDataEncryption)
      .where(eq(vpsDataEncryption.userId, userId))
    return
  }

  if (instance.tailscaleHostname || instance.tailscaleIp) {
    try {
      await deleteDeviceByHostname({
        hostname: instance.tailscaleHostname,
        tailscaleIp: instance.tailscaleIp,
      })
    } catch {
      // Best-effort — ephemeral devices auto-remove when offline
    }
  }

  const cleanup = await cleanupProvisioningResources(
    instance.serverId,
    instance.firewallId,
  )
  const hasCleanupErrors = cleanup.errors.length > 0

  if (hasCleanupErrors) {
    await db
      .update(vpsInstance)
      .set({
        status: 'cleanup_pending',
        hetznerServerId: cleanup.remainingServerId,
        hetznerFirewallId: cleanup.remainingFirewallId,
        ipv4Address: null,
      })
      .where(eq(vpsInstance.userId, userId))
  } else {
    await db.delete(vpsInstance).where(eq(vpsInstance.userId, userId))
    await db
      .delete(vpsDataEncryption)
      .where(eq(vpsDataEncryption.userId, userId))
  }

  await db.delete(provisioningJob).where(eq(provisioningJob.userId, userId))

  await db.insert(auditLog).values({
    id: createId(),
    userId,
    action: hasCleanupErrors ? 'vps.destroy_partially_failed' : 'vps.destroyed',
    metadata: JSON.stringify({
      serverId: instance.serverId,
      firewallId: instance.firewallId,
      cleanupErrors: cleanup.errors,
    }),
    createdAt: new Date(),
  })

  if (hasCleanupErrors) {
    throw new Error(PROVISIONING_CLEANUP_PENDING_MESSAGE)
  }
}
