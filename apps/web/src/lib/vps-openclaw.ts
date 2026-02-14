import { escapeShellArg, runVpsSshCommand } from '@/lib/vps-ssh'

interface GatewayStatusPayload {
  service?: {
    loaded?: boolean
    runtime?: {
      status?: string
    }
  }
  gateway?: {
    probeUrl?: string
  }
  rpc?: {
    ok?: boolean
    error?: string
    url?: string
  }
}

interface HealthPayload {
  ok?: boolean
  durationMs?: number
  channels?: Record<string, unknown>
}

interface PairingListPayload {
  requests?: Array<{
    code?: string
    id?: string
    createdAt?: string
    meta?: unknown
  }>
}

interface ChannelsStatusPayload {
  channelAccounts?: Record<string, unknown>
}

interface ChannelsCapabilitiesPayload {
  channels?: Array<{
    channel?: string
    accountId?: string
    configured?: boolean
    enabled?: boolean
    connected?: boolean
    running?: boolean
    dmPolicy?: string | null
    probe?: {
      ok?: boolean
      error?: string | null
      bot?: {
        username?: string
      }
    }
  }>
}

type TelegramCapabilitiesChannel = NonNullable<
  ChannelsCapabilitiesPayload['channels']
>[number]

export interface OpenClawVerifyResult {
  checkedAt: string
  ok: boolean
  gateway: {
    loaded: boolean
    runtimeStatus: string | null
    probeUrl: string | null
    rpcOk: boolean
    rpcError: string | null
  }
  health: {
    ok: boolean
    durationMs: number | null
    channelsOk: number
    channelsFailed: number
  }
}

export interface TelegramPairingRequest {
  code: string
  id: string
  createdAt: string | null
  meta?: unknown
}

export interface TelegramStatusSummary {
  checkedAt: string
  configured: boolean
  enabled: boolean
  running: boolean
  connected: boolean
  probeOk: boolean
  accountId: string | null
  botUsername: string | null
  dmPolicy: string | null
  lastError: string | null
  pairingRequests: Array<TelegramPairingRequest>
}

const OPENCLAW_REPAIR_TIMEOUT_MS = 180_000
const TELEGRAM_DIAGNOSTIC_SNIPPET_MAX_CHARS = 240
const PAIRING_REQUEST_MAX_AGE_MS = 15 * 60 * 1000

interface TelegramRuntimeDiagnostics {
  binaryPath: string | null
  version: string | null
  channelsHasTelegram: boolean
  pairingUnknownChannel: boolean
  telegramPluginEnabled: boolean | null
  telegramPluginLoaded: boolean | null
  channelsSnippet: string | null
  pairingSnippet: string | null
  pluginsSnippet: string | null
}

interface TelegramRepairAttempt {
  before: TelegramRuntimeDiagnostics
  after: TelegramRuntimeDiagnostics
  pluginEnableError: string | null
  updateError: string | null
  reinstallError: string | null
}

interface PluginListPayload {
  plugins?: Array<{
    id?: string
    enabled?: boolean
    status?: string
  }>
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function isUnsupportedTelegramChannelError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('unknown channel: telegram') ||
    normalized.includes('unknown channel "telegram"') ||
    normalized.includes("unknown channel 'telegram'") ||
    /unknown channel[^\n]*telegram/.test(normalized)
  )
}

