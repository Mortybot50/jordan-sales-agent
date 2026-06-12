import { useEffect, useRef, useState } from 'react'
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

// Matches the GoTrue resend throttle (smtp_max_frequency = 60s server-side).
const RESEND_COOLDOWN_S = 60

// Neutral by design: the same line shows whether the address has an account
// or not (signInWithOtp with shouldCreateUser: false returns "Signups not
// allowed" for unknown emails — surfacing that would let anyone probe which
// addresses exist).
const CODE_SENT_NEUTRAL =
  'If that address has an account, a code is on its way. Check your inbox.'

function isUnknownEmailError(message: string): boolean {
  return message.toLowerCase().includes('signups not allowed')
}

function friendlySendError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('rate limit') || m.includes('after') || m.includes('seconds')) {
    return 'Please wait a moment before requesting another code.'
  }
  return 'We couldn’t send the code just now. Please try again in a minute.'
}

function friendlyVerifyError(message: string): string {
  const m = message.toLowerCase()
  // GoTrue deliberately returns one combined message for wrong AND expired
  // codes ("Token has expired or is invalid") — don't tell the user it
  // expired when they most likely just mistyped it.
  if (m.includes('expired or is invalid')) {
    return 'That code didn’t work — it may have expired. Check the digits or request a new one.'
  }
  if (m.includes('expired')) {
    return 'That code has expired — request a new one below.'
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Too many tries — request a new code.'
  }
  if (m.includes('invalid') || m.includes('not found') || m.includes('token')) {
    return 'That code didn’t work. Check the digits and try again.'
  }
  return message
}

type Step = 'email' | 'code' | 'password'

export function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // Email lives in component state only — never in localStorage — so the
  // auth-recovery `sb-*` storage wipe can fire mid-flow without losing it.
  // no defaultValue — see brief 2026-06-09 (demo creds prefill explicitly out)
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  const codeInputRef = useRef<HTMLInputElement>(null)
  const banner = recoveryBanner(searchParams)

  useEffect(() => {
    if (resendIn <= 0) return
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1_000)
    return () => clearInterval(t)
  }, [resendIn])

  useEffect(() => {
    if (step === 'code') codeInputRef.current?.focus()
  }, [step])

  async function requestCode(): Promise<void> {
    setError(null)
    setLoading(true)
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    })
    setLoading(false)

    if (otpError && !isUnknownEmailError(otpError.message)) {
      setError(friendlySendError(otpError.message))
      return
    }
    // Unknown email falls through to the neutral success line on purpose.
    setInfo(CODE_SENT_NEUTRAL)
    setCode('')
    setStep('code')
    setResendIn(RESEND_COOLDOWN_S)
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    await requestCode()
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code,
      type: 'email',
    })
    setLoading(false)

    if (verifyError) {
      setError(friendlyVerifyError(verifyError.message))
      return
    }
    navigate('/dashboard')
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
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

  function switchStep(next: Step) {
    setStep(next)
    setError(null)
    setInfo(null)
    setCode('')
    setPassword('')
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
            <h2 className="text-base font-semibold">
              {step === 'code' ? 'Enter your code' : 'Sign in to your account'}
            </h2>
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

            {step === 'email' && (
              <form onSubmit={handleEmailSubmit} className="space-y-4">
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
                <p className="text-xs text-muted-foreground">
                  We’ll email you a 6-digit code — no password needed.
                </p>

                {error && (
                  <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                    {error}
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Sending code…' : 'Send code'}
                </Button>

                <button
                  type="button"
                  onClick={() => switchStep('password')}
                  className="w-full text-center text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  Sign in with password instead
                </button>
              </form>
            )}

            {step === 'code' && (
              <form onSubmit={handleCodeSubmit} className="space-y-4">
                {info && (
                  <p
                    role="status"
                    className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-900"
                  >
                    {info}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  Sent to <span className="font-medium text-foreground">{email.trim()}</span>
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="otp-code">6-digit code</Label>
                  <Input
                    id="otp-code"
                    ref={codeInputRef}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="text-center text-lg tracking-[0.5em] font-mono"
                    disabled={loading}
                  />
                </div>

                {error && (
                  <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                    {error}
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
                  {loading ? 'Checking…' : 'Sign in'}
                </Button>

                <div className="flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => switchStep('email')}
                    className="text-muted-foreground hover:text-foreground underline underline-offset-2"
                  >
                    Use a different email
                  </button>
                  <button
                    type="button"
                    onClick={() => void requestCode()}
                    disabled={loading || resendIn > 0}
                    className="text-muted-foreground hover:text-foreground underline underline-offset-2 disabled:no-underline disabled:cursor-default disabled:opacity-60"
                  >
                    {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
                  </button>
                </div>
              </form>
            )}

            {step === 'password' && (
              <form onSubmit={handlePasswordSubmit} className="space-y-4">
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

                <button
                  type="button"
                  onClick={() => switchStep('email')}
                  className="w-full text-center text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  Email me a code instead
                </button>
              </form>
            )}
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
