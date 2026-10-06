/*
 * Chooses the strongest decision maker from a provider's candidates. Titles
 * vary by industry ("Owner Dentist", "Managing Member"), so ranking is by
 * pattern, in priority order. Lower rank = stronger. Nobody is "promoted":
 * a business with only an Owner returns the Owner, never an invented CEO.
 */

export interface Candidate {
  title?: string
  /** Provider seniority label, e.g. "Founder/Owner", "C-Suite". */
  seniority?: string
  linkedinUrl?: string
}

/**
 * Priority order from the product spec (rank 0 is strongest). Checked top to
 * bottom, so the more specific patterns come first: "Co-Founder" must be
 * tested before "Founder", and "Vice President" must never match "President".
 */
const TITLE_PRIORITY: { rank: number; pattern: RegExp }[] = [
  { rank: 0, pattern: /\b(co-?\s?owner|owner|proprietor)\b/ }, // Owner, Practice Owner, Owner Dentist
  { rank: 2, pattern: /\bco-?\s?founder\b/ }, // Co-Founder
  { rank: 1, pattern: /\bfounder\b/ }, // Founder
  { rank: 3, pattern: /(?<!vice[\s-])\bpresident\b/ }, // President
  { rank: 4, pattern: /\b(ceo|chief executive)\b/ }, // CEO
  { rank: 5, pattern: /\bmanaging member\b/ },
  { rank: 6, pattern: /\bmanaging partner\b/ },
  { rank: 7, pattern: /\bprincipal\b/ },
  { rank: 8, pattern: /\b(general manager|gm)\b/ },
]

/** Fallback order for "other senior decision maker", by provider seniority. */
const SENIORITY_PRIORITY = [
  "founder/owner",
  "c-suite",
  "partner",
  "vice president",
  "head",
  "director",
  "manager",
]

const OTHER_SENIOR = 10
const NOT_SENIOR = 1_000

/** Lower is stronger. Titles that aren't senior at all rank NOT_SENIOR. */
export function decisionMakerRank(candidate: Candidate) {
  const title = (candidate.title ?? "").toLowerCase()
  const match = TITLE_PRIORITY.find(({ pattern }) => pattern.test(title))
  if (match) return match.rank

  const seniority = SENIORITY_PRIORITY.indexOf((candidate.seniority ?? "").toLowerCase())
  if (seniority !== -1) return OTHER_SENIOR + seniority

  // No seniority label: accept clearly senior titles only.
  if (/\b(partner|chief|director|vice president|vp|head of)\b/.test(title)) {
    return OTHER_SENIOR + SENIORITY_PRIORITY.length
  }
  return NOT_SENIOR
}

/** The strongest senior candidate, or null when none is senior. */
export function pickDecisionMaker<T extends Candidate>(candidates: T[]): T | null {
  let best: T | null = null
  let bestRank = NOT_SENIOR
  for (const candidate of candidates) {
    const rank = decisionMakerRank(candidate)
    // Ties keep the earlier candidate, i.e. the provider's own ordering.
    if (rank < bestRank) {
      best = candidate
      bestRank = rank
    }
  }
  return best
}
