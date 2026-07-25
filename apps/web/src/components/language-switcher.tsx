import { useTranslation } from "react-i18next"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  LOCALE_LABEL_KEYS,
  SUPPORTED_LOCALES,
  type AppLocale,
} from "@/i18n"
import { cn } from "@/lib/utils"

function resolveAppLocale(lng: string | undefined): AppLocale {
  if (lng && SUPPORTED_LOCALES.includes(lng as AppLocale)) return lng as AppLocale
  if (lng?.toLowerCase().startsWith("zh")) return "zh-CN"
  return "en"
}

type LanguageSwitcherProps = {
  className?: string
  id?: string
}

export function LanguageSwitcher({ className, id }: LanguageSwitcherProps) {
  const { t, i18n } = useTranslation()
  const current = resolveAppLocale(i18n.resolvedLanguage ?? i18n.language)

  const items = SUPPORTED_LOCALES.map((locale) => ({
    value: locale,
    label: t(LOCALE_LABEL_KEYS[locale]),
  }))

  return (
    <Select
      items={items}
      value={current}
      onValueChange={(value) => {
        if (value && SUPPORTED_LOCALES.includes(value as AppLocale)) {
          void i18n.changeLanguage(value)
        }
      }}
    >
      <SelectTrigger
        id={id}
        className={cn("w-full sm:w-48", className)}
        aria-label={t("settings.language")}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
