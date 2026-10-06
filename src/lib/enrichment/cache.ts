import "server-only"

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js"
import type { Database, LeadEnrichmentRow } from "@/types/database"
import type { LeadEnrichment } from "@/types/enrichment"
import { normalizeCompanyName } from "./normalize"
import {
  EnrichmentError,
  type BusinessInput,
  type DecisionMakerResult,
  type EmailVerificationResult,
} from "./types"

/*
 * Supabase is the cache for every provider result. A lookup is only sent to
 * a provider when nothing usable is stored, so credits are never spent twice
 * on the same company or the same email address.
 */

type Client = SupabaseClient<Database>

/** A "no match" is retried after this long, in case the provider has new data. */
export const NO_MATCH_TTL_DAYS = 30
/**
 * A verification older than this may be run again — only when the user
 * clicks Verify. Nothing is ever re-verified automatically.
 */
export const VERIFICATION_TTL_DAYS = 90

const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"])
const DAY_MS = 24 * 60 * 60 * 1000

function storageError(error: PostgrestError, action: string) {
  if (MISSING_TABLE_CODES.has(error.code ?? "")) return new EnrichmentError("not_set_up")
  return new EnrichmentError("storage_failed", {
    detail: `${action}: ${error.code ?? "unknown"} ${error.message}`,
  })
}

function isFresh(iso: string | null, ttlDays: number) {
  return iso !== null && Date.now() - new Date(iso).getTime() < ttlDays * DAY_MS
}

/** Stored rows that should be used instead of calling a provider. */
function isUsable(row: LeadEnrichmentRow) {
  return row.enrichment_status !== "no_match" || isFresh(row.enriched_at, NO_MATCH_TTL_DAYS)
}

const STATUS_STRENGTH = { enriched: 2, partial: 1, no_match: 0 } as const

function strongest(rows: LeadEnrichmentRow[]) {
  return rows
    .filter(isUsable)
    .sort(
      (a, b) =>
        STATUS_STRENGTH[b.enrichment_status] - STATUS_STRENGTH[a.enrichment_status] ||
        b.enriched_at.localeCompare(a.enriched_at)
    )[0] ?? null
}

/** Database row → the shape the UI consumes. */
export function toEnrichment(row: LeadEnrichmentRow): LeadEnrichment {
  const hasPerson = row.contact_full_name || row.contact_first_name || row.contact_title
  return {
    businessId: row.business_id,
    status: row.enrichment_status,
    provider: row.provider,
    person: hasPerson
      ? {
          fullName: row.contact_full_name,
          firstName: row.contact_first_name,
          lastName: row.contact_last_name,
          title: row.contact_title,
          seniority: row.contact_seniority,
          linkedinUrl: row.linkedin_url,
        }
      : null,
    email: row.work_email ? { address: row.work_email, providerStatus: row.email_status } : null,
    verification:
      row.work_email && row.verification_status && row.email_verified_at
        ? {
            status: row.verification_status,
            provider: row.verification_provider ?? "unknown",
            providerStatus: row.verification_provider_status,
            score: row.verification_score,
            verifiedAt: row.email_verified_at,
          }
        : null,
    enrichedAt: row.enriched_at,
  }
}

/** Stored enrichments for a set of businesses. Empty when unavailable. */
export async function getEnrichmentsByBusinessIds(
  supabase: Client,
  userId: string,
  businessIds: string[]
): Promise<LeadEnrichment[]> {
  if (businessIds.length === 0) return []
  const { data, error } = await supabase
    .from("lead_enrichments")
    .select("*")
    .eq("user_id", userId)
    .in("business_id", businessIds)

  if (error) {
    if (!MISSING_TABLE_CODES.has(error.code ?? "")) {
      console.error(`[enrichment] load failed: ${error.code ?? "unknown"} ${error.message}`)
    }
    return []
  }
  return (data ?? []).filter(isUsable).map(toEnrichment)
}

export async function getEnrichmentRow(supabase: Client, userId: string, businessId: string) {
  const { data, error } = await supabase
    .from("lead_enrichments")
    .select("*")
    .eq("user_id", userId)
    .eq("business_id", businessId)
    .maybeSingle()
  if (error) throw storageError(error, "load enrichment")
  return data
}

/** The contact/verification columns that travel with a cached result. */
function resultColumns(row: LeadEnrichmentRow) {
  return {
    provider: row.provider,
    enrichment_status: row.enrichment_status,
    provider_person_id: row.provider_person_id,
    contact_first_name: row.contact_first_name,
    contact_last_name: row.contact_last_name,
    contact_full_name: row.contact_full_name,
    contact_title: row.contact_title,
    contact_seniority: row.contact_seniority,
    linkedin_url: row.linkedin_url,
    work_email: row.work_email,
    email_status: row.email_status,
    verification_status: row.verification_status,
    verification_provider: row.verification_provider,
    verification_provider_status: row.verification_provider_status,
    verification_score: row.verification_score,
    email_verified_at: row.email_verified_at,
    enriched_at: row.enriched_at,
  }
}

function businessColumns(input: BusinessInput, prospectScore: number | null) {
  return {
    business_id: input.businessId,
    business_name: input.companyName,
    business_name_key: normalizeCompanyName(input.companyName),
    business_domain: input.domain,
    business_city: input.city,
    business_state: input.state,
    prospect_score: prospectScore,
  }
}

