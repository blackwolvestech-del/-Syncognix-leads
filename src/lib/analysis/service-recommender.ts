import type { AnalysisScores, Opportunity, ServiceRecommendation } from "@/types/analysis"
import { ANALYSIS_CONFIG, SERVICE_LABELS, type ServiceId } from "./config"

/*
 * Recommends services from the opportunities that were actually observed.
 * A service is only suggested when its own evidence is present, and the
 * reason quotes that evidence. Services with nothing to measure in this
 * version (Google Business Profile, review strategy, paid advertising) are
 * never suggested. The catalogue is generic: rename it in config.ts.
 */

const { thresholds: T, maxRecommendations } = ANALYSIS_CONFIG

const CONVERSION_FLAGS = ["NO_PRIMARY_CTA", "NO_CONTACT_FORM", "NO_QUOTE_CTA", "NO_BOOKING_FLOW", "NO_ORDER_OPTION", "NO_PHONE_CTA"]
const LOCAL_FLAGS = ["WEAK_LOCAL_SIGNALS", "NO_STRUCTURED_DATA", "NO_LOCAL_SCHEMA", "WEAK_TITLE_RELEVANCE", "NO_PHONE_ON_WEBSITE", "NO_ADDRESS_ON_WEBSITE", "PHONE_MISMATCH"]
const SEO_FLAGS = ["NOINDEX", "MISSING_TITLE", "GENERIC_TITLE", "WEAK_TITLE", "MISSING_META_DESCRIPTION", "WEAK_META_DESCRIPTION", "MISSING_H1", "MULTIPLE_H1", "MISSING_CANONICAL", "MISSING_IMAGE_ALT", "FEW_INTERNAL_LINKS"]
const CONTENT_FLAGS = ["THIN_CONTENT", "NO_SERVICE_PAGE", "WEAK_HEADING_STRUCTURE", "NO_TESTIMONIALS"]

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const

type Priority = ServiceRecommendation["priority"]

export function recommendServices(
  opportunities: Opportunity[],
  scores: Pick<AnalysisScores, "website" | "seo" | "conversion">
): ServiceRecommendation[] {
  const byCode = new Map(opportunities.map((opportunity) => [opportunity.code, opportunity]))
  const matching = (codes: string[]) => codes.flatMap((code) => byCode.get(code) ?? [])
  const has = (code: string) => byCode.has(code)
  const recommendations: ServiceRecommendation[] = []

  const add = (service: ServiceId, priority: Priority, evidence: Opportunity[], reason?: string) =>
    recommendations.push({
      service,
      label: SERVICE_LABELS[service],
      priority,
      // The reason is the evidence itself, not a sales line.
      reason: reason ?? evidence.slice(0, 3).map((item) => item.text).join(" "),
      evidence: evidence.map((item) => item.code),
    })

  // No own website: nothing else can be assessed, so this is the only recommendation.
  const noSite = matching(["NO_WEBSITE", "THIRD_PARTY_PAGE_ONLY"])
  if (noSite.length) {
    add("website_development", "high", noSite)
    return recommendations
  }

  const { website, seo, conversion } = scores
  if (website === null || seo === null || conversion === null) return recommendations

  // Redesign only when many independent structural gaps were observed.
  const structural = opportunities.filter((opportunity) => opportunity.area !== "local")
  if (structural.length >= T.redesignMinIssues && website <= T.redesignMaxWebsiteScore) {
    add(
      "website_redesign",
      "high",
      structural,
      `${structural.length} structural or functional gaps were observed on the homepage and its Website Score is ${website}/100. ${structural.slice(0, 2).map((item) => item.text).join(" ")}`
    )
  }

  const conversionGaps = matching(CONVERSION_FLAGS)
  if (conversionGaps.length && conversion < 70) {
    add(
      "conversion_optimization",
      conversion < 45 || has("NO_PRIMARY_CTA") ? "high" : conversionGaps.length >= 2 || conversion < 60 ? "medium" : "low",
      conversionGaps
    )
  }

  const localGaps = matching(LOCAL_FLAGS)
  const missingSchema = has("NO_STRUCTURED_DATA") || has("NO_LOCAL_SCHEMA")
  if (localGaps.length >= 2 || has("WEAK_LOCAL_SIGNALS")) {
    add("local_seo", has("WEAK_LOCAL_SIGNALS") && missingSchema ? "high" : localGaps.length >= 2 ? "medium" : "low", localGaps)
  }

  const seoGaps = matching(SEO_FLAGS)
  if (seoGaps.length >= 2 && seo < 75) {
    add("seo", seo < 45 || has("NOINDEX") || has("MISSING_TITLE") ? "high" : seo < 65 ? "medium" : "low", seoGaps)
  }

  const contentGaps = matching(CONTENT_FLAGS)
  if (contentGaps.length >= 2) {
    add("content_improvement", has("THIN_CONTENT") && has("NO_SERVICE_PAGE") ? "medium" : "low", contentGaps)
  }

  const social = matching(["NO_SOCIAL_PROFILES"])
  if (social.length) add("social_media", "low", social)

  // A site that already captures enquiries well: the visible gap isn't on the page.
  if (conversionGaps.length === 0 && conversion >= 70 && website >= 65) {
    add(
      "lead_generation",
      "low",
      [],
      `The homepage already has the elements needed to capture enquiries (Conversion Readiness ${conversion}/100), so it can support lead-generation campaigns.`
    )
  }

  return recommendations
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
    .slice(0, maxRecommendations)
}
