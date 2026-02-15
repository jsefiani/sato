import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { billingSubscription } from '@/db/schema'

export type AccessStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'requires_payment'

export interface AccessState {
  status: AccessStatus
  hasAccess: boolean
  trialEndsAt: string | null
  trialDaysRemaining: number
  subscriptionStatus: string | null
}

export async function getUserAccessState(userId: string): Promise<AccessState> {
  const subscriptionRow = await db.query.billingSubscription.findFirst({
    where: eq(billingSubscription.userId, userId),
    columns: {
      status: true,
      trialEndsAt: true,
    },
  })

  if (
    subscriptionRow?.status === 'active' ||
    subscriptionRow?.status === 'trialing'
  ) {
    return {
      status: subscriptionRow.status,
      hasAccess: true,
      trialEndsAt: subscriptionRow.trialEndsAt
        ? subscriptionRow.trialEndsAt.toISOString()
        : null,
      trialDaysRemaining: getTrialDaysRemaining(subscriptionRow.trialEndsAt),
      subscriptionStatus: subscriptionRow.status,
    }
  }

  if (subscriptionRow?.status === 'past_due') {
    return {
      status: 'past_due',
      hasAccess: false,
      trialEndsAt: subscriptionRow.trialEndsAt
        ? subscriptionRow.trialEndsAt.toISOString()
        : null,
      trialDaysRemaining: getTrialDaysRemaining(subscriptionRow.trialEndsAt),
      subscriptionStatus: subscriptionRow.status,
    }
  }

  if (subscriptionRow?.status === 'canceled') {
    return {
      status: 'canceled',
      hasAccess: false,
      trialEndsAt: subscriptionRow.trialEndsAt
        ? subscriptionRow.trialEndsAt.toISOString()
        : null,
      trialDaysRemaining: 0,
      subscriptionStatus: subscriptionRow.status,
    }
  }

  return {
    status: 'requires_payment',
    hasAccess: false,
    trialDaysRemaining: 0,
    trialEndsAt: null,
    subscriptionStatus: null,
  }
}

function getTrialDaysRemaining(trialEndsAt: Date | null): number {
  if (!trialEndsAt) {
    return 0
  }

  const remainingMs = trialEndsAt.getTime() - Date.now()
  if (remainingMs <= 0) {
    return 0
  }

  return Math.ceil(remainingMs / (24 * 60 * 60 * 1000))
}
