import {
  EnvelopeIcon,
  EnvelopeOpenIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  TrashIcon,
  AtIcon,
  UserCircleIcon,
  SignOutIcon,
  KeyIcon,
} from "@phosphor-icons/react"
import { useState } from "react"
import { Link, NavLink, Outlet, useNavigate } from "react-router"
import { toast } from "sonner"

import { useAuth } from "@/components/auth-gate"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { ChangePasswordDialog } from "@/features/auth/change-password-dialog"
import { api, isApiError } from "@/lib/api"
import { cn } from "@/lib/utils"

const folders = [
  { to: "/inbox", label: "Inbox", icon: EnvelopeIcon },
  { to: "/sent", label: "Sent", icon: PaperPlaneTiltIcon },
  { to: "/trash", label: "Trash", icon: TrashIcon },
] as const

export function AppShell() {
  const { user, clearUser } = useAuth()
  const navigate = useNavigate()
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  async function logout() {
    setLoggingOut(true)
    try {
      await api("/api/auth/logout", { method: "POST" })
    } catch (err) {
      toast.error(isApiError(err) ? err.message : "Logout failed")
    } finally {
      clearUser()
      setLoggingOut(false)
      navigate("/login", { replace: true })
    }
  }

  const label = user?.displayName || user?.username || "Account"

  return (
    <div className="flex min-h-svh bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col gap-4 border-r border-border bg-sidebar p-4 text-sidebar-foreground">
        <div className="flex items-center gap-2 px-1">
          <EnvelopeOpenIcon className="size-5 text-sidebar-primary" weight="duotone" />
          <span className="font-heading text-sm font-medium tracking-tight">
            Mankr Mail
          </span>
        </div>

        <Button
          render={<Link to="/compose" />}
          nativeButton={false}
          className="w-full"
        >
          <PlusIcon data-icon="inline-start" />
          Compose
        </Button>

        <nav className="flex flex-col gap-1">
          {folders.map(({ to, label: folderLabel, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-2xl px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/70"
                )
              }
            >
              <Icon />
              {folderLabel}
            </NavLink>
          ))}
        </nav>

        <Separator />

        <NavLink
          to="/aliases"
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2 rounded-2xl px-3 py-2 text-sm transition-colors",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "hover:bg-sidebar-accent/70"
            )
          }
        >
          <AtIcon />
          Aliases
        </NavLink>

        <div className="mt-auto">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" className="w-full justify-start" />
              }
            >
              <UserCircleIcon data-icon="inline-start" />
              <span className="truncate">{label}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuLabel className="truncate">
                {user?.username}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setPasswordOpen(true)}>
                <KeyIcon />
                Change password
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={loggingOut}
                onClick={() => void logout()}
              >
                <SignOutIcon />
                {loggingOut ? "Signing out…" : "Sign out"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>

      <ChangePasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
      />
    </div>
  )
}
