import { useTranslation } from "react-i18next"

import { Skeleton } from "@/components/ui/skeleton"
import type { Quota } from "@/lib/types"

type QuotaMeterProps = {
  label: string
  hint: string
  quota: Quota | null
  color: string
  format: (value: number) => string
}

export function QuotaMeter({ label, hint, quota, color, format }: QuotaMeterProps) {
  const { t } = useTranslation()
  const used = quota ? format(quota.used) : ""
  const limit = quota ? format(quota.limit) : ""
  const percent = quota && quota.limit > 0 ? Math.round((quota.used / quota.limit) * 100) : 0

  return (
    <div className="min-w-0 rounded-lg bg-background/55 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">{label}</h3>
        {quota ? <span className="text-xs font-semibold tabular-nums">{percent}%</span> : null}
      </div>
      {quota ? (
        <>
          <div
            role="meter"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={Math.max(quota.limit, 1)}
            aria-valuenow={Math.max(0, Math.min(quota.used, quota.limit))}
            aria-valuetext={`${used} / ${limit}`}
            className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(percent, 100))}%`, backgroundColor: color }} />
          </div>
          <p className="mt-2 text-sm tabular-nums">{used} / {limit}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("usage.remaining", { value: format(quota.remaining) })}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">{t("usage.unavailable")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("usage.unavailableHint")}</p>
        </>
      )}
    </div>
  )
}

export function QuotaMeterSkeleton({ count }: { count: number }) {
  return (
    <div aria-busy="true" className="grid gap-5 sm:grid-cols-2">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="space-y-3 rounded-lg bg-background/55 p-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-4 w-32" />
        </div>
      ))}
    </div>
  )
}
