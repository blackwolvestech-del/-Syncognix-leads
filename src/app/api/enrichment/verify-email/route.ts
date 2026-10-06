import { enforceRateLimit } from "@/lib/enrichment/rate-limit"
import {
  errorResponse,
  readJsonObject,
  requireEnrichmentUser,
  successResponse,
} from "@/lib/enrichment/route-helpers"
import { verifyBusinessEmail } from "@/lib/enrichment/service"
import { EnrichmentError } from "@/lib/enrichment/types"
import { isBusinessId } from "@/lib/leads/parse-business"

// Hunter can take a few polls to finish a verification.
export const maxDuration = 60

/**
 * POST /api/enrichment/verify-email   { businessId }
 *
 * Verifies the work email stored for ONE business the user chose. The
 * address is read from the user's own stored enrichment, never from the
 * request, so this can't be used to verify arbitrary addresses. A recent
 * stored verdict is returned without calling the verifier.
 */
export async function POST(request: Request) {
  try {
    const { supabase, userId } = await requireEnrichmentUser()
    const body = await readJsonObject(request)

    if (!isBusinessId(body.businessId)) throw new EnrichmentError("invalid_request")

    enforceRateLimit(userId, "verification")
    return successResponse(await verifyBusinessEmail(supabase, userId, body.businessId))
  } catch (error) {
    return errorResponse(error, "verify-email")
  }
}
