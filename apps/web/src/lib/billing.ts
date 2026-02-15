import { createHmac, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import {
  auditLog,
  billingCustomer,
  billingSubscription,
  stripeWebhookEvent,
} from '@/db/schema'
import {
  getTopupPacks,
  grantMonthlyCredits,
  spendFromTopupPack,
} from '@/lib/credits'
import { env } from '@/lib/env'
import { createId } from '@/lib/ids'

interface StripeCustomerResponse {
  id: string
}

interface StripeCheckoutResponse {
  id: string
  url: string | null
}

interface StripeSubscriptionResponse {
  id: string
  status: string
  customer: string
  items: {
    data: Array<{
      price: {
        id: string
      }
    }>
  }
  current_period_end: number | null
  trial_end: number | null
  canceled_at: number | null
}

interface StripeEvent {
  id: string
  type: string
  data: {
    object: Record<string, unknown>
  }
}

interface CheckoutSessionObject {
  id: string | null
  customer: string | null
  subscription: string | null
  mode: string | null
  metadata: Record<string, string>
}

interface InvoiceObject {
  id: string | null
  customer: string | null
  subscription: string | null
}

const STRIPE_API_BASE_URL = 'https://api.stripe.com/v1'

function formEncode(payload: Record<string, string>): string {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(payload)) {
    body.set(key, value)
  }
  return body.toString()
}

async function stripeRequest<T>(
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  payload?: Record<string, string>,
): Promise<T> {
  const response = await fetch(`${STRIPE_API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: payload ? formEncode(payload) : undefined,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Stripe API error (${response.status}): ${errorText}`)
  }

  return (await response.json()) as T
}

async function ensureStripeCustomer(
  userId: string,
  email: string,
): Promise<string> {
  const existingCustomer = await db.query.billingCustomer.findFirst({
    where: eq(billingCustomer.userId, userId),
    columns: { id: true },
  })

  if (existingCustomer) {
    return existingCustomer.id
  }

  const customer = await stripeRequest<StripeCustomerResponse>(
    '/customers',
    'POST',
    {
      email,
      'metadata[user_id]': userId,
    },
  )

  await db.insert(billingCustomer).values({
    id: customer.id,
    userId,
    createdAt: new Date(),
  })

  return customer.id
}

async function getUserIdByCustomerId(
  customerId: string,
): Promise<string | null> {
  const customer = await db.query.billingCustomer.findFirst({
    where: eq(billingCustomer.id, customerId),
    columns: { userId: true },
  })

  return customer?.userId ?? null
}

export async function createCheckoutSession(
  userId: string,
  email: string,
): Promise<string> {
  const customerId = await ensureStripeCustomer(userId, email)

  const checkout = await stripeRequest<StripeCheckoutResponse>(
    '/checkout/sessions',
    'POST',
    {
      mode: 'subscription',
      customer: customerId,
      success_url: `${env.APP_URL}/setup?step=trial&checkout=success`,
      cancel_url: `${env.APP_URL}/setup?step=trial&checkout=cancelled`,
      'line_items[0][price]': env.STRIPE_PRICE_ID,
      'line_items[0][quantity]': '1',
      'line_items[1][price_data][currency]': 'eur',
      'line_items[1][price_data][product_data][name]': 'Trial activation',
      'line_items[1][price_data][unit_amount]': '100',
      'line_items[1][quantity]': '1',
      'subscription_data[trial_period_days]': '3',
      'metadata[user_id]': userId,
      'metadata[checkout_kind]': 'subscription',
    },
  )

  if (!checkout.url) {
    throw new Error('Stripe checkout did not return a URL')
  }

  return checkout.url
}

export async function createTopupCheckoutSession(
  userId: string,
  email: string,
  packId: string,
): Promise<string> {
  const customerId = await ensureStripeCustomer(userId, email)
  const pack = getTopupPacks().find((entry) => entry.id === packId)

  if (!pack) {
    throw new Error('Unknown top-up pack')
  }

  const checkout = await stripeRequest<StripeCheckoutResponse>(
    '/checkout/sessions',
    'POST',
    {
      mode: 'payment',
      customer: customerId,
      success_url: `${env.APP_URL}/?topup=success`,
      cancel_url: `${env.APP_URL}/?topup=cancelled`,
      'line_items[0][price]': pack.stripePriceId,
      'line_items[0][quantity]': '1',
      'metadata[user_id]': userId,
      'metadata[checkout_kind]': 'topup',
      'metadata[topup_pack_id]': pack.id,
    },
  )

  if (!checkout.url) {
    throw new Error('Stripe checkout did not return a URL')
  }

  return checkout.url
}

export async function createPortalSession(userId: string): Promise<string> {
  const customer = await db.query.billingCustomer.findFirst({
    where: eq(billingCustomer.userId, userId),
    columns: { id: true },
  })

  if (!customer) {
    throw new Error('No Stripe customer found for this user')
  }

  const portal = await stripeRequest<{ url: string }>(
    '/billing_portal/sessions',
    'POST',
    {
      customer: customer.id,
      return_url: `${env.APP_URL}/`,
    },
  )

  return portal.url
}

