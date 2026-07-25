import { useEffect, useState } from "react"
import { Navigate, Outlet, useLocation } from "react-router"

import { api } from "@/lib/api"

export type AuthUser = {
  username: string
  displayName: string | null
}

type AuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: AuthUser }

const publicPaths = new Set(["/login", "/setup"])

export function AuthGate() {
  const location = useLocation()
  const [auth, setAuth] = useState<AuthState>({ status: "loading" })

  useEffect(() => {
    let cancelled = false

    api<AuthUser>("/api/auth/me")
      .then((user) => {
        if (!cancelled) setAuth({ status: "authenticated", user })
      })
      .catch(() => {
        if (!cancelled) setAuth({ status: "anonymous" })
      })

    return () => {
      cancelled = true
    }
  }, [location.pathname])

  if (auth.status === "loading") {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  const isPublic = publicPaths.has(location.pathname)

  if (auth.status === "anonymous" && !isPublic) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (auth.status === "authenticated" && isPublic) {
    return <Navigate to="/inbox" replace />
  }

  return <Outlet context={auth.status === "authenticated" ? auth.user : null} />
}
