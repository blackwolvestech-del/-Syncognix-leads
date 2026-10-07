"use client"

import { useEffect } from "react"
import { TIME_ZONE_COOKIE } from "@/lib/pipeline/follow-up"

/**
 * Remembers the browser's time zone in a cookie, so the server's follow-up
 * filters and counts ("due today") use the user's day, not the server's.
 * Until it is set (the very first page load) the server falls back to UTC.
 */
export function TimeZoneCookie() {
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!zone || document.cookie.includes(`${TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}`)) return
    document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax`
  }, [])
  return null
}
