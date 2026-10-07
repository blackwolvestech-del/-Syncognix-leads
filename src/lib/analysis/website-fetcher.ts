import "server-only"

import { lookup as dnsLookup } from "node:dns"
import http from "node:http"
import https from "node:https"
import type { LookupFunction } from "node:net"
import zlib from "node:zlib"
import type { WebsiteIssue } from "@/types/analysis"
import { ANALYSIS_CONFIG } from "./config"
import { checkUrl, isBlockedAddress } from "./url-safety"

/*
 * Fetches one public web page for analysis. Server-side only.
 *
 * Safety:
 *   - every URL (including each redirect target) passes checkUrl()
 *   - the DNS answer is checked inside the socket's own lookup, so the
 *     address that was validated is the address that is connected to
 *     (a host can't pass the check and then resolve somewhere private)
 *   - redirects are followed by hand, with a limit
 *   - one hard timeout, and a cap on how much of the body is read
 *
 * Politeness: a clear User-Agent, robots.txt honored, one page request,
 * few requests at once, and no attempt to get past logins, bot checks or
 * CAPTCHAs — a site that refuses us is reported as unavailable.
 */

const { fetch: FETCH } = ANALYSIS_CONFIG

export interface FetchedPage {
  requestedUrl: string
  finalUrl: string
  statusCode: number
  redirectCount: number
  contentType: string | null
  responseTimeMs: number
  httpRedirectsToHttps: boolean | null
  html: string
  htmlBytes: number
  truncated: boolean
}

export type FetchOutcome =
  | { ok: true; page: FetchedPage }
  | { ok: false; issue: WebsiteIssue; statusCode?: number }

class FetchFailure extends Error {
  constructor(
    readonly issue: WebsiteIssue,
    readonly statusCode?: number
  ) {
    super(issue)
  }
}

/** DNS lookup that refuses any host with a non-public address. */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true }, (error, addresses) => {
    if (error) return callback(error, "", 0)
    if (addresses.length === 0 || addresses.some((entry) => isBlockedAddress(entry.address))) {
      const blockedError: NodeJS.ErrnoException = new Error("Address not allowed")
      blockedError.code = "EBLOCKED"
      return callback(blockedError, "", 0)
    }
    if (options.all) return callback(null, addresses)
    callback(null, addresses[0].address, addresses[0].family)
  })
}

const SSL_CODE = /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME|EPROTO/
const DNS_CODES = new Set(["ENOTFOUND", "ENOENT", "EAI_AGAIN", "ENODATA", "EAI_FAIL", "ESERVFAIL"])

function toFailure(error: unknown): FetchFailure {
  if (error instanceof FetchFailure) return error
  const { code = "", name = "" } = (error ?? {}) as NodeJS.ErrnoException
  if (code === "EBLOCKED") return new FetchFailure("blocked_address")
  if (DNS_CODES.has(code)) return new FetchFailure("dns_failure")
  if (name === "AbortError" || name === "TimeoutError" || code === "ABORT_ERR" || code === "ETIMEDOUT") {
    return new FetchFailure("timeout")
  }
  if (SSL_CODE.test(code)) return new FetchFailure("ssl_error")
  return new FetchFailure("connection_failed")
}

interface RawResponse {
  status: number
  headers: http.IncomingHttpHeaders
  body: Buffer
  truncated: boolean
  responseTimeMs: number
}

function decoderFor(encoding: string | undefined) {
  switch (encoding?.trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return zlib.createGunzip()
    case "deflate":
      return zlib.createInflate()
    case "br":
      return zlib.createBrotliDecompress()
    default:
      return null
  }
}

/**
 * One GET request, no redirect following. The body is only read for 2xx
 * responses whose content type `wantsBody` accepts, and never beyond `maxBytes`.
 */
