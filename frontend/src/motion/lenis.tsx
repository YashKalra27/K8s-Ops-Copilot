// Smooth scroll on NATIVE scroll (Lenis), driven by GSAP's ticker so ScrollTrigger stays in sync.
// Source: Dictator's Frontend references/motion-patterns.md §4 (browser-tested).
// Mounted ONLY on the landing page (marketing), never on the console (product UI).
// Reduced motion: Lenis disables smoothing itself (respectReducedMotion, default true).
import { useEffect, useRef, type ReactNode } from "react"
import { ReactLenis, useLenis, type LenisRef } from "lenis/react"
import "lenis/dist/lenis.css"
import { gsap, ScrollTrigger } from "./gsap"

export function SmoothScrollLenis({ children }: { children: ReactNode }) {
  const lenisRef = useRef<LenisRef>(null)
  useEffect(() => {
    // Read the instance LAZILY on every tick: <ReactLenis> creates it after this effect runs.
    const tick = (time: number) => lenisRef.current?.lenis?.raf(time * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)
    return () => {
      gsap.ticker.remove(tick)
      gsap.ticker.lagSmoothing(500, 33)
    }
  }, [])
  return (
    <ReactLenis
      root
      ref={lenisRef}
      options={{ autoRaf: false, anchors: true, allowNestedScroll: true, stopInertiaOnNavigate: true }}
    >
      <LenisScrollTriggerSync />
      {children}
    </ReactLenis>
  )
}

/* ScrollTrigger must read every smoothed position. */
function LenisScrollTriggerSync() {
  useLenis(() => ScrollTrigger.update())
  return null
}
