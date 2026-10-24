import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

import type { Session } from "@/lib/api"

// The token lives in sessionStorage (cleared when the tab closes). Storage can
// throw in private windows, so every access is guarded and the app still works
// with in-memory state only.
const KEY = "advrag.session"

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Session
    const payload = JSON.parse(atob(parsed.token.split(".")[1])) as { exp?: number }
    if (payload.exp && payload.exp * 1000 < Date.now()) return null
    return parsed
  } catch {
    return null
  }
}

type SessionCtx = {
  session: Session | null
  signIn: (s: Session) => void
  signOut: () => void
}

const Ctx = createContext<SessionCtx | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(readSession)

  const signIn = useCallback((s: Session) => {
    setSession(s)
    try {
      sessionStorage.setItem(KEY, JSON.stringify(s))
    } catch {
      /* storage unavailable: keep the in-memory session */
    }
  }, [])

  const signOut = useCallback(() => {
    setSession(null)
    try {
      sessionStorage.removeItem(KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo(() => ({ session, signIn, signOut }), [session, signIn, signOut])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useSession must be used inside SessionProvider")
  return ctx
}

// ------------------------------------------------------------------ theme

type Theme = "light" | "dark" | "system"
const THEME_KEY = "advrag.theme"

function systemDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      // Dark by default: the design brief is a night-time operations room (DESIGN.md §1).
      return (localStorage.getItem(THEME_KEY) as Theme | null) ?? "dark"
    } catch {
      return "dark"
    }
  })

  useEffect(() => {
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && systemDark())
      document.documentElement.classList.toggle("dark", dark)
    }
    apply()
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* ignore */
    }
    if (theme !== "system") return
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [theme])

  const isDark = theme === "dark" || (theme === "system" && systemDark())
  return { theme, isDark, toggle: () => setTheme(isDark ? "light" : "dark") }
}
