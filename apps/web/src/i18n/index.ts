import i18n from "i18next"
import LanguageDetector from "i18next-browser-languagedetector"
import { initReactI18next } from "react-i18next"

import en from "./locales/en.json"
import zhCN from "./locales/zh-CN.json"

/** Add new locale codes here when shipping another language pack. */
export const SUPPORTED_LOCALES = ["en", "zh-CN"] as const
export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

export const LOCALE_LABEL_KEYS: Record<AppLocale, string> = {
  en: "language.en",
  "zh-CN": "language.zh-CN",
}

function normalizeLocale(lng: string): AppLocale {
  const lower = lng.toLowerCase()
  if (lower.startsWith("zh")) return "zh-CN"
  if (lower.startsWith("en")) return "en"
  return SUPPORTED_LOCALES.includes(lng as AppLocale) ? (lng as AppLocale) : "en"
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      "zh-CN": { translation: zhCN },
    },
    fallbackLng: "en",
    supportedLngs: [...SUPPORTED_LOCALES],
    // Avoid load:'all' + nonExplicitSupportedLngs with zh-CN — i18next then
    // inserts a bare `zh` into the resolve chain and falls back to English.
    load: "currentOnly",
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "mankr.locale",
      convertDetectedLanguage: normalizeLocale,
    },
  })

function syncDocumentLang(lng: string) {
  document.documentElement.lang = normalizeLocale(lng)
}

i18n.on("initialized", () => {
  syncDocumentLang(i18n.resolvedLanguage ?? i18n.language)
})
i18n.on("languageChanged", syncDocumentLang)

export default i18n
