/** Types shared by the server and the browser for Step 3 (scoring + enrichment). */

export interface ProspectScore {
  /** 0–100 suitability score from available business signals. Not a purchase probability. */
  score: number
  reasons: string[]
  opportunities: string[]
}

export type ProspectTier = "high" | "moderate" | "lower"

/** What is stored for a business after a provider lookup. */
export type StoredEnrichmentStatus = "enriched" | "partial" | "no_match"

/** Full set of states the UI can show for a business. */
export type EnrichmentStatus = "not_enriched" | "enriching" | StoredEnrichmentStatus | "failed"

/** Our normalized email verification outcome. */
export type VerificationStatus = "deliverable" | "risky" | "invalid" | "unknown"

export interface EmailVerification {
  status: VerificationStatus
  /** e.g. "hunter". */
  provider: string
  /** The provider's own wording, e.g. "accept_all". */
  providerStatus: string | null
  /** Provider confidence score (0–100) when given. */
  score: number | null
  verifiedAt: string
}

/** Decision-maker data for one business, as the UI consumes it. */
export interface LeadEnrichment {
  /** The Step 2 business id (OSM id, e.g. "node:123"). */
  businessId: string
  status: StoredEnrichmentStatus
  /** e.g. "prospeo". */
  provider: string
  person: {
    fullName: string | null
    firstName: string | null
    lastName: string | null
    title: string | null
    seniority: string | null
    linkedinUrl: string | null
  } | null
  email: {
    address: string
    /** The enrichment provider's own email status, e.g. "VERIFIED". */
    providerStatus: string | null
  } | null
  verification: EmailVerification | null
  enrichedAt: string
}

export type EnrichmentErrorCode =
  | "unauthorized"
  | "invalid_request"
  | "not_configured"
  | "invalid_key"
  | "quota_exhausted"
  | "plan_required"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "not_set_up"
  | "storage_failed"
  | "no_email"
  | "blocked"
  | "pending"
  | "internal_error"

export interface EnrichmentErrorResponse {
  success: false
  error: string
  code: EnrichmentErrorCode
  /** True when retrying other businesses would fail the same way (stop bulk runs). */
  fatal: boolean
}

export interface EnrichmentSuccessResponse {
  success: true
  enrichment: LeadEnrichment
  /** True when served from stored data without calling the provider. */
  cached: boolean
}

export type EnrichmentResponse = EnrichmentSuccessResponse | EnrichmentErrorResponse

export interface ProviderUsage {
  provider: "prospeo" | "hunter"
  configured: boolean
  /** Provider API calls made by this account through Syncognix this month. */
  requestsThisMonth: number
  /** Credits those calls are estimated to have used, when it could be determined. */
  creditsEstimatedThisMonth: number
  /** Official balance from the provider's account API, when available. */
  account: { plan: string | null; remaining: number | null; used: number | null } | null
}
