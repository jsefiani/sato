import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { motion } from 'motion/react'
import {
  Activity,
  Brain,
  Check,
  ChevronDown,
  CreditCard,
  ExternalLink,
  Loader2,
  MessageCircle,
  MessageSquare,
  Settings,
  ShieldCheck,
  Terminal,
  Trash2,
} from 'lucide-react'
import {
  siAlibabacloud,
  siAnthropic,
  siGooglegemini,
  siMeta,
  siOpenrouter,
} from 'simple-icons'
import type {
  SetupState,
  TopupPack,
} from '@/components/onboarding/onboarding-utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { authClient } from '@/lib/auth-client'
import { DEFAULT_MODEL, SUPPORTED_MODELS } from '@/lib/models'
import { useEventStream } from '@/lib/use-event-stream'

interface VerifyState {
  checkedAt: string
  ok: boolean
  gateway: {
    loaded: boolean
    rpcOk: boolean
  }
  health: {
    ok: boolean
    durationMs: number | null
    channelsOk: number
    channelsFailed: number
  }
}

interface VpsLogs {
  bootstrapLog: string
  cloudInitStatus: string
}

function formatMessages(value: number): string {
  return new Intl.NumberFormat().format(value)
}

const modelBrandLogos = {
  'openrouter/anthropic/claude-sonnet-4': siAnthropic,
  'openrouter/anthropic/claude-3.5-haiku': siAnthropic,
  'openrouter/openai/gpt-4.1-mini': siOpenrouter,
  'openrouter/google/gemini-2.5-flash': siGooglegemini,
  'openrouter/moonshotai/kimi-k2.5': siOpenrouter,
  'openrouter/deepseek/deepseek-r1': siOpenrouter,
  'openrouter/qwen/qwen3-coder': siAlibabacloud,
  'openrouter/meta-llama/llama-3.3-70b-instruct': siMeta,
} as const

function resolveModelBrandLogo({ model }: { model: string }) {
  if (model in modelBrandLogos) {
    return modelBrandLogos[model as keyof typeof modelBrandLogos]
  }

  return siOpenrouter
}

function ModelBrandLogo({
  model,
  className,
}: {
  model: string
  className?: string
}) {
  const logo = resolveModelBrandLogo({ model })

  return (
    <svg
      viewBox="0 0 24 24"
      fill={`#${logo.hex}`}
      aria-hidden="true"
      className={['size-4 shrink-0', className].filter(Boolean).join(' ')}
    >
      <path d={logo.path} />
    </svg>
  )
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.08 },
  },
} as const

const item = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 260, damping: 22 },
  },
}

const MODEL_RESTART_WATCH_TIMEOUT_MS = 45_000
const MODEL_RESTART_QUERY_POLL_MS = 2_000

