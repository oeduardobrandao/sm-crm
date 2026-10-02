# Duplicar post e duplicar fluxo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users duplicate a post or a whole fluxo, choosing between keeping each post's status or resetting everything to Rascunho.

**Architecture:** Two atomic `SECURITY DEFINER` Postgres RPCs (`duplicate_post`, `duplicate_workflow`) share one internal row-copy function (`_clone_post_row`), so a plan-limit error or any failure rolls back the whole copy. The CRM calls them through two thin store wrappers (`clonePost`, `cloneWorkflow`), and one `DuplicateDialog` component serves the four entry points (WorkflowDrawer post kebab, StandalonePostDrawer header, PostProcessCard kebab, WorkflowCard kebab).

**Tech Stack:** Postgres/plpgsql (Supabase migrations), psql test suites (`supabase/tests/entitlements`), React 19 + TanStack Query + shadcn Dialog, Vitest + Testing Library, `sonner` toasts, `lucide-react` icons.

**Spec:** `docs/superpowers/specs/2026-10-02-duplicate-posts-fluxos-design.md`. Read it before starting.

## Global Constraints

- Worktree: `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/stories-analytics-metrics-754b28` (lowercase `projects`). Run every command from there. Branch `claude/clone-duplicate-posts-fluxes-635fca`.
- Portuguese UI copy. **No em-dashes (`—`) in user-facing copy**; use a period or colon.
- Title suffix: `' (cópia)'` on the duplicated post (single-post duplicate) and on the duplicated fluxo. Posts copied as part of a fluxo keep their original title (no suffix).
- Status mapping: `p_to_rascunho = true` → `status = 'rascunho'`, `custom_status_id = null`. `false` → same `status` and `custom_status_id`, except `agendado`/`postado`/`falha_publicacao` → `'aprovado_cliente'` with `custom_status_id = null`.
- `scheduled_at` is always kept. Every Instagram/TikTok publish-result column is always reset.
- Media: new `post_file_links` rows pointing at the **same** `file_id` (never copy files).
- Permission: both RPCs require `has_permission_for(auth.uid(), conta, 'entregas', 'editar')`; the UI shows the entry points only when `can('entregas', 'editar') === true`.
- Grants: `REVOKE ALL ... FROM PUBLIC, anon` then `GRANT EXECUTE ... TO authenticated, service_role` on the two public RPCs. Internal helpers (`_clone_post_row`, `_remap_option_value`): `REVOKE ALL ... FROM PUBLIC, anon, authenticated` and `GRANT EXECUTE ... TO service_role`.
- Error identifiers raised by the RPCs (all `ERRCODE = 'P0001'`): `workspace_not_found`, `permission_denied`, `not_found`. Plan limits surface as the existing `plan_limit_exceeded:<key>`.
- Migration version prefixes must be unique and above `main`'s tail. Today's tail is `20261002000010`; this plan uses `20261002000020` and `20261002000021`. Re-check with `git fetch origin main && git ls-tree --name-only origin/main supabase/migrations/ | tail -3` right before opening the PR and renumber if needed.
- The migrations must be applied to prod **before** the PR merges (merge deploys the frontend).
- Do not touch the existing `duplicateWorkflow` in `apps/crm/src/store/workflows.ts` (recurrence copy).
- Before pushing: `npm run lint`, `npm run format:check`, the four `tsc` commands, `npm run test`. `npm run check:functions`/`test:functions` are unaffected (no edge function changes) but CI runs them anyway.

## Local database for the psql tasks (Tasks 1–2)

Docker here is colima. Other worktrees may hold the default Supabase ports, so use overrides:

```bash
colima status || colima start --cpu 4 --memory 8
cp supabase/config.toml /tmp/config.toml.dup-bak
cat >> supabase/config.toml <<'EOF'

[api]
port = 54421
[db]
port = 54422
[inbucket]
port = 54424
[studio]
port = 54425
EOF
npx supabase start
export SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
```

Apply new migrations with `npx supabase migration up --local`. When Tasks 1–2 are finished: `npx supabase stop && cp /tmp/config.toml.dup-bak supabase/config.toml`. **Never commit `supabase/config.toml` changes** (check `git diff --stat supabase/config.toml` is empty before each commit).

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/20261002000020_duplicate_post.sql` (create) | `_remap_option_value`, `_clone_post_row`, `duplicate_post` |
| `supabase/migrations/20261002000021_duplicate_workflow.sql` (create) | `duplicate_workflow` |
| `supabase/tests/entitlements/99_duplicate_post.sql` (create) | psql suite for the post RPC + column-classification guard |
| `supabase/tests/entitlements/99_duplicate_workflow.sql` (create) | psql suite for the fluxo RPC |
| `apps/crm/src/store/posts.ts` (modify) | `clonePost` |
| `apps/crm/src/store/workflows.ts` (modify) | `cloneWorkflow` |
| `apps/crm/src/store/__tests__/cloneRpcs.test.ts` (create) | store wrapper tests |
| `apps/crm/src/pages/entregas/components/DuplicateDialog.tsx` (create) | the dialog + `DuplicateTarget` type + `duplicateErrorMessage` |
| `apps/crm/src/pages/entregas/components/__tests__/DuplicateDialog.test.tsx` (create) | dialog tests |
| `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` (modify) | "Duplicar post" in the post kebab |
| `apps/crm/src/pages/entregas/components/StandalonePostDrawer.tsx` (modify) | "Duplicar post" header button |
| `apps/crm/src/pages/entregas/components/PostProcessCard.tsx` (modify) | "Duplicar post" kebab item |
| `apps/crm/src/pages/entregas/components/WorkflowCard.tsx` (modify) | "Duplicar fluxo" kebab item |
| `apps/crm/src/pages/entregas/views/KanbanView.tsx` (modify) | thread the two new callbacks to the cards |
| `apps/crm/src/pages/entregas/EntregasPage.tsx` (modify) | owns the board's `DuplicateDialog`, toasts, "Abrir" |
| `docs/superpowers/specs/2026-10-02-duplicate-posts-fluxos-design.md` (modify) | record the plan-time decisions (Task 8) |

---

### Task 1: `duplicate_post` RPC

**Files:**
- Create: `supabase/migrations/20261002000020_duplicate_post.sql`
- Test: `supabase/tests/entitlements/99_duplicate_post.sql`

**Interfaces:**
- Produces (SQL):
  - `public._remap_option_value(p_value jsonb, p_map jsonb) RETURNS jsonb`
  - `public._clone_post_row(p_conta uuid, p_src_post_id bigint, p_target_workflow_id bigint, p_to_rascunho boolean, p_option_map jsonb, p_solo boolean) RETURNS bigint` — `p_solo = true` means a single-post duplicate (suffix, place right after the original, clone the process); `false` means "part of a fluxo copy" (no suffix, keep `ordem`, `board_ordem = null`, no process).
  - `public.duplicate_post(p_post_id bigint, p_to_rascunho boolean) RETURNS bigint` (new post id).

Background the implementer needs:
- `workflow_posts` has `workflow_id NULL` for posts avulsos (then `cliente_id` is set explicitly). Trigger `post_a0_sync_cliente` derives `cliente_id` from the workflow on INSERT when `workflow_id` is set.
- `post_status_definitions.behaves_as` only allows the six non-publishing statuses, so a post in `agendado`/`postado`/`falha_publicacao` never has a `custom_status_id`.
- `post_file_link_auto_cover` (BEFORE INSERT on `post_file_links`) forces `is_cover = true` when the post has no cover yet, and there is a one-cover-per-post unique index. Insert the cover link first.
- `post_processes`/`post_process_steps` refuse client INSERTs; this function is `SECURITY DEFINER` so it can write them. `trg_feature_post_processes` raises `feature_disabled:feature_post_processes` on INSERT when the plan lacks the feature, so check `effective_plan_feature(conta, 'feature_post_processes')` first and skip the process when it's off.
- Every process-writing RPC takes `pg_advisory_xact_lock(hashtext(conta::text || ':post_move'))` first (see `20260919000004_apply_post_process.sql`). Do the same.
- Publicações board ranks (`board_ordem`, double) follow `apps/crm/src/pages/entregas/postsBoardOrder.ts`: columns are keyed by status/custom status, step is 1024, unranked posts sort after ranked ones.
- Select values are an `option_id` string; multiselect values are a string array.

- [ ] **Step 1: Start the local DB** (see "Local database" above) and confirm `psql "$SUPABASE_DB_URL" -c 'select 1'` works.

- [ ] **Step 2: Write the failing test suite**

Create `supabase/tests/entitlements/99_duplicate_post.sql`:

```sql
-- supabase/tests/entitlements/99_duplicate_post.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- duplicate_post (20261002000020). Cobre:
-- 99p.0 guarda de colunas: toda coluna de workflow_posts, post_file_links,
--       post_processes e post_process_steps esta classificada
-- 99p.1 "manter status": colunas copiadas, publicacao zerada, scheduled_at
--       mantido, sufixo, ordem logo depois, irmaos empurrados, links e capa
-- 99p.2 matriz de status nos dois modos (inclui status customizado)
-- 99p.3 board_ordem: ponto medio, +1024 sem vizinho, null quando muda de coluna
-- 99p.4 post individual: processo e steps clonados; sem a feature, sem processo
-- 99p.5 isolamento e grants: outra conta -> not_found; anon sem EXECUTE;
--       authenticated nao executa _clone_post_row
-- 99p.6 limite de plano desfaz tudo

