import type { Metadata } from "next"
import Link from "next/link"
import { BadgeCheck, Building2, MailSearch, Search, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GettingStarted } from "@/components/dashboard/getting-started"
import { LeadQualityOverview } from "@/components/dashboard/lead-quality-overview"
import { MetricCard } from "@/components/dashboard/metric-card"
import { QuickActions } from "@/components/dashboard/quick-actions"
import { RecentSearches } from "@/components/dashboard/recent-searches"
import { Stagger, StaggerItem } from "@/components/shared/motion"
import { PageHeader } from "@/components/shared/page-header"
import { ToastOnMount } from "@/components/shared/toast-on-mount"
import { requireUser } from "@/lib/auth/user"
import { getEnrichmentCounts } from "@/lib/enrichment/cache"
import { getLeadCount } from "@/lib/leads/get-leads"
import { getRecentSearches } from "@/lib/leads/searches"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Dashboard" }

// AI lead-quality analysis arrives in a later step.
const LATER = "Not analyzed yet"

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const [user, params] = await Promise.all([requireUser(), searchParams])
  const [leadCount, recentSearches, contacts] = await Promise.all([
    getLeadCount(user.id),
    getRecentSearches(user.id),
    getEnrichmentCounts(await createClient(), user.id),
  ])

  const metrics = [
    {
      title: "Total Leads",
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
    { title: "High Quality Leads", value: 0, icon: Sparkles, hint: LATER },
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
          />
        </StaggerItem>
        <StaggerItem className="lg:col-span-2">
          <LeadQualityOverview />
        </StaggerItem>
        <StaggerItem>
          <QuickActions />
        </StaggerItem>
      </Stagger>
    </div>
  )
}
