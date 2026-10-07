import { BlockList, isIP } from "node:net"

/*
 * SSRF protection, part 1: which URLs and IP addresses may be requested.
 * The website address of a business reaches the server from the browser, so
 * it is treated as hostile input. Part 2 (website-fetcher.ts) applies
 * isBlockedAddress() to the address a connection is actually made to.
 */

const blocked = new BlockList()

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], // "this" network, incl. 0.0.0.0
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. broadcast
]

const BLOCKED_V6: [string, number][] = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local, incl. fd00:ec2::254 metadata
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
]

for (const [network, prefix] of BLOCKED_V4) blocked.addSubnet(network, prefix, "ipv4")
for (const [network, prefix] of BLOCKED_V6) blocked.addSubnet(network, prefix, "ipv6")

/**
 * True for loopback, private, link-local, metadata and other non-public addresses.
 * IPv4-mapped IPv6 ("::ffff:127.0.0.1") is matched against the IPv4 rules by BlockList itself.
 */
export function isBlockedAddress(address: string) {
  const family = isIP(address)
  if (family === 4) return blocked.check(address, "ipv4")
  if (family === 6) return blocked.check(address, "ipv6")
  return true // not an IP address at all
}

/** Host names that never point at a public website. */
const BLOCKED_HOST_SUFFIXES = [
  "localhost", "local", "localdomain", "internal", "intranet", "lan", "home", "corp",
  "private", "test", "example", "invalid", "onion", "arpa",
]

export type UrlCheck =
  | { ok: true; url: URL }
  | { ok: false; issue: "invalid_url" | "blocked_address" }

/**
 * Validates and normalizes a URL before it is requested: http/https only, no
 * credentials, default ports only, and a public host name or public IP.
 * The WHATWG URL parser already canonicalizes disguised IPs ("0x7f.1",
 * "2130706433" → "127.0.0.1"), so those are caught by the IP check.
 */
export function checkUrl(raw: string): UrlCheck {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { ok: false, issue: "invalid_url" }
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, issue: "invalid_url" }
  if (url.username || url.password) return { ok: false, issue: "invalid_url" }
  // Only the default ports (80/443): the parser leaves `port` empty for those.
  if (url.port) return { ok: false, issue: "blocked_address" }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")
  if (!host || host.length > 253) return { ok: false, issue: "invalid_url" }

  if (isIP(host)) {
    return isBlockedAddress(host) ? { ok: false, issue: "blocked_address" } : { ok: true, url }
  }

  const labels = host.split(".")
  if (BLOCKED_HOST_SUFFIXES.includes(labels[labels.length - 1])) return { ok: false, issue: "blocked_address" }
  // A public website always has a dot in its host name ("intranet" does not).
  if (labels.length < 2) return { ok: false, issue: "blocked_address" }
  if (!labels.every((label) => /^[a-z0-9_-]{1,63}$/.test(label))) return { ok: false, issue: "invalid_url" }

  url.hash = ""
  return { ok: true, url }
}
