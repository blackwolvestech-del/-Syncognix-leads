import {
  NO_FILTERS,
  filtersActive,
  parseFilters,
  writeFilterParams,
  type AnalysisFilters,
} from "@/lib/analysis/filters"
import {
  PIPELINE_STAGES,
  PRIORITIES,
  QUICK_VIEWS,
  type PipelineStage,
  type Priority,
  type QuickView,
} from "./config"
import type { FollowUpBucket } from "./follow-up"

/*
 * The state of the Leads page (search, quick view, filters, sort, page and
 * layout) as URL parameters, so every view can be bookmarked or shared and
 * the server does the filtering. Only ids and enum values go in the URL.
 */

export type LeadSort =
  | "newest"
  | "oldest"
  | "name"
  | "qualified"
  | "prospect"
  | "opportunity"
  | "priority"
  | "follow_up"
  | "website"
  | "seo"
  | "conversion"

// Rating and review count aren't listed: OpenStreetMap has neither.
export const LEAD_SORT_LABELS: Record<LeadSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  name: "Business name A–Z",
  qualified: "Qualified lead score",
  prospect: "Prospect score",
  opportunity: "Opportunity score",
  priority: "Priority",
  follow_up: "Follow-up date",
  website: "Lowest website score",
  seo: "Lowest SEO score",
  conversion: "Lowest conversion score",
}

/** Cookie remembering the last sort the user chose. */
export const SORT_COOKIE = "sl_leads_sort"

export type FollowUpFilter = FollowUpBucket | "scheduled" | "none"

export const FOLLOW_UP_FILTER_LABELS: Record<FollowUpFilter | "any", string> = {
  any: "Any follow-up",
  overdue: "Overdue",
  today: "Due today",
  tomorrow: "Due tomorrow",
  upcoming: "Upcoming",
  scheduled: "Has a follow-up",
  none: "No follow-up",
}

export type ArchiveFilter = "active" | "archived" | "all"

export interface LeadQuery {
  q: string
  page: number
  layout: "table" | "pipeline"
  view: QuickView
  sort: LeadSort
  stage: PipelineStage | null
  priority: Priority | null
  /** List id. */
  list: string | null
  /** Tag id. */
  tag: string | null
  followUp: FollowUpFilter | null
  state: string
  city: string
  category: string | null
  minProspect: number | null
  archive: ArchiveFilter
  /** Step 4 score and contact filters. */
  scores: AnalysisFilters
}

export const DEFAULT_LEAD_QUERY: LeadQuery = {
  q: "",
  page: 1,
  layout: "table",
  view: "all",
  sort: "newest",
  stage: null,
  priority: null,
  list: null,
  tag: null,
  followUp: null,
  state: "",
  city: "",
  category: null,
  minProspect: null,
  archive: "active",
  scores: NO_FILTERS,
}

type Param = string | string[] | undefined
type Params = Record<string, Param>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FOLLOW_UPS: FollowUpFilter[] = ["overdue", "today", "tomorrow", "upcoming", "scheduled", "none"]

const first = (value: Param) => (Array.isArray(value) ? value[0] : value)
const oneOf = <T extends string>(value: Param, allowed: readonly T[]): T | null => {
  const text = first(value)
  return text && (allowed as readonly string[]).includes(text) ? (text as T) : null
}
const shortText = (value: Param, max: number) => (first(value) ?? "").trim().slice(0, max)

export function isLeadSort(value: string | undefined): value is LeadSort {
  return Boolean(value) && value! in LEAD_SORT_LABELS
}

export function parseLeadQuery(params: Params, rememberedSort?: string): LeadQuery {
  const page = Number(first(params.page))
  const minProspect = Number(first(params.pmin))
  const sortParam = first(params.sort)
  return {
    q: shortText(params.q, 100),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    layout: first(params.layout) === "pipeline" ? "pipeline" : "table",
    view: oneOf(params.view, QUICK_VIEWS) ?? "all",
    sort: isLeadSort(sortParam) ? sortParam : isLeadSort(rememberedSort) ? rememberedSort : "newest",
    stage: oneOf(params.stage, PIPELINE_STAGES),
    priority: oneOf(params.priority, PRIORITIES),
    list: UUID.test(first(params.list) ?? "") ? first(params.list)! : null,
    tag: UUID.test(first(params.tag) ?? "") ? first(params.tag)! : null,
    followUp: oneOf(params.followup, FOLLOW_UPS),
    state: shortText(params.state, 40),
    city: shortText(params.city, 60),
    category: shortText(params.category, 60) || null,
    minProspect:
      first(params.pmin) && Number.isInteger(minProspect) && minProspect >= 0 && minProspect <= 100 ? minProspect : null,
    archive: oneOf(params.archive, ["archived", "all"] as const) ?? "active",
    scores: parseFilters(params),
  }
}

/** The query as URL parameters, leaving defaults out. */
export function leadQueryParams(query: LeadQuery, rememberedSort?: string): URLSearchParams {
  // First: this helper also clears "sort", which is set below.
  const search = writeFilterParams(new URLSearchParams(), query.scores, null)
  const set = (key: string, value: string | number | null | false) => {
    if (value !== null && value !== false && value !== "") search.set(key, String(value))
  }
  set("q", query.q)
  set("layout", query.layout === "pipeline" && "pipeline")
  set("view", query.view !== "all" && query.view)
  // Written unless it is what the server would pick anyway.
  const fallback = isLeadSort(rememberedSort) ? rememberedSort : "newest"
  set("sort", query.sort !== fallback && query.sort)
  set("stage", query.stage)
  set("priority", query.priority)
  set("list", query.list)
  set("tag", query.tag)
  set("followup", query.followUp)
  set("state", query.state)
  set("city", query.city)
  set("category", query.category)
  set("pmin", query.minProspect)
  set("archive", query.archive !== "active" && query.archive)
  set("page", query.page > 1 && query.page)
  return search
}

export function leadsHref(query: LeadQuery, rememberedSort?: string) {
  const qs = leadQueryParams(query, rememberedSort).toString()
  return qs ? `/leads?${qs}` : "/leads"
}

/** True when a filter (beyond the search box and the quick view) narrows the list. */
export function leadFiltersActive(query: LeadQuery) {
  return (
    query.stage !== null ||
    query.priority !== null ||
    query.list !== null ||
    query.tag !== null ||
    query.followUp !== null ||
    query.state !== "" ||
    query.city !== "" ||
    query.category !== null ||
    query.minProspect !== null ||
    query.archive !== "active" ||
    filtersActive(query.scores)
  )
}
