# Step 3 — Prospect scoring, decision makers and email verification

Step 3 adds a free enrichment layer on top of the Step 2 business search.

```text
Step 2 Business Search          (free, OpenStreetMap)
        ↓
Prospect Score                  (free, computed from Step 2 data)
        ↓
Manual Selection                (user picks businesses)
        ↓
Prospeo                         (only after "Find Decision Maker")
        ↓
Decision Maker + Work Email
        ↓
Manual Email Selection          (user picks emails)
        ↓
Hunter                          (only after "Verify Email")
        ↓
Verified Lead
        ↓
Supabase Cache                  (every result is stored and reused)
```

## Principles

- **API calls happen only after a manual action.** Searching, opening a page or saving a lead
  never calls Prospeo or Hunter. The only entry points are the two enrichment API routes, and
  they are only called from button clicks (bulk actions ask for confirmation first).
- **Cached data prevents repeated API usage.** Every result is stored in Supabase and looked up
  before any provider is called.
- **Direct mobile enrichment is disabled.** `enrich_mobile` is always `false` and mobile fields in
  provider responses are ignored. Only the decision maker, their professional email, their
  LinkedIn profile and the business phone from Step 2 are used.
- **Paid providers are not included.** Apollo and People Data Labs are not integrated. The
  provider layer is ready for them (see "Adding a provider").
- **No fake data.** Without API keys the features report "not configured"; there are no mock
  contacts.

## Configuration

