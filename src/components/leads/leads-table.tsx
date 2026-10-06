"use client"

import { useState, useTransition } from "react"
import { Eye, Loader2, MoreHorizontal, ShieldCheck, Trash2, UserRoundSearch } from "lucide-react"
import { toast } from "sonner"
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
import {
  DecisionMakerCell,
  EmailLink,
  EnrichmentSections,
  personName,
} from "@/components/enrichment/decision-maker"
import {
  EnrichmentStatusBadge,
  NotVerifiedBadge,
  VerificationBadge,
} from "@/components/enrichment/enrichment-badges"
import { ScoreBadge } from "@/components/enrichment/prospect-score"
import { useEnrichment } from "@/components/enrichment/use-enrichment"
import { deleteLeadAction } from "@/lib/leads/actions"
import type { Lead } from "@/types"
import type { BusinessSearchResult } from "@/types/business"
import type { LeadEnrichment, ProspectScore } from "@/types/enrichment"
import { Missing, PhoneLink, cityState } from "./business-cells"
import { BusinessDetailsSheet, type BusinessDetails } from "./business-details-sheet"

export type LeadRow = Lead & { categoryLabel: string; prospect: ProspectScore }

const COLUMNS = ["Business", "Decision Maker", "Work Email", "Business Phone", "Score", "Added"]

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
})

function sourceLabel(source: string | undefined) {
  return !source || source === "openstreetmap" ? "OpenStreetMap" : source
}

function toDetails(lead: LeadRow): BusinessDetails {
  return {
    name: lead.name,
    categoryLabel: lead.categoryLabel,
    website: lead.website,
    phone: lead.phone,
    address: lead.address,
    street: lead.street,
    city: lead.city,
    state: lead.state,
    postcode: lead.postcode,
    latitude: lead.latitude,
    longitude: lead.longitude,
    osmId: lead.osm_id,
    osmType: lead.osm_type,
    source: sourceLabel(lead.source),
    addedAt: lead.created_at,
  }
}

