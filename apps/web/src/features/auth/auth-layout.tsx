import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { BrandMark } from "@/components/brand-mark"
import { LanguageSwitcher } from "@/components/language-switcher"

export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation()

  return (
    <main className="grid min-h-svh grid-rows-[auto_1fr] bg-main md:grid-rows-1 md:grid-cols-[minmax(16rem,0.85fr)_minmax(0,1.15fr)]">
      <div className="post-rail flex items-center gap-3 overflow-hidden px-5 py-4 md:relative md:items-start md:px-10 md:py-9">
        <BrandMark className="size-9" />
        <span className="self-center text-base font-semibold tracking-tight md:self-auto md:pt-1.5">
          {t("app.name")}
        </span>
        <BrandMark className="pointer-events-none absolute top-1/2 left-1/2 hidden size-[min(58%,22rem)] -translate-x-1/2 -translate-y-1/2 text-foreground/15 opacity-90 md:block dark:text-primary" />
      </div>
      <div className="flex min-w-0 flex-col">
        <div className="flex justify-end px-5 pt-4 md:px-8 md:pt-7">
          <LanguageSwitcher className="w-36" />
        </div>
        <div className="flex flex-1 items-start justify-center px-5 pt-12 pb-10 md:items-center md:px-10 md:pt-5">
          {children}
        </div>
      </div>
    </main>
  )
}
