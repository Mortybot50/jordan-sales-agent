/**
 * Mints an authenticated Supabase session for the smoke suite and writes it
 * as a Playwright storageState file (localStorage entry the app's auth client
 * reads on boot).
 *
 * Credential sources, in order:
 *   1. env SUPABASE_SERVICE_ROLE_KEY + SUPABASE_ANON_KEY
 *   2. `supabase projects api-keys --project-ref <ref> -o json` (logged-in CLI)
 *
 * Non-destructive: uses admin generate_link (magiclink) + /auth/v1/verify —
 * never touches the operator's password.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PROJECT_REF = 'bsevgxhnxlkzkcalevbb'
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`
const OPERATOR_EMAIL = process.env.SMOKE_EMAIL ?? 'demo@jordan-sales-agent.test'
const STATE_PATH = path.join(__dirname, '.auth-state.json')

function getKeys(): { anon: string; service: string } | null {
  const envAnon = process.env.SUPABASE_ANON_KEY
  const envSvc = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (envAnon && envSvc) return { anon: envAnon, service: envSvc }
  try {
    const out = execFileSync(
      'supabase',
      ['projects', 'api-keys', '--project-ref', PROJECT_REF, '-o', 'json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const keys = JSON.parse(out) as Array<{ name: string; api_key?: string }>
    const anon = keys.find((k) => k.name === 'anon')?.api_key
    const service = keys.find((k) => k.name === 'service_role')?.api_key
    if (anon && service) return { anon, service }
  } catch {
    // fall through
  }
  return null
}

async function post(pathname: string, body: unknown, key: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${SUPABASE_URL}${pathname}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${pathname} → HTTP ${res.status}: ${await res.text()}`)
  return (await res.json()) as Record<string, unknown>
}

export default async function globalSetup(): Promise<void> {
  const baseURL = process.env.SMOKE_BASE_URL ?? 'http://localhost:5173'
  const origin = new URL(baseURL).origin
  const keys = getKeys()

  if (!keys) {
    // No credentials available — write an empty state so storageState loading
    // doesn't fail; authenticated specs detect this and skip themselves.
    writeFileSync(STATE_PATH, JSON.stringify({ cookies: [], origins: [] }))
    console.warn('[global-setup] No Supabase credentials — authenticated smoke specs will skip.')
    return
  }

  const link = await post(
    '/auth/v1/admin/generate_link',
    { type: 'magiclink', email: OPERATOR_EMAIL },
    keys.service,
  )
  const session = await post(
    '/auth/v1/verify',
    { type: 'magiclink', token_hash: link.hashed_token },
    keys.anon,
  )
  if (!session.access_token) throw new Error('Session mint failed — no access_token in verify response')

  const payload = {
    access_token: session.access_token,
    token_type: session.token_type ?? 'bearer',
    expires_in: session.expires_in ?? 3600,
    expires_at:
      session.expires_at ?? Math.floor(Date.now() / 1000) + Number(session.expires_in ?? 3600),
    refresh_token: session.refresh_token,
    user: session.user,
  }

  writeFileSync(
    STATE_PATH,
    JSON.stringify({
      cookies: [],
      origins: [
        {
          origin,
          localStorage: [
            {
              name: `sb-${PROJECT_REF}-auth-token`,
              value: JSON.stringify(payload),
            },
          ],
        },
      ],
    }),
  )
}
