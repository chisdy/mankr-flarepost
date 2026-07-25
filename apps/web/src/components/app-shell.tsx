import {
  EnvelopeIcon,
  EnvelopeOpenIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  TrashIcon,
  AtIcon,
} from "@phosphor-icons/react"
import { Link, NavLink, Outlet } from "react-router"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

const folders = [
  { to: "/inbox", label: "Inbox", icon: EnvelopeIcon },
  { to: "/sent", label: "Sent", icon: PaperPlaneTiltIcon },
  { to: "/trash", label: "Trash", icon: TrashIcon },
] as const

export function AppShell() {
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
          {folders.map(({ to, label, icon: Icon }) => (
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
              {label}
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
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  )
}