function parseStripeHeader(signatureHeader: string): {
  timestamp: string
  signature: string
} {
  const items = signatureHeader.split(',')
  const timestamp = items.find((item) => item.startsWith('t='))?.slice(2)
  const signature = items.find((item) => item.startsWith('v1='))?.slice(3)

  if (!timestamp || !signature) {
    throw new Error('Invalid Stripe signature header')
  }

  return { timestamp, signature }
}

const WEBHOOK_TOLERANCE_SECONDS = 300

export function verifyStripeWebhookSignature(
  payload: string,
  signatureHeader: string,
): void {
  const secret = env.STRIPE_WEBHOOK_SECRET
  const { timestamp, signature } = parseStripeHeader(signatureHeader)

  const timestampSeconds = Number(timestamp)

  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(Date.now() / 1000 - timestampSeconds) > WEBHOOK_TOLERANCE_SECONDS
  ) {
    throw new Error('Stripe webhook timestamp too old')
  }

  const signedPayload = `${timestamp}.${payload}`
  const digest = createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex')

  const expected = Buffer.from(digest, 'utf8')
  const provided = Buffer.from(signature, 'utf8')

  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    throw new Error('Invalid Stripe webhook signature')
  }
}

async function saveSubscription(
  userId: string,
  subscription: StripeSubscriptionResponse,
) {
  const customer = await db.query.billingCustomer.findFirst({
    where: eq(billingCustomer.id, subscription.customer),
    columns: { id: true },
  })

  if (!customer) {
    await db.insert(billingCustomer).values({
      id: subscription.customer,
      userId,
      createdAt: new Date(),
    })
  }

  await db
    .insert(billingSubscription)
    .values({
      id: subscription.id,
      userId,
      customerId: subscription.customer,
      stripePriceId: subscription.items.data[0]?.price.id ?? null,
      status: subscription.status,
      currentPeriodEnd: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : null,
      trialEndsAt: subscription.trial_end
        ? new Date(subscription.trial_end * 1000)
        : null,
      canceledAt: subscription.canceled_at
        ? new Date(subscription.canceled_at * 1000)
        : null,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: billingSubscription.userId,
      set: {
        id: subscription.id,
        customerId: subscription.customer,
        stripePriceId: subscription.items.data[0]?.price.id ?? null,
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000)
          : null,
        trialEndsAt: subscription.trial_end
          ? new Date(subscription.trial_end * 1000)
          : null,
        canceledAt: subscription.canceled_at
          ? new Date(subscription.canceled_at * 1000)
          : null,
        updatedAt: new Date(),
      },
    })
}

async function retrieveSubscription(
  subscriptionId: string,
): Promise<StripeSubscriptionResponse> {
  return stripeRequest<StripeSubscriptionResponse>(
    `/subscriptions/${subscriptionId}`,
    'GET',
  )
}

function readCheckoutSession(
  object: Record<string, unknown>,
): CheckoutSessionObject {
  const metadataRaw = object.metadata
  const metadata =
    metadataRaw && typeof metadataRaw === 'object'
      ? Object.entries(metadataRaw).reduce<Record<string, string>>(
          (acc, [key, value]) => {
            if (typeof value === 'string') {
              acc[key] = value
            }
            return acc
          },
          {},
        )
      : {}

  return {
    id: typeof object.id === 'string' ? object.id : null,
    customer: typeof object.customer === 'string' ? object.customer : null,
    subscription:
      typeof object.subscription === 'string' ? object.subscription : null,
    mode: typeof object.mode === 'string' ? object.mode : null,
    metadata,
  }
}

function readInvoice(object: Record<string, unknown>): InvoiceObject {
  return {
    id: typeof object.id === 'string' ? object.id : null,
    customer: typeof object.customer === 'string' ? object.customer : null,
    subscription:
      typeof object.subscription === 'string' ? object.subscription : null,
  }
}

function readSubscriptionEvent(obj: Record<string, unknown>) {
  return {
    id: obj.id as string,
    customer: obj.customer as string,
    trial_end: obj.trial_end as number | null,
  }
}

function readDispute(obj: Record<string, unknown>) {
  return {
    id: obj.id as string,
    charge: obj.charge as string,
    customer: typeof obj.customer === 'string' ? obj.customer : null,
    amount: obj.amount as number,
    reason: obj.reason as string | null,
  }
}

async function cancelSubscription(subscriptionId: string): Promise<void> {
  await stripeRequest(`/subscriptions/${subscriptionId}`, 'DELETE')
}

async function markStripeEventProcessed(event: StripeEvent): Promise<boolean> {
  const existingEvent = await db.query.stripeWebhookEvent.findFirst({
    where: eq(stripeWebhookEvent.id, event.id),
    columns: { id: true },
  })

  if (existingEvent) {
    return false
  }

  await db.insert(stripeWebhookEvent).values({
    id: event.id,
    eventType: event.type,
    processedAt: new Date(),
  })

  return true
}

