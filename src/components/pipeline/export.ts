"use client"

import { toast } from "sonner"

/**
 * Downloads leads as CSV: exactly the given ids, or everything matching the
 * current filters (`params` is the Leads page's query string).
 */
export async function exportLeads(selection: { ids: string[] } | { params: string }) {
  try {
    const response = await fetch("/api/leads/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selection),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      toast.error(body?.error ?? "We couldn't prepare the export. Please try again.")
      return
    }

    const blob = await response.blob()
    const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "leads.csv"
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = name
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)

    const count = Number(response.headers.get("X-Lead-Count"))
    toast.success(count ? `Exported ${count} ${count === 1 ? "lead" : "leads"} to CSV.` : "Export downloaded.")
  } catch {
    toast.error("We couldn't prepare the export. Check your connection and try again.")
  }
}
