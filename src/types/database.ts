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
          archived_at: string | null
          body: string | null
          contact_id: string | null
          created_at: string | null
          deal_id: string | null
          external_message_id: string | null
          id: string
          metadata: Json | null
          occurred_at: string | null
          org_id: string
          raw_headers: Json | null
          subject: string | null
        }
        Insert: {
          activity_type: string
          archived_at?: string | null
          body?: string | null
          contact_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          external_message_id?: string | null
          id?: string
          metadata?: Json | null
          occurred_at?: string | null
          org_id: string
          raw_headers?: Json | null
          subject?: string | null
        }
        Update: {
          activity_type?: string
          archived_at?: string | null
          body?: string | null
          contact_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          external_message_id?: string | null
          id?: string
          metadata?: Json | null
          occurred_at?: string | null
          org_id?: string
          raw_headers?: Json | null
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
          contact_id: string | null
          deal_id: string | null
          event_name: string | null
          event_start: string | null
          event_type: string | null
          id: string
          invitee_email: string | null
          invitee_name: string | null
          org_id: string
          raw_payload: Json | null
          received_at: string | null
        }
        Insert: {
          contact_id?: string | null
          deal_id?: string | null
          event_name?: string | null
          event_start?: string | null
          event_type?: string | null
          id?: string
          invitee_email?: string | null
          invitee_name?: string | null
          org_id: string
          raw_payload?: Json | null
          received_at?: string | null
        }
        Update: {
          contact_id?: string | null
          deal_id?: string | null
          event_name?: string | null
          event_start?: string | null
          event_type?: string | null
          id?: string
          invitee_email?: string | null
          invitee_name?: string | null
          org_id?: string
          raw_payload?: Json | null
          received_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendly_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
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
      contact_tags: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          org_id: string
          tag: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          org_id: string
          tag: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          org_id?: string
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tags_org_id_fkey"
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
          do_not_contact: boolean
          email: string | null
          full_name: string
          geocoded_at: string | null
          id: string
          is_primary: boolean | null
          last_visited_at: string | null
          lat: number | null
          linkedin_url: string | null
          lng: number | null
          notes: string | null
          org_id: string
          phone: string | null
          role: string | null
          signal_reopening: Json | null
          updated_at: string | null
          venue_id: string | null
        }
        Insert: {
          created_at?: string | null
          do_not_contact?: boolean
          email?: string | null
          full_name: string
          geocoded_at?: string | null
          id?: string
          is_primary?: boolean | null
          last_visited_at?: string | null
          lat?: number | null
          linkedin_url?: string | null
          lng?: number | null
          notes?: string | null
          org_id: string
          phone?: string | null
          role?: string | null
          signal_reopening?: Json | null
          updated_at?: string | null
          venue_id?: string | null
        }
        Update: {
          created_at?: string | null
          do_not_contact?: boolean
          email?: string | null
          full_name?: string
          geocoded_at?: string | null
          id?: string
          is_primary?: boolean | null
          last_visited_at?: string | null
          lat?: number | null
          linkedin_url?: string | null
          lng?: number | null
          notes?: string | null
          org_id?: string
          phone?: string | null
          role?: string | null
          signal_reopening?: Json | null
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
          acv: number | null
          close_won_at: string | null
          closed_at: string | null
          commission_amount: number | null
          commission_pct: number | null
          contact_id: string | null
          contract_months: number | null
          contract_value: number | null
          created_at: string | null
          final_value: number | null
          follow_up_due: string | null
          id: string
          install_completed_at: string | null
          install_confirmed_at: string | null
          install_scheduled_for: string | null
          last_touch_at: string | null
          lost_reason: string | null
          notes: string | null
          org_id: string
          outcome: string | null
          owner_user_id: string | null
          product_id: string | null
          snoozed_until: string | null
          stage_id: string | null
          tcv: number | null
          term_months: number | null
          title: string | null
          updated_at: string | null
          venue_id: string | null
          weekly_price_override: number | null
        }
        Insert: {
          acv?: number | null
          close_won_at?: string | null
          closed_at?: string | null
          commission_amount?: number | null
          commission_pct?: number | null
          contact_id?: string | null
          contract_months?: number | null
          contract_value?: number | null
          created_at?: string | null
          final_value?: number | null
          follow_up_due?: string | null
          id?: string
          install_completed_at?: string | null
          install_confirmed_at?: string | null
          install_scheduled_for?: string | null
          last_touch_at?: string | null
          lost_reason?: string | null
          notes?: string | null
          org_id: string
          outcome?: string | null
          owner_user_id?: string | null
          product_id?: string | null
          snoozed_until?: string | null
          stage_id?: string | null
          tcv?: number | null
          term_months?: number | null
          title?: string | null
          updated_at?: string | null
          venue_id?: string | null
          weekly_price_override?: number | null
        }
        Update: {
          acv?: number | null
          close_won_at?: string | null
          closed_at?: string | null
          commission_amount?: number | null
          commission_pct?: number | null
          contact_id?: string | null
          contract_months?: number | null
          contract_value?: number | null
          created_at?: string | null
          final_value?: number | null
          follow_up_due?: string | null
          id?: string
          install_completed_at?: string | null
          install_confirmed_at?: string | null
          install_scheduled_for?: string | null
          last_touch_at?: string | null
          lost_reason?: string | null
          notes?: string | null
          org_id?: string
          outcome?: string | null
          owner_user_id?: string | null
          product_id?: string | null
          snoozed_until?: string | null
          stage_id?: string | null
          tcv?: number | null
          term_months?: number | null
          title?: string | null
          updated_at?: string | null
          venue_id?: string | null
          weekly_price_override?: number | null
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
            foreignKeyName: "deals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
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
          approved_at: string | null
          body: string | null
          contact_id: string | null
          context_json: Json | null
          created_at: string | null
          created_by: string | null
          deal_id: string | null
          draft_type: string
          edit_logged_at: string | null
          edited_body: string | null
          edited_subject: string | null
          generated_at: string | null
          id: string
          model: string | null
          org_id: string
          original_body: string | null
          original_subject: string | null
          sendgrid_msg_id: string | null
          sent_at: string | null
          status: string | null
          subject: string | null
        }
        Insert: {
          approved_at?: string | null
          body?: string | null
          contact_id?: string | null
          context_json?: Json | null
          created_at?: string | null
          created_by?: string | null
          deal_id?: string | null
          draft_type: string
          edit_logged_at?: string | null
          edited_body?: string | null
          edited_subject?: string | null
          generated_at?: string | null
          id?: string
          model?: string | null
          org_id: string
          original_body?: string | null
          original_subject?: string | null
          sendgrid_msg_id?: string | null
          sent_at?: string | null
          status?: string | null
          subject?: string | null
        }
        Update: {
          approved_at?: string | null
          body?: string | null
          contact_id?: string | null
          context_json?: Json | null
          created_at?: string | null
          created_by?: string | null
          deal_id?: string | null
          draft_type?: string
          edit_logged_at?: string | null
          edited_body?: string | null
          edited_subject?: string | null
          generated_at?: string | null
          id?: string
          model?: string | null
          org_id?: string
          original_body?: string | null
          original_subject?: string | null
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
      field_visits: {
        Row: {
          contact_id: string | null
          created_at: string
          id: string
          lat: number | null
          lng: number | null
          notes: string | null
          org_id: string
          outcome: string
          user_id: string
          venue_observation_id: string | null
          visited_at: string
          voice_audio_path: string | null
          voice_transcript: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          notes?: string | null
          org_id: string
          outcome: string
          user_id: string
          venue_observation_id?: string | null
          visited_at?: string
          voice_audio_path?: string | null
          voice_transcript?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          notes?: string | null
          org_id?: string
          outcome?: string
          user_id?: string
          venue_observation_id?: string | null
          visited_at?: string
          voice_audio_path?: string | null
          voice_transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "field_visits_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_visits_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_visits_venue_observation_id_fkey"
            columns: ["venue_observation_id"]
            isOneToOne: false
            referencedRelation: "venue_observations"
            referencedColumns: ["id"]
          },
        ]
      }
      gmail_connections: {
        Row: {
          access_token_encrypted: string | null
          access_token_expires_at: string | null
          created_at: string | null
          email: string
          history_id: string | null
          id: string
          org_id: string
          refresh_token_encrypted: string | null
          updated_at: string | null
          user_id: string
          watch_expires_at: string | null
        }
        Insert: {
          access_token_encrypted?: string | null
          access_token_expires_at?: string | null
          created_at?: string | null
          email: string
          history_id?: string | null
          id?: string
          org_id: string
          refresh_token_encrypted?: string | null
          updated_at?: string | null
          user_id: string
          watch_expires_at?: string | null
        }
        Update: {
          access_token_encrypted?: string | null
          access_token_expires_at?: string | null
          created_at?: string | null
          email?: string
          history_id?: string | null
          id?: string
          org_id?: string
          refresh_token_encrypted?: string | null
          updated_at?: string | null
          user_id?: string
          watch_expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gmail_connections_org_id_fkey"
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
      learning_digests: {
        Row: {
          created_at: string
          drafts_analysed: number
          email_sent_at: string | null
          generated_at: string
          id: string
          org_id: string
          proposed_rules: Json
          status: string
          updated_at: string
          user_id: string
          week_end: string
          week_start: string
        }
        Insert: {
          created_at?: string
          drafts_analysed?: number
          email_sent_at?: string | null
          generated_at?: string
          id?: string
          org_id: string
          proposed_rules?: Json
          status?: string
          updated_at?: string
          user_id: string
          week_end: string
          week_start: string
        }
        Update: {
          created_at?: string
          drafts_analysed?: number
          email_sent_at?: string | null
          generated_at?: string
          id?: string
          org_id?: string
          proposed_rules?: Json
          status?: string
          updated_at?: string
          user_id?: string
          week_end?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "learning_digests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_gates: {
        Row: {
          achieved_acv: number
          created_at: string
          forfeited_at: string | null
          hit_gate: boolean
          id: string
          locked_at: string | null
          month: string
          notes: string | null
          org_id: string
          prior_month_commission_amount: number | null
          prior_month_commission_status: string | null
          target_acv: number
          updated_at: string
          user_id: string
        }
        Insert: {
          achieved_acv?: number
          created_at?: string
          forfeited_at?: string | null
          hit_gate?: boolean
          id?: string
          locked_at?: string | null
          month: string
          notes?: string | null
          org_id: string
          prior_month_commission_amount?: number | null
          prior_month_commission_status?: string | null
          target_acv?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          achieved_acv?: number
          created_at?: string
          forfeited_at?: string | null
          hit_gate?: boolean
          id?: string
          locked_at?: string | null
          month?: string
          notes?: string | null
          org_id?: string
          prior_month_commission_amount?: number | null
          prior_month_commission_status?: string | null
          target_acv?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_gates_org_id_fkey"
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
      products: {
        Row: {
          active: boolean
          brand: string
          category: string
          created_at: string
          default_commission_pct: number
          default_term_months: number
          id: string
          label: string
          notes: string | null
          sku: string
          updated_at: string
          water_types: string[]
          weekly_price_aud: number
        }
        Insert: {
          active?: boolean
          brand: string
          category: string
          created_at?: string
          default_commission_pct?: number
          default_term_months: number
          id?: string
          label: string
          notes?: string | null
          sku: string
          updated_at?: string
          water_types?: string[]
          weekly_price_aud: number
        }
        Update: {
          active?: boolean
          brand?: string
          category?: string
          created_at?: string
          default_commission_pct?: number
          default_term_months?: number
          id?: string
          label?: string
          notes?: string | null
          sku?: string
          updated_at?: string
          water_types?: string[]
          weekly_price_aud?: number
        }
        Relationships: []
      }
      reopening_events: {
        Row: {
          contact_id: string | null
          created_at: string | null
          detected_at: string
          dismissed_at: string | null
          event_type: string
          id: string
          org_id: string
          venue_observation_new: string
          venue_observation_prior: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string | null
          detected_at?: string
          dismissed_at?: string | null
          event_type: string
          id?: string
          org_id: string
          venue_observation_new: string
          venue_observation_prior?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string | null
          detected_at?: string
          dismissed_at?: string | null
          event_type?: string
          id?: string
          org_id?: string
          venue_observation_new?: string
          venue_observation_prior?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reopening_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reopening_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reopening_events_venue_observation_new_fkey"
            columns: ["venue_observation_new"]
            isOneToOne: false
            referencedRelation: "venue_observations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reopening_events_venue_observation_prior_fkey"
            columns: ["venue_observation_prior"]
            isOneToOne: false
            referencedRelation: "venue_observations"
            referencedColumns: ["id"]
          },
        ]
      }
      sending_domains: {
        Row: {
          created_at: string
          dkim_status: string | null
          dmarc_status: string | null
          domain: string
          id: string
          inbox_count: number
          last_checked_at: string | null
          notes: string | null
          org_id: string
          provider: string | null
          spf_status: string | null
          status: string
          updated_at: string
          user_id: string
          warmup_day: number
          warmup_target_day: number
        }
        Insert: {
          created_at?: string
          dkim_status?: string | null
          dmarc_status?: string | null
          domain: string
          id?: string
          inbox_count?: number
          last_checked_at?: string | null
          notes?: string | null
          org_id: string
          provider?: string | null
          spf_status?: string | null
          status?: string
          updated_at?: string
          user_id: string
          warmup_day?: number
          warmup_target_day?: number
        }
        Update: {
          created_at?: string
          dkim_status?: string | null
          dmarc_status?: string | null
          domain?: string
          id?: string
          inbox_count?: number
          last_checked_at?: string | null
          notes?: string | null
          org_id?: string
          provider?: string | null
          spf_status?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          warmup_day?: number
          warmup_target_day?: number
        }
        Relationships: [
          {
            foreignKeyName: "sending_domains_org_id_fkey"
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
          added_by_user_id: string | null
          domain_suppression: boolean
          email: string
          id: string
          notes: string | null
          org_id: string
          reason: string
          source: string | null
          suppressed_at: string | null
        }
        Insert: {
          added_by_user_id?: string | null
          domain_suppression?: boolean
          email: string
          id?: string
          notes?: string | null
          org_id: string
          reason: string
          source?: string | null
          suppressed_at?: string | null
        }
        Update: {
          added_by_user_id?: string | null
          domain_suppression?: boolean
          email?: string
          id?: string
          notes?: string | null
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
          calendly_token_encrypted: string | null
          calendly_url: string | null
          created_at: string | null
          default_commission_pct: number | null
          email: string | null
          email_notifications: Json
          email_signature: string | null
          full_name: string | null
          icp_config: Json | null
          id: string
          org_id: string
          role: string | null
          voice_rules: string | null
        }
        Insert: {
          calendly_token_encrypted?: string | null
          calendly_url?: string | null
          created_at?: string | null
          default_commission_pct?: number | null
          email?: string | null
          email_notifications?: Json
          email_signature?: string | null
          full_name?: string | null
          icp_config?: Json | null
          id: string
          org_id: string
          role?: string | null
          voice_rules?: string | null
        }
        Update: {
          calendly_token_encrypted?: string | null
          calendly_url?: string | null
          created_at?: string | null
          default_commission_pct?: number | null
          email?: string | null
          email_notifications?: Json
          email_signature?: string | null
          full_name?: string | null
          icp_config?: Json | null
          id?: string
          org_id?: string
          role?: string | null
          voice_rules?: string | null
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
      venue_observations: {
        Row: {
          address: string | null
          business_status: string
          created_at: string | null
          evidence_url: string | null
          external_id: string | null
          geocoded_at: string | null
          id: string
          lat: number | null
          licence_number: string | null
          licence_type: string | null
          licensee: string | null
          lng: number | null
          observed_at: string
          org_id: string
          raw: Json | null
          source: string
          suburb: string | null
          venue_name: string
        }
        Insert: {
          address?: string | null
          business_status: string
          created_at?: string | null
          evidence_url?: string | null
          external_id?: string | null
          geocoded_at?: string | null
          id?: string
          lat?: number | null
          licence_number?: string | null
          licence_type?: string | null
          licensee?: string | null
          lng?: number | null
          observed_at?: string
          org_id: string
          raw?: Json | null
          source: string
          suburb?: string | null
          venue_name: string
        }
        Update: {
          address?: string | null
          business_status?: string
          created_at?: string | null
          evidence_url?: string | null
          external_id?: string | null
          geocoded_at?: string | null
          id?: string
          lat?: number | null
          licence_number?: string | null
          licence_type?: string | null
          licensee?: string | null
          lng?: number | null
          observed_at?: string
          org_id?: string
          raw?: Json | null
          source?: string
          suburb?: string | null
          venue_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_observations_org_id_fkey"
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
          avg_spend_tier: string | null
          competitor_water_usage: string | null
          cover_count: number | null
          created_at: string | null
          google_place_id: string | null
          icp_score: number | null
          id: string
          is_excluded: boolean | null
          kitchen_type: string | null
          licence_type: string | null
          licensing_status: string | null
          name: string
          neighbourhood: string | null
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
          avg_spend_tier?: string | null
          competitor_water_usage?: string | null
          cover_count?: number | null
          created_at?: string | null
          google_place_id?: string | null
          icp_score?: number | null
          id?: string
          is_excluded?: boolean | null
          kitchen_type?: string | null
          licence_type?: string | null
          licensing_status?: string | null
          name: string
          neighbourhood?: string | null
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
          avg_spend_tier?: string | null
          competitor_water_usage?: string | null
          cover_count?: number | null
          created_at?: string | null
          google_place_id?: string | null
          icp_score?: number | null
          id?: string
          is_excluded?: boolean | null
          kitchen_type?: string | null
          licence_type?: string | null
          licensing_status?: string | null
          name?: string
          neighbourhood?: string | null
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
      compute_lead_score: { Args: { p_contact_id: string }; Returns: number }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      recompute_monthly_gate: {
        Args: { p_month: string; p_org_id: string; p_user_id: string }
        Returns: undefined
      }
      run_monthly_gate_forfeits: { Args: never; Returns: undefined }
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

