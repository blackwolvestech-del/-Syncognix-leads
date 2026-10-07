import "server-only"

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"
import { scoreProspect } from "@/lib/scoring/prospect-score"
import type { Database, LeadOverviewRow } from "@/types/database"
import type { LeadActivityEntry, LeadList, LeadNote, LeadTag } from "@/types/pipeline"
import { PIPELINE_CONFIG, PIPELINE_STAGES, PRE_CONTACT_STAGES, type PipelineStage } from "./config"
import { TIME_ZONE_COOKIE, dayBounds, type DayBounds } from "./follow-up"
import { SORT_COOKIE, type LeadQuery, type LeadSort } from "./params"

/*
 * Reads for Step 5. Leads are read through the `lead_overview` view, which
 * joins each lead with its decision maker, analysis scores, tags and lists,
 * so searching, filtering, sorting and paging all happen in the database.
 */

type Client = SupabaseClient<Database>

const MISSING_CODES = new Set(["42P01", "PGRST205", "PGRST202", "42883"])

export function isNotSetUp(error: PostgrestError | null) {
  return error !== null && MISSING_CODES.has(error.code ?? "")
}

function logError(scope: string, error: PostgrestError) {
  console.error(`[pipeline] ${scope} failed: ${error.code ?? "unknown"} ${error.message}`)
}

/** Request-scoped preferences kept in cookies: the user's time zone and last sort. */
export async function getLeadPreferences() {
  const store = await cookies()
  return {
    timeZone: store.get(TIME_ZONE_COOKIE)?.value,
    sort: store.get(SORT_COOKIE)?.value,
  }
}