create or replace function pg_temp.dp_env(
  out ws uuid, out usr uuid, out cli bigint, out wf bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws, nome = 'Dona' where id = usr;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (usr, ws, cli, 'WF', 'ativo') returning id into wf;
end $$;

create or replace function pg_temp.dp_as(p_usr uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- 99p.0 guarda de colunas. Se falhar: a coluna nova precisa entrar em
-- _clone_post_row (copiar ou zerar) E na lista abaixo.
begin;
do $$
declare v_missing text;
begin
  select string_agg(column_name, ', ' order by column_name) into v_missing
    from information_schema.columns
   where table_schema = 'public' and table_name = 'workflow_posts'
     and column_name not in (
       -- copiadas
       'titulo','conteudo','conteudo_plain','tipo','platform','responsavel_id',
       'ig_caption','music_note','cover_url','tiktok_caption','tiktok_title',
       'tiktok_settings','ig_trial_strategy','is_express','scheduled_at',
       'cliente_id','conta_id','workflow_id','ordem','status','custom_status_id',
       'board_ordem','created_via',
       -- zeradas (default da coluna)
       'instagram_container_id','instagram_media_id','instagram_permalink',
       'published_at','publish_error','publish_error_code','publish_retry_count',
       'publish_processing_at','story_segments','carousel_children',
       'tiktok_publish_id','tiktok_post_id','tiktok_post_url','tiktok_publish_status',
       'tiktok_publish_error','tiktok_publish_retry_count','tiktok_publish_processing_at',
       'media_autocleaned_at',
       -- geradas pelo banco
       'id','created_at','updated_at');
  assert v_missing is null, format('workflow_posts tem coluna nao classificada em _clone_post_row: %s', v_missing);

  select string_agg(column_name, ', ' order by column_name) into v_missing
    from information_schema.columns
   where table_schema = 'public' and table_name = 'post_file_links'
     and column_name not in ('id','post_id','file_id','conta_id','is_cover','sort_order','created_at');
  assert v_missing is null, format('post_file_links tem coluna nao classificada: %s', v_missing);

  select string_agg(column_name, ', ' order by column_name) into v_missing
    from information_schema.columns
   where table_schema = 'public' and table_name = 'post_processes'
     and column_name not in ('id','conta_id','post_id','template_id','template_nome',
       'assinatura','origem_workflow_id','origem_descricao','estado','motivo_encerramento',
       'etapa_atual','modo_prazo','board_position','revisao','created_by','created_at',
       'updated_at','concluido_em');
  assert v_missing is null, format('post_processes tem coluna nao classificada: %s', v_missing);

  select string_agg(column_name, ', ' order by column_name) into v_missing
    from information_schema.columns
   where table_schema = 'public' and table_name = 'post_process_steps'
     and column_name not in ('id','conta_id','process_id','ordem','nome','tipo',
       'responsavel_id','prazo_dias','tipo_prazo','prazo_efetivo','estado','iniciado_em',
       'concluido_em','interrompido_em','origem_etapa_ordem','origem_etapa_nome');
  assert v_missing is null, format('post_process_steps tem coluna nao classificada: %s', v_missing);
  raise notice 'PASS 99p.0';
end $$;
rollback;

-- 99p.1 manter status: copia, zera publicacao, posiciona, linka midia
begin;
select et_grant_hosted_parity();
do $$
declare
  e record; v_m bigint; p1 bigint; p2 bigint; p3 bigint; v_new bigint;
  f1 bigint; f2 bigint; f3 bigint; r record; v_n int; v_refs int;
begin
  e := pg_temp.dp_env();
  insert into membros (user_id, conta_id, nome, cargo, tipo)
    values (e.usr, e.ws, 'M', 'x', 'clt') returning id into v_m;
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem, status) values
    (e.wf, e.ws, 'Antes', 0, 'rascunho') returning id into p1;
  insert into workflow_posts (
      workflow_id, conta_id, titulo, ordem, status, tipo, platform, responsavel_id,
      conteudo, conteudo_plain, ig_caption, music_note, scheduled_at,
      instagram_container_id, instagram_media_id, instagram_permalink, publish_error,
      publish_retry_count, story_segments, tiktok_post_id)
    values (e.wf, e.ws, 'Original', 1, 'enviado_cliente', 'carrossel', 'instagram', v_m,
      '{"type":"doc"}', 'texto', 'Legenda', 'musica', timestamptz '2026-11-05 15:00+00',
      'c1', 'm1', 'https://instagram.com/p/x', 'erro', 2, '[{"file_id":1}]', 'tt1')
    returning id into p2;
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem, status) values
    (e.wf, e.ws, 'Depois', 2, 'rascunho') returning id into p3;

  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes) values
    (e.ws, 'k1', 'f1', 'image', 'image/png', 10) returning id into f1;
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes) values
    (e.ws, 'k2', 'f2', 'image', 'image/png', 10) returning id into f2;
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes) values
    (e.ws, 'k3', 'f3', 'image', 'image/png', 10) returning id into f3;
  -- f1 entra primeiro (o auto-cover a marcaria), depois a capa vira f2.
  insert into post_file_links (post_id, file_id, conta_id, sort_order) values (p2, f1, e.ws, 0);
  update post_file_links set is_cover = false where post_id = p2;
  insert into post_file_links (post_id, file_id, conta_id, sort_order, is_cover) values (p2, f2, e.ws, 1, true);
  insert into post_file_links (post_id, file_id, conta_id, sort_order) values (p2, f3, e.ws, 2);

  perform pg_temp.dp_as(e.usr);
  v_new := duplicate_post(p2, false);
  execute 'reset role';

  select * into r from workflow_posts where id = v_new;
  assert r.titulo = 'Original (cópia)', format('titulo: %s', r.titulo);
  assert r.workflow_id = e.wf and r.cliente_id = e.cli, 'fluxo/cliente';
  assert r.status = 'enviado_cliente', format('status: %s', r.status);
  assert r.tipo = 'carrossel' and r.platform = 'instagram' and r.responsavel_id = v_m, 'tipo/platform/resp';
  assert r.conteudo = '{"type":"doc"}'::jsonb and r.conteudo_plain = 'texto', 'conteudo';
  assert r.ig_caption = 'Legenda' and r.music_note = 'musica', 'legenda/musica';
  assert r.scheduled_at = timestamptz '2026-11-05 15:00+00', 'scheduled_at mantido';
  assert r.instagram_container_id is null and r.instagram_media_id is null
     and r.instagram_permalink is null and r.publish_error is null
     and r.publish_retry_count = 0 and r.story_segments is null
     and r.tiktok_post_id is null and r.published_at is null, 'publicacao zerada';
  assert r.created_via = 'human', 'created_via';
  assert r.ordem = 2, format('ordem do clone: %s', r.ordem);
  assert (select ordem from workflow_posts where id = p3) = 3, 'irmao depois do original empurrado';
  assert (select ordem from workflow_posts where id = p1) = 0, 'irmao antes do original intocado';

  select count(*) into v_n from post_file_links where post_id = v_new;
  assert v_n = 3, format('links: %s', v_n);
  assert (select file_id from post_file_links where post_id = v_new and is_cover) = f2, 'capa preservada';
  assert (select sort_order from post_file_links where post_id = v_new and file_id = f3) = 2, 'sort_order';
  select reference_count into v_refs from files where id = f1;
  assert v_refs = 2, format('reference_count de f1: %s', v_refs);
  raise notice 'PASS 99p.1';
end $$;
rollback;

-- 99p.2 matriz de status
begin;
select et_grant_hosted_parity();
do $$
declare
  e record; v_def uuid; v_src bigint; v_new bigint; v_st text; v_cs uuid;
  s text;
begin
  e := pg_temp.dp_env();
  insert into post_status_definitions (conta_id, nome, behaves_as)
    values (e.ws, 'Em design', 'revisao_interna') returning id into v_def;

  foreach s in array array['rascunho','revisao_interna','aprovado_interno','enviado_cliente',
                           'aprovado_cliente','correcao_cliente','agendado','postado','falha_publicacao'] loop
    insert into workflow_posts (workflow_id, conta_id, titulo, status)
      values (e.wf, e.ws, s, s) returning id into v_src;
    perform pg_temp.dp_as(e.usr);
    v_new := duplicate_post(v_src, false);
    execute 'reset role';
    select status into v_st from workflow_posts where id = v_new;
    if s in ('agendado','postado','falha_publicacao') then
      assert v_st = 'aprovado_cliente', format('manter %s -> %s', s, v_st);
    else
      assert v_st = s, format('manter %s -> %s', s, v_st);
    end if;
    perform pg_temp.dp_as(e.usr);
    v_new := duplicate_post(v_src, true);
    execute 'reset role';
    select status into v_st from workflow_posts where id = v_new;
    assert v_st = 'rascunho', format('rascunho %s -> %s', s, v_st);
  end loop;

  -- status customizado: mantido no modo manter, zerado no modo rascunho
  insert into workflow_posts (workflow_id, conta_id, titulo, status, custom_status_id)
    values (e.wf, e.ws, 'custom', 'revisao_interna', v_def) returning id into v_src;
  perform pg_temp.dp_as(e.usr);
  v_new := duplicate_post(v_src, false);
  execute 'reset role';
  select status, custom_status_id into v_st, v_cs from workflow_posts where id = v_new;
  assert v_st = 'revisao_interna' and v_cs = v_def, format('custom manter: %s %s', v_st, v_cs);
  perform pg_temp.dp_as(e.usr);
  v_new := duplicate_post(v_src, true);
  execute 'reset role';
  select status, custom_status_id into v_st, v_cs from workflow_posts where id = v_new;
  assert v_st = 'rascunho' and v_cs is null, format('custom rascunho: %s %s', v_st, v_cs);
  raise notice 'PASS 99p.2';
end $$;
rollback;

-- 99p.3 board_ordem
begin;
select et_grant_hosted_parity();
do $$
declare e record; a bigint; b bigint; c bigint; u bigint; v_new bigint; v_bo double precision;
begin
  e := pg_temp.dp_env();
  insert into workflow_posts (workflow_id, conta_id, titulo, status, board_ordem)
    values (e.wf, e.ws, 'A', 'revisao_interna', 1024) returning id into a;
  insert into workflow_posts (workflow_id, conta_id, titulo, status, board_ordem)
    values (e.wf, e.ws, 'B', 'revisao_interna', 2048) returning id into b;
  insert into workflow_posts (workflow_id, conta_id, titulo, status, board_ordem)
    values (e.wf, e.ws, 'C', 'aprovado_interno', 5000) returning id into c;
  insert into workflow_posts (workflow_id, conta_id, titulo, status)
    values (e.wf, e.ws, 'U', 'revisao_interna') returning id into u;

  perform pg_temp.dp_as(e.usr);
  v_new := duplicate_post(a, false);                    -- mesma coluna, vizinho B
  select board_ordem into v_bo from workflow_posts where id = v_new;
  assert v_bo = 1536, format('ponto medio: %s', v_bo);

  v_new := duplicate_post(b, false);                    -- mesma coluna, sem vizinho ranqueado depois
  select board_ordem into v_bo from workflow_posts where id = v_new;
  assert v_bo = 3072, format('+1024: %s', v_bo);

  v_new := duplicate_post(a, true);                     -- vira rascunho: outra coluna
  select board_ordem into v_bo from workflow_posts where id = v_new;
  assert v_bo is null, format('outra coluna: %s', v_bo);

  v_new := duplicate_post(u, false);                    -- original sem ranque
  select board_ordem into v_bo from workflow_posts where id = v_new;
  assert v_bo is null, format('sem ranque: %s', v_bo);
  execute 'reset role';
  raise notice 'PASS 99p.3';
end $$;
rollback;

