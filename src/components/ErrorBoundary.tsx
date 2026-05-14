import { Component, type ReactNode, type ErrorInfo } from 'react'

interface ErrorBoundaryProps {
  /** Children to render when no error has been caught. */
  children: ReactNode
  /**
   * Optional human label rendered above the error message so users know which
   * screen failed (e.g. "Booking page"). Defaults to a generic message.
   */
  label?: string
  /**
   * Optional reset-key. When this changes (e.g. on route change), the boundary
   * clears its error state so a healthy retry can render. Useful for per-route
   * boundaries where navigating away should escape the failure surface.
   */
  resetKey?: string | number
}

interface ErrorBoundaryState {
  error: Error | null
  componentStack: string | null
}

/**
 * Route-level React error boundary.
 *
 * Per audit FE-P1-05, the previous root-only boundary blanked the whole app
 * — including /login and the public /book, /privacy, /unsubscribe pages —
 * when any single screen threw. This boundary is designed to be mounted
 * per top-level route or per public page so a Dashboard crash never takes
 * down /book/:slug.
 *
 * Implements componentDidCatch so the React-supplied componentStack is
 * captured (previous root boundary dropped it).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null, componentStack: null }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null })
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', this.props.label ?? 'route', error, info.componentStack)
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.error &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ error: null, componentStack: null })
    }
  }

  render(): ReactNode {
    const { error, componentStack } = this.state
    if (!error) return this.props.children

    const heading = this.props.label
      ? `${this.props.label} failed to render`
      : 'Something went wrong'

    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          background: '#0f172a',
          color: '#f8fafc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
        }}
      >
        <div style={{ maxWidth: 640, width: '100%', textAlign: 'center' as const }}>
          <h1 style={{ color: '#f87171', fontFamily: 'sans-serif', marginBottom: '1rem' }}>
            {heading}
          </h1>
          <p style={{ color: '#94a3b8', fontFamily: 'sans-serif', marginBottom: '1.5rem' }}>
            Refresh the page. If the problem persists, contact support.
          </p>
          {import.meta.env.DEV && (
            <pre
              style={{
                background: '#1e293b',
                padding: '1.5rem',
                borderRadius: 8,
                fontFamily: 'monospace',
                fontSize: 13,
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: '#fbbf24',
                margin: '0 0 1.5rem',
                textAlign: 'left' as const,
              }}
            >
              {error.message}
              {error.stack ? '\n\n' + error.stack : ''}
              {componentStack ? '\n\nComponent stack:' + componentStack : ''}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              padding: '0.5rem 1.25rem',
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: 'sans-serif',
              fontSize: 14,
            }}
          >
            Reload page
          </button>
        </div>
      </div>
    )
  }
}
