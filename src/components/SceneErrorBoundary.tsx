import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  onError: () => void
}

/**
 * If anything inside the 3D canvas throws (for example WebGL fails to
 * initialise), render nothing and tell the app so it can show the HTML
 * fallback instead of a blank page.
 */
export class SceneErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    this.props.onError()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
