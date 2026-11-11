import { FilterHorizontalIcon, Search01Icon } from "@hugeicons/core-free-icons"
import { useId, useState, type FormEvent, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { Icon } from "@/components/icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SEARCH_FIELDS, searchParamsFor, type SearchField, type SearchFilters } from "@/features/mailbox/mailbox-api"
import type { Alias, Tag } from "@/lib/types"

const selectClass = "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-base text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60 sm:text-sm"

function SearchFieldControl({ title, children }: { title: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{title}</label>
      {children(id)}
    </div>
  )
}

export function MailboxSearch({ filters, aliases, tags, metadataFailed, onRetryMetadata, onSearch }: {
  filters: SearchFilters
  aliases: Alias[] | null
  tags: Tag[] | null
  metadataFailed: boolean
  onRetryMetadata: () => void
  onSearch: (params: URLSearchParams) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(filters)
  const [expanded, setExpanded] = useState(false)
  const [invalidDate, setInvalidDate] = useState(false)
  const filterPanel = useId()
  const filterCount = SEARCH_FIELDS.filter((field) => field !== "q" && filters[field]).length
  const activeDraft = SEARCH_FIELDS.some((field) => field !== "q" && draft[field])

  function update(field: SearchField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
    if (field === "after" || field === "before") setInvalidDate(false)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (draft.after && draft.before && draft.after > draft.before) {
      setExpanded(true)
      setInvalidDate(true)
      return
    }
    setExpanded(false)
    onSearch(searchParamsFor(draft))
  }

  function clearFilters() {
    setDraft({ q: draft.q })
    setInvalidDate(false)
    if (filterCount) onSearch(searchParamsFor({ q: draft.q }))
  }

  return (
    <form className="shrink-0 px-4 pb-3 sm:px-7" onSubmit={submit}>
      <div className="flex items-center gap-2">
        <Input
          value={draft.q ?? ""}
          onChange={(event) => update("q", event.target.value)}
          placeholder={t("mailbox.searchPlaceholder")}
          aria-label={t("nav.search")}
          className="min-w-0 flex-1"
          maxLength={200}
        />
        <Button type="button" variant={expanded ? "secondary" : "outline"} className="relative h-10 w-10 shrink-0 px-0 sm:w-auto sm:px-3" aria-label={t("mailbox.filters", { count: filterCount })} aria-expanded={expanded} aria-controls={filterPanel} title={t("mailbox.filters", { count: filterCount })} onClick={() => setExpanded(!expanded)}>
          <Icon icon={FilterHorizontalIcon} />
          <span aria-hidden className="hidden sm:inline">{t("mailbox.filters", { count: 0 })}</span>
          {filterCount ? <span aria-hidden className="absolute -end-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-xs leading-4 text-primary-foreground tabular-nums">{filterCount}</span> : null}
        </Button>
        <Button type="submit" className="h-10 shrink-0">
          <Icon icon={Search01Icon} data-icon="inline-start" />
          {t("mailbox.searchAction")}
        </Button>
      </div>
      <div id={filterPanel} hidden={!expanded} className="mt-3 border-t border-border pt-3">
        <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          <SearchFieldControl title={t("mailbox.filterSender")}>
            {(id) => <Input id={id} value={draft.from ?? ""} onChange={(event) => update("from", event.target.value)} autoCapitalize="none" spellCheck={false} maxLength={200} />}
          </SearchFieldControl>
          <SearchFieldControl title={t("mailbox.filterAlias")}>
            {(id) => (
              <select id={id} className={selectClass} value={draft.aliasId ?? ""} onChange={(event) => update("aliasId", event.target.value)} disabled={!aliases}>
                <option value="">{t("mailbox.filterAnyAlias")}</option>
                {aliases?.map((alias) => <option key={alias.id} value={alias.id}>{alias.address}</option>)}
              </select>
            )}
          </SearchFieldControl>
          <SearchFieldControl title={t("mailbox.filterTag")}>
            {(id) => (
              <select id={id} className={selectClass} value={draft.tagId ?? ""} onChange={(event) => update("tagId", event.target.value)} disabled={!tags}>
                <option value="">{t("mailbox.filterAnyTag")}</option>
                {tags?.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
              </select>
            )}
          </SearchFieldControl>
          <SearchFieldControl title={t("mailbox.filterRead")}>
            {(id) => (
              <select id={id} className={selectClass} value={draft.read ?? ""} onChange={(event) => update("read", event.target.value)}>
                <option value="">{t("mailbox.filterAnyRead")}</option>
                <option value="0">{t("mailbox.unread")}</option>
                <option value="1">{t("mailbox.read")}</option>
              </select>
            )}
          </SearchFieldControl>
          <SearchFieldControl title={t("mailbox.filterAfter")}>
            {(id) => <Input id={id} type="date" className="min-w-0 px-2" aria-invalid={invalidDate || undefined} value={draft.after ?? ""} onChange={(event) => update("after", event.target.value)} />}
          </SearchFieldControl>
          <SearchFieldControl title={t("mailbox.filterBefore")}>
            {(id) => <Input id={id} type="date" className="min-w-0 px-2" aria-invalid={invalidDate || undefined} value={draft.before ?? ""} onChange={(event) => update("before", event.target.value)} />}
          </SearchFieldControl>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("mailbox.filterDateZone")}</p>
        {invalidDate ? <p role="alert" className="mt-2 text-sm text-destructive">{t("mailbox.filterDateInvalid")}</p> : null}
        {metadataFailed ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <p role="status" className="text-muted-foreground">{t("mailbox.filterOptionsFailed")}</p>
            <Button type="button" variant="outline" size="sm" onClick={onRetryMetadata}>{t("mailbox.retry")}</Button>
          </div>
        ) : null}
        {filterCount || activeDraft ? <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={clearFilters}>{t("mailbox.filterClear")}</Button> : null}
      </div>
    </form>
  )
}
