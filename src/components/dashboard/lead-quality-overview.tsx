import { SectionCard } from "@/components/shared/section-card"
import { cn } from "@/lib/utils"

const tiers = [
  { label: "High quality", range: "80–100", min: 80, max: 100, dot: "bg-success" },
  { label: "Medium", range: "50–79", min: 50, max: 79, dot: "bg-warning" },
  { label: "Low", range: "0–49", min: 0, max: 49, dot: "bg-muted-foreground/50" },
]

// Placeholder silhouette shown until there are scores; purely decorative.
const ghostBars = [18, 28, 36, 48, 62, 74, 66, 52, 38, 24]

const BUCKETS = 10

/** Distribution of Qualified Lead Scores across the businesses the user has analyzed. */
export function LeadQualityOverview({ scores }: { scores: number[] }) {
  const total = scores.length
  const buckets = Array.from({ length: BUCKETS }, () => 0)
  for (const score of scores) buckets[Math.min(BUCKETS - 1, Math.floor(score / 10))]++
  const tallest = Math.max(1, ...buckets)

  return (
    <SectionCard
      title="Lead quality overview"
      description={
        total
          ? `Qualified Lead Scores of the ${total} ${total === 1 ? "business" : "businesses"} you have analyzed.`
          : "Distribution of lead scores across your workspace."
      }
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="relative">
          <div
            role={total ? "img" : undefined}
            aria-hidden={total ? undefined : true}
            aria-label={
              total
                ? `Score distribution: ${buckets.map((count, i) => `${count} between ${i * 10} and ${i === BUCKETS - 1 ? 100 : i * 10 + 9}`).join(", ")}`
                : undefined
            }
            className="flex h-40 items-end gap-1.5 border-b border-dashed pb-px sm:gap-2"
          >
            {total
              ? buckets.map((count, i) => (
                  <div
                    key={i}
                    title={`${i * 10}–${i === BUCKETS - 1 ? 100 : i * 10 + 9}: ${count}`}
                    className={cn(
                      "flex-1 rounded-t-sm",
                      count === 0 ? "bg-muted" : i >= 8 ? "bg-success" : i >= 5 ? "bg-warning" : "bg-muted-foreground/50"
                    )}
                    style={{ height: count === 0 ? "2px" : `${Math.max(6, (count / tallest) * 100)}%` }}
                  />
                ))
              : ghostBars.map((height, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t-sm bg-gradient-to-t from-muted to-muted/40"
                    style={{ height: `${height}%` }}
                  />
                ))}
          </div>
          <div aria-hidden className="mt-2 flex justify-between text-[11px] text-muted-foreground tabular-nums">
            <span>0</span>
            <span>50</span>
            <span>100</span>
          </div>
          {total === 0 && (
            <div className="absolute inset-x-0 top-0 flex h-40 items-center justify-center px-6">
              <p className="max-w-xs rounded-md border bg-card/90 px-3 py-2 text-center text-[13px] text-pretty text-muted-foreground shadow-xs backdrop-blur-sm">
                Lead scores will appear after you start analyzing businesses.
              </p>
            </div>
          )}
        </div>

        <ul className="space-y-4 self-center">
          {tiers.map((tier) => {
            const count = scores.filter((score) => score >= tier.min && score <= tier.max).length
            return (
              <li key={tier.label}>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className={cn("size-2 rounded-full", tier.dot)} aria-hidden />
                    {tier.label}
                    <span className="text-xs text-muted-foreground">{tier.range}</span>
                  </span>
                  <span className="font-medium tabular-nums">{count}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  {total > 0 && (
                    <div className={cn("h-full rounded-full", tier.dot)} style={{ width: `${(count / total) * 100}%` }} />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </SectionCard>
  )
}
