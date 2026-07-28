import { MagnifyingGlassIcon, StarIcon, TrashIcon } from "@phosphor-icons/react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Link,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import {
  OnboardingBanner,
  OnboardingGuide,
} from "@/features/onboarding/onboarding-guide"
import { api, isApiError } from "@/lib/api"
import { formatMessageTime } from "@/lib/format"
import type { Folder, MailboxViewMode, MessageListItem, Tag } from "@/lib/types"
import { cn } from "@/lib/utils"

function MessageListSkeleton({
  count = 8,
  label,
  showStar = true,
}: {
  count?: number
  label: string
  showStar?: boolean
}) {
  return (
    <ul
      className="divide-y divide-border"
      aria-busy="true"
      aria-live="polite"
      aria-label={label}
    >
      {Array.from({ length: count }, (_, index) => (
        <li key={index}>
          <div className="flex items-stretch gap-1 px-2 sm:px-4">
            {showStar ? (
              <Skeleton className="mt-2.5 size-8 shrink-0 rounded-lg" />
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col gap-2 py-3 sm:flex-row sm:items-baseline sm:gap-3 sm:px-2">
              <div className="flex min-w-0 items-baseline justify-between gap-3 sm:contents">
                <Skeleton className="h-4 w-28 sm:w-40 sm:shrink-0" />
                <Skeleton className="h-3 w-12 sm:order-last" />
              </div>
              <Skeleton className="h-4 w-full max-w-md sm:flex-1" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function modeFromLocation(
  pathname: string,
  tagIdParam: string | undefined,
  searchQuery: string
): MailboxViewMode {
  if (pathname === "/search" || pathname.startsWith("/search/")) {
    return { kind: "search", query: searchQuery }
  }
  if (pathname === "/starred" || pathname.startsWith("/starred/")) {
    return { kind: "starred" }
  }
  const tagMatch = pathname.match(/^\/tags\/([^/]+)/)
  if (tagMatch?.[1] || tagIdParam) {
    return { kind: "tag", tagId: tagIdParam || tagMatch![1]! }
  }
  const seg = pathname.replace(/^\//, "").split("/")[0] ?? ""
  if (seg === "sent" || seg === "trash" || seg === "draft" || seg === "spam") {
    return { kind: "folder", folder: seg }
  }
  return { kind: "folder", folder: "inbox" }
}

function buildListQuery(mode: MailboxViewMode, cursor?: string | null): string {
  const qs = new URLSearchParams()
  if (mode.kind === "starred") qs.set("starred", "1")
  else if (mode.kind === "tag") qs.set("tagId", mode.tagId)
  else if (mode.kind === "search") qs.set("q", mode.query)
  else qs.set("folder", mode.folder)
  if (cursor) qs.set("cursor", cursor)
  return qs.toString()
}

export function MailboxView() {
  const { t, i18n } = useTranslation()
  const { pathname } = useLocation()
  const { tagId: tagIdParam } = useParams<{ tagId?: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlQuery = searchParams.get("q") ?? ""
  const [searchInput, setSearchInput] = useState(urlQuery)
  const [prevUrlQuery, setPrevUrlQuery] = useState(urlQuery)

  const mode = useMemo(
    () => modeFromLocation(pathname, tagIdParam, urlQuery.trim()),
    [pathname, tagIdParam, urlQuery]
  )

  // Sync draft input from URL when the query param changes (render-time adjust).
  if (urlQuery !== prevUrlQuery) {
    setPrevUrlQuery(urlQuery)
    if (mode.kind === "search") setSearchInput(urlQuery)
  }

  const tagId = mode.kind === "tag" ? mode.tagId : null
  const [tagName, setTagName] = useState<string | null>(null)
  const [tagNameForId, setTagNameForId] = useState<string | null>(null)

  if (tagId !== tagNameForId) {
    setTagNameForId(tagId)
    setTagName(null)
  }

  useEffect(() => {
    if (!tagId) return
    let cancelled = false
    api<{ tags: Tag[] }>("/api/tags")
      .then((data) => {
        if (cancelled) return
        const found = data.tags.find((x) => x.id === tagId)
        setTagName(found?.name ?? null)
      })
      .catch(() => {
        if (!cancelled) setTagName(null)
      })
    return () => {
      cancelled = true
    }
  }, [tagId])

  const meta = useMemo(() => {
    if (mode.kind === "search") {
      return {
        title: mode.query
          ? t("mailbox.searchTitle", { query: mode.query })
          : t("nav.search"),
        empty: mode.query
          ? t("mailbox.searchEmpty")
          : t("mailbox.searchHint"),
      }
    }
    if (mode.kind === "starred") {
      return { title: t("nav.starred"), empty: t("mailbox.starredEmpty") }
    }
    if (mode.kind === "tag") {
      return {
        title: tagName ? t("mailbox.tagTitle", { name: tagName }) : t("nav.tags"),
        empty: t("mailbox.tagEmpty"),
      }
    }
    const titles: Record<Folder, string> = {
      inbox: t("nav.inbox"),
      sent: t("nav.sent"),
      trash: t("nav.trash"),
      draft: t("nav.drafts"),
      spam: t("nav.spam"),
    }
    const empties: Record<Folder, string> = {
      inbox: t("mailbox.inboxEmpty"),
      sent: t("mailbox.sentEmpty"),
      trash: t("mailbox.trashEmpty"),
      draft: t("mailbox.draftEmpty"),
      spam: t("mailbox.spamEmpty"),
    }
    return { title: titles[mode.folder], empty: empties[mode.folder] }
  }, [mode, t, tagName])

  const [items, setItems] = useState<MessageListItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [emptying, setEmptying] = useState(false)
  const [aliasCount, setAliasCount] = useState<number | null>(null)
  const [starringId, setStarringId] = useState<string | null>(null)

  const listKey = useMemo(() => buildListQuery(mode), [mode])
  const [activeListKey, setActiveListKey] = useState(listKey)
  const searchWithoutQuery = mode.kind === "search" && !mode.query

  if (listKey !== activeListKey) {
    setActiveListKey(listKey)
    setItems([])
    setNextCursor(null)
    setLoading(!searchWithoutQuery)
    setLoadingMore(false)
  } else if (searchWithoutQuery && loading) {
    setLoading(false)
  }

  useEffect(() => {
    if (searchWithoutQuery) return

    let cancelled = false
    const qs = buildListQuery(mode)
    const path =
      mode.kind === "search"
        ? `/api/messages/search?${qs}`
        : `/api/messages?${qs}`

    api<{ items: MessageListItem[]; nextCursor: string | null }>(path)
      .then((data) => {
        if (cancelled) return
        setItems(data.items)
        setNextCursor(data.nextCursor)
      })
      .catch((err) => {
        if (cancelled) return
        toast.error(isApiError(err) ? err.message : t("mailbox.loadFailed"))
        setItems([])
        setNextCursor(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [listKey, mode, searchWithoutQuery, t])

  async function loadMore() {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const qs = buildListQuery(mode, nextCursor)
      const path =
        mode.kind === "search"
          ? `/api/messages/search?${qs}`
          : `/api/messages?${qs}`
      const data = await api<{
        items: MessageListItem[]
        nextCursor: string | null
      }>(path)
      setItems((prev) => [...prev, ...data.items])
      setNextCursor(data.nextCursor)
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("mailbox.loadFailed"))
    } finally {
      setLoadingMore(false)
    }
  }

  async function reload() {
    if (searchWithoutQuery) {
      setItems([])
      setNextCursor(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const qs = buildListQuery(mode)
      const path =
        mode.kind === "search"
          ? `/api/messages/search?${qs}`
          : `/api/messages?${qs}`
      const data = await api<{
        items: MessageListItem[]
        nextCursor: string | null
      }>(path)
      setItems(data.items)
      setNextCursor(data.nextCursor)
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("mailbox.loadFailed"))
      setItems([])
      setNextCursor(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    api<{ aliases: { id: string }[] }>("/api/aliases")
      .then((data) => {
        if (!cancelled) setAliasCount(data.aliases.length)
      })
      .catch(() => {
        if (!cancelled) setAliasCount(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function submitSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = searchInput.trim()
    setSearchParams(q ? { q } : {}, { replace: true })
  }

  async function emptyFolder(target: "trash" | "spam") {
    const confirmKey =
      target === "spam" ? "mailbox.emptySpamConfirm" : "mailbox.emptyConfirm"
    if (!window.confirm(t(confirmKey))) return
    setEmptying(true)
    try {
      await api(`/api/messages/${target}`, { method: "DELETE" })
      toast.success(t("mailbox.emptied"))
      await reload()
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("mailbox.emptyFailed"))
    } finally {
      setEmptying(false)
    }
  }

  async function toggleStar(e: React.MouseEvent, item: MessageListItem) {
    e.preventDefault()
    e.stopPropagation()
    setStarringId(item.id)
    const next = !item.isStarred
    try {
      await api(`/api/messages/${item.id}/star`, {
        method: "POST",
        body: JSON.stringify({ starred: next }),
      })
      setItems((prev) =>
        prev
          .map((m) => (m.id === item.id ? { ...m, isStarred: next } : m))
          .filter((m) => !(mode.kind === "starred" && !m.isStarred))
      )
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("mailbox.starFailed"))
    } finally {
      setStarringId(null)
    }
  }

  const folder = mode.kind === "folder" ? mode.folder : null
  const showEmptyOnboarding =
    mode.kind === "folder" &&
    mode.folder === "inbox" &&
    !loading &&
    items.length === 0
  const showBanner =
    mode.kind === "folder" && mode.folder === "inbox" && !showEmptyOnboarding

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader
        title={meta.title}
        actions={
          folder === "trash" || folder === "spam" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={emptying || items.length === 0}
              onClick={() => void emptyFolder(folder)}
            >
              <TrashIcon data-icon="inline-start" />
              {emptying
                ? t("mailbox.emptying")
                : folder === "spam"
                  ? t("mailbox.emptySpam")
                  : t("mailbox.emptyTrash")}
            </Button>
          ) : null
        }
      />

      {mode.kind === "search" ? (
        <form
          className="flex gap-2 border-b border-border px-4 py-3 sm:px-6"
          onSubmit={submitSearch}
        >
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("mailbox.searchPlaceholder")}
            aria-label={t("nav.search")}
            autoFocus
          />
          <Button type="submit" variant="outline">
            <MagnifyingGlassIcon data-icon="inline-start" />
            {t("mailbox.searchAction")}
          </Button>
        </form>
      ) : null}

      {showBanner ? <OnboardingBanner aliasCount={aliasCount} /> : null}

      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <MessageListSkeleton
            label={t("app.loading")}
            showStar={folder !== "draft"}
          />
        ) : items.length === 0 ? (
          showEmptyOnboarding ? (
            <div className="mx-auto flex max-w-lg flex-col gap-4 px-6 py-10">
              <p className="text-sm text-muted-foreground">{meta.empty}</p>
              <OnboardingGuide aliasCount={aliasCount} />
            </div>
          ) : (
            <p className="px-6 py-8 text-sm text-muted-foreground">
              {meta.empty}
            </p>
          )
        ) : (
          <>
            <ul className="divide-y divide-border">
              {items.map((item) => {
                const listFolder = folder ?? item.folder
                const peer =
                  listFolder === "sent" || listFolder === "draft"
                    ? item.toAddrs.join(", ") || t("app.noRecipients")
                    : item.fromAddr
                const href =
                  listFolder === "draft"
                    ? `/compose?draft=${item.id}`
                    : `/m/${item.id}`
                return (
                  <li key={item.id}>
                    <div className="flex items-stretch gap-1 px-2 sm:px-4">
                      {listFolder !== "draft" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="mt-2.5 shrink-0 text-muted-foreground hover:bg-amber-500/10 hover:text-amber-500"
                          disabled={starringId === item.id}
                          aria-label={
                            item.isStarred
                              ? t("mailbox.unstar")
                              : t("mailbox.star")
                          }
                          onClick={(e) => void toggleStar(e, item)}
                        >
                          <StarIcon
                            weight={item.isStarred ? "fill" : "regular"}
                            className={
                              item.isStarred ? "text-amber-500" : undefined
                            }
                          />
                        </Button>
                      ) : null}
                      <Link
                        to={href}
                        className={cn(
                          "flex min-w-0 flex-1 flex-col gap-1 py-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-baseline sm:gap-3 sm:px-2",
                          !item.isRead && listFolder !== "draft" && "bg-muted/30"
                        )}
                      >
                        <div className="flex min-w-0 items-baseline justify-between gap-3 sm:contents">
                          <span
                            className={cn(
                              "min-w-0 truncate text-sm sm:w-40 sm:shrink-0",
                              !item.isRead && listFolder !== "draft"
                                ? "font-semibold text-foreground"
                                : "text-muted-foreground/70"
                            )}
                          >
                            {peer}
                          </span>
                          <time
                            className={cn(
                              "shrink-0 text-xs tabular-nums sm:order-last",
                              !item.isRead && listFolder !== "draft"
                                ? "text-muted-foreground"
                                : "text-muted-foreground/55"
                            )}
                            dateTime={new Date(item.createdAt).toISOString()}
                            key={`${item.id}-${i18n.language}`}
                          >
                            {formatMessageTime(item.createdAt)}
                          </time>
                        </div>
                        <span
                          className={cn(
                            "min-w-0 truncate text-sm sm:flex-1",
                            !item.isRead && listFolder !== "draft"
                              ? "font-semibold text-foreground"
                              : "text-muted-foreground"
                          )}
                        >
                          {item.subject || t("app.noSubject")}
                        </span>
                        {mode.kind === "search" ? (
                          <span className="hidden text-xs text-muted-foreground sm:inline sm:w-16 sm:shrink-0">
                            {t(`nav.${item.folder === "draft" ? "drafts" : item.folder}`)}
                          </span>
                        ) : null}
                      </Link>
                    </div>
                  </li>
                )
              })}
            </ul>
            {nextCursor ? (
              <div className="flex justify-center px-6 py-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? t("app.loading") : t("mailbox.loadMore")}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </ScrollArea>
    </div>
  )
}
