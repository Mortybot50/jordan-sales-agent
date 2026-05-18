/**
 * email-accounts — TanStack Query hooks for the LeadFlow native sender.
 *
 * The list/select side is plain Supabase (RLS scopes to caller's org_id).
 * The save side goes through `/api/email-accounts/save` (Vercel API route)
 * because the SMTP password must be encrypted server-side with
 * TOKEN_ENCRYPTION_KEY — that key never reaches the browser.
 *
 * Types here are hand-written (not generated) because the database.ts
 * regen hasn't been run since the email_accounts migration landed.
 * Keep them in sync with `supabase/migrations/20260519000001_*.sql`.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

export type EmailAccountStatus =
  | 'active'
  | 'paused'
  | 'warming'
  | 'bounced_recently'

export type EmailAccountBrand = 'purezza' | 'culligan' | 'zip' | null
export type EmailAccountSegment = 'hospitality' | 'office' | 'trade' | null

/** Row shape returned from /select — INTENTIONALLY excludes the password ciphertext. */
export interface EmailAccount {
  id: string
  org_id: string
  user_id: string
  email_address: string
  domain: string | null
  display_name: string | null
  smtp_host: string
  smtp_port: number
  smtp_username: string
  send_signature: string | null
  reply_to_address: string | null
  daily_send_cap: number
  status: EmailAccountStatus
  brand: EmailAccountBrand
  icp_segment: EmailAccountSegment
  reputation_score: number | null
  last_send_at: string | null
  last_bounce_at: string | null
  last_warmup_send_at: string | null
  created_at: string
  updated_at: string
}

/** Payload for the save endpoint. `id` set → update; omit → insert. */
export interface SaveEmailAccountPayload {
  id?: string
  email_address?: string
  display_name?: string | null
  smtp_host?: string
  smtp_port?: number
  smtp_username?: string
  /** Plaintext — encrypted server-side. Omit on edit to keep existing. */
  smtp_password?: string
  reply_to_address?: string | null
  send_signature?: string | null
  daily_send_cap?: number
  brand?: EmailAccountBrand | ''
  icp_segment?: EmailAccountSegment | ''
  status?: EmailAccountStatus
}

const SELECT_COLUMNS =
  'id, org_id, user_id, email_address, domain, display_name, smtp_host, smtp_port, smtp_username, send_signature, reply_to_address, daily_send_cap, status, brand, icp_segment, reputation_score, last_send_at, last_bounce_at, last_warmup_send_at, created_at, updated_at'

/** List all email_accounts visible to the caller (RLS-scoped to org). */
export function useEmailAccounts() {
  return useQuery({
    queryKey: ['email-accounts'],
    queryFn: async (): Promise<EmailAccount[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('email_accounts')
        .select(SELECT_COLUMNS)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as EmailAccount[]
    },
  })
}

async function callSaveApi(payload: SaveEmailAccountPayload): Promise<EmailAccount> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not signed in')

  const res = await fetch('/api/email-accounts/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(body?.error ?? `Save failed (${res.status})`)
  }
  return body.account as EmailAccount
}

export function useSaveEmailAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: callSaveApi,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-accounts'] })
      toast.success('Inbox saved')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useDeleteEmailAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('email_accounts')
        .delete()
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-accounts'] })
      toast.success('Inbox deleted')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

/**
 * Trigger a test send via the send-via-smtp Edge Function (mode='test').
 * Sends from the inbox TO the inbox itself — no contacts touched.
 */
export function useTestEmailAccountConnection() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('send-via-smtp', {
        body: { mode: 'test', email_account_id: id },
      })
      if (error) throw new Error(error.message)
      const result = data as { success?: boolean; error?: string }
      if (!result?.success) {
        throw new Error(result?.error ?? 'SMTP test failed')
      }
      return result
    },
    onSuccess: () => toast.success('Test email sent — check the inbox'),
    onError: (err: Error) => toast.error(`SMTP test failed: ${err.message}`),
  })
}
