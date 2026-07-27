import { XIcon } from "@phosphor-icons/react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"

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
          ? "relative rounded-2xl border border-border bg-muted/40 px-4 py-3"
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
            <XIcon />
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
export function OnboardingBanner({ aliasCount }: { aliasCount: number | null }) {
  const [visible, setVisible] = useState(() => !isOnboardingDismissed())

  if (!visible) return null

  return (
    <div className="border-b border-border px-4 py-3 sm:px-6">
      <OnboardingGuide
        aliasCount={aliasCount}
        compact
        onDismiss={() => {
          dismissOnboarding()
          setVisible(false)
        }}
      />
    </div>
  )
}
