import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SectionCard } from "@/components/shared/section-card"
import { PIPELINE_STAGES, STAGE_LABELS, STAGE_STYLES, type PipelineStage } from "@/lib/pipeline/config"
import { cn } from "@/lib/utils"

const numberFormat = new Intl.NumberFormat("en-US")

/** Active leads in each pipeline stage, from stored data. Each row opens that stage. */
export function PipelineOverview({ stages }: { stages: Record<PipelineStage, number> }) {
  const total = PIPELINE_STAGES.reduce((sum, stage) => sum + stages[stage], 0)
  const largest = Math.max(1, ...PIPELINE_STAGES.map((stage) => stages[stage]))

  return (
    <SectionCard
      title="Pipeline"
      description={`${numberFormat.format(total)} active ${total === 1 ? "lead" : "leads"} by stage.`}
      action={
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
          <Link href="/leads?layout=pipeline">
            Open pipeline <ArrowUpRight />
          </Link>
        </Button>
      }
      contentClassName="px-2 py-2"
    >
      <ul className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">
        {PIPELINE_STAGES.map((stage) => (
          <li key={stage}>
            <Link
              href={`/leads?stage=${stage}`}
              className="block rounded-md px-3 py-2 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", STAGE_STYLES[stage].dot)} aria-hidden />
                  {STAGE_LABELS[stage]}
                </span>
                <span className="font-medium tabular-nums">{numberFormat.format(stages[stage])}</span>
              </span>
              <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span
                  className={cn("block h-full rounded-full", STAGE_STYLES[stage].dot)}
                  style={{ width: `${(stages[stage] / largest) * 100}%` }}
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}
