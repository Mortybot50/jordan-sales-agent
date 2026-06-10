import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

// Recovery-flag → banner message. Set by useAuth when it routes the user back
// to /login after a corrupt cached token (`?reset=1`) or a persistent
// session-restore failure (`?error=auth-init-failed`). Without these banners
// the user lands on a blank-feeling /login with no explanation of why their
// previous session evaporated.
function recoveryBanner(params: URLSearchParams): string | null {
  if (params.get('reset') === '1') {
    return 'Your session expired — please sign in again.'
  }
  if (params.get('error') === 'auth-init-failed') {
    return 'We couldn’t restore your session. Please sign in again.'
  }
  return null
}

export function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // no defaultValue — see brief 2026-06-09 (demo creds prefill explicitly out)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const banner = recoveryBanner(searchParams)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    setLoading(false)

    if (authError) {
      if (
        authError.message.toLowerCase().includes('invalid') ||
        authError.message.toLowerCase().includes('credentials')
      ) {
        setError('Incorrect email or password. Please try again.')
      } else {
        setError(authError.message)
      }
      return
    }

    navigate('/dashboard')
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Brand header */}
        <div className="text-center space-y-1">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-primary-foreground text-lg font-bold mb-2">
            LF
          </div>
          <h1 className="text-2xl font-bold tracking-tight">LeadFlow</h1>
          <p className="text-sm text-muted-foreground">Jordan's Sales Agent</p>
        </div>

        <Card>
          <CardHeader className="pb-2 pt-5">
            <h2 className="text-base font-semibold">Sign in to your account</h2>
          </CardHeader>
          <CardContent className="pb-5">
            {banner && (
              <p
                role="status"
                className="mb-4 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900"
              >
                {banner}
              </p>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  disabled={loading}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>

              {error && (
                <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Need access?{' '}
          <span className="text-foreground font-medium">Contact your admin to get an account.</span>
        </p>
      </div>
    </div>
  )
}
