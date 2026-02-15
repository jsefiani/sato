import { runVpsSshCommand } from '@/lib/vps-ssh'
import { verifyOpenClawHost } from '@/lib/vps-openclaw'

const UPDATE_TIMEOUT_MS = 180_000
const DOCTOR_TIMEOUT_MS = 45_000
const OS_UPDATE_TIMEOUT_MS = 300_000
const HEALTH_CHECK_DELAY_MS = 5_000

function buildRootShellCommand(command: string): string {
  const escaped = command.replace(/'/g, `'"'"'`)
  return `/bin/bash -lc 'export HOME=/root; export PATH=/usr/local/bin:/usr/bin:/bin; ${escaped}'`
}

async function runRootShellCommand(
  host: string,
  command: string,
  opts?: { timeoutMs?: number },
): Promise<string> {
  return await runVpsSshCommand(host, buildRootShellCommand(command), opts)
}

function buildOpenclawUserCommand(command: string): string {
  const escaped = command.replace(/'/g, `'"'"'`)
  return `sudo -u openclaw env HOME=/opt/openclaw PATH=/usr/local/bin:/usr/bin:/bin /bin/bash -c '${escaped}'`
}

async function runOpenclawCommand(
  host: string,
  command: string,
  opts?: { timeoutMs?: number },
): Promise<string> {
  return await runVpsSshCommand(
    host,
    buildOpenclawUserCommand(`openclaw ${command}`),
    opts,
  )
}

function firstNonEmptyLine(value: string): string | null {
  const line =
    value
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find(Boolean) ?? null

  return line || null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function getOpenClawVersion({
  host,
}: {
  host: string
}): Promise<string | null> {
  try {
    const output = await runOpenclawCommand(host, '--version', {
      timeoutMs: 15_000,
    })
    return firstNonEmptyLine(output)
  } catch {
    return null
  }
}

interface MaintenanceResult {
  durationMs: number
  detail: Record<string, unknown>
}

async function updateOpenClaw({
  host,
}: {
  host: string
}): Promise<MaintenanceResult> {
  const start = Date.now()

  const fromVersion = await getOpenClawVersion({ host })

  await runRootShellCommand(host, 'openclaw update --channel stable', {
    timeoutMs: UPDATE_TIMEOUT_MS,
  })

  await runOpenclawCommand(host, 'doctor --non-interactive', {
    timeoutMs: DOCTOR_TIMEOUT_MS,
  }).catch(() => {})

  await runRootShellCommand(host, 'systemctl restart openclaw-gateway', {
    timeoutMs: 30_000,
  })

  await sleep(HEALTH_CHECK_DELAY_MS)

  const verification = await verifyOpenClawHost(host)
  if (!verification.ok) {
    throw new Error(
      `Health check failed after update: gateway=${JSON.stringify(verification.gateway)}, health=${JSON.stringify(verification.health)}`,
    )
  }

  const toVersion = await getOpenClawVersion({ host })

  return {
    durationMs: Date.now() - start,
    detail: { fromVersion, toVersion },
  }
}

const UNATTENDED_UPGRADES_CONFIG = `Unattended-Upgrade::Allowed-Origins {
    "\${distro_id}:\${distro_codename}-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";`

const AUTO_UPGRADES_CONFIG = `APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";`

async function enableUnattendedUpgrades({
  host,
}: {
  host: string
}): Promise<MaintenanceResult> {
  const start = Date.now()

  await runRootShellCommand(
    host,
    'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unattended-upgrades',
    { timeoutMs: 60_000 },
  )

  await runRootShellCommand(
    host,
    `cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'UUCFG'\n${UNATTENDED_UPGRADES_CONFIG}\nUUCFG`,
    { timeoutMs: 10_000 },
  )

  await runRootShellCommand(
    host,
    `cat > /etc/apt/apt.conf.d/20auto-upgrades << 'AUTOCFG'\n${AUTO_UPGRADES_CONFIG}\nAUTOCFG`,
    { timeoutMs: 10_000 },
  )

  return {
    durationMs: Date.now() - start,
    detail: { enabled: true },
  }
}

async function updateOs({
  host,
}: {
  host: string
}): Promise<MaintenanceResult> {
  const start = Date.now()

  await runRootShellCommand(
    host,
    'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq',
    { timeoutMs: OS_UPDATE_TIMEOUT_MS },
  )

  return {
    durationMs: Date.now() - start,
    detail: { upgraded: true },
  }
}

export const maintenanceActions = {
  'update-openclaw': updateOpenClaw,
  'enable-unattended-upgrades': enableUnattendedUpgrades,
  'update-os': updateOs,
} as const

export type MaintenanceAction = keyof typeof maintenanceActions
