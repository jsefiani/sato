import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

interface UseEventStreamOptions {
  url: string
  enabled: boolean
  queryKey: ReadonlyArray<unknown>
  merge?: boolean
}

export function useEventStream({
  url,
  enabled,
  queryKey,
  merge = false,
}: UseEventStreamOptions) {
  const queryClient = useQueryClient()
  const [isConnected, setIsConnected] = useState(false)
  const queryKeyRef = useRef(queryKey)
  queryKeyRef.current = queryKey

  useEffect(() => {
    if (!enabled) {
      setIsConnected(false)
      return
    }

    const eventSource = new EventSource(url)

    eventSource.addEventListener('open', () => {
      setIsConnected(true)
    })

    eventSource.addEventListener('message', (event) => {
      try {
        const parsed = JSON.parse(event.data)
        if (merge) {
          queryClient.setQueryData(queryKeyRef.current, (old: unknown) =>
            old && typeof old === 'object'
              ? { ...(old as Record<string, unknown>), ...parsed }
              : old,
          )
        } else {
          queryClient.setQueryData(queryKeyRef.current, parsed)
        }
      } catch {
        // ignore malformed events
      }
    })

    eventSource.addEventListener('error', () => {
      setIsConnected(false)
    })

    return () => {
      eventSource.close()
      setIsConnected(false)
    }
  }, [url, enabled, merge, queryClient])

  return { isConnected }
}
