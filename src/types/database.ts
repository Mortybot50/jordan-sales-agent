// TODO(week-2): Replace with generated types once schema is stable
// Run: npx supabase gen types typescript --project-id <ref> > src/types/database.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      orgs: {
        Row: {
          id: string
          name: string
          slug: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['orgs']['Insert']>
      }
      users: {
        Row: {
          id: string
          org_id: string
          full_name: string | null
          email: string | null
          role: string
          created_at: string
        }
        Insert: {
          id: string
          org_id: string
          full_name?: string | null
          email?: string | null
          role?: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['users']['Insert']>
      }
      venues: {
        Row: {
          id: string
          org_id: string
          name: string
          google_place_id: string | null
          address: string | null
          suburb: string | null
          state: string
          postcode: string | null
          website: string | null
          phone: string | null
          venue_type: string | null
          service_style: string | null
          cover_count: number | null
          kitchen_type: string | null
          competitor_water_usage: string | null
          licensing_status: string | null
          seasonality_window: string | null
          icp_score: number | null
          source: string | null
          source_details: Json | null
          is_excluded: boolean
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['venues']['Row'], 'id' | 'created_at' | 'updated_at'> & { id?: string }
        Update: Partial<Database['public']['Tables']['venues']['Insert']>
      }
      contacts: {
        Row: {
          id: string
          org_id: string
          venue_id: string | null
          full_name: string
          role: string | null
          email: string | null
          phone: string | null
          linkedin_url: string | null
          is_primary: boolean
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['contacts']['Row'], 'id' | 'created_at' | 'updated_at'> & { id?: string }
        Update: Partial<Database['public']['Tables']['contacts']['Insert']>
      }
      deals: {
        Row: {
          id: string
          org_id: string
          venue_id: string | null
          contact_id: string | null
          stage_id: string | null
          title: string | null
          contract_value: number
          contract_months: number | null
          follow_up_due: string | null
          last_touch_at: string | null
          closed_at: string | null
          lost_reason: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['deals']['Row'], 'id' | 'created_at' | 'updated_at'> & { id?: string }
        Update: Partial<Database['public']['Tables']['deals']['Insert']>
      }
      pipeline_stages: {
        Row: {
          id: string
          org_id: string
          name: string
          position: number
          is_closed: boolean
          color: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['pipeline_stages']['Row'], 'id' | 'created_at'> & { id?: string }
        Update: Partial<Database['public']['Tables']['pipeline_stages']['Insert']>
      }
      activities: {
        Row: {
          id: string
          org_id: string
          deal_id: string | null
          contact_id: string | null
          activity_type: string
          subject: string | null
          body: string | null
          metadata: Json | null
          occurred_at: string
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['activities']['Row'], 'id' | 'created_at'> & { id?: string }
        Update: Partial<Database['public']['Tables']['activities']['Insert']>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
