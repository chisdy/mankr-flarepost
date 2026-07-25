import { zodResolver } from "@hookform/resolvers/zod"
import { CheckCircleIcon, CircleIcon, ToggleLeftIcon, ToggleRightIcon } from "@phosphor-icons/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"

import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { api, isApiError } from "@/lib/api"
import type { Alias } from "@/lib/types"

const MAX_ALIASES = 5

type CreateValues = {
  address: string
}

export function AliasesView() {
  const { t } = useTranslation()
  const [aliases, setAliases] = useState<Alias[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const createSchema = useMemo(
    () =>
      z.object({
        address: z.string().trim().min(1, t("aliases.addressRequired")),
      }),
    [t]
  )

  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { address: "" },
  })

  const load = useCallback(async () => {
    try {
      const data = await api<{ aliases: Alias[] }>("/api/aliases")
      setAliases(data.aliases)
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("aliases.loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const remaining = Math.max(0, MAX_ALIASES - aliases.length)

  async function onCreate(values: CreateValues) {
    setCreating(true)
    try {
      await api("/api/aliases", {
        method: "POST",
        body: JSON.stringify({ address: values.address }),
      })
      form.reset()
      toast.success(t("aliases.created"))
      await load()
    } catch (err) {
      if (isApiError(err) && err.body.error === "alias_limit") {
        toast.error(err.message || t("aliases.limitToast", { max: MAX_ALIASES }))
      } else {
        toast.error(isApiError(err) ? err.message : t("aliases.createFailed"))
      }
    } finally {
      setCreating(false)
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
      setAliases((prev) =>
        prev.map((a) => {
          if (a.id === updated.id) return updated
          if (patch.isDefault === true) return { ...a, isDefault: false }
          return a
        })
      )
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("aliases.updateFailed"))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader
        title={
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-lg font-medium">{t("aliases.title")}</h1>
            <Badge variant="secondary">
              {aliases.length}/{MAX_ALIASES}
            </Badge>
          </div>
        }
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-6 px-4 py-6 sm:px-6">
          <p className="text-sm text-muted-foreground">
            {t("aliases.freeTierNote", { max: MAX_ALIASES })}
          </p>

          <form
            className="max-w-lg"
            onSubmit={form.handleSubmit(onCreate)}
          >
            <FieldGroup>
              <Field data-invalid={!!form.formState.errors.address || undefined}>
                <FieldLabel htmlFor="alias-address">{t("aliases.newAlias")}</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="alias-address"
                    placeholder={t("aliases.placeholder")}
                    disabled={remaining === 0 || creating}
                    aria-invalid={!!form.formState.errors.address}
                    {...form.register("address")}
                  />
                  <Button type="submit" disabled={remaining === 0 || creating}>
                    {creating ? t("aliases.adding") : t("aliases.add")}
                  </Button>
                </div>
                <FieldDescription>
                  {remaining === 0
                    ? t("aliases.limitReached", { max: MAX_ALIASES })
                    : t("aliases.slotsRemaining", { count: remaining })}
                </FieldDescription>
                <FieldError errors={[form.formState.errors.address]} />
              </Field>
            </FieldGroup>
          </form>

          <Separator />

          {loading ? (
            <p className="text-sm text-muted-foreground">{t("aliases.loading")}</p>
          ) : aliases.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("aliases.empty")}</p>
          ) : (
            <ul className="flex max-w-2xl flex-col gap-2">
              {aliases.map((alias) => {
                const busy = busyId === alias.id
                return (
                  <li
                    key={alias.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted/40 px-4 py-3"
                  >
                    <div className="min-w-0 flex flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{alias.address}</span>
                        {alias.isDefault ? (
                          <Badge variant="outline">{t("aliases.default")}</Badge>
                        ) : null}
                        {!alias.enabled ? (
                          <Badge variant="secondary">{t("aliases.disabled")}</Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy || alias.isDefault}
                        onClick={() => void patchAlias(alias.id, { isDefault: true })}
                      >
                        {alias.isDefault ? (
                          <CheckCircleIcon data-icon="inline-start" weight="fill" />
                        ) : (
                          <CircleIcon data-icon="inline-start" />
                        )}
                        {t("aliases.default")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void patchAlias(alias.id, { enabled: !alias.enabled })
                        }
                      >
                        {alias.enabled ? (
                          <ToggleRightIcon data-icon="inline-start" weight="fill" />
                        ) : (
                          <ToggleLeftIcon data-icon="inline-start" />
                        )}
                        {alias.enabled ? t("aliases.disable") : t("aliases.enable")}
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
