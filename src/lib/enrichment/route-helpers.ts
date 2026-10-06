import "server-only"

import { createClient } from "@/lib/supabase/server"
import type { EnrichmentErrorResponse, EnrichmentSuccessResponse } from "@/types/enrichment"
import type { EnrichmentOutcome } from "./service"
import { EnrichmentError } from "./types"

const NO_STORE = { "Cache-Control": "no-store" }

/**
 * The verified signed-in user. Enrichment endpoints spend provider credits,
 * so — unlike business search — there is no anonymous access, even in dev.
 */
export async function requireEnrichmentUser() {
  const supabase = await createClient()
  let userId: string | null = null
  try {
    const { data } = await supabase.auth.getClaims()
    userId = data?.claims?.sub ?? null
  } catch {
    userId = null
  }
  if (!userId) throw new EnrichmentError("unauthorized")
  return { supabase, userId }
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new EnrichmentError("invalid_request")
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new EnrichmentError("invalid_request")
  }
  return body as Record<string, unknown>
}

export function successResponse(outcome: EnrichmentOutcome) {
  const body: EnrichmentSuccessResponse = { success: true, ...outcome }
  return Response.json(body, { headers: NO_STORE })
}

/** Logs the technical detail server-side and answers with a user-safe message. */
export function errorResponse(error: unknown, scope: string) {
  if (error instanceof EnrichmentError) {
    // Expected outcomes (bad input, signed out) aren't worth logging.
    if (error.detail) console.error(`[enrichment] ${scope}: ${error.code} (${error.detail.slice(0, 300)})`)
    const body: EnrichmentErrorResponse = {
      success: false,
      error: error.message,
      code: error.code,
      fatal: error.fatal,
    }
    // "pending" is reported as an error body, so use a real error status for it.
    return Response.json(body, { status: error.status === 202 ? 503 : error.status, headers: NO_STORE })
  }

  console.error(`[enrichment] ${scope}: unexpected error:`, error)
  const body: EnrichmentErrorResponse = {
    success: false,
    error: "Something went wrong. Please try again.",
    code: "internal_error",
    fatal: false,
  }
  return Response.json(body, { status: 500, headers: NO_STORE })
}
