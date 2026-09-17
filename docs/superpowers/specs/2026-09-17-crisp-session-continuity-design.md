# Crisp session continuity — Design

**Date:** 2026-09-17
**Status:** Approved. Brainstormed 2026-09-17, reviewed by an independent model (fable) mid-design,
one claim verified empirically against the live widget on mesaas.com.br. Ready for implementation.

## Goal

Today the CRM does **identity verification** only: once a user logs in, `AuthContext.tsx` pushes
`user:email` with an HMAC signature from the `crisp-identity` edge function, which puts a green
"Verified" checkmark on the Crisp session. That is a different Crisp feature from **Session
Continuity**, and does not do what its name suggests — per Crisp's own docs, identity
verification "does not bind the session to that user." Each browser/device still gets its own
throwaway anonymous session, so the same agency user chatting with Mesaas support from work and
from home sees two unrelated conversations, and clearing cookies loses history entirely.

This spec adds Session Continuity: binding the widget to a backend-issued, per-user random token
(`CRISP_TOKEN_ID`) so the same conversation follows the user across browsers, devices, and cookie
clears.

**Scope:** `apps/crm` only. Admin and Hub load no Crisp integration at all and stay that way.

## Decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Token storage | New table, `crisp_sessions`, touched only by `crisp-identity`'s service-role client. Rejected a `profiles` column — see "Why not a `profiles` column" below. Rejected an HMAC-derived token (no table) — the never-rotate secret and no per-user reset it would require weren't worth the saved migration. |
| Token minting | `gen_random_uuid()` default on the table, handed out via a get-or-create upsert inside `crisp-identity` — the same edge function that already signs the email, same JWT trust boundary. |
| Rebind mechanism | Live: `window.CRISP_TOKEN_ID = token; $crisp.push(['do','session:reset'])`, executed as soon as the token is known — **not** only "before script injection" as Crisp's docs literally say. Verified empirically (see "Verification" below) that this deterministically rebinds an already-loaded widget to the same session every time. |
| Chat open/closed UI state on reload | **Unchanged.** `AppLayout`'s `chat:hide`-on-mount stays exactly as-is; explicitly out of scope. |
| Anonymous→identified message merge (`session_merge`) | Out of scope. Not requested; a pre-login anonymous chat on `/login` is orphaned once binding kicks in, which is an accepted trade-off for an internal CRM. |

### Why not a `profiles` column

The obvious first move — add `crisp_token` to `profiles`, since `getCurrentProfile()` already
fetches the row once per session — turns out to leak. The only `SELECT` policy on `profiles`
(`profiles_select_same_workspace`, `20260315_rls_security_audit.sql`) is scoped to the whole
workspace, not to `auth.uid()`, and carries no column-level allowlist the way `membros`/`clientes`
do. Cross-member profile reads are a live, intended pattern (`workspace.ts` embeds
`profiles!inner(id, nome, avatar_url, created_at)` for the team roster), so RLS — the only
enforcement layer the browser's anon-key client is subject to — would let any teammate in the same
workspace `.select('crisp_token')` on a colleague's row today. Because the token is a bearer
credential to a conversation that already carries the victim's *verified* identity, whoever holds
it can load the public `CRISP_WEBSITE_ID` on any page, set `CRISP_TOKEN_ID`, and read/write that
person's support thread as a Verified session — a strictly worse outcome than not having session
continuity at all.

A column-level `GRANT SELECT` lockdown on `profiles` (mirroring the existing `membros`/`clientes`
allowlists) was considered and rejected as disproportionate: it breaks every `select('*')` caller
(`getCurrentProfile`, `PerfilTab`, `EmailsAutomaticosSection`, `WorkspaceSetupPage`,
`ConfigurarSenhaPage`, `services/billing.ts`), requires an audit of all of them, and makes every
future column invisible until explicitly granted — exactly the failure mode CLAUDE.md already
warns about for `membros`/`clientes`. A new, minimal, service-role-only table sidesteps all of it.

## Architecture

