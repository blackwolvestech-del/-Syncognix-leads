-- Syncognix Leads — Step 4: business analysis (website, SEO, conversion, qualification)
-- Run in Supabase Dashboard → SQL Editor, or with `supabase db push`.
-- Additive and safe to re-run: no existing table, column or row is changed or removed.

-- One row per user per business. Linked to leads and enrichments by
-- business_id (= leads.osm_id = lead_enrichments.business_id), so a business
-- can be analyzed before or after it is saved as a lead.
create table if not exists public.business_analyses (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,

  business_id           text not null,          -- Step 2 id, e.g. 'node:123456'
  business_name         text not null,
  business_domain       text,                   -- normalized, e.g. 'abcroofing.com'

  analysis_status       text not null
                        check (analysis_status in ('complete', 'partial', 'website_unavailable', 'failed')),

  -- 0–100. NULL means "could not be measured" (never stored as 0).
  website_score         smallint check (website_score between 0 and 100),
  seo_score             smallint check (seo_score between 0 and 100),
  conversion_score      smallint check (conversion_score between 0 and 100),
  local_presence_score  smallint check (local_presence_score between 0 and 100),
  opportunity_score     smallint check (opportunity_score between 0 and 100),
  qualified_lead_score  smallint check (qualified_lead_score between 0 and 100),

  top_opportunity       text,                   -- label of the first recommended service

  strengths             jsonb not null default '[]'::jsonb,
  weaknesses            jsonb not null default '[]'::jsonb,   -- observed gaps, with evidence
  opportunities         jsonb not null default '[]'::jsonb,   -- suggested improvements
  recommended_services  jsonb not null default '[]'::jsonb,
  flags                 jsonb not null default '[]'::jsonb,
  analysis_data         jsonb not null,         -- the full normalized analysis

  analyzed_at           timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- The same business is analyzed at most once per user; re-analysis replaces it.
  constraint business_analyses_user_business_unique unique (user_id, business_id)
);

comment on table public.business_analyses is
  'Cached business intelligence reports, so a website is not fetched again on every view.';

create index if not exists business_analyses_business_idx
  on public.business_analyses (business_id);
create index if not exists business_analyses_domain_idx
  on public.business_analyses (user_id, business_domain);
create index if not exists business_analyses_qualified_idx
  on public.business_analyses (user_id, qualified_lead_score desc nulls last);
create index if not exists business_analyses_status_idx
  on public.business_analyses (user_id, analysis_status);

alter table public.business_analyses enable row level security;

drop policy if exists "Users can view their own analyses" on public.business_analyses;
create policy "Users can view their own analyses"
  on public.business_analyses for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own analyses" on public.business_analyses;
create policy "Users can insert their own analyses"
  on public.business_analyses for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own analyses" on public.business_analyses;
create policy "Users can update their own analyses"
  on public.business_analyses for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own analyses" on public.business_analyses;
create policy "Users can delete their own analyses"
  on public.business_analyses for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- set_updated_at() was created in the profiles migration.
drop trigger if exists business_analyses_set_updated_at on public.business_analyses;
create trigger business_analyses_set_updated_at
  before update on public.business_analyses
  for each row execute function public.set_updated_at();
