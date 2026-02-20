import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { creditLedger, creditWallet, userOpenRouterKey } from '@/db/schema'
import {
  CREDITS_PER_USD,
  TOPUP_PACK_CREDITS,
  creditsToUsd,
  roundToUsd,
} from '@/lib/credit-policy'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import { env } from '@/lib/env'
import { createId } from '@/lib/ids'
import {
  createOpenRouterKey,
  deleteOpenRouterKey,
  getOpenRouterKey,
  updateOpenRouterKey,
} from '@/lib/openrouter'

const CREDIT_SYNC_MIN_INTERVAL_MS = env.OPENROUTER_CREDIT_SYNC_MIN_INTERVAL_MS

const inFlightCreditSyncByUserId = new Map<string, Promise<void>>()

export interface UserCreditState {
  trialCreditsRemaining: number
  monthlyCreditsRemaining: number
  purchasedCreditsRemaining: number
  totalCreditsRemaining: number
  monthlyCreditsGrant: number
  monthlyCycleAnchor: string | null
}

export interface TopupPack {
  id: 'pack_10' | 'pack_25' | 'pack_50'
  label: string
  credits: number
  stripePriceId: string
}

function getTrialCreditGrant(): number {
  return env.TRIAL_INCLUDED_CREDITS
}

function getMonthlyCreditGrant(): number {
  return env.MONTHLY_INCLUDED_CREDITS
}

function shouldSyncCredits(lastSyncedAt: Date | null): boolean {
  if (!lastSyncedAt) {
    return true
  }

  return Date.now() - lastSyncedAt.getTime() >= CREDIT_SYNC_MIN_INTERVAL_MS
}

function getTotalCredits(wallet: {
  trialCreditsRemaining: number
  monthlyCreditsRemaining: number
  purchasedCreditsRemaining: number
}): number {
  return (
    wallet.trialCreditsRemaining +
    wallet.monthlyCreditsRemaining +
    wallet.purchasedCreditsRemaining
  )
}

function toState(wallet: {
  trialCreditsRemaining: number
  monthlyCreditsRemaining: number
  purchasedCreditsRemaining: number
  monthlyCreditsGrant: number
  monthlyCycleAnchor: Date | null
}): UserCreditState {
  return {
    trialCreditsRemaining: wallet.trialCreditsRemaining,
    monthlyCreditsRemaining: wallet.monthlyCreditsRemaining,
    purchasedCreditsRemaining: wallet.purchasedCreditsRemaining,
    totalCreditsRemaining: getTotalCredits(wallet),
    monthlyCreditsGrant: wallet.monthlyCreditsGrant,
    monthlyCycleAnchor: wallet.monthlyCycleAnchor
      ? wallet.monthlyCycleAnchor.toISOString()
      : null,
  }
}

function isOpenRouterNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('OpenRouter API error (404)')
}

export function getTopupPacks(): Array<TopupPack> {
  return [
    {
      id: 'pack_10',
      label: '$10 top-up - 4,000 credits',
      credits: TOPUP_PACK_CREDITS.pack_10,
      stripePriceId: env.STRIPE_TOPUP_PACK_10_PRICE_ID,
    },
    {
      id: 'pack_25',
      label: '$25 top-up - 10,000 credits',
      credits: TOPUP_PACK_CREDITS.pack_25,
      stripePriceId: env.STRIPE_TOPUP_PACK_25_PRICE_ID,
    },
    {
      id: 'pack_50',
      label: '$50 top-up - 22,000 credits',
      credits: TOPUP_PACK_CREDITS.pack_50,
      stripePriceId: env.STRIPE_TOPUP_PACK_50_PRICE_ID,
    },
  ]
}

function getTopupPackById(packId: string): TopupPack {
  const pack = getTopupPacks().find((entry) => entry.id === packId)
  if (!pack) {
    throw new Error('Unknown top-up pack')
  }
  return pack
}

