import { forwardRef } from 'react'
import type { Mesh } from 'three'

/**
 * TEMPORARY. A plain chrome icosahedron used only to prove the scroll/camera
 * architecture. It is not the cheetah and will be removed.
 */
export const PlaceholderObject = forwardRef<Mesh>(function PlaceholderObject(_props, ref) {
  return (
    <mesh ref={ref}>
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial color="#c9ccd1" metalness={1} roughness={0.18} flatShading />
    </mesh>
  )
})
