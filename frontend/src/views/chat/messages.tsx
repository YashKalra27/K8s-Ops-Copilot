import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import {
  ArrowsClockwiseIcon,
  BooksIcon,
  CaretDownIcon,
  CheckIcon,
  CircleIcon,
  CopyIcon,
  DatabaseIcon,
  HandPalmIcon,
  LightningIcon,
  ListChecksIcon,
  ShieldWarningIcon,
} from "@phosphor-icons/react"

import { ChunkList, ResultsTable } from "@/components/results"
import { TraceTimeline } from "@/components/trace-timeline"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { ApiError, ChatResponse, TraceStep } from "@/lib/api"
import { ACTS, ROUTE_LABEL, stageFor } from "@/lib/stages"
import { cn } from "@/lib/utils"

import type { ChatTurn, LiveState } from "./use-chat"

// ------------------------------------------------------------------ helpers

function Mark() {
  return (
    <MessageAvatar className="self-start bg-transparent max-sm:hidden">
      <span className="flex size-8 items-center justify-center rounded-full border border-primary/30 bg-accent-soft">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-5" />
      </span>
    </MessageAvatar>
  )
}

const reveal = {
  hidden: { opacity: 0, y: 6 },
  shown: { opacity: 1, y: 0, transition: { type: "spring" as const, bounce: 0, visualDuration: 0.4 } },
}

/** Answer text with `code` and fenced blocks. Fresh answers settle in paragraph by paragraph. */
function AnswerText({ text, animate }: { text: string; animate: boolean }) {
  const blocks = text.split(/```[a-z]*\n?/)
  return (
    <motion.div
      initial={animate ? "hidden" : false}
      animate="shown"
      variants={{ shown: { transition: { staggerChildren: 0.08 } } }}
      className="flex flex-col gap-3 text-[15px] leading-7"
    >
      {blocks.map((block, i) =>
        i % 2 === 1 ? (
          <motion.pre key={i} variants={reveal} className="overflow-x-auto rounded-xl border bg-muted/60 p-3.5 font-mono text-[13px] leading-relaxed">
            {block.trim()}
          </motion.pre>
        ) : (
          block
            .split(/\n{2,}/)
            .filter((p) => p.trim())
            .map((para, j) => (
              <motion.p key={`${i}-${j}`} variants={reveal} className="whitespace-pre-line">
                {para.split(/(`[^`]+`)/).map((part, k) =>
                  part.startsWith("`") && part.endsWith("`") ? (
                    <code key={k} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.86em] [box-decoration-break:clone]">
                      {part.slice(1, -1)}
                    </code>
                  ) : (
                    part
                  ),
                )}
              </motion.p>
            ))
        ),
      )}
    </motion.div>
  )
}

