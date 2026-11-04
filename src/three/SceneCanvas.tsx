import { Canvas } from '@react-three/fiber'
import { Scene } from './Scene'

interface SceneCanvasProps {
  onReady: () => void
  onContextLost: () => void
}

// Cap pixel ratio: lower on touch devices, where fill-rate is the bottleneck.
const MAX_DPR = window.matchMedia('(pointer: coarse)').matches ? 1.5 : 2

/**
 * The one persistent, full-viewport canvas. `frameloop="demand"` means it
 * only renders when something calls invalidate() (the scroll rig, a resize),
 * so it costs almost nothing while the page is still.
 */
export function SceneCanvas({ onReady, onContextLost }: SceneCanvasProps) {
  return (
    <div className="stage" aria-hidden="true">
      <Canvas
        frameloop="demand"
        dpr={[1, MAX_DPR]}
        camera={{ fov: 40, near: 0.1, far: 50, position: [0, 0.2, 7.5] }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener('webglcontextlost', (event) => {
            event.preventDefault()
            onContextLost()
          })
          requestAnimationFrame(onReady)
        }}
      >
        <Scene />
      </Canvas>
    </div>
  )
}
