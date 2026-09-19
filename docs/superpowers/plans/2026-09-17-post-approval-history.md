# Hub Post Approval History and Comments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the client, inside each of the three real Hub post cards (`InstagramPostCard`, `StoryPostCard`, `TextPostCard`), a shared history panel with two tabs (Histórico: approvals `aprovado`/`correcao` plus status events without `post_approval_id`; Comentários: `mensagem` rows plus a new composer), a per-post KPI line (rounds + average response time), a caption diff between consecutive sends, a required correction-reason tag (Legenda / Imagem-vídeo / Data / Outro) when requesting a correction, and status filter chips on Postagens only.

**Architecture:** Three migrations in a three-phase rollout (spec §3). Phase 1, `20260925000010`, adds `post_approvals.motivo` with a *permissive* CHECK (`motivo IS NULL OR motivo IN (...)`, value validated, presence not yet required) and *replaces* (drop + create, never overload) `record_client_approval` with a 7-argument signature whose trailing `p_motivo text default null` keeps the still-deployed 6-argument `hub-approve` call working until it is redeployed. Phase 2 redeploys `hub-approve` and ships the three card UIs sending the tag. Phase 3, `20260925000012` in a follow-up PR (Task 16), swaps the CHECK for the mandatory one (`action <> 'correcao' OR (motivo IS NOT NULL AND motivo IN (...))`) created `NOT VALID`; shipping the mandatory CHECK together with the column would reject every correction sent by the old `hub-approve` bundle between the migration push and the function redeploy. `20260925000011` implements spec §1 option (a) "explicit reference between the send event and the content": it adds `snapshot_conteudo_plain`/`snapshot_ig_caption` to `post_status_events`, stamped by `record_post_status_event()` from `NEW.*` only when `NEW.status = 'enviado_cliente'`. A snapshot copied from the row being updated is immutable; a foreign key to `post_content_versions` is not, because `record_post_content_version()` coalesces a later edit by the same actor into the tip row for 5 minutes (`20260923000001_post_content_versions.sql:119-140`), so an FK could silently point at text the client never saw. A new token-authenticated edge function `hub-post-history` (GET `?token&post_id`) reuses the `hub-approve` ownership check (`post.cliente_id === hubToken.cliente_id && post.conta_id === hubToken.conta_id`), applies the `to_status` allowlist, drops `from_status = to_status` rows (the `20260805000001` trigger guard also fires on custom-status-only moves), applies the temporal floor at the first `to_status = 'enviado_cliente'` event, and returns a sanitized DTO (no `from_status`, no actor names, no TipTap JSON). `hub-posts` keeps shipping `postApprovals` in the list payload (the collapsed panel header uses it for its counts; the full history loads only when a panel is opened), but Task 4b filters that query's result server-side with the same rule as `hub-post-history`: today `hub-posts/handler.ts:139-145` returns every `post_approvals` row verbatim, so internal team `mensagem` rows reach the browser on every page load. The shared predicate lives in `supabase/functions/_shared/hub-approvals.ts` (`isClientVisibleApproval`) and both endpoints use it. `hub-approve` gains server-side validation for `mensagem` (trimmed, non-empty, at most 4000 chars) and for `correcao` (`motivo` required, one of four values). Client side: the CRM word-diff moves into a shared `packages/text-diff` workspace package (CRM keeps a re-export shim); `apps/hub/src/lib/postHistory.ts` holds the pure merge/KPI state machine; `PostHistoryPanel`, `CorrectionReasonChips` and `StatusFilterChips` are new components; the three cards and `PostagensPage` wire them in.

**Tech Stack:** Postgres (plpgsql triggers/RPCs, psql SQL test suites run by `npm run test:db`), Deno edge functions (tests via `npm run test:functions`, types via `npm run check:functions`), React 19 + TypeScript + Vite (Hub), Vitest + Testing Library (jsdom), react-i18next (`packages/i18n/locales/{pt,en}/hubPosts.json`), `diff-match-patch`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-17-post-approval-history-design.md`. Do not re-open its scope decisions. Explicitly cut: unread indicator, aggregate KPI panel, the word "Rejeitado", media diff, retroactive motivo tags, status filter on Aprovações.
- **P0 authorization (spec §1):** `hub-post-history` must load the post by `id` and check `post.conta_id === hubToken.conta_id && post.cliente_id === hubToken.cliente_id` before returning any row. Never trust `post_id` from the client without this check.
- **Allowlist (spec §1):** an event enters the response only if `to_status ∈ VISIBLE_STATUSES` = `enviado_cliente`, `aprovado_cliente`, `correcao_cliente`, `agendado`, `postado`, `falha_publicacao` (`apps/hub/src/lib/postView.ts:5-12`). `from_status` is never exposed (it can be internal: `rascunho`, `revisao_interna`, `aprovado_interno`). Rows with `from_status IS NOT DISTINCT FROM to_status` are dropped.
- **Temporal floor (spec §1):** events before the first `to_status = 'enviado_cliente'` event of that post never enter the response. Posts predating `20260606000001` simply have no events: the UI shows an empty/partial Histórico, never a reconstruction. The floor applies to `post_status_events` only. It is never applied to `post_approvals`: client-authored rows (`is_workspace_user = false`, which is every `aprovado`/`correcao` row `hub-approve` writes and every `mensagem` the new composer writes) are safe by definition and must survive even when the post has no send event at all.
- **Team messages never reach the Hub (spec §1, revision notes 8 and 10):** both Hub endpoints that read `post_approvals` drop every row with `action = 'mensagem' AND is_workspace_user = true` server-side through the shared predicate `isClientVisibleApproval` in `supabase/functions/_shared/hub-approvals.ts`: `hub-post-history` inside `sanitizeHistoryApprovals` (Task 4) and `hub-posts` on its `postApprovals` list payload (Task 4b). Those rows come from the CRM's `replyToPostApproval` (internal coordination, notifies owner/admin only). No new column (`visivel_cliente` or similar) is added: the Hub has no team identity, so every `mensagem` this feature writes is `is_workspace_user = false` by construction. The Hub's `selectComments` and the collapsed-header comment count apply the same rule as a second line of defense, but the API contract itself never carries team messages.
- **Actor names:** team actors are shown only as the generic label "Equipe"; system as "Sistema". The DTO never carries `actor_name`, `actor_user_id`, `token`, `author_user_id`, `from_custom_nome`, `to_custom_nome`, or the `conteudo` JSON tree (so `commentHighlight`, `threadId`, `resolved` cannot leak).
- **Motivo (spec §3, three phases):** column `motivo text` nullable. Phase 1 (`20260925000010`) constraint: `CHECK (motivo IS NULL OR motivo IN ('legenda','imagem_video','data','outro'))` (permissive on presence). Phase 3 (`20260925000012`, Task 16, only after `hub-approve` and the Hub bundle are live in production): drop it and add `CHECK (action <> 'correcao' OR (motivo IS NOT NULL AND motivo IN ('legenda','imagem_video','data','outro'))) NOT VALID` (the explicit `IS NOT NULL` matters: `NULL IN (...)` is `NULL`, and a CHECK only rejects `FALSE`). `record_client_approval` is dropped and recreated with exactly one 7-argument signature; `REVOKE ALL ... FROM PUBLIC` then `GRANT EXECUTE ... TO service_role` on that exact signature (REVOKE FROM PUBLIC also strips service_role, so the grant is mandatory).
- **KPI state machine (spec §3):** rounds = client `correcao` approvals + `correcao_cliente` status events with `post_approval_id IS NULL`; response time = for each send event (`to_status = 'enviado_cliente'`), the first client response (`aprovado` or `correcao` approval with `is_workspace_user = false`) whose `(created_at, id)` is at or after the send and before the next send. Case (c) approval straight from `correcao_cliente` without a resend and case (d) a second/third correction while already `correcao_cliente` are explicitly *not* new samples (they answer a send that already has a sample). Zero samples renders as "Sem dados ainda", never 0. Ordering everywhere is `(created_at, id)`.
- **Comment composer** is enabled in every client-visible status (the panel only renders for posts in `VISIBLE_STATUSES`), and `hub-approve` enforces the same rule server-side: a `mensagem` on a post whose `status ∉ VISIBLE_STATUSES` (`rascunho`, `revisao_interna`, `aprovado_interno`, ...) is rejected with 400 before any insert, because client-authored `post_approvals` rows are never floor-filtered and such a comment would otherwise surface permanently, timestamped before the send, once the post was eventually sent (spec §1). Its `useUnsavedWork(text.trim() !== '' || sending)` call is mandatory (silent-update rule in CLAUDE.md).
- No em-dashes in user-facing copy. Keys go into both `pt` and `en` JSON files; `test/vitest.setup.ts` loads the real `pt` JSON, so tests assert the Portuguese strings.
- Migration prefixes `20260925000010` and `20260925000011` are above the current tail `20260923000008` (also `origin/main`'s tail as of 2026-09-17). Re-check with `ls supabase/migrations | tail -1` before opening the PR and renumber above main's tail if needed.
- Deploy order (last task): `npx supabase db push --linked` (migrations) → `npx supabase functions deploy hub-post-history --use-api --no-verify-jwt` → `npx supabase functions deploy hub-posts --use-api --no-verify-jwt` (pure narrowing of the list payload, safe with either bundle) → merge (Vercel deploys the Hub bundle on merge) → confirm the new bundle is live → `npx supabase functions deploy hub-approve --use-api --no-verify-jwt`. `hub-approve` goes LAST on purpose: the new one answers 400 "Informe o motivo da correção." to the old bundle (which never sends `motivo`), while the old `hub-approve` ignores the extra `motivo` field from the new bundle and its 6-argument RPC call still resolves against the 7-argument function (Task 1 case A.1), so the only thing lost in that order is the tag on corrections sent during the gap, which the phase-1 CHECK allows. Staging first, then production.
- Before every commit run `npm run format` on touched files. Before the PR run `npm run lint`, `npm run format:check`, `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`, `npm run test`, `npm run check:functions`, `npm run test:functions`, and `npm run test:db` (needs Docker/colima; CI runs it regardless).
- Work on branch `claude/post-approval-history-5938fa` in this worktree. Never use bare `git stash`.
- Line numbers quoted in Modify steps refer to the file as it is on `origin/main` before that task's first edit; apply the edits of a task top to bottom and expect later anchors to have shifted by the lines already inserted. Match on the quoted code, not the number.

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260925000010_post_approvals_motivo.sql` | Create | `motivo` column + permissive value CHECK + replace `record_client_approval` (7 args) + grants |
| `supabase/migrations/20260925000012_post_approvals_motivo_required.sql` | Create (Task 16, follow-up PR) | swap to the mandatory conditional CHECK, `NOT VALID` |
| `supabase/migrations/20260925000011_post_status_events_send_snapshot.sql` | Create | `snapshot_conteudo_plain`/`snapshot_ig_caption` on `post_status_events`; `record_post_status_event()` stamps them on sends |
| `supabase/tests/post_approval_history.sql` | Create | psql suite for the migrations (RPC replacement, CHECK, grants, snapshot stamping; phase-3 case appended in Task 16) |
| `supabase/functions/hub-approve/handler.ts` | Modify | validate `mensagem` text and `correcao` motivo; pass `p_motivo`; generic insert error |
| `supabase/functions/_shared/hub-approvals.ts` | Create | `isClientVisibleApproval(row)` shared predicate (team `mensagem` rows never leave the server) |
| `supabase/functions/hub-post-history/handler.ts` | Create | `createHubPostHistoryHandler(deps)` + pure `sanitizeHistoryEvents()` / `sanitizeHistoryApprovals()` |
| `supabase/functions/hub-posts/handler.ts` | Modify | filter `postApprovals` with `isClientVisibleApproval` (Task 4b) |
| `supabase/functions/hub-post-history/index.ts` | Create | Deno.serve wiring |
| `supabase/functions/__tests__/hub-post-history_test.ts` | Create | handler tests (authz, allowlist, floor, team-message exclusion, DTO shape) |
| `supabase/functions/__tests__/hub-functions_test.ts` | Modify | (also) hub-posts test: team `mensagem` row absent from `postApprovals` (Task 4b) |
| `supabase/functions/__tests__/hub-functions_test.ts` | Modify | hub-approve tests for motivo + mensagem validation |
| `supabase/config.toml` | Modify | `[functions.hub-post-history] verify_jwt = false` |
| `packages/text-diff/index.ts`, `package.json`, `index.test.ts` | Create | shared `diffWords`/`computeWordDiff`/`DiffSegment` |
| `apps/crm/src/utils/textDiff.ts` | Modify | becomes `export * from '@mesaas/text-diff'` shim |
| `vitest.config.ts`, `apps/hub/vite.config.ts`, `apps/hub/tsconfig.json`, `apps/crm/vite.config.ts`, `apps/crm/tsconfig.json` | Modify | `@mesaas/text-diff` alias |
| `apps/hub/src/types.ts` | Modify | `CorrectionReason`, `PostHistoryEvent`, `PostHistoryApproval`, `PostHistoryResponse`; `PostApproval.motivo` |
| `apps/hub/src/api.ts` | Modify | `fetchPostHistory(token, post_id)`; `submitApproval(..., motivo?)` |
| `apps/hub/src/__tests__/api.test.ts` | Modify | tests for both |
| `apps/hub/src/lib/postHistory.ts` | Create | `CORRECTION_REASONS`, `buildHistoryEntries`, `selectComments`, `computePostKpis`, `formatDuration` |
| `apps/hub/src/lib/__tests__/postHistory.test.ts` | Create | scenarios a, b, c, d, ties, missing sample |
| `packages/i18n/locales/pt/hubPosts.json`, `.../en/hubPosts.json` | Modify | `history.*`, `correctionReason.*`, `postagens.filter.*` |
| `apps/hub/src/components/CorrectionReasonChips.tsx` + test | Create | 4 chips, `aria-pressed` |
| `apps/hub/src/components/PostHistoryPanel.tsx` + test | Create | collapsed header with counts, tabs, KPIs, diff, composer |
| `apps/hub/src/components/TextPostCard.tsx`, `StoryPostCard.tsx`, `InstagramPostCard.tsx` + tests | Modify | chips in approval block, motivo in `submitApproval`, panel mounted |
| `apps/hub/src/components/StatusFilterChips.tsx` + test | Create | Todos / enviado_cliente / correcao_cliente / aprovado_cliente with counts |
| `apps/hub/src/pages/PostagensPage.tsx` + `pages/__tests__/aprovacoesPostagensFeatures.test.tsx` | Modify | filter state applied before grouping |

---

### Task 1: Migration: `post_approvals.motivo` + replace `record_client_approval`

**Files:**
- Create: `supabase/migrations/20260925000010_post_approvals_motivo.sql`
- Create: `supabase/tests/post_approval_history.sql`

**Interfaces:**
- Consumes: `post_approvals` (`20260402_workflow_posts.sql`), the existing 6-argument `record_client_approval(bigint, text, text, text, boolean, text)` from `20260606000001_post_status_events.sql:121-151` (its only definition; `20260903000030` only mentions it in a comment).
- Produces: `record_client_approval(p_post_id bigint, p_token text, p_action text, p_comentario text, p_is_workspace_user boolean, p_new_status text, p_motivo text default null) returns bigint`, the single function of that name. Column `post_approvals.motivo text`. Constraint `post_approvals_motivo_value_check` (permissive: value only). The presence rule arrives in Task 16.

- [ ] **Step 1: Write the failing SQL test**

Create `supabase/tests/post_approval_history.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Valida 20260925000010_post_approvals_motivo.sql e
-- 20260925000011_post_status_events_send_snapshot.sql.
--   A.1 uma unica record_client_approval existe (7 args); chamada com 6 args nao e ambigua
--   A.2 correcao com motivo grava motivo e move o status; evento liga post_approval_id
--   A.3 fase 1: correcao sem motivo ainda e aceita (motivo null) -- a obrigatoriedade chega na fase 3
--   A.4 motivo fora dos quatro valores viola o CHECK (23514)
--   A.5 EXECUTE: service_role sim, authenticated/anon nao
--   B.1 transicao para enviado_cliente grava snapshot do texto de NEW
--   B.2 transicao para aprovado_cliente nao grava snapshot
--   B.3 update que muda texto E status no mesmo statement grava o texto novo

create or replace function pg_temp.pah_fixture(out ws uuid, out usr uuid, out cli bigint, out post bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws where id = usr;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflow_posts (conta_id, cliente_id, titulo, status, ig_caption, conteudo_plain)
    values (ws, cli, 'post historico', 'enviado_cliente', 'legenda v1', 'texto v1') returning id into post;
end $$;

-- A.1
begin;
do $$
declare f record; v_count int; v_id bigint;
begin
  select * into f from pg_temp.pah_fixture();
  select count(*) into v_count from pg_proc where proname = 'record_client_approval';
  assert v_count = 1, format('esperava 1 record_client_approval, achou %s', v_count);
  select record_client_approval(f.post, 'tok', 'aprovado', null, false, 'aprovado_cliente') into v_id;
  assert v_id is not null, 'chamada com 6 args deve resolver';
  assert (select motivo from post_approvals where id = v_id) is null, 'aprovado sem motivo fica null';
  assert (select status from workflow_posts where id = f.post) = 'aprovado_cliente';
end $$;
rollback;

-- A.2
begin;
do $$
declare f record; v_id bigint; v_ev record;
begin
  select * into f from pg_temp.pah_fixture();
  select record_client_approval(f.post, 'tok', 'correcao', 'trocar imagem', false, 'correcao_cliente', 'imagem_video') into v_id;
  assert (select motivo from post_approvals where id = v_id) = 'imagem_video';
  assert (select status from workflow_posts where id = f.post) = 'correcao_cliente';
  select * into v_ev from post_status_events where post_id = f.post order by created_at desc, id desc limit 1;
  assert v_ev.post_approval_id = v_id, 'evento de status deve apontar para a aprovacao';
  assert v_ev.to_status = 'correcao_cliente';
  assert v_ev.source = 'client';
end $$;
rollback;

-- A.3
begin;
do $$
declare f record; v_id bigint;
begin
  select * into f from pg_temp.pah_fixture();
  select record_client_approval(f.post, 'tok', 'correcao', 'sem motivo', false, 'correcao_cliente') into v_id;
  assert v_id is not null, 'fase 1: correcao sem motivo (hub-approve antigo) deve continuar funcionando';
  assert (select motivo from post_approvals where id = v_id) is null;
end $$;
rollback;

-- A.4
begin;
do $$
declare f record; v_id bigint; v_state text;
begin
  select * into f from pg_temp.pah_fixture();
  begin
    select record_client_approval(f.post, 'tok', 'correcao', 'x', false, 'correcao_cliente', 'preco') into v_id;
    v_state := 'none';
  exception when others then
    v_state := sqlstate;
  end;
  assert v_state = '23514', format('esperava check_violation, veio %s', v_state);
end $$;
rollback;

-- A.5
begin;
do $$
begin
  assert has_function_privilege('service_role', 'record_client_approval(bigint, text, text, text, boolean, text, text)', 'execute'),
    'service_role deve poder executar';
  assert not has_function_privilege('authenticated', 'record_client_approval(bigint, text, text, text, boolean, text, text)', 'execute'),
    'authenticated nao pode executar';
  assert not has_function_privilege('anon', 'record_client_approval(bigint, text, text, text, boolean, text, text)', 'execute'),
    'anon nao pode executar';
end $$;
rollback;
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx supabase start` (once, needs Docker/colima) then `npm run test:db`.
Expected: `FAIL supabase/tests/post_approval_history.sql` with `column "motivo" does not exist` or `function record_client_approval(bigint, text, text, text, boolean, text, text) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260925000010_post_approvals_motivo.sql`:

```sql
-- =====================================================================
-- 20260925000010_post_approvals_motivo.sql
-- Correction-reason tag on post_approvals, required only for
-- action = 'correcao', and record_client_approval widened to accept it.
-- Spec: docs/superpowers/specs/2026-09-17-post-approval-history-design.md (§3)
-- =====================================================================

alter table post_approvals add column if not exists motivo text;

-- Phase 1 of 3 (spec §3): validate the VALUE when present, do not require
-- presence yet. The deployed hub-approve still calls the RPC with 6 args
-- (motivo = NULL) until it is redeployed; a mandatory CHECK here would
-- reject every correction in that window. Phase 3 (20260925000012) swaps
-- this for the conditional NOT VALID constraint once hub-approve and the
-- Hub bundle are live.
alter table post_approvals drop constraint if exists post_approvals_motivo_value_check;
alter table post_approvals
  add constraint post_approvals_motivo_value_check
  check (motivo is null or motivo in ('legenda', 'imagem_video', 'data', 'outro'));

-- Replace, never overload. Postgres identifies a function by name + argument
-- types: CREATE OR REPLACE with a new trailing parameter would create a
-- SECOND function, and the existing 6-argument call in hub-approve would then
-- match both candidates (exact match vs. default-filled) and fail as
-- ambiguous. Drop the old signature, create the only new one, and re-apply
-- the grants to that exact signature (REVOKE FROM PUBLIC also strips
-- service_role, so the GRANT is not optional).
drop function if exists record_client_approval(bigint, text, text, text, boolean, text);

create function record_client_approval(
  p_post_id           bigint,
  p_token             text,
  p_action            text,
  p_comentario        text,
  p_is_workspace_user boolean,
  p_new_status        text,
  p_motivo            text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approval bigint;
begin
  insert into post_approvals (post_id, token, action, comentario, is_workspace_user, motivo)
  values (p_post_id, p_token, p_action, p_comentario, p_is_workspace_user, p_motivo)
  returning id into v_approval;

  perform set_config('app.event_source',     'client',         true);
  perform set_config('app.post_approval_id', v_approval::text, true);

  update workflow_posts set status = p_new_status where id = p_post_id;

  return v_approval;
end;
$$;

revoke all on function record_client_approval(bigint, text, text, text, boolean, text, text) from public;
grant execute on function record_client_approval(bigint, text, text, text, boolean, text, text) to service_role;
```