async function upsertRow(
  supabase: Client,
  userId: string,
  values: Database["public"]["Tables"]["lead_enrichments"]["Insert"]
) {
  const { data, error } = await supabase
    .from("lead_enrichments")
    .upsert({ ...values, user_id: userId }, { onConflict: "user_id,business_id" })
    .select("*")
    .single()
  if (error) throw storageError(error, "store enrichment")
  return data
}

/**
 * Looks for a stored result before any provider is called. Tried in order:
 *   1. this exact business (business id)
 *   2. the same company domain (e.g. another location of the same company)
 *   3. the same company name in the same city/state, when domains don't conflict
 * A match found by 2 or 3 is copied onto this business, so it is linked from
 * then on. Returns null when a provider lookup is needed.
 */
export async function findCachedEnrichment(
  supabase: Client,
  userId: string,
  input: BusinessInput,
  prospectScore: number | null
): Promise<LeadEnrichmentRow | null> {
  const own = await getEnrichmentRow(supabase, userId, input.businessId)
  if (own && isUsable(own)) return own

  let match: LeadEnrichmentRow | null = null

  if (input.domain) {
    const { data, error } = await supabase
      .from("lead_enrichments")
      .select("*")
      .eq("user_id", userId)
      .eq("business_domain", input.domain)
      .order("enriched_at", { ascending: false })
      .limit(10)
    if (error) throw storageError(error, "cache lookup by domain")
    match = strongest(data ?? [])
  }

  if (!match && input.state) {
    const { data, error } = await supabase
      .from("lead_enrichments")
      .select("*")
      .eq("user_id", userId)
      .eq("business_name_key", normalizeCompanyName(input.companyName))
      .eq("business_state", input.state)
      .order("enriched_at", { ascending: false })
      .limit(10)
    if (error) throw storageError(error, "cache lookup by name")
    const city = input.city?.toLowerCase()
    match = strongest(
      (data ?? []).filter(
        (row) =>
          // Same town when both are known, and never two different domains.
          (!city || !row.business_city || row.business_city.toLowerCase() === city) &&
          (!input.domain || !row.business_domain || row.business_domain === input.domain)
      )
    )
  }

  if (!match) return null
  return upsertRow(supabase, userId, {
    ...businessColumns(input, prospectScore),
    ...resultColumns(match),
  })
}

/** Saves a provider result for a business (replacing an expired "no match"). */
export async function storeEnrichment(
  supabase: Client,
  userId: string,
  input: BusinessInput,
  result: DecisionMakerResult,
  prospectScore: number | null
) {
  return upsertRow(supabase, userId, {
    ...businessColumns(input, prospectScore),
    provider: result.provider,
    enrichment_status: result.status,
    provider_person_id: result.rawProviderId ?? null,
    contact_first_name: result.person?.firstName ?? null,
    contact_last_name: result.person?.lastName ?? null,
    contact_full_name: result.person?.fullName ?? null,
    contact_title: result.person?.title ?? null,
    contact_seniority: result.person?.seniority ?? null,
    linkedin_url: result.person?.linkedinUrl ?? null,
    work_email: result.email?.address ?? null,
    email_status: result.email?.providerStatus ?? null,
    // A new lookup may return a different email; old verdicts don't carry over.
    verification_status: null,
    verification_provider: null,
    verification_provider_status: null,
    verification_score: null,
    email_verified_at: null,
    enriched_at: result.metadata.enrichedAt,
  })
}

export function hasFreshVerification(row: LeadEnrichmentRow) {
  return Boolean(row.verification_status) && isFresh(row.email_verified_at, VERIFICATION_TTL_DAYS)
}

/** A recent verification of this address stored on any of the user's businesses. */
export async function findCachedVerification(supabase: Client, userId: string, email: string) {
  const { data, error } = await supabase
    .from("lead_enrichments")
    .select("*")
    .eq("user_id", userId)
    .eq("work_email", email)
    .not("verification_status", "is", null)
    .order("email_verified_at", { ascending: false })
    .limit(1)
  if (error) throw storageError(error, "verification cache lookup")
  const row = data?.[0]
  return row && hasFreshVerification(row) ? row : null
}

/** Writes a verification onto every stored business that uses this address. */
export async function storeVerification(
  supabase: Client,
  userId: string,
  businessId: string,
  verification: Pick<
    EmailVerificationResult,
    "email" | "status" | "provider" | "providerStatus" | "score" | "verifiedAt"
  >
) {
  const { data, error } = await supabase
    .from("lead_enrichments")
    .update({
      verification_status: verification.status,
      verification_provider: verification.provider,
      verification_provider_status: verification.providerStatus,
      verification_score: verification.score,
      email_verified_at: verification.verifiedAt,
    })
    .eq("user_id", userId)
    .eq("work_email", verification.email)
    .select("*")
  if (error) throw storageError(error, "store verification")
  const row = (data ?? []).find((r) => r.business_id === businessId)
  if (!row) throw new EnrichmentError("storage_failed", { detail: "verification row not found after update" })
  return row
}

/** Dashboard totals: work emails found and emails verified as deliverable. Zeros when unavailable. */
export async function getEnrichmentCounts(supabase: Client, userId: string) {
  const count = (filter: "email" | "deliverable") => {
    const query = supabase
      .from("lead_enrichments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .not("work_email", "is", null)
    return filter === "deliverable" ? query.eq("verification_status", "deliverable") : query
  }
  const [emails, verified] = await Promise.all([count("email"), count("deliverable")])
  return {
    emailsFound: emails.error ? 0 : (emails.count ?? 0),
    verifiedEmails: verified.error ? 0 : (verified.count ?? 0),
  }
}
