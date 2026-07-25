import { zodResolver } from "@hookform/resolvers/zod"
import { CheckCircleIcon, CircleIcon, ToggleLeftIcon, ToggleRightIcon } from "@phosphor-icons/react"
import { useCallback, useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

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
import { Separator } from "@/components/ui/separator"
import { api, isApiError } from "@/lib/api"
import type { Alias } from "@/lib/types"

const MAX_ALIASES = 5

const createSchema = z.object({
  address: z.string().trim().min(1, "Local-part or full address is required"),
})

type CreateValues = z.infer<typeof createSchema>

export function AliasesView() {
  const [aliases, setAliases] = useState<Alias[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { address: "" },
  })

  const load = useCallback(async () => {
    try {
      const data = await api<{ aliases: Alias[] }>("/api/aliases")
      setAliases(data.aliases)
    } catch (err) {
      toast.error(isApiError(err) ? err.message : "Failed to load aliases")
    } finally {
      setLoading(false)
    }
  }, [])

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
      toast.success("Alias created")
      await load()
    } catch (err) {
      if (isApiError(err) && err.body.error === "alias_limit") {
        toast.error(err.message || `Free tier allows at most ${MAX_ALIASES} aliases`)
      } else {
        toast.error(isApiError(err) ? err.message : "Could not create alias")
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
      toast.error(isApiError(err) ? err.message : "Update failed")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-lg font-medium">Aliases</h1>
          <Badge variant="secondary">
            {aliases.length}/{MAX_ALIASES}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Free tier: up to {MAX_ALIASES} aliases on one domain. No attachments,
          single user.
        </p>
      </div>

      <form
        className="max-w-lg"
        onSubmit={form.handleSubmit(onCreate)}
      >
        <FieldGroup>
          <Field data-invalid={!!form.formState.errors.address || undefined}>
            <FieldLabel htmlFor="alias-address">New alias</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="alias-address"
                placeholder="hello or hello@your.domain"
                disabled={remaining === 0 || creating}
                aria-invalid={!!form.formState.errors.address}
                {...form.register("address")}
              />
              <Button type="submit" disabled={remaining === 0 || creating}>
                {creating ? "Adding…" : "Add"}
              </Button>
            </div>
            <FieldDescription>
              {remaining === 0
                ? `Limit reached (${MAX_ALIASES}). Disable unused aliases or wait for a higher tier.`
                : `${remaining} slot${remaining === 1 ? "" : "s"} remaining.`}
            </FieldDescription>
            <FieldError errors={[form.formState.errors.address]} />
          </Field>
        </FieldGroup>
      </form>

      <Separator />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading aliases…</p>
      ) : aliases.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No aliases yet. Create one to start receiving mail.
        </p>
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
                      <Badge variant="outline">Default</Badge>
                    ) : null}
                    {!alias.enabled ? (
                      <Badge variant="secondary">Disabled</Badge>
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
                    Default
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
                    {alias.enabled ? "Disable" : "Enable"}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
