import { z } from 'zod'

// E.164: `+` followed by 8–15 digits. Loose enough to accept all real numbers
// without enforcing country-specific length rules. Empty string → null.
const e164Regex = /^\+[1-9]\d{7,14}$/

export const notificationPrefsSchema = z.object({
  notify_whatsapp_e164: z
    .string()
    .trim()
    .refine((v) => v === '' || e164Regex.test(v), {
      message: 'Use E.164 format, e.g. +61416104718',
    })
    .transform((v) => (v === '' ? null : v))
    .nullable(),
  notify_warm_replies: z.boolean(),
  notify_quiet_hours_start: z.number().int().min(0).max(23).nullable(),
  notify_quiet_hours_end: z.number().int().min(0).max(24).nullable(),
})

export type NotificationPrefsValues = z.infer<typeof notificationPrefsSchema>
