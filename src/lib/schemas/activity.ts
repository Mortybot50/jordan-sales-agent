import { z } from 'zod'

export const activityFormSchema = z.object({
  activity_type: z.enum(['call_note', 'meeting_note', 'note', 'email_outbound']),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().optional(),
  occurred_at: z.string().optional(),
})

export type ActivityFormValues = z.infer<typeof activityFormSchema>
