import {
  ArrowBendUpLeftIcon,
  ArrowBendUpRightIcon,
  ArrowLeftIcon,
  TrashIcon,
  ArrowCounterClockwiseIcon,
} from "@phosphor-icons/react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useNavigate, useParams } from "react-router"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { api, isApiError } from "@/lib/api"
import { formatFullTime } from "@/lib/format"
import { sanitize } from "@/lib/sanitize"
import type { MessageDetail } from "@/lib/types"

export function MessageView() {
  const { t, i18n } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [message, setMessage] = useState<MessageDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const msg = await api<MessageDetail>(`/api/messages/${id}`)
        if (cancelled) return
        setMessage(msg)
        if (!msg.isRead && msg.folder !== "trash") {
          void api(`/api/messages/${id}/read`, { method: "POST" }).then(() => {
            if (!cancelled) {
              setMessage((prev) => (prev ? { ...prev, isRead: true } : prev))
            }
          })
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(isApiError(err) ? err.message : t("message.notFound"))
          navigate("/inbox", { replace: true })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [id, navigate, t])

  async function trash() {
    if (!id) return
    setActing(true)
    try {
      await api(`/api/messages/${id}/trash`, { method: "POST" })
      toast.success(t("message.movedToTrash"))
      navigate("/inbox")
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("message.trashFailed"))
    } finally {
      setActing(false)
    }
  }

  async function restore() {
    if (!id) return
    setActing(true)
    try {
      const result = await api<{ ok: true; folder: "inbox" | "sent" }>(
        `/api/messages/${id}/restore`,
        { method: "POST" }
      )
      toast.success(t("message.restored"))
      navigate(`/${result.folder}`)
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("message.restoreFailed"))
    } finally {
      setActing(false)
    }
  }

  if (loading || !message) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        {t("message.loading")}
      </div>
    )
  }

  const backTo =
    message.folder === "sent"
      ? "/sent"
      : message.folder === "trash"
        ? "/trash"
        : message.folder === "draft"
          ? "/draft"
          : "/inbox"

  const sanitized = message.htmlBody ? sanitize(message.htmlBody).trim() : ""
  const html = sanitized || null

  const showReplyForward =
    message.folder !== "trash" && message.folder !== "draft"

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <PageHeader
        leading={
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("app.back")}
                  render={<Link to={backTo} />}
                  nativeButton={false}
                />
              }
            >
              <ArrowLeftIcon />
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("app.back")}</TooltipContent>
          </Tooltip>
        }
        actions={
          message.folder === "trash" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={acting}
              onClick={() => void restore()}
            >
              <ArrowCounterClockwiseIcon data-icon="inline-start" />
              {t("message.restore")}
            </Button>
          ) : message.folder === "draft" ? (
            <Button
              type="button"
              size="sm"
              render={<Link to={`/compose?draft=${message.id}`} />}
              nativeButton={false}
            >
              {t("message.editDraft")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={acting}
              onClick={() => void trash()}
            >
              <TrashIcon data-icon="inline-start" />
              {t("message.trash")}
            </Button>
          )
        }
      />

      <ScrollArea className="min-h-0 flex-1">
        <article className="flex w-full flex-col gap-5 px-4 py-6 pb-24 sm:px-8">
          <div className="flex flex-col gap-3">
            <h1 className="font-heading text-2xl font-medium tracking-tight sm:text-3xl">
              {message.subject || t("app.noSubject")}
            </h1>
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-sm">
              <p className="min-w-0 text-muted-foreground">
                <span className="mr-1">{t("message.from")}</span>
                <span className="text-foreground">{message.fromAddr}</span>
                <span className="mx-2 text-border" aria-hidden>
                  ·
                </span>
                <span className="mr-1">{t("message.to")}</span>
                <span className="text-foreground">
                  {message.toAddrs.join(", ")}
                </span>
              </p>
              <time
                key={i18n.language}
                className="shrink-0 text-muted-foreground tabular-nums"
                dateTime={new Date(message.createdAt).toISOString()}
              >
                {formatFullTime(message.createdAt)}
              </time>
            </div>
          </div>

          {message.hasUnsupportedAttachments ? (
            <div
              role="status"
              className="rounded-2xl bg-secondary px-4 py-3 text-sm text-secondary-foreground"
            >
              {t("message.attachmentBanner")}
            </div>
          ) : null}

          <Separator />

          {html ? (
            <div
              className="prose prose-sm max-w-none text-foreground [&_a]:text-primary [&_a]:underline"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
              {message.textBody || t("app.emptyBody")}
            </pre>
          )}
        </article>
      </ScrollArea>

      {showReplyForward ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-start px-4 pb-4 md:left-56 sm:px-6">
          <div className="pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-border bg-background/95 p-1.5 shadow-lg backdrop-blur-sm">
            {message.direction === "inbound" ? (
              <Button
                type="button"
                size="sm"
                render={<Link to={`/compose?reply=${message.id}`} />}
                nativeButton={false}
              >
                <ArrowBendUpLeftIcon data-icon="inline-start" />
                {t("message.reply")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              render={<Link to={`/compose?forward=${message.id}`} />}
              nativeButton={false}
            >
              <ArrowBendUpRightIcon data-icon="inline-start" />
              {t("message.forward")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
