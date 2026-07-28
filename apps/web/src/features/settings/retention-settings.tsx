import { BroomIcon } from "@phosphor-icons/react"
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
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { api, isApiError } from "@/lib/api"
import type { MailboxSettings } from "@/lib/types"

const MIN_DAYS = 1
const MAX_DAYS = 90

function isValidDays(value: string): boolean {
  if (!/^\d+$/.test(value.trim())) return false
  const n = Number(value)
  return n >= MIN_DAYS && n <= MAX_DAYS
}

export function RetentionSettings() {
  const { t } = useTranslation()
  const [trashDays, setTrashDays] = useState("")
  const [spamDays, setSpamDays] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    let cancelled = false
    api<MailboxSettings>("/api/mailbox-settings")
      .then((data) => {
        if (cancelled) return
        setTrashDays(String(data.trashRetentionDays))
        setSpamDays(String(data.spamRetentionDays))
      })
      .catch((err) => {
        if (cancelled) return
        toast.error(
          isApiError(err) ? err.message : t("settings.retentionLoadFailed")
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [t])

  const trashInvalid = touched && !isValidDays(trashDays)
  const spamInvalid = touched && !isValidDays(spamDays)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!isValidDays(trashDays) || !isValidDays(spamDays)) return

    setSaving(true)
    try {
      const updated = await api<MailboxSettings>("/api/mailbox-settings", {
        method: "PATCH",
        body: JSON.stringify({
          trashRetentionDays: Number(trashDays),
          spamRetentionDays: Number(spamDays),
        }),
      })
      setTrashDays(String(updated.trashRetentionDays))
      setSpamDays(String(updated.spamRetentionDays))
      setTouched(false)
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
          <BroomIcon className="size-4 text-primary" />
          {t("settings.retention")}
        </CardTitle>
        <CardDescription>{t("settings.retentionHint")}</CardDescription>
      </CardHeader>
      <form className="contents" onSubmit={onSubmit}>
        <CardContent>
          <FieldGroup>
            <Field data-invalid={trashInvalid || undefined}>
              <FieldLabel htmlFor="retention-trash">
                {t("settings.retentionTrashDays")}
              </FieldLabel>
              <Input
                id="retention-trash"
                type="number"
                inputMode="numeric"
                min={MIN_DAYS}
                max={MAX_DAYS}
                step={1}
                value={trashDays}
                disabled={loading || saving}
                aria-invalid={trashInvalid}
                onChange={(e) => setTrashDays(e.target.value)}
              />
              <FieldDescription>
                {t("settings.retentionRange")}
              </FieldDescription>
              {trashInvalid ? (
                <FieldError errors={[{ message: t("settings.retentionInvalid") }]} />
              ) : null}
            </Field>

            <Field data-invalid={spamInvalid || undefined}>
              <FieldLabel htmlFor="retention-spam">
                {t("settings.retentionSpamDays")}
              </FieldLabel>
              <Input
                id="retention-spam"
                type="number"
                inputMode="numeric"
                min={MIN_DAYS}
                max={MAX_DAYS}
                step={1}
                value={spamDays}
                disabled={loading || saving}
                aria-invalid={spamInvalid}
                onChange={(e) => setSpamDays(e.target.value)}
              />
              <FieldDescription>
                {t("settings.retentionRange")}
              </FieldDescription>
              {spamInvalid ? (
                <FieldError errors={[{ message: t("settings.retentionInvalid") }]} />
              ) : null}
            </Field>
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
