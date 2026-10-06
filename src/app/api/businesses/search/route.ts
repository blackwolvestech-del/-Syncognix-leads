import { createClient } from "@/lib/supabase/server"
import {
  BusinessSearchError,
  isBusinessSearchError,
  logBusinessSearchError,
} from "@/lib/business-search/errors"
import {
  getCategoryLabel,
  getSupportedCategoryIds,
} from "@/lib/business-search/normalize-category"
import { searchBusinesses } from "@/lib/business-search/search-businesses"
import { validateSearchRequest } from "@/lib/business-search/validate-request"
import { getEnrichmentsByBusinessIds } from "@/lib/enrichment/cache"
import { getSavedOsmIds } from "@/lib/leads/save-leads"
import { recordSearch } from "@/lib/leads/searches"
import { scoreProspect } from "@/lib/scoring/prospect-score"
import type {
  BusinessSearchErrorResponse,
  BusinessSearchSuccessResponse,
} from "@/types/business"
import type { LeadEnrichment } from "@/types/enrichment"

// searchBusinesses caps itself at SEARCH_DEADLINE_MS (50s), under this limit.
export const maxDuration = 60

const NO_STORE = { "Cache-Control": "no-store" }

function errorResponse(error: BusinessSearchError) {
  const body: BusinessSearchErrorResponse = {
    success: false,
    error: error.message,
    code: error.code,
  }
  if (error.code === "unsupported_category") {
    body.supportedCategories = getSupportedCategoryIds()
  }
  return Response.json(body, { status: error.status, headers: NO_STORE })
}

/**
 * Returns the signed-in user's id, or null. Signed-in users only — except in
 * `next dev`, where anonymous requests are allowed so the endpoint can be
 * exercised with curl/Postman (nothing is recorded for them).
 */
async function getRequestUser() {
  const supabase = await createClient()
  let userId: string | null = null
  try {
    const { data } = await supabase.auth.getClaims()
    userId = data?.claims?.sub ?? null
  } catch {
    userId = null
  }

  if (!userId && process.env.NODE_ENV !== "development") {
    throw new BusinessSearchError({
      message: "You need to be signed in to search for businesses.",
      status: 401,
      code: "unauthorized",
      service: "request",
    })
  }
  return { supabase, userId }
}

export async function POST(request: Request) {
  try {
    const { supabase, userId } = await getRequestUser()

    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new BusinessSearchError({
        message: "Request body must be valid JSON.",
        status: 400,
        code: "invalid_request",
        service: "request",
      })
    }

    const query = validateSearchRequest(body)
    const result = await searchBusinesses(query)

    // Results are only saved when the user chooses to (saveLeadsAction).
    // Here we just flag which ones they already have and log the search.
    // Stored decision-maker data is attached too (read-only: searching never
    // calls an enrichment provider).
    let savedOsmIds: string[] = []
    let enrichments: LeadEnrichment[] = []
    if (userId) {
      const osmIds = result.businesses.map((business) => business.osmId)
      ;[savedOsmIds, enrichments] = await Promise.all([
        getSavedOsmIds(supabase, userId, osmIds),
        getEnrichmentsByBusinessIds(supabase, userId, osmIds),
        recordSearch(supabase, userId, {
          businessType: getCategoryLabel(result.query.normalizedBusinessType),
          location: query.location,
          resultCount: result.count,
        }),
      ])
    }

    const response: BusinessSearchSuccessResponse = {
      ...result,
      businesses: result.businesses.map((business) => ({
        ...business,
        prospect: scoreProspect(business),
      })),
      savedOsmIds,
      enrichments,
    }
    return Response.json(response, { headers: NO_STORE })
  } catch (error) {
    logBusinessSearchError(error)
    if (isBusinessSearchError(error)) return errorResponse(error)
    return Response.json(
      {
        success: false,
        error: "Something went wrong while searching. Please try again.",
        code: "internal_error",
      } satisfies BusinessSearchErrorResponse,
      { status: 500, headers: NO_STORE }
    )
  }
}
