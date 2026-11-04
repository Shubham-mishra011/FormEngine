import { lazy, Suspense, useCallback, useRef, useState } from 'react'
import { ChapterSections } from './components/ChapterSections'
import { Hud } from './components/Hud'
import { SceneErrorBoundary } from './components/SceneErrorBoundary'
import { LoadingOverlay, WebGLFallback } from './components/StatusMessages'
import { useScrollProgress } from './scroll/useScrollProgress'
import { useSmoothScroll } from './scroll/useSmoothScroll'
import { isWebGLAvailable } from './three/webgl'

// Three.js is large; load it after the page shell so the loading state shows first.
const SceneCanvas = lazy(() =>
  import('./three/SceneCanvas').then((module) => ({ default: module.SceneCanvas })),
)

type SceneStatus = 'loading' | 'ready' | 'failed'

/**
 * Page layout: one persistent 3D canvas behind, scrolling HTML chapters in
 * front, a fixed HUD on top.
 */
export default function App() {
  const [status, setStatus] = useState<SceneStatus>(() =>
    isWebGLAvailable() ? 'loading' : 'failed',
  )
  const scrollRef = useRef<HTMLElement>(null)

  useSmoothScroll()
  useScrollProgress(scrollRef)

  const handleReady = useCallback(() => setStatus((s) => (s === 'failed' ? s : 'ready')), [])
  const handleFailed = useCallback(() => setStatus('failed'), [])

  return (
    <>
      {status !== 'failed' && (
        <SceneErrorBoundary onError={handleFailed}>
          <Suspense fallback={null}>
            <SceneCanvas onReady={handleReady} onContextLost={handleFailed} />
          </Suspense>
        </SceneErrorBoundary>
      )}

      <main ref={scrollRef} className="content">
        {status === 'failed' && <WebGLFallback />}
        <ChapterSections />
      </main>

      <Hud />
      {status !== 'failed' && <LoadingOverlay visible={status === 'loading'} />}
    </>
  )
}