function buildRootShellCommand(command: string): string {
  const escaped = command.replace(/'/g, `'"'"'`)
  return `/bin/bash -lc 'export HOME=/root; export PATH=/usr/local/bin:/usr/bin:/bin; ${escaped}'`
}

async function runRootShellCommand(
  host: string,
  command: string,
  opts?: {
    timeoutMs?: number
    redact?: Array<string>
  },
): Promise<string> {
  return await runVpsSshCommand(host, buildRootShellCommand(command), opts)
}

function buildOpenclawUserCommand(command: string): string {
  const escaped = command.replace(/'/g, `'"'"'`)
  return `sudo -u openclaw env HOME=/opt/openclaw PATH=/usr/local/bin:/usr/bin:/bin /bin/bash -c '${escaped}'`
}

async function runOpenClawUserCommand(
  host: string,
  command: string,
  opts?: {
    timeoutMs?: number
    redact?: Array<string>
  },
): Promise<string> {
  return await runVpsSshCommand(host, buildOpenclawUserCommand(command), opts)
}

async function runOpenclawCommand(
  host: string,
  command: string,
  opts?: {
    timeoutMs?: number
    redact?: Array<string>
  },
): Promise<string> {
  return await runOpenClawUserCommand(host, `openclaw ${command}`, opts)
}

function firstNonEmptyLine(value: string | null): string | null {
  if (!value) {
    return null
  }

  const line =
    value
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find(Boolean) ?? null

  return line || null
}

function truncateDiagnosticSnippet(value: string): string | null {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return null
  }

  if (normalized.length <= TELEGRAM_DIAGNOSTIC_SNIPPET_MAX_CHARS) {
    return normalized
  }

  return `${normalized.slice(0, TELEGRAM_DIAGNOSTIC_SNIPPET_MAX_CHARS)}...`
}

function formatTelegramRuntimeDiagnostics(
  diagnostics: TelegramRuntimeDiagnostics,
): string {
  const fragments = [
    `version=${diagnostics.version ?? 'unknown'}`,
    `binary=${diagnostics.binaryPath ?? 'missing'}`,
    `channelsHasTelegram=${diagnostics.channelsHasTelegram ? 'yes' : 'no'}`,
    `pairingUnknownChannel=${diagnostics.pairingUnknownChannel ? 'yes' : 'no'}`,
    `telegramPluginEnabled=${diagnostics.telegramPluginEnabled === null ? 'unknown' : diagnostics.telegramPluginEnabled ? 'yes' : 'no'}`,
    `telegramPluginLoaded=${diagnostics.telegramPluginLoaded === null ? 'unknown' : diagnostics.telegramPluginLoaded ? 'yes' : 'no'}`,
  ]

  if (diagnostics.channelsSnippet) {
    fragments.push(`channelsSnippet="${diagnostics.channelsSnippet}"`)
  }

  if (diagnostics.pairingSnippet) {
    fragments.push(`pairingSnippet="${diagnostics.pairingSnippet}"`)
  }

  if (diagnostics.pluginsSnippet) {
    fragments.push(`pluginsSnippet="${diagnostics.pluginsSnippet}"`)
  }

  return fragments.join(', ')
}

function extractTelegramPluginDiagnostics(pluginsRaw: string): {
  enabled: boolean | null
  loaded: boolean | null
} {
  const pluginsPayload = tryParseJson<PluginListPayload>(pluginsRaw)
  if (!Array.isArray(pluginsPayload?.plugins)) {
    return {
      enabled: null,
      loaded: null,
    }
  }

  const telegramPlugin = pluginsPayload.plugins.find(
    (plugin) =>
      typeof plugin.id === 'string' &&
      plugin.id.trim().toLowerCase() === 'telegram',
  )

  if (!telegramPlugin) {
    return {
      enabled: null,
      loaded: null,
    }
  }

  const enabled =
    typeof telegramPlugin.enabled === 'boolean' ? telegramPlugin.enabled : null
  const status =
    typeof telegramPlugin.status === 'string'
      ? telegramPlugin.status.trim().toLowerCase()
      : ''

  return {
    enabled,
    loaded: status ? status === 'loaded' : null,
  }
}

async function tryEnableTelegramPlugin(host: string): Promise<string | null> {
  try {
    await runOpenclawCommand(host, 'plugins enable telegram', {
      timeoutMs: 25_000,
    })
    return null
  } catch (error) {
    return errorMessage(error)
  }
}

async function collectTelegramRuntimeDiagnostics(
  host: string,
): Promise<TelegramRuntimeDiagnostics> {
  const [
    pathResult,
    versionResult,
    channelsResult,
    pairingResult,
    pluginsResult,
  ] = await Promise.allSettled([
    runRootShellCommand(host, 'command -v openclaw || true', {
      timeoutMs: 15_000,
    }),
    runOpenclawCommand(host, '--version 2>/dev/null || true', {
      timeoutMs: 15_000,
    }),
    runOpenclawCommand(host, 'channels list 2>&1 || true', {
      timeoutMs: 20_000,
    }),
    runOpenclawCommand(host, 'pairing list telegram --json 2>&1 || true', {
      timeoutMs: 20_000,
    }),
    runOpenclawCommand(host, 'plugins list --json 2>&1 || true', {
      timeoutMs: 20_000,
    }),
  ])

  const channelsRaw =
    channelsResult.status === 'fulfilled'
      ? channelsResult.value
      : errorMessage(channelsResult.reason)
  const pairingRaw =
    pairingResult.status === 'fulfilled'
      ? pairingResult.value
      : errorMessage(pairingResult.reason)
  const pluginsRaw =
    pluginsResult.status === 'fulfilled'
      ? pluginsResult.value
      : errorMessage(pluginsResult.reason)
  const pluginDiagnostics = extractTelegramPluginDiagnostics(pluginsRaw)

  return {
    binaryPath:
      pathResult.status === 'fulfilled'
        ? firstNonEmptyLine(pathResult.value)
        : null,
    version:
      versionResult.status === 'fulfilled'
        ? firstNonEmptyLine(versionResult.value)
        : null,
    channelsHasTelegram: /(^|\W)telegram(\W|$)/i.test(channelsRaw),
    pairingUnknownChannel: isUnsupportedTelegramChannelError(pairingRaw),
    telegramPluginEnabled: pluginDiagnostics.enabled,
    telegramPluginLoaded: pluginDiagnostics.loaded,
    channelsSnippet: truncateDiagnosticSnippet(channelsRaw),
    pairingSnippet: truncateDiagnosticSnippet(pairingRaw),
    pluginsSnippet: truncateDiagnosticSnippet(pluginsRaw),
  }
}

async function attemptTelegramRuntimeRepair(
  host: string,
): Promise<TelegramRepairAttempt> {
  const before = await collectTelegramRuntimeDiagnostics(host)

  let pluginEnableError = await tryEnableTelegramPlugin(host)
  let updateError: string | null = null
  let reinstallError: string | null = null

  try {
    await runRootShellCommand(host, 'openclaw update --channel stable', {
      timeoutMs: OPENCLAW_REPAIR_TIMEOUT_MS,
    })
  } catch (error) {
    updateError = errorMessage(error)
  }

  const afterUpdate = await collectTelegramRuntimeDiagnostics(host)
  const stillUnsupported =
    afterUpdate.pairingUnknownChannel ||
    afterUpdate.telegramPluginLoaded === false

  if (stillUnsupported) {
    try {
      await runRootShellCommand(
        host,
        'curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-prompt --no-onboard --no-gum --version latest',
        { timeoutMs: OPENCLAW_REPAIR_TIMEOUT_MS },
      )
    } catch (error) {
      reinstallError = errorMessage(error)
    }

    const enableAfterReinstallError = await tryEnableTelegramPlugin(host)
    if (enableAfterReinstallError) {
      pluginEnableError = pluginEnableError ?? enableAfterReinstallError
    }
  }

  await runOpenclawCommand(host, 'doctor --non-interactive || true', {
    timeoutMs: 45_000,
  }).catch(() => {})

  await runRootShellCommand(
    host,
    'if command -v systemctl >/dev/null 2>&1; then systemctl restart openclaw-gateway || true; fi',
    { timeoutMs: 30_000 },
  ).catch(() => {})

  const after = await collectTelegramRuntimeDiagnostics(host)

  return {
    before,
    after,
    pluginEnableError,
    updateError,
    reinstallError,
  }
}

function buildTelegramRepairFailureError(
  error: unknown,
  repair: TelegramRepairAttempt,
): Error {
  const reason = errorMessage(error)
  const steps = [
    `before: ${formatTelegramRuntimeDiagnostics(repair.before)}`,
    `after: ${formatTelegramRuntimeDiagnostics(repair.after)}`,
  ]

  if (repair.pluginEnableError) {
    steps.push(
      `pluginEnableError="${truncateDiagnosticSnippet(repair.pluginEnableError) ?? 'unknown'}"`,
    )
  }

  if (repair.updateError) {
    steps.push(
      `updateError="${truncateDiagnosticSnippet(repair.updateError) ?? 'unknown'}"`,
    )
  }

  if (repair.reinstallError) {
    steps.push(
      `reinstallError="${truncateDiagnosticSnippet(repair.reinstallError) ?? 'unknown'}"`,
    )
  }

  return new Error(
    `Telegram setup failed after automatic OpenClaw runtime repair. ${reason}. ${steps.join(' | ')}`,
  )
}

async function runTelegramCommandWithAutoRepair(
  host: string,
  command: string,
  opts?: {
    timeoutMs?: number
    redact?: Array<string>
  },
): Promise<void> {
  try {
    await runOpenclawCommand(host, command, opts)
    return
  } catch (error) {
    const initialMessage = errorMessage(error)
    if (!isUnsupportedTelegramChannelError(initialMessage)) {
      throw error
    }
  }

  await tryEnableTelegramPlugin(host)

  try {
    await runOpenclawCommand(host, command, opts)
    return
  } catch (error) {
    const message = errorMessage(error)
    if (!isUnsupportedTelegramChannelError(message)) {
      throw error
    }
  }

  const repair = await attemptTelegramRuntimeRepair(host)

  try {
    await runOpenclawCommand(host, command, opts)
  } catch (error) {
    throw buildTelegramRepairFailureError(error, repair)
  }
}

function tryParseJson<T>(raw: string): T | null {
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }

  try {
    return JSON.parse(trimmed) as T
  } catch {
    const firstObject = trimmed.indexOf('{')
    const lastObject = trimmed.lastIndexOf('}')
    if (firstObject !== -1 && lastObject > firstObject) {
      try {
        return JSON.parse(trimmed.slice(firstObject, lastObject + 1)) as T
      } catch {
        return null
      }
    }
    return null
  }
}

