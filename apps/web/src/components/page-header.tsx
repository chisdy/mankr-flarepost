import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

type PageHeaderProps = {
  title?: ReactNode
  description?: ReactNode
  leading?: ReactNode
  actions?: ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  leading,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-7 sm:py-5",
        className
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {leading}
        {title != null || description != null ? (
          <div className="flex min-w-0 flex-col gap-0.5">
            {title != null ? (
              typeof title === "string" || typeof title === "number" ? (
                <h1 className="font-heading text-[1.5rem] leading-tight font-semibold tracking-tight sm:text-[1.75rem] [overflow-wrap:anywhere]">{title}</h1>
              ) : (
                title
              )
            ) : null}
            {description != null ? (
              typeof description === "string" ||
              typeof description === "number" ? (
                <p className="text-sm text-muted-foreground">{description}</p>
              ) : (
                description
              )
            ) : null}
          </div>
        ) : null}
      </div>
      {actions != null ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  )
}