/** Strips characters with meaning in PostgREST filter syntax so user text can't alter a filter. */
function toPattern(text: string) {
  const term = text.replace(/[,()*%\\:"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100)
  return term ? `%${term}%` : null
}

const SEARCH_COLUMNS = ["name", "city", "state", "category", "contact_full_name", "work_email", "tags_text"]

/** The filter methods used below; every PostgREST filter builder has them. */
interface Filterable {
  eq(column: string, value: unknown): this
  gte(column: string, value: unknown): this
  lte(column: string, value: unknown): this
  lt(column: string, value: unknown): this
  in(column: string, values: readonly unknown[]): this
  is(column: string, value: null): this
  not(column: string, operator: string, value: unknown): this
  ilike(column: string, pattern: string): this
  or(filters: string): this
  contains(column: string, value: readonly unknown[]): this
}

/** Applies every part of a LeadQuery except sort and page. `stage` overrides the query's own stage. */
function applyFilters<T>(builder: T, query: LeadQuery, bounds: DayBounds, stage?: PipelineStage): T {
  let request = builder as unknown as Filterable
  const { scores } = query

  if (query.archive === "active") request = request.eq("is_archived", false)
  else if (query.archive === "archived") request = request.eq("is_archived", true)

  const pattern = toPattern(query.q)
  if (pattern) request = request.or(SEARCH_COLUMNS.map((column) => `${column}.ilike.${pattern}`).join(","))

  switch (query.view) {
    case "high_potential":
      request = request.gte("qualified_lead_score", PIPELINE_CONFIG.highPotentialScore)
      break
    case "outreach_ready":
      request = request.eq("outreach_ready", true).in("pipeline_stage", PRE_CONTACT_STAGES)
      if (PIPELINE_CONFIG.outreach.minQualifiedScore > 0) {
        request = request.gte("qualified_lead_score", PIPELINE_CONFIG.outreach.minQualifiedScore)
      }
      break
    case "follow_up_due":
      request = request.lt("follow_up_at", bounds.tomorrow.toISOString())
      break
    case "contacted":
    case "won":
    case "lost":
      request = request.eq("pipeline_stage", query.view)
      break
  }

  const wantedStage = stage ?? query.stage
  if (wantedStage) request = request.eq("pipeline_stage", wantedStage)
  if (query.priority) request = request.eq("priority", query.priority)
  if (query.list) request = request.contains("list_ids", [query.list])
  if (query.tag) request = request.contains("tag_ids", [query.tag])
  if (query.category) request = request.eq("category", query.category)
  const state = toPattern(query.state)
  if (state) request = request.ilike("state", state)
  const city = toPattern(query.city)
  if (city) request = request.ilike("city", city)
  if (query.minProspect !== null) request = request.gte("prospect_score", query.minProspect)

  switch (query.followUp) {
    case "overdue":
      request = request.lt("follow_up_at", bounds.today.toISOString())
      break
    case "today":
      request = request.gte("follow_up_at", bounds.today.toISOString()).lt("follow_up_at", bounds.tomorrow.toISOString())
      break
    case "tomorrow":
      request = request.gte("follow_up_at", bounds.tomorrow.toISOString()).lt("follow_up_at", bounds.dayAfter.toISOString())
      break
    case "upcoming":
      request = request.gte("follow_up_at", bounds.dayAfter.toISOString())
      break
    case "scheduled":
      request = request.not("follow_up_at", "is", null)
      break
    case "none":
      request = request.is("follow_up_at", null)
      break
  }

  // Step 4 filters. A threshold never matches a lead without that score.
  if (scores.minQualified !== null) request = request.gte("qualified_lead_score", scores.minQualified)
  if (scores.minOpportunity !== null) request = request.gte("opportunity_score", scores.minOpportunity)
  if (scores.maxWebsite !== null) request = request.lte("website_score", scores.maxWebsite)
  if (scores.maxSeo !== null) request = request.lte("seo_score", scores.maxSeo)
  if (scores.maxConversion !== null) request = request.lte("conversion_score", scores.maxConversion)
  if (scores.contact === "decision_maker") request = request.eq("has_decision_maker", true)
  if (scores.contact === "email") request = request.eq("has_email", true)
  if (scores.analysis === "analyzed") request = request.eq("is_analyzed", true)
  if (scores.analysis === "not_analyzed") request = request.eq("is_analyzed", false)
  if (scores.analysis === "complete") request = request.eq("analysis_status", "complete")

  return request as unknown as T
}

/** Column and direction for each sort. Leads without the value always come last. */
const SORTS: Record<LeadSort, { column: keyof LeadOverviewRow & string; ascending: boolean }> = {
  newest: { column: "created_at", ascending: false },
  oldest: { column: "created_at", ascending: true },
  name: { column: "name", ascending: true },
  qualified: { column: "qualified_lead_score", ascending: false },
  prospect: { column: "prospect_score", ascending: false },
  opportunity: { column: "opportunity_score", ascending: false },
  priority: { column: "priority_rank", ascending: false },
  follow_up: { column: "follow_up_at", ascending: true },
  website: { column: "website_score", ascending: true },
  seo: { column: "seo_score", ascending: true },
  conversion: { column: "conversion_score", ascending: true },
}

export type LeadsResult<T> = ({ status: "ok" } & T) | { status: "not_set_up" } | { status: "error" }

export interface LeadsPageData {
  leads: LeadOverviewRow[]
  total: number
  page: number
  pageCount: number
}

/** One page of the user's leads for the table view. */
export async function getLeadsOverviewPage(
  supabase: Client,
  userId: string,
  query: LeadQuery,
  timeZone: string | undefined
): Promise<LeadsResult<LeadsPageData>> {
  const size = PIPELINE_CONFIG.pageSize
  const from = (query.page - 1) * size
  const sort = SORTS[query.sort]

  const base = supabase.from("lead_overview").select("*", { count: "exact" }).eq("user_id", userId)
  const { data, count, error } = await applyFilters(base, query, dayBounds(timeZone))
    .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(from, from + size - 1)

  if (error) {
    if (isNotSetUp(error)) return { status: "not_set_up" }
    logError("leads page", error)
    return { status: "error" }
  }
  const total = count ?? 0
  return { status: "ok", leads: data ?? [], total, page: query.page, pageCount: Math.max(1, Math.ceil(total / size)) }
}

export interface BoardData {
  leads: LeadOverviewRow[]
  /** Leads matching the filters in each stage (may exceed the cards loaded). */
  counts: Record<PipelineStage, number>
}

/** The first cards of every stage for the pipeline board, best leads first. */
export async function getPipelineBoard(
  supabase: Client,
  userId: string,
  query: LeadQuery,
  timeZone: string | undefined
): Promise<LeadsResult<BoardData>> {
  const bounds = dayBounds(timeZone)
  const columns = await Promise.all(
    PIPELINE_STAGES.map((stage) =>
      applyFilters(
        supabase.from("lead_overview").select("*", { count: "exact" }).eq("user_id", userId),
        query,
        bounds,
        stage
      )
        .order("priority_rank", { ascending: false })
        .order("qualified_lead_score", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(PIPELINE_CONFIG.boardColumnLimit)
    )
  )

  const failed = columns.find((column) => column.error)?.error
  if (failed) {
    if (isNotSetUp(failed)) return { status: "not_set_up" }
    logError("pipeline board", failed)
    return { status: "error" }
  }

  const counts = {} as Record<PipelineStage, number>
  PIPELINE_STAGES.forEach((stage, index) => {
    // A stage the filters exclude (e.g. a different stage filter) is simply empty.
    counts[stage] = query.stage && query.stage !== stage ? 0 : (columns[index].count ?? 0)
  })
  return {
    status: "ok",
    leads: columns.flatMap((column, index) =>
      query.stage && query.stage !== PIPELINE_STAGES[index] ? [] : (column.data ?? [])
    ),
    counts,
  }
}

/** One lead by id, or null. */
export async function getLeadOverview(supabase: Client, userId: string, leadId: string) {
  const { data, error } = await supabase
    .from("lead_overview")
    .select("*")
    .eq("user_id", userId)
    .eq("id", leadId)
    .maybeSingle()
  if (error) {
    if (isNotSetUp(error)) return { status: "not_set_up" as const }
    logError("lead", error)
    return { status: "error" as const }
  }
  return { status: "ok" as const, lead: data }
}

/** The user's lists with their lead counts, by name. Empty when unavailable. */
export async function getLeadLists(supabase: Client, userId: string): Promise<LeadList[]> {
  const [lists, counts] = await Promise.all([
    supabase.from("lead_lists").select("id, name, description").eq("user_id", userId).order("name"),
    supabase.rpc("lead_list_counts"),
  ])
  if (lists.error) {
    if (!isNotSetUp(lists.error)) logError("lists", lists.error)
    return []
  }
  const totals = new Map((counts.data ?? []).map((row) => [row.list_id, Number(row.total)]))
  return (lists.data ?? []).map((list) => ({ ...list, count: totals.get(list.id) ?? 0 }))
}

/** The user's tags, by name. Empty when unavailable. */
export async function getLeadTags(supabase: Client, userId: string): Promise<LeadTag[]> {
  const { data, error } = await supabase.from("tags").select("id, name").eq("user_id", userId).order("name")
  if (error) {
    if (!isNotSetUp(error)) logError("tags", error)
    return []
  }
  return data ?? []
}

export async function getLeadNotes(supabase: Client, userId: string, leadId: string): Promise<LeadNote[]> {
  const { data, error } = await supabase
    .from("lead_notes")
    .select("id, content, created_at, updated_at")
    .eq("user_id", userId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true })
    .limit(200)
  if (error) {
    if (!isNotSetUp(error)) logError("notes", error)
    return []
  }
  return (data ?? []).map((note) => ({
    id: note.id,
    content: note.content,
    createdAt: note.created_at,
    updatedAt: note.updated_at,
  }))
}

export async function getLeadActivity(supabase: Client, userId: string, leadId: string): Promise<LeadActivityEntry[]> {
  const { data, error } = await supabase
    .from("lead_activity")
    .select("id, action, metadata, created_at")
    .eq("user_id", userId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(100)
  if (error) {
    if (!isNotSetUp(error)) logError("activity", error)
    return []
  }
  return (data ?? []).map((entry) => ({
    id: entry.id,
    action: entry.action,
    metadata: entry.metadata ?? {},
    createdAt: entry.created_at,
  }))
}

export interface PipelineSummary {
  /** Active (not archived) leads per stage. */
  stages: Record<PipelineStage, number>
  outreachReady: number
  followUpsDue: number
}

/** Counts for the dashboard, from stored data only. Null when Step 5 isn't set up. */
export async function getPipelineSummary(
  supabase: Client,
  userId: string,
  timeZone: string | undefined
): Promise<PipelineSummary | null> {
  const bounds = dayBounds(timeZone)
  const active = () =>
    supabase.from("lead_overview").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_archived", false)

  const ready = active().eq("outreach_ready", true).in("pipeline_stage", PRE_CONTACT_STAGES)
  const [counts, outreachReady, followUpsDue] = await Promise.all([
    supabase.rpc("lead_pipeline_counts"),
    PIPELINE_CONFIG.outreach.minQualifiedScore > 0
      ? ready.gte("qualified_lead_score", PIPELINE_CONFIG.outreach.minQualifiedScore)
      : ready,
    active().lt("follow_up_at", bounds.tomorrow.toISOString()),
  ])
  if (counts.error) {
    if (!isNotSetUp(counts.error)) logError("pipeline counts", counts.error)
    return null
  }

  const stages = Object.fromEntries(PIPELINE_STAGES.map((stage) => [stage, 0])) as Record<PipelineStage, number>
  for (const row of counts.data ?? []) {
    if (row.pipeline_stage in stages) stages[row.pipeline_stage as PipelineStage] = Number(row.total)
  }
  return { stages, outreachReady: outreachReady.count ?? 0, followUpsDue: followUpsDue.count ?? 0 }
}

/**
 * Stores the Step 3 prospect score on leads that don't have it yet (leads
 * saved before Step 5), so they can be sorted and filtered by it. The score
 * depends only on the lead's own fields, so it never goes stale.
 */
export async function backfillProspectScores(supabase: Client, userId: string) {
  const { data, error } = await supabase
    .from("leads")
    .select("id, website, phone, address, city, state, is_chain")
    .eq("user_id", userId)
    .is("prospect_score", null)
    .limit(500)
  if (error || !data?.length) return

  const byScore = new Map<number, string[]>()
  for (const lead of data) {
    const score = scoreProspect({ ...lead, chain: lead.is_chain }).score
    byScore.set(score, [...(byScore.get(score) ?? []), lead.id])
  }
  // Ids travel in the request URL, so they go in modest batches.
  const updates: PromiseLike<unknown>[] = []
  for (const [score, ids] of byScore) {
    for (let start = 0; start < ids.length; start += 100) {
      updates.push(
        supabase.from("leads").update({ prospect_score: score }).eq("user_id", userId).in("id", ids.slice(start, start + 100))
      )
    }
  }
  await Promise.all(updates)
}

/**
 * Leads for a CSV export: either the given ids, or everything matching the
 * query (ignoring its page), up to the export limit. Null on failure.
 */
export async function getLeadsForExport(
  supabase: Client,
  userId: string,
  selection: { ids: string[] } | { query: LeadQuery },
  timeZone: string | undefined
): Promise<LeadOverviewRow[] | null> {
  const leads: LeadOverviewRow[] = []

  if ("ids" in selection) {
    for (let start = 0; start < selection.ids.length; start += 100) {
      const { data, error } = await supabase
        .from("lead_overview")
        .select("*")
        .eq("user_id", userId)
        .in("id", selection.ids.slice(start, start + 100))
      if (error) {
        logError("export selected", error)
        return null
      }
      leads.push(...(data ?? []))
    }
    // Keep the order the ids were given in (the order on screen).
    const order = new Map(selection.ids.map((id, index) => [id, index]))
    return leads.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  }

  const sort = SORTS[selection.query.sort]
  const bounds = dayBounds(timeZone)
  const chunk = 1_000
  while (leads.length < PIPELINE_CONFIG.maxExportRows) {
    const { data, error } = await applyFilters(
      supabase.from("lead_overview").select("*").eq("user_id", userId),
      selection.query,
      bounds
    )
      .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(leads.length, leads.length + chunk - 1)
    if (error) {
      logError("export filtered", error)
      return null
    }
    leads.push(...(data ?? []))
    if ((data?.length ?? 0) < chunk) break
  }
  return leads.slice(0, PIPELINE_CONFIG.maxExportRows)
}
