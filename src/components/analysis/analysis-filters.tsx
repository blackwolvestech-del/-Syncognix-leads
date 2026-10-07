"use client"

import { FilterSelect } from "@/components/shared/filter-select"
import type { AnalysisFilters } from "@/lib/analysis/filters"

// Keys are prefixed so they are not integer-like: object keys that look like
// integers are always listed first, which would push "any" to the bottom.
type Threshold = "any" | `t${number}`

function thresholdOptions(prefix: string, any: string, values: number[]) {
  const options: Record<string, string> = { any }
  for (const value of values) options[`t${value}`] = `${prefix} ${value}`
  return options as Record<Threshold, string>
}

const QUALIFIED = thresholdOptions("Qualified ≥", "Any qualified score", [60, 70, 80, 90])
const OPPORTUNITY = thresholdOptions("Opportunity ≥", "Any opportunity", [40, 50, 60, 70, 80])
const WEBSITE = thresholdOptions("Website ≤", "Any website score", [40, 50, 60, 70])
const SEO = thresholdOptions("SEO ≤", "Any SEO score", [40, 50, 60, 70])
const CONVERSION = thresholdOptions("Conversion ≤", "Any conversion score", [40, 50, 60, 70])

const CONTACT: Record<AnalysisFilters["contact"], string> = {
  any: "Any contact data",
  decision_maker: "Decision maker found",
  email: "Email found",
}

const ANALYSIS: Record<AnalysisFilters["analysis"], string> = {
  any: "Any analysis status",
  analyzed: "Analyzed",
  complete: "Analysis complete",
  not_analyzed: "Not analyzed",
}

const toThreshold = (value: number | null): Threshold => (value === null ? "any" : `t${value}`)
const fromThreshold = (value: Threshold) => (value === "any" ? null : Number(value.slice(1)))

/**
 * The Step 4 filters. Score thresholds only ever match analyzed businesses:
 * a business without a score is never treated as scoring zero.
 */
export function AnalysisFilterBar({
  filters,
  onChange,
  showContact = true,
}: {
  filters: AnalysisFilters
  onChange: (filters: AnalysisFilters) => void
  /** False where another control already filters by contact data. */
  showContact?: boolean
}) {
  const set = <K extends keyof AnalysisFilters>(key: K, value: AnalysisFilters[K]) =>
    onChange({ ...filters, [key]: value })

  const score = (
    label: string,
    key: "minQualified" | "minOpportunity" | "maxWebsite" | "maxSeo" | "maxConversion",
    options: Record<Threshold, string>
  ) => (
    <FilterSelect
      label={label}
      value={toThreshold(filters[key])}
      onChange={(value) => set(key, fromThreshold(value))}
      active={filters[key] !== null}
      options={options}
      className="sm:w-44"
    />
  )

  return (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" role="group" aria-label="Business intelligence filters">
      {score("Filter by qualified lead score", "minQualified", QUALIFIED)}
      {score("Filter by opportunity score", "minOpportunity", OPPORTUNITY)}
      {score("Filter by website score", "maxWebsite", WEBSITE)}
      {score("Filter by SEO score", "maxSeo", SEO)}
      {score("Filter by conversion score", "maxConversion", CONVERSION)}
      {showContact && (
        <FilterSelect
          label="Filter by contact data"
          value={filters.contact}
          onChange={(value) => set("contact", value)}
          active={filters.contact !== "any"}
          options={CONTACT}
          className="sm:w-44"
        />
      )}
      <FilterSelect
        label="Filter by analysis status"
        value={filters.analysis}
        onChange={(value) => set("analysis", value)}
        active={filters.analysis !== "any"}
        options={ANALYSIS}
        className="sm:w-44"
      />
    </div>
  )
}
