import "server-only"

import type {
  BusinessDataSource,
  BusinessSearchQuery,
  BusinessSearchResult,
  BusinessSearchSuccessResponse,
} from "@/types/business"
import { buildOverpassQuery } from "./build-overpass-query"
import type { BusinessCategory } from "./category-map"
import {
  DATA_PROVIDER,
  DEFAULT_SEARCH_RADIUS_METERS,
  OVERPASS_MIN_ATTEMPT_MS,
  PARTIAL_RESULT_CACHE_TTL_MS,
  RESULT_CACHE_MAX_ENTRIES,
  RESULT_CACHE_TTL_MS,
  SEARCH_DEADLINE_MS,
} from "./constants"
import { deduplicateBusinesses } from "./deduplicate-businesses"
import { BusinessSearchError, logBusinessSearchError } from "./errors"
import { distanceMeters } from "./geo"
import { geocodeUsLocation } from "./geocode-us-location"
import { normalizeBusiness } from "./normalize-business"
import { resolveBusinessCategory } from "./normalize-category"
import type { OsmElement } from "./osm-element"
import { rankBusinesses } from "./rank-businesses"
import { searchNominatimBusinesses } from "./search-nominatim-businesses"
import { searchOverpass } from "./search-overpass"
import { TtlCache } from "./ttl-cache"

/** The search result before the route adds per-user data and prospect scores. */
export type BusinessSearchOutcome = Omit<
  BusinessSearchSuccessResponse,
  "businesses" | "savedOsmIds" | "enrichments"
> & { businesses: BusinessSearchResult[] }

const PARTIAL_NOTICE =
  "Some businesses may be missing because the OpenStreetMap search server is busy. Try again later for more complete results."

interface CachedResults {
  /** Ranked, deduplicated results before `limit`. */
  businesses: BusinessSearchResult[]
  sources: BusinessDataSource[]
  /** True when Overpass (the fuller source) contributed, so any limit can be served. */
  complete: boolean
  notice?: string
}

const resultCache = new TtlCache<CachedResults>(RESULT_CACHE_TTL_MS, RESULT_CACHE_MAX_ENTRIES)

/**
 * Search pipeline:
 *   category → US geocode → Nominatim tag search (fast) →
 *   Overpass top-up only if Nominatim found fewer than `limit` →
 *   normalize + US filter + radius filter → rank → dedupe → limit.
 *
 * If Overpass is busy, results from Nominatim are still returned with a
 * notice. Upstream calls always run one after the other.
 */
export async function searchBusinesses(
  query: BusinessSearchQuery
): Promise<BusinessSearchOutcome> {
  // Resolve the category before any network call so unsupported types cost nothing.
  const category = resolveBusinessCategory(query.businessType)
  if (!category) {
    throw new BusinessSearchError({
      message: "This business category is not supported yet.",
      status: 422,
      code: "unsupported_category",
      service: "request",
    })
  }

  const deadline = Date.now() + SEARCH_DEADLINE_MS
  const radiusMeters = DEFAULT_SEARCH_RADIUS_METERS
  const searchLocation = await geocodeUsLocation(query.location)
  const { latitude, longitude } = searchLocation

  const cacheKey = `${category.id}|${latitude.toFixed(4)},${longitude.toFixed(4)}|${radiusMeters}`
  const cached = resultCache.get(cacheKey)
  // Partial entries (with a notice) are reused for their short TTL too, so a
  // retry doesn't wait on the same busy server again.
  const useCache =
    cached && (cached.complete || Boolean(cached.notice) || cached.businesses.length >= query.limit)

  const found = useCache
    ? { ...cached, fromCache: true }
    : {
        ...(await collectBusinesses(category, latitude, longitude, radiusMeters, query.limit, deadline)),
        fromCache: false,
      }

  if (!useCache) {
    const { businesses, sources, complete, notice } = found
    resultCache.set(
      cacheKey,
      { businesses, sources, complete, notice },
      notice ? PARTIAL_RESULT_CACHE_TTL_MS : RESULT_CACHE_TTL_MS
    )
  }

  const businesses = found.businesses.slice(0, query.limit)

  return {
    success: true,
    query: { ...query, normalizedBusinessType: category.id },
    searchLocation,
    count: businesses.length,
    businesses,
    meta: {
      provider: DATA_PROVIDER,
      radiusMeters,
      resultsBeforeLimit: found.businesses.length,
      sources: found.sources,
      cached: found.fromCache,
      ...(found.notice ? { notice: found.notice } : {}),
    },
  }
}

async function collectBusinesses(
  category: BusinessCategory,
  latitude: number,
  longitude: number,
  radiusMeters: number,
  limit: number,
  deadline: number
) {
  const toResults = (elements: OsmElement[]) =>
    elements
      .map((element) => normalizeBusiness(element, category.id))
      .filter((business): business is BusinessSearchResult => business !== null)
      .filter(
        (business) =>
          business.latitude === null ||
          business.longitude === null ||
          distanceMeters(latitude, longitude, business.latitude, business.longitude) <= radiusMeters
      )

  const sources: BusinessDataSource[] = []
  let failure: BusinessSearchError | undefined
  let results: BusinessSearchResult[] = []

  // 1. Nominatim: fast, but its tag search can miss some businesses.
  try {
    const elements = await searchNominatimBusinesses(category, latitude, longitude, radiusMeters, limit)
    results = toResults(elements)
    sources.push("nominatim")
  } catch (error) {
    if (!(error instanceof BusinessSearchError)) throw error
    logBusinessSearchError(error)
    failure = error
  }

  // 2. Overpass: fuller but often slow; only when we still need more.
  let complete = false
  if (results.length < limit && deadline - Date.now() >= OVERPASS_MIN_ATTEMPT_MS) {
    try {
      const elements = await searchOverpass(
        buildOverpassQuery(category, latitude, longitude, radiusMeters),
        deadline
      )
      results = [...results, ...toResults(elements)]
      sources.push("overpass")
      complete = true
    } catch (error) {
      if (!(error instanceof BusinessSearchError)) throw error
      logBusinessSearchError(error)
      failure = error
    }
  }

  const needsMore = results.length < limit && !complete
  if (results.length === 0 && failure) throw failure

  return {
    businesses: deduplicateBusinesses(rankBusinesses(results, latitude, longitude)),
    sources,
    complete,
    // Only warn when a source actually failed and the list may be short.
    notice: failure && needsMore ? PARTIAL_NOTICE : undefined,
  }
}
