import { useTranslation } from "react-i18next"
import {
  Label,
  PolarAngleAxis,
  PolarRadiusAxis,
  RadialBar,
  RadialBarChart,
} from "recharts"

import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import type { Quota } from "@/lib/types"

type QuotaRingProps = {
  label: string
  hint: string
  quota: Quota | null
  color: string
  format: (value: number) => string
}

export function QuotaRing({
  label,
  hint,
  quota,
  color,
  format,
}: QuotaRingProps) {
  const { t } = useTranslation()

  if (!quota) {
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex size-[150px] items-center justify-center rounded-full border border-dashed">
          <span className="px-4 text-xs text-muted-foreground">
            {t("usage.unavailable")}
          </span>
        </div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          {t("usage.unavailableHint")}
        </p>
      </div>
    )
  }

  const limit = Math.max(quota.limit, 1)
  // Over-quota usage would wrap the ring past 360°, so plot it capped.
  const plotted = Math.min(quota.used, limit)
  const percent = Math.round((plotted / limit) * 100)
  const chartConfig = {
    used: { label, color },
  } satisfies ChartConfig

  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <ChartContainer
        config={chartConfig}
        className="aspect-square h-[150px] w-[150px]"
      >
        <RadialBarChart
          data={[{ metric: label, used: plotted }]}
          startAngle={90}
          endAngle={-270}
          innerRadius={58}
          outerRadius={78}
        >
          {/* Only the angle axis may be numeric — a numeric radius axis collapses the bar to zero thickness. */}
          <PolarAngleAxis type="number" domain={[0, limit]} tick={false} />
          <RadialBar
            dataKey="used"
            background
            fill="var(--color-used)"
            cornerRadius={8}
          />
          <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
            <Label
              content={({ viewBox }) => {
                if (!viewBox || !("cx" in viewBox)) return null
                const cx = Number(viewBox.cx ?? 0)
                const cy = Number(viewBox.cy ?? 0)
                return (
                  <text
                    x={cx}
                    y={cy}
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    <tspan
                      x={cx}
                      y={cy - 4}
                      className="fill-foreground text-2xl font-semibold tabular-nums"
                    >
                      {percent}%
                    </tspan>
                    <tspan
                      x={cx}
                      y={cy + 16}
                      className="fill-muted-foreground text-xs"
                    >
                      {t("usage.usedLabel")}
                    </tspan>
                  </text>
                )
              }}
            />
          </PolarRadiusAxis>
        </RadialBarChart>
      </ChartContainer>

      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground tabular-nums">
        {format(quota.used)} / {format(quota.limit)}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("usage.remaining", { value: format(quota.remaining) })}
      </p>
      <p className="text-[0.65rem] text-muted-foreground">{hint}</p>
    </div>
  )
}

export function QuotaRingSkeleton({ count }: { count: number }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col items-center gap-2">
          <Skeleton className="size-[150px] rounded-full" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  )
}
