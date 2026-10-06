import "server-only"

import { EnrichmentError } from "./types"

/*
 * A small per-user sliding-window limit, so one signed-in account can't burn
 * through provider credits with a script. In memory, per server process:
 * enough for a single instance; move to a shared store (e.g. Redis) before
 * running several instances.
 */

const WINDOW_MS = 60_000
const hits = new Map<string, number[]>()

export const RATE_LIMITS = {
  /** Decision-maker lookups per user per minute. */
  enrichment: 60,
  /** Email verifications per user per minute. */
  verification: 60,
} as const

export function enforceRateLimit(userId: string, kind: keyof typeof RATE_LIMITS) {
  const key = `${kind}:${userId}`
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((time) => now - time < WINDOW_MS)

  if (recent.length >= RATE_LIMITS[kind]) {
    hits.set(key, recent)
    throw new EnrichmentError("rate_limited", { detail: `app rate limit hit for ${kind}` })
  }
  recent.push(now)
  hits.set(key, recent)

  // Keep the map from growing without bound.
  if (hits.size > 5_000) {
    for (const [k, times] of hits) {
      if (times.every((time) => now - time >= WINDOW_MS)) hits.delete(k)
    }
  }
}
