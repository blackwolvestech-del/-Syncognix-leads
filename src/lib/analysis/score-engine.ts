import type { ScoreFactor, WebsiteAnalysis } from "@/types/analysis"
import type { BusinessSearchResult } from "@/types/business"
import { ACTION_CTA_KINDS, ANALYSIS_CONFIG, type CategoryProfile } from "./config"

/*
 * Rule-based scores from observed facts. Each score is a list of factors
 * (earned / max); a factor that couldn't be measured is left out of the
 * total rather than counted as zero. These scores describe observable
 * fundamentals only — not rankings, revenue, UX quality or page speed.
 */

const { weights: W, thresholds: T } = ANALYSIS_CONFIG

function factor(label: string, earned: number, max: number, note?: string): ScoreFactor {
  return { label, earned: Math.max(0, Math.min(max, Math.round(earned))), max, measured: true, ...(note && { note }) }
}

function unmeasured(label: string, max: number, note: string): ScoreFactor {
  return { label, earned: 0, max, measured: false, note }
}

/** 0–100 from the measured factors, or null when nothing could be measured. */
export function totalScore(factors: ScoreFactor[]): number | null {
  const measured = factors.filter((entry) => entry.measured && entry.max > 0)
  const max = measured.reduce((sum, entry) => sum + entry.max, 0)
  if (max === 0) return null
  return Math.round((measured.reduce((sum, entry) => sum + entry.earned, 0) / max) * 100)
}

/** Weighted average of 0–100 parts, skipping the ones that are null. */
export function weightedScore(parts: { value: number | null; weight: number }[]): number | null {
  const known = parts.filter((part): part is { value: number; weight: number } => part.value !== null)
  const weight = known.reduce((sum, part) => sum + part.weight, 0)
  if (weight === 0) return null
  return Math.round(known.reduce((sum, part) => sum + part.value * part.weight, 0) / weight)
}

const inRange = (length: number, range: { min: number; max: number }) => length >= range.min && length <= range.max
const yesNo = (value: boolean) => (value ? "Detected" : "Not detected")

export function technicalFactors(site: WebsiteAnalysis): ScoreFactor[] {
  const w = W.technical
  const seconds = (site.responseTimeMs / 1000).toFixed(1)
  return [
    factor(
      "Website reachable",
      w.reachable,
      w.reachable,
      `HTTP ${site.statusCode}${site.redirectCount ? `, ${site.redirectCount} redirect${site.redirectCount === 1 ? "" : "s"}` : ""}`
    ),
    factor(
      "HTTPS",
      site.https ? w.https : 0,
      w.https,
      site.https
        ? site.httpRedirectsToHttps
          ? "HTTP redirects to HTTPS"
          : "Served over HTTPS"
        : "Served over HTTP only"
    ),
    factor(
      "Responsive configuration",
      site.hasViewport ? w.viewport : 0,
      w.viewport,
      site.hasViewport
        ? ["Viewport meta tag", ...site.responsiveHints].join("; ")
        : "No viewport meta tag"
    ),
    factor(
      "Server response time",
      site.responseTimeMs <= T.fastResponseMs ? w.responseTime : site.responseTimeMs <= T.slowResponseMs ? w.responseTime / 2 : 0,
      w.responseTime,
      `${seconds}s to first response (not a page-speed test)`
    ),
    factor("Language declared", site.lang ? w.lang : 0, w.lang, site.lang ?? "No lang attribute"),
    site.hasFavicon
      ? factor("Favicon", w.favicon, w.favicon, "Icon link found")
      : unmeasured("Favicon", w.favicon, "No icon link in the HTML; /favicon.ico was not requested"),
  ]
}

