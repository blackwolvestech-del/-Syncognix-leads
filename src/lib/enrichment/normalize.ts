import { platformHost } from "@/lib/scoring/prospect-score"

/*
 * Normalizers used for cache matching and provider input. The same business
 * must always produce the same keys, however its details were typed.
 */

/** Two-part public suffixes we may meet for US businesses. */
const TWO_PART_SUFFIXES = new Set(["co.uk", "com.au", "co.nz", "com.mx", "co.jp", "com.br"])

/**
 * "https://www.abc.com/", "www.abc.com", "ABC.com/contact" → "abc.com".
 * Subdomains are dropped ("shop.abc.com" → "abc.com") because providers
 * match on root domains. Returns null when the value isn't a usable host.
 */
export function normalizeDomain(value: string | null | undefined): string | null {
  if (!value) return null
  const raw = value.trim().toLowerCase()
  if (!raw || /\s/.test(raw)) return null

  let host: string
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`).hostname
  } catch {
    return null
  }
  host = host.replace(/^www\./, "").replace(/\.$/, "")
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null

  const parts = host.split(".")
  const lastTwo = parts.slice(-2).join(".")
  const keep = TWO_PART_SUFFIXES.has(lastTwo) ? 3 : 2
  return parts.slice(-keep).join(".")
}

/**
 * The domain a business owns, for decision-maker lookups. Facebook, Yelp and
 * similar pages are not the business's own domain, so they return null.
 */
export function businessDomain(website: string | null | undefined): string | null {
  const domain = normalizeDomain(website)
  if (!domain) return null
  // Check the full host too, so "abc.wixsite.com" is caught before trimming.
  let host = domain
  try {
    host = new URL(website!.includes("://") ? website! : `https://${website}`).hostname.toLowerCase()
  } catch {
    // keep the trimmed domain
  }
  return platformHost(host.replace(/^www\./, "")) || platformHost(domain) ? null : domain
}

const LEGAL_SUFFIXES =
  /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|ltd|limited|pllc|pc|p\.c|pa|p\.a|llp|lp|dds|dmd)\b\.?/g

/** "ABC Roofing, LLC." → "abc roofing". Used only for matching, never shown. */
export function normalizeCompanyName(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bthe\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Trims and lowercases; null when it isn't a plausible address. */
export function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const email = value.trim().toLowerCase()
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null
}

/** Trimmed text or undefined, capped in length. For sanitizing provider fields. */
export function cleanText(value: unknown, max = 200): string | undefined {
  if (typeof value !== "string") return undefined
  const text = value.replace(/\s+/g, " ").trim()
  return text ? text.slice(0, max) : undefined
}

/** Only https://…linkedin.com/… URLs are kept; anything else is dropped. */
export function cleanLinkedinUrl(value: unknown): string | undefined {
  const text = cleanText(value, 300)
  if (!text) return undefined
  try {
    const url = new URL(text.includes("://") ? text : `https://${text}`)
    const host = url.hostname.toLowerCase()
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return undefined
    url.protocol = "https:"
    return url.href
  } catch {
    return undefined
  }
}
