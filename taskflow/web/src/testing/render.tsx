import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { Providers } from '../App'
import type { Settings } from '../useSettings'

/** Renders one page/component inside every app context (store, settings, toasts, focus, task editor). */
export function renderWithProviders(ui: ReactElement, settings?: Partial<Settings>) {
  return render(<Providers settings={settings}>{ui}</Providers>)
}