-- 99p.4 post individual
begin;
select et_grant_hosted_parity();
do $$
declare e record; v_post bigint; v_proc bigint; v_new bigint; r record; v_n int;
begin
  e := pg_temp.dp_env();
  update plans set feature_post_processes = true where id = (select plan_id from workspaces where id = e.ws);
  insert into workflow_posts (conta_id, cliente_id, titulo, status)
    values (e.ws, e.cli, 'Avulso', 'revisao_interna') returning id into v_post;
  insert into post_processes (conta_id, post_id, assinatura, estado, etapa_atual, board_position)
    values (e.ws, v_post, '0|Copy|padrao' || chr(10) || '1|Design|padrao', 'ativo', 1, 4)
    returning id into v_proc;
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, estado, concluido_em)
    values (e.ws, v_proc, 0, 'Copy', 'padrao', 'concluido', timestamptz '2026-10-01 10:00+00');
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, estado, iniciado_em)
    values (e.ws, v_proc, 1, 'Design', 'padrao', 'ativo', timestamptz '2026-10-01 10:00+00');

  perform pg_temp.dp_as(e.usr);
  v_new := duplicate_post(v_post, false);
  execute 'reset role';

  select * into r from workflow_posts where id = v_new;
  assert r.workflow_id is null and r.cliente_id = e.cli, 'clone avulso no mesmo cliente';
  select * into r from post_processes where post_id = v_new;
  assert found, 'processo clonado';
  assert r.estado = 'ativo' and r.etapa_atual = 1 and r.revisao = 1 and r.created_by = e.usr,
    format('processo: %s %s %s', r.estado, r.etapa_atual, r.revisao);
  assert r.board_position = 5, format('board_position no fim: %s', r.board_position);
  select count(*) into v_n from post_process_steps where process_id = r.id;
  assert v_n = 2, format('steps: %s', v_n);
  assert (select estado from post_process_steps where process_id = r.id and ordem = 1) = 'ativo', 'etapa ativa mantida';

  -- sem a feature: clone sem processo, sem erro
  update plans set feature_post_processes = false where id = (select plan_id from workspaces where id = e.ws);
  perform pg_temp.dp_as(e.usr);
  v_new := duplicate_post(v_post, false);
  execute 'reset role';
  assert not exists (select 1 from post_processes where post_id = v_new), 'sem feature: sem processo';
  raise notice 'PASS 99p.4';
end $$;
rollback;

-- 99p.5 isolamento e grants
begin;
select et_grant_hosted_parity();
do $$
declare e record; o record; v_post bigint; v_raised boolean;
begin
  e := pg_temp.dp_env();
  o := pg_temp.dp_env();
  insert into workflow_posts (workflow_id, conta_id, titulo) values (e.wf, e.ws, 'P') returning id into v_post;

  perform pg_temp.dp_as(o.usr);
  v_raised := false;
  begin
    perform duplicate_post(v_post, false);
  exception when others then
    v_raised := true;
    assert sqlerrm = 'not_found', format('outra conta: %s', sqlerrm);
  end;
  assert v_raised, 'outra conta duplicou o post';
  assert (select count(*) from workflow_posts where workflow_id = e.wf) = 1, 'nada criado';

  v_raised := false;
  begin
    perform _clone_post_row(e.ws, v_post, e.wf, false, '{}'::jsonb, true);
  exception when insufficient_privilege then v_raised := true;
  end;
  assert v_raised, 'authenticated executa _clone_post_row';
  execute 'reset role';

  assert not has_function_privilege('anon', 'public.duplicate_post(bigint, boolean)', 'EXECUTE'),
    'anon tem EXECUTE em duplicate_post';
  assert has_function_privilege('service_role', 'public.duplicate_post(bigint, boolean)', 'EXECUTE'),
    'service_role sem EXECUTE em duplicate_post';
  raise notice 'PASS 99p.5';
end $$;
rollback;

-- 99p.6 limite de plano desfaz tudo (max_posts_per_workflow = 2)
begin;
select et_grant_hosted_parity();
do $$
declare e record; p1 bigint; p2 bigint; v_raised boolean;
begin
  e := pg_temp.dp_env();
  insert into workspace_plan_overrides (workspace_id, resource_overrides)
    values (e.ws, '{"max_posts_per_workflow": 2}'::jsonb);
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem) values (e.wf, e.ws, 'P1', 0) returning id into p1;
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem) values (e.wf, e.ws, 'P2', 1) returning id into p2;

  perform pg_temp.dp_as(e.usr);
  v_raised := false;
  begin
    perform duplicate_post(p1, false);
  exception when others then
    v_raised := true;
    assert sqlerrm like 'plan_limit_exceeded:max_posts_per_workflow%', format('msg: %s', sqlerrm);
  end;
  execute 'reset role';
  assert v_raised, 'limite nao barrou';
  assert (select count(*) from workflow_posts where workflow_id = e.wf) = 2, 'post criado apesar do limite';
  assert (select ordem from workflow_posts where id = p2) = 1, 'empurrao de ordem nao foi desfeito';
  raise notice 'PASS 99p.6';
end $$;
rollback;
```

If `workspace_plan_overrides.resource_overrides` uses a different shape for `max_posts_per_workflow` in your checkout, mirror `supabase/tests/entitlements/70_workflow_posts_avulsos.sql` instead of guessing.

- [ ] **Step 3: Run it and confirm it fails**

Run: `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_duplicate_post.sql`
Expected: 99p.0 passes (`PASS 99p.0`), 99p.1 fails with `function duplicate_post(bigint, boolean) does not exist`. If 99p.0 fails, a column exists that this plan doesn't know about: decide copy vs. reset for it, add it to the list in the test **and** to `_clone_post_row` in Step 4.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20261002000020_duplicate_post.sql`:

```sql
-- supabase/migrations/20261002000020_duplicate_post.sql
-- Duplicar post (spec docs/superpowers/specs/2026-10-02-duplicate-posts-fluxos-design.md).
--
-- _remap_option_value: troca option_ids de select/multiselect/status pelo mapa
--   que a copia de fluxo monta (option_id e UNIQUE global, entao o fluxo novo
--   precisa de ids novos). Select guarda o option_id como string; multiselect,
--   como array de strings.
-- _clone_post_row: a copia de UM post, compartilhada por duplicate_post e
--   duplicate_workflow. p_solo = true e o "Duplicar post" (sufixo, logo depois
--   do original, processo clonado); false e um post dentro da copia de fluxo
--   (sem sufixo, mesma ordem, sem ranque no quadro).
-- duplicate_post: a RPC do botao.
--
-- SECURITY DEFINER porque post_processes/post_process_steps recusam INSERT de
-- authenticated. A checagem de conta e de permissao e explicita no comeco.
-- Status: agendado/postado/falha_publicacao viram aprovado_cliente no modo
-- "manter" (o clone nunca publica sozinho: auto-publicacao so roda em
-- hub-approve). scheduled_at e mantido; o servidor recusa agendar com menos
-- de 10 minutos de antecedencia (validateForScheduling), entao uma data antiga
-- obriga a escolher outra.

CREATE OR REPLACE FUNCTION public._remap_option_value(p_value jsonb, p_map jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR p_map IS NULL OR p_map = '{}'::jsonb THEN p_value
    WHEN jsonb_typeof(p_value) = 'string'
      THEN coalesce(p_map -> (p_value #>> '{}'), p_value)
    WHEN jsonb_typeof(p_value) = 'array' THEN (
      SELECT coalesce(
               jsonb_agg(
                 CASE WHEN jsonb_typeof(t.e) = 'string'
                      THEN coalesce(p_map -> (t.e #>> '{}'), t.e)
                      ELSE t.e END
                 ORDER BY t.i),
               '[]'::jsonb)
        FROM jsonb_array_elements(p_value) WITH ORDINALITY AS t(e, i))
    ELSE p_value
  END
$$;

REVOKE ALL ON FUNCTION public._remap_option_value(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._remap_option_value(jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public._clone_post_row(
  p_conta              uuid,
  p_src_post_id        bigint,
  p_target_workflow_id bigint,
  p_to_rascunho        boolean,
  p_option_map         jsonb,
  p_solo               boolean
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s          workflow_posts%ROWTYPE;
  v_status   text;
  v_custom   uuid;
  v_ordem    integer;
  v_board    double precision := NULL;
  v_next     double precision;
  v_mid      double precision;
  v_new      bigint;
  pp         post_processes%ROWTYPE;
  v_proc     bigint;
  v_pos      integer;
BEGIN
  SELECT * INTO s FROM workflow_posts WHERE id = p_src_post_id AND conta_id = p_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0001';
  END IF;

  IF p_to_rascunho THEN
    v_status := 'rascunho';            v_custom := NULL;
  ELSIF s.status IN ('agendado', 'postado', 'falha_publicacao') THEN
    v_status := 'aprovado_cliente';    v_custom := NULL;
  ELSE
    v_status := s.status;              v_custom := s.custom_status_id;
  END IF;

  IF p_solo THEN
    -- Logo depois do original. Avulso nao tem irmaos ordenados (createAvulsoPost
    -- grava ordem 0), entao so posts de fluxo empurram os seguintes.
    v_ordem := s.ordem + CASE WHEN s.workflow_id IS NULL THEN 0 ELSE 1 END;
    IF s.workflow_id IS NOT NULL THEN
      UPDATE workflow_posts
         SET ordem = ordem + 1
       WHERE conta_id = p_conta AND workflow_id = s.workflow_id AND ordem > s.ordem;
    END IF;

    -- Quadro de Publicacoes: so ranqueia quando o original tem ranque e o clone
    -- cai na MESMA coluna (mesmo status e status customizado). Senao, null:
    -- entra na cauda automatica da coluna (postsBoardOrder.ts).
    IF s.board_ordem IS NOT NULL
       AND v_status = s.status
       AND v_custom IS NOT DISTINCT FROM s.custom_status_id THEN
      SELECT min(wp.board_ordem) INTO v_next
        FROM workflow_posts wp
       WHERE wp.conta_id = p_conta
         AND wp.status = v_status
         AND wp.custom_status_id IS NOT DISTINCT FROM v_custom
         AND wp.board_ordem > s.board_ordem;
      IF v_next IS NULL THEN
        v_board := s.board_ordem + 1024;
      ELSE
        v_mid := (s.board_ordem + v_next) / 2;
        IF v_mid > s.board_ordem AND v_mid < v_next THEN
          v_board := v_mid;
        END IF;
      END IF;
    END IF;
  ELSE
    v_ordem := s.ordem;
  END IF;

  INSERT INTO workflow_posts (
    workflow_id, conta_id, cliente_id, titulo, conteudo, conteudo_plain, tipo,
    ordem, status, custom_status_id, responsavel_id, platform, ig_caption,
    music_note, cover_url, tiktok_caption, tiktok_title, tiktok_settings,
    ig_trial_strategy, is_express, scheduled_at, board_ordem, created_via)
  VALUES (
    p_target_workflow_id, p_conta, s.cliente_id,
    s.titulo || CASE WHEN p_solo THEN ' (cópia)' ELSE '' END,
    s.conteudo, s.conteudo_plain, s.tipo,
    v_ordem, v_status, v_custom, s.responsavel_id, s.platform, s.ig_caption,
    s.music_note, s.cover_url, s.tiktok_caption, s.tiktok_title, s.tiktok_settings,
    s.ig_trial_strategy, s.is_express, s.scheduled_at, v_board, 'human')
  RETURNING id INTO v_new;

  -- Midia: mesmos arquivos (reference_count sobe por trigger). Capa primeiro,
  -- para o auto-cover nao escolher outra.
  INSERT INTO post_file_links (post_id, file_id, conta_id, sort_order, is_cover)
  SELECT v_new, l.file_id, l.conta_id, l.sort_order, true
    FROM post_file_links l
   WHERE l.post_id = s.id AND l.is_cover;
  INSERT INTO post_file_links (post_id, file_id, conta_id, sort_order, is_cover)
  SELECT v_new, l.file_id, l.conta_id, l.sort_order, false
    FROM post_file_links l
   WHERE l.post_id = s.id AND NOT l.is_cover
   ORDER BY l.sort_order, l.id;

  -- Propriedades: opcoes por fluxo passam pelo mapa (vazio na copia de post).
  INSERT INTO post_property_values (post_id, property_definition_id, value)
  SELECT v_new, v.property_definition_id,
         CASE WHEN d.type IN ('select', 'multiselect', 'status')
              THEN public._remap_option_value(v.value, p_option_map)
              ELSE v.value END
    FROM post_property_values v
    JOIN template_property_definitions d ON d.id = v.property_definition_id
   WHERE v.post_id = s.id;

  -- Processo do post individual: so na copia de post avulso e com a feature
  -- ligada (o trigger trg_feature_post_processes recusaria o INSERT).
  IF p_solo AND s.workflow_id IS NULL
     AND effective_plan_feature(p_conta, 'feature_post_processes') THEN
    SELECT * INTO pp FROM post_processes
     WHERE post_id = s.id AND conta_id = p_conta AND estado IN ('ativo', 'concluido');
    IF FOUND THEN
      -- Fim da coluna, como apply_post_process: empurrar os outros mexeria em
      -- linhas que o quadro aberto de outra pessoa esta vendo.
      SELECT coalesce(max(x.board_position), -1) + 1 INTO v_pos
        FROM post_processes x WHERE x.conta_id = p_conta;
      INSERT INTO post_processes (
        conta_id, post_id, template_id, template_nome, assinatura,
        origem_workflow_id, origem_descricao, estado, etapa_atual, modo_prazo,
        board_position, revisao, created_by, concluido_em)
      VALUES (
        p_conta, v_new, pp.template_id, pp.template_nome, pp.assinatura,
        pp.origem_workflow_id, pp.origem_descricao, pp.estado, pp.etapa_atual,
        pp.modo_prazo, v_pos, 1, auth.uid(), pp.concluido_em)
      RETURNING id INTO v_proc;

      INSERT INTO post_process_steps (
        conta_id, process_id, ordem, nome, tipo, responsavel_id, prazo_dias,
        tipo_prazo, prazo_efetivo, estado, iniciado_em, concluido_em,
        interrompido_em, origem_etapa_ordem, origem_etapa_nome)
      SELECT p_conta, v_proc, st.ordem, st.nome, st.tipo, st.responsavel_id,
             st.prazo_dias, st.tipo_prazo, st.prazo_efetivo, st.estado,
             st.iniciado_em, st.concluido_em, st.interrompido_em,
             st.origem_etapa_ordem, st.origem_etapa_nome
        FROM post_process_steps st
       WHERE st.process_id = pp.id
       ORDER BY st.ordem;
    END IF;
  END IF;

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public._clone_post_row(uuid, bigint, bigint, boolean, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._clone_post_row(uuid, bigint, bigint, boolean, jsonb, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.duplicate_post(p_post_id bigint, p_to_rascunho boolean)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta uuid := public.get_my_conta_id();
  v_wf    bigint;
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF public.has_permission_for(auth.uid(), v_conta, 'entregas', 'editar') IS NOT TRUE THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  SELECT wp.workflow_id INTO v_wf
    FROM workflow_posts wp
   WHERE wp.id = p_post_id AND wp.conta_id = v_conta
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0001';
  END IF;

  RETURN public._clone_post_row(v_conta, p_post_id, v_wf, coalesce(p_to_rascunho, false), '{}'::jsonb, true);
END;
$$;

REVOKE ALL ON FUNCTION public.duplicate_post(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duplicate_post(bigint, boolean) TO authenticated, service_role;
```

