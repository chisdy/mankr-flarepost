import { TrashIcon } from "@phosphor-icons/react"
import { useCallback, useEffect, useState } from "react"
import { Link, useLocation } from "react-router"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { api, isApiError } from "@/lib/api"
import { formatMessageTime } from "@/lib/format"
import type { Folder, MessageListItem } from "@/lib/types"
import { cn } from "@/lib/utils"

const folderMeta: Record<
  Folder,
  { title: string; empty: string }
> = {
  inbox: {
    title: "Inbox",
    empty: "No messages in inbox.",
  },
  sent: {
    title: "Sent",
    empty: "No sent messages yet.",
  },
  trash: {
    title: "Trash",
    empty: "Trash is empty.",
  },
}

function folderFromPath(pathname: string): Folder {
  const seg = pathname.replace(/^\//, "")
  if (seg === "sent" || seg === "trash") return seg
  return "inbox"
}

export function MailboxView() {
  const { pathname } = useLocation()
  const folder = folderFromPath(pathname)
  const meta = folderMeta[folder]

  const [items, setItems] = useState<MessageListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [emptying, setEmptying] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<{ items: MessageListItem[]; nextCursor: string | null }>(
        `/api/messages?folder=${folder}`
      )
      setItems(data.items)
    } catch (err) {
      toast.error(isApiError(err) ? err.message : "Failed to load messages")
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [folder])

  useEffect(() => {
    void load()
  }, [load])

  async function emptyTrash() {
    if (!window.confirm("Permanently delete all messages in Trash?")) return
    setEmptying(true)
    try {
      await api("/api/messages/trash", { method: "DELETE" })
      toast.success("Trash emptied")
      await load()
    } catch (err) {
      toast.error(isApiError(err) ? err.message : "Could not empty trash")
    } finally {
      setEmptying(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
        <h1 className="font-heading text-lg font-medium">{meta.title}</h1>
        {folder === "trash" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={emptying || items.length === 0}
            onClick={() => void emptyTrash()}
          >
            <TrashIcon data-icon="inline-start" />
            {emptying ? "Emptying…" : "Empty trash"}
          </Button>
        ) : null}
      </header>

      <ScrollArea className="flex-1">
        {loading ? (
          <p className="px-6 py-8 text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-6 py-8 text-sm text-muted-foreground">{meta.empty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => {
              const peer =
                folder === "sent"
                  ? item.toAddrs.join(", ") || "(no recipients)"
                  : item.fromAddr
              return (
                <li key={item.id}>
                  <Link
                    to={`/m/${item.id}`}
                    className={cn(
                      "flex items-baseline gap-3 px-6 py-3 transition-colors hover:bg-muted/50",
                      !item.isRead && "bg-muted/30"
                    )}
                  >
                    <span
                      className={cn(
                        "w-40 shrink-0 truncate text-sm",
                        !item.isRead ? "font-semibold" : "text-muted-foreground"
                      )}
                    >
                      {peer}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-sm",
                        !item.isRead ? "font-semibold" : "text-foreground/90"
                      )}
                    >
                      {item.subject || "(no subject)"}
                    </span>
                    <time
                      className="shrink-0 text-xs text-muted-foreground tabular-nums"
                      dateTime={new Date(item.createdAt).toISOString()}
                    >
                      {formatMessageTime(item.createdAt)}
                    </time>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}
