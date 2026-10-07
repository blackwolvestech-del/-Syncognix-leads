"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Columns3, Download, ListPlus, Loader2, Search, SlidersHorizontal, Table2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AnalysisFilterBar } from "@/components/analysis/analysis-filters"
import { ListsDialog } from "@/components/pipeline/dialogs"
import { exportLeads } from "@/components/pipeline/export"
import { FilterSelect } from "@/components/shared/filter-select"
import {
  PRIORITY_LABELS,
  QUICK_VIEWS,
  QUICK_VIEW_HINTS,
  QUICK_VIEW_LABELS,
  STAGE_LABELS,
  type PipelineStage,
  type Priority,
} from "@/lib/pipeline/config"
import {
  DEFAULT_LEAD_QUERY,
  FOLLOW_UP_FILTER_LABELS,
  LEAD_SORT_LABELS,
  SORT_COOKIE,
  leadFiltersActive,
  leadQueryParams,
  leadsHref,
  type ArchiveFilter,
  type FollowUpFilter,
  type LeadQuery,
  type LeadSort,
} from "@/lib/pipeline/params"
import { cn } from "@/lib/utils"
import type { CategoryOption } from "@/types/business"
import type { LeadList, LeadTag } from "@/types/pipeline"

const DEBOUNCE_MS = 300

const ANY = "any"

/** { any: "Any stage", ...labels } with "any" listed first. */
function withAny<T extends string>(any: string, labels: Record<T, string>) {
  return { [ANY]: any, ...labels } as Record<T | typeof ANY, string>
}

const STAGE_OPTIONS = withAny("Any stage", STAGE_LABELS)
const PRIORITY_OPTIONS = withAny("Any priority", PRIORITY_LABELS)
const { any: _anyFollowUp, ...FOLLOW_UP_LABELS } = FOLLOW_UP_FILTER_LABELS
const FOLLOW_UP_OPTIONS = withAny(_anyFollowUp, FOLLOW_UP_LABELS)
const PROSPECT_OPTIONS = { any: "Any prospect score", p60: "Prospect ≥ 60", p80: "Prospect ≥ 80" }
const ARCHIVE_OPTIONS: Record<ArchiveFilter, string> = {
  active: "Active leads",
  archived: "Archived only",
  all: "Active and archived",
}

/** A debounced text input that reports its trimmed value. */
function DebouncedInput({
  value,
  onCommit,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & { value: string; onCommit: (value: string) => void }) {
  const [text, setText] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Follow outside changes (e.g. "Clear filters") without fighting typing.
  const [previous, setPrevious] = useState(value)
  if (value !== previous) {
    setPrevious(value)
    if (value !== text.trim()) setText(value)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <Input
      {...props}
      value={text}
      onChange={(event) => {
        const next = event.target.value
        setText(next)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => onCommit(next.trim()), DEBOUNCE_MS)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          clearTimeout(timer.current)
          onCommit(text.trim())
        }
      }}
    />
  )
}

/**
 * Quick views, search, sort and filters for saved leads. Everything is kept
 * in the URL and applied by the server, so a view can be bookmarked and the
 * browser never holds more than one page of leads.
 */
