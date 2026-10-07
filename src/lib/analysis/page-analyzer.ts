import { usStateAbbreviation, usStateName } from "@/lib/business-search/us-regions"
import { normalizeCompanyName } from "@/lib/enrichment/normalize"
import type {
  CtaKind,
  FormKind,
  ImportantPage,
  SocialPlatform,
  WebsiteAnalysis,
} from "@/types/analysis"
import type { BusinessSearchResult } from "@/types/business"
import { ANALYSIS_CONFIG, categoryProfile } from "./config"
import { tokenize } from "./html-parser"

/*
 * Reads facts out of one fetched HTML page: technical basics, on-page SEO,
 * conversion elements, contact details, local signals, social links and
 * navigation. Everything is observed in the HTML — nothing is rendered,
 * submitted, scored or guessed here. Forms are inspected, never sent.
 */

/** What the analyzer needs to know about the fetch (see website-fetcher.ts). */
export interface PageInput {
  requestedUrl: string
  finalUrl: string
  statusCode: number
  redirectCount: number
  contentType: string | null
  responseTimeMs: number
  httpRedirectsToHttps: boolean | null
  html: string
  htmlBytes: number
  truncated: boolean
}

type Business = Pick<
  BusinessSearchResult,
  "name" | "category" | "city" | "state" | "phone" | "street" | "postcode"
>

const clean = (text: string) => text.replace(/\s+/g, " ").trim()
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "")

// --- calls to action ---------------------------------------------------------

