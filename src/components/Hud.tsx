import { useEffect, useRef, useSyncExternalStore } from 'react'
import { chapters } from '../animation/chapters'
import {
  getChapter,
  getProgress,
  subscribeChapter,
  subscribeProgress,
} from '../scroll/scrollState'

const pad = (n: number) => String(n).padStart(2, '0')

/** Fixed overlay: brand, current chapter, scroll progress, prototype note. */
export function Hud() {
  const chapterIndex = useSyncExternalStore(subscribeChapter, getChapter)
  const barRef = useRef<HTMLDivElement>(null)

  // The progress bar is updated straight on the DOM node, not through React,
  // so scrolling never triggers a re-render.
  useEffect(() => {
    const update = () => {
      if (barRef.current) barRef.current.style.transform = `scaleX(${getProgress()})`
    }
    update()
    return subscribeProgress(update)
  }, [])

  const chapter = chapters[chapterIndex]

  return (
    <>
      <header className="hud hud--top">
        <h1 className="hud__brand">FORM ENGINE</h1>
        <p className="hud__chapter">
          <span className="hud__index">
            {pad(chapterIndex + 1)} / {pad(chapters.length)}
          </span>{' '}
          {chapter.label}
        </p>
      </header>

      <footer className="hud hud--bottom">
        <p className="hud__note">
          Technical prototype — placeholder geometry only. Not the final design.
        </p>
      </footer>

      <div className="progress" aria-hidden="true">
        <div ref={barRef} className="progress__bar" />
      </div>
    </>
  )
}
