import { enforceRateLimit } from "@/lib/enrichment/rate-limit"
import {
  errorResponse,
  readJsonObject,
  requireEnrichmentUser,
  successResponse,
} from "@/lib/enrichment/route-helpers"
import { enrichBusiness } from "@/lib/enrichment/service"
import { EnrichmentError } from "@/lib/enrichment/types"
import { parseBusiness } from "@/lib/leads/parse-business"

// Two provider calls of up to 20s each, plus queueing behind other lookups.
export const maxDuration = 60

/**
 * POST /api/enrichment/decision-maker   { business }
 *
 * Finds the decision maker for ONE business the user chose. Returns stored
 * data when it exists; otherwise calls the enrichment provider, stores the
 * result and logs the usage. Bulk runs call this once per business, so one
 * failure never affects the others.
 */
export async function POST(request: Request) {
  try {
    const { supabase, userId } = await requireEnrichmentUser()
    const body = await readJsonObject(request)

    const business = parseBusiness(body.business)
    if (!business) throw new EnrichmentError("invalid_request")

    enforceRateLimit(userId, "enrichment")
    return successResponse(await enrichBusiness(supabase, userId, business))
  } catch (error) {
    return errorResponse(error, "decision-maker")
  }
}
