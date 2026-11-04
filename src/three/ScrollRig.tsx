import { useEffect, type RefObject } from 'react'
import { useThree } from '@react-three/fiber'
import { Vector3, type DirectionalLight, type Mesh } from 'three'
import { chapters } from '../animation/chapters'
import { createMasterTimeline } from '../animation/masterTimeline'
import { getProgress, subscribeProgress } from '../scroll/scrollState'

interface ScrollRigProps {
  objectRef: RefObject<Mesh | null>
  keyLightRef: RefObject<DirectionalLight | null>
}

const look = new Vector3()

/**
 * Connects scroll progress to the 3D scene. On every progress change it
 * seeks the master timeline, writes the resulting pose to the camera, object
 * and lights, and requests exactly one render. Nothing here uses React state
 * or a per-frame loop, so the canvas is idle when the user is not scrolling.
 */
export function ScrollRig({ objectRef, keyLightRef }: ScrollRigProps) {
  const camera = useThree((state) => state.camera)
  const getState = useThree((state) => state.get)
  const invalidate = useThree((state) => state.invalidate)
  const width = useThree((state) => state.size.width)
  const height = useThree((state) => state.size.height)

  useEffect(() => {
    const rig = { ...chapters[0].pose }
    const timeline = createMasterTimeline(rig)

    // On portrait screens, pull the camera back so the subject stays framed.
    const aspect = width / height
    const fit = aspect < 1 ? 1 + (1 - aspect) * 0.9 : 1

    const render = () => {
      timeline.progress(getProgress())

      look.set(rig.lookX, rig.lookY, rig.lookZ)
      camera.position.set(
        look.x + (rig.camX - look.x) * fit,
        look.y + (rig.camY - look.y) * fit,
        look.z + (rig.camZ - look.z) * fit,
      )
      camera.lookAt(look)

      const object = objectRef.current
      if (object) {
        object.position.set(rig.objX, rig.objY, rig.objZ)
        object.rotation.set(rig.rotX, rig.rotY, rig.rotZ)
        object.scale.setScalar(rig.scale)
      }
      if (keyLightRef.current) keyLightRef.current.intensity = rig.key
      getState().scene.environmentIntensity = rig.env

      invalidate()
    }

    render()
    const unsubscribe = subscribeProgress(render)

    return () => {
      unsubscribe()
      timeline.kill()
    }
  }, [camera, getState, invalidate, objectRef, keyLightRef, width, height])

  return null
}
