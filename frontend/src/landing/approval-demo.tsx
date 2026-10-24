import { useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ArrowCounterClockwiseIcon, CheckCircleIcon, HandPalmIcon, ProhibitIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"

import { APPROVAL_DEMO } from "./data"

type State = "pending" | "approved" | "rejected"

const swap = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { type: "spring" as const, bounce: 0, visualDuration: 0.3 },
}

/** The real approval card, replaying a recorded query. Reason for motion: the
 *  card changes state when you decide, exactly as it does in the console. */
export function ApprovalDemo() {
  const [state, setState] = useState<State>("pending")

  return (
    <section aria-labelledby="approval-title" className="relative">
      <div className="mx-auto grid max-w-[1280px] items-center gap-12 px-5 py-28 md:px-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="flex flex-col gap-5">
          <h2 id="approval-title" className="text-4xl leading-[1.05] font-semibold tracking-[-0.03em] text-balance md:text-5xl">
            It writes the SQL. You press run.
          </h2>
          <p className="max-w-[46ch] text-muted-foreground">
            Questions about numbers go to the operations database. The AI drafts the query, Postgres checks it without running it, and the
            workflow pauses until a person approves. Try it: this is a recorded query from the real database.
          </p>
        </div>

        <div className="rounded-3xl border bg-card/70 p-2 shadow-[0_30px_90px_-40px_color-mix(in_oklab,var(--primary)_55%,transparent)] backdrop-blur">
          <div className="rounded-[20px] border border-border/60 bg-background/60 p-6">
            <p className="text-sm text-muted-foreground">Question</p>
            <p className="mt-1 text-lg font-medium">{APPROVAL_DEMO.question}</p>

            <pre className="mt-5 overflow-x-auto rounded-xl border bg-card p-4 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap">
              {APPROVAL_DEMO.sql}
            </pre>
            <p className="mt-3 text-sm text-muted-foreground">{APPROVAL_DEMO.explanation}</p>

            <motion.div layout className="mt-5" aria-live="polite" transition={{ type: "spring", bounce: 0, visualDuration: 0.35 }}>
              <AnimatePresence mode="wait" initial={false}>
                {state === "pending" && (
                  <motion.div key="pending" {...swap} className="flex flex-col gap-4">
                    <p className="inline-flex items-center gap-2 text-sm font-medium text-primary">
                      <HandPalmIcon className="size-4" weight="fill" aria-hidden />
                      Paused. Nothing has touched the data yet.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => setState("approved")} className="active:translate-y-px">
                        Approve and run
                      </Button>
                      <Button variant="outline" onClick={() => setState("rejected")}>
                        Reject
                      </Button>
                    </div>
                  </motion.div>
                )}
                {state === "approved" && (
                  <motion.div key="approved" {...swap} className="flex flex-col gap-3">
                    <p className="inline-flex items-center gap-2 text-sm font-medium text-ok">
                      <CheckCircleIcon className="size-4" weight="fill" aria-hidden />
                      Ran read-only in 25 ms. Five rows:
                    </p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="py-1.5 font-medium">Cluster</th>
                          <th className="py-1.5 text-right font-medium">P1 incidents</th>
                        </tr>
                      </thead>
                      <tbody>
                        {APPROVAL_DEMO.rows.map((r, i) => (
                          <motion.tr
                            key={r.cluster}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.06 * i, type: "spring", bounce: 0, visualDuration: 0.3 }}
                            className="border-t border-border/60"
                          >
                            <td className="py-1.5 font-mono text-[13px]">{r.cluster}</td>
                            <td className="py-1.5 text-right tabular">{r.p1}</td>
                          </motion.tr>
                        ))}
                      </tbody>
                    </table>
                    <Button variant="ghost" size="sm" className="self-start" onClick={() => setState("pending")}>
                      <ArrowCounterClockwiseIcon data-icon="inline-start" />
                      Reset demo
                    </Button>
                  </motion.div>
                )}
                {state === "rejected" && (
                  <motion.div key="rejected" {...swap} className="flex flex-col gap-3">
                    <p className="inline-flex items-center gap-2 text-sm font-medium text-destructive">
                      <ProhibitIcon className="size-4" weight="fill" aria-hidden />
                      Rejected. The query never ran.
                    </p>
                    <p className="text-sm text-muted-foreground">The saved workflow ends here; the database was never contacted.</p>
                    <Button variant="ghost" size="sm" className="self-start" onClick={() => setState("pending")}>
                      <ArrowCounterClockwiseIcon data-icon="inline-start" />
                      Reset demo
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  )
}
