# Hub: editar sugestão pendente + diff — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Hub client keep editing a pending edit suggestion (text + caption), see it as a red/green diff, and make every client/team writer on a post's suggestion race-safe.

**Architecture:** Backend: one migration re-defines four existing SECURITY DEFINER functions with the same signatures (post-first lock order, status/pending guards, `metadata.updated`), plus two edge-function error mappings and a notify-on-update change. Frontend (Hub): the edit hook keeps the suggestion a save returns as its effective state; the correction panel stays usable while a suggestion is pending; the reading view gains a default "Alterações" diff built on the existing word-diff package. CRM: one notification title.

**Tech Stack:** Postgres/plpgsql (Supabase), Deno edge functions, React 19 + Vitest + Testing Library, `@mesaas/text-diff`, react-i18next, psql test suites.

**Spec:** `docs/superpowers/specs/2026-09-28-hub-editar-sugestao-diff-design.md` (approved v4). Read it before starting.

## Global Constraints

- Worktree: `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/relatorios-interativos-default-1e62f5`, branch `claude/recover-post-suggestions-ea3978`. Run `pwd && git branch --show-current` before each task.
- No function signature changes. Every SQL change is `CREATE OR REPLACE` on an existing signature (test `96_lockdown_definer_function_grants.sql` pins them).
- Lock order for every writer: `workflow_posts` row, then `post_edit_suggestions` row.
- Migration file: `supabase/migrations/20260928000001_edit_suggestion_update_flow.sql`. Before opening the PR, `git fetch origin main && git ls-tree --name-only origin/main supabase/migrations/ | tail -3`; renumber above main's tail if needed.
- UI copy in Portuguese, no em-dashes in new user-facing copy. Every new Hub string goes through `t('shared.<key>', '<pt fallback>')` in namespace `hubPosts`, with the key added to both `packages/i18n/locales/pt/hubPosts.json` and `packages/i18n/locales/en/hubPosts.json` under `"shared"`.
- Icons: `lucide-react` only. Edge functions never return raw error details.
- Never `useBlocker`. Unsaved-work signalling stays with `useUnsavedWork` (already wired).
- Do NOT deploy or push migrations. Deploy is a separate, user-approved step (see end).
- Before the final commit: `npm run lint`, `npm run format:check`, the four `tsc` commands, `npm run test`, `npm run check:functions`, `npm run test:functions`. After any `deno` run: `ls node_modules/.deno 2>/dev/null && npm ci` (deno pollutes node_modules) and `git checkout deno.lock` if it changed.

---

## File map

| File | Change |
|---|---|
| `supabase/migrations/20260928000001_edit_suggestion_update_flow.sql` | Create: 4 function redefinitions |
| `supabase/tests/edit_suggestion_update_flow.sql` | Create: psql suite |
| `supabase/functions/hub-edit-suggestion/handler.ts` | 409 mapping, notify on update |
| `supabase/functions/hub-approve/handler.ts` | 409 mapping |
| `supabase/functions/__tests__/hub-functions_test.ts` | New Deno tests |
| `apps/crm/src/lib/notification-config.ts`, `notification-catalog.ts` | "atualizada" title, catalog copy |
| `apps/crm/src/lib/__tests__/notification-config.edit-suggestion.test.ts` | Create |
| `apps/hub/src/components/TextDiff.tsx` | Create: extracted from PostHistoryPanel |
| `apps/hub/src/components/PostHistoryPanel.tsx` | Import TextDiff |
| `apps/hub/src/lib/postView.ts` | `suggestionAwareCaption` |
| `apps/hub/src/components/posts/SuggestionDiff.tsx` | Create |
| `apps/hub/src/hooks/useEditSuggestion.ts` | Effective suggestion |
| `apps/hub/src/components/posts/CorrectionPanel.tsx` | Editable while pending, notice view `diff` |
| `apps/hub/src/components/posts/PostDetailDialog.tsx` | Editar sugestão, footer save, diff view |
| `packages/i18n/locales/{pt,en}/hubPosts.json` | New keys |
| Hub tests under `apps/hub/src/**/__tests__/` | New + updated |

---

### Task 1: Database — migration + psql suite

**Files:**
- Create: `supabase/migrations/20260928000001_edit_suggestion_update_flow.sql`
- Create: `supabase/tests/edit_suggestion_update_flow.sql`

**Interfaces:**
- Produces: `upsert_edit_suggestion(...)` raises `post_not_pending` (P0001) unless the post is `enviado_cliente` and `conta_id = p_conta_id`. `record_client_approval(...)` raises `pending_suggestion` (P0001) for a client `aprovado`/`correcao` while a pending suggestion exists. `create_edit_suggestion_notification(bigint)` returns 0 when no pending row exists; the metadata gains `updated boolean`. Tasks 2 and 3 rely on these exact message strings and the metadata key.

- [ ] **Step 1: Confirm the latest bodies being replaced**

```bash
grep -ln "FUNCTION upsert_edit_suggestion\|function upsert_edit_suggestion" supabase/migrations/*
grep -iln "function accept_edit_suggestion" supabase/migrations/*
grep -iln "function create_edit_suggestion_notification" supabase/migrations/*
grep -iln "function record_client_approval" supabase/migrations/*
```
Expected latest definitions: `20260521000001` (upsert), `20260923000001` (accept), `20260830000003` (notification), `20260925000010` (record_client_approval). If any later file redefines one, base that function on the later body instead.

- [ ] **Step 2: Write the failing psql suite**

Create `supabase/tests/edit_suggestion_update_flow.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Suite for 20260928000001_edit_suggestion_update_flow.sql
-- (spec docs/superpowers/specs/2026-09-28-hub-editar-sugestao-diff-design.md §3).
--   E.1 notification metadata.updated: false on first insert, true after an update
--   E.2 upsert_edit_suggestion raises post_not_pending when the post left enviado_cliente
--   E.3 upsert_edit_suggestion raises post_not_pending for a foreign conta_id
--   E.4 create_edit_suggestion_notification returns 0 with no pending row
--   E.5 record_client_approval raises pending_suggestion for a client approval/correction
--   E.6 record_client_approval still succeeds for a workspace user with a pending row
--   E.7 accept_edit_suggestion still applies the suggestion (lock-order rewrite)

create or replace function pg_temp.esf_fixture(out ws uuid, out usr uuid, out cli bigint, out post bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws where id = usr;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflow_posts (conta_id, cliente_id, titulo, status, ig_caption, conteudo_plain)
    values (ws, cli, 'post sugestao', 'enviado_cliente', 'legenda v1', 'texto v1') returning id into post;
end $$;

-- E.1
begin;
do $$
declare f record; v_res jsonb; v_meta jsonb;
begin
  select * into f from pg_temp.esf_fixture();
  v_res := upsert_edit_suggestion(f.post, f.ws, 'tok', null, 'texto v1', 'legenda v2');
  assert v_res->>'action' = 'upserted' and (v_res->>'is_new')::boolean, format('first upsert: %s', v_res);
  perform create_edit_suggestion_notification(f.post);
  select metadata into v_meta from notifications
   where type = 'post_edit_suggestion' and (metadata->>'post_id')::bigint = f.post
   order by created_at desc limit 1;
  assert v_meta is not null, 'a notification must be created on first insert';
  assert (v_meta->>'updated')::boolean = false, format('first insert must be updated=false: %s', v_meta);

  -- created_at/updated_at are both now() inside one transaction; age the row so the
  -- BEFORE UPDATE trigger's new now() is observably later. That UPDATE itself fires the
  -- trigger (updated_at := now()), so reset updated_at = created_at afterwards; otherwise
  -- updated=true would hold even if the second upsert did nothing.
  update post_edit_suggestions set created_at = created_at - interval '1 minute' where post_id = f.post;
  alter table post_edit_suggestions disable trigger post_edit_suggestions_updated_at;
  update post_edit_suggestions set updated_at = created_at where post_id = f.post;
  alter table post_edit_suggestions enable trigger post_edit_suggestions_updated_at;
  v_res := upsert_edit_suggestion(f.post, f.ws, 'tok', null, 'texto v1', 'legenda v3');
  assert not (v_res->>'is_new')::boolean, 'second upsert must update the same pending row';
  delete from notifications where (metadata->>'post_id')::bigint = f.post;
  perform create_edit_suggestion_notification(f.post);
  select metadata into v_meta from notifications
   where type = 'post_edit_suggestion' and (metadata->>'post_id')::bigint = f.post
   order by created_at desc limit 1;
  assert (v_meta->>'updated')::boolean = true, format('update must be updated=true: %s', v_meta);
  raise notice 'PASS E.1 metadata.updated false on insert, true on update';
end $$;
rollback;

-- E.2
begin;
do $$
declare f record;
begin
  select * into f from pg_temp.esf_fixture();
  update workflow_posts set status = 'aprovado_cliente' where id = f.post;
  begin
    perform upsert_edit_suggestion(f.post, f.ws, 'tok', null, 'texto v1', 'legenda v2');
    raise exception 'expected post_not_pending' using errcode = 'P0002';
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_not_pending', format('unexpected message: %s', sqlerrm);
  end;
  assert not exists (select 1 from post_edit_suggestions where post_id = f.post), 'no row may be created';
  raise notice 'PASS E.2 upsert refuses a post that left enviado_cliente';
end $$;
rollback;

-- E.3
begin;
do $$
declare f record;
begin
  select * into f from pg_temp.esf_fixture();
  begin
    perform upsert_edit_suggestion(f.post, gen_random_uuid(), 'tok', null, 'texto v1', 'legenda v2');
    raise exception 'expected post_not_pending' using errcode = 'P0002';
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_not_pending', format('unexpected message: %s', sqlerrm);
  end;
  raise notice 'PASS E.3 upsert refuses a foreign conta_id';
end $$;
rollback;

-- E.4
begin;
do $$
declare f record; v_count int;
begin
  select * into f from pg_temp.esf_fixture();
  select create_edit_suggestion_notification(f.post) into v_count;
  assert v_count = 0, format('no pending row must notify nobody, got %s', v_count);
  assert not exists (select 1 from notifications where (metadata->>'post_id')::bigint = f.post);
  raise notice 'PASS E.4 notification is a no-op without a pending row';
end $$;
rollback;

-- E.5
begin;
do $$
declare f record; v_action text;
begin
  select * into f from pg_temp.esf_fixture();
  perform upsert_edit_suggestion(f.post, f.ws, 'tok', null, 'texto v1', 'legenda v2');
  foreach v_action in array array['aprovado', 'correcao'] loop
    begin
      perform record_client_approval(f.post, 'tok', v_action, null, false,
        case v_action when 'aprovado' then 'aprovado_cliente' else 'correcao_cliente' end);
      raise exception 'expected pending_suggestion for %', v_action using errcode = 'P0002';
    exception when sqlstate 'P0001' then
      assert sqlerrm = 'pending_suggestion', format('unexpected message: %s', sqlerrm);
    end;
  end loop;
  assert (select status from workflow_posts where id = f.post) = 'enviado_cliente', 'status must not move';
  assert (select status from post_edit_suggestions where post_id = f.post) = 'pending', 'suggestion must stay pending';
  raise notice 'PASS E.5 client approval/correction blocked while a suggestion is pending';
end $$;
rollback;

-- E.6
begin;
do $$
declare f record;
begin
  select * into f from pg_temp.esf_fixture();
  perform upsert_edit_suggestion(f.post, f.ws, 'tok', null, 'texto v1', 'legenda v2');
  perform record_client_approval(f.post, 'tok', 'aprovado', null, true, 'aprovado_cliente');
  assert (select status from workflow_posts where id = f.post) = 'aprovado_cliente';
  raise notice 'PASS E.6 workspace-user approval is not blocked';
end $$;
rollback;

-- E.7
begin;
do $$
declare f record; v_id bigint;
begin
  select * into f from pg_temp.esf_fixture();
  perform upsert_edit_suggestion(f.post, f.ws, 'tok', null, 'texto v1', 'legenda v2');
  select id into v_id from post_edit_suggestions where post_id = f.post and status = 'pending';
  perform accept_edit_suggestion(v_id);
  assert (select ig_caption from workflow_posts where id = f.post) = 'legenda v2';
  assert (select status from post_edit_suggestions where id = v_id) = 'accepted';
  raise notice 'PASS E.7 accept_edit_suggestion still applies the suggestion';
end $$;
rollback;
```

