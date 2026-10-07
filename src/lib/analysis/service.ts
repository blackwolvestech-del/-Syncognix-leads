import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { getEnrichmentsByBusinessIds } from "@/lib/enrichment/cache"
import { EnrichmentError } from "@/lib/enrichment/types"
import { scoreProspect } from "@/lib/scoring/prospect-score"
import type { AnalysisStage, BusinessAnalysis } from "@/types/analysis"
import type { BusinessSearchResult } from "@/types/business"
import type { Database } from "@/types/database"
import { buildAnalysis, qualify, websiteTarget, type PageOutcome } from "./analyze-business"
import { getStoredAnalysis, isFresh, storeAnalysis } from "./cache"
import { fetchPage } from "./website-fetcher"

/*
 * The only place a business website is ever requested:
 *
 *   stored analysis still fresh → return it (re-qualified with current contact data)
 *   otherwise                   → fetch homepage → analyze → score → store
 *
 * Nothing here runs on its own; it is only reached from the analysis API
 * route, which is only called when the user clicks Analyze or Reanalyze.
 */

type Client = SupabaseClient<Database>

export interface AnalysisOutcome {
  analysis: BusinessAnalysis
  /** True when served from stored data without fetching the website. */
  cached: boolean
}

export interface AnalyzeOptions {
  /** Fetch the website again even when a fresh analysis is stored. */
  reanalyze?: boolean
  /** Only re-qualify the stored analysis with current contact data; never fetch. */
  refreshOnly?: boolean
  onStage?: (stage: AnalysisStage) => void
}

/** Analyses already running, so a double click can't fetch the same site twice. */
const inFlight = new Map<string, Promise<AnalysisOutcome>>()

export function analyzeBusiness(
  supabase: Client,
  userId: string,
  business: BusinessSearchResult,
  options: AnalyzeOptions = {}
): Promise<AnalysisOutcome> {
  const key = `${userId}:${business.osmId}`
  const running = inFlight.get(key)
  if (running) return running

  const promise = run(supabase, userId, business, options).finally(() => inFlight.delete(key))
  inFlight.set(key, promise)
  return promise
}

async function run(
  supabase: Client,
  userId: string,
  business: BusinessSearchResult,
  { reanalyze = false, refreshOnly = false, onStage = () => {} }: AnalyzeOptions
): Promise<AnalysisOutcome> {
  onStage("cache")
  // Step 3 data is only read here; enrichment itself is never triggered.
  const [stored, enrichments] = await Promise.all([
    getStoredAnalysis(supabase, userId, business.osmId),
    getEnrichmentsByBusinessIds(supabase, userId, [business.osmId]),
  ])
  const enrichment = enrichments[0] ?? null

  if (refreshOnly && !stored) throw new EnrichmentError("invalid_request")

  if (stored && (refreshOnly || (!reanalyze && isFresh(stored)))) {
    // Contact data may have changed since; refresh the qualification only.
    const current = qualify(stored, scoreProspect(business).score, enrichment)
    if (JSON.stringify(current.qualification) !== JSON.stringify(stored.qualification) || current.scores.qualifiedLead !== stored.scores.qualifiedLead) {
      await storeAnalysis(supabase, userId, current)
    }
    return { analysis: current, cached: true }
  }

  const target = websiteTarget(business)
  let outcome: PageOutcome | null = null
  if ("url" in target) {
    onStage("connecting")
    outcome = await fetchPage(target.url)
  }

  // Parsing and scoring take milliseconds; buildAnalysis reports each stage as it starts.
  const analysis = buildAnalysis(business, outcome, enrichment, onStage)

  onStage("saving")
  await storeAnalysis(supabase, userId, analysis)
  return { analysis, cached: false }
}
