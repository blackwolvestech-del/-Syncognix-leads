import { ANALYSIS_TIERS } from "@/lib/analysis/config"

/*
 * Central configuration for Step 5 (pipeline and lead management). Stages,
 * priorities and statuses have stable internal values (stored in the
 * database) and display labels that live only here.
 */

export const PIPELINE_STAGES = [
  "new",
  "qualified",
  "ready_for_outreach",
  "contacted",
  "follow_up",
  "interested",
  "proposal",
  "won",
  "lost",
] as const

export type PipelineStage = (typeof PIPELINE_STAGES)[number]

export const DEFAULT_STAGE: PipelineStage = "new"

export const STAGE_LABELS: Record<PipelineStage, string> = {
  new: "New",
  qualified: "Qualified",
  ready_for_outreach: "Ready for Outreach",
  contacted: "Contacted",
  follow_up: "Follow-Up",
  interested: "Interested",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
}

/** Subtle per-stage styling from the existing design tokens: a dot and a badge. */
export const STAGE_STYLES: Record<PipelineStage, { dot: string; badge: string }> = {
  new: { dot: "bg-muted-foreground/50", badge: "border-border bg-muted/60 text-muted-foreground" },
  qualified: { dot: "bg-primary/60", badge: "border-primary/25 bg-primary/5 text-foreground" },
  ready_for_outreach: { dot: "bg-primary", badge: "border-primary/40 bg-primary/10 text-primary" },
  contacted: { dot: "bg-warning/70", badge: "border-warning/30 bg-warning/5 text-foreground" },
  follow_up: { dot: "bg-warning", badge: "border-warning/40 bg-warning/10 text-foreground" },
  interested: { dot: "bg-success/60", badge: "border-success/25 bg-success/5 text-foreground" },
  proposal: { dot: "bg-success/80", badge: "border-success/30 bg-success/10 text-foreground" },
  won: { dot: "bg-success", badge: "border-success/40 bg-success/15 text-success" },
  lost: { dot: "bg-muted-foreground/30", badge: "border-border bg-muted/40 text-muted-foreground/80" },
}

/** Stages before any contact was made; the "Ready for Outreach" view looks only at these. */
export const PRE_CONTACT_STAGES: PipelineStage[] = ["new", "qualified", "ready_for_outreach"]

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const

export type Priority = (typeof PRIORITIES)[number]

export const DEFAULT_PRIORITY: Priority = "medium"

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
}

export const PRIORITY_STYLES: Record<Priority, string> = {
  low: "border-border bg-muted/40 text-muted-foreground",
  medium: "border-border bg-muted/60 text-foreground",
  high: "border-warning/40 bg-warning/10 text-foreground",
  urgent: "border-destructive/30 bg-destructive/5 text-destructive",
}

/** Last communication outcome. Separate from the stage, which is the sales lifecycle. */
export const CONTACT_STATUSES = [
  "not_contacted",
  "email_sent",
  "called",
  "replied",
  "no_response",
  "invalid_contact",
] as const

export type ContactStatus = (typeof CONTACT_STATUSES)[number]

export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  not_contacted: "Not contacted",
  email_sent: "Email sent",
  called: "Called",
  replied: "Replied",
  no_response: "No response",
  invalid_contact: "Invalid contact",
}

export const PIPELINE_CONFIG = {
  /** Leads per page in the table view. */
  pageSize: 25,
  /** Cards loaded per stage on the pipeline board; the rest are reached through the table. */
  boardColumnLimit: 30,
  /** Most leads changed by one bulk action. */
  maxBulk: 200,
  /** Most rows in one CSV export. */
  maxExportRows: 5_000,
  /** "High Potential" = Qualified Lead Score at or above this. */
  highPotentialScore: ANALYSIS_TIERS.high,
  outreach: {
    /**
     * A lead is outreach-ready when it has a decision maker, a professional
     * email and a scored analysis. Raise this above 0 to also require a
     * minimum Qualified Lead Score (e.g. 80). Leads below it stay visible
     * everywhere else.
     */
    minQualifiedScore: 0,
  },
  /** A Qualified Lead Score at or above this suggests High priority. Never applied automatically. */
  suggestHighPriorityScore: 90,
  limits: { listName: 80, listDescription: 300, tagName: 40, note: 5_000, followUpNote: 300 },
} as const

/** The one-click views above the lead list. */
export const QUICK_VIEWS = [
  "all",
  "high_potential",
  "outreach_ready",
  "follow_up_due",
  "contacted",
  "won",
  "lost",
] as const

