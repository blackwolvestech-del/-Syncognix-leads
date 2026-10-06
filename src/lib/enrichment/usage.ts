import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import type { Database } from "@/types/database"
import type { ProviderUsage } from "@/types/enrichment"
import { getHunterAccount } from "./hunter"
import { getProspeoAccount } from "./prospeo"
import { getProviderStatus } from "./provider"
import type { ProviderCall } from "./types"

/*
 * Syncognix's own log of provider API calls (table: api_usage). This counts
 * what this app did — it is not the provider's official balance, which the
 * Usage page shows separately when the provider's account API returns it.
 */

const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"])

/**
 * Logs provider calls. Usage tracking is bookkeeping: a failure here is
 * logged but never fails the lookup the user asked for.
 */
export async function recordUsage(
  supabase: SupabaseClient<Database>,
  userId: string,
  calls: ProviderCall[],
  context: { businessId?: string | null; email?: string | null }
) {
  if (calls.length === 0) return
  const { error } = await supabase.from("api_usage").insert(
    calls.map((call) => ({
      user_id: userId,
      provider: call.provider,
      action: call.action,
      business_id: context.businessId ?? null,
      email: context.email ?? null,
      success: call.success,
      credits_estimated: call.creditsEstimated,
    }))
  )
  if (error && !MISSING_TABLE_CODES.has(error.code ?? "")) {
    console.error(`[usage] record failed: ${error.code ?? "unknown"} ${error.message}`)
  }
}

/** This calendar month's usage (UTC) per provider, plus official balances when available. */
export async function getMonthlyUsage(userId: string): Promise<ProviderUsage[]> {
  const supabase = await createClient()
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()

  const [{ data, error }, prospeoAccount, hunterAccount] = await Promise.all([
    supabase
      .from("api_usage")
      .select("provider, credits_estimated")
      .eq("user_id", userId)
      .gte("created_at", monthStart)
      .limit(10_000),
    getProspeoAccount(),
    getHunterAccount(),
  ])

  if (error && !MISSING_TABLE_CODES.has(error.code ?? "")) {
    console.error(`[usage] load failed: ${error.code ?? "unknown"} ${error.message}`)
  }

  const configured = getProviderStatus()
  const summarize = (provider: "prospeo" | "hunter", account: ProviderUsage["account"]): ProviderUsage => {
    const rows = (data ?? []).filter((row) => row.provider === provider)
    return {
      provider,
      configured: configured[provider],
      requestsThisMonth: rows.length,
      creditsEstimatedThisMonth: rows.reduce((sum, row) => sum + (row.credits_estimated ?? 0), 0),
      account,
    }
  }

  return [summarize("prospeo", prospeoAccount), summarize("hunter", hunterAccount)]
}
