import { StrictMode, Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

interface ErrorBoundaryState { error: Error | null }

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    const { error } = this.state
    if (error) {
      return (
        <div style={{
          minHeight: '100vh', background: '#0f172a', color: '#f8fafc',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem',
        }}>
          <div style={{ maxWidth: 640, width: '100%' }}>
            <h1 style={{ color: '#f87171', fontFamily: 'sans-serif', marginBottom: '1rem' }}>
              Application Error
            </h1>
            <pre style={{
              background: '#1e293b', padding: '1.5rem', borderRadius: 8,
              fontFamily: 'monospace', fontSize: 13, overflowX: 'auto',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              color: '#fbbf24', margin: 0,
            }}>
              {error.message}
              {error.stack ? '\n\n' + error.stack : ''}
            </pre>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
