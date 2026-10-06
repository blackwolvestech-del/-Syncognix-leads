import "server-only"

import { EnrichmentError } from "./types"

export interface ProviderResponse {
  status: number
  /** Parsed JSON body, or null when the body wasn't JSON. */
  body: unknown
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")
}

/**
 * Calls a provider API under one hard timeout and returns the parsed body
 * for any HTTP status. Timeouts and network failures become user-safe
 * EnrichmentErrors. Request headers (which hold API keys) are never logged
 * or included in errors.
 */
export async function providerFetch(
  provider: string,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<ProviderResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" })
    const text = await response.text()
    let body: unknown = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = null
    }
    return { status: response.status, body }
  } catch (error) {
    if (isAbortError(error)) {
      throw new EnrichmentError("timeout", { detail: `${provider} timed out after ${timeoutMs}ms` })
    }
    throw new EnrichmentError("unavailable", {
      detail: `${provider} network error: ${error instanceof Error ? error.name : "unknown"}`,
    })
  } finally {
    clearTimeout(timer)
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Runs calls one at a time with a minimum gap between them, so a bulk run
 * can't exceed a provider's per-second limit. Per server process.
 */
export function createThrottle(minIntervalMs: number) {
  let tail: Promise<unknown> = Promise.resolve()
  let lastStart = 0

  return function throttle<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(async () => {
      const wait = lastStart + minIntervalMs - Date.now()
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      lastStart = Date.now()
      return task()
    })
    // Keep the queue moving whether the task succeeds or fails.
    tail = run.catch(() => undefined)
    return run
  }
}