Add to `.env.local` (and to your host's environment variables when deploying), then restart:

| Variable | Used by | Purpose |
| --- | --- | --- |
| `PROSPEO_API_KEY` | `src/lib/enrichment/prospeo.ts` | Finds the decision maker and work email |
| `HUNTER_API_KEY` | `src/lib/enrichment/hunter.ts` | Verifies an email on request |

Both are server-side only. Never prefix them with `NEXT_PUBLIC_`, and never commit real keys.
Each is optional: a missing key only disables its own feature, with a clear message.

Run the migration `supabase/migrations/20261003000000_enrichment_and_api_usage.sql` in the
Supabase SQL Editor. It is additive: it creates `lead_enrichments` and `api_usage` and adds one
nullable column (`leads.is_chain`). No existing table, column or row is changed.

## Prospect score

`src/lib/scoring/prospect-score.ts` — a pure function returning `{ score, reasons, opportunities }`.

It scores how suitable a business looks as an outreach target, using only data Step 2 really
has. It is **not** a purchase or conversion probability.

| Signal | Points |
| --- | --- |
| Website on its own domain | 40 |
| …or only a social/directory page (Facebook, Yelp…) | 15 |
| Business phone | 15 |
| Both a website and a phone | 10 |
| Street address | 10 |
| City and state | 5 |
| No chain/brand listed in OpenStreetMap | 20 |

Tiers: 80–100 High potential, 60–79 Moderate potential, 0–59 Lower potential. Weights and tiers
are constants at the top of the file.

Not scored, because OpenStreetMap doesn't provide it: Google rating, review count, "business
appears active", and any website/SEO quality diagnosis. Category and location are not scored
either, because the search already guarantees them. Opportunities are only listed when the data
shows them: no website listed, a social page used as the website, or a non-HTTPS website address.

## Provider layer

```text
src/lib/enrichment/
  types.ts           provider-neutral contracts and user-safe errors
  provider.ts        the provider chain (which providers, in which order)
  prospeo.ts         Prospeo implementation of EnrichmentProvider
  hunter.ts          Hunter implementation of EmailVerifier
  decision-maker.ts  title priority (Owner → Founder → … → General Manager → other senior)
  normalize.ts       domain / company name / email normalization
  cache.ts           Supabase cache reads and writes
  usage.ts           api_usage logging and the monthly summary
  service.ts         cache → provider → store → log (the only place providers are called)
  rate-limit.ts      per-user limit on the enrichment routes
  http.ts            fetch with a hard timeout; request throttle
```

The UI and the routes only see the normalized shapes in `src/types/enrichment.ts`; no raw
provider JSON leaves `prospeo.ts` or `hunter.ts`.

### Prospeo

Two calls per business ([API docs](https://prospeo.io/api-docs)):

1. `POST /search-person` — senior people at the company, filtered by the company's root domain
   (or by company name when the business has no own domain). 1 credit when it returns results;
   nothing when it returns none.
2. `POST /enrich-person` — reveals the chosen person's work email. 1 credit when an email is
   found; nothing on no match.

The strongest decision maker is chosen by title: Owner, Founder, Co-Founder, President, CEO,
Managing Member, Managing Partner, Principal, General Manager, then other senior people by
seniority. Results whose company doesn't match the business (different domain; or, for name
searches, a different name or state) are discarded.

Outcomes: `enriched` (person + email), `partial` (person, no email), `no_match`. Failures are not
stored.

### Hunter

`GET /v2/email-verifier` ([API docs](https://hunter.io/api-documentation/v2#email-verifier)),
with the key in the `X-API-KEY` header. Hunter's status is stored as-is and mapped to four states:

| Hunter `status` | Shown as |
| --- | --- |
| `valid` | Deliverable |
| `invalid` | Invalid |
| `accept_all`, `webmail`, `disposable` | Risky |
| `unknown` | Unknown |

The address verified always comes from the user's stored enrichment, never from the request.
An email is only labelled as verified by Hunter when Hunter actually checked it; Prospeo's own
email status is shown separately as "Prospeo status".

## Cache behavior

Before Prospeo is called, `findCachedEnrichment` looks in `lead_enrichments` for the user's:

1. this exact business (business id),
2. the same normalized company domain (`https://www.abc.com/` → `abc.com`),
3. the same normalized company name in the same city/state, when domains don't conflict.

A hit returns the stored result with **zero API calls**. A hit by 2 or 3 is copied onto the new
business id so it is linked from then on. `no_match` results are also stored, and retried only
after `NO_MATCH_TTL_DAYS` (30).

Before Hunter is called, a verification of the same address newer than `VERIFICATION_TTL_DAYS`
(90) is reused — from the same business or any other business with that address. Older verdicts
are only re-checked when the user clicks Verify again; nothing is re-verified automatically.

The cache is per user (Row Level Security: `auth.uid() = user_id`). Sharing one cache across all
users would need a server-side service-role key, which the app doesn't use.

Saved leads are linked to enrichments by business id (`lead_enrichments.business_id =
leads.osm_id`), so nothing is duplicated and a business can be enriched before or after it is
saved.

## API routes

| Route | Body | Does |
| --- | --- | --- |
| `POST /api/enrichment/decision-maker` | `{ business }` | Cache lookup, then Prospeo for one business |
| `POST /api/enrichment/verify-email` | `{ businessId }` | Cache lookup, then Hunter for that business's stored email |

Both require a signed-in user (no anonymous access, even in development), validate their input,
are rate limited per user, time out provider calls, and answer with normalized JSON:
`{ success: true, enrichment, cached }` or `{ success: false, error, code, fatal }`. Provider
error text is logged on the server and never sent to the browser.

Bulk actions call the single-business route once per business, two at a time, so progress can be
shown and one failure never affects the others. A bulk run stops early only for errors that
would hit every business (missing key, rejected key, exhausted quota).

## Usage tracking

Every provider call writes a row to `api_usage` (`provider`, `action`, `business_id`, `email`,
`success`, `credits_estimated`). Actions: `prospeo_decision_maker_search`,
`prospeo_email_enrichment`, `hunter_email_verification`.

`credits_estimated` is only filled where the provider's documentation makes the cost certain
(Prospeo). It is left empty for Hunter.

Settings → Usage shows this month's counts. These are the app's own counters, not the official
provider balance; a "credits left" figure appears only when the provider's free account
endpoint reports one.

## Adding a provider

1. Create `src/lib/enrichment/<name>.ts` exporting an object that implements `EnrichmentProvider`
   (`id`, `isConfigured()`, `findDecisionMaker(input, track)`), returning a `DecisionMakerResult`.
2. Append it to `ENRICHMENT_PROVIDERS` in `provider.ts`. Providers are tried in order; the first
   to find someone wins.

Nothing else changes: the cache, routes, usage log and UI are provider-neutral.

```text
Cache → Prospeo → (Apollo → People Data Labs) → Hunter
```
