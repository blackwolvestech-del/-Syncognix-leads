import type { Metadata } from "next"
import Link from "next/link"
import {
  BadgeCheck,
  Building2,
  CalendarClock,
  MailSearch,
  Search,
  Send,
  Sparkles,
  Trophy,
  UserRoundCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { GettingStarted } from "@/components/dashboard/getting-started"
import { LeadQualityOverview } from "@/components/dashboard/lead-quality-overview"
import { MetricCard } from "@/components/dashboard/metric-card"
import { PipelineOverview } from "@/components/dashboard/pipeline-overview"
import { QuickActions } from "@/components/dashboard/quick-actions"
import { RecentSearches } from "@/components/dashboard/recent-searches"
import { TopQualifiedLeads } from "@/components/dashboard/top-qualified-leads"
import { Stagger, StaggerItem } from "@/components/shared/motion"
import { PageHeader } from "@/components/shared/page-header"
import { ToastOnMount } from "@/components/shared/toast-on-mount"
import { getAnalysisSummaries } from "@/lib/analysis/cache"
import { ANALYSIS_TIERS } from "@/lib/analysis/config"
import { requireUser } from "@/lib/auth/user"
import { getEnrichmentCounts } from "@/lib/enrichment/cache"
import { getLeadCount } from "@/lib/leads/get-leads"
import { getLeadPreferences, getPipelineSummary } from "@/lib/pipeline/queries"
import { getRecentSearches } from "@/lib/leads/searches"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Dashboard" }

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const [user, params] = await Promise.all([requireUser(), searchParams])
  const [supabase, preferences] = await Promise.all([createClient(), getLeadPreferences()])
  const [leadCount, recentSearches, contacts, analyses, pipeline] = await Promise.all([
    getLeadCount(user.id),
    getRecentSearches(user.id),
    getEnrichmentCounts(supabase, user.id),
    // Stored analysis results only; already sorted best qualified first.
    getAnalysisSummaries(supabase, user.id),
    // Null until the Step 5 migration has been run; the pipeline widgets are then left out.
    getPipelineSummary(supabase, user.id, preferences.timeZone),
  ])
  const qualifiedScores = analyses.flatMap((analysis) => analysis.qualifiedLead ?? [])
  const highQuality = qualifiedScores.filter((score) => score >= ANALYSIS_TIERS.high).length

  const metrics = [
    {
      title: "Total Saved Leads",
      value: leadCount ?? 0,
      icon: Building2,
      hint: leadCount ? "Saved from your searches" : "No saved leads yet",
    },
    {
      title: "Emails Found",
      value: contacts.emailsFound,
      icon: MailSearch,
      hint: contacts.emailsFound ? "Work emails from decision-maker lookups" : "No lookups yet",
    },
    {
      title: "Verified Emails",
      value: contacts.verifiedEmails,
      icon: BadgeCheck,
      hint: contacts.verifiedEmails ? "Verified as deliverable" : "No verified emails yet",
    },
    {
      title: "High Quality Leads",
      value: highQuality,
      icon: Sparkles,
      hint: analyses.length
        ? `Qualified Lead Score ${ANALYSIS_TIERS.high}+ of ${analyses.length} analyzed`
        : "Not analyzed yet",
    },
    ...(pipeline
      ? [
          {
            title: "Qualified Leads",
            value: pipeline.stages.qualified,
            icon: UserRoundCheck,
            hint: pipeline.stages.qualified ? "In the Qualified stage" : "None in the Qualified stage",
          },
          {
            title: "Ready for Outreach",
            value: pipeline.outreachReady,
            icon: Send,
            hint: pipeline.outreachReady ? "Contact, email and analysis in place" : "None ready yet",
          },
          {
            title: "Follow-Ups Due",
            value: pipeline.followUpsDue,
            icon: CalendarClock,
            hint: pipeline.followUpsDue ? "Overdue or due today" : "No follow-ups due",
          },
          {
            title: "Won Leads",
            value: pipeline.stages.won,
            icon: Trophy,
            hint: pipeline.stages.won ? "In the Won stage" : "None won yet",
          },
        ]
      : []),
  ]

  return (
    <div className="space-y-8">
      {params.password === "updated" && <ToastOnMount message="Your password has been updated." />}

      <PageHeader
        title={`Welcome back, ${user.firstName}`}
        description="Here’s an overview of your lead intelligence workspace."
        actions={
          <Button asChild>
            <Link href="/find-leads">
              <Search /> Find Leads
            </Link>
          </Button>
        }
      />

      <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <StaggerItem key={metric.title}>
            <MetricCard {...metric} />
          </StaggerItem>
        ))}
      </Stagger>

      <Stagger className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <StaggerItem className="lg:col-span-2">
          <RecentSearches searches={recentSearches} />
        </StaggerItem>
        <StaggerItem>
          <GettingStarted
            hasSearched={recentSearches.length > 0 || Boolean(leadCount)}
            hasEmails={contacts.emailsFound > 0}
            hasAnalyses={analyses.length > 0}
          />
        </StaggerItem>
        <StaggerItem className="lg:col-span-2">
          <LeadQualityOverview scores={qualifiedScores} />
        </StaggerItem>
        <StaggerItem>
          <QuickActions />
        </StaggerItem>
        {pipeline && (
          <StaggerItem className="lg:col-span-3">
            <PipelineOverview stages={pipeline.stages} />
          </StaggerItem>
        )}
        {analyses.length > 0 && (
          <StaggerItem className="lg:col-span-3">
            <TopQualifiedLeads leads={analyses.slice(0, 5)} />
          </StaggerItem>
        )}
      </Stagger>
    </div>
  )
}
