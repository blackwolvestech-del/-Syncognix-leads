import { Check } from "lucide-react"
import { SectionCard } from "@/components/shared/section-card"
import { cn } from "@/lib/utils"

const laterSteps = [
  { title: "Analyze lead quality", done: false },
  { title: "Generate outreach", done: false },
]

export function GettingStarted({
  hasSearched,
  hasEmails,
}: {
  hasSearched: boolean
  hasEmails: boolean
}) {
  const steps = [
    { title: "Create your account", done: true },
    { title: "Search for businesses", done: hasSearched },
    { title: "Find business emails", done: hasEmails },
    ...laterSteps,
  ]
  const completed = steps.filter((step) => step.done).length
  const percent = Math.round((completed / steps.length) * 100)

  return (
    <SectionCard
      title="Getting started"
      description={`${completed} of ${steps.length} steps complete`}
      action={
        <span className="text-xs font-medium text-muted-foreground tabular-nums">{percent}%</span>
      }
    >
      <div
        className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Onboarding progress"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <ol className="space-y-1">
        {steps.map((step, index) => (
          <li key={step.title} className="flex items-center gap-3 rounded-md py-1.5">
            <span
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full border text-[10px] font-medium tabular-nums",
                step.done
                  ? "border-success bg-success text-white"
                  : "border-dashed border-muted-foreground/40 text-muted-foreground"
              )}
            >
              {step.done ? <Check className="size-3" strokeWidth={3} aria-hidden /> : index + 1}
            </span>
            <span
              className={cn(
                "text-sm",
                step.done ? "text-muted-foreground line-through decoration-muted-foreground/40" : "text-foreground"
              )}
            >
              {step.title}
            </span>
            <span className="sr-only">{step.done ? "(completed)" : "(not started)"}</span>
          </li>
        ))}
      </ol>
    </SectionCard>
  )
}
