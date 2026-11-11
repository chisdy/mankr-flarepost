import { ArrowRight01Icon, Cancel01Icon } from "@hugeicons/core-free-icons"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"

import { Icon } from "@/components/icon"
import { Button } from "@/components/ui/button"

const STORAGE_KEY = "mankr.onboarding.dismissed"

export function isOnboardingDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

export function dismissOnboarding(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1")
  } catch {
    // ignore quota / private mode
  }
}

type OnboardingGuideProps = {
  aliasCount: number | null
  compact?: boolean
  onDismiss?: () => void
}

export function OnboardingGuide({
  aliasCount,
  compact = false,
  onDismiss,
}: OnboardingGuideProps) {
  const { t } = useTranslation()

  return (
    <div
      className={
        compact
          ? "relative rounded-2xl bg-muted/40 px-4 py-3"
          : "rounded-2xl bg-muted/50 px-5 py-4"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-heading text-sm font-medium">
          {t("onboarding.title")}
        </h2>
        {onDismiss ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            aria-label={t("onboarding.dismiss")}
            onClick={onDismiss}
          >
            <Icon icon={Cancel01Icon} />
          </Button>
        ) : null}
      </div>
      <ol className="mt-3 list-decimal space-y-2 pl-4 text-sm text-muted-foreground">
        <li>
          {aliasCount === 0 ? (
            <>
              {t("onboarding.stepAlias")}{" "}
              <Link
                to="/settings?tab=mail"
                className="text-foreground underline"
              >
                {t("settings.tabMail")}
              </Link>
            </>
          ) : (
            t("onboarding.stepAliasDone")
          )}
        </li>
        <li>{t("onboarding.stepDns")}</li>
        <li>{t("onboarding.stepTest")}</li>
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">
        {t("onboarding.docsHint")}
      </p>
    </div>
  )
}

/** Dismissible first-login banner shown until the user closes it. */
export function OnboardingBanner({
  aliasCount,
}: {
  aliasCount: number | null
}) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(() => !isOnboardingDismissed())

  if (!visible) return null

  return (
    <details className="group/onboarding px-4 sm:px-7">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-3 text-sm font-medium text-primary [&::-webkit-details-marker]:hidden">
        <Icon
          icon={ArrowRight01Icon}
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform duration-150 group-open/onboarding:rotate-90 motion-reduce:transition-none"
        />
        {t("onboarding.title")}
      </summary>
      <div className="pb-3">
        <OnboardingGuide
          aliasCount={aliasCount}
          compact
          onDismiss={() => {
            dismissOnboarding()
            setVisible(false)
          }}
        />
      </div>
    </details>
  )
}
