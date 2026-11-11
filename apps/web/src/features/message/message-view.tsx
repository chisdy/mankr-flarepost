import { Attachment01Icon, Mail01Icon } from "@hugeicons/core-free-icons"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { useLocation, useNavigate, useParams } from "react-router"
import { toast } from "sonner"

import { Icon } from "@/components/icon"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import {
  applyMailboxBulk,
  undoMailboxBulk,
} from "@/features/mailbox/mailbox-api"
import {
  patchMailboxReturnSnapshot,
  requestMailboxListRefresh,
  type MailboxNavigationState,
} from "@/features/mailbox/mailbox-navigation"
import { api, isApiError } from "@/lib/api"
import { invalidateMailboxMetadata } from "@/lib/mailbox-metadata"
import { sanitizeMail } from "@/lib/sanitize"
import type { MessageDetail, Tag } from "@/lib/types"

import { MessageFooter, MessageToolbar } from "./message-actions"
import { MessageEnvelope } from "./message-envelope"

interface MessagePaperProps {
  children: ReactNode
  labelledBy?: string
}

function MessagePaper({ children, labelledBy }: MessagePaperProps) {
  return (
    <div className="w-full px-2 pt-1 pb-3 sm:px-4 sm:pb-5">
      <article
        aria-labelledby={labelledBy}
        className="min-w-0 rounded-xl bg-card px-4 pt-6 pb-9 text-card-foreground sm:rounded-2xl sm:px-8 sm:pt-8 sm:pb-12"
      >
        {children}
      </article>
    </div>
  )
}

function MessageDetailSkeleton({ label }: { label: string }) {
  return (
    <>
      <p className="sr-only" role="status">
        {label}
      </p>
      <MessagePaper>
        <div aria-hidden="true">
          <div className="flex flex-col gap-4 border-b border-border pb-5">
            <Skeleton className="h-8 w-3/4 max-w-md rounded-md motion-reduce:animate-none sm:h-9" />
            <div className="flex items-center gap-3">
              <Skeleton className="size-9 rounded-lg motion-reduce:animate-none sm:size-10" />
              <div className="flex flex-col gap-2">
                <Skeleton className="h-3.5 w-40 motion-reduce:animate-none" />
                <Skeleton className="h-3 w-28 motion-reduce:animate-none" />
              </div>
            </div>
            <Skeleton className="h-7 w-20 rounded-lg motion-reduce:animate-none" />
          </div>
          <div className="flex max-w-[72ch] flex-col gap-3 pt-6 sm:pt-8">
            <Skeleton className="h-3.5 w-full motion-reduce:animate-none" />
            <Skeleton className="h-3.5 w-11/12 motion-reduce:animate-none" />
            <Skeleton className="h-3.5 w-4/5 motion-reduce:animate-none" />
            <Skeleton className="h-3.5 w-3/5 motion-reduce:animate-none" />
          </div>
        </div>
      </MessagePaper>
    </>
  )
}

