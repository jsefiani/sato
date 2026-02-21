import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { auditLog, provisioningJob } from '@/db/schema'
import { env } from '@/lib/env'
import {
  deleteFirewall,
  deleteServer,
  listFirewallsByLabels,
  listServersByLabels,
} from '@/lib/hetzner'
import { createId } from '@/lib/ids'

const ACTIVE_PROVISIONING_JOB_STATUSES = [
  'started',
  'bootstrapping',
  'cleanup_pending',
]
const CLEANUP_ATTEMPTS = 3
const CLEANUP_BACKOFF_MS = 500
const SWEEPER_STARTUP_DELAY_MS = 30_000

let sweeperStarted = false
let sweepInProgress = false

interface SweepResult {
  scannedServers: number
  scannedFirewalls: number
  deletedServers: number
  deletedFirewalls: number
  failedDeletes: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

function isNotFoundError(message: string): boolean {
  return (
    message.includes('Hetzner API error (404)') ||
    message.includes('"code":"not_found"') ||
    message.includes('"code": "not_found"')
  )
}

function isManagedUserResource(labels: Record<string, string>): boolean {
  return labels.app === 'sato' && typeof labels.sato_user === 'string'
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

export async function sweepOrphanHetznerResources({
  trigger,
}: {
  trigger: 'startup' | 'interval'
}): Promise<SweepResult> {
  const [instanceRows, activeProvisionRows, servers, firewalls] =
    await Promise.all([
      db.query.vpsInstance.findMany({
        columns: {
          hetznerServerId: true,
          hetznerFirewallId: true,
        },
      }),
      db.query.provisioningJob.findMany({
        where: and(
          eq(provisioningJob.type, 'provision'),
          inArray(provisioningJob.status, ACTIVE_PROVISIONING_JOB_STATUSES),
        ),
        columns: {
          requestId: true,
        },
      }),
      listServersByLabels({
        labels: { app: 'sato' },
      }),
      listFirewallsByLabels({
        labels: { app: 'sato' },
      }),
    ])

  const knownServerIds = new Set(
    instanceRows
      .map((row) => row.hetznerServerId)
      .filter((id): id is string => Boolean(id)),
  )
  const knownFirewallIds = new Set(
    instanceRows
      .map((row) => row.hetznerFirewallId)
      .filter((id): id is string => Boolean(id)),
  )
  const activeRequestIds = new Set(
    activeProvisionRows
      .map((row) => row.requestId)
      .filter((requestId): requestId is string => requestId.trim().length > 0),
  )

  const orphanServers = servers.filter((server) => {
    if (!isManagedUserResource(server.labels)) {
      return false
    }

    if (knownServerIds.has(server.id)) {
      return false
    }

    const resourceRequestId = server.labels.sato_request
    if (resourceRequestId && activeRequestIds.has(resourceRequestId)) {
      return false
    }

    return true
  })

  const orphanFirewalls = firewalls.filter((firewall) => {
    if (!isManagedUserResource(firewall.labels)) {
      return false
    }

    if (knownFirewallIds.has(firewall.id)) {
      return false
    }

    const resourceRequestId = firewall.labels.sato_request
    if (resourceRequestId && activeRequestIds.has(resourceRequestId)) {
      return false
    }

    return true
  })

  const cleanupErrors: Array<string> = []
  const deletedServerIds: Array<string> = []
  const deletedFirewallIds: Array<string> = []

  for (const server of orphanServers) {
    const cleanupError = await runCleanupWithRetries(async () => {
      await deleteServer(server.id)
    })

    if (cleanupError) {
      cleanupErrors.push(`server:${server.id}: ${cleanupError}`)
      continue
    }

    deletedServerIds.push(server.id)
  }

  for (const firewall of orphanFirewalls) {
    const cleanupError = await runCleanupWithRetries(async () => {
      await deleteFirewall(firewall.id)
    })

    if (cleanupError) {
      cleanupErrors.push(`firewall:${firewall.id}: ${cleanupError}`)
      continue
    }

    deletedFirewallIds.push(firewall.id)
  }

  await db.insert(auditLog).values({
    id: createId(),
    userId: null,
    action:
      cleanupErrors.length > 0
        ? 'vps.orphan_sweep_partially_failed'
        : 'vps.orphan_sweep_succeeded',
    metadata: JSON.stringify({
      trigger,
      scannedServers: servers.length,
      scannedFirewalls: firewalls.length,
      deletedServerIds,
      deletedFirewallIds,
      cleanupErrors,
    }),
    createdAt: new Date(),
  })

  if (cleanupErrors.length > 0) {
    console.error(
      '[vps-orphan-sweeper] Some orphan cleanup operations failed:',
      cleanupErrors.join(' | '),
    )
  }

  return {
    scannedServers: servers.length,
    scannedFirewalls: firewalls.length,
    deletedServers: deletedServerIds.length,
    deletedFirewalls: deletedFirewallIds.length,
    failedDeletes: cleanupErrors.length,
  }
}

export function startVpsOrphanSweeper(): void {
  if (sweeperStarted) {
    return
  }
  sweeperStarted = true

  if (env.VPS_ORPHAN_SWEEP_ENABLED !== 'true') {
    return
  }

  const intervalMs = env.VPS_ORPHAN_SWEEP_INTERVAL_MINUTES * 60_000

  const runSweep = async ({
    trigger,
  }: {
    trigger: 'startup' | 'interval'
  }): Promise<void> => {
    if (sweepInProgress) {
      return
    }
    sweepInProgress = true

    try {
      await sweepOrphanHetznerResources({ trigger })
    } catch (error) {
      console.error(
        '[vps-orphan-sweeper] Sweep failed:',
        getErrorMessage(error),
      )
    } finally {
      sweepInProgress = false
    }
  }

  setTimeout(() => {
    void runSweep({ trigger: 'startup' })
  }, SWEEPER_STARTUP_DELAY_MS).unref()

  setInterval(() => {
    void runSweep({ trigger: 'interval' })
  }, intervalMs).unref()
}
