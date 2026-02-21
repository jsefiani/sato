import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react'
import { siTelegram } from 'simple-icons'
import { containerVariants, itemVariants } from '../onboarding-animations'
import { useOnboardingContext } from '../onboarding-context'
import type { TelegramState } from '../onboarding-utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

type TelegramFlowStep = 'token' | 'message' | 'done'

const PAIRING_CODE_REGEX = /^[A-Z2-9]{8}$/

function deriveFlowStep({
  approved,
  telegramState,
}: {
  approved: boolean
  telegramState: TelegramState | null
}): TelegramFlowStep {
  if (approved) {
    return 'done'
  }

  if (telegramState?.configured || telegramState?.connected) {
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

  const flowStep = deriveFlowStep({
    approved,
    telegramState,
  })

  useEffect(() => {
    if (flowStep !== 'message') {
      setManualPairingCode('')
    }
  }, [flowStep])

  const panelError =
    flowStep === 'token'
      ? (connectError ?? null)
      : flowStep === 'message'
        ? (approveError ?? null)
        : null
  const statusError =
    flowStep === 'message' ? (telegramState?.lastError ?? null) : null
  const softError = panelError ?? statusError
  const visibleError =
    softError === 'Something went wrong'
      ? panelError
        ? flowStep === 'token'
          ? 'Could not connect that BotFather token. Double-check it and try again.'
          : 'Could not approve that connection code. Use the latest code from OpenClaw and try again.'
        : null
      : softError

  const { title, description } = STEP_CONFIG[flowStep]
  const isMessageStep = flowStep === 'message'

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

  const handleManualApprovePairing = () => {
    const normalizedCode = manualPairingCode.trim().toUpperCase()
    if (!PAIRING_CODE_REGEX.test(normalizedCode)) {
      return
    }

    onApprovePairing(normalizedCode)
  }

  return (
    <motion.div
      variants={containerVariants}
      initial={skipInitialAnimation ? false : 'hidden'}
      animate="show"
      className={`flex flex-col items-center ${isMessageStep ? 'gap-4' : 'gap-6'}`}
    >
      <motion.div variants={itemVariants}>
        {flowStep === 'done' ? (
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-success/10">
            <Check className="h-7 w-7 text-success" />
          </div>
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border">
            <svg
              viewBox="0 0 24 24"
              fill={`#${siTelegram.hex}`}
              aria-hidden="true"
              className="size-7 shrink-0"
            >
              <path d={siTelegram.path} />
            </svg>
          </div>
        )}
      </motion.div>

      <motion.div
        variants={itemVariants}
        className="flex flex-col items-center gap-2"
      >
        <h1 className="text-3xl font-light tracking-tight text-foreground">
          {title}
        </h1>

        {description && (
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </motion.div>

      <motion.div
        variants={itemVariants}
        className={`flex w-full max-w-lg flex-col ${isMessageStep ? 'gap-3' : 'gap-4'}`}
      >
        {visibleError ? (
          <Alert variant="destructive">
            <AlertDescription>{visibleError}</AlertDescription>
          </Alert>
        ) : null}

        <AnimatePresence mode="popLayout">
          {flowStep === 'token' && (
            <motion.div
              key="token"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.1 } }}
              className="flex flex-col gap-4"
            >
              <Card>
                <CardContent className="flex flex-col gap-5 text-left">
                  <div className="flex items-start gap-3">
                    <NumberCircle n={1} />
                    <div className="min-w-0 flex flex-1 flex-col gap-2 pt-0.5">
                      <p className="text-sm font-medium text-card-foreground">
                        Copy this command
                      </p>
                      <div className="flex w-full items-center justify-between rounded-lg border border-border bg-muted/60 px-2.5 py-2">
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
                    <NumberCircle n={2} />
                    <div className="min-w-0 flex flex-1 flex-col gap-2 pt-0.5">
                      <p className="text-sm font-medium text-card-foreground">
                        Open BotFather, paste the command, and follow prompts
                      </p>
                      <Button
                        className="self-start"
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
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        BotFather helps you create your bot and gives you the
                        code to paste here.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <NumberCircle n={3} />
                    <div className="min-w-0 flex flex-1 flex-col gap-2 pt-0.5">
                      <p className="text-sm font-medium text-card-foreground">
                        Paste the BotFather token code here
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
              className="flex flex-col gap-3"
            >
              {normalizedBotUsername && botHandle ? (
                <Button
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
                <CardContent className="flex flex-col gap-4 text-left">
                  <p className="text-sm text-card-foreground">
                    Send any message, then paste the connection code OpenClaw
                    gives you.
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
                      onClick={handleManualApprovePairing}
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

          {flowStep === 'done' && (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.1 } }}
              className="flex flex-col gap-4"
            >
              {normalizedBotUsername && botHandle ? (
                <Button
                  variant="outline"
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

              <Button variant="link" onClick={() => onNavigate(null)}>
                Go to dashboard
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}
