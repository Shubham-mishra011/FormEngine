import { chapterIndexForProgress } from '../animation/chapters'

/**
 * Tiny scroll store that lives outside React. Progress changes on every
 * scroll frame, so it must never go through React state. Consumers subscribe
 * and update the DOM or the 3D scene directly; only the chapter index (which
 * changes a handful of times) is used with React rendering.
 */

type Listener = () => void

let progress = 0
let chapter = 0
const progressListeners = new Set<Listener>()
const chapterListeners = new Set<Listener>()

export function setProgress(next: number): void {
  const clamped = Math.min(1, Math.max(0, next))
  if (clamped === progress) return
  progress = clamped
  progressListeners.forEach((listener) => listener())

  const nextChapter = chapterIndexForProgress(clamped)
  if (nextChapter !== chapter) {
    chapter = nextChapter
    chapterListeners.forEach((listener) => listener())
  }
}

export const getProgress = (): number => progress
export const getChapter = (): number => chapter

export function subscribeProgress(listener: Listener): () => void {
  progressListeners.add(listener)
  return () => {
    progressListeners.delete(listener)
  }
}

export function subscribeChapter(listener: Listener): () => void {
  chapterListeners.add(listener)
  return () => {
    chapterListeners.delete(listener)
  }
}
