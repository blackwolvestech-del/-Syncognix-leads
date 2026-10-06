import "server-only"

import { usStateAbbreviation } from "@/lib/business-search/us-regions"
import { pickDecisionMaker } from "./decision-maker"
import { asRecord, createThrottle, providerFetch } from "./http"
import {
  cleanLinkedinUrl,
  cleanText,
  normalizeCompanyName,
  normalizeDomain,
  normalizeEmail,
} from "./normalize"
import {
  EnrichmentError,
  type BusinessInput,
  type DecisionMakerResult,
  type EnrichmentProvider,
  type TrackCall,
} from "./types"

/*
 * Prospeo (https://prospeo.io/api-docs). Two calls per business, both only
 * after the user asks for a lookup:
 *
 *   1. POST /search-person  — senior people at the company (by domain, or by
 *      name when the business has no own domain). 1 credit when it returns
 *      results; nothing when it returns none.
 *   2. POST /enrich-person  — reveals the chosen person's work email.
 *      1 credit when an email is found; nothing on no match.
 *
 * Mobile numbers are never requested: `enrich_mobile` stays false (it would
 * cost 10 credits) and any mobile field in a response is ignored.
 */

const BASE_URL = "https://api.prospeo.io"
const TIMEOUT_MS = 20_000
/** Search endpoints allow 1 request/second on the entry plan; keep a margin. */
const throttleSearch = createThrottle(1_100)

export const PROSPEO_ACTIONS = {
  search: "prospeo_decision_maker_search",
  email: "prospeo_email_enrichment",
} as const

/** Seniority levels worth contacting, as Prospeo names them. */
const SENIOR_LEVELS = ["Founder/Owner", "C-Suite", "Partner", "Vice President", "Head", "Director", "Manager"]

function apiKey() {
  return process.env.PROSPEO_API_KEY?.trim() || null
}

/** Maps Prospeo's error codes to our user-safe errors. */
function toError(status: number, code: string | undefined, endpoint: string) {
  const detail = `prospeo ${endpoint}: HTTP ${status} ${code ?? "(no error_code)"}`
  if (status === 429) return new EnrichmentError("rate_limited", { detail })
  switch (code) {
    case "INVALID_API_KEY":
      return new EnrichmentError("invalid_key", { detail })
    case "INSUFFICIENT_CREDITS":
      return new EnrichmentError("quota_exhausted", { detail })
    case "PLAN_REQUIRED":
      return new EnrichmentError("plan_required", { detail })
    case "SERVICE_TEMPORARILY_UNAVAILABLE":
    case "INTERNAL_ERROR":
      return new EnrichmentError("unavailable", { detail })
    default:
      // INVALID_FILTERS / INVALID_REQUEST / INVALID_DATAPOINTS are our bug, not the user's.
      return new EnrichmentError("unavailable", { detail })
  }
}