Check the `notifications` column names against `supabase/migrations/20260430000001_notifications.sql` (the suite assumes `type`, `metadata`, `created_at`) and adjust if they differ.

- [ ] **Step 3: Run it to see it fail**

Local Supabase runs on colima (see memory `reference_local_supabase_colima.md`; port overrides in `supabase/config.toml` must NOT be committed). With the local stack up and migrations applied (`npx supabase db reset`):

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/edit_suggestion_update_flow.sql
```
Expected: FAIL at E.1 (`updated` key missing) or E.2 (no exception raised). If Docker/colima is unavailable, say so in the task report; CI's `entitlement-tests` job runs this suite.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260928000001_edit_suggestion_update_flow.sql`:

```sql
-- =====================================================================
-- 20260928000001_edit_suggestion_update_flow.sql
-- Hub: editar sugestão pendente (spec
-- docs/superpowers/specs/2026-09-28-hub-editar-sugestao-diff-design.md §3).
--
-- Every writer of a post's suggestion now locks in the same order:
-- workflow_posts row first, then post_edit_suggestions row. That is the
-- order the auto-reject trigger already uses (team UPDATE workflow_posts ->
-- trigger updates the suggestion), so client saves, client approvals and
-- team accepts serialize instead of racing or deadlocking.
--
-- All four functions keep their signatures; CREATE OR REPLACE keeps their
-- grants. The three service_role-only ones restate them anyway, matching
-- 20260925000001_lockdown_definer_function_grants.sql; accept_edit_suggestion
-- keeps its existing authenticated + service_role grants untouched.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 3a. upsert_edit_suggestion: lock the post and require enviado_cliente
-- in the same transaction as the upsert. Before, hub-edit-suggestion
-- checked the status in a separate query, so a team accept/reject landing
-- in between let the save recreate a pending suggestion on a post that was
-- no longer waiting for the client. Body otherwise identical to
-- 20260521000001.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION upsert_edit_suggestion(
  p_post_id                bigint,
  p_conta_id               uuid,
  p_token                  text,
  p_suggested_conteudo     jsonb,
  p_suggested_conteudo_plain text,
  p_suggested_ig_caption   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post             record;
  v_changed          text[] := '{}';
  v_result           record;
  v_is_new           boolean;
BEGIN
  SELECT conteudo, conteudo_plain, ig_caption, status, conta_id
    INTO v_post
    FROM workflow_posts
    WHERE id = p_post_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post not found';
  END IF;

  IF v_post.status <> 'enviado_cliente' OR v_post.conta_id IS DISTINCT FROM p_conta_id THEN
    RAISE EXCEPTION 'post_not_pending' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(p_suggested_conteudo_plain, '') IS DISTINCT FROM COALESCE(v_post.conteudo_plain, '') THEN
    v_changed := array_append(v_changed, 'conteudo_plain');
  END IF;
  IF p_suggested_conteudo::text IS DISTINCT FROM v_post.conteudo::text THEN
    v_changed := array_append(v_changed, 'conteudo');
  END IF;
  IF COALESCE(p_suggested_ig_caption, '') IS DISTINCT FROM COALESCE(v_post.ig_caption, '') THEN
    v_changed := array_append(v_changed, 'ig_caption');
  END IF;

  IF array_length(v_changed, 1) IS NULL THEN
    DELETE FROM post_edit_suggestions
      WHERE post_id = p_post_id AND status = 'pending';
    RETURN jsonb_build_object('action', 'deleted', 'suggestion', NULL, 'is_new', false);
  END IF;

  INSERT INTO post_edit_suggestions (
    post_id, conta_id, token,
    original_conteudo, original_conteudo_plain, original_ig_caption,
    suggested_conteudo, suggested_conteudo_plain, suggested_ig_caption,
    changed_fields, status
  ) VALUES (
    p_post_id, p_conta_id, p_token,
    v_post.conteudo, v_post.conteudo_plain, v_post.ig_caption,
    p_suggested_conteudo, p_suggested_conteudo_plain, p_suggested_ig_caption,
    v_changed, 'pending'
  )
  ON CONFLICT (post_id) WHERE status = 'pending'
  DO UPDATE SET
    suggested_conteudo       = EXCLUDED.suggested_conteudo,
    suggested_conteudo_plain = EXCLUDED.suggested_conteudo_plain,
    suggested_ig_caption     = EXCLUDED.suggested_ig_caption,
    changed_fields           = EXCLUDED.changed_fields
  RETURNING *, (xmax = 0) AS _is_new
  INTO v_result;

  v_is_new := v_result._is_new;

  RETURN jsonb_build_object(
    'action', 'upserted',
    'is_new', v_is_new,
    'suggestion', jsonb_build_object(
      'id',                       v_result.id,
      'post_id',                  v_result.post_id,
      'suggested_conteudo',       v_result.suggested_conteudo,
      'suggested_conteudo_plain', v_result.suggested_conteudo_plain,
      'suggested_ig_caption',     v_result.suggested_ig_caption,
      'changed_fields',           v_result.changed_fields,
      'updated_at',               v_result.updated_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text) TO service_role;

-- ---------------------------------------------------------------------
-- 3b. record_client_approval: a client approval or correction moves the
-- post's status, and the auto-reject trigger would then silently reject a
-- pending suggestion. Refuse it atomically (post locked, same order as the
-- upsert) instead of in a separate hub-approve query that could race a
-- concurrent save. Workspace users are not blocked. Body otherwise
-- identical to 20260925000010.
-- ---------------------------------------------------------------------
create or replace function record_client_approval(
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
  perform 1 from workflow_posts where id = p_post_id for update;

  if not coalesce(p_is_workspace_user, false)
     and p_action in ('aprovado', 'correcao')
     and exists (
       select 1 from post_edit_suggestions
        where post_id = p_post_id and status = 'pending'
     )
  then
    raise exception 'pending_suggestion' using errcode = 'P0001';
  end if;

  insert into post_approvals (post_id, token, action, comentario, is_workspace_user, motivo)
  values (p_post_id, p_token, p_action, p_comentario, p_is_workspace_user, p_motivo)
  returning id into v_approval;

  perform set_config('app.event_source',     'client',         true);
  perform set_config('app.post_approval_id', v_approval::text, true);

  update workflow_posts set status = p_new_status where id = p_post_id;

  return v_approval;
end;
$$;

revoke all on function record_client_approval(bigint, text, text, text, boolean, text, text) from public, anon, authenticated;
grant execute on function record_client_approval(bigint, text, text, text, boolean, text, text) to service_role;

-- ---------------------------------------------------------------------
-- 3c. create_edit_suggestion_notification: notify only while a pending row
-- exists, and say whether it is an update. The pending row is read FOR
-- SHARE: accept/reject take FOR UPDATE on it, so an in-flight resolution
-- makes this wait and then no longer match status = 'pending' (nothing is
-- sent), and a later one waits for this to commit. Locking the post would
-- not cover reject_edit_suggestion, which never locks the post. Body
-- otherwise identical to 20260830000003.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_edit_suggestion_notification(p_post_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_responsavel_id bigint;
  v_workflow_id    bigint;
  v_conta_id       uuid;
  v_cliente_id     bigint;
  v_post_title     text;
  v_client_name    text;
  v_targets        uuid[];
  v_link           text;
  v_metadata       jsonb;
  v_count          integer := 0;
  v_updated        boolean;
BEGIN
  SELECT (s.updated_at > s.created_at)
    INTO v_updated
    FROM post_edit_suggestions s
   WHERE s.post_id = p_post_id
     AND s.status = 'pending'
     FOR SHARE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT wp.responsavel_id, wp.workflow_id, wp.titulo,
         wp.conta_id, wp.cliente_id
    INTO v_responsavel_id, v_workflow_id, v_post_title, v_conta_id, v_cliente_id
    FROM workflow_posts wp
   WHERE wp.id = p_post_id;

  IF v_conta_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT nome INTO v_client_name FROM clientes WHERE id = v_cliente_id;

  v_targets := resolve_notification_targets(v_conta_id, v_responsavel_id, ARRAY['owner','admin']);

  IF v_targets IS NULL OR array_length(v_targets, 1) IS NULL THEN
    RETURN 0;
  END IF;

  v_link := CASE WHEN v_workflow_id IS NULL
    THEN '/entregas?post=' || p_post_id
    ELSE '/entregas?drawer=' || v_workflow_id
  END;
  v_metadata := jsonb_build_object(
    'client_name', v_client_name,
    'post_title',  v_post_title,
    'workflow_id', v_workflow_id,
    'post_id',     p_post_id,
    'updated',     COALESCE(v_updated, false)
  );

  PERFORM insert_notification_batch(v_conta_id, v_targets, 'post_edit_suggestion', v_link, v_metadata, NULL);

  v_count := array_length(v_targets, 1);
  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION create_edit_suggestion_notification(bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_edit_suggestion_notification(bigint) TO service_role;

-- ---------------------------------------------------------------------
-- 3d. accept_edit_suggestion: lock the post BEFORE the suggestion. It used
-- to lock the suggestion first and then update the post, the reverse of
-- the upsert above, so a team accept concurrent with a client save could
-- deadlock. Body otherwise identical to 20260923000001. Grants unchanged
-- (authenticated + service_role, the CRM calls it directly).
-- ---------------------------------------------------------------------
create or replace function accept_edit_suggestion(
  p_suggestion_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_id    bigint;
  v_suggestion record;
begin
  select post_id into v_post_id
    from post_edit_suggestions
    where id = p_suggestion_id;

  if v_post_id is null then
    raise exception 'Suggestion not found';
  end if;

  perform 1 from workflow_posts where id = v_post_id for update;

  select * into v_suggestion
    from post_edit_suggestions
    where id = p_suggestion_id
    for update;

  if v_suggestion is null then
    raise exception 'Suggestion not found';
  end if;

  if v_suggestion.status <> 'pending' then
    raise exception 'Suggestion is not pending (status: %)', v_suggestion.status;
  end if;

  perform set_config('app.accepting_edit_suggestion', v_suggestion.id::text, true);

  -- source is forced to 'client' (the TEXT is client-authored), while
  -- actor_user_id still resolves to auth.uid() via the content-version
  -- trigger's fallback (see 20260923000001).
  perform set_config('app.event_source', 'client', true);
  perform set_config('app.post_edit_suggestion_id', v_suggestion.id::text, true);

  update workflow_posts set
    conteudo       = coalesce(v_suggestion.suggested_conteudo, conteudo),
    conteudo_plain = coalesce(v_suggestion.suggested_conteudo_plain, conteudo_plain),
    ig_caption     = v_suggestion.suggested_ig_caption
  where id = v_suggestion.post_id;

  update post_edit_suggestions set
    status      = 'accepted',
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_suggestion_id;
end;
$$;
```

