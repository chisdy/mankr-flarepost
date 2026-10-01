import {
  AlertDiamondIcon,
  Delete02Icon,
  GaugeIcon,
  Key01Icon,
  Logout01Icon,
  Mail01Icon,
  MailOpen01Icon,
  Menu01Icon,
  Note01Icon,
  PlusSignIcon,
  Search01Icon,
  SentIcon,
  Settings01Icon,
  StarIcon,
  UserCircle02Icon,
} from "@hugeicons/core-free-icons"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router"
import { toast } from "sonner"

import { useAuth } from "@/components/auth-gate"
import { Icon } from "@/components/icon"
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
import { ScrollArea } from "@/components/ui/scroll-area"
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
import type { FolderCounts, Tag } from "@/lib/types"
import { cn } from "@/lib/utils"

const folders = [
  {
    to: "/inbox",
    labelKey: "nav.inbox",
    icon: Mail01Icon,
    countKey: "inbox",
  },
  {
    to: "/starred",
    labelKey: "nav.starred",
    icon: StarIcon,
    countKey: "starred",
  },
  { to: "/search", labelKey: "nav.search", icon: Search01Icon },
  {
    to: "/draft",
    labelKey: "nav.drafts",
    icon: Note01Icon,
    countKey: "draft",
  },
  {
    to: "/sent",
    labelKey: "nav.sent",
    icon: SentIcon,
    countKey: "sent",
  },
  {
    to: "/spam",
    labelKey: "nav.spam",
    icon: AlertDiamondIcon,
    countKey: "spam",
  },
  {
    to: "/trash",
    labelKey: "nav.trash",
    icon: Delete02Icon,
    countKey: "trash",
  },
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
  counts: FolderCounts | null
}

function SidebarNav({ onNavigate, tags, counts }: SidebarNavProps) {
  const { t } = useTranslation()

  return (
    <>
      <Button
        variant="glass"
        render={<Link to="/compose" onClick={onNavigate} />}
        nativeButton={false}
        className="w-full"
      >
        <Icon icon={PlusSignIcon} data-icon="inline-start" />
        {t("nav.compose")}
      </Button>

      <ScrollArea
        className="min-h-0 flex-1 -mx-4"
        scrollbarClassName="pointer-events-none !w-1.5 opacity-0 transition-opacity duration-150 group-hover/sidebar:pointer-events-auto group-hover/sidebar:opacity-100 data-scrolling:pointer-events-auto data-scrolling:opacity-100 data-scrolling:duration-0 !end-1"
      >
        <div className="flex flex-col gap-4 px-4">
          <nav className="flex flex-col gap-1">
            {folders.map(({ to, labelKey, icon: folderIcon, ...rest }) => {
              const countKey = "countKey" in rest ? rest.countKey : undefined
              const count = countKey && counts ? counts[countKey] : null
              return (
                <NavLink
                  key={to}
                  to={to}
                  onClick={onNavigate}
                  className={({ isActive }) => navClassName(isActive)}
                >
                  <Icon icon={folderIcon} className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{t(labelKey)}</span>
                  {count != null && count > 0 ? (
                    <span className="shrink-0 text-[0.65rem] text-muted-foreground tabular-nums">
                      {count}
                    </span>
                  ) : null}
                </NavLink>
              )
            })}
          </nav>

          {tags.length > 0 ? (
            <>
              <Separator />
              <p className="px-3 text-xs font-medium text-muted-foreground">
                {t("nav.tags")}
              </p>
              <nav className="flex flex-col gap-1">
                {tags.map((tag) => {
                  const color =
                    tag.color &&
                    /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(tag.color)
                      ? tag.color
                      : undefined
                  return (
                    <NavLink
                      key={tag.id}
                      to={`/tags/${tag.id}`}
                      onClick={onNavigate}
                      className={({ isActive }) => navClassName(isActive)}
                    >
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full bg-muted-foreground/50"
                        style={color ? { backgroundColor: color } : undefined}
                      />
                      <span className="truncate">{tag.name}</span>
                    </NavLink>
                  )
                })}
              </nav>
            </>
          ) : null}

          <Separator />

          <NavLink
            to="/usage"
            onClick={onNavigate}
            className={({ isActive }) => navClassName(isActive)}
          >
            <Icon icon={GaugeIcon} className="size-4" />
            {t("nav.usage")}
          </NavLink>

          <NavLink
            to="/settings"
            onClick={onNavigate}
            className={({ isActive }) => navClassName(isActive)}
          >
            <Icon icon={Settings01Icon} className="size-4" />
            {t("nav.settings")}
          </NavLink>
        </div>
      </ScrollArea>
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
        <Icon icon={UserCircle02Icon} data-icon="inline-start" />
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
          <Icon icon={Settings01Icon} />
          {t("nav.settings")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onChangePassword}>
          <Icon icon={Key01Icon} />
          {t("nav.changePassword")}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={loggingOut}
          onClick={onLogout}
        >
          <Icon icon={Logout01Icon} />
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
  const [mobileNavPath, setMobileNavPath] = useState(location.pathname)
  const [tags, setTags] = useState<Tag[]>([])
  const [counts, setCounts] = useState<FolderCounts | null>(null)

  if (location.pathname !== mobileNavPath) {
    setMobileNavPath(location.pathname)
    setMobileNavOpen(false)
  }

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

  useEffect(() => {
    let cancelled = false
    api<FolderCounts>("/api/messages/counts")
      .then((data) => {
        if (!cancelled) setCounts(data)
      })
      .catch(() => {
        if (!cancelled) setCounts(null)
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
      <aside className="group/sidebar hidden h-full min-h-0 w-56 shrink-0 flex-col gap-4 overflow-hidden py-4 pr-4 pl-6 md:flex">
        <div className="flex items-center gap-2 px-1">
          <Icon
            icon={MailOpen01Icon}
            className="size-5 shrink-0 text-primary"
          />
          <span className="truncate font-heading text-sm font-medium tracking-tight">
            {t("app.name")}
          </span>
        </div>

        <SidebarNav tags={tags} counts={counts} />

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
            <Icon icon={Menu01Icon} />
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Icon
              icon={MailOpen01Icon}
              className="size-5 shrink-0 text-primary"
            />
            <span className="truncate font-heading text-sm font-medium tracking-tight">
              {t("app.name")}
            </span>
          </div>
          <Button
            type="button"
            variant="glass"
            size="icon-sm"
            aria-label={t("nav.compose")}
            render={<Link to="/compose" />}
            nativeButton={false}
          >
            <Icon icon={PlusSignIcon} />
          </Button>
        </header>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          className="group/sidebar w-[min(100%,18rem)] gap-4 overflow-hidden bg-background p-4 text-foreground"
          showCloseButton={false}
        >
          <SheetHeader className="p-0">
            <SheetTitle className="flex items-center gap-2">
              <Icon icon={MailOpen01Icon} className="size-5 text-primary" />
              {t("app.name")}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {t("nav.menuDescription")}
            </SheetDescription>
          </SheetHeader>

          <SidebarNav tags={tags} counts={counts} onNavigate={closeMobileNav} />

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
