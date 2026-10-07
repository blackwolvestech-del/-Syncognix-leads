"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  Lightbulb,
  Loader2,
  MoreHorizontal,
  Tags,
  Trash2,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AnalysisSummarySection } from "@/components/analysis/analysis-cell"
import { AnalysisReportSheet } from "@/components/analysis/analysis-report-sheet"
import { useAnalysis } from "@/components/analysis/use-analysis"
import { EnrichmentSections } from "@/components/enrichment/decision-maker"
import { useEnrichment } from "@/components/enrichment/use-enrichment"
import { Missing, PhoneLink, WebsiteLink, cityState } from "@/components/leads/business-cells"
import { toBusiness, type LeadRow } from "@/components/leads/leads-table"
import {
  CONTACT_STATUSES,
  CONTACT_STATUS_LABELS,
  PIPELINE_CONFIG,
  PRIORITY_LABELS,
  STAGE_LABELS,
  isOutreachReady,
  suggestPriority,
  suggestStage,
  type ContactStatus,
} from "@/lib/pipeline/config"
import { cn } from "@/lib/utils"
import type { BusinessAnalysis } from "@/types/analysis"
import type { LeadEnrichment } from "@/types/enrichment"
import type { LeadActivityEntry, LeadList, LeadNote, LeadTag } from "@/types/pipeline"
import { FollowUpDialog, NameDialog } from "./dialogs"
import { FollowUpBadge, OutreachReadyBadge, PrioritySelect, StageBadge, StageSelect, formatFollowUp, useMounted } from "./fields"
import { LeadHistory, LeadNotes } from "./lead-notes"
import { MembershipMenus } from "./membership-menu"
import { useLeadActions } from "./use-lead-actions"

const { limits } = PIPELINE_CONFIG

const PRIORITY_STYLES = {
  high: "border-success/30 bg-success/10 text-success",
  medium: "border-warning/40 bg-warning/10 text-foreground",
  low: "border-border bg-muted text-muted-foreground",
} as const

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })

function Card({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  const id = `lead-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`
  return (
    <section aria-labelledby={id} className={cn("rounded-lg border bg-card shadow-xs", className)}>
      <div className="flex items-center justify-between gap-2 border-b px-5 py-3.5">
        <h2 id={id} className="text-sm font-medium">
          {title}
        </h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}

/** A hint from the scores. It changes nothing until the user applies it. */
function Suggestion({ text, onApply }: { text: string; onApply: () => void }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <Lightbulb className="size-3.5 text-warning" aria-hidden />
      {text}
      <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onApply}>
        Apply
      </Button>
    </p>
  )
}

