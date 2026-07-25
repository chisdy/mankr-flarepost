import { TrashIcon } from "@phosphor-icons/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "react-router"
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
import type { Folder, MessageListItem } from "@/lib/types"
import { cn } from "@/lib/utils"

function folderFromPath(pathname: string): Folder {
  const seg = pathname.replace(/^\//, "")
  if (seg === "sent" || seg === "trash" || seg === "draft") return seg
  return "inbox"
}

export function MailboxView() {
  const { t, i18n } = useTranslation()
  const { pathname } = useLocation()
  const folder = folderFromPath(pathname)

  const meta = useMemo(() => {
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
    return { title: titles[folder], empty: empties[folder] }
  }, [folder, t])

  const [items, setItems] = useState<MessageListItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [emptying, setEmptying] = useState(false)
  const [aliasCount, setAliasCount] = useState<number | null>(null)

  const load = useCallback(async (cursor?: string | null) => {
    const append = Boolean(cursor)
    if (append) setLoadingMore(true)
    else setLoading(true)
    try {
      const qs = new URLSearchParams({ folder })
      if (cursor) qs.set("cursor", cursor)
      const data = await api<{ items: MessageListItem[]; nextCursor: string | null }>(
        `/api/messages?${qs}`
      )
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
  }, [folder, t])

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

  const showEmptyOnboarding = folder === "inbox" && !loading && items.length === 0
  const showBanner = folder === "inbox" && !showEmptyOnboarding

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
          <p className="px-6 py-8 text-sm text-muted-foreground">{t("app.loading")}</p>
        ) : items.length === 0 ? (
          showEmptyOnboarding ? (
            <div className="mx-auto flex max-w-lg flex-col gap-4 px-6 py-10">
              <p className="text-sm text-muted-foreground">{meta.empty}</p>
              <OnboardingGuide aliasCount={aliasCount} />
            </div>
          ) : (
            <p className="px-6 py-8 text-sm text-muted-foreground">{meta.empty}</p>
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
                  folder === "draft" ? `/compose?draft=${item.id}` : `/m/${item.id}`
                return (
                  <li key={item.id}>
                    <Link
                      to={href}
                      className={cn(
                        "flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-baseline sm:gap-3 sm:px-6",
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
