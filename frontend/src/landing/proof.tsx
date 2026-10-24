import { useEffect, useRef, useState } from "react"

import { api } from "@/lib/api"
import { gsap, MOTION_OK, useGSAP } from "@/motion/gsap"

/* Counter recipe (motion-patterns.md §6.7): the real number is in the markup, so
   reduced motion and screen readers get it immediately; it counts up once. */
function Counter({ value }: { value: number }) {
  const el = useRef<HTMLSpanElement>(null)
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(MOTION_OK, () => {
        const fmt = (n: number) => Math.round(n).toLocaleString("en-US")
        const o = { v: 0 }
        el.current!.textContent = fmt(0)
        gsap.to(o, {
          v: value,
          duration: 1.6,
          ease: "power2.out",
          onUpdate: () => {
            el.current!.textContent = fmt(o.v)
          },
          scrollTrigger: { trigger: el.current, start: "top 90%", once: true },
        })
      })
    },
    { dependencies: [value] },
  )
  return (
    <span ref={el} className="tabular">
      {value.toLocaleString("en-US")}
    </span>
  )
}

function parseLeadingNumber(text: string | undefined): number | null {
  const m = text?.match(/^([\d,]+)/)
  return m ? Number(m[1].replace(/,/g, "")) : null
}

export function ProofRow() {
  // Live from the running API; falls back to the values measured for the guide.
  const [live, setLive] = useState({ chunks: 6122, incidents: 2000 })
  useEffect(() => {
    api
      .health()
      .then((h) => {
        const chunks = parseLeadingNumber(h.details.qdrant)
        const incidents = parseLeadingNumber(h.details.postgres)
        setLive((prev) => ({ chunks: chunks ?? prev.chunks, incidents: incidents ?? prev.incidents }))
      })
      .catch(() => {})
  }, [])

  const items = [
    { value: live.chunks, label: "passages searched for every question" },
    { value: live.incidents, label: "incidents in the operations database" },
    { value: 9, label: "security layers on every request" },
    { value: 71, label: "automated tests guarding the pipeline" },
  ]

  return (
    <section aria-label="The system in numbers" className="border-y border-border/70 bg-card/30">
      <dl className="mx-auto grid max-w-[1280px] grid-cols-2 gap-y-8 px-5 py-10 md:px-8 lg:grid-cols-4">
        {items.map((it, i) => (
          <div
            key={it.label}
            className={`flex flex-col-reverse justify-end gap-1 px-4 ${i % 2 === 1 ? "border-l border-border/70" : ""} ${i > 0 ? "lg:border-l lg:border-border/70" : ""}`}
          >
            <dt className="max-w-[24ch] text-sm text-muted-foreground">{it.label}</dt>
            <dd className="text-4xl font-semibold tracking-tight md:text-5xl">
              <Counter value={it.value} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
