import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { env } from '@/lib/env'

const DEFAULT_TIMEOUT_MS = 20_000
const SSH_FILE_MODE = 0o600
const KNOWN_HOSTS_FILENAME = 'sato-vps-known-hosts'
const INLINE_SSH_KEY_FILENAME = `sato-vps-ssh-key-${process.pid}`

let cachedKnownHostsPath: string | null = null
let cachedInlineKeyPath: string | null = null

function stripSshHostKeyNoise(value: string): string {
  return value
    .split(/\r?\n/)
    .filter(
      (line) =>
        !line.startsWith('Warning: Permanently added ') &&
        !line.includes('to the list of known hosts.'),
    )
    .join('\n')
}

function ensureSecureFile(filePath: string): void {
  const directory = path.dirname(filePath)
  mkdirSync(directory, { recursive: true })

  if (!existsSync(filePath)) {
    writeFileSync(filePath, '', { mode: SSH_FILE_MODE })
  }

  chmodSync(filePath, SSH_FILE_MODE)
}

function resolveKnownHostsPath(): string {
  const knownHostsPath =
    env.VPS_SSH_KNOWN_HOSTS_PATH ?? path.join(os.tmpdir(), KNOWN_HOSTS_FILENAME)

  if (cachedKnownHostsPath !== knownHostsPath) {
    ensureSecureFile(knownHostsPath)
    cachedKnownHostsPath = knownHostsPath
  }

  return knownHostsPath
}

function resolveSshPrivateKeyPath(): string {
  const inlineKey = env.HETZNER_SSH_PRIVATE_KEY

  if (!inlineKey || inlineKey.trim().length === 0) {
    return env.HETZNER_SSH_PRIVATE_KEY_PATH!
  }

  if (!cachedInlineKeyPath) {
    const keyPath = path.join(os.tmpdir(), INLINE_SSH_KEY_FILENAME)
    const normalizedKey = inlineKey.endsWith('\n')
      ? inlineKey
      : `${inlineKey}\n`

    writeFileSync(keyPath, normalizedKey, { mode: SSH_FILE_MODE })
    chmodSync(keyPath, SSH_FILE_MODE)
    cachedInlineKeyPath = keyPath
  }

  return cachedInlineKeyPath
}

function resolveHostKeyCheckingMode(): string {
  return env.VPS_SSH_STRICT_HOST_KEY_CHECKING
}

function redactSecrets(value: string, secrets: Array<string>): string {
  if (!value || secrets.length === 0) {
    return value
  }

  let redacted = value
  for (const secret of secrets) {
    if (!secret) {
      continue
    }

    redacted = redacted.split(secret).join('[REDACTED]')
  }

  return redacted
}

export function escapeShellArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

export async function runVpsSshCommand(
  ipv4Address: string,
  command: string,
  opts?: {
    timeoutMs?: number
    redact?: Array<string>
    connectTimeoutSeconds?: number
    tailscaleIp?: string | null
  },
): Promise<string> {
  const keyPath = resolveSshPrivateKeyPath()
  const knownHostsPath = resolveKnownHostsPath()
  const hostKeyCheckingMode = resolveHostKeyCheckingMode()
  const sshUser = env.VPS_SSH_USER
  const sshPort = env.VPS_SSH_PORT
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const redact = opts?.redact ?? []
  const connectTimeoutSeconds = Math.max(
    1,
    Math.floor(opts?.connectTimeoutSeconds ?? 8),
  )

  const targetHost = opts?.tailscaleIp ?? ipv4Address

  const sshArgs = [
    '-i',
    keyPath,
    '-o',
    'BatchMode=yes',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    `StrictHostKeyChecking=${hostKeyCheckingMode}`,
    '-o',
    `UserKnownHostsFile=${knownHostsPath}`,
    '-o',
    `ConnectTimeout=${connectTimeoutSeconds}`,
    '-o',
    'LogLevel=ERROR',
    '-p',
    String(sshPort),
  ]

  sshArgs.push(`${sshUser}@${targetHost}`, command)

  return await new Promise((resolve, reject) => {
    execFile(
      'ssh',
      sshArgs,
      { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stripSshHostKeyNoise(stderr || error.message)
          reject(
            new Error(
              `SSH failed: ${redactSecrets(detail, redact).trim() || 'unknown error'}`,
            ),
          )
          return
        }

        resolve(redactSecrets(stdout, redact))
      },
    )
  })
}
