import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { motion } from "motion/react"
import { MoonIcon, SignOutIcon, SunIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { useSession, useTheme } from "@/lib/session"
import { ChatView } from "@/views/chat/chat-view"
import { Skeleton } from "@/components/ui/skeleton"
import { LearnView } from "@/views/learn"
import { LoginView } from "@/views/login"

// The landing page carries GSAP, Lenis and WebGL; the chart views carry visx + Bklit.
// Each loads only when opened.
const Landing = lazy(() => import("@/landing/landing").then((m) => ({ default: m.Landing })))
const KnowledgeView = lazy(() => import("@/views/knowledge").then((m) => ({ default: m.KnowledgeView })))
const SystemView = lazy(() => import("@/views/system").then((m) => ({ default: m.SystemView })))

const VIEWS = [
  { id: "ask", label: "Ask" },
  { id: "learn", label: "How it works" },
  { id: "knowledge", label: "Knowledge" },
  { id: "system", label: "System" },
] as const
type ViewId = (typeof VIEWS)[number]["id"]
type Route = "home" | ViewId

function readHash(): Route {
  // "#ask/<conversation id>" is still the Ask view; the chat reads the id itself.
  const id = window.location.hash.replace("#", "").split("/")[0]
  return VIEWS.some((v) => v.id === id) ? (id as ViewId) : "home"
}

export default function App() {
  const { session, signOut } = useSession()
  const { isDark, toggle } = useTheme()
  const [view, setViewState] = useState<Route>(readHash)
  const [prefill, setPrefill] = useState<string | null>(null)

  // Coming back to Ask reopens the conversation you left, like any chat app.
  const lastAsk = useRef("#ask")
  const setView = (id: Route) => {
    if (window.location.hash.startsWith("#ask")) lastAsk.current = window.location.hash
    setViewState(id)
    history.pushState(null, "", id === "ask" ? lastAsk.current : `#${id}`)
    window.scrollTo({ top: 0 })
  }
  const clearPrefill = useCallback(() => setPrefill(null), [])

  // Browser back/forward between the landing page and the console.
  useEffect(() => {
    const onHash = () => setViewState(readHash())
    window.addEventListener("hashchange", onHash)
    window.addEventListener("popstate", onHash)
    return () => {
      window.removeEventListener("hashchange", onHash)
      window.removeEventListener("popstate", onHash)
    }
  }, [])

  if (view === "home") {
    return (
      <Suspense fallback={<div className="min-h-dvh bg-background" />}>
        <Landing isDark={isDark} onToggleTheme={toggle} onOpen={() => setView("ask")} />
      </Suspense>
    )
  }

  return (
    <div className="relative isolate min-h-dvh bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-2 px-4 sm:gap-4 md:px-6">
          <a href="#home" onClick={(e) => { e.preventDefault(); setView("home") }} className="flex shrink-0 items-center gap-2.5" aria-label="Back to the home page">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-7" />
            <span className="hidden text-sm font-semibold sm:inline">K8s Ops Copilot</span>
          </a>

          {session && (
            <nav aria-label="Views" className="-mx-1 flex min-w-0 flex-1 overflow-x-auto">
              <ul className="flex gap-0.5 sm:gap-1">
                {VIEWS.map((v) => {
                  const active = view === v.id
                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => setView(v.id)}
                        aria-current={active ? "page" : undefined}
                        className="relative rounded-md px-2 py-1.5 text-[13px] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-3 sm:text-sm"
                      >
                        {active && (
                          <motion.span
                            layoutId="nav-pill"
                            className="absolute inset-0 rounded-md bg-accent"
                            transition={{ type: "spring", bounce: 0.15, visualDuration: 0.35 }}
                          />
                        )}
                        <span className={active ? "relative text-accent-foreground" : "relative text-muted-foreground hover:text-foreground"}>
                          {v.label}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </nav>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="icon" onClick={toggle} aria-label={isDark ? "Use light theme" : "Use dark theme"}>
              {isDark ? <SunIcon /> : <MoonIcon />}
            </Button>
            {session && (
              <>
                <span className="hidden max-w-40 truncate text-xs text-muted-foreground md:inline">
                  {session.username}
                  {session.is_admin ? " (admin)" : ""}
                </span>
                <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
                  <SignOutIcon />
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {!session ? (
        <LoginView />
      ) : view === "ask" ? (
        // Full-height chat, no page padding (the thread and the composer manage their own space).
        <main className="relative">
          <div
            aria-hidden
            className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[45vh] bg-[radial-gradient(55%_70%_at_60%_0%,color-mix(in_oklab,var(--primary)_10%,transparent),transparent_70%)]"
          />
          <ChatView prefill={prefill} onPrefillUsed={clearPrefill} />
        </main>
      ) : (
        <main className="relative mx-auto max-w-[1400px] px-4 py-8 md:px-6">
          {/* Ambient light behind the console: static, fixed, never intercepts input. */}
          <div
            aria-hidden
            className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[55vh] bg-[radial-gradient(60%_80%_at_60%_0%,color-mix(in_oklab,var(--primary)_14%,transparent),transparent_70%)]"
          />
          {view === "learn" && (
            <LearnView
              onTry={(q) => {
                setPrefill(q)
                setView("ask")
              }}
            />
          )}
          <Suspense fallback={<Skeleton className="h-96 w-full" />}>
            {view === "knowledge" && <KnowledgeView />}
            {view === "system" && <SystemView />}
          </Suspense>
        </main>
      )}
    </div>
  )
}
