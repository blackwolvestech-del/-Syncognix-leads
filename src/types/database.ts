/**
 * Hand-written Supabase schema types. Regenerate with
 * `npx supabase gen types typescript --project-id <id> > src/types/database.ts`
 * once the schema grows.
 */
import type { ContactStatus, PipelineStage, Priority } from "@/lib/pipeline/config"
import type { BusinessAnalysis, Finding, ServiceRecommendation } from "./analysis"

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string | null
          avatar_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          full_name?: string | null
          avatar_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          id: string
          user_id: string
          osm_id: string
          osm_type: "node" | "way" | "relation"
          name: string
          website: string | null
          phone: string | null
          street: string | null
          city: string | null
          state: string | null
          postcode: string | null
          address: string | null
          category: string
          latitude: number | null
          longitude: number | null
          search_business_type: string | null
          search_location: string | null
          status: LeadStatus
          /** Optional until the 20261002 migration has been applied. */
          source?: string
          country?: string
          country_code?: string
          /** Optional until the 20261003 migration has been applied. */
          is_chain?: boolean | null
          created_at: string
          updated_at: string
          /** Optional until the 20261008 migration has been applied. */
        } & Partial<LeadPipelineFields>
        Insert: {
          id?: string
          user_id?: string
          osm_id: string
          osm_type: "node" | "way" | "relation"
          name: string
          website?: string | null
          phone?: string | null
          street?: string | null
          city?: string | null
          state?: string | null
          postcode?: string | null
          address?: string | null
          category: string
          latitude?: number | null
          longitude?: number | null
          search_business_type?: string | null
          search_location?: string | null
          is_chain?: boolean | null
          prospect_score?: number | null
          status?: LeadStatus
          created_at?: string
          updated_at?: string
        }
        Update: {
          website?: string | null
          phone?: string | null
          street?: string | null
          city?: string | null
          state?: string | null
          postcode?: string | null
          address?: string | null
          status?: LeadStatus
          updated_at?: string
        } & Partial<LeadPipelineFields>
        Relationships: []
      }
      lead_lists: {
        Row: { id: string; user_id: string; name: string; description: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; user_id?: string; name: string; description?: string | null }
        Update: { name?: string; description?: string | null }
        Relationships: []
      }
      lead_list_members: {
        Row: { id: string; list_id: string; lead_id: string; user_id: string; added_at: string }
        Insert: { id?: string; list_id: string; lead_id: string; user_id?: string }
        Update: Record<string, never>
        Relationships: []
      }
      tags: {
        Row: { id: string; user_id: string; name: string; created_at: string }
        Insert: { id?: string; user_id?: string; name: string }
        Update: { name?: string }
        Relationships: []
      }
      lead_tags: {
        Row: { id: string; lead_id: string; tag_id: string; user_id: string; created_at: string }
        Insert: { id?: string; lead_id: string; tag_id: string; user_id?: string }
        Update: Record<string, never>
        Relationships: []
      }
      lead_notes: {
        Row: { id: string; lead_id: string; user_id: string; content: string; created_at: string; updated_at: string }
        Insert: { id?: string; lead_id: string; user_id?: string; content: string }
        Update: { content?: string }
        Relationships: []
      }
      lead_activity: {
        Row: {
          id: string
          lead_id: string
          user_id: string
          action: string
          metadata: Record<string, unknown>
          created_at: string
        }
        Insert: { id?: string; lead_id: string; user_id?: string; action: string; metadata?: Record<string, unknown> }
        Update: Record<string, never>
        Relationships: []
      }
      lead_enrichments: {
        Row: LeadEnrichmentRow
        Insert: Omit<LeadEnrichmentRow, "id" | "user_id" | "created_at" | "updated_at" | "enriched_at"> & {
          id?: string
          user_id?: string
          enriched_at?: string
        }
        Update: Partial<Omit<LeadEnrichmentRow, "id" | "user_id" | "created_at">>
        Relationships: []
      }
      business_analyses: {
        Row: BusinessAnalysisRow
        Insert: Omit<BusinessAnalysisRow, "id" | "user_id" | "created_at" | "updated_at"> & {
          id?: string
          user_id?: string
        }
        Update: Partial<Omit<BusinessAnalysisRow, "id" | "user_id" | "created_at">>
        Relationships: []
      }
      api_usage: {
        Row: {
          id: string
          user_id: string
          provider: string
          action: string
          business_id: string | null
          email: string | null
          success: boolean
          credits_estimated: number | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          provider: string
          action: string
          business_id?: string | null
          email?: string | null
          success: boolean
          credits_estimated?: number | null
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: []
      }
      searches: {
        Row: {
          id: string
          user_id: string
          business_type: string
          location: string
          result_count: number
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          business_type: string
          location: string
          result_count?: number
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: []
      }
    }
    Views: {
      lead_overview: {
        Row: LeadOverviewRow
        Relationships: []
      }
    }
    Functions: {
      lead_pipeline_counts: {
        Args: Record<string, never>
        Returns: { pipeline_stage: string; total: number }[]
      }
      lead_list_counts: {
        Args: Record<string, never>
        Returns: { list_id: string; total: number }[]
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type LeadEnrichmentRow = {
  id: string
  user_id: string
  business_id: string
  business_name: string
  business_name_key: string
  business_domain: string | null
  business_city: string | null
  business_state: string | null
  provider: string
  enrichment_status: "enriched" | "partial" | "no_match"
  provider_person_id: string | null
  contact_first_name: string | null
  contact_last_name: string | null
  contact_full_name: string | null
  contact_title: string | null
  contact_seniority: string | null
  linkedin_url: string | null
  work_email: string | null
  email_status: string | null
  prospect_score: number | null
  verification_status: "deliverable" | "risky" | "invalid" | "unknown" | null
  verification_provider: string | null
  verification_provider_status: string | null
  verification_score: number | null
  email_verified_at: string | null
  enriched_at: string
  created_at: string
  updated_at: string
}

/** Columns added to `leads` in Step 5. */
export type LeadPipelineFields = {
  pipeline_stage: PipelineStage
  priority: Priority
  contact_status: ContactStatus
  follow_up_at: string | null
  follow_up_note: string | null
  assigned_to: string | null
  is_archived: boolean
  archived_at: string | null
  estimated_value: number | null
  actual_value: number | null
  currency: string
  /** Step 3 prospect score, stored for sorting; null until first computed. */
  prospect_score: number | null
}

/** One row of the `lead_overview` view: a lead with its contact, scores, tags and lists. */
export type LeadOverviewRow = Database["public"]["Tables"]["leads"]["Row"] &
  LeadPipelineFields & {
    enrichment_status: "enriched" | "partial" | "no_match" | null
    contact_full_name: string | null
    contact_title: string | null
    work_email: string | null
    linkedin_url: string | null
    verification_status: "deliverable" | "risky" | "invalid" | "unknown" | null
    has_decision_maker: boolean
    has_email: boolean
    analysis_status: "complete" | "partial" | "website_unavailable" | "failed" | null
    website_score: number | null
    seo_score: number | null
    conversion_score: number | null
    local_presence_score: number | null
    opportunity_score: number | null
    qualified_lead_score: number | null
    top_opportunity: string | null
    recommended_services: ServiceRecommendation[] | null
    is_analyzed: boolean
    /** Decision maker + professional email + scored analysis. */
    outreach_ready: boolean
    priority_rank: number
    list_ids: string[]
    tag_ids: string[]
    tag_names: string[]
    tags_text: string | null
  }

export type BusinessAnalysisRow = {
  id: string
  user_id: string
  business_id: string
  business_name: string
  business_domain: string | null
  analysis_status: "complete" | "partial" | "website_unavailable" | "failed"
  /** Scores are null when they could not be measured. */
  website_score: number | null
  seo_score: number | null
  conversion_score: number | null
  local_presence_score: number | null
  opportunity_score: number | null
  qualified_lead_score: number | null
  top_opportunity: string | null
  strengths: Finding[]
  /** Observed gaps, with their evidence. */
  weaknesses: Finding[]
  /** Suggested improvements, one per observed gap. */
  opportunities: string[]
  recommended_services: ServiceRecommendation[]
  flags: string[]
  analysis_data: BusinessAnalysis
  analyzed_at: string
  created_at: string
  updated_at: string
}

export type LeadStatus = "new" | "contacted" | "replied" | "qualified" | "archived"

export type Profile = Database["public"]["Tables"]["profiles"]["Row"]
export type Lead = Database["public"]["Tables"]["leads"]["Row"]
export type SearchHistoryEntry = Database["public"]["Tables"]["searches"]["Row"]
