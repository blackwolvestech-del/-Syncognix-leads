"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  ExternalLink,
  FileSearch,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  Trash2,
  UserRoundCheck,
  UserRoundSearch,
  UserRoundX,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { AnalysisCell } from "@/components/analysis/analysis-cell"
import { AnalysisReportSheet } from "@/components/analysis/analysis-report-sheet"
import { useAnalysis } from "@/components/analysis/use-analysis"
import { ConfirmActionDialog } from "@/components/enrichment/confirm-action-dialog"
import { DecisionMakerCell, EmailLink, personName } from "@/components/enrichment/decision-maker"
import { ScoreBadge } from "@/components/enrichment/prospect-score"
import { useEnrichment } from "@/components/enrichment/use-enrichment"
import { BulkActions } from "@/components/pipeline/bulk-actions"
import { FollowUpDialog, NameDialog } from "@/components/pipeline/dialogs"
import { exportLeads } from "@/components/pipeline/export"
import {
  FollowUpButton,
  OutreachReadyBadge,
  PrioritySelect,
  StageSelect,
  TagChips,
} from "@/components/pipeline/fields"
import { MembershipMenus } from "@/components/pipeline/membership-menu"
import { useLeadActions } from "@/components/pipeline/use-lead-actions"
import { PIPELINE_CONFIG, isOutreachReady } from "@/lib/pipeline/config"
import { cn } from "@/lib/utils"
import type { LeadOverviewRow } from "@/types"
import type { BusinessAnalysis } from "@/types/analysis"
import type { BusinessSearchResult } from "@/types/business"
import type { LeadEnrichment, ProspectScore } from "@/types/enrichment"
import type { LeadList, LeadTag } from "@/types/pipeline"
import { PhoneLink, cityState } from "./business-cells"

export type LeadRow = LeadOverviewRow & { categoryLabel: string; prospect: ProspectScore }

const COLUMNS = ["Business", "Decision Maker", "Scores", "Stage", "Priority", "Follow-Up", "Tags & Lists"]

const { limits } = PIPELINE_CONFIG

/** A saved lead in the shape the enrichment and analysis endpoints expect. */
export function toBusiness(lead: LeadOverviewRow): BusinessSearchResult {
  return {
    osmId: lead.osm_id,
    osmType: lead.osm_type,
    name: lead.name,
    website: lead.website,
    phone: lead.phone,
    street: lead.street,
    city: lead.city,
    state: lead.state,
    postcode: lead.postcode,
    address: lead.address,
    category: lead.category,
    latitude: lead.latitude,
    longitude: lead.longitude,
    chain: lead.is_chain === true,
    country: "United States",
    countryCode: "US",
  }
}

type NamePrompt = { kind: "list" | "tag"; ids: string[] }
type FollowUpTarget = { ids: string[]; name?: string; followUpAt: string | null; note: string | null }

