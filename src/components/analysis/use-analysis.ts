"use client"

import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"
import { ANALYSIS_CONFIG } from "@/lib/analysis/config"
import type {
  AnalysisResponse,
  AnalysisStage,
  AnalysisStreamEvent,
  BusinessAnalysis,
} from "@/types/analysis"
import type { BusinessSearchResult } from "@/types/business"

const REQUEST_TIMEOUT_MS = 70_000

/** What a running analysis is doing right now. "starting" = no update from the server yet. */
export type AnalysisActivity = AnalysisStage | "starting"

export const STAGE_LABELS: Record<AnalysisActivity, string> = {
  starting: "Starting analysis",
  cache: "Checking saved analysis",
  connecting: "Connecting to website",
  structure: "Analyzing page structure",
  seo: "Checking SEO fundamentals",
  conversion: "Checking conversion signals",
  scoring: "Calculating scores",
  saving: "Saving analysis",
}

export interface BulkAnalysisProgress {
  done: number
  total: number
}

type CallResult =
  | { ok: true; analysis: BusinessAnalysis; cached: boolean }
  | { ok: false; message: string; fatal: boolean }

const UNEXPECTED: CallResult = {
  ok: false,
  message: "The server returned an unexpected response. Please try again.",
  fatal: false,
}

function toResult(body: AnalysisResponse | null): CallResult {
  if (!body || typeof body.success !== "boolean") return UNEXPECTED
  return body.success
    ? { ok: true, analysis: body.analysis, cached: body.cached }
    : { ok: false, message: body.error, fatal: body.fatal }
}

/** Calls the analysis route and reads its progress stream line by line. */
async function callApi(body: unknown, onStage: (stage: AnalysisStage) => void): Promise<CallResult> {
  try {
    const response = await fetch("/api/analysis/business", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    // Rejected requests (signed out, rate limited…) are plain JSON, not a stream.
    if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("ndjson")) {
      return toResult((await response.json().catch(() => null)) as AnalysisResponse | null)
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ""
    let result: CallResult | null = null
    for (;;) {
      const { value, done } = await reader.read()
      buffer += value ?? ""
      const lines = buffer.split("\n")
      buffer = done ? "" : (lines.pop() ?? "")
      for (const line of lines) {
        if (!line.trim()) continue
        let event: AnalysisStreamEvent
        try {
          event = JSON.parse(line) as AnalysisStreamEvent
        } catch {
          continue
        }
        if ("stage" in event) onStage(event.stage)
        else result = toResult(event)
      }
      if (done) break
    }
    return result ?? UNEXPECTED
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError"
    return {
      ok: false,
      message: timedOut
        ? "The analysis took too long. Please try again."
        : "We couldn't reach the server. Check your connection and try again.",
      fatal: false,
    }
  }
}

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * Business-analysis state for a list of businesses. A website is only ever
 * fetched after a user action here; nothing runs on mount.
 */
export function useAnalysis(initial: BusinessAnalysis[]) {
  const [analyses, setAnalyses] = useState<ReadonlyMap<string, BusinessAnalysis>>(
    () => new Map(initial.map((analysis) => [analysis.businessId, analysis]))
  )
  const [activity, setActivity] = useState<ReadonlyMap<string, AnalysisActivity>>(new Map())
  const [failures, setFailures] = useState<ReadonlyMap<string, string>>(new Map())
  const [bulk, setBulk] = useState<BulkAnalysisProgress | null>(null)
  const busy = useRef(new Set<string>())

  const setEntry = <V,>(
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
    async (business: BusinessSearchResult, options: { reanalyze?: boolean; silent?: boolean }): Promise<CallResult | null> => {
      const id = business.osmId
      if (busy.current.has(id)) return null // already running for this business
      busy.current.add(id)
      if (!options.silent) {
        setEntry<AnalysisActivity>(setActivity, id, "starting")
        setEntry(setFailures, id, undefined)
      }

      const body = { business, reanalyze: options.reanalyze === true, refresh: options.silent === true }
      const result = await callApi(body, (stage) => {
        if (!options.silent) setEntry<AnalysisActivity>(setActivity, id, stage)
      })

      if (result.ok) setEntry(setAnalyses, id, result.analysis)
      else if (!options.silent) setEntry(setFailures, id, result.message)
      if (!options.silent) setEntry(setActivity, id, undefined)
      busy.current.delete(id)
      return result
    },
    []
  )

  /** Analyzes (or reanalyzes) one business. Shows its own toast. */
  const analyze = useCallback(
    async (business: BusinessSearchResult, options: { reanalyze?: boolean } = {}) => {
      const result = await run(business, options)
      if (!result) return
      if (!result.ok) return void toast.error(result.message)

      const { analysis, cached } = result
      if (analysis.status === "complete") {
        toast.success(
          cached
            ? `Loaded the saved analysis for ${business.name}.`
            : `Analysis complete for ${business.name}.`
        )
      } else {
        toast.info(analysis.websiteNote ?? `Business data analysis completed for ${business.name}.`)
      }
    },
    [run]
  )

  /**
   * Re-qualifies stored analyses after contact data changed (no website
   * request: the stored analysis is still fresh). Silent. Pass only businesses
   * that already have an analysis.
   */
  const refresh = useCallback(
    async (businesses: BusinessSearchResult[]) => {
      await Promise.all(businesses.map((business) => run(business, { silent: true })))
    },
    [run]
  )

  /** Analyzes several businesses a few at a time. One failure never stops the rest, unless it would hit them all. */
  const analyzeMany = useCallback(
    async (businesses: BusinessSearchResult[]) => {
      if (businesses.length === 0) return
      setBulk({ done: 0, total: businesses.length })
      const tally = { complete: 0, partial: 0, website_unavailable: 0, failed: 0 }
      // Set from inside the workers; an object so TypeScript tracks the change.
      const fatal: { message: string | null } = { message: null }

      let next = 0
      const workers = Array.from({ length: Math.min(ANALYSIS_CONFIG.bulkConcurrency, businesses.length) }, async () => {
        while (next < businesses.length && fatal.message === null) {
          const result = await run(businesses[next++], {})
          if (result?.ok) tally[result.analysis.status]++
          else if (result) {
            tally.failed++
            if (result.fatal) fatal.message = result.message
          }
          setBulk((current) => current && { ...current, done: current.done + 1 })
        }
      })
      await Promise.all(workers)
      setBulk(null)

      if (fatal.message) return void toast.error(fatal.message)
      const parts = [
        tally.complete && `${tally.complete} complete`,
        tally.partial && `${tally.partial} partial`,
        tally.website_unavailable && `${tally.website_unavailable} website unavailable`,
        tally.failed && `${tally.failed} failed`,
      ].filter(Boolean)
      const summary = `${count(businesses.length, "business", "businesses")} analyzed: ${parts.join(", ")}.`
      if (tally.failed) toast.warning(summary)
      else toast.success(summary)
    },
    [run]
  )

  return { analyses, activity, failures, bulk, analyze, analyzeMany, refresh }
}

export type AnalysisController = ReturnType<typeof useAnalysis>
