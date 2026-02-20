import { z } from 'zod'
import {
  DEFAULT_MONTHLY_INCLUDED_CREDITS,
  DEFAULT_TRIAL_INCLUDED_CREDITS,
} from '@/lib/credit-policy'

const envSchema = z.object({
  APP_URL: z.string().min(1),
  APP_ENCRYPTION_KEY: z.string().min(1),
  OPENCLAW_GATEWAY_TOKEN_SECRET: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.string().default('true'),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  OPENROUTER_PROVISIONING_KEY: z.string().min(1),
  OPENROUTER_CREDIT_SYNC_MIN_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(0)
    .default(30_000),

  HETZNER_API_TOKEN: z.string().min(1),
  HETZNER_SSH_KEY_ID: z.string().min(1).optional(),
  HETZNER_SNAPSHOT_ID: z.string().min(1),
  HETZNER_DEBUG_ALLOW_PUBLIC_SSH: z.enum(['true', 'false']).default('false'),
  HETZNER_DEBUG_SSH_SOURCE_IPS: z.string().min(1).default('0.0.0.0/0,::/0'),

  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_PRICE_ID: z.string().min(1),
  STRIPE_TOPUP_PACK_10_PRICE_ID: z.string().min(1),
  STRIPE_TOPUP_PACK_25_PRICE_ID: z.string().min(1),
  STRIPE_TOPUP_PACK_50_PRICE_ID: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),

  TAILSCALE_API_KEY: z.string().min(1),

  VPS_SSH_USER: z.string().default('root'),
  VPS_SSH_PORT: z.coerce.number().int().min(1).default(22),

  TRIAL_INCLUDED_CREDITS: z.coerce
    .number()
    .int()
    .min(0)
    .default(DEFAULT_TRIAL_INCLUDED_CREDITS),
  MONTHLY_INCLUDED_CREDITS: z.coerce
    .number()
    .int()
    .min(0)
    .default(DEFAULT_MONTHLY_INCLUDED_CREDITS),
})

type Env = z.infer<typeof envSchema>

function createEnv(): Env {
  const result = envSchema.safeParse(process.env)

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid environment variables:\n${formatted}`)
  }

  return result.data
}

export const env = createEnv()