/** A saved lead in the shape the enrichment endpoint expects. */
function toBusiness(lead: LeadRow): BusinessSearchResult {
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

/** Saved leads with their decision-maker data, plus view / enrich / verify / remove. */
export function LeadsTable({
  leads,
  enrichments: initialEnrichments,
}: {
  leads: LeadRow[]
  enrichments: LeadEnrichment[]
}) {
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [removing, setRemoving] = useState<LeadRow | null>(null)
  const [pending, startTransition] = useTransition()
  const { enrichments, activity, failures, statusOf, enrich, verify } = useEnrichment(initialEnrichments)

  const viewing = viewingId ? leads.find((lead) => lead.id === viewingId) ?? null : null

  function confirmRemove() {
    const lead = removing
    if (!lead) return
    startTransition(async () => {
      const result = await deleteLeadAction(lead.id).catch(() => null)
      if (!result?.ok) {
        toast.error(result?.message ?? "We couldn't remove this lead. Please try again.")
        return
      }
      setRemoving(null)
      if (viewingId === lead.id) setViewingId(null)
      toast.success(`Removed ${lead.name} from your saved leads.`)
    })
  }

  const decisionMakerProps = (lead: LeadRow) => ({
    status: statusOf(lead.osm_id),
    enrichment: enrichments.get(lead.osm_id),
    failure: failures.get(lead.osm_id),
    verifying: activity.get(lead.osm_id) === "verifying",
    onEnrich: () => enrich(toBusiness(lead)),
    onVerify: () => verify(lead.osm_id),
  })

  const actions = (lead: LeadRow) => {
    const status = statusOf(lead.osm_id)
    const enrichment = enrichments.get(lead.osm_id)
    return (
      // Non-modal so the confirm dialog it opens gets focus cleanly.
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${lead.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => setViewingId(lead.id)}>
            <Eye /> View details
          </DropdownMenuItem>
          {(status === "not_enriched" || status === "failed") && (
            <DropdownMenuItem onSelect={() => enrich(toBusiness(lead))}>
              <UserRoundSearch /> Find decision maker
            </DropdownMenuItem>
          )}
          {enrichment?.email && !enrichment.verification && (
            <DropdownMenuItem
              disabled={activity.get(lead.osm_id) === "verifying"}
              onSelect={() => verify(lead.osm_id)}
            >
              <ShieldCheck /> Verify email
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(lead)}>
            <Trash2 /> Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  /** Name + title, or the lookup state when there is nobody yet. */
  const decisionMaker = (lead: LeadRow) => {
    const props = decisionMakerProps(lead)
    const name = personName(props.enrichment)
    if (props.status === "enriched" || props.status === "partial") {
      return (
        <div className="min-w-36">
          <p className="font-medium text-foreground">{name ?? "Name not available"}</p>
          {props.enrichment?.person?.title && (
            <p className="text-xs text-muted-foreground">{props.enrichment.person.title}</p>
          )}
        </div>
      )
    }
    return <DecisionMakerCell {...props} businessName={lead.name} />
  }

  const workEmail = (lead: LeadRow) => {
    const { status, enrichment, verifying, onVerify } = decisionMakerProps(lead)
    if (!enrichment?.email) {
      return status === "partial" ? <EnrichmentStatusBadge status="partial" /> : <Missing />
    }
    return (
      <div className="space-y-1">
        <EmailLink address={enrichment.email.address} className="max-w-56 text-[13px]" />
        <div>
          {enrichment.verification ? (
            <VerificationBadge verification={enrichment.verification} />
          ) : verifying ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
              <Loader2 className="size-3 animate-spin" aria-hidden /> Verifying email...
            </span>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <NotVerifiedBadge />
              <Button
                variant="outline"
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                onClick={onVerify}
                aria-label={`Verify email for ${lead.name}`}
              >
                <ShieldCheck /> Verify Email
              </Button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="hidden lg:block">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              {COLUMNS.map((column) => (
                <TableHead
                  key={column}
                  className="h-10 px-4 text-xs font-medium whitespace-nowrap text-muted-foreground first:pl-5"
                >
                  {column}
                </TableHead>
              ))}
              <TableHead className="h-10 w-12 pr-5">
                <span className="sr-only">Action</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => (
              <TableRow key={lead.id}>
                <TableCell className="max-w-64 px-4 py-3 pl-5 align-top whitespace-normal">
                  <button
                    type="button"
                    onClick={() => setViewingId(lead.id)}
                    className="rounded-sm text-left font-medium text-foreground outline-none hover:underline hover:underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {lead.name}
                  </button>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {[lead.categoryLabel, cityState(lead.city, lead.state)].filter(Boolean).join(" · ")}
                  </div>
                </TableCell>
                <TableCell className="px-4 py-3 align-top whitespace-normal">{decisionMaker(lead)}</TableCell>
                <TableCell className="px-4 py-3 align-top">{workEmail(lead)}</TableCell>
                <TableCell className="px-4 py-3 align-top">
                  <PhoneLink phone={lead.phone} />
                </TableCell>
                <TableCell className="px-4 py-3 align-top">
                  <ScoreBadge prospect={lead.prospect} />
                </TableCell>
                <TableCell className="px-4 py-3 align-top whitespace-nowrap text-muted-foreground tabular-nums">
                  {dateFormat.format(new Date(lead.created_at))}
                </TableCell>
                <TableCell className="px-4 py-2 pr-5 text-right align-top">{actions(lead)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="divide-y lg:hidden">
        {leads.map((lead) => (
          <li key={lead.id} className="flex gap-3 px-4 py-4">
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setViewingId(lead.id)}
                    className="rounded-sm text-left leading-snug font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {lead.name}
                  </button>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {[lead.categoryLabel, cityState(lead.city, lead.state)].filter(Boolean).join(" · ") ||
                      "Location not available"}
                  </div>
                </div>
                <ScoreBadge prospect={lead.prospect} className="shrink-0" />
              </div>
              <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
                <dt className="text-muted-foreground">Decision maker</dt>
                <dd className="min-w-0">{decisionMaker(lead)}</dd>
                <dt className="text-muted-foreground">Work email</dt>
                <dd className="min-w-0">{workEmail(lead)}</dd>
                <dt className="text-muted-foreground">Business phone</dt>
                <dd>
                  <PhoneLink phone={lead.phone} />
                </dd>
                <dt className="text-muted-foreground">Added</dt>
                <dd className="text-muted-foreground tabular-nums">
                  {dateFormat.format(new Date(lead.created_at))}
                </dd>
              </dl>
            </div>
            <div className="-mr-1 shrink-0">{actions(lead)}</div>
          </li>
        ))}
      </ul>

      <BusinessDetailsSheet
        business={viewing ? toDetails(viewing) : null}
        onOpenChange={(open) => !open && setViewingId(null)}
        footer={
          viewing && (
            <Button variant="outline" onClick={() => setRemoving(viewing)} className="text-destructive hover:text-destructive">
              <Trash2 /> Remove from saved leads
            </Button>
          )
        }
      >
        {viewing && <EnrichmentSections prospect={viewing.prospect} {...decisionMakerProps(viewing)} />}
      </BusinessDetailsSheet>

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && !pending && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name} from your saved leads?</AlertDialogTitle>
            <AlertDialogDescription>
              You can save it again from a future search. Its decision-maker data stays in your
              saved data, so finding it again won&apos;t use credits.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={confirmRemove} disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {pending ? "Removing..." : "Remove"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
