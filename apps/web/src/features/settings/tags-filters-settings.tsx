import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { api, isApiError } from "@/lib/api"
import type { Alias, FilterCondition, FilterRule, Tag } from "@/lib/types"

const TAG_COLORS = ["#64748b", "#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#a855f7"]

type ConditionDraft = {
  key: string
  type: FilterCondition["type"]
  value: string
}

function newConditionDraft(
  type: FilterCondition["type"] = "from_contains",
  value = ""
): ConditionDraft {
  return { key: crypto.randomUUID(), type, value }
}

function isSafeHexColor(value: string | null | undefined): value is string {
  return typeof value === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
}

export function TagsFiltersSettings({ aliases }: { aliases: Alias[] }) {
  const { t } = useTranslation()
  const [tags, setTags] = useState<Tag[]>([])
  const [filters, setFilters] = useState<FilterRule[]>([])
  const [loading, setLoading] = useState(true)
  const [tagName, setTagName] = useState("")
  const [tagColor, setTagColor] = useState(TAG_COLORS[0]!)
  const [busy, setBusy] = useState(false)

  const [filterName, setFilterName] = useState("")
  const [matchMode, setMatchMode] = useState<"and" | "or">("and")
  const [priority, setPriority] = useState(0)
  const [conditions, setConditions] = useState<ConditionDraft[]>([
    newConditionDraft(),
  ])
  const [actionStar, setActionStar] = useState(false)
  const [actionTrash, setActionTrash] = useState(false)
  const [actionTagIds, setActionTagIds] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)

  async function reload() {
    const [tagsRes, filtersRes] = await Promise.all([
      api<{ tags: Tag[] }>("/api/tags"),
      api<{ filters: FilterRule[] }>("/api/filters"),
    ])
    setTags(tagsRes.tags)
    setFilters(filtersRes.filters)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    reload()
      .catch((err) => {
        if (!cancelled) {
          toast.error(isApiError(err) ? err.message : t("settings.tagsLoadFailed"))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [t])

  async function createTag() {
    if (!tagName.trim()) return
    setBusy(true)
    try {
      await api("/api/tags", {
        method: "POST",
        body: JSON.stringify({ name: tagName, color: tagColor }),
      })
      setTagName("")
      toast.success(t("settings.tagCreated"))
      await reload()
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("settings.tagCreateFailed"))
    } finally {
      setBusy(false)
    }
  }

  async function removeTag(id: string) {
    if (!window.confirm(t("settings.tagDeleteConfirm"))) return
    setBusy(true)
    try {
      await api(`/api/tags/${id}`, { method: "DELETE" })
      toast.success(t("settings.tagDeleted"))
      await reload()
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("settings.tagDeleteFailed"))
    } finally {
      setBusy(false)
    }
  }

  function resetFilterForm() {
    setEditingId(null)
    setFilterName("")
    setMatchMode("and")
    setPriority(0)
    setConditions([newConditionDraft()])
    setActionStar(false)
    setActionTrash(false)
    setActionTagIds([])
  }

  function loadFilterIntoForm(filter: FilterRule) {
    setEditingId(filter.id)
    setFilterName(filter.name)
    setMatchMode(filter.matchMode)
    setPriority(filter.priority)
    setConditions(
      filter.conditions.length > 0
        ? filter.conditions.map((c) => newConditionDraft(c.type, c.value))
        : [newConditionDraft()]
    )
    setActionStar(Boolean(filter.actions.setStarred))
    setActionTrash(Boolean(filter.actions.moveToTrash))
    setActionTagIds(filter.actions.addTagIds ?? [])
  }

  function updateCondition(
    key: string,
    patch: Partial<Pick<ConditionDraft, "type" | "value">>
  ) {
    setConditions((prev) =>
      prev.map((c) => (c.key === key ? { ...c, ...patch } : c))
    )
  }

  async function saveFilter() {
    const cleaned = conditions
      .map((c) => ({ type: c.type, value: c.value.trim() }))
      .filter((c) => c.value.length > 0)

    if (!filterName.trim() || cleaned.length === 0) {
      toast.error(t("settings.filterInvalid"))
      return
    }
    if (!actionStar && !actionTrash && actionTagIds.length === 0) {
      toast.error(t("settings.filterNeedAction"))
      return
    }

    const body = {
      name: filterName.trim(),
      enabled: true,
      priority,
      matchMode,
      conditions: cleaned,
      actions: {
        ...(actionTagIds.length ? { addTagIds: actionTagIds } : {}),
        ...(actionStar ? { setStarred: true as const } : {}),
        ...(actionTrash ? { moveToTrash: true as const } : {}),
      },
    }

    setBusy(true)
    try {
      if (editingId) {
        await api(`/api/filters/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        })
        toast.success(t("settings.filterUpdated"))
      } else {
        await api("/api/filters", {
          method: "POST",
          body: JSON.stringify(body),
        })
        toast.success(t("settings.filterCreated"))
      }
      resetFilterForm()
      await reload()
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("settings.filterSaveFailed"))
    } finally {
      setBusy(false)
    }
  }

  async function toggleFilterEnabled(filter: FilterRule) {
    setBusy(true)
    try {
      await api(`/api/filters/${filter.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: filter.name,
          enabled: !filter.enabled,
          priority: filter.priority,
          matchMode: filter.matchMode,
          conditions: filter.conditions,
          actions: filter.actions,
        }),
      })
      await reload()
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("settings.filterSaveFailed"))
    } finally {
      setBusy(false)
    }
  }

  async function removeFilter(id: string) {
    if (!window.confirm(t("settings.filterDeleteConfirm"))) return
    setBusy(true)
    try {
      await api(`/api/filters/${id}`, { method: "DELETE" })
      toast.success(t("settings.filterDeleted"))
      if (editingId === id) resetFilterForm()
      await reload()
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("settings.filterDeleteFailed"))
    } finally {
      setBusy(false)
    }
  }

  const conditionItems = [
    { value: "from_contains", label: t("settings.condFrom") },
    { value: "subject_contains", label: t("settings.condSubject") },
    { value: "body_contains", label: t("settings.condBody") },
    { value: "to_alias_id", label: t("settings.condAlias") },
  ]

  const matchModeItems = [
    { value: "and", label: t("settings.matchAnd") },
    { value: "or", label: t("settings.matchOr") },
  ]

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t("app.loading")}</p>
  }

  return (
    <>
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-medium">{t("settings.tagsSection")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("settings.tagsHint")}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Input
            value={tagName}
            onChange={(e) => setTagName(e.target.value)}
            placeholder={t("settings.tagNamePlaceholder")}
            className="max-w-xs"
          />
          <Select
            items={TAG_COLORS.map((c) => ({ value: c, label: c }))}
            value={tagColor}
            onValueChange={(v) => v && setTagColor(v)}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {TAG_COLORS.map((c) => (
                  <SelectItem key={c} value={c}>
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block size-3 rounded-full"
                        style={{ backgroundColor: c }}
                      />
                      {c}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button type="button" disabled={busy} onClick={() => void createTag()}>
            {t("settings.addTag")}
          </Button>
        </div>

        <ul className="flex flex-col gap-2">
          {tags.length === 0 ? (
            <li className="text-sm text-muted-foreground">{t("settings.noTags")}</li>
          ) : (
            tags.map((tag) => (
              <li
                key={tag.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border px-3 py-2"
              >
                <span className="flex items-center gap-2 text-sm">
                  <span
                    className="inline-block size-3 rounded-full"
                    style={{
                      backgroundColor: isSafeHexColor(tag.color)
                        ? tag.color
                        : "#94a3b8",
                    }}
                  />
                  {tag.name}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void removeTag(tag.id)}
                >
                  {t("settings.delete")}
                </Button>
              </li>
            ))
          )}
        </ul>
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-medium">{t("settings.filtersSection")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("settings.filtersHint")}
          </p>
        </div>

        <FieldGroup>
          <Field>
            <FieldLabel>{t("settings.filterName")}</FieldLabel>
            <Input
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>{t("settings.matchMode")}</FieldLabel>
            <Select
              items={matchModeItems}
              value={matchMode}
              onValueChange={(v) => v && setMatchMode(v as "and" | "or")}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {matchModeItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>{t("settings.priority")}</FieldLabel>
            <Input
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value) || 0)}
            />
            <FieldDescription>{t("settings.priorityHint")}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>{t("settings.conditions")}</FieldLabel>
            <div className="flex flex-col gap-3">
              {conditions.map((cond) => (
                <div
                  key={cond.key}
                  className="flex flex-col gap-2 rounded-2xl border border-border p-3 sm:flex-row sm:items-center"
                >
                  <Select
                    items={conditionItems}
                    value={cond.type}
                    onValueChange={(v) =>
                      v &&
                      updateCondition(cond.key, {
                        type: v as FilterCondition["type"],
                        value: v === "to_alias_id" ? "" : cond.value,
                      })
                    }
                  >
                    <SelectTrigger className="sm:w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {conditionItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {cond.type === "to_alias_id" ? (
                    <Select
                      items={aliases.map((a) => ({
                        value: a.id,
                        label: a.address,
                      }))}
                      value={cond.value || null}
                      onValueChange={(v) =>
                        v && updateCondition(cond.key, { value: v })
                      }
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder={t("settings.selectAlias")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {aliases.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.address}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      className="flex-1"
                      value={cond.value}
                      onChange={(e) =>
                        updateCondition(cond.key, { value: e.target.value })
                      }
                      placeholder={t("settings.conditionValue")}
                    />
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={conditions.length <= 1}
                    onClick={() =>
                      setConditions((prev) =>
                        prev.filter((c) => c.key !== cond.key)
                      )
                    }
                  >
                    {t("settings.removeCondition")}
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() =>
                  setConditions((prev) => [...prev, newConditionDraft()])
                }
              >
                {t("settings.addCondition")}
              </Button>
            </div>
          </Field>
          <Field>
            <FieldLabel>{t("settings.actions")}</FieldLabel>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={actionStar}
                  onChange={(e) => setActionStar(e.target.checked)}
                />
                {t("settings.actionStar")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={actionTrash}
                  onChange={(e) => setActionTrash(e.target.checked)}
                />
                {t("settings.actionTrash")}
              </label>
              {tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => {
                    const active = actionTagIds.includes(tag.id)
                    return (
                      <Button
                        key={tag.id}
                        type="button"
                        size="sm"
                        variant={active ? "default" : "outline"}
                        onClick={() =>
                          setActionTagIds((prev) =>
                            active
                              ? prev.filter((x) => x !== tag.id)
                              : [...prev, tag.id]
                          )
                        }
                      >
                        {tag.name}
                      </Button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          </Field>
        </FieldGroup>

        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => void saveFilter()}>
            {editingId ? t("settings.updateFilter") : t("settings.addFilter")}
          </Button>
          {editingId ? (
            <Button type="button" variant="outline" onClick={resetFilterForm}>
              {t("app.cancel")}
            </Button>
          ) : null}
        </div>

        <ul className="flex flex-col gap-2">
          {filters.length === 0 ? (
            <li className="text-sm text-muted-foreground">
              {t("settings.noFilters")}
            </li>
          ) : (
            filters.map((filter) => (
              <li
                key={filter.id}
                className="flex flex-col gap-2 rounded-2xl border border-border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 text-sm">
                  <p className="font-medium">
                    {filter.name}{" "}
                    <span className="text-muted-foreground">
                      (P{filter.priority})
                    </span>
                    {!filter.enabled ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t("settings.disabled")}
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-muted-foreground">
                    {filter.matchMode.toUpperCase()} ·{" "}
                    {filter.conditions
                      .map((c) => `${c.type}:${c.value}`)
                      .join(", ")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void toggleFilterEnabled(filter)}
                  >
                    {filter.enabled
                      ? t("settings.disable")
                      : t("settings.enable")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => loadFilterIntoForm(filter)}
                  >
                    {t("settings.edit")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void removeFilter(filter.id)}
                  >
                    {t("settings.delete")}
                  </Button>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>
    </>
  )
}