- [ ] **Step 4: Apply locally and run the test**

Run: `npx supabase db reset` (applies every migration to the local DB) then `npm run test:db`.
Expected: `PASS supabase/tests/post_approval_history.sql` and every other file still `PASS`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260925000010_post_approvals_motivo.sql supabase/tests/post_approval_history.sql
git commit -m "feat(db): post_approvals.motivo + single 7-arg record_client_approval

Phase 1 of the motivo rollout: adds the column with a permissive value
CHECK and replaces (drop + create) record_client_approval so exactly one
signature exists; the trailing p_motivo default keeps the deployed
hub-approve call working until it is redeployed. The mandatory CHECK
follows in a later migration once the function and UI are live.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Migration: caption snapshot on send events

**Files:**
- Create: `supabase/migrations/20260925000011_post_status_events_send_snapshot.sql`
- Modify: `supabase/tests/post_approval_history.sql` (append cases B.1 to B.3)

**Interfaces:**
- Consumes: `record_post_status_event()` as last defined in `supabase/migrations/20260805000001_post_status_definitions.sql:222-270` (custom-status columns included); trigger `workflow_posts_status_event` (unchanged, already `after update of status, custom_status_id`).
- Produces: columns `post_status_events.snapshot_conteudo_plain text` and `post_status_events.snapshot_ig_caption text`, non-null only on rows with `to_status = 'enviado_cliente'` and `from_status IS DISTINCT FROM to_status`.

- [ ] **Step 1: Append the failing SQL test cases**

Append to `supabase/tests/post_approval_history.sql`:

```sql
-- B.1
begin;
do $$
declare f record; v_ev record;
begin
  select * into f from pg_temp.pah_fixture();
  update workflow_posts set status = 'rascunho' where id = f.post;
  delete from post_status_events where post_id = f.post;
  update workflow_posts set status = 'enviado_cliente' where id = f.post;
  select * into v_ev from post_status_events where post_id = f.post order by created_at desc, id desc limit 1;
  assert v_ev.to_status = 'enviado_cliente';
  assert v_ev.snapshot_ig_caption = 'legenda v1', format('snapshot_ig_caption = %s', v_ev.snapshot_ig_caption);
  assert v_ev.snapshot_conteudo_plain = 'texto v1', format('snapshot_conteudo_plain = %s', v_ev.snapshot_conteudo_plain);
end $$;
rollback;

-- B.2
begin;
do $$
declare f record; v_ev record;
begin
  select * into f from pg_temp.pah_fixture();
  update workflow_posts set status = 'aprovado_cliente' where id = f.post;
  select * into v_ev from post_status_events where post_id = f.post order by created_at desc, id desc limit 1;
  assert v_ev.to_status = 'aprovado_cliente';
  assert v_ev.snapshot_ig_caption is null, 'aprovacao nao grava snapshot';
  assert v_ev.snapshot_conteudo_plain is null, 'aprovacao nao grava snapshot';
end $$;
rollback;

-- B.3
begin;
do $$
declare f record; v_ev record;
begin
  select * into f from pg_temp.pah_fixture();
  update workflow_posts set status = 'correcao_cliente' where id = f.post;
  update workflow_posts set status = 'enviado_cliente', ig_caption = 'legenda v2' where id = f.post;
  select * into v_ev from post_status_events where post_id = f.post order by created_at desc, id desc limit 1;
  assert v_ev.to_status = 'enviado_cliente';
  assert v_ev.snapshot_ig_caption = 'legenda v2', format('reenvio deve snapshotar o texto NOVO, veio %s', v_ev.snapshot_ig_caption);
end $$;
rollback;
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm run test:db`.
Expected: `FAIL supabase/tests/post_approval_history.sql` at B.1 with `record "v_ev" has no field "snapshot_ig_caption"`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260925000011_post_status_events_send_snapshot.sql`:

```sql
-- =====================================================================
-- 20260925000011_post_status_events_send_snapshot.sql
-- Snapshot of the caption/plain text on every "sent to client" event, so
-- the Hub can diff what the client saw in send N-1 vs send N. Copied from
-- NEW.* inside the status trigger: immutable by construction. A foreign key
-- to post_content_versions would NOT be: record_post_content_version()
-- coalesces a later same-actor edit into the tip row for 5 minutes
-- (20260923000001_post_content_versions.sql:119-140), so the referenced
-- row could change after the client already saw the text.
-- Function body copied from 20260805000001_post_status_definitions.sql
-- (the latest definition, with the custom-status columns) plus the two
-- snapshot assignments. Trigger unchanged.
-- =====================================================================

alter table post_status_events
  add column if not exists snapshot_conteudo_plain text,
  add column if not exists snapshot_ig_caption     text;

create or replace function record_post_status_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid;
  v_source     text;
  v_actor_name text;
  v_approval   bigint;
  v_from_nome  text;
  v_to_nome    text;
  v_snap_plain text;
  v_snap_cap   text;
begin
  begin
    v_actor := coalesce(nullif(current_setting('app.actor_id', true), '')::uuid, auth.uid());
    v_source := coalesce(
      nullif(current_setting('app.event_source', true), ''),
      case when v_actor is not null then 'workspace_user' else 'system' end
    );
    v_approval := nullif(current_setting('app.post_approval_id', true), '')::bigint;

    if v_actor is not null then
      select nome into v_actor_name from profiles where id = v_actor;
    end if;

    if old.custom_status_id is not null then
      select nome into v_from_nome from post_status_definitions where id = old.custom_status_id;
    end if;
    if new.custom_status_id is not null then
      select nome into v_to_nome from post_status_definitions where id = new.custom_status_id;
    end if;

    -- Only a real transition INTO enviado_cliente is a "send"; a custom-only
    -- move that keeps status = enviado_cliente is not.
    if new.status = 'enviado_cliente' and new.status is distinct from old.status then
      v_snap_plain := new.conteudo_plain;
      v_snap_cap   := new.ig_caption;
    end if;

    insert into post_status_events
      (post_id, conta_id, from_status, to_status, source,
       actor_user_id, actor_name, post_approval_id,
       from_custom_status_id, to_custom_status_id,
       from_custom_nome, to_custom_nome,
       snapshot_conteudo_plain, snapshot_ig_caption)
    values
      (new.id, new.conta_id, old.status, new.status, v_source,
       v_actor, v_actor_name, v_approval,
       old.custom_status_id, new.custom_status_id,
       v_from_nome, v_to_nome,
       v_snap_plain, v_snap_cap);
  exception when others then
    raise warning 'record_post_status_event failed for post %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
```

- [ ] **Step 4: Apply locally and run the test**

Run: `npx supabase db reset && npm run test:db`.
Expected: `PASS supabase/tests/post_approval_history.sql`; `ran=N failures=0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260925000011_post_status_events_send_snapshot.sql supabase/tests/post_approval_history.sql
git commit -m "feat(db): snapshot caption/plain text on enviado_cliente status events

Immutable per-send text for the Hub history diff (spec option a). Copied
from NEW.* in record_post_status_event instead of an FK to
post_content_versions, whose tip row is mutable for 5 minutes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `hub-approve`: validate `mensagem` text and status, and `correcao` motivo

**Files:**
- Modify: `supabase/functions/hub-approve/handler.ts`
- Modify: `supabase/functions/__tests__/hub-functions_test.ts`

**Interfaces:**
- Consumes: POST body `{ token, post_id, action, comentario?, motivo? }`; RPC `record_client_approval` (7 args from Task 1).
- Produces: `400 { error: "Escreva um comentário." }` for empty `mensagem`; `400 { error: "Comentário muito longo." }` above 4000 chars; `400 { error: "Post ainda não foi enviado para o cliente." }` for a `mensagem` on a post whose `status ∉ HUB_VISIBLE_STATUSES` (`enviado_cliente`, `aprovado_cliente`, `correcao_cliente`, `agendado`, `postado`, `falha_publicacao`; the `aprovado`/`correcao` branch keeps its existing narrower check and message); `400 { error: "Informe o motivo da correção." }` when `action = 'correcao'` and `motivo ∉ {legenda, imagem_video, data, outro}`; RPC payload gains `p_motivo` (`null` for `aprovado`); `mensagem` insert stores the trimmed text; insert failure returns the generic `"Erro ao registrar comentário."`.

- [ ] **Step 1: Update the existing correction test and add the new failing tests**

First run `grep -n 'action: "correcao"' supabase/functions/__tests__/hub-functions_test.ts`: every hub-approve request body that uses `correcao` must gain `motivo`, otherwise it fails with the new 400 for the wrong reason. At the time of writing the only hit is line 543 (the notification test below); `mcp-feedback_test.ts` and `mcp-content_test.ts` also contain `correcao` rows but they never call `hub-approve`, so leave them alone.

In `supabase/functions/__tests__/hub-functions_test.ts`, in the test `"hub-approve calls notification RPC with comentario for corrections"` (line 524), change the request body line to:

```ts
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "correcao", comentario: "Trocar imagem", motivo: "imagem_video" }),
```

and append after its last `assertEquals` (line 549):

```ts
  const approvalRpc = db.calls.find((c: { table: string }) => c.table === "rpc:record_client_approval");
  assert(approvalRpc, "record_client_approval should be called");
  assertEquals((approvalRpc.payload as { p_motivo: unknown }).p_motivo, "imagem_video");
```

Then insert this block immediately before `Deno.test("hub-approve auto-schedules an approved express post despite the missing date"` (line 604):

```ts
function hubApproveDbForPost(status = "enviado_cliente") {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, conta_id: "conta-1", is_active: true }, error: null });
  db.queue("workflow_posts", "select", {
    data: { id: 99, workflow_id: 7, status, cliente_id: 14, conta_id: "conta-1" },
    error: null,
  });
  return db;
}

function hubApproveHandlerFor(db: ReturnType<typeof createSupabaseQueryMock>) {
  return createHubApproveHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    rateLimit: async () => true,
  });
}

Deno.test("hub-approve rejects a correcao without motivo with 400 and never calls the RPC", async () => {
  const db = hubApproveDbForPost();
  const response = await hubApproveHandlerFor(db)(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "correcao", comentario: "Trocar imagem" }),
  }));
  assertEquals(response.status, 400);
  assertEquals((await readJson(response)).error, "Informe o motivo da correção.");
  assert(!db.calls.some((c: { table: string }) => c.table === "rpc:record_client_approval"));
});

Deno.test("hub-approve rejects a correcao whose motivo is outside the four allowed values", async () => {
  const db = hubApproveDbForPost();
  const response = await hubApproveHandlerFor(db)(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "correcao", comentario: "x", motivo: "preco" }),
  }));
  assertEquals(response.status, 400);
});

Deno.test("hub-approve sends p_motivo: null for an approval", async () => {
  const db = hubApproveDbForPost();
  db.queue("workflow_posts", "update", { data: null, error: null });
  const response = await hubApproveHandlerFor(db)(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "aprovado", motivo: "legenda" }),
  }));
  assertEquals(response.status, 200);
  const approvalRpc = db.calls.find((c: { table: string }) => c.table === "rpc:record_client_approval");
  assert(approvalRpc);
  assertEquals((approvalRpc.payload as { p_motivo: unknown }).p_motivo, null);
});

Deno.test("hub-approve rejects an empty or whitespace-only mensagem with 400", async () => {
  for (const comentario of [undefined, "", "   \n"]) {
    const db = hubApproveDbForPost("aprovado_cliente");
    const response = await hubApproveHandlerFor(db)(new Request("https://example.test/hub-approve", {
      method: "POST",
      body: JSON.stringify({ token: "hub-123", post_id: 99, action: "mensagem", comentario }),
    }));
    assertEquals(response.status, 400);
    assertEquals((await readJson(response)).error, "Escreva um comentário.");
    assert(!db.calls.some((c: { table: string; operation: string }) => c.table === "post_approvals" && c.operation === "insert"));
  }
});

Deno.test("hub-approve rejects a mensagem longer than 4000 characters", async () => {
  const db = hubApproveDbForPost("aprovado_cliente");
  const response = await hubApproveHandlerFor(db)(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "mensagem", comentario: "a".repeat(4001) }),
  }));
  assertEquals(response.status, 400);
  assertEquals((await readJson(response)).error, "Comentário muito longo.");
});

Deno.test("hub-approve stores a trimmed mensagem in any client-visible status and notifies with the trimmed text", async () => {
  const db = hubApproveDbForPost("postado");
  db.queue("post_approvals", "insert", { data: null, error: null });
  const response = await hubApproveHandlerFor(db)(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "mensagem", comentario: "  Ficou ótimo!  " }),
  }));
  assertEquals(response.status, 200);
  const insert = db.calls.find((c: { table: string; operation: string }) => c.table === "post_approvals" && c.operation === "insert");
  assert(insert);
  assertEquals(insert.payload, { post_id: 99, token: "hub-123", action: "mensagem", comentario: "Ficou ótimo!", is_workspace_user: false });
  const notif = db.calls.find((c: { table: string }) => c.table === "rpc:create_post_approval_notification");
  assert(notif);
  assertEquals(notif.payload, { p_post_id: 99, p_action: "mensagem", p_comentario: "Ficou ótimo!" });
});

Deno.test("hub-approve returns a generic message when the mensagem insert fails", async () => {
  const db = hubApproveDbForPost("aprovado_cliente");
  db.queue("post_approvals", "insert", { data: null, error: { message: "duplicate key value violates unique constraint" } });
  const response = await hubApproveHandlerFor(db)(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "mensagem", comentario: "oi" }),
  }));
  assertEquals(response.status, 500);
  assertEquals((await readJson(response)).error, "Erro ao registrar comentário.");
});

Deno.test("hub-approve rejects a mensagem on a post the client has not received yet and never inserts", async () => {
  for (const status of ["rascunho", "revisao_interna", "aprovado_interno"]) {
    const db = hubApproveDbForPost(status);
    const response = await hubApproveHandlerFor(db)(new Request("https://example.test/hub-approve", {
      method: "POST",
      body: JSON.stringify({ token: "hub-123", post_id: 99, action: "mensagem", comentario: "Posso ver esse post?" }),
    }));
    assertEquals(response.status, 400, `status ${status}`);
    assertEquals((await readJson(response)).error, "Post ainda não foi enviado para o cliente.");
    assert(!db.calls.some((c: { table: string; operation: string }) => c.table === "post_approvals" && c.operation === "insert"));
    assert(!db.calls.some((c: { table: string }) => c.table === "rpc:create_post_approval_notification"));
  }
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run test:functions -- --filter "hub-approve"`
Expected: the eight new/changed tests fail (`400` expected, `200` received; `p_motivo` `undefined`; error message mismatch; the internal-status mensagem test fails with `200` and an insert recorded). The pre-existing ones still pass.

- [ ] **Step 3: Implement the validation**

In `supabase/functions/hub-approve/handler.ts`, add these constants right after the `DbClient` type (after line 9):

```ts
// Mirrors hub-mensagens' MAX_CONTENT and the post_approvals motivo CHECK
// (20260925000010 value rule, 20260925000012 presence rule): the DB rejects
// anything else, this turns that into a 400 instead of a 500.
const MAX_COMMENT_LENGTH = 4000;
const CORRECTION_REASONS = ["legenda", "imagem_video", "data", "outro"];
// Same list as apps/hub/src/lib/postView.ts VISIBLE_STATUSES and the
// hub-post-history allowlist: the client may only comment on a post it can
// see. A comment on an internal draft would be a client-authored
// post_approvals row (never floor-filtered) dated before the first send.
const HUB_VISIBLE_STATUSES = [
  "enviado_cliente", "aprovado_cliente", "correcao_cliente", "agendado", "postado", "falha_publicacao",
];
```

Replace lines 86-88:

```ts
    const { token, post_id, action, comentario } = await req.json();
    if (!token || !post_id || !action) return json({ error: "token, post_id and action required" }, 400);
    if (!["aprovado", "correcao", "mensagem"].includes(action)) return json({ error: "Invalid action" }, 400);
```

with:

```ts
    const { token, post_id, action, comentario, motivo } = await req.json();
    if (!token || !post_id || !action) return json({ error: "token, post_id and action required" }, 400);
    if (!["aprovado", "correcao", "mensagem"].includes(action)) return json({ error: "Invalid action" }, 400);

    // Validated before any DB round-trip so a bad payload costs nothing.
    const mensagemText = typeof comentario === "string" ? comentario.trim() : "";
    if (action === "mensagem") {
      if (!mensagemText) return json({ error: "Escreva um comentário." }, 400);
      if (mensagemText.length > MAX_COMMENT_LENGTH) return json({ error: "Comentário muito longo." }, 400);
    }
    if (action === "correcao" && !CORRECTION_REASONS.includes(motivo)) {
      return json({ error: "Informe o motivo da correção." }, 400);
    }
```

Replace the `mensagem` branch (lines 123-133):

```ts
    if (action === "mensagem") {
      // Message-only: no status change, keep the plain insert.
      const { error: insertError } = await db.from("post_approvals").insert({
        post_id,
        token,
        action,
        comentario: comentario ?? null,
        is_workspace_user: false,
      });
      if (insertError) return json({ error: insertError.message }, 500);
    } else {
```

with:

```ts
    if (action === "mensagem") {
      // Message-only: no status change, keep the plain insert. The client can
      // only comment on a post it can already see (mirrors the
      // enviado_cliente/correcao_cliente gate of the aprovado/correcao branch).
      if (!HUB_VISIBLE_STATUSES.includes(post.status)) {
        return json({ error: "Post ainda não foi enviado para o cliente." }, 400);
      }
      const { error: insertError } = await db.from("post_approvals").insert({
        post_id,
        token,
        action,
        comentario: mensagemText,
        is_workspace_user: false,
      });
      if (insertError) {
        console.error("[hub-approve] mensagem insert failed:", insertError);
        return json({ error: "Erro ao registrar comentário." }, 500);
      }
    } else {
```

Replace the RPC call (lines 139-146) with:

```ts
      const { error: approvalErr } = await db.rpc("record_client_approval", {
        p_post_id: post_id,
        p_token: token,
        p_action: action,
        p_comentario: comentario ?? null,
        p_is_workspace_user: false,
        p_new_status: newStatus,
        p_motivo: action === "correcao" ? motivo : null,
      });
```

Replace the notification RPC payload (lines 188-192) with:

```ts
    const { error: notifErr } = await db.rpc("create_post_approval_notification", {
      p_post_id: post_id,
      p_action: action,
      p_comentario: action === "mensagem" ? mensagemText : (comentario ?? null),
    });
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm run check:functions && npm run test:functions -- --filter "hub-approve"`
Expected: `deno check` clean; every hub-approve test passes.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hub-approve/handler.ts supabase/functions/__tests__/hub-functions_test.ts
git commit -m "feat(hub-approve): require motivo on correcao, validate mensagem text

correcao needs one of the four correction reasons and passes p_motivo to
record_client_approval; mensagem must be non-empty after trim, at most
4000 chars, and only on a post in a client-visible status; insert
failures return a generic message.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: New edge function `hub-post-history`

**Files:**
- Create: `supabase/functions/_shared/hub-approvals.ts`
- Create: `supabase/functions/hub-post-history/handler.ts`
- Create: `supabase/functions/hub-post-history/index.ts`
- Create: `supabase/functions/__tests__/hub-post-history_test.ts`
- Modify: `supabase/config.toml` (after the `[functions.hub-approve]` block at line 46-47)

**Interfaces:**
- Consumes: `resolveHubToken(db, token, now)` from `supabase/functions/_shared/hub-token.ts`; `createJsonResponder` from `_shared/http.ts`; `getClientIP`/`checkRateLimit` from `_shared/rate-limit.ts`; tables `workflow_posts`, `post_status_events` (with Task 2 columns), `post_approvals` (with Task 1 column).
- Produces (shared, also consumed by Task 4b): `export function isClientVisibleApproval(row: { action: string; is_workspace_user: boolean | null }): boolean` in `supabase/functions/_shared/hub-approvals.ts`, true unless `action === "mensagem" && is_workspace_user === true`.
- Produces:

