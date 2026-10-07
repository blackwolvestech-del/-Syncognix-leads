import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeft, ChevronRight, CircleAlert, Database, Search, SearchX, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LeadsTable } from "@/components/leads/leads-table"
import { LeadsHeaderActions, LeadsToolbar } from "@/components/leads/leads-toolbar"
import { PipelineBoard } from "@/components/pipeline/pipeline-board"
import { EmptyState } from "@/components/shared/empty-state"
import { FadeIn } from "@/components/shared/motion"
import { PageHeader } from "@/components/shared/page-header"
import { getAnalysesByBusinessIds } from "@/lib/analysis/cache"
import { requireUser } from "@/lib/auth/user"
import { getCategoryLabel, getCategoryOptions } from "@/lib/business-search/normalize-category"
import { getEnrichmentsByBusinessIds } from "@/lib/enrichment/cache"
import { PIPELINE_STAGES, QUICK_VIEW_LABELS, type PipelineStage } from "@/lib/pipeline/config"
import { DEFAULT_LEAD_QUERY, leadFiltersActive, leadsHref, parseLeadQuery, type LeadQuery } from "@/lib/pipeline/params"
import {
  backfillProspectScores,
  getLeadLists,
  getLeadPreferences,
  getLeadTags,
  getLeadsOverviewPage,
  getPipelineBoard,
} from "@/lib/pipeline/queries"
import { scoreProspect } from "@/lib/scoring/prospect-score"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Leads" }

const numberFormat = new Intl.NumberFormat("en-US")

