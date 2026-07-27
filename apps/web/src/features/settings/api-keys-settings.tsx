import { KeyIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react"
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
import { api, isApiError } from "@/lib/api"
import type { Alias, ApiKey } from "@/lib/types"

export function ApiKeysSettings({ aliases }: { aliases: Alias[] }) {
  const { t } = useTranslation()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState("")
  const [aliasId, setAliasId] = useState<string | null>(null)
  const [hourlyLimit, setHourlyLimit] = useState("30")
  const [dailyLimit, setDailyLimit] = useState("200")

  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null)

  const enabledAliases = aliases.filter((a) => a.enabled)
  const aliasItems = enabledAliases.map((alias) => ({
    label: alias.address,
    value: alias.id,
  }))

  async function reload() {
    const data = await api<{ apiKeys: ApiKey[] }>("/api/api-keys")
    setKeys(data.apiKeys)
  }

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount / locale change
    void reload()
      .catch((err) => {
        if (!cancelled) {
          toast.error(isApiError(err) ? err.message : t("apiKeys.loadFailed"))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [t])

  function openCreate() {
    setName("")
    setAliasId(enabledAliases[0]?.id ?? null)
    setHourlyLimit("30")
    setDailyLimit("200")
    setCreateOpen(true)
  }

  async function createKey() {
    if (!name.trim() || !aliasId) {
      toast.error(t("apiKeys.createInvalid"))
      return
    }
    const hourly = Number(hourlyLimit)
    const daily = Number(dailyLimit)
    if (!Number.isInteger(hourly) || !Number.isInteger(daily)) {
      toast.error(t("apiKeys.createInvalid"))
      return
    }

    setBusy(true)
    try {
      const created = await api<ApiKey>("/api/api-keys", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          aliasId,
          hourlyLimit: hourly,
          dailyLimit: daily,
        }),
      })
      setCreateOpen(false)
      setRevealedSecret(created.secret ?? null)
      await reload()
      toast.success(t("apiKeys.created"))
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("apiKeys.createFailed"))
    } finally {
      setBusy(false)
    }
  }

  async function setEnabled(key: ApiKey, enabled: boolean) {
    setBusy(true)
    try {
      await api<ApiKey>(`/api/api-keys/${key.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      })
      await reload()
      toast.success(enabled ? t("apiKeys.enabled") : t("apiKeys.disabled"))
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("apiKeys.updateFailed"))
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await api(`/api/api-keys/${deleteTarget.id}`, { method: "DELETE" })
      setDeleteTarget(null)
      await reload()
      toast.success(t("apiKeys.deleted"))
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("apiKeys.deleteFailed"))
    } finally {
      setBusy(false)
    }
  }

  async function copySecret() {
    if (!revealedSecret) return
    try {
      await navigator.clipboard.writeText(revealedSecret)
      toast.success(t("apiKeys.copied"))
    } catch {
      toast.error(t("apiKeys.copyFailed"))
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyIcon className="size-4 text-primary" />
            {t("apiKeys.title")}
          </CardTitle>
          <CardDescription>
            {t("apiKeys.hint")} {t("apiKeys.resendRequired")}
          </CardDescription>
          <CardAction>
            <Button
              type="button"
              disabled={busy || enabledAliases.length === 0}
              onClick={openCreate}
            >
              <PlusIcon data-icon="inline-start" />
              {t("apiKeys.create")}
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-4">{t("app.loading")}</p>
          ) : keys.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-8 text-center">
              <p className="text-sm text-muted-foreground">{t("apiKeys.empty")}</p>
              {enabledAliases.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("apiKeys.needAlias")}
                </p>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={openCreate}
                >
                  <PlusIcon data-icon="inline-start" />
                  {t("apiKeys.create")}
                </Button>
              )}
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border/60">
              {keys.map((key) => (
                <li
                  key={key.id}
                  className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-foreground">
                        {key.name}
                      </span>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {key.keyPrefix}…
                      </code>
                      {!key.enabled ? (
                        <Badge variant="secondary" className="text-[10px]">
                          {t("settings.disabled")}
                        </Badge>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span>
                        {t("apiKeys.fromAlias", { address: key.aliasAddress })}
                        {!key.aliasEnabled ? ` (${t("apiKeys.aliasDisabled")})` : ""}
                      </span>
                      <span>·</span>
                      <span className="font-mono">
                        {t("apiKeys.limits", {
                          hourly: key.hourlyLimit,
                          daily: key.dailyLimit,
                        })}
                      </span>
                    </div>

                    <p className="text-[11px] font-mono text-muted-foreground/80">
                      {t("apiKeys.usage", {
                        sent24h: key.usage.sent24h,
                        failed24h: key.usage.failed24h,
                        sent7d: key.usage.sent7d,
                        failed7d: key.usage.failed7d,
                      })}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void setEnabled(key, !key.enabled)}
                    >
                      {key.enabled ? t("settings.disable") : t("settings.enable")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(key)}
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("apiKeys.createTitle")}</DialogTitle>
            <DialogDescription>{t("apiKeys.createHint")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="api-key-name">{t("apiKeys.name")}</FieldLabel>
              <Input
                id="api-key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("apiKeys.namePlaceholder")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="api-key-alias">
                {t("apiKeys.alias")}
              </FieldLabel>
              <Select
                items={aliasItems}
                value={aliasId}
                onValueChange={(value) => setAliasId(value)}
              >
                <SelectTrigger id="api-key-alias" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {aliasItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>{t("apiKeys.aliasHint")}</FieldDescription>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="api-key-hourly">
                  {t("apiKeys.hourlyLimit")}
                </FieldLabel>
                <Input
                  id="api-key-hourly"
                  type="number"
                  min={1}
                  max={10000}
                  value={hourlyLimit}
                  onChange={(e) => setHourlyLimit(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="api-key-daily">
                  {t("apiKeys.dailyLimit")}
                </FieldLabel>
                <Input
                  id="api-key-daily"
                  type="number"
                  min={1}
                  max={10000}
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(e.target.value)}
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">{t("apiKeys.softQuotaHint")}</p>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
            >
              {t("app.cancel")}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void createKey()}>
              {busy ? t("auth.saving") : t("apiKeys.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!revealedSecret}
        onOpenChange={(open) => {
          if (!open) setRevealedSecret(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("apiKeys.secretTitle")}</DialogTitle>
            <DialogDescription>{t("apiKeys.secretHint")}</DialogDescription>
          </DialogHeader>
          <code className="block break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">
            {revealedSecret}
          </code>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => void copySecret()}>
              {t("apiKeys.copy")}
            </Button>
            <Button type="button" onClick={() => setRevealedSecret(null)}>
              {t("apiKeys.secretAck")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("apiKeys.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("apiKeys.deleteConfirm", { name: deleteTarget?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
            >
              {t("app.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              {t("settings.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
