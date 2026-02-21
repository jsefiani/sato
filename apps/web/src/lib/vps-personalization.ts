import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { user } from '@/db/schema'
import { getGatewayAuthToken } from '@/lib/gateway-auth'
import { DEFAULT_MODEL, normalizeModel } from '@/lib/models'
import { isTcpPortReachable } from '@/lib/readiness'
import { waitForOpenClawGateway } from '@/lib/vps-probes'
import { runVpsSshCommand } from '@/lib/vps-ssh'

const GATEWAY_PORT = 18789
const GATEWAY_READY_ATTEMPTS = 10
const GATEWAY_READY_INTERVAL_MS = 1_000

function buildRootShellCommand({ command }: { command: string }): string {
  const escaped = command.replace(/'/g, `'"'"'`)
  return `/bin/bash -lc 'export HOME=/root; export PATH=/usr/local/bin:/usr/bin:/bin; ${escaped}'`
}

async function restartOpenClawGateway({
  tailscaleIp,
  waitForReady,
}: {
  tailscaleIp: string
  waitForReady: boolean
}): Promise<void> {
  if (!waitForReady) {
    try {
      await runVpsSshCommand(
        tailscaleIp,
        buildRootShellCommand({
          command:
            'if command -v systemctl >/dev/null 2>&1; then systemctl restart --no-block openclaw-gateway || systemctl restart openclaw-gateway; fi',
        }),
        { timeoutMs: 15_000 },
      )
    } catch (error) {
      console.warn(
        '[vps-personalization] Model config updated but gateway restart did not complete immediately.',
        error,
      )
    }
    return
  }

  await runVpsSshCommand(
    tailscaleIp,
    buildRootShellCommand({
      command: 'systemctl restart openclaw-gateway',
    }),
    { timeoutMs: 30_000 },
  )
}

function buildSoulMd({
  assistantName,
  communicationStyle,
  primaryUseCase,
  additionalContext,
}: {
  assistantName: string
  communicationStyle: string
  primaryUseCase: string
  additionalContext: string
}): string {
  const lines = [
    `# ${assistantName}`,
    '',
    `You are ${assistantName}, a personal AI assistant.`,
    '',
    `## Communication Style`,
    `- Style: ${communicationStyle}`,
    '',
    `## Primary Use Case`,
    `- Focus: ${primaryUseCase}`,
  ]

  if (additionalContext) {
    lines.push('', `## Additional Context`, additionalContext)
  }

  return lines.join('\n')
}

export async function injectPersonalization({
  userId,
  tailscaleIp,
}: {
  userId: string
  tailscaleIp: string
}): Promise<void> {
  const row = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: {
      assistantName: true,
      communicationStyle: true,
      primaryUseCase: true,
      additionalContext: true,
      personalizationInjectedAt: true,
    },
  })

  if (!row) return
  if (row.personalizationInjectedAt) return
  if (!row.assistantName) return

  const content = buildSoulMd({
    assistantName: row.assistantName,
    communicationStyle: row.communicationStyle ?? 'balanced',
    primaryUseCase: row.primaryUseCase ?? 'general',
    additionalContext: row.additionalContext ?? '',
  })

  await runVpsSshCommand(
    tailscaleIp,
    `sudo -u openclaw mkdir -p /opt/openclaw/.openclaw/workspace && sudo -u openclaw tee /opt/openclaw/.openclaw/workspace/SOUL.md > /dev/null <<'SOULEOF'\n${content}\nSOULEOF`,
  )

  await db
    .update(user)
    .set({ personalizationInjectedAt: new Date() })
    .where(eq(user.id, userId))
}

