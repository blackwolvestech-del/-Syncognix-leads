"use client"

import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"
import type { BusinessSearchResult } from "@/types/business"
import type {
  EnrichmentResponse,
  EnrichmentStatus,
  LeadEnrichment,
} from "@/types/enrichment"

/** Provider lookups in flight at once during a bulk run. Kept low on purpose. */
const BULK_CONCURRENCY = 2
const REQUEST_TIMEOUT_MS = 70_000

type Activity = "enriching" | "verifying"

export interface BulkProgress {
  kind: "enrich" | "verify"
  done: number
  total: number
}

type CallResult =
  | { ok: true; enrichment: LeadEnrichment; cached: boolean }
  | { ok: false; message: string; fatal: boolean }

async function callApi(path: string, body: unknown): Promise<CallResult> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const json = (await response.json().catch(() => null)) as EnrichmentResponse | null
    if (!json) return { ok: false, message: "The server returned an unexpected response. Please try again.", fatal: false }
    if (!json.success) return { ok: false, message: json.error, fatal: json.fatal }
    return { ok: true, enrichment: json.enrichment, cached: json.cached }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError"
    return {
      ok: false,
      message: timedOut
        ? "The request took too long. Please try again."
        : "We couldn't reach the server. Check your connection and try again.",
      fatal: false,
    }
  }
}

/** Runs `worker` over `items` a few at a time; stops handing out work once `shouldStop()`. */
async function runPool<T>(items: T[], worker: (item: T) => Promise<void>, shouldStop: () => boolean) {
  let next = 0
  const runners = Array.from({ length: Math.min(BULK_CONCURRENCY, items.length) }, async () => {
    while (next < items.length && !shouldStop()) {
      await worker(items[next++])
    }
  })
  await Promise.all(runners)
}

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * Decision-maker and email-verification state for a list of businesses.
 * Every provider call here starts from a user action; nothing runs on mount.
 */