export async function processStripeEvent(event: StripeEvent): Promise<void> {
  const shouldProcess = await markStripeEventProcessed(event)
  if (!shouldProcess) {
    return
  }

  if (event.type === 'checkout.session.completed') {
    const checkoutSession = readCheckoutSession(event.data.object)

    if (checkoutSession.metadata.checkout_kind === 'topup') {
      const userId = checkoutSession.metadata.user_id
      const packId = checkoutSession.metadata.topup_pack_id

      if (userId && packId) {
        await spendFromTopupPack(userId, packId, {
          checkoutSessionId: checkoutSession.id,
          customerId: checkoutSession.customer,
        })
      }
    }

    if (checkoutSession.mode === 'subscription') {
      if (!checkoutSession.subscription || !checkoutSession.customer) {
        return
      }

      const userId = await getUserIdByCustomerId(checkoutSession.customer)
      if (!userId) {
        return
      }

      const subscription = await retrieveSubscription(
        checkoutSession.subscription,
      )
      await saveSubscription(userId, subscription)
    }
  }

  if (event.type === 'customer.subscription.created') {
    const sub = readSubscriptionEvent(event.data.object)
    const userId = await getUserIdByCustomerId(sub.customer)
    if (userId) {
      const fullSub = await retrieveSubscription(sub.id)
      await saveSubscription(userId, fullSub)
    }
  }

  if (
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const subscription = event.data
      .object as unknown as StripeSubscriptionResponse
    const userId = await getUserIdByCustomerId(subscription.customer)

    if (userId) {
      await saveSubscription(userId, subscription)
    }
  }

  if (event.type === 'invoice.payment_succeeded') {
    const invoice = readInvoice(event.data.object)
    if (invoice.customer) {
      const userId = await getUserIdByCustomerId(invoice.customer)
      if (userId) {
        await grantMonthlyCredits(userId, {
          invoiceId: invoice.id,
          subscriptionId: invoice.subscription,
        })
      }
    }
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = readInvoice(event.data.object)
    if (invoice.customer && invoice.subscription) {
      const userId = await getUserIdByCustomerId(invoice.customer)
      if (userId) {
        const subscription = await retrieveSubscription(invoice.subscription)
        await saveSubscription(userId, subscription)
      }
    }
  }

  if (event.type === 'customer.subscription.trial_will_end') {
    const sub = readSubscriptionEvent(event.data.object)
    const userId = await getUserIdByCustomerId(sub.customer)
    if (userId) {
      await db.insert(auditLog).values({
        id: createId(),
        userId,
        action: 'subscription.trial_will_end',
        metadata: JSON.stringify({
          subscriptionId: sub.id,
          trialEnd: sub.trial_end,
        }),
        createdAt: new Date(),
      })
    }
  }

  if (event.type === 'invoice.finalization_failed') {
    const invoice = readInvoice(event.data.object)
    if (invoice.customer) {
      const userId = await getUserIdByCustomerId(invoice.customer)
      if (userId) {
        await db.insert(auditLog).values({
          id: createId(),
          userId,
          action: 'invoice.finalization_failed',
          metadata: JSON.stringify({
            invoiceId: invoice.id,
            subscriptionId: invoice.subscription,
          }),
          createdAt: new Date(),
        })
      }
    }
  }

  if (event.type === 'charge.dispute.created') {
    const dispute = readDispute(event.data.object)
    if (dispute.customer) {
      const userId = await getUserIdByCustomerId(dispute.customer)
      if (userId) {
        const sub = await db.query.billingSubscription.findFirst({
          where: eq(billingSubscription.userId, userId),
          columns: { id: true, status: true },
        })
        if (sub && sub.status !== 'canceled') {
          await cancelSubscription(sub.id)
        }
        await db.insert(auditLog).values({
          id: createId(),
          userId,
          action: 'charge.dispute.created',
          metadata: JSON.stringify({
            disputeId: dispute.id,
            chargeId: dispute.charge,
            amount: dispute.amount,
            reason: dispute.reason,
          }),
          createdAt: new Date(),
        })
      }
    }
  }

  if (event.type === 'charge.dispute.closed') {
    const dispute = readDispute(event.data.object)
    const disputeStatus = event.data.object.status as string
    if (dispute.customer) {
      const userId = await getUserIdByCustomerId(dispute.customer)
      if (userId) {
        await db.insert(auditLog).values({
          id: createId(),
          userId,
          action: 'charge.dispute.closed',
          metadata: JSON.stringify({
            disputeId: dispute.id,
            chargeId: dispute.charge,
            status: disputeStatus,
            amount: dispute.amount,
          }),
          createdAt: new Date(),
        })
      }
    }
  }

  if (event.type === 'radar.early_fraud_warning.created') {
    const warning = event.data.object
    await db.insert(auditLog).values({
      id: createId(),
      action: 'radar.early_fraud_warning.created',
      metadata: JSON.stringify({
        warningId: warning.id,
        chargeId: warning.charge,
        paymentIntent: warning.payment_intent,
        fraudType: warning.fraud_type,
      }),
      createdAt: new Date(),
    })
  }

  await db.insert(auditLog).values({
    id: createId(),
    action: 'stripe.webhook.processed',
    metadata: JSON.stringify({ eventId: event.id, eventType: event.type }),
    createdAt: new Date(),
  })
}
