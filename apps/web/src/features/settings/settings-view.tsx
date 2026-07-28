import { zodResolver } from "@hookform/resolvers/zod"
import {
  AtIcon,
  FunnelIcon,
  KeyIcon,
  PaletteIcon,
  ShieldCheckIcon,
  UserCircleIcon,
} from "@phosphor-icons/react"
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router"
import { toast } from "sonner"
import { z } from "zod"

import { useAuth } from "@/components/auth-gate"
import { LanguageSwitcher } from "@/components/language-switcher"
import { PageHeader } from "@/components/page-header"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import { ScrollArea } from "@/components/ui/scroll-area"
import { ChangePasswordDialog } from "@/features/auth/change-password-dialog"
import { AliasesSettings } from "@/features/settings/aliases-settings"
import { ApiKeysSettings } from "@/features/settings/api-keys-settings"
import { RetentionSettings } from "@/features/settings/retention-settings"
import { SendProvidersSettings } from "@/features/settings/send-providers-settings"
import { TagsFiltersSettings } from "@/features/settings/tags-filters-settings"
import { api, isApiError } from "@/lib/api"
import type { Alias, AuthUser } from "@/lib/types"
import { cn } from "@/lib/utils"

type TabKey = "general" | "security" | "mail" | "tags" | "apikeys"

const TAB_KEYS: TabKey[] = ["general", "security", "mail", "tags", "apikeys"]

function parseTab(value: string | null): TabKey {
  if (value && TAB_KEYS.includes(value as TabKey)) return value as TabKey
  return "general"
}

type ProfileValues = {
  displayName: string
}

export function SettingsView() {
  const { t } = useTranslation()
  const { user, setUser } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<TabKey>(() =>
    parseTab(searchParams.get("tab"))
  )
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [aliases, setAliases] = useState<Alias[]>([])
  const [aliasesLoading, setAliasesLoading] = useState(true)

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
    const next = parseTab(searchParams.get("tab"))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync tab from URL
    setActiveTab(next)
  }, [searchParams])

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount / locale change
    setAliasesLoading(true)
    api<{ aliases: Alias[] }>("/api/aliases")
      .then((data) => {
        if (cancelled) return
        setAliases(data.aliases)
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

  function selectTab(tab: TabKey) {
    setActiveTab(tab)
    if (tab === "general") {
      setSearchParams({}, { replace: true })
    } else {
      setSearchParams({ tab }, { replace: true })
    }
  }

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

  const tabs = [
    {
      id: "general" as const,
      label: t("settings.tabGeneral"),
      icon: UserCircleIcon,
    },
    {
      id: "security" as const,
      label: t("settings.tabSecurity"),
      icon: ShieldCheckIcon,
    },
    {
      id: "mail" as const,
      label: t("settings.tabMail"),
      icon: AtIcon,
    },
    {
      id: "tags" as const,
      label: t("settings.tabTagsFilters"),
      icon: FunnelIcon,
    },
    {
      id: "apikeys" as const,
      label: t("settings.tabApiKeys"),
      icon: KeyIcon,
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader title={t("settings.title")} />

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="shrink-0 px-4 py-2 md:w-56 md:px-3 md:py-4">
          <nav className="flex flex-row gap-1 overflow-x-auto md:flex-col md:overflow-x-visible">
            {tabs.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => selectTab(tab.id)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground shadow-2xs"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </nav>
        </aside>

        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8">
            {activeTab === "general" && (
              <div className="flex flex-col gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <UserCircleIcon className="size-4 text-primary" />
                      {t("settings.profile")}
                    </CardTitle>
                    <CardDescription>
                      {t("settings.profileHint")}
                    </CardDescription>
                  </CardHeader>
                  <form className="contents" onSubmit={form.handleSubmit(onSubmit)}>
                    <CardContent>
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

                        <Field
                          data-invalid={
                            !!form.formState.errors.displayName || undefined
                          }
                        >
                          <FieldLabel htmlFor="settings-display-name">
                            {t("auth.displayName")}
                          </FieldLabel>
                          <Input
                            id="settings-display-name"
                            placeholder={t("auth.optional")}
                            aria-invalid={!!form.formState.errors.displayName}
                            {...form.register("displayName")}
                          />
                          <FieldDescription>
                            {t("auth.displayNameHint")}
                          </FieldDescription>
                          <FieldError
                            errors={[form.formState.errors.displayName]}
                          />
                        </Field>
                      </FieldGroup>
                    </CardContent>
                    <CardFooter className="border-t border-border/60 pt-4">
                      <Button type="submit" disabled={saving}>
                        {saving ? t("auth.saving") : t("settings.save")}
                      </Button>
                    </CardFooter>
                  </form>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <PaletteIcon className="size-4 text-primary" />
                      {t("settings.appearance")}
                    </CardTitle>
                    <CardDescription>
                      {t("settings.appearanceHint")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="settings-theme">
                          {t("settings.theme")}
                        </FieldLabel>
                        <ThemeSwitcher id="settings-theme" />
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="settings-language">
                          {t("settings.language")}
                        </FieldLabel>
                        <LanguageSwitcher id="settings-language" />
                      </Field>
                    </FieldGroup>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === "security" && (
              <div className="flex flex-col gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ShieldCheckIcon className="size-4 text-primary" />
                      {t("settings.security")}
                    </CardTitle>
                    <CardDescription>
                      {t("settings.securityHint")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <p className="text-xs text-muted-foreground">
                      账号密码用于保护管理控制台的安全。建议使用高强度的专属密码。
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-fit"
                      onClick={() => setPasswordOpen(true)}
                    >
                      <KeyIcon data-icon="inline-start" />
                      {t("nav.changePassword")}
                    </Button>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === "mail" && (
              <div className="flex flex-col gap-6">
                <AliasesSettings
                  aliases={aliases}
                  loading={aliasesLoading}
                  onAliasesChange={setAliases}
                />
                <SendProvidersSettings />
                <RetentionSettings />
              </div>
            )}

            {activeTab === "tags" && <TagsFiltersSettings aliases={aliases} />}

            {activeTab === "apikeys" && <ApiKeysSettings aliases={aliases} />}
          </div>
        </ScrollArea>
      </div>

      <ChangePasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
      />
    </div>
  )
}