export function useEnrichment(initial: LeadEnrichment[]) {
  const [enrichments, setEnrichments] = useState<ReadonlyMap<string, LeadEnrichment>>(
    () => new Map(initial.map((e) => [e.businessId, e]))
  )
  const [activity, setActivity] = useState<ReadonlyMap<string, Activity>>(new Map())
  const [failures, setFailures] = useState<ReadonlyMap<string, string>>(new Map())
  const [bulk, setBulk] = useState<BulkProgress | null>(null)
  const busy = useRef(new Set<string>())

  const setMapEntry = <V,>(
    setter: React.Dispatch<React.SetStateAction<ReadonlyMap<string, V>>>,
    key: string,
    value: V | undefined
  ) =>
    setter((current) => {
      const next = new Map(current)
      if (value === undefined) next.delete(key)
      else next.set(key, value)
      return next
    })

  const run = useCallback(
    async (id: string, kind: Activity, path: string, body: unknown): Promise<CallResult | null> => {
      if (busy.current.has(id)) return null // already running for this business
      busy.current.add(id)
      setMapEntry(setActivity, id, kind)
      if (kind === "enriching") setMapEntry(setFailures, id, undefined)

      const result = await callApi(path, body)

      if (result.ok) setMapEntry(setEnrichments, id, result.enrichment)
      else if (kind === "enriching") setMapEntry(setFailures, id, result.message)
      setMapEntry(setActivity, id, undefined)
      busy.current.delete(id)
      return result
    },
    []
  )

  /** Looks up one business. Shows its own toast. */
  const enrich = useCallback(
    async (business: BusinessSearchResult) => {
      const result = await run(business.osmId, "enriching", "/api/enrichment/decision-maker", { business })
      if (!result) return
      if (!result.ok) return void toast.error(result.message)

      const { enrichment, cached } = result
      const note = cached ? " Loaded from your saved data — no credits used." : ""
      if (enrichment.status === "enriched") {
        toast.success(`Decision maker found for ${business.name}.${note}`)
      } else if (enrichment.status === "partial") {
        toast.info(`Found a decision maker for ${business.name}, but no work email.${note}`)
      } else {
        toast.info(`No decision maker could be found for ${business.name}.`)
      }
    },
    [run]
  )

  /** Verifies one stored work email. Shows its own toast. */
  const verify = useCallback(
    async (businessId: string) => {
      const result = await run(businessId, "verifying", "/api/enrichment/verify-email", { businessId })
      if (!result) return
      if (!result.ok) return void toast.error(result.message)

      const status = result.enrichment.verification?.status
      const note = result.cached ? " (from your saved data)" : ""
      if (status === "deliverable") toast.success(`Email verified as deliverable${note}.`)
      else if (status === "invalid") toast.warning(`This email was reported invalid${note}.`)
      else toast.info(`Verification result: ${status ?? "unknown"}${note}.`)
    },
    [run]
  )

  /** Looks up several businesses with progress. One failure never stops the rest, unless it would hit them all. */
  const enrichMany = useCallback(
    async (businesses: BusinessSearchResult[]) => {
      if (businesses.length === 0) return
      setBulk({ kind: "enrich", done: 0, total: businesses.length })
      const tally = { enriched: 0, partial: 0, no_match: 0, failed: 0, cached: 0 }
      // Set from inside the workers; an object so TypeScript tracks the change.
      const fatal: { message: string | null } = { message: null }

      await runPool(
        businesses,
        async (business) => {
          const result = await run(business.osmId, "enriching", "/api/enrichment/decision-maker", { business })
          if (result?.ok) {
            tally[result.enrichment.status]++
            if (result.cached) tally.cached++
          } else if (result) {
            tally.failed++
            if (result.fatal) fatal.message = result.message
          }
          setBulk((current) => current && { ...current, done: current.done + 1 })
        },
        () => fatal.message !== null
      )
      setBulk(null)

      if (fatal.message) return void toast.error(fatal.message)
      const parts = [
        tally.enriched && `${tally.enriched} found`,
        tally.partial && `${tally.partial} without email`,
        tally.no_match && `${tally.no_match} no match`,
        tally.failed && `${tally.failed} failed`,
      ].filter(Boolean)
      const summary = `${count(businesses.length, "business", "businesses")} processed: ${parts.join(", ")}.`
      const note = tally.cached ? ` ${tally.cached} loaded from saved data.` : ""
      if (tally.failed) toast.warning(summary + note)
      else toast.success(summary + note)
    },
    [run]
  )

  /** Verifies several stored emails with progress. */
  const verifyMany = useCallback(
    async (businessIds: string[]) => {
      if (businessIds.length === 0) return
      setBulk({ kind: "verify", done: 0, total: businessIds.length })
      const tally = { deliverable: 0, risky: 0, invalid: 0, unknown: 0, failed: 0 }
      // Set from inside the workers; an object so TypeScript tracks the change.
      const fatal: { message: string | null } = { message: null }

      await runPool(
        businessIds,
        async (businessId) => {
          const result = await run(businessId, "verifying", "/api/enrichment/verify-email", { businessId })
          const status = result?.ok ? result.enrichment.verification?.status : undefined
          if (status) tally[status]++
          else if (result) {
            tally.failed++
            if (!result.ok && result.fatal) fatal.message = result.message
          }
          setBulk((current) => current && { ...current, done: current.done + 1 })
        },
        () => fatal.message !== null
      )
      setBulk(null)

      if (fatal.message) return void toast.error(fatal.message)
      const parts = [
        tally.deliverable && `${tally.deliverable} deliverable`,
        tally.risky && `${tally.risky} risky`,
        tally.invalid && `${tally.invalid} invalid`,
        tally.unknown && `${tally.unknown} unknown`,
        tally.failed && `${tally.failed} failed`,
      ].filter(Boolean)
      const summary = `${count(businessIds.length, "email", "emails")} checked: ${parts.join(", ")}.`
      if (tally.failed) toast.warning(summary)
      else toast.success(summary)
    },
    [run]
  )

  const statusOf = useCallback(
    (businessId: string): EnrichmentStatus => {
      if (activity.get(businessId) === "enriching") return "enriching"
      const enrichment = enrichments.get(businessId)
      if (enrichment) return enrichment.status
      return failures.has(businessId) ? "failed" : "not_enriched"
    },
    [activity, enrichments, failures]
  )

  return { enrichments, activity, failures, bulk, statusOf, enrich, verify, enrichMany, verifyMany }
}

export type EnrichmentController = ReturnType<typeof useEnrichment>
