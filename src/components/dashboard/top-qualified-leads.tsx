import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScorePill } from "@/components/analysis/score-indicators"
import { SectionCard } from "@/components/shared/section-card"
import type { AnalysisSummary } from "@/lib/analysis/cache"

/** The best-qualified businesses the user has analyzed, from stored results. */
export function TopQualifiedLeads({ leads }: { leads: AnalysisSummary[] }) {
  return (
    <SectionCard
      title="Top leads"
      description="Your analyzed businesses with the highest Qualified Lead Score."
      action={
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
          <Link href="/leads?sort=qualified">
            View saved leads <ArrowUpRight />
          </Link>
        </Button>
      }
      contentClassName="px-0 py-0"
    >
      <ol className="divide-y">
        {leads.map((lead, index) => (
          <li key={lead.businessId} className="flex items-center gap-3 px-5 py-3">
            <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">{index + 1}.</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{lead.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {lead.topOpportunity ? `Top opportunity: ${lead.topOpportunity}` : "No service recommendation"}
              </span>
            </span>
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">Qualified lead</span>
            <ScorePill score={lead.qualifiedLead} label="Qualified lead score" />
          </li>
        ))}
      </ol>
    </SectionCard>
  )
}
