/*
 * Follow-up timing. A follow-up is only stored and surfaced; nothing is sent
 * or scheduled. "Today" depends on where the user is, so buckets are computed
 * from day boundaries in the user's time zone.
 */

export type FollowUpBucket = "overdue" | "today" | "tomorrow" | "upcoming"

export const FOLLOW_UP_LABELS: Record<FollowUpBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  upcoming: "Upcoming",
}

/** Cookie holding the browser's IANA time zone, so server-side filters match the user's day. */
export const TIME_ZONE_COOKIE = "sl_tz"

export function isTimeZone(value: string | undefined): value is string {
  if (!value || value.length > 64) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** Minutes the zone is ahead of UTC at `date`. */
function offsetMinutes(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"))
  return Math.round((asUtc - date.getTime()) / 60_000)
}

export interface DayBounds {
  /** Start of today, tomorrow and the day after, in the user's zone. */
  today: Date
  tomorrow: Date
  dayAfter: Date
}

/** Day boundaries around `now` in `timeZone` (UTC when the zone is unknown). */
export function dayBounds(timeZone: string | undefined, now: Date = new Date()): DayBounds {
  const zone = isTimeZone(timeZone) ? timeZone : "UTC"
  const startOfDay = (reference: Date) => {
    const local = new Date(reference.getTime() + offsetMinutes(reference, zone) * 60_000)
    const midnightAsUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
    // The offset at midnight can differ from now's on a daylight-saving day.
    const guess = new Date(midnightAsUtc - offsetMinutes(reference, zone) * 60_000)
    return new Date(midnightAsUtc - offsetMinutes(guess, zone) * 60_000)
  }
  const today = startOfDay(now)
  // 36h and 60h later always land inside the next two days, whatever the DST shift.
  const tomorrow = startOfDay(new Date(today.getTime() + 36 * 3_600_000))
  const dayAfter = startOfDay(new Date(today.getTime() + 60 * 3_600_000))
  return { today, tomorrow, dayAfter }
}

export function followUpBucket(followUpAt: string | null, bounds: DayBounds): FollowUpBucket | null {
  if (!followUpAt) return null
  const time = new Date(followUpAt).getTime()
  if (Number.isNaN(time)) return null
  if (time < bounds.today.getTime()) return "overdue"
  if (time < bounds.tomorrow.getTime()) return "today"
  if (time < bounds.dayAfter.getTime()) return "tomorrow"
  return "upcoming"
}

/** "2026-10-12T10:00" (a datetime-local value, in the browser's zone) for an ISO timestamp. */
export function toLocalInputValue(iso: string | null) {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