export default function Dashboard() {
  const { data: session } = authClient.useSession()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const setupQuery = useQuery({
    queryKey: ['setup-status'],
    queryFn: async () => {
      const res = await fetch('/api/vps/status')
      if (!res.ok) throw new Error('Failed to load status')
      return res.json() as Promise<SetupState>
    },
    refetchOnMount: false,
  })

  const state = setupQuery.data ?? null

  const [stripeLoading, setStripeLoading] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [isModelDialogOpen, setIsModelDialogOpen] = useState(false)
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const [isModelRestartWatchActive, setIsModelRestartWatchActive] =
    useState(false)
  const [hasSeenModelRestartDown, setHasSeenModelRestartDown] = useState(false)
  const [modelRestartWatchStartedAt, setModelRestartWatchStartedAt] = useState<
    number | null
  >(null)
  const [preferredModelOverride, setPreferredModelOverride] = useState<
    string | null
  >(null)
  const [pendingModelSelection, setPendingModelSelection] = useState<string>(
    DEFAULT_MODEL.value,
  )

  const openPortal = async () => {
    setStripeLoading(true)
    try {
      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
      })
      const payload = (await res.json()) as {
        portalUrl?: string
        error?: string
      }
      if (!res.ok || !payload.portalUrl)
        throw new Error(payload.error ?? 'Unable to open billing portal')
      window.location.href = payload.portalUrl
    } catch {
      setStripeLoading(false)
    }
  }

  const openTopupCheckout = async (packId: string) => {
    setStripeLoading(true)
    try {
      const res = await fetch('/api/stripe/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId }),
      })
      const payload = (await res.json()) as {
        checkoutUrl?: string
        error?: string
      }
      if (!res.ok || !payload.checkoutUrl)
        throw new Error(payload.error ?? 'Unable to start top-up checkout')
      window.location.href = payload.checkoutUrl
    } catch {
      setStripeLoading(false)
    }
  }

  const destroyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/vps/destroy', {
        method: 'POST',
      })
      const payload = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(payload.error ?? 'Failed to destroy server')
    },
    onSuccess: () => {
      queryClient.removeQueries({
        queryKey: ['setup-status'],
      })
    },
  })

  const modelMutation = useMutation({
    mutationFn: async ({
      modelLabel,
    }: {
      modelValue: string
      modelLabel: string
    }) => {
      const res = await fetch('/api/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelLabel }),
      })
      const payload = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(payload.error ?? 'Failed to update model')
    },
    onMutate: async ({ modelValue, modelLabel }) => {
      await queryClient.cancelQueries({ queryKey: ['setup-status'] })
      const previous = queryClient.getQueryData<SetupState>(['setup-status'])
      queryClient.setQueryData<SetupState>(['setup-status'], (old) =>
        old
          ? { ...old, preferredModel: modelLabel, openClawReady: false }
          : old,
      )
      setPreferredModelOverride(modelValue)
      setIsModelRestartWatchActive(true)
      setHasSeenModelRestartDown(false)
      setModelRestartWatchStartedAt(Date.now())
      return { previous }
    },
    onSuccess: () => {
      setIsModelDialogOpen(false)
    },
    onError: (_err, _vars, context) => {
      setPreferredModelOverride(null)
      setIsModelRestartWatchActive(false)
      setHasSeenModelRestartDown(false)
      setModelRestartWatchStartedAt(null)
      if (context?.previous) {
        queryClient.setQueryData(['setup-status'], context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['setup-status'] })
    },
  })

  const statePreferredModelValue =
    SUPPORTED_MODELS.find((model) => model.label === state?.preferredModel)
      ?.value ?? DEFAULT_MODEL.value
  const currentModel = preferredModelOverride ?? statePreferredModelValue
  const currentModelLabel =
    SUPPORTED_MODELS.find((m) => m.value === currentModel)?.label ??
    DEFAULT_MODEL.label
  const pendingModel =
    SUPPORTED_MODELS.find((m) => m.value === pendingModelSelection) ??
    DEFAULT_MODEL

  useEffect(() => {
    if (!preferredModelOverride) return
    if (statePreferredModelValue === preferredModelOverride) {
      setPreferredModelOverride(null)
    }
  }, [preferredModelOverride, statePreferredModelValue])

  useEffect(() => {
    if (!isModelDialogOpen || modelMutation.isPending) {
      setIsModelMenuOpen(false)
    }
  }, [isModelDialogOpen, modelMutation.isPending])

  useEffect(() => {
    if (!isModelRestartWatchActive) return

    if (state?.vps?.status !== 'active') {
      setIsModelRestartWatchActive(false)
      setHasSeenModelRestartDown(false)
      setModelRestartWatchStartedAt(null)
      return
    }

    if (!hasSeenModelRestartDown && state.openClawReady === false) {
      setHasSeenModelRestartDown(true)
      return
    }

    if (
      hasSeenModelRestartDown &&
      !modelMutation.isPending &&
      state.openClawReady === true
    ) {
      setIsModelRestartWatchActive(false)
      setHasSeenModelRestartDown(false)
      setModelRestartWatchStartedAt(null)
    }
  }, [
    hasSeenModelRestartDown,
    isModelRestartWatchActive,
    modelMutation.isPending,
    state?.openClawReady,
    state?.vps?.status,
  ])

  useEffect(() => {
    if (!isModelRestartWatchActive || !modelRestartWatchStartedAt) return

    const remainingMs =
      modelRestartWatchStartedAt + MODEL_RESTART_WATCH_TIMEOUT_MS - Date.now()

    if (remainingMs <= 0) {
      setIsModelRestartWatchActive(false)
      setHasSeenModelRestartDown(false)
      setModelRestartWatchStartedAt(null)
      return
    }

    const timeoutId = window.setTimeout(() => {
      setIsModelRestartWatchActive(false)
      setHasSeenModelRestartDown(false)
      setModelRestartWatchStartedAt(null)
    }, remainingMs)

    return () => window.clearTimeout(timeoutId)
  }, [isModelRestartWatchActive, modelRestartWatchStartedAt])

  useEffect(() => {
    if (!isModelRestartWatchActive) return

    const intervalId = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ['setup-status'] })
    }, MODEL_RESTART_QUERY_POLL_MS)

    return () => window.clearInterval(intervalId)
  }, [isModelRestartWatchActive, queryClient])

  const needsStatusStream =
    modelMutation.isPending ||
    isModelRestartWatchActive ||
    (!!state?.vps &&
      (state.vps.status === 'provisioning' ||
        state.vps.status === 'bootstrapping' ||
        (state.vps.status === 'active' && state.openClawReady === false)))

  useEventStream({
    url: '/api/vps/status-stream',
    enabled: needsStatusStream,
    queryKey: ['setup-status'],
    merge: true,
  })
  const telegramSetup =
    state?.channelSetup.channels.find(
      (channel) => channel.channel === 'telegram',
    ) ?? null
  const persistedTelegramBotUsername =
    telegramSetup?.displayName?.replace(/^@+/, '') ?? null

  const isAssistantLive =
    !modelMutation.isPending &&
    !isModelRestartWatchActive &&
    state?.vps?.status === 'active' &&
    state.openClawReady === true
  const canViewDebugLogs = import.meta.env.DEV
  const isAssistantRestarting =
    state?.vps?.status === 'active' &&
    (modelMutation.isPending ||
      isModelRestartWatchActive ||
      state.openClawReady === false)

  const telegramBotHandle = persistedTelegramBotUsername
    ? `@${persistedTelegramBotUsername}`
    : null
  const telegramConnected = telegramSetup?.connected === true
  const telegramConfigured =
    telegramConnected || telegramSetup?.setupState === 'configuring'

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/vps/verify')
      const payload = (await res.json()) as VerifyState & {
        error?: string
      }
      if (!res.ok) throw new Error(payload.error ?? 'Verification failed')
      return payload
    },
  })

  const logsQuery = useQuery({
    queryKey: ['vps-logs'],
    queryFn: async () => {
      const res = await fetch('/api/vps/logs')
      if (!res.ok) throw new Error('Failed to fetch logs')
      return res.json() as Promise<VpsLogs>
    },
    enabled: showLogs,
    refetchInterval: showLogs ? 10_000 : false,
  })

  const statusLabel = state?.vps
    ? ({
        provisioning: 'Setting up your server…',
        bootstrapping: 'Installing software…',
        failed: 'Setup failed',
        cleanup_pending: 'Being removed…',
        terminated: 'No server provisioned',
      }[state.vps.status] ?? state.vps.status)
    : 'No server provisioned'

  const canSetupAssistant =
    !state?.vps ||
    state.vps.status === 'pending' ||
    state.vps.status === 'failed' ||
    state.vps.status === 'terminated'

  const planLabel = useMemo(() => {
    if (!state) return 'Loading…'
    if (state.access.status === 'active') return 'Active plan'
    if (state.access.status === 'trialing') {
      const d = state.access.trialDaysRemaining
      return `Free trial — ${d} day${d === 1 ? '' : 's'} left`
    }
    return 'No active plan'
  }, [state])

  const totalMessages = state?.credits.totalCreditsRemaining ?? 0
  const maxMessages =
    (state?.credits.monthlyCreditsGrant ?? 0) +
    (state?.credits.purchasedCreditsRemaining ?? 0) +
    (state?.credits.trialCreditsRemaining ?? 0)
  const messagesPercent =
    maxMessages > 0 ? Math.min((totalMessages / maxMessages) * 100, 100) : 0

  const firstName = session?.user.name.split(' ')[0] ?? 'there'

  if (!state) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/80" />
      </div>
    )
  }

  if (!state.hasPersonalized) {
    navigate({ to: '/setup', search: { step: 'welcome' } })
    return null
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-8 text-foreground">
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="mx-auto w-full max-w-xl space-y-4"
      >
        <motion.div variants={item} className="pb-2">
          <h1 className="text-2xl font-light tracking-tight text-foreground">
            Hey, {firstName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground/80">
            Here's how your assistant is doing.
          </p>
        </motion.div>

        <motion.div variants={item}>
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                    isAssistantLive ? 'bg-foreground/4' : 'bg-secondary/80'
                  }`}
                >
                  <Activity
                    className={`h-4 w-4 ${isAssistantLive ? 'text-foreground/80' : 'text-muted-foreground/50'}`}
                  />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground/80">
                    {isAssistantLive
                      ? 'Your assistant is running'
                      : isAssistantRestarting
                        ? 'Assistant restarting'
                        : 'Assistant offline'}
                  </p>
                  <p className="text-[13px] text-muted-foreground/80">
                    {isAssistantLive
                      ? 'Everything looks good'
                      : isAssistantRestarting
                        ? 'Applying model change. This should take a few seconds.'
                        : statusLabel}
                  </p>
                </div>
              </div>
              <div className="flex items-center">
                {canSetupAssistant ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      navigate({ to: '/setup', search: { step: 'launch' } })
                    }
                  >
                    Set up again
                  </Button>
                ) : (
                  <div
                    className={`h-2.5 w-2.5 rounded-full ${
                      isAssistantLive
                        ? 'bg-foreground shadow-[0_0_8px_rgba(30,41,59,0.3)]'
                        : 'bg-secondary'
                    }`}
                  />
                )}
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div variants={item}>
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-foreground/4">
                  <Brain className="h-4 w-4 text-foreground/80" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground/80">
                    AI Model
                  </p>
                  <p className="text-[13px] text-muted-foreground/80">
                    {currentModelLabel}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={!isAssistantLive}
                onClick={() => {
                  modelMutation.reset()
                  setPendingModelSelection(currentModel)
                  setIsModelDialogOpen(true)
                }}
              >
                Change
              </Button>
            </div>
          </Card>
        </motion.div>

        <motion.div variants={item}>
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground/80">
                Messages remaining
              </p>
              <p className="text-lg font-semibold tabular-nums text-foreground">
                {formatMessages(totalMessages)}
              </p>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
              <motion.div
                className="h-full rounded-full bg-foreground"
                initial={{ width: 0 }}
                animate={{ width: `${messagesPercent}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            </div>
            <p className="mt-2.5 text-[12px] text-muted-foreground/80">
              {formatMessages(state.credits.trialCreditsRemaining)} trial ·{' '}
              {formatMessages(state.credits.monthlyCreditsRemaining)} monthly ·{' '}
              {formatMessages(state.credits.purchasedCreditsRemaining)} extra
            </p>
          </Card>
        </motion.div>

        <motion.div variants={item}>
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-foreground/4">
                  <MessageSquare className="h-4 w-4 text-foreground/80" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground/80">
                    Chat with assistant
                  </p>
                  <p className="text-[13px] text-muted-foreground/80">
                    {isAssistantLive
                      ? 'Open the web chat interface'
                      : 'Available when your assistant is running'}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={!isAssistantLive}
                onClick={() => navigate({ to: '/chat' })}
              >
                Open chat
              </Button>
            </div>
          </Card>
        </motion.div>

        <motion.div variants={item}>
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-foreground/4">
                  <MessageCircle className="h-4 w-4 text-foreground/80" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground/80">
                    Telegram
                  </p>
                  <p className="text-[13px] text-muted-foreground/80">
                    {telegramConnected
                      ? (telegramBotHandle ?? 'Connected')
                      : telegramConfigured
                        ? 'Configured, not connected'
                        : 'Not connected'}
                  </p>
                </div>
              </div>
              {isAssistantLive && !telegramConnected ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    navigate({ to: '/setup', search: { step: 'telegram' } })
                  }
                >
                  Connect Telegram
                </Button>
              ) : persistedTelegramBotUsername ? (
                <Button
                  variant="outline"
                  size="sm"
                  render={
                    <a
                      href={`https://t.me/${persistedTelegramBotUsername}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  Open chat <ExternalLink />
                </Button>
              ) : null}
            </div>
          </Card>
        </motion.div>

        <motion.div variants={item}>
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-foreground/4">
                  <CreditCard className="h-4 w-4 text-foreground/80" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground/80">
                    Plan & billing
                  </p>
                  <p className="text-[13px] text-muted-foreground/80">
                    {planLabel}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={openPortal}
                disabled={stripeLoading}
              >
                Manage
              </Button>
            </div>
          </Card>
        </motion.div>

        {state.topupPacks.length > 0 && (
          <motion.div variants={item}>
            <Card className="p-5">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground/80">
                  Need more messages?
                </p>
                <p className="mt-1 text-[13px] text-muted-foreground/80">
                  Top up your balance anytime.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {state.topupPacks.map((pack: TopupPack) => (
                  <Button
                    key={pack.id}
                    variant="outline"
                    onClick={() => openTopupCheckout(pack.id)}
                    disabled={stripeLoading}
                  >
                    {pack.label}
                  </Button>
                ))}
              </div>
            </Card>
          </motion.div>
        )}

        <motion.div variants={item}>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex w-full items-center gap-2 rounded-2xl border border-border/70 bg-card/30 p-4 text-sm text-muted-foreground/80 transition-colors hover:text-muted-foreground"
          >
            <Settings className="h-3.5 w-3.5" />
            Advanced
            <ChevronDown
              className={`ml-auto h-3.5 w-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
            />
          </button>

          {showAdvanced && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mt-2 space-y-3 rounded-2xl border border-border/70 bg-card/30 p-5"
            >
              {canViewDebugLogs && isAssistantLive && (
                <div className="space-y-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => verifyMutation.mutate()}
                    disabled={verifyMutation.isPending}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {verifyMutation.isPending
                      ? 'Checking…'
                      : 'Run health check'}
                  </Button>

                  {verifyMutation.data && (
                    <div className="grid gap-1.5 text-[13px] text-muted-foreground sm:grid-cols-2">
                      <p>
                        Connection:{' '}
                        <span
                          className={
                            verifyMutation.data.gateway.loaded
                              ? 'text-foreground/80'
                              : 'text-destructive'
                          }
                        >
                          {verifyMutation.data.gateway.loaded
                            ? 'working'
                            : 'not working'}
                        </span>
                      </p>
                      <p>
                        Communication:{' '}
                        <span
                          className={
                            verifyMutation.data.gateway.rpcOk
                              ? 'text-foreground/80'
                              : 'text-destructive'
                          }
                        >
                          {verifyMutation.data.gateway.rpcOk
                            ? 'working'
                            : 'not working'}
                        </span>
                      </p>
                      <p>
                        System:{' '}
                        <span
                          className={
                            verifyMutation.data.health.ok
                              ? 'text-foreground/80'
                              : 'text-destructive'
                          }
                        >
                          {verifyMutation.data.health.ok
                            ? 'healthy'
                            : 'needs attention'}
                        </span>
                      </p>
                      <p>
                        Features: {verifyMutation.data.health.channelsOk}{' '}
                        working / {verifyMutation.data.health.channelsFailed}{' '}
                        issues
                      </p>
                    </div>
                  )}
                </div>
              )}

              {isAssistantLive && (
                <div className="space-y-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowLogs((v) => !v)}
                  >
                    <Terminal className="h-3.5 w-3.5" />
                    {showLogs ? 'Hide logs' : 'Setup logs'}
                  </Button>

                  {showLogs && (
                    <div className="space-y-3 rounded-xl border border-border/70 bg-background/50 p-4">
                      {logsQuery.isLoading ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground/80">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Fetching logs…
                        </div>
                      ) : logsQuery.isError ? (
                        <p className="text-sm text-destructive">
                          Failed to load logs.
                        </p>
                      ) : (
                        <>
                          <div>
                            <h3 className="mb-2 text-[13px] font-medium text-foreground/80">
                              Setup Log
                            </h3>
                            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-3 font-mono text-[12px] text-muted-foreground/80">
                              {logsQuery.data?.bootstrapLog}
                            </pre>
                          </div>
                          <div>
                            <h3 className="mb-2 text-[13px] font-medium text-foreground/80">
                              Server setup
                            </h3>
                            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-3 font-mono text-[12px] text-muted-foreground/80">
                              {logsQuery.data?.cloudInitStatus}
                            </pre>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {state.vps && state.vps.status !== 'terminated' && (
                <div className="pt-3">
                  <Separator className="mb-3" />
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      if (
                        window.confirm('Are you sure? This cannot be undone.')
                      ) {
                        destroyMutation.mutate()
                      }
                    }}
                    disabled={destroyMutation.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {destroyMutation.isPending
                      ? 'Removing…'
                      : 'Remove assistant'}
                  </Button>
                  {destroyMutation.isSuccess && (
                    <p className="mt-2 flex items-center gap-1.5 text-[13px] text-foreground/80">
                      <Check className="h-3 w-3" />
                      Assistant removed.
                    </p>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </motion.div>
      </motion.div>

      <Dialog
        open={isModelDialogOpen}
        onOpenChange={(open) => {
          if (modelMutation.isPending) return
          if (open) {
            setPendingModelSelection(currentModel)
          }
          setIsModelDialogOpen(open)
        }}
      >
        <DialogContent
          className="sm:max-w-lg"
          showCloseButton={!modelMutation.isPending}
        >
          <DialogHeader>
            <DialogTitle>Change AI model</DialogTitle>
            <DialogDescription>
              Pick the model your assistant should use for new messages.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-lg border border-border/70 bg-secondary/40 p-3">
              <p className="text-sm font-medium text-foreground/80">
                Model changes restart your assistant.
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground/80">
                Chat can be temporarily unavailable while the restart finishes.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-[13px] font-medium text-foreground/80">
                Selected model
              </p>
              <DropdownMenu
                open={isModelMenuOpen}
                onOpenChange={setIsModelMenuOpen}
              >
                <DropdownMenuTrigger
                  disabled={modelMutation.isPending}
                  render={
                    <Button
                      variant="outline"
                      className="w-full justify-between"
                      disabled={modelMutation.isPending}
                    />
                  }
                >
                  <span className="flex min-w-0 items-center gap-2 text-left">
                    <ModelBrandLogo model={pendingModel.value} />
                    <span className="truncate">{pendingModel.label}</span>
                  </span>
                  <ChevronDown />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="max-h-72 w-(--anchor-width)"
                >
                  <DropdownMenuRadioGroup
                    value={pendingModelSelection}
                    onValueChange={(value) => {
                      setPendingModelSelection(value)
                      setIsModelMenuOpen(false)
                    }}
                  >
                    {SUPPORTED_MODELS.map((model) => {
                      return (
                        <DropdownMenuRadioItem
                          key={model.value}
                          value={model.value}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <ModelBrandLogo model={model.value} />
                              <p className="truncate text-[13px] leading-5">
                                {model.label}
                              </p>
                            </div>
                            <div className="pl-6">
                              <p className="text-[13px] leading-5 text-muted-foreground">
                                {model.description}
                              </p>
                            </div>
                          </div>
                        </DropdownMenuRadioItem>
                      )
                    })}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <p className="text-[13px] text-muted-foreground/80">
                {pendingModel.description}
              </p>
            </div>

            {modelMutation.isError && (
              <p className="text-[13px] text-destructive">
                Failed to update the model. Please try again.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsModelDialogOpen(false)}
              disabled={modelMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              disabled={
                modelMutation.isPending ||
                pendingModelSelection === currentModel
              }
              onClick={() =>
                modelMutation.mutate({
                  modelValue: pendingModelSelection,
                  modelLabel: pendingModel.label,
                })
              }
            >
              {modelMutation.isPending ? (
                <>
                  <Loader2 className="animate-spin" />
                  Applying…
                </>
              ) : (
                'Restart assistant'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
