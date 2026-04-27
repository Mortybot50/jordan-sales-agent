import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

interface PublicUserProfile {
  public_slug: string | null
  calendly_url: string | null
  full_name: string | null
  email: string | null
}

type PageState = 'loading' | 'found' | 'not_found' | 'no_calendly'

export function BookingPage() {
  const { slug } = useParams<{ slug: string }>()
  const [state, setState] = useState<PageState>('loading')
  const [profile, setProfile] = useState<PublicUserProfile | null>(null)

  useEffect(() => {
    async function load() {
      if (!slug) { setState('not_found'); return }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('public_user_profiles')
        .select('public_slug, calendly_url, full_name, email')
        .eq('public_slug', slug)
        .maybeSingle()

      if (error || !data) {
        setState('not_found')
        return
      }

      const p = data as PublicUserProfile
      setProfile(p)
      setState(p.calendly_url ? 'found' : 'no_calendly')
    }

    void load()
  }, [slug])

  useEffect(() => {
    if (state === 'found' && profile?.full_name) {
      document.title = `Book a call with ${profile.full_name} — LeadFlow`
    } else if (state === 'found') {
      document.title = 'Book a call — LeadFlow'
    } else {
      document.title = 'LeadFlow'
    }
    return () => { document.title = 'LeadFlow' }
  }, [state, profile])

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0f1e' }}>
        <div style={{ color: '#64748b', fontSize: '0.875rem' }}>Loading…</div>
      </div>
    )
  }

  if (state === 'not_found') return <NotFoundState slug={slug} />
  if (state === 'no_calendly') return <NoCalendlyState profile={profile} />
  return <BookingView profile={profile!} />
}

function BookingView({ profile }: { profile: PublicUserProfile }) {
  const firstName = profile.full_name?.split(' ')[0] ?? 'Jordan'

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0a0f1e', color: '#f8fafc' }}>
      {/* Hero */}
      <div
        className="px-6 py-12 sm:py-16 text-center"
        style={{ background: '#0f172a', borderBottom: '1px solid #1e293b' }}
      >
        <div className="max-w-xl mx-auto space-y-3">
          <div
            className="inline-flex items-center justify-center w-10 h-10 rounded-xl text-sm font-bold mb-2 tracking-tight"
            style={{ background: 'rgba(255,255,255,0.1)' }}
          >
            LF
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Book a 15-min call with {firstName}
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '1rem', lineHeight: '1.625' }}>
            Let's chat about reducing your hospo water costs and lifting service quality.
            Pick a time that works for you.
          </p>
        </div>
      </div>

      {/* Calendly embed — white background required by Calendly */}
      <div className="flex-1 w-full" style={{ background: '#ffffff' }}>
        <iframe
          src={profile.calendly_url!}
          width="100%"
          style={{ minHeight: '700px', border: 'none', display: 'block' }}
          title={`Book a call with ${profile.full_name ?? 'Jordan'}`}
          loading="lazy"
        />
      </div>

      {/* Footer */}
      <div
        className="py-4 text-center"
        style={{ background: '#0a0f1e', borderTop: '1px solid #1e293b' }}
      >
        <p style={{ fontSize: '0.75rem', color: '#334155' }}>
          Powered by{' '}
          <a href="/" style={{ color: '#475569' }} className="hover:text-slate-400 transition-colors">
            LeadFlow
          </a>
        </p>
      </div>
    </div>
  )
}

function NotFoundState({ slug }: { slug: string | undefined }) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{ background: '#0a0f1e', color: '#f8fafc' }}
    >
      <div className="max-w-sm text-center space-y-4">
        <div
          className="inline-flex items-center justify-center w-10 h-10 rounded-xl text-sm font-bold mb-2 tracking-tight"
          style={{ background: 'rgba(255,255,255,0.1)' }}
        >
          LF
        </div>
        <h1 className="text-2xl font-bold">Page not found</h1>
        <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
          {slug ? (
            <>The booking page <span style={{ color: '#cbd5e1', fontFamily: 'monospace' }}>/book/{slug}</span> doesn't exist.</>
          ) : (
            "This booking page doesn't exist."
          )}
        </p>
        <p style={{ color: '#64748b', fontSize: '0.75rem' }}>
          If you followed a link from an email, it may have expired or been removed.
        </p>
      </div>
      <div className="mt-10">
        <p style={{ fontSize: '0.75rem', color: '#1e293b' }}>Powered by LeadFlow</p>
      </div>
    </div>
  )
}

function NoCalendlyState({ profile }: { profile: PublicUserProfile | null }) {
  const firstName = profile?.full_name?.split(' ')[0] ?? 'Jordan'
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{ background: '#0a0f1e', color: '#f8fafc' }}
    >
      <div className="max-w-sm text-center space-y-4">
        <div
          className="inline-flex items-center justify-center w-10 h-10 rounded-xl text-sm font-bold mb-2 tracking-tight"
          style={{ background: 'rgba(255,255,255,0.1)' }}
        >
          LF
        </div>
        <h1 className="text-2xl font-bold">Booking unavailable</h1>
        <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
          {firstName}'s booking calendar isn't set up yet. Please get in touch directly.
        </p>
      </div>
      <div className="mt-10">
        <p style={{ fontSize: '0.75rem', color: '#1e293b' }}>Powered by LeadFlow</p>
      </div>
    </div>
  )
}
