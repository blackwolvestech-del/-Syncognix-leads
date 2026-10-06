"use client"

import { memo, useCallback, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { AnimatePresence } from "motion/react"
import * as m from "motion/react-m"
import {
  BookmarkCheck,
  BookmarkPlus,
  Eye,
  Loader2,
  Search,
  SearchX,
  ShieldCheck,
  TriangleAlert,
  UserRoundSearch,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ConfirmActionDialog } from "@/components/enrichment/confirm-action-dialog"
import {
  DecisionMakerCell,
  EnrichmentSections,
  type DecisionMakerProps,
} from "@/components/enrichment/decision-maker"
import { ScoreBadge, ScoreReasons, TierLabel } from "@/components/enrichment/prospect-score"
import { useEnrichment, type BulkProgress } from "@/components/enrichment/use-enrichment"
import { PhoneLink, WebsiteLink, cityState } from "@/components/leads/business-cells"
import {
  BusinessDetailsSheet,
  type BusinessDetails,
} from "@/components/leads/business-details-sheet"
import { EmptyState } from "@/components/shared/empty-state"
import { lowerFirst } from "@/lib/format"
import { cn } from "@/lib/utils"
import type {
  BusinessSearchResult,
  BusinessSearchSuccessResponse,
  CategoryOption,
  ScoredBusiness,
} from "@/types/business"
import type { EnrichmentStatus } from "@/types/enrichment"

type Presence = "any" | "has" | "missing"
type SortKey = "score-desc" | "score-asc" | "name" | "relevance"
type MinScore = "0" | "60" | "80"
type EnrichmentFilter = "all" | "not_enriched" | "enriched" | "partial" | "no_match"

// OpenStreetMap has no ratings or review counts, so there is nothing to sort by there.
const SORT_LABELS: Record<SortKey, string> = {
  "score-desc": "Highest prospect score",
  "score-asc": "Lowest prospect score",
  name: "Business name A–Z",
  relevance: "Closest to search area",
}

const ENRICHMENT_FILTER_LABELS: Record<EnrichmentFilter, string> = {
  all: "Any enrichment",
  not_enriched: "Not enriched",
  enriched: "Decision maker found",
  partial: "Partial contact data",
  no_match: "No match",
}

const SOURCE_LABEL = "OpenStreetMap"
const nameCollator = new Intl.Collator("en-US", { sensitivity: "base", numeric: true })

function matchesPresence(value: string | null, filter: Presence) {
  if (filter === "has") return Boolean(value)
  if (filter === "missing") return !value
  return true
}

/** "Dallas, Texas", or "New York, New York 10001" for ZIP searches. */
function searchAreaLabel(data: BusinessSearchSuccessResponse) {
  const { searchLocation, query } = data
  const area = cityState(searchLocation.city, searchLocation.state)
  if (!area) return query.location
  const zip = /^\d{5}/.exec(query.location.trim())?.[0]
  return zip ? `${area} ${zip}` : area
}

function toDetails(business: BusinessSearchResult, categoryLabel: string): BusinessDetails {
  return {
    name: business.name,
    categoryLabel,
    website: business.website,
    phone: business.phone,
    address: business.address,
    street: business.street,
    city: business.city,
    state: business.state,
    postcode: business.postcode,
    latitude: business.latitude,
    longitude: business.longitude,
    osmId: business.osmId,
    osmType: business.osmType,
    source: SOURCE_LABEL,
  }
}

export function ResultsView({
  data,
  categories,
  savedIds,
  onSave,
}: {
  data: BusinessSearchSuccessResponse
  categories: CategoryOption[]
  savedIds: ReadonlySet<string>
  onSave: (businesses: BusinessSearchResult[]) => Promise<boolean>
}) {
  const { businesses, meta } = data
  const [nameQuery, setNameQuery] = useState("")
  const [website, setWebsite] = useState<Presence>("any")
  const [phone, setPhone] = useState<Presence>("any")
  const [minScore, setMinScore] = useState<MinScore>("0")
  const [enrichmentFilter, setEnrichmentFilter] = useState<EnrichmentFilter>("all")
  const [sort, setSort] = useState<SortKey>("score-desc")
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [saving, setSaving] = useState<"selected" | "all" | "single" | null>(null)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<"enrich" | "verify" | null>(null)

  // Stored decision-maker data arrives with the search; lookups only start on click.
  const enrichment = useEnrichment(data.enrichments)
  const { enrichments, activity, failures, bulk, statusOf, enrich, verify } = enrichment

  const categoryLabels = useMemo(
    () => new Map(categories.map((c) => [c.id, c.label])),
    [categories]
  )
  const labelFor = useCallback(
    (id: string) => categoryLabels.get(id) ?? id,
    [categoryLabels]
  )
  const category = categories.find((c) => c.id === data.query.normalizedBusinessType)

  const visible = useMemo(() => {
    const query = nameQuery.trim().toLowerCase()
    const floor = Number(minScore)
    const list = businesses.filter((b) => {
      if (query && !b.name.toLowerCase().includes(query)) return false
      if (!matchesPresence(b.website, website) || !matchesPresence(b.phone, phone)) return false
      if (b.prospect.score < floor) return false
      if (enrichmentFilter === "all") return true
      const status = statusOf(b.osmId)
      // A failed or running lookup still counts as "not enriched".
      const bucket: EnrichmentStatus =
        status === "failed" || status === "enriching" ? "not_enriched" : status
      return bucket === enrichmentFilter
    })
    if (sort === "relevance") return list
    // Array.prototype.sort is stable, so ties keep the API's closest-first order.
    return [...list].sort((a, b) => {
      if (sort === "name") return nameCollator.compare(a.name, b.name)
      return sort === "score-desc"
        ? b.prospect.score - a.prospect.score
        : a.prospect.score - b.prospect.score
    })
  }, [businesses, nameQuery, website, phone, minScore, enrichmentFilter, sort, statusOf])

  const filtersActive =
    nameQuery.trim() !== "" ||
    website !== "any" ||
    phone !== "any" ||
    minScore !== "0" ||
    enrichmentFilter !== "all"
  const visibleSelected = visible.filter((b) => selected.has(b.osmId)).length
  const allVisibleSelected = visible.length > 0 && visibleSelected === visible.length
  const unsavedCount = businesses.filter((b) => !savedIds.has(b.osmId)).length

  // What the bulk actions would act on, from the current selection.
  const selectedBusinesses = businesses.filter((b) => selected.has(b.osmId))
  const toEnrich = selectedBusinesses.filter((b) => {
    const status = statusOf(b.osmId)
    return status === "not_enriched" || status === "failed"
  })
  const toVerify = selectedBusinesses.filter((b) => {
    const e = enrichments.get(b.osmId)
    return e?.email && !e.verification
  })

  const toggle = useCallback((osmId: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(osmId)
      else next.delete(osmId)
      return next
    })
  }, [])

  function toggleAllVisible(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      for (const b of visible) {
        if (checked) next.add(b.osmId)
        else next.delete(b.osmId)
      }
      return next
    })
  }

  function resetFilters() {
    setNameQuery("")
    setWebsite("any")
    setPhone("any")
    setMinScore("0")
    setEnrichmentFilter("all")
  }

  const save = useCallback(
    async (kind: "selected" | "all" | "single", list: BusinessSearchResult[]) => {
      if (list.length === 0) return
      setSaving(kind)
      const ok = await onSave(list)
      setSaving(null)
      if (ok && kind === "selected") setSelected(new Set())
    },
    [onSave]
  )

  const view = useCallback((business: BusinessSearchResult) => setViewingId(business.osmId), [])
  const saveOne = useCallback((business: BusinessSearchResult) => save("single", [business]), [save])

  const viewing = viewingId ? businesses.find((b) => b.osmId === viewingId) ?? null : null
  const busy = saving !== null || bulk !== null

  const rowProps = (business: ScoredBusiness) => ({
    business,
    categoryLabel: labelFor(business.category),
    checked: selected.has(business.osmId),
    saved: savedIds.has(business.osmId),
    status: statusOf(business.osmId),
    enrichment: enrichments.get(business.osmId),
    failure: failures.get(business.osmId),
    verifying: activity.get(business.osmId) === "verifying",
    disabled: bulk !== null,
    savingDisabled: busy,
    onToggle: toggle,
    onView: view,
    onSave: saveOne,
    onEnrich: enrich,
    onVerify: verify,
  })

  if (businesses.length === 0) {
    return (
      <>
        {meta.notice && <Notice text={meta.notice} />}
        <EmptyState
          icon={SearchX}
          title="No matching businesses were found in this area."
          description={`OpenStreetMap has no ${category ? lowerFirst(category.plural) : "matching businesses"} listed within ${Math.round(meta.radiusMeters / 1000)} km. Try a nearby larger city or a related business type.`}
          className="py-16"
        />
      </>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight tabular-nums">
            {businesses.length} {businesses.length === 1 ? "business" : "businesses"} found
          </h2>
          <p className="truncate text-sm text-muted-foreground">
            {category?.plural ?? "Businesses"} near {searchAreaLabel(data)}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>Search radius: {Math.round(meta.radiusMeters / 1000)} km</span>
            <span aria-hidden className="text-border">|</span>
            <span>Source: {SOURCE_LABEL}</span>
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => save("all", businesses)}
          disabled={busy || unsavedCount === 0}
          className="shrink-0"
        >
          {saving === "all" ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : unsavedCount === 0 ? (
            <BookmarkCheck />
          ) : (
            <BookmarkPlus />
          )}
          {saving === "all"
            ? "Saving..."
            : unsavedCount === 0
              ? "All saved"
              : `Save All (${businesses.length})`}
        </Button>
      </div>

      {meta.notice && <Notice text={meta.notice} />}

      {/* Filters */}
      <div className="flex flex-col gap-2.5 border-b bg-muted/20 px-5 py-3 xl:flex-row xl:items-center">
        <div className="relative xl:w-56 xl:shrink-0">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder="Search business name…"
            aria-label="Search business name"
            className="h-9 bg-background pl-9"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap xl:ml-auto">
          <FilterSelect
            label="Filter by prospect score"
            value={minScore}
            onChange={setMinScore}
            active={minScore !== "0"}
            options={{ "0": "Any score", "60": "Score 60+", "80": "Score 80+" }}
          />
          <FilterSelect
            label="Filter by website"
            value={website}
            onChange={setWebsite}
            active={website !== "any"}
            options={{ any: "Any website", has: "Has website", missing: "Missing website" }}
          />
          <FilterSelect
            label="Filter by phone"
            value={phone}
            onChange={setPhone}
            active={phone !== "any"}
            options={{ any: "Any phone", has: "Has phone", missing: "Missing phone" }}
          />
          <FilterSelect
            label="Filter by enrichment status"
            value={enrichmentFilter}
            onChange={setEnrichmentFilter}
            active={enrichmentFilter !== "all"}
            options={ENRICHMENT_FILTER_LABELS}
            className="sm:w-48"
          />
          <FilterSelect
            label="Sort results"
            value={sort}
            onChange={setSort}
            active={false}
            options={SORT_LABELS}
            className="col-span-2 sm:w-52"
            align="end"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No businesses match these filters."
          description="Try clearing a filter to see more of your results."
          className="py-14"
          action={
            <Button variant="outline" size="sm" onClick={resetFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          {/* Select-all row for the card layout */}
          <div className="flex items-center gap-3 border-b px-5 py-2.5 text-[13px] text-muted-foreground lg:hidden">
            <Checkbox
              id="select-all-mobile"
              checked={allVisibleSelected ? true : visibleSelected > 0 ? "indeterminate" : false}
              onCheckedChange={(c) => toggleAllVisible(c === true)}
            />
            <label htmlFor="select-all-mobile" className="cursor-pointer">
              Select all{filtersActive ? " shown" : ""} ({visible.length})
            </label>
          </div>

          {/* Desktop table */}
          <div className="hidden lg:block">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-10 w-10 pr-0 pl-5">
                    <Checkbox
                      aria-label={`Select all${filtersActive ? " shown" : ""} businesses`}
                      checked={allVisibleSelected ? true : visibleSelected > 0 ? "indeterminate" : false}
                      onCheckedChange={(c) => toggleAllVisible(c === true)}
                    />
                  </TableHead>
                  {["Business", "Prospect Score", "Contact", "Decision Maker"].map((column) => (
                    <TableHead
                      key={column}
                      className="h-10 px-4 text-xs font-medium whitespace-nowrap text-muted-foreground"
                    >
                      {column}
                    </TableHead>
                  ))}
                  <TableHead className="h-10 px-4 pr-5 text-right text-xs font-medium text-muted-foreground">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((business, index) => (
                  <ResultRow key={business.osmId} index={index} {...rowProps(business)} />
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile / tablet cards */}
          <ul className="divide-y lg:hidden">
            {visible.map((business, index) => (
              <ResultCard key={business.osmId} index={index} {...rowProps(business)} />
            ))}
          </ul>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {filtersActive
            ? `Showing ${visible.length} of ${businesses.length}`
            : meta.resultsBeforeLimit > businesses.length
              ? `Showing ${businesses.length} of ${meta.resultsBeforeLimit} found`
              : `Showing all ${businesses.length}`}
        </span>
        <span>Data © OpenStreetMap contributors</span>
      </div>

      <SelectionBar
        count={selected.size}
        enrichCount={toEnrich.length}
        verifyCount={toVerify.length}
        saving={saving === "selected"}
        busy={busy}
        bulk={bulk}
        onClear={() => setSelected(new Set())}
        onEnrich={() => setConfirm("enrich")}
        onVerify={() => setConfirm("verify")}
        onSave={() => save("selected", selectedBusinesses)}
      />

      <ConfirmActionDialog
        open={confirm === "enrich"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Find Decision Makers"
        confirmLabel="Continue"
        onConfirm={() => enrichment.enrichMany(toEnrich)}
      >
        <p>
          You selected {toEnrich.length} {toEnrich.length === 1 ? "business" : "businesses"} without
          decision-maker data.
        </p>
        <p>Prospeo will be used to search for decision makers and professional emails.</p>
        <p>
          Results are stored, so the same business is never looked up twice. Businesses you have
          already looked up are loaded from your saved data.
        </p>
        <p className="font-medium text-foreground">This action may use Prospeo free credits.</p>
      </ConfirmActionDialog>

      <ConfirmActionDialog
        open={confirm === "verify"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Verify ${toVerify.length} ${toVerify.length === 1 ? "Email" : "Emails"}`}
        confirmLabel="Verify"
        onConfirm={() => enrichment.verifyMany(toVerify.map((b) => b.osmId))}
      >
        <p>Hunter will verify the selected email addresses.</p>
        <p>Emails that were already verified are not checked again.</p>
        <p className="font-medium text-foreground">This action may consume Hunter free credits.</p>
      </ConfirmActionDialog>

      <BusinessDetailsSheet
        business={viewing ? toDetails(viewing, labelFor(viewing.category)) : null}
        onOpenChange={(open) => !open && setViewingId(null)}
        footer={
          viewing &&
          (savedIds.has(viewing.osmId) ? (
            <Button variant="outline" asChild>
              <Link href="/leads">
                <BookmarkCheck /> Saved — View Leads
              </Link>
            </Button>
          ) : (
            <Button onClick={() => save("single", [viewing])} disabled={busy}>
              {saving === "single" ? <Loader2 className="animate-spin" aria-hidden /> : <BookmarkPlus />}
              {saving === "single" ? "Saving..." : "Save Lead"}
            </Button>
          ))
        }
      >
        {viewing && (
          <EnrichmentSections
            prospect={viewing.prospect}
            status={statusOf(viewing.osmId)}
            enrichment={enrichments.get(viewing.osmId)}
            failure={failures.get(viewing.osmId)}
            verifying={activity.get(viewing.osmId) === "verifying"}
            disabled={bulk !== null}
            onEnrich={() => enrich(viewing)}
            onVerify={() => verify(viewing.osmId)}
          />
        )}
      </BusinessDetailsSheet>
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return (
    <div role="status" className="flex items-start gap-2.5 border-b bg-warning/10 px-5 py-3 text-sm">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <p className="leading-snug">{text}</p>
    </div>
  )
}

function FilterSelect<T extends string>({
  label,
  value,
  onChange,
  options,
  active,
  className,
  align,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  options: Record<T, string>
  active: boolean
  className?: string
  align?: "start" | "end"
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger
        aria-label={label}
        className={cn("w-full bg-background sm:w-40", active && "border-primary/40", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align={align}>
        {(Object.keys(options) as T[]).map((key) => (
          <SelectItem key={key} value={key}>
            {options[key]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Small entrance stagger, capped so long lists don't wait. */
function rowEnter(index: number): React.CSSProperties {
  return { animationDelay: `${Math.min(index, 12) * 18}ms` }
}

const ROW_ENTER =
  "animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-200 ease-out"

type RowProps = Omit<DecisionMakerProps, "onEnrich" | "onVerify"> & {
  business: ScoredBusiness
  index: number
  categoryLabel: string
  checked: boolean
  saved: boolean
  savingDisabled: boolean
  onToggle: (osmId: string, checked: boolean) => void
  onView: (business: BusinessSearchResult) => void
  onSave: (business: BusinessSearchResult) => void
  onEnrich: (business: BusinessSearchResult) => void
  onVerify: (osmId: string) => void
}

function SavedBadge() {
  return (
    <Badge variant="outline" className="gap-1 border-success/30 bg-success/8 font-normal text-success">
      <BookmarkCheck aria-hidden /> Saved
    </Badge>
  )
}

function IconAction({
  label,
  tooltip,
  onClick,
  disabled,
  children,
}: {
  /** Full accessible name, e.g. "View details for ABC Roofing". */
  label: string
  tooltip: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" onClick={onClick} disabled={disabled} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

const ResultRow = memo(function ResultRow({
  business,
  index,
  categoryLabel,
  checked,
  saved,
  savingDisabled,
  onToggle,
  onView,
  onSave,
  onEnrich,
  onVerify,
  ...decisionMaker
}: RowProps) {
  const place = cityState(business.city, business.state)
  return (
    <TableRow
      data-state={checked ? "selected" : undefined}
      className={ROW_ENTER}
      style={rowEnter(index)}
    >
      <TableCell className="w-10 pr-0 pl-5 align-top">
        <Checkbox
          className="mt-0.5"
          aria-label={`Select ${business.name}`}
          checked={checked}
          onCheckedChange={(c) => onToggle(business.osmId, c === true)}
        />
      </TableCell>
      <TableCell className="max-w-72 px-4 py-3 align-top whitespace-normal">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-foreground">{business.name}</span>
          {saved && <SavedBadge />}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {[categoryLabel, place].filter(Boolean).join(" · ")}
        </div>
        {business.address && (
          <div title={business.address} className="mt-0.5 truncate text-xs text-muted-foreground/80">
            {business.address}
          </div>
        )}
      </TableCell>
      <TableCell className="px-4 py-3 align-top">
        <div className="flex items-center gap-2">
          <ScoreBadge prospect={business.prospect} />
          <span className="text-xs text-muted-foreground tabular-nums">/ 100</span>
        </div>
        <TierLabel score={business.prospect.score} className="mt-1 block" />
      </TableCell>
      <TableCell className="px-4 py-3 align-top">
        <div className="space-y-1">
          <div>
            <WebsiteLink url={business.website} />
          </div>
          <div>
            <PhoneLink phone={business.phone} />
          </div>
        </div>
      </TableCell>
      <TableCell className="px-4 py-3 align-top whitespace-normal">
        <DecisionMakerCell
          {...decisionMaker}
          businessName={business.name}
          onEnrich={() => onEnrich(business)}
          onVerify={() => onVerify(business.osmId)}
        />
      </TableCell>
      <TableCell className="px-4 py-2 pr-5 align-top">
        <div className="flex justify-end gap-0.5">
          <IconAction
            label={`View details for ${business.name}`}
            tooltip="View details"
            onClick={() => onView(business)}
          >
            <Eye />
          </IconAction>
          {saved ? (
            <span className="grid size-8 place-items-center text-success" title="Saved to your leads">
              <BookmarkCheck className="size-4" aria-hidden />
              <span className="sr-only">Saved to your leads</span>
            </span>
          ) : (
            <IconAction
              label={`Save ${business.name} as a lead`}
              tooltip="Save lead"
              onClick={() => onSave(business)}
              disabled={savingDisabled}
            >
              <BookmarkPlus />
            </IconAction>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
})

const ResultCard = memo(function ResultCard({
  business,
  index,
  categoryLabel,
  checked,
  saved,
  savingDisabled,
  onToggle,
  onView,
  onSave,
  onEnrich,
  onVerify,
  ...decisionMaker
}: RowProps) {
  const checkboxId = `select-${business.osmId}`
  const place = cityState(business.city, business.state)
  return (
    <li
      className={cn("flex gap-3 px-5 py-4", ROW_ENTER, checked && "bg-muted/50")}
      style={rowEnter(index)}
    >
      <Checkbox
        id={checkboxId}
        className="mt-1"
        checked={checked}
        onCheckedChange={(c) => onToggle(business.osmId, c === true)}
      />
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <label htmlFor={checkboxId} className="block cursor-pointer leading-snug font-medium">
              {business.name}
            </label>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {[categoryLabel, place].filter(Boolean).join(" · ") || "Location not available"}
              {saved && <SavedBadge />}
            </div>
            {business.address && (
              <div className="mt-0.5 text-xs text-muted-foreground/80">{business.address}</div>
            )}
          </div>
          <div className="shrink-0 text-right">
            <ScoreBadge prospect={business.prospect} />
            <TierLabel score={business.prospect.score} className="mt-1 block text-[11px]" />
          </div>
        </div>

        <ScoreReasons reasons={business.prospect.reasons} />

        <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
          <dt className="text-muted-foreground">Website</dt>
          <dd className="min-w-0">
            <WebsiteLink url={business.website} className="max-w-full" />
          </dd>
          <dt className="text-muted-foreground">Phone</dt>
          <dd>
            <PhoneLink phone={business.phone} />
          </dd>
        </dl>

        <div className="rounded-md border bg-muted/20 p-3 text-sm">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Decision maker</p>
          <DecisionMakerCell
            {...decisionMaker}
            businessName={business.name}
            onEnrich={() => onEnrich(business)}
            onVerify={() => onVerify(business.osmId)}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onView(business)}>
            <Eye /> View Details
          </Button>
          {!saved && (
            <Button variant="outline" size="sm" onClick={() => onSave(business)} disabled={savingDisabled}>
              <BookmarkPlus /> Save Lead
            </Button>
          )}
        </div>
      </div>
    </li>
  )
})

function SelectionBar({
  count,
  enrichCount,
  verifyCount,
  saving,
  busy,
  bulk,
  onClear,
  onEnrich,
  onVerify,
  onSave,
}: {
  count: number
  enrichCount: number
  verifyCount: number
  saving: boolean
  busy: boolean
  bulk: BulkProgress | null
  onClear: () => void
  onEnrich: () => void
  onVerify: () => void
  onSave: () => void
}) {
  // Portaled: an animated ancestor's transform would otherwise pin this
  // "fixed" bar to the results card instead of the viewport.
  if (typeof document === "undefined") return null
  return createPortal(
    <AnimatePresence>
      {(count > 0 || bulk) && (
        <m.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 lg:pl-64"
        >
          <div
            role="region"
            aria-label="Selected businesses"
            className="pointer-events-auto w-full max-w-3xl overflow-hidden rounded-xl border bg-popover/95 text-popover-foreground shadow-lg backdrop-blur"
          >
            {bulk ? (
              <div className="px-4 py-3" role="status" aria-live="polite">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                  <span className="font-medium">
                    {bulk.kind === "enrich" ? "Finding decision makers..." : "Verifying emails..."}
                  </span>
                  <span className="ml-auto text-muted-foreground tabular-nums">
                    {bulk.done} of {bulk.total} {bulk.kind === "enrich" ? "businesses" : "emails"} processed
                  </span>
                </div>
                <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                    style={{ width: `${(bulk.done / bulk.total) * 100}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 py-2 pr-2 pl-4">
                <span className="text-sm font-medium tabular-nums" aria-live="polite">
                  Selected: {count} {count === 1 ? "business" : "businesses"}
                </span>
                <Button variant="ghost" size="sm" onClick={onClear} disabled={busy} className="text-muted-foreground">
                  <X /> Deselect all
                </Button>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {verifyCount > 0 && (
                    <Button variant="outline" size="sm" onClick={onVerify} disabled={busy}>
                      <ShieldCheck /> Verify Selected Emails ({verifyCount})
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={onEnrich} disabled={busy || enrichCount === 0}>
                    <UserRoundSearch /> Find Decision Makers{enrichCount > 0 && ` (${enrichCount})`}
                  </Button>
                  <Button size="sm" onClick={onSave} disabled={busy}>
                    {saving ? <Loader2 className="animate-spin" aria-hidden /> : <BookmarkPlus />}
                    {saving ? "Saving..." : "Save Leads"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </m.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
