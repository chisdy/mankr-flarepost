import {
  ArrowBendUpLeftIcon,
  ArrowLeftIcon,
  TrashIcon,
  ArrowCounterClockwiseIcon,
} from "@phosphor-icons/react"
import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { api, isApiError } from "@/lib/api"
import { formatFullTime } from "@/lib/format"
import { sanitize } from "@/lib/sanitize"
import type { MessageDetail } from "@/lib/types"

export function MessageView() {
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
          toast.error(isApiError(err) ? err.message : "Message not found")
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
  }, [id, navigate])

  async function trash() {
    if (!id) return
    setActing(true)
    try {
      await api(`/api/messages/${id}/trash`, { method: "POST" })
      toast.success("Moved to trash")
      navigate("/inbox")
    } catch (err) {
      toast.error(isApiError(err) ? err.message : "Could not trash message")
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
      toast.success("Message restored")
      navigate(`/${result.folder}`)
    } catch (err) {
      toast.error(isApiError(err) ? err.message : "Could not restore message")
    } finally {
      setActing(false)
    }
  }

  if (loading || !message) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        Loading message…
      </div>
    )
  }

  const backTo =
    message.folder === "sent"
      ? "/sent"
      : message.folder === "trash"
        ? "/trash"
        : "/inbox"

  const sanitized = message.htmlBody ? sanitize(message.htmlBody).trim() : ""
  const html = sanitized || null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-6">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          render={<Link to={backTo} />}
          nativeButton={false}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Back
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {message.folder === "trash" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={acting}
              onClick={() => void restore()}
            >
              <ArrowCounterClockwiseIcon data-icon="inline-start" />
              Restore
            </Button>
          ) : (
            <>
              {message.direction === "inbound" ? (
                <Button
                  type="button"
                  size="sm"
                  render={<Link to={`/compose?reply=${message.id}`} />}
                  nativeButton={false}
                >
                  <ArrowBendUpLeftIcon data-icon="inline-start" />
                  Reply
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={acting}
                onClick={() => void trash()}
              >
                <TrashIcon data-icon="inline-start" />
                Trash
              </Button>
            </>
          )}
        </div>
      </header>

      <article className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-6">
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-xl font-medium tracking-tight">
            {message.subject || "(no subject)"}
          </h1>
          <dl className="grid gap-1 text-sm text-muted-foreground">
            <div className="flex gap-2">
              <dt className="w-12 shrink-0">From</dt>
              <dd className="text-foreground">{message.fromAddr}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-12 shrink-0">To</dt>
              <dd className="text-foreground">{message.toAddrs.join(", ")}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-12 shrink-0">Date</dt>
              <dd>{formatFullTime(message.createdAt)}</dd>
            </div>
          </dl>
        </div>

        {message.hasUnsupportedAttachments ? (
          <div
            role="status"
            className="rounded-2xl bg-secondary px-4 py-3 text-sm text-secondary-foreground"
          >
            This message had attachments that are not supported in V1. Only the
            text/HTML body is shown.
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
            {message.textBody || "(empty body)"}
          </pre>
        )}
      </article>
    </div>
  )
}
