import { analyzeBusiness } from "@/lib/analysis/service"
import { enforceRateLimit } from "@/lib/enrichment/rate-limit"
import { errorResponse, readJsonObject, requireEnrichmentUser } from "@/lib/enrichment/route-helpers"
import { EnrichmentError } from "@/lib/enrichment/types"
import { parseBusiness } from "@/lib/leads/parse-business"
import type { AnalysisStreamEvent } from "@/types/analysis"

// One page fetch capped at 20s, plus storage and queueing behind other analyses.
export const maxDuration = 60

/**
 * POST /api/analysis/business   { business, reanalyze?, refresh? }
 *
 * Analyzes ONE business the user chose. Returns the stored analysis while it
 * is still fresh; otherwise fetches the homepage server-side, analyzes it and
 * stores the result. `reanalyze: true` skips the stored result; `refresh: true`
 * only re-qualifies a stored analysis with current contact data. Bulk runs
 * call this once per business, so one failure never affects the others.
 *
 * Problems with the request itself are answered as plain JSON with an error
 * status. Otherwise the response is NDJSON: `{"stage": …}` lines as each step
 * starts, then one final `{"success": …}` line.
 */
export async function POST(request: Request) {
  let context: Awaited<ReturnType<typeof requireEnrichmentUser>>
  let business: NonNullable<ReturnType<typeof parseBusiness>>
  let options: { reanalyze: boolean; refreshOnly: boolean }
  try {
    context = await requireEnrichmentUser()
    const body = await readJsonObject(request)
    const parsed = parseBusiness(body.business)
    if (!parsed) throw new EnrichmentError("invalid_request")
    business = parsed
    options = { reanalyze: body.reanalyze === true, refreshOnly: body.refresh === true }
    enforceRateLimit(context.userId, "analysis")
  } catch (error) {
    return errorResponse(error, "analysis")
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AnalysisStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          // The browser went away; the analysis still finishes and is stored.
        }
      }
      try {
        const outcome = await analyzeBusiness(context.supabase, context.userId, business, {
          ...options,
          onStage: (stage) => send({ stage }),
        })
        send({ success: true, ...outcome })
      } catch (error) {
        // Reuse the shared mapping so no raw error or stack trace is ever sent.
        send(await errorResponse(error, "analysis").json())
      }
      try {
        controller.close()
      } catch {
        // already closed
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  })
}