function extractProbeOkCount(channels: Record<string, unknown> | undefined): {
  ok: number
  failed: number
} {
  if (!channels) {
    return { ok: 0, failed: 0 }
  }

  let ok = 0
  let failed = 0

  const countProbe = (candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object') {
      return
    }

    const probe =
      'probe' in candidate &&
      candidate.probe &&
      typeof candidate.probe === 'object'
        ? (candidate.probe as { ok?: unknown })
        : null

    if (typeof probe?.ok === 'boolean') {
      if (probe.ok) {
        ok += 1
      } else {
        failed += 1
      }
    }
  }

  for (const summary of Object.values(channels)) {
    if (!summary || typeof summary !== 'object') {
      continue
    }

    const accounts =
      'accounts' in summary &&
      summary.accounts &&
      typeof summary.accounts === 'object'
        ? (summary.accounts as Record<string, unknown>)
        : null

    if (accounts) {
      for (const accountSummary of Object.values(accounts)) {
        countProbe(accountSummary)
      }
      continue
    }

    countProbe(summary)
  }

  return { ok, failed }
}

function normalizeBotUsername(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const username = value.trim()
  if (!username) {
    return null
  }

  return username.startsWith('@') ? username : `@${username}`
}

function indicatesUnpairedAccessSignal(value: string | null): boolean {
  if (!value) {
    return false
  }

  const normalized = value.toLowerCase()
  return (
    normalized.includes('access not configured') ||
    normalized.includes('pairing required') ||
    normalized.includes('approve telegram') ||
    normalized.includes('not approved')
  )
}

