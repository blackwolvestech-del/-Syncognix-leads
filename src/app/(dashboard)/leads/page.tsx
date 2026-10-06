import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeft, ChevronRight, CircleAlert, Database, Search, SearchX, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LeadsTable } from "@/components/leads/leads-table"
import { LeadsToolbar } from "@/components/leads/leads-toolbar"
import { EmptyState } from "@/components/shared/empty-state"
import { FadeIn } from "@/components/shared/motion"
import { PageHeader } from "@/components/shared/page-header"
import { requireUser } from "@/lib/auth/user"
import { getCategoryLabel } from "@/lib/business-search/normalize-category"
import { getEnrichmentsByBusinessIds } from "@/lib/enrichment/cache"
import { getLeadsPage } from "@/lib/leads/get-leads"
import { scoreProspect } from "@/lib/scoring/prospect-score"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Leads" }

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function parsePage(value: string | undefined) {
  const page = Number(value)
  return Number.isInteger(page) && page > 0 ? page : 1
}

function FindLeadsButton() {
  return (
    <Button asChild size="sm">
      <Link href="/find-leads">
        <Search /> Find Leads
      </Link>
    </Button>
  )
}

export default async function LeadsPage(props: PageProps<"/leads">) {
  const user = await requireUser()
  const params = await props.searchParams
  const page = parsePage(first(params.page))
  const query = (first(params.q) ?? "").trim().slice(0, 100)
  const result = await getLeadsPage(user.id, page, query)

  const total = result.status === "ok" ? result.total : 0
  const rows =
    result.status === "ok"
      ? result.leads.map((lead) => ({
          ...lead,
          categoryLabel: getCategoryLabel(lead.category),
          prospect: scoreProspect({ ...lead, chain: lead.is_chain }),
        }))
      : []
  // Decision-maker data is linked to leads by business id (read-only here).
  const enrichments = rows.length
    ? await getEnrichmentsByBusinessIds(
        await createClient(),
        user.id,
        rows.map((lead) => lead.osm_id)
      )
    : []

  return (
    <div className="space-y-8">
      <PageHeader
        title="Leads"
        description="Businesses you've saved, with their decision makers and verified emails."
        actions={
          <Button asChild>
            <Link href="/find-leads">
              <Search /> Find Leads
            </Link>
          </Button>
        }
      />

      <FadeIn>
        <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
          {(total > 0 || query) && (
            <LeadsToolbar query={query} total={result.status === "ok" ? total : null} />
          )}

          {result.status === "not_set_up" && (
            <EmptyState
              icon={Database}
              title="The leads table isn't set up yet."
              description="Run the SQL files in supabase/migrations in the Supabase SQL Editor, then refresh this page."
              className="py-16"
            />
          )}

          {result.status === "error" && (
            <EmptyState
              icon={CircleAlert}
              title="We couldn't load your leads."
              description="Please refresh the page. If this keeps happening, try again in a few minutes."
              className="py-16"
            />
          )}

          {result.status === "ok" && rows.length === 0 && (
            query ? (
              <EmptyState
                icon={SearchX}
                title="No saved leads match your search."
                description="Try a different business name, city, state or category."
                className="py-16"
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link href="/leads">Clear search</Link>
                  </Button>
                }
              />
            ) : total === 0 ? (
              <EmptyState
                icon={Users}
                title="No saved leads yet."
                description="Search for businesses and save the ones you want to work with."
                className="py-16"
                action={<FindLeadsButton />}
              />
            ) : (
              <EmptyState
                icon={Users}
                title="No leads on this page."
                description="This page is past the end of your list."
                className="py-16"
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link href="/leads">Back to first page</Link>
                  </Button>
                }
              />
            )
          )}

          {rows.length > 0 && (
            // Keyed so each page of leads starts from its own stored enrichment data.
            <LeadsTable key={`${page}:${query}`} leads={rows} enrichments={enrichments} />
          )}

          {result.status === "ok" && total > 0 && (
            <div className="flex items-center justify-between gap-3 border-t px-5 py-3 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {total} {total === 1 ? "lead" : "leads"}
                {query && " found"}
              </span>
              <Pagination page={result.page} pageCount={result.pageCount} query={query} />
            </div>
          )}
        </div>
      </FadeIn>
    </div>
  )
}

function Pagination({ page, pageCount, query }: { page: number; pageCount: number; query: string }) {
  if (pageCount <= 1) return null
  const href = (target: number) => {
    const search = new URLSearchParams()
    if (query) search.set("q", query)
    if (target > 1) search.set("page", String(target))
    const qs = search.toString()
    return qs ? `/leads?${qs}` : "/leads"
  }
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
