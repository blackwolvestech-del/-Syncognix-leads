import { CircleAlert, CircleCheck, CircleDashed, CircleSlash, type LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { QUALIFIED_TIER_LABELS, analysisTier, type AnalysisTier } from "@/lib/analysis/config"
import { cn } from "@/lib/utils"
import type { AnalysisStatus, ScoreKey } from "@/types/analysis"

/** Same tokens as the prospect score, so every score reads the same way. */
const TIER_STYLES: Record<AnalysisTier, { badge: string; bar: string }> = {
  high: { badge: "border-success/30 bg-success/10 text-success", bar: "bg-success" },
  moderate: { badge: "border-warning/40 bg-warning/10 text-foreground", bar: "bg-warning" },
  lower: { badge: "border-border bg-muted text-muted-foreground", bar: "bg-muted-foreground/50" },
}

export const SCORE_LABELS: Record<ScoreKey, string> = {
  website: "Website",
  seo: "SEO",
  conversion: "Conversion",
  localPresence: "Local Presence",
  opportunity: "Opportunity",
  qualifiedLead: "Qualified Lead",
}

/** What each score does — and doesn't — measure. Shown as help text. */
export const SCORE_HINTS: Record<ScoreKey, string> = {
  website: "Observable website fundamentals on the homepage. Not a measure of design, rankings or revenue.",
  seo: "On-page SEO fundamentals found in the homepage HTML. Not search rankings or traffic.",
  conversion: "Calls to action, forms and contact options detected on the homepage.",
  localPresence: "Listing completeness plus local signals on the website. Ratings and reviews are not available.",
  opportunity: "How much visible room for improvement was found. A strong business can still score high here.",
  qualifiedLead: "Prospect score, decision-maker contact and website opportunity combined. Not a purchase probability.",
}

export function qualifiedTierLabel(score: number) {
  return QUALIFIED_TIER_LABELS[analysisTier(score)]
}

/** Compact score pill. A score that couldn't be measured shows a dash, never 0. */
export function ScorePill({
  score,
  label,
  className,
}: {
  score: number | null
  /** e.g. "Qualified lead score". */
  label: string
  className?: string
}) {
  const style = score === null ? TIER_STYLES.lower.badge : TIER_STYLES[analysisTier(score)].badge
  return (
    <span
      role="img"
      aria-label={score === null ? `${label}: not measured` : `${label}: ${score} out of 100`}
      title={score === null ? `${label}: not measured` : `${label}: ${score} / 100`}
      className={cn(
        "inline-flex h-6 min-w-10 items-center justify-center rounded-full border px-2 text-xs font-semibold tabular-nums",
        style,
        className
      )}
    >
      {score ?? "—"}
    </span>
  )
}

/** One scorecard line: label, meter and value. */
export function ScoreBar({ scoreKey, score }: { scoreKey: ScoreKey; score: number | null }) {
  const label = SCORE_LABELS[scoreKey]
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)_3.75rem] items-center gap-3 py-1.5 text-sm">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="w-fit cursor-default underline decoration-muted-foreground/40 decoration-dotted underline-offset-4" tabIndex={0}>
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">{SCORE_HINTS[scoreKey]}</TooltipContent>
      </Tooltip>
      {score === null ? (
        <span className="text-xs text-muted-foreground/70">Not measured</span>
      ) : (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="meter"
          aria-label={`${label} score`}
          aria-valuenow={score}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={cn("h-full rounded-full transition-[width] duration-300", TIER_STYLES[analysisTier(score)].bar)}
            style={{ width: `${score}%` }}
          />
        </div>
      )}
      <span className="text-right font-medium tabular-nums">
        {score ?? "—"}
        {score !== null && <span className="text-xs font-normal text-muted-foreground"> / 100</span>}
      </span>
    </div>
  )
}

/** Tier badge for the Qualified Lead Score, e.g. "High-potential prospect". */
export function QualifiedTierBadge({ score, className }: { score: number; className?: string }) {
  const tier = analysisTier(score)
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", TIER_STYLES[tier].badge, className)}>
      {QUALIFIED_TIER_LABELS[tier]}
    </span>
  )
}

export function scoreBarClass(score: number) {
  return TIER_STYLES[analysisTier(score)].bar
}

const STATUS: Record<AnalysisStatus | "not_analyzed", { label: string; icon: LucideIcon; style: string }> = {
  complete: { label: "Analysis complete", icon: CircleCheck, style: "border-success/30 bg-success/10 text-success" },
  partial: { label: "Partial analysis", icon: CircleSlash, style: "border-warning/40 bg-warning/10 text-foreground [&>svg]:text-warning" },
  website_unavailable: { label: "Website unavailable", icon: CircleAlert, style: "border-warning/40 bg-warning/10 text-foreground [&>svg]:text-warning" },
  failed: { label: "Analysis failed", icon: CircleAlert, style: "border-destructive/30 bg-destructive/5 text-destructive" },
  not_analyzed: { label: "Not analyzed", icon: CircleDashed, style: "border-border bg-muted/60 text-muted-foreground" },
}

export function AnalysisStatusBadge({
  status,
  className,
}: {
  status: AnalysisStatus | "not_analyzed"
  className?: string
}) {
  const { label, icon: Icon, style } = STATUS[status]
  return (
    <Badge variant="outline" className={cn("gap-1 font-normal", style, className)}>
      <Icon aria-hidden /> {label}
    </Badge>
  )
}