function normalizeFlag(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return value === 1
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return (
      normalized === 'true' ||
      normalized === '1' ||
      normalized === 'yes' ||
      normalized === 'enabled'
    )
  }

  return false
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized ? normalized : null
}

function firstNonNull<T>(values: Array<T | null | undefined>): T | null {
  for (const value of values) {
    if (value !== null && typeof value !== 'undefined') {
      return value
    }
  }

  return null
}

function normalizeAccountId(value: unknown): string | null {
  return nonEmptyString(value)
}

function isDefaultAccountId(accountId: string | null): boolean {
  return !!accountId && accountId.toLowerCase() === 'default'
}

function getTelegramAccounts(
  payload: ChannelsStatusPayload,
): Array<Record<string, unknown>> {
  const collectAccounts = (value: unknown): Array<Record<string, unknown>> => {
    if (Array.isArray(value)) {
      return value.filter(
        (entry): entry is Record<string, unknown> =>
          !!entry && typeof entry === 'object',
      )
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      const accounts: Array<Record<string, unknown>> = []

      for (const [accountId, accountValue] of Object.entries(record)) {
        if (!accountValue || typeof accountValue !== 'object') {
          continue
        }

        const account = accountValue as Record<string, unknown>
        if ('accountId' in account) {
          accounts.push(account)
          continue
        }

        accounts.push({
          ...account,
          accountId,
        })
      }

      return accounts
    }

    return []
  }

  const fromChannelsArray =
    'channels' in payload &&
    Array.isArray((payload as { channels?: unknown }).channels)
      ? ((payload as { channels?: Array<unknown> }).channels ?? [])
      : []

  const channelsAccounts = fromChannelsArray.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return []
    }

    const channelEntry = entry as Record<string, unknown>
    if (nonEmptyString(channelEntry.channel)?.toLowerCase() !== 'telegram') {
      return []
    }

    const accounts = collectAccounts(channelEntry.accounts)
    if (accounts.length > 0) {
      return accounts
    }

    if (
      'accountId' in channelEntry ||
      'configured' in channelEntry ||
      'connected' in channelEntry ||
      'running' in channelEntry
    ) {
      return [channelEntry]
    }

    return []
  })
  if (channelsAccounts.length > 0) {
    return channelsAccounts
  }

  const byChannel = payload.channelAccounts
  if (byChannel && typeof byChannel === 'object') {
    const byChannelAccounts = collectAccounts(byChannel.telegram)
    if (byChannelAccounts.length > 0) {
      return byChannelAccounts
    }
  }

  if ('telegram' in payload) {
    return collectAccounts((payload as { telegram?: unknown }).telegram)
  }

  return []
}

