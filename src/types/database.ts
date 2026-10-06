/**
 * Hand-written Supabase schema types. Regenerate with
 * `npx supabase gen types typescript --project-id <id> > src/types/database.ts`
 * once the schema grows.
 */
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
        }
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
        }
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
    Views: Record<string, never>
    Functions: Record<string, never>
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

export type LeadStatus = "new" | "contacted" | "replied" | "qualified" | "archived"

export type Profile = Database["public"]["Tables"]["profiles"]["Row"]
export type Lead = Database["public"]["Tables"]["leads"]["Row"]
export type SearchHistoryEntry = Database["public"]["Tables"]["searches"]["Row"]
