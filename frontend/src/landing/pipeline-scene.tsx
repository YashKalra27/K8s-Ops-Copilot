import { useRef } from "react"

import { gsap, MOTION_OK, useGSAP } from "@/motion/gsap"

import { RECORDED_QUESTION, RECORDED_TOTAL_MS, SCENE_ACTS } from "./data"

// Route map geometry (SVG user units). The route snakes through four rows, one per act.
const X0 = 70
const X1 = 650
const ROWS_Y = [62, 196, 330, 464]
const TURN = 64
const STRAIGHT = X1 - X0

const ROUTE = [
  `M${X0} ${ROWS_Y[0]} H${X1}`,
  `C${X1 + TURN} ${ROWS_Y[0]} ${X1 + TURN} ${ROWS_Y[1]} ${X1} ${ROWS_Y[1]} H${X0}`,
  `C${X0 - TURN} ${ROWS_Y[1]} ${X0 - TURN} ${ROWS_Y[2]} ${X0} ${ROWS_Y[2]} H${X1}`,
  `C${X1 + TURN} ${ROWS_Y[2]} ${X1 + TURN} ${ROWS_Y[3]} ${X1} ${ROWS_Y[3]} H${X0}`,
].join(" ")

type Placed = { act: number; row: number; x: number; y: number; along: number; label: "above" | "below" }

const STATIONS = SCENE_ACTS.flatMap((act, row) =>
  act.stations.map((s, i) => {
    const n = act.stations.length
    const along = (i + 0.5) * (STRAIGHT / n) // distance travelled along this row
    const leftToRight = row % 2 === 0
    const x = leftToRight ? X0 + along : X1 - along
    return { ...s, act: row, row, x, y: ROWS_Y[row], along, label: (i % 2 === 0 ? "above" : "below") as Placed["label"] }
  }),
)

// Cumulative measured time at each station (what the clock shows once the packet reaches it).
const CUMULATIVE = STATIONS.reduce<number[]>((acc, s) => [...acc, (acc.at(-1) ?? 0) + s.ms], [])

const STATUS_FILL: Record<string, string> = { ok: "var(--ok)", miss: "var(--muted-foreground)", fallback: "var(--warn)" }

function fmtSeconds(ms: number) {
  return `${(ms / 1000).toFixed(1)} s`
}

/** Per-station time: milliseconds when short, seconds otherwise. */
function fmtStep(ms: number) {
  if (ms < 1) return "<1 ms"
  if (ms < 1000) return `${Math.round(ms)} ms`
  return fmtSeconds(ms)
}

