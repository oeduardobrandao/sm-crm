# Workspace acquisition source

Status: draft for approval · 2026-11-26

## Intent

Mesaas runs ads on Meta, Google and ChatGPT and also gets organic traffic (Instagram, Google
search, AI assistants, email, affiliates). Today nothing in the database says where a workspace
came from, so ad spend is decided without knowing which channel brings **paying** customers.

This spec records, for every new workspace, the channel and campaign that brought its owner, and
shows in the platform Admin how many signups, paying customers and MRR each channel produced.

Spend data (cost per customer, payback) is out of scope: the owner compares these numbers with
what Meta and Google report spending.

## What exists today

- The affiliate `?ref=` code is the only acquisition signal that reaches the database:
  `lib/referral.ts` saves it in localStorage at boot (`main.tsx`), `LoginPage` sends it as
  `ref_code` in the signUp metadata, and the trigger `on_auth_user_created_zz_affiliate_referral`
  (`record_affiliate_referral`, migration `20261013000001`) writes `affiliate_referrals`. It runs
  after `on_auth_user_created_workspace` (alphabetical order) so the workspace already exists.
- `market: 'us'` travels the same way (signups from `/en`).
- Ad click ids (`gclid`, `fbclid`, `oppref`) are read only by the ad pixels, and only after
  `marketing` consent. PostHog stores first UTMs per person, only with `analytics` consent (about
  10% of landing visitors).
- PostHog (90 days, consented sample) shows how traffic arrives:
  - Meta ads: `utm_source=meta&utm_medium=paid`.
  - Instagram bio: `utm_source=ig&utm_medium=social`, or referrer `l.instagram.com`.
  - Google Ads: **no UTMs**, only `gclid` (PostHog classes it "Paid Unknown").
  - ChatGPT organic citations: `utm_source=chatgpt.com`. ChatGPT ads: `?oppref=`.
- Sign-up happens only in the CRM web `LoginPage` (email + password). The iOS app is login only
  (`apps/mobile/DECISIONS.md` D5). Invited members join an existing workspace (signUp metadata
  carries `conta_id`) and create no workspace.
- Paying status in the Admin: `metrics-logic.ts` `classOf` (active and `monthly_cents > 0`, plus a
  Pagar.me trial that is a Stripe switch in progress), over `workspace_subscription_snapshots`
  (daily, migration `20260925130001`). Live MRR comes from `workspace_subscriptions` (`mrr.ts`).

## Goals

- Every workspace created after launch has an acquisition row: first touch, last non-direct touch,
  and a derived channel.
- The Admin shows, per channel and per campaign, for workspaces created in a chosen month range:
  signups, workspaces that ever paid, workspaces paying today, and MRR (BRL and USD separately).
- Each workspace shows its origin: a column and a filter in the Admin workspace list, and an
  "Origem" panel in the workspace detail.

## Non-goals

- Ad spend, CAC, ROAS, payback.
- Multi-touch attribution or a log of every visit.
- Cross-device stitching (ad click on phone, signup on laptop).
- Backfilling workspaces created before launch.
- Showing attribution to the workspace's own users.

## Anti-goals

- Attribution that waits for cookie consent. With ~10% consent the report would be mostly
  "unknown" and useless for the decision it exists for.
- Storing ad click ids, full referrer URLs, query strings, IPs or anything that identifies the
  visitor beyond the account it is attached to.
- Breaking or slowing signup. A failure anywhere in this feature must never block account
  creation.

## Approaches

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Save first and last touch in the browser at landing, send them in the signUp metadata, write them in an `auth.users` trigger (copy of the affiliate flow) | Only two touches; a device switch before signup loses them. Smallest build, least data stored. |
| B | Beacon every landing visit to an edge function keyed by an anonymous id, link the id at signup | Every visit and visit-to-signup rates, but a public endpoint, a table that grows with all traffic, and a weaker case for running without consent. More than the decision needs. |
| C | Sync PostHog's first-touch UTMs into the database | Only covers the ~10% who accept analytics cookies. Ruled out. |

The owner picked A.

## Design

### 1. Capture in the browser (`apps/crm/src/lib/acquisition.ts`)