- [ ] **Step 5: Apply and run the suite**

Run: `npx supabase migration up --local && psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_duplicate_post.sql`
Expected: `PASS 99p.0` through `PASS 99p.6`, exit 0.

Likely snags and how to resolve them (do not loosen the assertion; fix the cause):
- `post_file_links` trigger rejects the insert or `reference_count` is off: read `supabase/migrations/20260425000002_file_system_triggers.sql` and adapt the fixture, not the function.
- 99p.1 `files` insert fails on a newer NOT NULL column: add it to the fixture from `20260425000001` + later `ALTER TABLE files` migrations.
- `post_processes` INSERT rejected by a hardening trigger (`20260919000002_post_process_hardening.sql`): read it; the clone must satisfy the same invariants as `apply_post_process`.

- [ ] **Step 6: Run the whole DB suite once** to make sure nothing else broke.

Run: `npm run test:db`
Expected: every file PASS.

- [ ] **Step 7: Commit**

```bash
git diff --stat supabase/config.toml   # must print nothing
git add supabase/migrations/20261002000020_duplicate_post.sql supabase/tests/entitlements/99_duplicate_post.sql
git commit -m "feat(entregas): RPC duplicate_post

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `duplicate_workflow` RPC

**Files:**
- Create: `supabase/migrations/20261002000021_duplicate_workflow.sql`
- Test: `supabase/tests/entitlements/99_duplicate_workflow.sql`

**Interfaces:**
- Consumes: `public._clone_post_row(uuid, bigint, bigint, boolean, jsonb, boolean)` from Task 1.
- Produces: `public.duplicate_workflow(p_workflow_id bigint, p_to_rascunho boolean) RETURNS bigint` (new workflow id).

Background:
- `workflows` columns copied: `cliente_id, template_id, status, etapa_atual, recorrente, modo_prazo, link_notion, link_drive, concluido_em`. `position` is only a kanban order; the `workflows_updated_event` trigger explicitly does not watch it, so shifting it on other rows logs nothing.
- `workflow_etapas` has no `conta_id`; columns: `workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo, status, iniciado_em, concluido_em, data_limite`.
- `workflow_select_options`: `workflow_id, property_definition_id, conta_id, option_id (uuid, UNIQUE, default gen_random_uuid()), label, color`.
- `trg_limit_workflows` (`max_active_workflows_per_client`) fires on INSERT of an `ativo` workflow; `trg_limit_posts` fires per post.

- [ ] **Step 1: Write the failing test suite**

Create `supabase/tests/entitlements/99_duplicate_workflow.sql`:

```sql
-- supabase/tests/entitlements/99_duplicate_workflow.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- duplicate_workflow (20261002000021). Cobre:
-- 99w.1 fluxo: titulo, campos, etapas no mesmo estado, posicao logo depois
-- 99w.2 posts: todos copiados sem sufixo, mesma ordem, status pelo modo, midia
-- 99w.3 opcoes: option_id novo e valores select/multiselect remapeados;
--       texto que nao e opcao fica igual
-- 99w.4 isolamento e grants
-- 99w.5 limite de fluxos ativos desfaz tudo

create or replace function pg_temp.dw_env(
  out ws uuid, out usr uuid, out cli bigint, out tmpl bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws, nome = 'Dona' where id = usr;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflow_templates (user_id, conta_id, nome, etapas)
    values (usr, ws, 'T', '[]'::jsonb) returning id into tmpl;
end $$;

create or replace function pg_temp.dw_as(p_usr uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

begin;
select et_grant_hosted_parity();
do $$
declare
  e record; wf bigint; wf_other bigint; v_new bigint; r record; v_n int;
  p1 bigint; p2 bigint; f1 bigint;
  d_sel bigint; d_multi bigint; d_txt bigint;
  o1 uuid; o2 uuid; n1 uuid; n2 uuid;
  v_val jsonb;
begin
  e := pg_temp.dw_env();
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, template_id,
                         etapa_atual, recorrente, position, modo_prazo, link_notion)
    values (e.usr, e.ws, e.cli, 'Mensal', 'ativo', e.tmpl, 1, true, 3, 'data_fixa', 'https://n.so/x')
    returning id into wf;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, position)
    values (e.usr, e.ws, e.cli, 'Outro', 'ativo', 4) returning id into wf_other;

  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, concluido_em, data_limite)
    values (wf, 0, 'Copy', 2, 'corridos', 'padrao', 'concluido', timestamptz '2026-10-01 10:00+00', date '2026-10-01');
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, iniciado_em, data_limite)
    values (wf, 1, 'Aprovação', 3, 'uteis', 'aprovacao_cliente', 'ativo', timestamptz '2026-10-01 10:00+00', date '2026-10-06');

  insert into workflow_posts (workflow_id, conta_id, titulo, ordem, status, scheduled_at)
    values (wf, e.ws, 'Post 1', 0, 'agendado', timestamptz '2026-11-01 12:00+00') returning id into p1;
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem, status)
    values (wf, e.ws, 'Post 2', 1, 'enviado_cliente') returning id into p2;
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (e.ws, 'k1', 'f1', 'image', 'image/png', 10) returning id into f1;
  insert into post_file_links (post_id, file_id, conta_id, sort_order) values (p1, f1, e.ws, 0);

  insert into template_property_definitions (template_id, conta_id, name, type)
    values (e.tmpl, e.ws, 'Formato', 'select') returning id into d_sel;
  insert into template_property_definitions (template_id, conta_id, name, type)
    values (e.tmpl, e.ws, 'Tags', 'multiselect') returning id into d_multi;
  insert into template_property_definitions (template_id, conta_id, name, type)
    values (e.tmpl, e.ws, 'Nota', 'text') returning id into d_txt;
  insert into workflow_select_options (workflow_id, property_definition_id, conta_id, label, color)
    values (wf, d_sel, e.ws, 'Vídeo', '#f00') returning option_id into o1;
  insert into workflow_select_options (workflow_id, property_definition_id, conta_id, label)
    values (wf, d_multi, e.ws, 'Promo') returning option_id into o2;
  insert into post_property_values (post_id, property_definition_id, value) values
    (p1, d_sel, to_jsonb(o1::text)),
    (p1, d_multi, jsonb_build_array(o2::text, 'opcao-do-template')),
    (p1, d_txt, to_jsonb(o1::text));   -- texto que parece uuid: nao remapeia

  perform pg_temp.dw_as(e.usr);
  v_new := duplicate_workflow(wf, false);
  execute 'reset role';

  -- 99w.1
  select * into r from workflows where id = v_new;
  assert r.titulo = 'Mensal (cópia)', format('titulo: %s', r.titulo);
  assert r.cliente_id = e.cli and r.template_id = e.tmpl and r.status = 'ativo'
     and r.etapa_atual = 1 and r.recorrente and r.modo_prazo = 'data_fixa'
     and r.link_notion = 'https://n.so/x' and r.user_id = e.usr and r.created_via = 'human', 'campos do fluxo';
  assert r.position = 4, format('position do clone: %s', r.position);
  assert (select position from workflows where id = wf_other) = 5, 'fluxo seguinte empurrado';
  assert (select position from workflows where id = wf) = 3, 'original intocado';
  select count(*) into v_n from workflow_etapas where workflow_id = v_new;
  assert v_n = 2, format('etapas: %s', v_n);
  select * into r from workflow_etapas where workflow_id = v_new and ordem = 1;
  assert r.status = 'ativo' and r.tipo = 'aprovacao_cliente' and r.data_limite = date '2026-10-06'
     and r.iniciado_em = timestamptz '2026-10-01 10:00+00', 'etapa ativa no mesmo estado';
  assert (select status from workflow_etapas where workflow_id = v_new and ordem = 0) = 'concluido', 'etapa concluida';
  raise notice 'PASS 99w.1';

  -- 99w.2
  select count(*) into v_n from workflow_posts where workflow_id = v_new;
  assert v_n = 2, format('posts: %s', v_n);
  select * into r from workflow_posts where workflow_id = v_new and ordem = 0;
  assert r.titulo = 'Post 1', format('sem sufixo: %s', r.titulo);
  assert r.status = 'aprovado_cliente' and r.scheduled_at = timestamptz '2026-11-01 12:00+00', 'agendado -> aprovado, data mantida';
  assert r.board_ordem is null, 'sem ranque';
  assert exists (select 1 from post_file_links where post_id = r.id and file_id = f1), 'midia linkada';
  assert (select status from workflow_posts where workflow_id = v_new and ordem = 1) = 'enviado_cliente', 'status mantido';
  raise notice 'PASS 99w.2';

  -- 99w.3
  select option_id into n1 from workflow_select_options where workflow_id = v_new and property_definition_id = d_sel;
  select option_id into n2 from workflow_select_options where workflow_id = v_new and property_definition_id = d_multi;
  assert n1 is not null and n1 <> o1 and n2 is not null and n2 <> o2, 'option_ids novos';
  assert (select label from workflow_select_options where option_id = n1) = 'Vídeo'
     and (select color from workflow_select_options where option_id = n1) = '#f00', 'label/cor';
  select value into v_val from post_property_values
   where property_definition_id = d_sel and post_id = (select id from workflow_posts where workflow_id = v_new and ordem = 0);
  assert v_val = to_jsonb(n1::text), format('select remapeado: %s', v_val);
  select value into v_val from post_property_values
   where property_definition_id = d_multi and post_id = (select id from workflow_posts where workflow_id = v_new and ordem = 0);
  assert v_val = jsonb_build_array(n2::text, 'opcao-do-template'), format('multiselect remapeado: %s', v_val);
  select value into v_val from post_property_values
   where property_definition_id = d_txt and post_id = (select id from workflow_posts where workflow_id = v_new and ordem = 0);
  assert v_val = to_jsonb(o1::text), format('texto intocado: %s', v_val);
  -- o original continua com as opcoes antigas
  assert (select value from post_property_values where post_id = p1 and property_definition_id = d_sel) = to_jsonb(o1::text), 'original intocado';
  raise notice 'PASS 99w.3';

  -- modo rascunho
  perform pg_temp.dw_as(e.usr);
  v_new := duplicate_workflow(wf, true);
  execute 'reset role';
  assert not exists (select 1 from workflow_posts where workflow_id = v_new and status <> 'rascunho'), 'tudo rascunho';
  raise notice 'PASS 99w.2b';
