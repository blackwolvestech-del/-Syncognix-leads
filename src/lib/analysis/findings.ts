import type { Finding, Opportunity, WebsiteAnalysis } from "@/types/analysis"
import type { BusinessSearchResult } from "@/types/business"
import { ANALYSIS_CONFIG, type CategoryProfile } from "./config"

/*
 * Turns observed facts into strengths and opportunities. Every sentence here
 * states what was (or wasn't) found in the fetched HTML or the listing —
 * never an opinion about design, age or quality. `code` doubles as a
 * reusable flag (e.g. NO_CONTACT_FORM) for filters and later outreach.
 */

const { thresholds: T } = ANALYSIS_CONFIG

const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn",
  youtube: "YouTube", tiktok: "TikTok", x: "X",
}

export const platformLabel = (platform: string) => PLATFORM_LABELS[platform] ?? platform

type ListingInput = Pick<BusinessSearchResult, "phone" | "address" | "city">

export interface SiteFindings {
  strengths: Finding[]
  opportunities: Opportunity[]
  /** Flags that aren't a finding of their own. */
  extraFlags: string[]
}

/** Findings from the business listing alone (always available). */
export function listingStrengths(business: ListingInput): Finding[] {
  const strengths: Finding[] = []
  if (business.phone) strengths.push({ code: "BUSINESS_PHONE_AVAILABLE", text: "Business phone available" })
  if (business.address) strengths.push({ code: "STREET_ADDRESS_AVAILABLE", text: "Street address on record" })
  return strengths
}

/**
 * Findings from the homepage. With `contentReadable` false (a page that
 * renders in the browser) only the technical findings are produced, because
 * missing text or forms would prove nothing.
 */
