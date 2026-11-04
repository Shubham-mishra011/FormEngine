import { useEffect, type RefObject } from 'react'
import { ScrollTrigger } from '../animation/gsapSetup'
import { setProgress } from './scrollState'

/**
 * The single ScrollTrigger in the app. It maps the scroll range of the given
 * element to a 0..1 progress value in the scroll store. Everything else
 * (HUD, 3D timeline) reads that value.
 */
export function useScrollProgress(target: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = target.current
    if (!element) return

    const trigger = ScrollTrigger.create({
      trigger: element,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (self) => setProgress(self.progress),
      onRefresh: (self) => setProgress(self.progress),
    })
    setProgress(trigger.progress)

    return () => trigger.kill()
  }, [target])
}
