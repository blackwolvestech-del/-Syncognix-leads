import { getCategoryLabel } from "@/lib/business-search/normalize-category"
import type { LeadOverviewRow } from "@/types/database"
import { PRIORITY_LABELS, STAGE_LABELS } from "./config"

/*
 * CSV export of leads. Pure: rows in, text out. Cells are escaped per
 * RFC 4180 and protected against spreadsheet formula injection.
 */

/** A cell starting with one of these is run as a formula by Excel, Sheets and others. */
const FORMULA_START = /^[=+\-@\t\r]/

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  let text = typeof value === "string" ? value : String(value)
  // A leading apostrophe makes spreadsheets treat the cell as text.
  if (FORMULA_START.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(header: string[], rows: unknown[][]): string {
  // CRLF line endings and a BOM, so Excel reads it as UTF-8.
  return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`
}

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })

/** Only business-facing fields: no internal ids or provider identifiers. */
const COLUMNS: [string, (lead: LeadOverviewRow, timeZone: string) => unknown][] = [
  ["Business Name", (lead) => lead.name],
  ["Category", (lead) => getCategoryLabel(lead.category)],
  ["City", (lead) => lead.city],
  ["State", (lead) => lead.state],
  ["Website", (lead) => lead.website],
  ["Business Phone", (lead) => lead.phone],
  ["Decision Maker", (lead) => lead.contact_full_name],
  ["Title", (lead) => lead.contact_title],
  ["Professional Email", (lead) => lead.work_email],
  ["Prospect Score", (lead) => lead.prospect_score],
  ["Qualified Lead Score", (lead) => lead.qualified_lead_score],
  ["Opportunity Score", (lead) => lead.opportunity_score],
  ["Recommended Services", (lead) => (lead.recommended_services ?? []).map((service) => service.label).join("; ")],
  ["Pipeline Stage", (lead) => STAGE_LABELS[lead.pipeline_stage] ?? lead.pipeline_stage],
  ["Priority", (lead) => PRIORITY_LABELS[lead.priority] ?? lead.priority],
  ["Tags", (lead) => (lead.tag_names ?? []).join("; ")],
  [
    "Follow-Up Date",
    (lead, timeZone) => {
      if (!lead.follow_up_at) return ""
      try {
        return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(
          new Date(lead.follow_up_at)
        )
      } catch {
        return dateTime.format(new Date(lead.follow_up_at))
      }
    },
  ],
  ["Follow-Up Note", (lead) => lead.follow_up_note],
]

export function leadsToCsv(leads: LeadOverviewRow[], timeZone = "UTC") {
  return toCsv(
    COLUMNS.map(([label]) => label),
    leads.map((lead) => COLUMNS.map(([, value]) => value(lead, timeZone)))
  )
}
