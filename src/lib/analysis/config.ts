import { brand } from "@/config/brand"
import type { CtaKind } from "@/types/analysis"

/*
 * Every tunable number for Step 4 lives here: request limits, cache period,
 * concurrency and score weights. Nothing in this file is specific to one
 * agency — services and weights are generic and can be changed freely.
 */

function envInt(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

export const ANALYSIS_CONFIG = {
  /** Bump when scoring rules change so stored analyses are redone on next request. */
  version: 1,

  fetch: {
    /** Hard limit for one request, connection to last byte. */
    timeoutMs: 12_000,
    /** Hard limit for the whole fetch, redirects and robots.txt included. */
    totalTimeoutMs: 20_000,
    /** Only this much HTML is read; larger pages are analyzed from their start. */
    maxHtmlBytes: 2_000_000,
    maxRedirects: 5,
    /** robots.txt is small; anything bigger is ignored. */
    robotsTimeoutMs: 5_000,
    maxRobotsBytes: 200_000,
    /** Honor robots.txt Disallow rules for the homepage. */
    respectRobotsTxt: true,
    /** Website requests in flight at once across the whole server process. */
    maxConcurrentRequests: 3,
    /** Token matched against robots.txt User-agent lines. */
    robotsToken: "SyncognixLeads",
    userAgent: `${brand.userAgentName}/0.1 (business website analysis; one homepage request)`,
  },

  cache: {
    /** A stored analysis is reused for this long. Override with BUSINESS_ANALYSIS_CACHE_DAYS. */
    days: envInt("BUSINESS_ANALYSIS_CACHE_DAYS", 30, 1, 365),
    /** "Website unavailable" results are retried sooner: the site may just have been down. */
    unavailableDays: 1,
  },

  /** Businesses analyzed at once during a bulk run (browser side). */
  bulkConcurrency: 3,

  /** Points per signal. Each group adds up to 100. */
  weights: {
    technical: {
      reachable: 30,
      https: 30,
      viewport: 20,
      responseTime: 10,
      lang: 5,
      favicon: 5,
    },
    seo: {
      title: 15,
      metaDescription: 10,
      h1: 15,
      headingStructure: 10,
      canonical: 5,
      imageAlt: 10,
      localRelevance: 15,
      structuredData: 10,
      internalLinks: 10,
    },
    conversion: {
      primaryCta: 25,
      phoneCta: 15,
      contactForm: 20,
      bookingOrQuote: 15,
      contactInfo: 10,
      serviceClarity: 10,
      trust: 5,
    },
    localPresence: {
      businessPhone: 15,
      streetAddress: 15,
      cityAndState: 10,
      ownWebsite: 15,
      cityOnWebsite: 12,
      stateOnWebsite: 5,
      phoneOnWebsite: 8,
      addressOnWebsite: 8,
      localSchema: 7,
      serviceAreaLanguage: 5,
    },
    content: {
      servicesPage: 25,
      contactPage: 20,
      aboutPage: 15,
      testimonials: 10,
      faq: 10,
      gallery: 10,
      bodyText: 10,
    },
    /** How the Website Score combines the groups above. Adds up to 100. */
    website: { technical: 25, seo: 25, conversion: 25, local: 15, content: 10 },
    /** How visible room for improvement is combined into the Opportunity Score. */
    opportunity: { website: 40, conversion: 30, seo: 30 },
    /** Qualified Lead Score. Components that can't be measured are left out and the rest rescaled. */
    qualifiedLead: {
      prospect: 25,
      decisionMaker: 15,
      contact: 10,
      websiteOpportunity: 20,
      seoOpportunity: 10,
      conversionOpportunity: 10,
      localStrength: 10,
    },
  },

  thresholds: {
    /** Server response slower than this earns no response-time points. */
    slowResponseMs: 3_000,
    title: { min: 25, max: 65 },
    metaDescription: { min: 70, max: 170 },
    /** Fewer words than this on the homepage counts as thin content. */
    thinContentWords: 150,
    /** Fewer words than this (with scripts present) means the page renders in the browser. */
    clientRenderedWords: 40,
    /** Server response at or under this earns full response-time points. */
    fastResponseMs: 1_000,
    /** A homepage marked noindex can score no higher than this on SEO fundamentals. */
    noindexSeoCap: 30,
    /** Homepage words needed for full body-text points. */
    solidContentWords: 250,
    /** Share of images without an alt attribute above which it is flagged. */
    missingAltShare: 0.3,
    /** Opportunity assigned when there is no website at all / only a third-party page. */
    noWebsiteOpportunity: 90,
    thirdPartyPageOpportunity: 80,
    /** Structural gaps needed (with a low Website Score) before a redesign is suggested. */
    redesignMinIssues: 6,
    redesignMaxWebsiteScore: 45,
  },

  maxRecommendations: 4,
} as const

/** Qualified Lead / score tiers, shared by every score indicator. */
export const ANALYSIS_TIERS = { high: 80, moderate: 60 } as const

export type AnalysisTier = "high" | "moderate" | "lower"

export function analysisTier(score: number): AnalysisTier {
  if (score >= ANALYSIS_TIERS.high) return "high"
  if (score >= ANALYSIS_TIERS.moderate) return "moderate"
  return "lower"
}

export const QUALIFIED_TIER_LABELS: Record<AnalysisTier, string> = {
  high: "High-potential prospect",
  moderate: "Moderate-potential prospect",
  lower: "Lower-potential prospect",
}

/** Services the engine can recommend. Rename or remove freely; rules live in service-recommender.ts. */
export const SERVICE_LABELS = {
  website_development: "Website Development",
  website_redesign: "Website Redesign",
  conversion_optimization: "Conversion Optimization",
  local_seo: "Local SEO",
  seo: "SEO",
  content_improvement: "Content Improvement",
  social_media: "Social Media",
  lead_generation: "Lead Generation",
} as const

export type ServiceId = keyof typeof SERVICE_LABELS

/**
 * What a visitor is normally expected to do on a site in each category, so a
 * car wash isn't marked down for having no quote form.
 */
export interface CategoryProfile {
  /** The action a booking/quote check looks for; "none" skips that check. */
  action: "quote" | "booking" | "order" | "any" | "none"
  expectsContactForm: boolean
  /** Words that show the page talks about this kind of service. */
  terms: string[]
}

const DEFAULT_PROFILE: CategoryProfile = { action: "any", expectsContactForm: true, terms: [] }

const CATEGORY_PROFILES: Record<string, CategoryProfile> = {
  plumber: { action: "quote", expectsContactForm: true, terms: ["plumb", "drain", "water heater", "leak", "sewer", "pipe"] },
  electrician: { action: "quote", expectsContactForm: true, terms: ["electric", "wiring", "panel", "lighting", "outlet", "generator"] },
  roofing: { action: "quote", expectsContactForm: true, terms: ["roof", "shingle", "gutter", "siding", "storm damage"] },
  landscaping: { action: "quote", expectsContactForm: true, terms: ["landscap", "lawn", "garden", "irrigation", "mowing", "hardscap"] },
  cleaning: { action: "quote", expectsContactForm: true, terms: ["clean", "janitorial", "maid", "housekeeping", "sanitiz"] },
  hvac: { action: "quote", expectsContactForm: true, terms: ["hvac", "heating", "cooling", "air condition", "furnace", "heat pump"] },
  dentist: { action: "booking", expectsContactForm: true, terms: ["dent", "teeth", "tooth", "orthodont", "implant", "oral"] },
  "car repair": { action: "booking", expectsContactForm: true, terms: ["auto repair", "car repair", "mechanic", "brake", "oil change", "engine", "transmission"] },
  "auto detailing": { action: "booking", expectsContactForm: true, terms: ["detail", "ceramic coating", "paint correction", "wax", "interior clean"] },
  restaurant: { action: "order", expectsContactForm: false, terms: ["menu", "dine", "dining", "cuisine", "restaurant", "catering"] },
  "car wash": { action: "none", expectsContactForm: false, terms: ["car wash", "wash", "detail", "membership", "vacuum"] },
}

export function categoryProfile(category: string): CategoryProfile {
  return CATEGORY_PROFILES[category.toLowerCase()] ?? DEFAULT_PROFILE
}

/** Which CTA kinds satisfy each expected action. */
export const ACTION_CTA_KINDS: Record<Exclude<CategoryProfile["action"], "none">, CtaKind[]> = {
  quote: ["quote", "booking"],
  booking: ["booking", "quote"],
  order: ["order", "booking"],
  any: ["quote", "booking", "order"],
}

/** Signals no free source can provide; always reported as not measured. */
export const NOT_MEASURED = [
  "Google rating and review count (not available from OpenStreetMap)",
  "Search rankings, keyword positions and search volume",
  "Core Web Vitals and real page speed",
  "Mobile usability (only responsive configuration is checked)",
  "Name/address/phone consistency across other websites",
] as const
