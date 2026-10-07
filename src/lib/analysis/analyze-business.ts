import { getCategoryLabel } from "@/lib/business-search/normalize-category"
import { decisionMakerRank } from "@/lib/enrichment/decision-maker"
import { businessDomain } from "@/lib/enrichment/normalize"
import { scoreProspect } from "@/lib/scoring/prospect-score"
import type {
  AnalysisStage,
  BusinessAnalysis,
  Finding,
  Opportunity,
  QualificationComponent,
  WebsiteAnalysis,
  WebsiteIssue,
} from "@/types/analysis"
import type { BusinessSearchResult } from "@/types/business"
import type { LeadEnrichment } from "@/types/enrichment"
import { ANALYSIS_CONFIG, NOT_MEASURED, categoryProfile } from "./config"
import { listingStrengths, siteFindings } from "./findings"
import { analyzePage, type PageInput } from "./page-analyzer"
import {
  contentFactors,
  conversionFactors,
  localPresenceFactors,
  seoFactors,
  seoScore,
  technicalFactors,
  totalScore,
  weightedScore,
} from "./score-engine"
import { recommendServices } from "./service-recommender"

/*
 * Combines the fetched homepage (when there is one) with the Step 2 listing
 * and the Step 3 contact data into one BusinessAnalysis. Pure: no network,
 * no database. A score that can't be measured is null — never zero.
 */

const { weights: W, thresholds: T } = ANALYSIS_CONFIG

/** What the fetch produced, or null when there was nothing to fetch. */
export type PageOutcome =
  | { ok: true; page: PageInput }
  | { ok: false; issue: WebsiteIssue; statusCode?: number }

/** The URL to analyze, or why there isn't one. */
export function websiteTarget(business: Pick<BusinessSearchResult, "website">):
  | { url: string }
  | { issue: "no_website" | "third_party_page" } {
  if (!business.website) return { issue: "no_website" }
  // Facebook, Yelp and similar pages aren't the business's own site.
  return businessDomain(business.website) ? { url: business.website } : { issue: "third_party_page" }
}

const ISSUE_NOTES: Record<WebsiteIssue, string> = {
  no_website: "No website is listed for this business. Business data analysis completed.",
  third_party_page:
    "The listed website is a third-party page, not a site on the business's own domain, so there is no website to analyze. Business data analysis completed.",
  invalid_url: "Website analysis unavailable: the listed address isn't a valid web address.",
  blocked_address: "Website analysis unavailable: the listed address can't be analyzed.",
  dns_failure: "Website unavailable: its domain could not be found.",
  timeout: "Website unavailable: it took too long to respond.",
  connection_failed: "Website unavailable: the connection failed.",
  ssl_error: "Website unavailable: its HTTPS certificate could not be validated.",
  too_many_redirects: "Website unavailable: it redirected too many times.",
  access_denied: "Website analysis unavailable: the site declined automated requests.",
  robots_disallowed: "Website analysis unavailable: the site's robots.txt asks automated tools not to fetch this page.",
  http_error: "Website unavailable: it returned an error page.",
  not_html: "Website analysis unavailable: the address did not return an HTML page.",
  client_rendered:
    "The fetched HTML contains almost no readable text, as pages built in the browser with JavaScript do, so content-based checks could not be made reliably. Only technical checks were made.",
}

/** Failures that say something about the site itself, not about our access to it. */
const UNREACHABLE: ReadonlySet<WebsiteIssue> = new Set([
  "dns_failure", "timeout", "connection_failed", "too_many_redirects", "http_error",
])

const CONTACT_CODES = new Set(["OWNER_FOUND", "DECISION_MAKER_FOUND", "PROFESSIONAL_EMAIL_FOUND", "EMAIL_VERIFIED"])

/** Owner, founder, president, CEO, managing member/partner, principal. */
const OWNER_LEVEL_MAX_RANK = 7
const NOT_SENIOR_RANK = 1_000

