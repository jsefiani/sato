import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { user } from '@/db/schema'
import { DEFAULT_MODEL, normalizeModel } from '@/lib/models'
import { isTcpPortReachable } from '@/lib/readiness'
import { runVpsSshCommand } from '@/lib/vps-ssh'

const GATEWAY_PORT = 18789
const GATEWAY_READY_ATTEMPTS = 10
const GATEWAY_READY_INTERVAL_MS = 1_000

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

export async function ensureChatEndpointEnabled(
  tailscaleIp: string,
): Promise<void> {
  const checkCmd = `sudo -u openclaw env HOME=/opt/openclaw bash -c 'cat /opt/openclaw/.openclaw/openclaw.json 2>/dev/null || echo "{}"'`
  const configJson = await runVpsSshCommand(tailscaleIp, checkCmd)
  let desiredPrimaryModel = DEFAULT_MODEL.value

  try {
    const config = JSON.parse(configJson)
    const configuredPrimary =
      typeof config?.agents?.defaults?.model?.primary === 'string'
        ? config.agents.defaults.model.primary
        : null
    desiredPrimaryModel = normalizeModel(configuredPrimary)
    const modelNeedsRepair = configuredPrimary !== desiredPrimaryModel

    if (
      config?.gateway?.http?.endpoints?.chatCompletions?.enabled === true &&
      config?.gateway?.auth?.allowTailscale === true &&
      config?.gateway?.auth?.token === 'openclaw' &&
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
    'openclaw config set gateway.auth.token openclaw 2>/dev/null || true',
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
    `c.setdefault(\\"gateway\\",{}).setdefault(\\"auth\\",{})[\\"token\\"] = \\"openclaw\\"`,
    `c.setdefault(\\"gateway\\",{}).setdefault(\\"http\\",{}).setdefault(\\"endpoints\\",{}).setdefault(\\"chatCompletions\\",{})[\\"enabled\\"] = True`,
    `json.dump(c, open(p,\\"w\\"), indent=2)`,
    '"',
    "'",
  ].join('\n')

  await runVpsSshCommand(tailscaleIp, writeCmd)

  // Restart the gateway so it picks up the new config (no hot-reload support)
  const restartCmd = `/bin/bash -lc 'export HOME=/root; export PATH=/usr/local/bin:/usr/bin:/bin; systemctl restart openclaw-gateway'`
  await runVpsSshCommand(tailscaleIp, restartCmd, { timeoutMs: 30_000 })

  // Wait for the gateway to accept connections before returning
  for (let i = 0; i < GATEWAY_READY_ATTEMPTS; i++) {
    if (await isTcpPortReachable(tailscaleIp, GATEWAY_PORT)) return
    await new Promise((resolve) =>
      setTimeout(resolve, GATEWAY_READY_INTERVAL_MS),
    )
  }
}

export async function applyModelConfig({
  tailscaleIp,
  model,
}: {
  tailscaleIp: string
  model: string
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

  const restartCmd = `/bin/bash -lc 'export HOME=/root; export PATH=/usr/local/bin:/usr/bin:/bin; systemctl restart openclaw-gateway'`
  await runVpsSshCommand(tailscaleIp, restartCmd, { timeoutMs: 30_000 })

  for (let i = 0; i < GATEWAY_READY_ATTEMPTS; i++) {
    if (await isTcpPortReachable(tailscaleIp, GATEWAY_PORT)) return
    await new Promise((resolve) =>
      setTimeout(resolve, GATEWAY_READY_INTERVAL_MS),
    )
  }
}
