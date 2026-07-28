import { FunnelIcon, PlusIcon, TagIcon, TrashIcon, PencilSimpleIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

  // Filter Form state in Dialog
  const [filterDialogOpen, setFilterDialogOpen] = useState(false)
  const [filterName, setFilterName] = useState("")
  const [matchMode, setMatchMode] = useState<"and" | "or">("and")
  const [priority, setPriority] = useState(0)
  const [conditions, setConditions] = useState<ConditionDraft[]>([
    newConditionDraft(),
  ])
  const [actionStar, setActionStar] = useState(false)
  const [actionTrash, setActionTrash] = useState(false)
  const [actionSpam, setActionSpam] = useState(false)
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount / locale change
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
        body: JSON.stringify({ name: tagName.trim(), color: tagColor }),
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
    setActionSpam(false)
    setActionTagIds([])
  }

  function openCreateFilter() {
    resetFilterForm()
    setFilterDialogOpen(true)
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
    setActionSpam(Boolean(filter.actions.moveToSpam))
    setActionTagIds(filter.actions.addTagIds ?? [])
    setFilterDialogOpen(true)
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
    if (!actionStar && !actionTrash && !actionSpam && actionTagIds.length === 0) {
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
        ...(actionSpam ? { moveToSpam: true as const } : {}),
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
      setFilterDialogOpen(false)
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
    return <p className="text-sm text-muted-foreground py-4">{t("app.loading")}</p>
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 标签管理卡片 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TagIcon className="size-4 text-primary" />
            {t("settings.tagsSection")}
          </CardTitle>
          <CardDescription>{t("settings.tagsHint")}</CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          {/* 新增标签工具栏 */}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              placeholder={t("settings.tagNamePlaceholder")}
              className="max-w-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void createTag()
                }
              }}
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
            <Button
              type="button"
              disabled={busy || !tagName.trim()}
              onClick={() => void createTag()}
            >
              <PlusIcon data-icon="inline-start" />
              {t("settings.addTag")}
            </Button>
          </div>

          {/* 标签列表 */}
          {tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("settings.noTags")}</p>
          ) : (
            <div className="flex flex-wrap gap-2 pt-1">
              {tags.map((tag) => (
                <div
                  key={tag.id}
                  className="group inline-flex items-center gap-2 rounded-xl border border-border/80 bg-card px-3 py-1.5 text-sm shadow-2xs transition-colors hover:border-border"
                >
                  <span
                    className="size-2.5 rounded-full shrink-0"
                    style={{
                      backgroundColor: isSafeHexColor(tag.color)
                        ? tag.color
                        : "#94a3b8",
                    }}
                  />
                  <span className="font-medium text-foreground">{tag.name}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removeTag(tag.id)}
                    className="ml-1 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                    title={t("settings.delete")}
                  >
                    <TrashIcon className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 过滤器卡片 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FunnelIcon className="size-4 text-primary" />
            {t("settings.filtersSection")}
          </CardTitle>
          <CardDescription>{t("settings.filtersHint")}</CardDescription>
          <CardAction>
            <Button type="button" onClick={openCreateFilter}>
              <PlusIcon data-icon="inline-start" />
              {t("settings.createFilter")}
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent>
          {filters.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-8 text-center">
              <p className="text-sm text-muted-foreground">{t("settings.noFilters")}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={openCreateFilter}
              >
                <PlusIcon data-icon="inline-start" />
                {t("settings.createFilter")}
              </Button>
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border/60">
              {filters.map((filter) => (
                <li
                  key={filter.id}
                  className="flex flex-col gap-2 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-foreground">
                        {filter.name}
                      </span>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        P{filter.priority}
                      </Badge>
                      {!filter.enabled ? (
                        <Badge variant="secondary" className="text-[10px]">
                          {t("settings.disabled")}
                        </Badge>
                      ) : null}
                    </div>

                    <p className="text-xs text-muted-foreground truncate">
                      <span className="font-mono uppercase font-semibold text-[11px] text-foreground/70">
                        {filter.matchMode}
                      </span>{" "}
                      ·{" "}
                      {filter.conditions
                        .map((c) => `${c.type.replace("_contains", "")}: ${c.value}`)
                        .join(", ")}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
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
                      variant="ghost"
                      disabled={busy}
                      onClick={() => loadFilterIntoForm(filter)}
                    >
                      <PencilSimpleIcon className="size-3.5" />
                      {t("settings.edit")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      className="text-destructive hover:text-destructive"
                      onClick={() => void removeFilter(filter.id)}
                    >
                      <TrashIcon className="size-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 过滤器编辑/新建 Dialog 弹窗 */}
      <Dialog open={filterDialogOpen} onOpenChange={setFilterDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? t("settings.editFilterTitle")
                : t("settings.createFilterTitle")}
            </DialogTitle>
            <DialogDescription>{t("settings.createFilterHint")}</DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-2">
            <Field>
              <FieldLabel>{t("settings.filterName")}</FieldLabel>
              <Input
                value={filterName}
                onChange={(e) => setFilterName(e.target.value)}
                placeholder="e.g. GitHub Notifications"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <FieldSet>
                <FieldLegend variant="label">{t("settings.matchMode")}</FieldLegend>
                <RadioGroup
                  value={matchMode}
                  onValueChange={(v) => {
                    if (v === "and" || v === "or") setMatchMode(v)
                  }}
                  className="flex flex-row flex-wrap gap-4"
                >
                  {matchModeItems.map((item) => (
                    <Field key={item.value} orientation="horizontal">
                      <RadioGroupItem
                        value={item.value}
                        id={`filter-match-${item.value}`}
                      />
                      <FieldLabel
                        htmlFor={`filter-match-${item.value}`}
                        className="font-normal"
                      >
                        {item.label}
                      </FieldLabel>
                    </Field>
                  ))}
                </RadioGroup>
              </FieldSet>

              <Field>
                <FieldLabel>{t("settings.priority")}</FieldLabel>
                <Input
                  type="number"
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value) || 0)}
                />
                <FieldDescription>{t("settings.priorityHint")}</FieldDescription>
              </Field>
            </div>

            <Field>
              <FieldLabel>{t("settings.conditions")}</FieldLabel>
              <div className="flex flex-col gap-2.5">
                {conditions.map((cond) => (
                  <div
                    key={cond.key}
                    className="flex items-center gap-2"
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
                      <SelectTrigger className="w-40 shrink-0">
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
                      size="icon-sm"
                      disabled={conditions.length <= 1}
                      onClick={() =>
                        setConditions((prev) =>
                          prev.filter((c) => c.key !== cond.key)
                        )
                      }
                    >
                      <TrashIcon className="size-3.5" />
                    </Button>
                  </div>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit mt-1"
                  onClick={() =>
                    setConditions((prev) => [...prev, newConditionDraft()])
                  }
                >
                  <PlusIcon data-icon="inline-start" />
                  {t("settings.addCondition")}
                </Button>
              </div>
            </Field>

            <FieldSet>
              <FieldLegend variant="label">{t("settings.actions")}</FieldLegend>
              <div className="flex flex-col gap-2.5 rounded-xl border border-border p-3">
                <FieldGroup
                  data-slot="checkbox-group"
                  className="flex flex-row flex-wrap gap-x-6 gap-y-2"
                >
                  <Field orientation="horizontal">
                    <Checkbox
                      id="filter-action-star"
                      checked={actionStar}
                      onCheckedChange={setActionStar}
                    />
                    <FieldLabel
                      htmlFor="filter-action-star"
                      className="font-normal"
                    >
                      {t("settings.actionStar")}
                    </FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <Checkbox
                      id="filter-action-trash"
                      checked={actionTrash}
                      onCheckedChange={(checked) => {
                        setActionTrash(checked)
                        if (checked) setActionSpam(false)
                      }}
                    />
                    <FieldLabel
                      htmlFor="filter-action-trash"
                      className="font-normal"
                    >
                      {t("settings.actionTrash")}
                    </FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <Checkbox
                      id="filter-action-spam"
                      checked={actionSpam}
                      onCheckedChange={(checked) => {
                        setActionSpam(checked)
                        if (checked) setActionTrash(false)
                      }}
                    />
                    <FieldLabel
                      htmlFor="filter-action-spam"
                      className="font-normal"
                    >
                      {t("settings.actionSpam")}
                    </FieldLabel>
                  </Field>
                </FieldGroup>

                {tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <span className="text-xs text-muted-foreground w-full">
                      {t("nav.tags")}：
                    </span>
                    {tags.map((tag) => {
                      const active = actionTagIds.includes(tag.id)
                      return (
                        <Button
                          key={tag.id}
                          type="button"
                          size="sm"
                          variant={active ? "default" : "outline"}
                          className="h-7 text-xs"
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
            </FieldSet>
          </FieldGroup>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setFilterDialogOpen(false)}
            >
              {t("app.cancel")}
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void saveFilter()}
            >
              {editingId ? t("settings.updateFilter") : t("settings.addFilter")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
