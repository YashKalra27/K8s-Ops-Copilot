import { useId, type ReactNode } from "react"

type Column<T> = { key: keyof T; label: string; format?: (v: T[keyof T]) => string }

/** Every chart gets a text alternative: a one-line takeaway plus the same data
 * as a screen-reader table (Dictator's Frontend Bklit rule §4). */
export function ChartFigure<T extends Record<string, unknown>>({
  title,
  summary,
  data,
  columns,
  children,
}: {
  title: string
  summary: string
  data: T[]
  columns: Column<T>[]
  children: ReactNode
}) {
  const id = useId()
  return (
    <figure role="group" aria-labelledby={`${id}-t`} aria-describedby={`${id}-s`} className="flex flex-col gap-3">
      <figcaption className="flex flex-col gap-1">
        <h3 id={`${id}-t`} className="text-sm font-medium">
          {title}
        </h3>
        <p id={`${id}-s`} className="text-sm text-muted-foreground">
          {summary}
        </p>
      </figcaption>
      <div aria-hidden="true">{children}</div>
      <table className="sr-only">
        <caption>{title}: data</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={String(c.key)} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={String(c.key)}>{c.format ? c.format(row[c.key]) : String(row[c.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
