import { useEffect } from 'react'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import { gsap, ScrollTrigger } from '../animation/gsapSetup'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'

/**
 * Lenis smooth scrolling, driven by GSAP's ticker so there is exactly one
 * animation loop for scrolling (Lenis' own requestAnimationFrame loop is not
 * used). Lenis scroll events keep ScrollTrigger in sync.
 *
 * With "reduce motion" enabled, Lenis is skipped and the browser's native
 * scrolling is used.
 */
export function useSmoothScroll(): void {
  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    if (reducedMotion) return

    const lenis = new Lenis()
    const onScroll = () => ScrollTrigger.update()
    const tick = (time: number) => lenis.raf(time * 1000)

    lenis.on('scroll', onScroll)
    gsap.ticker.add(tick)
    // Lenis needs real elapsed time; GSAP's lag smoothing would cause jumps.
    gsap.ticker.lagSmoothing(0)

    return () => {
      gsap.ticker.remove(tick)
      gsap.ticker.lagSmoothing(500, 33) // restore GSAP defaults
      lenis.off('scroll', onScroll)
      lenis.destroy()
    }
  }, [reducedMotion])
}
