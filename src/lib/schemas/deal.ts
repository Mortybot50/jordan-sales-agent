import { z } from 'zod'

export const dealFormSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  contact_id: z.string().uuid().optional(),
  stage_id: z.string().uuid('Stage is required'),
  contract_value: z.number().min(0, 'Value must be positive'),
  follow_up_due: z.string().optional(),
  notes: z.string().optional(),
})

export const dealEditSchema = dealFormSchema

export type DealFormValues = z.infer<typeof dealFormSchema>
