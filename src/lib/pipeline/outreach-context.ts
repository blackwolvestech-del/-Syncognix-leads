import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { getAnalysesByBusinessIds } from "@/lib/analysis/cache"
import type { Opportunity, ServiceRecommendation } from "@/types/analysis"
import type { Database } from "@/types/database"
import { isOutreachReady, type ContactStatus, type PipelineStage, type Priority } from "./config"
import { getLeadNotes, getLeadOverview } from "./queries"

/*
 * Everything Step 6 (personalized outreach) needs about one lead, in a single
 * call, so it doesn't have to query leads, enrichments, analyses, tags and
 * notes itself. Nothing here generates text.
 */

export interface OutreachContext {
  leadId: string
  /** Decision maker, professional email and a scored analysis are all in place. */
  outreachReady: boolean
  business: {
    name: string
    category: string
    city: string | null
    state: string | null
    website: string | null
    phone: string | null
  }
  decisionMaker: { name: string | null; title: string | null; linkedinUrl: string | null } | null
  email: string | null
  emailVerification: string | null
  scores: {
    prospect: number | null
    qualifiedLead: number | null
    opportunity: number | null
    website: number | null
    seo: number | null
    conversion: number | null
  }
  topOpportunity: string | null
  recommendedServices: ServiceRecommendation[]
  /** Observed gaps, each with the evidence sentence and the flag behind it. */
  weaknesses: Opportunity[]
  strengths: string[]
  pipeline: { stage: PipelineStage; priority: Priority; contactStatus: ContactStatus; followUpAt: string | null }
  tags: string[]
  notes: string[]
}

export async function getOutreachContext(
  supabase: SupabaseClient<Database>,
  userId: string,
  leadId: string
): Promise<OutreachContext | null> {
  const result = await getLeadOverview(supabase, userId, leadId)
  if (result.status !== "ok" || !result.lead) return null
  const lead = result.lead

  const [analyses, notes] = await Promise.all([
    getAnalysesByBusinessIds(supabase, userId, [lead.osm_id]),
    getLeadNotes(supabase, userId, leadId),
  ])
  const analysis = analyses[0] ?? null

  return {
    leadId: lead.id,
    outreachReady: isOutreachReady(lead),
    business: {
      name: lead.name,
      category: lead.category,
      city: lead.city,
      state: lead.state,
      website: lead.website,
      phone: lead.phone,
    },
    decisionMaker: lead.has_decision_maker
      ? { name: lead.contact_full_name, title: lead.contact_title, linkedinUrl: lead.linkedin_url }
      : null,
    email: lead.work_email,
    emailVerification: lead.verification_status,
    scores: {
      prospect: lead.prospect_score,
      qualifiedLead: lead.qualified_lead_score,
      opportunity: lead.opportunity_score,
      website: lead.website_score,
      seo: lead.seo_score,
      conversion: lead.conversion_score,
    },
    topOpportunity: lead.top_opportunity,
    recommendedServices: analysis?.recommendedServices ?? lead.recommended_services ?? [],
    weaknesses: analysis?.opportunities ?? [],
    strengths: (analysis?.strengths ?? []).map((strength) => strength.text),
    pipeline: {
      stage: lead.pipeline_stage,
      priority: lead.priority,
      contactStatus: lead.contact_status,
      followUpAt: lead.follow_up_at,
    },
    tags: lead.tag_names,
    notes: notes.map((note) => note.content),
  }
}