Before saving, diff the accept body against `supabase/migrations/20260923000001_post_content_versions.sql` (the `create or replace function accept_edit_suggestion` block near line 190) and confirm that the only change is the post lock. Do the same for the other three functions against their source files.

- [ ] **Step 5: Run the suite and the existing ones it touches**

```bash
npx supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/edit_suggestion_update_flow.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/post_approval_history.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/96_lockdown_definer_function_grants.sql
```
Expected: all `PASS` notices, exit 0. Don't commit any colima port override in `supabase/config.toml`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260928000001_edit_suggestion_update_flow.sql supabase/tests/edit_suggestion_update_flow.sql
git commit -m "feat(db): sugestão de edição com lock post→sugestão, guarda de aprovação e aviso de atualização

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Edge functions — hub-edit-suggestion + hub-approve

**Files:**
- Modify: `supabase/functions/hub-edit-suggestion/handler.ts` (the `if (rpcError)` block and the `if (rpcResult.is_new)` block, ~lines 138-153)
- Modify: `supabase/functions/hub-approve/handler.ts` (the `if (approvalErr)` line, ~line 196)
- Test: `supabase/functions/__tests__/hub-functions_test.ts`

**Interfaces:**
- Consumes (Task 1): RPC error messages `post_not_pending` / `pending_suggestion`.
- Produces: `hub-edit-suggestion` → 409 `{ error: "Post não está aguardando aprovação." }` on `post_not_pending`; calls `create_edit_suggestion_notification` whenever `action !== "deleted"`. `hub-approve` → 409 `{ error: "Há uma sugestão de edição pendente." }` on `pending_suggestion`.

- [ ] **Step 1: Write the failing Deno tests**

Append to `supabase/functions/__tests__/hub-functions_test.ts` (after the existing `hub-edit-suggestion accepts a suggestion for an avulso post` test):

```ts
function hubEditSuggestionDb() {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("workflow_posts", "select", {
    data: { id: 99, workflow_id: 7, status: "enviado_cliente", conteudo: null, conta_id: "conta-1", cliente_id: 14 },
    error: null,
  });
  return db;
}

function hubEditSuggestionHandlerFor(db: ReturnType<typeof createSupabaseQueryMock>) {
  return createHubEditSuggestionHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    rateLimit: async () => true,
  });
}

function editSuggestionRequest() {
  return new Request("https://example.test/hub-edit-suggestion", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, suggested_conteudo_plain: "Corpo", suggested_ig_caption: "Legenda nova" }),
  });
}

Deno.test("hub-edit-suggestion notifies the team again when a pending suggestion is updated", async () => {
  const db = hubEditSuggestionDb();
  db.queueRpc("upsert_edit_suggestion", {
    data: { action: "upserted", is_new: false, suggestion: { id: 5, post_id: 99 } },
    error: null,
  });
  const response = await hubEditSuggestionHandlerFor(db)(editSuggestionRequest());
  assertEquals(response.status, 200);
  const notif = db.calls.find((c: { table: string }) => c.table === "rpc:create_edit_suggestion_notification");
  assert(notif, "an update must notify too");
  assertEquals(notif.payload, { p_post_id: 99 });
});

Deno.test("hub-edit-suggestion does not notify when the client reverted the suggestion (deleted)", async () => {
  const db = hubEditSuggestionDb();
  db.queueRpc("upsert_edit_suggestion", {
    data: { action: "deleted", is_new: false, suggestion: null },
    error: null,
  });
  const response = await hubEditSuggestionHandlerFor(db)(editSuggestionRequest());
  assertEquals(response.status, 200);
  assertEquals((await readJson(response)).pending_suggestion, null);
  assertEquals(
    db.calls.some((c: { table: string }) => c.table === "rpc:create_edit_suggestion_notification"),
    false,
  );
});

Deno.test("hub-edit-suggestion maps post_not_pending from the RPC to 409 and does not notify", async () => {
  const db = hubEditSuggestionDb();
  db.queueRpc("upsert_edit_suggestion", { data: null, error: { message: "post_not_pending" } });
  const response = await hubEditSuggestionHandlerFor(db)(editSuggestionRequest());
  assertEquals(response.status, 409);
  assertEquals((await readJson(response)).error, "Post não está aguardando aprovação.");
  assertEquals(
    db.calls.some((c: { table: string }) => c.table === "rpc:create_edit_suggestion_notification"),
    false,
  );
});

Deno.test("hub-edit-suggestion still returns a generic 500 for other RPC errors", async () => {
  const db = hubEditSuggestionDb();
  db.queueRpc("upsert_edit_suggestion", { data: null, error: { message: "boom" } });
  const response = await hubEditSuggestionHandlerFor(db)(editSuggestionRequest());
  assertEquals(response.status, 500);
  assertEquals((await readJson(response)).error, "Erro ao salvar sugestão.");
});

for (const action of ["aprovado", "correcao"] as const) {
  Deno.test(`hub-approve maps pending_suggestion to 409 for ${action}`, async () => {
    const db = hubApproveDbForPost();
    db.queueRpc("record_client_approval", { data: null, error: { message: "pending_suggestion" } });
    const response = await hubApproveHandlerFor(db)(new Request("https://example.test/hub-approve", {
      method: "POST",
      body: JSON.stringify({ token: "hub-123", post_id: 99, action }),
    }));
    assertEquals(response.status, 409);
    assertEquals((await readJson(response)).error, "Há uma sugestão de edição pendente.");
    assertEquals(
      db.calls.some((c: { table: string }) => c.table === "rpc:create_post_approval_notification"),
      false,
    );
  });
}
```

