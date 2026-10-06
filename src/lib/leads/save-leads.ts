import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { BusinessSearchResult, SaveLeadsResult } from "@/types/business"
import type { Database } from "@/types/database"

/** Postgres/PostgREST codes for "table doesn't exist". */
export const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"])

/** Postgres/PostgREST codes for "column doesn't exist". */
const UNKNOWN_COLUMN_CODES = new Set(["42703", "PGRST204"])

const SAVE_FAILED = "We couldn't save these leads. Please try again."
const NOT_SET_UP =
  "Leads can't be saved because the leads table hasn't been set up yet. Run the leads migration in Supabase."

/**
 * Saves businesses as the user's leads in one batch. Businesses the user has
 * already saved (same user_id + osm_id) are skipped by the database's unique
 * constraint, so saving the same result twice never creates a duplicate and
 * never overwrites an existing lead.
 */
export async function saveLeads(
  supabase: SupabaseClient<Database>,
  userId: string,
  businesses: BusinessSearchResult[],
  search: { businessType: string; location: string }
): Promise<SaveLeadsResult> {
  if (businesses.length === 0) return { ok: true, saved: 0, alreadySaved: 0, savedOsmIds: [] }

  const rows = businesses.map((business) => ({
    user_id: userId,
    osm_id: business.osmId,
    osm_type: business.osmType,
    name: business.name,
    website: business.website,
    phone: business.phone,
    street: business.street,
    city: business.city,
    state: business.state,
    postcode: business.postcode,
    address: business.address,
    category: business.category,
    latitude: business.latitude,
    longitude: business.longitude,
    search_business_type: search.businessType,
    search_location: search.location,
  }))
  // Chain flag for the prospect score (column added by the 20261003 migration).
  const rowsWithChain = rows.map((row, index) => ({
    ...row,
    is_chain: businesses[index].chain ?? null,
  }))

  // ON CONFLICT DO NOTHING: only newly inserted rows come back.
  const insert = (values: typeof rows | typeof rowsWithChain) =>
    supabase
      .from("leads")
      .upsert(values, { onConflict: "user_id,osm_id", ignoreDuplicates: true })
      .select("osm_id")

  let { data, error } = await insert(rowsWithChain)
  // Before that migration is applied the column doesn't exist; saving must still work.
  if (error && UNKNOWN_COLUMN_CODES.has(error.code ?? "")) {
    ;({ data, error } = await insert(rows))
  }

  if (error) {
    console.error(`[leads] save failed: ${error.code ?? "unknown"} ${error.message}`)
    return {
      ok: false,
      message: MISSING_TABLE_CODES.has(error.code ?? "") ? NOT_SET_UP : SAVE_FAILED,
    }
  }

  const saved = data?.length ?? 0
  return {
    ok: true,
    saved,
    alreadySaved: rows.length - saved,
    savedOsmIds: rows.map((row) => row.osm_id),
  }
}

/** Which of `osmIds` the user has already saved. Empty on any error. */
export async function getSavedOsmIds(
  supabase: SupabaseClient<Database>,
  userId: string,
  osmIds: string[]
): Promise<string[]> {
  if (osmIds.length === 0) return []
  const { data, error } = await supabase
    .from("leads")
    .select("osm_id")
    .eq("user_id", userId)
    .in("osm_id", osmIds)

  if (error) {
    if (!MISSING_TABLE_CODES.has(error.code ?? "")) {
      console.error(`[leads] saved lookup failed: ${error.code ?? "unknown"} ${error.message}`)
    }
    return []
  }
  return (data ?? []).map((row) => row.osm_id)
}
