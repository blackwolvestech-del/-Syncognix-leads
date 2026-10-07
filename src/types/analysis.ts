/** Types shared by the server and the browser for Step 4 (business analysis). */

/**
 * complete             the homepage was fetched and analyzed
 * partial              only business data could be analyzed (no own website, or
 *                      the page's content couldn't be read reliably)
 * website_unavailable  a website is listed but couldn't be fetched
 * failed               the analysis itself failed (never stored)
 */
export type AnalysisStatus = "complete" | "partial" | "website_unavailable" | "failed"

/** Why the website part of an analysis is missing or limited. */
export type WebsiteIssue =
  | "no_website"
  | "third_party_page"
  | "invalid_url"
  | "blocked_address"
  | "dns_failure"
  | "timeout"
  | "connection_failed"
  | "ssl_error"
  | "too_many_redirects"
  | "access_denied"
  | "robots_disallowed"
  | "http_error"
  | "not_html"
  | "client_rendered"

export type CtaKind = "quote" | "booking" | "order" | "call" | "contact" | "start"

export type FormKind = "contact" | "newsletter" | "search" | "login" | "other"

export type SocialPlatform = "facebook" | "instagram" | "linkedin" | "youtube" | "tiktok" | "x"

export type ImportantPage =
  | "services"
  | "about"
  | "contact"
  | "service_areas"
  | "pricing"
  | "testimonials"
  | "faq"
  | "gallery"
  | "team"
  | "booking"
  | "blog"
  | "locations"

/** Facts read from the fetched homepage HTML. Nothing here is inferred. */
export interface WebsiteAnalysis {
  requestedUrl: string
  finalUrl: string
  statusCode: number
  redirectCount: number
  contentType: string | null
  /** Time until the server's final response headers arrived. Not a page-speed metric. */
  responseTimeMs: number
  https: boolean
  /** Only known when the listed address was http://; null when it wasn't tested. */
  httpRedirectsToHttps: boolean | null
  htmlBytes: number
  /** True when the page was larger than the size limit and only the start was read. */
  truncated: boolean
  /** True when the HTML has almost no text but loads scripts (typical of pages rendered in the browser). */
  clientRendered: boolean

  title: string | null
  titleGeneric: boolean
  titleHasBusinessName: boolean
  /** null when the business has no city on record. */
  titleHasLocation: boolean | null
  titleHasService: boolean
  metaDescription: string | null
  h1Texts: string[]
  h1Count: number
  h2Texts: string[]
  h2Count: number
  hasViewport: boolean
  /** e.g. "CSS media queries", "Bootstrap grid classes". Hints only, not a usability test. */
  responsiveHints: string[]
  canonicalUrl: string | null
  robotsMeta: string | null
  noindex: boolean
  lang: string | null
  hasFavicon: boolean
  wordCount: number

  imageCount: number
  /** Images with no alt attribute at all. */
  missingAltCount: number
  /** Images with alt="" (valid for decorative images). */
  emptyAltCount: number
  internalLinkCount: number
  externalLinkCount: number

  schemaTypes: string[]
  hasLocalBusinessSchema: boolean
  hasOrganizationSchema: boolean

  ctas: { text: string; kind: CtaKind }[]
  hasPhoneCta: boolean
  hasEmailCta: boolean
  hasQuoteCta: boolean
  hasBookingCta: boolean
  hasOrderCta: boolean
  /** Distinct links/buttons that ask for an action (quote, booking, order, contact, get started). */
  primaryCtaCount: number
  ctaClarity: "strong" | "moderate" | "weak"
  forms: { kind: FormKind; fields: string[] }[]
  hasContactForm: boolean
  /** A third-party form embed (HubSpot, Typeform…) whose fields aren't in the HTML. */
  embeddedForm: string | null

  socialProfiles: { platform: SocialPlatform; url: string }[]
  phones: string[]
  emails: string[]
  /** null when the business has no phone on record to compare with. */
  phoneMatchesListing: boolean | null
  addressFound: boolean
  contactPageUrl: string | null
  /** null when the business has no city / state on record. */
  cityMentioned: boolean | null
  stateMentioned: boolean | null
  serviceAreaLanguage: boolean
  serviceTermsFound: string[]
  detectedPages: ImportantPage[]
}

export type ScoreKey = "website" | "seo" | "conversion" | "localPresence" | "opportunity" | "qualifiedLead"

/** null = it couldn't be measured. Never shown as 0. */
export type AnalysisScores = Record<ScoreKey, number | null>

/** One line of a score's breakdown. */
export interface ScoreFactor {
  label: string
  earned: number
  max: number
  /** False when the signal couldn't be measured; it is then left out of the score. */
  measured: boolean
  note?: string
}

/** An observation with the evidence behind it. `code` is a reusable flag. */
export interface Finding {
  code: string
  text: string
}

/** A gap observed for the business, with the improvement it suggests. */
export interface Opportunity extends Finding {
  area: "website" | "seo" | "conversion" | "local" | "content"
  action: string
}

export interface ServiceRecommendation {
  /** Stable id, e.g. "local_seo". */
  service: string
  label: string
  priority: "high" | "medium" | "low"
  reason: string
  /** Flags (Finding codes) that justify the recommendation. */
  evidence: string[]
}

export interface QualificationComponent {
  key: string
  label: string
  /** 0–100, or null when it couldn't be measured (its weight is redistributed). */
  value: number | null
  weight: number
}

/** The decision maker as known when the lead was last qualified. */
export interface AnalysisContact {
  name: string | null
  title: string | null
  email: string | null
  ownerLevel: boolean
}

export interface BusinessAnalysis {
  /** Bumped when the analysis rules change, so older stored results are redone. */
  version: number
  /** The Step 2 business id (OSM id, e.g. "node:123"). */
  businessId: string
  business: {
    name: string
    category: string
    categoryLabel: string
    city: string | null
    state: string | null
    website: string | null
    phone: string | null
  }

  status: Exclude<AnalysisStatus, "failed">
  websiteIssue: WebsiteIssue | null
  /** User-safe sentence explaining `websiteIssue`. */
  websiteNote: string | null
  website: WebsiteAnalysis | null

  scores: AnalysisScores
  breakdown: {
    technical: ScoreFactor[]
    seo: ScoreFactor[]
    conversion: ScoreFactor[]
    localPresence: ScoreFactor[]
    content: ScoreFactor[]
  }
  qualification: {
    prospectScore: number
    components: QualificationComponent[]
    reasons: string[]
  }

  strengths: Finding[]
  /** Observed gaps (pain points), each with its evidence and suggested action. */
  opportunities: Opportunity[]
  recommendedServices: ServiceRecommendation[]
  /** Label of the highest-priority recommendation. */
  topOpportunity: string | null
  flags: string[]
  /** Signals this version can't measure (e.g. ratings, rankings). */
  notMeasured: string[]

  contact: AnalysisContact | null
  analyzedAt: string
}

/** Progress stages reported while an analysis runs, in order. */
export type AnalysisStage = "cache" | "connecting" | "structure" | "seo" | "conversion" | "scoring" | "saving"

export interface AnalysisSuccessResponse {
  success: true
  analysis: BusinessAnalysis
  /** True when served from stored data without fetching the website. */
  cached: boolean
}

export interface AnalysisErrorResponse {
  success: false
  error: string
  code: string
  /** True when retrying other businesses would fail the same way (stop bulk runs). */
  fatal: boolean
}

export type AnalysisResponse = AnalysisSuccessResponse | AnalysisErrorResponse

/** One line of the analysis route's NDJSON stream. */
export type AnalysisStreamEvent = { stage: AnalysisStage } | AnalysisResponse
