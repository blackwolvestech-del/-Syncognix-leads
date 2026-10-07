import "server-only"

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js"
import { businessDomain } from "@/lib/enrichment/normalize"
import { EnrichmentError } from "@/lib/enrichment/types"
import type { BusinessAnalysis } from "@/types/analysis"
import type { BusinessAnalysisRow, Database } from "@/types/database"
import { ANALYSIS_CONFIG } from "./config"

/*
 * Supabase is the cache for analyses: a website is only fetched again when
 * its stored analysis is older than the cache period, was made by an older
 * version of the rules, or the user asks to reanalyze. Per user (Row Level
 * Security), like the enrichment cache.
 */

type Client = SupabaseClient<Database>

const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"])
const DAY_MS = 24 * 60 * 60 * 1000

const NOT_SET_UP =
  "Analysis storage isn't set up yet. Run the 20261007 migration in Supabase, then try again."

function storageError(error: PostgrestError, action: string) {
  if (MISSING_TABLE_CODES.has(error.code ?? "")) return new EnrichmentError("not_set_up", { message: NOT_SET_UP })
  return new EnrichmentError("storage_failed", {
    message: "We couldn't store the analysis. Please try again.",
    detail: `${action}: ${error.code ?? "unknown"} ${error.message}`,
  })
}

/** A stored analysis made with the current rules. Older shapes are ignored. */
function readAnalysis(row: Pick<BusinessAnalysisRow, "analysis_data">): BusinessAnalysis | null {
  const data = row.analysis_data
  return data && typeof data === "object" && data.version === ANALYSIS_CONFIG.version ? data : null
}

/** True while a stored analysis should be reused instead of fetching the site again. */
export function isFresh(analysis: BusinessAnalysis) {
  const days =
    analysis.status === "website_unavailable" ? ANALYSIS_CONFIG.cache.unavailableDays : ANALYSIS_CONFIG.cache.days
  return Date.now() - new Date(analysis.analyzedAt).getTime() < days * DAY_MS
}

export async function getStoredAnalysis(supabase: Client, userId: string, businessId: string) {
  const { data, error } = await supabase
    .from("business_analyses")
    .select("analysis_data")
    .eq("user_id", userId)
    .eq("business_id", businessId)
    .maybeSingle()
  if (error) throw storageError(error, "load analysis")
  return data ? readAnalysis(data) : null
}

/** Stored analyses for a set of businesses (any age: the UI shows their date). Empty when unavailable. */
export async function getAnalysesByBusinessIds(
  supabase: Client,
  userId: string,
  businessIds: string[]
): Promise<BusinessAnalysis[]> {
  if (businessIds.length === 0) return []
  const { data, error } = await supabase
    .from("business_analyses")
    .select("analysis_data")
    .eq("user_id", userId)
    .in("business_id", businessIds)

  if (error) {
    if (!MISSING_TABLE_CODES.has(error.code ?? "")) {
      console.error(`[analysis] load failed: ${error.code ?? "unknown"} ${error.message}`)
    }
    return []
  }
  return (data ?? []).flatMap((row) => readAnalysis(row) ?? [])
}

export async function storeAnalysis(supabase: Client, userId: string, analysis: BusinessAnalysis) {
  const { scores } = analysis
  const { error } = await supabase.from("business_analyses").upsert(
    {
      user_id: userId,
      business_id: analysis.businessId,
      business_name: analysis.business.name,
      business_domain: businessDomain(analysis.business.website),
      analysis_status: analysis.status,
      website_score: scores.website,
      seo_score: scores.seo,
      conversion_score: scores.conversion,
      local_presence_score: scores.localPresence,
      opportunity_score: scores.opportunity,
      qualified_lead_score: scores.qualifiedLead,
      top_opportunity: analysis.topOpportunity,
      strengths: analysis.strengths,
      weaknesses: analysis.opportunities.map(({ code, text }) => ({ code, text })),
      opportunities: analysis.opportunities.map((opportunity) => opportunity.action),
      recommended_services: analysis.recommendedServices,
      flags: analysis.flags,
      analysis_data: analysis,
      analyzed_at: analysis.analyzedAt,
    },
    { onConflict: "user_id,business_id" }
  )
  if (error) throw storageError(error, "store analysis")
}

/** The slim columns used for sorting, filtering and dashboard lists. */
export interface AnalysisSummary {
  businessId: string
  name: string
  status: BusinessAnalysisRow["analysis_status"]
  website: number | null
  seo: number | null
  conversion: number | null
  opportunity: number | null
  qualifiedLead: number | null
  topOpportunity: string | null
}

/** Every analysis the user has, summarized, best qualified first. Empty when unavailable. */
export async function getAnalysisSummaries(supabase: Client, userId: string, limit = 2_000): Promise<AnalysisSummary[]> {
  const { data, error } = await supabase
    .from("business_analyses")
    .select(
      "business_id, business_name, analysis_status, website_score, seo_score, conversion_score, opportunity_score, qualified_lead_score, top_opportunity"
    )
    .eq("user_id", userId)
    .order("qualified_lead_score", { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) {
    if (!MISSING_TABLE_CODES.has(error.code ?? "")) {
      console.error(`[analysis] summary load failed: ${error.code ?? "unknown"} ${error.message}`)
    }
    return []
  }
  return (data ?? []).map((row) => ({
    businessId: row.business_id,
    name: row.business_name,
    status: row.analysis_status,
    website: row.website_score,
    seo: row.seo_score,
    conversion: row.conversion_score,
    opportunity: row.opportunity_score,
    qualifiedLead: row.qualified_lead_score,
    topOpportunity: row.top_opportunity,
  }))
}
