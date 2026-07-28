import { LightningIcon } from "@phosphor-icons/react"
import { useTranslation } from "react-i18next"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { FreeTierLimits } from "@/lib/types"

import { formatBytes, formatCount } from "./format"

export function FreeTierCard({ limits }: { limits: FreeTierLimits | null }) {
  const { t } = useTranslation()

  const groups = limits
    ? [
        {
          title: "Resend",
          rows: [
            {
              value: formatCount(limits.resendEmailsPerDay),
              label: t("usage.limitEmailsPerDay"),
            },
            {
              value: formatCount(limits.resendEmailsPerMonth),
              label: t("usage.limitEmailsPerMonth"),
            },
          ],
        },
        {
          title: "Cloudflare Workers",
          rows: [
            {
              value: formatCount(limits.workersRequestsPerDay),
              label: t("usage.limitRequestsPerDay"),
            },
          ],
        },
        {
          title: "Cloudflare D1",
          rows: [
            {
              value: formatCount(limits.d1RowsReadPerDay),
              label: t("usage.limitRowsReadPerDay"),
            },
            {
              value: formatCount(limits.d1RowsWrittenPerDay),
              label: t("usage.limitRowsWrittenPerDay"),
            },
            {
              value: formatBytes(limits.d1StorageBytes),
              label: t("usage.limitStored"),
            },
          ],
        },
      ]
    : null

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <LightningIcon className="size-4 text-primary" />
          {t("usage.freeTierTitle")}
        </CardTitle>
        <CardDescription className="text-xs">
          {t("usage.freeTierNote")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {groups ? (
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
            {groups.map((group) => (
              <div key={group.title} className="flex flex-col gap-1">
                <dt className="text-xs font-medium text-muted-foreground">
                  {group.title}
                </dt>
                {group.rows.map((row) => (
                  <dd key={row.label} className="flex items-baseline gap-1.5">
                    <span className="font-medium tabular-nums">
                      {row.value}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {row.label}
                    </span>
                  </dd>
                ))}
              </div>
            ))}
          </dl>
        ) : (
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="flex flex-col gap-2">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
