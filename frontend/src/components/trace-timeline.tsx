import { useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { CaretDownIcon, CircleIcon } from "@phosphor-icons/react"

import type { TraceStep } from "@/lib/api"
import { ACTS, stageFor } from "@/lib/stages"
import { cn } from "@/lib/utils"

const STATUS_STYLE: Record<string, { dot: string; label: string; text: string }> = {
  ok: { dot: "bg-ok", label: "passed", text: "text-ok" },
  hit: { dot: "bg-primary", label: "hit", text: "text-primary" },
  miss: { dot: "bg-muted-foreground/50", label: "miss", text: "text-muted-foreground" },
  skip: { dot: "border border-muted-foreground/60 bg-transparent", label: "off", text: "text-muted-foreground" },
  fallback: { dot: "bg-warn", label: "fallback", text: "text-warn" },
  blocked: { dot: "bg-destructive", label: "blocked", text: "text-destructive" },
  error: { dot: "bg-destructive", label: "error", text: "text-destructive" },
}

function styleFor(status: string) {
  return STATUS_STYLE[status] ?? STATUS_STYLE.ok
}

/** One short, human-readable line per step, built from the real trace detail. */
function summarize(step: TraceStep): string {
  const d = step.detail as Record<string, unknown>
  const s = (k: string) => (d[k] === undefined || d[k] === null ? undefined : String(d[k]))
  if (d.reason && (step.status === "skip" || step.status === "blocked" || step.status === "fallback"))
    return String(d.reason)
  if (d.error) return String(d.error)
  switch (step.name) {
    case "Intent router":
      return `route: ${s("intent")}${d.cache === "hit" || step.status === "hit" ? " (cached)" : ""}`
    case "Retrieve":
      return `${s("mode")}: ${s("candidates")} candidates`
    case "Rerank (cross-encoder)":
      return `kept ${s("kept")} best`
    case "CRAG grading":
      return d.score !== undefined ? `relevance ${Number(d.score).toFixed(2)}: ${s("verdict")}` : (s("verdict") ?? "")
    case "Web search (Tavily)":
      return `${s("results")} web results`
    case "HyDE hypotheses":
      return `${s("count")} hypothetical answers`
    case "Rate limit":
      return `${s("remaining")} requests left this minute`
    case "Token budget":
      return `~${s("estimated")} tokens of ${Number(d.remaining ?? 0).toLocaleString()} left`
    case "Input restructuring":
      return `${s("tokens")} tokens, ${s("method")}`
    case "Input moderation + PII redaction":
    case "Output moderation + PII redaction":
      return d.redacted ? "personal data redacted" : "nothing to redact"
    case "Text2SQL generate":
      return d.cache === "hit" ? "SQL from cache" : Number(d.fixes) > 0 ? `SQL written, fixed ${d.fixes}x after EXPLAIN` : "SQL written and checked with EXPLAIN"
    case "Execute SQL (read-only)":
      return `${s("rows")} ${Number(d.rows) === 1 ? "row" : "rows"}`
    case "Spotlighting":
      return `${s("chunks")} chunks fenced as data`
    case "Generate answer":
      return d.tokens ? `${s("tokens")} tokens` : ""
    case "Self-RAG reflection":
      return `score ${Number(d.score ?? 0).toFixed(2)}${d.regenerate ? ", rewriting question" : ", accepted"}`
    case "Output schema validation":
      return s("result") ?? ""
    case "Human approval":
      return d.approved ? "approved" : "rejected"
    case "Paused for SQL approval":
      return "waiting for you"
    case "JWT auth":
      return `signed in as ${s("user")}`
    default:
      return ""
  }
}

function formatMs(ms: number) {
  if (ms < 1) return "<1 ms"
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

export function TraceTimeline({ steps, replayKey, live = false, replay = true }: { steps: TraceStep[]; replayKey: string; live?: boolean; replay?: boolean }) {
  const reduce = useReducedMotion()
  const [open, setOpen] = useState<number | null>(null)
  // Cap the replay at ~1.4s however many steps there are.
  const stagger = Math.min(0.07, 1.4 / Math.max(steps.length, 1))

  let lastAct: string | undefined

  return (
    <motion.ol
      key={replayKey}
      className="relative flex flex-col"
      // Replay: the whole list staggers in once. Live: each new step animates in as it arrives.
      initial={reduce || live || !replay ? false : "hidden"}
      animate="shown"
      variants={{ shown: { transition: { staggerChildren: stagger } } }}
      aria-label="Pipeline trace, in the order the request ran"
    >
      {steps.map((step, i) => {
        const stage = stageFor(step.name)
        const st = styleFor(step.status)
        const Icon = stage?.icon ?? CircleIcon
        const act = stage?.act
        const actHeader = act && act !== lastAct ? ACTS.find((a) => a.id === act)?.title : undefined
        lastAct = act ?? lastAct
        const summary = summarize(step)
        const expanded = open === i
        const last = i === steps.length - 1

        return (
          <motion.li
            key={`${step.name}-${i}`}
            initial={live && !reduce ? { opacity: 0, y: 8 } : undefined}
            variants={{
              hidden: { opacity: 0, y: 6 },
              shown: { opacity: 1, y: 0, transition: { type: "spring", bounce: 0, visualDuration: 0.3 } },
            }}
          >
            {actHeader && (
              <p className={cn("pb-2 pl-9 text-xs font-medium text-muted-foreground", i > 0 && "pt-3")}>{actHeader}</p>
            )}
            <div className="grid grid-cols-[28px_1fr] gap-x-2">
              <div className="relative flex justify-center">
                <span className={cn("relative z-10 mt-[7px] size-2.5 rounded-full", st.dot)} aria-hidden />
                {!last && <span className="absolute top-[18px] bottom-[-7px] w-px bg-border" aria-hidden />}
              </div>
              <div className="pb-3">
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : i)}
                  aria-expanded={expanded}
                  className="group flex w-full items-start gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-medium">{stage?.short ?? step.name}</span>
                      {step.layer?.startsWith("L") && (
                        <span className="text-xs text-muted-foreground tabular">{step.layer}</span>
                      )}
                      <span className={cn("text-xs", st.text)}>{st.label}</span>
                    </span>
                    {summary && <span className="block truncate text-xs text-muted-foreground">{summary}</span>}
                  </span>
                  <span className="shrink-0 pt-0.5 text-xs text-muted-foreground tabular">{formatMs(step.ms)}</span>
                  <CaretDownIcon
                    className={cn(
                      "mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform",
                      expanded && "rotate-180",
                    )}
                    aria-hidden
                  />
                </button>
                <AnimatePresence initial={false}>
                  {expanded && stage && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ type: "spring", bounce: 0, visualDuration: 0.25 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2 flex flex-col gap-1.5 rounded-md bg-muted/60 p-3 text-xs leading-relaxed">
                        <p>{stage.plain}</p>
                        <p className="text-muted-foreground">
                          Code: <span className="font-mono">{stage.code}</span>
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.li>
        )
      })}
    </motion.ol>
  )
}
