import {
  DesktopIcon,
  MoonIcon,
  SunIcon,
} from "@phosphor-icons/react"
import { useTranslation } from "react-i18next"

import { useTheme } from "@/components/theme-provider"
import Segmented from "@/components/ui/segmented"
import { cn } from "@/lib/utils"

const THEME_OPTIONS = ["light", "dark", "system"] as const
type ThemeOption = (typeof THEME_OPTIONS)[number]

const ICON_MAP = {
  light: SunIcon,
  dark: MoonIcon,
  system: DesktopIcon,
} as const

const LABEL_MAP = {
  light: "settings.themeLight",
  dark: "settings.themeDark",
  system: "settings.themeSystem",
} as const

type ThemeSwitcherProps = {
  className?: string
  id?: string
}

export function ThemeSwitcher({ className, id }: ThemeSwitcherProps) {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()

  return (
    <div id={id} className={cn("w-full sm:w-fit", className)}>
      <Segmented<ThemeOption>
        value={theme}
        onChange={(next) => setTheme(next)}
        options={THEME_OPTIONS}
        renderLabel={(val) => {
          const Icon = ICON_MAP[val]
          return (
            <>
              <Icon className="size-4 shrink-0" />
              <span>{t(LABEL_MAP[val])}</span>
            </>
          )
        }}
        className="w-full sm:w-fit"
      />
    </div>
  )
}
