import { useRef } from "react"
import { PlayIcon } from "@phosphor-icons/react"

import WebThreads from "@/components/WebThreads"
import { Button } from "@/components/ui/button"
import { LiveBackground } from "@/motion/gates"
import { gsap, MOTION_OK, SplitText, useGSAP } from "@/motion/gsap"

/** Static stand-in for the WebGL background: same palette, no motion (reduced motion, off-screen). */
function HeroPoster() {
  return (
    <div className="absolute inset-0 bg-[radial-gradient(60%_55%_at_72%_58%,color-mix(in_oklab,var(--primary)_22%,transparent),transparent_70%),radial-gradient(40%_40%_at_20%_20%,color-mix(in_oklab,var(--primary)_10%,transparent),transparent_70%)]" />
  )
}

export function Hero({ isDark, onOpen, onTour }: { isDark: boolean; onOpen: () => void; onTour: () => void }) {
  const root = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(MOTION_OK, () => {
        // Reason: the promise reads in order, line by line, then the product comes forward.
        gsap.set(".hero-shot", { rotateX: 22, rotateY: -14, rotateZ: 3, scale: 0.9, transformPerspective: 1600 })
        // autoSplit re-runs onSplit when the web font loads or the width changes, so only
        // the line reveal lives there (returned, so SplitText reverts it before re-splitting).
        // Everything else runs once with explicit end values; a re-run .from() would
        // otherwise tween from 0 to 0 and leave the buttons hidden (seen on phones).
        SplitText.create(".hero-title", {
          type: "lines",
          mask: "lines",
          autoSplit: true,
          onSplit: (self) => gsap.from(self.lines, { yPercent: 110, stagger: 0.09, duration: 1, ease: "expo.out" }),
        })
        gsap
          .timeline({ defaults: { ease: "expo.out", duration: 1 }, delay: 0.3 })
          .fromTo(".hero-sub", { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0 })
          .fromTo(".hero-cta", { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, stagger: 0.06 }, "<0.1")
          .fromTo(".hero-shot-wrap", { autoAlpha: 0, y: 60 }, { autoAlpha: 1, y: 0, duration: 1.4 }, "<")
        // Reason: scrolling straightens the console toward the viewer as the story begins.
        gsap.to(".hero-shot", {
          rotateX: 0,
          rotateY: 0,
          rotateZ: 0,
          scale: 1,
          ease: "none",
          scrollTrigger: { trigger: root.current, start: "top top", end: "bottom 20%", scrub: true },
        })
      })
    },
    { scope: root },
  )

  return (
    <section ref={root} className="relative isolate overflow-hidden" aria-labelledby="hero-title">
      <LiveBackground fallback={<HeroPoster />}>
        <HeroPoster />
        <WebThreads
          className="absolute inset-0"
          colors={isDark ? ["#2D5BCB", "#7A9CF0", "#4C74E0"] : ["#1C3F94", "#2D5BCB", "#4C74E0"]}
          coreColor={isDark ? "#C9D6FA" : "#0F2A6B"}
          lightMode={!isDark}
          threadCount={9}
          speed={0.14}
          frequency={4}
          spread={0.22}
          position={0.6}
          pinch={0.55}
          nodes={3}
          angle={-8}
          glow={0.025}
          brightness={isDark ? 0.62 : 1.1}
          opacity={isDark ? 0.95 : 1}
          grain={0.035}
          pulses={2}
          mouseStrength={0.35}
          pulseOnClick={false}
          dpr={1.5}
        />
        {/* Scrim so the headline column always keeps full contrast over the threads. */}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,var(--background)_0%,color-mix(in_oklab,var(--background)_88%,transparent)_42%,color-mix(in_oklab,var(--background)_40%,transparent)_70%,transparent_100%)] lg:bg-[linear-gradient(90deg,var(--background)_0%,color-mix(in_oklab,var(--background)_75%,transparent)_38%,transparent_70%)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />
      </LiveBackground>

      <div className="mx-auto grid min-h-[100dvh] max-w-[1280px] items-center gap-12 px-5 pt-24 pb-16 md:px-8 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
        <div className="flex flex-col gap-7">
          <h1
            id="hero-title"
            className="hero-title text-[clamp(2.6rem,5vw,4.75rem)] leading-[1.02] font-semibold tracking-[-0.04em]"
          >
            <span className="sm:whitespace-nowrap">Ask anything.</span>
            <br />
            <span className="sm:whitespace-nowrap">See every check.</span>
          </h1>
          <p className="hero-sub max-w-[46ch] text-lg leading-relaxed text-muted-foreground">
            An AI assistant for Kubernetes teams. It reads the docs, asks before running SQL, and shows every check it ran.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" className="hero-cta h-11 px-5 text-[15px] active:translate-y-px" onClick={onOpen}>
              Open the console
            </Button>
            <Button size="lg" variant="outline" className="hero-cta h-11 bg-background/40 px-5 text-[15px] backdrop-blur" onClick={onTour}>
              <PlayIcon data-icon="inline-start" weight="fill" />
              How it works
            </Button>
          </div>
        </div>

        <div className="hero-shot-wrap relative [perspective:1600px]">
          <div className="hero-shot relative rounded-2xl border border-foreground/10 bg-card/60 p-1.5 shadow-[0_40px_120px_-30px_color-mix(in_oklab,var(--primary)_45%,transparent)] will-change-transform">
            <img
              src={`${import.meta.env.BASE_URL}img/console-${isDark ? "dark" : "light"}.png`}
              alt="The console answering a question, with its sources and the list of checks the request passed"
              width={2880}
              height={1800}
              className="block w-full rounded-[12px]"
              fetchPriority="high"
            />
          </div>
        </div>
      </div>
    </section>
  )
}