/** Saved leads as a table (cards on small screens), with pipeline fields and bulk actions. */
export function LeadsTable({
  leads: serverLeads,
  enrichments: initialEnrichments,
  analyses: initialAnalyses,
  lists,
  tags,
  currentUserId,
  showingArchived,
}: {
  leads: LeadRow[]
  enrichments: LeadEnrichment[]
  analyses: BusinessAnalysis[]
  lists: LeadList[]
  tags: LeadTag[]
  currentUserId: string
  /** True when the view includes archived leads (offers Restore). */
  showingArchived: boolean
}) {
  const router = useRouter()
  const [reportId, setReportId] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [deleting, setDeleting] = useState<LeadRow[] | null>(null)
  const [archiving, setArchiving] = useState<LeadRow[] | null>(null)
  const [confirmAnalyze, setConfirmAnalyze] = useState<LeadRow[] | null>(null)
  const [namePrompt, setNamePrompt] = useState<NamePrompt | null>(null)
  const [followUp, setFollowUp] = useState<FollowUpTarget | null>(null)

  const actions = useLeadActions(serverLeads, currentUserId)
  const { rows: leads, pending } = actions
  const enrichment = useEnrichment(initialEnrichments)
  const { enrichments, activity, failures, statusOf } = enrichment
  const analysis = useAnalysis(initialAnalyses)
  const { analyses } = analysis

  const reporting = reportId ? leads.find((lead) => lead.id === reportId) ?? null : null
  // Only leads still on this page count: removed ones drop out of the selection.
  const selectedLeads = leads.filter((lead) => selected.has(lead.id))
  const selectedIds = selectedLeads.map((lead) => lead.id)
  const allSelected = leads.length > 0 && selectedLeads.length === leads.length
  const selectAllState = allSelected ? true : selectedLeads.length > 0 ? "indeterminate" : false
  const notAnalyzed = leads.filter((lead) => !analyses.has(lead.osm_id) && !analysis.activity.has(lead.osm_id))
  const busy = pending || analysis.bulk !== null

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // New contact or analysis data changes scores and outreach-readiness, which
  // are read from the server: re-qualify the stored analysis, then reload.
  async function enrich(lead: LeadRow) {
    await enrichment.enrich(toBusiness(lead))
    if (analyses.has(lead.osm_id)) await analysis.refresh([toBusiness(lead)])
    router.refresh()
  }
  async function verify(lead: LeadRow) {
    await enrichment.verify(lead.osm_id)
    if (analyses.has(lead.osm_id)) await analysis.refresh([toBusiness(lead)])
    router.refresh()
  }
  async function analyze(lead: LeadRow, reanalyze = false) {
    await analysis.analyze(toBusiness(lead), { reanalyze })
    router.refresh()
  }
  async function analyzeMany(targets: LeadRow[]) {
    await analysis.analyzeMany(targets.map(toBusiness))
    router.refresh()
  }

  async function confirmDelete() {
    if (!deleting) return
    const ids = deleting.map((lead) => lead.id)
    if (await actions.remove(ids)) {
      setDeleting(null)
      setSelected((current) => new Set([...current].filter((id) => !ids.includes(id))))
      if (reportId && ids.includes(reportId)) setReportId(null)
    }
  }

  async function archive(targets: LeadRow[], archived: boolean) {
    const ids = targets.map((lead) => lead.id)
    if (await actions.update(ids, { archived })) {
      setSelected((current) => new Set([...current].filter((id) => !ids.includes(id))))
    }
  }

  const decisionMaker = (lead: LeadRow) => {
    const status = statusOf(lead.osm_id)
    const leadEnrichment = enrichments.get(lead.osm_id)
    if (status === "enriched" || status === "partial") {
      return (
        <div className="min-w-40 space-y-0.5">
          <p className="font-medium text-foreground">{personName(leadEnrichment) ?? "Name not available"}</p>
          {leadEnrichment?.person?.title && (
            <p className="text-xs text-muted-foreground">{leadEnrichment.person.title}</p>
          )}
          {leadEnrichment?.email ? (
            <EmailLink address={leadEnrichment.email.address} className="max-w-56 text-[13px]" />
          ) : (
            <p className="text-xs text-muted-foreground/70">No email found</p>
          )}
        </div>
      )
    }
    return (
      <DecisionMakerCell
        status={status}
        enrichment={leadEnrichment}
        failure={failures.get(lead.osm_id)}
        verifying={activity.get(lead.osm_id) === "verifying"}
        onEnrich={() => enrich(lead)}
        onVerify={() => verify(lead)}
        businessName={lead.name}
      />
    )
  }

  const scores = (lead: LeadRow) => (
    <div className="flex items-start gap-3">
      <div className="space-y-1">
        <p className="text-[11px] text-muted-foreground">Prospect</p>
        <ScoreBadge prospect={lead.prospect} />
      </div>
      <div className="space-y-1">
        <p className="text-[11px] text-muted-foreground">Qualified lead</p>
        <AnalysisCell
          analysis={analyses.get(lead.osm_id)}
          activity={analysis.activity.get(lead.osm_id)}
          failure={analysis.failures.get(lead.osm_id)}
          disabled={analysis.bulk !== null}
          onAnalyze={() => analyze(lead)}
          onView={() => setReportId(lead.id)}
          businessName={lead.name}
        />
      </div>
    </div>
  )

  const stage = (lead: LeadRow) => (
    <StageSelect
      value={lead.pipeline_stage}
      onChange={(next) => actions.update([lead.id], { stage: next })}
      label={`Stage for ${lead.name}`}
    />
  )

  const priority = (lead: LeadRow) => (
    <PrioritySelect
      value={lead.priority}
      onChange={(next) => actions.update([lead.id], { priority: next })}
      label={`Priority for ${lead.name}`}
    />
  )

  const followUpCell = (lead: LeadRow) => (
    <FollowUpButton
      followUpAt={lead.follow_up_at}
      note={lead.follow_up_note}
      businessName={lead.name}
      onClick={() => setFollowUp({ ids: [lead.id], name: lead.name, followUpAt: lead.follow_up_at, note: lead.follow_up_note })}
    />
  )

  const membership = (lead: LeadRow) => {
    const inLists = lists.filter((list) => lead.list_ids.includes(list.id))
    if (lead.tag_ids.length === 0 && inLists.length === 0) return <span className="text-muted-foreground/70">—</span>
    return (
      <div className="max-w-52 space-y-1">
        <TagChips tagIds={lead.tag_ids} tags={tags} />
        {inLists.length > 0 && (
          <p className="truncate text-xs text-muted-foreground" title={inLists.map((list) => list.name).join(", ")}>
            {inLists.length === 1 ? inLists[0].name : `${inLists[0].name} +${inLists.length - 1}`}
          </p>
        )}
      </div>
    )
  }

  const badges = (lead: LeadRow) =>
    (isOutreachReady(lead) || lead.is_archived) && (
      <span className="mt-1 flex flex-wrap gap-1">
        {isOutreachReady(lead) && <OutreachReadyBadge />}
        {lead.is_archived && (
          <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
            <Archive aria-hidden /> Archived
          </Badge>
        )}
      </span>
    )

  const rowMenu = (lead: LeadRow) => {
    const status = statusOf(lead.osm_id)
    const leadEnrichment = enrichments.get(lead.osm_id)
    const analyzed = analyses.has(lead.osm_id)
    const analyzing = analysis.activity.has(lead.osm_id) || analysis.bulk !== null
    return (
      // Non-modal so a dialog opened from an item gets focus cleanly.
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${lead.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem asChild>
            <Link href={`/leads/${lead.id}`}>
              <ExternalLink /> Open lead
            </Link>
          </DropdownMenuItem>
          {analyzed ? (
            <>
              <DropdownMenuItem onSelect={() => setReportId(lead.id)}>
                <FileSearch /> View analysis
              </DropdownMenuItem>
              <DropdownMenuItem disabled={analyzing} onSelect={() => analyze(lead, true)}>
                <RefreshCw /> Reanalyze
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem disabled={analyzing} onSelect={() => analyze(lead)}>
              <ScanSearch /> Analyze business
            </DropdownMenuItem>
          )}
          {(status === "not_enriched" || status === "failed") && (
            <DropdownMenuItem onSelect={() => enrich(lead)}>
              <UserRoundSearch /> Find decision maker
            </DropdownMenuItem>
          )}
          {leadEnrichment?.email && !leadEnrichment.verification && (
            <DropdownMenuItem disabled={activity.get(lead.osm_id) === "verifying"} onSelect={() => verify(lead)}>
              <ShieldCheck /> Verify email
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <MembershipMenus
            tags={tags}
            lists={lists}
            tagIds={lead.tag_ids}
            listIds={lead.list_ids}
            onToggleTag={(tag, on) => (on ? actions.addTag(tag, [lead.id]) : actions.removeTag(tag, [lead.id]))}
            onToggleList={(list, on) => (on ? actions.addToList(list, [lead.id]) : actions.removeFromList(list, [lead.id]))}
            onNewTag={() => setNamePrompt({ kind: "tag", ids: [lead.id] })}
            onNewList={() => setNamePrompt({ kind: "list", ids: [lead.id] })}
          />
          <DropdownMenuItem
            onSelect={() => setFollowUp({ ids: [lead.id], name: lead.name, followUpAt: lead.follow_up_at, note: lead.follow_up_note })}
          >
            <CalendarClock /> {lead.follow_up_at ? "Change follow-up…" : "Set follow-up…"}
          </DropdownMenuItem>
          {lead.assigned_to ? (
            <DropdownMenuItem onSelect={() => actions.update([lead.id], { assignToMe: false }, { announce: true })}>
              <UserRoundX /> Unassign
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => actions.update([lead.id], { assignToMe: true }, { announce: true })}>
              <UserRoundCheck /> Assign to me
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {lead.is_archived ? (
            <DropdownMenuItem onSelect={() => archive([lead], false)}>
              <ArchiveRestore /> Restore
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => archive([lead], true)}>
              <Archive /> Archive
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting([lead])}>
            <Trash2 /> Delete permanently…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const nameLink = (lead: LeadRow, className?: string) => (
    <Link
      href={`/leads/${lead.id}`}
      className={cn(
        "rounded-sm font-medium text-foreground outline-none hover:underline hover:underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className
      )}
    >
      {lead.name}
    </Link>
  )

  return (
    <>
      {/* Selection actions, or bulk analysis for this page */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-4 py-2.5 text-[13px] text-muted-foreground sm:px-5">
        {analysis.bulk ? (
          <div className="w-full" role="status" aria-live="polite">
            <div className="flex flex-wrap items-center gap-2">
              <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
              <span className="font-medium text-foreground">Analyzing businesses...</span>
              <span className="ml-auto tabular-nums">
                {analysis.bulk.done} of {analysis.bulk.total} businesses analyzed
              </span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${(analysis.bulk.done / analysis.bulk.total) * 100}%` }}
              />
            </div>
          </div>
        ) : selectedLeads.length > 0 ? (
          <BulkActions
            count={selectedLeads.length}
            disabled={busy}
            lists={lists}
            tags={tags}
            selectedTagIds={new Set(selectedLeads.flatMap((lead) => lead.tag_ids))}
            unanalyzedCount={selectedLeads.filter((lead) => !analyses.has(lead.osm_id)).length}
            showingArchived={showingArchived && selectedLeads.every((lead) => lead.is_archived)}
            onClear={() => setSelected(new Set())}
            onStage={(next) => actions.update(selectedIds, { stage: next }, { announce: true })}
            onPriority={(next) => actions.update(selectedIds, { priority: next }, { announce: true })}
            onAddToList={(list) => actions.addToList(list, selectedIds)}
            onNewList={() => setNamePrompt({ kind: "list", ids: selectedIds })}
            onAddTag={(tag) => actions.addTag(tag, selectedIds)}
            onNewTag={() => setNamePrompt({ kind: "tag", ids: selectedIds })}
            onRemoveTag={(tag) => actions.removeTag(tag, selectedIds)}
            onAssign={(toMe) => actions.update(selectedIds, { assignToMe: toMe }, { announce: true })}
            onFollowUp={() => setFollowUp({ ids: selectedIds, followUpAt: null, note: null })}
            onClearFollowUp={() => actions.update(selectedIds, { followUpAt: null }, { announce: true })}
            onAnalyze={() => setConfirmAnalyze(selectedLeads.filter((lead) => !analyses.has(lead.osm_id)))}
            onExport={() => exportLeads({ ids: selectedIds })}
            onArchive={() => setArchiving(selectedLeads)}
            onRestore={() => archive(selectedLeads, false)}
            onDelete={() => setDeleting(selectedLeads)}
          />
        ) : (
          <>
            <span className="flex items-center gap-3 tabular-nums">
              {/* The table header has its own select-all; this one serves the card layout. */}
              <span className="flex items-center gap-2 lg:hidden">
                <Checkbox
                  id="select-all-leads-mobile"
                  checked={selectAllState}
                  onCheckedChange={(checked) => setSelected(checked === true ? new Set(leads.map((lead) => lead.id)) : new Set())}
                />
                <label htmlFor="select-all-leads-mobile" className="cursor-pointer">
                  Select all
                </label>
                <span aria-hidden className="text-border">|</span>
              </span>
              {leads.length - notAnalyzed.length} of {leads.length} on this page analyzed
            </span>
            {notAnalyzed.length > 0 && (
              <Button variant="outline" size="sm" className="bg-background" onClick={() => setConfirmAnalyze(notAnalyzed)}>
                <ScanSearch /> Analyze Remaining ({notAnalyzed.length})
              </Button>
            )}
          </>
        )}
      </div>

      <div className="hidden lg:block">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-10 w-10 pr-0 pl-5">
                <Checkbox
                  aria-label="Select all leads on this page"
                  checked={selectAllState}
                  onCheckedChange={(checked) => setSelected(checked === true ? new Set(leads.map((lead) => lead.id)) : new Set())}
                />
              </TableHead>
              {COLUMNS.map((column) => (
                <TableHead key={column} className="h-10 px-3 text-xs font-medium whitespace-nowrap text-muted-foreground">
                  {column}
                </TableHead>
              ))}
              <TableHead className="h-10 w-12 pr-5">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => (
              <TableRow
                key={lead.id}
                data-state={selected.has(lead.id) ? "selected" : undefined}
                className={cn(lead.is_archived && "opacity-70")}
              >
                <TableCell className="w-10 pr-0 pl-5 align-top">
                  <Checkbox
                    className="mt-0.5"
                    aria-label={`Select ${lead.name}`}
                    checked={selected.has(lead.id)}
                    onCheckedChange={(checked) => toggle(lead.id, checked === true)}
                  />
                </TableCell>
                <TableCell className="max-w-60 px-3 py-3 align-top whitespace-normal">
                  {nameLink(lead)}
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {[lead.categoryLabel, cityState(lead.city, lead.state)].filter(Boolean).join(" · ")}
                  </div>
                  {lead.phone && (
                    <div className="mt-1 text-xs">
                      <PhoneLink phone={lead.phone} />
                    </div>
                  )}
                  {badges(lead)}
                </TableCell>
                <TableCell className="px-3 py-3 align-top whitespace-normal">{decisionMaker(lead)}</TableCell>
                <TableCell className="px-3 py-3 align-top whitespace-normal">{scores(lead)}</TableCell>
                <TableCell className="px-3 py-2.5 align-top">{stage(lead)}</TableCell>
                <TableCell className="px-3 py-2.5 align-top">{priority(lead)}</TableCell>
                <TableCell className="px-3 py-3 align-top">{followUpCell(lead)}</TableCell>
                <TableCell className="px-3 py-3 align-top whitespace-normal">{membership(lead)}</TableCell>
                <TableCell className="px-3 py-2 pr-5 text-right align-top">{rowMenu(lead)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="divide-y lg:hidden">
        {leads.map((lead) => (
          <li key={lead.id} className={cn("flex gap-3 px-4 py-4", selected.has(lead.id) && "bg-muted/50")}>
            <Checkbox
              className="mt-1"
              aria-label={`Select ${lead.name}`}
              checked={selected.has(lead.id)}
              onCheckedChange={(checked) => toggle(lead.id, checked === true)}
            />
            <div className="min-w-0 flex-1 space-y-3">
              <div className="min-w-0">
                {nameLink(lead, "leading-snug")}
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {[lead.categoryLabel, cityState(lead.city, lead.state)].filter(Boolean).join(" · ") ||
                    "Location not available"}
                </div>
                {badges(lead)}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {stage(lead)}
                {priority(lead)}
              </div>
              <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
                <dt className="text-muted-foreground">Decision maker</dt>
                <dd className="min-w-0">{decisionMaker(lead)}</dd>
                <dt className="text-muted-foreground">Business phone</dt>
                <dd>
                  <PhoneLink phone={lead.phone} />
                </dd>
                <dt className="text-muted-foreground">Scores</dt>
                <dd className="min-w-0">{scores(lead)}</dd>
                <dt className="text-muted-foreground">Follow-up</dt>
                <dd>{followUpCell(lead)}</dd>
                <dt className="text-muted-foreground">Tags &amp; lists</dt>
                <dd className="min-w-0">{membership(lead)}</dd>
              </dl>
              <Button asChild variant="outline" size="sm">
                <Link href={`/leads/${lead.id}`}>Open Lead</Link>
              </Button>
            </div>
            <div className="-mr-1 shrink-0">{rowMenu(lead)}</div>
          </li>
        ))}
      </ul>

      <AnalysisReportSheet
        analysis={reporting ? analyses.get(reporting.osm_id) ?? null : null}
        enrichment={reporting ? enrichments.get(reporting.osm_id) : undefined}
        prospect={reporting?.prospect}
        activity={reporting ? analysis.activity.get(reporting.osm_id) : undefined}
        disabled={analysis.bulk !== null}
        onReanalyze={() => reporting && analyze(reporting, true)}
        onOpenChange={(open) => !open && setReportId(null)}
      />

      <FollowUpDialog
        target={followUp && { count: followUp.ids.length, name: followUp.name, followUpAt: followUp.followUpAt, note: followUp.note }}
        onOpenChange={(open) => !open && setFollowUp(null)}
        onSave={(followUpAt, note) =>
          followUp && actions.update(followUp.ids, { followUpAt, followUpNote: note }, { announce: true })
        }
      />

      <NameDialog
        open={namePrompt?.kind === "list"}
        onOpenChange={(open) => !open && setNamePrompt(null)}
        title="New list"
        description={namePrompt ? `${namePrompt.ids.length} ${namePrompt.ids.length === 1 ? "lead" : "leads"} will be added to it.` : undefined}
        label="List name"
        placeholder="e.g. Website Redesign Prospects"
        maxLength={limits.listName}
        submitLabel="Create List"
        onSubmit={(name) => actions.createList(name, namePrompt?.ids ?? [])}
      />
      <NameDialog
        open={namePrompt?.kind === "tag"}
        onOpenChange={(open) => !open && setNamePrompt(null)}
        title="New tag"
        description={namePrompt ? `It will be applied to ${namePrompt.ids.length} ${namePrompt.ids.length === 1 ? "lead" : "leads"}.` : undefined}
        label="Tag name"
        placeholder="e.g. Local SEO"
        maxLength={limits.tagName}
        submitLabel="Add Tag"
        onSubmit={(name) => actions.createTag(name, namePrompt?.ids ?? [])}
      />

      <ConfirmActionDialog
        open={confirmAnalyze !== null}
        onOpenChange={(open) => !open && setConfirmAnalyze(null)}
        title={`Analyze ${confirmAnalyze?.length ?? 0} ${confirmAnalyze?.length === 1 ? "Business" : "Businesses"}`}
        confirmLabel="Analyze"
        onConfirm={() => confirmAnalyze && analyzeMany(confirmAnalyze)}
      >
        <p>
          Each business&apos;s homepage is fetched once and checked for website, SEO and conversion
          fundamentals. Businesses without a website get a business-data analysis.
        </p>
        <p>Results are saved, so the same website isn&apos;t fetched again when you come back.</p>
        <p className="font-medium text-foreground">This is free and uses no provider credits.</p>
      </ConfirmActionDialog>

      <ConfirmActionDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={`Archive ${archiving?.length ?? 0} ${archiving?.length === 1 ? "lead" : "leads"}?`}
        confirmLabel="Archive"
        onConfirm={() => archiving && archive(archiving, true)}
      >
        <p>
          Archived leads are hidden from your lists, pipeline and counts. Nothing is deleted: their
          notes, tags, contact data and analysis are kept.
        </p>
        <p>You can restore them any time from Filters → Archived.</p>
      </ConfirmActionDialog>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && !pending && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleting?.length === 1
                ? `Permanently delete ${deleting[0].name}?`
                : `Permanently delete ${deleting?.length ?? 0} leads?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-pretty text-muted-foreground">
                {deleting && deleting.length > 1 && (
                  <p>
                    {deleting.slice(0, 5).map((lead) => lead.name).join(", ")}
                    {deleting.length > 5 && ` and ${deleting.length - 5} more`}.
                  </p>
                )}
                <p>
                  This removes {deleting?.length === 1 ? "the lead" : "these leads"} with{" "}
                  {deleting?.length === 1 ? "its" : "their"} notes, tags, list memberships and history, and
                  can&apos;t be undone. To just hide {deleting?.length === 1 ? "it" : "them"}, archive instead.
                </p>
                <p>
                  Decision-maker data and analyses stay in your saved data, so finding the business
                  again won&apos;t use credits.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={confirmDelete} disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {pending ? "Deleting..." : "Delete permanently"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
