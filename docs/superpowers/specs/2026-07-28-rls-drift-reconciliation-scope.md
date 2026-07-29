# RLS / migration drift reconciliation — scope

**Date:** 2026-07-28 (revised 2026-07-29 after external review)
**Status:** scoping only. No remediation written, nothing applied.
**Trigger:** Migration B (`20260728000002`) aborted against production in its own
post-condition. Root-causing that failure surfaced a live cross-tenant data
exposure.

## Summary

**Production has a confirmed, reproducible cross-tenant read.** Any authenticated
user can issue one UPDATE against their own `profiles` row and read another
workspace's data without holding any membership in it. This is Finding 1 and it
is the reason this document exists; everything else is secondary.

The root cause is that `20260315_rls_security_audit.sql` is recorded in
`schema_migrations` but never executed. It was written to close exactly this.

Nothing here is fixed by [PR #258](https://github.com/oeduardobrandao/sm-crm/pull/258),
which addresses only the four legacy policies that would have defeated Migration B.

## Method and confidence

Against a fresh `supabase db dump --linked` of production (verified
byte-identical to the dump taken during the incident — 322,261 bytes, 73 tables,
matching the known production table count), every `CREATE POLICY` and
`CREATE FUNCTION` name in every migration was checked for presence.

Positive controls (present, as expected): `post_media_set_from_uploads`,
`file_insert_with_quota`, `set_membro_crm_user`, `can_see_financials`,
`mcp_api_keys`, `tiktok_accounts`. Negative control (absent, as expected):
`guard_financial_write`, from the un-applied Migration B.

**A name absent from production is not by itself evidence of a failed apply** —
a later migration may have dropped it deliberately. Every apparent gap must be
checked against subsequent migrations before being called drift. An earlier
revision of this document got that wrong (see "Corrections" below).

**Blind spots.** Policies and functions only. Tables and columns were covered by
the earlier audit that produced the `20260727000001`–`8` series. Indexes,
constraints, triggers and grants were **not** swept. `storage.objects` policies
cannot be checked — the dump contains no storage schema.

### Ruled out

| Apparent gap | Verdict |
|---|---|
| `post_media_*` (`20260409`), `tiktok_posts_public_read` (`20260718000001`) | `storage.objects` policies; dump has no storage schema. Not evaluable. |
| `ws_update_owner` (`20260317`) | Superseded by `ws_update_owner_admin` in `20260322`. |
| ~60 `_kb_*` functions | Temporary helpers the seed migrations `DROP` themselves. |
| Estúdio / `designs` schema (11 migrations, `20260702`–`20260706`) | **Retired on purpose.** `20260722000002_drop_estudio_objects.sql` drops the tables and RPCs and asserts their absence; `20260722000003` removes the plan columns. Confirmed: a local migrations-built database also has zero of these tables, so production matches. Not drift. |

## Finding 1 (P0) — cross-tenant read via `profiles.conta_id`

### The vector

Production has all three of:

```sql
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);          -- no WITH CHECK

-- the only trigger on the table:
trg_validate_active_workspace BEFORE UPDATE OF active_workspace_id
```

With `WITH CHECK` omitted, Postgres reuses the `USING` expression as the check.
`auth.uid() = id` stays true no matter which of *your own* columns you change, and
the trigger guards `active_workspace_id` only — **`conta_id` is unguarded**.

`conta_id` is a tenant selector. The legacy `FOR ALL` policies on `clientes`,
`membros`, `leads`, `integracoes_status` (and, until PR #258, `transacoes` and
`contratos`) read it through `get_user_conta_id()`:

```sql
USING (auth.uid() = user_id OR conta_id = public.get_user_conta_id())
-- get_user_conta_id() := SELECT conta_id FROM profiles WHERE id = auth.uid()
```

No membership check anywhere in that chain. So: point your own `conta_id` at any
workspace UUID and its rows become visible.

### Reproduced

Production's exact ACL, policies and helper were replayed on a local database.
An attacker who is a member of workspace A only, against a client row in
workspace B:

```
attacker is a member of victim_ws: NO
rows visible in victim workspace BEFORE: 0
UPDATE profiles SET conta_id = <victim_ws> succeeded: t
rows visible in victim workspace AFTER:  1
```

One statement, against the attacker's own row, no membership required.

### Also open: self-promotion

The same missing `WITH CHECK` allows `update profiles set role = 'owner'`.
Lower severity than the above but the same root cause and the same fix.

Neither path compromises per-admin financial visibility: `can_see_financials()`
reads `workspace_members`, which is properly locked
(`wm_no_client_insert/update/delete` all `USING (false)`), and `get_my_conta_id()`
reads `active_workspace_id` *and* verifies membership.

## Finding 2 (P1) — `profiles.role` is not per-workspace

`get_my_role()` is `SELECT role FROM profiles WHERE id = auth.uid()`. Workspace
switching writes `active_workspace_id` and `conta_id` and never touches `role`
(`store/workspace.ts:103`, `Sidebar.tsx:78`, `lib/supabase.ts:131`).

So an owner in workspace A who is an agent in workspace B keeps
`profiles.role = 'owner'` while working in B. `leads_select` gates on
`get_my_role() IS DISTINCT FROM 'agent'`, so that user retains lead access in a
workspace where they are an agent.

Migration A already treats `workspace_members.role` as the per-workspace source
of truth for exactly this reason. Any policy still keyed on `get_my_role()` needs
the same treatment. `20260315` does not address this — it predates
multi-workspace — so remediation must go beyond it.

## Finding 3 (P2) — `20260315` never ran; the rest of its intent is unmet

Recorded as applied; never executed. Evidence: three tables still carry policies
it explicitly `DROP`s (`tags_conta`, `reports_conta`, the old `profiles` triple),
and production's `workflows_select` reads a `profiles` subquery rather than
`get_my_conta_id()`. `20260404` *did* run, which is why exactly
`transacoes_select`, `contratos_select` and `leads_select` exist in the newer form.

| Table | Production | Intended |
|---|---|---|
| `profiles` | 3 legacy; `GRANT ALL` | per-command + column-scoped UPDATE |
| `clientes`, `membros`, `integracoes_status` | 2 legacy `FOR ALL` each | 4 per-command each |
| `leads` | `"Leads: workspace access"` + `leads_select` | 4 per-command |
| `instagram_post_tags`, `analytics_reports` | 1 `FOR ALL` each | 4 per-command each |
| `workflows`, `workflow_templates`, `workflow_etapas` | 4 each, `profiles`-subquery bodies | same 4, `get_my_conta_id()` bodies |
| `transacoes`, `contratos` | — | **handled by PR #258** |

`get_user_conta_id()` exists in production but in **no migration and no
application code**. It is referenced only by the legacy policies and should be
dropped once they are.

## Remediation — the traps

**`20260315` must not be replayed verbatim.** It predates
`20260317_multi_workspace.sql` and is four months stale.

1. **It would downgrade `get_my_conta_id()`.** Its version omits the
   `workspace_members` `EXISTS` check that production's current version has.

2. **Its `profiles` UPDATE allowlist is `(nome, avatar_url)`; the app writes far
   more.** Union of what the CRM updates with the user's own JWT:

   | Column | Written by |
   |---|---|
   | `active_workspace_id`, `conta_id` | `Sidebar.tsx:78`, `lib/supabase.ts:131`, `store/workspace.ts:103` |
   | `nome`, `empresa`, `telefone`, `whatsapp`, `marketing_opt_in` | `PerfilTab.tsx:48` |
   | `nome`, `empresa` | `WorkspaceSetupPage.tsx:43` |
   | `onboarding_complete`, `nome` | `ConfigurarSenhaPage.tsx:161` |

   A verbatim replay breaks workspace switching, profile editing and onboarding.

3. **`conta_id` and `active_workspace_id` must NOT become bare column grants.**
   This is the trap that makes the naive fix useless: re-granting
   `UPDATE (conta_id)` leaves the tenant selector under user control and Finding 1
   survives the "fix". The honest client is not the threat model — the client
   writing both columns together is a convention, not an enforced invariant.

   **Preferred:** move switching into a `SECURITY DEFINER` RPC that verifies
   membership and sets both columns, and grant the client `UPDATE` on neither.
   `switchWorkspace()` is already a single choke point, so the client change is
   small. **Alternative:** keep the grants but add a `WITH CHECK` binding *both*
   columns to a real `workspace_members` row. Either way, membership must be
   enforced in the database, not assumed from the caller.

4. **Switching the legacy tables from `get_user_conta_id()` to
   `get_my_conta_id()` is a live visibility change.** It is the correct
   multi-workspace semantic, but for any user whose `active_workspace_id` differs
   from their `conta_id` it changes which rows they see. Check against real data
   before shipping.

5. **Replace the legacy policies; never supplement them.** Permissive policies
   are OR-combined, so adding a correct policy beside `"Users can update own
   profile"` changes nothing — that is precisely how Migration B would have
   failed silently had its post-condition not caught it. Every remediation
   migration must assert an **exact final policy inventory and ACL state**, in the
   shape PR #258 uses: exact name set, plus per-policy assertions that each
   required conjunct is present in `qual` and `with_check` **separately**.

## Suggested sequencing

1. **PR #258** — unblocks Migration B. Independent of everything below.
2. **Finding 1, as its own migration.** Highest value, smallest diff: replace the
   `profiles` UPDATE policy (drop, don't supplement), revoke table UPDATE, grant
   only the safe columns, and route workspace switching through a membership-
   checking RPC. Exclude `role`, `conta_id`, `active_workspace_id` from any grant.
3. **Finding 2** — audit every `get_my_role()` call site and move per-workspace
   authorization to `workspace_members.role`.
4. **Finding 3** — per-command policies for the remaining tables, one table per
   migration, each with its own exact-inventory post-condition. Drop
   `get_user_conta_id()` last, once nothing references it.
5. **A CI job that runs `scripts/test-entitlements.sh`.** It runs in no workflow
   today, so its 17 suites protect nothing on `main`.

## Required test coverage

Browser smoke tests cannot prove RLS — the table owner bypasses row security, so
only tests that `SET LOCAL ROLE authenticated` with forged JWT claims prove
anything. Each of these is currently uncovered and must land with its slice:

- **Cross-tenant denial via forged `conta_id`** — the Finding 1 reproduction,
  inverted: after the fix, the UPDATE must fail (or the rows must stay invisible).
  This test exists as a scratch reproduction today and should become a suite.
- **Non-member workspace switch denied** — switching to a workspace you do not
  belong to must be rejected by the database, not by the client.
- **`role` update denied** — `update profiles set role = 'owner'` must fail.
- **Safe profile edits still work** — `nome`, `empresa`, `telefone`, `whatsapp`,
  `marketing_opt_in`, `onboarding_complete`. The positive counterpart, without
  which an over-broad revoke passes unnoticed.
- **Per-workspace role** — a user who is owner in A and agent in B is treated as
  an agent while active in B.

RLS denies by filtering, not by raising, so every denial assertion must check the
affected-row count *and* that the underlying data is unchanged.

## Corrections to the first revision

- **A "Finding 2" claiming the Estúdio/`designs` schema was recorded-but-absent
  has been removed.** It was a false positive: `20260722000002` retires the
  feature deliberately. The check that would have caught it — does a later
  migration drop this object? — was applied to the `_kb_*` helpers and not to a
  dedicated teardown migration. Its inventory was also incomplete (11 migrations,
  not 8; it omitted `20260702000002`, `20260702000003`, `20260702000005`).
- **The `profiles` finding was understated.** The first revision reported only
  self-promotion via `role`. The cross-tenant read via `conta_id` is the more
  severe path and was missed.
- **The proposed remediation was itself unsafe**, granting `UPDATE (conta_id)` as
  a bare column privilege and so preserving the vulnerability it set out to fix.

## Open questions

- How did version rows get recorded without the SQL running, and is the practice
  that produced it still in use? Without an answer, this recurs.
- Does staging share Finding 1? Not checked — the repo was linked to production
  throughout this audit and the link state flips between the two.