function requestOnce(
  url: URL,
  options: { timeoutMs: number; maxBytes: number; wantsBody: (contentType: string) => boolean }
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    let settled = false
    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      action()
      request.destroy()
    }

    const transport = url.protocol === "https:" ? https : http
    const request = transport.request(
      url,
      {
        method: "GET",
        // A fresh connection per request, so the checked lookup always runs.
        agent: false,
        lookup: safeLookup,
        signal: AbortSignal.timeout(options.timeoutMs),
        headers: {
          "User-Agent": FETCH.userAgent,
          Accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5,*/*;q=0.1",
          "Accept-Language": "en-US,en;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0
        const base = { status, headers: response.headers, responseTimeMs: Date.now() - started }
        const contentType = String(response.headers["content-type"] ?? "")
        const empty = () => finish(() => resolve({ ...base, body: Buffer.alloc(0), truncated: false }))

        if (status < 200 || status >= 300 || !options.wantsBody(contentType)) return empty()

        const decoder = decoderFor(String(response.headers["content-encoding"] ?? ""))
        const stream = decoder ? response.pipe(decoder) : response
        const chunks: Buffer[] = []
        let size = 0
        const done = (truncated: boolean) =>
          finish(() => resolve({ ...base, body: Buffer.concat(chunks), truncated }))

        stream.on("data", (chunk: Buffer) => {
          const room = options.maxBytes - size
          if (chunk.length >= room) {
            chunks.push(chunk.subarray(0, room))
            size += room
            return done(chunk.length > room)
          }
          chunks.push(chunk)
          size += chunk.length
        })
        stream.on("end", () => done(false))
        // A broken body still leaves whatever arrived before it.
        const onError = (error: unknown) => (size > 0 ? done(true) : finish(() => reject(toFailure(error))))
        stream.on("error", onError)
        if (decoder) response.on("error", onError)
      }
    )
    request.on("error", (error) => finish(() => reject(toFailure(error))))
    request.end()
  })
}

// --- robots.txt --------------------------------------------------------------

function robotsPattern(path: string) {
  const anchored = path.endsWith("$")
  const body = (anchored ? path.slice(0, -1) : path)
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*")
  return new RegExp(`^${body}${anchored ? "$" : ""}`)
}

/** True when robots.txt lets our crawler fetch `path`. Longest matching rule wins. */
export function robotsAllows(robotsTxt: string, path: string, token: string = FETCH.robotsToken) {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = []
  let current: (typeof groups)[number] | null = null
  let readingAgents = false

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim()
    const separator = line.indexOf(":")
    if (separator < 1) continue
    const field = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()

    if (field === "user-agent") {
      if (!current || !readingAgents) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      readingAgents = true
    } else if ((field === "allow" || field === "disallow") && current) {
      readingAgents = false
      if (value) current.rules.push({ allow: field === "allow", path: value })
    } else {
      readingAgents = false
    }
  }

  const name = token.toLowerCase()
  const own = groups.filter((group) => group.agents.some((agent) => agent !== "*" && name.includes(agent)))
  const applicable = own.length ? own : groups.filter((group) => group.agents.includes("*"))

  let best: { allow: boolean; length: number } | null = null
  for (const rule of applicable.flatMap((group) => group.rules)) {
    if (rule.path.length > 2_000 || !robotsPattern(rule.path).test(path)) continue
    if (!best || rule.path.length > best.length || (rule.path.length === best.length && rule.allow)) {
      best = { allow: rule.allow, length: rule.path.length }
    }
  }
  return best ? best.allow : true
}

/** A missing, unreadable or oversized robots.txt places no restriction. */
async function allowedByRobots(url: URL, timeoutMs: number) {
  if (!FETCH.respectRobotsTxt) return true
  try {
    const response = await requestOnce(new URL("/robots.txt", url.origin), {
      timeoutMs: Math.min(FETCH.robotsTimeoutMs, timeoutMs),
      maxBytes: FETCH.maxRobotsBytes,
      wantsBody: (contentType) => !/html/i.test(contentType),
    })
    if (response.status !== 200 || response.truncated || response.body.length === 0) return true
    return robotsAllows(response.body.toString("utf8"), url.pathname + url.search)
  } catch (error) {
    // An unsafe address must still stop the fetch; anything else means "no rules".
    if (toFailure(error).issue === "blocked_address") throw toFailure(error)
    return true
  }
}

// --- page fetch --------------------------------------------------------------

const HTML_TYPE = /^(text\/html|application\/xhtml\+xml)\b/i
/** Statuses that mean "we don't want automated visitors here" — respected, never worked around. */
const DENIED_STATUSES = new Set([401, 403, 407, 429, 451])

function decodeHtml(body: Buffer, contentType: string) {
  const declared =
    /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(body.subarray(0, 2_048).toString("latin1"))?.[1]
  try {
    return new TextDecoder(declared ?? "utf-8").decode(body)
  } catch {
    return new TextDecoder("utf-8").decode(body)
  }
}

async function fetchPageUnlimited(rawUrl: string): Promise<FetchOutcome> {
  const first = checkUrl(rawUrl)
  if (!first.ok) return { ok: false, issue: first.issue }

  const deadline = Date.now() + FETCH.totalTimeoutMs
  const remaining = () => {
    const left = deadline - Date.now()
    if (left <= 0) throw new FetchFailure("timeout")
    return Math.min(FETCH.timeoutMs, left)
  }

  try {
    let url = first.url
    const visited = new Set<string>()
    const robotsChecked = new Set<string>()

    for (let redirectCount = 0; ; redirectCount++) {
      if (redirectCount > FETCH.maxRedirects || visited.has(url.href)) {
        throw new FetchFailure("too_many_redirects")
      }
      visited.add(url.href)

      if (!robotsChecked.has(url.origin)) {
        robotsChecked.add(url.origin)
        if (!(await allowedByRobots(url, remaining()))) throw new FetchFailure("robots_disallowed")
      }

      const response = await requestOnce(url, {
        timeoutMs: remaining(),
        maxBytes: FETCH.maxHtmlBytes,
        wantsBody: (contentType) => HTML_TYPE.test(contentType.trim()),
      })
      const { status, headers } = response

      if (status >= 300 && status < 400 && headers.location) {
        let target: URL
        try {
          target = new URL(headers.location, url)
        } catch {
          throw new FetchFailure("http_error", status)
        }
        // Each redirect target is validated like the original URL.
        const next = checkUrl(target.href)
        if (!next.ok) throw new FetchFailure(next.issue)
        url = next.url
        continue
      }

      const challenged = headers["cf-mitigated"] === "challenge"
      if (DENIED_STATUSES.has(status) || challenged) throw new FetchFailure("access_denied", status)
      if (status < 200 || status >= 300) throw new FetchFailure("http_error", status)

      const contentType = String(headers["content-type"] ?? "").trim()
      if (!HTML_TYPE.test(contentType)) throw new FetchFailure("not_html", status)

      const requested = first.url
      return {
        ok: true,
        page: {
          requestedUrl: requested.href,
          finalUrl: url.href,
          statusCode: status,
          redirectCount,
          contentType: contentType || null,
          responseTimeMs: response.responseTimeMs,
          httpRedirectsToHttps: requested.protocol === "http:" ? url.protocol === "https:" : null,
          html: decodeHtml(response.body, contentType),
          htmlBytes: response.body.length,
          truncated: response.truncated,
        },
      }
    }
  } catch (error) {
    const failure = toFailure(error)
    return { ok: false, issue: failure.issue, statusCode: failure.statusCode }
  }
}

// A small process-wide queue, so bulk runs from several users stay gentle.
let active = 0
const waiting: (() => void)[] = []

/** Fetches a page safely. Never throws: failures come back as an issue code. */
export async function fetchPage(rawUrl: string): Promise<FetchOutcome> {
  if (active >= FETCH.maxConcurrentRequests) await new Promise<void>((resolve) => waiting.push(resolve))
  else active++
  try {
    return await fetchPageUnlimited(rawUrl)
  } finally {
    const next = waiting.shift()
    if (next) next()
    else active--
  }
}
