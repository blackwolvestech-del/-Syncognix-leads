import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { getCategoryLabel } from "@/lib/business-search/normalize-category"
import { usStateAbbreviation } from "@/lib/business-search/us-regions"
import { scoreProspect } from "@/lib/scoring/prospect-score"
import type { BusinessSearchResult } from "@/types/business"
import type { Database } from "@/types/database"
import type { LeadEnrichment } from "@/types/enrichment"
import {
  findCachedEnrichment,
  findCachedVerification,
  getEnrichmentRow,
  hasFreshVerification,
  storeEnrichment,
  storeVerification,
  toEnrichment,
} from "./cache"
import { businessDomain } from "./normalize"
import { getEmailVerifier, getEnrichmentProviders } from "./provider"
import { recordUsage } from "./usage"
import {
  EnrichmentError,
  type BusinessInput,
  type DecisionMakerResult,
  type ProviderCall,
} from "./types"

/*
 * The only place that decides whether a provider is called:
 *
 *   cache hit  → return stored data, no API call
 *   cache miss → provider chain → store the result → log usage
 *
 * Nothing here runs on its own; both functions are only reached from the
 * API routes, which are only called when the user clicks a button.
 */

type Client = SupabaseClient<Database>

export interface EnrichmentOutcome {
  enrichment: LeadEnrichment
  /** True when served from stored data without calling a provider. */
  cached: boolean
}

/** What a provider is told about a business: company identifiers only. */
export function toBusinessInput(business: BusinessSearchResult): BusinessInput {
  return {
    businessId: business.osmId,
    companyName: business.name,
    domain: businessDomain(business.website),
    city: business.city,
    state: usStateAbbreviation(business.state),
    country: "United States",
    category: getCategoryLabel(business.category),
  }
}

/** Requests already running, so a double click can't trigger two paid lookups. */
const inFlight = new Map<string, Promise<EnrichmentOutcome>>()

function once(key: string, run: () => Promise<EnrichmentOutcome>) {
  const running = inFlight.get(key)
  if (running) return running
  const promise = run().finally(() => inFlight.delete(key))
  inFlight.set(key, promise)
  return promise
}

/** Finds the decision maker for a business, using stored data when it exists. */
export function enrichBusiness(
  supabase: Client,
  userId: string,
  business: BusinessSearchResult
): Promise<EnrichmentOutcome> {
  return once(`enrich:${userId}:${business.osmId}`, async () => {
    const input = toBusinessInput(business)
    const prospectScore = scoreProspect(business).score

    const cached = await findCachedEnrichment(supabase, userId, input, prospectScore)
    if (cached) return { enrichment: toEnrichment(cached), cached: true }

    const providers = getEnrichmentProviders().filter((provider) => provider.isConfigured())
    if (providers.length === 0) {
      throw new EnrichmentError("not_configured", {
        message:
          "Enrichment provider is not configured. Add your Prospeo API key in environment settings.",
      })
    }

    const calls: ProviderCall[] = []
    let result: DecisionMakerResult | null = null
    try {
      // First provider to find someone wins; later ones are only fallbacks.
      for (const provider of providers) {
        result = await provider.findDecisionMaker(input, (call) => calls.push(call))
        if (result.status !== "no_match") break
      }
    } finally {
      await recordUsage(supabase, userId, calls, { businessId: input.businessId })
    }

    // "No match" is stored too, so the same lookup isn't repeated needlessly.
    const row = await storeEnrichment(supabase, userId, input, result!, prospectScore)
    return { enrichment: toEnrichment(row), cached: false }
  })
}

/** Verifies the stored work email of a business, using a stored verdict when recent. */
export function verifyBusinessEmail(
  supabase: Client,
  userId: string,
  businessId: string
): Promise<EnrichmentOutcome> {
  return once(`verify:${userId}:${businessId}`, async () => {
    // The address always comes from our own stored data, never from the client.
    const row = await getEnrichmentRow(supabase, userId, businessId)
    const email = row?.work_email
    if (!row || !email) throw new EnrichmentError("no_email")

    if (hasFreshVerification(row)) return { enrichment: toEnrichment(row), cached: true }

    // The same address may already be verified on another business.
    const other = await findCachedVerification(supabase, userId, email)
    if (other) {
      const updated = await storeVerification(supabase, userId, businessId, {
        email,
        status: other.verification_status!,
        provider: other.verification_provider ?? "unknown",
        providerStatus: other.verification_provider_status,
        score: other.verification_score,
        verifiedAt: other.email_verified_at!,
      })
      return { enrichment: toEnrichment(updated), cached: true }
    }

    const verifier = getEmailVerifier()
    const calls: ProviderCall[] = []
    let verification
    try {
      verification = await verifier.verifyEmail(email, (call) => calls.push(call))
    } finally {
      await recordUsage(supabase, userId, calls, { businessId, email })
    }

    const updated = await storeVerification(supabase, userId, businessId, verification)
    return { enrichment: toEnrichment(updated), cached: false }
  })
}
