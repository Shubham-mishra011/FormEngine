import { useRef } from 'react'
import { Environment, Lightformer } from '@react-three/drei'
import type { DirectionalLight, Mesh } from 'three'
import { PlaceholderObject } from './PlaceholderObject'
import { ScrollRig } from './ScrollRig'

/**
 * Lighting is intentionally minimal: a procedural studio environment (three
 * soft strips, no downloaded HDR files) for chrome reflections, plus one key
 * light. Intensities are animated by ScrollRig.
 */
export function Scene() {
  const objectRef = useRef<Mesh>(null)
  const keyLightRef = useRef<DirectionalLight>(null)

  return (
    <>
      <color attach="background" args={['#000000']} />

      <Environment resolution={256}>
        <Lightformer form="rect" intensity={4} position={[0, 5, -6]} scale={[12, 2, 1]} />
        <Lightformer
          form="rect"
          intensity={2}
          position={[-6, 0, 2]}
          rotation-y={Math.PI / 2}
          scale={[8, 2, 1]}
        />
        <Lightformer
          form="rect"
          intensity={2}
          position={[6, 0, 2]}
          rotation-y={-Math.PI / 2}
          scale={[8, 2, 1]}
        />
      </Environment>

      <directionalLight ref={keyLightRef} position={[3, 4, 5]} color="#e8ebf0" />

      <PlaceholderObject ref={objectRef} />
      <ScrollRig objectRef={objectRef} keyLightRef={keyLightRef} />
    </>
  )
}
