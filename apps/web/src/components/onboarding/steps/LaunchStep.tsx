import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Loader2, Sparkles } from 'lucide-react'
import type { DashboardState } from '../onboarding-utils'

interface LaunchStepProps {
  state: DashboardState
  onProvision: () => void
  provisioning: boolean
  provisionError?: string | null
  launchIssue?: string | null
}

const PROGRESS_MESSAGES = [
  { key: 'provision', label: 'Creating a home for your assistant…' },
  { key: 'bootstrap', label: 'Getting your assistant ready…' },
  { key: 'warmup', label: 'Almost there…' },
  { key: 'ready', label: 'All done! Your assistant is live' },
]

const ITEM_HEIGHT = 52
const MAX_VISIBLE = 3
const OPACITY_BY_OFFSET = [1, 0.4, 0.15] as const

function getProgressIndex(state: DashboardState): number {
  const vps = state.vps
  if (!vps) return -1
  if (vps.status === 'provisioning') return 0
  if (vps.status === 'bootstrapping') return 1
  if (vps.status === 'active' && state.openClawReady !== true) return 2
  if (vps.status === 'active' && state.openClawReady === true) return 3
  return -1
}

function StepIcon({ done, active }: { done: boolean; active: boolean }) {
  if (done)
    return (
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring' as const, stiffness: 400, damping: 15 }}
        className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.03]"
      >
        <Check className="h-3.5 w-3.5 text-zinc-300" />
      </motion.div>
    )
  if (active) return <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
  return <div className="mx-auto h-1.5 w-1.5 rounded-full bg-zinc-700" />
}

function IssueCard({ message }: { message: string }) {
  return (
    <div className="mt-4 w-full max-w-sm rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-left">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-red-200/90">
        Setup issue detected
      </p>
      <p className="mt-1 text-sm leading-relaxed text-red-100/80">{message}</p>
    </div>
  )
}

export default function LaunchStep({
  state,
  onProvision,
  provisioning,
  provisionError,
  launchIssue,
}: LaunchStepProps) {
  const rawProgressIndex = getProgressIndex(state)
  const isRetry =
    state.vps?.status === 'failed' || state.vps?.status === 'cleanup_pending'
  const hasProvisionError =
    !isRetry && !!provisionError && rawProgressIndex === -1

  // When provisioning was just triggered but status hasn't updated yet,
  // show the first progress step instead of a blank screen
  const progressIndex =
    rawProgressIndex === -1 && !isRetry && !hasProvisionError
      ? 0
      : rawProgressIndex
  const isReady = progressIndex === 3
  const showRetry = isRetry || hasProvisionError

  const effectiveIssue =
    launchIssue ??
    provisionError ??
    (isRetry
      ? 'Assistant setup failed before it became ready. Please retry provisioning.'
      : null)

  const autoProvisioned = useRef(false)

  // Safety net: if we land here without provisioning started (e.g. deep link)
  useEffect(() => {
    if (
      rawProgressIndex === -1 &&
      !isRetry &&
      !provisioning &&
      !autoProvisioned.current
    ) {
      autoProvisioned.current = true
      onProvision()
    }
  }, [rawProgressIndex, isRetry, provisioning, onProvision])

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex w-full flex-col items-center text-center"
    >
      <motion.div
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.04]"
        animate={isReady ? {} : { scale: [1, 1.06, 1] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <Sparkles
          className={`h-7 w-7 ${isReady ? 'text-zinc-300' : 'text-white/80'}`}
        />
      </motion.div>

      <h1 className="mt-6 text-2xl font-light tracking-tight text-white">
        {isReady ? 'All set' : 'Setting things up…'}
      </h1>

      <p className="mt-2 text-sm text-zinc-500">
        {isReady
          ? 'Your assistant is ready to go.'
          : 'This usually takes 2–3 minutes.'}
      </p>

      {effectiveIssue && <IssueCard message={effectiveIssue} />}

      <AnimatePresence mode="wait">
        {showRetry ? (
          <motion.div
            key="retry"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-8 flex flex-col items-center"
          >
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onProvision}
              disabled={provisioning}
              className="h-12 w-full max-w-sm rounded-2xl bg-white text-[15px] font-semibold text-zinc-950 transition-colors hover:bg-zinc-200 disabled:opacity-60 px-8"
            >
              {provisioning ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Starting…
                </span>
              ) : (
                'Retry setup'
              )}
            </motion.button>
          </motion.div>
        ) : (
          <motion.div
            key="progress"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="relative mt-8 w-full max-w-sm overflow-hidden"
            style={{ height: MAX_VISIBLE * ITEM_HEIGHT }}
          >
            <motion.div
              animate={{ y: -progressIndex * ITEM_HEIGHT }}
              transition={{ type: 'spring', stiffness: 200, damping: 25 }}
            >
              {PROGRESS_MESSAGES.map((msg, i) => {
                const relativePos = i - progressIndex
                const opacity = OPACITY_BY_OFFSET[relativePos] ?? 0

                return (
                  <motion.div
                    key={msg.key}
                    animate={{ opacity }}
                    transition={{ duration: 0.4 }}
                    style={{ height: ITEM_HEIGHT }}
                    className="flex items-center justify-center gap-3 text-left"
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center">
                      <StepIcon
                        done={i < progressIndex}
                        active={i === progressIndex}
                      />
                    </div>
                    <span
                      className={`text-sm ${
                        i < progressIndex
                          ? 'text-zinc-300'
                          : i === progressIndex
                            ? 'font-medium text-zinc-300'
                            : 'text-zinc-600'
                      }`}
                    >
                      {msg.label}
                    </span>
                  </motion.div>
                )
              })}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
