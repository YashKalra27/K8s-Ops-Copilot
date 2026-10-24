import { useState } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { ChunkPreview } from "@/lib/api"

function fileLabel(source: string) {
  if (source.startsWith("http")) return source.replace(/^https?:\/\//, "").slice(0, 48)
  const base = source.split("/").pop() ?? source
  return base.length > 56 ? `${base.slice(0, 53)}...` : base
}

export function ResultsTable({ rows, sql }: { rows: Record<string, unknown>[]; sql: string | null }) {
  if (!rows.length && !sql) return null
  const columns = rows.length ? Object.keys(rows[0]) : []
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Database rows</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {sql && (
          <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {sql}
          </pre>
        )}
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">The query returned no rows.</p>
        ) : (
          <div className="max-h-80 overflow-auto rounded-md border" data-lenis-prevent>
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => (
                    <TableHead key={c} className="font-mono text-xs">
                      {c}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow key={i}>
                    {columns.map((c) => (
                      <TableCell key={c} className="text-xs tabular">
                        {String(row[c] ?? "")}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Retrieved text keeps Markdown fences and PDF line breaks; tidy it for reading. */
function tidy(text: string) {
  return text
    .replace(/```[a-z]*/g, "")
    .replace(/([^\n])\n(?!\n)/g, "$1 ")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

export function ChunkList({ chunks }: { chunks: ChunkPreview[] }) {
  const [open, setOpen] = useState<number | null>(0)
  if (!chunks.length) return null
  const max = Math.max(...chunks.map((c) => Math.abs(c.score)), 1e-9)
  return (
    <ol className="flex flex-col gap-2" aria-label="Retrieved passages">
      {chunks.map((c, i) => (
        <li key={i} className="rounded-md border bg-card">
          <button
            type="button"
            className="flex w-full items-center gap-3 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
          >
            <span className="w-5 text-xs text-muted-foreground tabular">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{fileLabel(c.source)}</span>
            <span
              className="h-1.5 rounded-full bg-primary/70"
              style={{ width: `${Math.max(6, (Math.abs(c.score) / max) * 48)}px` }}
              aria-hidden
            />
            <span className="w-12 text-right text-xs text-muted-foreground tabular">{c.score.toFixed(3)}</span>
          </button>
          {open === i && (
            <p className="border-t px-3 py-2 text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
              {(() => {
                const t = tidy(c.text)
                return t.length > 900 ? `${t.slice(0, 900)}...` : t
              })()}
            </p>
          )}
        </li>
      ))}
    </ol>
  )
}
