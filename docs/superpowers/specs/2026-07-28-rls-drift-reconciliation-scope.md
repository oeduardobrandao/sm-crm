# RLS / migration drift reconciliation — scope

**Date:** 2026-07-28
**Status:** scoping only. No remediation written, nothing applied.
**Trigger:** Migration B (`20260728000002`) aborted against production in its own
post-condition. Root-causing that failure surfaced a class of drift the earlier
schema audit could not see.

## Summary

Production's `schema_migrations` records migrations that never executed. Two
groups are confirmed:

1. **`20260315_rls_security_audit.sql`** — recorded, never ran. 33 of its
   policies are absent. This is the drift that broke Migration B, and it leaves
   a live privilege-escalation path on `profiles`.
2. **The Estúdio / `designs` series** (8 migrations, `20260702`–`20260706`) —
   recorded, and their entire schema is absent from production: no
   `post_designs`, `designs`, `design_asset_refs` or `ai_image_generations`
   table, and none of their ~20 functions. Needs a decision before any action;
   this may be an intentional teardown from the OpenPencil pivot rather than a
   failed apply.

Nothing here is fixed by [PR #258](https://github.com/oeduardobrandao/sm-crm/pull/258),
which addresses only the four legacy policies that would have defeated Migration B.

## Method and confidence

Against a fresh `supabase db dump --linked` of production (verified
byte-identical to the dump taken during the incident — 322,261 bytes, 73 tables,
which matches the known production table count):

- **Every** `CREATE POLICY` name in **every** migration was checked for presence.
- **Every** `CREATE FUNCTION` name in **every** migration was checked for presence.

Positive controls (present, as expected): `post_media_set_from_uploads`,
`file_insert_with_quota`, `set_membro_crm_user`, `can_see_financials`,
`mcp_api_keys`, `tiktok_accounts`.
Negative control (absent, as expected): `guard_financial_write`, from the
un-applied Migration B.

**Blind spots.** This method covers policies and functions. Tables and columns
were covered by the earlier drift audit that produced the `20260727000001`–`8`
series. Indexes, constraints, triggers and grants were **not** swept
exhaustively. `storage.objects` policies cannot be checked at all — the dump
contains no storage schema.

### Ruled out (false positives)

| Apparent gap | Verdict |
|---|---|
| `post_media_*` (`20260409`), `tiktok_posts_public_read` (`20260718000001`) | `storage.objects` policies; dump has no storage schema. Not evaluable, not evidence. |
| `ws_update_owner` (`20260317`) | Superseded by `ws_update_owner_admin` in `20260322`. Normal evolution. |
| ~60 `_kb_*` functions (seed migrations) | Temporary helpers the seed migrations `DROP` themselves. |

## Finding 1 — `20260315_rls_security_audit.sql` never ran

Recorded as applied; the SQL never executed. The version row was backfilled.

Evidence is conclusive rather than circumstantial — three tables still carry
policies this migration explicitly `DROP`s (`tags_conta` on
`instagram_post_tags`, `reports_conta` on `analytics_reports`, the old `profiles`
triple), and production's `workflows_select` reads
`SELECT profiles.conta_id FROM profiles WHERE id = auth.uid()` rather than the
migration's `get_my_conta_id()`.

`20260404_agent_rls_restriction.sql` **did** run, which is why exactly
`transacoes_select`, `contratos_select` and `leads_select` exist in the newer
form while the rest of `20260315` is missing.

### What production actually has

| Table | Production | `20260315` intends |
|---|---|---|
| `profiles` | 3 legacy policies; `GRANT ALL` to `authenticated` | 4 per-command policies + column-scoped UPDATE |
| `clientes` | 2 legacy `FOR ALL` | 4 per-command |
| `membros` | 2 legacy `FOR ALL` | 4 per-command |
| `integracoes_status` | 2 legacy `FOR ALL` | 4 per-command |
| `leads` | `"Leads: workspace access"` + `leads_select` | 4 per-command |
| `instagram_post_tags` | `tags_conta` (`FOR ALL`) | 4 per-command |
| `analytics_reports` | `reports_conta` (`FOR ALL`) | 4 per-command |
| `workflows`, `workflow_templates`, `workflow_etapas` | 4 each, bodies use a `profiles` subquery | same 4, bodies use `get_my_conta_id()` |
| `transacoes`, `contratos` | — | **handled by PR #258** |

The legacy policies are all permissive and `FOR ALL`, keyed on
`auth.uid() = user_id OR conta_id = get_user_conta_id()`.
`get_user_conta_id()` returns `profiles.conta_id` — the user's *home* account,
with no membership check. `get_my_conta_id()` returns `active_workspace_id` and
verifies membership. For any user belonging to more than one workspace these
differ, so the legacy policies scope by home account rather than active
workspace.

`get_user_conta_id()` itself exists in production but in **no migration and no
application code**. It is referenced only by the legacy policies.

### Consequence: `profiles` privilege escalation

Production has `GRANT ALL ON profiles TO authenticated` and:

```sql
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);   -- no WITH CHECK
```

With `WITH CHECK` omitted, Postgres reuses the `USING` expression as the check.
`auth.uid() = id` stays true while you change your own `role`, so **any
authenticated user can `update profiles set role = 'owner'`**. The only trigger
on the table, `trg_validate_active_workspace`, fires on `active_workspace_id`.

`20260315` was written to close exactly this
(`REVOKE UPDATE ON profiles; GRANT UPDATE (nome, avatar_url)`) and never ran.

This does **not** compromise per-admin financial visibility —
`can_see_financials()` reads `workspace_members`, and that table is properly
locked (`wm_no_client_insert/update/delete` all `USING (false)`). It does affect
everything keyed on `get_my_role()` or on the client-side role.

## Finding 2 — the Estúdio / `designs` series is recorded but absent

Eight migrations, all recorded as applied in production, none of whose objects
exist there:

`20260702000001`, `20260702000004`, `20260702000006`, `20260704000001`,
`20260704000002`, `20260705000001`, `20260706000001`, `20260706000002`

Absent: the `post_designs`, `designs`, `design_asset_refs` and
`ai_image_generations` tables, and ~20 functions including `create_design`,
`attach_design`, `claim_design_render`, `save_design_blob`,
`finalize_design_render`. The string `ai_image` does not appear in the
production schema at all.

**This needs a decision before anything is written.** Two readings fit:

- the migrations never applied, same as Finding 1; or
- they applied and were later torn down deliberately, as part of the v1 →
  OpenPencil pivot, leaving the version rows behind.

The second is plausible and would make this benign — but it still leaves `main`'s
migration set unable to rebuild production. A fresh environment built from
migrations would have the schema; production does not.

## Remediation — the traps

**`20260315` must not be replayed verbatim.** It is four months stale and
predates features built on top of it. Three specific hazards:

1. **It would downgrade `get_my_conta_id()`.** Its version is
   `SELECT active_workspace_id FROM profiles WHERE id = auth.uid()`. Production's
   current version additionally requires an `EXISTS` check against
   `workspace_members`. Replaying the file re-creates the weaker one.

2. **Its `profiles` UPDATE allowlist is `(nome, avatar_url)`, and the app now
   writes far more.** Union of what the CRM updates with the user's own JWT:

   | Column | Written by |
   |---|---|
   | `active_workspace_id`, `conta_id` | `Sidebar.tsx:78`, `lib/supabase.ts:131`, `store/workspace.ts:103` — workspace switching |
   | `nome`, `empresa`, `telefone`, `whatsapp`, `marketing_opt_in` | `PerfilTab.tsx:48` |
   | `nome`, `empresa` | `WorkspaceSetupPage.tsx:43` |
   | `onboarding_complete`, `nome` | `ConfigurarSenhaPage.tsx:161` |

   A verbatim replay breaks workspace switching, profile editing and onboarding.
   `20260315` predates `20260317_multi_workspace.sql` — it was written for a
   single-workspace world. The allowlist has to be re-derived from today's call
   sites, and must exclude `role`.

3. **Switching `clientes`/`membros`/`leads`/`integracoes_status` from
   `get_user_conta_id()` to `get_my_conta_id()` is a live visibility change**,
   not a no-op. It is the correct multi-workspace semantic, but for any user
   whose `active_workspace_id` differs from their `conta_id` it changes which
   rows they see. Needs checking against real data before it ships.

The intent of `20260315` is still right — per-command policies, column-scoped
profile updates, no blanket `FOR ALL`. Its specifics are not. Remediation should
be a **new migration derived from current app behaviour**, not a replay.

## Suggested sequencing

1. **PR #258** — unblocks Migration B. Independent of everything below.
2. **`profiles` lockdown** — smallest, highest-value slice. Revoke table UPDATE,
   grant the eight columns above, add `WITH CHECK`. Closes the escalation path.
   Verify workspace switching, profile editing and onboarding in a browser.
3. **Decide on Finding 2** before touching it. If the teardown was deliberate,
   the fix is to record that in the repo, not to re-apply.
4. **Per-command policies for the remaining tables**, one table per migration,
   each with a post-condition asserting its own final state — the pattern that
   caught this whole class of problem in the first place.
5. **A CI job that runs `scripts/test-entitlements.sh`.** It runs in no workflow
   today, so its 17 suites protect nothing on `main`.

## Open questions

- Were the Estúdio objects dropped deliberately? (Finding 2)
- How did the version rows get recorded without the SQL running — and is the
  practice that produced it still in use? Without an answer this recurs.
- Does staging share either gap? Not checked; the repo was linked to production
  throughout this audit and the link state flips.
