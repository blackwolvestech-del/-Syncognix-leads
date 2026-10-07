import { PIPELINE_CONFIG } from "@/lib/pipeline/config"
import { leadsToCsv } from "@/lib/pipeline/csv"
import { isTimeZone } from "@/lib/pipeline/follow-up"
import { parseLeadQuery } from "@/lib/pipeline/params"
import { getLeadPreferences, getLeadsForExport } from "@/lib/pipeline/queries"
import { createClient } from "@/lib/supabase/server"

const NO_STORE = { "Cache-Control": "no-store" }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INVALID = "That request wasn't valid. Please refresh the page and try again."

function problem(message: string, status: number) {
  return Response.json({ success: false, error: message }, { status, headers: NO_STORE })
}

/**
 * POST /api/leads/export   { ids: string[] }  or  { params: string }
 *
 * Returns the signed-in user's leads as CSV: exactly the selected ids, or
 * everything matching the current filters (`params` is the Leads page's
 * query string). Never more than what was asked for.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getClaims()
    const userId = data?.claims?.sub
    if (!userId) return problem("You need to be signed in to do this.", 401)

    const body = (await request.json().catch(() => null)) as { ids?: unknown; params?: unknown } | null
    if (!body || typeof body !== "object") return problem(INVALID, 400)

    const preferences = await getLeadPreferences()
    let selection: Parameters<typeof getLeadsForExport>[2]
    if (Array.isArray(body.ids)) {
      const ids = [...new Set(body.ids)]
      const valid =
        ids.length > 0 &&
        ids.length <= PIPELINE_CONFIG.maxExportRows &&
        ids.every((id) => typeof id === "string" && UUID.test(id))
      if (!valid) return problem(INVALID, 400)
      selection = { ids: ids as string[] }
    } else if (typeof body.params === "string" && body.params.length <= 2_000) {
      const params = Object.fromEntries(new URLSearchParams(body.params))
      selection = { query: parseLeadQuery(params, preferences.sort) }
    } else {
      return problem(INVALID, 400)
    }

    const leads = await getLeadsForExport(supabase, userId, selection, preferences.timeZone)
    if (!leads) return problem("We couldn't prepare the export. Please try again.", 500)
    if (leads.length === 0) return problem("There are no leads to export.", 404)

    const csv = leadsToCsv(leads, isTimeZone(preferences.timeZone) ? preferences.timeZone : "UTC")
    const stamp = new Date().toISOString().slice(0, 10)
    return new Response(csv, {
      headers: {
        ...NO_STORE,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="syncognix-leads-${stamp}.csv"`,
        "X-Lead-Count": String(leads.length),
      },
    })
  } catch (error) {
    console.error("[pipeline] export failed:", error)
    return problem("We couldn't prepare the export. Please try again.", 500)
  }
}
