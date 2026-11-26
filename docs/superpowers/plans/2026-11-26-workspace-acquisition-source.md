# Workspace Acquisition Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the channel and campaign that brought each new workspace's owner, and show signups, paying customers and MRR per channel in the platform Admin.

**Architecture:** The CRM saves a first and a last non-direct "touch" (UTM labels, referrer host, click-id type) in localStorage at boot and sends them in the signUp metadata as `acq`. A `BEFORE INSERT` trigger on `auth.users` strips `acq` into a pending table; an `AFTER INSERT` trigger (sorted after the workspace and affiliate triggers) writes `workspace_acquisition` with a SQL-classified channel. `platform-admin` aggregates it with the existing MRR pricing and payment signals; the Admin shows a Métricas card, a list column and filter, and a detail panel.

**Tech Stack:** Postgres (plpgsql, psql suites), Deno edge function (`platform-admin`), React 19 + TanStack Query (Admin), Vitest, Deno test.

**Spec:** `docs/superpowers/specs/2026-11-26-workspace-acquisition-source-design.md` (read it first; this plan does not repeat its rule tables). Mockups: https://claude.ai/artifact/Eg3TZYFrMC9X3JBpyuW2AN

## Global Constraints

- Signup must never fail because of this feature: every trigger body is wrapped in `EXCEPTION WHEN OTHERS THEN RAISE WARNING` and returns normally.
- Never store click-id values, full referrer URLs, query strings or IPs. `click` holds only the param name; `referrer_host` only the host; `landing_path` only the pathname.
- Strings cut to 200 characters; `utm_source`/`utm_medium` lowercased.
- Storage key `mesaas:acq`, value `{ first, last, v: 1 }`, TTL 90 days from `first.at`.
- New tables: RLS on, `REVOKE ALL ... FROM PUBLIC, anon, authenticated` (name all three), service role only.
- Channel values: `affiliate, chatgpt_ads, google_ads, meta_ads, other_ads, email, instagram, other_social, ai, search, other_sites, direct` (classifier) plus `unknown` (captured false), `demo` and `no_data` (computed at read time).
- BRL and USD MRR are never summed.
- São Paulo months are `YYYY-MM-01T00:00:00-03:00` (Brazil has had no DST since 2019); both ends inclusive.
- No em-dashes in user-facing copy. pt-BR labels exactly as the spec's §5 list.
- Migrations: `20261209000001_workspace_acquisition.sql`, `20261209000002_admin_list_workspaces_channel.sql`. Before opening the PR, renumber above `main`'s newest migration if it moved.
- Before pushing: `npm run lint`, `npm run format:check`, the five `tsc` commands from CLAUDE.md, `npm run test`, `npm run check:functions`, `npm run test:functions`, and `npm run test:db` (needs the local Supabase on colima).

## Review Focus

1. **A visitor lands from an ad, browses, leaves, and comes back directly days later before signing up.** The direct return must not overwrite `last`, and `first` must not change. Test in Task 3.
2. **Sign-up with an email that already has an account** (GoTrue returns a fake user, no row is created). The stored touches must survive for the real signup. Test in Task 4.
3. **Hostile or broken `acq` metadata** (10 KB strings, nested objects, numbers where strings go, an unknown `click`, `acq` as a string). Signup succeeds, junk is nulled, the row is still written. Test in Task 1.
4. **Corrupt or old-version localStorage** (`not json`, `{v:2}`, missing `first`). Treated as empty and replaced on the next boot, never thrown. Test in Task 3.
5. **A workspace created at 23:30 São Paulo on the last day of a month** (02:30 UTC the next day). It counts in the São Paulo month, not the UTC one. Test in Task 7.

---

### Task 1: Database: tables, classifier, capture triggers

**Files:**
- Create: `supabase/migrations/20261209000001_workspace_acquisition.sql`
- Test: `supabase/tests/entitlements/99_workspace_acquisition.sql`

**Interfaces:**
- Produces (SQL, all `SET search_path = public`):
  - table `workspace_acquisition(workspace_id uuid PK → workspaces ON DELETE CASCADE, first_touch jsonb, last_touch jsonb, channel text NOT NULL, campaign text, captured boolean NOT NULL, created_at timestamptz DEFAULT now())`, index on `channel`
  - table `acquisition_pending(user_id uuid PK, acq jsonb, captured boolean NOT NULL, created_at timestamptz DEFAULT now())`
  - `acquisition_sanitize_touch(t jsonb) RETURNS jsonb` IMMUTABLE: only the 10 Touch keys, types enforced, strings ≤ 200, `click` ∈ {gclid,gbraid,wbraid,fbclid,oppref,msclkid} else null, `referrer_host` must match `^[a-z0-9.-]{1,253}$` else null, `ref` boolean (default false); returns null when `t` is not an object
  - `acquisition_channel(t jsonb, has_affiliate boolean) RETURNS text` IMMUTABLE: the spec's 12-rule table plus rule 8b, first match wins; `t` null → `direct`
  - `workspace_acquisition_reclassify(p_workspace uuid) RETURNS text` SECURITY DEFINER, EXECUTE to `service_role` only: recomputes `channel`/`campaign` from `coalesce(last_touch, first_touch)` and the current existence of an `affiliate_referrals` row; leaves `captured = false` rows untouched; returns the channel (null when no row)
  - trigger `on_auth_user_created_aaa_acquisition_stash` BEFORE INSERT OR UPDATE OF raw_user_meta_data ON auth.users → `stash_signup_acquisition()`
  - trigger `on_auth_user_created_zzz_acquisition` AFTER INSERT ON auth.users → `record_workspace_acquisition()`

