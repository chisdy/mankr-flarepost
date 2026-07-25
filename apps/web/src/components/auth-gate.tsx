import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { Navigate, Outlet, useLocation } from "react-router"

import { api, isApiError } from "@/lib/api"
import type { AuthUser } from "@/lib/types"

type AuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: AuthUser }

type AuthContextValue = {
  user: AuthUser | null
  setUser: (user: AuthUser) => void
  clearUser: () => void
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const publicPaths = new Set(["/login", "/setup"])

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuth must be used within AuthGate")
  }
  return ctx
}

export function AuthGate() {
  const location = useLocation()
  const [auth, setAuth] = useState<AuthState>({ status: "loading" })

  const refresh = useCallback(async () => {
    try {
      const user = await api<AuthUser>("/api/auth/me")
      setAuth({ status: "authenticated", user })
    } catch (err) {
      if (isApiError(err) && err.status === 401) {
        setAuth({ status: "anonymous" })
        return
      }
      setAuth({ status: "anonymous" })
    }
  }, [])

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
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user: auth.status === "authenticated" ? auth.user : null,
      setUser: (user) => setAuth({ status: "authenticated", user }),
      clearUser: () => setAuth({ status: "anonymous" }),
      refresh,
    }),
    [auth, refresh]
  )

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

  return (
    <AuthContext.Provider value={value}>
      <Outlet />
    </AuthContext.Provider>
  )
}
