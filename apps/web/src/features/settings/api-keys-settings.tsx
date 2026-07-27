import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
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
import { Separator } from "@/components/ui/separator"
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
    // Same mount-load pattern as TagsFiltersSettings; the rule flags setState via reload().
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
      <Separator />

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-medium">{t("apiKeys.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("apiKeys.hint")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("apiKeys.resendRequired")}
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">{t("app.loading")}</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("apiKeys.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {keys.map((key) => (
              <li
                key={key.id}
                className="flex flex-col gap-2 border-b border-border/60 pb-3 last:border-0"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {key.name}
                      {!key.enabled ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {t("settings.disabled")}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {key.keyPrefix}…
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("apiKeys.fromAlias", { address: key.aliasAddress })}
                      {!key.aliasEnabled
                        ? ` · ${t("apiKeys.aliasDisabled")}`
                        : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("apiKeys.limits", {
                        hourly: key.hourlyLimit,
                        daily: key.dailyLimit,
                      })}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("apiKeys.usage", {
                        sent24h: key.usage.sent24h,
                        failed24h: key.usage.failed24h,
                        sent7d: key.usage.sent7d,
                        failed7d: key.usage.failed7d,
                      })}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
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
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => setDeleteTarget(key)}
                    >
                      {t("settings.delete")}
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Button
          type="button"
          variant="outline"
          className="w-fit"
          disabled={busy || enabledAliases.length === 0}
          onClick={openCreate}
        >
          {t("apiKeys.create")}
        </Button>
        {enabledAliases.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("apiKeys.needAlias")}
          </p>
        ) : null}
      </section>

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
              <FieldDescription>{t("apiKeys.softQuotaHint")}</FieldDescription>
            </Field>
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
