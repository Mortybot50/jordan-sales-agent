import { StrictMode } from 'react'
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="App">
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)

// React-mounted signal for the index.html error overlay (Wave 3A-B, Codex
// review v2 PR #45 [P2] residual). The overlay's 5s timer previously fired
// false positives on slow networks because the window included bundle
// download time. The flag lets the overlay hide instantly the moment React
// commits its first render, regardless of network speed.
//
// Set AFTER createRoot().render() returns. React 18 schedules render
// synchronously inside microtasks, so by the time this line executes the
// first commit is queued — index.html's timer is the one that observes the
// flag, and it only fires after the bundle has already executed.
declare global {
  interface Window {
    __leadflow_react_mounted__?: boolean
  }
}
window.__leadflow_react_mounted__ = true
