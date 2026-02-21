import { useCallback, useEffect, useState } from 'react'
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  deriveStep,
  getAutoAdvanceStep,
  resolveCurrentStep,
} from './onboarding-utils'
import type {
  OnboardingStep,
  PersonalizationData,
  SetupState,
  TelegramState,
} from './onboarding-utils'
import { authClient } from '@/lib/auth-client'
import { useEventStream } from '@/lib/use-event-stream'

interface OnboardingBaseValue {
  setupState: SetupState | null
  currentStep: OnboardingStep
  onNavigate: (step: OnboardingStep | null) => void
  sessionPending: boolean
  userName: string
  userImage: string | null
  handleProvision: () => void
  provisionPending: boolean
  provisionError: string | null
  openCheckout: () => void
  stripeLoading: boolean
  telegramState: TelegramState | null
  telegramApproved: boolean
  handleConnectToken: (token: string) => void
  connectingToken: boolean
  connectError: string | null
  handleApprovePairing: (code: string) => void
  approvingPairing: boolean
  approveError: string | null
  handleWelcomeContinue: () => void
  handlePersonalizeContinue: (data: PersonalizationData) => void
  personalizeSaving: boolean
  isConfirmingPayment: boolean
  isCheckoutTimedOut: boolean
}

export type OnboardingContextValue = OnboardingBaseValue & {
  skipInitialAnimation: boolean
}

const CHECKOUT_POLL_INTERVAL = 2000
const CHECKOUT_POLL_TIMEOUT = 60_000

