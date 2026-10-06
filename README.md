# Syncognix Leads

Lead intelligence and outreach platform. **Step 1** — authentication, protected app shell and dashboard. **Step 2** — US business search (OpenStreetMap), selecting and saving businesses as leads, and a searchable Leads list. **Step 3** — prospect scoring, decision-maker lookup (Prospeo) and email verification (Hunter), both only on request and cached in Supabase. See [docs/step-3-enrichment.md](docs/step-3-enrichment.md).

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui (Radix) · Supabase Auth + Postgres (`@supabase/ssr`) · Motion · Sonner · Lucide

## Getting started

1. **Install**
   ```bash
   npm install
   ```
2. **Create a Supabase project** at https://supabase.com, then copy the env template:
   ```bash
   cp .env.example .env.local
   ```
   Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Project Settings → API).
3. **Run the SQL** files in `supabase/migrations/`, oldest first, via the Supabase SQL Editor (or `supabase db push`). Each is safe to re-run.
   - `20260930000000_create_profiles.sql` — `profiles`, RLS, and a trigger that creates a profile on sign-up.
   - `20261001000000_create_leads.sql` — `leads`, RLS, and the `unique (user_id, osm_id)` duplicate guard.
   - `20261002000000_leads_source_and_searches.sql` — lead `source`/`country` columns and the `searches` history table (dashboard "Recent searches").
   - `20261003000000_enrichment_and_api_usage.sql` — `lead_enrichments` (decision-maker and verification cache), `api_usage`, and `leads.is_chain`.

   Optional, for Step 3: add `PROSPEO_API_KEY` and `HUNTER_API_KEY` to `.env.local` (server-side only; see `.env.example`). Without them the app works as before and those two features show "not configured".
4. **Configure Auth URLs** (Authentication → URL Configuration):
   - Site URL: `http://localhost:3000` (your production URL later)
   - Redirect URLs: `http://localhost:3000/auth/confirm`
5. **Run**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000.

### Email confirmation

- With **Confirm email** on (Supabase default), sign-up shows a "Check your inbox" state and the email link lands on `/auth/confirm`, which signs the user in.
- For faster local testing you can turn it off (Authentication → Providers → Email → Confirm email). Sign-up then goes straight to the dashboard.
- Supabase's built-in email sender is rate-limited (a few emails/hour). Configure custom SMTP before launch.
- Optional, more robust links (these work across devices): in Authentication → Email Templates, change the links to
  - Confirm signup: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard`
  - Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`

## Scripts

| Command         | Purpose                  |
| --------------- | ------------------------ |
| `npm run dev`   | Dev server               |
| `npm run build` | Production build         |
| `npm start`     | Serve production build   |
| `npm run lint`  | ESLint                   |

## Project structure

```
src/
  proxy.ts                     # Next 16 "proxy" (formerly middleware): session refresh + route guards
  app/
    (auth)/                    # login, signup, forgot-password, reset-password (split layout)
    (dashboard)/               # protected shell: dashboard, find-leads, leads, settings
    auth/confirm/route.ts      # email link handler (token_hash or PKCE code)
    setup/                     # shown when Supabase env vars are missing
  components/
    auth/ dashboard/ find-leads/ leads/ settings/   # feature components
    layout/                    # sidebar, header, mobile drawer, user menu, command menu (Ctrl/⌘K)
    forms/                     # FormField, SubmitButton, PasswordInput, useValidatedAction
    shared/                    # EmptyState, PageHeader, SectionCard, CSS entrance animations
    ui/                        # shadcn/ui primitives
  config/                      # site + navigation
  lib/
    auth/                      # server actions, cached current-user lookup, friendly error mapping
    supabase/                  # browser / server / proxy clients, env helpers
    theme.ts                   # tiny theme store (light/dark/system, no flash)
    validation.ts              # shared client/server validators
  types/                       # Database + app types
supabase/migrations/           # SQL
```

## Auth model

- `src/proxy.ts` refreshes the Supabase session on every request and does optimistic redirects (signed-out → `/login?next=…`, signed-in on auth pages → `/dashboard`).
- `(dashboard)/layout.tsx` re-verifies the user on the server (`getClaims()`), so protection doesn't rely on the proxy alone.
- `getCurrentUser()` is wrapped in React `cache`, so the layout and page share one lookup per request.
- All auth calls are Server Actions; the browser never needs anything beyond the public anon key.
