import { execFile } from 'node:child_process'
import { env } from '@/lib/env'

const DEFAULT_TIMEOUT_MS = 20_000

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
  host: string,
  command: string,
  opts?: {
    timeoutMs?: number
    redact?: Array<string>
    connectTimeoutSeconds?: number
  },
): Promise<string> {
  const sshUser = env.VPS_SSH_USER
  const sshPort = env.VPS_SSH_PORT
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const redact = opts?.redact ?? []
  const connectTimeoutSeconds = Math.max(
    1,
    Math.floor(opts?.connectTimeoutSeconds ?? 8),
  )

  const sshArgs = [
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=/dev/null',
    '-o',
    `ConnectTimeout=${connectTimeoutSeconds}`,
    '-o',
    'LogLevel=ERROR',
    '-p',
    String(sshPort),
    `${sshUser}@${host}`,
    command,
  ]

  return await new Promise((resolve, reject) => {
    execFile(
      'ssh',
      sshArgs,
      { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr || error.message
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
