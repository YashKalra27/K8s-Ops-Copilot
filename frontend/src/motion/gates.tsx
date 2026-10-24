// Reduced-motion and off-screen gates for community WebGL backgrounds and effects.
// Source: Dictator's Frontend references/reactbits/README.md §3 (browser-tested, used verbatim).
import { useEffect, useRef, useState, type ReactNode } from "react"
import { useReducedMotion } from "motion/react"

/* Wrap EVERY animated WebGL / canvas background taken from a community library.
   - Mounted only while its section is near the viewport; off-screen it unmounts, so it stops drawing and frees the GPU.
   - Under reduced motion, and until the section first comes near, it shows `fallback` (a static poster).
   - The parent needs `relative isolate` and a height. */
export function LiveBackground({ children, fallback, margin = "200px" }: { children: ReactNode; fallback: ReactNode; margin?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const reduce = useReducedMotion()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: margin })
    io.observe(el)
    return () => io.disconnect()
  }, [margin])
  return (
    <div ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {near && !reduce ? children : fallback}
    </div>
  )
}

/* For animated effects that ignore reduced motion: render `fallback` (same content, static) instead. */
export function MotionOrStatic({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  return useReducedMotion() ? fallback : children
}
