const requiredEnvVars = [
  'APP_URL',
  'APP_ENCRYPTION_KEY',
  'OPENROUTER_PROVISIONING_KEY',
  'HETZNER_API_TOKEN',
  'STRIPE_SECRET_KEY',
  'STRIPE_PRICE_ID',
  'STRIPE_TOPUP_PACK_10_PRICE_ID',
  'STRIPE_TOPUP_PACK_25_PRICE_ID',
  'STRIPE_TOPUP_PACK_50_PRICE_ID',
  'STRIPE_WEBHOOK_SECRET',
  'HETZNER_SSH_KEY_ID',
  'HETZNER_SNAPSHOT_ID',
] as const

const SSH_KEY_PATH_ENV = 'HETZNER_SSH_PRIVATE_KEY_PATH'
const SSH_KEY_INLINE_ENV = 'HETZNER_SSH_PRIVATE_KEY'

export function getEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export function validateCoreEnv(): void {
  for (const envName of requiredEnvVars) {
    getEnv(envName)
  }

  if (!process.env[SSH_KEY_PATH_ENV] && !process.env[SSH_KEY_INLINE_ENV]) {
    throw new Error(
      `Missing required environment variable: ${SSH_KEY_PATH_ENV} or ${SSH_KEY_INLINE_ENV}`,
    )
  }
}

export function getOptionalEnv(name: string): string | null {
  return process.env[name] ?? null
}

export function getNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) {
    return fallback
  }

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a number`)
  }

  return parsed
}
