import type { EnrichmentErrorCode, VerificationStatus } from "@/types/enrichment"

/*
 * Provider-neutral contracts for Step 3. Core logic (service.ts, cache.ts,
 * the API routes and the UI) only ever sees these shapes, so adding another
 * provider later (Apollo, People Data Labs…) means writing one file that
 * implements EnrichmentProvider and listing it in provider.ts.
 */

/** What we send a provider about a business. No personal data. */
export interface BusinessInput {
  /** Step 2 business id (OSM id). */
  businessId: string
  companyName: string
  /** Normalized root domain ("abcroofing.com"), or null when there is no own website. */
  domain: string | null
  city: string | null
  /** USPS code ("TX") when known. */
  state: string | null
  country: "United States"
  /** Friendly category, e.g. "Roofing". */
  category: string
}

export type DecisionMakerStatus = "enriched" | "partial" | "no_match"

/** A provider's answer, normalized. Failures are thrown as ProviderError instead. */
export interface DecisionMakerResult {
  status: DecisionMakerStatus
  provider: string
  person?: {
    firstName?: string
    lastName?: string
    fullName?: string
    title?: string
    seniority?: string
    linkedinUrl?: string
  }
  email?: {
    address: string
    /** The provider's own status for the email, e.g. "VERIFIED". */
    providerStatus?: string
  }
  company?: { name?: string; domain?: string }
  rawProviderId?: string
  metadata: { enrichedAt: string }
}

/** One call made to a provider, reported for usage tracking. */
export interface ProviderCall {
  provider: string
  action: string
  success: boolean
  /** Only set when the provider's documented rules make the cost certain. */
  creditsEstimated: number | null
}

export type TrackCall = (call: ProviderCall) => void

export interface EnrichmentProvider {
  readonly id: string
  /** False when its API key is missing; unconfigured providers are skipped. */
  isConfigured(): boolean
  findDecisionMaker(input: BusinessInput, track: TrackCall): Promise<DecisionMakerResult>
}

export interface EmailVerificationResult {
  email: string
  status: VerificationStatus
  provider: string
  providerStatus: string | null
  score: number | null
  verifiedAt: string
}

export interface EmailVerifier {
  readonly id: string
  isConfigured(): boolean
  verifyEmail(email: string, track: TrackCall): Promise<EmailVerificationResult>
}

/** User-safe messages. Provider wording and stack traces never reach the UI. */
const MESSAGES: Record<EnrichmentErrorCode, string> = {
  unauthorized: "You need to be signed in to do this.",
  invalid_request: "That request wasn't valid. Please refresh the page and try again.",
  not_configured: "Enrichment provider is not configured.",
  invalid_key: "The provider rejected the API key. Check the key in your environment settings.",
  quota_exhausted: "Your enrichment provider limit may have been reached.",
  plan_required: "Your provider plan doesn't include this lookup.",
  rate_limited: "Too many requests right now. Please wait a minute and try again.",
  timeout: "The provider took too long to respond. Please try again.",
  unavailable: "The provider is temporarily unavailable. Please try again.",
  not_set_up:
    "Enrichment storage isn't set up yet. Run the 20261003 migration in Supabase, then try again.",
  storage_failed: "We couldn't store the result. Please try again.",
  no_email: "There is no email address to verify for this business.",
  blocked: "This email address can't be processed at its owner's request.",
  pending: "Verification is still in progress. Please try again in a minute.",
  internal_error: "Something went wrong. Please try again.",
}

/** Errors that would hit every other business in a bulk run the same way. */
const FATAL: ReadonlySet<EnrichmentErrorCode> = new Set([
  "unauthorized",
  "not_configured",
  "invalid_key",
  "quota_exhausted",
  "plan_required",
  "not_set_up",
])

/**
 * An enrichment failure whose `message` is always safe to show to users.
 * Technical details go in `detail`, which is only logged server-side.
 */
export class EnrichmentError extends Error {
  readonly code: EnrichmentErrorCode
  readonly status: number
  readonly detail?: string

  constructor(code: EnrichmentErrorCode, options: { message?: string; detail?: string; status?: number } = {}) {
    super(options.message ?? MESSAGES[code])
    this.name = "EnrichmentError"
    this.code = code
    this.detail = options.detail
    this.status = options.status ?? DEFAULT_STATUS[code] ?? 502
  }

  get fatal() {
    return FATAL.has(this.code)
  }
}

const DEFAULT_STATUS: Partial<Record<EnrichmentErrorCode, number>> = {
  unauthorized: 401,
  invalid_request: 400,
  not_configured: 503,
  rate_limited: 429,
  quota_exhausted: 402,
  plan_required: 402,
  timeout: 504,
  no_email: 400,
  blocked: 451,
  pending: 202,
  not_set_up: 503,
  storage_failed: 500,
  internal_error: 500,
}
