import { PaperPlaneTiltIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

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
import type { SendProviderId, SendProvidersSnapshot } from "@/lib/types"

const PROVIDERS: SendProviderId[] = ["resend", "brevo", "maileroo"]

const PROVIDER_LABELS: Record<SendProviderId, string> = {
  resend: "Resend",
  brevo: "Brevo",
  maileroo: "Maileroo",
}

/** Sentinel for "follow env / default" in the select. */
const FOLLOW_ENV = "__env__"

export function SendProvidersSettings() {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<SendProvidersSnapshot | null>(null)
  const [activeChoice, setActiveChoice] = useState<string>(FOLLOW_ENV)
  const [draftKeys, setDraftKeys] = useState<Record<SendProviderId, string>>({
    resend: "",
    brevo: "",
    maileroo: "",
  })
  const [clearFlags, setClearFlags] = useState<
    Partial<Record<SendProviderId, boolean>>
  >({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const activeProviderItems = [
    { value: FOLLOW_ENV, label: t("settings.sendFollowEnv") },
    ...PROVIDERS.map((provider) => ({
      value: provider,
      label: PROVIDER_LABELS[provider],
    })),
  ]

  function applySnapshot(data: SendProvidersSnapshot) {
    setSnapshot(data)
    setActiveChoice(
      data.activeSource === "database" ? data.activeProvider : FOLLOW_ENV,
    )
    setDraftKeys({ resend: "", brevo: "", maileroo: "" })
    setClearFlags({})
  }

  useEffect(() => {
    let cancelled = false
    api<SendProvidersSnapshot>("/api/send-providers")
      .then((data) => {
        if (!cancelled) applySnapshot(data)
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(
            isApiError(err) ? err.message : t("settings.sendProvidersLoadFailed"),
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [t])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const secrets: Array<{ provider: SendProviderId; apiKey: string }> = []
      for (const provider of PROVIDERS) {
        if (clearFlags[provider]) {
          secrets.push({ provider, apiKey: "" })
        } else if (draftKeys[provider].trim()) {
          secrets.push({ provider, apiKey: draftKeys[provider].trim() })
        }
      }

      const body: {
        activeProvider: SendProviderId | null
        secrets?: Array<{ provider: SendProviderId; apiKey: string }>
      } = {
        activeProvider:
          activeChoice === FOLLOW_ENV
            ? null
            : (activeChoice as SendProviderId),
      }
      if (secrets.length > 0) body.secrets = secrets

      const updated = await api<SendProvidersSnapshot>("/api/send-providers", {
        method: "PUT",
        body: JSON.stringify(body),
      })
      applySnapshot(updated)
      toast.success(t("settings.saved"))
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("settings.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PaperPlaneTiltIcon className="size-4 text-primary" />
          {t("settings.sendProviders")}
        </CardTitle>
        <CardDescription>{t("settings.sendProvidersHint")}</CardDescription>
      </CardHeader>
      <form className="contents" onSubmit={(e) => void onSubmit(e)}>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="send-active-provider">
                {t("settings.sendActiveProvider")}
              </FieldLabel>
              <Select
                items={activeProviderItems}
                value={activeChoice}
                onValueChange={(value) => {
                  if (value) setActiveChoice(value)
                }}
                disabled={loading}
              >
                <SelectTrigger id="send-active-provider" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {activeProviderItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                {snapshot
                  ? t("settings.sendActiveSource", {
                      source: t(`settings.sendSource.${snapshot.activeSource}`),
                      provider: PROVIDER_LABELS[snapshot.activeProvider],
                    })
                  : t("settings.sendFollowEnvHint")}
              </FieldDescription>
            </Field>

            {PROVIDERS.map((provider) => {
              const status = snapshot?.providers.find(
                (p) => p.provider === provider,
              )
              const clearing = Boolean(clearFlags[provider])
              const placeholder = clearing
                ? t("settings.sendKeyWillClear")
                : status?.configured && status.source === "database" && status.hint
                  ? t("settings.sendKeyHintStored", { hint: status.hint })
                  : status?.configured && status.source === "env"
                    ? t("settings.sendKeyHintEnv", { envVar: status.envVar })
                    : t("settings.sendKeyPlaceholder")

              return (
                <Field key={provider}>
                  <FieldLabel htmlFor={`send-key-${provider}`}>
                    {PROVIDER_LABELS[provider]} API Key
                  </FieldLabel>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      id={`send-key-${provider}`}
                      type="password"
                      autoComplete="off"
                      disabled={loading || clearing}
                      placeholder={placeholder}
                      value={draftKeys[provider]}
                      onChange={(e) =>
                        setDraftKeys((prev) => ({
                          ...prev,
                          [provider]: e.target.value,
                        }))
                      }
                    />
                    {status?.source === "database" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={loading || saving}
                        onClick={() =>
                          setClearFlags((prev) => ({
                            ...prev,
                            [provider]: !prev[provider],
                          }))
                        }
                      >
                        {clearing
                          ? t("settings.sendKeyKeep")
                          : t("settings.sendKeyClear")}
                      </Button>
                    )}
                  </div>
                  <FieldDescription>
                    {status?.configured
                      ? t("settings.sendKeyStatusConfigured", {
                          source: t(`settings.sendSource.${status.source}`),
                        })
                      : t("settings.sendKeyStatusMissing", {
                          envVar: status?.envVar ?? "",
                        })}
                  </FieldDescription>
                </Field>
              )
            })}
          </FieldGroup>
        </CardContent>
        <CardFooter className="border-t border-border/60 pt-4">
          <Button type="submit" disabled={loading || saving}>
            {saving ? t("auth.saving") : t("settings.save")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
