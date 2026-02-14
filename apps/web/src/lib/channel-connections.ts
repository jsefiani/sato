import { and, eq } from 'drizzle-orm'
import type { TelegramStatusSummary } from '@/lib/vps-openclaw'
import { db } from '@/db'
import { channelConnection } from '@/db/schema'
import { createId } from '@/lib/ids'

export type ChannelSetupState =
  | 'disconnected'
  | 'configuring'
  | 'connected'
  | 'error'

export type ChannelHealthState = 'unknown' | 'checking' | 'online' | 'offline'

export interface UserChannelConnectionSnapshot {
  channel: string
  setupState: ChannelSetupState
  connected: boolean
  connectedAt: string | null
  externalAccountId: string | null
  displayName: string | null
  healthStatus: ChannelHealthState
  lastCheckedAt: string | null
  lastError: string | null
}

export interface UserChannelSetupSummary {
  channels: Array<UserChannelConnectionSnapshot>
  connectedChannels: Array<string>
  connectedCount: number
  hasConnectedChannel: boolean
}

interface UpsertUserChannelConnectionInput {
  userId: string
  channel: string
  setupState: ChannelSetupState
  connectedAt?: Date | null
  externalAccountId?: string | null
  displayName?: string | null
  healthStatus?: ChannelHealthState
  lastCheckedAt?: Date | null
  lastError?: string | null
}

interface SyncTelegramChannelConnectionOptions {
  approvedNow?: boolean
  vpsProvisionedAt?: Date | null
  resetConnectionApproval?: boolean
}

function normalizeChannel(channel: string): string {
  return channel.trim().toLowerCase()
}

function parseIsoDate(value: string): Date | null {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return null
  }

  return new Date(timestamp)
}

function toSnapshot(row: {
  channel: string
  setupState: string
  connectedAt: Date | null
  externalAccountId: string | null
  displayName: string | null
  healthStatus: string
  lastCheckedAt: Date | null
  lastError: string | null
}): UserChannelConnectionSnapshot {
  const setupState =
    row.setupState === 'configuring' ||
    row.setupState === 'connected' ||
    row.setupState === 'error'
      ? row.setupState
      : 'disconnected'

  const healthStatus =
    row.healthStatus === 'checking' ||
    row.healthStatus === 'online' ||
    row.healthStatus === 'offline'
      ? row.healthStatus
      : 'unknown'

  return {
    channel: normalizeChannel(row.channel),
    setupState,
    connected: setupState === 'connected',
    connectedAt: row.connectedAt ? row.connectedAt.toISOString() : null,
    externalAccountId: row.externalAccountId,
    displayName: row.displayName,
    healthStatus,
    lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
    lastError: row.lastError,
  }
}

export async function getUserChannelSetupSummary(
  userId: string,
): Promise<UserChannelSetupSummary> {
  const rows = await db.query.channelConnection.findMany({
    where: eq(channelConnection.userId, userId),
    columns: {
      channel: true,
      setupState: true,
      connectedAt: true,
      externalAccountId: true,
      displayName: true,
      healthStatus: true,
      lastCheckedAt: true,
      lastError: true,
    },
    orderBy: (connection, { asc }) => asc(connection.channel),
  })

  const channels = rows.map(toSnapshot)
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

export async function upsertUserChannelConnection(
  input: UpsertUserChannelConnectionInput,
): Promise<void> {
  const now = new Date()
  const channel = normalizeChannel(input.channel)

  await db
    .insert(channelConnection)
    .values({
      id: createId(),
      userId: input.userId,
      channel,
      setupState: input.setupState,
      connectedAt: input.connectedAt ?? null,
      externalAccountId: input.externalAccountId ?? null,
      displayName: input.displayName ?? null,
      healthStatus: input.healthStatus ?? 'unknown',
      lastCheckedAt: input.lastCheckedAt ?? null,
      lastError: input.lastError ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [channelConnection.userId, channelConnection.channel],
      set: {
        setupState: input.setupState,
        connectedAt: input.connectedAt ?? null,
        externalAccountId: input.externalAccountId ?? null,
        displayName: input.displayName ?? null,
        healthStatus: input.healthStatus ?? 'unknown',
        lastCheckedAt: input.lastCheckedAt ?? null,
        lastError: input.lastError ?? null,
        updatedAt: now,
      },
    })
}

export async function syncTelegramChannelConnection(
  userId: string,
  summary: TelegramStatusSummary,
  options?: SyncTelegramChannelConnectionOptions,
): Promise<ChannelSetupState> {
  const channel = 'telegram'
  const existing = await db.query.channelConnection.findFirst({
    where: and(
      eq(channelConnection.userId, userId),
      eq(channelConnection.channel, channel),
    ),
    columns: {
      setupState: true,
      connectedAt: true,
      externalAccountId: true,
      displayName: true,
      healthStatus: true,
      lastCheckedAt: true,
      lastError: true,
    },
  })

  const checkedAt = parseIsoDate(summary.checkedAt) ?? new Date()
  const existingConnected = existing?.setupState === 'connected'
  const existingConnectedAtDate = existing?.connectedAt ?? null
  const provisionedAt = options?.vpsProvisionedAt ?? null
  const staleConnectedState =
    existingConnected &&
    provisionedAt !== null &&
    (existingConnectedAtDate === null ||
      existingConnectedAtDate <= provisionedAt)
  const canReuseConnectedState =
    existingConnected &&
    provisionedAt !== null &&
    !staleConnectedState &&
    options?.resetConnectionApproval !== true
  const setupState: ChannelSetupState =
    options?.approvedNow === true
      ? 'connected'
      : canReuseConnectedState
        ? 'connected'
        : summary.configured
          ? 'configuring'
          : 'disconnected'

  const connectedAt =
    setupState === 'connected'
      ? options?.approvedNow
        ? checkedAt
        : (existing?.connectedAt ?? checkedAt)
      : null
  const healthStatus: ChannelHealthState =
    setupState === 'connected'
      ? 'online'
      : summary.configured
        ? 'checking'
        : 'unknown'
  const externalAccountId =
    summary.accountId ?? existing?.externalAccountId ?? null
  const displayName = summary.botUsername ?? existing?.displayName ?? null
  const lastError = summary.lastError

  if (existing) {
    const existingConnectedAt = existing.connectedAt?.getTime() ?? null
    const nextConnectedAt = connectedAt?.getTime() ?? null
    const existingHealthStatus: ChannelHealthState =
      existing.healthStatus === 'checking' ||
      existing.healthStatus === 'online' ||
      existing.healthStatus === 'offline'
        ? existing.healthStatus
        : 'unknown'
    const checkedRecently =
      existing.lastCheckedAt &&
      checkedAt.getTime() - existing.lastCheckedAt.getTime() < 30_000

    if (
      existing.setupState === setupState &&
      existingConnectedAt === nextConnectedAt &&
      (existing.externalAccountId ?? null) === externalAccountId &&
      (existing.displayName ?? null) === displayName &&
      existingHealthStatus === healthStatus &&
      (existing.lastError ?? null) === lastError &&
      checkedRecently
    ) {
      return setupState
    }
  }

  await upsertUserChannelConnection({
    userId,
    channel,
    setupState,
    connectedAt,
    externalAccountId,
    displayName,
    healthStatus,
    lastCheckedAt: checkedAt,
    lastError,
  })

  return setupState
}

export async function clearUserChannelConnections(
  userId: string,
): Promise<void> {
  await db.delete(channelConnection).where(eq(channelConnection.userId, userId))
}

export function normalizeChannelSetupForCurrentInstance(
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
