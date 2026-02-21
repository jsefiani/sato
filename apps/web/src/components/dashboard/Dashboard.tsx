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
import { authClient } from '@/lib/auth-client'
import { DEFAULT_MODEL, SUPPORTED_MODELS } from '@/lib/models'
import { useEventStream } from '@/lib/use-event-stream'

function formatCredits(value: number): string {
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
  const [isModelDialogOpen, setIsModelDialogOpen] = useState(false)
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
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
          ? {
              ...old,
              preferredModel: modelLabel,
              openClawReady: false,
              gatewayState: 'restarting',
              gatewayRestartStartedAt: new Date().toISOString(),
            }
          : old,
      )
      setPreferredModelOverride(modelValue)
      return { previous }
    },
    onSuccess: () => {
      setIsModelDialogOpen(false)
    },
    onError: (_err, _vars, context) => {
      setPreferredModelOverride(null)
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

  const gatewayState = state?.gatewayState ?? 'ready'
  const needsStatusStream =
    modelMutation.isPending ||
    gatewayState === 'restarting' ||
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
    gatewayState === 'ready' &&
    state?.vps?.status === 'active' &&
    state.openClawReady === true
  const isAssistantRestarting =
    state?.vps?.status === 'active' &&
    (modelMutation.isPending || gatewayState === 'restarting')

  const telegramBotHandle = persistedTelegramBotUsername
    ? `@${persistedTelegramBotUsername}`
    : null
  const telegramConnected = telegramSetup?.connected === true
  const telegramConfigured =
    telegramConnected || telegramSetup?.setupState === 'configuring'

  const statusLabel = state?.vps
    ? state.vps.status === 'active' && gatewayState === 'degraded'
      ? 'Assistant health is degraded. Please retry in a minute.'
      : ({
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

  const totalCredits = state?.credits.totalCreditsRemaining ?? 0
  const maxCredits =
    (state?.credits.monthlyCreditsGrant ?? 0) +
    (state?.credits.purchasedCreditsRemaining ?? 0) +
    (state?.credits.trialCreditsRemaining ?? 0)
  const creditsPercent =
    maxCredits > 0 ? Math.min((totalCredits / maxCredits) * 100, 100) : 0
  const creditsPerUsd = state?.creditPolicy?.creditsPerUsd ?? 1000

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
                        ? 'Applying model change. This can take up to a minute.'
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
                Credits remaining
              </p>
              <p className="text-lg font-semibold tabular-nums text-foreground">
                {formatCredits(totalCredits)}
              </p>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
              <motion.div
                className="h-full rounded-full bg-foreground"
                initial={{ width: 0 }}
                animate={{ width: `${creditsPercent}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            </div>
            <p className="mt-2.5 text-[12px] text-muted-foreground/80">
              {formatCredits(state.credits.trialCreditsRemaining)} trial ·{' '}
              {formatCredits(state.credits.monthlyCreditsRemaining)} monthly ·{' '}
              {formatCredits(state.credits.purchasedCreditsRemaining)} extra
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground/70">
              {formatCredits(creditsPerUsd)} credits = $1 AI usage. Usage varies
              by model and response length.
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
                  Need more credits?
                </p>
                <p className="mt-1 text-[13px] text-muted-foreground/80">
                  Top up your balance anytime. Some top-up bundles include bonus
                  credits.
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

        {state.vps && state.vps.status !== 'terminated' && (
          <motion.div variants={item}>
            <Card className="rounded-2xl border-destructive/30 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch sm:justify-between">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold text-destructive">
                    Danger zone
                  </h2>
                  <p className="text-sm text-muted-foreground/80">
                    Remove the assistant and deprovision its server. This cannot
                    be undone.
                  </p>
                </div>

                <div className="sm:flex sm:items-center">
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
                    {destroyMutation.isPending
                      ? 'Removing…'
                      : 'Remove assistant'}
                  </Button>
                </div>
              </div>

              {destroyMutation.isSuccess && (
                <p className="mt-3 flex items-center gap-1.5 text-[13px] text-foreground/80">
                  <Check className="size-3" />
                  Assistant removed.
                </p>
              )}
            </Card>
          </motion.div>
        )}
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
