import type { BusinessSearchResult, OsmElementType } from "@/types/business"

const OSM_TYPES = new Set<OsmElementType>(["node", "way", "relation"])
/** "node:123456" — the Step 2 business id. */
const OSM_ID = /^(node|way|relation):\d{1,20}$/

function text(value: unknown, max: number) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function coordinate(value: unknown, limit: number) {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit
    ? value
    : null
}

export function isBusinessId(value: unknown): value is string {
  return typeof value === "string" && OSM_ID.test(value)
}

/**
 * Server actions and API routes accept any payload, so a business sent by
 * the browser is rebuilt from known fields only. Returns null when it isn't
 * a well-formed business.
 */
export function parseBusiness(value: unknown): BusinessSearchResult | null {
  if (!value || typeof value !== "object") return null
  const input = value as Record<string, unknown>
  const osmType = input.osmType as OsmElementType
  const name = text(input.name, 300)
  const category = text(input.category, 100)
  if (!isBusinessId(input.osmId) || !OSM_TYPES.has(osmType) || !name || !category) return null

  const website = text(input.website, 2048)
  return {
    osmId: input.osmId,
    osmType,
    name,
    website: website && /^https?:\/\//i.test(website) ? website : null,
    phone: text(input.phone, 100),
    street: text(input.street, 300),
    city: text(input.city, 200),
    state: text(input.state, 200),
    postcode: text(input.postcode, 20),
    address: text(input.address, 500),
    category,
    latitude: coordinate(input.latitude, 90),
    longitude: coordinate(input.longitude, 180),
    chain: input.chain === true,
    country: "United States",
    countryCode: "US",
  }
}