export function seoFactors(site: WebsiteAnalysis, profile: CategoryProfile): ScoreFactor[] {
  const w = W.seo
  const titleLength = site.title?.length ?? 0
  const descriptionLength = site.metaDescription?.length ?? 0

  const title = !site.title
    ? factor("Page title", 0, w.title, "Missing")
    : factor(
        "Page title",
        8 + (inRange(titleLength, T.title) ? 4 : 0) + (site.titleGeneric ? 0 : 3),
        w.title,
        `${titleLength} characters${site.titleGeneric ? ", appears generic" : ""}`
      )

  const description = !site.metaDescription
    ? factor("Meta description", 0, w.metaDescription, "Missing")
    : factor(
        "Meta description",
        6 + (inRange(descriptionLength, T.metaDescription) ? 4 : 0),
        w.metaDescription,
        `${descriptionLength} characters`
      )

  // Local relevance is built from whichever parts can actually be checked.
  const local: { earned: number; max: number; note: string }[] = []
  if (site.cityMentioned !== null) {
    local.push({ earned: site.cityMentioned ? 9 : 0, max: 9, note: `City ${site.cityMentioned ? "mentioned" : "not mentioned"}` })
  }
  if (site.stateMentioned !== null) {
    local.push({ earned: site.stateMentioned ? 2 : 0, max: 2, note: `state ${site.stateMentioned ? "mentioned" : "not mentioned"}` })
  }
  if (profile.terms.length) {
    const found = site.serviceTermsFound.length
    local.push({ earned: found >= 2 ? 4 : found * 2, max: 4, note: `${found} service term${found === 1 ? "" : "s"} found` })
  }
  const localMax = local.reduce((sum, part) => sum + part.max, 0)
  const localRelevance = localMax
    ? factor(
        "Local and service relevance",
        (local.reduce((sum, part) => sum + part.earned, 0) / localMax) * w.localRelevance,
        w.localRelevance,
        local.map((part) => part.note).join(", ")
      )
    : unmeasured("Local and service relevance", w.localRelevance, "No city or category terms to check against")

  return [
    title,
    description,
    factor(
      "H1 heading",
      site.h1Count === 1 ? w.h1 : site.h1Count > 1 ? w.h1 * 0.6 : 0,
      w.h1,
      site.h1Count === 0 ? "Missing" : `${site.h1Count} found`
    ),
    factor(
      "Heading structure",
      site.h2Count >= 2 ? w.headingStructure : site.h2Count === 1 ? w.headingStructure / 2 : 0,
      w.headingStructure,
      `${site.h2Count} H2 heading${site.h2Count === 1 ? "" : "s"}`
    ),
    factor("Canonical tag", site.canonicalUrl ? w.canonical : 0, w.canonical, yesNo(Boolean(site.canonicalUrl))),
    site.imageCount === 0
      ? unmeasured("Image alt text", w.imageAlt, "No images in the HTML")
      : factor(
          "Image alt text",
          w.imageAlt * (1 - site.missingAltCount / site.imageCount),
          w.imageAlt,
          `${site.missingAltCount} of ${site.imageCount} images have no alt attribute`
        ),
    localRelevance,
    factor(
      "Structured data",
      site.schemaTypes.length === 0 ? 0 : site.hasLocalBusinessSchema || site.hasOrganizationSchema ? w.structuredData : w.structuredData * 0.6,
      w.structuredData,
      site.schemaTypes.length ? site.schemaTypes.slice(0, 4).join(", ") : "Not detected"
    ),
    factor(
      "Internal linking",
      site.internalLinkCount >= 10 ? w.internalLinks : site.internalLinkCount >= 3 ? w.internalLinks / 2 : 0,
      w.internalLinks,
      `About ${site.internalLinkCount} internal links`
    ),
  ]
}

/** SEO fundamentals score, capped when the homepage asks not to be indexed. */
export function seoScore(site: WebsiteAnalysis, factors: ScoreFactor[]) {
  const score = totalScore(factors)
  return score !== null && site.noindex ? Math.min(score, T.noindexSeoCap) : score
}

