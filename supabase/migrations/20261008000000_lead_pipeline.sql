-- Syncognix Leads — Step 5: pipeline, lists, tags, notes, follow-ups, activity
-- Run in Supabase Dashboard → SQL Editor, or with `supabase db push`.
-- Requires the Step 3 (20261003) and Step 4 (20261007) migrations.
-- Additive and safe to re-run: no existing column or row is changed or removed.

-- 1. Leads: pipeline fields --------------------------------------------------
alter table public.leads
  add column if not exists pipeline_stage  text not null default 'new',
  add column if not exists priority        text not null default 'medium',
  -- Last communication outcome; separate from the sales stage above.
  add column if not exists contact_status  text not null default 'not_contacted',
  add column if not exists follow_up_at    timestamptz,
  add column if not exists follow_up_note  text,
  -- Ready for teams later; for now a user can only assign a lead to themselves.
  add column if not exists assigned_to     uuid references auth.users (id) on delete set null,
  add column if not exists is_archived     boolean not null default false,
  add column if not exists archived_at     timestamptz,
  -- Optional, for future CRM use.
  add column if not exists estimated_value numeric(12, 2),
  add column if not exists actual_value    numeric(12, 2),
  add column if not exists currency        text not null default 'USD',
  -- Step 3 prospect score, stored so leads can be sorted and filtered by it.
  add column if not exists prospect_score  smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_pipeline_stage_check') then
    alter table public.leads add constraint leads_pipeline_stage_check check (pipeline_stage in
      ('new', 'qualified', 'ready_for_outreach', 'contacted', 'follow_up', 'interested', 'proposal', 'won', 'lost'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_priority_check') then
    alter table public.leads add constraint leads_priority_check check (priority in ('low', 'medium', 'high', 'urgent'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_contact_status_check') then
    alter table public.leads add constraint leads_contact_status_check check (contact_status in
      ('not_contacted', 'email_sent', 'called', 'replied', 'no_response', 'invalid_contact'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_prospect_score_check') then
    alter table public.leads add constraint leads_prospect_score_check check (prospect_score between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_follow_up_note_check') then
    alter table public.leads add constraint leads_follow_up_note_check check (char_length(follow_up_note) <= 300);
  end if;
end $$;

create index if not exists leads_user_stage_idx
  on public.leads (user_id, is_archived, pipeline_stage);
create index if not exists leads_user_priority_idx
  on public.leads (user_id, priority);
create index if not exists leads_user_follow_up_idx
  on public.leads (user_id, follow_up_at) where follow_up_at is not null;
create index if not exists leads_user_archived_created_idx
  on public.leads (user_id, is_archived, created_at desc);

-- 2. Lists -------------------------------------------------------------------
create table if not exists public.lead_lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (char_length(description) <= 300),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.lead_lists is 'User-defined lists of saved leads (campaign, service, location…).';

-- One list per name per user, whatever the capitalization.
create unique index if not exists lead_lists_user_name_unique
  on public.lead_lists (user_id, lower(btrim(name)));

-- A lead is linked to a list, never copied into it.
create table if not exists public.lead_list_members (
  id       uuid primary key default gen_random_uuid(),
  list_id  uuid not null references public.lead_lists (id) on delete cascade,
  lead_id  uuid not null references public.leads (id) on delete cascade,
  user_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  constraint lead_list_members_unique unique (list_id, lead_id)
);

create index if not exists lead_list_members_lead_idx on public.lead_list_members (lead_id);
create index if not exists lead_list_members_user_idx on public.lead_list_members (user_id);

-- 3. Tags --------------------------------------------------------------------
create table if not exists public.tags (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);

create unique index if not exists tags_user_name_unique
  on public.tags (user_id, lower(btrim(name)));

create table if not exists public.lead_tags (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads (id) on delete cascade,
  tag_id     uuid not null references public.tags (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint lead_tags_unique unique (lead_id, tag_id)
);

create index if not exists lead_tags_tag_idx on public.lead_tags (tag_id);
create index if not exists lead_tags_user_idx on public.lead_tags (user_id);

-- 4. Notes (each note is its own row: notes never overwrite one another) ------
create table if not exists public.lead_notes (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  content    text not null check (char_length(btrim(content)) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lead_notes_lead_idx on public.lead_notes (lead_id, created_at desc);
create index if not exists lead_notes_user_idx on public.lead_notes (user_id);

-- 5. Activity history --------------------------------------------------------
create table if not exists public.lead_activity (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  action     text not null,                 -- e.g. 'stage_changed'
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.lead_activity is
  'Append-only history of what happened to each lead. Written by triggers, so it can''t drift from the data.';

create index if not exists lead_activity_lead_idx on public.lead_activity (lead_id, created_at desc);
create index if not exists lead_activity_user_idx on public.lead_activity (user_id, created_at desc);

-- 6. Row Level Security: every row belongs to exactly one user -----------------
alter table public.lead_lists        enable row level security;
alter table public.lead_list_members enable row level security;
alter table public.tags              enable row level security;
alter table public.lead_tags         enable row level security;
alter table public.lead_notes        enable row level security;
alter table public.lead_activity     enable row level security;

-- lead_lists
drop policy if exists "Users can view their own lists" on public.lead_lists;
create policy "Users can view their own lists" on public.lead_lists for select
  to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert their own lists" on public.lead_lists;
create policy "Users can insert their own lists" on public.lead_lists for insert
  to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update their own lists" on public.lead_lists;
create policy "Users can update their own lists" on public.lead_lists for update
  to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete their own lists" on public.lead_lists;
create policy "Users can delete their own lists" on public.lead_lists for delete
  to authenticated using ((select auth.uid()) = user_id);

-- lead_list_members: the list AND the lead must both be the user's own
drop policy if exists "Users can view their own list members" on public.lead_list_members;
create policy "Users can view their own list members" on public.lead_list_members for select
  to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can add their own leads to their own lists" on public.lead_list_members;
create policy "Users can add their own leads to their own lists" on public.lead_list_members for insert
  to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.lead_lists s where s.id = list_id and s.user_id = (select auth.uid()))
    and exists (select 1 from public.leads d where d.id = lead_id and d.user_id = (select auth.uid()))
  );
drop policy if exists "Users can remove their own list members" on public.lead_list_members;
create policy "Users can remove their own list members" on public.lead_list_members for delete
  to authenticated using ((select auth.uid()) = user_id);

-- tags
drop policy if exists "Users can view their own tags" on public.tags;
create policy "Users can view their own tags" on public.tags for select
  to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert their own tags" on public.tags;
create policy "Users can insert their own tags" on public.tags for insert
  to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update their own tags" on public.tags;
create policy "Users can update their own tags" on public.tags for update
  to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete their own tags" on public.tags;
create policy "Users can delete their own tags" on public.tags for delete
  to authenticated using ((select auth.uid()) = user_id);

-- lead_tags: the tag AND the lead must both be the user's own
drop policy if exists "Users can view their own lead tags" on public.lead_tags;
create policy "Users can view their own lead tags" on public.lead_tags for select
  to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can tag their own leads with their own tags" on public.lead_tags;
create policy "Users can tag their own leads with their own tags" on public.lead_tags for insert
  to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.tags g where g.id = tag_id and g.user_id = (select auth.uid()))
    and exists (select 1 from public.leads d where d.id = lead_id and d.user_id = (select auth.uid()))
  );
drop policy if exists "Users can remove their own lead tags" on public.lead_tags;
create policy "Users can remove their own lead tags" on public.lead_tags for delete
  to authenticated using ((select auth.uid()) = user_id);

-- lead_notes
drop policy if exists "Users can view their own notes" on public.lead_notes;
create policy "Users can view their own notes" on public.lead_notes for select
  to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can add notes to their own leads" on public.lead_notes;
create policy "Users can add notes to their own leads" on public.lead_notes for insert
  to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.leads d where d.id = lead_id and d.user_id = (select auth.uid()))
  );
drop policy if exists "Users can update their own notes" on public.lead_notes;
create policy "Users can update their own notes" on public.lead_notes for update
  to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete their own notes" on public.lead_notes;
create policy "Users can delete their own notes" on public.lead_notes for delete
  to authenticated using ((select auth.uid()) = user_id);

-- lead_activity: read and append only (no update or delete policy)
drop policy if exists "Users can view their own lead activity" on public.lead_activity;
create policy "Users can view their own lead activity" on public.lead_activity for select
  to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can log activity on their own leads" on public.lead_activity;
create policy "Users can log activity on their own leads" on public.lead_activity for insert
  to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.leads d where d.id = lead_id and d.user_id = (select auth.uid()))
  );

grant select, insert, update, delete on public.lead_lists, public.tags, public.lead_notes to authenticated;
grant select, insert, delete on public.lead_list_members, public.lead_tags to authenticated;
grant select, insert on public.lead_activity to authenticated;

-- 7. updated_at (set_updated_at() was created in the profiles migration) ------
drop trigger if exists lead_lists_set_updated_at on public.lead_lists;
create trigger lead_lists_set_updated_at
  before update on public.lead_lists
  for each row execute function public.set_updated_at();

drop trigger if exists lead_notes_set_updated_at on public.lead_notes;
create trigger lead_notes_set_updated_at
  before update on public.lead_notes
  for each row execute function public.set_updated_at();

-- 8. Activity triggers --------------------------------------------------------
-- History is written in the same transaction as the change it describes, so a
-- change and its history entry succeed or fail together. The functions run as
-- the calling user, so Row Level Security still applies to what they write.

create or replace function public.log_lead_activity(p_lead_id uuid, p_owner uuid, p_action text, p_metadata jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.lead_activity (lead_id, user_id, action, metadata)
  values (p_lead_id, coalesce((select auth.uid()), p_owner), p_action, coalesce(p_metadata, '{}'::jsonb));
$$;

create or replace function public.track_lead_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_lead_activity(new.id, new.user_id, 'lead_saved', '{}'::jsonb);
    return new;
  end if;

  if new.pipeline_stage is distinct from old.pipeline_stage then
    perform public.log_lead_activity(new.id, new.user_id, 'stage_changed',
      jsonb_build_object('from', old.pipeline_stage, 'to', new.pipeline_stage));
  end if;
  if new.priority is distinct from old.priority then
    perform public.log_lead_activity(new.id, new.user_id, 'priority_changed',
      jsonb_build_object('from', old.priority, 'to', new.priority));
  end if;
  if new.contact_status is distinct from old.contact_status then
    perform public.log_lead_activity(new.id, new.user_id, 'contact_status_changed',
      jsonb_build_object('from', old.contact_status, 'to', new.contact_status));
  end if;
  if new.follow_up_at is distinct from old.follow_up_at then
    if new.follow_up_at is null then
      perform public.log_lead_activity(new.id, new.user_id, 'follow_up_cleared', '{}'::jsonb);
    else
      perform public.log_lead_activity(new.id, new.user_id, 'follow_up_set',
        jsonb_build_object('at', new.follow_up_at, 'note', new.follow_up_note));
    end if;
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    perform public.log_lead_activity(new.id, new.user_id,
      case when new.assigned_to is null then 'unassigned' else 'assigned' end,
      jsonb_build_object('to', new.assigned_to));
  end if;
  if new.is_archived is distinct from old.is_archived then
    perform public.log_lead_activity(new.id, new.user_id,
      case when new.is_archived then 'lead_archived' else 'lead_restored' end, '{}'::jsonb);
  end if;
  return new;
end;
$$;

drop trigger if exists leads_track_changes on public.leads;
create trigger leads_track_changes
  after insert or update on public.leads
  for each row execute function public.track_lead_changes();

create or replace function public.track_lead_list_membership()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  member record;
  list_name text;
begin
  if tg_op = 'INSERT' then member := new; else member := old; end if;
  -- When the lead itself is being deleted there is nothing left to attach history to.
  if not exists (select 1 from public.leads d where d.id = member.lead_id) then
    return member;
  end if;
  select s.name into list_name from public.lead_lists s where s.id = member.list_id;
  perform public.log_lead_activity(member.lead_id, member.user_id,
    case when tg_op = 'INSERT' then 'list_added' else 'list_removed' end,
    jsonb_build_object('list_id', member.list_id, 'list', list_name));
  return member;
end;
$$;

drop trigger if exists lead_list_members_track on public.lead_list_members;
create trigger lead_list_members_track
  after insert or delete on public.lead_list_members
  for each row execute function public.track_lead_list_membership();

create or replace function public.track_lead_tags()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  link record;
  tag_name text;
begin
  if tg_op = 'INSERT' then link := new; else link := old; end if;
  if not exists (select 1 from public.leads d where d.id = link.lead_id) then
    return link;
  end if;
  select g.name into tag_name from public.tags g where g.id = link.tag_id;
  perform public.log_lead_activity(link.lead_id, link.user_id,
    case when tg_op = 'INSERT' then 'tag_added' else 'tag_removed' end,
    jsonb_build_object('tag_id', link.tag_id, 'tag', tag_name));
  return link;
end;
$$;

drop trigger if exists lead_tags_track on public.lead_tags;
create trigger lead_tags_track
  after insert or delete on public.lead_tags
  for each row execute function public.track_lead_tags();

create or replace function public.track_lead_notes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_lead_activity(new.lead_id, new.user_id, 'note_added', jsonb_build_object('note_id', new.id));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.content is distinct from old.content then
      perform public.log_lead_activity(new.lead_id, new.user_id, 'note_edited', jsonb_build_object('note_id', new.id));
    end if;
    return new;
  end if;
  if exists (select 1 from public.leads d where d.id = old.lead_id) then
    perform public.log_lead_activity(old.lead_id, old.user_id, 'note_deleted', jsonb_build_object('note_id', old.id));
  end if;
  return old;
end;
$$;

drop trigger if exists lead_notes_track on public.lead_notes;
create trigger lead_notes_track
  after insert or update or delete on public.lead_notes
  for each row execute function public.track_lead_notes();

-- Enrichment and analysis results are linked to leads by business id. Their
-- history entries are best-effort: a problem here must never fail a lookup
-- or an analysis, so errors are swallowed.
create or replace function public.track_lead_enrichment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  begin
    if tg_op = 'INSERT' or new.enriched_at is distinct from old.enriched_at then
      insert into public.lead_activity (lead_id, user_id, action, metadata)
      select d.id, new.user_id, 'enrichment_completed',
             jsonb_build_object('status', new.enrichment_status, 'provider', new.provider)
      from public.leads d
      where d.user_id = new.user_id and d.osm_id = new.business_id;
    end if;
    if tg_op = 'UPDATE' and new.email_verified_at is not null
       and new.email_verified_at is distinct from old.email_verified_at then
      insert into public.lead_activity (lead_id, user_id, action, metadata)
      select d.id, new.user_id, 'email_verified', jsonb_build_object('status', new.verification_status)
      from public.leads d
      where d.user_id = new.user_id and d.osm_id = new.business_id;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists lead_enrichments_track on public.lead_enrichments;
create trigger lead_enrichments_track
  after insert or update on public.lead_enrichments
  for each row execute function public.track_lead_enrichment();

create or replace function public.track_lead_analysis()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  begin
    -- Re-qualifying a stored analysis keeps analyzed_at, so it isn't logged again.
    if tg_op = 'INSERT' or new.analyzed_at is distinct from old.analyzed_at then
      insert into public.lead_activity (lead_id, user_id, action, metadata)
      select d.id, new.user_id, 'analysis_completed',
             jsonb_build_object('status', new.analysis_status, 'qualified_lead_score', new.qualified_lead_score)
      from public.leads d
      where d.user_id = new.user_id and d.osm_id = new.business_id;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists business_analyses_track on public.business_analyses;
create trigger business_analyses_track
  after insert or update on public.business_analyses
  for each row execute function public.track_lead_analysis();

-- 9. One row per lead with its contact, scores, tags and lists ----------------
-- Lets the app search, filter, sort and page leads entirely in the database.
-- security_invoker: the view runs with the caller's permissions, so the Row
-- Level Security of every underlying table applies.
drop view if exists public.lead_overview;
create view public.lead_overview
with (security_invoker = true) as
select
  l.*,
  e.enrichment_status,
  e.contact_full_name,
  e.contact_title,
  e.work_email,
  e.linkedin_url,
  e.verification_status,
  (e.contact_full_name is not null or e.contact_first_name is not null or e.contact_title is not null) as has_decision_maker,
  (e.work_email is not null) as has_email,
  a.analysis_status,
  a.website_score,
  a.seo_score,
  a.conversion_score,
  a.local_presence_score,
  a.opportunity_score,
  a.qualified_lead_score,
  a.top_opportunity,
  a.recommended_services,
  (a.id is not null) as is_analyzed,
  -- Everything Step 6 needs to write to this lead: a person, an email and a scored analysis.
  (
    (e.contact_full_name is not null or e.contact_first_name is not null or e.contact_title is not null)
    and e.work_email is not null
    and a.qualified_lead_score is not null
  ) as outreach_ready,
  case l.priority when 'urgent' then 4 when 'high' then 3 when 'medium' then 2 else 1 end as priority_rank,
  coalesce((select array_agg(m.list_id) from public.lead_list_members m where m.lead_id = l.id), '{}'::uuid[]) as list_ids,
  coalesce((select array_agg(t.tag_id) from public.lead_tags t where t.lead_id = l.id), '{}'::uuid[]) as tag_ids,
  coalesce(
    (select array_agg(g.name order by lower(g.name))
       from public.lead_tags t join public.tags g on g.id = t.tag_id
      where t.lead_id = l.id),
    '{}'::text[]
  ) as tag_names,
  -- Tag names as one string, so a text search can match them.
  (select string_agg(g.name, ' ')
     from public.lead_tags t join public.tags g on g.id = t.tag_id
    where t.lead_id = l.id) as tags_text
from public.leads l
left join public.lead_enrichments e on e.user_id = l.user_id and e.business_id = l.osm_id
left join public.business_analyses a on a.user_id = l.user_id and a.business_id = l.osm_id;

comment on view public.lead_overview is
  'Saved leads joined with their decision maker, analysis scores, tags and lists. Read-only.';

grant select on public.lead_overview to authenticated;

-- 10. Counts for the pipeline board and the dashboard ------------------------
create or replace function public.lead_pipeline_counts()
returns table (pipeline_stage text, total bigint)
language sql
stable
set search_path = ''
as $$
  select d.pipeline_stage, count(*)
  from public.leads d
  where d.user_id = (select auth.uid()) and not d.is_archived
  group by d.pipeline_stage;
$$;

grant execute on function public.lead_pipeline_counts() to authenticated;

create or replace function public.lead_list_counts()
returns table (list_id uuid, total bigint)
language sql
stable
set search_path = ''
as $$
  select m.list_id, count(*)
  from public.lead_list_members m
  where m.user_id = (select auth.uid())
  group by m.list_id;
$$;

grant execute on function public.lead_list_counts() to authenticated;

-- Make the new view and functions visible to the API straight away.
notify pgrst, 'reload schema';