function fileLabel(source: string) {
  if (source.startsWith("http")) return source.replace(/^https?:\/\//, "").slice(0, 40)
  const base = source.split("/").pop() ?? source
  const short = base.split("__").pop() ?? base
  return short.length > 44 ? `${short.slice(0, 41)}...` : short
}

function Disclosure({ label, icon: Icon, children }: { label: string; icon: typeof ListChecksIcon; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col">
      <Button variant="ghost" size="sm" className="h-7 self-start rounded-full px-2.5 text-xs text-muted-foreground" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon data-icon="inline-start" />
        {label}
        <CaretDownIcon data-icon="inline-end" className={cn("transition-transform", open && "rotate-180")} />
      </Button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", bounce: 0, visualDuration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="pt-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ------------------------------------------------------------------ thinking (live)

function LiveClock({ since }: { since: number }) {
  const el = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const id = window.setInterval(() => {
      if (el.current) el.current.textContent = `${((Date.now() - since) / 1000).toFixed(1)} s`
    }, 100)
    return () => window.clearInterval(id)
  }, [since])
  return <span ref={el} className="tabular">0.0 s</span>
}

/** Gemini-style "thinking" row, driven by the backend's live stream (nothing simulated). */
function Thinking({ live }: { live: LiveState }) {
  const reduce = useReducedMotion()
  const [open, setOpen] = useState(false)
  const stage = live.current ? stageFor(live.current.name) : undefined
  const StageIcon = stage?.icon ?? CircleIcon
  const label = stage ? (stage.doing ?? stage.short) : live.steps.length ? "Working" : "Connecting to the pipeline"
  const currentAct = stage?.act ?? (live.steps.length ? stageFor(live.steps[live.steps.length - 1].name)?.act : undefined)
  const order = ACTS.map((a) => a.id)

  return (
    <div className="flex flex-col gap-2.5" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <StageIcon className="size-4 shrink-0 text-primary" weight="duotone" aria-hidden />
        <span className="text-[15px] font-medium motion-safe:shimmer">{label}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          <LiveClock since={live.startedAt} />
        </span>
      </div>
      <ol className="grid grid-cols-4 gap-1.5" aria-label="Progress">
        {ACTS.map((a) => {
          const idx = order.indexOf(a.id)
          const cur = currentAct ? order.indexOf(currentAct) : -1
          const state = idx < cur ? "done" : idx === cur ? "active" : "idle"
          return (
            <li key={a.id} className="flex flex-col gap-1" title={a.title}>
              <span className="relative h-1 overflow-hidden rounded-full bg-border/60">
                {state === "done" && <span className="absolute inset-0 bg-ok" />}
                {state === "active" && (
                  <span className="absolute inset-0 bg-primary/35">
                    {!reduce && <span className="absolute inset-y-0 w-1/2 animate-[sweep_1.1s_ease-in-out_infinite] bg-primary" />}
                  </span>
                )}
              </span>
              <span className={cn("truncate text-[11px]", state === "idle" ? "text-muted-foreground/70" : state === "done" ? "text-ok" : "text-primary")}>{a.title}</span>
            </li>
          )
        })}
      </ol>
      {live.steps.length > 0 && (
        <div>
          <Button variant="ghost" size="sm" className="h-7 rounded-full px-2.5 text-xs text-muted-foreground" onClick={() => setOpen(!open)} aria-expanded={open}>
            <ListChecksIcon data-icon="inline-start" />
            {open ? "Hide steps" : `Show steps (${live.steps.length} done)`}
            <CaretDownIcon data-icon="inline-end" className={cn("transition-transform", open && "rotate-180")} />
          </Button>
          {open && (
            <div className="mt-2 rounded-xl border bg-card/60 p-3">
              <TraceTimeline steps={live.steps} replayKey="live" live />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ approval + blocked

function Approval({ data, busy, onDecide }: { data: ChatResponse; busy: boolean; onDecide: (approved: boolean) => void }) {
  const p = data.pending_sql!
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-accent-soft p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <HandPalmIcon className="size-4 text-primary" weight="fill" aria-hidden />
        This needs the operations database. Nothing has run yet.
      </p>
      <pre className="overflow-x-auto rounded-xl border bg-card p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap">{p.sql}</pre>
      {p.explanation && <p className="text-sm text-muted-foreground">{p.explanation}</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onDecide(true)} disabled={busy} className="rounded-full active:translate-y-px">
          {busy ? "Running" : "Approve and run"}
        </Button>
        <Button variant="outline" onClick={() => onDecide(false)} disabled={busy} className="rounded-full">
          Reject
        </Button>
      </div>
    </div>
  )
}

function Blocked({ error }: { error: ApiError }) {
  const step = [...error.trace].reverse().find((s) => s.status === "blocked" || s.status === "error")
  const stage = step ? stageFor(step.name) : undefined
  const title = error.status === 0 ? "The API is offline" : stage ? `Stopped by ${stage.layer}: ${stage.short}` : `Request failed (${error.status})`
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-destructive/30 bg-danger-soft p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
        <ShieldWarningIcon className="size-4" weight="fill" aria-hidden />
        {title}
      </p>
      <p className="text-sm">{error.message}</p>
      {stage && <p className="text-sm text-muted-foreground">{stage.why}</p>}
      {stage?.layer === "L2" && (
        <p className="text-sm text-muted-foreground">If this was a genuine question, try wording it differently. The scanning model can misread harmless phrasing.</p>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ messages

export function UserMessage({ content }: { content: string }) {
  return (
    <Message align="end">
      <MessageContent>
        <Bubble variant="secondary" align="end">
          <BubbleContent className="rounded-3xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap">{content}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

function Actions({ data, text }: { data: ChatResponse; text: string }) {
  const [copied, setCopied] = useState(false)
  const m = data.metadata
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard blocked */
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="rounded-full" onClick={copy} aria-label="Copy answer">
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copied ? "Copied" : "Copy"}</TooltipContent>
      </Tooltip>
      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground/80">{ROUTE_LABEL[m.route] ?? m.route}</span>
      {data.cache_hit && (
        <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] text-accent-foreground">
          <LightningIcon weight="fill" className="size-3" aria-hidden /> From cache
        </span>
      )}
      <span className="px-1 tabular">
        Confidence {Math.round(data.confidence * 100)}%{m.total_ms ? `, ${(m.total_ms / 1000).toFixed(1)} s` : ""}
      </span>
    </div>
  )
}

export function AssistantMessage({
  turn,
  onDecide,
}: {
  turn: Extract<ChatTurn, { role: "assistant" }>
  onDecide: (queryId: string, approved: boolean) => void
}) {
  const data = turn.response
  const m = data?.metadata
  const trace: TraceStep[] = turn.error?.trace ?? m?.trace ?? []
  const chunks = m && m.route !== "sql" ? m.retrieved_chunks : []

  return (
    <Message align="start" className="gap-3">
      <Mark />
      <MessageContent className="min-w-0 gap-3 pt-1">
        {turn.live && <Thinking live={turn.live} />}
        {turn.error && <Blocked error={turn.error} />}

        {data && !turn.error && (
          <>
            {m?.standalone_question && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ArrowsClockwiseIcon className="size-3.5" aria-hidden />
                Understood as: <span className="text-foreground/80">{m.standalone_question}</span>
              </p>
            )}
            {data.pending_sql ? (
              <Approval data={data} busy={Boolean(turn.approving)} onDecide={(ok) => onDecide(data.pending_sql!.query_id, ok)} />
            ) : (
              <>
                <AnswerText text={data.answer || "No answer was produced."} animate={Boolean(turn.fresh)} />
                {m && (m.sql_rows.length > 0 || m.sql) && <ResultsTable rows={m.sql_rows} sql={m.sql} />}
                {data.sources.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5" aria-label="Sources">
                    {data.sources.map((s) => (
                      <li key={s} className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card/60 px-2.5 py-1 text-xs" title={s}>
                        {s === "database query" ? (
                          <DatabaseIcon className="size-3.5 shrink-0 text-primary" aria-hidden />
                        ) : (
                          <BooksIcon className="size-3.5 shrink-0 text-primary" aria-hidden />
                        )}
                        <span className="truncate">{fileLabel(s)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <Actions data={data} text={data.answer} />
              </>
            )}
          </>
        )}

        {!turn.live && (trace.length > 0 || chunks.length > 0) && (
          <div className="-mt-1 flex flex-col gap-1">
            {trace.length > 0 && (
              <Disclosure label={`${trace.length} checks and steps`} icon={ListChecksIcon}>
                <div className="rounded-xl border bg-card/60 p-3">
                  <TraceTimeline steps={trace} replayKey={turn.id} replay={false} />
                </div>
              </Disclosure>
            )}
            {chunks.length > 0 && (
              <Disclosure label={`${chunks.length} passages used`} icon={BooksIcon}>
                <ChunkList chunks={chunks} />
              </Disclosure>
            )}
          </div>
        )}
      </MessageContent>
    </Message>
  )
}
