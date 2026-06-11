import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { contactFormSchema, type ContactFormValues } from '@/lib/schemas/contact'
import { useCreateContact } from '@/lib/queries/contacts'
import { useCreateVenue, useVenues } from '@/lib/queries/venues'
import { useAuth } from '@/hooks/useAuth'
import { venueTypeLabel, cn } from '@/lib/utils'
import { Textarea } from '@/components/ui/textarea'
import { ArrowLeft } from 'lucide-react'
import { SuburbAutocomplete } from '@/components/venues/SuburbAutocomplete'

const VENUE_TYPES = [
  'restaurant', 'cafe', 'hotel', 'event_space', 'bar',
  'club', 'pub', 'qsr', 'function_centre', 'other',
] as const

export function ContactNewPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const createContact = useCreateContact()
  const createVenue = useCreateVenue()
  const { data: venues } = useVenues()

  const [venueMode, setVenueMode] = useState<'existing' | 'new'>('existing')
  const [venueSearch, setVenueSearch] = useState('')

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      linkedin_url: '',
    },
  })

  const { register, handleSubmit, formState: { errors, isSubmitting }, setValue, watch } = form

  const filteredVenues = venues?.filter((v) =>
    v.name.toLowerCase().includes(venueSearch.toLowerCase())
  ) ?? []

  async function onSubmit(values: ContactFormValues) {
    if (!user) return

    let venueId: string | undefined

    if (venueMode === 'new' && values.new_venue) {
      const coverCount = values.new_venue.cover_count
      const validCoverCount =
        typeof coverCount === 'number' && !Number.isNaN(coverCount) ? coverCount : undefined
      const venue = await createVenue.mutateAsync({
        org_id: user.org_id,
        name: values.new_venue.name,
        venue_type: values.new_venue.venue_type,
        address: values.new_venue.address,
        suburb: values.new_venue.suburb,
        state: values.new_venue.state,
        postcode: values.new_venue.postcode,
        website: values.new_venue.website || undefined,
        cover_count: validCoverCount,
      })
      venueId = venue.id
    } else if (venueMode === 'existing' && values.venue_id) {
      venueId = values.venue_id
    }

    const contact = await createContact.mutateAsync({
      org_id: user.org_id,
      first_name: values.first_name,
      last_name: values.last_name,
      role: values.role,
      email: values.email || undefined,
      phone: values.phone || undefined,
      linkedin_url: values.linkedin_url || undefined,
      notes: values.notes || undefined,
      venue_id: venueId,
    })

    navigate(`/contacts/${contact.id}`)
  }

  function onInvalid(formErrors: FieldErrors<ContactFormValues>) {
    const firstError = Object.entries(formErrors)[0]
    if (firstError) {
      const [field, err] = firstError
      const message = (err as { message?: string })?.message ?? 'Invalid value'
      toast.error('Cannot save — check the form', {
        description: `${field}: ${message}`,
      })
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-2xl">
      <button
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => navigate('/contacts')}
        type="button"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to contacts
      </button>

      <div>
        <h1 className="text-2xl font-semibold">New Contact</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Add a contact and optionally link or create their venue.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-6">
        {Object.keys(errors).length > 0 && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            Please fix the highlighted fields before saving. ({Object.keys(errors).length} issue
            {Object.keys(errors).length === 1 ? '' : 's'})
          </div>
        )}
        {/* Name */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Personal Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="first_name">First name *</Label>
                <Input
                  id="first_name"
                  {...register('first_name')}
                  placeholder="Jordan"
                  className={cn(errors.first_name && 'border-destructive')}
                />
                {errors.first_name && (
                  <p className="text-xs text-destructive">{errors.first_name.message}</p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="last_name">Last name *</Label>
                <Input
                  id="last_name"
                  {...register('last_name')}
                  placeholder="Smith"
                  className={cn(errors.last_name && 'border-destructive')}
                />
                {errors.last_name && (
                  <p className="text-xs text-destructive">{errors.last_name.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label>Role</Label>
              <Select
                value={watch('role') ?? ''}
                onValueChange={(v) => setValue('role', v as ContactFormValues['role'])}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="venue_manager">Venue Manager</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                  <SelectItem value="f_b_director">F&B Director</SelectItem>
                  <SelectItem value="head_chef">Head Chef</SelectItem>
                  <SelectItem value="events_manager">Events Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  {...register('email')}
                  placeholder="jordan@thevenue.com.au"
                  className={cn(errors.email && 'border-destructive')}
                />
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  {...register('phone')}
                  placeholder="0400 000 000"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="linkedin_url">LinkedIn URL</Label>
              <Input
                id="linkedin_url"
                type="url"
                {...register('linkedin_url')}
                placeholder="https://linkedin.com/in/…"
                className={cn(errors.linkedin_url && 'border-destructive')}
              />
              {errors.linkedin_url && (
                <p className="text-xs text-destructive">{errors.linkedin_url.message}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                {...register('notes')}
                rows={3}
                placeholder="Key context, past interactions, intro source…"
              />
            </div>
          </CardContent>
        </Card>

        {/* Venue */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Venue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Toggle */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setVenueMode('existing')}
                className={cn(
                  'flex-1 py-2 px-3 rounded-lg text-sm border transition-colors',
                  venueMode === 'existing'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-input hover:bg-accent'
                )}
              >
                Select existing
              </button>
              <button
                type="button"
                onClick={() => setVenueMode('new')}
                className={cn(
                  'flex-1 py-2 px-3 rounded-lg text-sm border transition-colors',
                  venueMode === 'new'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-input hover:bg-accent'
                )}
              >
                Create new
              </button>
            </div>

            {venueMode === 'existing' && (
              <div className="space-y-2">
                <Input
                  placeholder="Search venues…"
                  value={venueSearch}
                  onChange={(e) => setVenueSearch(e.target.value)}
                  className="h-8 text-sm"
                />
                <div className="border rounded-lg max-h-48 overflow-y-auto divide-y">
                  {filteredVenues.length === 0 && (
                    <p className="text-sm text-muted-foreground px-3 py-4 text-center">
                      {venueSearch ? 'No venues match.' : 'No venues yet. Create one above.'}
                    </p>
                  )}
                  {filteredVenues.map((venue) => (
                    <label
                      key={venue.id}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-accent cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="venue_id"
                        value={venue.id}
                        checked={watch('venue_id') === venue.id}
                        onChange={() => setValue('venue_id', venue.id)}
                        className="accent-primary"
                      />
                      <div>
                        <p className="text-sm font-medium">{venue.name}</p>
                        {venue.venue_type && (
                          <p className="text-xs text-muted-foreground">
                            {venueTypeLabel(venue.venue_type)}
                            {venue.suburb ? ` · ${venue.suburb}` : ''}
                          </p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {venueMode === 'new' && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Venue name *</Label>
                  <Input
                    {...register('new_venue.name')}
                    placeholder="The Espy"
                    className={cn(errors.new_venue?.name && 'border-destructive')}
                  />
                  {errors.new_venue?.name && (
                    <p className="text-xs text-destructive">{errors.new_venue.name.message}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label>Venue type</Label>
                  <Select
                    value={watch('new_venue.venue_type') ?? ''}
                    onValueChange={(v) =>
                      setValue(
                        'new_venue.venue_type',
                        v as (typeof VENUE_TYPES)[number]
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {VENUE_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {venueTypeLabel(t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Address</Label>
                  <Input
                    {...register('new_venue.address')}
                    placeholder="11 The Esplanade"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <SuburbAutocomplete
                      label="Suburb"
                      value={watch('new_venue.suburb') ?? ''}
                      onChange={(v) =>
                        setValue('new_venue.suburb', v, { shouldValidate: true })
                      }
                      onSelect={({ suburb, state, postcode }) => {
                        setValue('new_venue.suburb', suburb, { shouldValidate: true })
                        if (state) setValue('new_venue.state', state, { shouldValidate: true })
                        if (postcode)
                          setValue('new_venue.postcode', postcode, { shouldValidate: true })
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label
                      htmlFor="new_venue.postcode"
                      className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium"
                    >
                      Postcode
                    </Label>
                    <Input
                      id="new_venue.postcode"
                      {...register('new_venue.postcode')}
                      placeholder="3182"
                      inputMode="numeric"
                    />
                  </div>
                </div>
                <input type="hidden" {...register('new_venue.state')} />
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Website</Label>
                    <Input
                      {...register('new_venue.website')}
                      type="url"
                      placeholder="https://…"
                      className={cn(errors.new_venue?.website && 'border-destructive')}
                    />
                    {errors.new_venue?.website && (
                      <p className="text-xs text-destructive">{errors.new_venue.website.message}</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label>Cover count</Label>
                    <Input
                      type="number"
                      min={1}
                      {...register('new_venue.cover_count', { valueAsNumber: true })}
                      placeholder="120"
                      className={cn(errors.new_venue?.cover_count && 'border-destructive')}
                    />
                    {errors.new_venue?.cover_count && (
                      <p className="text-xs text-destructive">
                        {errors.new_venue.cover_count.message}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => navigate('/contacts')}
          >
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create contact'}
          </Button>
        </div>
      </form>
    </div>
  )
}
