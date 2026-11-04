import { gsap } from './gsapSetup'
import { chapters, type Pose } from './chapters'

/**
 * Builds the paused master timeline. It is never played: the caller sets its
 * progress from the scroll position, so the result is a pure function of
 * scroll — scrolling backward or jumping always lands on the correct state.
 *
 * Each segment uses explicit from/to values (not plain `to`) so seeking to
 * any point renders correctly even if earlier segments never ran.
 */
export function createMasterTimeline(rig: Pose): gsap.core.Timeline {
  const timeline = gsap.timeline({
    paused: true,
    defaults: { ease: 'power2.inOut', duration: 1 },
  })

  for (let i = 1; i < chapters.length; i++) {
    timeline.fromTo(
      rig,
      { ...chapters[i - 1].pose },
      { ...chapters[i].pose, immediateRender: false },
      i - 1,
    )
  }

  return timeline
}