const CTA_PATTERNS: [CtaKind, RegExp][] = [
  ["quote", /\b(quote|estimate|free (consultation|inspection|assessment)|request (a )?(bid|consultation)|get (a )?bid)\b/],
  ["booking", /\b(book|schedule|appointment|reserve|reservation|make a booking)\b/],
  ["order", /\b(order (now|online|here|food|delivery|pickup)|buy now|shop now|add to cart|order$)/],
  ["call", /\b(call (now|us|today)|call \(?\d|tap to call|click to call)\b|^call$/],
  ["contact", /^(contact( us)?|get in touch|reach out|message us|text us|send (us )?(a )?message|talk to (us|an expert)|speak (to|with) .{0,20}|request (a )?(service|call ?back|info(rmation)?))\b/],
  ["start", /\b(get started|start (now|today|here))\b/],
]

/** Third-party scheduling/ordering tools: a link or embed is itself a booking or order option. */
const BOOKING_HOSTS = /calendly\.com|acuityscheduling\.com|squareup\.com\/appointments|square\.site|setmore\.com|booksy\.com|vagaro\.com|fresha\.com|mindbodyonline\.com|schedulicity\.com|housecallpro\.com|getjobber\.com|servicetitan\.com|opentable\.com|resy\.com|zocdoc\.com|localmed\.com|nexhealth\.com|simplybook\.me/i
const ORDER_HOSTS = /doordash\.com|ubereats\.com|grubhub\.com|toasttab\.com|chownow\.com|order\.online|clover\.com\/online-ordering|slicelife\.com/i
const FORM_EMBEDS: [string, RegExp][] = [
  ["HubSpot", /hsforms\.(com|net)|hbspt\.forms|js\.hsforms/i],
  ["Typeform", /typeform\.com/i],
  ["Jotform", /jotform\.com/i],
  ["Google Forms", /docs\.google\.com\/forms/i],
  ["Wufoo", /wufoo\.com/i],
  ["Formstack", /formstack\.com/i],
  ["Cognito Forms", /cognitoforms\.com/i],
  ["Tally", /tally\.so/i],
]

function ctaKind(text: string): CtaKind | null {
  const value = text.toLowerCase()
  return CTA_PATTERNS.find(([, pattern]) => pattern.test(value))?.[0] ?? null
}

// --- navigation --------------------------------------------------------------

const PAGE_PATTERNS: [ImportantPage, RegExp][] = [
  ["service_areas", /\b(service areas?|areas? (we )?serve[ds]?|areas? served|locations? we serve)\b/],
  ["services", /\b(services?|what we do|our work(s)? includes)\b/],
  ["about", /\b(about|our story|who we are|our company)\b/],
  ["contact", /\b(contact|get in touch)\b/],
  ["pricing", /\b(pricing|prices?|rates|plans|specials|coupons|financing)\b/],
  ["testimonials", /\b(testimonials?|reviews?|what (our )?(clients|customers|patients) say)\b/],
  ["faq", /\b(faqs?|frequently asked)\b/],
  ["gallery", /\b(gallery|portfolio|our work|projects|before (and|&) after)\b/],
  ["team", /\b(team|our staff|meet (the|our)|our (doctors?|dentists?|technicians|crew))\b/],
  ["booking", /\b(book|booking|schedule|appointments?|reservations?)\b/],
  ["blog", /\b(blog|news|articles|resources|tips)\b/],
  ["locations", /\blocations?\b/],
]

const SOCIAL_HOSTS: [SocialPlatform, RegExp][] = [
  ["facebook", /(^|\.)(facebook|fb)\.com$/],
  ["instagram", /(^|\.)instagram\.com$/],
  ["linkedin", /(^|\.)linkedin\.com$/],
  ["youtube", /(^|\.)(youtube\.com|youtu\.be)$/],
  ["tiktok", /(^|\.)tiktok\.com$/],
  ["x", /(^|\.)(twitter|x)\.com$/],
]
/** Share/intent links are buttons, not the business's own profile. */
const SOCIAL_SHARE_PATH = /^\/(sharer|share|intent|dialog|plugins|hashtag|search)\b|\/sharer\.php/i

// --- structured data ---------------------------------------------------------

const LOCAL_BUSINESS_TYPES = new Set([
  "localbusiness", "dentist", "restaurant", "roofingcontractor", "plumber", "electrician",
  "hvacbusiness", "autorepair", "autowash", "autobodyshop", "automotivebusiness",
  "professionalservice", "homeandconstructionbusiness", "generalcontractor", "housepainter",
  "locksmith", "movingcompany", "foodestablishment", "cafeorcoffeeshop", "barorpub", "bakery",
  "fastfoodrestaurant", "medicalbusiness", "medicalclinic", "physician", "legalservice",
  "attorney", "store", "healthandbeautybusiness", "beautysalon", "hairsalon", "dayspa",
  "lodgingbusiness", "financialservice", "realestateagent", "veterinarycare", "childcare",
  "drycleaningorlaundry", "emergencyservice", "entertainmentbusiness", "sportsactivitylocation",
  "landscapingbusiness", "cleaningservice", "pestcontrol",
])
const ORGANIZATION_TYPES = new Set(["organization", "corporation", "ngo", "onlinebusiness"])

interface SchemaFacts {
  types: Set<string>
  hasAddress: boolean
  phones: string[]
}

function schemaTypeName(value: string) {
  return value.replace(/^https?:\/\/schema\.org\//i, "").trim()
}

function walkSchema(node: unknown, facts: SchemaFacts, depth = 0) {
  if (!node || typeof node !== "object" || depth > 8) return
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 100)) walkSchema(item, facts, depth + 1)
    return
  }
  const record = node as Record<string, unknown>
  for (const type of [record["@type"]].flat()) {
    if (typeof type === "string" && type && facts.types.size < 30) facts.types.add(schemaTypeName(type))
  }
  const address = record.address
  if (address && typeof address === "object" && "streetAddress" in address) facts.hasAddress = true
  if (typeof record.telephone === "string") facts.phones.push(record.telephone)
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") walkSchema(value, facts, depth + 1)
  }
}

// --- contact details ---------------------------------------------------------

