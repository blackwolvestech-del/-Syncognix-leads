import type { LeadEnrichment, ProspectScore } from "./enrichment"

export type OsmElementType = "node" | "way" | "relation"

export type BusinessDataSource = "nominatim" | "overpass"

/** A clean, normalized US business returned by the search API. */
export interface BusinessSearchResult {
  /** Unique across element types, e.g. "node:123456". */
  osmId: string
  osmType: OsmElementType

  name: string

  website: string | null
  phone: string | null

  street: string | null
  city: string | null
  state: string | null
  postcode: string | null
  /** Full street address, or null when no street is known. */
  address: string | null

  /** Our category id (e.g. "plumber"), not the raw OSM tag. */
  category: string

  latitude: number | null
  longitude: number | null

  /** True when OpenStreetMap lists a brand for it (a chain location). */
  chain?: boolean

  country: "United States"
  countryCode: "US"
}

export interface BusinessSearchQuery {
  businessType: string
  location: string
  limit: number
}

export interface UsLocation {
  displayName: string
  latitude: number
  longitude: number
  city: string | null
  state: string | null
  postcode: string | null
  country: "United States"
  countryCode: "US"
}

/** A search result with its prospect score (see lib/scoring/prospect-score.ts). */
export type ScoredBusiness = BusinessSearchResult & { prospect: ProspectScore }

export interface BusinessSearchSuccessResponse {
  success: true
  query: BusinessSearchQuery & { normalizedBusinessType: string }
  searchLocation: UsLocation
  count: number
  businesses: ScoredBusiness[]
  meta: {
    provider: string
    radiusMeters: number
    /** Matching businesses found before `limit` was applied. */
    resultsBeforeLimit: number
    /** OpenStreetMap services that contributed results. */
    sources: BusinessDataSource[]
    /** True when served from the server's recent-results cache. */
    cached: boolean
    /** Set when results may be incomplete (e.g. a source was busy). */
    notice?: string
  }
  /** osmIds from these results the signed-in user has already saved. */
  savedOsmIds: string[]
  /** Stored decision-maker data the user already has for these results. */
  enrichments: LeadEnrichment[]
}

export interface BusinessSearchErrorResponse {
  success: false
  error: string
  /** Machine-readable reason, e.g. "location_not_us". */
  code: string
  supportedCategories?: string[]
}

export type BusinessSearchResponse =
  | BusinessSearchSuccessResponse
  | BusinessSearchErrorResponse

/** A supported business type as shown in the search form (no OSM tags). */
export interface CategoryOption {
  id: string
  label: string
  plural: string
  aliases: string[]
}

/** What the client sends to save leads: a search result plus its search. */
export interface SaveLeadsInput {
  businesses: BusinessSearchResult[]
  businessType: string
  location: string
}

export type SaveLeadsResult =
  | { ok: true; saved: number; alreadySaved: number; savedOsmIds: string[] }
  | { ok: false; message: string }