`hubApproveDbForPost` and `hubApproveHandlerFor` already exist in the file (~line 769).

- [ ] **Step 2: Run to see them fail**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys --filter "/hub-edit-suggestion|hub-approve maps/" supabase/functions/__tests__/hub-functions_test.ts
```
Expected: the update test fails (no notification call), and the two 409 tests get 500. `--filter` matches test NAMES; it's only a regex when wrapped in `/…/`. The flags mirror `test:functions` in `package.json`.

- [ ] **Step 3: Implement hub-edit-suggestion**

Replace the `if (rpcError) { ... }` block and the notification block with:

```ts
    if (rpcError) {
      // upsert_edit_suggestion re-checks the status under a row lock (migration
      // 20260928000001): the team accepted/rejected/moved the post after the check above.
      const message = (rpcError as { message?: unknown }).message;
      if (typeof message === "string" && message.includes("post_not_pending")) {
        return json({ error: "Post não está aguardando aprovação." }, 409);
      }
      console.error("[hub-edit-suggestion] upsert failed:", rpcError);
      return json({ error: "Erro ao salvar sugestão." }, 500);
    }

    const rpcResult = result as { action: string; is_new: boolean; suggestion: unknown };

    // Notify on every save that leaves a pending suggestion: the first one and each later
    // update (the RPC flags updates via metadata.updated and no-ops if the row was resolved
    // in between). A revert to the original (`deleted`) sends nothing.
    if (rpcResult.action !== "deleted") {
      const { error: notifErr } = await db.rpc("create_edit_suggestion_notification", {
        p_post_id: post_id,
      });
      if (notifErr) {
        console.error("[hub-edit-suggestion] notification creation failed:", notifErr);
      }
    }
```

- [ ] **Step 4: Implement hub-approve**

Replace `if (approvalErr) return json({ error: "Erro ao registrar aprovação." }, 500);` with:

```ts
      if (approvalErr) {
        // record_client_approval refuses a client approval/correction while an edit
        // suggestion is pending (migration 20260928000001): the status change would make the
        // auto-reject trigger silently discard it.
        const message = (approvalErr as { message?: unknown }).message;
        if (typeof message === "string" && message.includes("pending_suggestion")) {
          return json({ error: "Há uma sugestão de edição pendente." }, 409);
        }
        return json({ error: "Erro ao registrar aprovação." }, 500);
      }
```

- [ ] **Step 5: Run the Deno suites and the type gate**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/hub-functions_test.ts
npm run check:functions
ls node_modules/.deno 2>/dev/null && npm ci; git status --short deno.lock
```
Expected: all pass; restore `deno.lock` with `git checkout deno.lock` if it changed.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/hub-edit-suggestion/handler.ts supabase/functions/hub-approve/handler.ts supabase/functions/__tests__/hub-functions_test.ts
git commit -m "feat(hub): avisa a equipe a cada atualização da sugestão e mapeia conflitos para 409

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: CRM — "Sugestão de edição atualizada"

**Files:**
- Modify: `apps/crm/src/lib/notification-config.ts` (`case 'post_edit_suggestion'`, ~line 93)
- Modify: `apps/crm/src/lib/notification-catalog.ts` (`post_edit_suggestion.when`, ~line 62)
- Create: `apps/crm/src/lib/__tests__/notification-config.edit-suggestion.test.ts`

**Interfaces:**
- Consumes (Task 1): `metadata.updated: boolean`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, test } from 'vitest';
import { getNotificationDisplay } from '../notification-config';

describe('post_edit_suggestion notification', () => {
  test('first suggestion keeps the original title', () => {
    const d = getNotificationDisplay('post_edit_suggestion', {
      client_name: 'Clínica X',
      post_title: 'Post 1',
      updated: false,
    });
    expect(d.title).toBe('Sugestão de edição do cliente');
  });

  test('an updated suggestion says so', () => {
    const d = getNotificationDisplay('post_edit_suggestion', {
      client_name: 'Clínica X',
      post_title: 'Post 1',
      updated: true,
    });
    expect(d.title).toBe('Sugestão de edição atualizada');
  });

  test('older notifications without the flag read as a first suggestion', () => {
    const d = getNotificationDisplay('post_edit_suggestion', { client_name: 'X', post_title: 'P' });
    expect(d.title).toBe('Sugestão de edição do cliente');
  });
});
```

- [ ] **Step 2: Run** `npx vitest run apps/crm/src/lib/__tests__/notification-config.edit-suggestion.test.ts`. Expected: the second test fails.

- [ ] **Step 3: Implement**

In `notification-config.ts`:

```ts
    case 'post_edit_suggestion':
      return {
        icon: FilePen,
        tone: 'warning',
        title: m.updated === true ? 'Sugestão de edição atualizada' : 'Sugestão de edição do cliente',
        body: `${client} — ${post}`,
      };
```

In `notification-catalog.ts`, `post_edit_suggestion.when`:

```ts
    when: 'o cliente sugere ou atualiza uma alteração de texto ou legenda no Hub',
```

- [ ] **Step 4: Run** the new test plus `npx vitest run apps/crm/src/lib` and `npx tsc -p apps/crm/tsconfig.json --noEmit`. Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/lib/notification-config.ts apps/crm/src/lib/notification-catalog.ts apps/crm/src/lib/__tests__/notification-config.edit-suggestion.test.ts
git commit -m "feat(crm): notificação diferencia sugestão de edição atualizada

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Hub — TextDiff extraction, `suggestionAwareCaption`, SuggestionDiff, i18n keys

**Files:**
- Create: `apps/hub/src/components/TextDiff.tsx`
- Modify: `apps/hub/src/components/PostHistoryPanel.tsx:40-58` (remove local `TextDiff`, import it)
- Modify: `apps/hub/src/components/__tests__/PostHistoryPanel.test.tsx:3` (import `TextDiff` from `../TextDiff`)
- Modify: `apps/hub/src/lib/postView.ts` (add a function after `deriveCaption`, ~line 145)
- Create: `apps/hub/src/components/posts/SuggestionDiff.tsx`
- Create: `apps/hub/src/components/posts/__tests__/SuggestionDiff.test.tsx`
- Modify: `packages/i18n/locales/pt/hubPosts.json`, `packages/i18n/locales/en/hubPosts.json`

**Interfaces:**
- Deliberate deviation from spec §2 (keep it): for TEXT-kind posts the caption diff's "before" is the raw `post.ig_caption ?? ''`, not `deriveCaption(...)`. A text post without a caption stores `''` as its suggested caption, and `deriveCaption` would turn "before" into the body text, which would show a fake "removed the whole body" caption block. Media posts use `deriveCaption` as the spec says.
- Produces:
  - `TextDiff({ before: string; after: string; className?: string }): JSX.Element`
  - `suggestionAwareCaption(post: HubPost, suggestion: PendingEditSuggestion | null): string`
  - `suggestionDiffBlocks(post: HubPost, suggestion: PendingEditSuggestion): SuggestionDiffBlock[]` where `SuggestionDiffBlock = { field: 'text' | 'caption'; before: string; after: string }`
  - `SuggestionDiff({ post: HubPost; suggestion: PendingEditSuggestion }): JSX.Element`
  - i18n keys (all under `shared`): `editSuggestion`, `editingSuggestionNote`, `correctionBlockedBySuggestion`, `suggestionViewDiff`, `suggestionShowingDiff`, `suggestionDiffTextLabel`, `suggestionDiffCaptionLabel`, `suggestionNoTextDiff`.

- [ ] **Step 1: Failing tests**

`apps/hub/src/components/posts/__tests__/SuggestionDiff.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SuggestionDiff, suggestionDiffBlocks } from '../SuggestionDiff';
import { suggestionAwareCaption } from '../../../lib/postView';
import type { HubPost, PendingEditSuggestion } from '../../../types';

