import type { BusinessSearchResult } from "@/types/business"
import type { OsmElement } from "./osm-element"
import { hasNonUsAddress } from "./us-regions"

/** Trims a tag value and collapses whitespace; empty values become null. */
function clean(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null
  const cleaned = value.replace(/\s+/g, " ").trim()
  return cleaned || null
}

/** OSM allows several values separated by ";" — keep the first. */
function firstValue(value: string | undefined): string | null {
  return clean(value?.split(";")[0])
}

function firstTag(tags: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = firstValue(tags[key])
    if (value) return value
  }
  return null
}

/**
 * Returns an absolute http(s) URL, or null if the tag isn't a usable website.
 * "abcplumbing.com" → "https://abcplumbing.com"; existing protocols are kept.
 */
export function normalizeWebsite(raw: string | null): string | null {
  if (!raw || /\s/.test(raw)) return null
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (!url.hostname.includes(".")) return null
    // "mailto:a@b.com" parses as user "mailto" on host b.com — not a website.
    if (url.username || url.password) return null
    const href = url.href
    // Drop the trailing slash URL adds to bare domains ("https://a.com/").
    return url.pathname === "/" && !url.search && !url.hash ? href.slice(0, -1) : href
  } catch {
    return null
  }
}

/** "123 Main St, Dallas, TX 75201" — null unless a street is known. */
function buildAddress(
  street: string | null,
  city: string | null,
  state: string | null,
  postcode: string | null
) {
  if (!street) return null
  const region = [state, postcode].filter(Boolean).join(" ")
  return [street, city, region].filter(Boolean).join(", ")
}

function coordinates(element: OsmElement) {
  const lat = element.type === "node" ? element.lat : element.center?.lat
  const lon = element.type === "node" ? element.lon : element.center?.lon
  if (typeof lat !== "number" || typeof lon !== "number") {
    return { latitude: null, longitude: null }
  }
  return { latitude: lat, longitude: lon }
}

/**
 * Converts one Overpass element into a clean result. Returns null for
 * unnamed objects and for anything whose address places it outside the US.
 */
export function normalizeBusiness(
  element: OsmElement,
  categoryId: string
): BusinessSearchResult | null {
  const tags = element.tags ?? {}
  const name = clean(tags.name)
  if (!name || hasNonUsAddress(tags)) return null

  const streetName = firstTag(tags, ["addr:street"])
  const houseNumber = firstTag(tags, ["addr:housenumber"])
  const street = streetName ? [houseNumber, streetName].filter(Boolean).join(" ") : null
  const city = firstTag(tags, ["addr:city"])
  const state = firstTag(tags, ["addr:state"])
  const postcode = firstTag(tags, ["addr:postcode"])

  return {
    osmId: `${element.type}:${element.id}`,
    osmType: element.type,
    name,
    website: normalizeWebsite(firstTag(tags, ["website", "contact:website", "url"])),
    phone: firstTag(tags, ["phone", "contact:phone"]),
    street,
    city,
    state,
    postcode,
    address: buildAddress(street, city, state, postcode),
    category: categoryId,
    // OSM marks chain locations with brand tags (e.g. brand:wikidata=Q...).
    chain: Boolean(firstTag(tags, ["brand:wikidata", "brand"])),
    ...coordinates(element),
    country: "United States",
    countryCode: "US",
  }
}