function getTelegramCapabilitiesAccounts(
  payload: ChannelsCapabilitiesPayload,
): Array<TelegramCapabilitiesChannel> {
  if (!Array.isArray(payload.channels) || payload.channels.length === 0) {
    return []
  }

  return payload.channels.filter(
    (entry): entry is TelegramCapabilitiesChannel =>
      typeof entry.channel === 'string' &&
      entry.channel.trim().toLowerCase() === 'telegram',
  )
}

function getStatusProbeInfo(account: Record<string, unknown>): {
  ok: boolean
  error: string | null
  botUsername: string | null
} {
  const probe =
    'probe' in account && account.probe && typeof account.probe === 'object'
      ? (account.probe as { ok?: unknown; error?: unknown; bot?: unknown })
      : null

  const probeBot =
    probe?.bot && typeof probe.bot === 'object'
      ? (probe.bot as { username?: unknown })
      : null
  const rootBot =
    'bot' in account && account.bot && typeof account.bot === 'object'
      ? (account.bot as { username?: unknown })
      : null

  return {
    ok: normalizeFlag(probe?.ok),
    error: nonEmptyString(probe?.error),
    botUsername: normalizeBotUsername(rootBot?.username ?? probeBot?.username),
  }
}

function getCapabilitiesProbeInfo(account: TelegramCapabilitiesChannel): {
  ok: boolean
  error: string | null
  botUsername: string | null
} {
  const probe =
    account.probe && typeof account.probe === 'object' ? account.probe : null
  const probeBot =
    probe?.bot && typeof probe.bot === 'object' ? probe.bot : null

  return {
    ok: normalizeFlag(probe?.ok),
    error: nonEmptyString(probe?.error),
    botUsername: normalizeBotUsername(probeBot?.username),
  }
}

function scoreStatusAccount(account: Record<string, unknown>): number {
  const probe = getStatusProbeInfo(account)
  const accountId = normalizeAccountId(account.accountId)

  let score = 0
  if (normalizeFlag(account.connected)) score += 100
  if (normalizeFlag(account.running)) score += 40
  if (normalizeFlag(account.configured)) score += 20
  if (account.enabled !== false) score += 8
  if (probe.ok) score += 4
  if (isDefaultAccountId(accountId)) score += 1

  return score
}

function scoreCapabilitiesAccount(
  account: TelegramCapabilitiesChannel,
): number {
  const probe = getCapabilitiesProbeInfo(account)
  const accountId = normalizeAccountId(account.accountId)

  let score = 0
  if (account.connected === true) score += 100
  if (account.running === true) score += 40
  if (account.configured === true) score += 20
  if (account.enabled !== false) score += 8
  if (probe.ok) score += 4
  if (isDefaultAccountId(accountId)) score += 1

  return score
}

function pickPreferredStatusAccount(
  accounts: Array<Record<string, unknown>>,
): Record<string, unknown> | null {
  if (accounts.length === 0) {
    return null
  }

  let best = accounts[0]
  let bestScore = scoreStatusAccount(best)

  for (const account of accounts.slice(1)) {
    const score = scoreStatusAccount(account)
    if (score > bestScore) {
      best = account
      bestScore = score
      continue
    }

    if (score === bestScore) {
      const bestId = normalizeAccountId(best.accountId) ?? 'zzzz'
      const candidateId = normalizeAccountId(account.accountId) ?? 'zzzz'
      if (candidateId < bestId) {
        best = account
      }
    }
  }

  return best
}

function pickPreferredCapabilitiesAccount(
  accounts: Array<TelegramCapabilitiesChannel>,
): TelegramCapabilitiesChannel | null {
  if (accounts.length === 0) {
    return null
  }

  let best = accounts[0]
  let bestScore = scoreCapabilitiesAccount(best)

  for (const account of accounts.slice(1)) {
    const score = scoreCapabilitiesAccount(account)
    if (score > bestScore) {
      best = account
      bestScore = score
      continue
    }

    if (score === bestScore) {
      const bestId = normalizeAccountId(best.accountId) ?? 'zzzz'
      const candidateId = normalizeAccountId(account.accountId) ?? 'zzzz'
      if (candidateId < bestId) {
        best = account
      }
    }
  }

  return best
}

function parsePairingRequests(raw: string): Array<TelegramPairingRequest> {
  const parsed = tryParseJson<PairingListPayload>(raw)
  if (!parsed?.requests || !Array.isArray(parsed.requests)) {
    return []
  }

  const requests: Array<TelegramPairingRequest> = []
  for (const request of parsed.requests) {
    const code = typeof request.code === 'string' ? request.code.trim() : ''
    const id = typeof request.id === 'string' ? request.id.trim() : ''
    if (!code || !id) {
      continue
    }

    requests.push({
      code,
      id,
      createdAt:
        typeof request.createdAt === 'string' && request.createdAt.trim()
          ? request.createdAt
          : null,
      ...(typeof request.meta !== 'undefined' ? { meta: request.meta } : {}),
    })
  }

  return requests
}

