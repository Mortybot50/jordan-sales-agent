import { z } from 'zod'

// Matches the brand_key CHECK constraint on email_signature_templates.
export const brandKeySchema = z.enum(['purezza', 'culligan_zip'])

export const signatureFormSchema = z.object({
  brand_key: brandKeySchema,
  body_text: z.string().min(1, 'Signature cannot be empty').max(4000, 'Signature too long'),
  body_html: z.string().max(8000, 'Signature HTML too long').optional(),
})

export type BrandKey = z.infer<typeof brandKeySchema>
export type SignatureFormValues = z.infer<typeof signatureFormSchema>

export const BRAND_LABELS: Record<BrandKey, string> = {
  purezza: 'Purezza',
  culligan_zip: 'Culligan / Zip',
}
