import { zodResolver } from "@hookform/resolvers/zod"
import {
  AtIcon,
  CheckmarkCircle02Icon,
  CircleIcon,
} from "@hugeicons/core-free-icons"

import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"
import { Link } from "react-router"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"

import { Icon } from "@/components/icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { api, isApiError } from "@/lib/api"
import { invalidateMailboxMetadata } from "@/lib/mailbox-metadata"
import type { Alias, ApiKey, IntegrationCapabilities } from "@/lib/types"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type CreateValues = {
  address: string
}

type AliasesSettingsProps = {
  aliases: Alias[]
  loading: boolean
  onAliasesChange: Dispatch<SetStateAction<Alias[]>>
}

export function AliasesSettings({
  aliases,
  loading,
  onAliasesChange,
}: AliasesSettingsProps) {
  const { t } = useTranslation()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [capabilities, setCapabilities] =
    useState<IntegrationCapabilities | null>(null)
  const [capError, setCapError] = useState(false)
  const [capRevision, setCapRevision] = useState(0)
  const [disableTarget, setDisableTarget] = useState<{
    alias: Alias
    keys: ApiKey[]
  } | null>(null)
  const creationDisabled =
    loading || creating || capError || !capabilities?.domain

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
  }, [capRevision])

  const createSchema = useMemo(
    () =>
      z.object({
        address: z
          .string()
          .trim()
          .min(1, t("aliases.addressRequired"))
          .regex(
            /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/i,
            t("integrations.localPartHint")
          )
          .refine(
            (value) => !value.includes(".."),
            t("integrations.localPartHint")
          ),
      }),
    [t]
  )

  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { address: "" },
  })

  async function onCreate(values: CreateValues) {
    if (creationDisabled) return
    setCreating(true)
    try {
      const alias = await api<Alias>("/api/aliases", {
        method: "POST",
        body: JSON.stringify({ localPart: values.address }),
      })
      onAliasesChange((current) =>
        current.some(({ id }) => id === alias.id) ? current : [...current, alias]
      )
      invalidateMailboxMetadata("aliases")
      form.reset()
      toast.success(t("aliases.created"))
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("aliases.createFailed"))
    } finally {
      setCreating(false)
    }
  }

  async function requestEnabled(alias: Alias, enabled: boolean) {
    if (enabled) {
      await patchAlias(alias.id, { enabled })
      return
    }
    setBusyId(alias.id)
    try {
      const data = await api<{ apiKeys: ApiKey[] }>("/api/api-keys")
      setDisableTarget({
        alias,
        keys: data.apiKeys.filter((key) => key.aliasId === alias.id),
      })
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("apiKeys.loadFailed"))
    } finally {
      setBusyId(null)
    }
  }

  async function patchAlias(
    id: string,
    patch: { enabled?: boolean; isDefault?: boolean }
  ) {
    setBusyId(id)
    try {
      const updated = await api<Alias>(`/api/aliases/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      })
      invalidateMailboxMetadata("aliases")
      onAliasesChange((current) =>
        current.map((a) => {
          if (a.id === updated.id) return updated
          if (patch.isDefault === true) return { ...a, isDefault: false }
          return a
        })
      )
      if (patch.isDefault === true) {
        toast.success(t("settings.defaultAliasSaved"))
      }
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("aliases.updateFailed"))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon icon={AtIcon} className="size-4 text-primary" />
            {t("aliases.title")}
            <Badge variant="secondary">
              {loading ? "…" : aliases.length}
            </Badge>
          </CardTitle>
          <CardDescription>
            {t("aliases.routingHint")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {capError ? (
            <div role="alert" className="text-sm">
              <p>{t("integrations.capFailed")}</p>
              <Button
                variant="outline"
                onClick={() => setCapRevision((value) => value + 1)}
              >
                {t("integrations.refresh")}
              </Button>
            </div>
          ) : capabilities && !capabilities.domain ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t("aliases.domainMissing")}
            </p>
          ) : null}
          <form onSubmit={form.handleSubmit(onCreate)}>
            <FieldGroup>
              <Field
                data-invalid={!!form.formState.errors.address || undefined}
              >
                <FieldLabel htmlFor="alias-address">
                  {t("aliases.newAlias")}
                </FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="alias-address"
                    placeholder="notifications"
                    disabled={creationDisabled}
                    aria-invalid={!!form.formState.errors.address}
                    {...form.register("address")}
                  />
                  <span className="max-w-40 self-center text-xs break-all text-muted-foreground">
                    @{capabilities?.domain ?? "…"}
                  </span>
                  <Button
                    type="submit"
                    disabled={creationDisabled}
                  >
                    {creating ? t("aliases.adding") : t("aliases.add")}
                  </Button>
                </div>
                <FieldError errors={[form.formState.errors.address]} />
                <FieldDescription>
                  {t("integrations.localPartHint")}
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>

          <div aria-hidden="true" className="h-2" />

          {loading ? (
            <p className="text-sm text-muted-foreground">
              {t("aliases.loading")}
            </p>
          ) : aliases.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("aliases.empty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {aliases.map((alias) => {
                const busy = busyId === alias.id
                return (
                  <li
                    key={alias.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted/40 px-4 py-3"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate font-medium">
                        {alias.address}
                      </span>
                      {alias.isDefault ? (
                        <Badge variant="outline">{t("aliases.default")}</Badge>
                      ) : null}
                      {!alias.enabled ? (
                        <Badge variant="secondary">
                          {t("aliases.disabled")}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {alias.enabled ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          nativeButton={false}
                          render={
                            <Link
                              to={`/settings?tab=apikeys&alias=${encodeURIComponent(alias.id)}&create=1`}
                            />
                          }
                        >
                          {t("integrations.useForProject")}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy || alias.isDefault}
                        onClick={() =>
                          void patchAlias(alias.id, { isDefault: true })
                        }
                      >
                        {alias.isDefault ? (
                          <Icon
                            icon={CheckmarkCircle02Icon}
                            data-icon="inline-start"
                          />
                        ) : (
                          <Icon icon={CircleIcon} data-icon="inline-start" />
                        )}
                        {t("aliases.default")}
                      </Button>
                      <Switch
                        checked={alias.enabled}
                        disabled={busy}
                        aria-label={
                          alias.enabled
                            ? t("aliases.disable")
                            : t("aliases.enable")
                        }
                        onCheckedChange={(enabled) => {
                          void requestEnabled(alias, enabled)
                        }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
      <Dialog
        open={!!disableTarget}
        onOpenChange={(value) => {
          if (!value && !busyId) setDisableTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("integrations.disableAddress")}</DialogTitle>
            <DialogDescription>
              {t("integrations.disableAddressHint", {
                address: disableTarget?.alias.address,
                count: disableTarget?.keys.length ?? 0,
              })}
            </DialogDescription>
          </DialogHeader>
          {disableTarget?.keys.length ? (
            <ul className="text-sm">
              {disableTarget.keys.map((key) => (
                <li key={key.id}>
                  {key.name} · {key.keyPrefix}…
                </li>
              ))}
            </ul>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={!!busyId}
              onClick={() => setDisableTarget(null)}
            >
              {t("app.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={!!busyId}
              onClick={() => {
                if (disableTarget)
                  void patchAlias(disableTarget.alias.id, {
                    enabled: false,
                  }).then(() => setDisableTarget(null))
              }}
            >
              {t("settings.disable")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
