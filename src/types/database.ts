export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activities: {
        Row: {
          activity_type: string
          body: string | null
          contact_id: string | null
          created_at: string | null
          deal_id: string | null
          id: string
          metadata: Json | null
          occurred_at: string | null
          org_id: string
          subject: string | null
        }
        Insert: {
          activity_type: string
          body?: string | null
          contact_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          id?: string
          metadata?: Json | null
          occurred_at?: string | null
          org_id: string
          subject?: string | null
        }
        Update: {
          activity_type?: string
          body?: string | null
          contact_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          id?: string
          metadata?: Json | null
          occurred_at?: string | null
          org_id?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_sourced_candidates: {
        Row: {
          address: string | null
          created_at: string | null
          google_place_id: string | null
          icp_score_guess: number | null
          id: string
          name: string | null
          org_id: string
          raw_data: Json | null
          reviewed_at: string | null
          status: string | null
          suburb: string | null
          venue_type_guess: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string | null
          google_place_id?: string | null
          icp_score_guess?: number | null
          id?: string
          name?: string | null
          org_id: string
          raw_data?: Json | null
          reviewed_at?: string | null
          status?: string | null
          suburb?: string | null
          venue_type_guess?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string | null
          google_place_id?: string | null
          icp_score_guess?: number | null
          id?: string
          name?: string | null
          org_id?: string
          raw_data?: Json | null
          reviewed_at?: string | null
          status?: string | null
          suburb?: string | null
          venue_type_guess?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auto_sourced_candidates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      calendly_events: {
        Row: {
          deal_id: string | null
          event_start: string | null
          event_type: string | null
          id: string
          invitee_email: string | null
          org_id: string
          raw_payload: Json | null
          received_at: string | null
        }
        Insert: {
          deal_id?: string | null
          event_start?: string | null
          event_type?: string | null
          id?: string
          invitee_email?: string | null
          org_id: string
          raw_payload?: Json | null
          received_at?: string | null
        }
        Update: {
          deal_id?: string | null
          event_start?: string | null
          event_type?: string | null
          id?: string
          invitee_email?: string | null
          org_id?: string
          raw_payload?: Json | null
          received_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendly_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendly_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          created_at: string | null
          email: string | null
          full_name: string
          id: string
          is_primary: boolean | null
          linkedin_url: string | null
          notes: string | null
          org_id: string
          phone: string | null
          role: string | null
          updated_at: string | null
          venue_id: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          full_name: string
          id?: string
          is_primary?: boolean | null
          linkedin_url?: string | null
          notes?: string | null
          org_id: string
          phone?: string | null
          role?: string | null
          updated_at?: string | null
          venue_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          full_name?: string
          id?: string
          is_primary?: boolean | null
          linkedin_url?: string | null
          notes?: string | null
          org_id?: string
          phone?: string | null
          role?: string | null
          updated_at?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          closed_at: string | null
          contact_id: string | null
          contract_months: number | null
          contract_value: number | null
          created_at: string | null
          follow_up_due: string | null
          id: string
          last_touch_at: string | null
          lost_reason: string | null
          notes: string | null
          org_id: string
          stage_id: string | null
          title: string | null
          updated_at: string | null
          venue_id: string | null
        }
        Insert: {
          closed_at?: string | null
          contact_id?: string | null
          contract_months?: number | null
          contract_value?: number | null
          created_at?: string | null
          follow_up_due?: string | null
          id?: string
          last_touch_at?: string | null
          lost_reason?: string | null
          notes?: string | null
          org_id: string
          stage_id?: string | null
          title?: string | null
          updated_at?: string | null
          venue_id?: string | null
        }
        Update: {
          closed_at?: string | null
          contact_id?: string | null
          contract_months?: number | null
          contract_value?: number | null
          created_at?: string | null
          follow_up_due?: string | null
          id?: string
          last_touch_at?: string | null
          lost_reason?: string | null
          notes?: string | null
          org_id?: string
          stage_id?: string | null
          title?: string | null
          updated_at?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_edits: {
        Row: {
          created_at: string | null
          draft_id: string | null
          edit_delta: Json | null
          edited: string | null
          id: string
          org_id: string
          original: string | null
        }
        Insert: {
          created_at?: string | null
          draft_id?: string | null
          edit_delta?: Json | null
          edited?: string | null
          id?: string
          org_id: string
          original?: string | null
        }
        Update: {
          created_at?: string | null
          draft_id?: string | null
          edit_delta?: Json | null
          edited?: string | null
          id?: string
          org_id?: string
          original?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "draft_edits_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "email_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_edits_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      email_drafts: {
        Row: {
          body: string | null
          contact_id: string | null
          created_at: string | null
          deal_id: string | null
          draft_type: string
          id: string
          org_id: string
          prompt_context: Json | null
          sendgrid_msg_id: string | null
          sent_at: string | null
          status: string | null
          subject: string | null
        }
        Insert: {
          body?: string | null
          contact_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          draft_type: string
          id?: string
          org_id: string
          prompt_context?: Json | null
          sendgrid_msg_id?: string | null
          sent_at?: string | null
          status?: string | null
          subject?: string | null
        }
        Update: {
          body?: string | null
          contact_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          draft_type?: string
          id?: string
          org_id?: string
          prompt_context?: Json | null
          sendgrid_msg_id?: string | null
          sent_at?: string | null
          status?: string | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_drafts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_scores: {
        Row: {
          deal_id: string | null
          factors: Json | null
          id: string
          org_id: string
          score: number
          scored_at: string | null
          tier: string
        }
        Insert: {
          deal_id?: string | null
          factors?: Json | null
          id?: string
          org_id: string
          score: number
          scored_at?: string | null
          tier: string
        }
        Update: {
          deal_id?: string | null
          factors?: Json | null
          id?: string
          org_id?: string
          score?: number
          scored_at?: string | null
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_scores_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_scores_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      orgs: {
        Row: {
          created_at: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      pipeline_stages: {
        Row: {
          color: string | null
          created_at: string | null
          id: string
          is_closed: boolean | null
          name: string
          org_id: string
          position: number
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          id?: string
          is_closed?: boolean | null
          name: string
          org_id: string
          position: number
        }
        Update: {
          color?: string | null
          created_at?: string | null
          id?: string
          is_closed?: boolean | null
          name?: string
          org_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      sequence_enrollments: {
        Row: {
          completed_at: string | null
          current_step: number | null
          deal_id: string | null
          enrolled_at: string | null
          id: string
          next_send_at: string | null
          org_id: string
          processing_started_at: string | null
          sequence_id: string | null
          status: string | null
          step_snapshots: Json | null
        }
        Insert: {
          completed_at?: string | null
          current_step?: number | null
          deal_id?: string | null
          enrolled_at?: string | null
          id?: string
          next_send_at?: string | null
          org_id: string
          processing_started_at?: string | null
          sequence_id?: string | null
          status?: string | null
          step_snapshots?: Json | null
        }
        Update: {
          completed_at?: string | null
          current_step?: number | null
          deal_id?: string | null
          enrolled_at?: string | null
          id?: string
          next_send_at?: string | null
          org_id?: string
          processing_started_at?: string | null
          sequence_id?: string | null
          status?: string | null
          step_snapshots?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "sequence_enrollments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_enrollments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_enrollments_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      sequence_steps: {
        Row: {
          body_template: string | null
          created_at: string | null
          delay_days: number
          id: string
          org_id: string
          sequence_id: string | null
          step_number: number
          step_type: string | null
          stop_on_meeting: boolean | null
          stop_on_reply: boolean | null
          subject_template: string | null
        }
        Insert: {
          body_template?: string | null
          created_at?: string | null
          delay_days: number
          id?: string
          org_id: string
          sequence_id?: string | null
          step_number: number
          step_type?: string | null
          stop_on_meeting?: boolean | null
          stop_on_reply?: boolean | null
          subject_template?: string | null
        }
        Update: {
          body_template?: string | null
          created_at?: string | null
          delay_days?: number
          id?: string
          org_id?: string
          sequence_id?: string | null
          step_number?: number
          step_type?: string | null
          stop_on_meeting?: boolean | null
          stop_on_reply?: boolean | null
          subject_template?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sequence_steps_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_steps_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      sequences: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          org_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          org_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          org_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sequences_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      signals: {
        Row: {
          actioned_at: string | null
          contact_id: string | null
          detail: Json | null
          detected_at: string | null
          headline: string | null
          id: string
          is_actioned: boolean | null
          org_id: string
          signal_source: string
          signal_type: string
          venue_id: string | null
        }
        Insert: {
          actioned_at?: string | null
          contact_id?: string | null
          detail?: Json | null
          detected_at?: string | null
          headline?: string | null
          id?: string
          is_actioned?: boolean | null
          org_id: string
          signal_source: string
          signal_type: string
          venue_id?: string | null
        }
        Update: {
          actioned_at?: string | null
          contact_id?: string | null
          detail?: Json | null
          detected_at?: string | null
          headline?: string | null
          id?: string
          is_actioned?: boolean | null
          org_id?: string
          signal_source?: string
          signal_type?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signals_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      suppression_list: {
        Row: {
          email: string
          id: string
          org_id: string
          reason: string
          source: string | null
          suppressed_at: string | null
        }
        Insert: {
          email: string
          id?: string
          org_id: string
          reason: string
          source?: string | null
          suppressed_at?: string | null
        }
        Update: {
          email?: string
          id?: string
          org_id?: string
          reason?: string
          source?: string | null
          suppressed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppression_list_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          completed_at: string | null
          contact_id: string | null
          created_at: string | null
          deal_id: string | null
          description: string | null
          due_at: string | null
          id: string
          org_id: string
          task_type: string | null
          title: string
        }
        Insert: {
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          org_id: string
          task_type?: string | null
          title: string
        }
        Update: {
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          org_id?: string
          task_type?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          org_id: string
          role: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          org_id: string
          role?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          org_id?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          address: string | null
          competitor_water_usage: string | null
          cover_count: number | null
          created_at: string | null
          google_place_id: string | null
          icp_score: number | null
          id: string
          is_excluded: boolean | null
          kitchen_type: string | null
          licensing_status: string | null
          name: string
          notes: string | null
          org_id: string
          phone: string | null
          postcode: string | null
          seasonality_window: string | null
          service_style: string | null
          source: string | null
          source_details: Json | null
          state: string | null
          suburb: string | null
          updated_at: string | null
          venue_type: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          competitor_water_usage?: string | null
          cover_count?: number | null
          created_at?: string | null
          google_place_id?: string | null
          icp_score?: number | null
          id?: string
          is_excluded?: boolean | null
          kitchen_type?: string | null
          licensing_status?: string | null
          name: string
          notes?: string | null
          org_id: string
          phone?: string | null
          postcode?: string | null
          seasonality_window?: string | null
          service_style?: string | null
          source?: string | null
          source_details?: Json | null
          state?: string | null
          suburb?: string | null
          updated_at?: string | null
          venue_type?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          competitor_water_usage?: string | null
          cover_count?: number | null
          created_at?: string | null
          google_place_id?: string | null
          icp_score?: number | null
          id?: string
          is_excluded?: boolean | null
          kitchen_type?: string | null
          licensing_status?: string | null
          name?: string
          notes?: string | null
          org_id?: string
          phone?: string | null
          postcode?: string | null
          seasonality_window?: string | null
          service_style?: string | null
          source?: string | null
          source_details?: Json | null
          state?: string | null
          suburb?: string | null
          updated_at?: string | null
          venue_type?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venues_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_runs: {
        Row: {
          completed_at: string | null
          error_message: string | null
          id: string
          items_processed: number | null
          metadata: Json | null
          org_id: string | null
          started_at: string | null
          status: string | null
          worker_name: string
        }
        Insert: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          items_processed?: number | null
          metadata?: Json | null
          org_id?: string | null
          started_at?: string | null
          status?: string | null
          worker_name: string
        }
        Update: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          items_processed?: number | null
          metadata?: Json | null
          org_id?: string | null
          started_at?: string | null
          status?: string | null
          worker_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_org_id: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
