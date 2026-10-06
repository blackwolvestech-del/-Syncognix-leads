/** US states, DC and territories: full name → USPS abbreviation. */
const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "puerto rico": "PR", guam: "GU", "us virgin islands": "VI",
  "american samoa": "AS", "northern mariana islands": "MP",
}

const US_STATE_ABBREVIATIONS = new Set(Object.values(US_STATES))

const US_COUNTRY_VALUES = new Set([
  "us",
  "usa",
  "u.s.",
  "u.s.a.",
  "united states",
  "united states of america",
])

/**
 * Regions just across the US border that a 30 km search around a border
 * city (Detroit, El Paso, San Diego, Buffalo…) can reach.
 */
const NEIGHBORING_NON_US_REGIONS = new Set([
  // Canada
  "alberta", "ab", "british columbia", "bc", "manitoba", "mb", "new brunswick", "nb",
  "newfoundland and labrador", "nl", "nova scotia", "ns", "ontario", "on",
  "prince edward island", "pe", "quebec", "québec", "qc", "saskatchewan", "sk",
  "yukon", "yt", "northwest territories", "nt", "nunavut", "nu",
  // Mexico (border states)
  "baja california", "b.c.", "sonora", "son.", "chihuahua", "chih.",
  "coahuila", "coahuila de zaragoza", "coah.", "nuevo león", "nuevo leon", "n.l.",
  "tamaulipas", "tamps.",
])

/** "Texas" or "tx" → "TX"; null when the value isn't a US state. */
export function usStateAbbreviation(value: string | null | undefined) {
  if (!value) return null
  const text = key(value)
  if (text in US_STATES) return US_STATES[text]
  const upper = text.toUpperCase()
  return US_STATE_ABBREVIATIONS.has(upper) ? upper : null
}

const CANADIAN_POSTCODE = /^[a-z]\d[a-z]\s?\d[a-z]\d$/i
export const US_ZIP_CODE = /^\d{5}(?:-\d{4})?$/

function key(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

export function isUsCountryValue(value: string) {
  return US_COUNTRY_VALUES.has(key(value))
}

/**
 * True when free-text input clearly refers to a US place: a ZIP code, a US
 * state name ("Dallas, Texas"), a state abbreviation after a comma
 * ("Miami, FL"), or "USA" / "United States".
 */
export function mentionsUnitedStates(input: string) {
  const text = key(input)
  if (US_ZIP_CODE.test(text)) return true

  const parts = text.split(",").map((part) => part.trim()).filter(Boolean)
  for (const part of parts) {
    if (isUsCountryValue(part) || part in US_STATES) return true
  }

  // "Miami, FL" / "Dallas TX" / "Austin, TX 78701": two-letter code after a
  // comma or at the end. Kept strict so words like "in"/"or" never match.
  const abbreviation = input.match(/(?:,\s*|\s)([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/)
  return Boolean(abbreviation && US_STATE_ABBREVIATIONS.has(abbreviation[1].toUpperCase()))
}

/**
 * Extra guard on OSM tags: excludes businesses whose own address says they
 * are outside the US. Missing tags never exclude a result.
 */
export function hasNonUsAddress(tags: Record<string, string>) {
  const country = tags["addr:country"]
  if (country && !isUsCountryValue(country)) return true

  const state = tags["addr:state"] ?? tags["addr:province"]
  if (state && NEIGHBORING_NON_US_REGIONS.has(key(state))) return true

  const postcode = tags["addr:postcode"]
  if (postcode && CANADIAN_POSTCODE.test(postcode.trim())) return true

  return false
}