Called from `main.tsx` at boot, next to `captureReferral`, before any SPA navigation. Runs on
every page served by the CRM entry (landing, `/en`, prices, blog, login, app). Never reads
consent: it stores labels only (see Privacy). Must be safe when `localStorage` throws (private
mode, blocked storage): it then does nothing.

A **touch** is built from the current URL and `document.referrer`:

```ts
interface Touch {
  utm_source: string | null;   // lowercased
  utm_medium: string | null;   // lowercased
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  click: 'gclid' | 'gbraid' | 'wbraid' | 'fbclid' | 'oppref' | 'msclkid' | null; // which param was present, never its value
  ref: boolean;                // affiliate ?ref= present
  referrer_host: string | null; // host only, e.g. "l.instagram.com"
  landing_path: string;         // pathname only, no query or hash
  at: string;                   // ISO timestamp
}
```

- Each string trimmed and cut to 200 characters.
- `referrer_host` is null when the referrer is empty or one of our own hosts (`mesaas.com.br`,
  `www.mesaas.com.br`, `localhost`, preview hosts) or a payment host (`checkout.stripe.com`,
  `billing.stripe.com`, `connect.stripe.com`, `pagar.me` hosts), so internal navigation and
  checkout returns never count as a source.
- A touch is **non-direct** when it has `utm_source`, `utm_medium`, a `click`, `ref`, or a
  `referrer_host`. (`utm_campaign`/`utm_content`/`utm_term` alone do not count.) The
  classifier guarantees every non-direct touch lands in a channel other than `direct` (rules
  8b and 11), so a non-direct `last` can never read as "Direto".
- Storage key `mesaas:acq`, value `{ first: Touch, last: Touch | null, v: 1 }`:
  - `first` is written once, on the first visit, even when direct.
  - `last` is overwritten only by a non-direct touch (last non-direct click wins).
  - Expiry: 90 days from `first.at`; an expired value is replaced by a fresh one.
- Exported `getStoredAcquisition()` returns the value or null; `clearStoredAcquisition()` runs
  after a successful signup (like `clearStoredReferral`).

### 2. Signup

`LoginPage` adds `acq: getStoredAcquisition()` to the signUp metadata (`signUp` meta type in
`lib/supabase.ts` gains `acq?`), only when present. Nothing else changes in the form.

### 3. Database (one migration)

**Table `public.workspace_acquisition`**, one row per workspace:

| column | type | notes |
|---|---|---|
| `workspace_id` | uuid PK | FK `workspaces(id) ON DELETE CASCADE` |
| `first_touch` | jsonb null | sanitized Touch |
| `last_touch` | jsonb null | sanitized Touch |
| `channel` | text not null | classifier result; `unknown` when `captured` is false |
| `campaign` | text null | `utm_campaign` of the touch the channel came from |
| `captured` | boolean not null | false when the signup carried no `acq` (storage blocked, device switch) |
| `created_at` | timestamptz default now() | |

RLS on, no policies for `anon`/`authenticated`; `REVOKE ALL ... FROM PUBLIC, anon, authenticated`
(name the roles explicitly) and service role only. Index on `channel`.

**Classifier `public.acquisition_channel(t jsonb, has_affiliate boolean) returns text`**,
IMMUTABLE, applied to `last_touch` when present, else `first_touch`. First rule that matches wins:

