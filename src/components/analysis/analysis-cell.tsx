"use client"

import { FileSearch, Loader2, RotateCcw, ScanSearch } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { BusinessAnalysis } from "@/types/analysis"
import { AnalysisStatusBadge, ScoreBar, ScorePill, qualifiedTierLabel } from "./score-indicators"
import { STAGE_LABELS, type AnalysisActivity } from "./use-analysis"

export interface AnalysisCellProps {
  analysis: BusinessAnalysis | undefined
  /** Set while an analysis is running for this business. */
  activity: AnalysisActivity | undefined
  /** Why the last attempt failed, if it did. */
  failure?: string
  /** True while a bulk run is in progress; single actions wait. */
  disabled?: boolean
  onAnalyze: () => void
  onView: () => void
}

export function AnalysisProgress({ activity, name }: { activity: AnalysisActivity; name?: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
      <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
      <span>
        {name && <span className="sr-only">Analyzing {name}: </span>}
        {STAGE_LABELS[activity]}...
      </span>
    </p>
  )
}

/** Compact business-intelligence block for table rows and cards. */
export function AnalysisCell({
  analysis,
  activity,
  failure,
  disabled,
  onAnalyze,
  onView,
  businessName,
}: AnalysisCellProps & { businessName: string }) {
  if (activity) return <AnalysisProgress activity={activity} name={businessName} />

  if (!analysis) {
    return (
      <div className="space-y-1.5">
        {failure && <p className="max-w-56 text-xs text-pretty text-muted-foreground">{failure}</p>}
        <Button
          variant="outline"
          size="sm"
          onClick={onAnalyze}
          disabled={disabled}
          aria-label={`Analyze ${businessName}`}
        >
          {failure ? <RotateCcw /> : <ScanSearch />}
          {failure ? "Try Again" : "Analyze Business"}
        </Button>
      </div>
    )
  }

  const { qualifiedLead } = analysis.scores
  return (
    <div className="min-w-36 space-y-1">
      <div className="flex items-center gap-2">
        <ScorePill score={qualifiedLead} label="Qualified lead score" />
        <span className="text-xs text-muted-foreground">
          {qualifiedLead === null ? "Not scored" : qualifiedTierLabel(qualifiedLead).replace(" prospect", "")}
        </span>
      </div>
      {analysis.status !== "complete" ? (
        <AnalysisStatusBadge status={analysis.status} />
      ) : (
        analysis.topOpportunity && (
          <p className="max-w-48 truncate text-xs text-muted-foreground" title={analysis.topOpportunity}>
            Top: {analysis.topOpportunity}
          </p>
        )
      )}
      <Button
        variant="link"
        size="sm"
        className="h-auto gap-1 p-0 text-xs"
        onClick={onView}
        aria-label={`View analysis for ${businessName}`}
      >
        <FileSearch /> View Analysis
      </Button>
    </div>
  )
}

/** Business Intelligence section for the details panel: scores at a glance. */
export function AnalysisSummarySection({
  analysis,
  activity,
  failure,
  disabled,
  onAnalyze,
  onView,
}: AnalysisCellProps) {
  return (
    <section aria-labelledby="details-intelligence">
      <div className="flex items-center justify-between gap-2">
        <h3 id="details-intelligence" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Business intelligence
        </h3>
        <AnalysisStatusBadge status={analysis?.status ?? "not_analyzed"} />
      </div>

      {activity ? (
        <div className="mt-3">
          <AnalysisProgress activity={activity} />
        </div>
      ) : !analysis ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-pretty text-muted-foreground">
            {failure ??
              "Fetch this business's homepage and check its website, SEO and conversion fundamentals. Free: no credits are used, and the result is saved."}
          </p>
          <Button onClick={onAnalyze} disabled={disabled} size="sm">
            {failure ? <RotateCcw /> : <ScanSearch />}
            {failure ? "Try Again" : "Analyze Business"}
          </Button>
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          <div>
            <ScoreBar scoreKey="qualifiedLead" score={analysis.scores.qualifiedLead} />
            <ScoreBar scoreKey="opportunity" score={analysis.scores.opportunity} />
            <ScoreBar scoreKey="website" score={analysis.scores.website} />
            <ScoreBar scoreKey="seo" score={analysis.scores.seo} />
            <ScoreBar scoreKey="conversion" score={analysis.scores.conversion} />
            <ScoreBar scoreKey="localPresence" score={analysis.scores.localPresence} />
          </div>
          {analysis.recommendedServices.length > 0 && (
            <p className="text-sm">
              <span className="text-muted-foreground">Recommended: </span>
              {analysis.recommendedServices.map((service) => service.label).join(" · ")}
            </p>
          )}
          {analysis.websiteNote && <p className="text-xs text-pretty text-muted-foreground">{analysis.websiteNote}</p>}
          <Button onClick={onView} size="sm" variant="outline">
            <FileSearch /> View Analysis
          </Button>
        </div>
      )}
    </section>
  )
}
