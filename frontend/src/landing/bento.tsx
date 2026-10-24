import { useRef } from "react"
import { CpuIcon, DownloadSimpleIcon, FloppyDiskIcon, LightningIcon, TestTubeIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { gsap, MOTION_OK, ScrollTrigger, useGSAP } from "@/motion/gsap"

const CACHES = [
  { name: "Intent", ttl: "24 h" },
  { name: "Embeddings", ttl: "7 d" },
  { name: "Answers", ttl: "1 h" },
  { name: "SQL text", ttl: "24 h" },
  { name: "SQL rows", ttl: "15 min" },
]

// The worked Reciprocal Rank Fusion example from the guide (illustrative passages A, B, C).
const RRF = [
  { id: "B", meaning: 2, keyword: 1, points: "0.0325" },
  { id: "A", meaning: 1, keyword: 3, points: "0.0323" },
  { id: "C", meaning: null, keyword: 1, points: "0.0164" },
]

export function Bento() {
  const root = useRef<HTMLElement>(null)
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(MOTION_OK, () => {
        // Reveal stagger (motion-patterns.md §5.C). Reason: the cells arrive as a set, once.
        const cells = gsap.utils.toArray<HTMLElement>(".bento-cell")
        gsap.set(cells, { autoAlpha: 0, y: 28 })
        ScrollTrigger.batch(cells, {
          start: "top 85%",
          once: true,
          onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.8, stagger: 0.08, ease: "expo.out", overwrite: true }),
        })
      })
    },
    { scope: root },
  )

  return (
    <section ref={root} aria-labelledby="bento-title" className="mx-auto max-w-[1280px] px-5 py-24 md:px-8">
      <h2 id="bento-title" className="max-w-[20ch] text-4xl leading-[1.05] font-semibold tracking-[-0.03em] md:text-5xl">
        Under the hood
      </h2>
      <div className="mt-10 grid gap-4 md:grid-cols-6 md:grid-rows-[auto_auto_auto]">
        {/* A: hybrid search, worked example */}
        <article className="bento-cell relative overflow-hidden rounded-2xl border bg-card p-6 md:col-span-3 md:row-span-2 [background-image:radial-gradient(color-mix(in_oklab,var(--foreground)_9%,transparent)_1px,transparent_1px)] [background-size:18px_18px]">
          <h3 className="text-xl font-semibold">Two searches, one ranking</h3>
          <p className="mt-2 max-w-[44ch] text-sm leading-relaxed text-muted-foreground">
            Meaning search finds paraphrases; keyword search (BM25) finds exact error codes. Reciprocal Rank Fusion gives each passage 1 / (60 +
            rank) from each list, so passages both searches like win.
          </p>
          <table className="mt-6 w-full max-w-md rounded-xl bg-background/70 text-sm backdrop-blur">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Passage</th>
                <th className="px-3 py-2 font-medium">Meaning</th>
                <th className="px-3 py-2 font-medium">Keyword</th>
                <th className="px-3 py-2 text-right font-medium">Points</th>
              </tr>
            </thead>
            <tbody>
              {RRF.map((r, i) => (
                <tr key={r.id} className={i === 0 ? "text-foreground" : "text-muted-foreground"}>
                  <td className="px-3 py-2 font-semibold">{r.id}</td>
                  <td className="px-3 py-2 tabular">{r.meaning ? `#${r.meaning}` : "absent"}</td>
                  <td className="px-3 py-2 tabular">#{r.keyword}</td>
                  <td className={`px-3 py-2 text-right tabular ${i === 0 ? "font-semibold text-primary" : ""}`}>{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">Worked example; B wins because both searches rank it highly.</p>
        </article>

        {/* B: caches */}
        <article className="bento-cell rounded-2xl border bg-[linear-gradient(135deg,color-mix(in_oklab,var(--primary)_22%,var(--card))_0%,var(--card)_65%)] p-6 md:col-span-3">
          <LightningIcon className="size-6 text-primary" weight="duotone" aria-hidden />
          <h3 className="mt-3 text-xl font-semibold">Five caches, five lifetimes</h3>
          <p className="mt-1 text-sm text-muted-foreground">Each result is remembered for exactly as long as it stays true.</p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {CACHES.map((c) => (
              <li key={c.name} className="rounded-full border border-primary/30 bg-background/50 px-3 py-1 text-sm">
                {c.name} <span className="text-muted-foreground tabular">{c.ttl}</span>
              </li>
            ))}
          </ul>
        </article>

        {/* C: checkpoints */}
        <article className="bento-cell rounded-2xl border bg-card p-6 md:col-span-2">
          <FloppyDiskIcon className="size-6 text-primary" weight="duotone" aria-hidden />
          <h3 className="mt-3 text-lg font-semibold">Pauses, saves, resumes</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            LangGraph saves the workflow to Postgres while it waits for your approval, so it survives a server restart.
          </p>
        </article>

        {/* D: tests */}
        <article className="bento-cell flex flex-col justify-between rounded-2xl border bg-[linear-gradient(160deg,var(--ok-soft),var(--card)_70%)] p-6 md:col-span-1">
          <TestTubeIcon className="size-6 text-ok" weight="duotone" aria-hidden />
          <p className="mt-6">
            <span className="block text-5xl font-semibold tracking-tight tabular">71</span>
            <span className="text-sm text-muted-foreground">unit tests, no services needed</span>
          </p>
        </article>

        {/* E: runs locally, with a real screenshot */}
        <article className="bento-cell grid items-center gap-6 overflow-hidden rounded-2xl border bg-card p-6 md:col-span-6 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:p-8">
          <div>
            <CpuIcon className="size-6 text-primary" weight="duotone" aria-hidden />
            <h3 className="mt-3 text-xl font-semibold">Runs on a laptop. Or on GPT-4o.</h3>
            <p className="mt-2 max-w-[44ch] text-sm leading-relaxed text-muted-foreground">
              Everything you see here ran locally on an 8 GB MacBook: Ollama models, an embedded vector database, a private Postgres, no paid keys.
              Switch two settings and the same code uses OpenAI.
            </p>
          </div>
          <img
            src={`${import.meta.env.BASE_URL}img/system-dark.png`}
            alt="The System page: every service healthy, cache hit and miss chart, configuration in use"
            loading="lazy"
            width={2880}
            height={1994}
            className="w-full rounded-xl border border-border/70 md:translate-x-6 md:translate-y-6"
          />
        </article>
      </div>
    </section>
  )
}

export function FinalCta({ onOpen }: { onOpen: () => void }) {
  return (
    <section
      aria-labelledby="cta-title"
      className="relative isolate overflow-hidden border-t border-border/70 bg-[radial-gradient(50%_80%_at_50%_100%,color-mix(in_oklab,var(--primary)_22%,transparent),transparent_70%)]"
    >
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-5 py-32 text-center">
        <h2 id="cta-title" className="text-4xl leading-[1.05] font-semibold tracking-[-0.03em] text-balance md:text-6xl">
          Ask it something hard.
        </h2>
        <p className="max-w-[48ch] text-lg text-muted-foreground">
          Sign in with a demo account and watch the pipeline light up while your question runs.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button size="lg" className="h-11 px-5 text-[15px] active:translate-y-px" onClick={onOpen}>
            Open the console
          </Button>
          <Button size="lg" variant="outline" className="h-11 px-5 text-[15px]" asChild>
            <a href={`${import.meta.env.BASE_URL}guide.pdf`} download>
              <DownloadSimpleIcon data-icon="inline-start" />
              Download the guide (PDF)
            </a>
          </Button>
        </div>
      </div>
      <footer className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 border-t border-border/60 px-5 py-6 text-sm text-muted-foreground md:px-8">
        <span>K8s Ops Copilot, built on the EnterpriseRAG project</span>
        <span>FastAPI, LangGraph, Qdrant, Postgres, Redis, Ollama</span>
      </footer>
    </section>
  )
}