```ts
export interface HubHistoryEvent {
  id: number;
  to_status: string;                       // one of VISIBLE_STATUSES
  source: "client" | "team" | "system";    // workspace_user is mapped to "team"
  created_at: string;
  post_approval_id: number | null;
  snapshot: { conteudo_plain: string | null; ig_caption: string | null } | null; // only on enviado_cliente events
}
export interface HubHistoryApproval {
  id: number;
  action: "aprovado" | "correcao" | "mensagem";
  comentario: string | null;
  motivo: string | null;
  is_workspace_user: boolean;   // always false when action = "mensagem": team messages are dropped server-side
  created_at: string;
}
export function sanitizeHistoryEvents(rows: RawStatusEventRow[]): HubHistoryEvent[];
// Drops action = "mensagem" rows with is_workspace_user = true; applies NO temporal floor
// (client-authored approvals are safe even when the post has no send event).
export function sanitizeHistoryApprovals(rows: RawApprovalRow[]): HubHistoryApproval[];
export function createHubPostHistoryHandler(deps: {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
}): (req: Request) => Promise<Response>;
```

  GET `?token=<hub token>&post_id=<int>` → `200 { events: HubHistoryEvent[], approvals: HubHistoryApproval[] }`; `405` non-GET; `400` missing/invalid params; `404 "Link inválido."` bad token; `404 "Post não encontrado."`; `403 "Não autorizado."`; `429` on rate limit (`hub-read:${conta_id}:${cliente_id}` 300/300s, `hub-badtoken:<ip>` 30/600s).

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/__tests__/hub-post-history_test.ts`:

```ts
import { assert, assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createHubPostHistoryHandler, sanitizeHistoryApprovals, sanitizeHistoryEvents } from "../hub-post-history/handler.ts";

const now = () => "2026-09-17T12:00:00.000Z";
const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://hub.mesaas.com" });

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>, rateLimit = async () => true) {
  return createHubPostHistoryHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    rateLimit,
  });
}

function queueOwnedPost(db: ReturnType<typeof createSupabaseQueryMock>) {
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, conta_id: "conta-1", is_active: true }, error: null });
  db.queue("workflow_posts", "select", { data: { id: 99, cliente_id: 14, conta_id: "conta-1" }, error: null });
}

const rawEvents = [
  // internal move before the first send: must be dropped by the floor (and by the allowlist)
  { id: 1, from_status: "rascunho", to_status: "revisao_interna", source: "workspace_user", actor_user_id: "u-1", actor_name: "Ana da Agência", post_approval_id: null, created_at: "2026-09-01T10:00:00.000Z", from_custom_status_id: null, to_custom_status_id: null, from_custom_nome: null, to_custom_nome: null, snapshot_conteudo_plain: null, snapshot_ig_caption: null },
  // first send (from an internal status): kept, from_status hidden, snapshot exposed
  { id: 2, from_status: "aprovado_interno", to_status: "enviado_cliente", source: "workspace_user", actor_user_id: "u-1", actor_name: "Ana da Agência", post_approval_id: null, created_at: "2026-09-02T10:00:00.000Z", from_custom_status_id: null, to_custom_status_id: null, from_custom_nome: null, to_custom_nome: null, snapshot_conteudo_plain: "texto v1", snapshot_ig_caption: "legenda v1" },
  // custom-status-only move: from = to, must be dropped
  { id: 3, from_status: "enviado_cliente", to_status: "enviado_cliente", source: "workspace_user", actor_user_id: "u-1", actor_name: "Ana da Agência", post_approval_id: null, created_at: "2026-09-02T11:00:00.000Z", from_custom_status_id: null, to_custom_status_id: "cs-1", from_custom_nome: null, to_custom_nome: "Em revisão do cliente", snapshot_conteudo_plain: null, snapshot_ig_caption: null },
  // client correction, linked to an approval
  { id: 4, from_status: "enviado_cliente", to_status: "correcao_cliente", source: "client", actor_user_id: null, actor_name: null, post_approval_id: 501, created_at: "2026-09-03T09:00:00.000Z", from_custom_status_id: null, to_custom_status_id: null, from_custom_nome: null, to_custom_nome: null, snapshot_conteudo_plain: null, snapshot_ig_caption: null },
  // team moves the post back to an internal status: to_status not visible, dropped
  { id: 5, from_status: "correcao_cliente", to_status: "revisao_interna", source: "workspace_user", actor_user_id: "u-2", actor_name: "Bia", post_approval_id: null, created_at: "2026-09-03T10:00:00.000Z", from_custom_status_id: null, to_custom_status_id: null, from_custom_nome: null, to_custom_nome: null, snapshot_conteudo_plain: null, snapshot_ig_caption: null },
  // cron publishes
  { id: 6, from_status: "agendado", to_status: "postado", source: "system", actor_user_id: null, actor_name: null, post_approval_id: null, created_at: "2026-09-05T10:00:00.000Z", from_custom_status_id: null, to_custom_status_id: null, from_custom_nome: null, to_custom_nome: null, snapshot_conteudo_plain: null, snapshot_ig_caption: null },
];

Deno.test("sanitizeHistoryEvents applies allowlist, floor, from=to drop, and hides actors", () => {
  const events = sanitizeHistoryEvents(rawEvents);
  assertEquals(events.map((e) => e.id), [2, 4, 6]);
  assertEquals(events[0], {
    id: 2,
    to_status: "enviado_cliente",
    source: "team",
    created_at: "2026-09-02T10:00:00.000Z",
    post_approval_id: null,
    snapshot: { conteudo_plain: "texto v1", ig_caption: "legenda v1" },
  });
  assertEquals(events[1].source, "client");
  assertEquals(events[1].post_approval_id, 501);
  assertEquals(events[1].snapshot, null);
  assertEquals(events[2].source, "system");
  for (const ev of events) {
    assert(!("from_status" in ev), "from_status must not leak");
    assert(!("actor_name" in ev), "actor_name must not leak");
    assert(!("actor_user_id" in ev), "actor_user_id must not leak");
    assert(!("to_custom_nome" in ev), "custom status names must not leak");
  }
});

Deno.test("sanitizeHistoryEvents returns nothing when the post was never sent to the client", () => {
  assertEquals(sanitizeHistoryEvents([rawEvents[0], rawEvents[4]]), []);
});

const rawApprovals = [
  // team note written on the CRM Mensagens page BEFORE the first send: must be dropped
  // (team mensagem), and NOT because of any floor
  { id: 500, action: "mensagem", comentario: "Ana, revisa o CTA antes de enviar", motivo: null, is_workspace_user: true, token: null, author_user_id: "u-1", created_at: "2026-09-01T12:00:00.000Z" },
  { id: 501, action: "correcao", comentario: "Trocar a foto", motivo: "imagem_video", is_workspace_user: false, token: "hub-123", author_user_id: null, created_at: "2026-09-03T09:00:00.000Z" },
  // team reply via replyToPostApproval: internal, never shown to the client
  { id: 502, action: "mensagem", comentario: "Cliente reclamou de novo, alguém olha?", motivo: null, is_workspace_user: true, token: null, author_user_id: "u-2", created_at: "2026-09-05T11:00:00.000Z" },
  // client comment from the new composer: kept
  { id: 503, action: "mensagem", comentario: "Ficou ótimo", motivo: null, is_workspace_user: false, token: "hub-123", author_user_id: null, created_at: "2026-09-05T12:00:00.000Z" },
];

Deno.test("sanitizeHistoryApprovals drops team-authored mensagem rows, keeps client rows regardless of date, and hides token/author", () => {
  const approvals = sanitizeHistoryApprovals(rawApprovals);
  assertEquals(approvals.map((a) => a.id), [501, 503]);
  assertEquals(approvals[1], {
    id: 503,
    action: "mensagem",
    comentario: "Ficou ótimo",
    motivo: null,
    is_workspace_user: false,
    created_at: "2026-09-05T12:00:00.000Z",
  });
  for (const a of approvals) {
    assert(!("token" in a), "token must not leak");
    assert(!("author_user_id" in a), "author_user_id must not leak");
  }
});

Deno.test("sanitizeHistoryApprovals keeps client approvals for a post that has no send event (no floor on approvals)", () => {
  const onlyClientRows = [rawApprovals[1], rawApprovals[3]];
  assertEquals(sanitizeHistoryApprovals(onlyClientRows).map((a) => a.id), [501, 503]);
});

Deno.test("hub-post-history returns sanitized events and approvals for an owned post", async () => {
  const db = createSupabaseQueryMock();
  queueOwnedPost(db);
  db.queue("post_status_events", "select", { data: rawEvents, error: null });
  db.queue("post_approvals", "select", { data: rawApprovals, error: null });

  const response = await makeHandler(db)(new Request("https://example.test/hub-post-history?token=hub-123&post_id=99"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.events.map((e: { id: number }) => e.id), [2, 4, 6]);
  assertEquals(body.approvals.map((a: { id: number }) => a.id), [501, 503]);
  assertEquals(body.approvals[0].motivo, "imagem_video");
  assert(!body.approvals.some((a: { is_workspace_user: boolean; action: string }) => a.action === "mensagem" && a.is_workspace_user), "team messages must not leak");
  assert(!("token" in body.approvals[0]), "token must not leak");
  assert(!("author_user_id" in body.approvals[0]), "author_user_id must not leak");

  const eventsQuery = db.calls.find((c) => c.table === "post_status_events");
  assert(eventsQuery);
  assertEquals(eventsQuery.modifiers.find((m) => m.method === "eq")?.args, ["post_id", 99]);
  const approvalsQuery = db.calls.find((c) => c.table === "post_approvals");
  assert(approvalsQuery);
  assertEquals(approvalsQuery.selectArgs[0], ["id, action, comentario, motivo, is_workspace_user, created_at"]);
});

Deno.test("hub-post-history returns 403 for a post owned by another client and reads no history", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, conta_id: "conta-1", is_active: true }, error: null });
  db.queue("workflow_posts", "select", { data: { id: 99, cliente_id: 999, conta_id: "conta-1" }, error: null });

  const response = await makeHandler(db)(new Request("https://example.test/hub-post-history?token=hub-123&post_id=99"));
  assertEquals(response.status, 403);
  assert(!db.calls.some((c) => c.table === "post_status_events" || c.table === "post_approvals"));
});

Deno.test("hub-post-history returns 403 for a post in another workspace", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, conta_id: "conta-1", is_active: true }, error: null });
  db.queue("workflow_posts", "select", { data: { id: 99, cliente_id: 14, conta_id: "conta-2" }, error: null });

  const response = await makeHandler(db)(new Request("https://example.test/hub-post-history?token=hub-123&post_id=99"));
  assertEquals(response.status, 403);
});

Deno.test("hub-post-history returns 404 for an unknown post", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, conta_id: "conta-1", is_active: true }, error: null });
  db.queue("workflow_posts", "select", { data: null, error: null });
  const response = await makeHandler(db)(new Request("https://example.test/hub-post-history?token=hub-123&post_id=99"));
  assertEquals(response.status, 404);
});

Deno.test("hub-post-history returns 404 for an invalid token", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });
  const response = await makeHandler(db)(new Request("https://example.test/hub-post-history?token=expired&post_id=99"));
  assertEquals(response.status, 404);
});

Deno.test("hub-post-history rejects a non-numeric post_id and a missing token with 400", async () => {
  const db = createSupabaseQueryMock();
  assertEquals((await makeHandler(db)(new Request("https://example.test/hub-post-history?token=hub-123&post_id=abc"))).status, 400);
  assertEquals((await makeHandler(db)(new Request("https://example.test/hub-post-history?post_id=1"))).status, 400);
});

Deno.test("hub-post-history rejects POST with 405", async () => {
  const db = createSupabaseQueryMock();
  const response = await makeHandler(db)(new Request("https://example.test/hub-post-history?token=hub-123&post_id=99", { method: "POST" }));
  assertEquals(response.status, 405);
});

Deno.test("hub-post-history returns 429 when the read rate limit trips", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, conta_id: "conta-1", is_active: true }, error: null });
  const response = await makeHandler(db, async () => false)(new Request("https://example.test/hub-post-history?token=hub-123&post_id=99"));
  assertEquals(response.status, 429);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run test:functions -- --filter "hub-post-history"`
Expected: module resolution error for `../hub-post-history/handler.ts` (file does not exist).

- [ ] **Step 3: Implement the shared predicate and the handler**

Create `supabase/functions/_shared/hub-approvals.ts`:

```ts
/**
 * Which post_approvals rows may leave the server towards the client Hub.
 * Team-authored messages (action = 'mensagem' AND is_workspace_user = true,
 * written by the CRM's replyToPostApproval for internal coordination; its
 * notification trigger only tells owner/admin) are internal and must never
 * reach a hub token holder, in any payload. aprovado/correcao rows and
 * client messages (is_workspace_user = false) are always visible. Used by
 * hub-posts (list payload) and hub-post-history (per-post history).
 */
export function isClientVisibleApproval(row: { action: string; is_workspace_user: boolean | null }): boolean {
  return !(row.action === "mensagem" && row.is_workspace_user === true);
}
```

Create `supabase/functions/hub-post-history/handler.ts`:

```ts
import { createJsonResponder } from "../_shared/http.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";
import { getClientIP } from "../_shared/rate-limit.ts";
import { isClientVisibleApproval } from "../_shared/hub-approvals.ts";

type DbClient = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
};

// Mirrors apps/hub/src/lib/postView.ts VISIBLE_STATUSES. An event enters the
// response only by its to_status; from_status is never exposed because the
// first send always comes from an internal status.
const VISIBLE_STATUSES = new Set([
  "enviado_cliente",
  "aprovado_cliente",
  "correcao_cliente",
  "agendado",
  "postado",
  "falha_publicacao",
]);

export interface RawStatusEventRow {
  id: number;
  from_status: string | null;
  to_status: string;
  source: string;
  post_approval_id: number | null;
  created_at: string;
  snapshot_conteudo_plain: string | null;
  snapshot_ig_caption: string | null;
  // actor_name / actor_user_id / custom-status columns may be present on the
  // row; they are read here only to be dropped.
  [extra: string]: unknown;
}

export interface HubHistoryEvent {
  id: number;
  to_status: string;
  source: "client" | "team" | "system";
  created_at: string;
  post_approval_id: number | null;
  snapshot: { conteudo_plain: string | null; ig_caption: string | null } | null;
}

export interface HubHistoryApproval {
  id: number;
  action: "aprovado" | "correcao" | "mensagem";
  comentario: string | null;
  motivo: string | null;
  /** Always false for action = "mensagem": team messages never leave this function. */
  is_workspace_user: boolean;
  created_at: string;
}

export interface RawApprovalRow {
  id: number;
  action: string;
  comentario: string | null;
  motivo: string | null;
  is_workspace_user: boolean | null;
  created_at: string;
  [extra: string]: unknown;
}

function compareByCreatedAtThenId(a: { created_at: string; id: number }, b: { created_at: string; id: number }) {
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id;
}

/**
 * Pure DTO builder. Order (created_at, id); drop from = to rows (custom-status
 * only moves also fire the trigger since 20260805000001); keep only visible
 * to_status; start at the first enviado_cliente event (temporal floor); never
 * copy actor names, from_status or custom-status names.
 */
export function sanitizeHistoryEvents(rows: RawStatusEventRow[]): HubHistoryEvent[] {
  const ordered = [...rows].sort(compareByCreatedAtThenId).filter(
    (r) => r.from_status !== r.to_status && VISIBLE_STATUSES.has(r.to_status),
  );
  const firstSend = ordered.findIndex((r) => r.to_status === "enviado_cliente");
  if (firstSend === -1) return [];
  return ordered.slice(firstSend).map((r) => ({
    id: r.id,
    to_status: r.to_status,
    source: r.source === "client" ? "client" : r.source === "system" ? "system" : "team",
    created_at: r.created_at,
    post_approval_id: r.post_approval_id ?? null,
    snapshot: r.to_status === "enviado_cliente"
      ? { conteudo_plain: r.snapshot_conteudo_plain ?? null, ig_caption: r.snapshot_ig_caption ?? null }
      : null,
  }));
}

/**
 * Pure DTO builder for post_approvals. Two rules, both from spec §1:
 * 1. Team-authored messages (action = 'mensagem' AND is_workspace_user = true,
 *    written by the CRM's replyToPostApproval for internal coordination) are
 *    dropped, without exception. The Hub has no team identity, so every
 *    mensagem this feature writes is is_workspace_user = false by construction.
 * 2. NO temporal floor: aprovado/correcao/mensagem rows written by the client
 *    are safe by definition (the client only answered because the post had
 *    already reached them), and a post may have no enviado_cliente event at
 *    all (pre-20260606000001 or best-effort trigger miss). Filtering them by
 *    the first send event would erase the client's own history.
 * Never copies token or author_user_id.
 */
export function sanitizeHistoryApprovals(rows: RawApprovalRow[]): HubHistoryApproval[] {
  return [...rows]
    .sort(compareByCreatedAtThenId)
    .filter(isClientVisibleApproval)
    .map((r) => ({
      id: r.id,
      action: r.action as HubHistoryApproval["action"],
      comentario: r.comentario ?? null,
      motivo: r.motivo ?? null,
      is_workspace_user: r.is_workspace_user === true,
      created_at: r.created_at,
    }));
}

interface HubPostHistoryHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
}

export function createHubPostHistoryHandler(deps: HubPostHistoryHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    const postId = Number.parseInt(url.searchParams.get("post_id") ?? "", 10);
    if (!token || Number.isNaN(postId) || postId <= 0) {
      return json({ error: "token and post_id required" }, 400);
    }

    const db = deps.createDb();

    // deno-lint-ignore no-explicit-any
    const hubToken = await resolveHubToken(db as any, token, deps.now());
    if (!hubToken) {
      const okBadToken = await deps.rateLimit(db, `hub-badtoken:${getClientIP(req)}`, 30, 600);
      if (!okBadToken) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
      return json({ error: "Link inválido." }, 404);
    }

    const okRead = await deps.rateLimit(
      db, `hub-read:${hubToken.conta_id}:${hubToken.cliente_id}`, 300, 300,
    );
    if (!okRead) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);

    // P0: resolve the post through the token's own client/workspace BEFORE
    // reading any history. Same pattern as hub-approve.
    const { data: post } = await db
      .from("workflow_posts")
      .select("id, cliente_id, conta_id")
      .eq("id", postId)
      .maybeSingle();
    if (!post) return json({ error: "Post não encontrado." }, 404);
    if (post.cliente_id !== hubToken.cliente_id || post.conta_id !== hubToken.conta_id) {
      return json({ error: "Não autorizado." }, 403);
    }

    const { data: events, error: eventsError } = await db
      .from("post_status_events")
      .select("id, from_status, to_status, source, post_approval_id, created_at, snapshot_conteudo_plain, snapshot_ig_caption")
      .eq("post_id", postId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (eventsError) {
      console.error("[hub-post-history] events lookup failed:", eventsError);
      return json({ error: "Erro ao carregar histórico." }, 500);
    }

    const { data: approvals, error: approvalsError } = await db
      .from("post_approvals")
      .select("id, action, comentario, motivo, is_workspace_user, created_at")
      .eq("post_id", postId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (approvalsError) {
      console.error("[hub-post-history] approvals lookup failed:", approvalsError);
      return json({ error: "Erro ao carregar histórico." }, 500);
    }

    return json({
      events: sanitizeHistoryEvents((events ?? []) as RawStatusEventRow[]),
      approvals: sanitizeHistoryApprovals((approvals ?? []) as RawApprovalRow[]),
    });
  };
}
```

Create `supabase/functions/hub-post-history/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { createHubPostHistoryHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createHubPostHistoryHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
  now: () => new Date().toISOString(),
  // deno-lint-ignore no-explicit-any
  rateLimit: (db, key, max, win) => checkRateLimit(db as any, key, max, win),
}));
```

In `supabase/config.toml`, after line 47 (`verify_jwt = false` of `[functions.hub-approve]`) add:

```toml

