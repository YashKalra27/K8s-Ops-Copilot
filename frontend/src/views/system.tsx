import { useCallback, useEffect, useState } from "react"
import { useReducedMotion } from "motion/react"
import { ArrowsClockwiseIcon, CheckCircleIcon, TrashIcon, XCircleIcon } from "@phosphor-icons/react"
import { toast } from "sonner"

import { ChartFigure } from "@/components/chart-figure"
import { Bar } from "@/components/charts/bar"
import { BarChart } from "@/components/charts/bar-chart"
import { BarXAxis } from "@/components/charts/bar-x-axis"
import { Grid } from "@/components/charts/grid"
import { ChartTooltip } from "@/components/charts/tooltip"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError, api, type CacheStats, type Health, type Me } from "@/lib/api"
import { useSession } from "@/lib/session"

const COMPONENTS: { key: keyof Health; name: string; what: string }[] = [
  { key: "llm", name: "Language model", what: "Writes answers, SQL and grades" },
  { key: "qdrant", name: "Qdrant", what: "Vector search over document chunks" },
  { key: "postgres", name: "PostgreSQL", what: "Ops data, users, paused workflows" },
  { key: "redis", name: "Cache store", what: "Caches, rate limits, budgets" },
  { key: "tavily", name: "Tavily web search", what: "CRAG fallback (optional)" },
]

const TIERS: { key: keyof CacheStats; label: string; ttl: string }[] = [
  { key: "intent_router", label: "Intent", ttl: "24 h" },
  { key: "embedding", label: "Embeddings", ttl: "7 d" },
  { key: "rag", label: "Answers", ttl: "1 h" },
  { key: "sql_gen", label: "SQL text", ttl: "24 h" },
  { key: "sql_result", label: "SQL rows", ttl: "15 min" },
]

export function SystemView() {
  const { session } = useSession()
  const reduce = useReducedMotion()
  const [health, setHealth] = useState<Health | null>(null)
  const [cache, setCache] = useState<CacheStats | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!session) return
    setLoading(true)
    const [h, m, c] = await Promise.allSettled([
      api.health(),
      api.me(session.token),
      session.is_admin ? api.cacheStats(session.token) : Promise.reject(new ApiError(403, "admin only")),
    ])
    if (h.status === "fulfilled") setHealth(h.value)
    else toast.error((h.reason as Error).message)
    if (m.status === "fulfilled") setMe(m.value)
    if (c.status === "fulfilled") setCache(c.value)
    setLoading(false)
  }, [session])

  useEffect(() => {
    void load()
  }, [load])

  const clear = async () => {
    if (!session) return
    try {
      const res = await api.clearCache(session.token)
      toast.success(`Cleared: ${res.cleared.join(", ")}`)
      void load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not clear the cache")
    }
  }

  const tierData = cache
    ? TIERS.map((t) => ({ tier: t.label, hits: cache[t.key].hits, misses: cache[t.key].misses }))
    : []
  const totalHits = tierData.reduce((s, t) => s + t.hits, 0)
  const totalLookups = tierData.reduce((s, t) => s + t.hits + t.misses, 0)
  const best = [...tierData].sort((a, b) => b.hits - a.hits)[0]

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-[70ch] flex-col gap-3">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">System status</h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            Live checks of every service the assistant depends on, and how often each cache saved work.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <ArrowsClockwiseIcon data-icon="inline-start" className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Services</CardTitle>
              {health && (
                <span className={health.status === "ok" ? "text-sm text-ok" : "text-sm text-warn"}>
                  {health.status === "ok" ? "All required services up" : "Degraded"}
                </span>
              )}
            </CardHeader>
            <CardContent>
              {!health ? (
                <div className="flex flex-col gap-3">
                  {COMPONENTS.map((c) => (
                    <Skeleton key={c.key} className="h-10" />
                  ))}
                </div>
              ) : (
                <ul className="flex flex-col gap-4">
                  {COMPONENTS.map((c) => {
                    const ok = Boolean(health[c.key])
                    return (
                      <li key={c.key} className="flex items-start gap-3">
                        {ok ? (
                          <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-ok" weight="fill" aria-label="up" />
                        ) : (
                          <XCircleIcon className="mt-0.5 size-5 shrink-0 text-destructive" weight="fill" aria-label="down" />
                        )}
                        <div className="flex min-w-0 flex-col">
                          <p className="text-sm font-medium">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.what}</p>
                          <p className="truncate font-mono text-xs text-muted-foreground">{health.details[c.key]}</p>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {health && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Configuration in use</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                  {Object.entries(health.config).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k.replaceAll("_", " ")}</dt>
                      <dd className="truncate font-mono text-xs leading-5">{v}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-base">Cache tiers</CardTitle>
              {session?.is_admin && (
                <Button size="sm" variant="outline" onClick={() => void clear()}>
                  <TrashIcon data-icon="inline-start" />
                  Clear caches
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {!session?.is_admin ? (
                <p className="text-sm text-muted-foreground">Cache statistics are visible to admins. Sign in as admin@demo.local.</p>
              ) : !cache ? (
                <Skeleton className="h-64" />
              ) : totalLookups === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No lookups yet since the server started. Ask a few questions, then ask one again to see a hit.
                </p>
              ) : (
                <ChartFigure
                  title="Hits and misses per cache tier, since the server started"
                  summary={`${totalHits} of ${totalLookups} lookups were served from cache${best && best.hits ? `; the ${best.tier.toLowerCase()} tier saved the most work` : ""}.`}
                  data={tierData}
                  columns={[
                    { key: "tier", label: "Tier" },
                    { key: "hits", label: "Hits" },
                    { key: "misses", label: "Misses" },
                  ]}
                >
                  <BarChart data={tierData} xDataKey="tier" aspectRatio="2 / 1" barGap={0.3}>
                    <Grid horizontal />
                    <Bar dataKey="hits" fill="var(--chart-1)" animate={!reduce} lineCap={4} />
                    <Bar dataKey="misses" fill="var(--chart-2)" animate={!reduce} lineCap={4} />
                    <BarXAxis showAllLabels />
                    <ChartTooltip />
                  </BarChart>
                  <ul className="mt-3 flex gap-6 text-sm">
                    <li className="flex items-center gap-2">
                      <span className="size-2.5 rounded-full bg-chart-1" /> Hits
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="size-2.5 rounded-full bg-chart-2" /> Misses
                    </li>
                  </ul>
                </ChartFigure>
              )}
              <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {TIERS.map((t) => (
                  <div key={t.key} className="flex flex-col">
                    <dt className="text-xs text-muted-foreground">{t.label}</dt>
                    <dd className="text-sm tabular">kept {t.ttl}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          {me && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Your token budget today</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                <p className="text-2xl font-semibold tabular">
                  {me.token_budget.remaining.toLocaleString()}
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}
                    of {me.token_budget.limit.toLocaleString()} tokens left
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Each question is charged an estimate (question length plus 1,000 for the answer). The budget
                  resets at midnight UTC.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
