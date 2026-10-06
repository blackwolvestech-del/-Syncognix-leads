import "server-only"

import { hunter } from "./hunter"
import { prospeo } from "./prospeo"
import type { EmailVerifier, EnrichmentProvider } from "./types"

/*
 * The provider chain. Lookups try each configured provider in order and stop
 * at the first that finds someone:
 *
 *   Supabase cache → Prospeo → (future: Apollo → People Data Labs)
 *
 * To add a provider: implement EnrichmentProvider in its own file and append
 * it here. Nothing else in the app needs to change.
 */
const ENRICHMENT_PROVIDERS: readonly EnrichmentProvider[] = [prospeo]

const EMAIL_VERIFIER: EmailVerifier = hunter

export function getEnrichmentProviders() {
  return ENRICHMENT_PROVIDERS
}

export function getEmailVerifier() {
  return EMAIL_VERIFIER
}

/** Which providers have API keys, for the UI. Never returns the keys themselves. */
export function getProviderStatus() {
  return {
    prospeo: prospeo.isConfigured(),
    hunter: hunter.isConfigured(),
  }
}
