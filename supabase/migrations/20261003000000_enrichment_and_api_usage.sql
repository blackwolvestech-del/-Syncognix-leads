-- Syncognix Leads — Step 3: decision-maker enrichment, email verification, API usage
-- Run in Supabase Dashboard → SQL Editor, or with `supabase db push`.
-- Additive and safe to re-run: no existing table, column or row is changed or removed.

-- 1. Leads: remember whether OpenStreetMap listed a chain/brand -------------
-- (used by the prospect score; null = unknown for leads saved before Step 3)
alter table public.leads
  add column if not exists is_chain boolean;

-- 2. Enrichment cache --------------------------------------------------------
-- One row per user per business. Linked to leads by business_id = leads.osm_id,
-- so a business can be enriched before or after it is saved as a lead.
create table if not exists public.lead_enrichments (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- The business that was looked up
  business_id         text not null,          -- Step 2 id, e.g. 'node:123456'
  business_name       text not null,
  business_name_key   text not null,          -- normalized name, for cache matching
  business_domain     text,                   -- normalized, e.g. 'abcroofing.com'
  business_city       text,
  business_state      text,                   -- USPS code when known, e.g. 'TX'

  -- Result
  provider            text not null,          -- e.g. 'prospeo'
  enrichment_status   text not null
                      check (enrichment_status in ('enriched', 'partial', 'no_match')),
  provider_person_id  text,

  contact_first_name  text,
  contact_last_name   text,
  contact_full_name   text,
  contact_title       text,
  contact_seniority   text,
  linkedin_url        text,

  work_email          text,                   -- lowercase
  email_status        text,                   -- the enrichment provider's own status

  prospect_score      smallint check (prospect_score between 0 and 100),

  -- Email verification (only ever set by a manual verification)
  verification_status          text
                               check (verification_status in ('deliverable', 'risky', 'invalid', 'unknown')),
  verification_provider        text,          -- e.g. 'hunter'
  verification_provider_status text,          -- the verifier's own wording
  verification_score           smallint,
  email_verified_at            timestamptz,

  enriched_at         timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- The same business is enriched at most once per user.
  constraint lead_enrichments_user_business_unique unique (user_id, business_id)
);

comment on table public.lead_enrichments is
  'Cached decision-maker lookups and email verifications, so provider credits are never spent twice.';

create index if not exists lead_enrichments_domain_idx
  on public.lead_enrichments (user_id, business_domain);
create index if not exists lead_enrichments_name_idx
  on public.lead_enrichments (user_id, business_name_key, business_state);
create index if not exists lead_enrichments_email_idx
  on public.lead_enrichments (user_id, work_email);
create index if not exists lead_enrichments_status_idx
  on public.lead_enrichments (user_id, enrichment_status);

alter table public.lead_enrichments enable row level security;

drop policy if exists "Users can view their own enrichments" on public.lead_enrichments;
create policy "Users can view their own enrichments"
  on public.lead_enrichments for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own enrichments" on public.lead_enrichments;
create policy "Users can insert their own enrichments"
  on public.lead_enrichments for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own enrichments" on public.lead_enrichments;
create policy "Users can update their own enrichments"
  on public.lead_enrichments for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own enrichments" on public.lead_enrichments;
create policy "Users can delete their own enrichments"
  on public.lead_enrichments for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- set_updated_at() was created in the profiles migration.
drop trigger if exists lead_enrichments_set_updated_at on public.lead_enrichments;
create trigger lead_enrichments_set_updated_at
  before update on public.lead_enrichments
  for each row execute function public.set_updated_at();

-- 3. API usage log -----------------------------------------------------------
-- One row per call made to an enrichment/verification provider.
create table if not exists public.api_usage (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider          text not null,            -- 'prospeo' | 'hunter'
  action            text not null,            -- e.g. 'prospeo_decision_maker_search'
  business_id       text,
  email             text,
  success           boolean not null,
  -- Only set when the provider's documented rules make it certain.
  credits_estimated smallint,
  created_at        timestamptz not null default now()
);

comment on table public.api_usage is
  'Syncognix''s own count of provider API calls. Not the provider''s official balance.';

create index if not exists api_usage_user_created_idx
  on public.api_usage (user_id, created_at desc);
create index if not exists api_usage_provider_idx
  on public.api_usage (user_id, provider, created_at desc);

alter table public.api_usage enable row level security;

drop policy if exists "Users can view their own API usage" on public.api_usage;
create policy "Users can view their own API usage"
  on public.api_usage for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own API usage" on public.api_usage;
create policy "Users can insert their own API usage"
  on public.api_usage for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
