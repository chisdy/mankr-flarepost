import { CloudIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react"
import { useTranslation } from "react-i18next"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { CloudflareErrorReason, UsageSnapshot } from "@/lib/types"

import { formatBytes, formatCount } from "./format"
import { ProviderNotice } from "./provider-notice"
import { QuotaRing, QuotaRingSkeleton } from "./quota-ring"

/** Explicit map rather than an interpolated key, so an unhandled reason fails typecheck. */
const CLOUDFLARE_ERROR_KEYS: Record<CloudflareErrorReason, string> = {
  unauthorized: "usage.cloudflareErrorUnauthorized",
  query_failed: "usage.cloudflareErrorQueryFailed",
  unreachable: "usage.cloudflareErrorUnreachable",
}

export function ResendCard({
  resend,
  loading,
}: {
  resend: UsageSnapshot["resend"] | undefined
  loading: boolean
}) {
  const { t } = useTranslation()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PaperPlaneTiltIcon className="size-4 text-primary" />
          {t("usage.resendTitle")}
        </CardTitle>
        <CardDescription>{t("usage.resendHint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {loading ? (
          <QuotaRingSkeleton count={2} />
        ) : resend ? (
          <>
            <ProviderNotice
              status={resend.status}
              notConfiguredHint={t("usage.resendNotConfigured")}
            />
            {resend.status === "ok" && (
              <div className="grid gap-6 sm:grid-cols-2">
                <QuotaRing
                  label={t("usage.resendDaily")}
                  hint={t("usage.windowDay")}
                  quota={resend.daily}
                  color="var(--chart-1)"
                  format={formatCount}
                />
                <QuotaRing
                  label={t("usage.resendMonthly")}
                  hint={t("usage.windowMonth")}
                  quota={resend.monthly}
                  color="var(--chart-2)"
                  format={formatCount}
                />
              </div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function CloudflareCard({
  cloudflare,
  fetchedAt,
  loading,
}: {
  cloudflare: UsageSnapshot["cloudflare"] | undefined
  fetchedAt: string | undefined
  loading: boolean
}) {
  const { t } = useTranslation()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CloudIcon className="size-4 text-primary" />
          {t("usage.cloudflareTitle")}
        </CardTitle>
        <CardDescription>{t("usage.cloudflareHint")}</CardDescription>
        {fetchedAt ? (
          <CardAction className="text-xs text-muted-foreground">
            {t("usage.fetchedAt", {
              value: new Date(fetchedAt).toLocaleTimeString(),
            })}
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {loading ? (
          <QuotaRingSkeleton count={4} />
        ) : cloudflare ? (
          <>
            <ProviderNotice
              status={cloudflare.status}
              notConfiguredHint={t("usage.cloudflareNotConfigured")}
              errorHint={
                cloudflare.reason
                  ? t(CLOUDFLARE_ERROR_KEYS[cloudflare.reason])
                  : undefined
              }
            />
            {cloudflare.status === "ok" && (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <QuotaRing
                  label={t("usage.workersRequests")}
                  hint={t("usage.windowDayUtc")}
                  quota={cloudflare.workersRequests}
                  color="var(--chart-1)"
                  format={formatCount}
                />
                <QuotaRing
                  label={t("usage.d1RowsRead")}
                  hint={t("usage.windowDayUtc")}
                  quota={cloudflare.d1RowsRead}
                  color="var(--chart-3)"
                  format={formatCount}
                />
                <QuotaRing
                  label={t("usage.d1RowsWritten")}
                  hint={t("usage.windowDayUtc")}
                  quota={cloudflare.d1RowsWritten}
                  color="var(--chart-4)"
                  format={formatCount}
                />
                <QuotaRing
                  label={t("usage.d1Storage")}
                  hint={t("usage.windowTotal")}
                  quota={cloudflare.d1StorageBytes}
                  color="var(--chart-5)"
                  format={formatBytes}
                />
              </div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
