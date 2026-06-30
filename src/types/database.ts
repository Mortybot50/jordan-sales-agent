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
      briefing_sends: {
        Row: {
          error: string | null
          id: string
          item_count: number | null
          resend_message_id: string | null
          sent_at: string
          sent_local_date: string
          user_id: string
        }
        Insert: {
          error?: string | null
          id?: string
          item_count?: number | null
          resend_message_id?: string | null
          sent_at?: string
          sent_local_date?: string
          user_id: string
        }
        Update: {
          error?: string | null
          id?: string
          item_count?: number | null
          resend_message_id?: string | null
          sent_at?: string
          sent_local_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "briefing_sends_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
      claude_conversations: {
        Row: {
          contact_id: string | null
          created_at: string
          id: string
          org_id: string
          scope: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          id?: string
          org_id: string
          scope: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          id?: string
          org_id?: string
          scope?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "claude_conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claude_conversations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      claude_messages: {
        Row: {
          content: string
          conversation_id: string
          cost_usd: number | null
          created_at: string
          id: string
          model: string | null
          org_id: string
          role: string
          tokens_in: number | null
          tokens_out: number | null
        }
        Insert: {
          content: string
          conversation_id: string
          cost_usd?: number | null
          created_at?: string
          id?: string
          model?: string | null
          org_id: string
          role: string
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Update: {
          content?: string
          conversation_id?: string
          cost_usd?: number | null
          created_at?: string
          id?: string
          model?: string | null
          org_id?: string
          role?: string
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "claude_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "claude_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claude_messages_org_id_fkey"
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
          catch_all_flag: boolean | null
          catch_all_send_separately: boolean | null
          created_at: string | null
          do_not_contact: boolean
          email: string | null
          email_tier: number | null
          full_name: string
          geocoded_at: string | null
          id: string
          is_primary: boolean | null
          last_visited_at: string | null
          lat: number | null
          linkedin_url: string | null
          lng: number | null
          metadata: Json | null
          notes: string | null
          org_id: string
          phone: string | null
          role: string | null
          signal_reopening: Json | null
          source: string | null
          updated_at: string | null
          venue_id: string | null
          verification_status: string | null
          verified_at: string | null
        }
        Insert: {
          catch_all_flag?: boolean | null
          catch_all_send_separately?: boolean | null
          created_at?: string | null
          do_not_contact?: boolean
          email?: string | null
          email_tier?: number | null
          full_name: string
          geocoded_at?: string | null
          id?: string
          is_primary?: boolean | null
          last_visited_at?: string | null
          lat?: number | null
          linkedin_url?: string | null
          lng?: number | null
          metadata?: Json | null
          notes?: string | null
          org_id: string
          phone?: string | null
          role?: string | null
          signal_reopening?: Json | null
          source?: string | null
          updated_at?: string | null
          venue_id?: string | null
          verification_status?: string | null
          verified_at?: string | null
        }
        Update: {
          catch_all_flag?: boolean | null
          catch_all_send_separately?: boolean | null
          created_at?: string | null
          do_not_contact?: boolean
          email?: string | null
          email_tier?: number | null
          full_name?: string
          geocoded_at?: string | null
          id?: string
          is_primary?: boolean | null
          last_visited_at?: string | null
          lat?: number | null
          linkedin_url?: string | null
          lng?: number | null
          metadata?: Json | null
          notes?: string | null
          org_id?: string
          phone?: string | null
          role?: string | null
          signal_reopening?: Json | null
          source?: string | null
          updated_at?: string | null
          venue_id?: string | null
          verification_status?: string | null
          verified_at?: string | null
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
          held_until: string | null
          id: string
          install_completed_at: string | null
          install_confirmed_at: string | null
          install_scheduled_for: string | null
          is_held: boolean
          last_touch_at: string | null
          lost_reason: string | null
          next_step_due_at: string | null
          next_step_note: string | null
          notes: string | null
          org_id: string
          outcome: string | null
          owner_user_id: string | null
          product_id: string | null
          proposal_sent_at: string | null
          snoozed_until: string | null
          stage_id: string | null
          tcv: number | null
          temperature: string | null
          temperature_source: string
          term_months: number | null
          thread_excerpt: Json | null
          title: string | null
          updated_at: string | null
          venue_id: string | null
          weekly_price_override: number | null
          win_probability: number | null
          win_probability_breakdown: Json | null
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
          held_until?: string | null
          id?: string
          install_completed_at?: string | null
          install_confirmed_at?: string | null
          install_scheduled_for?: string | null
          is_held?: boolean
          last_touch_at?: string | null
          lost_reason?: string | null
          next_step_due_at?: string | null
          next_step_note?: string | null
          notes?: string | null
          org_id: string
          outcome?: string | null
          owner_user_id?: string | null
          product_id?: string | null
          proposal_sent_at?: string | null
          snoozed_until?: string | null
          stage_id?: string | null
          tcv?: number | null
          temperature?: string | null
          temperature_source?: string
          term_months?: number | null
          thread_excerpt?: Json | null
          title?: string | null
          updated_at?: string | null
          venue_id?: string | null
          weekly_price_override?: number | null
          win_probability?: number | null
          win_probability_breakdown?: Json | null
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
          held_until?: string | null
          id?: string
          install_completed_at?: string | null
          install_confirmed_at?: string | null
          install_scheduled_for?: string | null
          is_held?: boolean
          last_touch_at?: string | null
          lost_reason?: string | null
          next_step_due_at?: string | null
          next_step_note?: string | null
          notes?: string | null
          org_id?: string
          outcome?: string | null
          owner_user_id?: string | null
          product_id?: string | null
          proposal_sent_at?: string | null
          snoozed_until?: string | null
          stage_id?: string | null
          tcv?: number | null
          temperature?: string | null
          temperature_source?: string
          term_months?: number | null
          thread_excerpt?: Json | null
          title?: string | null
          updated_at?: string | null
          venue_id?: string | null
          weekly_price_override?: number | null
          win_probability?: number | null
          win_probability_breakdown?: Json | null
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
      email_accounts: {
        Row: {
          brand: string | null
          created_at: string
          daily_send_cap: number
          display_name: string | null
          domain: string | null
          email_address: string
          icp_segment: string | null
          id: string
          last_bounce_at: string | null
          last_send_at: string | null
          last_warmup_send_at: string | null
          org_id: string
          reply_to_address: string | null
          reputation_score: number | null
          send_signature: string | null
          smtp_host: string
          smtp_password_encrypted: string | null
          smtp_port: number
          smtp_username: string
          status: string
          updated_at: string
          user_id: string
          warmup_day: number
          warmup_day_bumped_on: string | null
        }
        Insert: {
          brand?: string | null
          created_at?: string
          daily_send_cap?: number
          display_name?: string | null
          domain?: string | null
          email_address: string
          icp_segment?: string | null
          id?: string
          last_bounce_at?: string | null
          last_send_at?: string | null
          last_warmup_send_at?: string | null
          org_id: string
          reply_to_address?: string | null
          reputation_score?: number | null
          send_signature?: string | null
          smtp_host?: string
          smtp_password_encrypted?: string | null
          smtp_port?: number
          smtp_username: string
          status?: string
          updated_at?: string
          user_id: string
          warmup_day?: number
          warmup_day_bumped_on?: string | null
        }
        Update: {
          brand?: string | null
          created_at?: string
          daily_send_cap?: number
          display_name?: string | null
          domain?: string | null
          email_address?: string
          icp_segment?: string | null
          id?: string
          last_bounce_at?: string | null
          last_send_at?: string | null
          last_warmup_send_at?: string | null
          org_id?: string
          reply_to_address?: string | null
          reputation_score?: number | null
          send_signature?: string | null
          smtp_host?: string
          smtp_password_encrypted?: string | null
          smtp_port?: number
          smtp_username?: string
          status?: string
          updated_at?: string
          user_id?: string
          warmup_day?: number
          warmup_day_bumped_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
          draft_kind: string
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
          scheduled_send_at: string | null
          sender_inbox_id: string | null
          sendgrid_msg_id: string | null
          sent_at: string | null
          sequence_enrollment_id: string | null
          sequence_step_number: number | null
          status: string | null
          subject: string | null
          suppression_reason: string | null
        }
        Insert: {
          approved_at?: string | null
          body?: string | null
          contact_id?: string | null
          context_json?: Json | null
          created_at?: string | null
          created_by?: string | null
          deal_id?: string | null
          draft_kind?: string
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
          scheduled_send_at?: string | null
          sender_inbox_id?: string | null
          sendgrid_msg_id?: string | null
          sent_at?: string | null
          sequence_enrollment_id?: string | null
          sequence_step_number?: number | null
          status?: string | null
          subject?: string | null
          suppression_reason?: string | null
        }
        Update: {
          approved_at?: string | null
          body?: string | null
          contact_id?: string | null
          context_json?: Json | null
          created_at?: string | null
          created_by?: string | null
          deal_id?: string | null
          draft_kind?: string
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
          scheduled_send_at?: string | null
          sender_inbox_id?: string | null
          sendgrid_msg_id?: string | null
          sent_at?: string | null
          sequence_enrollment_id?: string | null
          sequence_step_number?: number | null
          status?: string | null
          subject?: string | null
          suppression_reason?: string | null
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
          {
            foreignKeyName: "email_drafts_sender_inbox_id_fkey"
            columns: ["sender_inbox_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_sequence_enrollment_id_fkey"
            columns: ["sequence_enrollment_id"]
            isOneToOne: false
            referencedRelation: "sequence_enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      email_pixel_hits: {
        Row: {
          created_at: string
          hit_at: string
          id: string
          ip_address: unknown
          is_apple_mpp: boolean
          send_queue_id: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          hit_at?: string
          id?: string
          ip_address?: unknown
          is_apple_mpp?: boolean
          send_queue_id?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          hit_at?: string
          id?: string
          ip_address?: unknown
          is_apple_mpp?: boolean
          send_queue_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_pixel_hits_send_queue_id_fkey"
            columns: ["send_queue_id"]
            isOneToOne: false
            referencedRelation: "email_send_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_events: {
        Row: {
          created_at: string
          draft_id: string | null
          email_account_id: string | null
          event_at: string
          event_type: string
          id: string
          metadata: Json | null
          org_id: string
          send_queue_id: string | null
        }
        Insert: {
          created_at?: string
          draft_id?: string | null
          email_account_id?: string | null
          event_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          org_id: string
          send_queue_id?: string | null
        }
        Update: {
          created_at?: string
          draft_id?: string | null
          email_account_id?: string | null
          event_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          org_id?: string
          send_queue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_send_events_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "email_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_send_events_email_account_id_fkey"
            columns: ["email_account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_send_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_send_events_send_queue_id_fkey"
            columns: ["send_queue_id"]
            isOneToOne: false
            referencedRelation: "email_send_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_queue: {
        Row: {
          attempt_count: number
          body: string | null
          created_at: string
          draft_id: string | null
          email_account_id: string
          id: string
          last_error: string | null
          org_id: string
          scheduled_for: string
          sent_at: string | null
          smtp_message_id: string | null
          smtp_response: string | null
          status: string
          subject: string | null
          to_email: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          body?: string | null
          created_at?: string
          draft_id?: string | null
          email_account_id: string
          id?: string
          last_error?: string | null
          org_id: string
          scheduled_for: string
          sent_at?: string | null
          smtp_message_id?: string | null
          smtp_response?: string | null
          status?: string
          subject?: string | null
          to_email: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          body?: string | null
          created_at?: string
          draft_id?: string | null
          email_account_id?: string
          id?: string
          last_error?: string | null
          org_id?: string
          scheduled_for?: string
          sent_at?: string | null
          smtp_message_id?: string | null
          smtp_response?: string | null
          status?: string
          subject?: string | null
          to_email?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_send_queue_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "email_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_send_queue_email_account_id_fkey"
            columns: ["email_account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_send_queue_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_send_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      email_signature_templates: {
        Row: {
          body_html: string
          body_text: string
          brand_key: string
          created_at: string
          id: string
          org_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body_html: string
          body_text: string
          brand_key: string
          created_at?: string
          id?: string
          org_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body_html?: string
          body_text?: string
          brand_key?: string
          created_at?: string
          id?: string
          org_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_signature_templates_org_id_fkey"
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
          venue_id: string | null
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
          venue_id?: string | null
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
          venue_id?: string | null
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
            foreignKeyName: "field_visits_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
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
      inbox_placement_seeds: {
        Row: {
          created_at: string
          domain: string
          id: string
          org_id: string
          placement: string | null
          placement_recorded_at: string | null
          seed_address: string
          seed_provider: string
          sent_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          domain: string
          id?: string
          org_id: string
          placement?: string | null
          placement_recorded_at?: string | null
          seed_address: string
          seed_provider: string
          sent_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          domain?: string
          id?: string
          org_id?: string
          placement?: string | null
          placement_recorded_at?: string | null
          seed_address?: string
          seed_provider?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbox_placement_seeds_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_placement_seeds_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
      lead_search_runs: {
        Row: {
          cost_usd: number | null
          error_message: string | null
          finished_at: string | null
          id: string
          new_venue_count: number | null
          org_id: string
          result_count: number | null
          search_id: string
          started_at: string
          status: string
          triggered_by: string
        }
        Insert: {
          cost_usd?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          new_venue_count?: number | null
          org_id: string
          result_count?: number | null
          search_id: string
          started_at?: string
          status?: string
          triggered_by?: string
        }
        Update: {
          cost_usd?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          new_venue_count?: number | null
          org_id?: string
          result_count?: number | null
          search_id?: string
          started_at?: string
          status?: string
          triggered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_search_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_search_runs_search_id_fkey"
            columns: ["search_id"]
            isOneToOne: false
            referencedRelation: "lead_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_searches: {
        Row: {
          categories: string[]
          created_at: string | null
          email_extraction: boolean
          id: string
          last_run_at: string | null
          last_run_cost_usd: number | null
          last_run_result_count: number | null
          limit_per_run: number
          name: string
          org_id: string
          region: string
          schedule_cron: string | null
          source_engine: string
          suburb: string | null
          total_runs: number
          user_id: string
        }
        Insert: {
          categories: string[]
          created_at?: string | null
          email_extraction?: boolean
          id?: string
          last_run_at?: string | null
          last_run_cost_usd?: number | null
          last_run_result_count?: number | null
          limit_per_run?: number
          name: string
          org_id: string
          region?: string
          schedule_cron?: string | null
          source_engine: string
          suburb?: string | null
          total_runs?: number
          user_id: string
        }
        Update: {
          categories?: string[]
          created_at?: string | null
          email_extraction?: boolean
          id?: string
          last_run_at?: string | null
          last_run_cost_usd?: number | null
          last_run_result_count?: number | null
          limit_per_run?: number
          name?: string
          org_id?: string
          region?: string
          schedule_cron?: string | null
          source_engine?: string
          suburb?: string | null
          total_runs?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_searches_org_id_fkey"
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
      notification_log: {
        Row: {
          activity_id: string | null
          body: string | null
          channel: string
          created_at: string
          id: string
          kind: string
          org_id: string
          reason: string | null
          sent_at: string | null
          status: string
          target: string
          user_id: string
        }
        Insert: {
          activity_id?: string | null
          body?: string | null
          channel: string
          created_at?: string
          id?: string
          kind: string
          org_id: string
          reason?: string | null
          sent_at?: string | null
          status: string
          target: string
          user_id: string
        }
        Update: {
          activity_id?: string | null
          body?: string | null
          channel?: string
          created_at?: string
          id?: string
          kind?: string
          org_id?: string
          reason?: string | null
          sent_at?: string | null
          status?: string
          target?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_log_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_state_nonces: {
        Row: {
          created_at: string
          expires_at: string
          nonce: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          nonce: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          nonce?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_state_nonces_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
      postmaster_grades: {
        Row: {
          created_at: string
          domain: string
          grade: string
          id: string
          notes: string | null
          org_id: string
          recorded_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          domain: string
          grade: string
          id?: string
          notes?: string | null
          org_id: string
          recorded_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          domain?: string
          grade?: string
          id?: string
          notes?: string | null
          org_id?: string
          recorded_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "postmaster_grades_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postmaster_grades_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
      reply_scan_runs: {
        Row: {
          classified_replies: number
          email_account_id: string
          errors: string[] | null
          finished_at: string | null
          id: string
          matched_replies: number
          org_id: string
          scanned_messages: number
          started_at: string
          status: string
        }
        Insert: {
          classified_replies?: number
          email_account_id: string
          errors?: string[] | null
          finished_at?: string | null
          id?: string
          matched_replies?: number
          org_id: string
          scanned_messages?: number
          started_at?: string
          status?: string
        }
        Update: {
          classified_replies?: number
          email_account_id?: string
          errors?: string[] | null
          finished_at?: string | null
          id?: string
          matched_replies?: number
          org_id?: string
          scanned_messages?: number
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reply_scan_runs_email_account_id_fkey"
            columns: ["email_account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reply_scan_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      route_days: {
        Row: {
          anchor_lat: number | null
          anchor_lng: number | null
          anchor_venue_id: string | null
          created_at: string
          day_of_week: number
          generated_at: string | null
          id: string
          notes: string | null
          org_id: string
          prospect_share: number
          radius_km: number
          suburb_focus: string | null
          target_stops: number
          updated_at: string
          user_id: string
        }
        Insert: {
          anchor_lat?: number | null
          anchor_lng?: number | null
          anchor_venue_id?: string | null
          created_at?: string
          day_of_week: number
          generated_at?: string | null
          id?: string
          notes?: string | null
          org_id: string
          prospect_share?: number
          radius_km?: number
          suburb_focus?: string | null
          target_stops?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          anchor_lat?: number | null
          anchor_lng?: number | null
          anchor_venue_id?: string | null
          created_at?: string
          day_of_week?: number
          generated_at?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          prospect_share?: number
          radius_km?: number
          suburb_focus?: string | null
          target_stops?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_days_anchor_venue_id_fkey"
            columns: ["anchor_venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_days_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      route_stops: {
        Row: {
          created_at: string
          est_arrival_min: number | null
          est_drive_km: number | null
          field_visit_id: string | null
          id: string
          lead_score_cached: number | null
          org_id: string
          route_day_id: string
          stop_kind: string
          stop_order: number
          suburb_cached: string | null
          venue_id: string
          venue_name_cached: string
        }
        Insert: {
          created_at?: string
          est_arrival_min?: number | null
          est_drive_km?: number | null
          field_visit_id?: string | null
          id?: string
          lead_score_cached?: number | null
          org_id: string
          route_day_id: string
          stop_kind: string
          stop_order: number
          suburb_cached?: string | null
          venue_id: string
          venue_name_cached: string
        }
        Update: {
          created_at?: string
          est_arrival_min?: number | null
          est_drive_km?: number | null
          field_visit_id?: string | null
          id?: string
          lead_score_cached?: number | null
          org_id?: string
          route_day_id?: string
          stop_kind?: string
          stop_order?: number
          suburb_cached?: string | null
          venue_id?: string
          venue_name_cached?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_stops_field_visit_id_fkey"
            columns: ["field_visit_id"]
            isOneToOne: false
            referencedRelation: "field_visits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_stops_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_stops_route_day_id_fkey"
            columns: ["route_day_id"]
            isOneToOne: false
            referencedRelation: "route_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_stops_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
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
          contact_id: string | null
          current_step: number | null
          deal_id: string | null
          enrolled_at: string | null
          enrolled_by_user_id: string | null
          failure_count: number
          id: string
          last_status_message: string | null
          last_step_fired_at: string | null
          next_send_at: string | null
          next_step_due_at: string
          org_id: string
          processing_started_at: string | null
          sequence_id: string | null
          status: string | null
          step_snapshots: Json | null
        }
        Insert: {
          completed_at?: string | null
          contact_id?: string | null
          current_step?: number | null
          deal_id?: string | null
          enrolled_at?: string | null
          enrolled_by_user_id?: string | null
          failure_count?: number
          id?: string
          last_status_message?: string | null
          last_step_fired_at?: string | null
          next_send_at?: string | null
          next_step_due_at?: string
          org_id: string
          processing_started_at?: string | null
          sequence_id?: string | null
          status?: string | null
          step_snapshots?: Json | null
        }
        Update: {
          completed_at?: string | null
          contact_id?: string | null
          current_step?: number | null
          deal_id?: string | null
          enrolled_at?: string | null
          enrolled_by_user_id?: string | null
          failure_count?: number
          id?: string
          last_status_message?: string | null
          last_step_fired_at?: string | null
          next_send_at?: string | null
          next_step_due_at?: string
          org_id?: string
          processing_started_at?: string | null
          sequence_id?: string | null
          status?: string | null
          step_snapshots?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "sequence_enrollments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_enrollments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_enrollments_enrolled_by_user_id_fkey"
            columns: ["enrolled_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
          prompt_instructions: string | null
          sequence_id: string | null
          step_number: number
          step_type: string | null
          stop_on_meeting: boolean | null
          stop_on_reply: boolean | null
          subject_template: string | null
          template_variants: Json | null
        }
        Insert: {
          body_template?: string | null
          created_at?: string | null
          delay_days?: number
          id?: string
          org_id: string
          prompt_instructions?: string | null
          sequence_id?: string | null
          step_number: number
          step_type?: string | null
          stop_on_meeting?: boolean | null
          stop_on_reply?: boolean | null
          subject_template?: string | null
          template_variants?: Json | null
        }
        Update: {
          body_template?: string | null
          created_at?: string | null
          delay_days?: number
          id?: string
          org_id?: string
          prompt_instructions?: string | null
          sequence_id?: string | null
          step_number?: number
          step_type?: string | null
          stop_on_meeting?: boolean | null
          stop_on_reply?: boolean | null
          subject_template?: string | null
          template_variants?: Json | null
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
          created_by_user_id: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_canonical: boolean
          name: string
          org_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by_user_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_canonical?: boolean
          name: string
          org_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by_user_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_canonical?: boolean
          name?: string
          org_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sequences_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
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
          evidence_url: string | null
          headline: string | null
          id: string
          is_actioned: boolean | null
          org_id: string
          signal_source: string
          signal_type: string
          suburb: string | null
          venue_id: string | null
        }
        Insert: {
          actioned_at?: string | null
          contact_id?: string | null
          detail?: Json | null
          detected_at?: string | null
          evidence_url?: string | null
          headline?: string | null
          id?: string
          is_actioned?: boolean | null
          org_id: string
          signal_source: string
          signal_type: string
          suburb?: string | null
          venue_id?: string | null
        }
        Update: {
          actioned_at?: string | null
          contact_id?: string | null
          detail?: Json | null
          detected_at?: string | null
          evidence_url?: string | null
          headline?: string | null
          id?: string
          is_actioned?: boolean | null
          org_id?: string
          signal_source?: string
          signal_type?: string
          suburb?: string | null
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
          calendly_account_email: string | null
          calendly_test_booking_at: string | null
          calendly_token_encrypted: string | null
          calendly_url: string | null
          calendly_webhook_registered_at: string | null
          created_at: string | null
          default_commission_pct: number | null
          email: string | null
          email_notifications: Json
          email_signature: string | null
          full_name: string | null
          icp_config: Json | null
          id: string
          notify_quiet_hours_end: number | null
          notify_quiet_hours_start: number | null
          notify_warm_replies: boolean
          notify_whatsapp_e164: string | null
          org_id: string
          public_slug: string | null
          role: string | null
          send_timezone: string
          spam_act_sender_block: string | null
          voice_rules: string | null
          working_hours_end_local: number
          working_hours_start_local: number
        }
        Insert: {
          calendly_account_email?: string | null
          calendly_test_booking_at?: string | null
          calendly_token_encrypted?: string | null
          calendly_url?: string | null
          calendly_webhook_registered_at?: string | null
          created_at?: string | null
          default_commission_pct?: number | null
          email?: string | null
          email_notifications?: Json
          email_signature?: string | null
          full_name?: string | null
          icp_config?: Json | null
          id: string
          notify_quiet_hours_end?: number | null
          notify_quiet_hours_start?: number | null
          notify_warm_replies?: boolean
          notify_whatsapp_e164?: string | null
          org_id: string
          public_slug?: string | null
          role?: string | null
          send_timezone?: string
          spam_act_sender_block?: string | null
          voice_rules?: string | null
          working_hours_end_local?: number
          working_hours_start_local?: number
        }
        Update: {
          calendly_account_email?: string | null
          calendly_test_booking_at?: string | null
          calendly_token_encrypted?: string | null
          calendly_url?: string | null
          calendly_webhook_registered_at?: string | null
          created_at?: string | null
          default_commission_pct?: number | null
          email?: string | null
          email_notifications?: Json
          email_signature?: string | null
          full_name?: string | null
          icp_config?: Json | null
          id?: string
          notify_quiet_hours_end?: number | null
          notify_quiet_hours_start?: number | null
          notify_warm_replies?: boolean
          notify_whatsapp_e164?: string | null
          org_id?: string
          public_slug?: string | null
          role?: string | null
          send_timezone?: string
          spam_act_sender_block?: string | null
          voice_rules?: string | null
          working_hours_end_local?: number
          working_hours_start_local?: number
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
      vcglr_licences: {
        Row: {
          address: string | null
          category: string | null
          council: string | null
          first_seen_at: string
          last_seen_at: string
          lat: number | null
          licence_number: string
          licensee: string | null
          lng: number | null
          postcode: string | null
          region: string | null
          snapshot_date: string
          status: string
          suburb: string | null
          trading_hours: string | null
          trading_name: string | null
        }
        Insert: {
          address?: string | null
          category?: string | null
          council?: string | null
          first_seen_at?: string
          last_seen_at?: string
          lat?: number | null
          licence_number: string
          licensee?: string | null
          lng?: number | null
          postcode?: string | null
          region?: string | null
          snapshot_date: string
          status?: string
          suburb?: string | null
          trading_hours?: string | null
          trading_name?: string | null
        }
        Update: {
          address?: string | null
          category?: string | null
          council?: string | null
          first_seen_at?: string
          last_seen_at?: string
          lat?: number | null
          licence_number?: string
          licensee?: string | null
          lng?: number | null
          postcode?: string | null
          region?: string | null
          snapshot_date?: string
          status?: string
          suburb?: string | null
          trading_hours?: string | null
          trading_name?: string | null
        }
        Relationships: []
      }
      vcglr_signals: {
        Row: {
          detected_at: string
          event_type: string
          id: string
          licence_number: string
          payload: Json
          snapshot_date_after: string
          snapshot_date_before: string | null
        }
        Insert: {
          detected_at?: string
          event_type: string
          id?: string
          licence_number: string
          payload?: Json
          snapshot_date_after: string
          snapshot_date_before?: string | null
        }
        Update: {
          detected_at?: string
          event_type?: string
          id?: string
          licence_number?: string
          payload?: Json
          snapshot_date_after?: string
          snapshot_date_before?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vcglr_signals_licence_number_fkey"
            columns: ["licence_number"]
            isOneToOne: false
            referencedRelation: "vcglr_licences"
            referencedColumns: ["licence_number"]
          },
        ]
      }
      venue_groups: {
        Row: {
          abn: string | null
          created_at: string | null
          id: string
          name: string
          notes: string | null
          org_id: string
        }
        Insert: {
          abn?: string | null
          created_at?: string | null
          id?: string
          name: string
          notes?: string | null
          org_id: string
        }
        Update: {
          abn?: string | null
          created_at?: string | null
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_groups_org_id_fkey"
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
          about_blob: Json | null
          address: string | null
          archived: boolean
          avg_spend_tier: string | null
          business_status: string | null
          cid: string | null
          competitor_water_usage: string | null
          contact_enrichment_status: string
          cover_count: number | null
          created_at: string | null
          geocoded_at: string | null
          google_place_id: string | null
          group_id: string | null
          icp_score: number | null
          id: string
          is_excluded: boolean | null
          kgmid: string | null
          kitchen_type: string | null
          last_crawled_at: string | null
          last_visited_at: string | null
          lat: number | null
          licence_type: string | null
          licensing_status: string | null
          lng: number | null
          multi_site_flag: boolean
          name: string
          neighbourhood: string | null
          notes: string | null
          org_id: string
          phone: string | null
          place_id: string | null
          postcode: string | null
          rating: number | null
          review_count: number | null
          review_decided_at: string | null
          review_decided_by: string | null
          review_defer_until: string | null
          review_notes: string | null
          review_status: string
          seasonality_window: string | null
          service_style: string | null
          social_facebook: string | null
          social_instagram: string | null
          social_linkedin: string | null
          social_twitter: string | null
          source: string | null
          source_details: Json | null
          state: string | null
          suburb: string | null
          updated_at: string | null
          venue_type: string | null
          verified: boolean | null
          website: string | null
          working_hours: Json | null
        }
        Insert: {
          about_blob?: Json | null
          address?: string | null
          archived?: boolean
          avg_spend_tier?: string | null
          business_status?: string | null
          cid?: string | null
          competitor_water_usage?: string | null
          contact_enrichment_status?: string
          cover_count?: number | null
          created_at?: string | null
          geocoded_at?: string | null
          google_place_id?: string | null
          group_id?: string | null
          icp_score?: number | null
          id?: string
          is_excluded?: boolean | null
          kgmid?: string | null
          kitchen_type?: string | null
          last_crawled_at?: string | null
          last_visited_at?: string | null
          lat?: number | null
          licence_type?: string | null
          licensing_status?: string | null
          lng?: number | null
          multi_site_flag?: boolean
          name: string
          neighbourhood?: string | null
          notes?: string | null
          org_id: string
          phone?: string | null
          place_id?: string | null
          postcode?: string | null
          rating?: number | null
          review_count?: number | null
          review_decided_at?: string | null
          review_decided_by?: string | null
          review_defer_until?: string | null
          review_notes?: string | null
          review_status?: string
          seasonality_window?: string | null
          service_style?: string | null
          social_facebook?: string | null
          social_instagram?: string | null
          social_linkedin?: string | null
          social_twitter?: string | null
          source?: string | null
          source_details?: Json | null
          state?: string | null
          suburb?: string | null
          updated_at?: string | null
          venue_type?: string | null
          verified?: boolean | null
          website?: string | null
          working_hours?: Json | null
        }
        Update: {
          about_blob?: Json | null
          address?: string | null
          archived?: boolean
          avg_spend_tier?: string | null
          business_status?: string | null
          cid?: string | null
          competitor_water_usage?: string | null
          contact_enrichment_status?: string
          cover_count?: number | null
          created_at?: string | null
          geocoded_at?: string | null
          google_place_id?: string | null
          group_id?: string | null
          icp_score?: number | null
          id?: string
          is_excluded?: boolean | null
          kgmid?: string | null
          kitchen_type?: string | null
          last_crawled_at?: string | null
          last_visited_at?: string | null
          lat?: number | null
          licence_type?: string | null
          licensing_status?: string | null
          lng?: number | null
          multi_site_flag?: boolean
          name?: string
          neighbourhood?: string | null
          notes?: string | null
          org_id?: string
          phone?: string | null
          place_id?: string | null
          postcode?: string | null
          rating?: number | null
          review_count?: number | null
          review_decided_at?: string | null
          review_decided_by?: string | null
          review_defer_until?: string | null
          review_notes?: string | null
          review_status?: string
          seasonality_window?: string | null
          service_style?: string | null
          social_facebook?: string | null
          social_instagram?: string | null
          social_linkedin?: string | null
          social_twitter?: string | null
          source?: string | null
          source_details?: Json | null
          state?: string | null
          suburb?: string | null
          updated_at?: string | null
          venue_type?: string | null
          verified?: boolean | null
          website?: string | null
          working_hours?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "venues_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "venue_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venues_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venues_review_decided_by_fkey"
            columns: ["review_decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      warmup_messages: {
        Row: {
          active: boolean
          body: string
          created_at: string
          id: string
          kind: string
          language: string
          subject: string | null
          weight: number
        }
        Insert: {
          active?: boolean
          body: string
          created_at?: string
          id?: string
          kind: string
          language?: string
          subject?: string | null
          weight?: number
        }
        Update: {
          active?: boolean
          body?: string
          created_at?: string
          id?: string
          kind?: string
          language?: string
          subject?: string | null
          weight?: number
        }
        Relationships: []
      }
      warmup_threads: {
        Row: {
          created_at: string
          id: string
          last_send_at: string | null
          org_id: string
          recipient_account_id: string
          reply_count: number
          send_count: number
          sender_account_id: string
          status: string
          thread_subject: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_send_at?: string | null
          org_id: string
          recipient_account_id: string
          reply_count?: number
          send_count?: number
          sender_account_id: string
          status?: string
          thread_subject?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_send_at?: string | null
          org_id?: string
          recipient_account_id?: string
          reply_count?: number
          send_count?: number
          sender_account_id?: string
          status?: string
          thread_subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "warmup_threads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warmup_threads_recipient_account_id_fkey"
            columns: ["recipient_account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warmup_threads_sender_account_id_fkey"
            columns: ["sender_account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
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
      cron_job_run_status: {
        Row: {
          end_time: string | null
          http_content_type: string | null
          http_error: string | null
          http_status: number | null
          jobid: number | null
          jobname: string | null
          pg_cron_status: string | null
          runid: number | null
          start_time: string | null
        }
        Relationships: []
      }
      public_user_profiles: {
        Row: {
          calendly_url: string | null
          email: string | null
          full_name: string | null
          public_slug: string | null
        }
        Insert: {
          calendly_url?: string | null
          email?: string | null
          full_name?: string | null
          public_slug?: string | null
        }
        Update: {
          calendly_url?: string | null
          email?: string | null
          full_name?: string | null
          public_slug?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      auth_org_id: { Args: never; Returns: string }
      claim_send_queue_batch: {
        Args: { p_batch?: number }
        Returns: {
          body: string
          draft_id: string
          email_account_id: string
          id: string
          org_id: string
          subject: string
          to_email: string
        }[]
      }
      compute_inbox_reputation: {
        Args: { p_account_id: string }
        Returns: number
      }
      compute_lead_score: { Args: { p_contact_id: string }; Returns: number }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      generate_route_stops: {
        Args: { p_route_day_id: string; p_visited_lookback_days?: number }
        Returns: undefined
      }
      get_email_account_smtp: {
        Args: { p_account_id: string }
        Returns: {
          daily_send_cap: number
          display_name: string
          email_address: string
          org_id: string
          reply_to_address: string
          send_signature: string
          smtp_host: string
          smtp_password_encrypted: string
          smtp_port: number
          smtp_username: string
          status: string
          user_id: string
        }[]
      }
      haversine_km: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      is_suppressed: {
        Args: { p_email: string; p_org_id: string }
        Returns: boolean
      }
      leadflow_drain_crawl_queue: { Args: never; Returns: number }
      recompute_monthly_gate: {
        Args: { p_month: string; p_org_id: string; p_user_id: string }
        Returns: undefined
      }
      run_monthly_gate_forfeits: { Args: never; Returns: undefined }
      select_next_sender: {
        Args: { p_org_id: string }
        Returns: {
          brand: string | null
          created_at: string
          daily_send_cap: number
          display_name: string | null
          domain: string | null
          email_address: string
          icp_segment: string | null
          id: string
          last_bounce_at: string | null
          last_send_at: string | null
          last_warmup_send_at: string | null
          org_id: string
          reply_to_address: string | null
          reputation_score: number | null
          send_signature: string | null
          smtp_host: string
          smtp_password_encrypted: string | null
          smtp_port: number
          smtp_username: string
          status: string
          updated_at: string
          user_id: string
          warmup_day: number
          warmup_day_bumped_on: string | null
        }
        SetofOptions: {
          from: "*"
          to: "email_accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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
