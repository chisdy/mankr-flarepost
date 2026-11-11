import { Delete02Icon, RefreshIcon, StarIcon } from "@hugeicons/core-free-icons"
import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import { useTranslation } from "react-i18next"
import { Link, useLocation, useNavigationType, useParams, useSearchParams } from "react-router"
import { toast } from "sonner"

import { Icon } from "@/components/icon"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import {
  MAX_BULK_MESSAGES,
  applyMailboxBulk,
  mailboxMode,
  undoMailboxBulk,
  type BulkMailboxAction,
  type MailboxMode,
} from "@/features/mailbox/mailbox-api"
import { MailboxBulkToolbar } from "@/features/mailbox/mailbox-bulk-toolbar"
import {
  patchMailboxReturnSnapshot,
  readMailboxReturnSnapshot,
  requestMailboxListRefresh,
  saveMailboxReturnSnapshot,
  type MailboxNavigationState,
} from "@/features/mailbox/mailbox-navigation"
import { MailboxSearch } from "@/features/mailbox/mailbox-search"
import { useMailboxList } from "@/features/mailbox/use-mailbox-list"
import {
  OnboardingBanner,
  OnboardingGuide,
} from "@/features/onboarding/onboarding-guide"
import { api, isApiError } from "@/lib/api"
import { formatMessageTime } from "@/lib/format"
import { invalidateMailboxMetadata, useMailboxAliasState, useMailboxTagState } from "@/lib/mailbox-metadata"
import type { MessageListItem } from "@/lib/types"
import { cn } from "@/lib/utils"

