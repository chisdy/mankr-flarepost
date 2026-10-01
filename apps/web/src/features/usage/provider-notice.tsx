import { AlertCircleIcon } from "@hugeicons/core-free-icons"

import { useTranslation } from "react-i18next"

import { Icon } from "@/components/icon"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { ProviderStatus } from "@/lib/types"

export function ProviderNotice({
  status,
  notConfiguredHint,
  errorHint,
}: {
  status: ProviderStatus
  notConfiguredHint: string
  errorHint?: string
}) {
  const { t } = useTranslation()
  if (status === "ok") return null

  const isError = status === "error"
  return (
    <Alert variant={isError ? "destructive" : "default"}>
      <Icon icon={AlertCircleIcon} />
      <AlertTitle>
        {isError ? t("usage.errorTitle") : t("usage.notConfiguredTitle")}
      </AlertTitle>
      <AlertDescription>
        {isError ? (errorHint ?? t("usage.errorHint")) : notConfiguredHint}
      </AlertDescription>
    </Alert>
  )
}
