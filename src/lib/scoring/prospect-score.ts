import type { ProspectScore, ProspectTier } from "@/types/enrichment"

/*
 * Prospect Score: how suitable a business looks as an outreach target, from
 * the data Step 2 actually has (OpenStreetMap). It is NOT a purchase or
 * conversion probability.
 *
 * Only real signals are scored. OpenStreetMap has no ratings or review
 * counts, so those are not part of the score; category and location are
 * already guaranteed by the search itself. The score depends only on the
 * business's own fields, so a saved lead scores the same as it did in search.
 */

/** Points per signal. Must add up to 100. */
export const SCORE_WEIGHTS = {
  /** A website on the business's own domain (needed to find a decision maker). */
  ownWebsite: 40,
  /** Only a social/directory page (Facebook, Yelp…) is listed as the website. */
  socialPageOnly: 15,
  phone: 15,
  /** Both a website and a phone: more than one way to reach them. */
  multipleChannels: 10,
  streetAddress: 10,
  cityAndState: 5,
  /** No chain/brand listed, so decisions are likely made locally. */
  independent: 20,
} as const

export const SCORE_TIERS = { high: 80, moderate: 60 } as const

export const TIER_LABELS: Record<ProspectTier, string> = {
  high: "High potential",
  moderate: "Moderate potential",
  lower: "Lower potential",
}

export const SCORE_DISCLAIMER =
  "Prospect suitability score based on available business signals. It is not a purchase or conversion probability."

/** Hosts that are a profile on someone else's platform, not a business's own site. */
const PLATFORM_HOSTS = [
  "facebook.com", "fb.com", "instagram.com", "twitter.com", "x.com", "linkedin.com",
  "youtube.com", "tiktok.com", "yelp.com", "google.com", "goo.gl", "g.page",
  "business.site", "linktr.ee", "nextdoor.com", "yellowpages.com", "angi.com",
  "thumbtack.com", "homeadvisor.com", "houzz.com", "tripadvisor.com", "opentable.com",
  "doordash.com", "grubhub.com", "ubereats.com", "toasttab.com", "square.site",
  "wixsite.com", "weebly.com", "wordpress.com", "blogspot.com", "sites.google.com",
  "godaddysites.com", "mapquest.com", "bbb.org", "zocdoc.com", "healthgrades.com",
]

const PLATFORM_NAMES: Record<string, string> = {
  "facebook.com": "Facebook", "fb.com": "Facebook", "instagram.com": "Instagram",
  "yelp.com": "Yelp", "linktr.ee": "Linktree", "business.site": "Google",
  "google.com": "Google", "g.page": "Google",
}

function hostOf(website: string) {
  try {
    return new URL(website).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return null
  }
}

/** The platform a host belongs to ("facebook.com"), or null for an own domain. */
export function platformHost(host: string) {
  return PLATFORM_HOSTS.find((platform) => host === platform || host.endsWith(`.${platform}`)) ?? null
}

export interface ScoreInput {
  website: string | null
  phone: string | null
  /** Street address ("123 Main St, Dallas, TX"), when a street is known. */
  address: string | null
  city: string | null
  state: string | null
  /** True when OpenStreetMap lists a brand; null/undefined when unknown. */
  chain?: boolean | null
}

export function scoreTier(score: number): ProspectTier {
  if (score >= SCORE_TIERS.high) return "high"
  if (score >= SCORE_TIERS.moderate) return "moderate"
  return "lower"
}

/** Scores a business 0–100 with the reasons behind it. Pure and deterministic. */
export function scoreProspect(business: ScoreInput): ProspectScore {
  let score = 0
  const reasons: string[] = []
  const opportunities: string[] = []

  const host = business.website ? hostOf(business.website) : null
  const platform = host ? platformHost(host) : null

  if (host && !platform) {
    score += SCORE_WEIGHTS.ownWebsite
    reasons.push("Website on its own domain")
    if (business.website!.startsWith("http://")) {
      opportunities.push("Listed website address isn't HTTPS")
    }
  } else if (host && platform) {
    score += SCORE_WEIGHTS.socialPageOnly
    const name = PLATFORM_NAMES[platform]
    opportunities.push(
      name ? `No dedicated website (uses a ${name} page)` : "No dedicated website (uses a third-party page)"
    )
  } else {
    opportunities.push("No website listed")
  }

  if (business.phone) {
    score += SCORE_WEIGHTS.phone
    reasons.push("Business phone available")
  }
  if (host && business.phone) {
    score += SCORE_WEIGHTS.multipleChannels
    reasons.push("Reachable by web and phone")
  }

  if (business.address) {
    score += SCORE_WEIGHTS.streetAddress
    reasons.push("Street address on record")
  }
  if (business.city && business.state) score += SCORE_WEIGHTS.cityAndState

  // Chain locations rarely decide on vendors locally, so they get no points here.
  if (business.chain !== true) {
    score += SCORE_WEIGHTS.independent
    reasons.push("Appears independent (no chain listed)")
  }

  return { score: Math.max(0, Math.min(100, score)), reasons, opportunities }
}
