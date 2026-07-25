import {
  AtIcon,
  EnvelopeIcon,
  EnvelopeOpenIcon,
  GearIcon,
  KeyIcon,
  ListIcon,
  NoteBlankIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  SignOutIcon,
  StarIcon,
  TagIcon,
  TrashIcon,
  UserCircleIcon,
} from "@phosphor-icons/react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router"
import { toast } from "sonner"

import { useAuth } from "@/components/auth-gate"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ChangePasswordDialog } from "@/features/auth/change-password-dialog"
import { api, isApiError } from "@/lib/api"
import type { Tag } from "@/lib/types"
import { cn } from "@/lib/utils"

const folders = [
  { to: "/inbox", labelKey: "nav.inbox", icon: EnvelopeIcon },
  { to: "/starred", labelKey: "nav.starred", icon: StarIcon },
  { to: "/draft", labelKey: "nav.drafts", icon: NoteBlankIcon },
  { to: "/sent", labelKey: "nav.sent", icon: PaperPlaneTiltIcon },
  { to: "/trash", labelKey: "nav.trash", icon: TrashIcon },
] as const

function navClassName(isActive: boolean) {
  return cn(
    "flex items-center gap-2 rounded-2xl px-3 py-2 text-sm transition-colors",
    isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/70"
  )
}

type SidebarNavProps = {
  onNavigate?: () => void
  tags: Tag[]
}

function SidebarNav({ onNavigate, tags }: SidebarNavProps) {
  const { t } = useTranslation()

  return (
    <>
      <Button
        render={<Link to="/compose" onClick={onNavigate} />}
        nativeButton={false}
        className="w-full"
      >
        <PlusIcon data-icon="inline-start" />
        {t("nav.compose")}
      </Button>

      <nav className="flex flex-col gap-1">
        {folders.map(({ to, labelKey, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) => navClassName(isActive)}
          >
            <Icon />
            {t(labelKey)}
          </NavLink>
        ))}
      </nav>

      {tags.length > 0 ? (
        <>
          <Separator />
          <p className="px-3 text-xs font-medium text-muted-foreground">
            {t("nav.tags")}
          </p>
          <nav className="flex flex-col gap-1">
            {tags.map((tag) => (
              <NavLink
                key={tag.id}
                to={`/tags/${tag.id}`}
                onClick={onNavigate}
                className={({ isActive }) => navClassName(isActive)}
              >
                <TagIcon
                  style={
                    tag.color &&
                    /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(tag.color)
                      ? { color: tag.color }
                      : undefined
                  }
                />
                <span className="truncate">{tag.name}</span>
              </NavLink>
            ))}
          </nav>
        </>
      ) : null}

      <Separator />

      <NavLink
        to="/aliases"
        onClick={onNavigate}
        className={({ isActive }) => navClassName(isActive)}
      >
        <AtIcon />
        {t("nav.aliases")}
      </NavLink>

      <NavLink
        to="/settings"
        onClick={onNavigate}
        className={({ isActive }) => navClassName(isActive)}
      >
        <GearIcon />
        {t("nav.settings")}
      </NavLink>
    </>
  )
}

type AccountMenuProps = {
  label: string
  username: string | undefined
  loggingOut: boolean
  onSettings: () => void
  onChangePassword: () => void
  onLogout: () => void
}

function AccountMenu({
  label,
  username,
  loggingOut,
  onSettings,
  onChangePassword,
  onLogout,
}: AccountMenuProps) {
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" className="w-full justify-start" />}
      >
        <UserCircleIcon data-icon="inline-start" />
        <span className="truncate">{label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="end"
        sideOffset={8}
        className="w-52"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">{username}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSettings}>
          <GearIcon />
          {t("nav.settings")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onChangePassword}>
          <KeyIcon />
          {t("nav.changePassword")}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={loggingOut}
          onClick={onLogout}
        >
          <SignOutIcon />
          {loggingOut ? t("nav.signingOut") : t("nav.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppShell() {
  const { t } = useTranslation()
  const { user, clearUser } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [tags, setTags] = useState<Tag[]>([])

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  useEffect(() => {
    let cancelled = false
    api<{ tags: Tag[] }>("/api/tags")
      .then((data) => {
        if (!cancelled) setTags(data.tags)
      })
      .catch(() => {
        if (!cancelled) setTags([])
      })
    return () => {
      cancelled = true
    }
  }, [location.pathname])

  async function logout() {
    setLoggingOut(true)
    try {
      await api("/api/auth/logout", { method: "POST" })
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("auth.logoutFailed"))
    } finally {
      clearUser()
      setLoggingOut(false)
      navigate("/login", { replace: true })
    }
  }

  const label = user?.displayName || user?.username || t("app.account")
  const closeMobileNav = () => setMobileNavOpen(false)

  return (
    <div className="flex h-svh overflow-hidden bg-background text-foreground">
      <aside className="hidden h-full w-56 shrink-0 flex-col gap-4 overflow-y-auto p-4 md:flex">
        <div className="flex items-center gap-2 px-1">
          <EnvelopeOpenIcon
            className="size-5 shrink-0 text-primary"
            weight="duotone"
          />
          <span className="truncate font-heading text-sm font-medium tracking-tight">
            {t("app.name")}
          </span>
        </div>

        <SidebarNav tags={tags} />

        <div className="mt-auto">
          <AccountMenu
            label={label}
            username={user?.username}
            loggingOut={loggingOut}
            onSettings={() => navigate("/settings")}
            onChangePassword={() => setPasswordOpen(true)}
            onLogout={() => void logout()}
          />
        </div>
      </aside>

      <div className="m-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-main text-main-foreground shadow-sm">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2 md:hidden">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("nav.openMenu")}
            onClick={() => setMobileNavOpen(true)}
          >
            <ListIcon />
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <EnvelopeOpenIcon
              className="size-5 shrink-0 text-primary"
              weight="duotone"
            />
            <span className="truncate font-heading text-sm font-medium tracking-tight">
              {t("app.name")}
            </span>
          </div>
          <Button
            type="button"
            size="icon-sm"
            aria-label={t("nav.compose")}
            render={<Link to="/compose" />}
            nativeButton={false}
          >
            <PlusIcon />
          </Button>
        </header>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          className="w-[min(100%,18rem)] gap-4 bg-background p-4 text-foreground"
          showCloseButton={false}
        >
          <SheetHeader className="p-0">
            <SheetTitle className="flex items-center gap-2">
              <EnvelopeOpenIcon
                className="size-5 text-primary"
                weight="duotone"
              />
              {t("app.name")}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {t("nav.menuDescription")}
            </SheetDescription>
          </SheetHeader>

          <SidebarNav tags={tags} onNavigate={closeMobileNav} />

          <div className="mt-auto">
            <AccountMenu
              label={label}
              username={user?.username}
              loggingOut={loggingOut}
              onSettings={() => {
                closeMobileNav()
                navigate("/settings")
              }}
              onChangePassword={() => {
                closeMobileNav()
                setPasswordOpen(true)
              }}
              onLogout={() => {
                closeMobileNav()
                void logout()
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      <ChangePasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
      />
    </div>
  )
}