function MessageListSkeleton({ label, showStar }: { label: string; showStar: boolean }) {
  return (
    <ul className="flex flex-col gap-1 px-2 py-2 sm:py-4" aria-busy="true" aria-label={label}>
      {Array.from({ length: 8 }, (_, index) => (
        <li key={index}>
          <div className="flex min-h-16 items-center gap-2 pl-1 pr-3 sm:min-h-14 sm:gap-3 sm:pl-3 sm:pr-6">
            {showStar ? <Skeleton className="size-10 shrink-0 rounded-lg" /> : null}
            <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(8rem,0.7fr)_minmax(0,1.6fr)_6.5rem] sm:gap-x-5">
              <Skeleton className="h-3 w-3/4 max-w-40" />
              <Skeleton className="col-span-2 row-start-2 h-4 w-3/4 max-w-xs sm:col-span-1 sm:col-start-2 sm:row-start-1" />
              <Skeleton className="col-start-2 row-start-1 h-3 w-10 sm:col-start-3" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function isBulkEligible(item: MessageListItem) {
  return item.folder === "inbox" || item.folder === "archive" || item.folder === "sent"
}

export function MailboxView() {
  const { pathname, search, state } = useLocation()
  const { tagId } = useParams<{ tagId?: string }>()
  const navType = useNavigationType()
  const path = pathname + search
  const mode = useMemo(() => mailboxMode(pathname, tagId, search), [pathname, tagId, search])
  return (
    <MailboxList
      key={path}
      path={path}
      mode={mode}
      restore={navType === "POP" || state?.restoreMailbox === true}
    />
  )
}

function MailboxList({ path, mode, restore }: { path: string; mode: MailboxMode; restore: boolean }) {
  const { t, i18n } = useTranslation()
  const [, setSearchParams] = useSearchParams()
  const [snapshot] = useState(() => restore ? readMailboxReturnSnapshot(path) : null)
  const hasSearch = mode.kind !== "search" || Object.keys(mode.filters).length > 0
  const { items, nextCursor, firstLoading, refreshing, loadingMore, error, initialError, setPage, reload } =
    useMailboxList(mode, hasSearch, snapshot)
  const folder = mode.kind === "folder" ? mode.folder : null
  const { data: tags, failed: tagsFailed } = useMailboxTagState(mode.kind !== "folder" || (folder !== "draft" && folder !== "spam" && folder !== "trash"))
  const { data: aliases, failed: aliasesFailed } = useMailboxAliasState(folder === "inbox" || mode.kind === "search")
  const viewport = useRef<HTMLDivElement>(null)
  const selectionTrigger = useRef<HTMLButtonElement>(null)
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [mutating, setMutating] = useState<"bulk" | "empty" | string | null>(null)
  const mutation = useRef(false)
  const eligible = useMemo(() => items.filter(isBulkEligible), [items])
  const selected = eligible.filter((item) => selectedIds.has(item.id))
  const navigation = useMemo<MailboxNavigationState>(() => ({
    mailboxPath: path,
    messageIds: items.filter((item) => item.folder !== "draft").map((item) => item.id),
  }), [items, path])

  useLayoutEffect(() => {
    if (snapshot && viewport.current) viewport.current.scrollTop = snapshot.scrollTop
  }, [snapshot])

  const title = mode.kind === "search"
    ? mode.filters.q ? t("mailbox.searchTitle", { query: mode.filters.q }) : t("nav.search")
    : mode.kind === "tag"
      ? tags?.find((tag) => tag.id === mode.tagId)?.name || t("nav.tags")
      : t(`nav.${folder === "draft" ? "drafts" : folder ?? "starred"}`)
  const empty = mode.kind === "search"
    ? t(hasSearch ? "mailbox.searchEmpty" : "mailbox.searchHint")
    : mode.kind === "tag" ? t("mailbox.tagEmpty") : t(`mailbox.${folder ?? "starred"}Empty`)
  const showEmptyOnboarding = folder === "inbox" && !firstLoading && items.length === 0

  function rememberList(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    saveMailboxReturnSnapshot({ path, items, nextCursor, scrollTop: viewport.current?.scrollTop ?? 0 })
  }

  function toggleSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (!next.delete(id) && next.size < MAX_BULK_MESSAGES) next.add(id)
      return next
    })
  }

  function stopSelecting() {
    setSelecting(false)
    setSelectedIds(new Set())
    selectionTrigger.current?.focus()
  }

  async function runMutation(id: string, work: () => Promise<void>, fallback: string) {
    if (mutation.current) return
    mutation.current = true
    setMutating(id)
    try {
      await work()
    } catch (cause) {
      toast.error(isApiError(cause) ? cause.body.message || fallback : fallback)
    } finally {
      mutation.current = false
      setMutating(null)
    }
  }

  async function undo(token: string) {
    try {
      const { changed } = await undoMailboxBulk(token)
      invalidateMailboxMetadata()
      requestMailboxListRefresh()
      if (changed) toast.success(t("mailbox.bulkUndone", { count: changed }))
      else toast.info(t("mailbox.bulkUndoEmpty"))
    } catch {
      toast.error(t("mailbox.bulkUndoFailed"))
    }
  }

  function applyBulk(action: BulkMailboxAction, tagId?: string) {
    const ids = selected.map(({ id }) => id)
    if (!ids.length) return
    void runMutation("bulk", async () => {
      const { changed, undoToken } = await applyMailboxBulk(ids, action, tagId)
      stopSelecting()
      invalidateMailboxMetadata()
      requestMailboxListRefresh()
      if (!changed) {
        toast.info(t("mailbox.bulkNoChange"))
        return
      }
      const message = t(`mailbox.bulkResult.${action}`, { count: changed })
      toast.success(message, undoToken ? {
        duration: 12_000,
        action: { label: t("mailbox.bulkUndo"), onClick: () => { void undo(undoToken) } },
      } : undefined)
    }, t("mailbox.bulkFailed"))
  }

  function emptyFolder(target: "trash" | "spam") {
    if (mutation.current || !window.confirm(t(target === "spam" ? "mailbox.emptySpamConfirm" : "mailbox.emptyConfirm"))) return
    void runMutation("empty", async () => {
      await api(`/api/messages/${target}`, { method: "DELETE" })
      toast.success(t("mailbox.emptied"))
      invalidateMailboxMetadata()
      requestMailboxListRefresh()
    }, t("mailbox.emptyFailed"))
  }

  function toggleStar(item: MessageListItem) {
    const isStarred = !item.isStarred
    void runMutation(item.id, async () => {
      await api(`/api/messages/${item.id}/star`, {
        method: "POST",
        body: JSON.stringify({ starred: isStarred }),
      })
      patchMailboxReturnSnapshot(item.id, { isStarred })
      setPage((current) => current && {
        ...current,
        items: current.items.flatMap((row) => row.id !== item.id
          ? [row]
          : mode.kind === "starred" && !isStarred ? [] : [{ ...row, isStarred }]),
      })
      invalidateMailboxMetadata()
    }, t("mailbox.starFailed"))
  }

  const messageError = error ? isApiError(error) ? error.body.message || t("mailbox.loadFailed") : t("mailbox.loadFailed") : null

  return (
    <div className="group/mailbox flex h-full min-h-0 flex-1 flex-col" data-search={mode.kind === "search"}>
      <PageHeader
        title={title}
        actions={
          <>
            {eligible.length || selecting ? (
              <Button
                ref={selectionTrigger}
                type="button"
                variant={selecting ? "secondary" : "outline"}
                size="sm"
                disabled={!!mutating}
                aria-expanded={selecting}
                onClick={selecting ? stopSelecting : () => setSelecting(true)}
              >
                {t(selecting ? "mailbox.bulkDone" : "mailbox.bulkSelect")}
              </Button>
            ) : null}
            {folder === "trash" || folder === "spam" ? (
              <Button type="button" variant="outline" size="sm" disabled={!!mutating || !items.length} onClick={() => emptyFolder(folder)}>
                <Icon icon={Delete02Icon} data-icon="inline-start" />
                {mutating === "empty"
                  ? t("mailbox.emptying")
                  : t(folder === "spam" ? "mailbox.emptySpam" : "mailbox.emptyTrash")}
              </Button>
            ) : null}
            {hasSearch ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={!!mutating || refreshing}
                aria-label={t("mailbox.refresh")}
                title={t("mailbox.refresh")}
                onClick={() => {
                  invalidateMailboxMetadata(...(folder === "inbox" || mode.kind === "search"
                    ? ["counts", "aliases", "tags"] as const : ["counts", "tags"] as const))
                  void reload()
                }}
              >
                <Icon icon={RefreshIcon} className={cn(refreshing && "motion-safe:animate-spin")} />
              </Button>
            ) : null}
          </>
        }
      />

      {mode.kind === "search" ? (
        <MailboxSearch
          filters={mode.filters}
          aliases={aliases}
          tags={tags}
          metadataFailed={(aliasesFailed && !aliases) || (tagsFailed && !tags)}
          onRetryMetadata={() => invalidateMailboxMetadata("aliases", "tags")}
          onSearch={setSearchParams}
        />
      ) : null}

      {selecting ? (
        <MailboxBulkToolbar
          selected={selected}
          available={eligible.length}
          busy={!!mutating}
          tags={tags}
          onSelectAll={() => setSelectedIds(new Set(eligible.slice(0, MAX_BULK_MESSAGES).map(({ id }) => id)))}
          onClear={() => setSelectedIds(new Set())}
          onApply={applyBulk}
        />
      ) : null}

      <ScrollArea className="min-h-0 flex-1" viewportRef={viewport}>
        {folder === "inbox" && !showEmptyOnboarding && !firstLoading && !initialError ? (
          <OnboardingBanner aliasCount={aliases?.length ?? null} />
        ) : null}
        {firstLoading ? (
          <MessageListSkeleton label={t("app.loading")} showStar={folder !== "draft"} />
        ) : initialError ? (
          <div className="flex flex-col items-start gap-3 px-5 py-8 sm:px-7">
            <p role="alert" className="text-sm text-destructive">{messageError}</p>
            <Button variant="outline" onClick={() => void reload()}>{t("mailbox.retry")}</Button>
          </div>
        ) : (
          <>
            {messageError ? <p role="alert" className="px-4 py-2 text-sm text-destructive sm:px-7">{messageError}</p> : null}
            {!items.length ? showEmptyOnboarding ? (
              <div className="mx-auto flex max-w-lg flex-col gap-4 px-6 py-10">
                <p className="text-sm text-muted-foreground">{empty}</p>
                <OnboardingGuide aliasCount={aliases?.length ?? null} />
              </div>
            ) : <p className="px-6 py-8 text-sm text-muted-foreground">{empty}</p> : (
              <ul className="flex flex-col gap-1 px-2 py-2 sm:py-4" aria-label={title}>
                {items.map((item) => {
                  const draft = item.folder === "draft"
                  const peer = item.folder === "sent" || draft
                    ? item.toAddrs.join(", ") || t("app.noRecipients")
                    : item.fromAddr
                  const unread = !item.isRead && !draft
                  const subject = item.subject || t("app.noSubject")
                  return (
                    <li key={item.id} data-unread={unread || undefined} className={cn("post-row", selecting && selectedIds.has(item.id) && "!bg-accent")}>
                      <div className="flex min-h-16 items-center gap-2 pl-1 pr-3 sm:min-h-14 sm:gap-3 sm:pl-3 sm:pr-6">
                        {selecting ? (
                          <div className="grid size-10 shrink-0 place-items-center">
                            <Checkbox
                              checked={selectedIds.has(item.id)}
                              aria-label={t("mailbox.bulkSelectMessage", { subject })}
                              disabled={!!mutating || !isBulkEligible(item) || (selectedIds.size >= MAX_BULK_MESSAGES && !selectedIds.has(item.id))}
                              onCheckedChange={() => toggleSelection(item.id)}
                            />
                          </div>
                        ) : !draft ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-lg"
                            aria-pressed={item.isStarred}
                            className="size-10 shrink-0 text-muted-foreground hover:bg-accent hover:text-primary"
                            disabled={!!mutating || refreshing}
                            aria-label={item.isStarred ? t("mailbox.unstar") : t("mailbox.star")}
                            onClick={() => toggleStar(item)}
                          >
                            <Icon icon={StarIcon} strokeWidth={item.isStarred ? 2.25 : 1.5} className={item.isStarred ? "text-amber-700 dark:text-amber-400" : undefined} />
                          </Button>
                        ) : null}
                        <Link
                          to={draft ? `/compose?draft=${item.id}` : `/m/${item.id}`}
                          state={navigation}
                          onClick={draft ? undefined : rememberList}
                          className={cn(
                            "grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 rounded-sm py-3 sm:grid-cols-[minmax(8rem,0.7fr)_minmax(0,1.6fr)_6.5rem] sm:gap-x-5",
                            mode.kind === "search" && "lg:grid-cols-[minmax(8rem,0.7fr)_minmax(0,1.6fr)_5rem_6.5rem]"
                          )}
                        >
                          {unread ? <span className="sr-only">{t("mailbox.unread")}</span> : null}
                          <span className={cn("min-w-0 truncate text-xs sm:text-sm", unread ? "font-semibold text-foreground" : "text-muted-foreground")}>{peer}</span>
                          <time
                            className="col-start-2 row-start-1 justify-self-end text-right text-xs text-muted-foreground tabular-nums sm:col-start-3 lg:group-data-[search=true]/mailbox:col-start-4"
                            dateTime={new Date(item.createdAt).toISOString()}
                            key={i18n.language}
                          >
                            {formatMessageTime(item.createdAt)}
                          </time>
                          <span className={cn("col-span-2 row-start-2 min-w-0 truncate text-sm sm:col-span-1 sm:col-start-2 sm:row-start-1", unread && "font-semibold")}>{subject}</span>
                          {mode.kind === "search" ? (
                            <span className="hidden truncate text-xs text-muted-foreground lg:col-start-3 lg:row-start-1 lg:block">
                              {t(`nav.${item.folder === "draft" ? "drafts" : item.folder}`)}
                            </span>
                          ) : null}
                        </Link>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {nextCursor ? (
              <div className="flex justify-center px-6 py-4">
                <Button type="button" variant="outline" size="sm" disabled={loadingMore || refreshing || !!mutating} onClick={() => void reload(nextCursor)}>
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