- [ ] **Step 1: Verify the stash approach on the local stack (spec's open item)**

Start the local Supabase (colima, see the memory note on per-worktree ports). Write a throwaway migration in a scratch branch with only the BEFORE trigger that strips `acq`, `supabase db reset`, then with `curl` against local auth:
1. `POST /auth/v1/signup` with `data: {"empresa":"","acq":{"first":{"utm_source":"meta"}}}` (email confirmations ON in local config).
2. Same email again with a different `acq` (unconfirmed re-signup).
3. Confirm the user (`update auth.users set email_confirmed_at = now()`), sign in, decode the access token.

Expected: `select raw_user_meta_data ? 'acq' from auth.users where email = ...` is false after 1, 2 and 3; the token's `user_metadata` has no `acq`. **If any check fails:** switch to the spec's fallback (no stash trigger, no pending table; the AFTER trigger reads `NEW.raw_user_meta_data -> 'acq'` directly) and record that in the PR description. The rest of this task's tests change only in the "acq stripped" assertions.

- [ ] **Step 2: Write the failing psql suite**

`99_workspace_acquisition.sql`, same shape as `99_usd_billing_currency.sql` (`\set ON_ERROR_STOP on`, `\i _helpers.sql`, `begin; select et_grant_hosted_parity(); do $$ ... $$; rollback;`, `raise exception` on each failed check). Checks:
- classifier cases (each `acquisition_channel(<json>, <bool>) = <channel>`):
  `{"click":"oppref"}`→`chatgpt_ads`; `{"click":"gclid"}`→`google_ads`; `{"utm_source":"meta","utm_medium":"paid"}`→`meta_ads`; `{"utm_source":"ig","utm_medium":"social"}`→`instagram`; `{"click":"fbclid"}`→`other_social`; `{"click":"fbclid","referrer_host":"l.instagram.com"}`→`instagram`; `{"utm_source":"chatgpt.com"}`→`ai`; `{"referrer_host":"www.google.com"}`→`search`; `{"referrer_host":"www.google.com.br"}`→`search`; `{"utm_medium":"email"}`→`email`; `{"ref":true}` with false→`other_sites`; `{"ref":true}` with true→`affiliate`; `{"referrer_host":"blog.example.com"}`→`other_sites`; `{}`→`direct`; null→`direct`; `{"utm_campaign":"x"}`→`direct`.
- owner signup: `insert into auth.users (id, email, raw_user_meta_data)` with `empresa` and `acq = {first:{utm_source:"ig",utm_medium:"social",landing_path:"/",at:"..."}, last:{utm_source:"meta",utm_medium:"paid",utm_campaign:"lp-nov",...}}` → one `workspace_acquisition` row for the owner's `profiles.conta_id`, `channel = 'meta_ads'`, `campaign = 'lp-nov'`, `captured = true`; `raw_user_meta_data ? 'acq'` false; no `acquisition_pending` row for that user.
- signup without `acq` → row with `captured = false`, `channel = 'unknown'`, touches null.
- invite (`raw_user_meta_data` has `conta_id`) → no row, no pending row left.
- hostile metadata (Review Focus 3): `acq` = `'"oops"'::jsonb`; and `acq.first` with a 10 000-char `utm_source`, `click = 'evil'`, `referrer_host = 'a b'`, nested object in `utm_medium` → signup succeeds; `length(first_touch->>'utm_source') = 200`; `first_touch->>'click'` null; `first_touch->>'referrer_host'` null.
- re-signup path: `update auth.users set raw_user_meta_data = raw_user_meta_data || '{"acq":{"first":{}}}'` → `acq` absent after the update, no new pending row.
- affiliate: owner signup with valid `ref_code` of an active affiliate and `acq.last.ref = true` → `channel = 'affiliate'`; then delete the `affiliate_referrals` row and `select workspace_acquisition_reclassify(ws)` → `other_sites`.
- privileges: as `authenticated` and `anon`, `select` on both tables raises 42501; `has_function_privilege('authenticated', 'workspace_acquisition_reclassify(uuid)', 'execute')` false.

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run test:db`
Expected: FAIL in `99_workspace_acquisition.sql` (function `acquisition_channel` does not exist).

- [ ] **Step 4: Write the migration**

Copy the guard shape of `record_affiliate_referral` (migration `20261013000001`): skip on `conta_id` in metadata; owner workspace from `profiles` where `role = 'owner'`. The stash function: on INSERT without `conta_id`, insert `(NEW.id, sanitized acq, acq present)` into `acquisition_pending` `ON CONFLICT (user_id) DO NOTHING`; on INSERT and UPDATE, set `NEW.raw_user_meta_data := NEW.raw_user_meta_data - 'acq'`; inner `BEGIN/EXCEPTION` so a failure still strips and returns `NEW`. The AFTER function: read and delete the pending row, delete pending rows older than 1 day, compute channel (`unknown` when not captured), `INSERT ... ON CONFLICT (workspace_id) DO NOTHING`. A sanitized `acq` is `{first: sanitize(acq->'first'), last: sanitize(acq->'last')}`. Campaign = `utm_campaign` of the touch the classifier read. Grants per Global Constraints.

- [ ] **Step 5: Run the suite to verify it passes**

Run: `npm run test:db`
Expected: PASS, including the existing `99_usd_billing_currency.sql` and affiliate suites (trigger order unchanged for them).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261209000001_workspace_acquisition.sql supabase/tests/entitlements/99_workspace_acquisition.sql
git commit -m "feat(db): origem de aquisição do workspace (tabela, classificador, triggers)"
```

### Task 2: Database: `admin_list_workspaces` with channel

**Files:**
- Create: `supabase/migrations/20261209000002_admin_list_workspaces_channel.sql`
- Test: `supabase/tests/entitlements/99_admin_list_workspaces_channel.sql`

**Interfaces:**
- Consumes: `workspace_acquisition` (Task 1).
- Produces: `admin_list_workspaces(...11 current params..., p_channels text DEFAULT NULL) RETURNS jsonb`; each workspace object gains `'acquisition_channel'` = `CASE WHEN w.demo_created_at IS NOT NULL THEN 'demo' ELSE COALESCE(a.channel, 'no_data') END`.

- [ ] **Step 1: Write the failing psql suite**

Checks: exactly one function named `admin_list_workspaces` in `pg_proc`; seed four workspaces (meta_ads row, `unknown` row, no row, demo with `demo_created_at` set) and call as service role:
- `p_channels => 'meta_ads'` → only the meta workspace;
- `'no_data'` → only the no-row workspace; `'direct'` → none (does not match `unknown`);
- `'demo'` → only the demo; `'meta_ads,unknown'` → those two;
- the returned objects carry the right `acquisition_channel`;
- a call with the 11 old named args (no `p_channels`) still works;
- `authenticated` cannot execute.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:db` → FAIL (no `p_channels` parameter).

- [ ] **Step 3: Write the migration**

`DROP FUNCTION public.admin_list_workspaces(text,text,int,int,timestamptz,text,boolean,text,timestamptz,text,text);` then `CREATE FUNCTION` with the body copied verbatim from `20261205000002_usd_billing_rpcs.sql` (line 256 on), plus: `LEFT JOIN workspace_acquisition a ON a.workspace_id = w.id`; a `channels` array in `args` parsed exactly like `plan_ids` (`string_to_array` + `btrim` + `NULLIF(..., '{}')`); the filter `(SELECT channels FROM args) IS NULL OR <computed channel> = ANY((SELECT channels FROM args)::text[])`; the new key in the row object. Repeat the revoke/grant for the new 12-arg signature.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:db` → PASS (also the existing list suites).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261209000002_admin_list_workspaces_channel.sql supabase/tests/entitlements/99_admin_list_workspaces_channel.sql
git commit -m "feat(db): filtro e coluna de origem no admin_list_workspaces"
```

### Task 3: CRM: capture touches at boot

**Files:**
- Create: `apps/crm/src/lib/acquisition.ts`
- Modify: `apps/crm/src/main.tsx:36` (call next to `captureReferral`)
- Test: `apps/crm/src/lib/__tests__/acquisition.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const ACQUISITION_STORAGE_KEY = 'mesaas:acq';
  export const ACQUISITION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
  export type ClickParam = 'gclid' | 'gbraid' | 'wbraid' | 'fbclid' | 'oppref' | 'msclkid';
  export interface AcquisitionTouch { utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_content: string | null; utm_term: string | null; click: ClickParam | null; ref: boolean; referrer_host: string | null; landing_path: string; at: string; }
  export interface StoredAcquisition { first: AcquisitionTouch; last: AcquisitionTouch | null; v: 1; }
  export function buildTouch(href: string, referrer: string, now: number): AcquisitionTouch;
  export function isNonDirect(t: AcquisitionTouch): boolean;
  export function captureAcquisition(href: string, referrer: string, storage?: MinimalStorage | null, now?: number): StoredAcquisition | null;
  export function getStoredAcquisition(storage?: MinimalStorage | null, now?: number): StoredAcquisition | null;
  export function clearStoredAcquisition(storage?: MinimalStorage | null): void;
  ```
  `MinimalStorage` and `safeStorage()` follow `lib/referral.ts`. Own hosts: `mesaas.com.br`, `www.mesaas.com.br`, `localhost`, `127.0.0.1`, any `*.vercel.app`; payment hosts: `checkout.stripe.com`, `billing.stripe.com`, `connect.stripe.com`, any `*.pagar.me`. `click` = the first present param in the `ClickParam` order.

- [ ] **Step 1: Write the failing tests**

```ts
it('first visit stores first and, when non-direct, last', ...)
  // captureAcquisition('https://mesaas.com.br/?utm_source=Meta&utm_medium=paid&utm_campaign=lp&fbclid=XYZ', '', mem, T0)
  // → first.utm_source === 'meta', first.click === 'fbclid', last equals first, JSON never contains 'XYZ'
it('direct return keeps first and last (Review Focus 1)', ...)
  // after the ad visit, captureAcquisition('https://mesaas.com.br/precos', '', mem, T0 + 3 days) → unchanged
it('a later non-direct visit replaces last only', ...)
  // then '?utm_source=ig&utm_medium=social' → first unchanged, last.utm_source === 'ig'
it('own and payment referrers are not a source', ...)
  // referrer 'https://www.mesaas.com.br/blog/x' and 'https://checkout.stripe.com/c/pay' → referrer_host null, not non-direct
it('keeps host only and pathname only', ...)
  // referrer 'https://l.instagram.com/?u=abc' → 'l.instagram.com'; href '/precos?x=1#y' → landing_path '/precos'
it('cuts strings to 200 chars', ...)
it('utm_campaign alone is direct', ...)  // isNonDirect false
it('expires after 90 days from first.at and starts fresh', ...)
it('treats corrupt or old values as empty (Review Focus 4)', ...)
  // storage holds 'not json', '{"v":2}', '{"v":1}' → getStoredAcquisition null; capture replaces it
it('does nothing when storage throws', ...)  // getItem/setItem throw → returns null, no exception
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/crm/src/lib/__tests__/acquisition.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `acquisition.ts` and the `main.tsx` call**

`captureAcquisition(window.location.href, document.referrer)` right after `captureReferral(...)`, with a one-line comment pointing to the spec. Nothing at module top level touches `window` (the SSR prerender imports this module).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run apps/crm/src/lib/__tests__/acquisition.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/lib/acquisition.ts apps/crm/src/lib/__tests__/acquisition.test.ts apps/crm/src/main.tsx
git commit -m "feat(crm): guarda primeira e última origem da visita"
```

### Task 4: CRM: send `acq` at signup

**Files:**
- Modify: `apps/crm/src/lib/supabase.ts:250-259` (meta type gains `acq?: StoredAcquisition`)
- Modify: `apps/crm/src/pages/login/LoginPage.tsx:264-306`
- Test: `apps/crm/src/pages/login/__tests__/LoginPage.test.tsx`

**Interfaces:**
- Consumes: `getStoredAcquisition`, `clearStoredAcquisition`, `StoredAcquisition` (Task 3).

- [ ] **Step 1: Write the failing tests**

```ts
it('sends the stored acquisition in the signUp metadata', ...)
  // seed localStorage 'mesaas:acq' → signUp called with meta containing acq deep-equal to stored
it('omits acq when nothing is stored', ...)  // meta has no 'acq' key
it('clears acq after a successful signup', ...)
it('keeps acq when the email already has an account (Review Focus 2)', ...)
  // signUp resolves the existing-account shape used by isExistingAccountSignup → storage still holds it
it('keeps acq when signUp returns an error', ...)
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/crm/src/pages/login/__tests__/LoginPage.test.tsx` → the new tests FAIL.

- [ ] **Step 3: Implement**

Read `getStoredAcquisition()` next to `getStoredReferral()`, spread `...(acq ? { acq } : {})` into the meta, and call `clearStoredAcquisition()` next to `clearStoredReferral()` (after the existing-account return).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run apps/crm/src/pages/login/__tests__/LoginPage.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/lib/supabase.ts apps/crm/src/pages/login/LoginPage.tsx apps/crm/src/pages/login/__tests__/LoginPage.test.tsx
git commit -m "feat(crm): envia a origem da visita no cadastro"
```

### Task 5: Privacy copy

**Files:**
- Modify: `apps/crm/src/pages/lgpd/LgpdPage.tsx` (§11, "Sempre ativas" paragraph, ~line 311)
- Modify: `apps/crm/src/pages/en/PrivacyPageEn.tsx` (matching "always active" paragraph)

- [ ] **Step 1: Add the sentence**

pt-BR, inserted after the Vercel Analytics clause: "Também guardamos no navegador, por até 90 dias, qual campanha ou site trouxe você (as etiquetas da campanha e o domínio do site de origem, sem identificadores de anúncio), e ligamos essa informação à conta no cadastro para medir quais canais trazem clientes." English: "We also keep in your browser, for up to 90 days, which campaign or site brought you (the campaign tags and the referring site's domain, without ad identifiers), and attach it to the account when you sign up, to measure which channels bring customers." No em-dashes.

- [ ] **Step 2: Run the page tests and the parity checks**

Run: `npx vitest run apps/crm/src/pages/lgpd apps/crm/src/pages/en apps/crm/src/content` → PASS (update a snapshot only if one covers this paragraph).

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/lgpd/LgpdPage.tsx apps/crm/src/pages/en/PrivacyPageEn.tsx
git commit -m "docs(lgpd): explica o registro da origem da visita"
```

### Task 6: platform-admin: share the MRR pricing pipeline

**Files:**
- Modify: `supabase/functions/platform-admin/mrr.ts:78-146`
- Test: existing `supabase/functions/__tests__/platform-admin-mrr*_test.ts` (find with `ls supabase/functions/__tests__ | grep -i mrr`)

**Interfaces:**
- Produces: `export async function loadPricedMrrRows(svc: SupabaseClient, fetchInternalIdsFn?: (svc: SupabaseClient) => Promise<Set<string>>): Promise<{ priced: PricedMrrRow[]; createdByWs: Map<string, string> }>` where `PricedMrrRow` is the element type of `aggregateMrr(...).priced` (export a type alias) and `priced` is BRL and USD together, each row carrying `currency` and `monthly_cents`. `handleGetMrr` calls it and keeps its response byte-for-byte.

- [ ] **Step 1: Run the existing MRR tests (baseline)**

Run: `deno test --no-check supabase/functions/__tests__/ --filter mrr` → PASS.

- [ ] **Step 2: Extract lines 84–146 into `loadPricedMrrRows`; `handleGetMrr` aggregates per currency from its result as today**

- [ ] **Step 3: Re-run the MRR tests and `deno check`**

Run: `deno test --no-check supabase/functions/__tests__/ --filter mrr && npm run check:functions` → PASS, no test changed.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/platform-admin/mrr.ts
git commit -m "refactor(platform-admin): extrai o carregamento das linhas de MRR"
```

### Task 7: platform-admin: `get-acquisition-channels`

**Files:**
- Create: `supabase/functions/platform-admin/acquisition-logic.ts`
- Create: `supabase/functions/platform-admin/acquisition.ts`
- Modify: `supabase/functions/platform-admin/index.ts:151` (route `case "get-acquisition-channels"`)
- Test: `supabase/functions/__tests__/platform-admin-acquisition_test.ts`

**Interfaces:**
- Consumes: `loadPricedMrrRows` (Task 6), `classOf`/`SnapshotRecord` (`metrics-logic.ts`), `fetchAllRows` (`_shared/paginate.ts`).
- Produces (`acquisition-logic.ts`, pure):
  ```ts
  export type ChannelBucket = string; // classifier value | 'unknown' | 'demo' | 'no_data'
  export interface AcqWorkspace { id: string; created_at: string; demo_created_at: string | null; is_internal: boolean; }
  export interface AcqRow { workspace_id: string; channel: string; campaign: string | null; }
  export interface ChannelTotals { signups: number; ever_paid: number; paying_now: number; mrr_cents: { brl: number; usd: number }; }
  export interface ChannelRow extends ChannelTotals { channel: ChannelBucket; campaigns: ({ campaign: string | null } & ChannelTotals)[]; }
  export function monthBounds(from: string, to: string): { startIso: string; endIso: string } | null;
  export function bucketOf(ws: AcqWorkspace, acq: AcqRow | undefined): ChannelBucket;
  export function aggregateChannels(input: { workspaces: AcqWorkspace[]; acquisition: Map<string, AcqRow>; priced: { workspace_id: string; currency: 'brl' | 'usd'; monthly_cents: number }[]; everPaidIds: Set<string>; }): ChannelRow[];
  ```
  `monthBounds`: null when either month fails `^\d{4}-(0[1-9]|1[0-2])$`, `from > to`, or the span exceeds 24 months; else `startIso = ${from}-01T00:00:00-03:00`, `endIso` = first day of the month after `to`, same offset. `aggregateChannels` drops `is_internal`, sorts rows by `signups` desc, campaigns by `signups` desc with `null` last; `paying_now` and MRR come only from `priced`; `ever_paid` = `everPaidIds` ∪ paying now.
- Produces (`acquisition.ts`): `handleGetAcquisitionChannels(svc, body: { from_month?: string; to_month?: string }, headers, deps?: { loadPriced?: typeof loadPricedMrrRows })` → 400 `{ error: 'invalid_range' }` when `monthBounds` is null; else 200 `{ channels: ChannelRow[] }`. It fetches workspaces in range (`id, created_at, demo_created_at, is_internal, reverse_trial_first_paid_at`), their `workspace_acquisition` rows, their `workspace_subscription_snapshots` (the `SnapshotRecord` columns), their `workspace_subscriptions.ever_subscribed_at`, all in `chunk`ed `.in()` reads, and builds `everPaidIds` = snapshot row with `classOf(r) === 'paying'` ∪ `ever_subscribed_at` set ∪ `reverse_trial_first_paid_at` set.

- [ ] **Step 1: Write the failing Deno tests**

```ts
Deno.test("monthBounds: São Paulo midnight, both ends inclusive", ...)
  // monthBounds('2026-11','2026-11') → { startIso: '2026-11-01T00:00:00-03:00', endIso: '2026-12-01T00:00:00-03:00' }
Deno.test("monthBounds: rejects malformed, reversed and > 24 months", ...)
  // '2026-13', '2026-1', ('2026-11','2026-10'), ('2024-01','2026-02') → null
Deno.test("23:30 São Paulo on Nov 30 counts in November (Review Focus 5)", ...)
  // created_at '2026-12-01T02:30:00Z' is inside monthBounds('2026-11','2026-11'), outside ('2026-12','2026-12')
Deno.test("bucketOf: demo wins, then channel, then no_data", ...)
Deno.test("aggregateChannels: is_internal dropped, currencies apart", ...)
  // a USD paying meta workspace adds to mrr_cents.usd only; a BRL one to brl only
Deno.test("aggregateChannels: ever_paid includes paying-now and past payers", ...)
Deno.test("aggregateChannels: campaigns grouped, null campaign last", ...)
Deno.test("handler: 400 invalid_range", ...)
Deno.test("handler: ever paid from snapshot, ever_subscribed_at and reverse_trial_first_paid_at; a trialing-only subscription is not ever paid", ...)
  // stub svc in the style of platform-admin-churn_test.ts
```

- [ ] **Step 2: Run to verify they fail**

Run: `deno test --no-check supabase/functions/__tests__/platform-admin-acquisition_test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement the two modules and the route**

- [ ] **Step 4: Run to verify they pass, then type-check**

Run: `deno test --no-check supabase/functions/__tests__/platform-admin-acquisition_test.ts && npm run check:functions` → PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/platform-admin/acquisition-logic.ts supabase/functions/platform-admin/acquisition.ts supabase/functions/platform-admin/index.ts supabase/functions/__tests__/platform-admin-acquisition_test.ts
git commit -m "feat(platform-admin): canais de aquisição por mês de cadastro"
```

### Task 8: platform-admin: origin on the workspace, list filter, affiliate reclassify

**Files:**
- Modify: `supabase/functions/platform-admin/workspace-detail.ts:145-178` (load and return `acquisition`)
- Modify: `supabase/functions/platform-admin/workspace-affiliate.ts:81-130` (reclassify after set/change/remove)
- Modify: `supabase/functions/platform-admin/list-workspaces.ts:15-45` (forward `channels` as `p_channels`)
- Test: `supabase/functions/__tests__/platform-admin-workspace-detail*_test.ts`, `platform-admin-affiliates_test.ts` (or the affiliate handler's test file), the list-workspaces test (find with `grep -l list-workspaces supabase/functions/__tests__/*`)

**Interfaces:**
- Consumes: `workspace_acquisition`, `workspace_acquisition_reclassify` (Task 1), `bucketOf` (Task 7), `p_channels` (Task 2).
- Produces: `get-workspace` response gains `acquisition: { channel: ChannelBucket; campaign: string | null; captured: boolean; first_touch: Record<string, unknown> | null; last_touch: Record<string, unknown> | null } | null` (`channel` is `bucketOf`, so `demo` for demos; `null` only when there is no row and the workspace is not a demo, in which case the UI shows "Sem dados"). `list-workspaces` body gains `channels?: string`.

- [ ] **Step 1: Write the failing tests**

- detail: a stubbed row returns `acquisition.channel === 'meta_ads'` with both touches; a demo workspace returns `'demo'`; no row returns `acquisition: null`.
- affiliate: after a successful set, change and removal, the stub records one `rpc('workspace_acquisition_reclassify', { p_workspace: id })` call; a failing reclassify RPC is logged and the action still returns 200.
- list: `channels: 'meta_ads,no_data'` reaches `rpc('admin_list_workspaces', { ..., p_channels: 'meta_ads,no_data' })`; omitted → `p_channels: null`.

- [ ] **Step 2: Run to verify they fail**

Run: `deno test --no-check supabase/functions/__tests__/ --filter "workspace|affiliate|list"` → the new tests FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run to verify they pass, then type-check**

Run: same command, then `npm run check:functions` → PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/platform-admin/workspace-detail.ts supabase/functions/platform-admin/workspace-affiliate.ts supabase/functions/platform-admin/list-workspaces.ts supabase/functions/__tests__/
git commit -m "feat(platform-admin): origem no detalhe e na lista, reclassifica ao mudar afiliado"
```

### Task 9: Admin: channel labels, API types, list column and filter

**Files:**
- Create: `apps/admin/src/lib/acquisition-channels.ts`
- Modify: `apps/admin/src/lib/api.ts` (`WorkspaceSummary.acquisition_channel?: AcquisitionChannel`, `ListWorkspacesParams.channels?: string`, `WorkspaceDetail.acquisition?`, `getAcquisitionChannels`, `AcquisitionChannelRow`)
- Modify: `apps/admin/src/pages/workspaces-params.ts` (`origem: AcquisitionChannel[]` ↔ `?origem=a,b` ↔ `channels`)
- Modify: `apps/admin/src/pages/workspaces-columns.ts` (`{ key: 'origem', label: 'Origem', hideable: true }` after `plan`)
- Modify: `apps/admin/src/pages/workspaces/WorkspacesTable.tsx`, `WorkspacesPhone.tsx`, `WorkspacesFilterChips.tsx`, `WorkspacesToolbar.tsx`
- Modify: `apps/admin/src/pages/workspaces-export.ts` (`{ key: 'origem', label: 'Origem' }`, the label text)
- Test: `apps/admin/src/pages/__tests__/WorkspacesTable.test.tsx`, `WorkspacesPage.test.tsx`, `WorkspacesPage.phone.test.tsx`, a `workspaces-params` test if one exists

**Interfaces:**
- Produces (`acquisition-channels.ts`):
  ```ts
  export type AcquisitionChannel = 'meta_ads' | 'google_ads' | 'chatgpt_ads' | 'other_ads' | 'instagram' | 'other_social' | 'search' | 'ai' | 'email' | 'affiliate' | 'other_sites' | 'direct' | 'unknown' | 'demo' | 'no_data';
  export const ACQUISITION_CHANNELS: readonly AcquisitionChannel[]; // the order above = filter and report order
  export function channelLabel(c: AcquisitionChannel | string | null | undefined): string; // unknown string → 'Outros sites'; null → 'Sem dados'
  export function channelTone(c: AcquisitionChannel): 'primary' | 'info' | 'success' | 'warning' | 'neutral'; // Badge variant
  ```
  Labels exactly: Meta Ads, Google Ads, ChatGPT Ads, Outros anúncios, Instagram (orgânico), Outras redes, Busca orgânica, IA (ChatGPT, Claude…), E-mail, Afiliado, Outros sites, Direto, Não capturado, Demo (vendas), Sem dados.

- [ ] **Step 1: Write the failing tests**

- `channelLabel` for every value and for null/unknown strings.
- params: `?origem=meta_ads,no_data` parses to `['meta_ads','no_data']`, serializes back, and maps to `channels: 'meta_ads,no_data'`; an unknown value is dropped.
- table: a row with `acquisition_channel: 'google_ads'` shows a "Google Ads" badge in the Origem column; a row without the key shows "Sem dados".
- filter chip: choosing Meta Ads and Google Ads calls `listWorkspaces` with `channels: 'meta_ads,google_ads'`; every label in `ACQUISITION_CHANNELS` is offered.
- phone list shows the channel label on each row.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/admin/src` → the new tests FAIL.

- [ ] **Step 3: Implement**

Follow how the `plano`/`status` multi-select chips are built in `WorkspacesFilterChips.tsx`; reuse `Badge` from `components/ui/badge.tsx`.

- [ ] **Step 4: Run to verify they pass, then type-check**

Run: `npx vitest run apps/admin/src && npx tsc -p apps/admin/tsconfig.json --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src
git commit -m "feat(admin): coluna e filtro de origem na lista de workspaces"
```

### Task 10: Admin: "Canais de aquisição" on Métricas

**Files:**
- Create: `apps/admin/src/pages/metricas/ChannelsSection.tsx`, `ChannelsDesktop.tsx`, `ChannelsPhone.tsx`, `channels-view.ts`
- Modify: `apps/admin/src/pages/MetricasPage.tsx` (render `<ChannelsSection />` after `MovementSection`)
- Test: `apps/admin/src/pages/__tests__/MetricsSections.test.tsx`, `MetricasPage.phone.test.tsx`

**Interfaces:**
- Consumes: `getAcquisitionChannels(from_month: string, to_month: string): Promise<{ channels: AcquisitionChannelRow[] }>`, `channelLabel` (Task 9).
- Produces (`channels-view.ts`, pure): `defaultRange(now: Date): { from: string; to: string }` (current São Paulo month both ends); `toDisplayRows(rows: AcquisitionChannelRow[], range): DisplayRow[]` which merges `direct` + `unknown` into one "Direto / desconhecido" row carrying both counts for the tooltip, hides `no_data` when its signups are 0, and appends a Total row; `formatCents(cents: number, currency: 'brl' | 'usd'): string` (`-` for 0 USD, as in the mockup).

- [ ] **Step 1: Write the failing tests**

- `toDisplayRows` merges direct/unknown with the split, keeps `demo`, drops a zero `no_data`, totals each column, never adds BRL to USD.
- section: renders the columns Canal, Cadastros, Assinaram, Pagando hoje, MRR (R$), MRR (US$); clicking "Meta Ads" reveals its campaign rows; changing the range refetches with the new months; an API error shows the Admin's `ErrorState`.
- phone: one card per channel with the same numbers.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/admin/src/pages/__tests__/MetricsSections.test.tsx apps/admin/src/pages/__tests__/MetricasPage.phone.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

Query key `['acquisition-channels', from, to]`. Month picker: two native `<input type="month">` in the desktop toolbar and the phone sheet, with labels.

- [ ] **Step 4: Run to verify they pass, then type-check**

Run: same vitest command, then `npx tsc -p apps/admin/tsconfig.json --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/pages/metricas apps/admin/src/pages/MetricasPage.tsx apps/admin/src/pages/__tests__
git commit -m "feat(admin): canais de aquisição na página de Métricas"
```

### Task 11: Admin: "Origem" panel on the workspace detail

**Files:**
- Create: `apps/admin/src/pages/workspace-detail/OriginPanel.tsx`
- Modify: `apps/admin/src/pages/workspace-detail/PanelsDesktop.tsx`, `WorkspaceDetailPhone.tsx`
- Test: `apps/admin/src/pages/__tests__/WorkspaceDetailPage.test.tsx`, `WorkspaceDetailPage.phone.test.tsx`

**Interfaces:**
- Consumes: `WorkspaceDetail.acquisition` (Task 8 shape, typed in Task 9), `channelLabel`.

- [ ] **Step 1: Write the failing tests**

- with both touches: shows the channel badge with its campaign, and for "Primeira visita" and "Último clique (conta para o canal)" the Data, Fonte (`source / medium`), Campanha, Veio de, Página rows.
- `captured: false` → "Não capturado" and the one-line explanation; `acquisition: null` → "Sem dados"; `channel: 'demo'` → "Demo (vendas)" plus the touches when present.
- phone renders the same content in its panel list.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/admin/src/pages/__tests__/WorkspaceDetailPage.test.tsx apps/admin/src/pages/__tests__/WorkspaceDetailPage.phone.test.tsx` → FAIL.

- [ ] **Step 3: Implement** (layout as the mockup's Detalhe artboard; dates with `date-fns` in pt-BR)

- [ ] **Step 4: Run to verify they pass, then type-check**

Run: same vitest command, then `npx tsc -p apps/admin/tsconfig.json --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/pages/workspace-detail apps/admin/src/pages/__tests__
git commit -m "feat(admin): painel de origem no detalhe do workspace"
```

### Task 12: Full verification and PR notes

**Files:** none new (fix whatever the gates surface).

- [ ] **Step 1: Run every CI gate locally**

Run, in order: `npm run lint`, `npm run format:check`, `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p apps/mcp-widgets/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`, `npm run test`, `npm run check:functions`, `npm run test:functions`, `npm run test:db`.
Expected: all PASS.

- [ ] **Step 2: Prerender smoke**

Run: `npm run build && npm run prerender` (placeholder `VITE_*` as in the `landing-prerender-smoke` job) → `dist/index.html` has `data-ssr="landing"` (proves `acquisition.ts` has no top-level browser access).

- [ ] **Step 3: Browser check of the capture**

Start the CRM dev server (`npm run dev:env` via `preview_start`), open `/?utm_source=meta&utm_medium=paid&utm_campaign=x&fbclid=abc`, navigate to `/precos`, and read `localStorage['mesaas:acq']` with `javascript_tool`: `first.utm_source === 'meta'`, `click === 'fbclid'`, no `abc` anywhere, `landing_path === '/'`.

- [ ] **Step 4: Write the PR description's deploy section**

Copy the spec's deploy order (migrations → `platform-admin` + `mcp-admin` → merge), the Task 1 Step 1 outcome (stash or fallback), the migration numbers checked against `main`, and the post-deploy check: one real staging signup through `/?utm_source=meta&utm_medium=paid&utm_campaign=teste`, then the row in `workspace_acquisition` and the Admin card. Add the follow-up from the spec's §6: capture runs on `/en` without consent, to be added to the pending US-site legal review (`docs/us-english-site-runbook.md`); and that Google Ads needs `utm_campaign` in a tracking template for a campaign breakdown (Ads account change, not code).

- [ ] **Step 5: Commit any fixes**

```bash
git add <the files the gates changed>
git commit -m "chore: ajustes dos gates de CI"
```