end $$;
rollback;

-- 99w.4 isolamento e grants
begin;
select et_grant_hosted_parity();
do $$
declare e record; o record; wf bigint; v_raised boolean;
begin
  e := pg_temp.dw_env();
  o := pg_temp.dw_env();
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (e.usr, e.ws, e.cli, 'F', 'ativo') returning id into wf;
  perform pg_temp.dw_as(o.usr);
  v_raised := false;
  begin
    perform duplicate_workflow(wf, false);
  exception when others then
    v_raised := true;
    assert sqlerrm = 'not_found', format('outra conta: %s', sqlerrm);
  end;
  execute 'reset role';
  assert v_raised, 'outra conta duplicou o fluxo';
  assert not has_function_privilege('anon', 'public.duplicate_workflow(bigint, boolean)', 'EXECUTE'), 'anon tem EXECUTE';
  assert has_function_privilege('service_role', 'public.duplicate_workflow(bigint, boolean)', 'EXECUTE'), 'service_role sem EXECUTE';
  assert has_function_privilege('authenticated', 'public.duplicate_workflow(bigint, boolean)', 'EXECUTE'), 'authenticated sem EXECUTE';
  raise notice 'PASS 99w.4';
end $$;
rollback;

-- 99w.5 limite de fluxos ativos (max_active_workflows_per_client = 1)
begin;
select et_grant_hosted_parity();
do $$
declare e record; wf bigint; v_raised boolean;
begin
  e := pg_temp.dw_env();
  insert into workspace_plan_overrides (workspace_id, resource_overrides)
    values (e.ws, '{"max_active_workflows_per_client": 1}'::jsonb);
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (e.usr, e.ws, e.cli, 'F', 'ativo') returning id into wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, status)
    values (wf, 0, 'E', 1, 'corridos', 'ativo');
  insert into workflow_posts (workflow_id, conta_id, titulo) values (wf, e.ws, 'P');
  perform pg_temp.dw_as(e.usr);
  v_raised := false;
  begin
    perform duplicate_workflow(wf, false);
  exception when others then
    v_raised := true;
    assert sqlerrm like 'plan_limit_exceeded:max_active_workflows_per_client%', format('msg: %s', sqlerrm);
  end;
  execute 'reset role';
  assert v_raised, 'limite nao barrou';
  assert (select count(*) from workflows where conta_id = e.ws) = 1, 'fluxo orfao';
  assert (select count(*) from workflow_posts where conta_id = e.ws) = 1, 'post orfao';
  raise notice 'PASS 99w.5';
end $$;
rollback;
```

If a fixture INSERT fails on a NOT NULL column (e.g. `workflow_templates`, `workflow_etapas`), copy the minimal insert shape from an existing suite (`grep -l "insert into workflow_templates" supabase/tests/entitlements/*.sql`) rather than guessing.

- [ ] **Step 2: Run it and confirm it fails**

Run: `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_duplicate_workflow.sql`
Expected: FAIL with `function duplicate_workflow(bigint, boolean) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261002000021_duplicate_workflow.sql`:

```sql
-- supabase/migrations/20261002000021_duplicate_workflow.sql
-- Duplicar fluxo (spec docs/superpowers/specs/2026-10-02-duplicate-posts-fluxos-design.md).
--
-- Copia o fluxo no estado atual: mesmas etapas e datas, mesma coluna, logo
-- depois do original. Opcoes por fluxo ganham option_id novo e os valores dos
-- posts sao remapeados. Cada post passa por _clone_post_row (20261002000020)
-- com p_solo = false: sem sufixo, mesma ordem, sem ranque no quadro.
-- Nao copia portal_tokens nem o historico de workflow_events (o trigger de
-- "created" registra a criacao normalmente).

CREATE OR REPLACE FUNCTION public.duplicate_workflow(p_workflow_id bigint, p_to_rascunho boolean)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta uuid := public.get_my_conta_id();
  w       workflows%ROWTYPE;
  v_new   bigint;
  o       record;
  v_opt   uuid;
  v_map   jsonb := '{}'::jsonb;
  p       record;
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF public.has_permission_for(auth.uid(), v_conta, 'entregas', 'editar') IS NOT TRUE THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  SELECT * INTO w FROM workflows
   WHERE id = p_workflow_id AND conta_id = v_conta
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Logo depois do original: empurrar todos os posteriores da conta preserva a
  -- ordem relativa em todas as colunas. position nao gera evento.
  IF w.position IS NOT NULL THEN
    UPDATE workflows SET position = position + 1
     WHERE conta_id = v_conta AND position > w.position;
  END IF;

  INSERT INTO workflows (
    user_id, conta_id, cliente_id, titulo, template_id, status, etapa_atual,
    recorrente, position, modo_prazo, link_notion, link_drive, concluido_em,
    created_via)
  VALUES (
    auth.uid(), v_conta, w.cliente_id, w.titulo || ' (cópia)', w.template_id,
    w.status, w.etapa_atual, w.recorrente,
    CASE WHEN w.position IS NULL THEN NULL ELSE w.position + 1 END,
    w.modo_prazo, w.link_notion, w.link_drive, w.concluido_em, 'human')
  RETURNING id INTO v_new;

  INSERT INTO workflow_etapas (
    workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo,
    status, iniciado_em, concluido_em, data_limite)
  SELECT v_new, e.ordem, e.nome, e.prazo_dias, e.tipo_prazo, e.responsavel_id,
         e.tipo, e.status, e.iniciado_em, e.concluido_em, e.data_limite
    FROM workflow_etapas e
   WHERE e.workflow_id = w.id
   ORDER BY e.ordem, e.id;

  FOR o IN
    SELECT * FROM workflow_select_options WHERE workflow_id = w.id ORDER BY id
  LOOP
    INSERT INTO workflow_select_options (workflow_id, property_definition_id, conta_id, label, color)
    VALUES (v_new, o.property_definition_id, v_conta, o.label, o.color)
    RETURNING option_id INTO v_opt;
    v_map := v_map || jsonb_build_object(o.option_id::text, v_opt::text);
  END LOOP;

  FOR p IN
    SELECT id FROM workflow_posts
     WHERE workflow_id = w.id AND conta_id = v_conta
     ORDER BY ordem, id
  LOOP
    PERFORM public._clone_post_row(v_conta, p.id, v_new, coalesce(p_to_rascunho, false), v_map, false);
  END LOOP;

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.duplicate_workflow(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duplicate_workflow(bigint, boolean) TO authenticated, service_role;
```

Note: the original fluxo's columns `link_drive`, `concluido_em`, `created_via` exist per `20260826000001`, `20260903000010`, `20260624000001`. If `\d workflows` shows another column (other than `id`, `created_at`), stop and decide copy vs. default; add a guard assertion for `workflows` and `workflow_etapas` to 99p.0-style checks at the top of this suite in that case.

- [ ] **Step 4: Apply and run**

Run: `npx supabase migration up --local && psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_duplicate_workflow.sql && psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_duplicate_post.sql`
Expected: `PASS 99w.1`, `99w.2`, `99w.3`, `99w.2b`, `99w.4`, `99w.5`, and all `99p.*` still pass.

- [ ] **Step 5: Full DB suite, stop the stack, restore config**

Run: `npm run test:db` (all PASS), then `npx supabase stop && cp /tmp/config.toml.dup-bak supabase/config.toml && git diff --stat supabase/config.toml` (prints nothing).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261002000021_duplicate_workflow.sql supabase/tests/entitlements/99_duplicate_workflow.sql
git commit -m "feat(entregas): RPC duplicate_workflow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Store wrappers `clonePost` / `cloneWorkflow`

**Files:**
- Modify: `apps/crm/src/store/posts.ts` (add after `removeWorkflowPost`, ~line 912)
- Modify: `apps/crm/src/store/workflows.ts` (add after `duplicateWorkflow`, ~line 656)
- Test: `apps/crm/src/store/__tests__/cloneRpcs.test.ts`

**Interfaces:**
- Produces: `clonePost(postId: number, toRascunho: boolean): Promise<number>` and `cloneWorkflow(workflowId: number, toRascunho: boolean): Promise<number>`, both re-exported from `@/store` (via `store/index.ts`'s `export * from './posts'` / `'./workflows'`). They throw the raw PostgREST error.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/store/__tests__/cloneRpcs.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import {
  __resetSupabaseMock,
  __getSupabaseCalls,
  __queueSupabaseRpc,
} from '../../lib/__mocks__/supabase';
import { clonePost } from '../posts';
import { cloneWorkflow } from '../workflows';

describe('clonePost', () => {
  beforeEach(() => __resetSupabaseMock());

  it('chama duplicate_post e devolve o id novo', async () => {
    __queueSupabaseRpc('duplicate_post', { data: 321 });
    await expect(clonePost(12, true)).resolves.toBe(321);
    const call = __getSupabaseCalls().find((c) => c.table === 'rpc:duplicate_post');
    expect(call?.payload).toEqual({ p_post_id: 12, p_to_rascunho: true });
  });

  it('propaga o erro', async () => {
    __queueSupabaseRpc('duplicate_post', {
      error: { message: 'plan_limit_exceeded:max_posts_per_workflow' },
    });
    await expect(clonePost(12, false)).rejects.toMatchObject({
      message: 'plan_limit_exceeded:max_posts_per_workflow',
    });
  });
});

describe('cloneWorkflow', () => {
  beforeEach(() => __resetSupabaseMock());

  it('chama duplicate_workflow e devolve o id novo', async () => {
    __queueSupabaseRpc('duplicate_workflow', { data: 77 });
    await expect(cloneWorkflow(5, false)).resolves.toBe(77);
    const call = __getSupabaseCalls().find((c) => c.table === 'rpc:duplicate_workflow');
    expect(call?.payload).toEqual({ p_workflow_id: 5, p_to_rascunho: false });
  });

  it('propaga o erro', async () => {
    __queueSupabaseRpc('duplicate_workflow', { error: { message: 'not_found' } });
    await expect(cloneWorkflow(5, true)).rejects.toMatchObject({ message: 'not_found' });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run apps/crm/src/store/__tests__/cloneRpcs.test.ts`
Expected: FAIL, `clonePost is not a function` / `cloneWorkflow is not a function` (or an import error).

- [ ] **Step 3: Implement**

In `apps/crm/src/store/posts.ts`, right after `removeWorkflowPost`:

```ts
/**
 * Duplica um post (RPC duplicate_post, 20261002000020). A cópia fica logo
 * depois do original, com a mesma mídia (mesmos arquivos), propriedades e
 * data. `toRascunho` põe a cópia em rascunho; sem ele o status é mantido,
 * exceto agendado/postado/falha_publicacao, que viram aprovado_cliente.
 * Devolve o id do post novo; o erro da RPC sobe cru (plan_limit_exceeded:*,
 * not_found, permission_denied).
 */