export function buildAnalysis(
  business: BusinessSearchResult,
  outcome: PageOutcome | null,
  enrichment: LeadEnrichment | null,
  /** Called as each step really starts, for progress display. */
  onStage: (stage: AnalysisStage) => void = () => {}
): BusinessAnalysis {
  const profile = categoryProfile(business.category)
  const target = websiteTarget(business)
  const ownWebsite = "url" in target

  let site: WebsiteAnalysis | null = null
  let issue: WebsiteIssue | null = null
  let note: string | null = null

  if (!ownWebsite) issue = target.issue
  else if (!outcome) issue = "connection_failed"
  else if (!outcome.ok) {
    issue = outcome.issue
    if (outcome.issue === "http_error" && outcome.statusCode) {
      note = `Website unavailable: it returned an error page (HTTP ${outcome.statusCode}).`
    }
  } else {
    onStage("structure")
    site = analyzePage(outcome.page, business)
    if (site.clientRendered) issue = "client_rendered"
  }
  if (issue) note ??= ISSUE_NOTES[issue]
  if (site?.truncated) {
    note = `${note ? `${note} ` : ""}The page is larger than ${ANALYSIS_CONFIG.fetch.maxHtmlBytes / 1_000_000} MB, so only its first part was analyzed.`
  }

  // Content-based signals only count when the HTML actually contains the content.
  const readable = site !== null && !site.clientRendered
  const status: BusinessAnalysis["status"] = readable
    ? "complete"
    : site || issue === "no_website" || issue === "third_party_page"
      ? "partial"
      : "website_unavailable"

  const technical = site ? technicalFactors(site) : []
  if (readable) onStage("seo")
  const seo = readable ? seoFactors(site!, profile) : []
  if (readable) onStage("conversion")
  const conversion = readable ? conversionFactors(site!, profile) : []
  onStage("scoring")
  const content = readable ? contentFactors(site!) : []
  const local = localPresenceFactors(business, ownWebsite, readable ? site : null)

  const seoTotal = readable ? seoScore(site!, seo) : null
  const conversionTotal = totalScore(conversion)
  const websiteTotal = readable
    ? weightedScore([
        { value: totalScore(technical), weight: W.website.technical },
        { value: seoTotal, weight: W.website.seo },
        { value: conversionTotal, weight: W.website.conversion },
        { value: totalScore(local.websiteSide), weight: W.website.local },
        { value: totalScore(content), weight: W.website.content },
      ])
    : null

  // Opportunity = visible room for improvement, not a judgement of the business.
  const opportunity =
    issue === "no_website"
      ? T.noWebsiteOpportunity
      : issue === "third_party_page"
        ? T.thirdPartyPageOpportunity
        : websiteTotal !== null && seoTotal !== null && conversionTotal !== null
          ? Math.round(
              (W.opportunity.website * (100 - websiteTotal) +
                W.opportunity.conversion * (100 - conversionTotal) +
                W.opportunity.seo * (100 - seoTotal)) /
                100
            )
          : null

  const strengths: Finding[] = [...listingStrengths(business)]
  const opportunities: Opportunity[] = []
  const flags: string[] = []

  if (site) {
    const found = siteFindings(site, business, profile, readable)
    strengths.push(...found.strengths)
    opportunities.push(...found.opportunities)
    flags.push(...found.extraFlags)
    if (conversionTotal !== null && conversionTotal >= 70) {
      strengths.push({ code: "GOOD_CONVERSION_STRUCTURE", text: `Conversion elements well covered (${conversionTotal}/100)` })
    }
  } else if (issue === "no_website") {
    opportunities.push({ area: "website", code: "NO_WEBSITE", text: "No website is listed for this business.", action: "Build a website on the business's own domain" })
  } else if (issue === "third_party_page") {
    opportunities.push({
      area: "website",
      code: "THIRD_PARTY_PAGE_ONLY",
      text: "The listed website is a third-party page (social or directory profile), not a site on the business's own domain.",
      action: "Build a website on the business's own domain",
    })
  } else if (issue === "ssl_error") {
    opportunities.push({ area: "website", code: "SSL_PROBLEM", text: "The website's HTTPS certificate could not be validated when it was checked.", action: "Check the site's SSL certificate" })
  } else if (issue && UNREACHABLE.has(issue)) {
    // One failed request isn't proof of a broken site, so it is worded as an observation.
    opportunities.push({ area: "website", code: "WEBSITE_UNREACHABLE", text: "The listed website could not be loaded when it was checked.", action: "Confirm the website is online and reachable" })
  }
  if (issue && !site && !opportunities.length) flags.push("WEBSITE_ANALYSIS_UNAVAILABLE")
  if (issue === "client_rendered") flags.push("WEBSITE_CONTENT_NOT_READABLE")

  const recommendedServices = recommendServices(opportunities, {
    website: websiteTotal,
    seo: seoTotal,
    conversion: conversionTotal,
  })

  const analysis: BusinessAnalysis = {
    version: ANALYSIS_CONFIG.version,
    businessId: business.osmId,
    business: {
      name: business.name,
      category: business.category,
      categoryLabel: getCategoryLabel(business.category),
      city: business.city,
      state: business.state,
      website: business.website,
      phone: business.phone,
    },
    status,
    websiteIssue: issue,
    websiteNote: note,
    website: site,
    scores: {
      website: websiteTotal,
      seo: seoTotal,
      conversion: conversionTotal,
      localPresence: totalScore(local.factors),
      opportunity,
      qualifiedLead: null,
    },
    breakdown: { technical, seo, conversion, localPresence: local.factors, content },
    qualification: { prospectScore: 0, components: [], reasons: [] },
    strengths,
    opportunities,
    recommendedServices,
    topOpportunity: recommendedServices[0]?.label ?? null,
    flags,
    notMeasured: [...NOT_MEASURED],
    contact: null,
    analyzedAt: new Date().toISOString(),
  }

  return qualify(analysis, scoreProspect(business).score, enrichment)
}

