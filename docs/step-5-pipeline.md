# Step 5 — Pipeline and lead management

Step 5 turns saved leads into a lightweight outbound pipeline: lists, stages, priority, tags,
notes, follow-ups, history, bulk actions, a table and a Kanban view, and CSV export. Everything
from Steps 2–4 stays attached to each lead.

```text
Search → Prospect Score → Decision Maker + Email → Business Analysis → Qualified Lead Score
        ↓
Save / Add to List
        ↓
New → Qualified → Ready for Outreach → Contacted → Follow-Up → Interested → Proposal → Won / Lost
```

## Principles

- **The user moves leads.** Scores can suggest a stage or a priority (shown as a hint with an
  *Apply* button on the lead page); nothing changes a stage or priority automatically.
- **Leads are linked, never copied.** Lists and tags are relations to the one saved lead.
- **Archive before delete.** Archiving hides a lead and keeps everything. Permanent deletion is a
  separate, confirmed action.
- **Work happens in the database.** Search, filters, sorting and paging run in Postgres; the
  browser never holds more than one page of leads.
- **History can't drift.** Activity is written by database triggers in the same transaction as
  the change it describes.

## Setup

Run `supabase/migrations/20261008000000_lead_pipeline.sql` in the Supabase SQL Editor, after the
Step 3 and Step 4 migrations. It is additive and safe to re-run. Until it is run, the Leads page
shows a setup notice and the dashboard simply leaves out the pipeline widgets.

## Database

Added to `leads`: `pipeline_stage` (default `new`), `priority` (default `medium`),
`contact_status`, `follow_up_at`, `follow_up_note`, `assigned_to`, `is_archived`, `archived_at`,
`estimated_value`, `actual_value`, `currency`, `prospect_score`.

| Table | Purpose |
| --- | --- |
| `lead_lists` | A user's lists. One name per user (case-insensitive). |
| `lead_list_members` | Lead ↔ list. Unique on `(list_id, lead_id)`. |
| `tags` | A user's tags. One name per user (case-insensitive). |
| `lead_tags` | Lead ↔ tag. Unique on `(lead_id, tag_id)`. |
| `lead_notes` | One row per note, so notes never overwrite one another. |
| `lead_activity` | Append-only history: `action` plus `metadata` (JSONB). |

`lead_overview` is a read-only view: one row per lead with its decision maker, analysis scores,
tag and list ids, and the derived `outreach_ready` flag. It is created with
`security_invoker = true`, so the Row Level Security of every underlying table applies.

`lead_pipeline_counts()` and `lead_list_counts()` return counts for the signed-in user.

### Security

Row Level Security is on for every new table; each row has a `user_id` and is only visible to and
changeable by that user. Linking rows are checked on both sides: a lead can only be added to a
list, tagged or noted when the lead **and** the list/tag belong to the caller. `lead_activity` has
no update or delete policy. Every server action also re-reads the user from the session and
filters by `user_id`.

### Activity

Triggers record: `lead_saved`, `stage_changed`, `priority_changed`, `contact_status_changed`,
`follow_up_set` / `follow_up_cleared`, `assigned` / `unassigned`, `lead_archived` /
`lead_restored`, `list_added` / `list_removed`, `tag_added` / `tag_removed`, `note_added` /
`note_edited` / `note_deleted`, `enrichment_completed`, `email_verified`, `analysis_completed`.

The enrichment and analysis entries are best-effort: an error there is swallowed so it can never
fail a Prospeo lookup or an analysis. History starts when the migration is run; earlier events
aren't back-filled.

## Configuration

`src/lib/pipeline/config.ts` holds stages, priorities and contact statuses (stable values +
labels + styles), quick views, page size, board column limit, bulk and export limits, and the
outreach-readiness rule.

**Outreach-ready** (derived, not stored) = decision maker + professional email + a scored
analysis. Set `PIPELINE_CONFIG.outreach.minQualifiedScore` above 0 to also require a minimum
Qualified Lead Score. Leads below it are never hidden elsewhere.

## Leads page (`/leads`)

All state is in the URL, e.g. `/leads?stage=ready_for_outreach&priority=high`.

- **Quick views:** All Leads, High Potential (Qualified Lead ≥ 80), Ready for Outreach
  (outreach-ready and not yet contacted), Follow-Up Due (overdue or today), Contacted, Won, Lost.
- **Search** (debounced): business name, decision maker, email, city, state, category, tag.
- **Filters:** stage, priority, list, tag, follow-up, category, city, state, prospect score, the
  Step 4 score/contact/analysis filters, and active/archived.
- **Sort:** newest, oldest, name, qualified, prospect, opportunity, priority, follow-up date, and
  lowest website/SEO/conversion score. The last choice is remembered in a cookie.
- **Table view:** 25 per page; inline stage and priority; follow-up, tags and lists per row.
- **Pipeline view** (`?layout=pipeline`): a column per stage with counts. Cards can be dragged
  with a mouse; the *Move to* select on each card does the same for keyboard and touch. Each
  column loads its top 30 cards (by priority, then score) and links to the table for the rest.
- **Bulk actions:** stage, priority, add to list, add/remove tag, set/clear follow-up, assign to
  me/unassign, analyze, export, archive/restore, delete. Archive and delete ask first.

Stage, priority, tag and list changes show immediately and roll back if saving fails. Archive and
delete wait for the server.

Not available, because OpenStreetMap has no such data: sorting or filtering by rating or review
count.

## Lead page (`/leads/[id]`)

Business, contact and intelligence (the Step 3 and Step 4 sections, with their actions),
recommended services, a pipeline panel (stage, priority, contact status, assignee, follow-up,
tags, lists), notes (add, edit, delete) and history.

## Follow-ups

A follow-up is a date/time and an optional note. It is stored and surfaced as Overdue, Today,
Tomorrow or Upcoming; no reminder is sent. Buckets use the user's own day: the browser's time
zone is kept in the `sl_tz` cookie so server-side filters and counts match (UTC until the cookie
exists, i.e. on the very first page load).

## Export

`POST /api/leads/export` with `{ ids }` (Export selected) or `{ params }` (Export current view)
returns CSV, up to 5,000 rows. Cells are quoted per RFC 4180, and any cell starting with `=`,
`+`, `-`, `@`, tab or carriage return is prefixed with an apostrophe so spreadsheets don't run it
as a formula (this includes phone numbers that start with `+`). Internal ids are not exported.

## For Step 6

`getOutreachContext(supabase, userId, leadId)` in `src/lib/pipeline/outreach-context.ts` returns
one object with the business, decision maker, email, scores, top opportunity, recommended
services, weaknesses with their evidence, strengths, pipeline state, tags and notes.

## Deliberately left out

Automated reminders, team permissions (only `assigned_to` exists), saved custom views (quick
views are fixed presets), column show/hide, and any use of the value fields
(`estimated_value`, `actual_value`, `currency` exist but have no UI).