export async function clonePost(postId: number, toRascunho: boolean): Promise<number> {
  const { data, error } = await supabase.rpc('duplicate_post', {
    p_post_id: postId,
    p_to_rascunho: toRascunho,
  });
  if (error) throw error;
  return data as number;
}
```

In `apps/crm/src/store/workflows.ts`, right after `duplicateWorkflow` (leave `duplicateWorkflow` untouched):

```ts
/**
 * Duplica um fluxo no estado atual (RPC duplicate_workflow, 20261002000021):
 * mesmas etapas e datas, todos os posts com a mídia. Diferente de
 * `duplicateWorkflow`, que é a cópia de recorrência e volta para a etapa 0.
 * `toRascunho` vale para todos os posts (mesma regra de `clonePost`).
 * Devolve o id do fluxo novo; o erro da RPC sobe cru.
 */
export async function cloneWorkflow(workflowId: number, toRascunho: boolean): Promise<number> {
  const { data, error } = await supabase.rpc('duplicate_workflow', {
    p_workflow_id: workflowId,
    p_to_rascunho: toRascunho,
  });
  if (error) throw error;
  return data as number;
}
```

- [ ] **Step 4: Run test and typecheck**

Run: `npx vitest run apps/crm/src/store/__tests__/cloneRpcs.test.ts && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: 4 tests PASS, tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/store/posts.ts apps/crm/src/store/workflows.ts apps/crm/src/store/__tests__/cloneRpcs.test.ts
git commit -m "feat(entregas): clonePost e cloneWorkflow no store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `DuplicateDialog`

**Files:**
- Create: `apps/crm/src/pages/entregas/components/DuplicateDialog.tsx`
- Test: `apps/crm/src/pages/entregas/components/__tests__/DuplicateDialog.test.tsx`

**Interfaces:**
- Consumes: `clonePost`, `cloneWorkflow` from `@/store` (Task 3); `mapEntitlementError`, `entitlementMessage` from `@/lib/entitlement-errors`; `Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter` from `@/components/ui/dialog`; `Button` from `@/components/ui/button`.
- Produces:
  ```ts
  export type DuplicateTarget =
    | { kind: 'post'; postId: number; status: string }
    | { kind: 'workflow'; workflowId: number; postsCount: number; active: boolean };
  export function duplicateErrorMessage(err: unknown): string;
  export function DuplicateDialog(props: {
    target: DuplicateTarget | null;
    onClose: () => void;
    onDuplicated: (newId: number, target: DuplicateTarget) => void;
  }): JSX.Element;
  ```
  The dialog is open when `target !== null`. It calls the RPC, then `onDuplicated(newId, target)` and `onClose()`. Callers own the success toast and the refresh. Errors are toasted by the dialog itself and the dialog stays open.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/entregas/components/__tests__/DuplicateDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const clonePost = vi.fn();
const cloneWorkflow = vi.fn();
vi.mock('@/store', () => ({
  clonePost: (...a: unknown[]) => clonePost(...a),
  cloneWorkflow: (...a: unknown[]) => cloneWorkflow(...a),
}));
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

import { DuplicateDialog, duplicateErrorMessage } from '../DuplicateDialog';

beforeEach(() => {
  clonePost.mockReset();
  cloneWorkflow.mockReset();
  toastError.mockReset();
});

