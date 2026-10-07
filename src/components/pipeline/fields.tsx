"use client"

import { useSyncExternalStore } from "react"
import { CalendarClock, CalendarPlus, Send } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  PIPELINE_STAGES,
  PRIORITIES,
  PRIORITY_LABELS,
  PRIORITY_STYLES,
  STAGE_LABELS,
  STAGE_STYLES,
  type PipelineStage,
  type Priority,
} from "@/lib/pipeline/config"
import { FOLLOW_UP_LABELS, dayBounds, followUpBucket, type FollowUpBucket } from "@/lib/pipeline/follow-up"
import { cn } from "@/lib/utils"
import type { LeadTag } from "@/types/pipeline"

export function StageDot({ stage, className }: { stage: PipelineStage; className?: string }) {
  return <span aria-hidden className={cn("size-2 shrink-0 rounded-full", STAGE_STYLES[stage].dot, className)} />
}

export function StageBadge({ stage, className }: { stage: PipelineStage; className?: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-normal", STAGE_STYLES[stage].badge, className)}>
      <StageDot stage={stage} /> {STAGE_LABELS[stage]}
    </Badge>
  )
}

export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-normal", PRIORITY_STYLES[priority], className)}>
      {PRIORITY_LABELS[priority]}
    </Badge>
  )
}

const TRIGGER = "h-8 w-full gap-1.5 px-2.5 text-[13px]"

/** Inline stage picker. Also the keyboard and touch way to move a pipeline card. */
export function StageSelect({
  value,
  onChange,
  disabled,
  label,
  className,
}: {
  value: PipelineStage
  onChange: (stage: PipelineStage) => void
  disabled?: boolean
  /** Accessible name, e.g. "Stage for ABC Roofing". */
  label: string
  className?: string
}) {
  return (
    <Select value={value} onValueChange={(next) => next !== value && onChange(next as PipelineStage)} disabled={disabled}>
      <SelectTrigger aria-label={label} className={cn(TRIGGER, "min-w-36", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PIPELINE_STAGES.map((stage) => (
          <SelectItem key={stage} value={stage}>
            <StageDot stage={stage} /> {STAGE_LABELS[stage]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function PrioritySelect({
  value,
  onChange,
  disabled,
  label,
  className,
}: {
  value: Priority
  onChange: (priority: Priority) => void
  disabled?: boolean
  label: string
  className?: string
}) {
  return (
    <Select value={value} onValueChange={(next) => next !== value && onChange(next as Priority)} disabled={disabled}>
      <SelectTrigger
        aria-label={label}
        className={cn(TRIGGER, "min-w-24", (value === "high" || value === "urgent") && PRIORITY_STYLES[value], className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PRIORITIES.map((priority) => (
          <SelectItem key={priority} value={priority}>
            {PRIORITY_LABELS[priority]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// --- follow-ups ------------------------------------------------------------------

const noop = () => () => {}

/** False on the server and during hydration, true afterwards. */
export function useMounted() {
  return useSyncExternalStore(noop, () => true, () => false)
}

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })
const fullDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" })

/** "Oct 12, 2026, 10:00 AM" in the browser's time zone. */
export function formatFollowUp(iso: string) {
  return fullDate.format(new Date(iso))
}

// Overdue is noticeable without shouting; later dates stay quiet.
const BUCKET_STYLES: Record<FollowUpBucket, string> = {
  overdue: "border-destructive/30 bg-destructive/5 text-destructive",
  today: "border-warning/40 bg-warning/10 text-foreground [&>svg]:text-warning",
  tomorrow: "border-border bg-muted/60 text-foreground",
  upcoming: "border-border bg-muted/40 text-muted-foreground",
}

/**
 * A follow-up date with its urgency (overdue / today / tomorrow / upcoming),
 * worked out in the browser's own time zone. Rendered after hydration so the
 * server's time zone never shows through.
 */
export function FollowUpBadge({
  followUpAt,
  note,
  className,
}: {
  followUpAt: string | null
  note?: string | null
  className?: string
}) {
  const mounted = useMounted()
  if (!followUpAt) return null
  if (!mounted) return <span className={cn("inline-block h-5 w-16 rounded-full bg-muted", className)} aria-hidden />

  const bucket = followUpBucket(followUpAt, dayBounds(Intl.DateTimeFormat().resolvedOptions().timeZone)) ?? "upcoming"
  const date = new Date(followUpAt)
  const label = bucket === "today" || bucket === "tomorrow" ? FOLLOW_UP_LABELS[bucket] : shortDate.format(date)
  return (
    <Badge
      variant="outline"
      title={`${FOLLOW_UP_LABELS[bucket]}: ${fullDate.format(date)}${note ? ` — ${note}` : ""}`}
      className={cn("gap-1 font-normal", BUCKET_STYLES[bucket], className)}
    >
      <CalendarClock aria-hidden />
      {bucket === "overdue" && <span className="sr-only">Overdue: </span>}
      {label}
    </Badge>
  )
}

/** The follow-up cell: the date when one is set, otherwise a quiet "Set" action. */
export function FollowUpButton({
  followUpAt,
  note,
  onClick,
  disabled,
  businessName,
}: {
  followUpAt: string | null
  note?: string | null
  onClick: () => void
  disabled?: boolean
  businessName: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={followUpAt ? `Change follow-up for ${businessName}` : `Set follow-up for ${businessName}`}
      className="inline-flex items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
    >
      {followUpAt ? (
        <FollowUpBadge followUpAt={followUpAt} note={note} />
      ) : (
        <span className="inline-flex items-center gap-1 px-1 text-xs text-muted-foreground hover:text-foreground">
          <CalendarPlus className="size-3.5" aria-hidden /> Set
        </span>
      )}
    </button>
  )
}

// --- tags and readiness -----------------------------------------------------------

/** A lead's tags as chips, in name order; extra ones are folded into "+n". */
export function TagChips({
  tagIds,
  tags,
  max = 3,
  className,
}: {
  tagIds: string[]
  tags: LeadTag[]
  max?: number
  className?: string
}) {
  const applied = tags.filter((tag) => tagIds.includes(tag.id))
  if (applied.length === 0) return null
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {applied.slice(0, max).map((tag) => (
        <Badge key={tag.id} variant="secondary" className="max-w-32 font-normal">
          <span className="truncate">{tag.name}</span>
        </Badge>
      ))}
      {applied.length > max && (
        <Badge variant="outline" className="font-normal text-muted-foreground" title={applied.slice(max).map((tag) => tag.name).join(", ")}>
          +{applied.length - max}
        </Badge>
      )}
    </span>
  )
}

export function OutreachReadyBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      title="Decision maker, professional email and a scored analysis are in place"
      className={cn("gap-1 border-primary/30 bg-primary/5 font-normal text-primary", className)}
    >
      <Send aria-hidden /> Outreach-ready
    </Badge>
  )
}
