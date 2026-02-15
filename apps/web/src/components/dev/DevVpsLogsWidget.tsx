import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Loader2, RefreshCw, Terminal } from 'lucide-react'
import { useMemo, useState } from 'react'

interface VpsLogsPayload {
  bootstrapLog?: string
  cloudInitStatus?: string
  cloudInitOutput?: string
  error?: string
}

interface VpsStatusPayload {
  vpsFailureReason?: string | null
  vps?: {
    status?: string
    ipv4Address?: string | null
  } | null
}

const MAX_LOG_CHARS = 12_000

function clampLog(value: string | undefined): string {
  const normalized = value?.trim() ?? ''
  if (!normalized) {
    return 'No log output yet.'
  }

  if (normalized.length <= MAX_LOG_CHARS) {
    return normalized
  }

  return normalized.slice(normalized.length - MAX_LOG_CHARS)
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unknown error'
}

export default function DevVpsLogsWidget() {
  const [open, setOpen] = useState(false)

  const statusQuery = useQuery({
    queryKey: ['setup-status'],
    queryFn: async () => {
      const res = await fetch('/api/vps/status')
      const payload = (await res.json()) as VpsStatusPayload & {
        error?: string
      }

      if (!res.ok) {
        throw new Error(payload.error ?? 'Failed to load VPS status')
      }

      return payload
    },
    enabled: open,
    refetchInterval: open ? 5000 : false,
  })

  const logsQuery = useQuery({
    queryKey: ['dev-vps-logs-widget'],
    queryFn: async () => {
      const res = await fetch('/api/vps/logs')
      const payload = (await res.json()) as VpsLogsPayload & {
        error?: string
      }

      if (!res.ok) {
        throw new Error(payload.error ?? 'Failed to load VPS logs')
      }

      return payload
    },
    enabled: open,
    refetchInterval: open ? 5000 : false,
  })

  const statusLabel =
    statusQuery.data?.vps?.status?.trim() ||
    (statusQuery.isLoading ? 'loading' : 'no-vps')

  const lastUpdated = useMemo(() => {
    if (!logsQuery.dataUpdatedAt) {
      return 'never'
    }

    return new Date(logsQuery.dataUpdatedAt).toLocaleTimeString()
  }, [logsQuery.dataUpdatedAt])

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60]">
      {open ? (
        <div className="pointer-events-auto w-[min(92vw,36rem)] overflow-hidden rounded-2xl border border-emerald-300/20 bg-zinc-950/95 shadow-[0_16px_40px_rgba(0,0,0,0.45)] backdrop-blur">
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
            <div className="inline-flex items-center gap-2 rounded-lg bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-200">
              <Terminal className="h-3.5 w-3.5" />
              DEV LOGS
            </div>
            <span className="text-[11px] text-zinc-500">
              status: {statusLabel}
            </span>
            <span className="ml-auto text-[11px] text-zinc-600">
              updated {lastUpdated}
            </span>
            <button
              type="button"
              onClick={() => {
                void statusQuery.refetch()
                void logsQuery.refetch()
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-200"
              title="Refresh logs"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-200"
              title="Collapse"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="grid gap-2 p-3">
            {statusQuery.data?.vpsFailureReason ? (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-100">
                {statusQuery.data.vpsFailureReason}
              </div>
            ) : null}

            {logsQuery.isLoading ? (
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-900/80 p-3 text-xs text-zinc-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Fetching VPS logs...
              </div>
            ) : logsQuery.isError ? (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
                {summarizeError(logsQuery.error)}
              </div>
            ) : (
              <>
                <section>
                  <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-zinc-400">
                    bootstrap
                  </h3>
                  <pre className="max-h-52 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
                    {clampLog(logsQuery.data?.bootstrapLog)}
                  </pre>
                </section>
                <section>
                  <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-zinc-400">
                    cloud-init
                  </h3>
                  <pre className="max-h-44 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
                    {clampLog(logsQuery.data?.cloudInitStatus)}
                  </pre>
                </section>
                <section>
                  <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-zinc-400">
                    cloud-init-output
                  </h3>
                  <pre className="max-h-44 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
                    {clampLog(logsQuery.data?.cloudInitOutput)}
                  </pre>
                </section>
              </>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-zinc-950/90 px-3 py-2 text-xs font-medium text-emerald-100 shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-colors hover:border-emerald-200/40 hover:text-white"
          title="Open development VPS logs"
        >
          <Terminal className="h-3.5 w-3.5" />
          VPS logs
        </button>
      )}
    </div>
  )
}
