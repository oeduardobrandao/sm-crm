# Crisp session continuity — Design

**Date:** 2026-09-17
**Status:** Revised twice same-day. First revision (fable, twice — once on the design, once on the
written spec — plus an automated Codex review) found a real vulnerability in the first draft: a
blind `localStorage` preload in `index.html` could bind an unauthenticated visitor's Crisp widget
to a *previous* user's verified conversation, unhidden, on `/login` — a public route `AppLayout`'s
`chat:hide` never reaches. Fixed by removing the preload entirely and verifying (twice, against the
live production widget) that the remaining mechanism does not need it. Second revision (a further
automated Codex review, against Crisp's own docs, and against the actual sign-out code) refined
that fix: added a `chat:hide` push to `/login` itself for the pre-existing, broader version of the
same exposure class (see "Why the `index.html` preload was removed"); moved the *entire* Crisp
teardown in `signOut()` — not just the local cache clears — to before its `await`; and made the
token's lack of any server-side revocation explicit rather than implied (see "Non-goals"). Ready
for implementation.

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

## Decisions (from brainstorm, revised after review)

| Decision | Choice |
|---|---|
| Token storage | New table, `crisp_sessions`, touched only by `crisp-identity`'s service-role client. Rejected a `profiles` column — see "Why not a `profiles` column" below. Rejected an HMAC-derived token (no table) — the never-rotate secret and no per-user reset it would require weren't worth the saved migration. |
| Token minting | `gen_random_uuid()` default on the table, handed out via a get-or-create upsert inside `crisp-identity` — the same edge function that already signs the email, same JWT trust boundary. |
| Rebind mechanism | Live: `window.CRISP_TOKEN_ID = token; $crisp.push(['do','session:reset'])`, called from inside `AuthContext.tsx`'s already-`userId`-gated effect. Verified twice against the production widget (see "Verification") — once that it deterministically rebinds to the same session for the same token, and once that Crisp's own client then persists that binding across an ordinary reload **on its own**, with no help from our code. |
| Where the rebind is triggered from | **Only** from inside the authenticated effect — never from a synchronous, pre-authentication guess. `index.html` needs no changes at all; see "Why the preload was removed." |
| Chat open/closed UI state on reload | **Unchanged.** `AppLayout`'s `chat:hide`-on-mount stays exactly as-is; explicitly out of scope. |
| Anonymous→identified message merge (`session_merge`) | Out of scope. Not requested; a pre-login anonymous chat on `/login` is orphaned once binding kicks in, which is an accepted trade-off for an internal CRM. |

### Why not a `profiles` column

The obvious first move — add `crisp_token` to `profiles`, since `getCurrentProfile()` already
fetches the row once per session — turns out to leak. The exact policy name differs by
environment (an important correction from the first draft, which cited the wrong one — see below),
but the conclusion holds on every environment checked: any teammate in the same workspace can
already read any colleague's full `profiles` row, so a `crisp_token` column there would let them
read the token too, and since the token is a bearer credential to a conversation that already
carries the victim's *verified* identity, whoever holds it can load the public `CRISP_WEBSITE_ID`
on any page, set `CRISP_TOKEN_ID`, and read/write that person's support thread as a Verified
session — strictly worse than not having session continuity at all.

**Correction from the first draft:** it cited `profiles_select_same_workspace`
(`20260315_rls_security_audit.sql`) as the live policy. Per `supabase/tests/entitlements/56_profiles_write_lockdown.sql`
and `57_finding1_repro_closed.sql`, that policy **never actually ran on production** — it's
environment drift that happens to exist locally. Production's real policy is `"Users can view own
workspace profiles"`, `USING ((id = auth.uid()) OR (conta_id = get_my_conta_id()))`. The `id =
auth.uid()` arm is just an OR'd escape hatch for a user's own row; it does nothing to restrict the
`conta_id = get_my_conta_id()` arm's cross-member read. The leak conclusion is unchanged — if
anything it's more clearly a live, exercised policy on production than the drifted local one.

A column-level `GRANT SELECT` lockdown on `profiles` (mirroring the existing `membros`/`clientes`
allowlists) was considered and rejected as disproportionate: it breaks every `select('*')` caller
(`getCurrentProfile`, `PerfilTab`, `EmailsAutomaticosSection`, `WorkspaceSetupPage`,
`ConfigurarSenhaPage`, `services/billing.ts`), requires an audit of all of them, and makes every
future column invisible until explicitly granted — exactly the failure mode CLAUDE.md already
warns about for `membros`/`clientes`. A new, minimal, service-role-only table sidesteps all of it.

### Why the `index.html` preload was removed

The first draft of this spec had `index.html` synchronously read a cached `{ userId, token }` pair
from `localStorage` and pre-set `window.CRISP_TOKEN_ID` before the widget script even loads — a
best guess made before React/Supabase auth has resolved anything, intended to avoid a visible
reset flash on a returning user's reload.

Two independent reviews (fable, and an automated Codex pass) flagged the same hole from different
angles, and it checks out against the actual routing: `/login` is a standalone
`<Route path="/login" element={<LoginPage />} />` in `App.tsx`, **not** nested under the
`<AppLayout />` route — so `AppLayout`'s `chat:hide`-on-mount effect never runs there. Verified
live: navigating to the production `/login` page shows the Crisp widget fully loaded and
interactive, unhidden. On a shared or public machine, a stale cached token from a *previous* user
would therefore synchronously bind — and visibly display, since nothing hides it on this route —
that previous user's Verified conversation to whoever is now sitting at the machine, before any
authentication happens on this page load at all. That is a real cross-account exposure, strictly
worse than today's plain anonymous-widget baseline.

**Fix:** the preload is cut entirely. `CRISP_TOKEN_ID` is only ever set from inside
`AuthContext.tsx`'s Crisp-identify effect, which already hard-gates on `if (!userId) return` — so
it categorically cannot run on an unauthenticated view, `/login` included. `index.html` needs no
changes for this feature.

This does not reintroduce a "must rebind on every reload" cost. Verified empirically (see
"Verification") that once a browser has been bound to a token, Crisp's own client persists that
exact session across an ordinary reload **entirely on its own**, via its own cookie — with
`window.CRISP_TOKEN_ID` left unset and no push of any kind from our code. So a returning,
already-bound user's reload resumes silently; the authenticated effect's job on that load is just
to confirm nothing changed (see Data flow, "match" branch) and do nothing further.

**A further review round correctly pointed out this fix is narrower than it can be read to claim.**
Cutting the preload closes the vector *it* introduced (a foreign token loaded from `localStorage`
with zero verification), but Crisp's cookie-based persistence described in the paragraph above is
not new — it is the same mechanism the *already-shipped* `user:email` identity verification push
already relies on, and it applies regardless of anything in this spec. Concretely: if a user's
Supabase session simply lapses while their tab is closed (no explicit sign-out event ever fires —
there is no *transition* for `onAuthStateChange`'s `userChanged` check to detect, since
`activeUserId.current` starts `null` and a session that was merely never restored resolves to
`null` too), nothing in `AuthContext.tsx` — before or after this feature — ever pushes
`session:reset`. Crisp's cookie keeps that browser's session bound and Verified regardless.
Visiting `/login` on that same, now-idle browser shows it, unhidden, exactly as described above.
Before this feature that exposed an anonymous-looking but Verified session; after it, the same gap
exposes a conversation that also follows the user across every device they've used, which is a
materially higher-stakes version of the same pre-existing hole.

This spec closes the *visible* consequence of that broader gap by mirroring `AppLayout`'s own
`chat:hide`-on-mount pattern onto `LoginPage` (see the implementation plan's Task 6) — one line,
same pattern already in use, costs nothing. It does not fully close the underlying gap: the widget
is still bound under the hood even while hidden, and `/login` offers no chat affordance to reset
*to* today, so there is nothing more actionable to do here without a larger, separately-scoped
change (e.g. proactively detecting a silently-expired session and resetting Crisp at that point).
Flagged explicitly as a known, pre-existing, NOT-solved-here limitation rather than left implicit.

## Architecture

| Piece | Purpose |
|---|---|
| `crisp_sessions` (new table) | `user_id uuid primary key references auth.users(id), token uuid not null default gen_random_uuid()`. One row per user who has ever loaded the CRM post-login. |
| `crisp-identity` edge function (extended) | Already verifies the caller's JWT + `email_confirmed_at` and signs the email. Additionally get-or-creates the `crisp_sessions` row and returns `{ signature, crispToken? }` — `crispToken` is best-effort and may be absent. |
| `AuthContext.tsx` (extended) | The existing, already-`userId`-gated Crisp-identify effect compares the fetched `crispToken` against a `{ userId, token }` pair cached in `localStorage`; on a mismatch it live-rebinds and re-establishes the identity pushes; on sign-out/user-change it nulls `CRISP_TOKEN_ID` and clears the cache. |

`index.html` is unchanged.

### Data flow

1. **Authenticated load only.** The existing Crisp-identify effect already returns immediately when
   `!userId` — this now also gates the entire continuity mechanism, so it categorically cannot run
   on any unauthenticated view. Like every effect, it runs once on mount regardless of a fresh full
   reload or an in-SPA transition, so this covers first-ever login, a returning user's reload, and
   a user-to-user switch alike, without needing a hard reload anywhere to work correctly.
2. **Fetch.** Call `crisp-identity` as today; the response now also carries `crispToken` (absent on
   any failure — network, timeout, the upsert itself failing inside the function).
3. **Reconciliation**, entirely inside the effect's existing `active` / `crispResetGeneration`
   guard, after the `await` — the same placement the file already uses to protect the `user:email`
   push from the sign-out race (a write placed *before* that guard could let a swallowed error in
   the logout-clear path leave the *next* browser session, potentially a different physical person
   on a shared machine, bound to the outgoing user's token — persisting across reloads, not just one
   render):
   - **`crispToken` absent this call:** do nothing continuity-related. Not a "mismatch," not a
     signal to clear anything — the existing signature/unsigned `user:email` push proceeds exactly
     as it does today, unaffected. Because nothing is ever bound without an explicitly confirmed
     token in the first place (see previous section), there is no "stale wrong binding" this could
     be leaving in place — the only cost of a transient failure here is that continuity simply
     doesn't get (re)confirmed on this one load, which self-heals on the next successful call.
   - **`crispToken` present, matches the cached `{ userId, token }` for this exact user:** no-op.
     Crisp's own session persistence already has it right (verified).
   - **`crispToken` present, mismatched** (no cache yet — true for essentially every login, since
     login is an in-SPA `navigate({ replace: true })` and this is the first time the effect has run
     with a confirmed `userId`+token pair in this browser; a different cached user; or a rotated
     token): live rebind —
     a. `window.CRISP_TOKEN_ID = crispToken`
     b. `$crisp.push(['do','session:reset'])`
     c. Re-push `user:email` (with the signature) and, if `profile?.nome` is already known,
        `user:nickname` — in that order, immediately after the reset. A reset starts a fresh local
        session that has forgotten any traits set on the prior one, so both must be re-established
        on it explicitly rather than relying on the separately-keyed nickname effect (deps
        `[userId, profile?.nome]`, which a rebind alone doesn't change) to happen to re-fire.
     d. Write `{ userId, token: crispToken }` to the cache.
4. **Sign-out / user-change.** Both existing sites still null `CRISP_TOKEN_ID`, clear the cache, and
   push `session:reset` — but the *placement* in `signOut()` changes, and not only for the local
   clears. The first revision of this spec moved just `window.CRISP_TOKEN_ID = null` and the
   `localStorage` clear before `await supabaseSignOut()`, leaving the actual `session:reset` push
   where it already was — after the await, matching this file's pre-existing placement for the
   `user:email` reset. A further review round (checked directly against the code) correctly pointed
   out that this doesn't go far enough: if `supabaseSignOut()` rejects or hangs, nothing after it
   ever runs, so a push left there would leave Crisp's own cookie-persisted session bound to the
   outgoing user's token **and** identified email indefinitely — the next person on a shared machine
   would see it, unhidden, on `/login` (see previous section). The local clears alone don't prevent
   that; only actually pushing the reset does. Fix: the *entire* teardown — `CRISP_TOKEN_ID = null`,
   the `localStorage` clear, **and** the `session:reset` push itself — moves to execute synchronously
   immediately after `crispResetGeneration.current += 1`, **before** the `await`. Costs nothing to do
   early: the worst case on a `signOut()` failure is an unnecessary reset while the user is still
   technically logged in, which self-heals the next time the identify effect re-runs. This also
   strengthens the pre-existing, not-new-to-this-feature `user:email` reset guarantee for free, since
   `signOut()` only ever had one `session:reset` push site, shared by both features. The
   `userChanged` branch of `onAuthStateChange` needs no such change — it runs synchronously start to
   finish with no `await` in between, so its single existing clear site (immediately before its own
   `session:reset` push) is already safe.
5. **`crispResetGeneration` is deliberately not bumped by the live rebind** (step 3's reset push).
   That ref's documented invariant is "bumped at exactly the two places that push session:reset...
   and nowhere else" (sign-out, user-change) — a same-identity self-correction is not an "outgoing
   identity" event the way those two are, so it stays excluded on purpose. The implementation should
   update that ref's comment to name this third push site and say explicitly why it's excluded, so a
   future reader doesn't "fix" it into bumping the counter.

### Error handling

- The token upsert inside `crisp-identity` is best-effort: on failure, the function still returns
  `{ signature }` with `crispToken` simply absent. Identity verification is the more established,
  more important of the two behaviors and must not become collateral damage of the new table.
- **Explicitly rejected:** an earlier review round suggested that an absent/failed `crispToken`
  should trigger clearing `CRISP_TOKEN_ID` and the cache and resetting to anonymous ("fail closed").
  That guidance was written against the preload-based design, where a stale *foreign* binding could
  already be live on an unauthenticated view and needed tearing down. Under this design that
  scenario cannot arise — nothing is ever bound without a confirmed match (see Data flow, step 3).
  Applying "fail closed" here regardless would instead actively regress an already-correct,
  already-established binding on every transient hiccup (the existing 5s invoke timeout, a slow
  network) for no benefit, causing needless visible resets. Rejected; see the "absent" branch above.
- Every `window.$crisp?.push(...)` call is already individually wrapped in `try/catch` throughout
  `AuthContext.tsx` on the principle that "a support-tooling failure must never break auth" — the
  new pushes follow the same discipline, as do the `localStorage` reads/writes (private browsing,
  blocked storage).
- **Known, accepted limitation:** if a browser's cookies are cleared while its `localStorage`
  survives (an unusual split, since most "clear browsing data" flows clear both together), the
  cached `{ userId, token }` pair would read as a "match" even though Crisp's own cookie-based
  session is gone, so no rebind fires and continuity silently doesn't resume until something else
  invalidates the cache (e.g. a genuine token rotation). Not engineered around — it would require
  cross-checking Crisp's own live session state on every load for a corner case with no more
  exposure than today's plain identity-verification baseline already has in the same scenario.

## Verification

Two claims this design depends on were tested directly against the production widget on
`mesaas.com.br` (client-side widget state only; no user data touched):

**1. A live rebind is deterministic.** Cycling `CRISP_TOKEN_ID` through two values and back:

| Step | `CRISP_TOKEN_ID` | Resulting `session:identifier` |
|---|---|---|
| 1 | `test-token-fable-review-aaa` | `session_c10629a9-5942-4315-b395-35fa59d66284` |
| 2 | `test-token-fable-review-bbb` | `session_a6e033e7-93cd-4cf7-b42d-d56231ea034e` (different) |
| 3 | `test-token-fable-review-aaa` (again) | `session_c10629a9-5942-4315-b395-35fa59d66284` (**identical to step 1**) |

**2. Once bound, Crisp persists the session across a reload on its own.** After binding to a token
(resulting session `session_c658dc44-7885-4db7-ae39-a5fcee0ad1e4`), a full page reload — with
`window.CRISP_TOKEN_ID` left **unset**, simulating no preload at all — resumed the **identical**
`session_c658dc44…` session with no push of any kind from our code. This is what makes cutting the
`index.html` preload free: the reconciliation effect's "match" branch has nothing to do on a
returning user's plain reload, because Crisp already has it right.

## Testing

- `supabase/tests/entitlements/` — new file (the directory currently runs up to `95_...`; confirm
  the actual next number at implementation time rather than trusting this document). Same
  service-role-only shape as `78_admin_mcp_oauth_grants.sql` in spirit, but not a literal copy: that
  file inserts its test row while still the table owner, before switching roles, so it never
  actually exercises a `service_role` *positive* read/write — write a real one here. Also skip its
  trailing, unrelated `global_banners` CHECK assertion.
- `crisp-identity`'s get-or-create upsert must live in its own small, dependency-injected module —
  mirroring `sign.ts`'s pure-function pattern. `crisp-identity_test.ts` deliberately never imports
  `index.ts` (it throws at module load without `CRISP_IDENTITY_SECRET`, which CI's
  `edge-function-tests` job doesn't set), so the upsert needs the same testable shape `signEmail`
  already has, not a test that imports the handler directly.
- The upsert must use `.upsert({ user_id }, { onConflict: 'user_id' })` with `ignoreDuplicates`
  left at its default (`false`) — **not** `true`. `ignoreDuplicates: true` compiles to
  `ON CONFLICT DO NOTHING`, which returns no row on the conflicting case, breaking "a second call
  for the same user returns the same token, not a new one."
- `AuthContext.test.tsx` — `CRISP_TOKEN_ID` is a plain `window` property assignment, not a
  `$crisp.push(...)` call, so a spy on `push` will never observe it; assertions on it must read
  `window.CRISP_TOKEN_ID` directly. New cases: match (no rebind pushes, no `CRISP_TOKEN_ID` write),
  first-login/mismatch (reset pushed, `CRISP_TOKEN_ID` set, email+nickname re-pushed after in
  order, cache written), `crispToken` absent (no continuity-related pushes or writes at all —
  existing signature/unsigned behavior unaffected), and sign-out (`CRISP_TOKEN_ID` nulled and the
  cache cleared before the `supabaseSignOut()` await resolves, not after — e.g. by making that
  mock's promise never resolve in the test and asserting the clear already happened).
- `lib/__mocks__/supabase.ts` needs no shape change — its `functions.invoke` mock already returns
  whatever a test queues; tests queue `{ data: { signature, crispToken } }` (or omit `crispToken`)
  directly.
- Add `CRISP_TOKEN_ID?: string | null` to **one** of the two existing `declare global Window`
  blocks (`TopBarActions.tsx` or `MobileNav.tsx` both currently declare `$crisp` separately) — a TS
  global augmentation merges across the whole compilation, so one is sufficient; `AuthContext.tsx`
  needs no declaration of its own, and there's no need to touch both files.
- One implementation-time browser check worth doing, not gating the plan on: whether a live
  `session:reset` fired by the rebind (step 3 above) re-shows a chat bubble that `AppLayout`'s
  `chat:hide` had already hidden on mount. If it does, re-push `chat:hide` immediately after the
  rebind's re-established pushes.

## Migration

New file, `supabase/migrations/<timestamp>_crisp_sessions.sql` (timestamp chosen at
implementation/PR time per CLAUDE.md's migration-version-collision guidance — check against
`main`'s latest prefix first), following `20260908000001_admin_mcp_oauth_grants.sql`'s idempotent
shape:

```sql
CREATE TABLE IF NOT EXISTS crisp_sessions (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token      uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE crisp_sessions ENABLE ROW LEVEL SECURITY;

-- No policy for authenticated/anon: only crisp-identity's service-role client ever
-- touches this table. Hosted Supabase grants anon/authenticated/service_role
-- EXPLICITLY on every new table via pg_default_acl -- not via the implicit PUBLIC
-- pseudo-role -- so REVOKE ... FROM PUBLIC alone would leave anon/authenticated
-- fully able to read/write this table. Name the roles explicitly instead.
REVOKE ALL ON crisp_sessions FROM anon, authenticated;
GRANT ALL ON crisp_sessions TO service_role;

DROP POLICY IF EXISTS crisp_sessions_service_role ON crisp_sessions;
CREATE POLICY crisp_sessions_service_role ON crisp_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

Deployment order: run the migration, then deploy `crisp-identity` (`--no-verify-jwt`, matching its
existing deploy — it verifies the JWT itself), then merge/deploy the frontend. The best-effort
design tolerates the frontend landing slightly ahead of the migration (just gets no `crispToken`
back for a while), but this is the correct order regardless.

## Non-goals

- Restoring chat open/closed UI state across a reload.
- Merging a pre-login anonymous conversation into the post-login identified one
  (`CRISP_RUNTIME_CONFIG.session_merge`).
- Per-user token rotation UI/flow. `user_id` is the table's primary key, so "rotating" a token
  means updating that user's existing row, not inserting a new one — nothing in this spec builds a
  trigger for that update.
- **A revocation mechanism.** Checked directly against Crisp's own Session Continuity docs: there is
  no server-side API to revoke or expire a `CRISP_TOKEN_ID` once issued. The only documented
  invalidation path is client-side (`CRISP_TOKEN_ID = null` + `session:reset`, exactly what this spec
  already does on sign-out). Rotating our own `crisp_sessions` row — updating `token` to a new
  `gen_random_uuid()` — stops any *future* rebind from using the old value, but does **not** revoke
  the old value at Crisp's end: if it was ever copied (a captured request, a compromised browser, a
  future bug reintroducing the leak class this spec's own review process found once already), it
  remains a valid credential to that conversation at Crisp indefinitely, no matter what our database
  says. This is a real limitation of Crisp's platform, not an oversight in this design — stated
  plainly here rather than glossed as a routine "start over" operation, so nobody later assumes
  rotation is a meaningful incident response to a leaked token. If that ever matters (e.g. an
  account-deletion or incident-response requirement), it needs its own spec, and would likely mean
  asking Crisp support to intervene manually, since no self-service API exists for it today.
- Any change to Admin or Hub — neither loads Crisp today and neither gains it here.