export async function ensureChatEndpointEnabled({
  tailscaleIp,
  userId,
}: {
  tailscaleIp: string
  userId: string
}): Promise<void> {
  const checkCmd = `sudo -u openclaw env HOME=/opt/openclaw bash -c 'cat /opt/openclaw/.openclaw/openclaw.json 2>/dev/null || echo "{}"'`
  const configJson = await runVpsSshCommand(tailscaleIp, checkCmd)
  const gatewayToken = getGatewayAuthToken({ userId })
  let desiredPrimaryModel = DEFAULT_MODEL.value

  try {
    const config = JSON.parse(configJson)
    const configuredPrimary =
      typeof config?.agents?.defaults?.model?.primary === 'string'
        ? config.agents.defaults.model.primary
        : null
    desiredPrimaryModel = normalizeModel(configuredPrimary)
    const modelNeedsRepair = configuredPrimary !== desiredPrimaryModel
    const configuredGatewayToken =
      typeof config?.gateway?.auth?.token === 'string'
        ? config.gateway.auth.token
        : null

    if (
      config?.gateway?.http?.endpoints?.chatCompletions?.enabled === true &&
      config?.gateway?.auth?.allowTailscale === true &&
      (configuredGatewayToken === gatewayToken ||
        configuredGatewayToken === 'openclaw') &&
      !('provider' in config) &&
      !modelNeedsRepair
    ) {
      return
    }
  } catch {
    // config doesn't exist or is invalid — we'll write it
  }

  const writeCmd = [
    "sudo -u openclaw env HOME=/opt/openclaw bash -c '",
    'mkdir -p /opt/openclaw/.openclaw',
    'openclaw config set --json gateway.auth.allowTailscale true 2>/dev/null || true',
    `openclaw config set gateway.auth.token ${JSON.stringify(gatewayToken)} 2>/dev/null || true`,
    'openclaw config set --json gateway.http.endpoints.chatCompletions.enabled true 2>/dev/null || true',
    `openclaw config set agents.defaults.model.primary ${JSON.stringify(desiredPrimaryModel)} 2>/dev/null || true`,
    `python3 -c "`,
    'import json, os',
    `p = \\"/opt/openclaw/.openclaw/openclaw.json\\"`,
    'c = json.load(open(p)) if os.path.exists(p) else {}',
    `c.pop(\\"provider\\", None)`,
    `d = c.setdefault(\\"agents\\",{}).setdefault(\\"defaults\\",{})`,
    `m = d.setdefault(\\"model\\",{})`,
    `m[\\"primary\\"] = \\"${desiredPrimaryModel}\\"`,
    `models = d.setdefault(\\"models\\",{})`,
    `models.setdefault(\\"${desiredPrimaryModel}\\", {})`,
    `if \\"${desiredPrimaryModel}\\".startswith(\\"openrouter/\\") and \\"${desiredPrimaryModel}\\" != \\"openrouter/openrouter/auto\\" and not m.get(\\"fallbacks\\"):`,
    `  models.setdefault(\\"openrouter/openrouter/auto\\", {})`,
    `  m[\\"fallbacks\\"] = [\\"openrouter/openrouter/auto\\"]`,
    `c.setdefault(\\"gateway\\",{}).setdefault(\\"auth\\",{})[\\"allowTailscale\\"] = True`,
    `c.setdefault(\\"gateway\\",{}).setdefault(\\"auth\\",{})[\\"token\\"] = \\"${gatewayToken}\\"`,
    `c.setdefault(\\"gateway\\",{}).setdefault(\\"http\\",{}).setdefault(\\"endpoints\\",{}).setdefault(\\"chatCompletions\\",{})[\\"enabled\\"] = True`,
    `json.dump(c, open(p,\\"w\\"), indent=2)`,
    '"',
    "'",
  ].join('\n')

  await runVpsSshCommand(tailscaleIp, writeCmd)

  await restartOpenClawGateway({ tailscaleIp, waitForReady: true })

  await waitForOpenClawGateway({
    gatewayHost: tailscaleIp,
    gatewayAuthToken: gatewayToken,
    attempts: GATEWAY_READY_ATTEMPTS,
    intervalMs: GATEWAY_READY_INTERVAL_MS,
  })
}

export async function applyModelConfig({
  tailscaleIp,
  model,
  waitForReady = true,
}: {
  tailscaleIp: string
  model: string
  waitForReady?: boolean
}): Promise<void> {
  const modelId = normalizeModel(model)

  const checkCmd = `sudo -u openclaw env HOME=/opt/openclaw bash -c 'cat /opt/openclaw/.openclaw/openclaw.json 2>/dev/null || echo "{}"'`
  const configJson = await runVpsSshCommand(tailscaleIp, checkCmd)

  try {
    const config = JSON.parse(configJson)
    if (
      config?.agents?.defaults?.model?.primary === modelId &&
      !('provider' in config)
    ) {
      return
    }
  } catch {
    // config doesn't exist or is invalid — we'll write it
  }

  const writeCmd = [
    "sudo -u openclaw env HOME=/opt/openclaw bash -c '",
    'mkdir -p /opt/openclaw/.openclaw',
    `openclaw config set agents.defaults.model.primary ${JSON.stringify(modelId)} 2>/dev/null || true`,
    `python3 -c "`,
    'import json, os',
    `p = \\"/opt/openclaw/.openclaw/openclaw.json\\"`,
    'c = json.load(open(p)) if os.path.exists(p) else {}',
    `c.pop(\\"provider\\", None)`,
    `d = c.setdefault(\\"agents\\",{}).setdefault(\\"defaults\\",{})`,
    `m = d.setdefault(\\"model\\",{})`,
    `m[\\"primary\\"] = \\"${modelId}\\"`,
    `models = d.setdefault(\\"models\\",{})`,
    `models.setdefault(\\"${modelId}\\", {})`,
    `if \\"${modelId}\\".startswith(\\"openrouter/\\") and \\"${modelId}\\" != \\"openrouter/openrouter/auto\\" and not m.get(\\"fallbacks\\"):`,
    `  models.setdefault(\\"openrouter/openrouter/auto\\", {})`,
    `  m[\\"fallbacks\\"] = [\\"openrouter/openrouter/auto\\"]`,
    `json.dump(c, open(p,\\"w\\"), indent=2)`,
    '"',
    "'",
  ].join('\n')

  await runVpsSshCommand(tailscaleIp, writeCmd)

  await restartOpenClawGateway({ tailscaleIp, waitForReady })

  if (!waitForReady) {
    return
  }

  for (let i = 0; i < GATEWAY_READY_ATTEMPTS; i++) {
    if (await isTcpPortReachable(tailscaleIp, GATEWAY_PORT)) return
    await new Promise((resolve) =>
      setTimeout(resolve, GATEWAY_READY_INTERVAL_MS),
    )
  }
}