function hasPendingPairingRequests(
  pairingRequests: Array<TelegramPairingRequest>,
): boolean {
  const now = Date.now()

  return pairingRequests.some((request) => {
    if (!request.createdAt) {
      return true
    }

    const createdAtMs = Date.parse(request.createdAt)
    if (Number.isNaN(createdAtMs)) {
      return true
    }

    if (createdAtMs > now) {
      return true
    }

    return now - createdAtMs <= PAIRING_REQUEST_MAX_AGE_MS
  })
}

function summarizeTelegramStatusFromCapabilitiesPayload(
  capabilitiesPayload: ChannelsCapabilitiesPayload,
  pairingRequests: Array<TelegramPairingRequest>,
): TelegramStatusSummary {
  const accounts = getTelegramCapabilitiesAccounts(capabilitiesPayload)
  if (accounts.length === 0) {
    return {
      checkedAt: new Date().toISOString(),
      configured: false,
      enabled: false,
      running: false,
      connected: false,
      probeOk: false,
      accountId: null,
      botUsername: null,
      dmPolicy: null,
      lastError: null,
      pairingRequests,
    }
  }

  const primaryAccount = pickPreferredCapabilitiesAccount(accounts)
  if (!primaryAccount) {
    return {
      checkedAt: new Date().toISOString(),
      configured: false,
      enabled: false,
      running: false,
      connected: false,
      probeOk: false,
      accountId: null,
      botUsername: null,
      dmPolicy: null,
      lastError: null,
      pairingRequests,
    }
  }

  const probes = accounts.map((account) => getCapabilitiesProbeInfo(account))
  const primaryProbe = getCapabilitiesProbeInfo(primaryAccount)

  const configured = accounts.some((account) => account.configured === true)
  const enabled = accounts.some((account) => account.enabled !== false)
  const explicitConnected = accounts.some(
    (account) => account.connected === true,
  )
  const hasPendingPairing = hasPendingPairingRequests(pairingRequests)
  const probeOk = probes.some((probe) => probe.ok)
  const hasUnpairedSignal = probes.some((probe) =>
    indicatesUnpairedAccessSignal(probe.error),
  )
  const connected =
    explicitConnected && !hasPendingPairing && !hasUnpairedSignal
  const running =
    accounts.some((account) => account.running === true) || probeOk

  return {
    checkedAt: new Date().toISOString(),
    configured,
    enabled,
    running,
    connected,
    probeOk,
    accountId: normalizeAccountId(primaryAccount.accountId) ?? 'default',
    botUsername:
      primaryProbe.botUsername ??
      firstNonNull(probes.map((probe) => probe.botUsername)),
    dmPolicy:
      nonEmptyString(primaryAccount.dmPolicy) ??
      firstNonNull(accounts.map((account) => nonEmptyString(account.dmPolicy))),
    lastError:
      primaryProbe.error ?? firstNonNull(probes.map((probe) => probe.error)),
    pairingRequests,
  }
}

function summarizeTelegramStatusFromLegacyText(
  raw: string,
  pairingRequests: Array<TelegramPairingRequest>,
): TelegramStatusSummary | null {
  const line =
    raw
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find((entry) => /^-\s*telegram\s+/i.test(entry)) ?? null

  if (!line) {
    return null
  }

  const lineMatch = line.match(/^-\s*telegram\s+([^:]+):\s*(.+)$/i)
  const accountId = lineMatch?.[1]?.trim() || 'default'
  const tokens = (lineMatch?.[2] ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())

  const configured = tokens.includes('configured')
  const enabled = tokens.includes('enabled')
  const connected =
    tokens.includes('connected') && !hasPendingPairingRequests(pairingRequests)
  const running = tokens.includes('running') || connected

  return {
    checkedAt: new Date().toISOString(),
    configured,
    enabled,
    running,
    connected,
    probeOk: false,
    accountId,
    botUsername: null,
    dmPolicy: null,
    lastError: raw.toLowerCase().includes('pairing required')
      ? 'Gateway probe requires pairing, but Telegram account is configured.'
      : null,
    pairingRequests,
  }
}