[functions.hub-post-history]
verify_jwt = false
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm run check:functions && npm run test:functions -- --filter "hub-post-history"`
Expected: `deno check` clean (the new `index.ts` is picked up by the `supabase/functions/*/index.ts` glob); 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/hub-approvals.ts supabase/functions/hub-post-history supabase/functions/__tests__/hub-post-history_test.ts supabase/config.toml
git commit -m "feat(hub-post-history): token-scoped per-post history endpoint

GET ?token&post_id resolves the post through the hub token, checks
cliente_id/conta_id ownership, then returns status events filtered by the
client allowlist and temporal floor (no from_status, no actor names) plus
the post's approvals with motivo. Team-authored mensagem rows (CRM
replyToPostApproval) are dropped server-side; client-authored approvals
are never floor-filtered.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4b: `hub-posts`: stop shipping team messages in `postApprovals`

**Files:**
- Modify: `supabase/functions/hub-posts/handler.ts` (the `post_approvals` query at lines 139-145 and the `postApprovals:` response key at line 398)
- Modify: `supabase/functions/__tests__/hub-functions_test.ts` (append one test after `"hub-posts returns flattened post data with signed media URLs"`, which ends at line 168)

**Interfaces:**
- Consumes: `isClientVisibleApproval` from `supabase/functions/_shared/hub-approvals.ts` (Task 4); `createHubPostsHandler` deps unchanged.
- Produces: `GET /hub-posts?token=` response `postApprovals` never contains a row with `action = "mensagem" AND is_workspace_user = true`. Row shape unchanged (`id, post_id, action, comentario, is_workspace_user, created_at`), so `apps/hub/src/types.ts` `PostApproval` and every consumer of `postApprovals` keep working; the collapsed `PostHistoryPanel` header (Task 10) now counts already-clean data and needs no change.

- [ ] **Step 1: Write the failing test**

In `supabase/functions/__tests__/hub-functions_test.ts`, immediately after the closing `});` of `"hub-posts returns flattened post data with signed media URLs"` (line 168), add:

```ts
Deno.test("hub-posts never ships team-authored mensagem rows in postApprovals", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("workflow_posts", "select", {
    data: [
      { id: 99, titulo: "Post principal", tipo: "feed", status: "enviado_cliente", ordem: 0, conteudo_plain: "x", scheduled_at: "2026-04-20T10:00:00.000Z", platform: "instagram", workflow_id: 7, workflows: { titulo: "Calendário Abril" } },
    ],
    error: null,
  });
  db.queue("post_approvals", "select", {
    data: [
      // internal note from the CRM Mensagens page (replyToPostApproval): must be dropped
      { id: 1, post_id: 99, action: "mensagem", comentario: "Ana, o CTA está fraco", is_workspace_user: true, created_at: "2026-04-10T10:00:00.000Z" },
      { id: 2, post_id: 99, action: "correcao", comentario: "Trocar a foto", is_workspace_user: false, created_at: "2026-04-11T10:00:00.000Z" },
      { id: 3, post_id: 99, action: "mensagem", comentario: "Ficou ótimo", is_workspace_user: false, created_at: "2026-04-12T10:00:00.000Z" },
      // team-authored approval rows do not exist in practice (hub-approve hardcodes false) but are not messages: kept
      { id: 4, post_id: 99, action: "aprovado", comentario: null, is_workspace_user: true, created_at: "2026-04-13T10:00:00.000Z" },
    ],
    error: null,
  });
  db.queue("post_property_values", "select", { data: [], error: null });
  db.queue("workflow_select_options", "select", { data: [], error: null });
  db.queue("post_file_links", "select", { data: [], error: null });
  db.queue("instagram_accounts", "select", { data: null, error: null });

  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async (key) => `https://signed.mesaas.com/${key}`,
    rateLimit: async () => true,
  });

  const response = await handler(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.postApprovals.map((a: { id: number }) => a.id), [2, 3, 4]);
  assert(
    !body.postApprovals.some((a: { action: string; is_workspace_user: boolean }) => a.action === "mensagem" && a.is_workspace_user),
    "team mensagem rows must not leave hub-posts",
  );
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm run test:functions -- --filter "hub-posts never ships"`
Expected: fails with `[1, 2, 3, 4]` received instead of `[2, 3, 4]`.

- [ ] **Step 3: Filter the list payload**

In `supabase/functions/hub-posts/handler.ts`, add after line 3 (`import { getClientIP } from "../_shared/rate-limit.ts";`):

```ts
import { isClientVisibleApproval } from "../_shared/hub-approvals.ts";
```

Replace lines 139-144:

```ts
    const { data: postApprovals } = postIds.length > 0
      ? await db
          .from("post_approvals")
          .select("id, post_id, action, comentario, is_workspace_user, created_at")
          .in("post_id", postIds)
          .order("created_at", { ascending: true })
      : { data: [] };
```

with:

```ts
    const { data: rawPostApprovals } = postIds.length > 0
      ? await db
          .from("post_approvals")
          .select("id, post_id, action, comentario, is_workspace_user, created_at")
          .in("post_id", postIds)
          .order("created_at", { ascending: true })
      : { data: [] };
    // Internal team notes (replyToPostApproval) never leave the server; same
    // rule as hub-post-history. Filtered in code rather than with a PostgREST
    // .or() so the rule has exactly one definition (_shared/hub-approvals.ts).
    const postApprovals = ((rawPostApprovals ?? []) as { action: string; is_workspace_user: boolean | null }[])
      .filter(isClientVisibleApproval);
```

and change the response key at line 398 from `postApprovals: postApprovals ?? [],` to `postApprovals,`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm run check:functions && npm run test:functions -- --filter "hub-posts"`
Expected: `deno check` clean; every hub-posts test passes, including the new one (the pre-existing tests queue `post_approvals` as `[]`, so they are unaffected).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hub-posts/handler.ts supabase/functions/__tests__/hub-functions_test.ts
git commit -m "fix(hub-posts): drop team-authored mensagem rows from postApprovals

The list payload returned every post_approvals row verbatim, including
internal notes written from the CRM Mensagens page. Filter with the
shared isClientVisibleApproval predicate so the same rule protects both
hub-posts and hub-post-history.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Shared `@mesaas/text-diff` package

**Files:**
- Create: `packages/text-diff/package.json`, `packages/text-diff/index.ts`, `packages/text-diff/index.test.ts`
- Modify: `apps/crm/src/utils/textDiff.ts` (becomes a re-export shim; its two existing test files and `tiptapDiff.ts`, `DiffView.tsx`, `PostEditorBody.tsx`, `PostVersionHistorySheet.tsx` keep importing it unchanged)
- Modify: `vitest.config.ts` (line 15), `apps/hub/vite.config.ts` (line 16), `apps/hub/tsconfig.json` (line 10), `apps/crm/vite.config.ts` (line 19), `apps/crm/tsconfig.json` (line 11)

**Interfaces:**
- Consumes: root deps `diff-match-patch` and `@types/diff-match-patch` (already in `package.json:93,102`); the existing implementation at `apps/crm/src/utils/textDiff.ts`.
- Produces: `@mesaas/text-diff` exporting `interface DiffSegment { type: 'equal' | 'insert' | 'delete'; text: string }`, `diffWords(text1: string, text2: string): [number, string][]`, `computeWordDiff(original: string, suggested: string): DiffSegment[]`.

- [ ] **Step 1: Write the failing package test**

Create `packages/text-diff/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeWordDiff, diffWords } from './index';

describe('@mesaas/text-diff', () => {
  it('never splits a word: every insert/delete segment is made of whole tokens', () => {
    const segments = computeWordDiff('acneico funciona', 'antiacne funciona');
    const changed = segments.filter((s) => s.type !== 'equal').map((s) => s.text);
    expect(changed).toEqual(['acneico', 'antiacne']);
    expect(segments.at(-1)).toEqual({ type: 'equal', text: ' funciona' });
  });

  it('round-trips: equal+delete segments rebuild the original, equal+insert rebuild the new text', () => {
    const a = 'Lançamento da coleção de inverno, confira!';
    const b = 'Lançamento da nova coleção de verão. Confira!';
    const segments = computeWordDiff(a, b);
    expect(segments.filter((s) => s.type !== 'insert').map((s) => s.text).join('')).toBe(a);
    expect(segments.filter((s) => s.type !== 'delete').map((s) => s.text).join('')).toBe(b);
  });

  it('exposes the raw diff-match-patch tuples', () => {
    expect(diffWords('a', 'a')).toEqual([[0, 'a']]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm run test -- packages/text-diff`
Expected: `Failed to resolve import "./index"` (package does not exist yet).

- [ ] **Step 3: Create the package, the aliases and the shim**

Run: `git mv apps/crm/src/utils/textDiff.ts packages/text-diff/index.ts`

Create `packages/text-diff/package.json`:

```json
{
  "name": "@mesaas/text-diff",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "index.ts"
}
```

Create `apps/crm/src/utils/textDiff.ts` (shim; every CRM import path stays valid):

```ts
// Moved to the shared workspace package so the Hub history diff and the CRM
// suggestion/version diffs use one implementation. Import from
// '@mesaas/text-diff' in new code.
export { computeWordDiff, diffWords } from '@mesaas/text-diff';
export type { DiffSegment } from '@mesaas/text-diff';
```

Add the alias in each of the five config files, right after the `@mesaas/link-policy` line:

`vitest.config.ts` (after line 15):
```ts
      '@mesaas/text-diff': path.resolve(__dirname, 'packages/text-diff/index.ts'),
```
`apps/hub/vite.config.ts` (after line 16) and `apps/crm/vite.config.ts` (after line 19):
```ts
      '@mesaas/text-diff': path.resolve(__dirname, '../../packages/text-diff/index.ts'),
```
`apps/hub/tsconfig.json` (after line 10) and `apps/crm/tsconfig.json` (after line 11), inside `"paths"` (add a trailing comma to the previous entry):
```json
      "@mesaas/text-diff": ["../../packages/text-diff/index.ts"]
```

Run `npm install` so `package-lock.json` registers the new workspace, then check the lockfile diff only adds the `packages/text-diff` workspace entry (`git diff --stat package-lock.json`).

- [ ] **Step 4: Run the tests and typechecks and confirm they pass**

Run: `npm run test -- packages/text-diff apps/crm/src/utils && npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: the 3 new tests plus `textDiff.test.ts`, `textDiff.overflow.test.ts` and `tiptapDiff.test.ts` pass; both typechecks clean.

- [ ] **Step 5: Commit**

```bash
git add packages/text-diff apps/crm/src/utils/textDiff.ts vitest.config.ts apps/hub/vite.config.ts apps/hub/tsconfig.json apps/crm/vite.config.ts apps/crm/tsconfig.json package-lock.json
git commit -m "refactor: move word diff into shared @mesaas/text-diff package

CRM keeps a re-export shim at utils/textDiff.ts; the Hub history panel
imports the same implementation.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Hub types and API client

**Files:**
- Modify: `apps/hub/src/types.ts` (after the `PostApproval` interface)
- Modify: `apps/hub/src/api.ts` (lines 63-79)
- Modify: `apps/hub/src/__tests__/api.test.ts`

**Interfaces:**
- Consumes: `get<T>(fn, params)` / `post<T>(fn, body)` helpers in `apps/hub/src/api.ts:35-57`; the `hub-post-history` DTO from Task 4; `hub-approve` body from Task 3.
- Produces (in `types.ts`):

```ts
export type CorrectionReason = 'legenda' | 'imagem_video' | 'data' | 'outro';
export interface PostHistoryEvent {
  id: number;
  to_status: 'enviado_cliente' | 'aprovado_cliente' | 'correcao_cliente' | 'agendado' | 'postado' | 'falha_publicacao';
  source: 'client' | 'team' | 'system';
  created_at: string;
  post_approval_id: number | null;
  snapshot: { conteudo_plain: string | null; ig_caption: string | null } | null;
}
export interface PostHistoryApproval {
  id: number;
  action: 'aprovado' | 'correcao' | 'mensagem';
  comentario: string | null;
  motivo: CorrectionReason | null;
  is_workspace_user: boolean;
  created_at: string;
}
export interface PostHistoryResponse { events: PostHistoryEvent[]; approvals: PostHistoryApproval[] }
```
  and `PostApproval` gains `motivo?: CorrectionReason | null` (optional: `hub-posts` does not select it).
- Produces (in `api.ts`): `fetchPostHistory(token: string, post_id: number): Promise<PostHistoryResponse>` (GET `hub-post-history?token&post_id`) and `submitApproval(token, post_id, action, comentario?, motivo?: CorrectionReason)` which sends `motivo` in the body only when defined.

- [ ] **Step 1: Write the failing tests**

In `apps/hub/src/__tests__/api.test.ts`, add `fetchPostHistory` to the import list from `'../api'` (alphabetically after `fetchBriefing`), and append inside the `describe('hub api client', ...)` block:

```ts
  it('fetches a post history through hub-post-history with token and post_id', async () => {
    fetchHarness.queueResponse({ json: { events: [], approvals: [] } });

    const result = await fetchPostHistory('token-hub', 42);

    expect(result).toEqual({ events: [], approvals: [] });
    const url = new URL(String(fetchHarness.calls[0].input));
    expect(url.pathname).toBe('/functions/v1/hub-post-history');
    expect(url.searchParams.get('token')).toBe('token-hub');
    expect(url.searchParams.get('post_id')).toBe('42');
    expect(fetchHarness.calls[0].init?.method).toBeUndefined();
  });

  it('sends motivo with a correcao and omits it otherwise', async () => {
    fetchHarness.queueResponse({ json: { ok: true } });
    await submitApproval('token-hub', 12, 'correcao', 'Trocar foto', 'imagem_video');
    expect(JSON.parse(String(fetchHarness.calls[0].init?.body))).toEqual({
      token: 'token-hub',
      post_id: 12,
      action: 'correcao',
      comentario: 'Trocar foto',
      motivo: 'imagem_video',
    });

    fetchHarness.queueResponse({ json: { ok: true } });
    await submitApproval('token-hub', 12, 'aprovado');
    expect(JSON.parse(String(fetchHarness.calls[1].init?.body))).toEqual({
      token: 'token-hub',
      post_id: 12,
      action: 'aprovado',
    });
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run test -- apps/hub/src/__tests__/api.test.ts`
Expected: first test fails with `fetchPostHistory is not a function`; second fails because the body lacks `motivo`.

- [ ] **Step 3: Implement types and API**

In `apps/hub/src/types.ts`, locate `export interface PostApproval {` and add the field `motivo?: CorrectionReason | null;` as its last member, then insert after that interface:

```ts
export type CorrectionReason = 'legenda' | 'imagem_video' | 'data' | 'outro';

/** hub-post-history DTO. Sanitized server-side: no from_status, no actor names, no TipTap JSON. */
export interface PostHistoryEvent {
  id: number;
  to_status:
    | 'enviado_cliente'
    | 'aprovado_cliente'
    | 'correcao_cliente'
    | 'agendado'
    | 'postado'
    | 'falha_publicacao';
  source: 'client' | 'team' | 'system';
  created_at: string;
  post_approval_id: number | null;
  /** Present only on enviado_cliente events: the text the client saw on that send. */
  snapshot: { conteudo_plain: string | null; ig_caption: string | null } | null;
}

export interface PostHistoryApproval {
  id: number;
  action: 'aprovado' | 'correcao' | 'mensagem';
  comentario: string | null;
  motivo: CorrectionReason | null;
  is_workspace_user: boolean;
  created_at: string;
}

export interface PostHistoryResponse {
  events: PostHistoryEvent[];
  approvals: PostHistoryApproval[];
}
```

In `apps/hub/src/api.ts`, add `CorrectionReason` and `PostHistoryResponse` to the type import list, then replace lines 67-79 with:

```ts
export function submitApproval(
  token: string,
  post_id: number,
  action: 'aprovado' | 'correcao' | 'mensagem',
  comentario?: string,
  motivo?: CorrectionReason,
) {
  return post<{ ok: boolean; scheduled?: boolean }>('hub-approve', {
    token,
    post_id,
    action,
    comentario,
    ...(motivo ? { motivo } : {}),
  });
}