const MEDIA = {
  id: 1, post_id: 1, kind: 'image', mime_type: 'image/jpeg', url: 'https://cdn/a.jpg',
  thumbnail_url: null, width: 1, height: 1, duration_seconds: null, is_cover: false, sort_order: 0,
} as HubPost['media'][number];

function post(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 1, titulo: 'Post', tipo: 'feed', status: 'enviado_cliente', ordem: 1,
    conteudo: null, conteudo_plain: 'Corpo original', scheduled_at: null,
    ig_caption: 'Legenda original', instagram_permalink: null, published_at: null,
    publish_error: null, workflow_id: null, workflow_titulo: null, workflow_created_at: null,
    media: [MEDIA], cover_media: null, pending_suggestion: null, suggestion_rejected_at: null,
    ...over,
  };
}

function sugg(over: Partial<PendingEditSuggestion> = {}): PendingEditSuggestion {
  return {
    id: 9, suggested_conteudo: null, suggested_conteudo_plain: 'Corpo original',
    suggested_ig_caption: 'Legenda original', changed_fields: [],
    updated_at: '2026-09-28T10:00:00.000Z', ...over,
  };
}

describe('suggestionDiffBlocks', () => {
  it('returns only the caption block for a caption-only change on a media post', () => {
    const blocks = suggestionDiffBlocks(post(), sugg({ suggested_ig_caption: 'Legenda nova' }));
    expect(blocks).toEqual([{ field: 'caption', before: 'Legenda original', after: 'Legenda nova' }]);
  });

  it('returns a text block when the body text differs', () => {
    const blocks = suggestionDiffBlocks(post({ media: [] }), sugg({ suggested_conteudo_plain: 'Corpo novo' }));
    expect(blocks).toEqual([{ field: 'text', before: 'Corpo original', after: 'Corpo novo' }]);
  });

  it('ignores null suggested values', () => {
    const blocks = suggestionDiffBlocks(
      post(),
      sugg({ suggested_conteudo_plain: null as unknown as string, suggested_ig_caption: null }),
    );
    expect(blocks).toEqual([]);
  });

  it('diffs a media caption against the LEGENDA fallback the client actually edited', () => {
    const p = post({ ig_caption: null, conteudo_plain: 'Roteiro\nLEGENDA: legenda derivada' });
    const blocks = suggestionDiffBlocks(
      p,
      sugg({ suggested_conteudo_plain: p.conteudo_plain, suggested_ig_caption: 'legenda derivada nova' }),
    );
    expect(blocks).toEqual([
      { field: 'caption', before: 'legenda derivada', after: 'legenda derivada nova' },
    ]);
  });

  it('does not invent a caption change for a text post without a caption', () => {
    const p = post({ media: [], ig_caption: null });
    expect(suggestionDiffBlocks(p, sugg({ suggested_ig_caption: '' }))).toEqual([]);
  });
});

describe('SuggestionDiff', () => {
  it('renders removed and added words', () => {
    const { container } = render(
      <SuggestionDiff post={post()} suggestion={sugg({ suggested_ig_caption: 'Legenda editada' })} />,
    );
    // The equal segment "Legenda " is also a text node, so scope the label lookup to the <p>.
    expect(screen.getByText('Legenda', { selector: 'p' })).toBeInTheDocument();
    expect(container.querySelector('del')?.textContent).toContain('original');
    expect(container.querySelector('ins')?.textContent).toContain('editada');
  });

  it('says so when there is no text difference', () => {
    render(<SuggestionDiff post={post()} suggestion={sugg()} />);
    expect(screen.getByText('Sem diferenças de texto em relação ao original.')).toBeInTheDocument();
  });
});

describe('suggestionAwareCaption', () => {
  it("keeps a suggestion's empty caption instead of falling back to body text", () => {
    const p = post({ ig_caption: null, conteudo_plain: 'Roteiro LEGENDA: derivada' });
    expect(suggestionAwareCaption(p, sugg({ suggested_ig_caption: '' }))).toBe('');
  });
  it('falls back to deriveCaption without a suggestion', () => {
    const p = post({ ig_caption: null, conteudo_plain: 'Roteiro LEGENDA: derivada' });
    expect(suggestionAwareCaption(p, null)).toBe('derivada');
  });
});
```

Check `pickPostCardKind` in `apps/hub/src/lib/postView.ts` returns `'text'` for `media: []` on a `feed` post; if not, build the text-post fixture the way `CorrectionPanel.test.tsx` builds its text-kind post.

- [ ] **Step 2: Run** `npx vitest run apps/hub/src/components/posts/__tests__/SuggestionDiff.test.tsx`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`apps/hub/src/components/TextDiff.tsx` (moved from `PostHistoryPanel.tsx`, dark variants added):

```tsx
import { useMemo } from 'react';
import { computeWordDiff } from '@mesaas/text-diff';

