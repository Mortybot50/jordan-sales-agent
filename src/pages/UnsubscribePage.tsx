import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'

type State =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; email: string }
  | { kind: 'error'; message: string }

const BRAND = 'LeadFlow'

function isValidEmailShape(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function UnsubscribePage() {
  const [params] = useSearchParams()
  const queryEmail = (params.get('email') ?? '').trim().toLowerCase()
  const queryToken = (params.get('token') ?? '').trim()
  const hasSignedLink = useMemo(
    () => queryEmail.length > 0 && queryToken.length > 0,
    [queryEmail, queryToken],
  )

  const [emailInput, setEmailInput] = useState(queryEmail)
  const [state, setState] = useState<State>({ kind: 'idle' })

  useEffect(() => {
    document.title = `Unsubscribe — ${BRAND}`
    return () => {
      document.title = BRAND
    }
  }, [])

  // Auto-submit when arriving with a signed link.
  useEffect(() => {
    if (!hasSignedLink) return
    if (state.kind !== 'idle') return
    void submit(queryEmail, queryToken)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSignedLink])

  async function submit(email: string, token: string | null) {
    setState({ kind: 'submitting' })
    try {
      const res = await fetch('/api/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token: token ?? '' }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        setState({
          kind: 'error',
          message: data?.error ?? 'Something went wrong. Please try again.',
        })
        return
      }
      setState({ kind: 'success', email })
    } catch {
      setState({
        kind: 'error',
        message: 'Network error — please try again in a moment.',
      })
    }
  }

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    const email = emailInput.trim().toLowerCase()
    if (!isValidEmailShape(email)) {
      setState({ kind: 'error', message: 'Please enter a valid email address.' })
      return
    }
    void submit(email, null)
  }

  const showInvalidLinkBanner =
    hasSignedLink && state.kind === 'error' && /token|invalid/i.test(state.message)

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-hairline">
        <div className="mx-auto max-w-2xl px-4 py-5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-primary text-primary-foreground text-sm font-bold">
              L
            </div>
            <span className="text-base font-bold tracking-tight">{BRAND}</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
        {state.kind === 'success' ? (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-emerald-50 text-emerald-600">
                  <CheckCircle2 className="w-5 h-5" />
                </span>
                <CardTitle className="text-xl">You've been unsubscribed</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                <span className="font-mono text-foreground">{state.email}</span> has been removed
                from {BRAND}'s outbound list. We'll never email you again.
              </p>
              <p>
                If you receive another message after the next 24 hours, please reply with
                "unsubscribe" and we'll investigate immediately.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Unsubscribe from {BRAND} emails</CardTitle>
              <p className="text-sm text-muted-foreground">
                Confirm your email below and we'll add you to our suppression list. This is
                permanent — we honour Spam Act 2003 unsubscribe requests in full.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {showInvalidLinkBanner && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    This unsubscribe link looks invalid or expired. You can still unsubscribe by
                    submitting your email manually below.
                  </span>
                </div>
              )}

              {state.kind === 'submitting' && hasSignedLink && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing your unsubscribe…
                </div>
              )}

              <form onSubmit={handleManualSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="unsub-email">Email address</Label>
                  <Input
                    id="unsub-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    disabled={state.kind === 'submitting'}
                    required
                  />
                </div>

                {state.kind === 'error' && !showInvalidLinkBanner && (
                  <p className="text-xs text-destructive">{state.message}</p>
                )}

                <div className="flex justify-end">
                  <Button type="submit" disabled={state.kind === 'submitting'}>
                    {state.kind === 'submitting' && !hasSignedLink ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                        Unsubscribing…
                      </>
                    ) : (
                      'Unsubscribe me'
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <p className="mt-6 text-xs text-muted-foreground text-center">
          Questions? Read our{' '}
          <Link to="/privacy" className="underline hover:text-foreground">
            privacy policy
          </Link>
          .
        </p>
      </main>
    </div>
  )
}
