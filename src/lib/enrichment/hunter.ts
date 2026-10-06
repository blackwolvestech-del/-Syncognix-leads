import "server-only"

import type { VerificationStatus } from "@/types/enrichment"
import { asRecord, providerFetch } from "./http"
import { cleanText } from "./normalize"
import {
  EnrichmentError,
  type EmailVerificationResult,
  type EmailVerifier,
  type TrackCall,
} from "./types"

/*
 * Hunter Email Verifier (https://hunter.io/api-documentation/v2#email-verifier).
 * Only ever called when the user chooses to verify an email. The key is sent
 * in the X-API-KEY header, so it never appears in a URL or a log line.
 */

const BASE_URL = "https://api.hunter.io/v2"
const TIMEOUT_MS = 20_000
/** Hunter answers 202 while a verification is still running; poll briefly. */
const PENDING_RETRIES = 3
const PENDING_DELAY_MS = 2_500

export const HUNTER_ACTIONS = { verify: "hunter_email_verification" } as const

/**
 * Hunter's `status` → our four states. "accept_all" (the server accepts any
 * address), "webmail" and "disposable" can't be confirmed, so they are risky.
 */
const STATUS_MAP: Record<string, VerificationStatus> = {
  valid: "deliverable",
  invalid: "invalid",
  accept_all: "risky",
  webmail: "risky",
  disposable: "risky",
  unknown: "unknown",
}

function apiKey() {
  return process.env.HUNTER_API_KEY?.trim() || null
}

function firstErrorId(body: unknown) {
  const errors = asRecord(body).errors
  const first = Array.isArray(errors) ? asRecord(errors[0]) : {}
  return typeof first.id === "string" ? first.id : undefined
}

function toError(status: number, body: unknown) {
  const detail = `hunter email-verifier: HTTP ${status} ${firstErrorId(body) ?? ""}`.trim()
  if (status === 401) return new EnrichmentError("invalid_key", { detail })
  // 429 = monthly usage limit reached; 403 = short-term rate limit.
  if (status === 429) return new EnrichmentError("quota_exhausted", { detail })
  if (status === 403) return new EnrichmentError("rate_limited", { detail })
  if (status === 451) return new EnrichmentError("blocked", { detail })
  if (status === 400) {
    return new EnrichmentError("invalid_request", {
      message: "That email address isn't valid, so it can't be verified.",
      detail,
    })
  }
  return new EnrichmentError("unavailable", {
    message: "Email verification is temporarily unavailable.",
    detail,
  })
}

export const hunter: EmailVerifier = {
  id: "hunter",

  isConfigured() {
    return apiKey() !== null
  },

  async verifyEmail(email: string, track: TrackCall): Promise<EmailVerificationResult> {
    const key = apiKey()
    if (!key) {
      throw new EnrichmentError("not_configured", {
        message:
          "Email verification provider is not configured. Add your Hunter API key in environment settings.",
      })
    }

    const url = `${BASE_URL}/email-verifier?email=${encodeURIComponent(email)}`
    const request = () =>
      providerFetch("hunter", url, { method: "GET", headers: { "X-API-KEY": key } }, TIMEOUT_MS)

    let response = await request()
    // 202: still verifying. 222: the mail server gave an unexpected answer; retry.
    for (let i = 0; i < PENDING_RETRIES && (response.status === 202 || response.status === 222); i++) {
      await new Promise((resolve) => setTimeout(resolve, PENDING_DELAY_MS))
      response = await request()
    }

    const call = { provider: "hunter", action: HUNTER_ACTIONS.verify }
    if (response.status === 202 || response.status === 222) {
      track({ ...call, success: false, creditsEstimated: null })
      throw new EnrichmentError("pending", { detail: `hunter still pending (HTTP ${response.status})` })
    }
    if (response.status !== 200) {
      track({ ...call, success: false, creditsEstimated: 0 })
      throw toError(response.status, response.body)
    }

    const data = asRecord(asRecord(response.body).data)
    const providerStatus = cleanText(data.status, 40) ?? null
    const status = providerStatus ? STATUS_MAP[providerStatus] : undefined
    if (!status) {
      // Never guess a verdict from a response we don't understand.
      track({ ...call, success: false, creditsEstimated: null })
      throw new EnrichmentError("unavailable", {
        message: "Email verification is temporarily unavailable.",
        detail: `hunter returned unrecognized status "${providerStatus}"`,
      })
    }

    // Hunter's per-verification credit cost depends on the plan, so it isn't estimated.
    track({ ...call, success: true, creditsEstimated: null })
    return {
      email,
      status,
      provider: "hunter",
      providerStatus,
      score: typeof data.score === "number" && Number.isFinite(data.score) ? Math.round(data.score) : null,
      verifiedAt: new Date().toISOString(),
    }
  },
}

/** Official verification quota from Hunter's free account endpoint; null if unavailable. */
export async function getHunterAccount() {
  const key = apiKey()
  if (!key) return null
  try {
    const { status, body } = await providerFetch(
      "hunter",
      `${BASE_URL}/account`,
      { method: "GET", headers: { "X-API-KEY": key } },
      8_000
    )
    if (status !== 200) return null
    const data = asRecord(asRecord(body).data)
    const requests = asRecord(data.requests)
    // Newer accounts report a shared "credits" pool; older ones "verifications".
    const pool = "credits" in requests ? asRecord(requests.credits) : asRecord(requests.verifications)
    const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null)
    const used = number(pool.used)
    const available = number(pool.available)
    return {
      plan: cleanText(data.plan_name, 40) ?? null,
      remaining: used !== null && available !== null ? Math.max(0, available - used) : null,
      used,
    }
  } catch {
    return null
  }
}
