import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Loader2, RefreshCw, Terminal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'

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
        <div className="pointer-events-auto w-[min(92vw,36rem)] overflow-hidden rounded-2xl border border-success/30 bg-background/95 shadow-[0_16px_40px_rgba(0,0,0,0.45)] backdrop-blur">
          <div className="flex items-center gap-2 border-b border-input px-3 py-2">
            <div className="inline-flex items-center gap-2 rounded-lg bg-success/15 px-2 py-1 text-[11px] font-medium text-success-foreground">
              <Terminal className="h-3.5 w-3.5" />
              DEV LOGS
            </div>
            <span className="text-[11px] text-muted-foreground/80">
              status: {statusLabel}
            </span>
            <span className="ml-auto text-[11px] text-muted-foreground/50">
              updated {lastUpdated}
            </span>
            <button
              type="button"
              onClick={() => {
                void statusQuery.refetch()
                void logsQuery.refetch()
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-input text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground/80"
              title="Refresh logs"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-input text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground/80"
              title="Collapse"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="grid gap-2 p-3">
            {statusQuery.data?.vpsFailureReason ? (
              <Alert variant="warning">
                <AlertDescription>
                  {statusQuery.data.vpsFailureReason}
                </AlertDescription>
              </Alert>
            ) : null}

            {logsQuery.isLoading ? (
              <div className="flex items-center gap-2 rounded-xl border border-input bg-card/80 p-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Fetching VPS logs...
              </div>
            ) : logsQuery.isError ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {summarizeError(logsQuery.error)}
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <section>
                  <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground">
                    bootstrap
                  </h3>
                  <pre className="max-h-52 overflow-auto rounded-xl border border-input bg-background/80 p-3 font-mono text-[11px] leading-relaxed text-foreground/80">
                    {clampLog(logsQuery.data?.bootstrapLog)}
                  </pre>
                </section>
                <section>
                  <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground">
                    cloud-init
                  </h3>
                  <pre className="max-h-44 overflow-auto rounded-xl border border-input bg-background/80 p-3 font-mono text-[11px] leading-relaxed text-foreground/80">
                    {clampLog(logsQuery.data?.cloudInitStatus)}
                  </pre>
                </section>
                <section>
                  <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground">
                    cloud-init-output
                  </h3>
                  <pre className="max-h-44 overflow-auto rounded-xl border border-input bg-background/80 p-3 font-mono text-[11px] leading-relaxed text-foreground/80">
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
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-success/40 bg-background/90 px-3 py-2 text-xs font-medium text-success-foreground shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-colors hover:border-success/50 hover:text-foreground"
          title="Open development VPS logs"
        >
          <Terminal className="h-3.5 w-3.5" />
          VPS logs
        </button>
      )}
    </div>
  )
}
