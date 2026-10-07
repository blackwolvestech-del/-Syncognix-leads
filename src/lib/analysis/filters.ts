import type { AnalysisScores, AnalysisStatus } from "@/types/analysis"

/*
 * Sorting and filtering by Step 4 scores, shared by the search results
 * (in the browser) and the saved-leads page (on the server). A business that
 * hasn't been analyzed has no scores: it never matches a score threshold and
 * always sorts after the analyzed ones.
 */

export type AnalysisSortKey = "qualified" | "opportunity" | "website" | "seo" | "conversion"

export const ANALYSIS_SORT_LABELS: Record<AnalysisSortKey, string> = {
  qualified: "Qualified lead score",
  opportunity: "Opportunity score",
  website: "Lowest website score",
  seo: "Lowest SEO score",
  conversion: "Lowest conversion score",
}

/** What a filter or sort needs to know about one analysis. */
export interface ScoreSummary extends Pick<AnalysisScores, "qualifiedLead" | "opportunity" | "website" | "seo" | "conversion"> {
  status: AnalysisStatus
}

export interface AnalysisFilters {
  minQualified: number | null
  minOpportunity: number | null
  maxWebsite: number | null
  maxSeo: number | null
  maxConversion: number | null
  contact: "any" | "decision_maker" | "email"
  analysis: "any" | "analyzed" | "complete" | "not_analyzed"
}

export const NO_FILTERS: AnalysisFilters = {
  minQualified: null,
  minOpportunity: null,
  maxWebsite: null,
  maxSeo: null,
  maxConversion: null,
  contact: "any",
  analysis: "any",
}

export function filtersActive(filters: AnalysisFilters) {
  return (Object.keys(NO_FILTERS) as (keyof AnalysisFilters)[]).some((key) => filters[key] !== NO_FILTERS[key])
}

const atLeast = (value: number | null | undefined, min: number | null) => min === null || (value != null && value >= min)
const atMost = (value: number | null | undefined, max: number | null) => max === null || (value != null && value <= max)

export function matchesFilters(
  filters: AnalysisFilters,
  summary: ScoreSummary | undefined,
  contact: { hasDecisionMaker: boolean; hasEmail: boolean }
) {
  if (filters.contact === "decision_maker" && !contact.hasDecisionMaker) return false
  if (filters.contact === "email" && !contact.hasEmail) return false
  if (filters.analysis === "not_analyzed" && summary) return false
  if (filters.analysis === "analyzed" && !summary) return false
  if (filters.analysis === "complete" && summary?.status !== "complete") return false
  return (
    atLeast(summary?.qualifiedLead, filters.minQualified) &&
    atLeast(summary?.opportunity, filters.minOpportunity) &&
    atMost(summary?.website, filters.maxWebsite) &&
    atMost(summary?.seo, filters.maxSeo) &&
    atMost(summary?.conversion, filters.maxConversion)
  )
}

const SORT_FIELD: Record<AnalysisSortKey, { field: keyof Omit<ScoreSummary, "status">; descending: boolean }> = {
  qualified: { field: "qualifiedLead", descending: true },
  opportunity: { field: "opportunity", descending: true },
  // Weakest first: these are the sites with the most to improve.
  website: { field: "website", descending: false },
  seo: { field: "seo", descending: false },
  conversion: { field: "conversion", descending: false },
}

/** Comparator for a sort key. Businesses without that score always come last. */
export function compareByAnalysis(sort: AnalysisSortKey, a: ScoreSummary | undefined, b: ScoreSummary | undefined) {
  const { field, descending } = SORT_FIELD[sort]
  const left = a?.[field] ?? null
  const right = b?.[field] ?? null
  if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1
  return descending ? right - left : left - right
}

// --- URL parameters (saved-leads page) ---------------------------------------

const NUMBER_PARAMS = {
  qmin: "minQualified",
  omin: "minOpportunity",
  wmax: "maxWebsite",
  smax: "maxSeo",
  cmax: "maxConversion",
} as const

type Param = string | string[] | undefined

function first(value: Param) {
  return Array.isArray(value) ? value[0] : value
}

export function parseSort(value: Param): AnalysisSortKey | null {
  const sort = first(value)
  return sort && sort in ANALYSIS_SORT_LABELS ? (sort as AnalysisSortKey) : null
}

export function parseFilters(params: Record<string, Param>): AnalysisFilters {
  const filters = { ...NO_FILTERS }
  for (const [param, key] of Object.entries(NUMBER_PARAMS) as [keyof typeof NUMBER_PARAMS, (typeof NUMBER_PARAMS)[keyof typeof NUMBER_PARAMS]][]) {
    const value = Number(first(params[param]))
    if (first(params[param]) && Number.isInteger(value) && value >= 0 && value <= 100) filters[key] = value
  }
  const contact = first(params.contact)
  if (contact === "decision_maker" || contact === "email") filters.contact = contact
  const analysis = first(params.analysis)
  if (analysis === "analyzed" || analysis === "complete" || analysis === "not_analyzed") filters.analysis = analysis
  return filters
}

/** Writes the filters and sort into `search`, leaving defaults out of the URL. */
export function writeFilterParams(search: URLSearchParams, filters: AnalysisFilters, sort: AnalysisSortKey | null) {
  for (const [param, key] of Object.entries(NUMBER_PARAMS)) {
    const value = filters[key]
    if (value === null) search.delete(param)
    else search.set(param, String(value))
  }
  if (filters.contact === "any") search.delete("contact")
  else search.set("contact", filters.contact)
  if (filters.analysis === "any") search.delete("analysis")
  else search.set("analysis", filters.analysis)
  if (sort) search.set("sort", sort)
  else search.delete("sort")
  return search
}