function getMailboxPath(
  source: unknown,
  folder: MessageDetail["folder"] | undefined
) {
  return typeof source === "string" &&
    /^\/(?:inbox|draft|sent|archive|spam|trash|starred|search|tags\/[^/?#]+)(?:\?[^#]*)?$/.test(
      source
    )
    ? source
    : `/${folder ?? "inbox"}`
}

export function MessageView() {
  const { id } = useParams<{ id: string }>()
  return <MessageReader key={id} id={id} />
}

interface MessageReaderProps {
  id?: string
}

function MessageReader({ id }: MessageReaderProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { state } = useLocation()
  const [message, setMessage] = useState<MessageDetail | null>(null)
  const [loadStatus, setLoadStatus] = useState<
    "loading" | "ready" | "notFound" | "failed"
  >(id ? "loading" : "notFound")
  const [attempt, setAttempt] = useState(0)
  const [acting, setActing] = useState(false)
  const [showRemoteImages, setShowRemoteImages] = useState(false)
  const activeRequest = useRef<AbortSignal | null>(null)

  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    const { signal } = controller
    activeRequest.current = signal

    api<MessageDetail>(`/api/messages/${id}`, { signal })
      .then((msg) => {
        if (signal.aborted) return
        setMessage(msg)
        setLoadStatus("ready")
        if (
          !msg.isRead &&
          msg.folder !== "trash" &&
          msg.folder !== "spam" &&
          msg.folder !== "draft"
        ) {
          void api(`/api/messages/${id}/read`, { method: "POST" })
            .then(() => {
              patchMailboxReturnSnapshot(id, { isRead: true })
              if (!signal.aborted)
                setMessage((current) => current && { ...current, isRead: true })
            })
            .catch(() => {})
        }
      })
      .catch((error: unknown) => {
        if (signal.aborted) return
        setLoadStatus(
          isApiError(error) && error.status === 404 ? "notFound" : "failed"
        )
      })

    return () => controller.abort()
  }, [id, attempt])

  const source = Array.isArray(state?.messageIds)
    ? (state as MailboxNavigationState)
    : undefined
  const position = id ? (source?.messageIds.indexOf(id) ?? -1) : -1
  const backTo = getMailboxPath(state?.mailboxPath, message?.folder)
  const htmlBody = message?.htmlBody
  const rendered = useMemo(
    () => (htmlBody ? sanitizeMail(htmlBody, showRemoteImages) : null),
    [htmlBody, showRemoteImages]
  )

  async function act<T>(
    request: () => Promise<T>,
    onSuccess: (result: T) => void,
    fallbackError: string
  ) {
    const signal = activeRequest.current
    if (acting || !signal || signal.aborted) return
    setActing(true)
    try {
      const result = await request()
      if (!signal.aborted) onSuccess(result)
    } catch (error) {
      if (!signal.aborted)
        toast.error(isApiError(error) ? error.message : fallbackError)
    } finally {
      if (!signal.aborted) setActing(false)
    }
  }

  function move(action: "trash" | "spam" | "archive" | "unarchive") {
    if (!message) return
    const destination = action === "unarchive" ? "inbox" : action
    const messageId = message.id
    void act(
      () =>
        action === "spam"
          ? api(`/api/messages/${messageId}/spam`, { method: "POST" }).then(
              () => ({ changed: 1, undoToken: undefined })
            )
          : applyMailboxBulk([messageId], action),
      ({ changed, undoToken }) => {
        if (changed) {
          invalidateMailboxMetadata()
          patchMailboxReturnSnapshot(messageId, { folder: destination })
          toast.success(t(`message.moved.${destination}`), {
            action: undoToken
              ? {
                  label: t("message.undo"),
                  onClick: () =>
                    void undoMailboxBulk(undoToken)
                      .then(({ changed: restored }) => {
                        if (restored) {
                          invalidateMailboxMetadata()
                          requestMailboxListRefresh()
                          toast.success(t("message.moveUndone"))
                        } else {
                          toast.error(t("message.undoFailed"))
                        }
                      })
                      .catch(() => toast.error(t("message.undoFailed"))),
                }
              : undefined,
          })
        } else {
          requestMailboxListRefresh()
        }
        navigate(backTo, { replace: true, state: { restoreMailbox: true } })
      },
      t(
        destination === "trash"
          ? "message.trashFailed"
          : destination === "spam"
            ? "message.spamFailed"
            : "message.archiveFailed"
      )
    )
  }

  function restore() {
    if (!message) return
    void act(
      () =>
        api<{ ok: true; folder: "inbox" | "sent" }>(
          `/api/messages/${message.id}/restore`,
          {
            method: "POST",
          }
        ),
      ({ folder }) => {
        invalidateMailboxMetadata()
        patchMailboxReturnSnapshot(message.id, { folder })
        toast.success(t("message.restored"))
        navigate(`/${folder}`, { replace: true })
      },
      t("message.restoreFailed")
    )
  }

  function toggleStar() {
    if (!message) return
    const isStarred = !message.isStarred
    void act(
      () =>
        api(`/api/messages/${message.id}/star`, {
          method: "POST",
          body: JSON.stringify({ starred: isStarred }),
        }),
      () => {
        invalidateMailboxMetadata()
        patchMailboxReturnSnapshot(message.id, { isStarred })
        setMessage((current) => current && { ...current, isStarred })
      },
      t("mailbox.starFailed")
    )
  }

  function toggleTag(tag: Tag) {
    if (!message) return
    const tags = message.tags.some((item) => item.id === tag.id)
      ? message.tags.filter((item) => item.id !== tag.id)
      : [...message.tags, tag]
    const tagIds = tags.map((item) => item.id)
    void act(
      () =>
        api(`/api/messages/${message.id}/tags`, {
          method: "PUT",
          body: JSON.stringify({ tagIds }),
        }),
      () => {
        patchMailboxReturnSnapshot(message.id, { tagIds })
        setMessage((current) => current && { ...current, tags, tagIds })
      },
      t("message.tagsFailed")
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <MessageToolbar
        backTo={backTo}
        source={source}
        previousId={position > 0 ? source?.messageIds[position - 1] : undefined}
        nextId={position >= 0 ? source?.messageIds[position + 1] : undefined}
        message={message}
        acting={acting}
        onStar={toggleStar}
        onSpam={() => move("spam")}
        onTrash={() => move("trash")}
        onArchive={() =>
          move(message?.folder === "archive" ? "unarchive" : "archive")
        }
      />

      <ScrollArea className="min-h-0 flex-1">
        {loadStatus === "loading" ? (
          <MessageDetailSkeleton label={t("message.loading")} />
        ) : message ? (
          <MessagePaper labelledBy="message-subject">
            <MessageEnvelope
              message={message}
              acting={acting}
              onToggleTag={toggleTag}
            />
            <div className="flex min-w-0 flex-col gap-5 pt-5 sm:gap-6 sm:pt-7">
              {message.hasUnsupportedAttachments ? (
                <div className="flex max-w-[72ch] items-start gap-2.5 rounded-lg bg-secondary px-3 py-2.5 text-sm leading-5 text-secondary-foreground">
                  <Icon
                    icon={Attachment01Icon}
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <p>{t("message.attachmentBanner")}</p>
                </div>
              ) : null}

              {rendered?.blockedImages ? (
                <div className="flex max-w-[72ch] flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border px-3 py-2">
                  <p className="text-sm text-muted-foreground">
                    {t("message.imagesBlocked")}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setShowRemoteImages(true)}
                  >
                    {t("message.loadImages")}
                  </Button>
                </div>
              ) : null}

              {rendered?.content ? (
                <div
                  dir="auto"
                  className="post-message-body flow-root overflow-x-auto text-base/7 sm:text-sm/7 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2"
                  dangerouslySetInnerHTML={{ __html: rendered.content }}
                />
              ) : (
                <p
                  dir="auto"
                  data-format="plain"
                  className="post-message-body text-base/7 whitespace-pre-wrap sm:text-sm/7"
                >
                  {message.textBody.trim()
                    ? message.textBody
                    : t("app.emptyBody")}
                </p>
              )}
            </div>
          </MessagePaper>
        ) : (
          <MessagePaper labelledBy="message-error">
            <div className="flex flex-col items-start gap-3 sm:py-3">
              <span className="grid size-10 place-items-center rounded-lg bg-muted text-muted-foreground">
                <Icon icon={Mail01Icon} aria-hidden="true" className="size-5" />
              </span>
              <div role="alert" className="space-y-1">
                <h1
                  id="message-error"
                  className="text-xl font-semibold tracking-tight"
                >
                  {t(
                    loadStatus === "notFound"
                      ? "message.notFound"
                      : "message.loadFailed"
                  )}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {t(
                    loadStatus === "notFound"
                      ? "message.notFoundHint"
                      : "message.loadFailedHint"
                  )}
                </p>
              </div>
              {loadStatus === "failed" ? (
                <Button
                  size="lg"
                  onClick={() => {
                    setLoadStatus("loading")
                    setAttempt((value) => value + 1)
                  }}
                >
                  {t("mailbox.retry")}
                </Button>
              ) : null}
            </div>
          </MessagePaper>
        )}
      </ScrollArea>

      {message ? (
        <MessageFooter message={message} acting={acting} onRestore={restore} />
      ) : null}
    </div>
  )
}
