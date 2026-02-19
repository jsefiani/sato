import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  MessageCircle,
} from 'lucide-react'
import { containerVariants, itemVariants } from '../onboarding-animations'
import { useOnboardingContext } from '../onboarding-context'
import type { TelegramPairingRequest, TelegramState } from '../onboarding-utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

type TelegramFlowStep = 'token' | 'message' | 'approval' | 'done'

const AUTO_APPROVE_MAX_AGE_MS = 2 * 60 * 1000
const PAIRING_CODE_REGEX = /^[A-Z2-9]{8}$/

function parseTimestamp(value: string | null): number | null {
  if (!value) {
    return null
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function pickAutoApproveCandidate(
  requests: Array<TelegramPairingRequest>,
  nowMs = Date.now(),
): TelegramPairingRequest | null {
  if (requests.length !== 1) {
    return null
  }

  const candidate = requests[0]
  if (!PAIRING_CODE_REGEX.test(candidate.code)) {
    return null
  }

  const createdAtMs = parseTimestamp(candidate.createdAt)
  if (
    createdAtMs !== null &&
    nowMs >= createdAtMs &&
    nowMs - createdAtMs > AUTO_APPROVE_MAX_AGE_MS
  ) {
    return null
  }

  return candidate
}

function pickFallbackPairingRequest(
  requests: Array<TelegramPairingRequest>,
): TelegramPairingRequest | null {
  const valid = requests.filter((request) =>
    PAIRING_CODE_REGEX.test(request.code),
  )
  if (valid.length === 0) {
    return null
  }

  return [...valid].sort((a, b) => {
    const aTime = parseTimestamp(a.createdAt) ?? 0
    const bTime = parseTimestamp(b.createdAt) ?? 0
    return bTime - aTime
  })[0]
}

function deriveFlowStep({
  approved,
  telegramState,
  hasPairingRequest,
  approvingPairing,
  approveError,
}: {
  approved: boolean
  telegramState: TelegramState | null
  hasPairingRequest: boolean
  approvingPairing: boolean
  approveError: string | null
}): TelegramFlowStep {
  if (approved) {
    return 'done'
  }

  if (telegramState?.configured || telegramState?.connected) {
    if (approvingPairing || hasPairingRequest || !!approveError) {
      return 'approval'
    }
    return 'message'
  }

  return 'token'
}

function NumberCircle({ n }: { n: number }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground/8 text-xs font-medium text-foreground/70">
      {n}
    </span>
  )
}

const STEP_CONFIG: Record<
  TelegramFlowStep,
  { title: string; description: string }
> = {
  token: {
    title: 'Connect Telegram',
    description: 'Set up your assistant on Telegram, then paste the code.',
  },
  message: {
    title: 'Almost there!',
    description: '',
  },
  approval: {
    title: 'Finishing setup…',
    description: '',
  },
  done: {
    title: "You're all set!",
    description: 'Your assistant is connected to Telegram.',
  },
}

export default function TelegramStep() {
  const {
    telegramState,
    telegramApproved: approved,
    handleConnectToken: onConnectToken,
    connectingToken,
    connectError,
    handleApprovePairing: onApprovePairing,
    approvingPairing,
    approveError,
    onNavigate,
    skipInitialAnimation,
  } = useOnboardingContext()

  const normalizedBotUsername =
    telegramState?.botUsername?.replace(/^@+/, '') ?? null
  const botHandle = normalizedBotUsername ? `@${normalizedBotUsername}` : null

  const [token, setToken] = useState('')
  const [manualPairingCode, setManualPairingCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [showManualCode, setShowManualCode] = useState(false)

  const pairingRequests = telegramState?.pairingRequests ?? []
  const hasPairingRequest = pairingRequests.length > 0
  const hasMultiplePairingRequests = pairingRequests.length > 1

  const autoApproveCandidate = useMemo(
    () => pickAutoApproveCandidate(pairingRequests),
    [pairingRequests],
  )

  const fallbackPairingRequest = useMemo(
    () => pickFallbackPairingRequest(pairingRequests),
    [pairingRequests],
  )

  const flowStep = deriveFlowStep({
    approved,
    telegramState,
    hasPairingRequest,
    approvingPairing,
    approveError: approveError ?? null,
  })

  const autoApproveBlocked =
    flowStep === 'approval' && hasPairingRequest && !autoApproveCandidate
  const autoApproveFailed =
    flowStep === 'approval' && !!autoApproveCandidate && !!approveError

  const autoApproveAttemptedRef = useRef<string | null>(null)

  useEffect(() => {
    if (flowStep !== 'approval') {
      autoApproveAttemptedRef.current = null
      return
    }

    if (!autoApproveCandidate || approvingPairing) {
      return
    }

    const attemptKey = autoApproveCandidate.id || autoApproveCandidate.code
    if (autoApproveAttemptedRef.current === attemptKey) {
      return
    }

    autoApproveAttemptedRef.current = attemptKey
    onApprovePairing(autoApproveCandidate.code)
  }, [flowStep, autoApproveCandidate, approvingPairing, onApprovePairing])

  useEffect(() => {
    if (flowStep !== 'approval' && flowStep !== 'message') {
      setShowManualCode(false)
      setManualPairingCode('')
    }
  }, [flowStep])

  const panelError =
    flowStep === 'token'
      ? (connectError ?? null)
      : flowStep === 'approval'
        ? (approveError ?? null)
        : null
  const softError =
    panelError ??
    (flowStep !== 'done' ? (telegramState?.lastError ?? null) : null)

  const { title, description } = STEP_CONFIG[flowStep]

  const handleCopyBotfather = () => {
    void navigator.clipboard.writeText('/newbot')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleConnectBot = () => {
    const trimmed = token.trim()
    if (!trimmed) {
      return
    }

    onConnectToken(trimmed)
  }

  return (
    <motion.div
      variants={containerVariants}
      initial={skipInitialAnimation ? false : 'hidden'}
      animate="show"
      className="flex flex-col items-center text-center"
    >
      <motion.div variants={itemVariants}>
        {flowStep === 'done' ? (
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-success/10">
            <Check className="h-7 w-7 text-success" />
          </div>
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            {flowStep === 'approval' ? (
              <Loader2 className="h-7 w-7 animate-spin text-foreground/90" />
            ) : (
              <MessageCircle className="h-7 w-7 text-foreground/90" />
            )}
          </div>
        )}
      </motion.div>

      <motion.h1
        variants={itemVariants}
        className="mt-6 text-3xl font-light tracking-tight text-foreground"
      >
        {title}
      </motion.h1>

      {description && (
        <motion.p
          variants={itemVariants}
          className="mt-2 text-[15px] leading-relaxed text-muted-foreground"
        >
          {description}
        </motion.p>
      )}

      {flowStep === 'message' && botHandle && (
        <motion.p
          variants={itemVariants}
          className="mt-2 text-[13px] text-muted-foreground"
        >
          Connected as {botHandle}
        </motion.p>
      )}

      <motion.div
        variants={itemVariants}
        className="mt-3 w-full max-w-sm space-y-4"
      >
        {softError ? (
          <Alert variant="destructive">
            <AlertDescription>{softError}</AlertDescription>
          </Alert>
        ) : null}

        <AnimatePresence mode="popLayout">
          {flowStep === 'token' && (
            <motion.div
              key="token"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.1 } }}
              className="space-y-4"
            >
              <Card>
                <CardContent className="space-y-5 text-left">
                  <div className="flex items-start gap-3">
                    <NumberCircle n={1} />
                    <div className="space-y-2 pt-0.5">
                      <p className="text-sm font-medium text-card-foreground">
                        Open BotFather on Telegram
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        render={
                          <a
                            href="https://t.me/BotFather"
                            target="_blank"
                            rel="noopener noreferrer"
                          />
                        }
                      >
                        Open BotFather <ExternalLink />
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <NumberCircle n={2} />
                    <div className="space-y-2 pt-0.5">
                      <p className="text-sm font-medium text-card-foreground">
                        Send this command and follow the prompts
                      </p>
                      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/60 px-2.5 py-2">
                        <span className="font-mono text-[13px] text-card-foreground">
                          /newbot
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleCopyBotfather}
                        >
                          {copied ? 'Copied' : 'Copy'}
                          {copied ? <Check /> : <Copy />}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <NumberCircle n={3} />
                    <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                      <p className="text-sm font-medium text-card-foreground">
                        Paste the code it gives you
                      </p>
                      <Input
                        type="text"
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        placeholder="Paste here"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Button
                className="w-full"
                onClick={handleConnectBot}
                disabled={!token.trim() || connectingToken}
              >
                {connectingToken ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Connecting…
                  </span>
                ) : (
                  'Connect'
                )}
              </Button>
            </motion.div>
          )}

          {flowStep === 'message' && (
            <motion.div
              key="message"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.1 } }}
              className="space-y-4"
            >
              {normalizedBotUsername && botHandle ? (
                <Button
                  className="w-full"
                  size="lg"
                  render={
                    <a
                      href={`https://t.me/${normalizedBotUsername}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  Open {botHandle} in Telegram <ExternalLink />
                </Button>
              ) : (
                <Button className="w-full" size="lg" disabled>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading…
                </Button>
              )}

              <Card>
                <CardContent className="space-y-3 text-left">
                  <p className="text-sm text-card-foreground">
                    Send any message, then paste the code Telegram shows you.
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      value={manualPairingCode}
                      onChange={(event) =>
                        setManualPairingCode(
                          event.target.value.trim().toUpperCase().slice(0, 8),
                        )
                      }
                      placeholder="ABCD1234"
                      className="flex-1 font-mono tracking-widest"
                    />
                    <Button
                      onClick={() => onApprovePairing(manualPairingCode)}
                      disabled={
                        approvingPairing ||
                        !PAIRING_CODE_REGEX.test(manualPairingCode)
                      }
                    >
                      {approvingPairing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        'Confirm'
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {flowStep === 'approval' && (
            <motion.div
              key="approval"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.1 } }}
              className="space-y-4"
            >
              {autoApproveCandidate ? (
                autoApproveFailed ? (
                  <>
                    <Card>
                      <CardContent className="text-left">
                        <p className="text-sm text-card-foreground">
                          Something went wrong. Tap below to try again.
                        </p>
                      </CardContent>
                    </Card>
                    <Button
                      className="w-full"
                      onClick={() =>
                        onApprovePairing(autoApproveCandidate.code)
                      }
                      disabled={approvingPairing}
                    >
                      Retry
                    </Button>
                  </>
                ) : (
                  <Card className="flex-row items-center justify-center gap-2 p-3">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    <span className="text-[13px] text-muted-foreground">
                      {approvingPairing
                        ? 'Connecting your account…'
                        : 'Almost done…'}
                    </span>
                  </Card>
                )
              ) : fallbackPairingRequest ? (
                <>
                  <Card>
                    <CardContent className="text-left">
                      <p className="text-sm text-card-foreground">
                        {hasMultiplePairingRequests
                          ? 'We found multiple connection requests. Tap below to approve the latest one.'
                          : 'This request needs manual approval. Tap below to continue.'}
                      </p>
                    </CardContent>
                  </Card>
                  <Button
                    className="w-full"
                    onClick={() =>
                      onApprovePairing(fallbackPairingRequest.code)
                    }
                    disabled={approvingPairing}
                  >
                    {approvingPairing ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Approving…
                      </span>
                    ) : (
                      'Approve latest request'
                    )}
                  </Button>
                </>
              ) : (
                <Card>
                  <CardContent className="text-left">
                    <p className="text-sm text-card-foreground">
                      Send one more message to your assistant on Telegram to
                      create a fresh request.
                    </p>
                  </CardContent>
                </Card>
              )}

              {(autoApproveBlocked || autoApproveFailed) && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setShowManualCode((value) => !value)}
                    className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-accent-foreground"
                  >
                    Enter a code manually
                    <ChevronDown
                      className={`h-3 w-3 transition-transform ${showManualCode ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {showManualCode && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="mt-2 flex items-center gap-2"
                    >
                      <Input
                        type="text"
                        value={manualPairingCode}
                        onChange={(event) =>
                          setManualPairingCode(
                            event.target.value.trim().toUpperCase().slice(0, 8),
                          )
                        }
                        placeholder="ABCDEFGH"
                        className="flex-1 font-mono tracking-widest"
                      />
                      <Button
                        size="sm"
                        onClick={() => onApprovePairing(manualPairingCode)}
                        disabled={
                          approvingPairing ||
                          !PAIRING_CODE_REGEX.test(manualPairingCode)
                        }
                      >
                        Pair
                      </Button>
                    </motion.div>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {flowStep === 'done' && (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.1 } }}
              className="space-y-4"
            >
              <Card>
                <CardContent className="space-y-1 text-left">
                  <div className="flex items-center gap-2 text-sm font-medium text-card-foreground">
                    <Check className="h-4 w-4 text-success" />
                    Telegram connected
                  </div>
                  {botHandle && (
                    <p className="text-[13px] text-muted-foreground">
                      {botHandle}
                    </p>
                  )}
                </CardContent>
              </Card>

              {normalizedBotUsername && botHandle ? (
                <Button
                  className="w-full"
                  size="lg"
                  render={
                    <a
                      href={`https://t.me/${normalizedBotUsername}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  Open {botHandle} in Telegram <ExternalLink />
                </Button>
              ) : null}

              <Button
                variant="outline"
                className="w-full"
                onClick={() => onNavigate(null)}
              >
                Go to dashboard
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}
