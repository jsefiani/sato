import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Sparkles } from 'lucide-react'
import {
  deriveStep,
  getAutoAdvanceStep,
  resolveCurrentStep,
} from './onboarding-utils'
import OnboardingProgress from './OnboardingProgress'
import WelcomeStep from './steps/WelcomeStep'
import TrialStep from './steps/TrialStep'
import LaunchStep from './steps/LaunchStep'
import TelegramStep from './steps/TelegramStep'
import type {
  DashboardState,
  OnboardingStep,
  TelegramState,
} from './onboarding-utils'
import { authClient } from '@/lib/auth-client'
import { useEventStream } from '@/lib/use-event-stream'

interface OnboardingWizardProps {
  urlStep: OnboardingStep
  onNavigate: (step: OnboardingStep | null) => void
}

export default function OnboardingWizard({
  urlStep,
  onNavigate,
}: OnboardingWizardProps) {
  const { data: session } = authClient.useSession()
  const queryClient = useQueryClient()

  // ── Queries ───────────────────────────────────────────

  const dashboardQuery = useQuery({
    queryKey: ['dashboard-status'],
    queryFn: async () => {
      const res = await fetch('/api/vps/status')
      if (!res.ok) throw new Error('Failed to load status')
      return res.json() as Promise<DashboardState>
    },
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data?.vps) return false
      const { status } = data.vps
      const ready = data.openClawReady
      if (status === 'provisioning' || status === 'bootstrapping') return 5000
      if (status === 'active' && ready === false) return 5000
      return false
    },
  })

  const state = dashboardQuery.data ?? null
  const hasFreshDashboardState =
    !dashboardQuery.data || dashboardQuery.isFetchedAfterMount
  const telegramSetup =
    state?.channelSetup.channels.find(
      (channel) => channel.channel === 'telegram',
    ) ?? null
  const telegramApproved =
    hasFreshDashboardState && telegramSetup?.setupState === 'connected'

  const isAssistantLive =
    state?.vps?.status === 'active' && state.openClawReady === true

  const telegramStatusKey = [
    'telegram-status',
    state?.vps?.ipv4Address,
  ] as const

  useEventStream({
    url: '/api/vps/telegram/stream',
    enabled: isAssistantLive,
    queryKey: telegramStatusKey,
  })

  const telegramState =
    useQuery<TelegramState>({ queryKey: telegramStatusKey, enabled: false })
      .data ?? null

  // ── Step management ───────────────────────────────────

  const derivedStep = state ? deriveStep(state, telegramState) : urlStep
  const autoAdvanceStep = getAutoAdvanceStep(urlStep, derivedStep)
  const currentStep =
    autoAdvanceStep ?? resolveCurrentStep(urlStep, derivedStep)

  useEffect(() => {
    if (!autoAdvanceStep) {
      return
    }

    onNavigate(autoAdvanceStep)
  }, [autoAdvanceStep, onNavigate])

  // ── Mutations ─────────────────────────────────────────

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
      queryClient.removeQueries({
        queryKey: ['telegram-status'],
      })
      queryClient.removeQueries({
        queryKey: ['dashboard-status'],
      })
    },
  })

  const [stripeLoading, setStripeLoading] = useState(false)

  const handleProvision = useCallback(() => {
    provisionMutation.mutate()
  }, [provisionMutation.mutate])

  const openCheckout = useCallback(async () => {
    setStripeLoading(true)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
      })
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
      queryClient.invalidateQueries({
        queryKey: ['dashboard-status'],
      })
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
      queryClient.invalidateQueries({
        queryKey: ['dashboard-status'],
      })
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

  // ── Navigation callbacks ──────────────────────────────

  const handleWelcomeContinue = useCallback(() => {
    if (!state?.access.hasAccess) {
      onNavigate('trial')
      return
    }
    const vps = state.vps
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
  }, [state, handleProvision, onNavigate])

  // ── Loading state ─────────────────────────────────────

  const userName = session?.user.name || 'there'
  const userImage =
    (session?.user as { image?: string } | undefined)?.image ?? null

  if (!state && currentStep !== 'welcome') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.04]">
          <Sparkles className="h-7 w-7 text-white/80" />
        </div>
        <h1 className="mt-6 text-2xl font-light tracking-tight text-white">
          Setting things up…
        </h1>
        <p className="mt-2 text-sm text-zinc-500">Preparing your assistant…</p>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────

  return (
    <div className="flex flex-1 flex-col px-4 py-12">
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-md">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
            >
              {currentStep === 'welcome' && (
                <WelcomeStep
                  userName={userName}
                  userImage={userImage}
                  onContinue={handleWelcomeContinue}
                />
              )}

              {currentStep === 'trial' && state && (
                <TrialStep
                  access={state.access}
                  onContinue={() => onNavigate('launch')}
                  onSubscribe={openCheckout}
                  loading={stripeLoading}
                />
              )}

              {currentStep === 'launch' && state && (
                <LaunchStep
                  state={state}
                  onProvision={handleProvision}
                  provisioning={provisionMutation.isPending}
                  provisionError={provisionMutation.error?.message ?? null}
                  launchIssue={
                    state.vpsFailureReason ?? state.bootstrappingError ?? null
                  }
                />
              )}

              {currentStep === 'telegram' && (
                <TelegramStep
                  telegramState={telegramState}
                  approved={telegramApproved}
                  onConnectToken={handleConnectToken}
                  connectingToken={connectTelegramMutation.isPending}
                  connectError={connectTelegramMutation.error?.message ?? null}
                  onApprovePairing={handleApprovePairing}
                  approvingPairing={approvePairingMutation.isPending}
                  approveError={approvePairingMutation.error?.message ?? null}
                  onContinue={() => onNavigate(null)}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {currentStep !== 'welcome' && (
        <div className="flex justify-center pb-4">
          <OnboardingProgress currentStep={currentStep} />
        </div>
      )}
    </div>
  )
}
