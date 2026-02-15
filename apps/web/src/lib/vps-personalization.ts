import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { user } from '@/db/schema'
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

  try {
    const config = JSON.parse(configJson)
    if (
      config?.gateway?.http?.endpoints?.chatCompletions?.enabled === true &&
      config?.gateway?.auth?.allowTailscale === true
    ) {
      return
    }
  } catch {
    // config doesn't exist or is invalid — we'll write it
  }

  const writeCmd = [
    "sudo -u openclaw env HOME=/opt/openclaw bash -c '",
    'mkdir -p /opt/openclaw/.openclaw',
    `cat > /tmp/oc-patch.json <<EOJSON`,
    '{"gateway":{"auth":{"allowTailscale":true},"http":{"endpoints":{"chatCompletions":{"enabled":true}}}}}',
    'EOJSON',
    'openclaw config set --merge /tmp/oc-patch.json 2>/dev/null || ',
    `python3 -c "`,
    'import json, os',
    `p = \\"/opt/openclaw/.openclaw/openclaw.json\\"`,
    'c = json.load(open(p)) if os.path.exists(p) else {}',
    `c.setdefault(\\"gateway\\",{}).setdefault(\\"auth\\",{})[\\"allowTailscale\\"] = True`,
    `c.setdefault(\\"gateway\\",{}).setdefault(\\"http\\",{}).setdefault(\\"endpoints\\",{}).setdefault(\\"chatCompletions\\",{})[\\"enabled\\"] = True`,
    `json.dump(c, open(p,\\"w\\"), indent=2)`,
    '"',
    'rm -f /tmp/oc-patch.json',
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