/** Everything about one saved lead: business, contact, intelligence, pipeline, notes and history. */
export function LeadDetail({
  lead: serverLead,
  enrichment: initialEnrichment,
  analysis: initialAnalysis,
  lists,
  tags,
  notes,
  activity,
  user,
}: {
  lead: LeadRow
  enrichment: LeadEnrichment | null
  analysis: BusinessAnalysis | null
  lists: LeadList[]
  tags: LeadTag[]
  notes: LeadNote[]
  activity: LeadActivityEntry[]
  user: { id: string; name: string }
}) {
  const router = useRouter()
  const mounted = useMounted()
  const actions = useLeadActions([serverLead], user.id)
  const lead = actions.rows[0]
  const ids = [lead.id]
  const business = toBusiness(lead)

  const enrichment = useEnrichment(initialEnrichment ? [initialEnrichment] : [])
  const analysis = useAnalysis(initialAnalysis ? [initialAnalysis] : [])
  const stored = analysis.analyses.get(lead.osm_id)
  const contact = enrichment.enrichments.get(lead.osm_id)

  const [reportOpen, setReportOpen] = useState(false)
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const [namePrompt, setNamePrompt] = useState<"list" | "tag" | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Contact and analysis results change scores that are read from the server.
  async function enrich() {
    await enrichment.enrich(business)
    if (stored) await analysis.refresh([business])
    router.refresh()
  }
  async function verify() {
    await enrichment.verify(lead.osm_id)
    if (stored) await analysis.refresh([business])
    router.refresh()
  }
  async function analyze(reanalyze = false) {
    await analysis.analyze(business, { reanalyze })
    router.refresh()
  }
  async function remove() {
    if (await actions.remove(ids)) router.push("/leads")
  }

  const stageHint = suggestStage(lead)
  const priorityHint = suggestPriority(lead)
  const appliedTags = tags.filter((tag) => lead.tag_ids.includes(tag.id))
  const inLists = lists.filter((list) => lead.list_ids.includes(list.id))
  const services = stored?.recommendedServices ?? []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">{lead.name}</h1>
          <p className="text-sm text-muted-foreground">
            {[lead.categoryLabel, cityState(lead.city, lead.state)].filter(Boolean).join(" · ") || "Location not available"}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <StageBadge stage={lead.pipeline_stage} />
            {isOutreachReady(lead) && <OutreachReadyBadge />}
            <FollowUpBadge followUpAt={lead.follow_up_at} note={lead.follow_up_note} />
            {lead.is_archived && (
              <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                <Archive aria-hidden /> Archived
              </Badge>
            )}
          </div>
        </div>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="shrink-0 self-start" disabled={actions.pending}>
              <MoreHorizontal /> Actions
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {lead.is_archived ? (
              <DropdownMenuItem onSelect={() => actions.update(ids, { archived: false })}>
                <ArchiveRestore /> Restore
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => actions.update(ids, { archived: true })}>
                <Archive /> Archive
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
              <Trash2 /> Delete permanently…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Pipeline panel: first on small screens, at the side on large ones */}
        <Card title="Pipeline" className="lg:sticky lg:top-20 lg:order-2">
          <div className="space-y-4">
            <Field label="Stage">
              <StageSelect value={lead.pipeline_stage} onChange={(stage) => actions.update(ids, { stage })} label="Pipeline stage" />
              {stageHint && (
                <Suggestion
                  text={`Contact and analysis are in place. Suggested: ${STAGE_LABELS[stageHint]}.`}
                  onApply={() => actions.update(ids, { stage: stageHint })}
                />
              )}
            </Field>
            <Field label="Priority">
              <PrioritySelect value={lead.priority} onChange={(priority) => actions.update(ids, { priority })} label="Priority" />
              {priorityHint && (
                <Suggestion
                  text={`Qualified Lead Score ${lead.qualified_lead_score}. Suggested: ${PRIORITY_LABELS[priorityHint]}.`}
                  onApply={() => actions.update(ids, { priority: priorityHint })}
                />
              )}
            </Field>
            <Field label="Contact status">
              <Select
                value={lead.contact_status}
                onValueChange={(next) => actions.update(ids, { contactStatus: next as ContactStatus })}
              >
                <SelectTrigger aria-label="Contact status" className="h-8 w-full px-2.5 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTACT_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {CONTACT_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Assigned to">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className={cn(!lead.assigned_to && "text-muted-foreground/70")}>
                  {lead.assigned_to ? (lead.assigned_to === user.id ? `${user.name} (you)` : "Another user") : "Unassigned"}
                </span>
                <Button variant="outline" size="sm" onClick={() => actions.update(ids, { assignToMe: !lead.assigned_to })}>
                  {lead.assigned_to ? "Unassign" : "Assign to me"}
                </Button>
              </div>
            </Field>
            <Field label="Follow-up">
              <div className="flex items-start justify-between gap-2 text-sm">
                <div className="min-w-0">
                  {lead.follow_up_at ? (
                    <>
                      <p>{mounted ? formatFollowUp(lead.follow_up_at) : "…"}</p>
                      {lead.follow_up_note && <p className="text-xs text-pretty text-muted-foreground">{lead.follow_up_note}</p>}
                    </>
                  ) : (
                    <span className="text-muted-foreground/70">No follow-up set</span>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={() => setFollowUpOpen(true)}>
                  <CalendarClock /> {lead.follow_up_at ? "Change" : "Set"}
                </Button>
              </div>
            </Field>
            <Field label="Tags">
              {appliedTags.length === 0 ? (
                <p className="text-sm text-muted-foreground/70">No tags</p>
              ) : (
                <ul className="flex flex-wrap gap-1">
                  {appliedTags.map((tag) => (
                    <li key={tag.id}>
                      <Badge variant="secondary" className="gap-1 pr-1 font-normal">
                        {tag.name}
                        <button
                          type="button"
                          aria-label={`Remove tag ${tag.name}`}
                          onClick={() => actions.removeTag(tag, ids)}
                          className="rounded-full p-0.5 opacity-60 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <X className="size-3" />
                        </button>
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Field>
            <Field label="Lists">
              {inLists.length === 0 ? (
                <p className="text-sm text-muted-foreground/70">Not in any list</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {inLists.map((list) => (
                    <li key={list.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{list.name}</span>
                      <button
                        type="button"
                        aria-label={`Remove from ${list.name}`}
                        onClick={() => actions.removeFromList(list, ids)}
                        className="rounded-full p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Field>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="w-full">
                  <Tags /> Edit tags and lists
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <MembershipMenus
                  tags={tags}
                  lists={lists}
                  tagIds={lead.tag_ids}
                  listIds={lead.list_ids}
                  onToggleTag={(tag, on) => (on ? actions.addTag(tag, ids) : actions.removeTag(tag, ids))}
                  onToggleList={(list, on) => (on ? actions.addToList(list, ids) : actions.removeFromList(list, ids))}
                  onNewTag={() => setNamePrompt("tag")}
                  onNewList={() => setNamePrompt("list")}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Card>

        <div className="space-y-6 lg:order-1">
          <Card title="Business">
            <dl className="divide-y">
              <Row label="Category">{lead.categoryLabel}</Row>
              <Row label="Location">{lead.address ?? cityState(lead.city, lead.state) ?? <Missing />}</Row>
              <Row label="Website">
                <WebsiteLink url={lead.website} className="max-w-full" />
              </Row>
              <Row label="Business phone">
                <PhoneLink phone={lead.phone} />
              </Row>
              <Row label="Rating">
                <span className="text-muted-foreground/70">Not available (OpenStreetMap has no ratings)</span>
              </Row>
              <Row label="Reviews">
                <span className="text-muted-foreground/70">Not available</span>
              </Row>
              <Row label="Saved on">{dateFormat.format(new Date(lead.created_at))}</Row>
            </dl>
          </Card>

          <Card title="Contact and intelligence">
            <div className="space-y-6">
              <EnrichmentSections
                prospect={lead.prospect}
                status={enrichment.statusOf(lead.osm_id)}
                enrichment={contact}
                failure={enrichment.failures.get(lead.osm_id)}
                verifying={enrichment.activity.get(lead.osm_id) === "verifying"}
                onEnrich={enrich}
                onVerify={verify}
              />
              <AnalysisSummarySection
                analysis={stored}
                activity={analysis.activity.get(lead.osm_id)}
                failure={analysis.failures.get(lead.osm_id)}
                onAnalyze={() => analyze()}
                onView={() => setReportOpen(true)}
              />
            </div>
          </Card>

          <Card title="Recommended services">
            {services.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {stored
                  ? "No service is recommended: there isn't enough observed evidence to justify one."
                  : "Analyze this business to see which services its website evidence supports."}
              </p>
            ) : (
              <ul className="space-y-2.5">
                {services.map((service) => (
                  <li key={service.service} className="rounded-lg border p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">{service.label}</p>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide uppercase",
                          PRIORITY_STYLES[service.priority]
                        )}
                      >
                        {service.priority} priority
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm text-pretty text-muted-foreground">{service.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Notes">
            <LeadNotes leadId={lead.id} notes={notes} author={user.name} />
          </Card>

          <Card title="History">
            <LeadHistory activity={activity} />
          </Card>
        </div>
      </div>

      <AnalysisReportSheet
        analysis={reportOpen ? (stored ?? null) : null}
        enrichment={contact}
        prospect={lead.prospect}
        activity={analysis.activity.get(lead.osm_id)}
        onReanalyze={() => analyze(true)}
        onOpenChange={(open) => !open && setReportOpen(false)}
      />

      <FollowUpDialog
        target={followUpOpen ? { count: 1, name: lead.name, followUpAt: lead.follow_up_at, note: lead.follow_up_note } : null}
        onOpenChange={(open) => !open && setFollowUpOpen(false)}
        onSave={(followUpAt, note) => actions.update(ids, { followUpAt, followUpNote: note }, { announce: true })}
      />

      <NameDialog
        open={namePrompt === "list"}
        onOpenChange={(open) => !open && setNamePrompt(null)}
        title="New list"
        description="This lead will be added to it."
        label="List name"
        placeholder="e.g. Website Redesign Prospects"
        maxLength={limits.listName}
        submitLabel="Create List"
        onSubmit={(name) => actions.createList(name, ids)}
      />
      <NameDialog
        open={namePrompt === "tag"}
        onOpenChange={(open) => !open && setNamePrompt(null)}
        title="New tag"
        description="It will be applied to this lead."
        label="Tag name"
        placeholder="e.g. Local SEO"
        maxLength={limits.tagName}
        submitLabel="Add Tag"
        onSubmit={(name) => actions.createTag(name, ids)}
      />

      <AlertDialog open={confirmDelete} onOpenChange={(open) => !open && !actions.pending && setConfirmDelete(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete {lead.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the lead with its notes, tags, list memberships and history, and can&apos;t be
              undone. To just hide it, archive it instead. Its decision-maker data and analysis stay in
              your saved data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actions.pending}>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={remove} disabled={actions.pending}>
              {actions.pending && <Loader2 className="animate-spin" aria-hidden />}
              {actions.pending ? "Deleting..." : "Delete permanently"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