/**
 * Sets the Qualified Lead Score from the analysis plus the current contact
 * data. Also used on stored analyses, so a decision maker found after the
 * website was analyzed raises the score without fetching the site again.
 */
export function qualify(
  analysis: BusinessAnalysis,
  prospectScore: number,
  enrichment: LeadEnrichment | null
): BusinessAnalysis {
  const weights = W.qualifiedLead
  const { scores } = analysis
  const reasons: string[] = []
  const contactStrengths: Finding[] = []

  // Decision maker
  const person = enrichment?.person ?? null
  const name = person?.fullName ?? ([person?.firstName, person?.lastName].filter(Boolean).join(" ") || null)
  const rank = person ? decisionMakerRank({ title: person.title ?? undefined, seniority: person.seniority ?? undefined }) : NOT_SENIOR_RANK
  const ownerLevel = person !== null && rank <= OWNER_LEVEL_MAX_RANK
  let decisionMaker = 0
  if (person) {
    decisionMaker = ownerLevel ? 100 : rank < NOT_SENIOR_RANK ? 75 : 55
    const text = `${ownerLevel ? "Owner-level decision maker" : "Decision maker"} identified${person.title ? ` (${person.title})` : ""}`
    reasons.push(text)
    contactStrengths.push({ code: ownerLevel ? "OWNER_FOUND" : "DECISION_MAKER_FOUND", text })
  } else {
    reasons.push(enrichment ? "No decision maker could be found" : "Decision maker not looked up yet")
  }

  // Contact availability
  const email = enrichment?.email?.address ?? null
  const verdict = enrichment?.verification?.status ?? null
  let contact = analysis.business.phone ? 20 : 0
  if (email) {
    contact += verdict === "invalid" ? 0 : verdict === "risky" ? 50 : verdict === "deliverable" ? 80 : 70
    if (verdict === "invalid") reasons.push("The work email found was reported invalid")
    else {
      const text = verdict === "deliverable" ? "Professional email available and verified as deliverable" : "Professional email available"
      reasons.push(text)
      contactStrengths.push({ code: "PROFESSIONAL_EMAIL_FOUND", text: "Professional email available" })
      if (verdict === "deliverable") contactStrengths.push({ code: "EMAIL_VERIFIED", text: "Work email verified as deliverable" })
    }
  }

  // Opportunity side: more visible room for improvement = a stronger reason to reach out.
  const noSite = analysis.websiteIssue === "no_website" || analysis.websiteIssue === "third_party_page"
  const websiteOpportunity = noSite ? scores.opportunity : scores.website === null ? null : 100 - scores.website
  const seoOpportunity = scores.seo === null ? null : 100 - scores.seo
  const conversionOpportunity = scores.conversion === null ? null : 100 - scores.conversion

  if (prospectScore >= 80) reasons.push(`High prospect score (${prospectScore})`)
  if (noSite) reasons.push("No website on its own domain: a clear web presence opportunity")
  else if (websiteOpportunity === null) reasons.push("Website could not be analyzed, so the score uses business and contact data only")
  else if (websiteOpportunity >= 45) reasons.push("Website fundamentals show significant room for improvement")
  if (conversionOpportunity !== null && conversionOpportunity >= 45) reasons.push("Website has significant conversion opportunities")
  if (seoOpportunity !== null && seoOpportunity >= 35) reasons.push("Basic SEO improvements identified")
  if (scores.localPresence !== null && scores.localPresence >= 70) reasons.push("Strong local business signals")

  const components: QualificationComponent[] = [
    { key: "prospect", label: "Prospect Score", value: prospectScore, weight: weights.prospect },
    { key: "decisionMaker", label: "Decision maker", value: decisionMaker, weight: weights.decisionMaker },
    { key: "contact", label: "Contact availability", value: Math.min(100, contact), weight: weights.contact },
    { key: "websiteOpportunity", label: "Website opportunity", value: websiteOpportunity, weight: weights.websiteOpportunity },
    { key: "seoOpportunity", label: "SEO opportunity", value: seoOpportunity, weight: weights.seoOpportunity },
    { key: "conversionOpportunity", label: "Conversion opportunity", value: conversionOpportunity, weight: weights.conversionOpportunity },
    { key: "localStrength", label: "Local business strength", value: scores.localPresence, weight: weights.localStrength },
  ]

  const strengths = [...contactStrengths, ...analysis.strengths.filter((item) => !CONTACT_CODES.has(item.code))]
  const ownFlags = analysis.flags.filter(
    (flag) => !CONTACT_CODES.has(flag) && !analysis.strengths.some((item) => item.code === flag) && !analysis.opportunities.some((item) => item.code === flag)
  )

  return {
    ...analysis,
    scores: { ...scores, qualifiedLead: weightedScore(components) },
    qualification: { prospectScore, components, reasons },
    strengths,
    flags: [...new Set([...strengths.map((item) => item.code), ...analysis.opportunities.map((item) => item.code), ...ownFlags])],
    contact: person || email ? { name, title: person?.title ?? null, email, ownerLevel } : null,
  }
}