async function ensureWallet(userId: string) {
  const existingWallet = await db.query.creditWallet.findFirst({
    where: eq(creditWallet.userId, userId),
    columns: {
      id: true,
      userId: true,
      trialCreditsRemaining: true,
      monthlyCreditsRemaining: true,
      purchasedCreditsRemaining: true,
      monthlyCreditsGrant: true,
      monthlyCycleAnchor: true,
    },
  })

  if (existingWallet) return existingWallet

  const walletId = createId()
  const trialGrant = getTrialCreditGrant()
  const monthlyGrant = getMonthlyCreditGrant()

  await db.insert(creditWallet).values({
    id: walletId,
    userId,
    trialCreditsRemaining: trialGrant,
    monthlyCreditsRemaining: 0,
    purchasedCreditsRemaining: 0,
    monthlyCreditsGrant: monthlyGrant,
    createdAt: new Date(),
  })

  if (trialGrant > 0) {
    await db.insert(creditLedger).values({
      id: createId(),
      userId,
      kind: 'trial_grant',
      amount: trialGrant,
      metadata: JSON.stringify({ reason: 'initial_trial' }),
      createdAt: new Date(),
    })
  }

  return {
    id: walletId,
    userId,
    trialCreditsRemaining: trialGrant,
    monthlyCreditsRemaining: 0,
    purchasedCreditsRemaining: 0,
    monthlyCreditsGrant: monthlyGrant,
    monthlyCycleAnchor: null,
  }
}

async function refreshWallet(userId: string) {
  const wallet = await db.query.creditWallet.findFirst({
    where: eq(creditWallet.userId, userId),
    columns: {
      id: true,
      userId: true,
      trialCreditsRemaining: true,
      monthlyCreditsRemaining: true,
      purchasedCreditsRemaining: true,
      monthlyCreditsGrant: true,
      monthlyCycleAnchor: true,
    },
  })

  if (!wallet) throw new Error('Credit wallet not found')

  return wallet
}

function consumeCredits(
  wallet: {
    trialCreditsRemaining: number
    monthlyCreditsRemaining: number
    purchasedCreditsRemaining: number
  },
  requested: number,
): {
  consumed: number
  trialCreditsRemaining: number
  monthlyCreditsRemaining: number
  purchasedCreditsRemaining: number
} {
  let remaining = Math.max(0, requested)
  let trial = wallet.trialCreditsRemaining
  let monthly = wallet.monthlyCreditsRemaining
  let purchased = wallet.purchasedCreditsRemaining

  if (remaining > 0) {
    const fromTrial = Math.min(trial, remaining)
    trial -= fromTrial
    remaining -= fromTrial
  }

  if (remaining > 0) {
    const fromMonthly = Math.min(monthly, remaining)
    monthly -= fromMonthly
    remaining -= fromMonthly
  }

  if (remaining > 0) {
    const fromPurchased = Math.min(purchased, remaining)
    purchased -= fromPurchased
    remaining -= fromPurchased
  }

  return {
    consumed: requested - remaining,
    trialCreditsRemaining: trial,
    monthlyCreditsRemaining: monthly,
    purchasedCreditsRemaining: purchased,
  }
}

async function ensureUserOpenRouterKeyRecord(
  userId: string,
): Promise<{ keyHash: string; apiKey: string }> {
  const wallet = await ensureWallet(userId)

  const existingKey = await db.query.userOpenRouterKey.findFirst({
    where: eq(userOpenRouterKey.userId, userId),
    columns: {
      keyHash: true,
      keyEncrypted: true,
      disabledAt: true,
    },
  })

  if (existingKey) {
    return {
      keyHash: existingKey.keyHash,
      apiKey: decryptSecret(existingKey.keyEncrypted),
    }
  }

  const totalRemainingCredits = getTotalCredits(wallet)
  const key = await createOpenRouterKey({
    name: `Sato user ${userId}`,
    limitUsd: creditsToUsd(totalRemainingCredits),
  })

  await db.insert(userOpenRouterKey).values({
    id: createId(),
    userId,
    keyHash: key.hash,
    keyEncrypted: encryptSecret(key.key),
    lastKnownUsageUsd: String(key.usageUsd),
    usageRemainderUsd: '0',
    createdAt: new Date(),
  })

  return {
    keyHash: key.hash,
    apiKey: key.key,
  }
}

