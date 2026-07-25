import { StarIcon, TrashIcon } from "@phosphor-icons/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useLocation, useParams } from "react-router"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  OnboardingBanner,
  OnboardingGuide,
} from "@/features/onboarding/onboarding-guide"
import { api, isApiError } from "@/lib/api"
import { formatMessageTime } from "@/lib/format"
import type { Folder, MailboxViewMode, MessageListItem, Tag } from "@/lib/types"
import { cn } from "@/lib/utils"

function modeFromLocation(
  pathname: string,
  tagIdParam: string | undefined
): MailboxViewMode {
  if (pathname === "/starred" || pathname.startsWith("/starred/")) {
    return { kind: "starred" }
  }
  const tagMatch = pathname.match(/^\/tags\/([^/]+)/)
  if (tagMatch?.[1] || tagIdParam) {
    return { kind: "tag", tagId: tagIdParam || tagMatch![1]! }
  }
  const seg = pathname.replace(/^\//, "").split("/")[0] ?? ""
  if (seg === "sent" || seg === "trash" || seg === "draft") {
    return { kind: "folder", folder: seg }
  }
  return { kind: "folder", folder: "inbox" }
}

function buildListQuery(mode: MailboxViewMode, cursor?: string | null): string {
  const qs = new URLSearchParams()
  if (mode.kind === "starred") qs.set("starred", "1")
  else if (mode.kind === "tag") qs.set("tagId", mode.tagId)
  else qs.set("folder", mode.folder)
  if (cursor) qs.set("cursor", cursor)
  return qs.toString()
}

export function MailboxView() {
  const { t, i18n } = useTranslation()
  const { pathname } = useLocation()
  const { tagId: tagIdParam } = useParams<{ tagId?: string }>()
  const mode = useMemo(
    () => modeFromLocation(pathname, tagIdParam),
    [pathname, tagIdParam]
  )

  const [tagName, setTagName] = useState<string | null>(null)

  useEffect(() => {
    if (mode.kind !== "tag") {
      setTagName(null)
      return
    }
    let cancelled = false
    api<{ tags: Tag[] }>("/api/tags")
      .then((data) => {
        if (cancelled) return
        const found = data.tags.find((x) => x.id === mode.tagId)
        setTagName(found?.name ?? null)
      })
      .catch(() => {
        if (!cancelled) setTagName(null)
      })
    return () => {
      cancelled = true
    }
  }, [mode])

  const meta = useMemo(() => {
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
    }
    const empties: Record<Folder, string> = {
      inbox: t("mailbox.inboxEmpty"),
      sent: t("mailbox.sentEmpty"),
      trash: t("mailbox.trashEmpty"),
      draft: t("mailbox.draftEmpty"),
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

  const load = useCallback(
    async (cursor?: string | null) => {
      const append = Boolean(cursor)
      if (append) setLoadingMore(true)
      else setLoading(true)
      try {
        const qs = buildListQuery(mode, cursor)
        const data = await api<{
          items: MessageListItem[]
          nextCursor: string | null
        }>(`/api/messages?${qs}`)
        setItems((prev) => (append ? [...prev, ...data.items] : data.items))
        setNextCursor(data.nextCursor)
      } catch (err) {
        toast.error(isApiError(err) ? err.message : t("mailbox.loadFailed"))
        if (!append) {
          setItems([])
          setNextCursor(null)
        }
      } finally {
        if (append) setLoadingMore(false)
        else setLoading(false)
      }
    },
    [mode, t]
  )

  useEffect(() => {
    setItems([])
    setNextCursor(null)
    void load()
  }, [load])

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

  async function emptyTrash() {
    if (!window.confirm(t("mailbox.emptyConfirm"))) return
    setEmptying(true)
    try {
      await api("/api/messages/trash", { method: "DELETE" })
      toast.success(t("mailbox.emptied"))
      await load()
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
          folder === "trash" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={emptying || items.length === 0}
              onClick={() => void emptyTrash()}
            >
              <TrashIcon data-icon="inline-start" />
              {emptying ? t("mailbox.emptying") : t("mailbox.emptyTrash")}
            </Button>
          ) : null
        }
      />

      {showBanner ? <OnboardingBanner aliasCount={aliasCount} /> : null}

      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <p className="px-6 py-8 text-sm text-muted-foreground">
            {t("app.loading")}
          </p>
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
                const peer =
                  folder === "sent" || folder === "draft"
                    ? item.toAddrs.join(", ") || t("app.noRecipients")
                    : item.fromAddr
                const href =
                  folder === "draft"
                    ? `/compose?draft=${item.id}`
                    : `/m/${item.id}`
                return (
                  <li key={item.id}>
                    <div className="flex items-stretch gap-1 px-2 sm:px-4">
                      {folder !== "draft" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="mt-2.5 shrink-0"
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
                          !item.isRead && folder !== "draft" && "bg-muted/30"
                        )}
                      >
                        <div className="flex min-w-0 items-baseline justify-between gap-3 sm:contents">
                          <span
                            className={cn(
                              "min-w-0 truncate text-sm sm:w-40 sm:shrink-0",
                              !item.isRead && folder !== "draft"
                                ? "font-semibold"
                                : "text-muted-foreground"
                            )}
                          >
                            {peer}
                          </span>
                          <time
                            className="shrink-0 text-xs text-muted-foreground tabular-nums sm:order-last"
                            dateTime={new Date(item.createdAt).toISOString()}
                            key={`${item.id}-${i18n.language}`}
                          >
                            {formatMessageTime(item.createdAt)}
                          </time>
                        </div>
                        <span
                          className={cn(
                            "min-w-0 truncate text-sm sm:flex-1",
                            !item.isRead && folder !== "draft"
                              ? "font-semibold"
                              : "text-foreground/90"
                          )}
                        >
                          {item.subject || t("app.noSubject")}
                        </span>
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
                  onClick={() => void load(nextCursor)}
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