export function PipelineScene() {
  const root = useRef<HTMLElement>(null)
  const clock = useRef<HTMLSpanElement>(null)
  const nowName = useRef<HTMLSpanElement>(null)
  const nowNote = useRef<HTMLSpanElement>(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add({ motion: MOTION_OK, desktop: "(min-width: 1024px)" }, (ctx) => {
        const { motion, desktop } = ctx.conditions as { motion: boolean; desktop: boolean }
        if (!motion || !desktop) return // static, fully lit map instead

        const path = root.current!.querySelector<SVGPathElement>(".route-live")!
        const total = path.getTotalLength()
        const turn = (total - 4 * STRAIGHT) / 3
        const fracOf = (s: (typeof STATIONS)[number]) => (s.row * (STRAIGHT + turn) + s.along) / total
        const fractions = STATIONS.map(fracOf)

        // Acts overlap (one visible at a time) only while the live scene runs.
        const sceneEl = root.current!
        sceneEl.dataset.live = "true"
        const acts = gsap.utils.toArray<HTMLElement>(".scene-act")
        gsap.set(acts.slice(1), { autoAlpha: 0, y: 14 })
        gsap.set(".st-lit", { opacity: 0, scale: 0.4, transformOrigin: "50% 50%" })
        gsap.set(".st-label", { opacity: 0.35 })
        gsap.set(".packet", { autoAlpha: 1 })
        clock.current!.textContent = fmtSeconds(0)
        nowName.current!.textContent = "Question received"
        nowNote.current!.textContent = RECORDED_QUESTION

        // Reason: scrolling *is* the request travelling; each station lights as it is reached,
        // with the real time the recorded run spent there.
        const tl = gsap.timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: root.current,
            start: "top top",
            end: "+=320%",
            pin: true,
            scrub: true,
            onUpdate: (self) => {
              const p = self.progress
              let idx = -1
              for (let i = 0; i < fractions.length; i++) if (fractions[i] <= p + 0.002) idx = i
              const ms = p > 0.995 ? RECORDED_TOTAL_MS : idx >= 0 ? CUMULATIVE[idx] : 0
              clock.current!.textContent = fmtSeconds(ms)
              const s = idx >= 0 ? STATIONS[idx] : null
              nowName.current!.textContent = p > 0.995 ? "Answer delivered" : s ? `${s.short} (${s.layer})` : "Question received"
              nowNote.current!.textContent = p > 0.995 ? "Cited source: crashloop-triage-notes" : s ? s.note : RECORDED_QUESTION
            },
          },
        })
        tl.fromTo(".route-live", { drawSVG: "0%" }, { drawSVG: "100%", duration: 1 }, 0)
        tl.to(".packet", { motionPath: { path, align: path, alignOrigin: [0.5, 0.5] }, duration: 1 }, 0)
        fractions.forEach((f, i) => {
          tl.to(`.st-${i} .st-lit`, { opacity: 1, scale: 1, duration: 0.012, ease: "back.out(3)" }, Math.max(0, f - 0.004))
          tl.to(`.st-${i} .st-label`, { opacity: 1, duration: 0.012 }, Math.max(0, f - 0.004))
        })
        SCENE_ACTS.forEach((_, a) => {
          if (a === 0) return
          const first = STATIONS.findIndex((s) => s.act === a)
          const at = Math.max(0, fractions[first] - 0.05)
          tl.to(acts[a - 1], { autoAlpha: 0, y: -14, duration: 0.025, ease: "power2.in" }, at)
          tl.to(acts[a], { autoAlpha: 1, y: 0, duration: 0.025, ease: "power2.out" }, at + 0.02)
        })
        return () => {
          delete sceneEl.dataset.live
          clock.current!.textContent = fmtSeconds(RECORDED_TOTAL_MS)
          nowName.current!.textContent = "Answer delivered"
          nowNote.current!.textContent = "Cited source: crashloop-triage-notes"
        }
      })
    },
    { scope: root },
  )

  return (
    <section
      ref={root}
      id="pipeline"
      aria-labelledby="pipeline-title"
      className="group/scene relative isolate overflow-hidden bg-[radial-gradient(70%_60%_at_70%_50%,color-mix(in_oklab,var(--primary)_9%,transparent),transparent_70%)]"
    >
      <div className="mx-auto grid min-h-[100dvh] max-w-[1280px] items-center gap-10 px-5 py-20 md:px-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-4">
            <h2 id="pipeline-title" className="text-4xl leading-[1.05] font-semibold tracking-[-0.03em] md:text-5xl">
              Follow one question through the machine
            </h2>
            <p className="max-w-[44ch] text-muted-foreground">
              A real run, replayed as you scroll: “{RECORDED_QUESTION}” on a laptop, from first check to cited answer.
            </p>
          </div>

          {/* Live readout (desktop + motion). Values are written by the scroll timeline, outside React. */}
          <div className="hidden flex-col gap-1 rounded-2xl border border-border/80 bg-card/60 p-5 backdrop-blur lg:flex" aria-hidden>
            <span className="text-sm text-muted-foreground">Elapsed in the recorded run</span>
            <span ref={clock} className="text-5xl font-semibold tracking-tight tabular">
              {fmtSeconds(RECORDED_TOTAL_MS)}
            </span>
            <span ref={nowName} className="mt-2 text-sm font-medium text-primary">
              Answer delivered
            </span>
            <span ref={nowNote} className="text-sm text-muted-foreground">
              Cited source: crashloop-triage-notes
            </span>
          </div>

          <ol className="relative grid gap-6 group-data-[live=true]/scene:block group-data-[live=true]/scene:min-h-[9.5rem]">
            {SCENE_ACTS.map((act, i) => (
              <li
                key={act.title}
                className="scene-act flex flex-col gap-1.5 group-data-[live=true]/scene:absolute group-data-[live=true]/scene:inset-x-0 group-data-[live=true]/scene:top-0"
              >
                <span className="text-sm text-muted-foreground tabular">Act {i + 1} of 4</span>
                <h3 className="text-xl font-semibold">{act.title}</h3>
                <p className="max-w-[42ch] text-[15px] leading-relaxed text-muted-foreground">{act.body}</p>
              </li>
            ))}
          </ol>
        </div>

        {/* Route map: a diagram of the real pipeline (desktop). */}
        <figure className="hidden lg:block">
          <svg viewBox="0 0 720 530" className="w-full" role="img" aria-label="The route a question takes: seven security checks, routing, search, ranking, grading, then writing and checking the answer">
            <defs>
              <radialGradient id="packet-glow">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.55" />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <path d={ROUTE} fill="none" stroke="var(--border)" strokeWidth="2" strokeDasharray="4 7" strokeLinecap="round" />
            <path className="route-live" d={ROUTE} fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" />
            {STATIONS.map((s, i) => (
              <g key={i} className={`st-${i}`}>
                <circle cx={s.x} cy={s.y} r="9" fill="var(--card)" stroke="var(--border)" strokeWidth="2" />
                <circle className="st-lit" cx={s.x} cy={s.y} r="6.5" fill={STATUS_FILL[s.status]} />
                <g className="st-label">
                  <text
                    x={s.x}
                    y={s.label === "above" ? s.y - 22 : s.y + 32}
                    textAnchor="middle"
                    fontSize="14"
                    fontWeight="600"
                    fill="var(--foreground)"
                  >
                    {s.short}
                  </text>
                  <text
                    x={s.x}
                    y={s.label === "above" ? s.y - 40 : s.y + 49}
                    textAnchor="middle"
                    fontSize="11.5"
                    fill="var(--muted-foreground)"
                    className="tabular"
                  >
                    {s.layer} {fmtStep(s.ms)}
                  </text>
                </g>
              </g>
            ))}
            <g className="packet" style={{ visibility: "hidden" }}>
              <circle r="26" fill="url(#packet-glow)" />
              <circle r="7" fill="var(--primary)" stroke="var(--background)" strokeWidth="2.5" />
            </g>
          </svg>
          <figcaption className="mt-3 text-sm text-muted-foreground">
            Green: passed. Grey: cache miss (first time asked). Times are from the recorded run.
          </figcaption>
        </figure>

        {/* Phones and tablets: the same stations as a list. */}
        <ol className="grid gap-5 lg:hidden" aria-label="Stations in order">
          {SCENE_ACTS.map((act) => (
            <li key={act.title} className="rounded-2xl border border-border/80 bg-card/60 p-4">
              <p className="mb-3 text-sm font-semibold">{act.title}</p>
              <ul className="flex flex-wrap gap-2">
                {act.stations.map((s) => (
                  <li key={s.short} className="rounded-full bg-accent px-3 py-1 text-xs text-accent-foreground">
                    {s.short} <span className="tabular opacity-70">{fmtStep(s.ms)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
