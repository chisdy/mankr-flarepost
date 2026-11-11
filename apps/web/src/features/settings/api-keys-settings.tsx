import {
  Delete02Icon,
  Key01Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons"

import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useSearchParams } from "react-router"
import { toast } from "sonner"

import { Icon } from "@/components/icon"
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
import { invalidateMailboxMetadata } from "@/lib/mailbox-metadata"
import type { Alias, ApiKey, IntegrationCapabilities } from "@/lib/types"
import { IntegrationExamples } from "./integration-examples"
import { IntegrationLogs } from "./integration-logs"
import { IntegrationTest } from "./integration-test"

export function ApiKeysSettings({
  aliases,
  onAliasesChange,
}: {
  aliases: Alias[]
  onAliasesChange: (aliases: Alias[]) => void
}) {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const [capabilities, setCapabilities] =
    useState<IntegrationCapabilities | null>(null)
  const [capError, setCapError] = useState(false)
  const [capRevision, setCapRevision] = useState(0)
  const [logRevision, setLogRevision] = useState(0)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [createOpen, setCreateOpen] = useState(
    () => params.get("create") === "1"
  )
  const [name, setName] = useState("")
  const [aliasId, setAliasId] = useState<string | null>(() =>
    params.get("alias")
  )
  const [hourlyLimit, setHourlyLimit] = useState("30")
  const [dailyLimit, setDailyLimit] = useState("200")
  const [newAddress, setNewAddress] = useState(false)
  const [localPart, setLocalPart] = useState("")
  const [createdAddress, setCreatedAddress] = useState("")
  const [uncertainKey, setUncertainKey] = useState(false)
  const [editTarget, setEditTarget] = useState<ApiKey | null>(null)

  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null)

  const enabledAliases = aliases.filter((a) => a.enabled)
  const aliasItems = enabledAliases.map((alias) => ({
    label: alias.address,
    value: alias.id,
  }))

  useEffect(() => {
    let cancelled = false
    api<IntegrationCapabilities>("/api/integration-capabilities")
      .then((data) => {
        if (!cancelled) {
          setCapabilities(data)
          setCapError(false)
        }
      })
      .catch(() => {
        if (!cancelled) setCapError(true)
      })
    return () => {
      cancelled = true
    }
  }, [aliases.length, capRevision])

  function closeCreate(value: boolean) {
    if (busy) return
    setCreateOpen(value)
    if (!value && params.has("create"))
      setParams({ tab: "apikeys" }, { replace: true })
  }

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
    setNewAddress(enabledAliases.length === 0)
    setLocalPart("")
    setCreatedAddress("")
    setUncertainKey(false)
    setCreateOpen(true)
  }

  async function createAddress() {
    if (!capabilities?.domain || !localPart.trim() || busy) return
    if (
      !/^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/i.test(localPart.trim()) ||
      localPart.includes("..")
    ) {
      toast.error(t("integrations.localPartHint"))
      return
    }
    setBusy(true)
    try {
      const created = await api<Alias>("/api/aliases", {
        method: "POST",
        body: JSON.stringify({ localPart: localPart.trim() }),
      })
      invalidateMailboxMetadata("aliases")
      onAliasesChange([...aliases, created])
      setAliasId(created.id)
      setCreatedAddress(created.address)
      setNewAddress(false)
      setCapRevision((value) => value + 1)
      toast.success(t("aliases.created"))
    } catch (err) {
      toast.error(
        isApiError(err) ? err.message : t("integrations.addressUncertain")
      )
      // Recover a lost creation response by reading the address, never by guessing its ID.
      const refreshed = await api<{ aliases: Alias[] }>("/api/aliases").catch(
        () => null
      )
      if (refreshed) {
        onAliasesChange(refreshed.aliases)
        const address = `${localPart.trim().toLowerCase()}@${capabilities.domain}`
        const found = refreshed.aliases.find(
          (alias) => alias.address === address && alias.enabled
        )
        if (found) {
          setAliasId(found.id)
          setCreatedAddress(found.address)
          setNewAddress(false)
        }
      }
    } finally {
      setBusy(false)
    }
  }

  function openEdit(key: ApiKey) {
    setEditTarget(key)
    setName(key.name)
    setHourlyLimit(String(key.hourlyLimit))
    setDailyLimit(String(key.dailyLimit))
  }

  async function saveEdit() {
    if (!editTarget || busy) return
    setBusy(true)
    try {
      await api(`/api/api-keys/${editTarget.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          hourlyLimit: Number(hourlyLimit),
          dailyLimit: Number(dailyLimit),
        }),
      })
      setEditTarget(null)
      await reload()
      setLogRevision((value) => value + 1)
      toast.success(t("settings.saved"))
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("apiKeys.updateFailed"))
    } finally {
      setBusy(false)
    }
  }

  async function createKey() {
    if (busy || uncertainKey || newAddress) return
    if (!name.trim() || !aliasId) {
      toast.error(t("apiKeys.createInvalid"))
      return
    }
    const hourly = Number(hourlyLimit)
    const daily = Number(dailyLimit)
    if (
      !Number.isInteger(hourly) ||
      !Number.isInteger(daily) ||
      hourly < 1 ||
      hourly > 10000 ||
      daily < 1 ||
      daily > 10000
    ) {
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
      setCapRevision((value) => value + 1)
      if (params.has("create")) setParams({ tab: "apikeys" }, { replace: true })
      await reload().catch(() => toast.error(t("apiKeys.loadFailed")))
      toast.success(t("apiKeys.created"))
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("apiKeys.createFailed"))
      if (!isApiError(err) || err.status >= 500) {
        setUncertainKey(true)
        await reload().catch(() => undefined)
        setCapRevision((value) => value + 1)
      }
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
      setCapRevision((value) => value + 1)
      setLogRevision((value) => value + 1)
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
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("integrations.title")}</CardTitle>
          <CardDescription>{t("integrations.intro")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {capError ? (
            <div role="alert">
              <p>{t("integrations.capFailed")}</p>
              <Button
                variant="outline"
                onClick={() => setCapRevision((value) => value + 1)}
              >
                {t("integrations.refresh")}
              </Button>
            </div>
          ) : !capabilities ? (
            <p>{t("app.loading")}</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-muted/40 p-3">
                  <p className="font-medium">
                    {t("integrations.addressStatus", {
                      count: capabilities.aliases.used,
                    })}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("integrations.keyStatus", {
                      remaining: capabilities.apiKeys.remaining,
                      limit: capabilities.apiKeys.limit,
                    })}
                  </p>
                </div>
                <div className="rounded-xl bg-muted/40 p-3">
                  <p className="font-medium">
                    {capabilities.outbound.provider} ·{" "}
                    {capabilities.outbound.configured
                      ? t("integrations.configured")
                      : t("integrations.notConfigured")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("integrations.domainUnverified")}
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("integrations.routingHint")}
              </p>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to="/settings?tab=mail" />}
            >
              {t("integrations.manageMail")}
            </Button>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to="/usage" />}
            >
              {t("integrations.viewProviderUsage")}
            </Button>
            <IntegrationTest
              onSent={() => {
                setLogRevision((value) => value + 1)
                void reload().catch(() => undefined)
              }}
            />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Icon icon={Key01Icon} className="size-4 text-primary" />
            {t("apiKeys.title")}
          </CardTitle>
          <CardDescription className="col-span-2 row-start-2">
            {t("apiKeys.hint")} {t("apiKeys.providerRequired")}
          </CardDescription>
          <CardAction className="row-span-1">
            <Button
              type="button"
              disabled={
                busy ||
                !capabilities ||
                capError ||
                capabilities.apiKeys.remaining === 0
              }
              onClick={openCreate}
            >
              <Icon icon={PlusSignIcon} data-icon="inline-start" />
              {t("apiKeys.create")}
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent>
          {loading ? (
            <p className="py-4 text-sm text-muted-foreground">
              {t("app.loading")}
            </p>
          ) : keys.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl bg-muted/45 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                {t("apiKeys.empty")}
              </p>
              {enabledAliases.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("integrations.createInFlow")}
                </p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={openCreate}
                disabled={
                  !capabilities ||
                  capError ||
                  capabilities.apiKeys.remaining === 0
                }
              >
                <Icon icon={PlusSignIcon} data-icon="inline-start" />
                {t("apiKeys.create")}
              </Button>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {keys.map((key) => (
                <li
                  key={key.id}
                  className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
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
                        {!key.aliasEnabled
                          ? ` (${t("apiKeys.aliasDisabled")})`
                          : ""}
                      </span>
                      <span>·</span>
                      <span className="font-mono">
                        {t("apiKeys.limits", {
                          hourly: key.hourlyLimit,
                          daily: key.dailyLimit,
                        })}
                      </span>
                    </div>

                    <p className="font-mono text-[11px] text-muted-foreground/80">
                      {t("apiKeys.usage", {
                        sent24h: key.usage.sent24h,
                        failed24h: key.usage.failed24h,
                        sent7d: key.usage.sent7d,
                        failed7d: key.usage.failed7d,
                      })}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => openEdit(key)}
                    >
                      {t("integrations.edit")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void setEnabled(key, !key.enabled)}
                    >
                      {key.enabled
                        ? t("settings.disable")
                        : t("settings.enable")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      className="text-destructive hover:text-destructive"
                      aria-label={t("integrations.deleteKey", {
                        name: key.name,
                      })}
                      onClick={() => setDeleteTarget(key)}
                    >
                      <Icon icon={Delete02Icon} className="size-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={closeCreate}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("apiKeys.createTitle")}</DialogTitle>
            <DialogDescription>{t("apiKeys.createHint")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="api-key-name">
                {t("apiKeys.name")}
              </FieldLabel>
              <Input
                id="api-key-name"
                maxLength={60}
                disabled={busy}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("apiKeys.namePlaceholder")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="api-key-alias">
                {t("apiKeys.alias")}
              </FieldLabel>
              {createdAddress ? (
                <p className="text-xs text-primary">
                  {t("integrations.addressCreated", {
                    address: createdAddress,
                  })}
                </p>
              ) : null}
              {!newAddress ? (
                <>
                  <Select
                    disabled={busy}
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!capabilities?.domain || busy}
                    onClick={() => setNewAddress(true)}
                  >
                    {t("integrations.newAddress")}
                  </Button>
                </>
              ) : (
                <div className="space-y-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Input
                      id="project-local-part"
                      aria-label={t("integrations.localPart")}
                      value={localPart}
                      onChange={(event) => setLocalPart(event.target.value)}
                      placeholder="notifications"
                      disabled={busy}
                      autoComplete="off"
                      maxLength={64}
                    />
                    <span className="max-w-40 text-xs break-all text-muted-foreground">
                      @{capabilities?.domain ?? "…"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={
                        busy ||
                        !capabilities?.domain ||
                        !localPart.trim()
                      }
                      onClick={() => void createAddress()}
                    >
                      {busy
                        ? t("auth.saving")
                        : t("integrations.createAddress")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setNewAddress(false)}
                    >
                      {t("integrations.useExisting")}
                    </Button>
                  </div>
                </div>
              )}
              <FieldDescription>
                {t("apiKeys.aliasHint")} {t("integrations.localPartHint")}
              </FieldDescription>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="api-key-hourly">
                  {t("apiKeys.hourlyLimit")}
                </FieldLabel>
                <Input
                  id="api-key-hourly"
                  disabled={busy}
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
                  disabled={busy}
                  type="number"
                  min={1}
                  max={10000}
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(e.target.value)}
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("apiKeys.softQuotaHint")}
            </p>
          </FieldGroup>
          {uncertainKey ? (
            <p role="alert" className="text-sm text-destructive">
              {t("integrations.keyUncertain")}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => closeCreate(false)}
            >
              {t("app.cancel")}
            </Button>
            <Button
              type="button"
              disabled={
                busy ||
                uncertainKey ||
                newAddress ||
                !aliasId ||
                !capabilities ||
                capError ||
                capabilities.apiKeys.remaining === 0
              }
              onClick={() => void createKey()}
            >
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
          <code className="block rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">
            {revealedSecret}
          </code>
          <p className="text-xs break-all text-muted-foreground">
            {name} · {aliases.find((alias) => alias.id === aliasId)?.address}
            <br />
            POST {window.location.origin}/api/v1/send
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => void copySecret()}
            >
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
              {t("apiKeys.deleteConfirm", { name: deleteTarget?.name ?? "" })}{" "}
              {t("integrations.deleteWarning")}
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
      <Dialog
        open={!!editTarget}
        onOpenChange={(value) => {
          if (!value && !busy) setEditTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("integrations.edit")}</DialogTitle>
            <DialogDescription>{editTarget?.aliasAddress}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="edit-key-name">
                {t("apiKeys.name")}
              </FieldLabel>
              <Input
                id="edit-key-name"
                maxLength={60}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-key-hourly">
                {t("apiKeys.hourlyLimit")}
              </FieldLabel>
              <Input
                id="edit-key-hourly"
                type="number"
                min={1}
                max={10000}
                value={hourlyLimit}
                onChange={(event) => setHourlyLimit(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-key-daily">
                {t("apiKeys.dailyLimit")}
              </FieldLabel>
              <Input
                id="edit-key-daily"
                type="number"
                min={1}
                max={10000}
                value={dailyLimit}
                onChange={(event) => setDailyLimit(event.target.value)}
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              {t("integrations.quotaHint")}
            </p>
          </FieldGroup>
          <DialogFooter>
            <Button disabled={busy} onClick={() => void saveEdit()}>
              {t("settings.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <p className="text-xs text-muted-foreground">
        {t("integrations.quotaHint")} {t("integrations.rotationHint")}
      </p>
      <IntegrationExamples />
      <IntegrationLogs keys={keys} revision={logRevision} />
      <Card>
        <CardHeader>
          <CardTitle>SMTP · {t("integrations.smtpPending")}</CardTitle>
          <CardDescription>{t("integrations.smtpHint")}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