export type QuickView = (typeof QUICK_VIEWS)[number]

export const QUICK_VIEW_LABELS: Record<QuickView, string> = {
  all: "All Leads",
  high_potential: "High Potential",
  outreach_ready: "Ready for Outreach",
  follow_up_due: "Follow-Up Due",
  contacted: "Contacted",
  won: "Won",
  lost: "Lost",
}

export const QUICK_VIEW_HINTS: Record<QuickView, string> = {
  all: "Every saved lead",
  high_potential: `Qualified Lead Score ${ANALYSIS_TIERS.high} or higher`,
  outreach_ready: "Decision maker, email and scored analysis in place; not contacted yet",
  follow_up_due: "Follow-up overdue or due today",
  contacted: "Stage: Contacted",
  won: "Stage: Won",
  lost: "Stage: Lost",
}

/** True when a lead has everything outreach needs (and meets the optional score threshold). */
export function isOutreachReady(lead: { outreach_ready: boolean; qualified_lead_score: number | null }) {
  const minScore = PIPELINE_CONFIG.outreach.minQualifiedScore
  return lead.outreach_ready && (minScore === 0 || (lead.qualified_lead_score ?? 0) >= minScore)
}

/** What the scores suggest. Only ever shown as a hint: the user decides. */
export function suggestStage(lead: {
  pipeline_stage: PipelineStage
  outreach_ready: boolean
  qualified_lead_score: number | null
}): PipelineStage | null {
  if (!isOutreachReady(lead)) return null
  return lead.pipeline_stage === "new" || lead.pipeline_stage === "qualified" ? "ready_for_outreach" : null
}

export function suggestPriority(lead: { priority: Priority; qualified_lead_score: number | null }): Priority | null {
  const score = lead.qualified_lead_score
  if (score === null || score < PIPELINE_CONFIG.suggestHighPriorityScore) return null
  return lead.priority === "low" || lead.priority === "medium" ? "high" : null
}

/** History entries: how each stored action reads in the timeline. */
type Meta = Record<string, unknown>
const text = (value: unknown) => (typeof value === "string" && value ? value : null)
const stageName = (value: unknown) => STAGE_LABELS[value as PipelineStage] ?? text(value) ?? "Unknown"
const priorityName = (value: unknown) => PRIORITY_LABELS[value as Priority] ?? text(value) ?? "Unknown"
const contactName = (value: unknown) => CONTACT_STATUS_LABELS[value as ContactStatus] ?? text(value) ?? "Unknown"

const ACTIVITY_TEXT: Record<string, (meta: Meta) => string> = {
  lead_saved: () => "Lead saved",
  stage_changed: (m) => `Moved from ${stageName(m.from)} → ${stageName(m.to)}`,
  priority_changed: (m) => `Priority changed from ${priorityName(m.from)} to ${priorityName(m.to)}`,
  contact_status_changed: (m) => `Contact status: ${contactName(m.to)}`,
  follow_up_set: (m) => (text(m.note) ? `Follow-up scheduled: ${text(m.note)}` : "Follow-up scheduled"),
  follow_up_cleared: () => "Follow-up cleared",
  assigned: () => "Assigned",
  unassigned: () => "Unassigned",
  lead_archived: () => "Lead archived",
  lead_restored: () => "Lead restored",
  list_added: (m) => `Added to “${text(m.list) ?? "a list"}”`,
  list_removed: (m) => (text(m.list) ? `Removed from “${text(m.list)}”` : "Removed from a deleted list"),
  tag_added: (m) => `Tag added: ${text(m.tag) ?? "tag"}`,
  tag_removed: (m) => (text(m.tag) ? `Tag removed: ${text(m.tag)}` : "A deleted tag was removed"),
  note_added: () => "Note added",
  note_edited: () => "Note edited",
  note_deleted: () => "Note deleted",
  enrichment_completed: (m) =>
    m.status === "no_match"
      ? "Decision maker lookup: no match"
      : m.status === "partial"
        ? "Decision maker found (no email)"
        : "Decision maker found",
  email_verified: (m) => `Email verified: ${text(m.status) ?? "unknown"}`,
  analysis_completed: (m) =>
    typeof m.qualified_lead_score === "number"
      ? `Business analysis completed (Qualified Lead ${m.qualified_lead_score})`
      : "Business analysis completed",
}

export function describeActivity(action: string, metadata: Meta) {
  return ACTIVITY_TEXT[action]?.(metadata) ?? action.replace(/_/g, " ")
}
