import { useEffect } from "react"
import { MoonIcon, SunIcon } from "@phosphor-icons/react"
import { useLenis } from "lenis/react"

import { Button } from "@/components/ui/button"
import { autoRefreshOnLayoutShift } from "@/motion/gsap"
import { SmoothScrollLenis } from "@/motion/lenis"

import { ApprovalDemo } from "./approval-demo"
import { Attacks } from "./attacks"
import { Bento, FinalCta } from "./bento"
import { Haystack } from "./haystack"
import { Hero } from "./hero"
import { PipelineScene } from "./pipeline-scene"
import { ProofRow } from "./proof"

type Props = { isDark: boolean; onToggleTheme: () => void; onOpen: () => void }

export function Landing(props: Props) {
  // Lenis lives only on this marketing page, never in the console (DESIGN.md §6).
  return (
    <SmoothScrollLenis>
      <LandingInner {...props} />
    </SmoothScrollLenis>
  )
}

function LandingInner({ isDark, onToggleTheme, onOpen }: Props) {
  const lenis = useLenis()
  useEffect(() => autoRefreshOnLayoutShift(), [])
  useEffect(() => {
    lenis?.scrollTo(0, { immediate: true, force: true })
  }, [lenis])

  const tour = () => {
    const target = document.getElementById("pipeline")
    if (!target) return
    if (lenis) lenis.scrollTo(target, { duration: 1.4 })
    else target.scrollIntoView({ behavior: "smooth" })
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-border/40 bg-background/55 backdrop-blur-md supports-[backdrop-filter]:bg-background/40">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-3 px-5 md:px-8">
          <a href="#home" className="flex items-center gap-2.5" aria-label="K8s Ops Copilot home">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-7" />
            <span className="text-sm font-semibold">K8s Ops Copilot</span>
          </a>
          <nav aria-label="Page" className="ml-6 hidden items-center gap-1 md:flex">
            <button type="button" onClick={tour} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
              How it works
            </button>

          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" size="icon" onClick={onToggleTheme} aria-label={isDark ? "Use light theme" : "Use dark theme"}>
              {isDark ? <SunIcon /> : <MoonIcon />}
            </Button>
            <Button onClick={onOpen} className="active:translate-y-px">
              Open the console
            </Button>
          </div>
        </div>
      </header>

      <main>
        <Hero isDark={isDark} onOpen={onOpen} onTour={tour} />
        <ProofRow />
        <PipelineScene />
        <Haystack />
        <Attacks />
        <ApprovalDemo />
        <Bento />
        <FinalCta onOpen={onOpen} />
      </main>
    </div>
  )
}