export function conversionFactors(site: WebsiteAnalysis, profile: CategoryProfile): ScoreFactor[] {
  const w = W.conversion
  const mainCta = site.ctas.find((cta) => cta.kind !== "call") ?? site.ctas[0]
  const hasPhoneText = site.phones.length > 0
  const hasServicesPage = site.detectedPages.includes("services")
  const hasTestimonials = site.detectedPages.includes("testimonials")

  const contactForm = site.hasContactForm
    ? factor("Contact form", w.contactForm, w.contactForm, site.embeddedForm ? `Embedded form (${site.embeddedForm})` : "Detected on the homepage")
    : !profile.expectsContactForm
      ? unmeasured("Contact form", w.contactForm, "Not detected; not expected for this category")
      : factor(
          "Contact form",
          site.contactPageUrl ? w.contactForm / 2 : 0,
          w.contactForm,
          site.contactPageUrl ? "Not on the homepage; a contact page is linked (not fetched)" : "Not detected"
        )

  const actionLabel =
    profile.action === "booking" ? "Booking option" : profile.action === "order" ? "Order / reservation option" : "Quote or booking option"
  const action =
    profile.action === "none"
      ? unmeasured("Quote or booking option", w.bookingOrQuote, "Not expected for this category")
      : factor(
          actionLabel,
          site.ctas.some((cta) => ACTION_CTA_KINDS[profile.action as keyof typeof ACTION_CTA_KINDS].includes(cta.kind)) ? w.bookingOrQuote : 0,
          w.bookingOrQuote,
          site.hasQuoteCta || site.hasBookingCta || site.hasOrderCta
            ? [site.hasQuoteCta && "quote", site.hasBookingCta && "booking", site.hasOrderCta && "ordering"].filter(Boolean).join(", ") + " detected"
            : "Not detected"
        )

  const termCount = site.serviceTermsFound.length
  const termMax = profile.terms.length ? 6 : 0
  const serviceEarned = (profile.terms.length ? (termCount >= 2 ? 6 : termCount * 3) : 0) + (hasServicesPage ? 4 : 0)

  return [
    factor(
      "Primary call to action",
      site.ctaClarity === "strong" ? w.primaryCta : site.ctaClarity === "moderate" ? w.primaryCta / 2 : 0,
      w.primaryCta,
      mainCta ? `e.g. “${mainCta.text}”` : "None detected"
    ),
    factor(
      "Phone call to action",
      site.hasPhoneCta ? w.phoneCta : hasPhoneText ? w.phoneCta / 2 : 0,
      w.phoneCta,
      site.hasPhoneCta ? "Tap-to-call link" : hasPhoneText ? "Phone number shown, but not as a tap-to-call link" : "Not detected"
    ),
    contactForm,
    action,
    factor(
      "Contact information",
      (hasPhoneText ? 4 : 0) + (site.emails.length || site.hasEmailCta ? 3 : 0) + (site.addressFound ? 3 : 0),
      w.contactInfo,
      [hasPhoneText && "phone", (site.emails.length > 0 || site.hasEmailCta) && "email", site.addressFound && "address"]
        .filter(Boolean)
        .join(", ") || "None detected"
    ),
    factor(
      "Service clarity",
      (serviceEarned / (termMax + 4)) * w.serviceClarity,
      w.serviceClarity,
      [hasServicesPage ? "Services page linked" : "No services page link", termMax ? `${termCount} service terms` : null]
        .filter(Boolean)
        .join(", ")
    ),
    factor(
      "Trust and social signals",
      (site.socialProfiles.length ? 2 : 0) + (hasTestimonials ? 3 : 0),
      w.trust,
      [site.socialProfiles.length > 0 && "social profiles", hasTestimonials && "testimonials/reviews"].filter(Boolean).join(", ") ||
        "None detected"
    ),
  ]
}

