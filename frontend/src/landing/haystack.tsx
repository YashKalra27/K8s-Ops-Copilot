import { useMemo, useRef } from "react"

import { gsap, MOTION_OK, useGSAP } from "@/motion/gsap"
import { cn } from "@/lib/utils"

import { CORPUS } from "./data"

const COLS = 36
const ROWS = 17
const DOTS = COLS * ROWS // 612: one dot for every 10 of the 6,122 indexed passages
const GRADES = [0.6, 0.8, 1.0, 0.5, 0.8] // the recorded run's CRAG grades

/** Small deterministic RNG so the field looks the same on every visit. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Kind = "noise" | "signal" | "candidate-noise" | "candidate" | "kept"

function buildField(): Kind[] {
  const rand = mulberry32(42)
  const order = Array.from({ length: DOTS }, (_, i) => i).sort(() => rand() - 0.5)
  const signalCount = Math.round((CORPUS.signal / (CORPUS.signal + CORPUS.noise)) * DOTS) // 158
  const kinds: Kind[] = Array(DOTS).fill("noise")
  const signal = order.slice(0, signalCount)
  const noise = order.slice(signalCount)
  signal.forEach((i) => (kinds[i] = "signal"))
  signal.slice(0, 15).forEach((i) => (kinds[i] = "candidate"))
  noise.slice(0, 5).forEach((i) => (kinds[i] = "candidate-noise"))
  signal.slice(15, 20).forEach((i) => (kinds[i] = "kept"))
  return kinds
}

const STEPS = [
  { title: "6,122 passages, most of them noise", body: "Kubernetes docs and runbooks (blue) are mixed with thousands of unrelated computer-science papers on purpose." },
  { title: "Search finds 20 candidates", body: "Meaning search and keyword search are merged. Some noise always slips in: in the real run, a 1994 Windows file-format paper made the top five." },
  { title: "A second model keeps the best 5", body: "The cross-encoder reads the question and each candidate together. The noise is gone." },
  { title: "Every survivor is graded", body: "CRAG grades each passage on its own. Anything below 0.5 would be dropped and the system would say it does not know." },
]

export function Haystack() {
  const root = useRef<HTMLElement>(null)
  const kinds = useMemo(buildField, [])
  const keptOrder = useMemo(() => kinds.flatMap((k, i) => (k === "kept" ? [i] : [])), [kinds])

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add({ motion: MOTION_OK, desktop: "(min-width: 1024px)" }, (ctx) => {
        const { motion, desktop } = ctx.conditions as { motion: boolean; desktop: boolean }
        if (!motion || !desktop) return
        const el = root.current!
        el.dataset.live = "true"
        const steps = gsap.utils.toArray<HTMLElement>(".hay-step")
        gsap.set(steps.slice(1), { autoAlpha: 0, y: 14 })
        gsap.set(".hay-grade", { autoAlpha: 0, y: 6 })
        gsap.set(".dot-kept, .dot-candidate, .dot-candidate-noise", { scale: 1, opacity: 1 })
        gsap.set(".dot-kept .halo, .dot-candidate .halo, .dot-candidate-noise .halo", { opacity: 0 })

        // Reason: shows the funnel the retrieval techniques perform, in the order they run.
        const tl = gsap.timeline({
          defaults: { ease: "power2.inOut" },
          scrollTrigger: { trigger: el, start: "top top", end: "+=240%", pin: true, scrub: true },
        })
        tl.to({}, { duration: 0.6 }, 0) // a beat to take in the whole field first
          // step 1: candidates light up, everything else dims
          .to(".dot-noise, .dot-signal", { opacity: 0.18, duration: 0.6 }, 1.4)
          .to(".dot-candidate .halo, .dot-candidate-noise .halo, .dot-kept .halo", { opacity: 1, duration: 0.4, stagger: 0.02 }, 1.5)
          .to(steps[0], { autoAlpha: 0, y: -14, duration: 0.3 }, 1.3)
          .to(steps[1], { autoAlpha: 1, y: 0, duration: 0.3 }, 1.55)
          // step 2: rerank drops 15, keeps 5
          .to(".dot-candidate, .dot-candidate-noise", { opacity: 0.12, scale: 0.7, duration: 0.6 }, 2.8)
          .to(".dot-candidate .halo, .dot-candidate-noise .halo", { opacity: 0, duration: 0.4 }, 2.8)
          .to(".dot-kept", { scale: 1.9, duration: 0.6, ease: "back.out(2)" }, 2.9)
          .to(steps[1], { autoAlpha: 0, y: -14, duration: 0.3 }, 2.7)
          .to(steps[2], { autoAlpha: 1, y: 0, duration: 0.3 }, 2.95)
          // step 3: grades appear
          .to(steps[2], { autoAlpha: 0, y: -14, duration: 0.3 }, 4.0)
          .to(steps[3], { autoAlpha: 1, y: 0, duration: 0.3 }, 4.25)
          .to(".hay-grade", { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.1 }, 4.3)
          .to({}, { duration: 0.6 })
        return () => {
          delete el.dataset.live
        }
      })
    },
    { scope: root },
  )

  return (
    <section ref={root} aria-labelledby="hay-title" className="group/hay relative isolate overflow-hidden">
      <div className="mx-auto grid min-h-[100dvh] max-w-[1280px] items-center gap-12 px-5 py-20 md:px-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
        <figure className="order-2 flex flex-col gap-5 lg:order-1">
          <div
            className="grid gap-[5px] sm:gap-[7px]"
            style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
            role="img"
            aria-label="612 dots, one per 10 passages; about a quarter are Kubernetes documents. 20 are found by search, 5 survive reranking and all 5 pass grading."
          >
            {kinds.map((k, i) => (
              <span
                key={i}
                className={cn(
                  "dot relative block aspect-square rounded-full",
                  `dot-${k}`,
                  k === "noise" || k === "candidate-noise" ? "bg-muted-foreground/35" : "bg-primary",
                  // Static final state (reduced motion, phones): only the kept five stand out.
                  "group-data-[live=true]/hay:opacity-100",
                  k === "kept" ? "z-10 scale-[1.9] group-data-[live=true]/hay:scale-100" : "opacity-[0.22] group-data-[live=true]/hay:opacity-100",
                )}
              >
                {k !== "noise" && k !== "signal" && (
                  <span
                    className={cn(
                      "halo absolute -inset-[3px] rounded-full ring-2",
                      k === "candidate-noise" ? "ring-warn" : "ring-primary",
                      k === "kept" ? "opacity-100" : "opacity-0",
                    )}
                  />
                )}
              </span>
            ))}
          </div>
          <figcaption className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-primary" /> Kubernetes docs ({CORPUS.signal.toLocaleString()} passages)
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-muted-foreground/50" /> Unrelated papers ({CORPUS.noise.toLocaleString()})
            </span>
            <span>One dot = 10 passages. Positions are illustrative.</span>
          </figcaption>
        </figure>

        <div className="order-1 flex flex-col gap-6 lg:order-2">
          <h2 id="hay-title" className="text-4xl leading-[1.05] font-semibold tracking-[-0.03em] md:text-5xl">
            Finding five needles in a haystack
          </h2>
          <ol className="relative grid gap-5 group-data-[live=true]/hay:block group-data-[live=true]/hay:min-h-[9rem]">
            {STEPS.map((s) => (
              <li
                key={s.title}
                className="hay-step flex flex-col gap-1.5 group-data-[live=true]/hay:absolute group-data-[live=true]/hay:inset-x-0 group-data-[live=true]/hay:top-0"
              >
                <h3 className="text-lg font-semibold">{s.title}</h3>
                <p className="max-w-[44ch] text-[15px] leading-relaxed text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
          <ul className="flex flex-wrap gap-2" aria-label="Grades of the five kept passages">
            {GRADES.map((g, i) => (
              <li
                key={keptOrder[i] ?? i}
                className="hay-grade rounded-full border border-ok/40 bg-ok-soft px-3 py-1 text-sm font-medium text-ok tabular"
              >
                {g.toFixed(1)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
