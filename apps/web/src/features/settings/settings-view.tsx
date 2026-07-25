import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { toast } from "sonner"
import { z } from "zod"

import { useAuth } from "@/components/auth-gate"
import { LanguageSwitcher } from "@/components/language-switcher"
import { PageHeader } from "@/components/page-header"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Field,
  FieldDescription,
  FieldError,
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
import { ChangePasswordDialog } from "@/features/auth/change-password-dialog"
import { api, isApiError } from "@/lib/api"
import type { Alias, AuthUser } from "@/lib/types"

type ProfileValues = {
  displayName: string
}

export function SettingsView() {
  const { t } = useTranslation()
  const { user, setUser } = useAuth()
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [aliases, setAliases] = useState<Alias[]>([])
  const [aliasesLoading, setAliasesLoading] = useState(true)
  const [defaultBusy, setDefaultBusy] = useState(false)
  const [defaultAliasId, setDefaultAliasId] = useState<string | null>(null)

  const schema = useMemo(
    () =>
      z.object({
        displayName: z.string().max(80, t("settings.displayNameMax")),
      }),
    [t]
  )

  const form = useForm<ProfileValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      displayName: user?.displayName ?? "",
    },
  })

  useEffect(() => {
    let cancelled = false
    setAliasesLoading(true)
    api<{ aliases: Alias[] }>("/api/aliases")
      .then((data) => {
        if (cancelled) return
        setAliases(data.aliases)
        const currentDefault =
          data.aliases.find((a) => a.isDefault)?.id ??
          data.aliases.find((a) => a.enabled)?.id ??
          null
        setDefaultAliasId(currentDefault)
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(isApiError(err) ? err.message : t("aliases.loadFailed"))
        }
      })
      .finally(() => {
        if (!cancelled) setAliasesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [t])

  const enabledAliases = aliases.filter((a) => a.enabled)
  const aliasItems = enabledAliases.map((alias) => ({
    label: `${alias.address}${alias.isDefault ? t("compose.defaultSuffix") : ""}`,
    value: alias.id,
  }))

  async function onSubmit(values: ProfileValues) {
    setSaving(true)
    try {
      const updated = await api<AuthUser>("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: values.displayName.trim() || null,
        }),
      })
      setUser(updated)
      form.reset({ displayName: updated.displayName ?? "" })
      toast.success(t("settings.saved"))
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("settings.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  async function setDefaultAlias(id: string | null) {
    if (!id || id === defaultAliasId) return
    setDefaultBusy(true)
    try {
      const updated = await api<Alias>(`/api/aliases/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isDefault: true }),
      })
      setAliases((prev) =>
        prev.map((a) => ({
          ...a,
          isDefault: a.id === updated.id,
        }))
      )
      setDefaultAliasId(updated.id)
      toast.success(t("settings.defaultAliasSaved"))
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("aliases.updateFailed"))
    } finally {
      setDefaultBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader title={t("settings.title")} />

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-8 px-4 py-6 sm:px-6">
          <section className="flex flex-col gap-4">
            <div>
              <h2 className="text-sm font-medium">{t("settings.profile")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("settings.profileHint")}
              </p>
            </div>

            <form
              className="flex flex-col gap-4"
              onSubmit={form.handleSubmit(onSubmit)}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="settings-username">
                    {t("auth.username")}
                  </FieldLabel>
                  <Input
                    id="settings-username"
                    value={user?.username ?? ""}
                    disabled
                    readOnly
                  />
                </Field>

                <Field data-invalid={!!form.formState.errors.displayName || undefined}>
                  <FieldLabel htmlFor="settings-display-name">
                    {t("auth.displayName")}
                  </FieldLabel>
                  <Input
                    id="settings-display-name"
                    placeholder={t("auth.optional")}
                    aria-invalid={!!form.formState.errors.displayName}
                    {...form.register("displayName")}
                  />
                  <FieldDescription>{t("auth.displayNameHint")}</FieldDescription>
                  <FieldError errors={[form.formState.errors.displayName]} />
                </Field>
              </FieldGroup>

              <Button type="submit" className="w-fit" disabled={saving}>
                {saving ? t("auth.saving") : t("settings.save")}
              </Button>
            </form>
          </section>

          <Separator />

          <section className="flex flex-col gap-4">
            <div>
              <h2 className="text-sm font-medium">{t("settings.appearance")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("settings.appearanceHint")}
              </p>
            </div>

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="settings-theme">{t("settings.theme")}</FieldLabel>
                <ThemeSwitcher id="settings-theme" />
              </Field>

              <Field>
                <FieldLabel htmlFor="settings-language">
                  {t("settings.language")}
                </FieldLabel>
                <LanguageSwitcher id="settings-language" />
              </Field>
            </FieldGroup>
          </section>

          <Separator />

          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-medium">{t("settings.security")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("settings.securityHint")}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              onClick={() => setPasswordOpen(true)}
            >
              {t("nav.changePassword")}
            </Button>
          </section>

          <Separator />

          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-medium">{t("settings.mail")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("settings.mailHint")}
              </p>
            </div>

            {aliasesLoading ? (
              <p className="text-sm text-muted-foreground">{t("app.loading")}</p>
            ) : enabledAliases.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("settings.noEnabledAlias")}
              </p>
            ) : (
              <Field>
                <FieldLabel htmlFor="settings-default-alias">
                  {t("settings.defaultAlias")}
                </FieldLabel>
                <Select
                  items={aliasItems}
                  value={defaultAliasId}
                  onValueChange={(value) => void setDefaultAlias(value)}
                  disabled={defaultBusy}
                >
                  <SelectTrigger id="settings-default-alias" className="w-full">
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
                <FieldDescription>{t("settings.defaultAliasHint")}</FieldDescription>
              </Field>
            )}

            <Button
              type="button"
              variant="outline"
              className="w-fit"
              render={<Link to="/aliases" />}
              nativeButton={false}
            >
              {t("nav.aliases")}
            </Button>
          </section>
        </div>
      </ScrollArea>

      <ChangePasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
      />
    </div>
  )
}