async function post(endpoint: string, key: string, body: unknown) {
  const { status, body: json } = await providerFetch(
    "prospeo",
    `${BASE_URL}/${endpoint}`,
    {
      method: "POST",
      headers: { "X-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    TIMEOUT_MS
  )
  const data = asRecord(json)
  return { status, data, errorCode: typeof data.error_code === "string" ? data.error_code : undefined }
}

interface Candidate {
  personId?: string
  firstName?: string
  lastName?: string
  fullName?: string
  title?: string
  seniority?: string
  linkedinUrl?: string
  companyName?: string
  companyDomain?: string
  companyLocation?: string
}

function toCandidate(result: unknown): Candidate {
  const row = asRecord(result)
  const person = asRecord(row.person)
  const company = asRecord(row.company)
  const firstName = cleanText(person.first_name, 100)
  const lastName = cleanText(person.last_name, 100)
  return {
    personId: cleanText(person.person_id, 100),
    firstName,
    lastName,
    fullName: cleanText(person.full_name) ?? ([firstName, lastName].filter(Boolean).join(" ") || undefined),
    title: cleanText(person.job_title ?? person.current_job_title),
    seniority: cleanText(person.seniority, 60),
    linkedinUrl: cleanLinkedinUrl(person.linkedin_url),
    companyName: cleanText(company.company_name ?? company.name),
    companyDomain: normalizeDomain(cleanText(company.website ?? company.domain)) ?? undefined,
    companyLocation: cleanText(company.location, 200),
  }
}

/**
 * Guards against a provider matching the wrong company. By domain: the
 * result's domain must be ours. By name (no domain): the name must match
 * exactly after normalization, and its location must be in the same state.
 */
function sameCompany(candidate: Candidate, input: BusinessInput) {
  if (input.domain) {
    return !candidate.companyDomain || candidate.companyDomain === input.domain
  }
  if (!candidate.companyName) return false
  if (normalizeCompanyName(candidate.companyName) !== normalizeCompanyName(input.companyName)) {
    return false
  }
  if (!input.state) return false
  const location = candidate.companyLocation ?? ""
  if (!/united states/i.test(location)) return false
  return location
    .split(",")
    .map((part) => usStateAbbreviation(part.trim()))
    .includes(input.state)
}

function noMatch(): DecisionMakerResult {
  return { status: "no_match", provider: "prospeo", metadata: { enrichedAt: new Date().toISOString() } }
}

export const prospeo: EnrichmentProvider = {
  id: "prospeo",

  isConfigured() {
    return apiKey() !== null
  },

  async findDecisionMaker(input: BusinessInput, track: TrackCall): Promise<DecisionMakerResult> {
    const key = apiKey()
    if (!key) {
      throw new EnrichmentError("not_configured", {
        message:
          "Enrichment provider is not configured. Add your Prospeo API key in environment settings.",
      })
    }
    // A name-only lookup can't be trusted without a state to confirm the match.
    if (!input.domain && !input.state) return noMatch()

    // 1. Senior people at this company.
    const company = input.domain
      ? { websites: { include: [input.domain] } }
      : { names: { include: [input.companyName] } }

    const search = await throttleSearch(() =>
      post("search-person", key, {
        page: 1,
        filters: { company, person_seniority: { include: SENIOR_LEVELS } },
      })
    )

    if (search.data.error === true || search.status !== 200) {
      if (search.errorCode === "NO_RESULTS") {
        track({ provider: "prospeo", action: PROSPEO_ACTIONS.search, success: true, creditsEstimated: 0 })
        return noMatch()
      }
      track({ provider: "prospeo", action: PROSPEO_ACTIONS.search, success: false, creditsEstimated: 0 })
      throw toError(search.status, search.errorCode, "search-person")
    }

    const results = Array.isArray(search.data.results) ? search.data.results : []
    track({
      provider: "prospeo",
      action: PROSPEO_ACTIONS.search,
      success: true,
      // Documented: 1 credit per search with results, unless served free.
      creditsEstimated: results.length > 0 && search.data.free !== true ? 1 : 0,
    })

    const best = pickDecisionMaker(results.map(toCandidate).filter((c) => sameCompany(c, input)))
    if (!best) return noMatch()

    const result: DecisionMakerResult = {
      status: "partial",
      provider: "prospeo",
      person: {
        firstName: best.firstName,
        lastName: best.lastName,
        fullName: best.fullName,
        title: best.title,
        seniority: best.seniority,
        linkedinUrl: best.linkedinUrl,
      },
      company: { name: best.companyName, domain: best.companyDomain ?? input.domain ?? undefined },
      rawProviderId: best.personId,
      metadata: { enrichedAt: new Date().toISOString() },
    }
    if (!best.personId) return result

    // 2. Reveal that person's work email. Mobile enrichment stays off.
    const enrich = await post("enrich-person", key, {
      only_verified_email: false,
      enrich_mobile: false,
      data: { person_id: best.personId },
    })

    if (enrich.data.error === true || enrich.status !== 200) {
      if (enrich.errorCode === "NO_MATCH") {
        track({ provider: "prospeo", action: PROSPEO_ACTIONS.email, success: true, creditsEstimated: 0 })
        return result
      }
      track({ provider: "prospeo", action: PROSPEO_ACTIONS.email, success: false, creditsEstimated: 0 })
      throw toError(enrich.status, enrich.errorCode, "enrich-person")
    }

    const person = asRecord(enrich.data.person)
    const email = asRecord(person.email)
    const address = email.revealed === false ? null : normalizeEmail(cleanText(email.email, 254))
    track({
      provider: "prospeo",
      action: PROSPEO_ACTIONS.email,
      success: true,
      // Documented: 1 credit when an email is found, unless a free repeat.
      creditsEstimated: address && enrich.data.free_enrichment !== true ? 1 : 0,
    })

    // Enrich Person returns fuller profile fields than Search Person.
    result.person = {
      ...result.person,
      fullName: cleanText(person.full_name) ?? result.person?.fullName,
      title: cleanText(person.current_job_title) ?? result.person?.title,
      linkedinUrl: cleanLinkedinUrl(person.linkedin_url) ?? result.person?.linkedinUrl,
    }
    if (address) {
      result.status = "enriched"
      result.email = { address, providerStatus: cleanText(email.status, 40) }
    }
    return result
  },
}

/** Official credit balance from Prospeo's free account endpoint; null if unavailable. */
export async function getProspeoAccount() {
  const key = apiKey()
  if (!key) return null
  try {
    const { status, body } = await providerFetch(
      "prospeo",
      `${BASE_URL}/account-information`,
      { method: "GET", headers: { "X-KEY": key, "Content-Type": "application/json" } },
      8_000
    )
    const data = asRecord(body)
    if (status !== 200 || data.error === true) return null
    const response = asRecord(data.response)
    const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null)
    return {
      plan: cleanText(response.current_plan, 40) ?? null,
      remaining: number(response.remaining_credits),
      used: number(response.used_credits),
    }
  } catch {
    return null
  }
}
