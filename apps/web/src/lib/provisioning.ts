import { eq } from 'drizzle-orm'
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
  const safeApiKey = openRouterApiKey.replace(/'/g, `'"'"'`)
  const safeTsKey = tailscaleAuthKey.replace(/'/g, `'"'"'`)
  const safeCheckpointUrl = bootstrapCheckpointUrl.replace(/'/g, `'"'"'`)
  const safeCheckpointToken = bootstrapCheckpointToken.replace(/'/g, `'"'"'`)
  const safePreferredModel = preferredModel.replace(/'/g, `'"'"'`)

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
    '      #!/usr/bin/env bash',
    '      set -euo pipefail',
    '      mkdir -p /var/lib/sato',
    '      echo "started $(date -Is)" > /var/lib/sato/bootstrap-state',
    `      CHECKPOINT_URL='${safeCheckpointUrl}'`,
    `      CHECKPOINT_TOKEN='${safeCheckpointToken}'`,
    '',
    '      send_checkpoint() {',
    '        local event="$1"',
    '        local detail="${2:-}"',
    '        local tailscale_ip="${3:-}"',
    '        curl -fsS -m 6 -X POST "$CHECKPOINT_URL" \\',
    '          --data-urlencode "token=$CHECKPOINT_TOKEN" \\',
    '          --data-urlencode "event=$event" \\',
    '          --data-urlencode "detail=$detail" \\',
    '          --data-urlencode "tailscaleIp=$tailscale_ip" >/dev/null 2>&1 || true',
    '      }',
    '',
    '      on_bootstrap_error() {',
    '        local code="$1"',
    '        local line="$2"',
    '        echo "bootstrap.sh failed at line $line with exit code $code"',
    '        send_checkpoint "bootstrap_failed" "unexpected_error_line_${line}_code_${code}"',
    '        echo "failed $(date -Is) code=$code line=$line" > /var/lib/sato/bootstrap-state',
    '        exit "$code"',
    '      }',
    '      trap \'on_bootstrap_error "$?" "$LINENO"\' ERR',
    '',
    '      export HOME=/root',
    '      export PATH=/usr/local/bin:/usr/bin:/bin',
    '      export NO_COLOR=1',
    '      export CLICOLOR=0',
    '      export FORCE_COLOR=0',
    '      echo "bootstrap started at $(date -Is)"',
    '      echo "hostname: $(hostname)"',
    '      cloud-init status --long || true',
    '',
    '      # Load API key',
    '      set -a',
    '      source /opt/openclaw/.env',
    '      set +a',
    '      TS_IPV4=""',
    '      send_checkpoint "bootstrap_started" "bootstrap_started"',
    '',
    '      # Join Tailscale mesh (retry up to 3 times for transient DNS/network issues)',
    '      TS_JOINED=0',
    '      for TS_ATTEMPT in 1 2 3; do',
    `        if tailscale up --ssh --authkey '${safeTsKey}' --hostname '${tailscaleHostname}'; then`,
    '          TS_JOINED=1',
    '          break',
    '        fi',
    '        echo "tailscale up attempt $TS_ATTEMPT failed, retrying in 10s..."',
    '        sleep 10',
    '      done',
    '      if [ "$TS_JOINED" -ne 1 ]; then',
    '        echo "Failed to join Tailscale after 3 attempts"',
    '        send_checkpoint "bootstrap_failed" "tailscale_join_failed"',
    '        exit 1',
    '      fi',
    '      TS_IPV4="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"',
    '      send_checkpoint "tailscale_joined" "tailscale_joined" "$TS_IPV4"',
    '',
    '      # Configure OpenClaw as unprivileged user (already installed in snapshot)',
    '      if ! sudo -u openclaw env HOME=/opt/openclaw \\',
    '        PATH=/usr/local/bin:/usr/bin:/bin \\',
    '        NO_COLOR=1 CLICOLOR=0 FORCE_COLOR=0 \\',
    '        OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \\',
    '        openclaw onboard --non-interactive --accept-risk --mode local \\',
    '        --auth-choice openrouter-api-key --openrouter-api-key "$OPENROUTER_API_KEY" \\',
    '        --gateway-port 18789 --gateway-bind lan --skip-skills --skip-health; then',
    '        send_checkpoint "bootstrap_failed" "openclaw_onboard_failed" "$TS_IPV4"',
    '        exit 1',
    '      fi',
    '',
    '      # Enable chat completions endpoint + Tailscale auth bypass',
    '      if ! sudo -u openclaw env HOME=/opt/openclaw PATH=/usr/local/bin:/usr/bin:/bin \\',
    '        openclaw config set --json gateway.auth.allowTailscale true; then',
    `        python3 -c "import json,os; p='/opt/openclaw/.openclaw/openclaw.json'; c=json.load(open(p)) if os.path.exists(p) else {}; c.setdefault('gateway',{}).setdefault('auth',{})['allowTailscale']=True; json.dump(c, open(p,'w'), indent=2)"`,
    '      fi',
    '      if ! sudo -u openclaw env HOME=/opt/openclaw PATH=/usr/local/bin:/usr/bin:/bin \\',
    '        openclaw config set gateway.auth.token openclaw; then',
    `        python3 -c "import json,os; p='/opt/openclaw/.openclaw/openclaw.json'; c=json.load(open(p)) if os.path.exists(p) else {}; c.setdefault('gateway',{}).setdefault('auth',{})['token']='openclaw'; json.dump(c, open(p,'w'), indent=2)"`,
    '      fi',
    '      if ! sudo -u openclaw env HOME=/opt/openclaw PATH=/usr/local/bin:/usr/bin:/bin \\',
    '        openclaw config set --json gateway.http.endpoints.chatCompletions.enabled true; then',
    `        python3 -c "import json,os; p='/opt/openclaw/.openclaw/openclaw.json'; c=json.load(open(p)) if os.path.exists(p) else {}; c.setdefault('gateway',{}).setdefault('http',{}).setdefault('endpoints',{}).setdefault('chatCompletions',{})['enabled']=True; json.dump(c, open(p,'w'), indent=2)"`,
    '      fi',
    `      python3 -c "import json,os; p='/opt/openclaw/.openclaw/openclaw.json'; c=json.load(open(p)) if os.path.exists(p) else {}; c.pop('provider', None); json.dump(c, open(p,'w'), indent=2)" || true`,
    '',
    `      # Set preferred AI model`,
    '      if ! sudo -u openclaw env HOME=/opt/openclaw PATH=/usr/local/bin:/usr/bin:/bin \\',
    `        openclaw config set agents.defaults.model.primary '${safePreferredModel}'; then`,
    `        MODEL_VALUE='${safePreferredModel}' python3 -c "import json,os; p='/opt/openclaw/.openclaw/openclaw.json'; c=json.load(open(p)) if os.path.exists(p) else {}; c.setdefault('agents',{}).setdefault('defaults',{}).setdefault('model',{})['primary']=os.environ.get('MODEL_VALUE',''); json.dump(c, open(p,'w'), indent=2)"`,
    '      fi',
    `      MODEL_VALUE='${safePreferredModel}' python3 - <<'PY'`,
    `import json, os`,
    `p = '/opt/openclaw/.openclaw/openclaw.json'`,
    `c = json.load(open(p)) if os.path.exists(p) else {}`,
    `d = c.setdefault('agents', {}).setdefault('defaults', {})`,
    `model = d.setdefault('model', {})`,
    `m = os.environ.get('MODEL_VALUE', '')`,
    `models = d.setdefault('models', {})`,
    `if m:`,
    `  models.setdefault(m, {})`,
    `if m.startswith('openrouter/') and m != 'openrouter/openrouter/auto' and not model.get('fallbacks'):`,
    `  models.setdefault('openrouter/openrouter/auto', {})`,
    `  model['fallbacks'] = ['openrouter/openrouter/auto']`,
    `json.dump(c, open(p, 'w'), indent=2)`,
    `PY`,
    '',
    '      # Enable Telegram plugin',
    '      if ! sudo -u openclaw env HOME=/opt/openclaw PATH=/usr/local/bin:/usr/bin:/bin \\',
    '        NO_COLOR=1 CLICOLOR=0 FORCE_COLOR=0 \\',
    '        openclaw plugins enable telegram > /dev/null 2>&1; then',
    '        echo "Failed to enable Telegram plugin"',
    '        send_checkpoint "bootstrap_failed" "telegram_plugin_enable_failed" "$TS_IPV4"',
    '        sudo -u openclaw env HOME=/opt/openclaw PATH=/usr/local/bin:/usr/bin:/bin \\',
    '          openclaw plugins list --json || true',
    '        exit 1',
    '      fi',
    '',
    '      TELEGRAM_PLUGIN_LIST=$(sudo -u openclaw env HOME=/opt/openclaw PATH=/usr/local/bin:/usr/bin:/bin \\',
    '        NO_COLOR=1 CLICOLOR=0 FORCE_COLOR=0 \\',
    '        openclaw plugins list --enabled --json 2>/dev/null || true)',
    '      if ! printf \'%s\' "$TELEGRAM_PLUGIN_LIST" | grep -q \'"id": "telegram"\'; then',
    '        echo "Telegram plugin is still not enabled after setup"',
    '        send_checkpoint "bootstrap_failed" "telegram_plugin_missing_after_enable" "$TS_IPV4"',
    '        printf \'%s\\n\' "$TELEGRAM_PLUGIN_LIST"',
    '        exit 1',
    '      fi',
    '',
    '      # Start the pre-baked gateway service',
    '      systemctl daemon-reload',
    '      systemctl start openclaw-gateway',
    '      systemctl is-active --quiet openclaw-gateway',
    '',
    '      # Wait for gateway to come up (fatal if it never binds)',
    '      echo "Waiting for gateway on port 18789..."',
    '      GATEWAY_READY=0',
    '      for i in $(seq 1 30); do',
    "        if ss -tlnp | grep -q ':18789'; then",
    '          echo "Gateway is ready on port 18789"',
    '          GATEWAY_READY=1',
    '          break',
    '        fi',
    '        sleep 2',
    '      done',
    '',
    '      if [ "$GATEWAY_READY" -ne 1 ]; then',
    '        echo "Gateway failed to bind on port 18789"',
    '        send_checkpoint "bootstrap_failed" "gateway_bind_failed" "$TS_IPV4"',
    '        systemctl status openclaw-gateway --no-pager || true',
    '        journalctl -u openclaw-gateway -n 200 --no-pager || true',
    '        exit 1',
    '      fi',
    '      send_checkpoint "gateway_ready" "gateway_ready" "$TS_IPV4"',
    '',
    '      # Lock SSH back to Tailscale-only after successful bootstrap',
    '      ufw --force reset',
    '      ufw default deny incoming',
    '      ufw default allow outgoing',
    '      ufw allow 80/tcp',
    '      ufw allow 443/tcp',
    '      ufw allow 18789/tcp',
    '      ufw allow in on tailscale0 to any port 22 proto tcp',
    '      ufw --force enable',
    '',
    '      # Harden: clear the .env file (OpenClaw already loaded it)',
    '      : > /opt/openclaw/.env',
    '',
    '      # Harden: block metadata endpoint to prevent API key leakage',
    '      iptables -A OUTPUT -d 169.254.169.254 -j DROP || true',
    '      echo "succeeded $(date -Is)" > /var/lib/sato/bootstrap-state',
    '      send_checkpoint "bootstrap_completed" "bootstrap_completed" "$TS_IPV4"',
    '',
    '      # Log diagnostic info regardless of outcome',
    '      systemctl status openclaw-gateway --no-pager || true',
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
    })
    .from(vpsInstance)
    .where(eq(vpsInstance.userId, userId))
    .limit(1)

  const instance = instanceRows.at(0)

  if (!instance) {
    return
  }

  if (!instance.serverId && !instance.firewallId) {
    return
  }

  const cleanup = await cleanupProvisioningResources(
    instance.serverId,
    instance.firewallId,
  )

  const hasCleanupErrors = cleanup.errors.length > 0

  await db
    .update(vpsInstance)
    .set({
      status: hasCleanupErrors ? 'cleanup_pending' : 'pending',
      hetznerServerId: cleanup.remainingServerId,
      hetznerFirewallId: cleanup.remainingFirewallId,
    })
    .where(eq(vpsInstance.userId, userId))

  if (hasCleanupErrors) {
    throw new Error(
      `Unable to clean up previous failed resources: ${cleanup.errors.join(' | ')}`,
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
    })
    .from(vpsInstance)
    .where(eq(vpsInstance.userId, userId))
    .limit(1)

  const instance = instanceRows.at(0)

  if (!instance) return

  if (instance.tailscaleHostname) {
    try {
      await deleteDeviceByHostname({ hostname: instance.tailscaleHostname })
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