describe('DuplicateDialog', () => {
  it('post: manter status é o padrão e chama clonePost(id, false)', async () => {
    clonePost.mockResolvedValue(99);
    const onDuplicated = vi.fn();
    const onClose = vi.fn();
    const target = { kind: 'post' as const, postId: 5, status: 'revisao_interna' };
    render(<DuplicateDialog target={target} onClose={onClose} onDuplicated={onDuplicated} />);

    expect(screen.getByRole('heading', { name: 'Duplicar post' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Manter status atual/)).toBeChecked();
    expect(screen.queryByText(/é preciso agendar de novo/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Duplicar' }));
    await waitFor(() => expect(onDuplicated).toHaveBeenCalledWith(99, target));
    expect(clonePost).toHaveBeenCalledWith(5, false);
    expect(onClose).toHaveBeenCalled();
  });

  it('post agendado mostra o aviso de reagendar', () => {
    render(
      <DuplicateDialog
        target={{ kind: 'post', postId: 5, status: 'agendado' }}
        onClose={vi.fn()}
        onDuplicated={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        'Posts agendados, postados ou com falha voltam para Aprovado pelo cliente. A data fica, mas é preciso agendar de novo.',
      ),
    ).toBeInTheDocument();
  });

  it('fluxo em rascunho chama cloneWorkflow(id, true) e mostra a contagem', async () => {
    cloneWorkflow.mockResolvedValue(42);
    const onDuplicated = vi.fn();
    const target = { kind: 'workflow' as const, workflowId: 8, postsCount: 3, active: true };
    render(<DuplicateDialog target={target} onClose={vi.fn()} onDuplicated={onDuplicated} />);

    expect(screen.getByRole('heading', { name: 'Duplicar fluxo' })).toBeInTheDocument();
    expect(screen.getByText('Os 3 posts do fluxo serão copiados com a mídia.')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Mudar tudo para Rascunho/));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicar' }));
    await waitFor(() => expect(onDuplicated).toHaveBeenCalledWith(42, target));
    expect(cloneWorkflow).toHaveBeenCalledWith(8, true);
  });

  it('erro: toast e o diálogo continua aberto', async () => {
    clonePost.mockRejectedValue({ message: 'plan_limit_exceeded:max_posts_per_workflow' });
    const onClose = vi.fn();
    render(
      <DuplicateDialog
        target={{ kind: 'post', postId: 5, status: 'rascunho' }}
        onClose={onClose}
        onDuplicated={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Duplicar' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toMatch(/posts por fluxo/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('em voo: botões desabilitados', async () => {
    let resolve!: (v: number) => void;
    clonePost.mockReturnValue(new Promise<number>((r) => (resolve = r)));
    render(
      <DuplicateDialog
        target={{ kind: 'post', postId: 5, status: 'rascunho' }}
        onClose={vi.fn()}
        onDuplicated={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Duplicar' }));
    expect(await screen.findByRole('button', { name: 'Duplicando...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    resolve(1);
  });
});

describe('duplicateErrorMessage', () => {
  it('erro genérico', () => {
    expect(duplicateErrorMessage(new Error('boom'))).toBe(
      'Não foi possível duplicar. Tente novamente.',
    );
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/DuplicateDialog.test.tsx`
Expected: FAIL, cannot resolve `../DuplicateDialog`.

- [ ] **Step 3: Implement**

Create `apps/crm/src/pages/entregas/components/DuplicateDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { clonePost, cloneWorkflow } from '@/store';
import { entitlementMessage, mapEntitlementError } from '@/lib/entitlement-errors';

/** O que está sendo duplicado. `status` (post) decide se o aviso de
 *  reagendar aparece; `active` (fluxo) decide se o toast do chamador oferece
 *  "Abrir" (fluxo concluído/arquivado não aparece no quadro ativo). */
export type DuplicateTarget =
  | { kind: 'post'; postId: number; status: string }
  | { kind: 'workflow'; workflowId: number; postsCount: number; active: boolean };

const PUBLISH_STATES = new Set(['agendado', 'postado', 'falha_publicacao']);
const KEEP_HELP =
  'Posts agendados, postados ou com falha voltam para Aprovado pelo cliente. A data fica, mas é preciso agendar de novo.';

export function duplicateErrorMessage(err: unknown): string {
  const ent = mapEntitlementError(err);
  if (ent) return entitlementMessage(ent);
  return 'Não foi possível duplicar. Tente novamente.';
}

function postsLine(n: number): string {
  if (n === 0) return 'O fluxo não tem posts. Só as etapas serão copiadas.';
  if (n === 1) return 'O post do fluxo será copiado com a mídia.';
  return `Os ${n} posts do fluxo serão copiados com a mídia.`;
}

interface DuplicateDialogProps {
  target: DuplicateTarget | null;
  onClose: () => void;
  onDuplicated: (newId: number, target: DuplicateTarget) => void;
}

export function DuplicateDialog({ target, onClose, onDuplicated }: DuplicateDialogProps) {
  const [mode, setMode] = useState<'keep' | 'rascunho'>('keep');
  const [pending, setPending] = useState(false);

  // Cada abertura começa no padrão.
  useEffect(() => {
    if (target) setMode('keep');
  }, [target]);

  const isPost = target?.kind === 'post';
  const showKeepHelp = target ? !isPost || PUBLISH_STATES.has(target.status) : false;

  const submit = async () => {
    if (!target || pending) return;
    setPending(true);
    try {
      const toRascunho = mode === 'rascunho';
      const newId =
        target.kind === 'post'
          ? await clonePost(target.postId, toRascunho)
          : await cloneWorkflow(target.workflowId, toRascunho);
      onDuplicated(newId, target);
      onClose();
    } catch (err) {
      toast.error(duplicateErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const option = (value: 'keep' | 'rascunho', label: string, help?: string) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[:checked]:border-primary">
      <input
        type="radio"
        name="duplicate-mode"
        value={value}
        checked={mode === value}
        onChange={() => setMode(value)}
        disabled={pending}
        className="mt-1"
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {help && <span className="block text-xs text-muted-foreground">{help}</span>}
      </span>
    </label>
  );

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{isPost ? 'Duplicar post' : 'Duplicar fluxo'}</DialogTitle>
          <DialogDescription>
            {target?.kind === 'workflow'
              ? postsLine(target.postsCount)
              : 'A cópia leva conteúdo, legendas, mídia e propriedades.'}
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Status da cópia" className="space-y-2">
          {option(
            'keep',
            isPost ? 'Manter status atual' : 'Manter status atuais',
            showKeepHelp ? KEEP_HELP : undefined,
          )}
          {option('rascunho', isPost ? 'Mudar para Rascunho' : 'Mudar tudo para Rascunho')}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Duplicando...' : 'Duplicar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Two notes for the implementer:
- `getByLabelText(/Mudar tudo para Rascunho/)` relies on the `<input>` being inside its `<label>`, so keep that structure.
- `DialogContent`'s `onClick` stops propagation because React events bubble through portals: the board dialog is rendered by `EntregasPage`, not inside a card, but the WorkflowDrawer/StandalonePostDrawer ones sit inside drawers whose overlays have click handlers. If `DialogContent` in `apps/crm/src/components/ui/dialog.tsx` doesn't forward `onClick`, drop the prop and wrap the children in `<div onClick={(e) => e.stopPropagation()}>`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/DuplicateDialog.test.tsx && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: 6 tests PASS, tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/DuplicateDialog.tsx apps/crm/src/pages/entregas/components/__tests__/DuplicateDialog.test.tsx
git commit -m "feat(entregas): diálogo Duplicar post/fluxo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: "Duplicar post" in the WorkflowDrawer post kebab

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` (`SortablePostItemProps` ~1285, kebab ~1513-1522, call site ~1104, state near the other dialog state ~242-250, dialog render near the other dialogs at the end of the drawer's JSX)
- Test: `apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawer.duplicate.test.tsx` (create) — only if a WorkflowDrawer test harness already exists; see Step 1.

**Interfaces:**
- Consumes: `DuplicateDialog`, `DuplicateTarget` (Task 4); `useAuth().can` (already destructured at ~line 364).
- Produces: `SortablePostItemProps.onDuplicateRequest?: () => void`.

Behavior: after a successful duplicate the drawer calls `refresh()`, expands the copy (`setExpandedId(newId)`), scrolls to it (`setScrollTargetId(newId)`) and shows `toast.success('Post duplicado')`. No "Abrir" action: the copy is already open.

- [ ] **Step 1: Check for an existing harness**

Run: `ls apps/crm/src/pages/entregas/components/__tests__ | grep -i "WorkflowDrawer"`
If a harness renders `WorkflowDrawer` with posts (e.g. `WorkflowDrawer.*.test.tsx`), copy its setup into `WorkflowDrawer.duplicate.test.tsx` and add a test: with `can('entregas','editar')` true, clicking the "Duplicar post" menu item opens a dialog titled "Duplicar post"; with it false, the item is absent. If no harness exists, skip the component test (the dialog is covered by Task 4) and rely on the browser check in Task 8.

- [ ] **Step 2: Add the prop and the menu item**

In `SortablePostItemProps` add, next to `onMoveRequest`:

```ts
  /** "Duplicar post". Ausente quando o usuário não pode editar entregas. */
  onDuplicateRequest?: () => void;
```

Destructure `onDuplicateRequest` in `SortablePostItem`'s parameter list, and in the kebab, after "Copiar link do post":

```tsx
              {onDuplicateRequest && (
                <DropdownMenuItem onClick={onDuplicateRequest}>
                  <CopyPlus className="h-3.5 w-3.5" />
                  Duplicar post
                </DropdownMenuItem>
              )}
```

Add `CopyPlus` to the existing `lucide-react` import.

- [ ] **Step 3: State, wiring and dialog in the drawer**

Near the other dialog state (around `moveTarget`):

```ts
  const [duplicateTarget, setDuplicateTarget] = useState<DuplicateTarget | null>(null);
  const canDuplicate = can('entregas', 'editar') === true;
```

At the `SortablePostItem` call site (~line 1104), next to `onMoveRequest`:

```tsx
                          onDuplicateRequest={
                            canDuplicate
                              ? () =>
                                  setDuplicateTarget({
                                    kind: 'post',
                                    postId: post.id!,
                                    status: post.status,
                                  })
                              : undefined
                          }
```

Next to the other dialogs rendered by the drawer:

```tsx
      <DuplicateDialog
        target={duplicateTarget}
        onClose={() => setDuplicateTarget(null)}
        onDuplicated={(newId) => {
          refresh();
          setExpandedId(newId);
          setScrollTargetId(newId);
          toast.success('Post duplicado');
        }}
      />
```

Import: `import { DuplicateDialog, type DuplicateTarget } from './DuplicateDialog';`

- [ ] **Step 4: Typecheck and run the entregas tests**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npx vitest run apps/crm/src/pages/entregas`
Expected: tsc exits 0; all entregas tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx apps/crm/src/pages/entregas/components/__tests__/
git commit -m "feat(entregas): Duplicar post no drawer do fluxo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Board entry points (WorkflowCard, PostProcessCard, KanbanView, EntregasPage)

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowCard.tsx` (props ~39-70, kebab ~676-731)
- Modify: `apps/crm/src/pages/entregas/components/PostProcessCard.tsx` (props ~37-56, kebab ~449-503)
- Modify: `apps/crm/src/pages/entregas/views/KanbanView.tsx` (props interface ~100-130, `SortableCard` ~330-378, `SortablePostCard` ~384-425, render ~1375-1425)
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx` (state ~190, `<KanbanView>` ~1418-1440, dialogs ~1679+)
- Test: `apps/crm/src/pages/entregas/components/__tests__/PostProcessCard.test.tsx` (extend), `apps/crm/src/pages/entregas/components/__tests__/WorkflowCard.duplicate.test.tsx` (create)

**Interfaces:**
- Consumes: `DuplicateDialog`, `DuplicateTarget` (Task 4).
- Produces:
  - `WorkflowCardProps.onDuplicateClick?: () => void`
  - `PostProcessCardProps.onDuplicateClick?: () => void`
  - `KanbanViewProps.onDuplicateWorkflowClick?: (card: BoardCard, postsCount: number) => void`
  - `KanbanViewProps.onDuplicatePostClick?: (entity: PostEntity) => void`

- [ ] **Step 1: Write the failing card tests**

Append to `apps/crm/src/pages/entregas/components/__tests__/PostProcessCard.test.tsx` (it already mocks the dropdown so items render as buttons, and has `makeEntity`/`render`):

```tsx
describe('PostProcessCard: Duplicar post', () => {
  it('mostra o item e chama onDuplicateClick sem abrir o card', () => {
    const onClick = vi.fn();
    const onDuplicateClick = vi.fn();
    render(
      <PostProcessCard entity={makeEntity()} onClick={onClick} onDuplicateClick={onDuplicateClick} />,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /Duplicar post/ }));
    expect(onDuplicateClick).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('sem onDuplicateClick não mostra o item', () => {
    render(<PostProcessCard entity={makeEntity()} />);
    expect(screen.queryByRole('menuitem', { name: /Duplicar post/ })).not.toBeInTheDocument();
  });
});
```

Create `apps/crm/src/pages/entregas/components/__tests__/WorkflowCard.duplicate.test.tsx`. Copy the `vi.mock(...)` blocks, the `render` helper and the `BoardCard` fixture from `WorkflowCard.badge.test.tsx` verbatim (that file already renders `WorkflowCard` in isolation). If its dropdown mock doesn't wire `onClick`, use the `@/components/ui/dropdown-menu` mock from `PostProcessCard.test.tsx` lines 15-31 instead. Then add:

```tsx
describe('WorkflowCard: Duplicar fluxo', () => {
  it('mostra o item e chama onDuplicateClick sem abrir o card', () => {
    const onClick = vi.fn();
    const onDuplicateClick = vi.fn();
    render(<WorkflowCard card={card} onClick={onClick} onDuplicateClick={onDuplicateClick} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /Duplicar fluxo/ }));
    expect(onDuplicateClick).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('sem onDuplicateClick não mostra o item', () => {
    render(<WorkflowCard card={card} />);
    expect(screen.queryByRole('menuitem', { name: /Duplicar fluxo/ })).not.toBeInTheDocument();
  });
});
```

(`card` is the fixture name you copied; rename the references if the source file calls it something else.)

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/PostProcessCard.test.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowCard.duplicate.test.tsx`
Expected: the new tests FAIL (no "Duplicar" menu item; TS error on the unknown prop is fine under vitest).

- [ ] **Step 3: Add the card items**

`WorkflowCard.tsx`: add to `WorkflowCardProps`

```ts
  /** "Duplicar fluxo". Ausente no overlay de arraste e sem permissão. */
  onDuplicateClick?: () => void;
```

destructure it, add `CopyPlus` to the `lucide-react` import, and insert after the "Abrir posts" item:

```tsx
            {onDuplicateClick && !isDragOverlay && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicateClick();
                }}
              >
                <CopyPlus className="h-3.5 w-3.5" />
                Duplicar fluxo
              </DropdownMenuItem>
            )}
```

`PostProcessCard.tsx`: add to `PostProcessCardProps`

```ts
  /** "Duplicar post": copia o post e o processo na mesma etapa. */
  onDuplicateClick?: () => void;
```

destructure it, add `CopyPlus` to the `lucide-react` import, and insert after the "Abrir" item:

```tsx
                {onDuplicateClick && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onDuplicateClick();
                    }}
                  >
                    <CopyPlus className="h-3.5 w-3.5" />
                    Duplicar post
                  </DropdownMenuItem>
                )}
```

- [ ] **Step 4: Run the card tests**

Run: the same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Thread through KanbanView**

In the `KanbanView` props interface, next to `onDeletePostClick`:

```ts
  /** "Duplicar fluxo" no kebab do card. Ausente = item escondido. */
  onDuplicateWorkflowClick?: (card: BoardCard, postsCount: number) => void;
  /** "Duplicar post" no kebab do card de post individual. */
  onDuplicatePostClick?: (entity: PostEntity) => void;
```

Destructure both in `KanbanView`. `SortableCard`: add `onDuplicateClick?: () => void;` to its props type, destructure, pass `onDuplicateClick={onDuplicateClick}` to `<WorkflowCard>`. `SortablePostCard`: same, passing to `<PostProcessCard>`.

At the render site (~1388 and ~1413):

```tsx
                            onDuplicateClick={
                              onDuplicatePostClick ? () => onDuplicatePostClick(entity) : undefined
                            }
```

```tsx
                          onDuplicateClick={
                            onDuplicateWorkflowClick
                              ? () =>
                                  onDuplicateWorkflowClick(
                                    card,
                                    postsCounts.get(card.workflow.id!) ?? 0,
                                  )
                              : undefined
                          }
```

Do not pass it to the `DragOverlay`'s `WorkflowCard`/`PostProcessCard`.

- [ ] **Step 6: Own the dialog in EntregasPage**

Near `deletePostTarget` (~line 190):

```ts
  const [duplicateTarget, setDuplicateTarget] = useState<DuplicateTarget | null>(null);
```

`EntregasPage` already reads `useAuth()` at ~line 150 (`const { profile } = useAuth();`). Change it to `const { profile, can } = useAuth();` and add:

```ts
  const canDuplicate = can('entregas', 'editar') === true;
```

Add the handler next to `confirmDeletePost` (~line 726):

```ts
  // "Duplicar" nos cards do quadro. "Abrir" usa os mesmos caminhos do deep
  // link: post individual abre no drawer avulso; fluxo espera o card chegar
  // no refetch via pendingDeepLink.
  const handleDuplicated = (newId: number, target: DuplicateTarget) => {
    refresh();
    if (target.kind === 'post') {
      toast.success('Post duplicado', {
        action: {
          label: 'Abrir',
          onClick: () => {
            setDrawerCard(null);
            setDrawerInitialPostId(null);
            setStandalonePostId(newId);
          },
        },
      });
      return;
    }
    toast.success(
      'Fluxo duplicado',
      target.active
        ? {
            action: {
              label: 'Abrir',
              onClick: () => setPendingDeepLink({ workflowId: newId, postId: null }),
            },
          }
        : undefined,
    );
  };
```

On `<KanbanView>` (~line 1432), next to `onDeletePostClick`:

```tsx
              onDuplicateWorkflowClick={
                canDuplicate
                  ? (card, postsCount) =>
                      setDuplicateTarget({
                        kind: 'workflow',
                        workflowId: card.workflow.id!,
                        postsCount,
                        active: card.workflow.status === 'ativo',
                      })
                  : undefined
              }
              onDuplicatePostClick={
                canDuplicate
                  ? (entity) =>
                      setDuplicateTarget({
                        kind: 'post',
                        postId: entity.process.post_id,
                        status: entity.process.post.status,
                      })
                  : undefined
              }
```

Next to the delete-post `AlertDialog` (~line 1679):

```tsx
      <DuplicateDialog
        target={duplicateTarget}
        onClose={() => setDuplicateTarget(null)}
        onDuplicated={handleDuplicated}
      />
```

Import: `import { DuplicateDialog, type DuplicateTarget } from './components/DuplicateDialog';`

If `setPendingDeepLink`'s state type requires fields beyond `workflowId`/`postId`, read its declaration (~line 445) and pass the minimum it requires; `fromUrl`, `fromDrawerFallback` and `failedWorkflowId` are optional today.

`apps/crm/src/pages/cliente-detalhe/tabs/EntregasTab.tsx` also renders `KanbanView`; it gets no duplicate props (items hidden there). That is intentional for this change.

- [ ] **Step 7: Typecheck and run all entregas + cliente-detalhe tests**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npx vitest run apps/crm/src/pages/entregas apps/crm/src/pages/cliente-detalhe`
Expected: tsc exits 0; all PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/crm/src/pages/entregas/components/WorkflowCard.tsx apps/crm/src/pages/entregas/components/PostProcessCard.tsx apps/crm/src/pages/entregas/views/KanbanView.tsx apps/crm/src/pages/entregas/EntregasPage.tsx apps/crm/src/pages/entregas/components/__tests__/
git commit -m "feat(entregas): Duplicar fluxo e Duplicar post nos cards do quadro

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: "Duplicar post" in StandalonePostDrawer

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/StandalonePostDrawer.tsx` (props ~87-100, header buttons ~673-681)
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx` (`<StandalonePostDrawer>` ~1763)
- Test: `apps/crm/src/pages/entregas/components/__tests__/StandalonePostDrawer.test.tsx` (extend)

**Interfaces:**
- Consumes: `DuplicateDialog`, `DuplicateTarget` (Task 4); `useAuth().can` (already destructured at ~line 166).
- Produces: `StandalonePostDrawerProps.onDuplicated?: (newPostId: number) => void` — when provided, the success toast offers "Abrir" calling it.

- [ ] **Step 1: Write the failing test**

Open `StandalonePostDrawer.test.tsx`, find how it renders the drawer with a loaded post and how it mocks `useAuth` (it must return `can`). Add:

```tsx
it('Duplicar post abre o diálogo quando pode editar entregas', async () => {
  // render the drawer exactly like the existing "renders the header" test does,
  // with can('entregas','editar') returning true
  fireEvent.click(await screen.findByTitle('Duplicar post'));
  expect(await screen.findByRole('heading', { name: 'Duplicar post' })).toBeInTheDocument();
});

it('sem permissão de editar entregas não mostra o botão', async () => {
  // same render, with can() returning false for ('entregas','editar')
  await screen.findByTitle('Remover post');
  expect(screen.queryByTitle('Duplicar post')).not.toBeInTheDocument();
});
```

Replace the two comment lines with the file's own render helper and auth mock; if the file mocks `useAuth` with a fixed `can`, make it a `vi.fn()` and set its return per test.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/StandalonePostDrawer.test.tsx`
Expected: the two new tests FAIL (no "Duplicar post" button).

- [ ] **Step 3: Implement**

Props:

```ts
  /** Depois de "Duplicar post": o toast oferece "Abrir" com o id da cópia. */
  onDuplicated?: (newPostId: number) => void;
```

Destructure `onDuplicated`. State and permission next to the other dialog state:

```ts
  const [duplicateTarget, setDuplicateTarget] = useState<DuplicateTarget | null>(null);
  const canDuplicate = can('entregas', 'editar') === true;
```

Header, right before the "Remover post" button:

```tsx
                {canDuplicate && post && (
                  <button
                    className="drawer-close-btn"
                    onClick={() =>
                      setDuplicateTarget({ kind: 'post', postId, status: post.status })
                    }
                    title="Duplicar post"
                    aria-label="Duplicar post"
                  >
                    <CopyPlus className="h-3.5 w-3.5" />
                  </button>
                )}
```

(Match the class of the neighboring icon buttons if `drawer-close-btn` renders a different size; `CopyLinkButton`'s class is the reference.)

Dialog, next to the drawer's other dialogs:

```tsx
      <DuplicateDialog
        target={duplicateTarget}
        onClose={() => setDuplicateTarget(null)}
        onDuplicated={(newId) => {
          refresh();
          onRefresh();
          toast.success(
            'Post duplicado',
            onDuplicated
              ? { action: { label: 'Abrir', onClick: () => onDuplicated(newId) } }
              : undefined,
          );
        }}
      />
```

Imports: `CopyPlus` from `lucide-react`, `DuplicateDialog`/`DuplicateTarget` from `./DuplicateDialog`, `toast` from `sonner` if not already imported.

In `EntregasPage.tsx`, on `<StandalonePostDrawer>`:

```tsx
          onDuplicated={(id) => setStandalonePostId(id)}
```

(The drawer is keyed by `standalonePostId`, so this remounts it on the copy.)

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run apps/crm/src/pages/entregas && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: all PASS, tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/StandalonePostDrawer.tsx apps/crm/src/pages/entregas/EntregasPage.tsx apps/crm/src/pages/entregas/components/__tests__/StandalonePostDrawer.test.tsx
git commit -m "feat(entregas): Duplicar post no drawer do post avulso

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Spec update, full verification, browser check

**Files:**
- Modify: `docs/superpowers/specs/2026-10-02-duplicate-posts-fluxos-design.md`

- [ ] **Step 1: Record the plan-time decisions in the spec**

Edit the spec so it matches what was built:
1. "Decisões fechadas" → `Nome` row: `" (cópia)"` no post duplicado e no fluxo duplicado; posts copiados junto com o fluxo mantêm o título.
2. "Forma das funções": permissão é `has_permission_for(auth.uid(), conta, 'entregas', 'editar')` (mesma das RPCs de processo), erro `permission_denied`; replace the "Qualquer membro pode duplicar" bullet. `_clone_post_row` signature is `(p_conta, p_src_post_id, p_target_workflow_id, p_to_rascunho, p_option_map, p_solo)`; add `_remap_option_value`. Both take the `':post_move'` advisory lock.
3. "Processo (post individual)": `board_position` vai para o fim (max + 1), como `apply_post_process`, para não mexer em linhas de outros processos; `revisao = 1`.
4. "Posição": avulso não empurra irmãos (ordem igual à do original).
5. "Diálogo": no `WorkflowDrawer` a cópia é aberta e rolada direto, sem "Abrir" no toast; no `StandalonePostDrawer` e nos cards, "Abrir" como descrito. Entry points only render with `can('entregas','editar')`. `EntregasTab` (cliente-detalhe) não ganha os itens nesta entrega.

- [ ] **Step 2: Full local gate**

Run each and confirm exit 0:

```bash
npm run lint
npm run format:check || (npm run format && git diff --stat)
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
```

If `npm run format` changed files, commit them with the spec in Step 4.

- [ ] **Step 3: Browser check**

The dev server points at prod by default, so do **not** duplicate real data from a local session. Use staging only if the two migrations are applied there (`npx supabase db push --linked` targets staging; ask the user before pushing). With the migrations on staging and a staging seed login (see memory `reference_seed_login_browser_verification`), start the CRM against staging (`npm run dev:staging`; note worktrees lack `.env.staging`, see memory `reference_worktree_env_staging_gotcha`) and verify:
1. Entregas › Fluxos: a fluxo card's kebab shows "Duplicar fluxo"; duplicating with "Manter status atuais" creates "<título> (cópia)" right after the original in the same column; "Abrir" opens it; its posts show the same media and statuses (agendados as Aprovado pelo cliente).
2. In that fluxo's drawer, a post kebab "Duplicar post" with "Mudar para Rascunho" adds "<título> (cópia)" right below, expanded, in Rascunho, same media.
3. A post individual card: "Duplicar post" creates a second card in the same etapa; "Abrir" opens the standalone drawer on the copy.
4. Standalone drawer header button "Duplicar post" works and "Abrir" switches to the copy.
5. Hitting a plan limit shows the house entitlement message and creates nothing.

If staging isn't available, stop after Step 2 and tell the user the browser check is pending on applying the migrations to staging.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-02-duplicate-posts-fluxos-design.md
git commit -m "docs(spec): duplicar post/fluxo, decisões do plano

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Before opening the PR**

Re-check the migration tail (`git fetch origin main && git ls-tree --name-only origin/main supabase/migrations/ | tail -3`) and renumber `20261002000020`/`20261002000021` above it if needed (rename the files and update the version mentioned in each file's header comment and in the two test files' headers). Remind the user: apply both migrations to prod **before** merging.
