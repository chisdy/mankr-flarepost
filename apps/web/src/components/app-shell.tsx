import {
  AlertDiamondIcon,
  Archive02Icon,
  Delete02Icon,
  GaugeIcon,
  Key01Icon,
  Logout01Icon,
  Mail01Icon,
  Menu01Icon,
  Note01Icon,
  PlusSignIcon,
  Search01Icon,
  SentIcon,
  Settings01Icon,
  StarIcon,
  UserCircle02Icon,
} from "@hugeicons/core-free-icons"
import { Suspense, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router"
import { toast } from "sonner"

import { useAuth } from "@/components/auth-gate"
import { BrandMark } from "@/components/brand-mark"
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ChangePasswordDialog } from "@/features/auth/change-password-dialog"
import { clearMailboxReturnSnapshot } from "@/features/mailbox/mailbox-navigation"
import { api, isApiError } from "@/lib/api"
import { resetMailboxMetadata, useMailboxCounts, useMailboxTags } from "@/lib/mailbox-metadata"
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
    to: "/archive",
    labelKey: "nav.archive",
    icon: Archive02Icon,
    countKey: "archive",
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
    "flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
    isActive ? "bg-accent font-semibold text-accent-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
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
        variant="default"
        render={<Link to="/compose" onClick={onNavigate} />}
        nativeButton={false}
        size="lg"
        className="w-full justify-start"
      >
        <Icon icon={PlusSignIcon} data-icon="inline-start" />
        {t("nav.compose")}
      </Button>

      <ScrollArea
        className="min-h-0 flex-1 -mx-4"
        scrollbarClassName="pointer-events-none !w-1.5 opacity-0 transition-opacity duration-150 group-hover/sidebar:pointer-events-auto group-hover/sidebar:opacity-100 data-scrolling:pointer-events-auto data-scrolling:opacity-100 data-scrolling:duration-0 !end-1"
      >
        <div className="flex flex-col gap-4 px-4">
          <nav className="flex flex-col gap-0.5">
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
                    <span className="shrink-0 rounded-md bg-background/60 px-1.5 py-0.5 text-xs text-foreground tabular-nums">
                      {count}
                    </span>
                  ) : null}
                </NavLink>
              )
            })}
          </nav>

          {tags.length > 0 ? (
            <>
              <div aria-hidden="true" className="h-2" />
              <p className="px-3 text-xs font-medium text-muted-foreground">
                {t("nav.tags")}
              </p>
              <nav className="flex flex-col gap-0.5">
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

          <div aria-hidden="true" className="h-2" />

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
  const tags = useMailboxTags() ?? []
  const counts = useMailboxCounts()

  if (location.pathname !== mobileNavPath) {
    setMobileNavPath(location.pathname)
    setMobileNavOpen(false)
  }

  async function logout() {
    setLoggingOut(true)
    try {
      await api("/api/auth/logout", { method: "POST" })
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("auth.logoutFailed"))
    } finally {
      resetMailboxMetadata()
      clearMailboxReturnSnapshot()
      clearUser()
      setLoggingOut(false)
      navigate("/login", { replace: true })
    }
  }

  const label = user?.displayName || user?.username || t("app.account")
  const closeMobileNav = () => setMobileNavOpen(false)

  return (
    <div className="flex h-svh overflow-hidden bg-[var(--shell-background)] text-foreground">
      <aside className="post-rail group/sidebar hidden h-full min-h-0 w-60 shrink-0 flex-col gap-5 overflow-hidden px-4 py-5 md:flex">
        <div className="flex min-h-10 items-center gap-3 px-2">
          <BrandMark className="size-8" />
          <span className="truncate font-heading text-base font-semibold tracking-tight">
            {t("app.name")}
          </span>
        </div>

        <SidebarNav tags={tags} counts={counts} />

        <div className="mt-auto pt-3">
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

      <div className="m-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-3xl md:ml-0 bg-main text-main-foreground">
        <header className="post-rail flex min-h-16 shrink-0 items-center gap-2 px-3 md:hidden">
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="size-11"
            aria-label={t("nav.openMenu")}
            onClick={() => setMobileNavOpen(true)}
          >
            <Icon icon={Menu01Icon} />
          </Button>
          <Link to="/inbox" className="flex min-w-0 flex-1 items-center gap-2 rounded-md">
            <BrandMark className="size-8" />
            <span className="truncate font-heading text-base font-semibold tracking-tight">
              {t("app.name")}
            </span>
          </Link>
          <Button
            variant="ghost"
            size="icon-lg"
            className="size-11"
            aria-label={t("nav.search")}
            render={<Link to="/search" />}
            nativeButton={false}
          >
            <Icon icon={Search01Icon} />
          </Button>
          <Button
            type="button"
            variant="default"
            size="icon-lg"
            className="size-11"
            aria-label={t("nav.compose")}
            render={<Link to="/compose" />}
            nativeButton={false}
          >
            <Icon icon={PlusSignIcon} />
          </Button>
        </header>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Suspense fallback={<div role="status" className="grid flex-1 place-items-center text-sm text-muted-foreground">{t("app.loading")}</div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          className="post-rail group/sidebar w-[min(100%,19rem)] gap-4 overflow-hidden p-4"
          closeLabel={t("nav.closeMenu")}
        >
          <SheetHeader className="p-0">
            <SheetTitle className="flex items-center gap-2">
              <BrandMark className="size-8" />
              {t("app.name")}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {t("nav.menuDescription")}
            </SheetDescription>
          </SheetHeader>

          <SidebarNav tags={tags} counts={counts} onNavigate={closeMobileNav} />

          <div className="mt-auto pt-3">
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
