import { useLocation } from "react-router"

import { Badge } from "@/components/ui/badge"

const titles: Record<string, string> = {
  "/inbox": "Inbox",
  "/sent": "Sent",
  "/trash": "Trash",
}

export function MailboxPage() {
  const { pathname } = useLocation()
  const title = titles[pathname] ?? "Mailbox"

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-2">
        <h1 className="font-heading text-lg font-medium">{title}</h1>
        <Badge variant="secondary">Placeholder</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Mailbox list UI arrives in Task 8. Folder: {pathname.slice(1)}
      </p>
    </div>
  )
}