export function siteFindings(
  site: WebsiteAnalysis,
  business: ListingInput,
  profile: CategoryProfile,
  contentReadable: boolean
): SiteFindings {
  const strengths: Finding[] = []
  const opportunities: Opportunity[] = []
  const extraFlags: string[] = []
  const good = (code: string, text: string) => strengths.push({ code, text })
  const gap = (area: Opportunity["area"], code: string, text: string, action: string) =>
    opportunities.push({ area, code, text, action })

  // --- technical -------------------------------------------------------------
  good("WEBSITE_AVAILABLE", `Website reachable (HTTP ${site.statusCode})`)
  if (site.https) good("HTTPS_ENABLED", "HTTPS enabled")
  else gap("website", "HTTP_ONLY", "The homepage is served over HTTP, not HTTPS.", "Enable HTTPS and redirect HTTP traffic to it")

  if (site.hasViewport) good("RESPONSIVE_CONFIG", "Responsive configuration detected (viewport meta tag)")
  else gap("website", "MISSING_VIEWPORT", "No responsive viewport meta tag was found in the homepage HTML.", "Add a responsive viewport configuration")

  if (site.responseTimeMs > T.slowResponseMs) {
    gap(
      "website",
      "SLOW_SERVER_RESPONSE",
      `The server took ${(site.responseTimeMs / 1000).toFixed(1)}s to start responding to the homepage request.`,
      "Review hosting and server response time"
    )
  }
  if (site.noindex) {
    gap("seo", "NOINDEX", `The homepage carries a robots meta tag that blocks indexing (“${site.robotsMeta}”).`, "Remove the noindex directive if the page should appear in search")
  }

  if (!contentReadable) return { strengths, opportunities, extraFlags }

  // --- SEO fundamentals ------------------------------------------------------
  const titleLength = site.title?.length ?? 0
  if (!site.title) {
    gap("seo", "MISSING_TITLE", "The homepage has no page title.", "Add a descriptive page title")
  } else if (site.titleGeneric) {
    gap("seo", "GENERIC_TITLE", `The page title appears generic: “${site.title.slice(0, 80)}”.`, "Rewrite the page title around the service and location")
  } else if (titleLength < T.title.min || titleLength > T.title.max) {
    gap("seo", "WEAK_TITLE", `The page title is ${titleLength} characters (commonly recommended: ${T.title.min}–${T.title.max}).`, "Adjust the page title length")
  }
  if (site.title && !site.titleGeneric && site.titleHasLocation === false && !site.titleHasService && profile.terms.length) {
    gap("local", "WEAK_TITLE_RELEVANCE", "The page title mentions neither the city nor a service term.", "Include the main service and city in the page title")
  }

  const descriptionLength = site.metaDescription?.length ?? 0
  if (!site.metaDescription) {
    gap("seo", "MISSING_META_DESCRIPTION", "The homepage has no meta description.", "Write a meta description")
  } else if (descriptionLength < T.metaDescription.min) {
    gap("seo", "WEAK_META_DESCRIPTION", `The meta description is only ${descriptionLength} characters long.`, "Expand the meta description")
  }
  if (site.title && site.metaDescription) good("TITLE_AND_DESCRIPTION", "Page title and meta description present")

  if (site.h1Count === 0) gap("seo", "MISSING_H1", "No H1 heading was found on the homepage.", "Add one clear H1 heading")
  else if (site.h1Count > 1) gap("seo", "MULTIPLE_H1", `${site.h1Count} H1 headings were found on the homepage.`, "Use a single H1 heading")
  else good("SINGLE_H1", "Single H1 heading present")

  if (site.h2Count === 0) gap("content", "WEAK_HEADING_STRUCTURE", "No H2 subheadings were found on the homepage.", "Structure the page content with subheadings")
  if (!site.canonicalUrl) gap("seo", "MISSING_CANONICAL", "No canonical link tag was found.", "Add a canonical tag")

  if (site.imageCount > 0 && site.missingAltCount / site.imageCount > T.missingAltShare) {
    gap("seo", "MISSING_IMAGE_ALT", `${site.missingAltCount} of ${site.imageCount} images have no alt attribute.`, "Add alt text to images")
  }
  if (site.internalLinkCount < 3) {
    gap("seo", "FEW_INTERNAL_LINKS", `Only ${site.internalLinkCount} internal link${site.internalLinkCount === 1 ? " was" : "s were"} found on the homepage.`, "Link to key pages from the homepage")
  }

  // --- structured data and local signals -------------------------------------
  if (site.schemaTypes.length === 0) {
    gap("local", "NO_STRUCTURED_DATA", "Structured data (JSON-LD or microdata) was not detected.", "Add LocalBusiness structured data")
    extraFlags.push("NO_LOCAL_SCHEMA")
  } else {
    good("STRUCTURED_DATA_FOUND", `Structured data detected (${site.schemaTypes.slice(0, 4).join(", ")})`)
    if (site.hasLocalBusinessSchema) good("LOCAL_SCHEMA_FOUND", "LocalBusiness structured data detected")
    else gap("local", "NO_LOCAL_SCHEMA", `Structured data is present (${site.schemaTypes.slice(0, 3).join(", ")}) but no LocalBusiness type was detected.`, "Add LocalBusiness structured data")
  }

  if (site.cityMentioned === false) {
    gap("local", "WEAK_LOCAL_SIGNALS", `The city (${business.city}) does not appear in the homepage text, title or description.`, "Mention the city and service area on the homepage")
  } else if (site.cityMentioned) {
    good("LOCAL_RELEVANCE", site.stateMentioned ? "City and state appear on the homepage" : "City appears on the homepage")
  }
  if (site.phones.length === 0) {
    gap("local", "NO_PHONE_ON_WEBSITE", "No phone number was detected on the homepage.", "Show the business phone number on the homepage")
  } else if (site.phoneMatchesListing === false) {
    gap("local", "PHONE_MISMATCH", "The listed business phone was not found on the homepage; a different number is shown.", "Check that the same phone number is used everywhere")
  }
  if (business.address && !site.addressFound) {
    gap("local", "NO_ADDRESS_ON_WEBSITE", "No street address was detected on the homepage.", "Show the business address on the website")
  }

  // --- conversion ------------------------------------------------------------
  const mainCta = site.ctas.find((cta) => ["quote", "booking", "order"].includes(cta.kind))
  if (site.ctaClarity === "weak") {
    gap("conversion", "NO_PRIMARY_CTA", "No call-to-action link or button (quote, booking, contact or call) was detected on the homepage.", "Add a clear primary call to action")
  } else if (mainCta) {
    good("STRONG_CTA", `Clear call to action detected (“${mainCta.text}”)`)
  }

  if (site.hasPhoneCta) good("PHONE_CTA_FOUND", "Tap-to-call phone link present")
  else gap("conversion", "NO_PHONE_CTA", site.phones.length ? "A phone number is shown, but not as a tap-to-call link." : "No tap-to-call phone link was detected.", "Add a tap-to-call phone link")

  if (site.hasContactForm) {
    good("CONTACT_FORM_FOUND", site.embeddedForm ? `Contact form present (embedded ${site.embeddedForm} form)` : "Contact form present")
  } else if (profile.expectsContactForm) {
    gap(
      "conversion",
      "NO_CONTACT_FORM",
      site.contactPageUrl
        ? "The homepage did not expose a contact form in the fetched HTML (a contact page is linked, which was not fetched)."
        : "No contact form was detected in the homepage HTML.",
      "Add a short contact or enquiry form to the homepage"
    )
  }

  const actionable = site.hasQuoteCta || site.hasBookingCta || site.hasOrderCta
  if (profile.action === "quote" || profile.action === "any") {
    if (!site.hasQuoteCta && !site.hasBookingCta && !(profile.action === "any" && site.hasOrderCta)) {
      gap("conversion", "NO_QUOTE_CTA", "No quote, estimate or booking call to action was detected on the homepage.", "Add a quote or estimate request option")
    }
  } else if (profile.action === "booking" && !site.hasBookingCta && !site.hasQuoteCta) {
    gap("conversion", "NO_BOOKING_FLOW", "No booking or appointment option was detected on the homepage.", "Add an online booking or appointment request option")
  } else if (profile.action === "order" && !site.hasOrderCta && !site.hasBookingCta) {
    gap("conversion", "NO_ORDER_OPTION", "No online ordering or reservation option was detected on the homepage.", "Add online ordering or reservations")
  }
  if (actionable && profile.action !== "none") {
    good("BOOKING_OR_QUOTE_AVAILABLE", `${[site.hasQuoteCta && "Quote", site.hasBookingCta && "Booking", site.hasOrderCta && "Ordering"].filter(Boolean).join(" / ")} option detected`)
  }

  // --- content and navigation ------------------------------------------------
  const pages = site.detectedPages
  if (!pages.includes("services")) {
    gap("content", "NO_SERVICE_PAGE", "No services page or section link was detected in the homepage navigation.", "Add a services page describing each service")
  }
  if (!pages.includes("testimonials")) {
    gap("content", "NO_TESTIMONIALS", "No testimonials or reviews page or section link was detected.", "Show customer testimonials or reviews")
  }
  if (["services", "contact", "about"].every((page) => pages.includes(page as (typeof pages)[number]))) {
    good("KEY_PAGES_FOUND", "Services, About and Contact pages detected")
  }
  if (site.wordCount < T.thinContentWords) {
    gap("content", "THIN_CONTENT", `The homepage has about ${site.wordCount} words of text.`, "Expand the homepage content")
  }
  if (site.socialProfiles.length) {
    good("SOCIAL_PROFILES_FOUND", `Social profiles linked (${site.socialProfiles.map((profileLink) => platformLabel(profileLink.platform)).join(", ")})`)
  } else {
    gap("content", "NO_SOCIAL_PROFILES", "No social media profile links were detected on the homepage.", "Link the business's social profiles")
  }

  return { strengths, opportunities, extraFlags }
}
