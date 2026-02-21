import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db } from '@/db'
import { env } from '@/lib/env'

export const auth = betterAuth({
  baseURL: env.APP_URL,
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),
  trustedOrigins: [env.APP_URL],
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
  plugins: [tanstackStartCookies(), admin()],
})