export function LeadsToolbar({
  query,
  total,
  lists,
  tags,
  categories,
  rememberedSort,
}: {
  query: LeadQuery
  /** Leads matching the current view; null when unknown. */
  total: number | null
  lists: LeadList[]
  tags: LeadTag[]
  categories: CategoryOption[]
  rememberedSort: string | undefined
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [remembered, setRemembered] = useState(rememberedSort)
  const active = leadFiltersActive(query)
  const [showFilters, setShowFilters] = useState(active)

  /** Any change starts again from the first page. */
  function go(change: Partial<LeadQuery>, sortMemory = remembered) {
    const next = { ...query, ...change, page: 1 }
    startTransition(() => router.replace(leadsHref(next, sortMemory), { scroll: false }))
  }

  function changeSort(sort: LeadSort) {
    // Remembered for next time; the URL then doesn't need to carry it.
    document.cookie = `${SORT_COOKIE}=${sort}; path=/; max-age=31536000; samesite=lax`
    setRemembered(sort)
    go({ sort }, sort)
  }

  const listOptions = withAny("Any list", Object.fromEntries(lists.map((list) => [list.id, list.name])))
  const tagOptions = withAny("Any tag", Object.fromEntries(tags.map((tag) => [tag.id, tag.name])))
  const categoryOptions = withAny("Any category", Object.fromEntries(categories.map((category) => [category.id, category.label])))
  const prospect = query.minProspect === null ? "any" : query.minProspect >= 80 ? "p80" : "p60"

  return (
    <div className="border-b">
      {/* Quick views */}
      <div className="flex gap-1.5 overflow-x-auto border-b px-4 py-2.5 sm:px-5" role="group" aria-label="Quick views">
        {QUICK_VIEWS.map((view) => (
          <Button
            key={view}
            variant={query.view === view ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={query.view === view}
            title={QUICK_VIEW_HINTS[view]}
            onClick={() => go({ view })}
            className={cn("shrink-0", query.view !== view && "text-muted-foreground")}
          >
            {QUICK_VIEW_LABELS[view]}
          </Button>
        ))}
      </div>

      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
        <div className="relative w-full sm:max-w-xs">
          {pending ? (
            <Loader2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          )}
          <DebouncedInput
            type="search"
            value={query.q}
            onCommit={(q) => q !== query.q && go({ q })}
            placeholder="Search name, contact, email, city, tag…"
            aria-label="Search saved leads"
            className="h-9 pl-9"
          />
        </div>
        {total !== null && (query.q || active || query.view !== "all") && (
          <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
            {total} {total === 1 ? "lead" : "leads"} in this view
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 sm:ml-auto sm:flex">
          {query.layout === "table" && (
            <FilterSelect
              label="Sort leads"
              value={query.sort}
              onChange={changeSort}
              active={query.sort !== "newest"}
              options={LEAD_SORT_LABELS}
              className="sm:w-52"
              align="end"
            />
          )}
          <Button
            variant="outline"
            size="sm"
            className={cn("h-9 font-normal", active && "border-primary/40")}
            aria-expanded={showFilters}
            aria-controls="lead-filters"
            onClick={() => setShowFilters((open) => !open)}
          >
            <SlidersHorizontal /> Filters
          </Button>
        </div>
      </div>

      {showFilters && (
        <div id="lead-filters" className="space-y-2 border-t bg-muted/20 px-4 py-3 sm:px-5">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" role="group" aria-label="Pipeline filters">
            <FilterSelect
              label="Filter by pipeline stage"
              value={query.stage ?? ANY}
              onChange={(value) => go({ stage: value === ANY ? null : (value as PipelineStage) })}
              active={query.stage !== null}
              options={STAGE_OPTIONS}
              className="sm:w-44"
            />
            <FilterSelect
              label="Filter by priority"
              value={query.priority ?? ANY}
              onChange={(value) => go({ priority: value === ANY ? null : (value as Priority) })}
              active={query.priority !== null}
              options={PRIORITY_OPTIONS}
              className="sm:w-36"
            />
            <FilterSelect
              label="Filter by list"
              value={query.list && query.list in listOptions ? query.list : ANY}
              onChange={(value) => go({ list: value === ANY ? null : value })}
              active={query.list !== null}
              options={listOptions}
              className="sm:w-44"
            />
            <FilterSelect
              label="Filter by tag"
              value={query.tag && query.tag in tagOptions ? query.tag : ANY}
              onChange={(value) => go({ tag: value === ANY ? null : value })}
              active={query.tag !== null}
              options={tagOptions}
              className="sm:w-40"
            />
            <FilterSelect
              label="Filter by follow-up"
              value={query.followUp ?? ANY}
              onChange={(value) => go({ followUp: value === ANY ? null : (value as FollowUpFilter) })}
              active={query.followUp !== null}
              options={FOLLOW_UP_OPTIONS}
              className="sm:w-40"
            />
            <FilterSelect
              label="Filter by category"
              value={query.category && query.category in categoryOptions ? query.category : ANY}
              onChange={(value) => go({ category: value === ANY ? null : value })}
              active={query.category !== null}
              options={categoryOptions}
              className="sm:w-40"
            />
            <FilterSelect
              label="Filter by prospect score"
              value={prospect}
              onChange={(value) => go({ minProspect: value === "any" ? null : value === "p80" ? 80 : 60 })}
              active={query.minProspect !== null}
              options={PROSPECT_OPTIONS}
              className="sm:w-44"
            />
            <DebouncedInput
              value={query.city}
              onCommit={(city) => city !== query.city && go({ city })}
              placeholder="City"
              aria-label="Filter by city"
              className={cn("h-9 bg-background sm:w-32", query.city && "border-primary/40")}
            />
            <DebouncedInput
              value={query.state}
              onCommit={(state) => state !== query.state && go({ state })}
              placeholder="State"
              aria-label="Filter by state"
              className={cn("h-9 bg-background sm:w-32", query.state && "border-primary/40")}
            />
            <FilterSelect
              label="Show active or archived leads"
              value={query.archive}
              onChange={(archive) => go({ archive })}
              active={query.archive !== "active"}
              options={ARCHIVE_OPTIONS}
              className="sm:w-44"
            />
          </div>
          <AnalysisFilterBar filters={query.scores} onChange={(scores) => go({ scores })} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Score filters only match leads you have analyzed. Unanalyzed leads have no score.
            </p>
            {active && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => go({ ...DEFAULT_LEAD_QUERY, q: query.q, view: query.view, sort: query.sort, layout: query.layout })}
              >
                <X /> Clear filters
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Page-level actions: manage lists, switch between table and pipeline, export the current view. */
export function LeadsHeaderActions({
  query,
  lists,
  rememberedSort,
  canExport,
}: {
  query: LeadQuery
  lists: LeadList[]
  rememberedSort: string | undefined
  /** False when the current view has no leads. */
  canExport: boolean
}) {
  const router = useRouter()
  const [listsOpen, setListsOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const pipeline = query.layout === "pipeline"

  async function exportView() {
    setExporting(true)
    await exportLeads({ params: leadQueryParams({ ...query, page: 1 }, rememberedSort).toString() })
    setExporting(false)
  }

  return (
    <>
      <Button variant="outline" onClick={() => setListsOpen(true)}>
        <ListPlus /> Lists
      </Button>
      <Button variant="outline" asChild>
        <Link href={leadsHref({ ...query, layout: pipeline ? "table" : "pipeline", page: 1 }, rememberedSort)}>
          {pipeline ? <Table2 /> : <Columns3 />}
          {pipeline ? "Table View" : "Pipeline View"}
        </Link>
      </Button>
      <Button variant="outline" onClick={exportView} disabled={exporting || !canExport} title="Export the leads in the current view as CSV">
        {exporting ? <Loader2 className="animate-spin" aria-hidden /> : <Download />}
        Export
      </Button>

      <ListsDialog
        open={listsOpen}
        onOpenChange={setListsOpen}
        lists={lists}
        onOpenList={(list) => {
          setListsOpen(false)
          router.push(leadsHref({ ...DEFAULT_LEAD_QUERY, layout: query.layout, sort: query.sort, list: list.id }, rememberedSort))
        }}
      />
    </>
  )
}
