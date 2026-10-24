// One place to register GSAP plugins (all free, "Standard no charge" licence). Import gsap from here.
// Source: Dictator's Frontend references/motion-patterns.md §4 (browser-tested).
import gsap from "gsap"
import { useGSAP } from "@gsap/react"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { SplitText } from "gsap/SplitText"
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin"
import { MotionPathPlugin } from "gsap/MotionPathPlugin"
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin"

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText, DrawSVGPlugin, MotionPathPlugin, ScrambleTextPlugin)

export { gsap, useGSAP, ScrollTrigger, SplitText }

/** Media query that gates ALL non-essential motion. Under reduced motion the setup never runs, so the page stays static. */
export const MOTION_OK = "(prefers-reduced-motion: no-preference)"

/**
 * ScrollTrigger only re-measures on viewport resize/load. Content changing height ABOVE a trigger (late images,
 * accordions, async data) leaves start/end stale. Call once at the app root.
 * Guarded: heights produced by ScrollTrigger's own refresh (pin spacing) are recorded and ignored, so no loop.
 */
export function autoRefreshOnLayoutShift(delay = 150): () => void {
  const doc = document.documentElement
  let last = doc.scrollHeight
  let timer: number | undefined
  const onRefresh = () => {
    last = doc.scrollHeight
  }
  ScrollTrigger.addEventListener("refresh", onRefresh)
  const ro = new ResizeObserver(() => {
    if (Math.abs(doc.scrollHeight - last) < 2) return
    window.clearTimeout(timer)
    timer = window.setTimeout(() => ScrollTrigger.refresh(), delay)
  })
  ro.observe(document.body)
  return () => {
    ro.disconnect()
    window.clearTimeout(timer)
    ScrollTrigger.removeEventListener("refresh", onRefresh)
  }
}