| Piece | Purpose |
|---|---|
| `crisp_sessions` (new table) | `user_id uuid primary key references auth.users(id), token uuid not null default gen_random_uuid()`. One row per user who has ever loaded the CRM post-login. |
| `crisp-identity` edge function (extended) | Already verifies the caller's JWT + `email_confirmed_at` and signs the email. Additionally get-or-creates the `crisp_sessions` row and returns `{ signature, crispToken }`. |
| `apps/crm/index.html` (extended) | Reads a cached `{ userId, token }` from `localStorage` synchronously, right before injecting `l.js`, and pre-sets `window.CRISP_TOKEN_ID` as a best guess. |
| `AuthContext.tsx` (extended) | On the existing Crisp-identify effect, compares the fetched `crispToken` against the cached pair; on any mismatch, live-rebinds (`CRISP_TOKEN_ID` + `session:reset`) and updates the cache. On sign-out / user-change, nulls `CRISP_TOKEN_ID` and clears the cache before the existing `session:reset` push. |

### Data flow

1. **Page load (any state, logged in or not).** `index.html`'s deferred loader reads
   `localStorage['mesaas_crisp_token']` (a JSON `{ userId, token }` or absent). If present, sets
   `window.CRISP_TOKEN_ID = token` before appending `l.js`. This is a best guess made before React
   has resolved auth — right for a returning user reopening a tab, irrelevant (harmlessly wrong)
   for a fresh browser or a different user.
2. **Auth resolves, profile hydrates.** The existing Crisp-identify `useEffect` in `AuthContext.tsx`
   calls `crisp-identity` (as it already does for the signature) and now also receives
   `crispToken`.
3. **Reconciliation.** Compare `{ userId: user.id, token: crispToken }` against the cached pair:
   - **Match** (same user, same token — the common case for a returning user in the same
     browser): no-op. The widget is already correctly bound from step 1.
   - **Mismatch** (different user, no cache yet, or a rotated token — notably including *every
     login*, since login is an in-SPA `navigate({ replace: true })`, never a hard reload, so the
     widget script that ran in step 1 had no way to know the newly-authenticated user yet): set
     `window.CRISP_TOKEN_ID = crispToken`, push `['do','session:reset']`, then write the new pair
     to `localStorage`.
   - Both branches (and the write itself) happen **inside** the effect's existing `active` /
     `crispResetGeneration` guard, after the `await` — i.e. in the same place the file already
     guards the `user:email` push against the sign-out race described in its comments. A write
     placed before that guard would let a swallowed error in the logout-clear path (every Crisp
     push here is already wrapped in `try/catch`) leave the *next* browser session — potentially a
     different physical person on a shared machine — bound to the outgoing user's token, and unlike
     the email race this would persist across reloads, not just one render.
4. **Sign-out / user-change** (the two existing `push(['do','session:reset'])` sites in
   `AuthContext.tsx`): additionally set `window.CRISP_TOKEN_ID = null` and
   `localStorage.removeItem('mesaas_crisp_token')`, **before** the reset push — mirroring Crisp's
   documented logout pattern and this file's existing `resetAnalytics()` / `clearPopupSession()`
   precedent. This stays in the `userChanged` branch of `onAuthStateChange` (not moved into
   `signOut()` alone), so a second tab on the same shared machine that observes the
   `SIGNED_OUT`/`SIGNED_IN` events itself still clears its own stale write rather than relying on
   the tab that actually called `signOut()`.

### Error handling

- The token upsert inside `crisp-identity` is best-effort: on failure, the function still returns
  `{ signature }` with `crispToken` simply absent. Identity verification is the more established,
  more important of the two behaviors and must not become collateral damage of the new table.
- Every `window.$crisp?.push(...)` call is already individually wrapped in `try/catch` throughout
  `AuthContext.tsx` on the principle that "a support-tooling failure must never break auth" — the
  new pushes (`CRISP_TOKEN_ID` set + `session:reset` on rebind, and the null-out on logout) follow
  the same discipline.