function summarizeTelegramStatusFromPayload(
  channelsPayload: ChannelsStatusPayload,
  pairingRequests: Array<TelegramPairingRequest>,
): TelegramStatusSummary {
  const accounts = getTelegramAccounts(channelsPayload)
  if (accounts.length === 0) {
    return {
      checkedAt: new Date().toISOString(),
      configured: false,
      enabled: false,
      running: false,
      connected: false,
      probeOk: false,
      accountId: null,
      botUsername: null,
      dmPolicy: null,
      lastError: null,
      pairingRequests,
    }
  }

  const primaryAccount = pickPreferredStatusAccount(accounts)
  if (!primaryAccount) {
    return {
      checkedAt: new Date().toISOString(),
      configured: false,
      enabled: false,
      running: false,
      connected: false,
      probeOk: false,
      accountId: null,
      botUsername: null,
      dmPolicy: null,
      lastError: null,
      pairingRequests,
    }
  }

  const probes = accounts.map((account) => getStatusProbeInfo(account))
  const primaryProbe = getStatusProbeInfo(primaryAccount)

  const configured = accounts.some((account) =>
    normalizeFlag(account.configured),
  )
  const enabled = accounts.some((account) => account.enabled !== false)
  const explicitConnected = accounts.some((account) =>
    normalizeFlag(account.connected),
  )
  const hasPendingPairing = hasPendingPairingRequests(pairingRequests)
  const probeOk = probes.some((probe) => probe.ok)
  const hasUnpairedSignal =
    accounts.some((account) =>
      indicatesUnpairedAccessSignal(nonEmptyString(account.lastError)),
    ) || probes.some((probe) => indicatesUnpairedAccessSignal(probe.error))
  const connected =
    explicitConnected && !hasPendingPairing && !hasUnpairedSignal
  const running =
    accounts.some((account) => normalizeFlag(account.running)) || probeOk

  return {
    checkedAt: new Date().toISOString(),
    configured,
    enabled,
    running,
    connected,
    probeOk,
    accountId: normalizeAccountId(primaryAccount.accountId) ?? 'default',
    botUsername:
      primaryProbe.botUsername ??
      firstNonNull(probes.map((probe) => probe.botUsername)),
    dmPolicy:
      nonEmptyString(primaryAccount.dmPolicy) ??
      firstNonNull(accounts.map((account) => nonEmptyString(account.dmPolicy))),
    lastError:
      nonEmptyString(primaryAccount.lastError) ??
      primaryProbe.error ??
      firstNonNull(
        accounts.map((account) => nonEmptyString(account.lastError)),
      ) ??
      firstNonNull(probes.map((probe) => probe.error)),
    pairingRequests,
  }
}

function mergeTelegramStatusSummary(
  primary: TelegramStatusSummary,
  fallback: TelegramStatusSummary | null,
): TelegramStatusSummary {
  if (!fallback) {
    return primary
  }

  return {
    ...primary,
    running: primary.running || fallback.running,
    connected: primary.connected || fallback.connected,
    probeOk: primary.probeOk || fallback.probeOk,
    configured: primary.configured || fallback.configured,
    enabled: primary.enabled || fallback.enabled,
    accountId: primary.accountId ?? fallback.accountId,
    botUsername: primary.botUsername ?? fallback.botUsername,
    dmPolicy: primary.dmPolicy ?? fallback.dmPolicy,
    lastError: primary.lastError ?? fallback.lastError,
  }
}

export async function verifyOpenClawHost(
  host: string,
): Promise<OpenClawVerifyResult> {
  const [gatewayStatusRaw, healthRaw] = await Promise.all([
    runOpenclawCommand(host, 'gateway status --json', {
      timeoutMs: 30_000,
    }),
    runOpenclawCommand(host, 'health --json', {
      timeoutMs: 30_000,
    }),
  ])

  const gatewayStatus = tryParseJson<GatewayStatusPayload>(gatewayStatusRaw)
  if (!gatewayStatus) {
    throw new Error('Failed to parse gateway status JSON from server output')
  }

  const health = tryParseJson<HealthPayload>(healthRaw)
  if (!health) {
    throw new Error('Failed to parse health JSON from server output')
  }

  const channelProbeSummary = extractProbeOkCount(health.channels)
  const gatewayLoaded = gatewayStatus.service?.loaded === true
  const gatewayRuntimeStatus =
    typeof gatewayStatus.service?.runtime?.status === 'string'
      ? gatewayStatus.service.runtime.status
      : null
  const rpcOk = gatewayStatus.rpc?.ok === true
  const healthOk = health.ok === true

  return {
    checkedAt: new Date().toISOString(),
    ok: gatewayLoaded && rpcOk && healthOk,
    gateway: {
      loaded: gatewayLoaded,
      runtimeStatus: gatewayRuntimeStatus,
      probeUrl:
        typeof gatewayStatus.gateway?.probeUrl === 'string'
          ? gatewayStatus.gateway.probeUrl
          : null,
      rpcOk,
      rpcError:
        typeof gatewayStatus.rpc?.error === 'string'
          ? gatewayStatus.rpc.error
          : null,
    },
    health: {
      ok: healthOk,
      durationMs:
        typeof health.durationMs === 'number' ? health.durationMs : null,
      channelsOk: channelProbeSummary.ok,
      channelsFailed: channelProbeSummary.failed,
    },
  }
}

