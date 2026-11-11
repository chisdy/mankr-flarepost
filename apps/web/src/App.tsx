import { lazy, Suspense } from "react"
import { useTranslation } from "react-i18next"
import { BrowserRouter, Navigate, Route, Routes } from "react-router"

import { AppShell } from "@/components/app-shell"
import { AuthGate } from "@/components/auth-gate"
import { Toaster } from "@/components/ui/sonner"
import { LoginPage } from "@/pages/login"
import { MailboxPage } from "@/pages/mailbox"

const ComposePage = lazy(() => import("@/pages/compose").then((module) => ({ default: module.ComposePage })))
const MessagePage = lazy(() => import("@/pages/message").then((module) => ({ default: module.MessagePage })))
const SettingsPage = lazy(() => import("@/pages/settings").then((module) => ({ default: module.SettingsPage })))
const SetupPage = lazy(() => import("@/pages/setup").then((module) => ({ default: module.SetupPage })))
const UsagePage = lazy(() => import("@/pages/usage").then((module) => ({ default: module.UsagePage })))

function RouteLoading() {
  const { t } = useTranslation()
  return <div role="status" className="grid flex-1 place-items-center p-8 text-sm text-muted-foreground">{t("app.loading")}</div>
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AuthGate />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/setup" element={<Suspense fallback={<RouteLoading />}><SetupPage /></Suspense>} />
          <Route element={<AppShell />}>
            <Route path="/" element={<Navigate to="/inbox" replace />} />
            <Route path="/inbox" element={<MailboxPage />} />
            <Route path="/archive" element={<MailboxPage />} />
            <Route path="/starred" element={<MailboxPage />} />
            <Route path="/search" element={<MailboxPage />} />
            <Route path="/tags/:tagId" element={<MailboxPage />} />
            <Route path="/draft" element={<MailboxPage />} />
            <Route path="/sent" element={<MailboxPage />} />
            <Route path="/trash" element={<MailboxPage />} />
            <Route path="/spam" element={<MailboxPage />} />
            <Route path="/m/:id" element={<MessagePage />} />
            <Route path="/compose" element={<ComposePage />} />
            <Route
              path="/aliases"
              element={<Navigate to="/settings?tab=mail" replace />}
            />
            <Route path="/usage" element={<UsagePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}

export default App
