import { Archive02Icon, ArrowDown01Icon, Delete02Icon, Mail01Icon, Tag01Icon } from "@hugeicons/core-free-icons"
import { useTranslation } from "react-i18next"

import { Icon } from "@/components/icon"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MAX_BULK_MESSAGES, type BulkMailboxAction } from "@/features/mailbox/mailbox-api"
import type { MessageListItem, Tag } from "@/lib/types"

export function MailboxBulkToolbar({ selected, available, busy, tags, onSelectAll, onClear, onApply }: {
  selected: MessageListItem[]
  available: number
  busy: boolean
  tags: Tag[] | null
  onSelectAll: () => void
  onClear: () => void
  onApply: (action: BulkMailboxAction, tagId?: string) => void
}) {
  const { t } = useTranslation()
  const fullSelection = selected.length >= Math.min(available, MAX_BULK_MESSAGES)
  const canArchive = selected.length > 0 && selected.every((item) => item.folder === "inbox")
  const canUnarchive = selected.length > 0 && selected.every((item) => item.folder === "archive")

  return (
    <div role="group" aria-label={t("mailbox.bulkActions")} className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-y border-border bg-muted/60 px-4 py-2 sm:px-7">
      <p role="status" className="mr-auto text-sm font-medium tabular-nums">{t("mailbox.bulkSelected", { count: selected.length })}</p>
      <Button type="button" variant="ghost" size="sm" disabled={busy || (fullSelection && !selected.length)} onClick={fullSelection ? onClear : onSelectAll}>
        {fullSelection ? t("mailbox.bulkClear") : available > MAX_BULK_MESSAGES ? t("mailbox.bulkSelectLimit", { count: MAX_BULK_MESSAGES }) : t("mailbox.bulkSelectShown")}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" disabled={busy || !selected.length} />}>
          {busy ? t("mailbox.bulkWorking") : t("mailbox.bulkActions")}
          <Icon icon={ArrowDown01Icon} data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-max max-w-[min(18rem,85vw)] min-w-40">
          <DropdownMenuItem onClick={() => onApply("read")} disabled={selected.every((item) => item.isRead)}>
            <Icon icon={Mail01Icon} />{t("mailbox.bulkMarkRead")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onApply("unread")} disabled={selected.every((item) => !item.isRead)}>
            <Icon icon={Mail01Icon} />{t("mailbox.bulkMarkUnread")}
          </DropdownMenuItem>
          {tags?.length ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><Icon icon={Tag01Icon} />{t("mailbox.bulkTag")}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-w-[min(16rem,80vw)]">
                {tags.map((tag) => <DropdownMenuItem key={tag.id} onClick={() => onApply("tag", tag.id)}><span className="truncate">{tag.name}</span></DropdownMenuItem>)}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          <DropdownMenuSeparator />
          {canArchive ? <DropdownMenuItem onClick={() => onApply("archive")}><Icon icon={Archive02Icon} />{t("mailbox.bulkArchive")}</DropdownMenuItem> : null}
          {canUnarchive ? <DropdownMenuItem onClick={() => onApply("unarchive")}><Icon icon={Archive02Icon} />{t("mailbox.bulkUnarchive")}</DropdownMenuItem> : null}
          <DropdownMenuItem variant="destructive" onClick={() => onApply("trash")}><Icon icon={Delete02Icon} />{t("mailbox.bulkTrash")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
