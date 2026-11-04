import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'

/** Renders the whole app at a given route with clean storage. */
export function renderApp(hash = '#/tasks') {
  window.localStorage.clear()
  window.location.hash = hash
  const user = userEvent.setup()
  const utils = render(<App />)
  return { user, ...utils }
}
