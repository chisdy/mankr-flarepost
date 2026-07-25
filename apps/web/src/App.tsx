import { BrowserRouter, Navigate, Route, Routes } from "react-router"

import { AppShell } from "@/components/app-shell"
import { AuthGate } from "@/components/auth-gate"
import { Toaster } from "@/components/ui/sonner"
import { AliasesPage } from "@/pages/aliases"
import { ComposePage } from "@/pages/compose"
import { LoginPage } from "@/pages/login"
import { MailboxPage } from "@/pages/mailbox"
import { MessagePage } from "@/pages/message"
import { SettingsPage } from "@/pages/settings"
import { SetupPage } from "@/pages/setup"

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AuthGate />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<Navigate to="/inbox" replace />} />
            <Route path="/inbox" element={<MailboxPage />} />
            <Route path="/starred" element={<MailboxPage />} />
            <Route path="/tags/:tagId" element={<MailboxPage />} />
            <Route path="/draft" element={<MailboxPage />} />
            <Route path="/sent" element={<MailboxPage />} />
            <Route path="/trash" element={<MailboxPage />} />
            <Route path="/m/:id" element={<MessagePage />} />
            <Route path="/compose" element={<ComposePage />} />
            <Route path="/aliases" element={<AliasesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}

export default App