async function updateOpenRouterLimitFromWallet(userId: string): Promise<void> {
  const wallet = await refreshWallet(userId)
  const keyRow = await db.query.userOpenRouterKey.findFirst({
    where: eq(userOpenRouterKey.userId, userId),
    columns: {
      keyHash: true,
      lastKnownUsageUsd: true,
    },
  })

  if (!keyRow) return

  const usageUsd = Number(keyRow.lastKnownUsageUsd)
  const remainingUsd = creditsToUsd(getTotalCredits(wallet))

  await updateOpenRouterKey(keyRow.keyHash, {
    limitUsd: roundToUsd(usageUsd + remainingUsd),
    disabled: false,
  })
}

export async function ensureUserOpenRouterApiKey(
  userId: string,
): Promise<string> {
  const record = await ensureUserOpenRouterKeyRecord(userId)
  await syncUserCreditsWithOpenRouter(userId)
  return record.apiKey
}

export async function deleteUserOpenRouterKey(userId: string): Promise<void> {
  const keyRow = await db.query.userOpenRouterKey.findFirst({
    where: eq(userOpenRouterKey.userId, userId),
    columns: {
      keyHash: true,
    },
  })

  if (!keyRow) {
    return
  }

  try {
    await deleteOpenRouterKey(keyRow.keyHash)
  } catch (error) {
    if (!isOpenRouterNotFoundError(error)) {
      throw error
    }
  }

  await db.delete(userOpenRouterKey).where(eq(userOpenRouterKey.userId, userId))
}

export async function syncUserCreditsWithOpenRouter(
  userId: string,
): Promise<UserCreditState> {
  await ensureWallet(userId)

  const keyRow = await db.query.userOpenRouterKey.findFirst({
    where: eq(userOpenRouterKey.userId, userId),
    columns: {
      keyHash: true,
      lastKnownUsageUsd: true,
      usageRemainderUsd: true,
    },
  })

  if (!keyRow) {
    const wallet = await refreshWallet(userId)
    return toState(wallet)
  }

  const key = await getOpenRouterKey(keyRow.keyHash)
  const lastKnownUsageUsd = Number(keyRow.lastKnownUsageUsd)
  const usageRemainderUsd = Number(keyRow.usageRemainderUsd)
  const usageDeltaUsd = Math.max(0, key.usageUsd - lastKnownUsageUsd)
  const usageToAccountUsd = usageDeltaUsd + usageRemainderUsd
  const creditsToConsume = Math.floor(usageToAccountUsd * CREDITS_PER_USD)
  const newRemainderUsd = usageToAccountUsd - creditsToConsume / CREDITS_PER_USD

  const wallet = await refreshWallet(userId)
  let consumedCredits = 0

  if (creditsToConsume > 0) {
    const consumption = consumeCredits(wallet, creditsToConsume)
    consumedCredits = consumption.consumed

    await db
      .update(creditWallet)
      .set({
        trialCreditsRemaining: consumption.trialCreditsRemaining,
        monthlyCreditsRemaining: consumption.monthlyCreditsRemaining,
        purchasedCreditsRemaining: consumption.purchasedCreditsRemaining,
      })
      .where(eq(creditWallet.userId, userId))

    if (consumedCredits > 0) {
      await db.insert(creditLedger).values({
        id: createId(),
        userId,
        kind: 'usage',
        amount: -consumedCredits,
        metadata: JSON.stringify({
          keyHash: keyRow.keyHash,
          usageDeltaUsd,
        }),
        createdAt: new Date(),
      })
    }
  }

  await db
    .update(userOpenRouterKey)
    .set({
      lastKnownUsageUsd: String(key.usageUsd),
      usageRemainderUsd: String(newRemainderUsd),
      lastSyncedAt: new Date(),
    })
    .where(eq(userOpenRouterKey.userId, userId))

  const updatedWallet = await refreshWallet(userId)
  const remainingUsd = creditsToUsd(getTotalCredits(updatedWallet))

  await updateOpenRouterKey(keyRow.keyHash, {
    limitUsd: roundToUsd(key.usageUsd + remainingUsd),
    disabled: false,
  })

  return toState(updatedWallet)
}

