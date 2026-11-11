/** 邮件信封
 * @description 展示邮件主题、地址、时间及标签。
 */
import {
  ArrowDown01Icon,
  Mail01Icon,
  Tag01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"

import { Icon } from "@/components/icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { formatFullTime } from "@/lib/format"
import { invalidateMailboxMetadata, useMailboxTagState } from "@/lib/mailbox-metadata"
import type { MessageDetail, Tag } from "@/lib/types"

interface TagOptionsProps {
  selected: Tag[]
  acting: boolean
  onToggle: (tag: Tag) => void
}

function TagOptions({ selected, acting, onToggle }: TagOptionsProps) {
  const { t } = useTranslation()
  const { data: tags, failed } = useMailboxTagState()

  if (!tags && failed) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-muted-foreground">
          {t("message.tagsUnavailable")}
        </p>
        <Button
          variant="outline"
          onClick={() => invalidateMailboxMetadata("tags")}
        >
          {t("mailbox.retry")}
        </Button>
      </div>
    )
  }

  if (!tags) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("app.loading")}
      </p>
    )
  }

  if (tags.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("message.noTagsYet")}{" "}
        <Link
          to="/settings?tab=tags"
          className="text-primary underline underline-offset-2"
        >
          {t("nav.settings")}
        </Link>
      </p>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => {
        const active = selected.some((item) => item.id === tag.id)
        return (
          <Button
            key={tag.id}
            variant={active ? "secondary" : "outline"}
            className="min-h-11 max-w-full min-w-0 [overflow-wrap:anywhere] whitespace-normal aria-disabled:opacity-60"
            aria-pressed={active}
            aria-disabled={acting}
            onClick={() => onToggle(tag)}
          >
            <Icon
              icon={Tick02Icon}
              data-icon="inline-start"
              aria-hidden="true"
              className={active ? undefined : "invisible"}
            />
            {tag.name}
          </Button>
        )
      })}
    </div>
  )
}

interface MessageEnvelopeProps {
  message: MessageDetail
  acting: boolean
  onToggleTag: (tag: Tag) => void
}

export function MessageEnvelope({
  message,
  acting,
  onToggleTag,
}: MessageEnvelopeProps) {
  const { t } = useTranslation()
  const [firstRecipient, ...otherRecipients] = message.toAddrs
  const folderLabel =
    message.folder === "trash"
      ? t("nav.trash")
      : message.folder === "spam"
        ? t("nav.spam")
        : message.folder === "draft"
          ? t("nav.drafts")
          : null

  return (
    <header className="flex flex-col gap-4 border-b border-border pb-4 sm:gap-5 sm:pb-5">
      <h1
        id="message-subject"
        dir="auto"
        className="text-2xl leading-tight font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-3xl"
      >
        {message.subject.trim() || t("app.noSubject")}
      </h1>

      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground sm:size-10">
          <Icon icon={Mail01Icon} aria-hidden="true" className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-5 gap-y-1">
          <dl className="grid max-w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2.5 gap-y-1 text-sm">
            <dt className="text-xs text-muted-foreground">
              {t("message.from")}
            </dt>
            <dd className="font-medium [overflow-wrap:anywhere]">
              <bdi>{message.fromAddr}</bdi>
            </dd>
            <dt className="text-xs text-muted-foreground">{t("message.to")}</dt>
            <dd className="min-w-0 [overflow-wrap:anywhere]">
              <bdi>{firstRecipient || t("app.noRecipients")}</bdi>
              {otherRecipients.length > 0 ? (
                <details className="group">
                  <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-1 rounded-md pr-2 text-xs font-medium text-muted-foreground hover:text-foreground sm:min-h-8 [&::-webkit-details-marker]:hidden">
                    <Icon
                      icon={ArrowDown01Icon}
                      aria-hidden="true"
                      className="size-3 group-open:rotate-180"
                    />
                    {t("message.moreRecipients", {
                      count: otherRecipients.length,
                    })}
                  </summary>
                  <ul className="space-y-1 pb-1">
                    {otherRecipients.map((address, index) => (
                      <li key={`${address}-${index}`}>
                        <bdi>{address}</bdi>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </dd>
          </dl>
          <time
            className="max-w-full text-xs leading-5 text-muted-foreground tabular-nums"
            dateTime={new Date(message.createdAt).toISOString()}
          >
            {formatFullTime(message.createdAt)}
          </time>
        </div>
      </div>

      {folderLabel || message.tags.length > 0 || message.folder !== "draft" ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {folderLabel ? <Badge variant="outline">{folderLabel}</Badge> : null}
          {message.tags.map((tag) => (
            <Badge
              key={tag.id}
              variant="secondary"
              className="h-auto max-w-full min-w-0 gap-1.5 py-1 [overflow-wrap:anywhere] whitespace-normal"
            >
              {tag.color && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(tag.color) ? (
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
              ) : null}
              <bdi className="min-w-0">{tag.name}</bdi>
            </Badge>
          ))}
          {message.folder !== "draft" ? (
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11 text-muted-foreground sm:min-h-8"
                  />
                }
              >
                <Icon
                  icon={Tag01Icon}
                  data-icon="inline-start"
                  aria-hidden="true"
                />
                {t("message.editTags")}
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="max-h-(--available-height) max-w-[calc(100vw-2rem)] gap-3 overflow-y-auto rounded-xl"
              >
                <PopoverTitle>{t("message.editTags")}</PopoverTitle>
                <TagOptions
                  selected={message.tags}
                  acting={acting}
                  onToggle={onToggleTag}
                />
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      ) : null}
    </header>
  )
}
