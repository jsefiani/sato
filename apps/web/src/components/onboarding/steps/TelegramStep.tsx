import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  MessageCircle,
  UserCheck,
} from 'lucide-react'
import { containerVariants, itemVariants } from '../onboarding-animations'
import { useOnboardingContext } from '../onboarding-context'
import type { TelegramPairingRequest, TelegramState } from '../onboarding-utils'

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
    if (flowStep !== 'approval') {
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

  const stepLabel =
    flowStep === 'token'
      ? 'Step 1 of 3'
      : flowStep === 'message'
        ? 'Step 2 of 3'
        : flowStep === 'approval'
          ? 'Step 3 of 3'
          : 'Done'

  const stepDescription =
    flowStep === 'token'
      ? 'Set up Telegram for your assistant, then paste the Telegram token here.'
      : flowStep === 'message'
        ? 'Send one message to your assistant on Telegram to verify your account.'
        : flowStep === 'approval'
          ? 'Approving access automatically. This usually takes a few seconds.'
          : 'You are ready to chat with your assistant.'

  const autoApproveBlockedReason = hasMultiplePairingRequests
    ? 'We found multiple pending requests, so automatic approval is paused for safety.'
    : hasPairingRequest
      ? 'This request is too old to auto-approve safely. Approve the latest request below.'
      : 'No pending request found yet. Send a new message to your assistant on Telegram.'

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
      <motion.div
        variants={itemVariants}
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted"
      >
        <MessageCircle className="h-7 w-7 text-foreground/90" />
      </motion.div>

      <motion.h1
        variants={itemVariants}
        className="mt-6 text-3xl font-light tracking-tight text-foreground"
      >
        {flowStep === 'done' ? 'Telegram connected' : 'Connect Telegram'}
      </motion.h1>

      <motion.p
        variants={itemVariants}
        className="mt-2 text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
      >
        {stepLabel}
      </motion.p>

      <motion.p
        variants={itemVariants}
        className="mt-3 max-w-sm text-[15px] leading-relaxed text-muted-foreground"
      >
        {stepDescription}
      </motion.p>

      <motion.div
        variants={itemVariants}
        className="mt-8 w-full max-w-sm space-y-4"
      >
        {softError ? (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/15 px-3 py-2 text-left text-xs leading-relaxed text-destructive-foreground">
            {softError}
          </div>
        ) : null}

        <AnimatePresence mode="wait">
          {flowStep === 'token' && (
            <motion.div
              key="token"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="space-y-4"
            >
              <div className="space-y-5 rounded-2xl border border-border bg-card p-5 text-left">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-card-foreground">
                    Create your assistant in BotFather
                  </p>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    Send <span className="font-mono">/newbot</span> in
                    BotFather, follow the prompts, then paste your Telegram
                    token below.
                  </p>
                </div>

                <div className="space-y-2 rounded-xl border border-border bg-muted/60 p-3">
                  <p className="text-[12px] text-muted-foreground">
                    Command for BotFather:
                  </p>
                  <div className="flex items-center justify-between rounded-lg border border-border bg-background/80 px-2.5 py-2">
                    <span className="font-mono text-[13px] text-card-foreground">
                      /newbot
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyBotfather}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      {copied ? 'Copied' : 'Copy'}
                      {copied ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <a
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-muted text-[13px] font-medium text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  Open BotFather <ExternalLink className="h-3 w-3" />
                </a>

                <div className="space-y-2">
                  <label
                    htmlFor="telegram-token"
                    className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground"
                  >
                    Telegram token
                  </label>
                  <input
                    id="telegram-token"
                    type="password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="123456:ABC-DEF..."
                    className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-ring focus:outline-none"
                  />
                  <p className="text-[12px] text-muted-foreground">
                    Paste the Telegram token BotFather gives you.
                  </p>
                </div>
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleConnectBot}
                disabled={!token.trim() || connectingToken}
                className="h-12 w-full rounded-2xl bg-primary text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {connectingToken ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verifying token...
                  </span>
                ) : (
                  'Verify token'
                )}
              </motion.button>

              <p className="text-center text-[12px] text-muted-foreground">
                Next: send one message to your assistant on Telegram.
              </p>
            </motion.div>
          )}

          {flowStep === 'message' && (
            <motion.div
              key="message"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="space-y-4"
            >
              <div className="space-y-3 rounded-2xl border border-border bg-card p-5 text-left">
                <div className="flex items-center gap-2 text-sm font-medium text-card-foreground">
                  <Check className="h-4 w-4" />
                  Token verified
                </div>

                <p className="text-sm text-card-foreground">
                  Send one message to your assistant on Telegram.
                </p>

                {normalizedBotUsername && botHandle ? (
                  <a
                    href={`https://t.me/${normalizedBotUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-card-foreground hover:text-accent-foreground"
                  >
                    Open {botHandle} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}

                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  If Telegram shows a pairing code message, do nothing here -
                  approval is automatic.
                </p>
              </div>

              <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-muted px-3 py-3 text-[13px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Waiting for your message...
              </div>
            </motion.div>
          )}

          {flowStep === 'approval' && (
            <motion.div
              key="approval"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="space-y-4"
            >
              <div className="rounded-2xl border border-border bg-card p-4 text-left">
                <p className="text-sm font-medium text-card-foreground">
                  Connection request received
                </p>
                {autoApproveCandidate ? (
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    Approving access automatically...
                  </p>
                ) : (
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {autoApproveBlockedReason}
                  </p>
                )}
              </div>

              {autoApproveCandidate ? (
                autoApproveFailed ? (
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => onApprovePairing(autoApproveCandidate.code)}
                    disabled={approvingPairing}
                    className="h-12 w-full rounded-2xl bg-primary text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    Retry automatic approval
                  </motion.button>
                ) : (
                  <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-muted px-3 py-3 text-[13px] text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {approvingPairing
                      ? 'Approving access...'
                      : 'Finalizing approval...'}
                  </div>
                )
              ) : fallbackPairingRequest ? (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onApprovePairing(fallbackPairingRequest.code)}
                  disabled={approvingPairing}
                  className="h-12 w-full rounded-2xl bg-primary text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {approvingPairing ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Approving...
                    </span>
                  ) : (
                    'Approve latest request'
                  )}
                </motion.button>
              ) : (
                <div className="rounded-2xl border border-border bg-muted px-3 py-3 text-[13px] text-muted-foreground">
                  Send one more message to your assistant on Telegram to create
                  a fresh request.
                </div>
              )}

              {(autoApproveBlocked || autoApproveFailed) && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setShowManualCode((value) => !value)}
                    className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-accent-foreground"
                  >
                    Have a pairing code?
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
                      <input
                        type="text"
                        value={manualPairingCode}
                        onChange={(event) =>
                          setManualPairingCode(
                            event.target.value.trim().toUpperCase().slice(0, 8),
                          )
                        }
                        placeholder="ABCDEFGH"
                        className="h-10 flex-1 rounded-xl border border-input bg-background px-3 font-mono text-sm tracking-widest text-foreground placeholder:text-muted-foreground/70 focus:border-ring focus:outline-none"
                      />
                      <motion.button
                        whileHover={{ scale: 1.04 }}
                        whileTap={{ scale: 0.96 }}
                        onClick={() => onApprovePairing(manualPairingCode)}
                        disabled={
                          approvingPairing ||
                          !PAIRING_CODE_REGEX.test(manualPairingCode)
                        }
                        className="h-10 rounded-xl bg-primary px-5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                      >
                        Pair
                      </motion.button>
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
              exit={{ opacity: 0, y: -8 }}
              className="space-y-4"
            >
              <div className="space-y-2 rounded-2xl border border-border bg-card p-4 text-left">
                <div className="flex items-center gap-2 text-sm font-medium text-card-foreground">
                  <UserCheck className="h-4 w-4" />
                  Telegram is connected
                </div>
                <p className="text-[13px] text-muted-foreground">
                  Access is approved. You're all set to chat with your
                  assistant.
                </p>
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onNavigate(null)}
                className="h-12 w-full rounded-2xl bg-primary text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Go to dashboard
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}
