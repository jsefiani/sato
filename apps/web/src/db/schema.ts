import { relations } from 'drizzle-orm'
import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: text('role').notNull().default('user'),
  banned: boolean('banned').notNull().default(false),
  banReason: text('ban_reason'),
  banExpires: integer('ban_expires'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const billingCustomer = pgTable('billing_customer', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const billingSubscription = pgTable('billing_subscription', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  customerId: text('customer_id')
    .notNull()
    .references(() => billingCustomer.id, { onDelete: 'cascade' }),
  stripePriceId: text('stripe_price_id'),
  status: text('status').notNull(),
  currentPeriodEnd: timestamp('current_period_end'),
  trialEndsAt: timestamp('trial_ends_at'),
  canceledAt: timestamp('canceled_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const userOpenRouterKey = pgTable('user_openrouter_key', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  keyHash: text('key_hash').notNull().unique(),
  keyEncrypted: text('key_encrypted').notNull(),
  lastKnownUsageUsd: text('last_known_usage_usd').notNull().default('0'),
  usageRemainderUsd: text('usage_remainder_usd').notNull().default('0'),
  lastSyncedAt: timestamp('last_synced_at'),
  disabledAt: timestamp('disabled_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const creditWallet = pgTable('credit_wallet', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  trialCreditsRemaining: integer('trial_credits_remaining')
    .notNull()
    .default(0),
  monthlyCreditsRemaining: integer('monthly_credits_remaining')
    .notNull()
    .default(0),
  purchasedCreditsRemaining: integer('purchased_credits_remaining')
    .notNull()
    .default(0),
  monthlyCreditsGrant: integer('monthly_credits_grant').notNull().default(0),
  monthlyCycleAnchor: timestamp('monthly_cycle_anchor'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const creditLedger = pgTable('credit_ledger', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  amount: integer('amount').notNull(),
  metadata: text('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const stripeWebhookEvent = pgTable('stripe_webhook_event', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  processedAt: timestamp('processed_at').notNull().defaultNow(),
})

export const vpsInstance = pgTable('vps_instance', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  hetznerServerId: text('hetzner_server_id').unique(),
  hetznerFirewallId: text('hetzner_firewall_id'),
  region: text('region').notNull().default('nbg1'),
  serverType: text('server_type').notNull().default('cpx22'),
  ipv4Address: text('ipv4_address'),
  tailscaleIp: text('tailscale_ip'),
  tailscaleHostname: text('tailscale_hostname'),
  status: text('status').notNull().default('pending'),
  openclawVersion: text('openclaw_version'),
  snapshotVersion: text('snapshot_version'),
  lastUpdatedAt: timestamp('last_updated_at'),
  provisionedAt: timestamp('provisioned_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const channelConnection = pgTable(
  'channel_connection',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    setupState: text('setup_state').notNull().default('disconnected'),
    connectedAt: timestamp('connected_at'),
    externalAccountId: text('external_account_id'),
    displayName: text('display_name'),
    healthStatus: text('health_status').notNull().default('unknown'),
    lastCheckedAt: timestamp('last_checked_at'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userChannelUnique: uniqueIndex('channel_connection_user_channel_idx').on(
      table.userId,
      table.channel,
    ),
  }),
)

export const provisioningJob = pgTable('provisioning_job', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  status: text('status').notNull(),
  requestId: text('request_id').notNull().unique(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  metadata: text('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ── Relations ────────────────────────────────────────────────

export const userRelations = relations(user, ({ many, one }) => ({
  sessions: many(session),
  accounts: many(account),
  billingCustomer: one(billingCustomer),
  billingSubscription: one(billingSubscription),
  openRouterKey: one(userOpenRouterKey),
  creditWallet: one(creditWallet),
  creditLedgerEntries: many(creditLedger),
  vpsInstance: one(vpsInstance),
  channelConnections: many(channelConnection),
  provisioningJobs: many(provisioningJob),
  auditLogs: many(auditLog),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}))

export const billingCustomerRelations = relations(
  billingCustomer,
  ({ one }) => ({
    user: one(user, {
      fields: [billingCustomer.userId],
      references: [user.id],
    }),
  }),
)

export const billingSubscriptionRelations = relations(
  billingSubscription,
  ({ one }) => ({
    user: one(user, {
      fields: [billingSubscription.userId],
      references: [user.id],
    }),
    customer: one(billingCustomer, {
      fields: [billingSubscription.customerId],
      references: [billingCustomer.id],
    }),
  }),
)

export const userOpenRouterKeyRelations = relations(
  userOpenRouterKey,
  ({ one }) => ({
    user: one(user, {
      fields: [userOpenRouterKey.userId],
      references: [user.id],
    }),
  }),
)

export const creditWalletRelations = relations(creditWallet, ({ one }) => ({
  user: one(user, { fields: [creditWallet.userId], references: [user.id] }),
}))

export const creditLedgerRelations = relations(creditLedger, ({ one }) => ({
  user: one(user, { fields: [creditLedger.userId], references: [user.id] }),
}))

export const vpsInstanceRelations = relations(vpsInstance, ({ one }) => ({
  user: one(user, { fields: [vpsInstance.userId], references: [user.id] }),
}))

export const channelConnectionRelations = relations(
  channelConnection,
  ({ one }) => ({
    user: one(user, {
      fields: [channelConnection.userId],
      references: [user.id],
    }),
  }),
)

export const provisioningJobRelations = relations(
  provisioningJob,
  ({ one }) => ({
    user: one(user, {
      fields: [provisioningJob.userId],
      references: [user.id],
    }),
  }),
)

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(user, { fields: [auditLog.userId], references: [user.id] }),
}))