const PHONE = /(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]?\d{4}\b/g
const EMAIL = /\b[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi
/** Addresses that belong to site builders and tooling, not to the business. */
const NON_BUSINESS_EMAIL = /\.(png|jpe?g|gif|webp|svg|css|js)$|@(example|sentry|wixpress|sentry-next|domain|email|yourdomain)\.|@sentry\.io|^(you|name|email|user)@/i
const STREET = /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Za-z0-9.'-]+\s+){0,4}(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|highway|hwy|parkway|pkwy|court|ct|place|pl|circle|cir|trail|trl|suite|ste)\b/i
const STATE_ZIP = /\b[A-Z]{2}\.?,?\s+\d{5}(?:-\d{4})?\b/
const SERVICE_AREA = /\b(serving|proudly serv\w+|we serve|service areas?|areas? (we )?serve[ds]?|surrounding (areas?|communities)|locally owned|family[- ]owned)\b/i

function phoneDigits(value: string) {
  const digits = value.replace(/\D/g, "")
  return digits.length === 11 && digits[0] === "1" ? digits.slice(1) : digits
}

// --- forms -------------------------------------------------------------------

const FIELD_PATTERNS: [string, RegExp][] = [
  ["email", /e-?mail/],
  ["phone", /phone|\btel\b|mobile|cell/],
  ["message", /message|comment|details|question|inquiry|enquiry|how can we|tell us|describe/],
  ["service", /service|project|interest|subject|reason|type of|looking for/],
  ["date", /date|time|\bwhen\b|\bday\b/],
  ["location", /address|\bzip\b|postal|\bcity\b|location/],
  ["name", /name/],
]

interface OpenForm {
  fields: Set<string>
  inputs: number
  hasPassword: boolean
  isSearch: boolean
}

function fieldKind(tag: string, attrs: Record<string, string>) {
  const type = (attrs.type ?? "").toLowerCase()
  if (tag === "textarea") return "message"
  if (type === "email") return "email"
  if (type === "tel") return "phone"
  if (type === "date" || type === "datetime-local" || type === "time") return "date"
  const descriptor = [attrs.name, attrs.id, attrs.placeholder, attrs["aria-label"], attrs.autocomplete]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
  if (/user.?name|company|business/.test(descriptor)) return "other"
  return FIELD_PATTERNS.find(([, pattern]) => pattern.test(descriptor))?.[0] ?? "other"
}

function formKind(form: OpenForm): FormKind {
  if (form.hasPassword) return "login"
  if (form.isSearch) return "search"
  const has = (field: string) => form.fields.has(field)
  if (form.inputs === 1 && has("email")) return "newsletter"
  const reachable = has("email") || has("phone")
  if (reachable && (has("name") || has("message") || form.inputs >= 3)) return "contact"
  return "other"
}

// --- the analyzer ------------------------------------------------------------

const HIDDEN_TAGS = new Set(["noscript", "template", "svg", "head", "select", "option"])
const CAPTURE_TAGS = new Set(["a", "button", "h1", "h2", "title"])
const GENERIC_TITLE = /^(home|homepage|home page|welcome|index|untitled|my (site|website)|new (site|page)|default|coming soon|just another wordpress site|site title)$/

interface Capture {
  tag: string
  attrs: Record<string, string>
  text: string
}

export function analyzePage(page: PageInput, business: Business): WebsiteAnalysis {
  const { thresholds } = ANALYSIS_CONFIG
  const tokens = tokenize(page.html)
  const finalUrl = new URL(page.finalUrl)
  const siteHost = bareHost(finalUrl.hostname)
  const profile = categoryProfile(business.category)

  let lang: string | null = null
  let title: string | null = null
  let metaDescription: string | null = null
  let robotsMeta: string | null = null
  let canonicalUrl: string | null = null
  let hasViewport = false
  let hasFavicon = false
  let scriptCount = 0
  let hiddenDepth = 0
  const visible: string[] = []
  const h1Texts: string[] = []
  const h2Texts: string[] = []
  let h2Count = 0
  let imageCount = 0
  let missingAltCount = 0
  let emptyAltCount = 0
  let internalLinkCount = 0
  let externalLinkCount = 0
  let hasPhoneCta = false
  let hasEmailCta = false
  let embeddedForm: string | null = null
  let contactPageUrl: string | null = null
  const responsiveHints = new Set<string>()
  const ctas = new Map<string, { text: string; kind: CtaKind }>()
  const forms: { kind: FormKind; fields: string[] }[] = []
  const socialProfiles = new Map<SocialPlatform, string>()
  const detectedPages = new Set<ImportantPage>()
  const phones = new Set<string>()
  const emails = new Set<string>()
  const schema: SchemaFacts = { types: new Set(), hasAddress: false, phones: [] }
  const captures: Capture[] = []
  let form: OpenForm | null = null

  const addCta = (text: string, kind: CtaKind) => {
    const label = clean(text).slice(0, 60)
    if (ctas.size < 12) ctas.set(`${kind}:${label.toLowerCase()}`, { text: label || kind, kind })
  }

  const noteEmbed = (source: string) => {
    if (!source) return
    embeddedForm ??= FORM_EMBEDS.find(([, pattern]) => pattern.test(source))?.[0] ?? null
  }

  const closeForm = () => {
    if (!form) return
    if (form.inputs > 0 && forms.length < 10) forms.push({ kind: formKind(form), fields: [...form.fields] })
    form = null
  }

  /** Handles a finished <a>, <button>, heading or <title>. */
  const finish = ({ tag, attrs, text: rawText }: Capture) => {
    const text = clean(rawText)
    if (tag === "title") return void (title ??= text || null)
    if (tag === "h1") return void (text && h1Texts.push(text.slice(0, 160)))
    if (tag === "h2") {
      h2Count++
      if (text && h2Texts.length < 8) h2Texts.push(text.slice(0, 120))
      return
    }

    const label = text || clean(attrs["aria-label"] ?? attrs.title ?? "")
    const actionable = label.length > 0 && label.length <= 40

    if (tag === "button") {
      const kind = actionable ? ctaKind(label) : null
      // A form's own submit button isn't a separate call to action.
      if (kind && !form) addCta(label, kind)
      return
    }

    const href = (attrs.href ?? "").trim()
    if (!href || /^javascript:/i.test(href)) return

    if (/^tel:/i.test(href)) {
      hasPhoneCta = true
      const digits = phoneDigits(href.slice(4))
      if (digits.length === 10) phones.add(digits)
      return addCta(label || "Call", "call")
    }
    if (/^mailto:/i.test(href)) {
      hasEmailCta = true
      const address = href.slice(7).split("?")[0].trim().toLowerCase()
      if (EMAIL.test(address) && !NON_BUSINESS_EMAIL.test(address)) emails.add(address)
      EMAIL.lastIndex = 0
      return
    }
    if (/^sms:/i.test(href)) return addCta(label || "Text us", "contact")

    let url: URL
    try {
      url = new URL(href, finalUrl)
    } catch {
      return
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return

    const host = bareHost(url.hostname)
    const internal = host === siteHost || host.endsWith(`.${siteHost}`)
    const samePage = internal && url.pathname === finalUrl.pathname && url.search === finalUrl.search

    if (internal) {
      if (!samePage) internalLinkCount++
      // In-page anchors count too: one-page sites keep these as sections.
      if (!samePage || url.hash.length > 1) {
        const target = `${label} ${decodeURIComponentSafe(url.pathname + url.hash).replace(/[/#_-]+/g, " ")}`.toLowerCase()
        for (const [name, pattern] of PAGE_PATTERNS) {
          if (pattern.test(target)) {
            detectedPages.add(name)
            if (name === "contact" && !samePage) contactPageUrl ??= url.origin + url.pathname
          }
        }
      }
    } else {
      externalLinkCount++
      const platform = SOCIAL_HOSTS.find(([, pattern]) => pattern.test(host))?.[0]
      if (platform && url.pathname.length > 1 && !SOCIAL_SHARE_PATH.test(url.pathname) && !socialProfiles.has(platform)) {
        socialProfiles.set(platform, url.origin + url.pathname)
      }
    }

    const target = url.host + url.pathname
    const kind =
      (actionable ? ctaKind(label) : null) ??
      (BOOKING_HOSTS.test(target) ? "booking" : ORDER_HOSTS.test(target) ? "order" : null)
    if (kind) addCta(label, kind)
    if (kind === "booking") detectedPages.add("booking")
  }

  for (const token of tokens) {
    if (token.type === "raw") {
      if (token.tag === "style") {
        if (/@media[^{]*\((min|max)-width/i.test(token.text)) responsiveHints.add("CSS media queries in page styles")
        continue
      }
      scriptCount++
      noteEmbed(token.attrs.src ?? "")
      if (/ld\+json/i.test(token.attrs.type ?? "")) {
        try {
          walkSchema(JSON.parse(token.text), schema)
        } catch {
          // Invalid JSON-LD is simply not counted.
        }
      } else if (!token.attrs.src) {
        noteEmbed(token.text.slice(0, 20_000))
      }
      continue
    }

    if (token.type === "text") {
      if (captures.length) for (const capture of captures) capture.text += ` ${token.text}`
      if (hiddenDepth === 0) visible.push(token.text)
      continue
    }

    if (token.type === "close") {
      if (HIDDEN_TAGS.has(token.tag)) hiddenDepth = Math.max(0, hiddenDepth - 1)
      if (token.tag === "form") closeForm()
      if (CAPTURE_TAGS.has(token.tag)) {
        const index = captures.findLastIndex((capture) => capture.tag === token.tag)
        if (index !== -1) finish(captures.splice(index, 1)[0])
      }
      continue
    }

    const { tag, attrs } = token
    if (HIDDEN_TAGS.has(tag)) hiddenDepth++

    const classes = attrs.class
    if (classes && responsiveHints.size < 4) {
      if (/\bcol-(xs|sm|md|lg|xl)-\d/.test(classes)) responsiveHints.add("Bootstrap-style grid classes")
      else if (/(^|\s)(sm|md|lg|xl):[a-z]/.test(classes)) responsiveHints.add("Responsive utility classes")
    }
    const itemType = attrs.itemtype
    if (itemType && /schema\.org/i.test(itemType) && schema.types.size < 30) {
      schema.types.add(schemaTypeName(itemType))
    }

    switch (tag) {
      case "html":
        lang ??= attrs.lang?.trim() || null
        break
      case "body":
        // An unclosed <head> must not hide the whole page.
        hiddenDepth = 0
        break
      case "meta": {
        const name = (attrs.name ?? attrs.property ?? "").toLowerCase()
        const content = clean(attrs.content ?? "")
        if (name === "description") metaDescription ??= content || null
        else if (name === "robots") robotsMeta ??= content.toLowerCase() || null
        else if (name === "viewport" && /width\s*=/.test(content)) hasViewport = true
        break
      }
      case "link": {
        const rel = (attrs.rel ?? "").toLowerCase()
        if (/\bcanonical\b/.test(rel) && attrs.href) canonicalUrl ??= attrs.href.trim()
        if (/\bicon\b/.test(rel) && attrs.href) hasFavicon = true
        break
      }
      case "img": {
        // Tracking pixels aren't content images.
        if (attrs.width === "1" || attrs.height === "1") break
        imageCount++
        if (!("alt" in attrs)) missingAltCount++
        else if (!attrs.alt.trim()) emptyAltCount++
        else if (captures.length) captures[captures.length - 1].text += ` ${attrs.alt}`
        break
      }
      case "iframe":
        noteEmbed(attrs.src ?? "")
        if (BOOKING_HOSTS.test(attrs.src ?? "")) {
          addCta("Embedded booking", "booking")
          detectedPages.add("booking")
        }
        break
      case "form":
        closeForm()
        form = {
          fields: new Set(),
          inputs: 0,
          hasPassword: false,
          isSearch: attrs.role === "search" || /search/i.test(`${attrs.class ?? ""} ${attrs.id ?? ""} ${attrs.action ?? ""}`),
        }
        break
      case "input":
      case "textarea":
      case "select": {
        const type = (attrs.type ?? "").toLowerCase()
        if (tag === "input" && (type === "submit" || type === "button")) {
          const kind = attrs.value && !form ? ctaKind(attrs.value) : null
          if (kind) addCta(attrs.value, kind)
          break
        }
        if (!form || ["hidden", "image", "reset", "checkbox", "radio", "file"].includes(type)) break
        if (type === "password") form.hasPassword = true
        if (type === "search" || /^(q|s|query|search)$/i.test(attrs.name ?? "")) form.isSearch = true
        form.inputs++
        const kind = fieldKind(tag, attrs)
        if (kind !== "other") form.fields.add(kind)
        break
      }
    }

    if (CAPTURE_TAGS.has(tag) && captures.length < 50) captures.push({ tag, attrs, text: "" })
  }
  closeForm()
  for (const capture of captures) finish(capture)

  // --- text-level signals ---------------------------------------------------
  const text = clean(visible.join(" "))
  const wordCount = text ? text.split(" ").length : 0
  const searchable = `${title ?? ""} ${metaDescription ?? ""} ${text}`
  const lower = searchable.toLowerCase()

  for (const match of text.match(PHONE) ?? []) {
    const digits = phoneDigits(match)
    if (digits.length === 10 && phones.size < 5) phones.add(digits)
  }
  for (const value of schema.phones) {
    const digits = phoneDigits(value)
    if (digits.length === 10 && phones.size < 5) phones.add(digits)
  }
  for (const match of text.match(EMAIL) ?? []) {
    const address = match.toLowerCase()
    if (!NON_BUSINESS_EMAIL.test(address) && emails.size < 3) emails.add(address)
  }

  const listingPhone = business.phone ? phoneDigits(business.phone) : ""
  const street = business.street ? clean(business.street).toLowerCase() : ""
  const addressFound =
    schema.hasAddress ||
    (street.length >= 6 && lower.includes(street)) ||
    (STREET.test(text) && STATE_ZIP.test(text))

  const city = business.city?.trim()
  const stateName = usStateName(business.state)
  const stateCode = usStateAbbreviation(business.state)
  const cityMentioned = city ? new RegExp(`\\b${escapeRegExp(city)}\\b`, "i").test(searchable) : null
  const stateMentioned =
    stateName && stateCode
      ? new RegExp(`\\b${escapeRegExp(stateName)}\\b`, "i").test(searchable) ||
        new RegExp(`,\\s*${stateCode}\\b|\\b${stateCode}\\s+\\d{5}\\b`).test(searchable)
      : null

  const serviceTermsFound = profile.terms.filter((term) => lower.includes(term))

  const titleLower = (title ?? "").toLowerCase()
  const nameKey = normalizeCompanyName(business.name)
  const titleRest = clean(
    normalizeCompanyName(title ?? "").replace(nameKey, " ")
  )
  const schemaTypes = [...schema.types]
  const typeKeys = schemaTypes.map((type) => type.toLowerCase())
  const ctaList = [...ctas.values()]
  const hasKind = (kind: CtaKind) => ctaList.some((cta) => cta.kind === kind)
  const hasQuoteCta = hasKind("quote")
  const hasBookingCta = hasKind("booking")
  const hasOrderCta = hasKind("order")
  const primaryCtaCount = ctaList.filter((cta) => cta.kind !== "call").length
  const robots = robotsMeta as string | null

  return {
    requestedUrl: page.requestedUrl,
    finalUrl: page.finalUrl,
    statusCode: page.statusCode,
    redirectCount: page.redirectCount,
    contentType: page.contentType,
    responseTimeMs: page.responseTimeMs,
    https: finalUrl.protocol === "https:",
    httpRedirectsToHttps: page.httpRedirectsToHttps,
    htmlBytes: page.htmlBytes,
    truncated: page.truncated,
    clientRendered: wordCount < thresholds.clientRenderedWords && scriptCount > 0,

    title,
    titleGeneric: title !== null && (GENERIC_TITLE.test(titleLower.trim()) || GENERIC_TITLE.test(titleRest)),
    titleHasBusinessName: nameKey.length > 0 && normalizeCompanyName(title ?? "").includes(nameKey),
    titleHasLocation: city ? titleLower.includes(city.toLowerCase()) : null,
    titleHasService: profile.terms.some((term) => titleLower.includes(term)),
    metaDescription,
    h1Texts: h1Texts.slice(0, 5),
    h1Count: h1Texts.length,
    h2Texts,
    h2Count,
    hasViewport,
    responsiveHints: [...responsiveHints],
    canonicalUrl,
    robotsMeta: robots,
    noindex: robots !== null && /\b(noindex|none)\b/.test(robots),
    lang,
    hasFavicon,
    wordCount,

    imageCount,
    missingAltCount,
    emptyAltCount,
    internalLinkCount,
    externalLinkCount,

    schemaTypes,
    hasLocalBusinessSchema: typeKeys.some((type) => LOCAL_BUSINESS_TYPES.has(type)),
    hasOrganizationSchema: typeKeys.some((type) => ORGANIZATION_TYPES.has(type)),

    ctas: ctaList,
    hasPhoneCta,
    hasEmailCta,
    hasQuoteCta,
    hasBookingCta,
    hasOrderCta,
    primaryCtaCount,
    ctaClarity:
      hasQuoteCta || hasBookingCta || hasOrderCta
        ? "strong"
        : primaryCtaCount > 0 || hasPhoneCta
          ? "moderate"
          : "weak",
    forms,
    hasContactForm: forms.some((entry) => entry.kind === "contact") || embeddedForm !== null,
    embeddedForm,

    socialProfiles: [...socialProfiles].map(([platform, url]) => ({ platform, url })),
    phones: [...phones],
    emails: [...emails],
    phoneMatchesListing: listingPhone.length === 10 ? phones.has(listingPhone) : null,
    addressFound,
    contactPageUrl,
    cityMentioned,
    stateMentioned,
    serviceAreaLanguage: SERVICE_AREA.test(text),
    serviceTermsFound,
    detectedPages: [...detectedPages],
  }
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
