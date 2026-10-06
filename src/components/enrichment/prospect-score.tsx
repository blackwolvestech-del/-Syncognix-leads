import { Check, Lightbulb } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { SCORE_DISCLAIMER, TIER_LABELS, scoreTier } from "@/lib/scoring/prospect-score"
import { cn } from "@/lib/utils"
import type { ProspectScore, ProspectTier } from "@/types/enrichment"

/** Score colors come from the existing design tokens (success / warning / muted). */
const TIER_STYLES: Record<ProspectTier, { badge: string; bar: string }> = {
  high: { badge: "border-success/30 bg-success/10 text-success", bar: "bg-success" },
  moderate: { badge: "border-warning/40 bg-warning/10 text-foreground", bar: "bg-warning" },
  lower: { badge: "border-border bg-muted text-muted-foreground", bar: "bg-muted-foreground/50" },
}

/** Compact score pill. Hover or focus shows why the business scored that way. */
export function ScoreBadge({ prospect, className }: { prospect: ProspectScore; className?: string }) {
  const tier = scoreTier(prospect.score)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Prospect score ${prospect.score} out of 100, ${TIER_LABELS[tier]}. Show reasons.`}
          className={cn(
            "inline-flex h-6 min-w-10 cursor-default items-center justify-center rounded-full border px-2 text-xs font-semibold tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            TIER_STYLES[tier].badge,
            className
          )}
        >
          {prospect.score}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 space-y-1.5 py-2">
        <p className="font-medium">
          {prospect.score} / 100 · {TIER_LABELS[tier]}
        </p>
        <ul className="space-y-0.5">
          {prospect.reasons.map((reason) => (
            <li key={reason} className="flex items-start gap-1.5">
              <Check className="mt-0.5 size-3 shrink-0" aria-hidden />
              {reason}
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}

export function TierLabel({ score, className }: { score: number; className?: string }) {
  return <span className={cn("text-xs text-muted-foreground", className)}>{TIER_LABELS[scoreTier(score)]}</span>
}

/** The main reasons as a short checklist (used on mobile cards). */
export function ScoreReasons({ reasons, max = 3 }: { reasons: string[]; max?: number }) {
  if (reasons.length === 0) return null
  return (
    <ul className="space-y-0.5 text-xs text-muted-foreground">
      {reasons.slice(0, max).map((reason) => (
        <li key={reason} className="flex items-start gap-1.5">
          <Check className="mt-0.5 size-3 shrink-0 text-success" aria-hidden />
          {reason}
        </li>
      ))}
    </ul>
  )
}

/** Full breakdown for the details panel: score, meter, reasons and opportunities. */
export function ProspectAnalysis({ prospect }: { prospect: ProspectScore }) {
  const tier = scoreTier(prospect.score)
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <p className="text-2xl leading-none font-semibold tracking-tight tabular-nums">
          {prospect.score}
          <span className="text-sm font-normal text-muted-foreground"> / 100</span>
        </p>
        <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", TIER_STYLES[tier].badge)}>
          {TIER_LABELS[tier]}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label="Prospect score"
        aria-valuenow={prospect.score}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-300", TIER_STYLES[tier].bar)}
          style={{ width: `${prospect.score}%` }}
        />
      </div>

      {prospect.reasons.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Why</p>
          <ul className="mt-1 space-y-1 text-sm">
            {prospect.reasons.map((reason) => (
              <li key={reason} className="flex items-start gap-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {prospect.opportunities.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Opportunities</p>
          <ul className="mt-1 space-y-1 text-sm">
            {prospect.opportunities.map((opportunity) => (
              <li key={opportunity} className="flex items-start gap-2">
                <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                {opportunity}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-pretty text-muted-foreground">{SCORE_DISCLAIMER}</p>
    </div>
  )
}