export async function getTelegramStatus(
  host: string,
): Promise<TelegramStatusSummary> {
  const [capabilitiesResult, pairingResult] = await Promise.allSettled([
    runOpenclawCommand(
      host,
      'channels capabilities --channel telegram --json',
      {
        timeoutMs: 30_000,
      },
    ),
    runOpenclawCommand(host, 'pairing list telegram --json', {
      timeoutMs: 20_000,
    }),
  ])

  let pairingRequests: Array<TelegramPairingRequest> = []
  if (pairingResult.status === 'fulfilled') {
    pairingRequests = parsePairingRequests(pairingResult.value)
  } else {
    const message = errorMessage(pairingResult.reason)
    if (!isUnsupportedTelegramChannelError(message)) {
      throw pairingResult.reason
    }
  }

  let capabilitiesRaw: string | null =
    capabilitiesResult.status === 'fulfilled' ? capabilitiesResult.value : null
  let capabilitiesError: unknown =
    capabilitiesResult.status === 'rejected' ? capabilitiesResult.reason : null

  if (
    !capabilitiesRaw &&
    capabilitiesError &&
    isUnsupportedTelegramChannelError(errorMessage(capabilitiesError))
  ) {
    await tryEnableTelegramPlugin(host)
    try {
      capabilitiesRaw = await runOpenclawCommand(
        host,
        'channels capabilities --channel telegram --json',
        {
          timeoutMs: 30_000,
        },
      )
      capabilitiesError = null
    } catch (error) {
      capabilitiesError = error
    }
  }

  const capabilitiesPayload = capabilitiesRaw
    ? tryParseJson<ChannelsCapabilitiesPayload>(capabilitiesRaw)
    : null
  const capabilitiesSummary = capabilitiesPayload
    ? summarizeTelegramStatusFromCapabilitiesPayload(
        capabilitiesPayload,
        pairingRequests,
      )
    : null

  let channelsStatusRaw: string | null = null
  let channelsStatusError: unknown = null
  try {
    channelsStatusRaw = await runOpenclawCommand(
      host,
      'channels status --probe --json',
      {
        timeoutMs: 30_000,
      },
    )
  } catch (error) {
    channelsStatusError = error
  }

  if (channelsStatusRaw) {
    const channelsPayload =
      tryParseJson<ChannelsStatusPayload>(channelsStatusRaw)
    if (channelsPayload) {
      return mergeTelegramStatusSummary(
        summarizeTelegramStatusFromPayload(channelsPayload, pairingRequests),
        capabilitiesSummary,
      )
    }

    const legacySummary = summarizeTelegramStatusFromLegacyText(
      channelsStatusRaw,
      pairingRequests,
    )
    if (legacySummary) {
      return mergeTelegramStatusSummary(legacySummary, capabilitiesSummary)
    }
  }

  if (capabilitiesSummary) {
    return capabilitiesSummary
  }

  const failureSource = capabilitiesError ?? channelsStatusError
  const failure = failureSource
    ? truncateDiagnosticSnippet(errorMessage(failureSource))
    : null

  return {
    checkedAt: new Date().toISOString(),
    configured: false,
    enabled: false,
    running: false,
    connected: false,
    probeOk: false,
    accountId: null,
    botUsername: null,
    dmPolicy: null,
    lastError: failure
      ? `Telegram status probe unavailable: ${failure}`
      : 'Telegram status could not be parsed yet. The gateway may still be warming up.',
    pairingRequests,
  }
}

export async function connectTelegram(
  host: string,
  botToken: string,
): Promise<TelegramStatusSummary> {
  const escapedToken = escapeShellArg(botToken)
  await runTelegramCommandWithAutoRepair(
    host,
    `channels add --channel telegram --token ${escapedToken}`,
    {
      timeoutMs: 40_000,
      redact: [botToken],
    },
  )

  return await getTelegramStatus(host)
}

export async function approveTelegramPairing(
  host: string,
  code: string,
): Promise<TelegramStatusSummary> {
  const escapedCode = escapeShellArg(code)
  await runTelegramCommandWithAutoRepair(
    host,
    `pairing approve telegram ${escapedCode} --notify`,
    {
      timeoutMs: 20_000,
    },
  )

  return await getTelegramStatus(host)
}
