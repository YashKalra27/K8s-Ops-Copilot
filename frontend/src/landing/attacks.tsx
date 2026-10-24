import { useRef } from "react"
import { ShieldCheckIcon, ShieldWarningIcon } from "@phosphor-icons/react"

import { gsap, MOTION_OK, ScrollTrigger, useGSAP } from "@/motion/gsap"
import { cn } from "@/lib/utils"

import { ATTACKS } from "./data"

export function Attacks() {
  const root = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add({ motion: MOTION_OK, desktop: "(min-width: 1024px)" }, (ctx) => {
        const { motion, desktop } = ctx.conditions as { motion: boolean; desktop: boolean }
        if (!motion || !desktop) return
        // Sticky stack (motion-patterns.md §5.A). Reason: each attempt lands on the
        // pile of attempts already stopped, so the defence feels cumulative.
        const cards = gsap.utils.toArray<HTMLElement>(".stack-card")
        cards.slice(0, -1).forEach((card, i) => {
          ScrollTrigger.create({ trigger: card, start: "top top", endTrigger: cards[cards.length - 1], end: "top top", pin: true, pinSpacing: false })
          const inner = card.querySelector(".stack-inner")
          gsap.to(inner, { scale: 0.9, ease: "none", scrollTrigger: { trigger: cards[i + 1], start: "top bottom", end: "top top", scrub: true } })
          gsap.to(card.querySelector(".stack-dim"), {
            opacity: 0.65,
            ease: "none",
            scrollTrigger: { trigger: cards[i + 1], start: "top bottom", end: "top top", scrub: true },
          })
        })
      })
    },
    { scope: root },
  )

  return (
    <section ref={root} aria-labelledby="attacks-title" className="relative">
      <div className="mx-auto max-w-[1280px] px-5 pt-24 pb-8 md:px-8">
        <h2 id="attacks-title" className="max-w-[18ch] text-4xl leading-[1.05] font-semibold tracking-[-0.03em] md:text-5xl">
          We tried to break it. Here is what happened.
        </h2>
        <p className="mt-4 max-w-[52ch] text-muted-foreground">
          Four real attempts against the running system, and the layer that answered each one.
        </p>
      </div>
      <div>
        {ATTACKS.map((a, i) => {
          const neutralised = a.layer === "L8"
          const Icon = neutralised ? ShieldCheckIcon : ShieldWarningIcon
          return (
            <div key={a.text} className="stack-card flex items-center px-5 py-4 md:px-8 lg:h-[100dvh] lg:py-0">
              <article
                className={cn(
                  "stack-inner relative mx-auto w-full max-w-[1120px] overflow-hidden rounded-3xl border p-8 md:p-12",
                  "bg-[radial-gradient(90%_120%_at_100%_0%,var(--danger-soft),transparent_60%)] bg-card",
                  neutralised && "bg-[radial-gradient(90%_120%_at_100%_0%,var(--ok-soft),transparent_60%)]",
                )}
                style={{ transformOrigin: "top center" }}
              >
                <span aria-hidden className="stack-dim pointer-events-none absolute inset-0 z-10 bg-background opacity-0" />
                <p className="text-sm text-muted-foreground tabular">
                  Attempt {i + 1} of {ATTACKS.length}
                </p>
                <blockquote className="mt-4 max-w-[30ch] text-2xl leading-snug font-medium md:text-4xl">“{a.text}”</blockquote>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <span
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold",
                      neutralised ? "bg-ok-soft text-ok" : "bg-danger-soft text-destructive",
                    )}
                  >
                    <Icon className="size-4" weight="fill" aria-hidden />
                    {neutralised ? "Neutralised" : "Stopped"} by {a.layer}: {a.name}
                  </span>
                </div>
                <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground">{a.outcome}</p>
              </article>
            </div>
          )
        })}
      </div>
    </section>
  )
}
