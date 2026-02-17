import { eq } from 'drizzle-orm'
import bootstrapTemplateRaw from '../../scripts/templates/vps-bootstrap.sh.tmpl?raw'
import type { HetznerLabels } from '@/lib/hetzner'
import { db } from '@/db'
import { auditLog, provisioningJob, user, vpsInstance } from '@/db/schema'
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
  normalizeHetznerServerType,
  removeFirewallFromServer,
} from '@/lib/hetzner'
import { createId } from '@/lib/ids'
import { normalizeModel } from '@/lib/models'
import { createEphemeralAuthKey, deleteDeviceByHostname } from '@/lib/tailscale'
import { createVpsBootstrapToken } from '@/lib/vps-bootstrap-token'

const CLEANUP_ATTEMPTS = 3
const CLEANUP_BACKOFF_MS = 500
const BOOTSTRAP_TEMPLATE = bootstrapTemplateRaw.replace(/\r\n/g, '\n').trimEnd()

interface ProvisionInput {
  userId: string
  region?: string
  serverType?: string
}

interface CleanupOutcome {
  remainingServerId: string | null
  remainingFirewallId: string | null
  errors: Array<string>
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
  preferredModel,
}: {
  bootstrapCheckpointUrl: string
  bootstrapCheckpointToken: string
  tailscaleAuthKey: string
  tailscaleHostname: string
  preferredModel: string
}): string {
  const replacements = {
    CHECKPOINT_URL: escapeForSingleQuotedBash(bootstrapCheckpointUrl),
    CHECKPOINT_TOKEN: escapeForSingleQuotedBash(bootstrapCheckpointToken),
    TAILSCALE_AUTH_KEY: escapeForSingleQuotedBash(tailscaleAuthKey),
    TAILSCALE_HOSTNAME: escapeForSingleQuotedBash(tailscaleHostname),
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
  preferredModel,
}: {
  openRouterApiKey: string
  tailscaleAuthKey: string
  tailscaleHostname: string
  bootstrapCheckpointUrl: string
  bootstrapCheckpointToken: string
  preferredModel: string
}): string {
  const safeApiKey = escapeForSingleQuotedBash(openRouterApiKey)
  const bootstrapScript = renderBootstrapTemplate({
    bootstrapCheckpointUrl,
    bootstrapCheckpointToken,
    tailscaleAuthKey,
    tailscaleHostname,
    preferredModel,
  })

  return [
    '#cloud-config',
    'package_update: false',
    'write_files:',
    '  - path: /opt/openclaw/.env',
    '    owner: openclaw:openclaw',
    "    permissions: '0600'",
    '    content: |',
    `      OPENROUTER_API_KEY='${safeApiKey}'`,
    '  - path: /opt/openclaw/bootstrap.sh',
    '    owner: root:root',
    "    permissions: '0700'",
    '    content: |',
    indentForCloudConfigBlock(bootstrapScript),
    'runcmd:',
    "  - /bin/bash -lc '/opt/openclaw/bootstrap.sh > /var/log/sato-openclaw-bootstrap.log 2>&1'",
  ].join('\n')
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

function mapProvisioningErrorMessage(message: string): string {
  const lower = message.toLowerCase()

  if (lower.includes('image not found')) {
    return `Configured VPS snapshot image '${env.HETZNER_SNAPSHOT_ID}' was not found in Hetzner. Check that your running app env and Hetzner project token match, then retry setup.`
  }

  return message
}

function sanitizeLabelValue(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 63)

  return sanitized || 'na'
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

async function cleanupStaleResourcesForUser(userId: string): Promise<void> {
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
      status: hasCleanupErrors ? 'cleanup_pending' : 'pending',
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
    throw new Error(
      `Unable to clean up previous failed resources: ${cleanupErrors.join(' | ')}`,
    )
  }
}

export async function provisionUserServer(input: ProvisionInput) {
  const instanceRows = await db
    .select({
      id: vpsInstance.id,
      status: vpsInstance.status,
      region: vpsInstance.region,
      serverType: vpsInstance.serverType,
    })
    .from(vpsInstance)
    .where(eq(vpsInstance.userId, input.userId))
    .limit(1)

  const instanceRow = instanceRows.at(0)

  if (
    instanceRow &&
    (instanceRow.status === 'provisioning' || instanceRow.status === 'active')
  ) {
    throw new Error('This account already has a VPS instance')
  }

  await clearUserChannelConnections(input.userId)

  const region = (input.region ?? instanceRow?.region ?? 'nbg1')
    .trim()
    .toLowerCase()
  const serverType = normalizeHetznerServerType(
    input.serverType ?? instanceRow?.serverType ?? 'cpx22',
  )
  const snapshotId = env.HETZNER_SNAPSHOT_ID

  await Promise.all([
    cleanupStaleResourcesForUser(input.userId),
    assertServerTypeAvailable(serverType, region),
    assertSnapshotAvailable({ snapshotId }),
  ])

  const now = new Date()
  const requestId = createId()
  const jobId = createId()
  const instanceId = instanceRow?.id ?? createId()

  await db.insert(provisioningJob).values({
    id: jobId,
    userId: input.userId,
    type: 'provision',
    status: 'started',
    requestId,
    createdAt: now,
  })

  await db
    .insert(vpsInstance)
    .values({
      id: instanceId,
      userId: input.userId,
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
    .onConflictDoUpdate({
      target: vpsInstance.userId,
      set: {
        status: 'provisioning',
        region,
        serverType,
        hetznerServerId: null,
        hetznerFirewallId: null,
        ipv4Address: null,
        tailscaleIp: null,
        tailscaleHostname: null,
        snapshotVersion: snapshotId,
        openclawVersion: null,
        lastUpdatedAt: null,
        updatedAt: now,
      },
    })

  let createdFirewallId: string | null = null
  let createdServerId: string | null = null

  try {
    const [openRouterApiKey, tailscaleAuth, userRow] = await Promise.all([
      ensureUserOpenRouterApiKey(input.userId),
      createEphemeralAuthKey(),
      db.query.user.findFirst({
        where: eq(user.id, input.userId),
        columns: { preferredModel: true },
      }),
    ])
    const firewallName = buildResourceName('fw', input.userId)
    const serverName = buildResourceName('srv', input.userId)
    const tailscaleHostname = buildTailscaleHostname({ serverName })
    const bootstrapCheckpointToken = createVpsBootstrapToken({
      requestId,
      userId: input.userId,
    })
    const bootstrapCheckpointUrl = new URL(
      '/api/vps/status',
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
        region,
        serverType,
        snapshotId,
      }),
      createdAt: new Date(),
    })

    return {
      status: 'bootstrapping',
      serverId: server.serverId,
      ipv4Address: server.ipv4Address,
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
      ? `${message} | cleanup: ${cleanup.errors.join(' | ')}`
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
        message,
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

  if (!instance) return

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
    throw new Error(
      `Failed to fully remove server resources: ${cleanup.errors.join(' | ')}`,
    )
  }
}
