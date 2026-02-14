import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { motion } from 'motion/react'
import {
  Activity,
  Check,
  ChevronDown,
  CreditCard,
  ExternalLink,
  Loader2,
  MessageCircle,
  Settings,
  ShieldCheck,
  Terminal,
  Trash2,
} from 'lucide-react'
import type {
  DashboardState,
  TelegramState,
  TopupPack,
} from '@/components/onboarding/onboarding-utils'
import { authClient } from '@/lib/auth-client'

interface VerifyState {
  checkedAt: string
  ok: boolean
  gateway: {
    loaded: boolean
    runtimeStatus: string | null
    probeUrl: string | null
    rpcOk: boolean
    rpcError: string | null
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

export default function NewDashboard() {
  const { data: session } = authClient.useSession()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  // ── Queries ───────────────────────────────────────────

  const dashboardQuery = useQuery({
    queryKey: ['dashboard-status'],
    queryFn: async () => {
      const res = await fetch('/api/vps/status')
      if (!res.ok) throw new Error('Failed to load status')
      return res.json() as Promise<DashboardState>
    },
    refetchOnMount: false,
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
  const telegramSetup =
    state?.channelSetup.channels.find(
      (channel) => channel.channel === 'telegram',
    ) ?? null
  const persistedTelegramBotUsername =
    telegramSetup?.displayName?.replace(/^@+/, '') ?? null

  const isAssistantLive =
    state?.vps?.status === 'active' && state.openClawReady === true

  const telegramQuery = useQuery({
    queryKey: ['telegram-status', state?.vps?.ipv4Address],
    queryFn: async () => {
      const res = await fetch('/api/vps/telegram/status?view=telegram')
      const payload = (await res.json()) as TelegramState & {
        error?: string
      }
      if (!res.ok)
        throw new Error(payload.error ?? 'Failed to load Telegram status')
      return payload
    },
    enabled: isAssistantLive,
    refetchInterval: isAssistantLive ? 10000 : false,
  })

  const telegramState = telegramQuery.data ?? null
  const hasRuntimeTelegramState = telegramState !== null
  const normalizedTelegramBotUsername =
    telegramState?.botUsername?.replace(/^@+/, '') ??
    persistedTelegramBotUsername ??
    null
  const telegramBotHandle = normalizedTelegramBotUsername
    ? `@${normalizedTelegramBotUsername}`
    : null
  const telegramConnected = telegramSetup?.connected === true
  const telegramConfigured =
    telegramConnected ||
    telegramSetup?.setupState === 'configuring' ||
    (hasRuntimeTelegramState && telegramState.configured === true)
  const telegramInitialCheckInFlight =
    isAssistantLive && telegramQuery.isFetching && !hasRuntimeTelegramState
  const telegramStatusUnavailable =
    isAssistantLive && telegramQuery.isError && !hasRuntimeTelegramState

  // ── Billing / Stripe ──────────────────────────────────

  const [stripeLoading, setStripeLoading] = useState(false)

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

  // ── Advanced section ──────────────────────────────────

  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showLogs, setShowLogs] = useState(false)

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
        queryKey: ['telegram-status'],
      })
      queryClient.removeQueries({
        queryKey: ['dashboard-status'],
      })
    },
  })

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

  // ── Computed ──────────────────────────────────────────

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

  // ── Loading ───────────────────────────────────────────

  if (!state) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-8 text-white">
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="mx-auto w-full max-w-xl space-y-4"
      >
        {/* Greeting */}
        <motion.div variants={item} className="pb-2">
          <h1 className="text-2xl font-light tracking-tight text-white">
            Hey, {firstName}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Here's how your assistant is doing.
          </p>
        </motion.div>

        {/* Assistant Status */}
        <motion.div
          variants={item}
          className="rounded-2xl border border-white/[0.06] bg-zinc-900/50 p-5"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                  isAssistantLive ? 'bg-white/[0.04]' : 'bg-zinc-800/80'
                }`}
              >
                <Activity
                  className={`h-4 w-4 ${isAssistantLive ? 'text-white/80' : 'text-zinc-600'}`}
                />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-300">
                  {isAssistantLive
                    ? 'Your assistant is running'
                    : 'Assistant offline'}
                </p>
                <p className="text-[13px] text-zinc-500">
                  {isAssistantLive ? 'Everything looks good' : statusLabel}
                </p>
              </div>
            </div>
            <div className="flex items-center">
              {canSetupAssistant ? (
                <button
                  type="button"
                  onClick={() =>
                    navigate({ to: '/', search: { step: 'launch' } })
                  }
                  className="rounded-xl border border-white/[0.08] px-3 py-1.5 text-[13px] font-medium text-zinc-300 transition-colors hover:border-white/[0.16] hover:text-white"
                >
                  Set up again
                </button>
              ) : (
                <div
                  className={`h-2.5 w-2.5 rounded-full ${
                    isAssistantLive
                      ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.3)]'
                      : 'bg-zinc-700'
                  }`}
                />
              )}
            </div>
          </div>
        </motion.div>

        {/* Messages Card */}
        <motion.div
          variants={item}
          className="rounded-2xl border border-white/[0.06] bg-zinc-900/50 p-5"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-zinc-300">
              Messages remaining
            </p>
            <p className="text-lg font-semibold tabular-nums text-white">
              {formatMessages(totalMessages)}
            </p>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <motion.div
              className="h-full rounded-full bg-white"
              initial={{ width: 0 }}
              animate={{ width: `${messagesPercent}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          </div>
          <p className="mt-2.5 text-[12px] text-zinc-500">
            {formatMessages(state.credits.trialCreditsRemaining)} trial ·{' '}
            {formatMessages(state.credits.monthlyCreditsRemaining)} monthly ·{' '}
            {formatMessages(state.credits.purchasedCreditsRemaining)} extra
          </p>
        </motion.div>

        {/* Telegram Card */}
        <motion.div
          variants={item}
          className="rounded-2xl border border-white/[0.06] bg-zinc-900/50 p-5"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.04]">
                <MessageCircle className="h-4 w-4 text-white/80" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-300">Telegram</p>
                <p className="text-[13px] text-zinc-500">
                  {telegramConnected ? (
                    (telegramBotHandle ?? 'Connected')
                  ) : telegramInitialCheckInFlight ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Checking status…
                    </span>
                  ) : telegramStatusUnavailable ? (
                    'Status unavailable'
                  ) : telegramConfigured ? (
                    'Configured, not connected'
                  ) : (
                    'Not connected'
                  )}
                </p>
              </div>
            </div>
            {isAssistantLive && !telegramConnected ? (
              <button
                type="button"
                onClick={() =>
                  navigate({ to: '/', search: { step: 'telegram' } })
                }
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.06] px-3 py-1.5 text-[13px] font-medium text-zinc-400 transition-colors hover:border-white/[0.12] hover:text-zinc-300"
              >
                Fix Telegram
              </button>
            ) : normalizedTelegramBotUsername ? (
              <a
                href={`https://t.me/${normalizedTelegramBotUsername}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.06] px-3 py-1.5 text-[13px] font-medium text-zinc-400 transition-colors hover:border-white/[0.12] hover:text-zinc-300"
              >
                Open chat <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        </motion.div>

        {/* Plan & Billing */}
        <motion.div
          variants={item}
          className="rounded-2xl border border-white/[0.06] bg-zinc-900/50 p-5"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.04]">
                <CreditCard className="h-4 w-4 text-white/80" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-300">
                  Plan & billing
                </p>
                <p className="text-[13px] text-zinc-500">{planLabel}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={openPortal}
              disabled={stripeLoading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.06] px-3 py-1.5 text-[13px] font-medium text-zinc-400 transition-colors hover:border-white/[0.12] hover:text-zinc-300 disabled:opacity-60"
            >
              Manage
            </button>
          </div>
        </motion.div>

        {/* Top-up packs */}
        {state.topupPacks.length > 0 && (
          <motion.div
            variants={item}
            className="rounded-2xl border border-white/[0.06] bg-zinc-900/50 p-5"
          >
            <p className="text-sm font-medium text-zinc-300">
              Need more messages?
            </p>
            <p className="mt-1 text-[13px] text-zinc-500">
              Top up your balance anytime.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {state.topupPacks.map((pack: TopupPack) => (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => openTopupCheckout(pack.id)}
                  disabled={stripeLoading}
                  className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.06] disabled:opacity-60"
                >
                  {pack.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Advanced / Settings */}
        <motion.div variants={item}>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex w-full items-center gap-2 rounded-2xl border border-white/[0.04] bg-zinc-900/30 p-4 text-sm text-zinc-500 transition-colors hover:text-zinc-400"
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
              className="mt-2 space-y-3 rounded-2xl border border-white/[0.04] bg-zinc-900/30 p-5"
            >
              {isAssistantLive && (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => verifyMutation.mutate()}
                    disabled={verifyMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/[0.06] px-3 py-2 text-[13px] text-zinc-400 transition-colors hover:border-white/[0.1] hover:text-zinc-300 disabled:opacity-60"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {verifyMutation.isPending
                      ? 'Checking…'
                      : 'Run health check'}
                  </button>

                  {verifyMutation.data && (
                    <div className="grid gap-1.5 text-[13px] text-zinc-400 sm:grid-cols-2">
                      <p>
                        Connection:{' '}
                        <span
                          className={
                            verifyMutation.data.gateway.loaded
                              ? 'text-zinc-300'
                              : 'text-red-400/70'
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
                              ? 'text-zinc-300'
                              : 'text-red-400/70'
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
                              ? 'text-zinc-300'
                              : 'text-red-400/70'
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
                  <button
                    type="button"
                    onClick={() => setShowLogs((v) => !v)}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/[0.06] px-3 py-2 text-[13px] text-zinc-400 transition-colors hover:border-white/[0.1] hover:text-zinc-300"
                  >
                    <Terminal className="h-3.5 w-3.5" />
                    {showLogs ? 'Hide logs' : 'Setup logs'}
                  </button>

                  {showLogs && (
                    <div className="space-y-3 rounded-xl border border-white/[0.04] bg-zinc-950/50 p-4">
                      {logsQuery.isLoading ? (
                        <div className="flex items-center gap-2 text-sm text-zinc-500">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Fetching logs…
                        </div>
                      ) : logsQuery.isError ? (
                        <p className="text-sm text-red-400/70">
                          Failed to load logs.
                        </p>
                      ) : (
                        <>
                          <div>
                            <h3 className="mb-2 text-[13px] font-medium text-zinc-300">
                              Setup Log
                            </h3>
                            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-950 p-3 font-mono text-[12px] text-zinc-500">
                              {logsQuery.data?.bootstrapLog}
                            </pre>
                          </div>
                          <div>
                            <h3 className="mb-2 text-[13px] font-medium text-zinc-300">
                              Server setup
                            </h3>
                            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-950 p-3 font-mono text-[12px] text-zinc-500">
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
                <div className="border-t border-white/[0.04] pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm('Are you sure? This cannot be undone.')
                      ) {
                        destroyMutation.mutate()
                      }
                    }}
                    disabled={destroyMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-xl border border-red-400/10 px-3 py-2 text-[13px] text-red-400/70 transition-colors hover:bg-red-500/5 disabled:opacity-60"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {destroyMutation.isPending
                      ? 'Removing…'
                      : 'Remove assistant'}
                  </button>
                  {destroyMutation.isSuccess && (
                    <p className="mt-2 flex items-center gap-1.5 text-[13px] text-zinc-300">
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
    </div>
  )
}
