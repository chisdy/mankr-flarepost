import { useCallback, useEffect, useRef, useState } from "react"

import { mailboxListEndpoint, type MailboxMode, type MailboxPageData } from "@/features/mailbox/mailbox-api"
import { subscribeMailboxListRefresh } from "@/features/mailbox/mailbox-navigation"
import { api } from "@/lib/api"

const empty: MailboxPageData = { items: [], nextCursor: null }

/** The view is keyed by its location; every request belongs to only that mounted list. */
export function useMailboxList(mode: MailboxMode, enabled: boolean, initialPage: MailboxPageData | null) {
  const [page, setPage] = useState<MailboxPageData | null>(initialPage)
  const [pending, setPending] = useState<"first" | "more" | null>(enabled && !initialPage ? "first" : null)
  const [error, setError] = useState<unknown>(null)
  const mounted = useRef(false)
  const request = useRef<AbortController | null>(null)
  const hasInitialPage = useRef(initialPage !== null)

  const fetchPage = useCallback(async (cursor?: string) => {
    if (!enabled || !mounted.current || (cursor && request.current)) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setPending(cursor ? "more" : "first")
    setError(null)
    try {
      const result = await api<MailboxPageData>(mailboxListEndpoint(mode, cursor), { signal: controller.signal })
      if (controller.signal.aborted) return
      if (!cursor) setPage(result)
      else {
        setPage((current) => {
          const existing = new Set(current?.items.map(({ id }) => id))
          return {
            items: [...(current?.items ?? []), ...result.items.filter(({ id }) => !existing.has(id))],
            nextCursor: result.nextCursor,
          }
        })
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause)
    } finally {
      if (request.current === controller && !controller.signal.aborted) {
        request.current = null
        setPending(null)
      }
    }
  }, [enabled, mode])

  useEffect(() => {
    mounted.current = true
    if (!hasInitialPage.current) void fetchPage()
    const unsubscribe = subscribeMailboxListRefresh(() => { void fetchPage() })
    return () => {
      mounted.current = false
      request.current?.abort()
      request.current = null
      unsubscribe()
    }
  }, [fetchPage])

  return {
    ...page ?? empty,
    firstLoading: pending === "first" && !page,
    refreshing: pending === "first",
    loadingMore: pending === "more",
    error,
    initialError: page === null ? error : null,
    setPage,
    reload: fetchPage,
  }
}