- `index.html`'s synchronous `localStorage` read is wrapped in `try/catch` (private browsing,
  blocked storage) and placed inside the deferred loader function, immediately before
  `appendChild`, not at parse time — cheap, and keeps it genuinely "during injection" rather than
  racing anything else on the critical path.

## Verification

The load-bearing empirical claim — that a *live* `CRISP_TOKEN_ID` + `session:reset` (as opposed to
setting the variable only before the script first loads, which is all Crisp's docs describe) truly
rebinds an already-running widget, deterministically, to the same session — was tested directly
against the production widget on `mesaas.com.br` (client-side widget state only; no user data
touched):

| Step | `CRISP_TOKEN_ID` | Resulting `session:identifier` |
|---|---|---|
| 1 | `test-token-fable-review-aaa` | `session_c10629a9-5942-4315-b395-35fa59d66284` |
| 2 | `test-token-fable-review-bbb` | `session_a6e033e7-93cd-4cf7-b42d-d56231ea034e` (different) |
| 3 | `test-token-fable-review-aaa` (again) | `session_c10629a9-5942-4315-b395-35fa59d66284` (**identical to step 1**) |

This confirms the design's central mechanism: the reconciliation step in the data flow above
(triggered on every login, since login never hard-reloads) is sufficient on its own — no
workaround, no forced page reload after authentication, needed.

## Testing

- `supabase/tests/entitlements/` — new file (next available number after `78_...`), same shape as
  `78_admin_mcp_oauth_grants.sql`: assert `authenticated` and `anon` can neither read nor write
  `crisp_sessions` (table-privilege or zero-row, matching that file's `insufficient_privilege`
  pattern), and that `service_role` can. Gated by CI's `entitlement-tests` job.
- `supabase/functions/__tests__/crisp-identity_test.ts` — add cases for the get-or-create upsert
  (first call creates a row and returns its token; a second call for the same user returns the
  *same* token, not a new one) and for the best-effort failure path (signature still returned if
  the token upsert fails).
- `apps/crm/src/context/__tests__/AuthContext.test.tsx` — extend the existing `$crisp.push`
  sequence assertions with: match case (no rebind pushes), mismatch case (null/rebind pushes in
  order, cache updated), and sign-out/user-change (null pushed and cache cleared before
  `session:reset`, consistent with the file's existing race-guard tests).
- `apps/crm/src/lib/__mocks__/supabase.ts` — extend the `functions.invoke` mock response shape to
  include `crispToken` alongside `signature`.
- Add `CRISP_TOKEN_ID?: string | null` to the `declare global Window` block that already declares
  `$crisp`.

## Migration

New file, `supabase/migrations/<timestamp>_crisp_sessions.sql` (timestamp chosen at
implementation/PR time per CLAUDE.md's migration-version-collision guidance — check against
`main`'s latest prefix first), following `20260908000001_admin_mcp_oauth_grants.sql` verbatim:

```sql
CREATE TABLE crisp_sessions (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token      uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE crisp_sessions ENABLE ROW LEVEL SECURITY;

-- No policy for authenticated/anon: only crisp-identity's service-role client ever
-- touches this table. REVOKE only from anon/authenticated — REVOKE FROM PUBLIC would
-- also strip service_role.
REVOKE ALL ON crisp_sessions FROM anon, authenticated;
GRANT ALL ON crisp_sessions TO service_role;

CREATE POLICY crisp_sessions_service_role ON crisp_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

## Non-goals

- Restoring chat open/closed UI state across a reload.
- Merging a pre-login anonymous conversation into the post-login identified one
  (`CRISP_RUNTIME_CONFIG.session_merge`).
- Per-user token rotation UI/flow. The table supports it (an operator could manually issue a new
  token row), but nothing in this spec builds a trigger for it. Rotating a token is a "start over"
  operation — the old conversation stays in the Crisp inbox but becomes unreachable from the
  widget — not something to do routinely.
- Any change to Admin or Hub — neither loads Crisp today and neither gains it here.