/** Word-level diff: removed words struck through in rose, added words in emerald. */
export function TextDiff({
  before,
  after,
  className = 'text-[12px] leading-relaxed whitespace-pre-wrap hub-tx2',
}: {
  before: string;
  after: string;
  className?: string;
}) {
  const segments = useMemo(() => computeWordDiff(before, after), [before, after]);
  return (
    <p className={className}>
      {segments.map((segment, i) =>
        segment.type === 'delete' ? (
          <del
            key={i}
            className="bg-rose-50 text-rose-700 no-underline line-through dark:bg-rose-950/40 dark:text-rose-300"
          >
            {segment.text}
          </del>
        ) : segment.type === 'insert' ? (
          <ins
            key={i}
            className="bg-emerald-50 text-emerald-800 no-underline dark:bg-emerald-950/40 dark:text-emerald-300"
          >
            {segment.text}
          </ins>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </p>
  );
}
```

In `PostHistoryPanel.tsx`: delete the local `export function TextDiff …` block and the now-unused `computeWordDiff` import (drop `useMemo` from the React import too if nothing else uses it), and add `import { TextDiff } from './TextDiff';`. In `PostHistoryPanel.test.tsx` line 3: `import { PostHistoryPanel } from '../PostHistoryPanel';` plus `import { TextDiff } from '../TextDiff';`.

`apps/hub/src/lib/postView.ts`, after `deriveCaption` (add `PendingEditSuggestion` to the existing `../types` import):

```ts
/**
 * The caption to show/edit while a suggestion may be pending. A suggestion's own caption wins
 * even when it is '' (the client cleared it): `deriveCaption` treats '' as missing and would
 * fall back to LEGENDA-derived body text, which a re-save would then submit as the caption.
 */
export function suggestionAwareCaption(
  post: HubPost,
  suggestion: PendingEditSuggestion | null,
): string {
  if (suggestion && suggestion.suggested_ig_caption !== null) return suggestion.suggested_ig_caption;
  return deriveCaption(post, post.ig_caption);
}
```

`apps/hub/src/components/posts/SuggestionDiff.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import type { HubPost, PendingEditSuggestion } from '../../types';
import { deriveCaption, pickPostCardKind } from '../../lib/postView';
import { TextDiff } from '../TextDiff';

export interface SuggestionDiffBlock {
  field: 'text' | 'caption';
  before: string;
  after: string;
}

/**
 * What accepting the suggestion would change, field by field, against the LIVE post (what
 * `changed_fields` is computed against and what accept overwrites). A field only appears when
 * its plain text really differs: `changed_fields` alone also flags formatting-only or
 * null-document "changes" that accept never applies.
 */
export function suggestionDiffBlocks(
  post: HubPost,
  suggestion: PendingEditSuggestion,
): SuggestionDiffBlock[] {
  const blocks: SuggestionDiffBlock[] = [];
  const beforeText = post.conteudo_plain ?? '';
  if (suggestion.suggested_conteudo_plain != null && suggestion.suggested_conteudo_plain !== beforeText) {
    blocks.push({ field: 'text', before: beforeText, after: suggestion.suggested_conteudo_plain });
  }
  if (suggestion.suggested_ig_caption != null) {
    // Text posts edit the stored caption; media posts edit the caption the client sees, which
    // falls back to the LEGENDA part of the body when ig_caption is empty.
    const beforeCaption =
      pickPostCardKind(post) === 'text'
        ? (post.ig_caption ?? '')
        : deriveCaption(post, post.ig_caption);
    if (suggestion.suggested_ig_caption !== beforeCaption) {
      blocks.push({ field: 'caption', before: beforeCaption, after: suggestion.suggested_ig_caption });
    }
  }
  return blocks;
}

export function SuggestionDiff({
  post,
  suggestion,
}: {
  post: HubPost;
  suggestion: PendingEditSuggestion;
}) {
  const { t } = useTranslation('hubPosts');
  const blocks = suggestionDiffBlocks(post, suggestion);
  if (blocks.length === 0) {
    return (
      <p className="text-[13px] hub-tx3">
        {t('shared.suggestionNoTextDiff', 'Sem diferenças de texto em relação ao original.')}
      </p>
    );
  }
  return (
    <div className="space-y-4" data-testid="suggestion-diff">
      {blocks.map((b) => (
        <section key={b.field} className="space-y-1">
          <p className="text-[12px] font-semibold uppercase tracking-[0.06em] hub-tx3">
            {b.field === 'text'
              ? t('shared.suggestionDiffTextLabel', 'Texto do post')
              : t('shared.suggestionDiffCaptionLabel', 'Legenda')}
          </p>
          <TextDiff
            before={b.before}
            after={b.after}
            className="text-[14px] leading-[1.6] whitespace-pre-wrap hub-txt"
          />
        </section>
      ))}
    </div>
  );
}
```

i18n: add under `"shared"` in `packages/i18n/locales/pt/hubPosts.json`:

```json
    "editSuggestion": "Editar sugestão",
    "editingSuggestionNote": "Você está editando a sugestão que já enviou. As alterações anteriores continuam valendo.",
    "correctionBlockedBySuggestion": "Para pedir correção, aguarde a equipe revisar sua sugestão.",
    "suggestionViewDiff": "Alterações",
    "suggestionShowingDiff": "Em vermelho o que você removeu, em verde o que acrescentou.",
    "suggestionDiffTextLabel": "Texto do post",
    "suggestionDiffCaptionLabel": "Legenda",
    "suggestionNoTextDiff": "Sem diferenças de texto em relação ao original.",
```

and in `packages/i18n/locales/en/hubPosts.json`:

```json
    "editSuggestion": "Edit suggestion",
    "editingSuggestionNote": "You are editing the suggestion you already sent. Your earlier changes are kept.",
    "correctionBlockedBySuggestion": "To request a correction, wait for the team to review your suggestion.",
    "suggestionViewDiff": "Changes",
    "suggestionShowingDiff": "Removed text in red, added text in green.",
    "suggestionDiffTextLabel": "Post text",
    "suggestionDiffCaptionLabel": "Caption",
    "suggestionNoTextDiff": "No text differences from the original.",
```

- [ ] **Step 4: Run** `npx vitest run apps/hub/src/components/posts/__tests__/SuggestionDiff.test.tsx apps/hub/src/components/__tests__/PostHistoryPanel.test.tsx`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components/TextDiff.tsx apps/hub/src/components/PostHistoryPanel.tsx apps/hub/src/components/__tests__/PostHistoryPanel.test.tsx apps/hub/src/lib/postView.ts apps/hub/src/components/posts/SuggestionDiff.tsx apps/hub/src/components/posts/__tests__/SuggestionDiff.test.tsx packages/i18n/locales/pt/hubPosts.json packages/i18n/locales/en/hubPosts.json
git commit -m "feat(hub): diff da sugestão pendente (texto e legenda)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Hub — `useEditSuggestion` effective suggestion

**Files:**
- Modify: `apps/hub/src/hooks/useEditSuggestion.ts`
- Test: `apps/hub/src/hooks/__tests__/useEditSuggestion.test.tsx`

**Interfaces:**
- Produces: `resolveEffectiveSuggestion(post: HubPost, local: LocalSuggestion | null): PendingEditSuggestion | null` and `interface LocalSuggestion { postId: number; value: PendingEditSuggestion | null; postAtSave: HubPost }`. The hook's return value gains `suggestion: PendingEditSuggestion | null` (the effective one). `hasPendingSuggestion` and `draft*` derive from it.

- [ ] **Step 1: Failing tests** (append to `useEditSuggestion.test.tsx`; update the file's imports to include `resolveEffectiveSuggestion` and `PendingEditSuggestion`)

```tsx
const SAVED: PendingEditSuggestion = {
  id: 77,
  suggested_conteudo: null,
  suggested_conteudo_plain: 'original',
  suggested_ig_caption: 'legenda sugerida',
  changed_fields: ['ig_caption'],
  updated_at: '2026-09-28T12:00:00.000Z',
};

describe('resolveEffectiveSuggestion', () => {
  const base = makePost({ pending_suggestion: null });
  it('uses the prop without a local save', () => {
    expect(resolveEffectiveSuggestion(base, null)).toBeNull();
  });
  it('uses the saved value while the post prop is still the pre-save object', () => {
    expect(resolveEffectiveSuggestion(base, { postId: base.id, value: SAVED, postAtSave: base })).toBe(SAVED);
  });
  it('trusts a refetched post even when it has no suggestion (team resolved it)', () => {
    const refetched = makePost({ pending_suggestion: null });
    expect(resolveEffectiveSuggestion(refetched, { postId: base.id, value: SAVED, postAtSave: base })).toBeNull();
  });
  it('keeps the saved value over a refetch that carries an older row', () => {
    const stale = makePost({ pending_suggestion: { ...SAVED, updated_at: '2026-09-28T11:00:00.000Z' } });
    expect(resolveEffectiveSuggestion(stale, { postId: base.id, value: SAVED, postAtSave: base })).toBe(SAVED);
  });
  it('ignores a local save made for another post', () => {
    expect(resolveEffectiveSuggestion(base, { postId: 1, value: SAVED, postAtSave: base })).toBeNull();
  });
});

it('after a save, exposes the returned suggestion until the post prop is refetched', async () => {
  mockedSubmit.mockResolvedValue({ ok: true, pending_suggestion: SAVED });
  const initial = makePost({ pending_suggestion: null });
  const { result, rerender } = renderHook(
    ({ post }) => useEditSuggestion({ token: 't', post, onSaved: () => undefined }),
    { initialProps: { post: initial } },
  );
  act(() => result.current.saveSuggestion(null, 'original', 'legenda sugerida'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1600);
  });
  expect(result.current.hasPendingSuggestion).toBe(true);
  expect(result.current.suggestion).toEqual(SAVED);
  expect(result.current.draftIgCaption).toBe('legenda sugerida');

  // The team rejected it before the refetch landed: the refetched post wins.
  rerender({ post: makePost({ pending_suggestion: null }) });
  expect(result.current.hasPendingSuggestion).toBe(false);
  expect(result.current.draftIgCaption).toBe('legenda original');
});
```

Put the `it` block inside the existing `describe('useEditSuggestion', …)` so it gets the fake timers and mock resets from its `beforeEach`.

- [ ] **Step 2: Run** `npx vitest run apps/hub/src/hooks/__tests__/useEditSuggestion.test.tsx`. Expected: FAIL (`resolveEffectiveSuggestion` not exported).

- [ ] **Step 3: Implement**

In `useEditSuggestion.ts`:

1. Imports: `PendingEditSuggestion` is already imported from `../types`; nothing to add.
2. Add, above `export function useEditSuggestion`:

```ts
/** The suggestion a save just returned, held until the post prop catches up. */
export interface LocalSuggestion {
  postId: number;
  value: PendingEditSuggestion | null;
  /** The `post` object on screen when the save resolved (no refetch yet = same reference). */
  postAtSave: HubPost;
}

/**
 * The pending suggestion to act on. Right after a save, `post.pending_suggestion` is stale
 * until the list refetch lands; seeding drafts from it would let a reopened editor start from
 * the pre-save text and overwrite the suggestion. So the saved value wins while `post` is
 * still the same object it was at save time, or when a refetch carries an older row than the
 * save returned (a fetch that started before the save). Any other refetch is server truth,
 * including one where the team already accepted/rejected the suggestion.
 */
export function resolveEffectiveSuggestion(
  post: HubPost,
  local: LocalSuggestion | null,
): PendingEditSuggestion | null {
  // `?? null`: a cached/partial payload may omit the field entirely.
  const prop = post.pending_suggestion ?? null;
  if (!local || local.postId !== post.id) return prop;
  if (post === local.postAtSave) return local.value;
  if (prop && local.value && Date.parse(prop.updated_at) < Date.parse(local.value.updated_at)) {
    return local.value;
  }
  return prop;
}
```

3. Inside the hook, replace `const suggestion = post.pending_suggestion;` with:

```ts
  const [localSuggestion, setLocalSuggestion] = useState<LocalSuggestion | null>(null);
  // The post object currently rendered; read when a save settles to stamp `postAtSave`.
  const postRef = useRef(post);
  postRef.current = post;
  const suggestion = resolveEffectiveSuggestion(post, localSuggestion);
```

4. Remove the `hasPendingSuggestion` state (`const [hasPendingSuggestion, setHasPendingSuggestion] = useState(!!suggestion);`) and add after the `suggestion` line: `const hasPendingSuggestion = !!suggestion;`. Remove `setHasPendingSuggestion(!!suggestion);` from the navigation-reset block.
5. In `flush`, type the outcome: `pendingSuggestion: PendingEditSuggestion | null;`. In the post-loop success branch, replace `setHasPendingSuggestion(!!currentPostOutcome.pendingSuggestion);` with:

```ts
        setLocalSuggestion({
          postId: currentPostOutcome.postId,
          value: currentPostOutcome.pendingSuggestion,
          postAtSave: postRef.current,
        });
```

6. Add `suggestion` to the returned object.

If the React Compiler / `react-hooks` lint flags writing `postRef.current` during render, move the assignment into `useLayoutEffect(() => { postRef.current = post; })`. The hook already assigns `currentPostIdRef.current` during render, so check what lint does with that first.

- [ ] **Step 4: Run** the hook tests, then `npx vitest run apps/hub`. Expected: the hook suite passes. (`apps/hub/tsconfig.json` excludes test files, so `makeEdit` lacking `suggestion` until Task 6 does not break `tsc`.)

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/hooks/useEditSuggestion.ts apps/hub/src/hooks/__tests__/useEditSuggestion.test.tsx
git commit -m "feat(hub): hook de sugestão usa o retorno do salvamento até o refetch chegar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Hub — CorrectionPanel editable while a suggestion is pending

**Files:**
- Modify: `apps/hub/src/components/posts/CorrectionPanel.tsx`
- Test: `apps/hub/src/components/posts/__tests__/CorrectionPanel.test.tsx`

**Interfaces:**
- Consumes: `edit.suggestion` (Task 5), `suggestionAwareCaption` (Task 4).
- Produces: `CorrectionPanelProps.onSavedClean?: () => void`, called after a successful save when no comentário or motivo is typed. `SuggestionView = 'diff' | 'suggestion' | 'original'`. `SuggestionPendingNotice` renders three options with `diff` first.

- [ ] **Step 1: Failing tests**

In `CorrectionPanel.test.tsx`: add `suggestion: null,` to `makeEdit`'s defaults; replace the test `collapses to the pending message when a suggestion is pending` with:

```tsx
  const PENDING = {
    id: 9,
    suggested_conteudo: null,
    suggested_conteudo_plain: 'Corpo do post',
    suggested_ig_caption: 'Legenda sugerida',
    changed_fields: ['ig_caption'],
    updated_at: '2026-09-28T10:00:00.000Z',
  };

  it('keeps the editor open for a pending suggestion, seeded with it', () => {
    render(
      <CorrectionPanel
        post={post({ pending_suggestion: PENDING })}
        edit={makeEdit({
          hasPendingSuggestion: true,
          approvalBlocked: true,
          suggestion: PENDING,
          draftIgCaption: 'Legenda sugerida',
        })}
        submitting={false}
        onSubmitCorrection={onSubmitCorrection}
        onDirtyChange={onDirtyChange}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Legenda do post' })).toHaveValue('Legenda sugerida');
    expect(screen.getByText(/Você está editando a sugestão que já enviou/)).toBeInTheDocument();
    expect(
      screen.getByText('Para pedir correção, aguarde a equipe revisar sua sugestão.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Enviar correção/ })).toBeDisabled();
  });

  it("does not refill a suggestion's cleared caption with body text", () => {
    const cleared = { ...PENDING, suggested_ig_caption: '' };
    render(
      <CorrectionPanel
        post={post({ ig_caption: null, conteudo_plain: 'Roteiro LEGENDA: derivada', pending_suggestion: cleared })}
        edit={makeEdit({ hasPendingSuggestion: true, approvalBlocked: true, suggestion: cleared, draftIgCaption: '' })}
        submitting={false}
        onSubmitCorrection={onSubmitCorrection}
        onDirtyChange={onDirtyChange}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Legenda do post' })).toHaveValue('');
  });

  it('reports a clean save so the host can close, but not with a comentário typed', () => {
    const onSavedClean = vi.fn();
    const props = {
      post: post(),
      submitting: false,
      onSubmitCorrection,
      onDirtyChange,
      onSavedClean,
    };
    const { rerender } = render(<CorrectionPanel {...props} edit={makeEdit()} />);
    rerender(<CorrectionPanel {...props} edit={makeEdit({ saveState: 'saved' })} />);
    expect(onSavedClean).toHaveBeenCalledTimes(1);

    onSavedClean.mockReset();
    rerender(<CorrectionPanel {...props} edit={makeEdit({ saveState: 'idle' })} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Descreva o que precisa mudar' }), {
      target: { value: 'trocar a foto' },
    });
    rerender(<CorrectionPanel {...props} edit={makeEdit({ saveState: 'saved' })} />);
    expect(onSavedClean).not.toHaveBeenCalled();
  });

  it('does not report a clean save when it mounts during the 3s "saved" window', () => {
    // Reopening Editar sugestão right after a save mounts the panel with saveState 'saved'.
    const onSavedClean = vi.fn();
    render(
      <CorrectionPanel
        post={post()}
        edit={makeEdit({ saveState: 'saved' })}
        submitting={false}
        onSubmitCorrection={onSubmitCorrection}
        onDirtyChange={onDirtyChange}
        onSavedClean={onSavedClean}
      />,
    );
    expect(onSavedClean).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run** `npx vitest run apps/hub/src/components/posts/__tests__/CorrectionPanel.test.tsx`. Expected: the first three new tests fail (the mount-window test passes trivially until `onSavedClean` exists; it guards the implementation).

- [ ] **Step 3: Implement**

In `CorrectionPanel.tsx`:

1. Import `suggestionAwareCaption` from `../../lib/postView`.
2. `export type SuggestionView = 'diff' | 'suggestion' | 'original';`
3. `SuggestionPendingNotice`: default `view = 'diff'`. At the top of the `detail` chain add the `'diff'` case:

```ts
  const detail =
    view === 'diff'
      ? t('shared.suggestionShowingDiff', 'Em vermelho o que você removeu, em verde o que acrescentou.')
      : view === 'original'
        ? /* existing original branch */
        : /* existing textChanged/captionChanged chain */;
```

   In the option group, render `option('diff', t('shared.suggestionViewDiff', 'Alterações'))` first, then the existing two. Add `aria-live="polite"` to the detail `<p>`, and add `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500` to the option button classes.
4. Props: add `/** Called after a successful save when nothing else (comentário/motivo) is unsent. */ onSavedClean?: () => void;` to `CorrectionPanelProps` and to the destructuring. Keep it in a ref, like `onDirtyChangeRef`:

```ts
  const onSavedCleanRef = useRef(onSavedClean);
  onSavedCleanRef.current = onSavedClean;
```

5. Destructure `suggestion` from `edit`. Replace `const captionBaseline = deriveCaption(post, draftIgCaption);` with:

```ts
  // Baseline: the caption the client actually sees. A pending suggestion's own caption wins even
  // when '' (see suggestionAwareCaption); otherwise the LEGENDA fallback applies.
  const captionBaseline = suggestionAwareCaption(post, suggestion);
```

   If `deriveCaption` and `draftIgCaption` are no longer used, drop them from the import/destructuring.
6. Replace `const showCaptionField = !isText || draftIgCaption !== null || !!post.ig_caption;` with:

```ts
  const showCaptionField = !isText || post.ig_caption != null || !!suggestion?.suggested_ig_caption;
```

   Keep the existing explanatory comment above it and add one line: "A text post's suggestion stores '' when it had no caption field, which must not reveal one."
7. The saved effect becomes the following. `onSavedClean` fires only on the TRANSITION into `'saved'`, never on mount. The hook holds `saveState === 'saved'` for 3s after a save (`useEditSuggestion.ts`, `savedTimerRef`), and effects run on mount, so reopening the panel within 3s would otherwise close it right away. The staged resets stay as they are today.

```ts
  const prevSaveStateRef = useRef(saveState);
  useEffect(() => {
    const enteredSaved = saveState === 'saved' && prevSaveStateRef.current !== 'saved';
    prevSaveStateRef.current = saveState;
    if (saveState === 'saved') {
      setStagedConteudo(draftConteudo);
      setStagedConteudoPlain(draftConteudoPlain);
      setStagedCaption(captionBaseline);
      if (enteredSaved && comentario.trim() === '' && motivo === null) onSavedCleanRef.current?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveState]);
```

8. Delete the `if (hasPendingSuggestion) { return <SuggestionPendingNotice />; }` early return.
9. In section 1, right after the "Editar texto/legenda" heading `<p>`:

```tsx
        {hasPendingSuggestion && (
          <p className="text-[12px] text-amber-800 dark:text-amber-300">
            {t(
              'shared.editingSuggestionNote',
              'Você está editando a sugestão que já enviou. As alterações anteriores continuam valendo.',
            )}
          </p>
        )}
```

10. In section 2, right after the "Solicitar correção" heading `<p>`:

```tsx
        {hasPendingSuggestion && (
          <p className="text-[12px] hub-tx3">
            {t(
              'shared.correctionBlockedBySuggestion',
              'Para pedir correção, aguarde a equipe revisar sua sugestão.',
            )}
          </p>
        )}
```

   The chips and "Enviar correção" are already disabled through `approvalBlocked`. The textarea stays editable, and typed comentário/motivo is kept.

- [ ] **Step 4: Run** the CorrectionPanel suite. Expected: PASS. Then `npx tsc -p apps/hub/tsconfig.json --noEmit`; it will still flag the dialog (Task 7) if `SuggestionView` usage breaks, and that's fine until Task 7.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components/posts/CorrectionPanel.tsx apps/hub/src/components/posts/__tests__/CorrectionPanel.test.tsx
git commit -m "feat(hub): painel de correção edita a sugestão pendente

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Hub — PostDetailDialog: Editar sugestão, footer save, default diff view

**Files:**
- Modify: `apps/hub/src/components/posts/PostDetailDialog.tsx`
- Test: `apps/hub/src/components/posts/__tests__/PostDetailDialog.test.tsx`

**Interfaces:**
- Consumes: `edit.suggestion` (Task 5), `SuggestionDiff` (Task 4), `suggestionAwareCaption` (Task 4), `onSavedClean` and the `'diff'` view (Task 6).

- [ ] **Step 1: Update existing tests and add failing ones**

In the suggestion `describe` block (~line 980):

- `explains a pending suggestion without opening Corrigir…` becomes:

```tsx
    it('offers Editar sugestão (enabled) for a pending suggestion while Aprovar stays disabled', () => {
      renderDialog(1, { posts: [post({ id: 1, pending_suggestion: suggestion })] });
      expect(screen.getByText(PENDING_NOTICE)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Editar sugestão/ })).toBeEnabled();
      expect(screen.queryByRole('button', { name: /Corrigir/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Aprovar/ })).toBeDisabled();
      expect(screen.queryByText(REJECTED_NOTICE)).not.toBeInTheDocument();
    });
```

- `says the body is the suggested version and toggles to the original`: after rendering, assert the default is the diff, then click "Sua sugestão" before the old assertions:

```tsx
      const changes = screen.getByRole('button', { name: 'Alterações' });
      expect(changes).toHaveAttribute('aria-pressed', 'true');
      expect(
        screen.getByText('Em vermelho o que você removeu, em verde o que acrescentou.'),
      ).toBeInTheDocument();
      expect(document.querySelector('[data-testid="suggestion-diff"] ins')).not.toBeNull();

      const mine = screen.getByRole('button', { name: 'Sua sugestão' });
      fireEvent.click(mine);
      expect(
        screen.getByText('Abaixo está a versão que você sugeriu. Você alterou o texto e a legenda.'),
      ).toBeInTheDocument();
      // …then the existing assertions from `expect(mine).toHaveAttribute('aria-pressed', 'true')` on.
```

- Run the test at ~line 1180-1210 (`Texto do post` tab with a suggestion) after the change and fix only what the new default view breaks. Its assertions are about the postText tab and the Original toggle, which keep their behaviour.

Add inside the same `describe`:

```tsx
    it('Editar sugestão edits the pending suggestion and saves the merged caption from the footer', async () => {
      vi.useFakeTimers();
      try {
        submitEditSuggestionMock.mockResolvedValue({
          ok: true,
          pending_suggestion: {
            ...suggestion,
            suggested_ig_caption: 'Legenda editada de novo',
            updated_at: '2026-04-28T11:00:00.000Z',
          },
        });
        renderDialog(1, {
          posts: [post({ id: 1, ig_caption: 'Legenda um', pending_suggestion: suggestion })],
        });
        fireEvent.click(screen.getByRole('button', { name: /Editar sugestão/ }));
        const caption = screen.getByRole('textbox', { name: 'Legenda do post' });
        expect(caption).toHaveValue('Legenda editada');
        fireEvent.change(caption, { target: { value: 'Legenda editada de novo' } });

        fireEvent.click(screen.getByRole('button', { name: /Salvar edição/ }));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1600);
        });

        expect(submitEditSuggestionMock).toHaveBeenCalledWith(
          'token-publico',
          1,
          null,
          'Corpo',
          'Legenda editada de novo',
        );
        // Clean save: the panel closes back to the reading view, which already shows the saved
        // suggestion as a diff before any refetch.
        expect(screen.queryByRole('textbox', { name: 'Legenda do post' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Alterações' })).toHaveAttribute('aria-pressed', 'true');
        expect(document.querySelector('[data-testid="suggestion-diff"]')?.textContent).toContain('de novo');
      } finally {
        vi.useRealTimers();
      }
    });
```

If this suite already uses a different timer pattern for saves (search it for `advanceTimersByTime`), follow that pattern instead.

- [ ] **Step 2: Run** `npx vitest run apps/hub/src/components/posts/__tests__/PostDetailDialog.test.tsx`. Expected: the updated and new tests fail.

- [ ] **Step 3: Implement** in `PostDetailDialog.tsx`

1. Imports: add `PencilLine` to the lucide import; `import { SuggestionDiff } from './SuggestionDiff';`; add `suggestionAwareCaption` to the `../../lib/postView` import.
2. `const suggestion = isPending ? edit.suggestion : null;` (was `post.pending_suggestion`). Update the comment above it: the hook's effective suggestion includes a just-saved one before the refetch.
3. `useState<SuggestionView>('diff')`.
4. Caption:

```ts
  const caption =
    showOriginal || !edit.isEditable
      ? deriveCaption(post, post.ig_caption)
      : suggestionAwareCaption(post, suggestion);
```

5. `const showSaveInFooter = showPanel && (contentDirty || dirty);` Update the comment: the save slot must also mount while editing a pending suggestion, or Salvar edição has nowhere to render.
6. Clean-save close handler (next to `closePanel`; it bypasses `guard()` on purpose, because the panel only calls it once nothing is unsent and a stale `panelDirty` would otherwise prompt):

```ts
  const handleSavedClean = useCallback(() => {
    setPanelOpen(false);
    setPanelDirty(false);
    setContentDirty(false);
    setSuggestionView('diff');
  }, []);
```

   Pass `onSavedClean={handleSavedClean}` to `<CorrectionPanel …>`.
7. Footer: the non-panel branch button becomes:

```tsx
                    <button
                      type="button"
                      onClick={() => {
                        setTab('content');
                        setPanelOpen(true);
                      }}
                      disabled={submitting || locked}
                      className="flex-1 flex items-center justify-center gap-1.5 hub-btn-secondary rounded-[4px] py-2.5 min-h-[44px] text-[13px] font-semibold disabled:opacity-50"
                    >
                      {edit.hasPendingSuggestion ? (
                        <>
                          <PencilLine size={15} aria-hidden="true" />{' '}
                          {t('shared.editSuggestion', 'Editar sugestão')}
                        </>
                      ) : (
                        <>
                          <AlertCircle size={15} /> {t('posts.correct', 'Corrigir')}
                        </>
                      )}
                    </button>
```

8. Reading view (the non-panel branch, where `{readingBody}` renders):

```tsx
                    {suggestion && suggestionView === 'diff' ? (
                      <SuggestionDiff post={post} suggestion={suggestion} />
                    ) : (
                      readingBody
                    )}
```

   `bodyConteudo`/`bodyPlain`/`textCaption`/`showPostTextTab` already treat any view other than `'original'` as the suggested version, so the postText tab shows the suggestion in diff mode.

- [ ] **Step 4: Run** the dialog suite, then the whole Hub suite, then Hub `tsc`:

```bash
npx vitest run apps/hub/src/components/posts/__tests__/PostDetailDialog.test.tsx
npx vitest run apps/hub
npx tsc -p apps/hub/tsconfig.json --noEmit
```
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components/posts/PostDetailDialog.tsx apps/hub/src/components/posts/__tests__/PostDetailDialog.test.tsx
git commit -m "feat(hub): botão Editar sugestão e diff como visão padrão da sugestão

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Gates + browser verification

- [ ] **Step 1: Full local gates**

```bash
npm run lint
npm run format:check || (npm run format && git diff --stat)
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run check:functions
npm run test:functions
ls node_modules/.deno 2>/dev/null && npm ci; git checkout deno.lock 2>/dev/null; git status --short
```
Expected: all green. Commit any formatter output as `style: prettier`.

- [ ] **Step 2: Browser verification of the Hub UI (read-only against prod)**

The migration and functions are NOT deployed, so saving must not hit prod. Follow memory `reference_hub_repro_patch_fetch_browser_pane.md`: start the Hub dev server (`npm run dev:env` pattern for the Hub, see CLAUDE.md), open a Hub post in the Browser pane with `window.fetch` patched to (a) inject a `pending_suggestion` into the `hub-posts` response for one `enviado_cliente` post and (b) answer `hub-edit-suggestion` locally with `{ ok: true, pending_suggestion: … }`. Verify at 375px and desktop, light and dark:
  - the reading view opens on "Alterações" with red/green words for text and caption;
  - "Editar sugestão" opens the editor filled with the suggestion; Salvar edição shows in the footer;
  - after saving, the panel closes and the diff shows the new text at once;
  - "Solicitar correção" shows the reason line with its controls disabled.
  Take screenshots for the PR.

- [ ] **Step 3: Re-check the migration version** (Global Constraints) and push the branch / open the PR only when the user asks.

## Deploy (user-approved, after merge readiness; not part of execution)

1. `npx supabase functions deploy hub-edit-suggestion --no-verify-jwt --use-api` and the same for `hub-approve`, from an up-to-date checkout (diff against `origin/main` first). They work against the old RPC bodies; the old functions would map the new RPC errors (`post_not_pending`, `pending_suggestion`) to 500, so they go first.
2. `npx supabase db push --linked` for the migration (prod ref `skjzpekeqefvlojenfsw`; check `supabase/.temp/project-ref`).
3. Merge (the frontend deploys on merge). The CRM sends `p_expected_updated_at`, which only the migrated `accept_edit_suggestion` accepts; the currently deployed CRM keeps working after step 2 (one-argument call, `DEFAULT NULL`).

Rollback: re-apply the previous bodies (`20260521000001` upsert, `20260830000003` notification, `20260925000010` record_client_approval) with `CREATE OR REPLACE`, then redeploy the previous two functions. For accept, `DROP FUNCTION accept_edit_suggestion(bigint, timestamptz)` first, then the `20260923000001` body and its grants (otherwise both overloads coexist and one-argument calls are ambiguous), after rolling back the CRM that sends the second argument.
