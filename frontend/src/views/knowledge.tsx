import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useReducedMotion } from "motion/react"
import { UploadSimpleIcon } from "@phosphor-icons/react"
import { toast } from "sonner"

import { ChartFigure } from "@/components/chart-figure"
import { Ring } from "@/components/charts/ring"
import { RingCenter } from "@/components/charts/ring-center"
import { RingChart } from "@/components/charts/ring-chart"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError, api, type Corpus } from "@/lib/api"
import { useSession } from "@/lib/session"

const KIND_LABEL: Record<string, string> = {
  signal: "Kubernetes docs and runbooks",
  noise: "Unrelated papers (noise)",
  upload: "Uploaded by an admin",
  unknown: "Unlabelled",
}

export function KnowledgeView() {
  const { session } = useSession()
  const reduce = useReducedMotion()
  const [corpus, setCorpus] = useState<Corpus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState("")
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    if (!session) return
    api
      .documents(session.token)
      .then((c) => {
        setCorpus(c)
        setError(null)
      })
      .catch((e: ApiError) => setError(e.message))
  }, [session])

  useEffect(load, [load])

  const totals = useMemo(() => {
    const t = { signal: 0, noise: 0, upload: 0, unknown: 0 }
    corpus?.sources.forEach((s) => {
      t[s.corpus] += s.chunks
    })
    return t
  }, [corpus])

  const ringData = useMemo(() => {
    const total = corpus?.total_chunks || 1
    return [
      { label: "Signal", value: totals.signal + totals.upload, maxValue: total, color: "var(--chart-1)" },
      { label: "Noise", value: totals.noise, maxValue: total, color: "var(--chart-2)" },
    ]
  }, [corpus, totals])

  const shown = useMemo(
    () => (corpus?.sources ?? []).filter((s) => s.source.toLowerCase().includes(filter.toLowerCase())),
    [corpus, filter],
  )

  const upload = async (file: File) => {
    if (!session) return
    setUploading(true)
    try {
      const res = await api.upload(session.token, file)
      toast.success(
        res.status === "duplicate"
          ? `${file.name} was already indexed (same content), so it was skipped.`
          : `${res.source} indexed as ${res.chunks} chunks.`,
      )
      load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Upload failed")
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const noisePct = corpus?.total_chunks ? Math.round((totals.noise / corpus.total_chunks) * 100) : 0

  return (
    <div className="flex flex-col gap-8">
      <header className="flex max-w-[70ch] flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">What the assistant can read</h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          Documents are cut into chunks of about a paragraph and stored as embeddings. Most of this library is
          deliberately irrelevant: unrelated computer-science papers mixed in as noise, so the search techniques
          have to prove they can still find the right Kubernetes page.
        </p>
      </header>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardContent className="pt-2">
            {corpus ? (
              <ChartFigure
                title="Signal versus noise, by chunk"
                summary={`${noisePct}% of the ${corpus.total_chunks.toLocaleString()} chunks are noise: text that never answers a Kubernetes question.`}
                data={ringData.map((r) => ({ label: r.label, chunks: r.value }))}
                columns={[
                  { key: "label", label: "Kind" },
                  { key: "chunks", label: "Chunks" },
                ]}
              >
                <div className="mx-auto w-full max-w-[260px]">
                  <RingChart data={ringData} strokeWidth={16} ringGap={8} baseInnerRadius={62}>
                    {ringData.map((_, i) => (
                      <Ring key={i} index={i} animate={!reduce} />
                    ))}
                    <RingCenter defaultLabel="chunks" />
                  </RingChart>
                </div>
                <ul className="mt-2 flex justify-center gap-6 text-sm">
                  {ringData.map((r) => (
                    <li key={r.label} className="flex items-center gap-2">
                      <span className="size-2.5 rounded-full" style={{ background: r.color }} />
                      {r.label}
                      <span className="text-muted-foreground tabular">{r.value.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </ChartFigure>
            ) : (
              <Skeleton className="mx-auto my-6 size-56 rounded-full" />
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="flex flex-row flex-wrap items-center gap-3">
            <CardTitle className="mr-auto text-base">
              {corpus ? `${corpus.total_sources} documents` : "Documents"}
            </CardTitle>
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name"
              aria-label="Filter documents by name"
              className="h-8 w-44"
            />
            {session?.is_admin && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.docx,.html,.htm,.md,.txt"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
                />
                <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  <UploadSimpleIcon data-icon="inline-start" />
                  {uploading ? "Indexing" : "Upload"}
                </Button>
              </>
            )}
          </CardHeader>
          <CardContent>
            {!corpus ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} className="h-7" />
                ))}
              </div>
            ) : corpus.total_chunks === 0 ? (
              <p className="text-sm text-muted-foreground">
                The library is empty. Run <code className="font-mono">make seed-data</code> then{" "}
                <code className="font-mono">make seed</code> to build it.
              </p>
            ) : (
              <ul className="max-h-[420px] overflow-auto pr-1" data-lenis-prevent>
                {shown.map((s) => (
                  <li key={s.source} className="flex items-center gap-3 border-b py-1.5 last:border-0">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: s.corpus === "noise" ? "var(--chart-2)" : "var(--chart-1)" }}
                      title={KIND_LABEL[s.corpus]}
                      aria-label={KIND_LABEL[s.corpus]}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{s.source}</span>
                    <span className="text-xs text-muted-foreground tabular">{s.chunks}</span>
                  </li>
                ))}
                {shown.length === 0 && <li className="py-3 text-sm text-muted-foreground">No document matches.</li>}
              </ul>
            )}
            {!session?.is_admin && corpus && (
              <p className="mt-3 text-xs text-muted-foreground">Sign in as an admin to upload documents.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
