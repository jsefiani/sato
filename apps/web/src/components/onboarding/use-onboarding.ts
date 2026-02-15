import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  deriveStep,
  getAutoAdvanceStep,
  resolveCurrentStep,
} from './onboarding-utils'
import type {
  OnboardingStep,
  SetupState,
  TelegramState,
} from './onboarding-utils'
import { authClient } from '@/lib/auth-client'
import { useEventStream } from '@/lib/use-event-stream'

export interface OnboardingContextValue {
  setupState: SetupState | null
  currentStep: OnboardingStep
  onNavigate: (step: OnboardingStep | null) => void
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
}

export function useOnboarding({
  urlStep,
  onNavigate,
}: {
  urlStep: OnboardingStep
  onNavigate: (step: OnboardingStep | null) => void
}): OnboardingContextValue {
  const { data: session } = authClient.useSession()
  const queryClient = useQueryClient()

  const setupQuery = useQuery({
    queryKey: ['setup-status'],
    queryFn: async () => {
      const res = await fetch('/api/vps/status')
      if (!res.ok) throw new Error('Failed to load status')
      return res.json() as Promise<SetupState>
    },
  })

  const setupState = setupQuery.data ?? null

  const needsStatusStream =
    !!setupState?.vps &&
    (setupState.vps.status === 'provisioning' ||
      setupState.vps.status === 'bootstrapping' ||
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
    setupState?.vps?.status === 'active' && setupState.openClawReady === true

  const telegramStatusKey = [
    'telegram-status',
    setupState?.vps?.ipv4Address,
  ] as const

  useEventStream({
    url: '/api/vps/telegram/stream',
    enabled: isAssistantLive,
    queryKey: telegramStatusKey,
  })

  const telegramState =
    useQuery<TelegramState>({ queryKey: telegramStatusKey, enabled: false })
      .data ?? null

  const derivedStep = setupState
    ? deriveStep(setupState, telegramState)
    : urlStep
  const autoAdvanceStep = getAutoAdvanceStep(urlStep, derivedStep)
  const currentStep =
    autoAdvanceStep ?? resolveCurrentStep(urlStep, derivedStep)

  useEffect(() => {
    if (!autoAdvanceStep) return
    onNavigate(autoAdvanceStep)
  }, [autoAdvanceStep, onNavigate])

  const provisionMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/vps/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          region: 'nbg1',
          serverType: 'cpx22',
        }),
      })
      const payload = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(payload.error ?? 'Provisioning failed')
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['telegram-status'] })
      queryClient.removeQueries({ queryKey: ['setup-status'] })
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

  const handleWelcomeContinue = useCallback(() => {
    if (!setupState?.access.hasAccess) {
      onNavigate('trial')
      return
    }
    const vps = setupState.vps
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
  }, [setupState, handleProvision, onNavigate])

  const userName = session?.user.name || 'there'
  const userImage =
    (session?.user as { image?: string } | undefined)?.image ?? null

  return {
    setupState,
    currentStep,
    onNavigate,
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
  }
}