async function syncUserCreditsWithOpenRouterIfStale(
  userId: string,
): Promise<void> {
  const keyRow = await db.query.userOpenRouterKey.findFirst({
    where: eq(userOpenRouterKey.userId, userId),
    columns: {
      lastSyncedAt: true,
    },
  })

  if (!keyRow) {
    return
  }

  if (!shouldSyncCredits(keyRow.lastSyncedAt)) {
    return
  }

  const existingSync = inFlightCreditSyncByUserId.get(userId)
  if (existingSync) {
    await existingSync
    return
  }

  const syncPromise = (async () => {
    await syncUserCreditsWithOpenRouter(userId)
  })()

  inFlightCreditSyncByUserId.set(userId, syncPromise)

  try {
    await syncPromise
  } finally {
    inFlightCreditSyncByUserId.delete(userId)
  }
}

export async function getUserCreditStateSnapshot(
  userId: string,
): Promise<UserCreditState> {
  const wallet = await ensureWallet(userId)
  return toState(wallet)
}

export function triggerUserCreditSyncIfStale(userId: string): void {
  void syncUserCreditsWithOpenRouterIfStale(userId).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(
      `Failed to sync OpenRouter credits for user ${userId}:`,
      message,
    )
  })
}

export async function getUserCreditState(
  userId: string,
): Promise<UserCreditState> {
  await ensureWallet(userId)
  return syncUserCreditsWithOpenRouter(userId)
}

export async function grantTopupCredits(
  userId: string,
  credits: number,
  metadata: Record<string, unknown>,
): Promise<UserCreditState> {
  if (credits <= 0) {
    throw new Error('Top-up credits must be greater than zero')
  }

  const wallet = await ensureWallet(userId)

  await db
    .update(creditWallet)
    .set({
      purchasedCreditsRemaining: wallet.purchasedCreditsRemaining + credits,
    })
    .where(eq(creditWallet.userId, userId))

  await db.insert(creditLedger).values({
    id: createId(),
    userId,
    kind: 'topup',
    amount: credits,
    metadata: JSON.stringify(metadata),
    createdAt: new Date(),
  })

  await updateOpenRouterLimitFromWallet(userId)
  return syncUserCreditsWithOpenRouter(userId)
}

export async function grantMonthlyCredits(
  userId: string,
  metadata: Record<string, unknown>,
): Promise<UserCreditState> {
  const wallet = await ensureWallet(userId)
  const now = new Date()

  await db
    .update(creditWallet)
    .set({
      monthlyCreditsRemaining: wallet.monthlyCreditsGrant,
      monthlyCycleAnchor: now,
    })
    .where(eq(creditWallet.userId, userId))

  await db.insert(creditLedger).values({
    id: createId(),
    userId,
    kind: 'monthly_grant',
    amount: wallet.monthlyCreditsGrant,
    metadata: JSON.stringify(metadata),
    createdAt: now,
  })

  await updateOpenRouterLimitFromWallet(userId)
  return syncUserCreditsWithOpenRouter(userId)
}

export async function spendFromTopupPack(
  userId: string,
  packId: string,
  metadata: Record<string, unknown>,
): Promise<UserCreditState> {
  const pack = getTopupPackById(packId)
  return grantTopupCredits(userId, pack.credits, {
    ...metadata,
    packId: pack.id,
    packLabel: pack.label,
  })
}