export default async function LeadsPage(props: PageProps<"/leads">) {
  const [user, params, preferences, supabase] = await Promise.all([
    requireUser(),
    props.searchParams,
    getLeadPreferences(),
    createClient(),
  ])
  const query = parseLeadQuery(params, preferences.sort)
  const pipeline = query.layout === "pipeline"
  const narrowed = leadFiltersActive(query) || query.view !== "all" || query.q !== ""

  // Leads saved before Step 5 get their prospect score stored, so they sort and filter by it.
  await backfillProspectScores(supabase, user.id)

  const [table, board, lists, tags] = await Promise.all([
    pipeline ? null : getLeadsOverviewPage(supabase, user.id, query, preferences.timeZone),
    pipeline ? getPipelineBoard(supabase, user.id, query, preferences.timeZone) : null,
    getLeadLists(supabase, user.id),
    getLeadTags(supabase, user.id),
  ])
  const status = (table ?? board)!.status

  const total =
    table?.status === "ok"
      ? table.total
      : board?.status === "ok"
        ? Object.values(board.counts).reduce((sum, count) => sum + count, 0)
        : 0

  const rows =
    table?.status === "ok"
      ? table.leads.map((lead) => ({
          ...lead,
          categoryLabel: getCategoryLabel(lead.category),
          prospect: scoreProspect({ ...lead, chain: lead.is_chain }),
        }))
      : []

  // Decision-maker data and analyses are linked to leads by business id
  // (read-only here: opening this page never calls a provider or a website).
  const businessIds = rows.map((lead) => lead.osm_id)
  const [enrichments, analyses] = await Promise.all([
    getEnrichmentsByBusinessIds(supabase, user.id, businessIds),
    getAnalysesByBusinessIds(supabase, user.id, businessIds),
  ])

  const viewKey = leadsHref(query)
  const stageHrefs = Object.fromEntries(
    PIPELINE_STAGES.map((stage) => [stage, leadsHref({ ...query, layout: "table", stage, page: 1 }, preferences.sort)])
  ) as Record<PipelineStage, string>
  const clearHref = leadsHref({ ...DEFAULT_LEAD_QUERY, layout: query.layout, sort: query.sort }, preferences.sort)

  return (
    <div className="space-y-8">
      <PageHeader
        title="Saved Leads"
        description={
          status === "ok"
            ? `${numberFormat.format(total)} ${narrowed ? "in this view" : "total"} · ${
                pipeline ? "Pipeline" : "Table"
              } view${query.view !== "all" ? ` · ${QUICK_VIEW_LABELS[query.view]}` : ""}`
            : "Your saved businesses, organized into a sales pipeline."
        }
        actions={
          status === "ok" ? (
            <LeadsHeaderActions query={query} lists={lists} rememberedSort={preferences.sort} canExport={total > 0} />
          ) : (
            <Button asChild>
              <Link href="/find-leads">
                <Search /> Find Leads
              </Link>
            </Button>
          )
        }
        className="[&>div:last-child]:flex-wrap"
      />

      <FadeIn>
        <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
          {status === "ok" && (total > 0 || narrowed) && (
            <LeadsToolbar
              query={query}
              total={total}
              lists={lists}
              tags={tags}
              categories={getCategoryOptions()}
              rememberedSort={preferences.sort}
            />
          )}

          {status === "not_set_up" && (
            <EmptyState
              icon={Database}
              title="Lead management isn't set up yet."
              description="Run supabase/migrations/20261008000000_lead_pipeline.sql in the Supabase SQL Editor (after the earlier migrations), then refresh this page. Your saved leads are untouched."
              className="py-16"
            />
          )}

          {status === "error" && (
            <EmptyState
              icon={CircleAlert}
              title="We couldn't load your leads."
              description="Please refresh the page. If this keeps happening, try again in a few minutes."
              className="py-16"
            />
          )}

          {status === "ok" && total === 0 && !pipeline && (
            narrowed ? (
              <EmptyState
                icon={SearchX}
                title={query.view === "follow_up_due" ? "No follow-ups due." : "No saved leads match this view."}
                description={
                  query.view === "follow_up_due"
                    ? "Leads with a follow-up that is overdue or due today will appear here."
                    : "Try another quick view, a different search, or clear a filter. Score filters only match leads you have analyzed."
                }
                className="py-16"
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link href={clearHref}>Show all leads</Link>
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Users}
                title="No saved leads yet."
                description="Search for businesses and save the ones you want to work with."
                className="py-16"
                action={
                  <Button asChild size="sm">
                    <Link href="/find-leads">
                      <Search /> Find Leads
                    </Link>
                  </Button>
                }
              />
            )
          )}

          {table?.status === "ok" && total > 0 && rows.length === 0 && (
            <EmptyState
              icon={Users}
              title="No leads on this page."
              description="This page is past the end of your list."
              className="py-16"
              action={
                <Button asChild size="sm" variant="outline">
                  <Link href={leadsHref({ ...query, page: 1 }, preferences.sort)}>Back to first page</Link>
                </Button>
              }
            />
          )}

          {rows.length > 0 && (
            // Keyed so each view of leads starts from its own stored enrichment and analysis data.
            <LeadsTable
              key={viewKey}
              leads={rows}
              enrichments={enrichments}
              analyses={analyses}
              lists={lists}
              tags={tags}
              currentUserId={user.id}
              showingArchived={query.archive !== "active"}
            />
          )}

          {board?.status === "ok" && (
            <PipelineBoard
              key={viewKey}
              leads={board.leads}
              counts={board.counts}
              tags={tags}
              currentUserId={user.id}
              stageHrefs={stageHrefs}
            />
          )}

          {table?.status === "ok" && total > 0 && (
            <div className="flex items-center justify-between gap-3 border-t px-5 py-3 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {numberFormat.format(total)} {total === 1 ? "lead" : "leads"}
                {narrowed && " in this view"}
              </span>
              <Pagination page={table.page} pageCount={table.pageCount} query={query} rememberedSort={preferences.sort} />
            </div>
          )}
        </div>
      </FadeIn>
    </div>
  )
}

function Pagination({
  page,
  pageCount,
  query,
  rememberedSort,
}: {
  page: number
  pageCount: number
  query: LeadQuery
  rememberedSort: string | undefined
}) {
  if (pageCount <= 1) return null
  const href = (target: number) => leadsHref({ ...query, page: target }, rememberedSort)
  return (
    <nav aria-label="Leads pages" className="flex items-center gap-2">
      <span className="tabular-nums">
        Page {Math.min(page, pageCount)} of {pageCount}
      </span>
      {page > 1 ? (
        <Button asChild variant="outline" size="icon" className="size-7">
          <Link href={href(Math.min(page - 1, pageCount))} aria-label="Previous page">
            <ChevronLeft />
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="icon" className="size-7" disabled aria-label="Previous page">
          <ChevronLeft />
        </Button>
      )}
      {page < pageCount ? (
        <Button asChild variant="outline" size="icon" className="size-7">
          <Link href={href(page + 1)} aria-label="Next page">
            <ChevronRight />
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="icon" className="size-7" disabled aria-label="Next page">
          <ChevronRight />
        </Button>
      )}
    </nav>
  )
}