export function fetchPostHistory(token: string, post_id: number) {
  return get<PostHistoryResponse>('hub-post-history', { token, post_id: String(post_id) });
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm run test -- apps/hub/src/__tests__/api.test.ts && npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: all api tests pass (the pre-existing `submitApproval` assertions still hold: `JSON.stringify` drops `comentario: undefined`, as before); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/types.ts apps/hub/src/api.ts apps/hub/src/__tests__/api.test.ts
git commit -m "feat(hub): fetchPostHistory client + motivo on submitApproval

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Pure history/KPI library `lib/postHistory.ts`

**Files:**
- Create: `apps/hub/src/lib/postHistory.ts`
- Create: `apps/hub/src/lib/__tests__/postHistory.test.ts`

**Interfaces:**
- Consumes: `PostHistoryResponse`, `PostHistoryEvent`, `PostHistoryApproval`, `CorrectionReason` from `apps/hub/src/types.ts` (Task 6).
- Produces:

```ts
export const CORRECTION_REASONS: readonly CorrectionReason[];
export type HistoryEntry =
  | { kind: 'send'; key: string; at: string; version: number; diff: { before: string; after: string } | null }
  | { kind: 'approval'; key: string; at: string; action: 'aprovado' | 'correcao'; comentario: string | null; motivo: CorrectionReason | null; byTeam: boolean }
  | { kind: 'status'; key: string; at: string; to_status: PostHistoryEvent['to_status']; source: 'team' | 'system' | 'client' };
export function buildHistoryEntries(history: PostHistoryResponse): HistoryEntry[];
export function selectComments(history: PostHistoryResponse): PostHistoryApproval[]; // mensagem rows with is_workspace_user = false only (second line of defense; hub-post-history already drops team messages)
export interface PostKpis { rounds: number; samples: number; avgResponseMs: number | null }
export function computePostKpis(history: PostHistoryResponse): PostKpis;
export function formatDuration(ms: number): string; // "12 min" | "5 h" | "3 d"
```

  Rules: entries ordered by `(at, kind order send < approval < status, id)`; a `send` entry's `diff` is non-null only when both this send and the previous send have a snapshot and their display text (`ig_caption ?? conteudo_plain ?? ''`) differs; a status event with `post_approval_id` set is *not* a `status` entry (the approval row represents it); `rounds` and response samples follow the Global Constraints state machine.

- [ ] **Step 1: Write the failing tests**

Create `apps/hub/src/lib/__tests__/postHistory.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PostHistoryApproval, PostHistoryEvent, PostHistoryResponse } from '../../types';
import {
  buildHistoryEntries,
  computePostKpis,
  formatDuration,
  selectComments,
} from '../postHistory';

const HOUR = 60 * 60 * 1000;

function ev(overrides: Partial<PostHistoryEvent> & { id: number; to_status: PostHistoryEvent['to_status']; created_at: string }): PostHistoryEvent {
  return { source: 'team', post_approval_id: null, snapshot: null, ...overrides };
}

function send(id: number, created_at: string, caption: string | null): PostHistoryEvent {
  return ev({ id, to_status: 'enviado_cliente', created_at, snapshot: { conteudo_plain: 'texto', ig_caption: caption } });
}

function ap(overrides: Partial<PostHistoryApproval> & { id: number; action: PostHistoryApproval['action']; created_at: string }): PostHistoryApproval {
  return { comentario: null, motivo: null, is_workspace_user: false, ...overrides };
}

function history(events: PostHistoryEvent[], approvals: PostHistoryApproval[]): PostHistoryResponse {
  return { events, approvals };
}

describe('computePostKpis', () => {
  it('(a) send then first client response: one sample, zero rounds on approval', () => {
    const h = history(
      [send(1, '2026-09-01T10:00:00.000Z', 'v1'), ev({ id: 2, to_status: 'aprovado_cliente', source: 'client', post_approval_id: 10, created_at: '2026-09-01T13:00:00.000Z' })],
      [ap({ id: 10, action: 'aprovado', created_at: '2026-09-01T13:00:00.000Z' })],
    );
    expect(computePostKpis(h)).toEqual({ rounds: 0, samples: 1, avgResponseMs: 3 * HOUR });
  });

  it('(b) correction, resend, next response: two samples averaged, one round', () => {
    const h = history(
      [
        send(1, '2026-09-01T10:00:00.000Z', 'v1'),
        ev({ id: 2, to_status: 'correcao_cliente', source: 'client', post_approval_id: 10, created_at: '2026-09-01T12:00:00.000Z' }),
        send(3, '2026-09-02T10:00:00.000Z', 'v2'),
        ev({ id: 4, to_status: 'aprovado_cliente', source: 'client', post_approval_id: 11, created_at: '2026-09-02T14:00:00.000Z' }),
      ],
      [
        ap({ id: 10, action: 'correcao', motivo: 'legenda', comentario: 'ajustar', created_at: '2026-09-01T12:00:00.000Z' }),
        ap({ id: 11, action: 'aprovado', created_at: '2026-09-02T14:00:00.000Z' }),
      ],
    );
    expect(computePostKpis(h)).toEqual({ rounds: 1, samples: 2, avgResponseMs: 3 * HOUR });
  });

  it('(c) approval straight from correcao_cliente without a resend is not a new sample', () => {
    const h = history(
      [
        send(1, '2026-09-01T10:00:00.000Z', 'v1'),
        ev({ id: 2, to_status: 'correcao_cliente', source: 'client', post_approval_id: 10, created_at: '2026-09-01T11:00:00.000Z' }),
        ev({ id: 3, to_status: 'aprovado_cliente', source: 'client', post_approval_id: 11, created_at: '2026-09-03T11:00:00.000Z' }),
      ],
      [
        ap({ id: 10, action: 'correcao', motivo: 'data', created_at: '2026-09-01T11:00:00.000Z' }),
        ap({ id: 11, action: 'aprovado', created_at: '2026-09-03T11:00:00.000Z' }),
      ],
    );
    expect(computePostKpis(h)).toEqual({ rounds: 1, samples: 1, avgResponseMs: 1 * HOUR });
  });

  it('(d) second and third corrections while already correcao_cliente count as rounds but not samples', () => {
    const h = history(
      [
        send(1, '2026-09-01T10:00:00.000Z', 'v1'),
        ev({ id: 2, to_status: 'correcao_cliente', source: 'client', post_approval_id: 10, created_at: '2026-09-01T11:00:00.000Z' }),
      ],
      [
        ap({ id: 10, action: 'correcao', motivo: 'legenda', created_at: '2026-09-01T11:00:00.000Z' }),
        ap({ id: 11, action: 'correcao', motivo: 'outro', created_at: '2026-09-01T12:00:00.000Z' }),
        ap({ id: 12, action: 'correcao', motivo: 'data', created_at: '2026-09-01T13:00:00.000Z' }),
      ],
    );
    expect(computePostKpis(h)).toEqual({ rounds: 3, samples: 1, avgResponseMs: 1 * HOUR });
  });

  it('counts a team-set correcao_cliente event without post_approval_id as a round', () => {
    const h = history(
      [
        send(1, '2026-09-01T10:00:00.000Z', 'v1'),
        ev({ id: 2, to_status: 'correcao_cliente', source: 'team', created_at: '2026-09-01T11:00:00.000Z' }),
      ],
      [],
    );
    expect(computePostKpis(h)).toEqual({ rounds: 1, samples: 0, avgResponseMs: null });
  });

  it('treats a response created in the same instant as the send as a valid sample (timestamp tie, ids from different tables)', () => {
    const h = history(
      [send(5, '2026-09-01T10:00:00.000Z', 'v1')],
      [ap({ id: 6, action: 'aprovado', created_at: '2026-09-01T10:00:00.000Z' })],
    );
    expect(computePostKpis(h)).toEqual({ rounds: 0, samples: 1, avgResponseMs: 0 });
  });

  it('ignores team-authored approvals and mensagem rows as responses', () => {
    const h = history(
      [send(1, '2026-09-01T10:00:00.000Z', 'v1')],
      [
        ap({ id: 10, action: 'mensagem', comentario: 'oi', created_at: '2026-09-01T10:30:00.000Z' }),
        ap({ id: 11, action: 'aprovado', is_workspace_user: true, created_at: '2026-09-01T11:00:00.000Z' }),
      ],
    );
    expect(computePostKpis(h)).toEqual({ rounds: 0, samples: 0, avgResponseMs: null });
  });

  it('pre-20260606 post with approvals but no events: rounds from approvals, no samples (missing, not zero)', () => {
    const h = history([], [ap({ id: 10, action: 'correcao', created_at: '2026-05-01T10:00:00.000Z' })]);
    expect(computePostKpis(h)).toEqual({ rounds: 1, samples: 0, avgResponseMs: null });
  });
});

describe('buildHistoryEntries', () => {
  it('numbers sends, attaches a diff only when the previous send text differs, and merges approvals and unlinked status events in order', () => {
    const h = history(
      [
        send(1, '2026-09-01T10:00:00.000Z', 'legenda v1'),
        ev({ id: 2, to_status: 'correcao_cliente', source: 'client', post_approval_id: 10, created_at: '2026-09-01T12:00:00.000Z' }),
        send(3, '2026-09-02T10:00:00.000Z', 'legenda v1'),
        ev({ id: 4, to_status: 'correcao_cliente', source: 'team', created_at: '2026-09-02T11:00:00.000Z' }),
        send(5, '2026-09-03T10:00:00.000Z', 'legenda v2'),
        ev({ id: 6, to_status: 'aprovado_cliente', source: 'client', post_approval_id: 11, created_at: '2026-09-03T12:00:00.000Z' }),
        ev({ id: 7, to_status: 'postado', source: 'system', created_at: '2026-09-04T12:00:00.000Z' }),
      ],
      [
        ap({ id: 10, action: 'correcao', motivo: 'legenda', comentario: 'ajustar', created_at: '2026-09-01T12:00:00.000Z' }),
        ap({ id: 11, action: 'aprovado', created_at: '2026-09-03T12:00:00.000Z' }),
        ap({ id: 12, action: 'mensagem', comentario: 'oi', created_at: '2026-09-03T13:00:00.000Z' }),
      ],
    );
    const entries = buildHistoryEntries(h);
    expect(entries.map((e) => e.kind)).toEqual(['send', 'approval', 'send', 'status', 'send', 'approval', 'status']);
    expect(entries[0]).toMatchObject({ kind: 'send', version: 1, diff: null });
    expect(entries[2]).toMatchObject({ kind: 'send', version: 2, diff: null });
    expect(entries[4]).toMatchObject({ kind: 'send', version: 3, diff: { before: 'legenda v1', after: 'legenda v2' } });
    expect(entries[1]).toMatchObject({ kind: 'approval', action: 'correcao', motivo: 'legenda', comentario: 'ajustar', byTeam: false });
    expect(entries[3]).toMatchObject({ kind: 'status', to_status: 'correcao_cliente', source: 'team' });
    expect(entries[6]).toMatchObject({ kind: 'status', to_status: 'postado', source: 'system' });
    expect(entries.some((e) => e.kind === 'approval' && e.action !== 'correcao' && e.action !== 'aprovado')).toBe(false);
  });

  it('falls back to conteudo_plain when ig_caption is null and skips the diff when a snapshot is missing', () => {
    const h = history(
      [
        ev({ id: 1, to_status: 'enviado_cliente', created_at: '2026-09-01T10:00:00.000Z', snapshot: null }),
        ev({ id: 2, to_status: 'enviado_cliente', created_at: '2026-09-02T10:00:00.000Z', snapshot: { conteudo_plain: 'texto a', ig_caption: null } }),
        ev({ id: 3, to_status: 'enviado_cliente', created_at: '2026-09-03T10:00:00.000Z', snapshot: { conteudo_plain: 'texto b', ig_caption: null } }),
      ],
      [],
    );
    const entries = buildHistoryEntries(h);
    expect(entries[1]).toMatchObject({ kind: 'send', version: 2, diff: null });
    expect(entries[2]).toMatchObject({ kind: 'send', version: 3, diff: { before: 'texto a', after: 'texto b' } });
  });
});

describe('selectComments', () => {
  it('returns only client mensagem rows in (created_at, id) order and drops team messages', () => {
    const h = history([], [
      ap({ id: 3, action: 'mensagem', comentario: 'c', created_at: '2026-09-01T10:00:00.000Z' }),
      ap({ id: 1, action: 'aprovado', created_at: '2026-09-01T09:00:00.000Z' }),
      ap({ id: 2, action: 'mensagem', comentario: 'b', created_at: '2026-09-01T10:00:00.000Z' }),
      ap({ id: 4, action: 'mensagem', comentario: 'interno', is_workspace_user: true, created_at: '2026-09-01T11:00:00.000Z' }),
    ]);
    expect(selectComments(h).map((c) => c.id)).toEqual([2, 3]);
  });
});

describe('formatDuration', () => {
  it('picks minutes, hours or days', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(12 * 60 * 1000)).toBe('12 min');
    expect(formatDuration(5 * HOUR)).toBe('5 h');
    expect(formatDuration(47 * HOUR)).toBe('47 h');
    expect(formatDuration(72 * HOUR)).toBe('3 d');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run test -- apps/hub/src/lib/__tests__/postHistory.test.ts`
Expected: `Failed to resolve import "../postHistory"`.

- [ ] **Step 3: Implement the library**

Create `apps/hub/src/lib/postHistory.ts`:

```ts
import type {
  CorrectionReason,
  PostHistoryApproval,
  PostHistoryEvent,
  PostHistoryResponse,
} from '../types';

export const CORRECTION_REASONS: readonly CorrectionReason[] = [
  'legenda',
  'imagem_video',
  'data',
  'outro',
];

export type HistoryEntry =
  | {
      kind: 'send';
      key: string;
      at: string;
      version: number;
      diff: { before: string; after: string } | null;
    }
  | {
      kind: 'approval';
      key: string;
      at: string;
      action: 'aprovado' | 'correcao';
      comentario: string | null;
      motivo: CorrectionReason | null;
      byTeam: boolean;
    }
  | {
      kind: 'status';
      key: string;
      at: string;
      to_status: PostHistoryEvent['to_status'];
      source: PostHistoryEvent['source'];
    };

type Stamped = { created_at: string; id: number };

/** (created_at, id): the tie-break the DB indexes and the spec both use. */
function byCreatedAtThenId(a: Stamped, b: Stamped): number {
  if (a.created_at < b.created_at) return -1;
  if (a.created_at > b.created_at) return 1;
  return a.id - b.id;
}

/**
 * True when `a` is at or after `b`. Compares timestamps only: an equal
 * created_at counts as at-or-after regardless of id, because `a` and `b`
 * come from different tables (post_approvals vs post_status_events) and
 * their ids are not comparable. `byCreatedAtThenId` is only for ordering
 * rows of the same table.
 */
function isAtOrAfter(a: Stamped, b: Stamped): boolean {
  return a.created_at >= b.created_at;
}

function sortedEvents(history: PostHistoryResponse): PostHistoryEvent[] {
  return [...history.events].sort(byCreatedAtThenId);
}

function sortedApprovals(history: PostHistoryResponse): PostHistoryApproval[] {
  return [...history.approvals].sort(byCreatedAtThenId);
}

function snapshotText(event: PostHistoryEvent): string | null {
  if (!event.snapshot) return null;
  return event.snapshot.ig_caption ?? event.snapshot.conteudo_plain ?? '';
}

const KIND_ORDER: Record<HistoryEntry['kind'], number> = { send: 0, approval: 1, status: 2 };

export function buildHistoryEntries(history: PostHistoryResponse): HistoryEntry[] {
  const events = sortedEvents(history);
  const entries: Array<HistoryEntry & { id: number }> = [];

  let version = 0;
  let previousSendText: string | null = null;
  for (const event of events) {
    if (event.to_status === 'enviado_cliente') {
      version += 1;
      const text = snapshotText(event);
      const diff =
        text !== null && previousSendText !== null && text !== previousSendText
          ? { before: previousSendText, after: text }
          : null;
      entries.push({ kind: 'send', key: `send-${event.id}`, at: event.created_at, version, diff, id: event.id });
      previousSendText = text;
    } else if (event.post_approval_id == null) {
      // Events linked to an approval are represented by the approval row itself.
      entries.push({
        kind: 'status',
        key: `status-${event.id}`,
        at: event.created_at,
        to_status: event.to_status,
        source: event.source,
        id: event.id,
      });
    }
  }

  for (const approval of sortedApprovals(history)) {
    if (approval.action === 'mensagem') continue;
    entries.push({
      kind: 'approval',
      key: `approval-${approval.id}`,
      at: approval.created_at,
      action: approval.action,
      comentario: approval.comentario,
      motivo: approval.motivo,
      byTeam: approval.is_workspace_user,
      id: approval.id,
    });
  }

  entries.sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return a.id - b.id;
  });

  return entries.map(({ id: _id, ...entry }) => entry as HistoryEntry);
}

/**
 * Client comments only. hub-post-history already drops team-authored mensagem
 * rows (spec §1); this repeats the rule so a stale or misconfigured endpoint
 * can never put an internal team note on the client's screen.
 */
export function selectComments(history: PostHistoryResponse): PostHistoryApproval[] {
  return sortedApprovals(history).filter((a) => a.action === 'mensagem' && !a.is_workspace_user);
}

export interface PostKpis {
  /** Client corrections (post_approvals) + team-set correcao_cliente events without an approval. */
  rounds: number;
  /** Number of sends that received a client response. 0 means "no data", never "0 hours". */
  samples: number;
  avgResponseMs: number | null;
}

/**
 * Spec §3 state machine. A send opens a clock; the FIRST client response
 * (aprovado/correcao, is_workspace_user = false) at or after it and before the
 * next send closes it. Later responses to the same send (case c: approval
 * straight from correcao_cliente; case d: 2nd/3rd correction) are not samples.
 */
export function computePostKpis(history: PostHistoryResponse): PostKpis {
  const events = sortedEvents(history);
  const approvals = sortedApprovals(history);

  const rounds =
    approvals.filter((a) => a.action === 'correcao').length +
    events.filter((e) => e.to_status === 'correcao_cliente' && e.post_approval_id == null).length;

  const sends = events.filter((e) => e.to_status === 'enviado_cliente');
  const responses = approvals.filter((a) => a.action !== 'mensagem' && !a.is_workspace_user);

  const samplesMs: number[] = [];
  sends.forEach((send, i) => {
    const nextSend = sends[i + 1];
    const first = responses.find(
      (r) => isAtOrAfter(r, send) && (!nextSend || !isAtOrAfter(r, nextSend)),
    );
    if (first) {
      samplesMs.push(new Date(first.created_at).getTime() - new Date(send.created_at).getTime());
    }
  });

  const avgResponseMs =
    samplesMs.length > 0 ? samplesMs.reduce((sum, ms) => sum + ms, 0) / samplesMs.length : null;

  return { rounds, samples: samplesMs.length, avgResponseMs };
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(ms / 86_400_000)} d`;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm run test -- apps/hub/src/lib/__tests__/postHistory.test.ts && npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: 13 tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/lib/postHistory.ts apps/hub/src/lib/__tests__/postHistory.test.ts
git commit -m "feat(hub): pure post history merge + KPI state machine

Rounds union client corrections with team-set correcao_cliente events;
response time samples only the first client response per send (cases c
and d excluded); ordering by (created_at, id).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: i18n keys (pt + en)

**Files:**
- Modify: `packages/i18n/locales/pt/hubPosts.json`
- Modify: `packages/i18n/locales/en/hubPosts.json`
- Test: `apps/hub/src/lib/__tests__/hubPostsLocale.test.ts` (create)

**Interfaces:**
- Consumes: the existing `hubPosts` namespace (top-level keys `shared`, `aprovacoes`, `postagens`, `postagemFoco`, `instagramCard`, `storyCard`, `textCard`), loaded by `apps/hub/src/main.tsx` and `test/vitest.setup.ts:33-34`.
- Produces: new top-level objects `history` and `correctionReason`, and `postagens.filter`, identical key sets in `pt` and `en`. Components call `t('history.<key>', '<pt fallback>')` from `useTranslation('hubPosts')`.

- [ ] **Step 1: Write the failing parity test**

Create `apps/hub/src/lib/__tests__/hubPostsLocale.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import pt from '../../../../../packages/i18n/locales/pt/hubPosts.json';
import en from '../../../../../packages/i18n/locales/en/hubPosts.json';

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object'
      ? flattenKeys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe('hubPosts locale files', () => {
  it('pt and en expose the same keys', () => {
    expect(flattenKeys(en).sort()).toEqual(flattenKeys(pt).sort());
  });

  it('carries the history, correctionReason and postagens.filter keys', () => {
    const keys = flattenKeys(pt);
    for (const key of [
      'history.toggle',
      'history.summary',
      'history.tabHistory',
      'history.tabComments',
      'history.loading',
      'history.loadError',
      'history.empty',
      'history.emptyComments',
      'history.sentVersion',
      'history.approved',
      'history.correctionRequested',
      'history.actor.team',
      'history.actor.system',
      'history.actor.you',
      'history.showDiff',
      'history.hideDiff',
      'history.kpi.rounds',
      'history.kpi.avgResponse',
      'history.kpi.noData',
      'history.composerPlaceholder',
      'history.send',
      'history.sending',
      'history.sendError',
      'history.motivoLabel',
      'correctionReason.title',
      'correctionReason.required',
      'correctionReason.legenda',
      'correctionReason.imagem_video',
      'correctionReason.data',
      'correctionReason.outro',
      'postagens.filter.all',
      'postagens.filter.label',
    ]) {
      expect(keys, key).toContain(key);
    }
  });

  it('has no em-dash in any user-facing string', () => {
    expect(JSON.stringify(pt.history) + JSON.stringify(pt.correctionReason)).not.toMatch(/—/);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm run test -- apps/hub/src/lib/__tests__/hubPostsLocale.test.ts`
Expected: the second test fails on `history.toggle` (missing).

- [ ] **Step 3: Add the keys**

In `packages/i18n/locales/pt/hubPosts.json`, inside `"postagens"` add after `"clickToExpand"`:

```json
    "filter": {
      "label": "Filtrar por status",
      "all": "Todos"
    },
```

and add two new top-level objects at the end of the file (after `"textCard"`):

```json
  "history": {
    "toggle": "Histórico e comentários",
    "summary": "{{decisions}} decisões · {{comments}} comentários",
    "tabHistory": "Histórico",
    "tabComments": "Comentários",
    "loading": "Carregando histórico...",
    "loadError": "Não foi possível carregar o histórico.",
    "empty": "Nenhum evento registrado ainda.",
    "emptyComments": "Nenhum comentário ainda. Escreva o primeiro.",
    "sentVersion": "v{{version}}: enviado para aprovação",
    "approved": "Aprovado",
    "correctionRequested": "Correção solicitada",
    "actor": {
      "team": "Equipe",
      "system": "Sistema",
      "you": "Você"
    },
    "showDiff": "Ver alterações na legenda",
    "hideDiff": "Ocultar alterações",
    "kpi": {
      "rounds": "{{count}} rodada(s) de correção",
      "avgResponse": "Tempo médio de resposta: {{value}}",
      "noData": "Tempo médio de resposta: sem dados ainda"
    },
    "composerPlaceholder": "Escreva um comentário sobre este post",
    "send": "Enviar",
    "sending": "Enviando...",
    "sendError": "Não foi possível enviar o comentário.",
    "motivoLabel": "Motivo"
  },
  "correctionReason": {
    "title": "Motivo da correção",
    "required": "Escolha o motivo e deixe um comentário para solicitar correção",
    "legenda": "Legenda",
    "imagem_video": "Imagem/vídeo",
    "data": "Data",
    "outro": "Outro"
  }
```

In `packages/i18n/locales/en/hubPosts.json`, mirror the structure:

```json
    "filter": {
      "label": "Filter by status",
      "all": "All"
    },
```

```json
  "history": {
    "toggle": "History and comments",
    "summary": "{{decisions}} decisions · {{comments}} comments",
    "tabHistory": "History",
    "tabComments": "Comments",
    "loading": "Loading history...",
    "loadError": "Could not load the history.",
    "empty": "No events recorded yet.",
    "emptyComments": "No comments yet. Write the first one.",
    "sentVersion": "v{{version}}: sent for approval",
    "approved": "Approved",
    "correctionRequested": "Correction requested",
    "actor": {
      "team": "Team",
      "system": "System",
      "you": "You"
    },
    "showDiff": "Show caption changes",
    "hideDiff": "Hide changes",
    "kpi": {
      "rounds": "{{count}} correction round(s)",
      "avgResponse": "Average response time: {{value}}",
      "noData": "Average response time: no data yet"
    },
    "composerPlaceholder": "Write a comment about this post",
    "send": "Send",
    "sending": "Sending...",
    "sendError": "Could not send the comment.",
    "motivoLabel": "Reason"
  },
  "correctionReason": {
    "title": "Correction reason",
    "required": "Pick a reason and leave a comment to request a correction",
    "legenda": "Caption",
    "imagem_video": "Image/video",
    "data": "Date",
    "outro": "Other"
  }
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm run test -- apps/hub/src/lib/__tests__/hubPostsLocale.test.ts && npm run format:check`
Expected: 3 tests pass; prettier clean (run `npm run format` if the JSON indentation was off).

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/locales/pt/hubPosts.json packages/i18n/locales/en/hubPosts.json apps/hub/src/lib/__tests__/hubPostsLocale.test.ts
git commit -m "feat(i18n): hub post history, correction reason and status filter copy

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `CorrectionReasonChips` component

**Files:**
- Create: `apps/hub/src/components/CorrectionReasonChips.tsx`
- Create: `apps/hub/src/components/__tests__/CorrectionReasonChips.test.tsx`

**Interfaces:**
- Consumes: `CORRECTION_REASONS` from `apps/hub/src/lib/postHistory.ts`; `CorrectionReason` from `types.ts`; `hubPosts:correctionReason.*` keys (Task 8).
- Produces: `export function CorrectionReasonChips({ value, onChange, disabled }: { value: CorrectionReason | null; onChange: (value: CorrectionReason) => void; disabled?: boolean })` rendering a `<div role="group" aria-label="Motivo da correção">` with four `<button type="button" aria-pressed>` chips.

- [ ] **Step 1: Write the failing test**

Create `apps/hub/src/components/__tests__/CorrectionReasonChips.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CorrectionReasonChips } from '../CorrectionReasonChips';

describe('CorrectionReasonChips', () => {
  it('renders the four reasons inside a labelled group and reports the pressed one', () => {
    const onChange = vi.fn();
    render(<CorrectionReasonChips value="data" onChange={onChange} />);

    const group = screen.getByRole('group', { name: 'Motivo da correção' });
    expect(group).toBeInTheDocument();
    for (const label of ['Legenda', 'Imagem/vídeo', 'Data', 'Outro']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Data' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Legenda' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Legenda' }));
    expect(onChange).toHaveBeenCalledWith('legenda');
  });

  it('disables every chip when disabled', () => {
    render(<CorrectionReasonChips value={null} onChange={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: 'Outro' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm run test -- apps/hub/src/components/__tests__/CorrectionReasonChips.test.tsx`
Expected: `Failed to resolve import "../CorrectionReasonChips"`.

- [ ] **Step 3: Implement the component**

Create `apps/hub/src/components/CorrectionReasonChips.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { CORRECTION_REASONS } from '../lib/postHistory';
import type { CorrectionReason } from '../types';

const FALLBACK_LABELS: Record<CorrectionReason, string> = {
  legenda: 'Legenda',
  imagem_video: 'Imagem/vídeo',
  data: 'Data',
  outro: 'Outro',
};

interface CorrectionReasonChipsProps {
  value: CorrectionReason | null;
  onChange: (value: CorrectionReason) => void;
  disabled?: boolean;
}

/** Four fixed reasons; required by hub-approve (and the DB CHECK) on every correcao. */
export function CorrectionReasonChips({ value, onChange, disabled }: CorrectionReasonChipsProps) {
  const { t } = useTranslation('hubPosts');
  return (
    <div
      role="group"
      aria-label={t('correctionReason.title', 'Motivo da correção')}
      className="flex flex-wrap gap-1.5"
    >
      {CORRECTION_REASONS.map((reason) => {
        const selected = value === reason;
        return (
          <button
            key={reason}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChange(reason)}
            className="rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50"
            style={
              selected
                ? { background: 'var(--hub-acc)', color: 'var(--hub-acc-fg)', borderColor: 'var(--hub-acc)' }
                : { color: 'var(--hub-tx2)', borderColor: 'var(--hub-bd)' }
            }
          >
            {t(`correctionReason.${reason}`, FALLBACK_LABELS[reason])}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm run test -- apps/hub/src/components/__tests__/CorrectionReasonChips.test.tsx`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components/CorrectionReasonChips.tsx apps/hub/src/components/__tests__/CorrectionReasonChips.test.tsx
git commit -m "feat(hub): CorrectionReasonChips component

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `PostHistoryPanel` component

**Files:**
- Create: `apps/hub/src/components/PostHistoryPanel.tsx`
- Create: `apps/hub/src/components/__tests__/PostHistoryPanel.test.tsx`

**Interfaces:**
- Consumes: `fetchPostHistory`, `submitApproval` from `../api` (Task 6); `buildHistoryEntries`, `selectComments`, `computePostKpis`, `formatDuration` from `../lib/postHistory` (Task 7); `computeWordDiff` from `@mesaas/text-diff` (Task 5); `getClientStatusLabel` from `../lib/postView`; `formatDate` from `./PostCard`; `useUnsavedWork` from `@mesaas/app-lifecycle`; `hubPosts:history.*` keys (Task 8).
- Produces:

```ts
export function PostHistoryPanel(props: {
  post: HubPost;
  token: string;
  /** The list payload's postApprovals (all posts); filtered by post.id for the collapsed counts. */
  approvals: PostApproval[];
  /** Called after a comment is stored so the page can invalidate ['hub-posts', token]. */
  onCommentSent?: () => void;
}): JSX.Element | null;
export function TextDiff({ before, after }: { before: string; after: string }): JSX.Element;
```

  Behaviour: renders `null` when `post.status ∉ VISIBLE_STATUSES`. Collapsed: one `<button aria-expanded>` "Histórico e comentários" with the summary counts (decisions = `aprovado`+`correcao` rows, comments = `mensagem` rows with `is_workspace_user = false`; `hub-posts` already drops team notes server-side since Task 4b, the panel repeats the rule as defense in depth). Expanding triggers **one** `fetchPostHistory` call (plain `useState`/`useEffect`, no TanStack Query, so card tests render without a provider). Tabs are `<button role="tab" aria-selected>`. Histórico tab: KPI line, then entries; a `send` entry with `diff` has a "Ver alterações na legenda" toggle rendering `<TextDiff>` (`<del>`/`<ins>` per segment). Comentários tab: list + composer `<textarea>` + "Enviar" button (disabled when trimmed text is empty or sending); success clears the textarea, refetches, calls `onCommentSent`; failure shows `history.sendError`. `useUnsavedWork(text.trim() !== '' || sending)`.

- [ ] **Step 1: Write the failing tests**

Create `apps/hub/src/components/__tests__/PostHistoryPanel.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostHistoryPanel, TextDiff } from '../PostHistoryPanel';
import { fetchPostHistory, submitApproval } from '../../api';
import type { HubPost, PostApproval, PostHistoryResponse } from '../../types';

const fetchPostHistoryMock = vi.hoisted(() => vi.fn());
const submitApprovalMock = vi.hoisted(() => vi.fn());

vi.mock('../../api', () => ({
  fetchPostHistory: fetchPostHistoryMock,
  submitApproval: submitApprovalMock,
}));

const mockedFetch = vi.mocked(fetchPostHistory);
const mockedSubmit = vi.mocked(submitApproval);

function makePost(overrides: Partial<HubPost> = {}): HubPost {
  return {
    id: 7,
    titulo: 'Campanha',
    tipo: 'feed',
    status: 'correcao_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: 'texto',
    scheduled_at: null,
    ig_caption: 'legenda v2',
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: 1,
    workflow_titulo: 'Editorial',
    workflow_created_at: null,
    media: [],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    ...overrides,
  };
}

const listApprovals: PostApproval[] = [
  { id: 10, post_id: 7, action: 'correcao', comentario: 'ajustar', is_workspace_user: false, created_at: '2026-09-01T12:00:00.000Z' },
  { id: 12, post_id: 7, action: 'mensagem', comentario: 'oi', is_workspace_user: false, created_at: '2026-09-03T13:00:00.000Z' },
  { id: 13, post_id: 8, action: 'mensagem', comentario: 'outro post', is_workspace_user: false, created_at: '2026-09-03T13:00:00.000Z' },
  // team note from the CRM Mensagens page: hub-posts drops it server-side (Task 4b); the panel filters anyway as defense in depth
  { id: 14, post_id: 7, action: 'mensagem', comentario: 'nota interna', is_workspace_user: true, created_at: '2026-09-03T14:00:00.000Z' },
];

const fullHistory: PostHistoryResponse = {
  events: [
    { id: 1, to_status: 'enviado_cliente', source: 'team', created_at: '2026-09-01T10:00:00.000Z', post_approval_id: null, snapshot: { conteudo_plain: 'texto', ig_caption: 'legenda v1' } },
    { id: 2, to_status: 'correcao_cliente', source: 'client', created_at: '2026-09-01T12:00:00.000Z', post_approval_id: 10, snapshot: null },
    { id: 3, to_status: 'enviado_cliente', source: 'team', created_at: '2026-09-02T10:00:00.000Z', post_approval_id: null, snapshot: { conteudo_plain: 'texto', ig_caption: 'legenda v2' } },
    { id: 4, to_status: 'correcao_cliente', source: 'team', created_at: '2026-09-02T11:00:00.000Z', post_approval_id: null, snapshot: null },
  ],
  approvals: [
    { id: 10, action: 'correcao', comentario: 'ajustar', motivo: 'legenda', is_workspace_user: false, created_at: '2026-09-01T12:00:00.000Z' },
    { id: 12, action: 'mensagem', comentario: 'oi', motivo: null, is_workspace_user: false, created_at: '2026-09-03T13:00:00.000Z' },
    // would only appear if the endpoint regressed; the panel must still hide it
    { id: 14, action: 'mensagem', comentario: 'nota interna', motivo: null, is_workspace_user: true, created_at: '2026-09-03T14:00:00.000Z' },
  ],
};

describe('PostHistoryPanel', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedSubmit.mockReset();
  });

  it('renders nothing for a post in an internal status', () => {
    const { container } = render(
      <PostHistoryPanel post={makePost({ status: 'rascunho' })} token="tok" approvals={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows counts from the client rows of this post only and does not fetch while collapsed', () => {
    render(<PostHistoryPanel post={makePost()} token="tok" approvals={listApprovals} />);
    expect(screen.getByRole('button', { name: /Histórico e comentários/ })).toHaveAttribute('aria-expanded', 'false');
    // id 13 belongs to post 8 and id 14 is a team note: neither is counted
    expect(screen.getByText('1 decisões · 1 comentários')).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('fetches once on expand and renders the Histórico tab with KPIs, versions, motivo and a caption diff', async () => {
    mockedFetch.mockResolvedValue(fullHistory);
    render(<PostHistoryPanel post={makePost()} token="tok" approvals={listApprovals} />);

    fireEvent.click(screen.getByRole('button', { name: /Histórico e comentários/ }));
    expect(await screen.findByText('v1: enviado para aprovação')).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledWith('tok', 7);

    expect(screen.getByText('2 rodada(s) de correção')).toBeInTheDocument();
    expect(screen.getByText('Tempo médio de resposta: 2 h')).toBeInTheDocument();
    expect(screen.getByText('v2: enviado para aprovação')).toBeInTheDocument();
    expect(screen.getByText('ajustar')).toBeInTheDocument();
    expect(screen.getByText('Motivo: Legenda')).toBeInTheDocument();
    expect(screen.getAllByText('Equipe').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Correção solicitada').length).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: 'Ver alterações na legenda' }));
    expect(screen.getByText('v1').tagName).toBe('DEL');
    expect(screen.getByText('v2').tagName).toBe('INS');
    expect(screen.queryByText('oi')).not.toBeInTheDocument();
  });

  it('shows "sem dados ainda" instead of 0 when no send has a response', async () => {
    mockedFetch.mockResolvedValue({ events: [], approvals: [] });
    render(<PostHistoryPanel post={makePost()} token="tok" approvals={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Histórico e comentários/ }));
    expect(await screen.findByText('Tempo médio de resposta: sem dados ainda')).toBeInTheDocument();
    expect(screen.getByText('Nenhum evento registrado ainda.')).toBeInTheDocument();
  });

  it('shows the load error when the fetch rejects', async () => {
    mockedFetch.mockRejectedValue(new Error('HTTP 500'));
    render(<PostHistoryPanel post={makePost()} token="tok" approvals={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Histórico e comentários/ }));
    expect(await screen.findByText('Não foi possível carregar o histórico.')).toBeInTheDocument();
  });

  it('lists comments on the Comentários tab and sends a trimmed comment, then refetches', async () => {
    mockedFetch.mockResolvedValue(fullHistory);
    mockedSubmit.mockResolvedValue({ ok: true });
    const onCommentSent = vi.fn();
    render(
      <PostHistoryPanel post={makePost()} token="tok" approvals={listApprovals} onCommentSent={onCommentSent} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Histórico e comentários/ }));
    await screen.findByText('v1: enviado para aprovação');

    fireEvent.click(screen.getByRole('tab', { name: 'Comentários' }));
    expect(screen.getByText('oi')).toBeInTheDocument();
    expect(screen.getByText('Você')).toBeInTheDocument();
    expect(screen.queryByText('nota interna')).not.toBeInTheDocument();
    expect(screen.queryByText('Equipe')).not.toBeInTheDocument();

    const sendButton = screen.getByRole('button', { name: 'Enviar' });
    expect(sendButton).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Escreva um comentário sobre este post'), {
      target: { value: '  Perfeito, obrigado  ' },
    });
    expect(sendButton).toBeEnabled();
    fireEvent.click(sendButton);

    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledWith('tok', 7, 'mensagem', 'Perfeito, obrigado'));
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
    expect(onCommentSent).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText('Escreva um comentário sobre este post')).toHaveValue('');
  });

  it('keeps the draft and shows an error when sending fails', async () => {
    mockedFetch.mockResolvedValue({ events: [], approvals: [] });
    mockedSubmit.mockRejectedValue(new Error('Escreva um comentário.'));
    render(<PostHistoryPanel post={makePost()} token="tok" approvals={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Histórico e comentários/ }));
    await screen.findByRole('tab', { name: 'Comentários' });
    fireEvent.click(screen.getByRole('tab', { name: 'Comentários' }));
    fireEvent.change(screen.getByPlaceholderText('Escreva um comentário sobre este post'), {
      target: { value: 'oi' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Não foi possível enviar o comentário.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Escreva um comentário sobre este post')).toHaveValue('oi');
  });
});

describe('TextDiff', () => {
  it('renders deletions as <del> and insertions as <ins>', () => {
    const { container } = render(<TextDiff before="bom dia time" after="boa tarde time" />);
    expect(container.querySelector('del')?.textContent).toContain('bom');
    expect(container.querySelector('ins')?.textContent).toContain('boa');
    expect(container.textContent).toContain(' time');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run test -- apps/hub/src/components/__tests__/PostHistoryPanel.test.tsx`
Expected: `Failed to resolve import "../PostHistoryPanel"`.

- [ ] **Step 3: Implement the component**

Create `apps/hub/src/components/PostHistoryPanel.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { computeWordDiff } from '@mesaas/text-diff';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { fetchPostHistory, submitApproval } from '../api';
import {
  buildHistoryEntries,
  computePostKpis,
  formatDuration,
  selectComments,
  type HistoryEntry,
} from '../lib/postHistory';
import { getClientStatusLabel, VISIBLE_STATUSES } from '../lib/postView';
import { formatDate } from './PostCard';
import type { HubPost, PostApproval, PostHistoryResponse } from '../types';

interface PostHistoryPanelProps {
  post: HubPost;
  token: string;
  approvals: PostApproval[];
  onCommentSent?: () => void;
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: PostHistoryResponse };

export function TextDiff({ before, after }: { before: string; after: string }) {
  const segments = useMemo(() => computeWordDiff(before, after), [before, after]);
  return (
    <p className="text-[12px] leading-relaxed whitespace-pre-wrap hub-tx2">
      {segments.map((segment, i) =>
        segment.type === 'delete' ? (
          <del key={i} className="bg-rose-50 text-rose-700 no-underline line-through">
            {segment.text}
          </del>
        ) : segment.type === 'insert' ? (
          <ins key={i} className="bg-emerald-50 text-emerald-800 no-underline">
            {segment.text}
          </ins>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </p>
  );
}

export function PostHistoryPanel({ post, token, approvals, onCommentSent }: PostHistoryPanelProps) {
  const { t, i18n } = useTranslation('hubPosts');
  const dateLang = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'history' | 'comments'>('history');
  const [load, setLoad] = useState<LoadState>({ status: 'idle' });
  const [reloadKey, setReloadKey] = useState(0);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [openDiffs, setOpenDiffs] = useState<Set<string>>(new Set());
  useUnsavedWork(text.trim() !== '' || sending);

  const visible = VISIBLE_STATUSES.has(post.status);

  useEffect(() => {
    if (!open || !visible) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    fetchPostHistory(token, post.id)
      .then((data) => {
        if (!cancelled) setLoad({ status: 'ready', data });
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [open, visible, token, post.id, reloadKey]);

  if (!visible) return null;

  const mine = approvals.filter((a) => a.post_id === post.id);
  const decisionCount = mine.filter((a) => a.action !== 'mensagem').length;
  // Same rule as hub-post-history/selectComments: team notes are never counted.
  const commentCount = mine.filter((a) => a.action === 'mensagem' && !a.is_workspace_user).length;

  async function handleSend() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(false);
    try {
      await submitApproval(token, post.id, 'mensagem', body);
      setText('');
      setReloadKey((k) => k + 1);
      onCommentSent?.();
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  }

  function toggleDiff(key: string) {
    setOpenDiffs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function actorLabel(source: 'client' | 'team' | 'system' | boolean): string {
    if (source === 'client' || source === false) return t('history.actor.you', 'Você');
    if (source === 'system') return t('history.actor.system', 'Sistema');
    return t('history.actor.team', 'Equipe');
  }

  function renderEntry(entry: HistoryEntry) {
    const when = formatDate(entry.at, dateLang);
    if (entry.kind === 'send') {
      return (
        <li key={entry.key} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12px] font-semibold hub-txt">
              {t('history.sentVersion', 'v{{version}}: enviado para aprovação', {
                version: entry.version,
              })}
            </span>
            <span className="text-[11px] hub-tx3">{when}</span>
          </div>
          <span className="text-[11px] hub-tx3">{actorLabel('team')}</span>
          {entry.diff && (
            <div>
              <button
                type="button"
                onClick={() => toggleDiff(entry.key)}
                className="text-[11px] font-semibold underline-offset-2 hover:underline"
                style={{ color: 'var(--hub-acc)' }}
              >
                {openDiffs.has(entry.key)
                  ? t('history.hideDiff', 'Ocultar alterações')
                  : t('history.showDiff', 'Ver alterações na legenda')}
              </button>
              {openDiffs.has(entry.key) && (
                <TextDiff before={entry.diff.before} after={entry.diff.after} />
              )}
            </div>
          )}
        </li>
      );
    }
    if (entry.kind === 'approval') {
      return (
        <li key={entry.key} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={`text-[12px] font-semibold ${entry.action === 'aprovado' ? 'text-emerald-700' : 'text-rose-700'}`}
            >
              {entry.action === 'aprovado'
                ? t('history.approved', 'Aprovado')
                : t('history.correctionRequested', 'Correção solicitada')}
            </span>
            <span className="text-[11px] hub-tx3">{when}</span>
          </div>
          <span className="text-[11px] hub-tx3">{actorLabel(entry.byTeam)}</span>
          {entry.motivo && (
            <p className="text-[11px] hub-tx2">
              {t('history.motivoLabel', 'Motivo')}:{' '}
              {t(`correctionReason.${entry.motivo}`, entry.motivo)}
            </p>
          )}
          {entry.comentario && (
            <p className="text-[12px] hub-tx2 whitespace-pre-wrap">{entry.comentario}</p>
          )}
        </li>
      );
    }
    return (
      <li key={entry.key} className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12px] font-semibold hub-txt">
            {getClientStatusLabel(t, entry.to_status)}
          </span>
          <span className="text-[11px] hub-tx3">{when}</span>
        </div>
        <span className="text-[11px] hub-tx3">{actorLabel(entry.source)}</span>
      </li>
    );
  }

  const data = load.status === 'ready' ? load.data : null;
  const entries = data ? buildHistoryEntries(data) : [];
  const comments = data ? selectComments(data) : [];
  const kpis = data ? computePostKpis(data) : null;

  return (
    <div className="border-t hub-border px-4 py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 py-1.5 text-left"
      >
        <span className="text-[12px] font-semibold hub-txt">
          {t('history.toggle', 'Histórico e comentários')}
        </span>
        <span className="flex items-center gap-2 text-[11px] hub-tx3">
          {t('history.summary', '{{decisions}} decisões · {{comments}} comentários', {
            decisions: decisionCount,
            comments: commentCount,
          })}
          <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <div className="pb-2 space-y-3">
          <div role="tablist" className="flex gap-1 border-b hub-border">
            {(['history', 'comments'] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className="px-3 py-1.5 text-[12px] font-semibold border-b-2 -mb-px"
                style={
                  tab === key
                    ? { borderColor: 'var(--hub-acc)', color: 'var(--hub-txt)' }
                    : { borderColor: 'transparent', color: 'var(--hub-tx3)' }
                }
              >
                {key === 'history'
                  ? t('history.tabHistory', 'Histórico')
                  : t('history.tabComments', 'Comentários')}
              </button>
            ))}
          </div>

          {load.status === 'loading' && (
            <p className="text-[12px] hub-tx3">{t('history.loading', 'Carregando histórico...')}</p>
          )}
          {load.status === 'error' && (
            <p className="text-[12px] text-rose-700">
              {t('history.loadError', 'Não foi possível carregar o histórico.')}
            </p>
          )}

          {data && tab === 'history' && (
            <div className="space-y-3">
              {kpis && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] hub-tx2">
                  <span>
                    {t('history.kpi.rounds', '{{count}} rodada(s) de correção', {
                      count: kpis.rounds,
                    })}
                  </span>
                  <span>
                    {kpis.avgResponseMs === null
                      ? t('history.kpi.noData', 'Tempo médio de resposta: sem dados ainda')
                      : t('history.kpi.avgResponse', 'Tempo médio de resposta: {{value}}', {
                          value: formatDuration(kpis.avgResponseMs),
                        })}
                  </span>
                </div>
              )}
              {entries.length === 0 ? (
                <p className="text-[12px] hub-tx3">
                  {t('history.empty', 'Nenhum evento registrado ainda.')}
                </p>
              ) : (
                <ol className="space-y-3">{entries.map(renderEntry)}</ol>
              )}
            </div>
          )}

          {data && tab === 'comments' && (
            <div className="space-y-3">
              {comments.length === 0 ? (
                <p className="text-[12px] hub-tx3">
                  {t('history.emptyComments', 'Nenhum comentário ainda. Escreva o primeiro.')}
                </p>
              ) : (
                <ol className="space-y-3">
                  {comments.map((c) => (
                    <li key={c.id} className="space-y-0.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[11px] font-semibold hub-tx3">
                          {actorLabel(c.is_workspace_user)}
                        </span>
                        <span className="text-[11px] hub-tx3">{formatDate(c.created_at, dateLang)}</span>
                      </div>
                      <p className="text-[12px] hub-tx2 whitespace-pre-wrap">{c.comentario}</p>
                    </li>
                  ))}
                </ol>
              )}
              <div className="space-y-1.5">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={4000}
                  placeholder={t('history.composerPlaceholder', 'Escreva um comentário sobre este post')}
                  className="hub-focus-accent w-full rounded border hub-border px-3 py-2 text-[12px] resize-none min-h-[60px] hub-bg-card hub-txt placeholder:text-[var(--hub-tx3)] focus:outline-none"
                />
                {sendError && (
                  <p className="text-[11px] text-rose-700">
                    {t('history.sendError', 'Não foi possível enviar o comentário.')}
                  </p>
                )}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={sending || text.trim() === ''}
                    className="hub-btn-primary rounded px-4 py-2 min-h-[36px] text-[12px] font-semibold disabled:opacity-50"
                  >
                    {sending ? t('history.sending', 'Enviando...') : t('history.send', 'Enviar')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

Note on `actorLabel(entry.byTeam)`: `byTeam === false` and `source === 'client'` both mean the client, rendered as "Você"; `true` falls through to "Equipe".

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm run test -- apps/hub/src/components/__tests__/PostHistoryPanel.test.tsx && npx tsc -p apps/hub/tsconfig.json --noEmit && npm run lint`
Expected: 8 tests pass (the KPI assertion "2 h": send 1 → correction 10 at +2h is the only sample; rounds = approval 10 + team event 4 = 2); typecheck and lint clean. If lint flags the unused `_id` destructure in `postHistory.ts`, keep it (the repo's eslint config ignores `^_`).

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components/PostHistoryPanel.tsx apps/hub/src/components/__tests__/PostHistoryPanel.test.tsx
git commit -m "feat(hub): PostHistoryPanel with Histórico/Comentários tabs, KPIs and caption diff

Loads hub-post-history only when expanded; composer posts a trimmed
mensagem through hub-approve and refetches.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Wire chips + panel into `TextPostCard`

**Files:**
- Modify: `apps/hub/src/components/TextPostCard.tsx`
- Modify: `apps/hub/src/components/__tests__/TextPostCard.test.tsx`

**Interfaces:**
- Consumes: `CorrectionReasonChips` (Task 9), `PostHistoryPanel` (Task 10), `submitApproval(token, post_id, action, comentario?, motivo?)` (Task 6), `CorrectionReason` type.
- Produces: unchanged props `{ post, token, approvals, onApprovalSubmitted?, readOnly? }`. Behaviour: chips rendered inside the approval block above the buttons; "Solicitar correção" is disabled until both a trimmed comment and a motivo exist; `handleAction('correcao')` calls `submitApproval(token, post.id, 'correcao', comentario, motivo)`; `handleAction('aprovado')` keeps the 4-argument call (existing test asserts `toHaveBeenCalledWith('token-publico', 10, 'aprovado', undefined)` shape); `<PostHistoryPanel>` is rendered at the end of the expanded section for every visible status, with `onCommentSent={onApprovalSubmitted}`.

- [ ] **Step 1: Write the failing tests**

In `apps/hub/src/components/__tests__/TextPostCard.test.tsx` add a mock for the panel and the history API next to the existing `vi.mock('../../api', ...)` (line 9-11). Replace that mock with:

```tsx
vi.mock('../../api', () => ({
  submitApproval: submitApprovalMock,
  fetchPostHistory: vi.fn().mockResolvedValue({ events: [], approvals: [] }),
}));
```

Then append inside `describe('TextPostCard', ...)`:

```tsx
  it('requires a motivo chip before "Solicitar correção" is enabled and sends it', async () => {
    mockedSubmitApproval.mockResolvedValue({ ok: true });
    render(
      <TextPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        onApprovalSubmitted={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Texto motivacional segunda-feira'));

    const correctionButton = screen.getByRole('button', { name: /Solicitar correção/i });
    fireEvent.change(screen.getByPlaceholderText(/Comente aqui/), {
      target: { value: 'Trocar a data' },
    });
    expect(correctionButton).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Data' }));
    expect(correctionButton).toBeEnabled();
    fireEvent.click(correctionButton);

    await waitFor(() =>
      expect(mockedSubmitApproval).toHaveBeenCalledWith(
        'token-publico',
        10,
        'correcao',
        'Trocar a data',
        'data',
      ),
    );
  });

  it('renders the history panel toggle when expanded, also in read-only mode', () => {
    render(<TextPostCard post={makePost({ status: 'postado' })} token="token-publico" approvals={[]} readOnly />);
    fireEvent.click(screen.getByText('Texto motivacional segunda-feira'));
    expect(screen.getByRole('button', { name: /Histórico e comentários/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aprovar/i })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run test -- apps/hub/src/components/__tests__/TextPostCard.test.tsx`
Expected: first new test fails (`correctionButton` is enabled after typing, no "Data" button); second fails (no history toggle). Existing tests still pass.

- [ ] **Step 3: Implement**

In `apps/hub/src/components/TextPostCard.tsx`:

Replace the imports on lines 5 and 10:

```tsx
import { submitApproval } from '../api';
```
```tsx
import type { HubPost, PostApproval } from '../types';
```
with:
```tsx
import { submitApproval } from '../api';
import { CorrectionReasonChips } from './CorrectionReasonChips';
import { PostHistoryPanel } from './PostHistoryPanel';
```
```tsx
import type { CorrectionReason, HubPost, PostApproval } from '../types';
```

After line 38 (`const [comentario, setComentario] = useState('');`) add:

```tsx
  const [motivo, setMotivo] = useState<CorrectionReason | null>(null);
```

Replace line 73:

```tsx
      await submitApproval(token, post.id, action, comentario || undefined);
```
with:
```tsx
      if (action === 'correcao') {
        await submitApproval(token, post.id, action, comentario.trim(), motivo ?? undefined);
      } else {
        await submitApproval(token, post.id, action, comentario || undefined);
      }
```

Inside the approval block, replace the `<div className="flex gap-2">` opening (line 265) and the Correção button (lines 276-290) as follows. Insert before `<div className="flex gap-2">`:

```tsx
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium hub-tx3">
                      {t('correctionReason.title', 'Motivo da correção')}
                    </p>
                    <CorrectionReasonChips
                      value={motivo}
                      onChange={setMotivo}
                      disabled={submitting || approvalBlocked}
                    />
                  </div>
```

and replace the Correção button with:

```tsx
                    <button
                      onClick={() => handleAction('correcao')}
                      disabled={submitting || approvalBlocked || !comentario.trim() || !motivo}
                      title={
                        !comentario.trim() || !motivo
                          ? t(
                              'correctionReason.required',
                              'Escolha o motivo e deixe um comentário para solicitar correção',
                            )
                          : undefined
                      }
                      className="flex-1 flex items-center justify-center gap-1.5 hub-btn-secondary rounded py-2.5 min-h-[44px] text-[13px] font-semibold disabled:opacity-50 transition-colors"
                    >
                      <AlertCircle size={14} /> {t('shared.correcaoLong', 'Solicitar correção')}
                    </button>
```

Finally, after the `{result && (...)}` block (line 297-303) and before the closing `</div>` of the expanded section (line 304), add:

```tsx
          <PostHistoryPanel
            post={post}
            token={token}
            approvals={approvals}
            onCommentSent={onApprovalSubmitted}
          />
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm run test -- apps/hub/src/components/__tests__/TextPostCard.test.tsx apps/hub/src/pages/__tests__/postagemFocoPage.test.tsx && npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: all pass (the foco page mounts the real cards; the panel only touches `fetchPostHistory` after a click, so its `vi.mock('../../api', () => ({ fetchPosts: vi.fn() }))` stays valid).

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components/TextPostCard.tsx apps/hub/src/components/__tests__/TextPostCard.test.tsx
git commit -m "feat(hub): TextPostCard gets correction reason chips and the history panel

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Wire chips + panel into `StoryPostCard`

**Files:**
- Modify: `apps/hub/src/components/StoryPostCard.tsx`
- Modify: `apps/hub/src/components/__tests__/StoryPostCard.test.tsx`

**Interfaces:**
- Consumes: `CorrectionReasonChips` (Task 9), `PostHistoryPanel` (Task 10), `submitApproval(token, post_id, action, comentario?, motivo?)` (Task 6), `CorrectionReason` type from `apps/hub/src/types.ts`.
- Produces: unchanged props. Chips inside the approval section (lines 340-387), motivo sent on `correcao`, panel rendered after the `{result && (...)}` block and before the lightbox (line 401).

- [ ] **Step 1: Write the failing tests**

In `apps/hub/src/components/__tests__/StoryPostCard.test.tsx`, replace lines 1-8:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StoryPostCard } from '../StoryPostCard';
import type { HubPost, HubPostMedia, InstagramProfile } from '../../types';

vi.mock('../../api', () => ({
  submitApproval: vi.fn(),
}));
```

with:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StoryPostCard } from '../StoryPostCard';
import { submitApproval } from '../../api';
import type { HubPost, HubPostMedia, InstagramProfile } from '../../types';

const submitApprovalMock = vi.hoisted(() => vi.fn());

vi.mock('../../api', () => ({
  submitApproval: submitApprovalMock,
  fetchPostHistory: vi.fn().mockResolvedValue({ events: [], approvals: [] }),
}));

const mockedSubmitApproval = vi.mocked(submitApproval);
```

Add `beforeEach(() => { mockedSubmitApproval.mockReset(); });` as the first statement inside `describe('StoryPostCard', ...)`, then append inside that `describe`:

```tsx
  it('requires a motivo chip before "Correção" is enabled and sends it', async () => {
    mockedSubmitApproval.mockResolvedValue({ ok: true });
    render(
      <StoryPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        instagramProfile={null}
        workspaceName="Mesaas"
        onApprovalSubmitted={vi.fn()}
      />,
    );
    const correctionButton = screen.getByRole('button', { name: /Correção/ });
    fireEvent.change(screen.getByPlaceholderText(/Comente aqui/), {
      target: { value: 'Trocar a imagem' },
    });
    expect(correctionButton).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Imagem/vídeo' }));
    expect(correctionButton).toBeEnabled();
    fireEvent.click(correctionButton);
    await waitFor(() =>
      expect(mockedSubmitApproval).toHaveBeenCalledWith(
        'token-publico',
        7,
        'correcao',
        'Trocar a imagem',
        'imagem_video',
      ),
    );
  });

  it('renders the history panel toggle in read-only mode', () => {
    render(
      <StoryPostCard
        post={makePost({ status: 'aprovado_cliente' })}
        token="token-publico"
        approvals={[]}
        instagramProfile={null}
        workspaceName="Mesaas"
        readOnly
      />,
    );
    expect(screen.getByRole('button', { name: /Histórico e comentários/ })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run test -- apps/hub/src/components/__tests__/StoryPostCard.test.tsx`
Expected: both new tests fail (no chip, no toggle).

- [ ] **Step 3: Implement**

In `apps/hub/src/components/StoryPostCard.tsx`:

Replace lines 5 and 11:

```tsx
import { submitApproval } from '../api';
```
```tsx
import type { HubPost, PostApproval, InstagramProfile } from '../types';
```
with:
```tsx
import { submitApproval } from '../api';
import { CorrectionReasonChips } from './CorrectionReasonChips';
import { PostHistoryPanel } from './PostHistoryPanel';
```
```tsx
import type { CorrectionReason, HubPost, PostApproval, InstagramProfile } from '../types';
```

After line 35 (`const [comentario, setComentario] = useState('');`) add:

```tsx
  const [motivo, setMotivo] = useState<CorrectionReason | null>(null);
```

Replace line 83:

```tsx
      await submitApproval(token, post.id, action, comentario || undefined);
```
with:
```tsx
      if (action === 'correcao') {
        await submitApproval(token, post.id, action, comentario.trim(), motivo ?? undefined);
      } else {
        await submitApproval(token, post.id, action, comentario || undefined);
      }
```

Insert before `<div className="flex gap-1.5">` (line 357):

```tsx
              <CorrectionReasonChips
                value={motivo}
                onChange={setMotivo}
                disabled={submitting || approvalBlocked}
              />
```

Replace the Correção button (lines 368-382) with:

```tsx
                <button
                  onClick={() => handleAction('correcao')}
                  disabled={submitting || approvalBlocked || !comentario.trim() || !motivo}
                  title={
                    !comentario.trim() || !motivo
                      ? t(
                          'correctionReason.required',
                          'Escolha o motivo e deixe um comentário para solicitar correção',
                        )
                      : undefined
                  }
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 min-h-[44px] rounded-[4px] hub-btn-secondary text-[13px] font-medium disabled:opacity-50 transition-colors"
                >
                  <AlertCircle size={16} /> {t('shared.correcaoShort', 'Correção')}
                </button>
```

Insert right before `{lightboxIdx !== null && media.length > 0 && (` (line 401):

```tsx
      <div className="bg-white dark:bg-[#1a1a1a] rounded-b-2xl -mt-2 pt-2 shadow-[0_1px_3px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.04)]">
        <PostHistoryPanel
          post={post}
          token={token}
          approvals={approvals}
          onCommentSent={onApprovalSubmitted}
        />
      </div>
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm run test -- apps/hub/src/components/__tests__/StoryPostCard.test.tsx && npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components/StoryPostCard.tsx apps/hub/src/components/__tests__/StoryPostCard.test.tsx
git commit -m "feat(hub): StoryPostCard gets correction reason chips and the history panel

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Wire chips + panel into `InstagramPostCard`

**Files:**
- Modify: `apps/hub/src/components/InstagramPostCard.tsx`
- Modify: `apps/hub/src/components/__tests__/InstagramPostCard.test.tsx`

**Interfaces:**
- Consumes: `CorrectionReasonChips` (Task 9), `PostHistoryPanel` (Task 10), `submitApproval(token, post_id, action, comentario?, motivo?)` (Task 6), `CorrectionReason` type from `apps/hub/src/types.ts`.
- Produces: unchanged props. Chips inside the approval block (lines 708-753), motivo on `correcao`, panel rendered after the `{result && (...)}` block (line 834) and before the lightbox (line 836). The existing test `'submits an approval when Aprovar is clicked'` (line 145) asserting `toHaveBeenCalledWith('token-publico', 7, 'aprovado', undefined)` must keep passing unchanged.

- [ ] **Step 1: Write the failing tests**

In `apps/hub/src/components/__tests__/InstagramPostCard.test.tsx`, replace the `vi.mock('../../api', ...)` (lines 9-11) with:

```tsx
vi.mock('../../api', () => ({
  submitApproval: submitApprovalMock,
  fetchPostHistory: vi.fn().mockResolvedValue({ events: [], approvals: [] }),
}));
```

Append inside `describe('InstagramPostCard', ...)`:

```tsx
  it('requires a motivo chip before "Correção" is enabled and sends it', async () => {
    mockedSubmitApproval.mockResolvedValue({ ok: true });
    render(
      <InstagramPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        onApprovalSubmitted={vi.fn()}
      />,
    );
    const correctionButton = screen.getByRole('button', { name: /Correção/ });
    fireEvent.change(screen.getByPlaceholderText(/Comente aqui/), {
      target: { value: 'Ajustar legenda' },
    });
    expect(correctionButton).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Legenda' }));
    expect(correctionButton).toBeEnabled();
    fireEvent.click(correctionButton);
    await waitFor(() =>
      expect(mockedSubmitApproval).toHaveBeenCalledWith(
        'token-publico',
        7,
        'correcao',
        'Ajustar legenda',
        'legenda',
      ),
    );
  });

  it('renders the history panel toggle in read-only mode', () => {
    render(
      <InstagramPostCard
        post={makePost({ status: 'agendado' })}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        readOnly
      />,
    );
    expect(screen.getByRole('button', { name: /Histórico e comentários/ })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run test -- apps/hub/src/components/__tests__/InstagramPostCard.test.tsx`
Expected: both new tests fail; the rest pass.

- [ ] **Step 3: Implement**

In `apps/hub/src/components/InstagramPostCard.tsx`:

Replace lines 5 and 11:

```tsx
import { submitApproval } from '../api';
```
```tsx
import type { HubPost, PostApproval, InstagramProfile } from '../types';
```
with:
```tsx
import { submitApproval } from '../api';
import { CorrectionReasonChips } from './CorrectionReasonChips';
import { PostHistoryPanel } from './PostHistoryPanel';
```
```tsx
import type { CorrectionReason, HubPost, PostApproval, InstagramProfile } from '../types';
```

After line 62 (`const [comentario, setComentario] = useState('');`) add:

```tsx
  const [motivo, setMotivo] = useState<CorrectionReason | null>(null);
```

Replace line 225:

```tsx
      const res = await submitApproval(token, post.id, action, comentario || undefined);
```
with:
```tsx
      const res =
        action === 'correcao'
          ? await submitApproval(token, post.id, action, comentario.trim(), motivo ?? undefined)
          : await submitApproval(token, post.id, action, comentario || undefined);
```

Insert before `<div className="flex gap-1.5">` (line 725):

```tsx
              <CorrectionReasonChips
                value={motivo}
                onChange={setMotivo}
                disabled={submitting || approvalBlocked}
              />
```

Replace the Correção button (lines 736-750) with:

```tsx
                <button
                  onClick={() => handleAction('correcao')}
                  disabled={submitting || approvalBlocked || !comentario.trim() || !motivo}
                  title={
                    !comentario.trim() || !motivo
                      ? t(
                          'correctionReason.required',
                          'Escolha o motivo e deixe um comentário para solicitar correção',
                        )
                      : undefined
                  }
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 min-h-[44px] rounded-[4px] hub-btn-secondary text-[13px] font-medium disabled:opacity-50 transition-colors"
                >
                  <AlertCircle size={16} /> {t('shared.correcaoShort', 'Correção')}
                </button>
```

Insert after the `{result && (...)}` block (after line 834) and before `{lightboxIdx !== null && media.length > 0 && (`:

```tsx
      <PostHistoryPanel
        post={post}
        token={token}
        approvals={approvals}
        onCommentSent={onApprovalSubmitted}
      />
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm run test -- apps/hub/src/components && npx tsc -p apps/hub/tsconfig.json --noEmit && npm run lint`
Expected: every component suite passes (including the untouched `'submits an approval when Aprovar is clicked'`); typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components/InstagramPostCard.tsx apps/hub/src/components/__tests__/InstagramPostCard.test.tsx
git commit -m "feat(hub): InstagramPostCard gets correction reason chips and the history panel

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Status filter chips on Postagens

**Files:**
- Create: `apps/hub/src/components/StatusFilterChips.tsx`
- Create: `apps/hub/src/components/__tests__/StatusFilterChips.test.tsx`
- Modify: `apps/hub/src/pages/PostagensPage.tsx`
- Modify: `apps/hub/src/pages/__tests__/aprovacoesPostagensFeatures.test.tsx`

**Interfaces:**
- Consumes: `getClientStatusLabel(t, status)` from `apps/hub/src/lib/postView.ts:46` (labels come from `hubPostCard:status.*`, so "Correção solicitada" for `correcao_cliente`); `hubPosts:postagens.filter.*` (Task 8).
- Produces:

```ts
export type StatusFilter = 'all' | 'enviado_cliente' | 'correcao_cliente' | 'aprovado_cliente';
export const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'enviado_cliente', 'correcao_cliente', 'aprovado_cliente'];
export function StatusFilterChips(props: {
  value: StatusFilter;
  counts: Record<StatusFilter, number>;
  onChange: (value: StatusFilter) => void;
}): JSX.Element;
```

  `<div role="group" aria-label="Filtrar por status">` with one `<button type="button" aria-pressed>` per filter, accessible name `"<label> (<count>)"`. In `PostagensPage`, the filter is applied to `allPosts` *before* grouping (so a group with no matching post disappears), counts are always computed from the unfiltered visible posts, and `'all'` is the default. Aprovações is untouched.

- [ ] **Step 1: Write the failing tests**

Create `apps/hub/src/components/__tests__/StatusFilterChips.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatusFilterChips } from '../StatusFilterChips';

describe('StatusFilterChips', () => {
  it('renders Todos plus the three client statuses with live counts and reports clicks', () => {
    const onChange = vi.fn();
    render(
      <StatusFilterChips
        value="all"
        counts={{ all: 6, enviado_cliente: 2, correcao_cliente: 1, aprovado_cliente: 3 }}
        onChange={onChange}
      />,
    );
    const group = screen.getByRole('group', { name: 'Filtrar por status' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Todos (6)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Aguardando aprovação (2)' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Correção solicitada (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aprovado (3)' })).toBeInTheDocument();
    expect(screen.queryByText(/Rejeitado/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Correção solicitada (1)' }));
    expect(onChange).toHaveBeenCalledWith('correcao_cliente');
  });
});
```

In `apps/hub/src/pages/__tests__/aprovacoesPostagensFeatures.test.tsx`, append a new describe block at the end of the file:

```tsx
describe('PostagensPage — status filter chips', () => {
  beforeEach(() => {
    mockedFetchPosts.mockReset();
    mockedFetchInstagramFeed.mockReset();
  });

  it('shows live counts, filters the cards, hides empty groups and keeps counts from the unfiltered list', async () => {
    mockedFetchPosts.mockResolvedValue(
      makeResponse({
        posts: [
          makePost({ id: 1, titulo: 'Pendente A', status: 'enviado_cliente', workflow_id: 1, workflow_titulo: 'Editorial' }),
          makePost({ id: 2, titulo: 'Corrigir B', status: 'correcao_cliente', workflow_id: 1, workflow_titulo: 'Editorial' }),
          makePost({ id: 3, titulo: 'Aprovado C', status: 'aprovado_cliente', workflow_id: 2, workflow_titulo: 'Campanha' }),
          makePost({ id: 4, titulo: 'Publicado D', status: 'postado', workflow_id: 2, workflow_titulo: 'Campanha' }),
          makePost({ id: 5, titulo: 'Rascunho E', status: 'rascunho', workflow_id: 2, workflow_titulo: 'Campanha' }),
        ],
      }),
    );

    renderHubPage(POSTAGENS_PATH, POSTAGENS_ROUTE, <PostagensPage />);
    await screen.findByText('Pendente A');

    expect(screen.getByRole('button', { name: 'Todos (4)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Aguardando aprovação (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Correção solicitada (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aprovado (1)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Aprovado (1)' }));
    expect(screen.getByText('Aprovado C')).toBeInTheDocument();
    expect(screen.queryByText('Pendente A')).not.toBeInTheDocument();
    expect(screen.queryByText('Publicado D')).not.toBeInTheDocument();
    expect(screen.queryByText('Editorial')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Todos (4)' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Todos (4)' }));
    expect(screen.getByText('Pendente A')).toBeInTheDocument();
    expect(screen.getByText('Publicado D')).toBeInTheDocument();
  });

  it('does not render the filter chips on AprovacoesPage', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({ posts: [makePost({ id: 1, titulo: 'Pendente A' })] }));
    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);
    await screen.findByText('Pendente A');
    expect(screen.queryByRole('group', { name: 'Filtrar por status' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run test -- apps/hub/src/components/__tests__/StatusFilterChips.test.tsx apps/hub/src/pages/__tests__/aprovacoesPostagensFeatures.test.tsx`
Expected: the chips test fails on import; the page test's first case fails (no `Todos (4)` button); the Aprovações case already passes.

- [ ] **Step 3: Implement the component and wire the page**

Create `apps/hub/src/components/StatusFilterChips.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { getClientStatusLabel } from '../lib/postView';

export type StatusFilter = 'all' | 'enviado_cliente' | 'correcao_cliente' | 'aprovado_cliente';

export const STATUS_FILTERS: readonly StatusFilter[] = [
  'all',
  'enviado_cliente',
  'correcao_cliente',
  'aprovado_cliente',
];

interface StatusFilterChipsProps {
  value: StatusFilter;
  counts: Record<StatusFilter, number>;
  onChange: (value: StatusFilter) => void;
}

/** Postagens-only status filter. Labels reuse the client status labels (spec: "Correção solicitada", never "Rejeitado"). */
export function StatusFilterChips({ value, counts, onChange }: StatusFilterChipsProps) {
  const { t } = useTranslation('hubPosts');
  return (
    <div
      role="group"
      aria-label={t('postagens.filter.label', 'Filtrar por status')}
      className="flex flex-wrap gap-1.5 mb-6"
    >
      {STATUS_FILTERS.map((filter) => {
        const selected = value === filter;
        const label =
          filter === 'all' ? t('postagens.filter.all', 'Todos') : getClientStatusLabel(t, filter);
        return (
          <button
            key={filter}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(filter)}
            className="rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors"
            style={
              selected
                ? { background: 'var(--hub-acc)', color: 'var(--hub-acc-fg)', borderColor: 'var(--hub-acc)' }
                : { color: 'var(--hub-tx2)', borderColor: 'var(--hub-bd)' }
            }
          >
            {label} ({counts[filter]})
          </button>
        );
      })}
    </div>
  );
}
```

In `apps/hub/src/pages/PostagensPage.tsx`:

After line 17 (`import { OpenPostLink } from '../components/OpenPostLink';`) add:

```tsx
import { StatusFilterChips, type StatusFilter } from '../components/StatusFilterChips';
```

After line 88 (`const [showGrid, setShowGrid] = useState(false);`) add:

```tsx
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
```

Replace line 100:

```tsx
  const allPosts = (data?.posts ?? []).filter((p) => VISIBLE_STATUSES.has(p.status));
```
with:
```tsx
  const visiblePosts = (data?.posts ?? []).filter((p) => VISIBLE_STATUSES.has(p.status));
  const filterCounts: Record<StatusFilter, number> = {
    all: visiblePosts.length,
    enviado_cliente: visiblePosts.filter((p) => p.status === 'enviado_cliente').length,
    correcao_cliente: visiblePosts.filter((p) => p.status === 'correcao_cliente').length,
    aprovado_cliente: visiblePosts.filter((p) => p.status === 'aprovado_cliente').length,
  };
  // Filter before grouping so a fluxo with no matching post disappears with its header.
  const allPosts =
    statusFilter === 'all' ? visiblePosts : visiblePosts.filter((p) => p.status === statusFilter);
```

In the JSX, replace the `groups.length === 0` branch and its guard (lines 238-243):

```tsx
      ) : groups.length === 0 ? (
        <p className="text-sm hub-tx2">
          {t('postagens.empty', 'Nenhuma postagem disponível ainda.')}
        </p>
      ) : (
        <div className="space-y-10">
```
with:
```tsx
      ) : visiblePosts.length === 0 ? (
        <p className="text-sm hub-tx2">
          {t('postagens.empty', 'Nenhuma postagem disponível ainda.')}
        </p>
      ) : (
        <div className="space-y-10">
          <StatusFilterChips value={statusFilter} counts={filterCounts} onChange={setStatusFilter} />
```

(`groups` is empty when the filter matches nothing; the chips stay visible so the client can switch back, and the `space-y-10` container simply renders only the chips.)

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm run test -- apps/hub/src/components/__tests__/StatusFilterChips.test.tsx apps/hub/src/pages && npx tsc -p apps/hub/tsconfig.json --noEmit && npm run lint`
Expected: all page suites pass (existing Postagens tests are unaffected because `'all'` is the default and the chips add only buttons whose names end in `(n)`); typecheck and lint clean. Note `feedSelectable`/`selectedPosts` (lines 111-124) keep using `allPosts`/`data.posts`, so the feed preview follows the active filter, which is the intended behaviour.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components/StatusFilterChips.tsx apps/hub/src/components/__tests__/StatusFilterChips.test.tsx apps/hub/src/pages/PostagensPage.tsx apps/hub/src/pages/__tests__/aprovacoesPostagensFeatures.test.tsx
git commit -m "feat(hub): status filter chips with live counts on Postagens

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Full verification, staging rollout, PR, production rollout

**Files:**
- No new source files. Touches remote state only (staging/production Supabase) and opens the PR.

**Interfaces:**
- Consumes: everything above; project refs from `supabase/.temp/project-ref` (staging `wlyzhyfondykzpsiqsce`, production `skjzpekeqefvlojenfsw`).
- Produces: migrations applied and both functions deployed on staging, PR open, then production applied before merge.

- [ ] **Step 1: Run the complete local gate**

```bash
npm run format && npm run lint && npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run check:functions
npm run test:functions
npm run test:db
grep -rn "correcao\|Correção" e2e/
git status --short
```

Expected: every command exits 0; the `grep` over `e2e/` prints nothing (at the time of writing no Playwright spec drives the correction flow; if one now does, it must click a motivo chip before "Solicitar correção" and that change belongs in this PR); `git status` shows only the prettier reformatting of files already in this branch (commit those with `git commit -am "style: prettier" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"` if any). If `npm run test:functions` dirtied `deno.lock` or `node_modules`, run `git checkout deno.lock && npm ci`.

- [ ] **Step 2: Confirm the migration prefixes still lead main**

```bash
git fetch origin main
git ls-tree --name-only origin/main supabase/migrations/ | sort | tail -1
ls supabase/migrations | sort | tail -3
```

Expected: main's tail is `20260923000008_post_content_versions_baseline_same_update.sql` or lower than `20260925000010`. If main now has a `20260924*` file, rename both new migrations (and the references inside their header comments, the SQL test header comment and this plan) to the next free `202609240000NN` prefixes and amend the two migration commits.

- [ ] **Step 3: Staging rollout (migration first, then functions)**

`link` reads the CLI token from the "Supabase CLI" keychain entry and needs no DB password; `< /dev/null` skips the interactive prompt. `db push`/`db query` do not accept `--linked` together with `--project-ref`, so link first, then use `--linked`.

```bash
npx supabase link --project-ref wlyzhyfondykzpsiqsce < /dev/null
npx supabase migration list --linked
npx supabase db push --linked
npx supabase functions deploy hub-post-history --project-ref wlyzhyfondykzpsiqsce --use-api --no-verify-jwt
npx supabase functions deploy hub-posts --project-ref wlyzhyfondykzpsiqsce --use-api --no-verify-jwt
npx supabase functions deploy hub-approve --project-ref wlyzhyfondykzpsiqsce --use-api --no-verify-jwt
```

Expected: `migration list` shows no remote-only versions (if it does, see `db push` refusal handling in the staging ops memory: apply out of band with `db query --linked --file`); `db push` lists exactly `20260925000010` and `20260925000011`; the three deploys succeed. Staging deploys `hub-approve` right away because no client is on the staging bundle; production (Step 5) deploys it after the merge. Smoke on staging (`npm run dev:hub:staging`, requires `.env.staging` in this worktree): open a client hub token on Postagens, expand a card, open "Histórico e comentários", confirm the Histórico tab lists at least the sends/approvals, send a comment from the Comentários tab and see it appear; on Aprovações request a correction and confirm the button stays disabled until a motivo chip is picked. Verify in the DB that the new row has `motivo` set:

```bash
npx supabase db query --linked "select id, action, motivo, comentario from post_approvals order by id desc limit 3"
```

- [ ] **Step 4: Open the PR**

```bash
git push -u origin claude/post-approval-history-5938fa
gh pr create --base main --title "feat(hub): histórico de aprovação, comentários, motivo de correção e filtro de status" --body "$(cat <<'EOF'
## Summary
- Painel compartilhado "Histórico e comentários" nos três cards reais do Hub (Instagram, Story, Texto), com abas Histórico (aprovações/correções + eventos de status sem approval) e Comentários (mensagens + composer novo)
- KPIs por post (rodadas + tempo médio de resposta) com máquina de estados própria (casos a-d da spec)
- Diff da legenda entre envios consecutivos, via snapshot imutável gravado no evento `enviado_cliente`
- Tag de motivo obrigatória ao pedir correção (`post_approvals.motivo`, CHECK NOT VALID, `record_client_approval` substituída por assinatura única de 7 args)
- Filtro de status com contagem só em Postagens
- Nova function `hub-post-history` (autorização por token + posse do post, allowlist de status, piso temporal, DTO higienizado); `hub-approve` valida `mensagem` (texto + status visível) e `motivo`; `hub-posts` deixa de enviar mensagens internas da equipe em `postApprovals` (predicado compartilhado `_shared/hub-approvals.ts`)

Spec: docs/superpowers/specs/2026-09-17-post-approval-history-design.md
Plan: docs/superpowers/plans/2026-09-17-post-approval-history.md

## Deploy
Migrations 20260925000010/2 e as functions `hub-post-history` + `hub-posts` + `hub-approve` já estão em staging. Em produção, nesta ordem: `db push` + deploy de `hub-post-history` e `hub-posts` ANTES do merge (o bundle novo chama `hub-post-history`); merge; confirmar o bundle novo no ar; só então deploy de `hub-approve`. A `hub-approve` nova responde 400 ao bundle antigo (não manda `motivo`), enquanto a antiga aceita o bundle novo (ignora `motivo`, chamada de 6 args resolve na função de 7), então ela vai por último.

## Test plan
- [ ] `npm run test`, `npm run test:functions`, `npm run check:functions`, `npm run test:db`, lint, format, 4x tsc
- [ ] Staging: abrir painel em Postagens e Aprovações, enviar comentário, pedir correção com motivo, ver diff após reenvio com legenda alterada
- [ ] Produção: migrations + `hub-post-history` + `hub-posts` antes do merge; `hub-approve` depois do bundle novo estar no ar

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Read the external Codex review when it lands and address findings before merging.

- [ ] **Step 5: Production rollout: migrations + `hub-post-history`, merge, then `hub-approve`**

```bash
npx supabase link --project-ref skjzpekeqefvlojenfsw < /dev/null
npx supabase migration list --linked
npx supabase db push --linked
npx supabase db query --linked "select count(*) from pg_proc where proname = 'record_client_approval'"
npx supabase functions deploy hub-post-history --project-ref skjzpekeqefvlojenfsw --use-api --no-verify-jwt
npx supabase functions deploy hub-posts --project-ref skjzpekeqefvlojenfsw --use-api --no-verify-jwt
```

Expected: `db push` applies exactly the two migrations; the count query returns `1`; both deploys succeed (`hub-posts` only narrows `postApprovals`, which the old bundle reads with the same row shape). The old Hub bundle keeps working: it never calls `hub-post-history`, and its `hub-approve` still resolves the 6-argument RPC call against the 7-argument function.

Now merge the PR (`gh pr merge --squash`) and wait for Vercel to finish deploying. Confirm the new bundle is live by opening a client hub token on Postagens in production and seeing the "Histórico e comentários" toggle on a card. Only then:

```bash
npx supabase functions deploy hub-approve --project-ref skjzpekeqefvlojenfsw --use-api --no-verify-jwt
```

Expected: deploy succeeds. Between the merge and this deploy, a correction sent from the new bundle is stored with `motivo = null` (the old `hub-approve` ignores the field; the phase-1 CHECK allows null), which is why `hub-approve` goes last and why phase 3 creates its CHECK `NOT VALID`. Never deploy `hub-approve` before the bundle is live: the new function answers 400 "Informe o motivo da correção." to every correction from the old bundle. Once a correction with motivo has been recorded in production (`npx supabase db query --linked "select id, motivo from post_approvals where action = 'correcao' order by id desc limit 1"`), continue with Task 16 (phase 3).

---

### Task 16: Phase 3: make `motivo` mandatory on `correcao` (follow-up PR)

**Files:**
- Create: `supabase/migrations/20260925000012_post_approvals_motivo_required.sql`
- Modify: `supabase/tests/post_approval_history.sql` (append case C.1; rewrite case A.3)

**Interfaces:**
- Consumes: `post_approvals.motivo` and constraint `post_approvals_motivo_value_check` from Task 1; production state where `hub-approve` (Task 3) and the Hub bundle (Tasks 11-13) are live, verified in Task 15 Step 5.
- Produces: constraint `post_approvals_motivo_check` = `CHECK (action <> 'correcao' OR (motivo IS NOT NULL AND motivo IN ('legenda','imagem_video','data','outro'))) NOT VALID`; `post_approvals_motivo_value_check` dropped.

Start this task only after Task 15 is fully merged and live. Do it on a fresh branch off `origin/main`: `git fetch origin main && git checkout -b claude/post-approval-motivo-required origin/main`.

- [ ] **Step 1: Rewrite A.3 and append C.1 in the SQL test (failing)**

In `supabase/tests/post_approval_history.sql`, replace the A.3 block with:

```sql
-- A.3 (fase 3): correcao sem motivo viola o CHECK (23514)
begin;
do $$
declare f record; v_id bigint; v_state text;
begin
  select * into f from pg_temp.pah_fixture();
  begin
    select record_client_approval(f.post, 'tok', 'correcao', 'sem motivo', false, 'correcao_cliente') into v_id;
    v_state := 'none';
  exception when others then
    v_state := sqlstate;
  end;
  assert v_state = '23514', format('esperava check_violation, veio %s', v_state);
end $$;
rollback;
```

update the header comment line for A.3 to `--   A.3 fase 3: correcao sem motivo viola o CHECK (23514)`, and append at the end of the file:

```sql
-- C.1 insercao direta de correcao sem motivo tambem falha; constraint e NOT VALID; a permissiva da fase 1 sumiu
begin;
do $$
declare f record; v_state text;
begin
  select * into f from pg_temp.pah_fixture();
  begin
    insert into post_approvals (post_id, token, action, comentario, is_workspace_user, motivo)
      values (f.post, 'tok', 'correcao', 'direto', false, null);
    v_state := 'none';
  exception when others then
    v_state := sqlstate;
  end;
  assert v_state = '23514', format('esperava check_violation, veio %s', v_state);
  assert (select convalidated from pg_constraint where conname = 'post_approvals_motivo_check') = false,
    'constraint deve estar NOT VALID (linhas antigas sem motivo nao sao revalidadas)';
  assert not exists (select 1 from pg_constraint where conname = 'post_approvals_motivo_value_check'),
    'constraint permissiva da fase 1 deve ter sido removida';
end $$;
rollback;

-- C.2 aprovado e mensagem sem motivo continuam aceitos
begin;
do $$
declare f record; v_id bigint;
begin
  select * into f from pg_temp.pah_fixture();
  select record_client_approval(f.post, 'tok', 'aprovado', null, false, 'aprovado_cliente') into v_id;
  assert v_id is not null;
  insert into post_approvals (post_id, token, action, comentario, is_workspace_user)
    values (f.post, 'tok', 'mensagem', 'oi', false);
end $$;
rollback;
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx supabase db reset && npm run test:db`
Expected: `FAIL supabase/tests/post_approval_history.sql` at A.3 (`esperava check_violation, veio none`).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260925000012_post_approvals_motivo_required.sql`:

```sql
-- =====================================================================
-- 20260925000012_post_approvals_motivo_required.sql
-- Phase 3 of the correction-reason rollout (spec §3). Runs only after
-- hub-approve (which validates motivo and passes p_motivo) and the Hub
-- bundle (which sends it) are live in production; the phase-1 constraint
-- was deliberately permissive to keep the old 6-arg call working.
--
-- NOT VALID: 'correcao' rows from before this migration (pre-rollout and
-- phase 1) have motivo = NULL by scope decision and must keep existing; a
-- validating CHECK would fail on them. The explicit IS NOT NULL matters:
-- NULL IN (...) is NULL, and a CHECK only rejects FALSE.
-- =====================================================================

alter table post_approvals drop constraint if exists post_approvals_motivo_value_check;
alter table post_approvals drop constraint if exists post_approvals_motivo_check;
alter table post_approvals
  add constraint post_approvals_motivo_check
  check (
    action <> 'correcao'
    or (motivo is not null and motivo in ('legenda', 'imagem_video', 'data', 'outro'))
  ) not valid;
```

- [ ] **Step 4: Apply locally and run the test**

Run: `npx supabase db reset && npm run test:db`
Expected: `PASS supabase/tests/post_approval_history.sql` (A.1, A.2, A.3, A.4, A.5, B.1, B.2, B.3, C.1, C.2).

- [ ] **Step 5: Commit, push to staging and production, open the follow-up PR**

```bash
git add supabase/migrations/20260925000012_post_approvals_motivo_required.sql supabase/tests/post_approval_history.sql
git commit -m "feat(db): require motivo on correcao (phase 3, NOT VALID)

hub-approve and the Hub bundle already send the correction reason; swap
the permissive value CHECK for the conditional presence+value CHECK.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
npx supabase link --project-ref wlyzhyfondykzpsiqsce < /dev/null
npx supabase db push --linked
npx supabase db query --linked "select conname, convalidated from pg_constraint where conname like 'post_approvals_motivo%'"
npx supabase link --project-ref skjzpekeqefvlojenfsw < /dev/null
npx supabase db push --linked
npx supabase db query --linked "select conname, convalidated from pg_constraint where conname like 'post_approvals_motivo%'"
git push -u origin claude/post-approval-motivo-required
gh pr create --base main --title "feat(db): motivo obrigatório em correção (fase 3 do rollout)" --body "$(cat <<'EOF'
## Summary
- Fase 3 do rollout do motivo de correção (spec §3): troca o CHECK permissivo de valor pelo CHECK condicional de presença+valor, criado NOT VALID.
- Já aplicada em staging e produção; `hub-approve` e o bundle do Hub em produção já enviam `motivo` desde o PR anterior.

Spec: docs/superpowers/specs/2026-09-17-post-approval-history-design.md
Plan: docs/superpowers/plans/2026-09-17-post-approval-history.md (Task 16)

## Test plan
- [ ] `npm run test:db` (casos A.3, C.1, C.2)
- [ ] Produção: `select conname, convalidated from pg_constraint where conname like 'post_approvals_motivo%'` mostra só `post_approvals_motivo_check` com `convalidated = false`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: both `db push` runs apply exactly `20260925000012`; both queries return one row `post_approvals_motivo_check | f`; PR URL printed.
