export function LoadingOverlay({ visible }: { visible: boolean }) {
  return (
    <div className={`loading${visible ? '' : ' loading--hidden'}`} role="status">
      <span className="loading__text">Initializing scene</span>
    </div>
  )
}

/** Shown instead of the 3D scene when WebGL is unavailable or fails. */
export function WebGLFallback() {
  return (
    <div className="fallback" role="alert">
      <p className="fallback__title">The 3D experience is unavailable.</p>
      <p>
        Your browser or device could not start WebGL. The content below is still fully
        readable. Try updating your browser or enabling hardware acceleration.
      </p>
    </div>
  )
}
