/** 邮件阅读操作
 * @description 提供返回、邮件管理和常用后续操作。
 */
import {
  AlertDiamondIcon,
  Archive02Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowTurnBackwardIcon,
  ArrowTurnForwardIcon,
  Delete02Icon,
  Edit02Icon,
  MoreHorizontalIcon,
  StarIcon,
  UndoIcon,
} from "@hugeicons/core-free-icons"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"

import { Icon } from "@/components/icon"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { MessageDetail } from "@/lib/types"
import type { MailboxNavigationState } from "@/features/mailbox/mailbox-navigation"

interface MessageToolbarProps {
  backTo: string
  source?: MailboxNavigationState
  previousId?: string
  nextId?: string
  message: MessageDetail | null
  acting: boolean
  onStar: () => void
  onSpam: () => void
  onTrash: () => void
  onArchive: () => void
}

export function MessageToolbar({
  backTo,
  source,
  previousId,
  nextId,
  message,
  acting,
  onStar,
  onSpam,
  onTrash,
  onArchive,
}: MessageToolbarProps) {
  const { t } = useTranslation()
  const canStar = message && message.folder !== "draft"
  const canTrash = canStar && message.folder !== "trash"
  const canSpam = canTrash && message.folder !== "spam"
  const canArchive =
    message?.folder === "inbox" || message?.folder === "archive"

  function neighbor(
    neighborId: string | undefined,
    label: string,
    icon: typeof ArrowLeft01Icon
  ) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            neighborId ? (
              <Button
                variant="ghost"
                size="icon-lg"
                className="size-11"
                aria-label={label}
                nativeButton={false}
                render={
                  <Link
                    to={`/m/${encodeURIComponent(neighborId)}`}
                    state={source}
                    replace
                  />
                }
              />
            ) : (
              <Button
                variant="ghost"
                size="icon-lg"
                className="size-11"
                aria-label={label}
                disabled
              />
            )
          }
        >
          <Icon icon={icon} aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <header className="shrink-0">
      <div className="flex min-h-14 items-center justify-between gap-2 px-2 sm:px-4">
        <Button
          variant="ghost"
          size="lg"
          className="px-2 text-muted-foreground"
          render={<Link to={backTo} state={{ restoreMailbox: true }} replace />}
          nativeButton={false}
        >
          <Icon
            icon={ArrowLeft01Icon}
            data-icon="inline-start"
            aria-hidden="true"
          />
          {t("app.back")}
        </Button>

        <div className="flex items-center gap-1">
          {source && (previousId || nextId) ? (
            <div className="flex items-center gap-0.5">
              {neighbor(previousId, t("message.previous"), ArrowLeft01Icon)}
              {neighbor(nextId, t("message.next"), ArrowRight01Icon)}
            </div>
          ) : null}
          {canStar ? (
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-lg"
                      className="size-11 aria-disabled:opacity-60"
                      aria-label={t("mailbox.star")}
                      aria-pressed={message.isStarred}
                      aria-disabled={acting}
                      onClick={onStar}
                    />
                  }
                >
                  <Icon
                    icon={StarIcon}
                    aria-hidden="true"
                    strokeWidth={message.isStarred ? 2.25 : 1.5}
                    className={
                      message.isStarred
                        ? "text-amber-700 dark:text-amber-400"
                        : undefined
                    }
                  />
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {t(message.isStarred ? "mailbox.unstar" : "mailbox.star")}
                </TooltipContent>
              </Tooltip>
              {canTrash ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={t("message.moreActions")}
                    render={
                      <Button
                        variant="ghost"
                        size="icon-lg"
                        className="size-11"
                      />
                    }
                  >
                    <Icon icon={MoreHorizontalIcon} aria-hidden="true" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-max">
                    {canArchive ? (
                      <DropdownMenuItem
                        className="min-h-11"
                        disabled={acting}
                        onClick={onArchive}
                      >
                        <Icon icon={Archive02Icon} aria-hidden="true" />
                        {t(
                          message.folder === "archive"
                            ? "message.unarchive"
                            : "message.archive"
                        )}
                      </DropdownMenuItem>
                    ) : null}
                    {canSpam ? (
                      <>
                        <DropdownMenuItem
                          className="min-h-11"
                          disabled={acting}
                          onClick={onSpam}
                        >
                          <Icon icon={AlertDiamondIcon} aria-hidden="true" />
                          {t("message.markSpam")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    ) : null}
                    <DropdownMenuItem
                      className="min-h-11"
                      variant="destructive"
                      disabled={acting}
                      onClick={onTrash}
                    >
                      <Icon icon={Delete02Icon} aria-hidden="true" />
                      {t("message.trash")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </header>
  )
}

interface MessageFooterProps {
  message: MessageDetail
  acting: boolean
  onRestore: () => void
}

export function MessageFooter({
  message,
  acting,
  onRestore,
}: MessageFooterProps) {
  const { t } = useTranslation()
  const canRestore = message.folder === "trash" || message.folder === "spam"
  const canEdit = message.folder === "draft"
  const canReply = message.direction === "inbound"

  return (
    <footer className="shrink-0 bg-main">
      <div className="px-2 sm:px-4">
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-0 sm:pt-3 sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {canRestore ? (
            <Button
              size="lg"
              className="aria-disabled:opacity-60"
              aria-disabled={acting}
              onClick={onRestore}
            >
              <Icon
                icon={UndoIcon}
                data-icon="inline-start"
                aria-hidden="true"
              />
              {t("message.restore")}
            </Button>
          ) : canEdit ? (
            <Button
              size="lg"
              render={<Link to={`/compose?draft=${message.id}`} />}
              nativeButton={false}
            >
              <Icon
                icon={Edit02Icon}
                data-icon="inline-start"
                aria-hidden="true"
              />
              {t("message.editDraft")}
            </Button>
          ) : (
            <>
              {canReply ? (
                <Button
                  size="lg"
                  render={<Link to={`/compose?reply=${message.id}`} />}
                  nativeButton={false}
                >
                  <Icon
                    icon={ArrowTurnBackwardIcon}
                    data-icon="inline-start"
                    aria-hidden="true"
                  />
                  {t("message.reply")}
                </Button>
              ) : null}
              <Button
                size="lg"
                variant={canReply ? "outline" : "default"}
                render={<Link to={`/compose?forward=${message.id}`} />}
                nativeButton={false}
              >
                <Icon
                  icon={ArrowTurnForwardIcon}
                  data-icon="inline-start"
                  aria-hidden="true"
                />
                {t("message.forward")}
              </Button>
            </>
          )}
        </div>
      </div>
    </footer>
  )
}