| # | Rule | Channel |
|---|---|---|
| 1 | `has_affiliate` (an `affiliate_referrals` row was written for this workspace) and `t.ref` | `affiliate` |
| 2 | `click = 'oppref'` | `chatgpt_ads` |
| 3 | `click` in (`gclid`,`gbraid`,`wbraid`), or `utm_source` in (`google`,`adwords`) and `utm_medium` in (`cpc`,`ppc`,`paid`) | `google_ads` |
| 4 | `utm_source` in (`meta`,`facebook`,`fb`,`instagram`,`ig`) and `utm_medium` in (`paid`,`cpc`,`ppc`,`paid_social`) | `meta_ads` |
| 5 | `click = 'msclkid'` or other `utm_medium` in (`cpc`,`ppc`,`paid`) | `other_ads` |
| 6 | `utm_medium = 'email'` or referrer is a mail host (`mail.google.com`, `com.google.android.gm`, `outlook.live.com`, `outlook.office.com`) | `email` |
| 7 | `utm_source` in (`ig`,`instagram`) or referrer host `instagram.com`/`l.instagram.com`/`www.instagram.com` | `instagram` |
| 8 | referrer host is Facebook, TikTok, LinkedIn, YouTube, X/Twitter, Threads, WhatsApp (`l.wl.co`) or `utm_medium` in (`social`) | `other_social` |
| 8b | `click = 'fbclid'` with nothing above matching (Meta strips the referrer in its in-app browsers, so Facebook vs Instagram can't be told apart) | `other_social` |
| 9 | `utm_source = 'chatgpt.com'` or referrer host in (`chatgpt.com`,`claude.ai`,`perplexity.ai`,`gemini.google.com`,`copilot.microsoft.com`) | `ai` |
| 10 | referrer host is a search engine (Google, Bing, Yahoo, DuckDuckGo, Yandex, Baidu, Ecosia; any `google.*`) | `search` |
| 11 | any other non-direct touch (a `referrer_host`, `utm_source`, `utm_medium`, a `click`, or a `ref` with no affiliate row) | `other_sites` |
| 12 | nothing above | `direct` |

`fbclid` alone does **not** mean Meta ads: Meta adds it to organic link clicks too. Paid Meta is
recognized by its UTMs (rule 4), which the current ads already carry.

The rule list lives only in this function, so changing it later is a new migration with
`CREATE OR REPLACE` plus a one-line `UPDATE workspace_acquisition SET channel = ...` to
reclassify existing rows.

**Affiliate rule (owner's decision):** "Afiliado" only when the affiliate link was the last
touch. Someone who clicked an affiliate link and later came back through Google search keeps
the affiliate commission (`affiliate_referrals`, separate 60-day storage) but is counted as
`search` here. When the Admin sets, changes or removes a workspace's affiliate
(`platform-admin/workspace-affiliate.ts`), that action recomputes the row's `channel` with the
classifier (skipped when `captured` is false), so `has_affiliate` never goes stale.

**`acq` must not stay in `auth.users.raw_user_meta_data`.** Left there, every owner could read
their own touches through `user_metadata` and they would ride in every access token. So capture
happens in two triggers:

- **`on_auth_user_created_aaa_acquisition_stash`** (`BEFORE INSERT ON auth.users`): sanitizes
  `NEW.raw_user_meta_data -> 'acq'` (rules below), writes it to
  `public.acquisition_pending (user_id uuid PK, acq jsonb, captured boolean, created_at)`
  (service role only, same REVOKEs), and returns `NEW` with
  `raw_user_meta_data = raw_user_meta_data - 'acq'`. It always writes a pending row for a signup
  without `conta_id`, with `captured = false` when `acq` was absent. Wrapped in
  `EXCEPTION WHEN OTHERS` returning `NEW` (with `acq` stripped when possible) so signup never
  fails. No `UPDATE` of `auth.users` anywhere.
- **`on_auth_user_created_zzz_acquisition`** (below) reads and deletes the pending row by
  `NEW.id`.
- `acquisition_pending` rows left behind (user created without a workspace) are deleted when
  older than one day by the same trigger on its next run (`DELETE ... WHERE created_at <
  now() - interval '1 day'`, cheap with the PK and few rows).

**Trigger `on_auth_user_created_zzz_acquisition`** (`AFTER INSERT ON auth.users`,
`record_workspace_acquisition()`, SECURITY DEFINER, `search_path = public`). The `zzz` prefix
sorts it after both `on_auth_user_created_workspace` and `on_auth_user_created_zz_affiliate_referral`,
so the workspace and the affiliate row already exist. Same guards as the affiliate trigger:

- skip when `raw_user_meta_data ->> 'conta_id'` is set (invite);
- workspace = `profiles.conta_id` where `profiles.id = NEW.id and role = 'owner'`; skip if none;
- take `acq` and `captured` from `acquisition_pending` (sanitized by the stash trigger: only the
  Touch keys under `first` and `last`, strings cut to 200 chars, `click` only from the allowed
  list, `referrer_host` matching a host pattern, anything malformed becomes null, since the
  metadata is user controlled), then delete the pending row;
- when `captured` is false, `channel = 'unknown'` and the classifier is not called (so "no
  capture" never reads as "direct");
- `INSERT ... ON CONFLICT (workspace_id) DO NOTHING`;
- the whole body inside `BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE WARNING ...` so signup never
  fails because of it.

Admin demo workspaces also go through `auth.users` (`demo-workspace.ts` calls `createUser`
before it sets `demo_created_at` / `plan_source = 'demo'`), so they **do** get a row, with
`captured = false` / `channel = 'unknown'`.

**Demo and internal workspaces in the report:** `is_internal` workspaces are left out (what
`get-mrr` already excludes). Demo workspaces (`demo_created_at IS NOT NULL`, the durable marker;
`plan_source` can change later) are shown as their own **"Demo (vendas)"** row (`demo`), whatever
their stored channel. A demo that converts is a sales win, and keeping it as a row means the
card's MRR total still matches the MRR tile. The detail panel shows "Demo (vendas)" for them too;
the list filter offers `demo` as a value.

### 4. Admin backend (`platform-admin`)

- **`get-acquisition-channels`** `{ from_month: 'YYYY-MM', to_month: 'YYYY-MM' }`, by
  `workspaces.created_at`, `is_internal` excluded, demos bucketed as `demo`.
  - Bounds: `created_at >= (from_month || '-01')::timestamp AT TIME ZONE 'America/Sao_Paulo'`
    and `created_at < ((to_month || '-01')::date + interval '1 month')::timestamp AT TIME ZONE
    'America/Sao_Paulo'` (both months inclusive, São Paulo midnight, never UTC truncation).
  - 400 when a month is malformed, `from_month > to_month`, or the range exceeds 24 months.

  Returns:

  ```ts
  {
    channels: {
      channel: string;            // classifier value, or 'no_data' for workspaces without a row
      signups: number;
      ever_paid: number;
      paying_now: number;
      mrr_cents: { brl: number; usd: number };
      campaigns: { campaign: string | null; signups; ever_paid; paying_now; mrr_cents }[];
    }[];
  }
  ```

  - `paying_now` and `mrr_cents`: the handler reuses `get-mrr`'s pipeline as is (same
    `workspace_subscriptions` select, same eligibility, `priceSubscriptionRows` from `pricing.ts`
    with its mirror amounts, catalog fallback by workspace currency and bounded live Stripe
    reads and write-backs, same failure behavior). Extract the shared part of `mrr.ts` into a
    function both actions call rather than copying it. Amounts grouped by currency, never summed
    across currencies.
  - `ever_paid`: paying now, or any `workspace_subscription_snapshots` row (cron or backfill)
    that `classOf` counts as paying, or `workspace_subscriptions.ever_subscribed_at` set, or
    `workspaces.reverse_trial_first_paid_at` set. Not `_workspace_ever_paid()` as is: it also
    counts `trialing` and a bare `stripe_subscription_id`, which a 30-day card trial that never
    paid already has (it is built for trial eligibility, where over-counting is the safe side).
  - Aggregation of the priced rows, acquisition rows and paid signals lives in a pure module
    (`acquisition-logic.ts`) with Deno tests.
- **`get-workspace`** gains `acquisition: { channel, campaign, captured, first_touch, last_touch } | null`.
- **`admin_list_workspaces`** gains `acquisition_channel` per row (LEFT JOIN, `'no_data'` when
  no row) and a `p_channels text` filter (comma-separated, the same encoding
  `20261127000001_admin_list_workspaces_multi_filters` uses for plans and statuses).
  - Filter values: every classifier value plus `unknown` (captured false) and `no_data` (no
    row). Each value matches only itself; `direct` does not include `unknown`. The "Direto /
    desconhecido" grouping exists only in the report card.
  - Signature change: the current function has 11 parameters
    (`text,text,int,int,timestamptz,text,boolean,text,timestamptz,text,text`, body from
    `20261205000002_usd_billing_rpcs.sql`). The migration `DROP FUNCTION`s that exact signature,
    creates the 12-parameter one with the **current body copied verbatim** (reverse-trial and
    USD behavior included) plus the join and filter, and repeats the `revoke ... from public,
    anon, authenticated` / `grant ... to service_role`. No overload may remain.
  - `list-workspaces.ts` forwards `channels`. Deploy note: between the migration and the
    `platform-admin` redeploy the old function calls the RPC with 11 named args; with the new
    parameter defaulted (`p_channels text DEFAULT NULL`) that call still resolves.

### 5. Admin frontend

- **Métricas page**: a "Canais de aquisição" card. Month range picker (default: current month).
  Table: Canal, Cadastros, Assinaram, Pagando hoje, MRR (R$), MRR (US$). A row expands to its
  campaigns. "Sem dados" (`no_data`) row hidden unless the range includes months before launch.
  `direct` and `unknown` are shown together as "Direto / desconhecido", with the split in a
  tooltip.
- **Workspace list**: "Origem" column (channel badge) and a channel multi-select chip next to the
  existing filters; included in the list export.
- **Workspace detail**: "Origem" panel with channel, campaign, and for each touch the source,
  medium, campaign, referrer host, landing page and date. "Sem dados" when null; "Não capturado"
  when `captured` is false.
- Channel labels (pt-BR): Meta Ads, Google Ads, ChatGPT Ads, Outros anúncios, Instagram
  (orgânico), Outras redes, Busca orgânica, IA (ChatGPT, Claude…), E-mail, Afiliado, Outros sites,
  Direto, Não capturado, Demo (vendas), Sem dados. One shared label map in the Admin; the list filter offers
  every label separately.

### 6. Privacy

Basis: legitimate interest (art. 7º, IX), first party, never sent to a third party, no ad click
ids or visitor identifiers stored. Copy changes (no em-dashes in user-facing copy):

- `LgpdPage.tsx` §11 "Sempre ativas": one sentence saying we keep in the browser, for up to 90
  days, which campaign or site brought the visitor (campaign tags and the referring site's
  domain, without ad identifiers), and attach it to the account at signup to measure which
  channels bring customers. Add the `mesaas:acq` entry wherever the page lists storage keys.
- `PrivacyPageEn.tsx`: same sentence in English.

## Deploy order

1. Migration (table, classifier, trigger, `admin_list_workspaces` change). Safe alone: old
   frontends send no `acq`, so rows get `captured = false`.
2. `platform-admin` and `mcp-admin` redeploy (`mcp-admin` bundles `list-workspaces.ts`; the
   defaulted `p_channels` keeps the old bundles working in between). Before the migration the
   new action would 500.
3. Merge (CRM capture + Admin UI deploy together on Vercel).

Rollback: frontend first; the function and the table can stay.

## Testing

- Vitest: `acquisition.ts` (first written once, last only on non-direct, own and payment hosts
  ignored, 90-day expiry, storage throwing, click value never stored, path without query).
- Vitest: `LoginPage` sends `acq` when stored and clears it after success.
- psql suite in `supabase/tests/entitlements/`: classifier table cases (`fbclid` alone →
  `other_social`, `fbclid` + `l.instagram.com` → `instagram`, `utm_source=chatgpt.com` → `ai`,
  `ref` without affiliate row → `other_sites`, every non-direct touch ≠ `direct`); triggers write
  one row for an owner signup, strip `acq` from `raw_user_meta_data`, leave no pending row,
  skip invites, sanitize junk, never raise; `anon`/`authenticated` cannot select either table;
  the `admin_list_workspaces` overload count is 1.
- Deno: `acquisition-logic.ts` aggregation (ever paid, paying now, currency split, `no_data`).
- Browser: open the landing with `?utm_source=meta&utm_medium=paid&utm_campaign=x`, navigate,
  sign up on staging, confirm the row and the Admin card.

## Known limits

- Ad clicked inside the Instagram or Facebook in-app browser and signup later in Safari or Chrome:
  separate storage, so the signup shows "Direto / desconhecido".
- Google Ads campaigns carry no UTMs, so Google Ads shows no campaign breakdown until the ads get
  `utm_campaign` (auto-tagging stays on; adding a tracking template is an Ads account change, not
  code).
- Workspaces created before launch show "Sem dados".

## Left to the builder

- Exact host lists in the classifier and in the own-host filter (start from the lists above).
- Where the card sits on the Métricas page and the badge colors.
- The parameter shape of the list filter, matching the existing multi-select filters.
