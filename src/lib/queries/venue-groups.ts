import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

// ── Types ───────────────────────────────────────────────────────────

export interface VenueGroup {
  id: string
  org_id: string
  name: string
  abn: string | null
  notes: string | null
  created_at: string | null
}

/** Row returned by `useVenueGroups` — adds the computed member count. */
export interface VenueGroupWithCount extends VenueGroup {
  member_count: number
}

export interface VenueGroupMemberVenue {
  id: string
  name: string
  venue_type: string | null
  suburb: string | null
}

export interface VenueGroupUpsert {
  name: string
  abn: string | null
  notes: string | null
}

// ── Read hooks ──────────────────────────────────────────────────────

/**
 * List all venue groups for the org with member counts. Two cheap round-trips:
 * the groups themselves, then a per-group count via `venues.group_id` filter.
 * RLS scopes both queries to the current org automatically.
 */
export function useVenueGroups() {
  return useQuery({
    queryKey: ['venue-groups'],
    queryFn: async (): Promise<VenueGroupWithCount[]> => {
      const { data: groups, error } = await supabase
        .from('venue_groups')
        .select('*')
        .order('name', { ascending: true })
      if (error) throw error
      const rows = (groups ?? []) as VenueGroup[]
      if (rows.length === 0) return []

      // Pull every venue.group_id in scope and tally client-side. One round-trip
      // beats N+1 head-counts when there are >5 groups; org-scoped venues fit
      // comfortably in memory at Jordan's scale.
      const { data: members, error: mErr } = await supabase
        .from('venues')
        .select('group_id')
        .not('group_id', 'is', null)
      if (mErr) throw mErr

      const counts: Record<string, number> = {}
      for (const m of members ?? []) {
        const gid = (m as { group_id: string | null }).group_id
        if (gid) counts[gid] = (counts[gid] ?? 0) + 1
      }

      return rows.map((g) => ({ ...g, member_count: counts[g.id] ?? 0 }))
    },
  })
}

/** Detail query — single group + its member venues. */
export function useVenueGroup(id: string | null) {
  return useQuery({
    queryKey: ['venue-groups', id],
    queryFn: async (): Promise<{
      group: VenueGroup
      members: VenueGroupMemberVenue[]
    } | null> => {
      if (!id) return null
      const { data: group, error } = await supabase
        .from('venue_groups')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      if (!group) return null

      const { data: members, error: mErr } = await supabase
        .from('venues')
        .select('id, name, venue_type, suburb')
        .eq('group_id', id)
        .order('name', { ascending: true })
      if (mErr) throw mErr

      return {
        group: group as VenueGroup,
        members: (members ?? []) as VenueGroupMemberVenue[],
      }
    },
    enabled: !!id,
  })
}

// ── Mutations ───────────────────────────────────────────────────────

export function useCreateVenueGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      org_id,
      payload,
    }: {
      org_id: string
      payload: VenueGroupUpsert
    }): Promise<{ id: string }> => {
      const { data, error } = await supabase
        .from('venue_groups')
        .insert({
          org_id,
          name: payload.name,
          abn: payload.abn,
          notes: payload.notes,
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['venue-groups'] })
      toast.success('Group created')
    },
    onError: (err: Error) =>
      toast.error(`Couldn't create group: ${err.message}`),
  })
}

export function useUpdateVenueGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string
      payload: VenueGroupUpsert
    }) => {
      const { error } = await supabase
        .from('venue_groups')
        .update({
          name: payload.name,
          abn: payload.abn,
          notes: payload.notes,
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['venue-groups'] })
      qc.invalidateQueries({ queryKey: ['venue-groups', vars.id] })
      toast.success('Group saved')
    },
    onError: (err: Error) =>
      toast.error(`Couldn't save group: ${err.message}`),
  })
}

export function useDeleteVenueGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      // venues.group_id is ON DELETE SET NULL — orphaned venues stay, the
      // group row is removed, members go ungrouped.
      const { error } = await supabase
        .from('venue_groups')
        .delete()
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['venue-groups'] })
      qc.invalidateQueries({ queryKey: ['venues'] })
      toast.success('Group deleted')
    },
    onError: (err: Error) =>
      toast.error(`Couldn't delete group: ${err.message}`),
  })
}

/** Assign a single venue to a group (or null to clear). */
export function useAssignVenueToGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      venue_id,
      group_id,
    }: {
      venue_id: string
      group_id: string | null
    }) => {
      const { error } = await supabase
        .from('venues')
        .update({ group_id })
        .eq('id', venue_id)
      if (error) throw error
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['venue-groups'] })
      qc.invalidateQueries({ queryKey: ['venues'] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['deals'] })
      if (vars.group_id) {
        qc.invalidateQueries({ queryKey: ['venue-groups', vars.group_id] })
      }
    },
    onError: (err: Error) =>
      toast.error(`Couldn't update group: ${err.message}`),
  })
}

/**
 * Lookup helper — venues mapped to their venue_group (name only). Used by
 * the small group-chip subtitle on Pipeline/Contacts so we don't need to
 * re-fetch a full venue row to find its group's name. One round-trip,
 * RLS-scoped, cached for 60s.
 */
export interface VenueGroupBadge {
  venue_id: string
  group_id: string
  group_name: string
}

export function useVenueGroupBadges() {
  return useQuery({
    queryKey: ['venue-group-badges'],
    queryFn: async (): Promise<Record<string, VenueGroupBadge>> => {
      const { data, error } = await supabase
        .from('venues')
        .select('id, group_id, venue_groups:group_id(name)')
        .not('group_id', 'is', null)
      if (error) throw error
      const out: Record<string, VenueGroupBadge> = {}
      for (const row of (data ?? []) as Array<{
        id: string
        group_id: string | null
        venue_groups: { name: string } | { name: string }[] | null
      }>) {
        if (!row.group_id) continue
        const gname = Array.isArray(row.venue_groups)
          ? row.venue_groups[0]?.name
          : row.venue_groups?.name
        if (!gname) continue
        out[row.id] = {
          venue_id: row.id,
          group_id: row.group_id,
          group_name: gname,
        }
      }
      return out
    },
    staleTime: 60_000,
  })
}
