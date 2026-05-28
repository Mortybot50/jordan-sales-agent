// Side-effect import — initialises Sentry before any other module evaluates.
// MUST stay first (ESM hoists imports; this needs to win the eval order).
import './instrumentation'

import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

// Mount-detection timer (Wave 3A-B v2, Codex review v2 PR #45 [P2] residual).
//
// v1 of this lived in index.html and started the 8s clock when the script tag
// executed — which on slow networks included bundle download time, firing
// false-positive red overlays even though React eventually mounted fine.
//
// v2 (this file): the timer starts AFTER the bundle has executed and
// createRoot().render() has been called. A useEffect inside the React tree
// clears the timer on first commit, so any successful first render hides
// the overlay path entirely. 5s is the cap measured from render-attempt,
// not from network start.
let mountTimer: number | undefined

function MountWatcher() {
  useEffect(() => {
    if (mountTimer !== undefined) {
      window.clearTimeout(mountTimer)
      mountTimer = undefined
    }
  }, [])
  return null
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="App">
      <QueryClientProvider client={queryClient}>
        <MountWatcher />
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)

mountTimer = window.setTimeout(() => {
  const root = document.getElementById('root')
  if (root && root.children.length > 0) return
  const overlay = document.getElementById('ppb-error')
  const text = document.getElementById('ppb-error-text')
  if (!overlay || !text) return
  const lines = [
    'TIMEOUT: React did not mount within 5 seconds of bundle execution.',
    'userAgent: ' + navigator.userAgent,
    'localStorage keys: ' + Object.keys(localStorage).join(', '),
  ]
  text.textContent = lines.join('\n\n')
  overlay.style.display = 'block'
}, 5000)
