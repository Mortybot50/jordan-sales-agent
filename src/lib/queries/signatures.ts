import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { BrandKey } from '@/lib/schemas/signatures'

// `email_signature_templates` was added in migration 20260526120000 and isn't
// in the generated Database types yet — cast to an untyped client until the
// next `supabase gen types typescript` regen. Same pattern as queries/notifications.ts.
const sb = supabase as unknown as SupabaseClient

export interface SignatureTemplate {
  id: string
  org_id: string
  user_id: string
  brand_key: BrandKey
  body_text: string
  body_html: string
  created_at: string
  updated_at: string
}

export function useSignatures(userId: string | undefined) {
  return useQuery({
    queryKey: ['signatures', userId ?? null],
    queryFn: async (): Promise<SignatureTemplate[]> => {
      if (!userId) return []
      const { data, error } = await sb
        .from('email_signature_templates')
        .select('id, org_id, user_id, brand_key, body_text, body_html, created_at, updated_at')
        .eq('user_id', userId)
      if (error) throw error
      return (data ?? []) as SignatureTemplate[]
    },
    enabled: !!userId,
  })
}

export function useUpsertSignature() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      user_id: string
      org_id: string
      brand_key: BrandKey
      body_text: string
      body_html: string
    }) => {
      // Upsert by (user_id, brand_key) — matches the UNIQUE constraint.
      const { data, error } = await sb
        .from('email_signature_templates')
        .upsert(
          {
            user_id: input.user_id,
            org_id: input.org_id,
            brand_key: input.brand_key,
            body_text: input.body_text,
            body_html: input.body_html,
          },
          { onConflict: 'user_id,brand_key' },
        )
        .select()
        .single()
      if (error) throw error
      return data as SignatureTemplate
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['signatures'] })
      toast.success('Signature saved')
    },
    onError: (err: Error) => toast.error(`Save failed: ${err.message}`),
  })
}