export function useOnboarding({
  urlStep,
  onNavigate,
  checkoutStatus,
}: {
  urlStep: OnboardingStep
  onNavigate: (step: OnboardingStep | null) => void
  checkoutStatus?: string
}): OnboardingBaseValue {
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const queryClient = useQueryClient()

  const [checkoutPollStart] = useState(() =>
    checkoutStatus === 'success' ? Date.now() : null,
  )

  const [isCheckoutTimedOut, setCheckoutTimedOut] = useState(false)

  useEffect(() => {
    if (!checkoutPollStart) return
    const remaining = CHECKOUT_POLL_TIMEOUT - (Date.now() - checkoutPollStart)
    if (remaining <= 0) {
      setCheckoutTimedOut(true)
      return
    }
    const timer = setTimeout(() => setCheckoutTimedOut(true), remaining)
    return () => clearTimeout(timer)
  }, [checkoutPollStart])

  const setupQuery = useQuery({
    queryKey: ['setup-status'],
    queryFn: async () => {
      const res = await fetch('/api/vps/status')
      if (!res.ok) throw new Error('Failed to load status')
      return res.json() as Promise<SetupState>
    },
    refetchInterval: (query) => {
      if (!checkoutPollStart) return false
      const data = query.state.data
      if (data?.access.hasAccess) return false
      if (Date.now() - checkoutPollStart > CHECKOUT_POLL_TIMEOUT) return false
      return CHECKOUT_POLL_INTERVAL
    },
  })

  const setupState = setupQuery.data ?? null

  const isConfirmingPayment =
    checkoutPollStart !== null &&
    !setupState?.access.hasAccess &&
    !isCheckoutTimedOut

  const needsStatusStream =
    !!setupState?.vps &&
    (setupState.vps.status === 'provisioning' ||
      setupState.vps.status === 'bootstrapping' ||
      setupState.gatewayState === 'restarting' ||
      (setupState.vps.status === 'active' &&
        setupState.openClawReady === false))

  useEventStream({
    url: '/api/vps/status-stream',
    enabled: needsStatusStream,
    queryKey: ['setup-status'],
    merge: true,
  })

  const hasFreshSetup = !setupQuery.data || setupQuery.isFetchedAfterMount
  const telegramSetup =
    setupState?.channelSetup.channels.find(
      (channel) => channel.channel === 'telegram',
    ) ?? null
  const telegramApproved =
    hasFreshSetup && telegramSetup?.setupState === 'connected'

  const isAssistantLive =
    setupState?.vps?.status === 'active' &&
    setupState.gatewayState !== 'restarting' &&
    setupState.openClawReady === true

  const telegramStatusKey = ['telegram-status'] as const

  useEventStream({
    url: '/api/vps/telegram/stream',
    enabled: isAssistantLive,
    queryKey: telegramStatusKey,
  })

  const telegramState =
    useQuery<TelegramState>({ queryKey: telegramStatusKey, queryFn: skipToken })
      .data ?? null

  const hasPersonalized = setupState?.hasPersonalized ?? false
  const derivedStep = setupState ? deriveStep(setupState) : 'welcome'
  const autoAdvanceStep = getAutoAdvanceStep(
    urlStep,
    derivedStep,
    hasPersonalized,
  )
  const currentStep =
    autoAdvanceStep ?? resolveCurrentStep(urlStep, derivedStep, hasPersonalized)

  useEffect(() => {
    if (!autoAdvanceStep) return
    onNavigate(autoAdvanceStep)
  }, [autoAdvanceStep, onNavigate])

  const provisionMutation = useMutation({
    mutationFn: async () => {
      const idempotencyKey =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const res = await fetch('/api/vps/provision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({}),
      })
      const payload = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(payload.error ?? 'Provisioning failed')
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['telegram-status'] })
      queryClient.invalidateQueries({ queryKey: ['setup-status'] })
    },
  })

  const [stripeLoading, setStripeLoading] = useState(false)

  const handleProvision = useCallback(() => {
    provisionMutation.mutate()
  }, [provisionMutation.mutate])

  const openCheckout = useCallback(async () => {
    setStripeLoading(true)
    try {
      const res = await fetch('/api/stripe/checkout', { method: 'POST' })
      const payload = (await res.json()) as {
        checkoutUrl?: string
        error?: string
      }
      if (!res.ok || !payload.checkoutUrl)
        throw new Error(payload.error ?? 'Unable to start checkout')
      window.location.href = payload.checkoutUrl
    } catch {
      setStripeLoading(false)
    }
  }, [])

  const connectTelegramMutation = useMutation({
    mutationFn: async (token: string) => {
      const res = await fetch('/api/vps/telegram/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const payload = (await res.json()) as TelegramState & {
        error?: string
      }
      if (!res.ok)
        throw new Error(payload.error ?? 'Failed to connect Telegram')
      return payload
    },
    onSuccess: (payload) => {
      queryClient.setQueryData(telegramStatusKey, payload)
      queryClient.invalidateQueries({ queryKey: ['setup-status'] })
    },
  })

  const approvePairingMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await fetch('/api/vps/telegram/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const payload = (await res.json()) as TelegramState & {
        error?: string
      }
      if (!res.ok) throw new Error(payload.error ?? 'Failed to approve pairing')
      return payload
    },
    onSuccess: (payload) => {
      queryClient.setQueryData(telegramStatusKey, payload)
      queryClient.invalidateQueries({ queryKey: ['setup-status'] })
    },
  })

  const handleConnectToken = useCallback(
    (token: string) => {
      connectTelegramMutation.mutate(token)
    },
    [connectTelegramMutation.mutate],
  )

  const handleApprovePairing = useCallback(
    (code: string) => {
      approvePairingMutation.mutate(code)
    },
    [approvePairingMutation.mutate],
  )

  const personalizeMutation = useMutation({
    mutationFn: async (data: PersonalizationData) => {
      const res = await fetch('/api/personalization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const payload = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(payload.error ?? 'Failed to save')
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['setup-status'] })
      const freshState = queryClient.getQueryData<SetupState>(['setup-status'])
      if (!freshState?.access.hasAccess) {
        onNavigate('trial')
        return
      }
      const vps = freshState.vps
      const needsProvision =
        !vps ||
        vps.status === 'pending' ||
        vps.status === 'failed' ||
        vps.status === 'terminated' ||
        vps.status === 'cleanup_pending'
      if (needsProvision) {
        handleProvision()
      }
      onNavigate('launch')
    },
  })

  const handlePersonalizeContinue = useCallback(
    (data: PersonalizationData) => {
      personalizeMutation.mutate(data)
    },
    [personalizeMutation.mutate],
  )

  const handleWelcomeContinue = useCallback(() => {
    onNavigate('personalize')
  }, [onNavigate])

  const userName = session?.user.name || 'there'
  const userImage =
    (session?.user as { image?: string } | undefined)?.image ?? null

  return {
    setupState,
    currentStep,
    onNavigate,
    sessionPending,
    userName,
    userImage,
    handleProvision,
    provisionPending: provisionMutation.isPending,
    provisionError: provisionMutation.error?.message ?? null,
    openCheckout,
    stripeLoading,
    telegramState,
    telegramApproved,
    handleConnectToken,
    connectingToken: connectTelegramMutation.isPending,
    connectError: connectTelegramMutation.error?.message ?? null,
    handleApprovePairing,
    approvingPairing: approvePairingMutation.isPending,
    approveError: approvePairingMutation.error?.message ?? null,
    handleWelcomeContinue,
    handlePersonalizeContinue,
    personalizeSaving: personalizeMutation.isPending,
    isConfirmingPayment,
    isCheckoutTimedOut,
  }
}
