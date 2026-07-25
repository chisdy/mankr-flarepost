import {
  DesktopIcon,
  MoonIcon,
  SunIcon,
} from "@phosphor-icons/react"
import { useTranslation } from "react-i18next"

import { useTheme } from "@/components/theme-provider"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

const THEME_OPTIONS = [
  { value: "light", labelKey: "settings.themeLight", icon: SunIcon },
  { value: "dark", labelKey: "settings.themeDark", icon: MoonIcon },
  { value: "system", labelKey: "settings.themeSystem", icon: DesktopIcon },
] as const

type ThemeSwitcherProps = {
  className?: string
  id?: string
}

export function ThemeSwitcher({ className, id }: ThemeSwitcherProps) {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()

  return (
    <ToggleGroup
      id={id}
      variant="outline"
      spacing={0}
      value={[theme]}
      onValueChange={(values) => {
        const next = values[0]
        if (next === "light" || next === "dark" || next === "system") {
          setTheme(next)
        }
      }}
      aria-label={t("settings.theme")}
      className={cn("w-full sm:w-fit", className)}
    >
      {THEME_OPTIONS.map(({ value, labelKey, icon: Icon }) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={t(labelKey)}
          className="flex-1 sm:flex-initial"
        >
          <Icon data-icon="inline-start" />
          {t(labelKey)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
