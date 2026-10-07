import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeft, CircleAlert, Database } from "lucide-react"
import { LeadDetail } from "@/components/pipeline/lead-detail"
import { EmptyState } from "@/components/shared/empty-state"
import { FadeIn } from "@/components/shared/motion"
import { getAnalysesByBusinessIds } from "@/lib/analysis/cache"
import { requireUser } from "@/lib/auth/user"
import { getCategoryLabel } from "@/lib/business-search/normalize-category"
import { getEnrichmentsByBusinessIds } from "@/lib/enrichment/cache"
import {
  getLeadActivity,
  getLeadLists,
  getLeadNotes,
  getLeadOverview,
  getLeadTags,
} from "@/lib/pipeline/queries"
import { scoreProspect } from "@/lib/scoring/prospect-score"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Lead" }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function LeadPage(props: PageProps<"/leads/[id]">) {
  const [user, { id }, supabase] = await Promise.all([requireUser(), props.params, createClient()])
  if (!UUID.test(id)) notFound()

  const result = await getLeadOverview(supabase, user.id, id)
  // Someone else's lead looks exactly like one that doesn't exist.
  if (result.status === "ok" && !result.lead) notFound()

  const back = (
    <Link
      href="/leads"
      className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <ChevronLeft className="size-4" aria-hidden /> Saved Leads
    </Link>
  )

  if (result.status !== "ok" || !result.lead) {
    return (
      <div className="space-y-6">
        {back}
        <div className="rounded-lg border bg-card shadow-xs">
          {result.status === "not_set_up" ? (
            <EmptyState
              icon={Database}
              title="Lead management isn't set up yet."
              description="Run supabase/migrations/20261008000000_lead_pipeline.sql in the Supabase SQL Editor, then refresh this page."
              className="py-16"
            />
          ) : (
            <EmptyState
              icon={CircleAlert}
              title="We couldn't load this lead."
              description="Please refresh the page. If this keeps happening, try again in a few minutes."
              className="py-16"
            />
          )}
        </div>
      </div>
    )
  }

  const lead = result.lead
  // Read-only: opening a lead never calls a provider or fetches a website.
  const [enrichments, analyses, lists, tags, notes, activity] = await Promise.all([
    getEnrichmentsByBusinessIds(supabase, user.id, [lead.osm_id]),
    getAnalysesByBusinessIds(supabase, user.id, [lead.osm_id]),
    getLeadLists(supabase, user.id),
    getLeadTags(supabase, user.id),
    getLeadNotes(supabase, user.id, lead.id),
    getLeadActivity(supabase, user.id, lead.id),
  ])

  return (
    <div className="space-y-6">
      {back}
      <FadeIn>
        <LeadDetail
          lead={{
            ...lead,
            categoryLabel: getCategoryLabel(lead.category),
            prospect: scoreProspect({ ...lead, chain: lead.is_chain }),
          }}
          enrichment={enrichments[0] ?? null}
          analysis={analyses[0] ?? null}
          lists={lists}
          tags={tags}
          notes={notes}
          activity={activity}
          user={{ id: user.id, name: user.firstName }}
        />
      </FadeIn>
    </div>
  )
}