export function contentFactors(site: WebsiteAnalysis): ScoreFactor[] {
  const w = W.content
  const page = (label: string, key: (typeof site.detectedPages)[number], max: number) =>
    factor(label, site.detectedPages.includes(key) ? max : 0, max, site.detectedPages.includes(key) ? "Found" : "Not found")
  return [
    page("Services page or section", "services", w.servicesPage),
    page("Contact page or section", "contact", w.contactPage),
    page("About page or section", "about", w.aboutPage),
    page("Testimonials or reviews", "testimonials", w.testimonials),
    page("FAQ", "faq", w.faq),
    page("Gallery or portfolio", "gallery", w.gallery),
    factor(
      "Homepage text",
      site.wordCount >= T.solidContentWords ? w.bodyText : site.wordCount >= T.thinContentWords ? w.bodyText / 2 : 0,
      w.bodyText,
      `About ${site.wordCount} words`
    ),
  ]
}

type LocalBusinessInput = Pick<BusinessSearchResult, "phone" | "address" | "city" | "state">

/**
 * Local presence from the Step 2 listing plus what the website shows.
 * `site` is null when the page's content couldn't be read; the website-side
 * factors are then unmeasured. Ratings and reviews aren't available at all.
 */
export function localPresenceFactors(
  business: LocalBusinessInput,
  ownWebsite: boolean,
  site: WebsiteAnalysis | null
): { factors: ScoreFactor[]; websiteSide: ScoreFactor[] } {
  const w = W.localPresence
  const listing = [
    factor("Business phone on record", business.phone ? w.businessPhone : 0, w.businessPhone, business.phone ? "Available" : "Not available"),
    factor("Street address on record", business.address ? w.streetAddress : 0, w.streetAddress, business.address ? "Available" : "Not available"),
    factor("City and state on record", business.city && business.state ? w.cityAndState : 0, w.cityAndState, business.city && business.state ? "Available" : "Incomplete"),
    factor("Website on its own domain", ownWebsite ? w.ownWebsite : 0, w.ownWebsite, ownWebsite ? "Yes" : "No"),
  ]

  const none = "Website content not analyzed"
  const websiteSide: ScoreFactor[] = !site
    ? [
        unmeasured("City on website", w.cityOnWebsite, none),
        unmeasured("State on website", w.stateOnWebsite, none),
        unmeasured("Phone on website", w.phoneOnWebsite, none),
        unmeasured("Address on website", w.addressOnWebsite, none),
        unmeasured("Local business schema", w.localSchema, none),
        unmeasured("Service-area language", w.serviceAreaLanguage, none),
      ]
    : [
        site.cityMentioned === null
          ? unmeasured("City on website", w.cityOnWebsite, "No city on record to check")
          : factor("City on website", site.cityMentioned ? w.cityOnWebsite : 0, w.cityOnWebsite, site.cityMentioned ? "Yes" : "No"),
        site.stateMentioned === null
          ? unmeasured("State on website", w.stateOnWebsite, "No state on record to check")
          : factor("State on website", site.stateMentioned ? w.stateOnWebsite : 0, w.stateOnWebsite, site.stateMentioned ? "Yes" : "No"),
        factor(
          "Phone on website",
          site.phones.length === 0 ? 0 : site.phoneMatchesListing === false ? w.phoneOnWebsite / 2 : w.phoneOnWebsite,
          w.phoneOnWebsite,
          site.phones.length === 0
            ? "No"
            : site.phoneMatchesListing === false
              ? "A different number than the listing"
              : site.phoneMatchesListing
                ? "Matches the listing"
                : "Yes"
        ),
        factor("Address on website", site.addressFound ? w.addressOnWebsite : 0, w.addressOnWebsite, site.addressFound ? "Yes" : "Not detected"),
        factor(
          "Local business schema",
          site.hasLocalBusinessSchema ? w.localSchema : site.hasOrganizationSchema ? w.localSchema / 2 : 0,
          w.localSchema,
          site.hasLocalBusinessSchema ? "LocalBusiness type found" : site.hasOrganizationSchema ? "Organization only" : "Missing"
        ),
        factor("Service-area language", site.serviceAreaLanguage ? w.serviceAreaLanguage : 0, w.serviceAreaLanguage, yesNo(site.serviceAreaLanguage)),
      ]

  return { factors: [...listing, ...websiteSide], websiteSide }
}
