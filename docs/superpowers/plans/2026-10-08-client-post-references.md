# Client post references (Hub → post editor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clients attach images, videos, PDFs and links ("referências") to a post in the Hub while it waits for their approval; the team sees them in the CRM post editor and gets a notification.

**Architecture:** A new `post_references` table (files reuse `files` with `attached_to = 'post_reference'`, quota and R2 cleanup via triggers) written only through SECURITY DEFINER RPCs called by two new edge functions: `hub-post-references` (Hub token) and `post-references` (CRM JWT). `hub-approve` links staged references to a correction. The Hub gets a Referências tab, picker, upload queue and composer staging; the CRM gets a section in `PostEditorBody`, chips in the comment thread, a drawer badge and a notification type.

**Tech Stack:** Postgres (Supabase migrations, psql entitlement suites), Deno edge functions, Cloudflare R2 presigned URLs, React 19 + TanStack Query (CRM and Hub), Vitest, shadcn/ui (CRM), hand-written `hub-*` CSS (Hub).

**Spec:** `docs/superpowers/specs/2026-10-08-client-post-references-design.md` (read it before any task).
**Mockups:** https://claude.ai/artifact/6VVsAAMQz99mTAV3jw94KC

## Global Constraints

- Write gate: client writes only while `workflow_posts.status = 'enviado_cliente'`. GET is ownership-only.
- `can_remove`: gate holds AND no `post_approvals` team reply AND no `post_status_events` with `source <> 'client'` after the reference's `created_at`.
- Limits: 10 references per post; images (jpeg/png/webp/gif) and PDF 25 MB; video (mp4/quicktime/webm) 200 MB; webp thumbnail ≤ 512 KB (required for image/video, forbidden for PDF); note ≤ 500; link title ≤ 120; URL ≤ 2048, http/https, no credentials.
- Reference videos: `files.stream_status = 'skipped'`, never Cloudflare Stream.
- Reference `files` rows: `folder_id NULL`, `attached_to = 'post_reference'`, `uploaded_by NULL`; never linked from any other table.
- Rate limits: `hub-write:hub-post-references:{conta}:{cliente}` 120/3600s on writes only; GET debits `hub-read:{conta}:{cliente}` 300/300s.
- R2 HEAD in edge functions: `headObjectSigned`, never `getR2().send()`.
- New SECURITY DEFINER functions: `SET search_path = public, pg_temp`; `REVOKE ALL … FROM PUBLIC, anon, authenticated`; `GRANT EXECUTE … TO service_role`.
- No raw DB errors to clients; CORS via `buildCorsHeaders(req)`; `escapeHTML`/`sanitizeUrl` rules from CLAUDE.md.
- Copy: pt-BR, sentence case, **no em dash (—)** in user-facing strings; spec strings verbatim.
- Migration version `20261010000001`; renumber above `main`'s tail right before `gh pr create`.
- `hub-post-references` and `post-references` deploy with `--no-verify-jwt` (both verify auth themselves; ES256 keys).
- Before pushing: `npm run lint`, `npm run format:check`, the four `tsc` commands (crm, hub, admin, `tsconfig.scripts.json`), `npm run test`, `npm run check:functions`, `npm run test:functions`. After any Deno run: `ls node_modules/.deno` and `npm ci` if present.

## Task order and parallelism

| Wave | Tasks | Notes |
|---|---|---|
| 1 | Task 1 (DB) | Everything else depends on its names; Tasks 2–11 can be written against the contracts in parallel, but their integration checks need the migration. |
| 2 | Tasks 2 → 3 → 4 → 5 → 6 (edge, sequential in ONE worktree: Tasks 3 and 4 both edit `CLAUDE.md`, `supabase/config.toml` and `config-audit_test.ts`) · Task 7 → 8 → 9 (Hub) · Tasks 10, 11 (CRM) | Three independent streams. Task 7 moves `apps/crm/src/utils/videoFrame.ts` to `packages/ui/video/frame.ts`; Task 10 must not touch that file. |
| 3 | Final verification | All CI gates, browser check of Hub (:5175) and CRM, light and dark. |

Executors: end commit messages with the attribution trailer from YOUR session's reminder, not the literal trailer pasted in this plan. `services/postReferences.ts` deliberately does not retry 429 (unlike `api.ts`); do not add retries.

Each stream works in its own nested worktree branch off this branch (memory: parallel SDD in nested worktrees: node_modules symlinks, `cd` discipline, literal paths).

## Contracts

The exact names and types every task uses (copied from the planning contract; tasks restate what they consume and produce):

- SQL: `post_references`; `files.attached_to`; `files_stream_status_check` + `'skipped'`; `post_reference_can_remove(bigint)`, `post_reference_list(bigint, uuid)`, `post_reference_file_insert(jsonb)`, `post_reference_link_insert(jsonb)`, `post_reference_client_update(bigint, uuid, bigint, text)`, `post_reference_client_delete(bigint, uuid, bigint)`, `create_post_reference_notification(bigint)`; RPC error codes `post_not_found | post_not_pending | reference_limit | upload_mismatch | quota_exceeded`.
- Edge: `_shared/post-references.ts` (`ReferenceItem`, `ReferenceErrorCode`, `REFERENCE_MIME`, `normalizeReferenceUrl`); `signGetUrl(key, expires, downloadName?)`; `hub-post-references` routes GET / `upload-url` / `files` (201) / `links` (201) / PATCH `:id` / DELETE `:id`; `post-references` GET / DELETE `:id`; `hub-approve` `reference_ids`.
- Hub: `services/postReferences.ts`, `hooks/usePostReferences.ts` (called in `PostDetailContent`), `components/posts/references/*`, i18n `hubPosts.json` → `references`.
- CRM: `store/postReferences.ts` (imported directly, not via the `@/store` barrel), `pages/entregas/components/references/*`, notification type `post_client_reference`.

---

### Task 1: Database migration `post_references` + CI-gated SQL suite

**Files:**
- Create: `supabase/migrations/20261010000001_post_references.sql`
- Create: `supabase/tests/entitlements/99_post_references.sql`
- Modify (inside the same migration, `CREATE OR REPLACE`): `bulk_move_items(uuid, bigint[], bigint[], bigint)`, last defined in `supabase/migrations/20260501000001_bulk_move_items_rpc.sql`

**Interfaces:**
- Consumes (existing, verified below): `workflow_posts(id, conta_id, cliente_id, workflow_id, status, titulo, responsavel_id)` + `workflow_posts_id_conta_uq`; `files` + `files_id_conta_uq` + `files_stream_status_check` + `files_video_requires_thumbnail`; `post_approvals(id, post_id, is_workspace_user, created_at NULLABLE)`; `post_status_events(post_id, source IN ('workspace_user','client','system'), created_at)`; `file_update_reference_count()`; `file_enqueue_delete()` / `file_update_used_bytes()` (AFTER DELETE on files); `effective_plan_limit(uuid, text)`; `get_my_conta_id()`; `resolve_notification_targets(uuid, bigint, text[])`; `insert_notification_batch(uuid, uuid[], text, text, jsonb, uuid)`; `notifications(user_id, type, metadata, read_at, dismissed_at, created_at)`.
- Produces (contract names, exact):
  - table `post_references` (spec shape, no `cliente_id`), RLS SELECT for `authenticated` by `get_my_conta_id()`, no authenticated writes.
  - `files.attached_to text NULL CHECK (attached_to IN ('post_reference'))`; `files_stream_status_check` now allows `'skipped'`.
  - `post_reference_can_remove(p_ref_id bigint) RETURNS boolean`
  - `post_reference_list(p_post_id bigint, p_conta uuid) RETURNS TABLE(id, kind, file_id, url, link_title, note, post_approval_id, created_at, can_remove, name, mime_type, file_kind, size_bytes, width, height, duration_seconds, r2_key, thumbnail_r2_key, blur_data_url)` ordered by `created_at, id`
  - `post_reference_file_insert(p jsonb) RETURNS post_references` (P0001: `post_not_found`, `post_not_pending`, `reference_limit`, `upload_mismatch`, `quota_exceeded`, checked in that order). `upload_mismatch` = `r2_key` empty/NULL, `r2_key = thumbnail_r2_key`, or either key already present in `files.r2_key` or `files.thumbnail_r2_key` of ANY workspace (`files.r2_key` is not unique; without this a Hub client could finalize over an existing media key and the orphan trigger would later delete that object).
  - `post_reference_link_insert(p jsonb) RETURNS post_references` (P0001: `post_not_found`, `post_not_pending`, `reference_limit`)
  - `post_reference_client_update(p_id bigint, p_conta uuid, p_cliente bigint, p_note text) RETURNS text` and `post_reference_client_delete(p_id bigint, p_conta uuid, p_cliente bigint) RETURNS text`: `'ok' | 'not_found' | 'locked'`
  - `create_post_reference_notification(p_post_id bigint) RETURNS integer` (type `post_client_reference`, 15-minute per-target coalescing)
  - All of the above: `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE ... TO service_role`.
  - jsonb keys read by `post_reference_file_insert`: `post_id, conta_id, cliente_id, r2_key, thumbnail_r2_key, name, mime_type, file_kind, size_bytes, width, height, duration_seconds, blur_data_url, note`. `post_reference_link_insert`: `post_id, conta_id, cliente_id, url, link_title, note`. Every optional key (`thumbnail_r2_key, width, height, duration_seconds, blur_data_url, note, link_title`) accepts a missing key, JSON `null` or `''` as NULL (all read through `NULLIF(p->>'k', '')`).
  - `bulk_move_items` now refuses files with `attached_to IS NOT NULL`: they count as not found, so the whole call returns `{"error": ..., "code": "invalid_files"}` and nothing moves; the UPDATE carries the same predicate. Body otherwise verbatim; grants unchanged (service_role only).
  - Handler-facing notes: P0001 messages are the bare code (`sqlerrm = 'reference_limit'`), so supabase-js surfaces them as `error.message === 'reference_limit'`. A note over 500 chars or a malformed URL raises `23514` (check_violation), which the handlers must prevent (they validate first) and otherwise map to 500.

**Prerequisites for running the suite locally:** Docker (colima) and the local stack: `npx supabase start` from the worktree. The default DB URL is `postgresql://postgres:postgres@127.0.0.1:54322/postgres`; if this worktree uses a port override, export `SUPABASE_DB_URL` and use it in the `psql` commands below. CI runs this suite on every PR in the `entitlement-tests` job (`supabase start` on a fresh DB + `bash scripts/test-entitlements.sh`), which globs `supabase/tests/entitlements/[0-9]*.sql`, so the new file is picked up with no CI change.

- [ ] **Step 1: Confirm the migration version sorts last**

Run:
```bash
ls supabase/migrations | tail -3
```
Expected (as of 2026-10-08; `20261010000001` must sort after the last line):
```
20261008000002_agenda_convidados.sql
20261009000001_instagram_automation_contacts.sql
20261009000002_instagram_automation_contacts_rpcs.sql
```
If `main` has moved past `20261010000001` by PR time, renumber the file above main's tail before `gh pr create` (the `migration-version-guard` job fails on duplicate prefixes, and a version below an applied one is skipped by `db push`). Also re-check that no migration newer than `20261008000002_agenda_convidados.sql` redefines `notifications_type_check` / `notification_inapp_prefs_type_check`:
```bash
grep -ln "notifications_type_check\|notification_inapp_prefs_type_check" supabase/migrations/*.sql | tail -1
```
Expected: `supabase/migrations/20261008000002_agenda_convidados.sql`. If a newer file shows up, copy its two lists into Step 4 instead and append `post_client_reference`.

- [ ] **Step 2: Write the failing SQL suite**

Create `supabase/tests/entitlements/99_post_references.sql`:

```sql
-- supabase/tests/entitlements/99_post_references.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Referências do cliente no post (migration 20261010000001, spec 2026-10-08).
-- (a) grants da tabela e das RPCs; (b) RLS: isolamento entre workspaces,
-- anon sem acesso, authenticated sem escrita; (c) insert de arquivo: cota,
-- attached_to, stream_status 'skipped' em vídeo (fora da ingest do Stream);
-- (d) insert de link; (e) post_not_found / post_not_pending /
-- reference_limit / quota_exceeded; (f) CHECK de URL; (g) update/delete do
-- cliente: ok, not_found, locked (resposta da equipe, evento de status fora
-- do cliente, post fora de enviado_cliente); (h) órfão apaga o files e
-- devolve a cota; (i) excluir o post cascateia; (j) post_reference_list e
-- can_remove por referência; (k) notificação coalescida em 15 min;
-- (l) exclusão de workspace em cascata; (m) JSON null nos opcionais;
-- (n) upload_mismatch (chave já usada em files); (o) bulk_move_items não
-- move arquivo de referência.
--
-- now() é fixo dentro da transação: toda linha com DEFAULT now() tem o mesmo
-- created_at, e "created_at > referência.created_at" nunca é verdade. As
-- linhas que precisam ser POSTERIORES à referência usam now() + 1 segundo; as
-- que precisam ser ANTERIORES, now() - intervalo.

create or replace function pg_temp.pr_env(p_plan text, p_overrides jsonb,
  out ws uuid, out usr uuid, out cli bigint, out wf bigint)
language plpgsql as $$
begin
  ws := et_make_workspace(p_plan, p_overrides);
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws where id = usr;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (usr, ws, 'Cliente', 'C', '#000') returning id into cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (usr, ws, cli, 'WF', 'ativo') returning id into wf;
end $$;

-- Post já em enviado_cliente via INSERT: o trigger de status só dispara em
-- UPDATE, então nenhum post_status_events nasce aqui.
create or replace function pg_temp.pr_post(p_ws uuid, p_wf bigint, p_status text default 'enviado_cliente')
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into workflow_posts (workflow_id, conta_id, titulo, status)
    values (p_wf, p_ws, 'Post', p_status) returning id into v_id;
  return v_id;
end $$;

create or replace function pg_temp.pr_file(p_ws uuid, p_cli bigint, p_post bigint,
  p_kind text default 'image', p_size bigint default 100)
returns post_references language plpgsql as $$
begin
  return post_reference_file_insert(jsonb_build_object(
    'post_id', p_post, 'conta_id', p_ws, 'cliente_id', p_cli,
    'r2_key', 'contas/' || p_ws || '/files/' || gen_random_uuid() || '.bin',
    'thumbnail_r2_key', case when p_kind = 'document' then ''
                             else 'contas/' || p_ws || '/files/' || gen_random_uuid() || '.thumb.webp' end,
    'name', 'arquivo', 'mime_type', case p_kind when 'image' then 'image/png'
                                                when 'video' then 'video/mp4'
                                                else 'application/pdf' end,
    'file_kind', p_kind, 'size_bytes', p_size,
    'width', case when p_kind = 'document' then '' else '1080' end,
    'height', case when p_kind = 'document' then '' else '1350' end,
    'duration_seconds', case when p_kind = 'video' then '12' else '' end,
    'blur_data_url', '', 'note', 'Use esta foto'));
end $$;

create or replace function pg_temp.pr_link(p_ws uuid, p_cli bigint, p_post bigint,
  p_url text default 'https://example.com/a')
returns post_references language plpgsql as $$
begin
  return post_reference_link_insert(jsonb_build_object(
    'post_id', p_post, 'conta_id', p_ws, 'cliente_id', p_cli,
    'url', p_url, 'link_title', 'Exemplo', 'note', ''));
end $$;

-- Roda a RPC esperando P0001 com a mensagem exata.
create or replace function pg_temp.pr_expect(p_sql text, p_code text)
returns void language plpgsql as $$
declare v_raised boolean := false;
begin
  begin
    execute p_sql;
  exception when sqlstate 'P0001' then
    assert sqlerrm = p_code, format('esperava %s, veio %s', p_code, sqlerrm);
    v_raised := true;
  end;
  assert v_raised, format('esperava %s de: %s', p_code, p_sql);
end $$;

-- ---- (a) + (b) grants e RLS ----
begin;
select et_grant_hosted_parity(array['post_references']);
do $$
declare
  a record; b record;
  v_post_a bigint; v_post_b bigint;
  v_n int; v_raised boolean;
  v_fn text;
begin
  assert not has_table_privilege('anon', 'public.post_references', 'SELECT'),
    'anon nao pode ler post_references';
  assert has_table_privilege('authenticated', 'public.post_references', 'SELECT'),
    'authenticated precisa ler post_references';
  assert not has_table_privilege('authenticated', 'public.post_references', 'INSERT'),
    'authenticated nao pode inserir';
  assert not has_table_privilege('authenticated', 'public.post_references', 'UPDATE'),
    'authenticated nao pode atualizar';
  assert not has_table_privilege('authenticated', 'public.post_references', 'DELETE'),
    'authenticated nao pode apagar';
  assert has_table_privilege('service_role', 'public.post_references', 'INSERT'),
    'service_role precisa escrever';

  foreach v_fn in array array[
    'public.post_reference_can_remove(bigint)',
    'public.post_reference_list(bigint, uuid)',
    'public.post_reference_file_insert(jsonb)',
    'public.post_reference_link_insert(jsonb)',
    'public.post_reference_client_update(bigint, uuid, bigint, text)',
    'public.post_reference_client_delete(bigint, uuid, bigint)',
    'public.create_post_reference_notification(bigint)'
  ] loop
    assert has_function_privilege('service_role', v_fn, 'EXECUTE'),
      format('service_role precisa executar %s', v_fn);
    assert not has_function_privilege('anon', v_fn, 'EXECUTE'),
      format('anon nao pode executar %s', v_fn);
    assert not has_function_privilege('authenticated', v_fn, 'EXECUTE'),
      format('authenticated nao pode executar %s', v_fn);
  end loop;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  a := pg_temp.pr_env('max', null);
  b := pg_temp.pr_env('max', null);
  v_post_a := pg_temp.pr_post(a.ws, a.wf);
  v_post_b := pg_temp.pr_post(b.ws, b.wf);
  perform pg_temp.pr_link(a.ws, a.cli, v_post_a);
  perform pg_temp.pr_file(a.ws, a.cli, v_post_a);
  perform pg_temp.pr_link(b.ws, b.cli, v_post_b);

  -- usuário A só vê as duas do workspace A
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', a.usr, 'role', 'authenticated')::text, true);
  select count(*) into v_n from post_references;
  assert v_n = 2, format('A deveria ver 2 referencias, viu %s', v_n);
  select count(*) into v_n from post_references where conta_id = b.ws;
  assert v_n = 0, 'A nao pode ver referencias do workspace B';

  v_raised := false;
  begin
    insert into post_references (post_id, conta_id, kind, url)
      values (v_post_a, a.ws, 'link', 'https://x.com');
  exception when insufficient_privilege then v_raised := true;
  end;
  assert v_raised, 'authenticated nao pode inserir direto';
  reset role;

  -- usuário B só vê a dele
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', b.usr, 'role', 'authenticated')::text, true);
  select count(*) into v_n from post_references;
  assert v_n = 1, format('B deveria ver 1 referencia, viu %s', v_n);
  reset role;

  -- anon: sem privilégio nenhum
  set local role anon;
  v_raised := false;
  begin
    perform 1 from post_references;
  exception when insufficient_privilege then v_raised := true;
  end;
  assert v_raised, 'anon nao pode ler post_references';
  reset role;

  raise notice 'PASS 99_post_references (a, b) grants + RLS';
end $$;
rollback;

-- ---- (c) .. (f) inserts, gates, cota, URL ----
begin;
do $$
declare
  a record; q record;
  v_post bigint; v_post_draft bigint; v_post_lim bigint; v_post_q bigint;
  v_ref post_references; v_f files;
  v_used_before bigint; v_used_after bigint; v_n int;
  v_bad text; v_raised boolean;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  a := pg_temp.pr_env('max', null);
  v_post := pg_temp.pr_post(a.ws, a.wf);
  v_post_draft := pg_temp.pr_post(a.ws, a.wf, 'rascunho');
  v_post_lim := pg_temp.pr_post(a.ws, a.wf);

  -- (c) imagem: cobra a cota, attached_to, sem pasta e sem uploader
  select storage_used_bytes into v_used_before from workspaces where id = a.ws;
  v_ref := pg_temp.pr_file(a.ws, a.cli, v_post, 'image', 100);
  assert v_ref.kind = 'file' and v_ref.file_id is not null and v_ref.url is null,
    'referencia de arquivo com file_id e sem url';
  assert v_ref.note = 'Use esta foto', 'nota gravada';
  select * into v_f from files where id = v_ref.file_id;
  assert v_f.attached_to = 'post_reference', 'files.attached_to = post_reference';
  assert v_f.folder_id is null and v_f.uploaded_by is null, 'fora de pastas, sem uploader';
  assert v_f.kind = 'image' and v_f.stream_status is null, 'imagem sem stream_status';
  assert v_f.reference_count = 1, format('reference_count 1, veio %s', v_f.reference_count);
  select storage_used_bytes into v_used_after from workspaces where id = a.ws;
  assert v_used_after = v_used_before + 100,
    format('cota deveria subir 100 (%s -> %s)', v_used_before, v_used_after);

  -- (c) vídeo: 'skipped' e fora do predicado de ingest do Stream
  --     (stream-steps.ts: kind=video, stream_uid null, stream_status null|pending)
  v_ref := pg_temp.pr_file(a.ws, a.cli, v_post, 'video', 200);
  select * into v_f from files where id = v_ref.file_id;
  assert v_f.stream_status = 'skipped', format('video de referencia skipped, veio %s', v_f.stream_status);
  assert v_f.duration_seconds = 12, 'duration_seconds gravado';
  assert not exists (
    select 1 from files
     where id = v_f.id and kind = 'video' and stream_uid is null
       and (stream_status is null or stream_status = 'pending')),
    'video skipped nao pode casar com a ingest do Stream';

  -- (c) PDF sem thumbnail
  v_ref := pg_temp.pr_file(a.ws, a.cli, v_post, 'document', 50);
  select * into v_f from files where id = v_ref.file_id;
  assert v_f.thumbnail_r2_key is null and v_f.kind = 'document', 'pdf sem thumbnail';

  -- (d) link
  v_ref := pg_temp.pr_link(a.ws, a.cli, v_post, 'https://www.instagram.com/p/abc/?x=1#y');
  assert v_ref.kind = 'link' and v_ref.file_id is null
     and v_ref.url = 'https://www.instagram.com/p/abc/?x=1#y'
     and v_ref.link_title = 'Exemplo' and v_ref.note is null,
    'link gravado, nota vazia vira null';

  -- (e) post de outro cliente / workspace -> post_not_found
  perform pg_temp.pr_expect(format(
    'select pg_temp.pr_link(%L::uuid, %s, %s)', a.ws, a.cli + 100000, v_post), 'post_not_found');
  perform pg_temp.pr_expect(format(
    'select pg_temp.pr_link(%L::uuid, %s, %s)', gen_random_uuid(), a.cli, v_post), 'post_not_found');
  perform pg_temp.pr_expect(format(
    'select pg_temp.pr_file(%L::uuid, %s, %s)', a.ws, a.cli + 100000, v_post), 'post_not_found');

  -- (e) post fora de enviado_cliente -> post_not_pending
  perform pg_temp.pr_expect(format(
    'select pg_temp.pr_link(%L::uuid, %s, %s)', a.ws, a.cli, v_post_draft), 'post_not_pending');
  perform pg_temp.pr_expect(format(
    'select pg_temp.pr_file(%L::uuid, %s, %s)', a.ws, a.cli, v_post_draft), 'post_not_pending');

  -- (e) limite de 10 (arquivos + links)
  for i in 1..9 loop
    perform pg_temp.pr_link(a.ws, a.cli, v_post_lim);
  end loop;
  perform pg_temp.pr_file(a.ws, a.cli, v_post_lim);
  select count(*) into v_n from post_references where post_id = v_post_lim;
  assert v_n = 10, format('10 referencias no post, veio %s', v_n);
  perform pg_temp.pr_expect(format(
    'select pg_temp.pr_link(%L::uuid, %s, %s)', a.ws, a.cli, v_post_lim), 'reference_limit');
  perform pg_temp.pr_expect(format(
    'select pg_temp.pr_file(%L::uuid, %s, %s)', a.ws, a.cli, v_post_lim), 'reference_limit');

  -- (e) cota do plano estourada: nada gravado, cota intacta
  q := pg_temp.pr_env('max', '{"storage_quota_bytes": 1000}'::jsonb);
  v_post_q := pg_temp.pr_post(q.ws, q.wf);
  perform pg_temp.pr_expect(format(
    'select pg_temp.pr_file(%L::uuid, %s, %s, %L, 1001)', q.ws, q.cli, v_post_q, 'image'),
    'quota_exceeded');
  assert not exists (select 1 from files where conta_id = q.ws), 'nenhum files gravado';
  assert not exists (select 1 from post_references where post_id = v_post_q), 'nenhuma referencia gravada';
  assert (select storage_used_bytes from workspaces where id = q.ws) = 0, 'cota intacta';
  v_ref := pg_temp.pr_file(q.ws, q.cli, v_post_q, 'image', 1000);
  assert v_ref.id is not null, 'exatamente no limite passa';

  -- (f) CHECK de URL (rede de segurança)
  foreach v_bad in array array[
    'https://user:pass@x.com', 'https:// x', 'https://', 'ftp://x.com',
    'javascript:alert(1)', 'https://x.com/a b', 'https://x.com/' || chr(10),
    'https://x.com/' || repeat('a', 2048)
  ] loop
    v_raised := false;
    begin
      insert into post_references (post_id, conta_id, kind, url)
        values (v_post, a.ws, 'link', v_bad);
    exception when check_violation then v_raised := true;
    end;
    assert v_raised, format('URL %L deveria violar a CHECK', v_bad);
  end loop;
  insert into post_references (post_id, conta_id, kind, url)
    values (v_post, a.ws, 'link', 'HTTP://Example.com');
  insert into post_references (post_id, conta_id, kind, url)
    values (v_post, a.ws, 'link', 'https://x.com/@perfil');

  -- formato: link com file_id ou arquivo com url falham
  v_raised := false;
  begin
    insert into post_references (post_id, conta_id, kind, file_id, url)
      values (v_post, a.ws, 'file', v_f.id, 'https://x.com');
  exception when check_violation then v_raised := true;
  end;
  assert v_raised, 'arquivo com url deveria violar post_references_shape';

  -- (m) opcionais aceitam JSON null além de ''
  v_ref := post_reference_file_insert(jsonb_build_object(
    'post_id', v_post, 'conta_id', a.ws, 'cliente_id', a.cli,
    'r2_key', 'contas/' || a.ws || '/files/null-test.pdf', 'thumbnail_r2_key', null,
    'name', 'doc.pdf', 'mime_type', 'application/pdf', 'file_kind', 'document',
    'size_bytes', 1, 'width', null, 'height', null, 'duration_seconds', null,
    'blur_data_url', null, 'note', null));
  select * into v_f from files where id = v_ref.file_id;
  assert v_ref.note is null and v_f.thumbnail_r2_key is null and v_f.width is null
     and v_f.height is null and v_f.duration_seconds is null and v_f.blur_data_url is null,
    'JSON null vira NULL no arquivo';
  v_ref := post_reference_link_insert(jsonb_build_object(
    'post_id', v_post, 'conta_id', a.ws, 'cliente_id', a.cli,
    'url', 'https://example.com/null', 'link_title', null, 'note', null));
  assert v_ref.link_title is null and v_ref.note is null, 'JSON null vira NULL no link';

  -- (n) upload_mismatch: chave já existente em files (r2_key ou thumbnail,
  --     de qualquer workspace) ou chave principal = thumbnail
  insert into files (conta_id, r2_key, thumbnail_r2_key, name, kind, mime_type, size_bytes)
    values (q.ws, 'contas/' || q.ws || '/files/midia.mp4', 'contas/' || q.ws || '/files/midia.thumb.webp',
            'midia.mp4', 'video', 'video/mp4', 1);
  select storage_used_bytes into v_used_before from workspaces where id = a.ws;
  select count(*) into v_n from post_references where post_id = v_post;
  foreach v_bad in array array[
    format('{"r2_key": "contas/%s/files/midia.mp4", "thumbnail_r2_key": "contas/%s/files/novo.thumb.webp"}', q.ws, a.ws),
    format('{"r2_key": "contas/%s/files/midia.thumb.webp", "thumbnail_r2_key": "contas/%s/files/novo.thumb.webp"}', q.ws, a.ws),
    format('{"r2_key": "contas/%s/files/novo.png", "thumbnail_r2_key": "contas/%s/files/midia.mp4"}', a.ws, q.ws),
    format('{"r2_key": "contas/%s/files/novo.png", "thumbnail_r2_key": "contas/%s/files/midia.thumb.webp"}', a.ws, q.ws),
    format('{"r2_key": "contas/%s/files/igual.png", "thumbnail_r2_key": "contas/%s/files/igual.png"}', a.ws, a.ws),
    '{"r2_key": "", "thumbnail_r2_key": null}'
  ] loop
    perform pg_temp.pr_expect(format(
      'select post_reference_file_insert(%L::jsonb || %L::jsonb)',
      jsonb_build_object('post_id', v_post, 'conta_id', a.ws, 'cliente_id', a.cli,
        'name', 'x.png', 'mime_type', 'image/png', 'file_kind', 'image', 'size_bytes', 5),
      v_bad), 'upload_mismatch');
  end loop;
  assert (select count(*) from post_references where post_id = v_post) = v_n, 'nada gravado no mismatch';
  assert (select storage_used_bytes from workspaces where id = a.ws) = v_used_before, 'cota intacta no mismatch';

  raise notice 'PASS 99_post_references (c-f, m, n) inserts, gates, cota, URL, nulls, mismatch';
end $$;
rollback;

-- ---- (g) .. (j) update/delete do cliente, órfão, cascata, lista ----
begin;
do $$
declare
  a record; b record;
  v_post bigint; v_post_ev bigint; v_post_cli_ev bigint; v_post_moved bigint;
  v_post_null bigint; v_post_list bigint; v_post_del bigint; v_post_b bigint;
  r_file post_references; r_link post_references; r_ev post_references;
  r_cli_ev post_references; r_moved post_references; r_null post_references;
  r_old post_references; r_new post_references; r_b post_references;
  r_del1 post_references; r_del2 post_references;
  v_used bigint; v_used_before bigint; v_key text; v_n int;
  v_list record; v_rows int := 0;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  a := pg_temp.pr_env('max', null);
  b := pg_temp.pr_env('max', null);
  v_post := pg_temp.pr_post(a.ws, a.wf);
  v_post_ev := pg_temp.pr_post(a.ws, a.wf);
  v_post_cli_ev := pg_temp.pr_post(a.ws, a.wf);
  v_post_moved := pg_temp.pr_post(a.ws, a.wf);
  v_post_null := pg_temp.pr_post(a.ws, a.wf);
  v_post_b := pg_temp.pr_post(b.ws, b.wf);

  r_file := pg_temp.pr_file(a.ws, a.cli, v_post, 'image', 300);
  r_link := pg_temp.pr_link(a.ws, a.cli, v_post);
  r_b := pg_temp.pr_link(b.ws, b.cli, v_post_b);

  -- (g) ok: nota editada; '' vira null
  assert post_reference_client_update(r_link.id, a.ws, a.cli, 'Nova nota') = 'ok', 'update ok';
  assert (select note from post_references where id = r_link.id) = 'Nova nota', 'nota atualizada';
  assert post_reference_client_update(r_link.id, a.ws, a.cli, '') = 'ok', 'update vazio ok';
  assert (select note from post_references where id = r_link.id) is null, 'nota vazia vira null';

  -- (g) not_found: outro cliente, outro workspace, referência de B, id inexistente
  assert post_reference_client_update(r_link.id, a.ws, a.cli + 100000, 'x') = 'not_found', 'outro cliente';
  assert post_reference_client_update(r_link.id, b.ws, a.cli, 'x') = 'not_found', 'outro workspace';
  assert post_reference_client_delete(r_b.id, a.ws, a.cli) = 'not_found', 'referencia de B pelo token de A';
  assert post_reference_client_delete(-1, a.ws, a.cli) = 'not_found', 'id inexistente';
  assert exists (select 1 from post_references where id = r_b.id), 'referencia de B intacta';

  -- (h) delete ok: órfão apaga o files, devolve a cota, enfileira o R2
  select r2_key into v_key from files where id = r_file.file_id;
  select storage_used_bytes into v_used_before from workspaces where id = a.ws;
  assert post_reference_client_delete(r_file.id, a.ws, a.cli) = 'ok', 'delete ok';
  assert not exists (select 1 from post_references where id = r_file.id), 'referencia apagada';
  assert not exists (select 1 from files where id = r_file.file_id), 'files orfao apagado';
  select storage_used_bytes into v_used from workspaces where id = a.ws;
  assert v_used = v_used_before - 300, format('cota devolvida (%s -> %s)', v_used_before, v_used);
  assert exists (select 1 from file_deletions where r2_key = v_key), 'R2 enfileirado';

  -- (g) locked: resposta da equipe depois da referência
  insert into post_approvals (post_id, action, comentario, is_workspace_user, created_at)
    values (v_post, 'mensagem', 'Recebido', true, now() + interval '1 second');
  assert post_reference_client_update(r_link.id, a.ws, a.cli, 'x') = 'locked', 'update locked apos resposta';
  assert post_reference_client_delete(r_link.id, a.ws, a.cli) = 'locked', 'delete locked apos resposta';
  assert exists (select 1 from post_references where id = r_link.id), 'referencia travada continua';

  -- (g) resposta da equipe com created_at NULL nunca trava
  r_null := pg_temp.pr_link(a.ws, a.cli, v_post_null);
  insert into post_approvals (post_id, action, comentario, is_workspace_user, created_at)
    values (v_post_null, 'mensagem', 'Sem data', true, null);
  assert post_reference_client_update(r_null.id, a.ws, a.cli, 'ok') = 'ok', 'created_at NULL nao trava';

  -- (g) locked: evento de status fora do cliente (reenvio da equipe) depois
  r_ev := pg_temp.pr_link(a.ws, a.cli, v_post_ev);
  insert into post_status_events (post_id, conta_id, from_status, to_status, source, created_at)
    values (v_post_ev, a.ws, 'correcao_cliente', 'enviado_cliente', 'workspace_user',
            now() + interval '1 second');
  assert post_reference_client_delete(r_ev.id, a.ws, a.cli) = 'locked', 'delete locked apos reenvio';

  -- evento do próprio cliente não trava
  r_cli_ev := pg_temp.pr_link(a.ws, a.cli, v_post_cli_ev);
  insert into post_status_events (post_id, conta_id, from_status, to_status, source, created_at)
    values (v_post_cli_ev, a.ws, 'enviado_cliente', 'enviado_cliente', 'client',
            now() + interval '1 second');
  assert post_reference_client_update(r_cli_ev.id, a.ws, a.cli, 'ok') = 'ok', 'evento do cliente nao trava';

  -- (g) locked: post saiu de enviado_cliente
  r_moved := pg_temp.pr_link(a.ws, a.cli, v_post_moved);
  update workflow_posts set status = 'aprovado_cliente' where id = v_post_moved;
  assert post_reference_client_delete(r_moved.id, a.ws, a.cli) = 'locked', 'post aprovado trava';

  -- (j) lista: ordem por created_at, can_remove por referência
  v_post_list := pg_temp.pr_post(a.ws, a.wf);
  r_old := pg_temp.pr_file(a.ws, a.cli, v_post_list, 'image', 10);
  r_new := pg_temp.pr_link(a.ws, a.cli, v_post_list);
  update post_references set created_at = now() - interval '1 hour' where id = r_old.id;
  insert into post_approvals (post_id, action, comentario, is_workspace_user, created_at)
    values (v_post_list, 'mensagem', 'Entre as duas', true, now() - interval '30 minutes');
  for v_list in select * from post_reference_list(v_post_list, a.ws) loop
    v_rows := v_rows + 1;
    if v_rows = 1 then
      assert v_list.id = r_old.id, 'mais antiga primeiro';
      assert v_list.can_remove = false, 'antiga travada pela resposta posterior';
      assert v_list.kind = 'file' and v_list.file_kind = 'image'
         and v_list.size_bytes = 10 and v_list.width = 1080 and v_list.height = 1350
         and v_list.r2_key like 'contas/' || a.ws || '/files/%'
         and v_list.thumbnail_r2_key like '%.thumb.webp'
         and v_list.mime_type = 'image/png' and v_list.name = 'arquivo',
        'campos do arquivo na lista';
    else
      assert v_list.id = r_new.id, 'mais nova depois';
      assert v_list.can_remove = true, 'nova continua removivel';
      assert v_list.kind = 'link' and v_list.file_kind is null and v_list.url is not null,
        'link sem campos de arquivo';
    end if;
  end loop;
  assert v_rows = 2, format('lista com 2 linhas, veio %s', v_rows);
  select count(*) into v_n from post_reference_list(v_post_list, b.ws);
  assert v_n = 0, 'lista com conta errada vem vazia';
  assert post_reference_can_remove(r_old.id) = false and post_reference_can_remove(r_new.id) = true,
    'can_remove direto bate com a lista';

  -- (h) remoção da equipe (DELETE direto do service role) também limpa
  select storage_used_bytes into v_used_before from workspaces where id = a.ws;
  delete from post_references where id = r_old.id;
  assert not exists (select 1 from files where id = r_old.file_id), 'delete da equipe apaga o files';
  assert (select storage_used_bytes from workspaces where id = a.ws) = v_used_before - 10,
    'delete da equipe devolve a cota';

  -- (i) excluir o post cascateia referências e arquivos
  v_post_del := pg_temp.pr_post(a.ws, a.wf);
  r_del1 := pg_temp.pr_file(a.ws, a.cli, v_post_del, 'video', 500);
  r_del2 := pg_temp.pr_link(a.ws, a.cli, v_post_del);
  select storage_used_bytes into v_used_before from workspaces where id = a.ws;
  delete from workflow_posts where id = v_post_del;
  assert not exists (select 1 from post_references where post_id = v_post_del), 'referencias cascateadas';
  assert not exists (select 1 from files where id = r_del1.file_id), 'arquivo do post apagado';
  assert (select storage_used_bytes from workspaces where id = a.ws) = v_used_before - 500,
    'cota devolvida na exclusao do post';

  raise notice 'PASS 99_post_references (g-j) update/delete, orfao, cascata, lista';
end $$;
rollback;

-- ---- (k) notificação coalescida ----
begin;
do $$
declare
  a record;
  v_post bigint; v_n int; v_notif notifications;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  a := pg_temp.pr_env('max', null);
  v_post := pg_temp.pr_post(a.ws, a.wf);
  perform pg_temp.pr_link(a.ws, a.cli, v_post);

  assert create_post_reference_notification(v_post) = 1, 'primeira chamada notifica o owner';
  select * into v_notif from notifications
   where user_id = a.usr and type = 'post_client_reference';
  assert v_notif.workspace_id = a.ws, 'workspace da notificacao';
  assert v_notif.link = '/entregas?drawer=' || a.wf, format('link do fluxo, veio %s', v_notif.link);
  assert v_notif.metadata->>'post_id' = v_post::text
     and v_notif.metadata->>'client_name' = 'Cliente'
     and v_notif.metadata->>'post_title' = 'Post'
     and (v_notif.metadata->>'workflow_id')::bigint = a.wf,
    'metadata da notificacao';

  -- segunda dentro de 15 min, não lida: nada novo
  assert create_post_reference_notification(v_post) = 0, 'segunda chamada coalescida';
  select count(*) into v_n from notifications
   where user_id = a.usr and type = 'post_client_reference';
  assert v_n = 1, format('uma notificacao so, veio %s', v_n);

  -- lida: a próxima volta a notificar
  update notifications set read_at = now()
   where user_id = a.usr and type = 'post_client_reference';
  assert create_post_reference_notification(v_post) = 1, 'depois de lida notifica de novo';

  -- não lida mas com mais de 15 min: notifica de novo
  update notifications set created_at = now() - interval '16 minutes'
   where user_id = a.usr and type = 'post_client_reference' and read_at is null;
  assert create_post_reference_notification(v_post) = 1, 'apos 15 min notifica de novo';
  select count(*) into v_n from notifications
   where user_id = a.usr and type = 'post_client_reference';
  assert v_n = 3, format('tres notificacoes no total, veio %s', v_n);

  -- post inexistente: 0, sem erro
  assert create_post_reference_notification(-1) = 0, 'post inexistente';

  raise notice 'PASS 99_post_references (k) notificacao coalescida';
end $$;
rollback;

-- ---- (l) exclusão de workspace em cascata não trava ----
-- Três caminhos chegam em post_references (conta_id, post, files) e o trigger
-- de órfão apaga files que o mesmo statement já está apagando.
begin;
do $$
declare
  a record; v_post bigint;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  a := pg_temp.pr_env('max', null);
  v_post := pg_temp.pr_post(a.ws, a.wf);
  perform pg_temp.pr_file(a.ws, a.cli, v_post, 'image', 100);
  perform pg_temp.pr_file(a.ws, a.cli, v_post, 'video', 100);
  perform pg_temp.pr_link(a.ws, a.cli, v_post);
  delete from workspaces where id = a.ws;
  assert not exists (select 1 from post_references where conta_id = a.ws), 'referencias cascateadas';
  assert not exists (select 1 from files where conta_id = a.ws), 'arquivos cascateados';
  raise notice 'PASS 99_post_references (l) workspace cascade';
end $$;
rollback;

-- ---- (o) bulk_move_items não move arquivo de referência ----
begin;
do $$
declare
  a record; v_post bigint; v_ref post_references;
  v_folder bigint; v_plain bigint; v_res json;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  a := pg_temp.pr_env('max', null);
  v_post := pg_temp.pr_post(a.ws, a.wf);
  v_ref := pg_temp.pr_file(a.ws, a.cli, v_post, 'image', 10);
  insert into folders (conta_id, name) values (a.ws, 'Pasta') returning id into v_folder;
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (a.ws, 'contas/' || a.ws || '/files/solto.png', 'solto.png', 'image', 'image/png', 10)
    returning id into v_plain;

  v_res := bulk_move_items(a.ws, array[v_ref.file_id], '{}'::bigint[], v_folder);
  assert v_res->>'code' = 'invalid_files', format('referencia deveria ser invalid_files, veio %s', v_res);
  assert (select folder_id from files where id = v_ref.file_id) is null, 'referencia continua fora de pastas';

  v_res := bulk_move_items(a.ws, array[v_ref.file_id, v_plain], '{}'::bigint[], v_folder);
  assert v_res->>'code' = 'invalid_files', 'lote misto e recusado inteiro';
  assert (select folder_id from files where id = v_plain) is null, 'nada movido no lote recusado';

  v_res := bulk_move_items(a.ws, array[v_plain], '{}'::bigint[], v_folder);
  assert (v_res->>'ok')::boolean and (select folder_id from files where id = v_plain) = v_folder,
    'arquivo comum continua movendo';

  raise notice 'PASS 99_post_references (o) bulk_move_items';
end $$;
rollback;
```

- [ ] **Step 3: Run the suite and watch it fail**

The shared local DB can be behind or drifted (on 2026-10-08 it was 39 migrations behind and had `20260925000010` recorded without its column). Reset it first so it matches the repo (this wipes local data only):
```bash
npx supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_post_references.sql
```
Run `psql` from the repo root (the suite's `\i supabase/tests/entitlements/_helpers.sql` is CWD-relative).
Expected: FAIL with
```
psql:supabase/tests/entitlements/99_post_references.sql:NN: ERROR:  type "post_references" does not exist
```

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20261010000001_post_references.sql`:

```sql
-- supabase/migrations/20261010000001_post_references.sql
-- Referências do cliente no post (spec
-- docs/superpowers/specs/2026-10-08-client-post-references-design.md).
--
-- 1. files.attached_to + stream_status 'skipped' (+ 1b. bulk_move_items ignora arquivo com dono)
-- 2. post_references (tabela, índices, RLS, grants)
-- 3. triggers: updated_at, reference_count, limpeza de órfão
-- 4. post_reference_can_remove / post_reference_list
-- 5. RPCs de escrita do Hub (insert de arquivo e link, nota, remoção)
-- 6. notificação post_client_reference (CHECKs + RPC com coalescência de 15 min)
--
-- Forward-only: um rollback mantém a CHECK expandida de stream_status enquanto
-- existir vídeo de referência (ver "Rollout" no spec).

-- =====================================================================
-- 1. files
-- =====================================================================
-- Arquivo de referência pertence ao post, não ao gerenciador de Arquivos.
-- file-manage filtra attached_to IS NULL na raiz.
ALTER TABLE files ADD COLUMN attached_to text
  CONSTRAINT files_attached_to_check CHECK (attached_to IN ('post_reference'));

COMMENT ON COLUMN files.attached_to IS
  'Dono do arquivo fora do gerenciador de Arquivos. post_reference = anexo do cliente em post_references; nunca listado em Arquivos.';

-- 'skipped' = vídeo que nunca vai para o Cloudflare Stream (referências).
-- A ingest do post-media-cleanup-cron só pega stream_status NULL/'pending'
-- (stream-steps.ts), o settle e o webhook só 'pending'; todo leitor de
-- playback testa === 'ready' e cai para o R2. Nome da constraint: gerado
-- pelo CHECK inline de 20260814000002_stream_video_playback.sql.
ALTER TABLE files DROP CONSTRAINT files_stream_status_check;
ALTER TABLE files ADD CONSTRAINT files_stream_status_check
  CHECK (stream_status IN ('pending', 'ready', 'error', 'skipped'));

-- 1b. bulk_move_items não move arquivo com dono (attached_to). Corpo
-- idêntico ao de 20260501000001_bulk_move_items_rpc.sql (a única definição;
-- 20260925000001 só trocou os grants), mais o predicado attached_to IS NULL
-- na validação (arquivo de referência conta como "não encontrado") e no
-- UPDATE. CREATE OR REPLACE preserva o ACL; o REVOKE/GRANT abaixo repete o
-- de 20260925000001:131-132 só para deixar explícito.
CREATE OR REPLACE FUNCTION bulk_move_items(
  p_conta_id uuid,
  p_file_ids bigint[],
  p_folder_ids bigint[],
  p_destination_id bigint DEFAULT NULL
)
RETURNS json AS $$
DECLARE
  v_file_count int;
  v_folder_count int;
  v_folder_id bigint;
  v_ancestors bigint[];
BEGIN
  -- Validate all files belong to conta_id
  IF coalesce(array_length(p_file_ids, 1), 0) > 0 THEN
    SELECT count(*) INTO v_file_count
    FROM files
    WHERE id = ANY(p_file_ids) AND conta_id = p_conta_id AND attached_to IS NULL;

    IF v_file_count <> array_length(p_file_ids, 1) THEN
      RETURN json_build_object('error', 'Some files not found or not owned', 'code', 'invalid_files');
    END IF;
  END IF;

  -- Validate all folders belong to conta_id and are not system folders
  IF coalesce(array_length(p_folder_ids, 1), 0) > 0 THEN
    SELECT count(*) INTO v_folder_count
    FROM folders
    WHERE id = ANY(p_folder_ids) AND conta_id = p_conta_id AND source = 'user';

    IF v_folder_count <> array_length(p_folder_ids, 1) THEN
      RETURN json_build_object('error', 'Some folders not found, not owned, or are system folders', 'code', 'invalid_folders');
    END IF;
  END IF;

  -- Validate destination exists and belongs to conta_id (if not null / root)
  IF p_destination_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM folders WHERE id = p_destination_id AND conta_id = p_conta_id) THEN
      RETURN json_build_object('error', 'Destination folder not found', 'code', 'invalid_destination');
    END IF;

    -- Check destination is not a post system folder when moving folders
    IF array_length(p_folder_ids, 1) > 0 THEN
      IF EXISTS (SELECT 1 FROM folders WHERE id = p_destination_id AND source = 'system' AND source_type = 'post') THEN
        RETURN json_build_object('error', 'Cannot move folders into post folders', 'code', 'post_folder_restriction');
      END IF;
    END IF;

    -- Check no folder is being moved into itself or a descendant
    FOREACH v_folder_id IN ARRAY p_folder_ids LOOP
      -- Build ancestor chain from destination up to root
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id FROM folders WHERE id = p_destination_id
        UNION ALL
        SELECT f.id, f.parent_id FROM folders f JOIN ancestors a ON f.id = a.parent_id
      )
      SELECT array_agg(id) INTO v_ancestors FROM ancestors;

      IF v_folder_id = ANY(v_ancestors) THEN
        RETURN json_build_object(
          'error', 'Cannot move folder into itself or a descendant',
          'code', 'cycle_detected',
          'folder_id', v_folder_id
        );
      END IF;
    END LOOP;
  END IF;

  -- Perform the moves
  IF array_length(p_file_ids, 1) > 0 THEN
    UPDATE files SET folder_id = p_destination_id
     WHERE id = ANY(p_file_ids) AND conta_id = p_conta_id AND attached_to IS NULL;
  END IF;

  IF coalesce(array_length(p_folder_ids, 1), 0) > 0 THEN
    UPDATE folders SET parent_id = p_destination_id, updated_at = now() WHERE id = ANY(p_folder_ids) AND conta_id = p_conta_id;
  END IF;

  RETURN json_build_object('ok', true, 'files_moved', coalesce(array_length(p_file_ids, 1), 0), 'folders_moved', coalesce(array_length(p_folder_ids, 1), 0));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION bulk_move_items(uuid, bigint[], bigint[], bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION bulk_move_items(uuid, bigint[], bigint[], bigint) TO service_role;

-- =====================================================================
-- 2. post_references
-- =====================================================================
CREATE TABLE post_references (
  id               bigserial PRIMARY KEY,
  post_id          bigint NOT NULL,
  conta_id         uuid   NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind             text   NOT NULL CHECK (kind IN ('file', 'link')),
  file_id          bigint,
  url              text,
  link_title       text CHECK (link_title IS NULL OR char_length(link_title) <= 120),
  note             text CHECK (note IS NULL OR char_length(note) <= 500),
  post_approval_id bigint REFERENCES post_approvals(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- FKs compostas: post e arquivo presos ao workspace da própria linha
  -- (workflow_posts_id_conta_uq 20260820000002, files_id_conta_uq 20260626000001).
  CONSTRAINT post_references_post_fk
    FOREIGN KEY (post_id, conta_id) REFERENCES workflow_posts(id, conta_id) ON DELETE CASCADE,
  CONSTRAINT post_references_file_fk
    FOREIGN KEY (file_id, conta_id) REFERENCES files(id, conta_id) ON DELETE CASCADE,
  CONSTRAINT post_references_shape CHECK (
    (kind = 'file' AND file_id IS NOT NULL AND url IS NULL AND link_title IS NULL) OR
    (kind = 'link' AND file_id IS NULL AND url IS NOT NULL)),
  -- Rede de segurança grosseira (esquema, host não vazio, sem user:pass@,
  -- sem espaço/controle, tamanho). A política autoritativa é do handler.
  CONSTRAINT post_references_url_shape CHECK (
    url IS NULL OR (
      char_length(url) <= 2048
      AND url ~* '^https?://[^/?#@[:space:]]+([/?#]|$)'
      AND url !~ '[[:space:][:cntrl:]]'))
);

CREATE INDEX post_references_post_idx ON post_references (post_id, created_at);
CREATE UNIQUE INDEX post_references_file_uq ON post_references (file_id) WHERE file_id IS NOT NULL;
CREATE INDEX post_references_approval_idx ON post_references (post_approval_id)
  WHERE post_approval_id IS NOT NULL;
-- FK composta de conta_id -> workspaces e a exclusão de workspace em cascata.
CREATE INDEX post_references_conta_idx ON post_references (conta_id);

ALTER TABLE post_references ENABLE ROW LEVEL SECURITY;

-- O CRM lê só a contagem (badge do drawer). Toda escrita passa por edge
-- function com service role: nenhuma policy de escrita para authenticated.
CREATE POLICY post_references_tenant_select ON post_references
  FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY post_references_service_role_bypass ON post_references
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Hosted default ACLs dão ALL em tabela nova para anon/authenticated:
-- revoga explicitamente e devolve só SELECT.
REVOKE ALL ON post_references FROM PUBLIC, anon, authenticated;
GRANT SELECT ON post_references TO authenticated;
GRANT ALL ON post_references TO service_role;
REVOKE ALL ON SEQUENCE post_references_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE post_references_id_seq TO service_role;

-- =====================================================================
-- 3. triggers
-- =====================================================================
CREATE OR REPLACE FUNCTION set_post_references_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION set_post_references_updated_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER post_references_updated_at
  BEFORE UPDATE ON post_references
  FOR EACH ROW EXECUTE FUNCTION set_post_references_updated_at();

-- reference_count: reaproveita file_update_reference_count()
-- (20260425000002), que lê NEW/OLD.file_id. Links não têm arquivo: o WHEN
-- evita o UPDATE inútil.
CREATE TRIGGER trg_post_reference_ref_count_ins
  AFTER INSERT ON post_references
  FOR EACH ROW WHEN (NEW.file_id IS NOT NULL)
  EXECUTE FUNCTION file_update_reference_count();
CREATE TRIGGER trg_post_reference_ref_count_del
  AFTER DELETE ON post_references
  FOR EACH ROW WHEN (OLD.file_id IS NOT NULL)
  EXECUTE FUNCTION file_update_reference_count();

-- Último vínculo some -> apaga o files, o que dispara file_enqueue_delete
-- (R2) e file_update_used_bytes (devolve a cota). Mesmo modelo de
-- ideia_file_cleanup_orphan (corpo mais recente em 20261003000001), checando
-- os quatro vínculos direto (independente da ordem dos triggers). Invariante:
-- arquivo de referência nunca é vinculado em outra tabela, por isso
-- ideia_file_cleanup_orphan e storage_autoclean_candidates não mudam.
CREATE OR REPLACE FUNCTION post_reference_cleanup_orphan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM post_references       WHERE file_id = OLD.file_id)
     AND NOT EXISTS (SELECT 1 FROM ideia_files           WHERE file_id = OLD.file_id)
     AND NOT EXISTS (SELECT 1 FROM post_file_links       WHERE file_id = OLD.file_id)
     AND NOT EXISTS (SELECT 1 FROM report_document_files WHERE file_id = OLD.file_id) THEN
    DELETE FROM files WHERE id = OLD.file_id;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION post_reference_cleanup_orphan() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_post_reference_cleanup_orphan
  AFTER DELETE ON post_references
  FOR EACH ROW WHEN (OLD.file_id IS NOT NULL)
  EXECUTE FUNCTION post_reference_cleanup_orphan();

-- =====================================================================
-- 4. leitura
-- =====================================================================
-- Decisão 2 do spec: o cliente remove/edita enquanto o post espera aprovação
-- E a equipe não agiu depois da referência:
--   - nenhuma resposta da equipe (post_approvals.is_workspace_user) depois;
--   - nenhum evento de status fora do cliente (reenvio da equipe, sistema)
--     depois. Isso trava as referências da rodada 1 quando a equipe manda
--     uma versão nova de volta para enviado_cliente.
-- post_approvals.created_at é nullable: linha com NULL nunca trava
-- (NULL > x é NULL, o NOT EXISTS não a conta).
CREATE OR REPLACE FUNCTION post_reference_can_remove(p_ref_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM post_references r
      JOIN workflow_posts wp ON wp.id = r.post_id AND wp.conta_id = r.conta_id
     WHERE r.id = p_ref_id
       AND wp.status = 'enviado_cliente'
       AND NOT EXISTS (
         SELECT 1 FROM post_approvals pa
          WHERE pa.post_id = r.post_id
            AND pa.is_workspace_user = true
            AND pa.created_at > r.created_at)
       AND NOT EXISTS (
         SELECT 1 FROM post_status_events e
          WHERE e.post_id = r.post_id
            AND e.source <> 'client'
            AND e.created_at > r.created_at)
  );
$$;
REVOKE ALL ON FUNCTION post_reference_can_remove(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_reference_can_remove(bigint) TO service_role;

-- Lista do post com os campos do arquivo (LEFT JOIN: links não têm).
-- Ownership do post é checada pelo handler; p_conta é a defesa extra.
CREATE OR REPLACE FUNCTION post_reference_list(p_post_id bigint, p_conta uuid)
RETURNS TABLE (
  id bigint, kind text, file_id bigint, url text, link_title text, note text,
  post_approval_id bigint, created_at timestamptz, can_remove boolean,
  name text, mime_type text, file_kind text, size_bytes bigint, width int, height int,
  duration_seconds int, r2_key text, thumbnail_r2_key text, blur_data_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.id, r.kind, r.file_id, r.url, r.link_title, r.note,
         r.post_approval_id, r.created_at, post_reference_can_remove(r.id),
         f.name, f.mime_type, f.kind, f.size_bytes, f.width, f.height,
         f.duration_seconds, f.r2_key, f.thumbnail_r2_key, f.blur_data_url
    FROM post_references r
    LEFT JOIN files f ON f.id = r.file_id AND f.conta_id = r.conta_id
   WHERE r.post_id = p_post_id
     AND r.conta_id = p_conta
   ORDER BY r.created_at, r.id;
$$;
REVOKE ALL ON FUNCTION post_reference_list(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_reference_list(bigint, uuid) TO service_role;

-- =====================================================================
-- 5. escrita (Hub, service role)
-- =====================================================================
-- Finalize atômico de arquivo: trava o post (dono = token), gate de status,
-- limite de 10, cota, files + referência, cobra a cota. Cota igual a
-- ideia_file_insert_with_quota (20260626000001): cobra só size_bytes,
-- simétrico ao reembolso de file_update_used_bytes; NULL = ilimitado.
CREATE OR REPLACE FUNCTION post_reference_file_insert(p jsonb)
RETURNS post_references
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta   uuid   := (p->>'conta_id')::uuid;
  v_cliente bigint := NULLIF(p->>'cliente_id', '')::bigint;
  v_post    bigint := (p->>'post_id')::bigint;
  v_size    bigint := (p->>'size_bytes')::bigint;
  v_kind    text   := p->>'file_kind';
  v_key     text   := NULLIF(p->>'r2_key', '');
  v_thumb   text   := NULLIF(p->>'thumbnail_r2_key', '');
  v_status  text;
  v_count   int;
  v_quota   bigint;
  v_used    bigint;
  v_file    files;
  v_row     post_references;
BEGIN
  -- 1. Trava o post: confere workspace + cliente do token E serializa
  --    finalizes concorrentes (limite race-safe). Mesmo lock que
  --    record_client_approval e as mudanças de status da equipe tomam.
  SELECT wp.status INTO v_status
    FROM workflow_posts wp
   WHERE wp.id = v_post AND wp.conta_id = v_conta AND wp.cliente_id = v_cliente
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'post_not_found' USING errcode = 'P0001'; END IF;
  IF v_status <> 'enviado_cliente' THEN
    RAISE EXCEPTION 'post_not_pending' USING errcode = 'P0001';
  END IF;

  -- 2. Limite (arquivos + links), serializado pelo lock acima.
  SELECT count(*) INTO v_count FROM post_references r WHERE r.post_id = v_post;
  IF v_count >= 10 THEN RAISE EXCEPTION 'reference_limit' USING errcode = 'P0001'; END IF;

  -- 2b. Chave nova de verdade. files.r2_key não é UNIQUE: sem isto um
  --     cliente do Hub finalizaria uma referência sobre a chave de uma
  --     mídia existente (de qualquer workspace), e o trigger de órfão
  --     apagaria depois o objeto dela no R2. Vale para as duas chaves, nas
  --     duas colunas (files_r2_key_idx, files_thumbnail_r2_key_idx).
  IF v_key IS NULL OR v_key = v_thumb OR EXISTS (
       SELECT 1 FROM files f
        WHERE f.r2_key = v_key OR f.thumbnail_r2_key = v_key
           OR f.r2_key = v_thumb OR f.thumbnail_r2_key = v_thumb) THEN
    RAISE EXCEPTION 'upload_mismatch' USING errcode = 'P0001';
  END IF;

  -- 3. Cota do plano. Trava a linha do workspace para ler used_bytes.
  SELECT w.storage_used_bytes INTO v_used FROM workspaces w WHERE w.id = v_conta FOR UPDATE;
  v_quota := effective_plan_limit(v_conta, 'storage_quota_bytes');
  IF v_quota IS NOT NULL AND COALESCE(v_used, 0) + v_size > v_quota THEN
    RAISE EXCEPTION 'quota_exceeded' USING errcode = 'P0001';
  END IF;

  -- 4. Arquivo: fora de pastas, dono = referência, sem uploader (Hub).
  --    Vídeo nunca vai para o Stream (decisão 3).
  INSERT INTO files (
    conta_id, folder_id, r2_key, thumbnail_r2_key, name, kind, mime_type,
    size_bytes, width, height, duration_seconds, blur_data_url, uploaded_by,
    attached_to, stream_status
  ) VALUES (
    v_conta, NULL, v_key, v_thumb,
    p->>'name', v_kind, p->>'mime_type', v_size,
    NULLIF(p->>'width', '')::int, NULLIF(p->>'height', '')::int,
    NULLIF(p->>'duration_seconds', '')::int,
    NULLIF(p->>'blur_data_url', ''), NULL,
    'post_reference', CASE WHEN v_kind = 'video' THEN 'skipped' END
  ) RETURNING * INTO v_file;

  -- 5. Referência (dispara o reference_count).
  INSERT INTO post_references (post_id, conta_id, kind, file_id, note)
  VALUES (v_post, v_conta, 'file', v_file.id, NULLIF(p->>'note', ''))
  RETURNING * INTO v_row;

  -- 6. Cobra a cota (só o arquivo, simétrico ao reembolso).
  UPDATE workspaces SET storage_used_bytes = storage_used_bytes + v_size
   WHERE id = v_conta;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION post_reference_file_insert(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_reference_file_insert(jsonb) TO service_role;

-- Link: mesmo lock, gate e limite. URL já validada pelo handler; a CHECK
-- post_references_url_shape é a rede de segurança.
CREATE OR REPLACE FUNCTION post_reference_link_insert(p jsonb)
RETURNS post_references
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta   uuid   := (p->>'conta_id')::uuid;
  v_cliente bigint := NULLIF(p->>'cliente_id', '')::bigint;
  v_post    bigint := (p->>'post_id')::bigint;
  v_status  text;
  v_count   int;
  v_row     post_references;
BEGIN
  SELECT wp.status INTO v_status
    FROM workflow_posts wp
   WHERE wp.id = v_post AND wp.conta_id = v_conta AND wp.cliente_id = v_cliente
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'post_not_found' USING errcode = 'P0001'; END IF;
  IF v_status <> 'enviado_cliente' THEN
    RAISE EXCEPTION 'post_not_pending' USING errcode = 'P0001';
  END IF;

  SELECT count(*) INTO v_count FROM post_references r WHERE r.post_id = v_post;
  IF v_count >= 10 THEN RAISE EXCEPTION 'reference_limit' USING errcode = 'P0001'; END IF;

  INSERT INTO post_references (post_id, conta_id, kind, url, link_title, note)
  VALUES (v_post, v_conta, 'link', p->>'url',
          NULLIF(p->>'link_title', ''), NULLIF(p->>'note', ''))
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION post_reference_link_insert(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_reference_link_insert(jsonb) TO service_role;

-- Nota e remoção pelo cliente. Checagem e escrita sob o lock do post: uma
-- resposta ou reenvio da equipe em paralelo espera ou vence, nunca intercala.
-- 'not_found': referência inexistente ou de post de outro cliente/workspace.
-- 'locked': can_remove (decisão 2) falso.
CREATE OR REPLACE FUNCTION post_reference_client_update(
  p_id bigint, p_conta uuid, p_cliente bigint, p_note text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_post bigint;
BEGIN
  SELECT r.post_id INTO v_post
    FROM post_references r
    JOIN workflow_posts wp ON wp.id = r.post_id AND wp.conta_id = r.conta_id
   WHERE r.id = p_id AND r.conta_id = p_conta AND wp.cliente_id = p_cliente;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  PERFORM 1 FROM workflow_posts wp WHERE wp.id = v_post FOR UPDATE;

  -- Pode ter sumido enquanto esperava o lock.
  IF NOT EXISTS (SELECT 1 FROM post_references r WHERE r.id = p_id) THEN
    RETURN 'not_found';
  END IF;
  IF NOT post_reference_can_remove(p_id) THEN RETURN 'locked'; END IF;

  UPDATE post_references SET note = NULLIF(p_note, '') WHERE id = p_id;
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION post_reference_client_update(bigint, uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_reference_client_update(bigint, uuid, bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION post_reference_client_delete(
  p_id bigint, p_conta uuid, p_cliente bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_post bigint;
BEGIN
  SELECT r.post_id INTO v_post
    FROM post_references r
    JOIN workflow_posts wp ON wp.id = r.post_id AND wp.conta_id = r.conta_id
   WHERE r.id = p_id AND r.conta_id = p_conta AND wp.cliente_id = p_cliente;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  PERFORM 1 FROM workflow_posts wp WHERE wp.id = v_post FOR UPDATE;

  IF NOT EXISTS (SELECT 1 FROM post_references r WHERE r.id = p_id) THEN
    RETURN 'not_found';
  END IF;
  IF NOT post_reference_can_remove(p_id) THEN RETURN 'locked'; END IF;

  -- Dispara reference_count e a limpeza de órfão (files -> R2 + cota).
  DELETE FROM post_references WHERE id = p_id;
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION post_reference_client_delete(bigint, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_reference_client_delete(bigint, uuid, bigint) TO service_role;

-- =====================================================================
-- 6. notificação post_client_reference
-- =====================================================================
-- Listas copiadas de 20261008000002_agenda_convidados.sql (a definição mais
-- recente), só ACRESCENTANDO post_client_reference. Fora das prefs de e-mail:
-- claim_notification_emails tem allowlist própria, nenhum e-mail sai. Este
-- arquivo passa a ser a definição mais recente: a próxima migration copia
-- DAQUI.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'post_approved', 'post_correction', 'post_message',
    'idea_submitted', 'briefing_answered',
    'step_activated', 'step_completed', 'post_assigned',
    'workflow_completed', 'deadline_approaching',
    'invite_accepted', 'member_role_changed', 'member_removed',
    'post_edit_suggestion', 'task_assigned', 'client_message',
    'mention', 'post_status_automation',
    'instagram_connected_by_client',
    'post_publish_failed', 'storage_autoclean_report',
    'instagram_automation_failed',
    'event_invited', 'event_updated', 'event_cancelled', 'event_rsvp', 'event_reminder',
    'event_client_rsvp', 'event_reschedule_requested', 'event_guest_rsvp',
    'post_client_reference'
  )
);

ALTER TABLE public.notification_inapp_prefs DROP CONSTRAINT notification_inapp_prefs_type_check;
ALTER TABLE public.notification_inapp_prefs ADD CONSTRAINT notification_inapp_prefs_type_check CHECK (type IN (
  'post_approved','post_correction','post_message','post_edit_suggestion',
  'idea_submitted','briefing_answered','step_activated','step_completed',
  'post_assigned','task_assigned','workflow_completed','deadline_approaching',
  'invite_accepted','member_role_changed','member_removed','client_message',
  'mention','post_status_automation','instagram_connected_by_client',
  'post_publish_failed','storage_autoclean_report','instagram_automation_failed',
  'event_invited','event_updated','event_cancelled','event_rsvp','event_reminder',
  'event_client_rsvp','event_reschedule_requested','event_guest_rsvp',
  'post_client_reference',
  '__all__'
));

-- Alvos e link iguais a create_edit_suggestion_notification (20260928150001,
-- que lê conta/cliente direto do post: funciona para post avulso).
-- Coalescência: pula o alvo que já tem uma post_client_reference não lida
-- (e não dispensada) do mesmo post criada nos últimos 15 minutos, então dez
-- envios seguidos geram uma notificação. insert_notification_batch não tem
-- dedupe; o advisory lock por post serializa chamadas concorrentes para que
-- duas não passem juntas pelo filtro.
CREATE OR REPLACE FUNCTION create_post_reference_notification(p_post_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
BEGIN
  SELECT wp.responsavel_id, wp.workflow_id, wp.titulo, wp.conta_id, wp.cliente_id
    INTO v_responsavel_id, v_workflow_id, v_post_title, v_conta_id, v_cliente_id
    FROM workflow_posts wp
   WHERE wp.id = p_post_id;

  IF v_conta_id IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('post_client_reference:' || p_post_id, 0));

  SELECT c.nome INTO v_client_name FROM clientes c WHERE c.id = v_cliente_id;

  v_targets := resolve_notification_targets(v_conta_id, v_responsavel_id, ARRAY['owner','admin']);

  SELECT array_agg(t) INTO v_targets
    FROM unnest(COALESCE(v_targets, '{}'::uuid[])) AS t
   WHERE t IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM notifications n
        WHERE n.user_id = t
          AND n.type = 'post_client_reference'
          AND n.read_at IS NULL
          AND n.dismissed_at IS NULL
          AND n.metadata->>'post_id' = p_post_id::text
          AND n.created_at > now() - interval '15 minutes');

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
    'post_id',     p_post_id
  );

  PERFORM insert_notification_batch(v_conta_id, v_targets, 'post_client_reference', v_link, v_metadata, NULL);

  RETURN array_length(v_targets, 1);
END;
$$;
REVOKE ALL ON FUNCTION create_post_reference_notification(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_post_reference_notification(bigint) TO service_role;
```

- [ ] **Step 5: Apply it locally and run the suite until it passes**

```bash
npx supabase migration up
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_post_references.sql
```
Expected: exit 0 and six notices:
```
NOTICE:  PASS 99_post_references (a, b) grants + RLS
NOTICE:  PASS 99_post_references (c-f, m, n) inserts, gates, cota, URL, nulls, mismatch
NOTICE:  PASS 99_post_references (g-j) update/delete, orfao, cascata, lista
NOTICE:  PASS 99_post_references (k) notificacao coalescida
NOTICE:  PASS 99_post_references (l) workspace cascade
NOTICE:  PASS 99_post_references (o) bulk_move_items
```
(`migration up` applies only pending local migrations. If it complains about history, `npx supabase db reset` re-applies everything including the new file.)

Then the whole CI set, to prove the `files` CHECK change and the notification CHECK rewrite broke no other suite (notably `65_stream_video_columns.sql`, `63_storage_autoclean.sql`, `64_notification_email_prefs.sql`, `73_notification_center.sql`, `99_report_image_files.sql`):
```bash
bash scripts/test-entitlements.sh
```
Expected: every line `PASS ...`, last line `ran=<N>  failures=0`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261010000001_post_references.sql supabase/tests/entitlements/99_post_references.sql
git commit -m "$(cat <<'MSG'
feat(db): post_references table, RPCs and client-reference notification

Client references on posts (spec 2026-10-08): post_references with RLS
read-only for the CRM, files.attached_to, stream_status 'skipped' for
reference videos, insert/update/delete RPCs gated on enviado_cliente and
can_remove, orphan cleanup refunding quota, and a coalesced
post_client_reference notification. CI-gated SQL suite included.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

**Notes for later tasks / rollout:**
- Deploy order (spec "Rollout"): `npx supabase db push --linked` to staging, then prod, BEFORE merging (merge deploys the frontend). The migration is forward-only.
- Optional, not required by CI: add the seven new function signatures to the array in `supabase/tests/entitlements/96_lockdown_definer_function_grants.sql`. The new suite's block (a) already asserts service_role/anon/authenticated EXECUTE for each, so this is only for keeping one central list.
- The verification above was done on 2026-10-08 by applying the 39 pending migrations + this migration + this suite inside one rolled-back transaction against the local DB: all six blocks passed, and so did the neighbouring suites `63_storage_autoclean`, `64_notification_email_prefs`, `65_stream_video_columns`, `73_notification_center`, `99_report_image_files` and `96_lockdown_definer_function_grants` on top of the new migration; the suite fails without the migration (`type "post_references" does not exist`), and it catches five mutations (status-event clause removed from `can_remove`, dedupe removed, `'skipped'` not set, `upload_mismatch` raise removed, `attached_to IS NULL` removed from `bulk_move_items`' validation).

#### Contract issues

None blocking. Interpretations and small additions to flag:
1. **Dedupe "unread" includes "not dismissed".** The coalescing filter is `read_at IS NULL AND dismissed_at IS NULL AND metadata->>'post_id' = p_post_id::text AND created_at > now() - interval '15 minutes'`. A dismissed-but-unread notification no longer suppresses a new one, matching what the Central de Notificações shows. Concurrent calls for the same post are serialized with `pg_advisory_xact_lock(hashtextextended('post_client_reference:' || p_post_id, 0))`.
2. **Extra index** `post_references_conta_idx (conta_id)`, not in the spec, for the `conta_id -> workspaces ON DELETE CASCADE` FK and the RLS predicate. Drop it if the reviewer prefers the spec's exact index list.
3. **The RPC does not require a thumbnail for images.** The spec says thumbnails are required for image and video; the DB only enforces video (`files_video_requires_thumbnail`). The `hub-post-references` handler is the authority for the image rule, as the spec's route table says.
4. **`files_attached_to_check` is named explicitly** in the column definition (the auto-generated name would be the same; naming it makes a future down-migration greppable).
5. **`upload_mismatch` race.** The key check runs under the post lock, not a key lock, so two concurrent finalizes of the SAME fresh key on two different posts could both pass. Keys are server-generated UUIDs from the presign, so this needs a client replaying its own key twice at the same instant; the threat the check closes (reusing an existing media key) is not concurrent. Add `pg_advisory_xact_lock(hashtextextended(v_key, 0))` if the reviewer wants it airtight.
6. **`bulk_move_items` keeps its original properties** (`SECURITY DEFINER`, no `SET search_path`), as asked: body verbatim plus the predicate. Hardening its search_path is out of scope.

#### Verified facts

- `files_stream_status_check` is the auto-generated name of the inline CHECK in `supabase/migrations/20260814000002_stream_video_playback.sql:6`; confirmed in the local DB via `pg_constraint` (`files_stream_status_check | CHECK ((stream_status = ANY (ARRAY['pending','ready','error'])))`).
- `files` table, `files_video_requires_thumbnail`, `reference_count`, `uploaded_by` nullable: `supabase/migrations/20260425000001_file_system_tables.sql:37-56`.
- `files_id_conta_uq`: `supabase/migrations/20260626000001_ideia_files.sql:8`. `workflow_posts_id_conta_uq`: `supabase/migrations/20260820000002_ica_workflow_post_target.sql:18`.
- `file_update_reference_count()` does `UPDATE files ... WHERE id = NEW.file_id` / `OLD.file_id` with no NULL guard (NULL just updates zero rows); trigger `WHEN` clauses guard it anyway: `supabase/migrations/20260425000002_file_system_triggers.sql:130-147`.
- `file_enqueue_delete` (latest, NULL r2_key guard + stream_uid): `20260814000002_stream_video_playback.sql:18-33`; `file_update_used_bytes` + `trg_file_used_bytes_del`: `20260425000002_file_system_triggers.sql:264-279`.
- Orphan model, latest `ideia_file_cleanup_orphan` body (with `report_document_files` guard and `SET search_path = public, pg_temp`): `supabase/migrations/20261003000001_report_image_block.sql:195-208`.
- Quota model `ideia_file_insert_with_quota`: `supabase/migrations/20260626000001_ideia_files.sql:66-129`; `effective_plan_limit(ws_id uuid, limit_key text)`: `supabase/migrations/20260611130001_effective_plan_limit.sql:4`.
- No generic updated_at touch function exists (`set_updated_at()` dropped in `20260414114145_ideias_trigger_fix.sql:20`); per-table model `set_post_edit_suggestions_updated_at()`: `20260521000001_post_edit_suggestions.sql:45-56`.
- Grants pattern: `20261009000001_instagram_automation_contacts.sql:47-73`; sequence grants: `20261008000002_agenda_convidados.sql:97-98`.
- `create_edit_suggestion_notification` (reads `wp.conta_id`/`wp.cliente_id` directly, link CASE, metadata): `supabase/migrations/20260928150001_edit_suggestion_update_flow.sql:180-248`.
- `resolve_notification_targets`: `20260430000001_notifications.sql:133-171`; `insert_notification_batch` (no dedupe): `20260430000001_notifications.sql:176-200`; no later redefinition (only grant changes in `20260925000001_lockdown_definer_function_grants.sql:121-125`).
- `notifications` columns `read_at`, `dismissed_at`, `metadata jsonb`, `created_at`: `20260430000001_notifications.sql:13-24`; partial index `idx_notifications_user_unread (user_id, created_at DESC) WHERE read_at IS NULL` (local `\d notifications`).
- Newest `notifications_type_check` / `notification_inapp_prefs_type_check`: `20261008000002_agenda_convidados.sql:122-147` (no later migration touches them; `notification_email_prefs_type_check` left alone).
- `post_approvals.created_at` nullable (`timestamptz DEFAULT now()`, no NOT NULL), `is_workspace_user boolean NOT NULL DEFAULT false`: `20260402_workflow_posts.sql:58-66`.
- `post_status_events(post_id, conta_id, from_status, to_status, source, created_at, ...)`, `source CHECK IN ('workspace_user','client','system')`: `20260606000001_post_status_events.sql:16` + local `\d post_status_events`; the Hub reads these columns at `supabase/functions/hub-post-history/handler.ts:170-175`.
- `workflow_posts_status_event` fires only `AFTER UPDATE OF status, custom_status_id` (`20260805000001_post_status_definitions.sql:275-278`), so the suite inserts posts directly as `enviado_cliente` to avoid a status event at the frozen `now()`.
- Stream ingest predicate `kind='video' AND stream_uid IS NULL AND (stream_status IS NULL OR 'pending')`: `supabase/functions/post-media-cleanup-cron/stream-steps.ts:134-140`.
- `get_my_conta_id()` (active workspace + membership): `20260713000001_secure_workspace_invites.sql:4-19`.
- Test harness: `et_grant_hosted_parity(p_exclude)` and `et_make_workspace(plan, overrides)`: `supabase/tests/entitlements/_helpers.sql`; quota override pattern `et_make_workspace('pro', '{"storage_quota_bytes": 1000}')`: `65_instagram_automations.sql:1098`; runner and DB URL: `scripts/test-entitlements.sh`; CI job: `.github/workflows/ci.yml:203-216`.
- `bulk_move_items` has a single body, `supabase/migrations/20260501000001_bulk_move_items_rpc.sql:1-79` (`LANGUAGE plpgsql SECURITY DEFINER`, no search_path); `20260925000001_lockdown_definer_function_grants.sql:131-132` only revokes/grants (service_role); `96_lockdown_definer_function_grants.sql` pins that grant and still passes after the replace.
- `files_r2_key_idx (r2_key)`: `20260425000001_file_system_tables.sql:59`; `files_thumbnail_r2_key_idx`: `20261002000001_perf_files_thumbnail_idx_views_initplan.sql:22-23`. Both back the `upload_mismatch` lookup.
- Plan `max` has no `max_posts_per_workflow` limit and a 25 GB quota (local `plans` table), so the suite's posts never hit `trg_limit_posts`.


---

### Task 2: Shared module `_shared/post-references.ts` + `signGetUrl` download name

All commands run from the worktree root
`/Users/eduardosouza/projects/sm-crm/.claude/worktrees/client-file-link-attachments-5a50d3`.

Deno test command used throughout (same flags as `npm run test:functions`; plain
`deno test` cannot resolve the `npm:` specifiers `_shared/r2.ts` imports):

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys <file>
```

Every Deno run rewrites the ROOT `deno.lock` and can pollute `node_modules/.deno`. Before
each commit run `git checkout -- deno.lock` and never stage it. Before any frontend `tsc`
or `npm run test` after a Deno run, run `npm ci` (duplicate `@tiptap/core` otherwise).

**Files:**
- Modify: `supabase/functions/_shared/safe-href.ts` (export `CONTROL_OR_SPACE`)
- Modify: `supabase/functions/_shared/r2.ts` (`attachmentDisposition`, `signGetUrl(key, expires, downloadName?)`)
- Create: `supabase/functions/_shared/post-references.ts`
- Create: `supabase/functions/__tests__/r2-sign_test.ts`
- Create: `supabase/functions/__tests__/post-references-shared_test.ts`

**Interfaces:**
- Consumes: SQL from Task 1: `post_reference_list(p_post_id bigint, p_conta uuid)` (TABLE rows,
  ordered), `post_reference_file_insert(p jsonb) RETURNS post_references`,
  `post_reference_link_insert(p jsonb) RETURNS post_references` (RAISE messages
  `post_not_found | post_not_pending | reference_limit | quota_exceeded`);
  `effective_plan_limit` via `_shared/entitlements-rpc.ts`.
- Produces (all from `_shared/post-references.ts`): every contract export
  (`ReferenceFileKind`, `REFERENCE_MIME`, `MAX_REFERENCES_PER_POST`, `MAX_REFERENCE_THUMB_BYTES`,
  `MAX_REFERENCE_NOTE`, `MAX_REFERENCE_LINK_TITLE`, `MAX_REFERENCE_URL`,
  `normalizeReferenceUrl`, `ReferenceItem`, `ReferenceErrorCode`) plus helpers used by Tasks 3-5:
  `REFERENCE_ERROR_STATUS`, `ReferenceResult = { status, body }`, `referenceError(code)`,
  `ReferencesDb`, `SignGetUrl`, `SignPutUrl`, `HeadObject`, `referenceMimeSpec(mime)`,
  `parsePositiveId(v)`, `normalizeReferenceNote(raw)`, `normalizeReferenceLinkTitle(raw)`,
  `sanitizeReferenceName(raw, ext)`, `linkDomain(url)`, `ReferenceListRow`,
  `toReferenceItem(row, signGetUrl, { includeDownload })`,
  `listPostReferences({ db, post_id, conta_id, signGetUrl, includeDownload })`,
  `mapReferenceRpcError(error, scope)`, `presignReferenceUpload(...)`,
  `finalizeReferenceFile(...)`, `insertReferenceLink(...)`.
  From `_shared/r2.ts`: `attachmentDisposition(filename)` and
  `signGetUrl(key, expiresSeconds = 3600, downloadName?)`.
  From `_shared/safe-href.ts`: `CONTROL_OR_SPACE`.

- [ ] **Step 1: Write the failing r2 test**

Create `supabase/functions/__tests__/r2-sign_test.ts`:

```ts
// Pina o Content-Disposition do download de referências (post-references GET
// download_url): só com downloadName, RFC 5987, e sem mexer na URL comum.
import { assertEquals } from "./assert.ts";

Deno.env.set("R2_ACCOUNT_ID", "testaccount");
Deno.env.set("R2_ACCESS_KEY_ID", "testkey");
Deno.env.set("R2_SECRET_ACCESS_KEY", "testsecret");
Deno.env.set("R2_BUCKET", "test-bucket");

const { attachmentDisposition, signGetUrl } = await import("../_shared/r2.ts");

Deno.test("attachmentDisposition: RFC 5987 ext-value, escapes ' ( ) * too", () => {
  assertEquals(
    attachmentDisposition("Relatório final (v2).pdf"),
    "attachment; filename*=UTF-8''Relat%C3%B3rio%20final%20%28v2%29.pdf",
  );
  assertEquals(attachmentDisposition("it's*.png"), "attachment; filename*=UTF-8''it%27s%2A.png");
});

Deno.test("signGetUrl: response-content-disposition only when downloadName is given", async () => {
  const plain = new URL(await signGetUrl("contas/c/files/a.pdf", 3600));
  assertEquals(plain.searchParams.get("response-content-disposition"), null);

  const dl = new URL(await signGetUrl("contas/c/files/a.pdf", 3600, "Relatório final (v2).pdf"));
  assertEquals(
    dl.searchParams.get("response-content-disposition"),
    "attachment; filename*=UTF-8''Relat%C3%B3rio%20final%20%28v2%29.pdf",
  );
  assertEquals(dl.searchParams.get("X-Amz-Expires"), "3600");
});
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/r2-sign_test.ts
```
Expected: FAIL. `attachmentDisposition is not a function` (and the disposition assertion
fails because `signGetUrl` ignores the third argument).

- [ ] **Step 3: Implement the r2 change**

In `supabase/functions/_shared/r2.ts` replace the current `signGetUrl` (lines 46-49):

```ts
export async function signGetUrl(key: string, expiresSeconds = 3600) {
  const cmd = new GetObjectCommand({ Bucket: getBucket(), Key: key });
  return getSignedUrl(getR2(), cmd, { expiresIn: expiresSeconds });
}
```

with:

```ts
/** Content-Disposition de download (RFC 6266 + RFC 5987). encodeURIComponent deixa
 * ' ( ) * ! sem escapar; ' encerraria o ext-value, então os cinco viram %XX. */
export function attachmentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename)
    .replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename*=UTF-8''${encoded}`;
}

/** downloadName (opcional) faz o R2 servir o objeto como anexo com esse nome
 * (post-references download_url). Sem ele a URL é idêntica à de antes. */
export async function signGetUrl(key: string, expiresSeconds = 3600, downloadName?: string) {
  const cmd = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ...(downloadName ? { ResponseContentDisposition: attachmentDisposition(downloadName) } : {}),
  });
  return getSignedUrl(getR2(), cmd, { expiresIn: expiresSeconds });
}
```

- [ ] **Step 4: Run the r2 test, confirm it passes**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/r2-sign_test.ts
```
Expected: `ok | 2 passed | 0 failed`.

- [ ] **Step 5: Export `CONTROL_OR_SPACE`**

In `supabase/functions/_shared/safe-href.ts` line 7, replace:

```ts
const CONTROL_OR_SPACE = /[\x00-\x20\x7F]/;
```

with:

```ts
export const CONTROL_OR_SPACE = /[\x00-\x20\x7F]/;
```

(No `g` flag, so `.test()` is stateless and safe to share.)

- [ ] **Step 6: Write the failing shared-module test**

Create `supabase/functions/__tests__/post-references-shared_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import {
  linkDomain,
  mapReferenceRpcError,
  MAX_REFERENCE_NOTE,
  normalizeReferenceLinkTitle,
  normalizeReferenceNote,
  normalizeReferenceUrl,
  parsePositiveId,
  REFERENCE_ERROR_STATUS,
  REFERENCE_MIME,
  referenceMimeSpec,
  sanitizeReferenceName,
  toReferenceItem,
  type ReferenceListRow,
} from "../_shared/post-references.ts";

const sign = async (key: string, _exp?: number, name?: string) =>
  `https://get.example.com/${key}${name ? `?dl=${name}` : ""}`;

function fileRow(fields: Partial<ReferenceListRow> = {}): ReferenceListRow {
  return {
    id: 7, kind: "file", file_id: 70, url: null, link_title: null, note: "Use esta",
    post_approval_id: 501, created_at: "2026-10-08T11:00:00.000Z", can_remove: false,
    name: "foto.png", mime_type: "image/png", file_kind: "image", size_bytes: 5000,
    width: 1080, height: 1350, duration_seconds: null,
    r2_key: "contas/c/files/u.png", thumbnail_r2_key: "contas/c/files/u.thumb.webp",
    blur_data_url: null, ...fields,
  };
}

Deno.test("normalizeReferenceUrl: completes the scheme and returns the parsed href", () => {
  assertEquals(normalizeReferenceUrl("exemplo.com/post"), "https://exemplo.com/post");
  assertEquals(normalizeReferenceUrl("  https://Exemplo.com  "), "https://exemplo.com/");
  assertEquals(normalizeReferenceUrl("http://exemplo.com/a?b=1#c"), "http://exemplo.com/a?b=1#c");
  assertEquals(normalizeReferenceUrl("exemplo.com:8080/x"), "https://exemplo.com:8080/x");
  assertEquals(normalizeReferenceUrl("www.instagram.com/p/abc/"), "https://www.instagram.com/p/abc/");
});

Deno.test("normalizeReferenceUrl: rejects schemes, credentials, whitespace, control chars, length", () => {
  const bad = [
    "", "   ", "javascript:alert(1)", "data:text/html,<b>x</b>", "ftp://exemplo.com/a",
    "mailto:a@b.com", "https://user:pw@exemplo.com", "https://user@exemplo.com",
    "https://exem plo.com", "https://exemplo.com/\tx", "https://exemplo.com/\u0000",
    "https://exemplo.com:99999/", "https://", `https://exemplo.com/${"a".repeat(2048)}`,
  ];
  for (const raw of bad) assertEquals(normalizeReferenceUrl(raw), null, `should reject ${JSON.stringify(raw)}`);
  assertEquals(normalizeReferenceUrl(42 as unknown as string), null);
});

Deno.test("normalizeReferenceNote / LinkTitle: trim, empty to null, code-point cap, type check", () => {
  assertEquals(normalizeReferenceNote(undefined), { ok: true, value: null });
  assertEquals(normalizeReferenceNote(null), { ok: true, value: null });
  assertEquals(normalizeReferenceNote("   "), { ok: true, value: null });
  assertEquals(normalizeReferenceNote("  troca a capa  "), { ok: true, value: "troca a capa" });
  // 500 emoji = 1000 UTF-16 units but 500 code points, which is what char_length counts.
  assertEquals(normalizeReferenceNote("😀".repeat(MAX_REFERENCE_NOTE)).ok, true);
  assertEquals(normalizeReferenceNote("a".repeat(MAX_REFERENCE_NOTE + 1)), { ok: false });
  assertEquals(normalizeReferenceNote(12), { ok: false });
  assertEquals(normalizeReferenceLinkTitle("a".repeat(120)).ok, true);
  assertEquals(normalizeReferenceLinkTitle("a".repeat(121)), { ok: false });
});

Deno.test("referenceMimeSpec: allowlist with per-kind caps; prototype keys are not types", () => {
  assertEquals(referenceMimeSpec("video/quicktime"), { kind: "video", ext: "mov", maxBytes: 200 * 1024 * 1024 });
  assertEquals(referenceMimeSpec("application/pdf")?.maxBytes, 25 * 1024 * 1024);
  assertEquals(referenceMimeSpec("image/gif")?.kind, "image");
  assertEquals(referenceMimeSpec("image/svg+xml"), null);
  assertEquals(referenceMimeSpec("toString"), null);
  assertEquals(referenceMimeSpec(undefined), null);
  assertEquals(Object.keys(REFERENCE_MIME).length, 8);
});

Deno.test("sanitizeReferenceName: strips control chars and slashes, falls back by extension", () => {
  assertEquals(sanitizeReferenceName("  ../foto\u0000final.png ", "png"), ".._fotofinal.png");
  assertEquals(sanitizeReferenceName("", "pdf"), "referencia.pdf");
  assertEquals(sanitizeReferenceName(undefined, "mp4"), "referencia.mp4");
  assertEquals(sanitizeReferenceName("x".repeat(300), "png").length, 200);
});

Deno.test("parsePositiveId and linkDomain", () => {
  assertEquals(parsePositiveId(7), 7);
  assertEquals(parsePositiveId("7"), 7);
  assertEquals(parsePositiveId(0), null);
  assertEquals(parsePositiveId(-1), null);
  assertEquals(parsePositiveId(1.5), null);
  assertEquals(parsePositiveId("7a"), null);
  assertEquals(parsePositiveId(null), null);
  assertEquals(linkDomain("https://www.exemplo.com/a"), "exemplo.com");
  assertEquals(linkDomain("not a url"), null);
});

Deno.test("toReferenceItem: file signs url/thumb; download only when asked", async () => {
  const hub = await toReferenceItem(fileRow(), sign, { includeDownload: false });
  assertEquals(hub.kind, "file");
  assertEquals(hub.url, "https://get.example.com/contas/c/files/u.png");
  assertEquals(hub.thumbnail_url, "https://get.example.com/contas/c/files/u.thumb.webp");
  assertEquals(hub.download_url, null);
  assertEquals(hub.post_approval_id, 501);
  assertEquals(hub.can_remove, false);
  assertEquals(hub.link_url, null);

  const crm = await toReferenceItem(fileRow(), sign, { includeDownload: true });
  assertEquals(crm.download_url, "https://get.example.com/contas/c/files/u.png?dl=foto.png");

  const pdf = await toReferenceItem(
    fileRow({ mime_type: "application/pdf", file_kind: "document", thumbnail_r2_key: null }),
    sign, { includeDownload: false },
  );
  assertEquals(pdf.thumbnail_url, null);
  assertEquals(pdf.file_kind, "document");
});

Deno.test("toReferenceItem: link has link fields and never a download", async () => {
  const item = await toReferenceItem(
    fileRow({
      kind: "link", file_id: null, url: "https://www.exemplo.com/post", link_title: "Inspiração",
      name: null, mime_type: null, file_kind: null, size_bytes: null, width: null, height: null,
      r2_key: null, thumbnail_r2_key: null,
    }),
    sign, { includeDownload: true },
  );
  assertEquals(item.kind, "link");
  assertEquals(item.link_url, "https://www.exemplo.com/post");
  assertEquals(item.link_title, "Inspiração");
  assertEquals(item.link_domain, "exemplo.com");
  assertEquals(item.url, null);
  assertEquals(item.download_url, null);
  assertEquals(item.file_kind, null);
});

Deno.test("mapReferenceRpcError: known RAISE codes map; anything else is a generic 500", () => {
  assertEquals(mapReferenceRpcError({ message: "post_not_found" }, "t"), { status: 404, body: { error: "not_found" } });
  assertEquals(mapReferenceRpcError({ message: "post_not_pending" }, "t"), { status: 409, body: { error: "post_not_pending" } });
  assertEquals(mapReferenceRpcError({ message: "reference_limit" }, "t"), { status: 409, body: { error: "reference_limit" } });
  assertEquals(mapReferenceRpcError({ message: "quota_exceeded" }, "t"), { status: 413, body: { error: "quota_exceeded" } });
  assertEquals(mapReferenceRpcError({ message: "upload_mismatch" }, "t"), { status: 400, body: { error: "upload_mismatch" } });
  const raw = mapReferenceRpcError({ message: 'duplicate key value violates unique constraint "x"' }, "t");
  assertEquals(raw, { status: 500, body: { error: "internal" } });
  assertEquals(mapReferenceRpcError(null, "t").status, 500);
});

Deno.test("REFERENCE_ERROR_STATUS covers the HTTP mapping in the contract", () => {
  assertEquals(REFERENCE_ERROR_STATUS.unsupported_type, 415);
  assertEquals(REFERENCE_ERROR_STATUS.too_large, 413);
  assertEquals(REFERENCE_ERROR_STATUS.locked, 409);
  assertEquals(REFERENCE_ERROR_STATUS.rate_limited, 429);
  assertEquals(REFERENCE_ERROR_STATUS.internal, 500);
  assert(Object.values(REFERENCE_ERROR_STATUS).every((s) => [400, 404, 409, 413, 415, 429, 500].includes(s)));
});
```

- [ ] **Step 7: Run it, confirm it fails**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/post-references-shared_test.ts
```
Expected: FAIL with `Module not found ".../_shared/post-references.ts"`.

- [ ] **Step 8: Implement `_shared/post-references.ts`**

Create `supabase/functions/_shared/post-references.ts`:

```ts
// Referências do cliente no post (spec docs/superpowers/specs/2026-10-08-client-post-references-design.md).
// Compartilhado por hub-post-references (token do Hub) e post-references (JWT do CRM).
// Todo resultado é { status, body }; erro é sempre { error: ReferenceErrorCode } para o
// Hub mapear a copy sem ler texto livre (regra de segurança: nunca erro cru de DB).
import { effectivePlanLimit } from "./entitlements-rpc.ts";
import { CONTROL_OR_SPACE } from "./safe-href.ts";

export type ReferenceFileKind = "image" | "video" | "document";

const MB = 1024 * 1024;

export const REFERENCE_MIME: Record<string, { kind: ReferenceFileKind; ext: string; maxBytes: number }> = {
  "image/jpeg": { kind: "image", ext: "jpg", maxBytes: 25 * MB },
  "image/png": { kind: "image", ext: "png", maxBytes: 25 * MB },
  "image/webp": { kind: "image", ext: "webp", maxBytes: 25 * MB },
  "image/gif": { kind: "image", ext: "gif", maxBytes: 25 * MB },
  "application/pdf": { kind: "document", ext: "pdf", maxBytes: 25 * MB },
  "video/mp4": { kind: "video", ext: "mp4", maxBytes: 200 * MB },
  "video/quicktime": { kind: "video", ext: "mov", maxBytes: 200 * MB },
  "video/webm": { kind: "video", ext: "webm", maxBytes: 200 * MB },
};

export const MAX_REFERENCES_PER_POST = 10;
export const MAX_REFERENCE_THUMB_BYTES = 512 * 1024;
export const MAX_REFERENCE_NOTE = 500;
export const MAX_REFERENCE_LINK_TITLE = 120;
export const MAX_REFERENCE_URL = 2048;
/** URLs GET assinadas (arquivo e thumbnail) valem 1h, como em hub-ideias. */
export const REFERENCE_SIGNED_URL_TTL = 3600;

const MAX_REFERENCE_NAME = 200;
const MAX_BLUR_DATA_URL = 10_000;
const MAX_DIMENSION = 100_000;
const MAX_VIDEO_SECONDS = 24 * 3600;
const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export interface ReferenceItem {
  id: number;
  kind: "file" | "link";
  file_kind: ReferenceFileKind | null;
  name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  url: string | null;
  thumbnail_url: string | null;
  blur_data_url: string | null;
  download_url: string | null; // CRM only, files only; Hub always null
  link_url: string | null;
  link_title: string | null;
  link_domain: string | null;
  note: string | null;
  post_approval_id: number | null;
  created_at: string;
  can_remove: boolean;
}

export type ReferenceErrorCode =
  | "unsupported_type" | "too_large" | "thumbnail_invalid" | "reference_limit"
  | "quota_exceeded" | "post_not_pending" | "invalid_url" | "invalid_note"
  | "not_found" | "locked" | "rate_limited" | "upload_mismatch" | "internal";

export const REFERENCE_ERROR_STATUS: Record<ReferenceErrorCode, number> = {
  unsupported_type: 415,
  too_large: 413,
  thumbnail_invalid: 400,
  reference_limit: 409,
  quota_exceeded: 413,
  post_not_pending: 409,
  invalid_url: 400,
  invalid_note: 400,
  not_found: 404,
  locked: 409,
  rate_limited: 429,
  upload_mismatch: 400,
  internal: 500,
};

export type ReferenceResult = { status: number; body: Record<string, unknown> };

export function referenceError(code: ReferenceErrorCode): ReferenceResult {
  return { status: REFERENCE_ERROR_STATUS[code], body: { error: code } };
}

export type ReferencesDb = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  // deno-lint-ignore no-explicit-any
  rpc: (name: string, params: Record<string, unknown>) => any;
};

export type SignGetUrl = (key: string, expiresSeconds?: number, downloadName?: string) => Promise<string>;
export type SignPutUrl = (key: string, mime: string) => Promise<string>;
export type HeadObject = (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;

/** Entrada da allowlist, ou null. hasOwnProperty: "toString" não é um tipo de arquivo. */
export function referenceMimeSpec(mime: unknown) {
  if (typeof mime !== "string") return null;
  return Object.prototype.hasOwnProperty.call(REFERENCE_MIME, mime) ? REFERENCE_MIME[mime] : null;
}

export function parsePositiveId(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,16}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Política autoritativa de URL de referência (o CHECK do banco é só backstop).
 * trim; sem esquema ganha https://; rejeita controle/espaço em qualquer posição;
 * new URL() absoluto; só http/https; sem usuário/senha; host não vazio; ≤ 2048.
 * Só "esquema://" conta como esquema, então "exemplo.com:8080" vira https e
 * "javascript:x"/"mailto:x" viram host inválido ou credencial e caem fora.
 * isSafeHref não basta: aceita caminho relativo e credenciais.
 */
export function normalizeReferenceUrl(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_REFERENCE_URL) return null;
  if (CONTROL_OR_SPACE.test(trimmed)) return null;
  const candidate = SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`;
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username !== "" || u.password !== "") return null;
  if (!u.hostname) return null;
  const href = u.href;
  if (href.length > MAX_REFERENCE_URL || CONTROL_OR_SPACE.test(href)) return null;
  return href;
}

export type OptionalText = { ok: true; value: string | null } | { ok: false };

function normalizeOptionalText(raw: unknown, max: number): OptionalText {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  const v = raw.trim();
  if (!v) return { ok: true, value: null };
  // char_length() conta code points; Array.from também (string.length conta UTF-16).
  if (Array.from(v).length > max) return { ok: false };
  return { ok: true, value: v };
}

export function normalizeReferenceNote(raw: unknown): OptionalText {
  return normalizeOptionalText(raw, MAX_REFERENCE_NOTE);
}

export function normalizeReferenceLinkTitle(raw: unknown): OptionalText {
  return normalizeOptionalText(raw, MAX_REFERENCE_LINK_TITLE);
}

/** Nome exibido e usado no Content-Disposition: sem controle, sem barra, ≤ 200. */
export function sanitizeReferenceName(raw: unknown, ext: string): string {
  const cleaned = typeof raw === "string"
    ? raw.replace(/[\x00-\x1F\x7F]/g, "").replace(/[\\/]/g, "_").trim()
    : "";
  const capped = Array.from(cleaned).slice(0, MAX_REFERENCE_NAME).join("");
  return capped || `referencia.${ext}`;
}

export function linkDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** Linha de post_reference_list (Task 1), LEFT JOIN files. */
export interface ReferenceListRow {
  id: number;
  kind: "file" | "link";
  file_id: number | null;
  url: string | null;
  link_title: string | null;
  note: string | null;
  post_approval_id: number | null;
  created_at: string;
  can_remove: boolean;
  name: string | null;
  mime_type: string | null;
  file_kind: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  r2_key: string | null;
  thumbnail_r2_key: string | null;
  blur_data_url: string | null;
}

/** Linha de post_references devolvida pelos RPCs de insert. */
interface ReferenceInsertedRow {
  id: number;
  post_id: number;
  conta_id: string;
  kind: "file" | "link";
  file_id: number | null;
  url: string | null;
  link_title: string | null;
  note: string | null;
  post_approval_id: number | null;
  created_at: string;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isFileKind(v: unknown): v is ReferenceFileKind {
  return v === "image" || v === "video" || v === "document";
}

export async function toReferenceItem(
  row: ReferenceListRow,
  signGetUrl: SignGetUrl,
  opts: { includeDownload: boolean },
): Promise<ReferenceItem> {
  const base = {
    id: Number(row.id),
    note: row.note ?? null,
    post_approval_id: numOrNull(row.post_approval_id),
    created_at: row.created_at,
    can_remove: row.can_remove === true,
  };
  if (row.kind === "link") {
    return {
      ...base,
      kind: "link",
      file_kind: null,
      name: null,
      mime_type: null,
      size_bytes: null,
      duration_seconds: null,
      width: null,
      height: null,
      url: null,
      thumbnail_url: null,
      blur_data_url: null,
      download_url: null,
      link_url: row.url ?? null,
      link_title: row.link_title ?? null,
      link_domain: row.url ? linkDomain(row.url) : null,
    };
  }
  const key = row.r2_key;
  return {
    ...base,
    kind: "file",
    file_kind: isFileKind(row.file_kind) ? row.file_kind : null,
    name: row.name ?? null,
    mime_type: row.mime_type ?? null,
    size_bytes: numOrNull(row.size_bytes),
    duration_seconds: numOrNull(row.duration_seconds),
    width: numOrNull(row.width),
    height: numOrNull(row.height),
    url: key ? await signGetUrl(key, REFERENCE_SIGNED_URL_TTL) : null,
    thumbnail_url: row.thumbnail_r2_key ? await signGetUrl(row.thumbnail_r2_key, REFERENCE_SIGNED_URL_TTL) : null,
    blur_data_url: row.blur_data_url ?? null,
    download_url: opts.includeDownload && key
      ? await signGetUrl(key, REFERENCE_SIGNED_URL_TTL, row.name ?? "referencia")
      : null,
    link_url: null,
    link_title: null,
    link_domain: null,
  };
}

export type ListOutcome = { ok: true; items: ReferenceItem[] } | { ok: false; result: ReferenceResult };

/** post_reference_list já filtra conta_id e calcula can_remove (decisão 2). O chamador
 * confere a posse do post antes (token: cliente+conta; CRM: conta). */
export async function listPostReferences(a: {
  db: ReferencesDb;
  post_id: number;
  conta_id: string;
  signGetUrl: SignGetUrl;
  includeDownload: boolean;
}): Promise<ListOutcome> {
  const { data, error } = await a.db.rpc("post_reference_list", { p_post_id: a.post_id, p_conta: a.conta_id });
  if (error) {
    console.error("[post-references] list failed:", error);
    return { ok: false, result: referenceError("internal") };
  }
  const rows = Array.isArray(data) ? (data as ReferenceListRow[]) : [];
  const items = await Promise.all(
    rows.map((r) => toReferenceItem(r, a.signGetUrl, { includeDownload: a.includeDownload })),
  );
  return { ok: true, items };
}

/** RAISE conhecidos dos RPCs de insert viram código; o resto loga e vira 500 genérico. */
export function mapReferenceRpcError(error: unknown, scope: string): ReferenceResult {
  const raw = (error as { message?: unknown } | null)?.message;
  const msg = typeof raw === "string" ? raw : "";
  if (msg.includes("post_not_found")) return referenceError("not_found");
  if (msg.includes("post_not_pending")) return referenceError("post_not_pending");
  if (msg.includes("reference_limit")) return referenceError("reference_limit");
  if (msg.includes("quota_exceeded")) return referenceError("quota_exceeded");
  // Recheck de chave já usada por outro files dentro do RPC (ver Contract issues).
  if (msg.includes("upload_mismatch")) return referenceError("upload_mismatch");
  console.error(`[${scope}] rpc failed:`, error);
  return referenceError("internal");
}

function isSafeSize(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

function isThumbSize(v: unknown): v is number {
  return isSafeSize(v) && v <= MAX_REFERENCE_THUMB_BYTES;
}

function optionalDimension(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= MAX_DIMENSION ? Math.round(v) : null;
}

function optionalDuration(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_VIDEO_SECONDS ? Math.round(v) : null;
}

function optionalBlur(v: unknown): string | null {
  return typeof v === "string" && v.startsWith("data:image/") && v.length <= MAX_BLUR_DATA_URL ? v : null;
}

/** Thumbnail webp obrigatória para imagem/vídeo (files_video_requires_thumbnail),
 * proibida para PDF. */
function presignThumbnailOk(kind: ReferenceFileKind, thumb: unknown): boolean {
  if (kind === "document") return thumb === undefined || thumb === null;
  if (!thumb || typeof thumb !== "object") return false;
  const t = thumb as { mime_type?: unknown; size_bytes?: unknown };
  return t.mime_type === "image/webp" && isThumbSize(t.size_bytes);
}

export async function presignReferenceUpload(a: {
  db: ReferencesDb;
  conta_id: string;
  post_id: number;
  mime_type: unknown;
  size_bytes: unknown;
  thumbnail: unknown;
  signPutUrl: SignPutUrl;
  randomUUID?: () => string;
}): Promise<ReferenceResult> {
  const spec = referenceMimeSpec(a.mime_type);
  if (!spec) return referenceError("unsupported_type");
  const mime = a.mime_type as string;
  if (!isSafeSize(a.size_bytes)) return referenceError("upload_mismatch");
  const size = a.size_bytes;
  if (size > spec.maxBytes) return referenceError("too_large");
  if (!presignThumbnailOk(spec.kind, a.thumbnail)) return referenceError("thumbnail_invalid");

  // Best-effort: o RPC de insert recheca teto e cota sob o lock do post.
  const { count, error: countErr } = await a.db.from("post_references")
    .select("id", { count: "exact", head: true })
    .eq("post_id", a.post_id)
    .eq("conta_id", a.conta_id);
  if (!countErr && (count ?? 0) >= MAX_REFERENCES_PER_POST) return referenceError("reference_limit");

  // Cobra só size_bytes, como o RPC (contracts: thumbnail não entra na cota).
  try {
    const quota = await effectivePlanLimit(a.db as never, a.conta_id, "storage_quota_bytes");
    if (quota !== null) {
      const { data: ws } = await a.db.from("workspaces")
        .select("storage_used_bytes").eq("id", a.conta_id).single();
      if (Number(ws?.storage_used_bytes ?? 0) + size > quota) return referenceError("quota_exceeded");
    }
  } catch (e) {
    console.error("[post-references] quota precheck skipped:", e);
  }

  const uuid = (a.randomUUID ?? crypto.randomUUID.bind(crypto))();
  const stem = `contas/${a.conta_id}/files/${uuid}`;
  const r2_key = `${stem}.${spec.ext}`;
  const thumbnail_r2_key = spec.kind === "document" ? null : `${stem}.thumb.webp`;
  const upload_url = await a.signPutUrl(r2_key, mime);
  const thumbnail_upload_url = thumbnail_r2_key ? await a.signPutUrl(thumbnail_r2_key, "image/webp") : null;
  return { status: 200, body: { upload_url, r2_key, thumbnail_upload_url, thumbnail_r2_key } };
}

/** Uma chave que já é de outro files (mídia de post, ideia, Arquivos) nunca vira
 * referência: apagar a referência apagaria o objeto do R2 (file_enqueue_delete) e a
 * mídia do post sumiria. O Hub vê as chaves nas URLs assinadas de hub-posts.
 * null = falha de leitura (o chamador responde 500). */
async function keysAlreadyStored(db: ReferencesDb, keys: string[]): Promise<boolean | null> {
  for (const column of ["r2_key", "thumbnail_r2_key"]) {
    const { data, error } = await db.from("files").select("id").in(column, keys).limit(1);
    if (error) {
      console.error("[post-references] key lookup failed:", error);
      return null;
    }
    if (Array.isArray(data) && data.length > 0) return true;
  }
  return false;
}

export async function finalizeReferenceFile(a: {
  db: ReferencesDb;
  conta_id: string;
  cliente_id: number;
  post_id: number;
  input: Record<string, unknown>;
  headObject: HeadObject;
  signGetUrl: SignGetUrl;
}): Promise<ReferenceResult> {
  const b = a.input;
  const spec = referenceMimeSpec(b.mime_type);
  if (!spec) return referenceError("unsupported_type");
  const mime = b.mime_type as string;
  const sizeRaw = b.size_bytes;
  if (!isSafeSize(sizeRaw)) return referenceError("upload_mismatch");
  const size = sizeRaw;
  if (size > spec.maxBytes) return referenceError("too_large");

  // As chaves têm de ser o par que /upload-url cunhou:
  // contas/{conta}/files/{uuid}.{ext} e, para imagem/vídeo, {uuid}.thumb.webp.
  const prefix = `contas/${a.conta_id}/files/`;
  const r2Key = typeof b.r2_key === "string" ? b.r2_key : "";
  const match = r2Key.startsWith(prefix)
    ? new RegExp(`^(${UUID_RE})\\.${spec.ext}$`).exec(r2Key.slice(prefix.length))
    : null;
  if (!match) return referenceError("upload_mismatch");

  const rawThumbKey = typeof b.thumbnail_r2_key === "string" ? b.thumbnail_r2_key : "";
  const rawThumbBytes = b.thumbnail_bytes;
  let thumbKey: string | null = null;
  let thumbBytes: number | null = null;
  if (spec.kind === "document") {
    if (rawThumbKey !== "" || (rawThumbBytes !== undefined && rawThumbBytes !== null)) {
      return referenceError("thumbnail_invalid");
    }
  } else {
    if (rawThumbKey === "" || !isThumbSize(rawThumbBytes)) return referenceError("thumbnail_invalid");
    if (rawThumbKey !== `${prefix}${match[1]}.thumb.webp`) return referenceError("upload_mismatch");
    thumbKey = rawThumbKey;
    thumbBytes = rawThumbBytes;
  }

  const note = normalizeReferenceNote(b.note);
  if (!note.ok) return referenceError("invalid_note");

  const stored = await keysAlreadyStored(a.db, thumbKey ? [r2Key, thumbKey] : [r2Key]);
  if (stored === null) return referenceError("internal");
  if (stored) return referenceError("upload_mismatch");

  const head = await a.headObject(r2Key);
  if (!head || head.contentLength !== size || (head.contentType && head.contentType !== mime)) {
    return referenceError("upload_mismatch");
  }
  if (thumbKey) {
    const th = await a.headObject(thumbKey);
    if (!th || th.contentLength !== thumbBytes || (th.contentType && th.contentType !== "image/webp")) {
      return referenceError("upload_mismatch");
    }
  }

  const name = sanitizeReferenceName(b.name, spec.ext);
  const width = spec.kind === "document" ? null : optionalDimension(b.width);
  const height = spec.kind === "document" ? null : optionalDimension(b.height);
  const duration = spec.kind === "video" ? optionalDuration(b.duration_seconds) : null;
  const blur = spec.kind === "document" ? null : optionalBlur(b.blur_data_url);

  const { data: inserted, error } = await a.db.rpc("post_reference_file_insert", {
    p: {
      post_id: a.post_id,
      conta_id: a.conta_id,
      cliente_id: a.cliente_id,
      r2_key: r2Key,
      thumbnail_r2_key: thumbKey ?? "",
      name,
      mime_type: mime,
      file_kind: spec.kind,
      size_bytes: size,
      width,
      height,
      duration_seconds: duration,
      blur_data_url: blur,
      note: note.value,
    },
  }).single();
  if (error) return mapReferenceRpcError(error, "post-references:file-insert");
  const ref = inserted as ReferenceInsertedRow | null;
  if (!ref) {
    console.error("[post-references:file-insert] rpc returned no row");
    return referenceError("internal");
  }

  // Recém-criada: nenhuma ação da equipe pode ser posterior a ela, então can_remove = true.
  const item = await toReferenceItem({
    id: ref.id, kind: "file", file_id: ref.file_id, url: null, link_title: null,
    note: ref.note ?? null, post_approval_id: null, created_at: ref.created_at, can_remove: true,
    name, mime_type: mime, file_kind: spec.kind, size_bytes: size, width, height,
    duration_seconds: duration, r2_key: r2Key, thumbnail_r2_key: thumbKey, blur_data_url: blur,
  }, a.signGetUrl, { includeDownload: false });
  return { status: 201, body: { item } };
}

export async function insertReferenceLink(a: {
  db: ReferencesDb;
  conta_id: string;
  cliente_id: number;
  post_id: number;
  input: Record<string, unknown>;
  signGetUrl: SignGetUrl;
}): Promise<ReferenceResult> {
  const b = a.input;
  const url = normalizeReferenceUrl(typeof b.url === "string" ? b.url : "");
  if (!url) return referenceError("invalid_url");
  const title = normalizeReferenceLinkTitle(b.title);
  if (!title.ok) return referenceError("invalid_note");
  const note = normalizeReferenceNote(b.note);
  if (!note.ok) return referenceError("invalid_note");

  const { data: inserted, error } = await a.db.rpc("post_reference_link_insert", {
    p: {
      post_id: a.post_id,
      conta_id: a.conta_id,
      cliente_id: a.cliente_id,
      url,
      link_title: title.value,
      note: note.value,
    },
  }).single();
  if (error) return mapReferenceRpcError(error, "post-references:link-insert");
  const ref = inserted as ReferenceInsertedRow | null;
  if (!ref) {
    console.error("[post-references:link-insert] rpc returned no row");
    return referenceError("internal");
  }

  const item = await toReferenceItem({
    id: ref.id, kind: "link", file_id: null, url: ref.url ?? url, link_title: ref.link_title ?? title.value,
    note: ref.note ?? null, post_approval_id: null, created_at: ref.created_at, can_remove: true,
    name: null, mime_type: null, file_kind: null, size_bytes: null, width: null, height: null,
    duration_seconds: null, r2_key: null, thumbnail_r2_key: null, blur_data_url: null,
  }, a.signGetUrl, { includeDownload: false });
  return { status: 201, body: { item } };
}
```

- [ ] **Step 9: Run the shared test, confirm it passes**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/post-references-shared_test.ts
```
Expected: `ok | 10 passed | 0 failed`.

- [ ] **Step 10: Type gate**

```bash
npm run check:functions
```
Expected: exits 0 (it checks `_shared/*.ts`, so the new module and the r2/safe-href edits are covered).

- [ ] **Step 11: Commit**

```bash
git checkout -- deno.lock
git add supabase/functions/_shared/post-references.ts supabase/functions/_shared/r2.ts \
  supabase/functions/_shared/safe-href.ts supabase/functions/__tests__/r2-sign_test.ts \
  supabase/functions/__tests__/post-references-shared_test.ts
git commit -m "$(cat <<'EOF'
feat(references): shared post-references module and signed download names

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `hub-post-references` edge function (Hub token)

**Files:**
- Create: `supabase/functions/hub-post-references/handler.ts`
- Create: `supabase/functions/hub-post-references/index.ts`
- Create: `supabase/functions/__tests__/hub-post-references_test.ts`
- Modify: `supabase/config.toml` (add `[functions.hub-post-references] verify_jwt = false`)
- Modify: `supabase/functions/__tests__/config-audit_test.ts` (`REQUIRED_FUNCTIONS`)
- Modify: `CLAUDE.md` (`--no-verify-jwt` gotcha list)

**Interfaces:**
- Consumes: Task 2 helpers (`presignReferenceUpload`, `finalizeReferenceFile`,
  `insertReferenceLink`, `listPostReferences`, `normalizeReferenceNote`, `parsePositiveId`,
  `referenceError`, `MAX_REFERENCES_PER_POST`, `SignGetUrl`, `SignPutUrl`, `HeadObject`);
  `resolveHubToken` (`_shared/hub-token.ts`, enforces `feature_hub_portal`);
  `getClientIP`/`checkRateLimit` (`_shared/rate-limit.ts`); `headObjectSigned`, `signPutUrl`,
  `signGetUrl` (`_shared/r2.ts`); SQL RPCs `post_reference_client_update`,
  `post_reference_client_delete` (`'ok' | 'not_found' | 'locked'`),
  `create_post_reference_notification(p_post_id)`.
- Produces: `createHubPostReferencesHandler(deps)` and the routes from the contract:
  `GET ?token&post_id` → `{ can_add, items }`; `POST /upload-url` →
  `{ upload_url, r2_key, thumbnail_upload_url, thumbnail_r2_key }`; `POST /files` and
  `POST /links` → `201 { item }`; `PATCH /:id` → `{ item }`; `DELETE /:id` → `{ ok: true }`.
  Errors `{ error: ReferenceErrorCode }`, except the shared token layer: missing token
  `400 { error: "token required" }`, unknown token `404 { error: "Link inválido." }`
  (see Contract issues).

- [ ] **Step 1: Write the failing handler test**

Create `supabase/functions/__tests__/hub-post-references_test.ts`:

```ts
import { assert, assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createHubPostReferencesHandler } from "../hub-post-references/handler.ts";

type Db = ReturnType<typeof createSupabaseQueryMock>;
type Head = { contentLength: number; contentType: string | null } | null;

const UUID = "0b5f6c1e-3d2a-4f7b-9c1d-2e3f4a5b6c7d";
const KEY = `contas/conta-1/files/${UUID}.png`;
const THUMB = `contas/conta-1/files/${UUID}.thumb.webp`;
const WRITE_KEY = "hub-write:hub-post-references:conta-1:14";
const READ_KEY = "hub-read:conta-1:14";

interface Opts {
  rateKeys?: string[];
  limited?: boolean;
  head?: (key: string) => Promise<Head>;
}

function makeHandler(db: Db, opts: Opts = {}) {
  return createHubPostReferencesHandler({
    buildCorsHeaders: () => ({ "Access-Control-Allow-Origin": "https://hub.mesaas.com" }),
    createDb: () => db as never,
    now: () => "2026-10-08T12:00:00.000Z",
    signPutUrl: async (key: string) => `https://put.example.com/${key}`,
    signGetUrl: async (key: string, _exp?: number, name?: string) =>
      `https://get.example.com/${key}${name ? `?dl=${name}` : ""}`,
    headObject: opts.head ??
      (async (key: string) => ({ contentLength: key.endsWith(".thumb.webp") ? 2000 : 5000, contentType: null })),
    rateLimit: async (_db: unknown, key: string) => {
      opts.rateKeys?.push(key);
      return !opts.limited;
    },
    randomUUID: () => UUID,
  });
}

function setupToken(db: Db) {
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
}

function queuePost(db: Db, fields: Record<string, unknown> = {}) {
  db.queue("workflow_posts", "select", {
    data: { id: 99, status: "enviado_cliente", cliente_id: 14, conta_id: "conta-1", ...fields },
    error: null,
  });
}

function fileRow(fields: Record<string, unknown> = {}) {
  return {
    id: 7, kind: "file", file_id: 70, url: null, link_title: null, note: "Use esta foto",
    post_approval_id: null, created_at: "2026-10-08T11:00:00.000Z", can_remove: true,
    name: "foto.png", mime_type: "image/png", file_kind: "image", size_bytes: 5000,
    width: 1080, height: 1350, duration_seconds: null, r2_key: KEY, thumbnail_r2_key: THUMB,
    blur_data_url: null, ...fields,
  };
}

function linkRow(fields: Record<string, unknown> = {}) {
  return {
    id: 8, kind: "link", file_id: null, url: "https://www.exemplo.com/post", link_title: "Inspiração",
    note: null, post_approval_id: null, created_at: "2026-10-08T11:05:00.000Z", can_remove: false,
    name: null, mime_type: null, file_kind: null, size_bytes: null, width: null, height: null,
    duration_seconds: null, r2_key: null, thumbnail_r2_key: null, blur_data_url: null, ...fields,
  };
}

function insertedRow(fields: Record<string, unknown> = {}) {
  return {
    id: 7, post_id: 99, conta_id: "conta-1", kind: "file", file_id: 70, url: null, link_title: null,
    note: null, post_approval_id: null, created_at: "2026-10-08T12:00:00.000Z",
    updated_at: "2026-10-08T12:00:00.000Z", ...fields,
  };
}

function jsonReq(method: string, path: string, body: Record<string, unknown> = {}) {
  return new Request(`https://x.test/hub-post-references${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t", ...body }),
  });
}

function getReq(path: string, method = "GET") {
  return new Request(`https://x.test/hub-post-references${path}`, { method });
}

function rpcCall(db: Db, name: string) {
  return db.calls.find((c) => c.table === `rpc:${name}`);
}

const IMAGE_UPLOAD = {
  post_id: 99, filename: "foto.png", mime_type: "image/png", size_bytes: 5000,
  thumbnail: { mime_type: "image/webp", size_bytes: 2000 },
};

const IMAGE_FINALIZE = {
  post_id: 99, r2_key: KEY, thumbnail_r2_key: THUMB, mime_type: "image/png", size_bytes: 5000,
  thumbnail_bytes: 2000, name: "foto.png", width: 1080, height: 1350, note: "  Use esta foto  ",
};

// ── Token / routing ─────────────────────────────────────────────

Deno.test("hub-post-references: unknown token is 404 and debits only the bad-token limiter", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });
  const rateKeys: string[] = [];
  const res = await makeHandler(db, { rateKeys })(getReq("?token=nope&post_id=99"));
  assertEquals(res.status, 404);
  assertEquals((await readJson(res)).error, "Link inválido.");
  assertEquals(rateKeys.length, 1);
  assert(rateKeys[0].startsWith("hub-badtoken:"));
});

Deno.test("hub-post-references: unknown route is 404 not_found before any DB call", async () => {
  const db = createSupabaseQueryMock();
  const res = await makeHandler(db)(jsonReq("POST", "/whatever"));
  assertEquals(res.status, 404);
  assertEquals((await readJson(res)).error, "not_found");
  assertEquals(db.calls.length, 0);
});

// ── GET ─────────────────────────────────────────────────────────

Deno.test("hub-post-references: GET lists signed items and debits only hub-read", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queueRpc("post_reference_list", { data: [fileRow(), linkRow()], error: null });
  const rateKeys: string[] = [];
  const res = await makeHandler(db, { rateKeys })(getReq("?token=t&post_id=99"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(rateKeys, [READ_KEY]);
  assertEquals(body.can_add, true);
  assertEquals(body.items.length, 2);
  assertEquals(body.items[0].url, `https://get.example.com/${KEY}`);
  assertEquals(body.items[0].thumbnail_url, `https://get.example.com/${THUMB}`);
  assertEquals(body.items[0].download_url, null);
  assertEquals(body.items[1].link_url, "https://www.exemplo.com/post");
  assertEquals(body.items[1].link_domain, "exemplo.com");
  assertEquals(body.items[1].can_remove, false);
  assertEquals(rpcCall(db, "post_reference_list")?.payload, { p_post_id: 99, p_conta: "conta-1" });
});

Deno.test("hub-post-references: GET on another client's post is 404 and never lists", async () => {
  for (const fields of [{ cliente_id: 15 }, { conta_id: "conta-2" }]) {
    const db = createSupabaseQueryMock();
    setupToken(db);
    queuePost(db, fields);
    const res = await makeHandler(db)(getReq("?token=t&post_id=99"));
    assertEquals(res.status, 404);
    assertEquals((await readJson(res)).error, "not_found");
    assertEquals(rpcCall(db, "post_reference_list"), undefined);
  }
});

Deno.test("hub-post-references: GET is ownership-only (internal 'em produção' and postado read-only)", async () => {
  for (const status of ["rascunho", "em_producao", "postado", "correcao_cliente"]) {
    const db = createSupabaseQueryMock();
    setupToken(db);
    queuePost(db, { status });
    db.queueRpc("post_reference_list", { data: [fileRow({ can_remove: false })], error: null });
    const res = await makeHandler(db)(getReq("?token=t&post_id=99"));
    assertEquals(res.status, 200, status);
    const body = await readJson(res);
    assertEquals(body.can_add, false, status);
    assertEquals(body.items.length, 1, status);
  }
});

Deno.test("hub-post-references: GET can_add is false at 10 references", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queueRpc("post_reference_list", {
    data: Array.from({ length: 10 }, (_, i) => linkRow({ id: i + 1 })),
    error: null,
  });
  const res = await makeHandler(db)(getReq("?token=t&post_id=99"));
  assertEquals((await readJson(res)).can_add, false);
});

Deno.test("hub-post-references: GET without a valid post_id is 404", async () => {
  for (const q of ["?token=t", "?token=t&post_id=abc", "?token=t&post_id=0"]) {
    const db = createSupabaseQueryMock();
    setupToken(db);
    const res = await makeHandler(db)(getReq(q));
    assertEquals(res.status, 404, q);
  }
});

// ── POST /upload-url ────────────────────────────────────────────

Deno.test("hub-post-references: presign image returns both PUT URLs and debits only the write key", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queue("post_references", "select", { data: null, error: null, count: 3 });
  db.queueRpc("effective_plan_limit", { data: null, error: null });
  const rateKeys: string[] = [];
  const res = await makeHandler(db, { rateKeys })(jsonReq("POST", "/upload-url", IMAGE_UPLOAD));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(rateKeys, [WRITE_KEY]);
  assertEquals(body.r2_key, KEY);
  assertEquals(body.thumbnail_r2_key, THUMB);
  assertEquals(body.upload_url, `https://put.example.com/${KEY}`);
  assertEquals(body.thumbnail_upload_url, `https://put.example.com/${THUMB}`);
});

Deno.test("hub-post-references: presign PDF has no thumbnail; a PDF thumbnail is rejected", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queueRpc("effective_plan_limit", { data: null, error: null });
  const res = await makeHandler(db)(jsonReq("POST", "/upload-url", {
    post_id: 99, filename: "numeros.pdf", mime_type: "application/pdf", size_bytes: 5000,
  }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.r2_key, `contas/conta-1/files/${UUID}.pdf`);
  assertEquals(body.thumbnail_r2_key, null);
  assertEquals(body.thumbnail_upload_url, null);

  const db2 = createSupabaseQueryMock();
  setupToken(db2);
  queuePost(db2);
  const res2 = await makeHandler(db2)(jsonReq("POST", "/upload-url", {
    post_id: 99, mime_type: "application/pdf", size_bytes: 5000,
    thumbnail: { mime_type: "image/webp", size_bytes: 100 },
  }));
  assertEquals(res2.status, 400);
  assertEquals((await readJson(res2)).error, "thumbnail_invalid");
});

Deno.test("hub-post-references: presign rejects type, size and thumbnail violations", async () => {
  const webp = { mime_type: "image/webp", size_bytes: 2000 };
  const cases: Array<[Record<string, unknown>, number, string]> = [
    [{ mime_type: "image/svg+xml", size_bytes: 10, thumbnail: webp }, 415, "unsupported_type"],
    [{ mime_type: "video/mp4", size_bytes: 200 * 1024 * 1024 + 1, thumbnail: webp }, 413, "too_large"],
    [{ mime_type: "image/png", size_bytes: 25 * 1024 * 1024 + 1, thumbnail: webp }, 413, "too_large"],
    [{ mime_type: "application/pdf", size_bytes: 25 * 1024 * 1024 + 1 }, 413, "too_large"],
    [{ mime_type: "image/png", size_bytes: 0, thumbnail: webp }, 400, "upload_mismatch"],
    [{ mime_type: "image/png", size_bytes: 5000 }, 400, "thumbnail_invalid"],
    [{ mime_type: "video/webm", size_bytes: 5000 }, 400, "thumbnail_invalid"],
    [{ mime_type: "image/png", size_bytes: 5000, thumbnail: { mime_type: "image/png", size_bytes: 10 } }, 400, "thumbnail_invalid"],
    [{ mime_type: "image/png", size_bytes: 5000, thumbnail: { mime_type: "image/webp", size_bytes: 512 * 1024 + 1 } }, 400, "thumbnail_invalid"],
  ];
  for (const [fields, status, code] of cases) {
    const db = createSupabaseQueryMock();
    setupToken(db);
    queuePost(db);
    const res = await makeHandler(db)(jsonReq("POST", "/upload-url", { post_id: 99, ...fields }));
    assertEquals(res.status, status, JSON.stringify(fields));
    assertEquals((await readJson(res)).error, code, JSON.stringify(fields));
  }
});

Deno.test("hub-post-references: presign outside enviado_cliente is 409 post_not_pending", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db, { status: "correcao_cliente" });
  const res = await makeHandler(db)(jsonReq("POST", "/upload-url", IMAGE_UPLOAD));
  assertEquals(res.status, 409);
  assertEquals((await readJson(res)).error, "post_not_pending");
});

Deno.test("hub-post-references: presign at 10 references is 409 reference_limit", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queue("post_references", "select", { data: null, error: null, count: 10 });
  const res = await makeHandler(db)(jsonReq("POST", "/upload-url", IMAGE_UPLOAD));
  assertEquals(res.status, 409);
  assertEquals((await readJson(res)).error, "reference_limit");
});

Deno.test("hub-post-references: presign over quota is 413 quota_exceeded", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queue("post_references", "select", { data: null, error: null, count: 0 });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 999 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000, error: null });
  const res = await makeHandler(db)(jsonReq("POST", "/upload-url", IMAGE_UPLOAD));
  assertEquals(res.status, 413);
  assertEquals((await readJson(res)).error, "quota_exceeded");
});

// ── POST /files ─────────────────────────────────────────────────

Deno.test("hub-post-references: finalize image inserts via RPC, notifies, returns the item", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queueRpc("post_reference_file_insert", { data: insertedRow({ note: "Use esta foto" }), error: null });
  const rateKeys: string[] = [];
  const res = await makeHandler(db, { rateKeys })(jsonReq("POST", "/files", IMAGE_FINALIZE));
  assertEquals(res.status, 201);
  const { item } = await readJson(res);
  assertEquals(item.id, 7);
  assertEquals(item.kind, "file");
  assertEquals(item.file_kind, "image");
  assertEquals(item.note, "Use esta foto");
  assertEquals(item.can_remove, true);
  assertEquals(item.url, `https://get.example.com/${KEY}`);
  assertEquals(item.download_url, null);
  assertEquals(rateKeys, [WRITE_KEY]);

  const p = (rpcCall(db, "post_reference_file_insert")?.payload as { p: Record<string, unknown> }).p;
  assertEquals(p.post_id, 99);
  assertEquals(p.conta_id, "conta-1");
  assertEquals(p.cliente_id, 14);
  assertEquals(p.r2_key, KEY);
  assertEquals(p.thumbnail_r2_key, THUMB);
  assertEquals(p.file_kind, "image");
  assertEquals(p.mime_type, "image/png");
  assertEquals(p.size_bytes, 5000);
  assertEquals(p.width, 1080);
  assertEquals(p.duration_seconds, null);
  assertEquals(p.note, "Use esta foto");
  assertEquals(rpcCall(db, "create_post_reference_notification")?.payload, { p_post_id: 99 });
});

Deno.test("hub-post-references: finalize PDF sends thumbnail_r2_key '' and no dimensions", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queueRpc("post_reference_file_insert", { data: insertedRow(), error: null });
  const pdfKey = `contas/conta-1/files/${UUID}.pdf`;
  const res = await makeHandler(db)(jsonReq("POST", "/files", {
    post_id: 99, r2_key: pdfKey, mime_type: "application/pdf", size_bytes: 5000,
    name: "numeros.pdf", width: 10, height: 10,
  }));
  assertEquals(res.status, 201);
  const p = (rpcCall(db, "post_reference_file_insert")?.payload as { p: Record<string, unknown> }).p;
  assertEquals(p.thumbnail_r2_key, "");
  assertEquals(p.file_kind, "document");
  assertEquals(p.width, null);
  assertEquals((await readJson(res)).item.thumbnail_url, null);
});

Deno.test("hub-post-references: finalize video rounds duration and keeps the thumbnail", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queueRpc("post_reference_file_insert", { data: insertedRow(), error: null });
  const res = await makeHandler(db)(jsonReq("POST", "/files", {
    ...IMAGE_FINALIZE, r2_key: `contas/conta-1/files/${UUID}.mp4`, mime_type: "video/mp4",
    duration_seconds: 12.6,
  }));
  assertEquals(res.status, 201);
  const p = (rpcCall(db, "post_reference_file_insert")?.payload as { p: Record<string, unknown> }).p;
  assertEquals(p.file_kind, "video");
  assertEquals(p.duration_seconds, 13);
  assertEquals(p.thumbnail_r2_key, THUMB);
});

Deno.test("hub-post-references: finalize rejects HEAD mismatches before the RPC", async () => {
  const heads: Array<(key: string) => Promise<Head>> = [
    async () => null,
    async (k) => ({ contentLength: k.endsWith(".thumb.webp") ? 2000 : 4999, contentType: null }),
    async (k) => ({ contentLength: k.endsWith(".thumb.webp") ? 2000 : 5000, contentType: k.endsWith(".thumb.webp") ? null : "image/jpeg" }),
    async (k) => (k.endsWith(".thumb.webp") ? null : { contentLength: 5000, contentType: null }),
    async (k) => ({ contentLength: k.endsWith(".thumb.webp") ? 1999 : 5000, contentType: null }),
  ];
  for (const head of heads) {
    const db = createSupabaseQueryMock();
    setupToken(db);
    queuePost(db);
    const res = await makeHandler(db, { head })(jsonReq("POST", "/files", IMAGE_FINALIZE));
    assertEquals(res.status, 400);
    assertEquals((await readJson(res)).error, "upload_mismatch");
    assertEquals(rpcCall(db, "post_reference_file_insert"), undefined);
  }
});

Deno.test("hub-post-references: finalize rejects keys that /upload-url did not mint", async () => {
  const other = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
  const cases: Array<Record<string, unknown>> = [
    { r2_key: `contas/conta-2/files/${UUID}.png`, thumbnail_r2_key: `contas/conta-2/files/${UUID}.thumb.webp` },
    { r2_key: `contas/conta-1/files/${UUID}.jpg` },
    { r2_key: `contas/conta-1/files/../files/${UUID}.png` },
    { thumbnail_r2_key: `contas/conta-1/files/${other}.thumb.webp` },
  ];
  for (const fields of cases) {
    const db = createSupabaseQueryMock();
    setupToken(db);
    queuePost(db);
    const res = await makeHandler(db)(jsonReq("POST", "/files", { ...IMAGE_FINALIZE, ...fields }));
    assertEquals(res.status, 400, JSON.stringify(fields));
    assertEquals((await readJson(res)).error, "upload_mismatch", JSON.stringify(fields));
  }
});

Deno.test("hub-post-references: finalize refuses a key another files row already owns", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queue("files", "select", { data: [{ id: 555 }], error: null });
  const res = await makeHandler(db)(jsonReq("POST", "/files", IMAGE_FINALIZE));
  assertEquals(res.status, 400);
  assertEquals((await readJson(res)).error, "upload_mismatch");
  assertEquals(rpcCall(db, "post_reference_file_insert"), undefined);
});

Deno.test("hub-post-references: finalize thumbnail rules (missing for image, present for PDF)", async () => {
  const pdfKey = `contas/conta-1/files/${UUID}.pdf`;
  const cases: Array<Record<string, unknown>> = [
    { thumbnail_r2_key: undefined, thumbnail_bytes: undefined },
    { thumbnail_bytes: 512 * 1024 + 1 },
    { r2_key: pdfKey, mime_type: "application/pdf" },
  ];
  for (const fields of cases) {
    const db = createSupabaseQueryMock();
    setupToken(db);
    queuePost(db);
    const res = await makeHandler(db)(jsonReq("POST", "/files", { ...IMAGE_FINALIZE, ...fields }));
    assertEquals(res.status, 400, JSON.stringify(fields));
    assertEquals((await readJson(res)).error, "thumbnail_invalid", JSON.stringify(fields));
  }
});

Deno.test("hub-post-references: finalize maps RPC codes and hides raw DB errors", async () => {
  const cases: Array<[string, number, string]> = [
    ["post_not_pending", 409, "post_not_pending"],
    ["reference_limit", 409, "reference_limit"],
    ["quota_exceeded", 413, "quota_exceeded"],
    ["post_not_found", 404, "not_found"],
    ['duplicate key value violates unique constraint "post_references_file_uq"', 500, "internal"],
  ];
  for (const [message, status, code] of cases) {
    const db = createSupabaseQueryMock();
    setupToken(db);
    queuePost(db);
    db.queueRpc("post_reference_file_insert", { data: null, error: { message } });
    const res = await makeHandler(db)(jsonReq("POST", "/files", IMAGE_FINALIZE));
    assertEquals(res.status, status, message);
    assertEquals(await readJson(res), { error: code });
    assertEquals(rpcCall(db, "create_post_reference_notification"), undefined);
  }
});

Deno.test("hub-post-references: a failed notification does not fail the upload", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queueRpc("post_reference_file_insert", { data: insertedRow(), error: null });
  db.queueRpc("create_post_reference_notification", { data: null, error: { message: "boom" } });
  const res = await makeHandler(db)(jsonReq("POST", "/files", IMAGE_FINALIZE));
  assertEquals(res.status, 201);
});

// ── POST /links ─────────────────────────────────────────────────

Deno.test("hub-post-references: link is normalised, inserted, notified", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queueRpc("post_reference_link_insert", {
    data: insertedRow({ id: 8, kind: "link", file_id: null, url: "https://exemplo.com/post", link_title: "Referência" }),
    error: null,
  });
  const res = await makeHandler(db)(jsonReq("POST", "/links", {
    post_id: 99, url: "  exemplo.com/post ", title: " Referência ", note: "",
  }));
  assertEquals(res.status, 201);
  const { item } = await readJson(res);
  assertEquals(item.kind, "link");
  assertEquals(item.link_url, "https://exemplo.com/post");
  assertEquals(item.link_domain, "exemplo.com");
  assertEquals(item.download_url, null);
  assertEquals(rpcCall(db, "post_reference_link_insert")?.payload, {
    p: { post_id: 99, conta_id: "conta-1", cliente_id: 14, url: "https://exemplo.com/post", link_title: "Referência", note: null },
  });
  assertEquals(rpcCall(db, "create_post_reference_notification")?.payload, { p_post_id: 99 });
});

Deno.test("hub-post-references: link rejects unsafe URLs and long titles without calling the RPC", async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ url: "javascript:alert(1)" }, "invalid_url"],
    [{ url: "https://user:pw@exemplo.com" }, "invalid_url"],
    [{ url: "ftp://exemplo.com" }, "invalid_url"],
    [{ url: "https://exem plo.com" }, "invalid_url"],
    [{ url: "" }, "invalid_url"],
    [{ url: 12 }, "invalid_url"],
    [{ url: "exemplo.com", title: "a".repeat(121) }, "invalid_note"],
    [{ url: "exemplo.com", note: "a".repeat(501) }, "invalid_note"],
  ];
  for (const [fields, code] of cases) {
    const db = createSupabaseQueryMock();
    setupToken(db);
    queuePost(db);
    const res = await makeHandler(db)(jsonReq("POST", "/links", { post_id: 99, ...fields }));
    assertEquals(res.status, 400, JSON.stringify(fields));
    assertEquals((await readJson(res)).error, code, JSON.stringify(fields));
    assertEquals(rpcCall(db, "post_reference_link_insert"), undefined);
  }
});

Deno.test("hub-post-references: link on a post outside enviado_cliente is 409", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db, { status: "aprovado_cliente" });
  const res = await makeHandler(db)(jsonReq("POST", "/links", { post_id: 99, url: "exemplo.com" }));
  assertEquals(res.status, 409);
  assertEquals((await readJson(res)).error, "post_not_pending");
});

// ── PATCH /:id ──────────────────────────────────────────────────

Deno.test("hub-post-references: PATCH saves the note through the RPC and returns the item", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queueRpc("post_reference_client_update", { data: "ok", error: null });
  db.queue("post_references", "select", { data: { post_id: 99 }, error: null });
  db.queueRpc("post_reference_list", { data: [linkRow({ note: "nova nota", can_remove: true }), fileRow()], error: null });
  const rateKeys: string[] = [];
  const res = await makeHandler(db, { rateKeys })(jsonReq("PATCH", "/8", { note: "  nova nota " }));
  assertEquals(res.status, 200);
  assertEquals((await readJson(res)).item.note, "nova nota");
  assertEquals(rateKeys, [WRITE_KEY]);
  assertEquals(rpcCall(db, "post_reference_client_update")?.payload, {
    p_id: 8, p_conta: "conta-1", p_cliente: 14, p_note: "nova nota",
  });
});

Deno.test("hub-post-references: PATCH maps locked to 409 and not_found to 404", async () => {
  for (const [outcome, status] of [["locked", 409], ["not_found", 404]] as const) {
    const db = createSupabaseQueryMock();
    setupToken(db);
    db.queueRpc("post_reference_client_update", { data: outcome, error: null });
    const res = await makeHandler(db)(jsonReq("PATCH", "/8", { note: "x" }));
    assertEquals(res.status, status);
    assertEquals((await readJson(res)).error, outcome);
  }
});

Deno.test("hub-post-references: PATCH rejects a note over 500 chars before the RPC", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  const res = await makeHandler(db)(jsonReq("PATCH", "/8", { note: "a".repeat(501) }));
  assertEquals(res.status, 400);
  assertEquals((await readJson(res)).error, "invalid_note");
  assertEquals(rpcCall(db, "post_reference_client_update"), undefined);
});

// ── DELETE /:id ─────────────────────────────────────────────────

Deno.test("hub-post-references: DELETE removes through the RPC scoped to the token", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queueRpc("post_reference_client_delete", { data: "ok", error: null });
  const rateKeys: string[] = [];
  const res = await makeHandler(db, { rateKeys })(getReq("/7?token=t", "DELETE"));
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), { ok: true });
  assertEquals(rateKeys, [WRITE_KEY]);
  assertEquals(rpcCall(db, "post_reference_client_delete")?.payload, { p_id: 7, p_conta: "conta-1", p_cliente: 14 });
});

Deno.test("hub-post-references: DELETE maps locked to 409, not_found to 404, RPC error to 500", async () => {
  const cases: Array<[Record<string, unknown>, number, string]> = [
    [{ data: "locked", error: null }, 409, "locked"],
    [{ data: "not_found", error: null }, 404, "not_found"],
    [{ data: null, error: { message: "deadlock detected" } }, 500, "internal"],
  ];
  for (const [rpc, status, code] of cases) {
    const db = createSupabaseQueryMock();
    setupToken(db);
    db.queueRpc("post_reference_client_delete", rpc);
    const res = await makeHandler(db)(getReq("/7?token=t", "DELETE"));
    assertEquals(res.status, status);
    assertEquals(await readJson(res), { error: code });
  }
});

Deno.test("hub-post-references: an exhausted write budget is 429 rate_limited with no work", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  const res = await makeHandler(db, { limited: true })(getReq("/7?token=t", "DELETE"));
  assertEquals(res.status, 429);
  assertEquals((await readJson(res)).error, "rate_limited");
  assertEquals(rpcCall(db, "post_reference_client_delete"), undefined);
});
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/hub-post-references_test.ts
```
Expected: FAIL with `Module not found ".../hub-post-references/handler.ts"`.

- [ ] **Step 3: Implement the handler**

Create `supabase/functions/hub-post-references/handler.ts`:

```ts
// Referências do cliente no post, lado Hub (token). Spec:
// docs/superpowers/specs/2026-10-08-client-post-references-design.md
import { createJsonResponder } from "../_shared/http.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";
import { getClientIP } from "../_shared/rate-limit.ts";
import {
  finalizeReferenceFile,
  type HeadObject,
  insertReferenceLink,
  listPostReferences,
  MAX_REFERENCES_PER_POST,
  normalizeReferenceNote,
  parsePositiveId,
  presignReferenceUpload,
  referenceError,
  type ReferenceResult,
  type ReferencesDb,
  type SignGetUrl,
  type SignPutUrl,
} from "../_shared/post-references.ts";

type DbClient = ReferencesDb;

export interface HubPostReferencesHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  signPutUrl: SignPutUrl;
  signGetUrl: SignGetUrl;
  headObject: HeadObject;
  rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
  randomUUID?: () => string;
}

// Escritas debitam SÓ este pool, nunca o hub-read compartilhado (mesmo racional de
// hub-edit-suggestion/handler.ts:77-85). Um arquivo custa 2 (presign + finalize) e
// "Salvar nota" é botão explícito (1), então 10 arquivos com nota num post gastam 30.
const WRITE_MAX = 120;
const WRITE_WINDOW = 3600;
const READ_MAX = 300;
const READ_WINDOW = 300;

type Route = "list" | "presign" | "files" | "links" | "update" | "delete";

function resolveRoute(method: string, seg: string[]): { route: Route; refId: number | null } | null {
  if (seg.length === 0 && method === "GET") return { route: "list", refId: null };
  if (seg.length === 1 && method === "POST") {
    if (seg[0] === "upload-url") return { route: "presign", refId: null };
    if (seg[0] === "files") return { route: "files", refId: null };
    if (seg[0] === "links") return { route: "links", refId: null };
    return null;
  }
  if (seg.length === 1 && (method === "PATCH" || method === "DELETE")) {
    const refId = parsePositiveId(seg[0]);
    if (refId === null) return null;
    return { route: method === "PATCH" ? "update" : "delete", refId };
  }
  return null;
}

/** Resultado dos RPCs de cliente ('ok' | 'not_found' | 'locked'); null = ok. */
function clientMutationOutcome(data: unknown, error: unknown, scope: string): ReferenceResult | null {
  if (error) {
    console.error(`[hub-post-references:${scope}] rpc failed:`, error);
    return referenceError("internal");
  }
  if (data === "ok") return null;
  if (data === "not_found") return referenceError("not_found");
  if (data === "locked") return referenceError("locked");
  console.error(`[hub-post-references:${scope}] unexpected rpc result:`, data);
  return referenceError("internal");
}

export function createHubPostReferencesHandler(deps: HubPostReferencesHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);
    const send = (r: ReferenceResult) => json(r.body, r.status);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("hub-post-references");
    const seg = idx >= 0 ? parts.slice(idx + 1) : [];
    const resolved = resolveRoute(req.method, seg);
    if (!resolved) return send(referenceError("not_found"));
    const { route, refId } = resolved;

    let body: Record<string, unknown> = {};
    if (req.method === "POST" || req.method === "PATCH") {
      const parsed = await req.json().catch(() => null);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    }

    const token = url.searchParams.get("token") ?? (typeof body.token === "string" ? body.token : null);
    if (!token) return json({ error: "token required" }, 400);

    const db = deps.createDb();
    // deno-lint-ignore no-explicit-any
    const hubToken = await resolveHubToken(db as any, token, deps.now());
    if (!hubToken) {
      const okBadToken = await deps.rateLimit(db, `hub-badtoken:${getClientIP(req)}`, 30, 600);
      if (!okBadToken) return send(referenceError("rate_limited"));
      return json({ error: "Link inválido." }, 404);
    }
    const contaId = hubToken.conta_id;
    const clienteId = hubToken.cliente_id;

    const allowed = route === "list"
      ? await deps.rateLimit(db, `hub-read:${contaId}:${clienteId}`, READ_MAX, READ_WINDOW)
      : await deps.rateLimit(db, `hub-write:hub-post-references:${contaId}:${clienteId}`, WRITE_MAX, WRITE_WINDOW);
    if (!allowed) return send(referenceError("rate_limited"));

    // ── PATCH /:id e DELETE /:id: o RPC confere cliente/conta e can_remove sob o
    // lock do post, então não há leitura prévia aqui (seria só uma corrida a mais).
    if (route === "update") {
      const note = normalizeReferenceNote(body.note);
      if (!note.ok) return send(referenceError("invalid_note"));
      const { data, error } = await db.rpc("post_reference_client_update", {
        p_id: refId, p_conta: contaId, p_cliente: clienteId, p_note: note.value,
      });
      const outcome = clientMutationOutcome(data, error, "update");
      if (outcome) return send(outcome);
      const { data: ref } = await db.from("post_references")
        .select("post_id").eq("id", refId).eq("conta_id", contaId).maybeSingle();
      const postId = parsePositiveId((ref as { post_id?: unknown } | null)?.post_id);
      if (postId === null) return send(referenceError("not_found"));
      const listed = await listPostReferences({
        db, post_id: postId, conta_id: contaId, signGetUrl: deps.signGetUrl, includeDownload: false,
      });
      if (!listed.ok) return send(listed.result);
      const item = listed.items.find((i) => i.id === refId);
      return item ? json({ item }) : send(referenceError("not_found"));
    }

    if (route === "delete") {
      const { data, error } = await db.rpc("post_reference_client_delete", {
        p_id: refId, p_conta: contaId, p_cliente: clienteId,
      });
      const outcome = clientMutationOutcome(data, error, "delete");
      if (outcome) return send(outcome);
      return json({ ok: true });
    }

    // ── Rotas por post: posse pelo cliente_id/conta_id do PRÓPRIO post (vale para
    // post avulso, como hub-approve). 404, não 403: não confirma que o id existe.
    const postId = parsePositiveId(route === "list" ? url.searchParams.get("post_id") : body.post_id);
    if (postId === null) return send(referenceError("not_found"));
    const { data: post, error: postErr } = await db.from("workflow_posts")
      .select("id, status, cliente_id, conta_id")
      .eq("id", postId)
      .maybeSingle();
    if (postErr) {
      console.error("[hub-post-references] post lookup failed:", postErr);
      return send(referenceError("internal"));
    }
    const owned = post as { status: string; cliente_id: number; conta_id: string } | null;
    if (!owned || owned.cliente_id !== clienteId || owned.conta_id !== contaId) {
      return send(referenceError("not_found"));
    }

    if (route === "list") {
      // Só posse, sem gate de status (como hub-post-history): um post pode seguir
      // visível "em produção" num status interno depois de um envio.
      const listed = await listPostReferences({
        db, post_id: postId, conta_id: contaId, signGetUrl: deps.signGetUrl, includeDownload: false,
      });
      if (!listed.ok) return send(listed.result);
      return json({
        can_add: owned.status === "enviado_cliente" && listed.items.length < MAX_REFERENCES_PER_POST,
        items: listed.items,
      });
    }

    // Gate de escrita (decisão 1). Best-effort: os RPCs rechecam sob FOR UPDATE.
    if (owned.status !== "enviado_cliente") return send(referenceError("post_not_pending"));

    if (route === "presign") {
      return send(await presignReferenceUpload({
        db,
        conta_id: contaId,
        post_id: postId,
        mime_type: body.mime_type,
        size_bytes: body.size_bytes,
        thumbnail: body.thumbnail,
        signPutUrl: deps.signPutUrl,
        randomUUID: deps.randomUUID,
      }));
    }

    const result = route === "files"
      ? await finalizeReferenceFile({
        db, conta_id: contaId, cliente_id: clienteId, post_id: postId, input: body,
        headObject: deps.headObject, signGetUrl: deps.signGetUrl,
      })
      : await insertReferenceLink({
        db, conta_id: contaId, cliente_id: clienteId, post_id: postId, input: body,
        signGetUrl: deps.signGetUrl,
      });

    if (result.status < 300) {
      // Não fatal: a referência já existe; o RPC agrupa avisos em 15 min por post.
      try {
        const { error: notifErr } = await db.rpc("create_post_reference_notification", { p_post_id: postId });
        if (notifErr) console.error("[hub-post-references] notification failed:", notifErr);
      } catch (e) {
        console.error("[hub-post-references] notification threw:", e);
      }
    }
    return send(result);
  };
}
```

- [ ] **Step 4: Run the handler test, confirm it passes**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/hub-post-references_test.ts
```
Expected: `ok | 31 passed | 0 failed`.

- [ ] **Step 5: Create the entrypoint**

Create `supabase/functions/hub-post-references/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { headObjectSigned, signGetUrl, signPutUrl } from "../_shared/r2.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { createHubPostReferencesHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createHubPostReferencesHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
  now: () => new Date().toISOString(),
  signPutUrl,
  signGetUrl,
  // headObjectSigned, nunca headObject: getR2().send() trava no edge runtime.
  headObject: headObjectSigned,
  // deno-lint-ignore no-explicit-any
  rateLimit: (db, key, max, win) => checkRateLimit(db as any, key, max, win),
}));
```

- [ ] **Step 6: Register `verify_jwt = false` and the config audit**

In `supabase/config.toml`, directly after the `hub-ideias` block (lines 64-65):

```toml
[functions.hub-ideias]
verify_jwt = false
```

insert:

```toml

[functions.hub-post-references]
verify_jwt = false
```

In `supabase/functions/__tests__/config-audit_test.ts`, in `REQUIRED_FUNCTIONS`, replace:

```ts
  "hub-ideias",
  "hub-instagram-feed",
```

with:

```ts
  "hub-ideias",
  "hub-post-references",
  "hub-instagram-feed",
```

- [ ] **Step 7: Document the deploy flag**

In `CLAUDE.md` (Gotchas, the `--no-verify-jwt` bullet), replace:

```
`hub-briefing` and `hub-agenda` (token do hub)
```

with:

```
`hub-briefing`, `hub-agenda` and `hub-post-references` (token do hub)
```

- [ ] **Step 8: Run the config audit and the type gate**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/config-audit_test.ts
npm run check:functions
```
Expected: `ok | 2 passed | 0 failed`; `check:functions` exits 0 (it type-checks
`hub-post-references/index.ts` and, through it, `handler.ts`).

- [ ] **Step 9: Commit**

```bash
git checkout -- deno.lock
git add supabase/functions/hub-post-references supabase/functions/__tests__/hub-post-references_test.ts \
  supabase/config.toml supabase/functions/__tests__/config-audit_test.ts CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(references): hub-post-references edge function for client references

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `post-references` edge function (CRM JWT)

**Files:**
- Create: `supabase/functions/post-references/handler.ts`
- Create: `supabase/functions/post-references/index.ts`
- Create: `supabase/functions/__tests__/post-references_test.ts`
- Modify: `supabase/config.toml`, `supabase/functions/__tests__/config-audit_test.ts`, `CLAUDE.md`

**Interfaces:**
- Consumes: Task 2 (`listPostReferences` with `includeDownload: true`, `parsePositiveId`,
  `referenceError`, `SignGetUrl`), `signGetUrl(key, 3600, name)` from Task 2's r2 change,
  `hasPermissionFor` (`_shared/permissions.ts`; module `entregas` exists at line 5),
  `insertAuditLog` (`_shared/audit.ts`, never throws). SQL: `post_reference_list`; the orphan
  trigger from Task 1 frees the `files` row and quota after the plain delete.
- Produces: `createPostReferencesHandler(deps)`. `GET /post-references?post_id` →
  `{ items: ReferenceItem[] }` (download_url on files); `DELETE /post-references/:id` →
  `{ ok: true }`, `403 { error: "forbidden" }` without `entregas`/`editar`,
  `404 { error: "not_found" }` when the row is not in the caller's workspace.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/post-references_test.ts`:

```ts
import { assert, assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createPostReferencesHandler } from "../post-references/handler.ts";

type Db = ReturnType<typeof createSupabaseQueryMock>;

function makeHandler(db: Db) {
  return createPostReferencesHandler({
    buildCorsHeaders: () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" }),
    createDb: () => db as never,
    signGetUrl: async (key: string, _exp?: number, name?: string) =>
      `https://get.example.com/${key}${name ? `?dl=${encodeURIComponent(name)}` : ""}`,
  });
}

function setupAuth(db: Db, contaId: string | null = "conta-1") {
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: contaId }, error: null });
}

function req(method: string, path: string) {
  return new Request(`https://x.test/post-references${path}`, {
    method,
    headers: { Authorization: "Bearer jwt" },
  });
}

const FILE_ROW = {
  id: 7, kind: "file", file_id: 70, url: null, link_title: null, note: "Use esta foto",
  post_approval_id: 501, created_at: "2026-10-08T11:00:00.000Z", can_remove: false,
  name: "Relatório (v2).pdf", mime_type: "application/pdf", file_kind: "document", size_bytes: 5000,
  width: null, height: null, duration_seconds: null, r2_key: "contas/conta-1/files/u.pdf",
  thumbnail_r2_key: null, blur_data_url: null,
};
const LINK_ROW = {
  ...FILE_ROW, id: 8, kind: "link", file_id: null, url: "https://exemplo.com/x", link_title: "X",
  name: null, mime_type: null, file_kind: null, size_bytes: null, r2_key: null, post_approval_id: null,
};

Deno.test("post-references: missing or invalid auth is 401", async () => {
  const db = createSupabaseQueryMock();
  assertEquals((await makeHandler(db)(new Request("https://x.test/post-references?post_id=99"))).status, 401);
  const db2 = createSupabaseQueryMock();
  db2.withAuth(null, { message: "bad jwt" });
  assertEquals((await makeHandler(db2)(req("GET", "?post_id=99"))).status, 401);
});

Deno.test("post-references: profile without conta_id is 403", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db, null);
  assertEquals((await makeHandler(db)(req("GET", "?post_id=99"))).status, 403);
});

Deno.test("post-references: GET lists items with a download URL on files only", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("workflow_posts", "select", { data: { id: 99 }, error: null });
  db.queueRpc("post_reference_list", { data: [FILE_ROW, LINK_ROW], error: null });
  const res = await makeHandler(db)(req("GET", "?post_id=99"));
  assertEquals(res.status, 200);
  const { items } = await readJson(res);
  assertEquals(items.length, 2);
  assertEquals(items[0].url, "https://get.example.com/contas/conta-1/files/u.pdf");
  assertEquals(
    items[0].download_url,
    `https://get.example.com/contas/conta-1/files/u.pdf?dl=${encodeURIComponent("Relatório (v2).pdf")}`,
  );
  assertEquals(items[0].post_approval_id, 501);
  assertEquals(items[1].kind, "link");
  assertEquals(items[1].download_url, null);

  const postLookup = db.calls.find((c) => c.table === "workflow_posts");
  assert(postLookup?.modifiers.some((m) => m.method === "eq" && m.args[0] === "conta_id" && m.args[1] === "conta-1"));
  assertEquals(db.calls.find((c) => c.table === "rpc:post_reference_list")?.payload, { p_post_id: 99, p_conta: "conta-1" });
});

Deno.test("post-references: GET for a post outside the workspace is 404 and never lists", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("workflow_posts", "select", { data: null, error: null });
  const res = await makeHandler(db)(req("GET", "?post_id=99"));
  assertEquals(res.status, 404);
  assertEquals((await readJson(res)).error, "not_found");
  assertEquals(db.calls.find((c) => c.table === "rpc:post_reference_list"), undefined);
});

Deno.test("post-references: DELETE requires entregas/editar", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("has_permission_for", { data: false, error: null });
  const res = await makeHandler(db)(req("DELETE", "/7"));
  assertEquals(res.status, 403);
  assertEquals(await readJson(res), { error: "forbidden" });
  assertEquals(db.calls.find((c) => c.table === "post_references" && c.operation === "delete"), undefined);
  assertEquals(db.calls.find((c) => c.table === "rpc:has_permission_for")?.payload, {
    p_user: "user-1", p_workspace: "conta-1", p_module: "entregas", p_action: "editar",
  });
});

Deno.test("post-references: DELETE removes the row filtered by id and conta_id", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_references", "delete", { data: [{ id: 7, post_id: 99, kind: "file" }], error: null });
  const res = await makeHandler(db)(req("DELETE", "/7"));
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), { ok: true });
  const del = db.calls.find((c) => c.table === "post_references" && c.operation === "delete");
  assertEquals(del?.modifiers.filter((m) => m.method === "eq"), [
    { method: "eq", args: ["id", 7] },
    { method: "eq", args: ["conta_id", "conta-1"] },
  ]);
  const audit = db.calls.find((c) => c.table === "audit_log");
  assertEquals((audit?.payload as { action: string }).action, "delete_post_reference");
});

Deno.test("post-references: DELETE of a missing or foreign row is 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_references", "delete", { data: [], error: null });
  const res = await makeHandler(db)(req("DELETE", "/7"));
  assertEquals(res.status, 404);
  assertEquals((await readJson(res)).error, "not_found");
});

Deno.test("post-references: DELETE with a non-numeric id is 404 without a permission check", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const res = await makeHandler(db)(req("DELETE", "/abc"));
  assertEquals(res.status, 404);
  assertEquals(db.calls.find((c) => c.table === "rpc:has_permission_for"), undefined);
});

Deno.test("post-references: a DB error on delete is a generic 500", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_references", "delete", { data: null, error: { message: "permission denied for table" } });
  const res = await makeHandler(db)(req("DELETE", "/7"));
  assertEquals(res.status, 500);
  assertEquals(await readJson(res), { error: "internal" });
});
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/post-references_test.ts
```
Expected: FAIL with `Module not found ".../post-references/handler.ts"`.

- [ ] **Step 3: Implement the handler**

Create `supabase/functions/post-references/handler.ts`:

```ts
// Referências do cliente no post, lado CRM (JWT). Spec:
// docs/superpowers/specs/2026-10-08-client-post-references-design.md
// Mesma forma de auth de ideia-media-manage: service role + getUser(token),
// conta pelo profiles.conta_id (403 se nulo). Toda query filtra conta_id.
import { insertAuditLog } from "../_shared/audit.ts";
import { createJsonResponder } from "../_shared/http.ts";
import { hasPermissionFor } from "../_shared/permissions.ts";
import {
  listPostReferences,
  parsePositiveId,
  referenceError,
  type ReferenceResult,
  type SignGetUrl,
} from "../_shared/post-references.ts";

type DbClient = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  // deno-lint-ignore no-explicit-any
  auth: { getUser: (token: string) => Promise<{ data: { user: any }; error: any }> };
  // deno-lint-ignore no-explicit-any
  rpc: (name: string, params: Record<string, unknown>) => any;
};

export interface PostReferencesHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  signGetUrl: SignGetUrl;
}

export function createPostReferencesHandler(deps: PostReferencesHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = { ...deps.buildCorsHeaders(req), "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS" };
    const json = createJsonResponder(cors);
    const send = (r: ReferenceResult) => json(r.body, r.status);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const db = deps.createDb();
    const { data: { user }, error: authErr } = await db.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await db.from("profiles").select("conta_id").eq("id", user.id).single();
    if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);
    const contaId = profile.conta_id as string;

    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("post-references");
    const seg = idx >= 0 ? parts.slice(idx + 1) : [];

    // GET ?post_id → lista com download_url. Sem checagem de módulo: mesma regra da
    // mídia do post (membro do workspace, via RLS), e a lista de referências já é
    // legível por SELECT direto (policy de post_references).
    if (req.method === "GET" && seg.length === 0) {
      const postId = parsePositiveId(url.searchParams.get("post_id"));
      if (postId === null) return send(referenceError("not_found"));
      const { data: post } = await db.from("workflow_posts")
        .select("id").eq("id", postId).eq("conta_id", contaId).maybeSingle();
      if (!post) return send(referenceError("not_found"));
      const listed = await listPostReferences({
        db, post_id: postId, conta_id: contaId, signGetUrl: deps.signGetUrl, includeDownload: true,
      });
      if (!listed.ok) return send(listed.result);
      return json({ items: listed.items });
    }

    // DELETE /:id → remoção pela equipe. Exige entregas/editar (espelho do
    // can('entregas','editar') do WorkflowDrawer): mais estrito que a mídia do post,
    // de propósito, porque é material do cliente. O trigger de órfão apaga o files
    // e devolve a cota.
    if (req.method === "DELETE" && seg.length === 1) {
      const refId = parsePositiveId(seg[0]);
      if (refId === null) return send(referenceError("not_found"));
      const canEdit = await hasPermissionFor(db, user.id, contaId, "entregas", "editar");
      if (!canEdit) return json({ error: "forbidden" }, 403);

      const { data: deleted, error } = await db.from("post_references")
        .delete()
        .eq("id", refId)
        .eq("conta_id", contaId)
        .select("id, post_id, kind");
      if (error) {
        console.error("[post-references] delete failed:", error);
        return send(referenceError("internal"));
      }
      const row = Array.isArray(deleted) ? deleted[0] as { post_id: number; kind: string } | undefined : undefined;
      if (!row) return send(referenceError("not_found"));

      await insertAuditLog(db, {
        conta_id: contaId,
        actor_user_id: user.id,
        action: "delete_post_reference",
        resource_type: "post_reference",
        resource_id: String(refId),
        metadata: { post_id: row.post_id, kind: row.kind },
      });
      return json({ ok: true });
    }

    return send(referenceError("not_found"));
  };
}
```

- [ ] **Step 4: Run the test, confirm it passes**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/post-references_test.ts
```
Expected: `ok | 9 passed | 0 failed`.

- [ ] **Step 5: Create the entrypoint**

Create `supabase/functions/post-references/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { signGetUrl } from "../_shared/r2.ts";
import { createPostReferencesHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createPostReferencesHandler({
  buildCorsHeaders,
  // Service role; auth.getUser(token) ainda valida o JWT do chamador (chaves ES256:
  // o gateway não valida, por isso verify_jwt = false no config.toml).
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
  signGetUrl,
}));
```

- [ ] **Step 6: Gateway flag, config audit, CLAUDE.md**

In `supabase/config.toml`, directly after the `ideia-media-manage` block:

```toml
[functions.ideia-media-manage]
verify_jwt = false
```

insert:

```toml

[functions.post-references]
verify_jwt = false
```

In `supabase/functions/__tests__/config-audit_test.ts`, replace:

```ts
  "post-media-manage",
  "platform-admin",
```

with:

```ts
  "post-media-manage",
  "post-references",
  "platform-admin",
```

In `CLAUDE.md` (same `--no-verify-jwt` bullet), replace:

```
`briefing-audio` and `geo-autocomplete` (verify the user JWT themselves)
```

with:

```
`briefing-audio`, `geo-autocomplete` and `post-references` (verify the user JWT themselves)
```

- [ ] **Step 7: Run the config audit and type gate**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/config-audit_test.ts
npm run check:functions
```
Expected: `ok | 2 passed | 0 failed`; `check:functions` exits 0.

- [ ] **Step 8: Commit**

```bash
git checkout -- deno.lock
git add supabase/functions/post-references supabase/functions/__tests__/post-references_test.ts \
  supabase/config.toml supabase/functions/__tests__/config-audit_test.ts CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(references): post-references edge function for the CRM editor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `hub-approve` links `reference_ids` to the correction

**Files:**
- Modify: `supabase/functions/hub-approve/handler.ts`
- Modify: `supabase/functions/__tests__/hub-functions_test.ts` (append tests; the only Deno
  suite that imports this handler besides `config-audit_test.ts`, which only lists the name)

**Interfaces:**
- Consumes: `record_client_approval(...) RETURNS bigint` (latest definition
  `20260928150001_edit_suggestion_update_flow.sql:126-164`, returns the new
  `post_approvals.id`); `post_references` table (Task 1); `MAX_REFERENCES_PER_POST` (Task 2).
- Produces: request body gains optional `reference_ids: number[]`, honoured only for
  `action = "correcao"`; `400 { error: "Referências inválidas." }` on a malformed list.
  Response shape unchanged (`{ ok: true, scheduled }`), so no Vitest consumer changes.

- [ ] **Step 1: Write the failing tests**

Append to the end of `supabase/functions/__tests__/hub-functions_test.ts` (it reuses the
file's `hubApproveDbForPost()` and `hubApproveHandlerFor()` helpers):

```ts
// ── hub-approve reference_ids (client post references, 2026-10-08) ──

function correcaoRequest(extra: Record<string, unknown>) {
  return new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "correcao", comentario: "Trocar", ...extra }),
  });
}

Deno.test("hub-approve links deduped reference_ids to the new correction", async () => {
  const db = hubApproveDbForPost();
  db.queueRpc("record_client_approval", { data: 501, error: null });
  const response = await hubApproveHandlerFor(db)(correcaoRequest({ reference_ids: [5, 6, 5] }));
  assertEquals(response.status, 200);
  const update = db.calls.find((c: { table: string; operation: string }) =>
    c.table === "post_references" && c.operation === "update");
  assert(update, "post_references should be updated");
  assertEquals(update.payload, { post_approval_id: 501 });
  assertEquals(update.modifiers, [
    { method: "in", args: ["id", [5, 6]] },
    { method: "eq", args: ["post_id", 99] },
    { method: "eq", args: ["conta_id", "conta-1"] },
    { method: "is", args: ["post_approval_id", null] },
  ]);
});

Deno.test("hub-approve rejects malformed reference_ids before any DB call", async () => {
  const bad: unknown[] = [
    "5", [0], [-1], [1.5], ["5"], [null], [Number.MAX_SAFE_INTEGER + 1], {},
    Array.from({ length: 11 }, (_, i) => i + 1),
  ];
  for (const reference_ids of bad) {
    const db = createSupabaseQueryMock();
    const response = await hubApproveHandlerFor(db)(correcaoRequest({ reference_ids }));
    assertEquals(response.status, 400, JSON.stringify(reference_ids));
    assertEquals((await readJson(response)).error, "Referências inválidas.");
    assertEquals(db.calls.length, 0);
  }
});

Deno.test("hub-approve ignores reference_ids on aprovado and mensagem", async () => {
  for (const action of ["aprovado", "mensagem"]) {
    const db = hubApproveDbForPost();
    db.queueRpc("record_client_approval", { data: 501, error: null });
    const response = await hubApproveHandlerFor(db)(new Request("https://example.test/hub-approve", {
      method: "POST",
      body: JSON.stringify({ token: "hub-123", post_id: 99, action, comentario: "ok", reference_ids: "junk" }),
    }));
    assertEquals(response.status, 200, action);
    assertEquals(
      db.calls.find((c: { table: string }) => c.table === "post_references"),
      undefined,
      action,
    );
  }
});

Deno.test("hub-approve keeps the correction when linking references fails", async () => {
  const db = hubApproveDbForPost();
  db.queueRpc("record_client_approval", { data: 501, error: null });
  db.queue("post_references", "update", { data: null, error: { message: "boom" } });
  const response = await hubApproveHandlerFor(db)(correcaoRequest({ reference_ids: [5] }));
  assertEquals(response.status, 200);
  assertEquals((await readJson(response)).ok, true);
  assert(db.calls.find((c: { table: string }) => c.table === "rpc:create_post_approval_notification"));
});

Deno.test("hub-approve skips linking references when record_client_approval returns no id", async () => {
  for (const data of [true, null, "abc", 0]) {
    const db = hubApproveDbForPost();
    db.queueRpc("record_client_approval", { data, error: null });
    const response = await hubApproveHandlerFor(db)(correcaoRequest({ reference_ids: [5] }));
    assertEquals(response.status, 200, JSON.stringify(data));
    assertEquals(
      db.calls.find((c: { table: string }) => c.table === "post_references"),
      undefined,
      JSON.stringify(data),
    );
  }
});

Deno.test("hub-approve with an empty reference_ids list does not touch post_references", async () => {
  const db = hubApproveDbForPost();
  db.queueRpc("record_client_approval", { data: 501, error: null });
  const response = await hubApproveHandlerFor(db)(correcaoRequest({ reference_ids: [] }));
  assertEquals(response.status, 200);
  assertEquals(db.calls.find((c: { table: string }) => c.table === "post_references"), undefined);
});
```

- [ ] **Step 2: Run them, confirm they fail**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/hub-functions_test.ts --filter "reference"
```
Expected: 6 tests selected; the "links deduped" test fails with "post_references should be
updated" and the malformed-ids test fails (200 instead of 400). The other four pass already
(they assert that nothing happens), which is fine.

- [ ] **Step 3: Implement**

In `supabase/functions/hub-approve/handler.ts`:

(a) Add the import after the existing `getClientIP` import (line 4):

```ts
import { MAX_REFERENCES_PER_POST } from "../_shared/post-references.ts";
```

(b) Directly after the `HUB_VISIBLE_STATUSES` constant, add:

```ts
/** reference_ids de uma correção (spec 2026-10-08): array de inteiros positivos
 * seguros, sem duplicatas, no máximo o teto de referências do post. null = inválido. */
function parseReferenceIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_REFERENCES_PER_POST * 10) return null;
  const ids = new Set<number>();
  for (const v of raw) {
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) return null;
    ids.add(v);
  }
  return ids.size <= MAX_REFERENCES_PER_POST ? [...ids] : null;
}

/** Liga as referências já enviadas à correção recém-gravada. Não fatal: a correção
 * vale e as referências ficam no nível do post. Só liga referências deste post, desta
 * conta e ainda soltas (a posse do post já foi conferida contra o token). */
async function linkReferencesToApproval(
  db: DbClient,
  approvalData: unknown,
  ids: number[],
  postId: unknown,
  contaId: string,
): Promise<void> {
  const approvalId = typeof approvalData === "number" || typeof approvalData === "string"
    ? Number(approvalData)
    : NaN;
  if (!Number.isSafeInteger(approvalId) || approvalId <= 0) {
    console.error("[hub-approve] record_client_approval returned no approval id; references stay post-level");
    return;
  }
  try {
    const { error } = await db.from("post_references")
      .update({ post_approval_id: approvalId })
      .in("id", ids)
      .eq("post_id", postId)
      .eq("conta_id", contaId)
      .is("post_approval_id", null);
    if (error) console.error("[hub-approve] reference link failed (correction stands):", error);
  } catch (e) {
    console.error("[hub-approve] reference link threw (correction stands):", e);
  }
}
```

(c) Replace line 100:

```ts
    const { token, post_id, action, comentario, motivo } = await req.json();
```

with:

```ts
    const { token, post_id, action, comentario, motivo, reference_ids } = await req.json();
```

(d) Replace the motivo check (lines 111-113):

```ts
    if (action === "correcao" && motivo != null && !CORRECTION_REASONS.includes(motivo)) {
      return json({ error: "Motivo inválido." }, 400);
    }
```

with:

```ts
    if (action === "correcao" && motivo != null && !CORRECTION_REASONS.includes(motivo)) {
      return json({ error: "Motivo inválido." }, 400);
    }
    // reference_ids só valem na correção; validados antes de qualquer ida ao banco
    // e ignorados em aprovado/mensagem.
    let referenceIds: number[] = [];
    if (action === "correcao" && reference_ids != null) {
      const parsed = parseReferenceIds(reference_ids);
      if (!parsed) return json({ error: "Referências inválidas." }, 400);
      referenceIds = parsed;
    }
```

(e) Replace the RPC call head (line 187):

```ts
      const { error: approvalErr } = await db.rpc("record_client_approval", {
```

with:

```ts
      const { data: approvalData, error: approvalErr } = await db.rpc("record_client_approval", {
```

(f) Directly after the closing brace of the `if (approvalErr) { ... }` block (the one that
ends with `return json({ error: "Erro ao registrar aprovação." }, 500);` and `}`), still
inside the `else` branch, add:

```ts
      // record_client_approval já commitou (este UPDATE é outra requisição, sem lock).
      // É seguro porque o post saiu de enviado_cliente: um finalize atrasado dá 409
      // (post_not_pending) e nunca cria referência nova depois deste ponto.
      if (referenceIds.length > 0) {
        await linkReferencesToApproval(db, approvalData, referenceIds, post_id, hubToken.conta_id);
      }
```

- [ ] **Step 4: Run the whole hub suite (new and existing hub-approve tests)**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/hub-functions_test.ts
```
Expected: `ok | 130 passed | 0 failed` at the time of writing (124 existing + 6 new; every
pre-existing hub-approve test stays green: they
send no `reference_ids`, and an unqueued `record_client_approval` still resolves `{ data: true }`,
which the guard treats as "no id").

- [ ] **Step 5: Type gate**

```bash
npm run check:functions
```
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git checkout -- deno.lock
git add supabase/functions/hub-approve/handler.ts supabase/functions/__tests__/hub-functions_test.ts
git commit -m "$(cat <<'EOF'
feat(references): link staged references to a Hub correction

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Keep reference files out of Arquivos (`file-manage`)

**Audit of every place that lists `files` rows to users** (grep of
`from("files")`/`from('files')` across `apps/`, `packages/`, `supabase/functions/`):

| Reader | Lists to a user? | Action |
|---|---|---|
| `file-manage/handler.ts:126-128` GET `/folders` (root and folder contents) | Yes. This is Arquivos, the post-media `FilePickerModal` and the report `ImageBlockEditor` picker (both call `getFolderContents` in `apps/crm/src/services/fileService.ts:141-143`) | Add `.is("attached_to", null)` (unconditionally) |
| `file-manage/handler.ts:102-105` GET `/folders/:id` direct file count | Counts by `folder_id`; references are `folder_id NULL` | None |
| `file-manage/handler.ts:466` PATCH `/files/:id` (rename/move) | Moving a reference into a folder would surface it in Arquivos | Reject `attached_to` rows with 404 |
| `file-manage/handler.ts:537` POST `/links` (link file to post) | Would break the invariant "a reference file is never linked from another table" | Reject `attached_to` rows with 404 |
| `file-manage/handler.ts:638` POST `/bulk-move` (RPC `bulk_move_items`) | Same as PATCH, through SQL | Pre-check in the handler, 404 |
| `file-manage` bulk-delete, DELETE `/files/:id` | Reference files have `reference_count > 0` (trigger), so both already refuse | None |
| `file-manage` POST `/files/:id/copy` | Creates an independent new row and key without `attached_to` | None (not a leak) |
| `file-manage` GET `/files/:id/url`, `file-zip`, `apps/crm/src/hooks/useFileUrl.ts:77` | By id, not a listing | None |
| `mcp/queries.ts:351,564` | Only through `post_file_links!inner` | None |
| Storage UI (`useWorkspaceUsage` → `workspace_usage`, `ArmazenamentoTab` → `storage_autoclean_preview`) | Totals / autoclean candidates (only files with a `post_file_links` row) | None (reference bytes are meant to count against quota) |
| `post-media-cleanup-cron/stream-steps.ts`, `stream-webhook`, `express-post-cleanup-cron`, `hub-posts:525`, `mcp-admin/images.ts:219` | Not user listings | None |

**Files:**
- Modify: `supabase/functions/file-manage/handler.ts`
- Modify: `supabase/functions/__tests__/file-manage_test.ts`
- Modify: `supabase/functions/__tests__/file-manage-bulk_test.ts`

**Interfaces:**
- Consumes: `files.attached_to` column (Task 1, `text NULL CHECK (attached_to IN ('post_reference'))`).
- Produces: GET `/folders` never returns `attached_to` rows; PATCH `/files/:id`, POST `/links`
  and POST `/bulk-move` answer `404` for them (same body as a foreign file).

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/__tests__/file-manage_test.ts`:

```ts
// ─── Client post references (files.attached_to) ─────────────────

function hasAttachedToFilter(db: ReturnType<typeof createSupabaseQueryMock>) {
  const filesSelect = db.calls.find((c) => c.table === "files" && c.operation === "select");
  return !!filesSelect?.modifiers.some((m) =>
    m.method === "is" && m.args[0] === "attached_to" && m.args[1] === null
  );
}

Deno.test("file-manage: GET /folders root listing excludes reference files (attached_to)", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: [], error: null });
  db.queue("files", "select", { data: [], error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000000, error: null });
  const res = await makeHandler(db)(req("GET", "/folders"));
  assertEquals(res.status, 200);
  assert(hasAttachedToFilter(db), "root files query must filter attached_to IS NULL");
});

Deno.test("file-manage: GET /folders?parent_id also excludes reference files", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: [], error: null });
  db.queue("files", "select", { data: [], error: null });
  db.queue("folders", "select", { data: { id: 5, conta_id: "conta-1" }, error: null });
  db.queueRpc("folder_breadcrumbs", { data: [{ id: 5, name: "Sub" }], error: null });
  db.queue("folders", "select", { data: { id: 5, name: "Sub" }, error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000000, error: null });
  const res = await makeHandler(db)(req("GET", "/folders?parent_id=5"));
  assertEquals(res.status, 200);
  assert(hasAttachedToFilter(db), "folder files query must filter attached_to IS NULL");
});

Deno.test("file-manage: PATCH /files/:id on a reference file is 404 and never updates", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: { conta_id: "conta-1", attached_to: "post_reference" }, error: null });
  const res = await makeHandler(db)(req("PATCH", "/files/10", { folder_id: null, name: "x" }));
  assertEquals(res.status, 404);
  assertEquals(db.calls.find((c) => c.table === "files" && c.operation === "update"), undefined);
});

Deno.test("file-manage: POST /links refuses to link a reference file to a post", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", {
    data: { conta_id: "conta-1", kind: "image", attached_to: "post_reference" },
    error: null,
  });
  const res = await makeHandler(db)(req("POST", "/links", { post_id: 50, file_id: 10 }));
  assertEquals(res.status, 404);
  assertEquals(db.calls.find((c) => c.table === "post_file_links"), undefined);
});
```

Append to `supabase/functions/__tests__/file-manage-bulk_test.ts`:

```ts
Deno.test("bulk-move: refuses reference files (attached_to) before the RPC", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: [{ id: 2 }], error: null });
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/bulk-move", { file_ids: [1, 2], folder_ids: [], destination_id: 10 }));
  assertEquals(res.status, 404);
  assertEquals(db.calls.find((c) => c.table === "rpc:bulk_move_items"), undefined);
  const check = db.calls.find((c) => c.table === "files" && c.operation === "select");
  assert(check?.modifiers.some((m) => m.method === "not" && m.args[0] === "attached_to"));
});
```

- [ ] **Step 2: Run them, confirm they fail**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/file-manage_test.ts supabase/functions/__tests__/file-manage-bulk_test.ts
```
Expected: FAIL on the five new tests (no `attached_to` filter; PATCH returns 200; POST
/links returns 201; bulk-move calls the RPC).

- [ ] **Step 3: Implement**

In `supabase/functions/file-manage/handler.ts`:

(a) Replace (lines 126-129):

```ts
        const filesQ = svc.from("files").select("*").eq("conta_id", contaId);
        if (parentFilter) filesQ.eq("folder_id", parentFilter);
        else filesQ.is("folder_id", null);
        filesQ.order("created_at", { ascending: false });
```

with:

```ts
        const filesQ = svc.from("files").select("*").eq("conta_id", contaId);
        if (parentFilter) filesQ.eq("folder_id", parentFilter);
        else filesQ.is("folder_id", null);
        // Arquivos de referência do cliente (post_references) pertencem ao post, não à
        // biblioteca: nunca aparecem aqui, na raiz nem numa pasta (spec 2026-10-08).
        filesQ.is("attached_to", null);
        filesQ.order("created_at", { ascending: false });
```

(b) In PATCH `/files/:id`, replace:

```ts
        const { data: file } = await svc.from("files").select("conta_id").eq("id", fileId).single();
        if (!file || file.conta_id !== contaId) return json({ error: "File not found" }, 404);

        const body = await req.json().catch(() => ({}));
        const patch: Record<string, unknown> = {};
```

with:

```ts
        const { data: file } = await svc.from("files").select("conta_id, attached_to").eq("id", fileId).single();
        // Mover uma referência para uma pasta a faria aparecer em Arquivos.
        if (!file || file.conta_id !== contaId || file.attached_to != null) {
          return json({ error: "File not found" }, 404);
        }

        const body = await req.json().catch(() => ({}));
        const patch: Record<string, unknown> = {};
```

(c) In POST `/links`, replace:

```ts
        const { data: file } = await svc.from("files").select("conta_id, kind").eq("id", file_id).single();
        if (!file || file.conta_id !== contaId) return json({ error: "File not found" }, 404);
```

with:

```ts
        const { data: file } = await svc.from("files").select("conta_id, kind, attached_to").eq("id", file_id).single();
        // Invariante de post_references: o files de uma referência nunca é ligado a
        // outra tabela ("Usar no post" futuro COPIA o objeto para um files novo).
        if (!file || file.conta_id !== contaId || file.attached_to != null) {
          return json({ error: "File not found" }, 404);
        }
```

(d) In POST `/bulk-move`, replace:

```ts
      if ((!file_ids || file_ids.length === 0) && (!folder_ids || folder_ids.length === 0)) {
        return json({ error: "No items to move" }, 400);
      }

      const { data: result, error: rpcError } = await svc.rpc("bulk_move_items", {
```

with:

```ts
      if ((!file_ids || file_ids.length === 0) && (!folder_ids || folder_ids.length === 0)) {
        return json({ error: "No items to move" }, 400);
      }

      if (file_ids && file_ids.length > 0) {
        const { data: attached, error: attachedErr } = await svc.from("files")
          .select("id")
          .eq("conta_id", contaId)
          .in("id", file_ids)
          .not("attached_to", "is", null)
          .limit(1);
        if (attachedErr) return internalServerError(json, "file-manage:move-attached-check", attachedErr);
        if ((attached ?? []).length > 0) return json({ error: "File not found" }, 404);
      }

      const { data: result, error: rpcError } = await svc.rpc("bulk_move_items", {
```

- [ ] **Step 4: Run both file-manage suites**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/file-manage_test.ts supabase/functions/__tests__/file-manage-bulk_test.ts
```
Expected: `ok | 85 passed | 0 failed` at the time of writing (66 + 19; pre-existing PATCH/links fixtures return rows without
`attached_to`, i.e. `undefined`, which passes `!= null`; pre-existing bulk-move tests get the
mock's default empty select for the new pre-check).

- [ ] **Step 5: Full edge gates**

```bash
npm run check:functions
npm run test:functions
```
Expected: both exit 0; the test run ends `ok | N passed | 0 failed`.

- [ ] **Step 6: Commit**

```bash
git checkout -- deno.lock
git add supabase/functions/file-manage/handler.ts supabase/functions/__tests__/file-manage_test.ts \
  supabase/functions/__tests__/file-manage-bulk_test.ts
git commit -m "$(cat <<'EOF'
feat(references): keep reference files out of Arquivos and post media

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

After the last Deno run, `npm ci` before any frontend `tsc`/Vitest.

---

### Contract issues

1. **`CONTROL_OR_SPACE` is not exported** from `_shared/safe-href.ts` (module-level `const`,
   line 7). Task 2 Step 5 adds `export`; no behaviour change.
2. **`post-references` also needs `verify_jwt = false`.** The contracts only flag
   `hub-post-references` as `--no-verify-jwt`, but the project's keys are ES256 and every
   function that verifies the user JWT itself (`ideia-media-manage`, `file-manage`,
   `briefing-audio`) has `verify_jwt = false` in `config.toml`. Task 4 adds the config entry,
   the `config-audit_test.ts` entry and the CLAUDE.md mention; the deploy command for
   `post-references` needs `--no-verify-jwt` too.
3. **Token-layer errors are not `ReferenceErrorCode`s.** To stay consistent with every
   other Hub function, `hub-post-references` keeps `400 { error: "token required" }` and
   `404 { error: "Link inválido." }` for a missing/unknown token. All other errors are codes,
   and both limiters (bad-token and read/write) return `429 { error: "rate_limited" }`. The
   Hub service must treat a non-code `error` as `internal`/link-invalid.
4. **No code for a malformed request.** Missing/invalid `post_id` maps to `404 not_found`; a
   non-positive or non-integer `size_bytes` maps to `400 upload_mismatch`; an over-long link
   title maps to `400 invalid_note` (it is a free-text length error like the note). The Hub
   only hits these on a client bug; flag if the frontend part wants a dedicated code.
   For `application/pdf` the Hub must omit `thumbnail_r2_key` (or send `""`) and omit
   `thumbnail_bytes` (or send `null`): any other value, `0` included, is `400 thumbnail_invalid`.
5. **RPC jsonb nulls.** Only `thumbnail_r2_key` uses `''` for "none" (contract). `width`,
   `height`, `duration_seconds`, `blur_data_url` and `note` are sent as JSON `null`.
   `p->>'k'` on JSON null is SQL NULL, so a plain `(p->>'width')::int` works; Task 1 should
   still use `NULLIF(p->>'k','')` to be robust to both.
6. **`files.r2_key` is not unique** (only `files_r2_key_idx`, a plain index,
   `20260425000001_file_system_tables.sql:59`). Two consequences: a replayed finalize would
   insert a second files row for the same object, and a Hub client could finalize a
   reference with the r2_key of existing post media (the key is visible in the signed URLs
   `hub-posts` returns) and then delete the reference, which deletes the R2 object through
   `file_enqueue_delete` and breaks the post. Task 2's `finalizeReferenceFile` blocks both
   best-effort (exact `{uuid}.{ext}` / `{uuid}.thumb.webp` key shape plus a lookup of both
   keys in `files.r2_key` and `files.thumbnail_r2_key`), but that check is racy. **Ask for
   Task 1:** inside `post_reference_file_insert`, before inserting, `RAISE EXCEPTION
   'upload_mismatch'` when any `files` row has `r2_key` or `thumbnail_r2_key` equal to
   either incoming key. `mapReferenceRpcError` already maps `upload_mismatch` to 400. The
   same hole exists today in `hub-ideias` finalize (out of scope).
7. **`can_remove` "after a team reply / after a team re-send"** is computed only in SQL
   (`post_reference_list`, `post_reference_client_update/delete`). The Deno tests can only
   assert that the handler passes the RPC's `can_remove` and `locked` through; the real
   coverage belongs to Task 1's `supabase/tests/entitlements/` suite.
8. **`bulk_move_items` (SQL) does not know about `attached_to`.** Task 6 guards it in the
   handler; if Task 1 prefers, add `AND attached_to IS NULL` to the RPC's file update as the
   authoritative check.
9. **CRM GET has no module check.** `post-references` GET is membership-only (same as post
   media and the `post_references` SELECT policy). Only DELETE checks `entregas`/`editar`,
   as the contract says.
10. **Status codes on create.** `POST /files` and `POST /links` return `201 { item }`
    (the contract does not specify; the Hub service should test `res.ok`, not `=== 200`).

### Verified facts

Every Create/Append/replace block in Tasks 2-6 was applied to a scratch copy of
`supabase/functions` (not the repo) and run: shared 10 + r2 2, hub-post-references 31,
post-references 9, config-audit 2, file-manage 66, file-manage-bulk 19, hub-functions 130,
all `0 failed`; `deno check` over every `*/index.ts`, `_shared/*.ts`, `_shared/*/*.ts`
exits 0 with the changes.

- `_shared/r2.ts:46-49`: `signGetUrl(key, expiresSeconds = 3600)` builds a
  `GetObjectCommand` with no disposition; `headObjectSigned` (presign + fetch HEAD) is at the
  end of the file; `signPutUrl` default 900s at `:41-44`.
- `hub-ideias/index.ts:12-25`: wiring with `headObject: headObjectSigned`,
  `rateLimit: (db, key, max, win) => checkRateLimit(db as any, ...)`.
- `hub-ideias/handler.ts`: token via `?token` or body; bad-token limiter
  `hub-badtoken:{ip}` 30/600 returning `404 "Link inválido."`; debits `hub-read` on every route.
- `hub-edit-suggestion/handler.ts:77-85`: comment and write-only key
  `hub-write:hub-edit-suggestion:{conta}:{cliente}` (no `hub-read` debit).
- `hub-approve/handler.ts:100` destructuring; `:111-113` motivo check; `:159` ownership by the
  post's own `cliente_id`/`conta_id` (403 there); `:187` `record_client_approval` call whose
  `data` is discarded today.
- `supabase/migrations/20260928150001_edit_suggestion_update_flow.sql:126-164`:
  `record_client_approval(... p_motivo text default null) returns bigint`, locks the post
  `FOR UPDATE`, returns the new `post_approvals.id`.
- `_shared/permissions.ts:4-8` (`PERMISSION_MODULES` includes `"entregas"`), `:31-55`
  `hasPermissionFor` fails closed, calls RPC `has_permission_for` with
  `{p_user, p_workspace, p_module, p_action}`.
- `ideia-media-manage/handler.ts`: service-role client, `getUser(token)`,
  `profiles.conta_id` null → `403 "Profile not found"`; `config.toml` has
  `[functions.ideia-media-manage] verify_jwt = false`.
- `_shared/safe-href.ts:7`: `const CONTROL_OR_SPACE = /[\x00-\x20\x7F]/;` (not exported).
- `_shared/ideia-media.ts`: model for presign/finalize (`{status, body}`, prefix check,
  HEAD size + content-type, `.single()` on the insert RPC, 500 fallback logged generically).
- `_shared/entitlements-rpc.ts`: `effectivePlanLimit` returns `Number(data)`, so in tests an
  unqueued RPC (`{data: true}`) means a 1-byte quota; every presign test queues
  `effective_plan_limit`.
- `test/shared/supabaseMock.ts`: `queue(table, op, ...)`, `queueRpc(name, ...)`, `calls[]`
  with `payload`/`modifiers`; unqueued select → `{data: []}`, unqueued rpc → `{data: true}`;
  `select()` after `delete()` keeps the `delete` operation.
- `supabase/functions/__tests__/hub-functions_test.ts:1364-1378`: `hubApproveDbForPost()` and
  `hubApproveHandlerFor()` helpers; hub-approve tests live only in this file (plus the name in
  `config-audit_test.ts:47`).
- `supabase/functions/__tests__/config-audit_test.ts`: `REQUIRED_FUNCTIONS` must have
  `verify_jwt = false`; a second test fails if a configured function has no source directory.
- `file-manage/handler.ts:126-128` root/folder listing; `:466` PATCH select; `:537` POST
  `/links` select; `:638` `bulk_move_items`; `apps/crm/src/services/fileService.ts:141-143`
  `getFolderContents` is what `FilePickerModal` (post media + report `ImageBlockEditor`) calls.
- `supabase/migrations/20260425000001_file_system_tables.sql:59`: `files_r2_key_idx` is a
  plain (non-unique) index; `:205-216` `file_enqueue_delete` queues the R2 key on every
  `files` delete.
- `_shared/cors.ts` `buildCorsHeaders` already allows `PATCH` and `DELETE`.
- `package.json:33-34`: `test:functions` / `check:functions` commands (check covers
  `*/index.ts` and `_shared/*.ts`, not `__tests__`).


---

### Task 7: Hub references data layer (types, shared video frame, media prep, service, hook)

**Files:**
- Move: `apps/crm/src/utils/videoFrame.ts` → `packages/ui/video/frame.ts`
- Move: `apps/crm/src/utils/__tests__/videoFrame.test.ts` → `packages/ui/video/__tests__/frame.test.ts`
- Modify: `apps/crm/src/pages/entregas/components/ThumbnailPickerDialog.tsx:13`
- Modify: `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx:40`
- Modify: `apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx:21,70`
- Modify: `apps/hub/src/services/ideiaMedia.ts` (export three helpers, `generateThumbnail` gains `maxEdge`)
- Create: `apps/hub/src/types/postReferences.ts`
- Create: `apps/hub/src/services/referenceMedia.ts`
- Create: `apps/hub/src/services/postReferences.ts`
- Create: `apps/hub/src/hooks/usePostReferences.ts`
- Test: `apps/hub/src/services/__tests__/referenceMedia.test.ts`
- Test: `apps/hub/src/services/__tests__/postReferences.test.ts`
- Test: `apps/hub/src/hooks/__tests__/usePostReferences.test.tsx`

**Interfaces:**

```ts
// apps/hub/src/types/postReferences.ts  (same shapes as _shared/post-references.ts)
export type ReferenceFileKind = 'image' | 'video' | 'document';
export interface ReferenceItem { /* see Step 2 */ }
export type ReferenceErrorCode = 'unsupported_type' | 'too_large' | ... | 'internal';

// apps/hub/src/services/referenceMedia.ts
export const MAX_REFERENCE_THUMB_BYTES = 524288;
export interface ReferenceMedia { thumbnail: File | null; blurDataUrl?: string; width?: number; height?: number; durationSeconds?: number }
export function prepareReferenceMedia(file: File, kind: ReferenceFileKind): Promise<ReferenceMedia>;
export function drawNeutralPoster(play: boolean): Promise<File>;
export function probeVideo(file: File): Promise<{ width?: number; height?: number; duration?: number } | null>;

// apps/hub/src/services/postReferences.ts
export class PostReferenceError extends Error { readonly code: ReferenceErrorCode }
export const REFERENCE_MIME, REFERENCE_ACCEPT, MAX_REFERENCES_PER_POST, MAX_REFERENCE_NOTE,
  MAX_REFERENCE_LINK_TITLE, MAX_REFERENCE_URL;
export function isAbortError(err: unknown): boolean;
export function referenceMime(file: File): string | null;
export function referenceFileKind(file: File): ReferenceFileKind | null;
export function validateReferenceFile(file: File): ReferenceErrorCode | null;
export function normalizeReferenceUrl(raw: string): string | null;
export function fetchPostReferences(token: string, postId: number): Promise<{ can_add: boolean; items: ReferenceItem[] }>;
export function uploadPostReference(token: string, postId: number, file: File, opts?: { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal; note?: string }): Promise<ReferenceItem>;
export function addPostReferenceLink(token: string, postId: number, input: { url: string; title?: string; note?: string }): Promise<ReferenceItem>;
export function updatePostReferenceNote(token: string, id: number, note: string): Promise<ReferenceItem>;
export function removePostReference(token: string, id: number): Promise<void>;

// apps/hub/src/hooks/usePostReferences.ts
export const postReferencesKey: (postId: number) => readonly ['hub-post-references', number];
export interface UploadEntry { localId: string; name: string; fileKind: ReferenceFileKind; loaded: number; total: number; status: 'uploading' | 'error'; error?: ReferenceErrorCode }
export interface AddReferenceLinkInput { url: string; title?: string; note?: string }
export function usePostReferences(token: string, postId: number): {
  data: { can_add: boolean; items: ReferenceItem[] } | undefined;
  isLoading: boolean; canAdd: boolean; items: ReferenceItem[];
  uploads: UploadEntry[]; uploadsInFlight: boolean;
  freshIds: number[];                                   // additive: ids uploaded by this card, note field starts open
  startUploads(files: File[], opts?: { onUploaded?: (item: ReferenceItem) => void }): Promise<ReferenceItem[]>;
  cancelUpload(localId: string): void;                  // aborts an uploading entry, or dismisses an error entry
  retryUpload(localId: string): void;                   // additive: re-runs the whole upload (fresh presign)
  addLink(input: AddReferenceLinkInput): Promise<ReferenceItem>;
  updateNote(id: number, note: string): Promise<void>;
  remove(id: number): Promise<void>;
  refresh(): void;                                      // additive: invalidates the query
};
export type PostReferencesState = ReturnType<typeof usePostReferences>;
```

`startUploads` resolves with the items that finalized successfully (in input order); failed or
cancelled files resolve to nothing and stay in `uploads` as `status: 'error'` (cancelled ones are
removed). Uploads run two at a time. When the hook unmounts it aborts everything in flight.

> Worktree note: the worktree has no `node_modules`; Node resolves up to the main checkout's
> `/Users/eduardosouza/Projects/sm-crm/node_modules`, so `npx vitest`, `npx tsc`, `npx prettier`
> work from the worktree root. Do not run `npm install` inside the worktree.

- [ ] **Step 1: Move the video frame helper to `packages/ui` (no behaviour change)**

The helper has no CRM-only imports (`apps/crm/src/utils/videoFrame.ts:1-97` uses only DOM APIs),
and `@mesaas/ui/*` is already aliased in all three apps and vitest (`apps/hub/tsconfig.json:6`,
`apps/crm/tsconfig.json:7`, `apps/admin/tsconfig.json:7`, `vitest.config.ts:11`).
`packages/ui/audio/validation.ts` is the precedent for a plain util in that package.

```bash
mkdir -p packages/ui/video/__tests__
git mv apps/crm/src/utils/videoFrame.ts packages/ui/video/frame.ts
git mv apps/crm/src/utils/__tests__/videoFrame.test.ts packages/ui/video/__tests__/frame.test.ts
```

Edit `packages/ui/video/frame.ts` line 1:

```ts
// packages/ui/video/frame.ts (shared by the CRM post editor and the Hub's reference posters)
```

Edit `packages/ui/video/__tests__/frame.test.ts` line 3:

```ts
import { captureFrameFromElement, extractVideoFrame } from '../frame';
```

Edit `apps/crm/src/pages/entregas/components/ThumbnailPickerDialog.tsx` line 13:

```ts
import { captureFrameFromElement } from '@mesaas/ui/video/frame';
```

Edit `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx` line 40:

```ts
import { extractVideoFrame } from '@mesaas/ui/video/frame';
```

Edit `apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx` line 21:

```ts
vi.mock('@mesaas/ui/video/frame', () => ({
```

and line 70:

```ts
import { extractVideoFrame } from '@mesaas/ui/video/frame';
```

Run:

```bash
grep -rn "utils/videoFrame" apps packages || echo "no stale imports"
npx vitest run packages/ui/video apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: `no stale imports`; both test files PASS; tsc exits 0 with no output.

- [ ] **Step 2: Hub reference types**

Create `apps/hub/src/types/postReferences.ts`:

```ts
/**
 * Hub copy of the ReferenceItem contract (supabase/functions/_shared/post-references.ts).
 * The Hub cannot import Deno modules, so the shapes are re-declared; keep them in sync.
 * Lives under src/types/ next to src/types.ts: `'../types'` still resolves to types.ts.
 */
export type ReferenceFileKind = 'image' | 'video' | 'document';

export interface ReferenceItem {
  id: number;
  kind: 'file' | 'link';
  file_kind: ReferenceFileKind | null;
  name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  /** Signed GET URL of the file (1h). Null for links. */
  url: string | null;
  thumbnail_url: string | null;
  blur_data_url: string | null;
  /** CRM only; always null in the Hub. */
  download_url: string | null;
  link_url: string | null;
  link_title: string | null;
  link_domain: string | null;
  note: string | null;
  post_approval_id: number | null;
  created_at: string;
  can_remove: boolean;
}

export type ReferenceErrorCode =
  | 'unsupported_type'
  | 'too_large'
  | 'thumbnail_invalid'
  | 'reference_limit'
  | 'quota_exceeded'
  | 'post_not_pending'
  | 'invalid_url'
  | 'invalid_note'
  | 'not_found'
  | 'locked'
  | 'rate_limited'
  | 'upload_mismatch'
  | 'internal';
```

- [ ] **Step 3: Export the ideia image helpers (thumbnail size becomes a parameter)**

In `apps/hub/src/services/ideiaMedia.ts`:

Replace `function probeImage(file: File): Promise<{ width: number; height: number }> {` with:

```ts
export function probeImage(file: File): Promise<{ width: number; height: number }> {
```

Replace the first two lines of `generateThumbnail`:

```ts
function generateThumbnail(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
```

with:

```ts
/** WebP thumbnail whose longest edge is at most `maxEdge` px (never upscaled). */
export function generateThumbnail(file: File, maxEdge: number = THUMB_SIZE): Promise<File> {
  return new Promise((resolve, reject) => {
```

and inside it replace

```ts
      const scale = Math.min(THUMB_SIZE / img.naturalWidth, THUMB_SIZE / img.naturalHeight, 1);
```

with

```ts
      const scale = Math.min(maxEdge / img.naturalWidth, maxEdge / img.naturalHeight, 1);
```

Replace `function generateBlur(file: File): Promise<string> {` with:

```ts
export function generateBlur(file: File): Promise<string> {
```

`uploadIdeiaImageUnguarded` keeps calling `generateThumbnail(file)` (default 256 px), so ideia
uploads are unchanged.

Run: `npx vitest run apps/hub/src/services/__tests__/ideiaMedia.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Write the failing media-prep test**

Create `apps/hub/src/services/__tests__/referenceMedia.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const frameMock = vi.hoisted(() => ({ extractVideoFrame: vi.fn() }));
const ideiaMock = vi.hoisted(() => ({
  probeImage: vi.fn(),
  generateThumbnail: vi.fn(),
  generateBlur: vi.fn(),
}));
vi.mock('@mesaas/ui/video/frame', () => frameMock);
vi.mock('../ideiaMedia', () => ideiaMock);

import {
  MAX_REFERENCE_THUMB_BYTES,
  drawNeutralPoster,
  prepareReferenceMedia,
} from '../referenceMedia';

function sizedFile(name: string, type: string, size: number): File {
  const f = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

/** Detached <video> that reports metadata as soon as it gets a src. */
class MockVideo {
  preload = '';
  muted = false;
  playsInline = false;
  videoWidth = 1080;
  videoHeight = 1920;
  duration = 12.4;
  onloadedmetadata: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onloadedmetadata?.());
  }
  removeAttribute() {}
  load() {}
}

const drawCalls: string[] = [];

/** jsdom has no canvas: a 2D context that records every drawing call. */
function fakeCanvas() {
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_target, prop) => () => {
      drawCalls.push(String(prop));
    },
    set: () => true,
  });
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob: (cb: (blob: Blob | null) => void, type: string) => cb(new Blob(['poster'], { type })),
  };
}

const urlStatics = URL as unknown as Record<string, unknown>;

describe('prepareReferenceMedia', () => {
  beforeEach(() => {
    drawCalls.length = 0;
    frameMock.extractVideoFrame.mockReset();
    ideiaMock.probeImage.mockReset();
    ideiaMock.generateThumbnail.mockReset();
    ideiaMock.generateBlur.mockReset();
    urlStatics.createObjectURL = vi.fn(() => 'blob:local');
    urlStatics.revokeObjectURL = vi.fn();
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'video') return new MockVideo() as unknown as HTMLElement;
      if (tag === 'canvas') return fakeCanvas() as unknown as HTMLElement;
      return realCreate(tag);
    }) as typeof document.createElement);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete urlStatics.createObjectURL;
    delete urlStatics.revokeObjectURL;
  });

  it('returns no thumbnail for a PDF', async () => {
    const media = await prepareReferenceMedia(sizedFile('a.pdf', 'application/pdf', 10), 'document');
    expect(media).toEqual({ thumbnail: null });
    expect(ideiaMock.generateThumbnail).not.toHaveBeenCalled();
  });

  it('builds an image thumbnail at 480px with blur and dimensions', async () => {
    const thumb = sizedFile('thumb.webp', 'image/webp', 40_000);
    ideiaMock.generateThumbnail.mockResolvedValue(thumb);
    ideiaMock.generateBlur.mockResolvedValue('data:image/webp;base64,AAA');
    ideiaMock.probeImage.mockResolvedValue({ width: 1080, height: 1350 });
    const file = sizedFile('foto.jpg', 'image/jpeg', 2_000_000);

    const media = await prepareReferenceMedia(file, 'image');

    expect(ideiaMock.generateThumbnail).toHaveBeenCalledWith(file, 480);
    expect(media).toEqual({
      thumbnail: thumb,
      blurDataUrl: 'data:image/webp;base64,AAA',
      width: 1080,
      height: 1350,
    });
  });

  it('shrinks the thumbnail until it fits the 512 KB cap', async () => {
    ideiaMock.generateThumbnail
      .mockResolvedValueOnce(sizedFile('t.webp', 'image/webp', MAX_REFERENCE_THUMB_BYTES + 1))
      .mockResolvedValueOnce(sizedFile('t.webp', 'image/webp', 100_000));
    ideiaMock.generateBlur.mockResolvedValue(undefined);
    ideiaMock.probeImage.mockResolvedValue({ width: 4000, height: 3000 });

    const media = await prepareReferenceMedia(sizedFile('big.png', 'image/png', 9_000_000), 'image');

    expect(ideiaMock.generateThumbnail.mock.calls.map((call) => call[1])).toEqual([480, 320]);
    expect(media.thumbnail?.size).toBe(100_000);
  });

  it('uses the first video frame as the poster, with duration and size from the metadata', async () => {
    const frame = sizedFile('thumb.jpg', 'image/jpeg', 300_000);
    const thumb = sizedFile('thumb.webp', 'image/webp', 30_000);
    frameMock.extractVideoFrame.mockResolvedValue(frame);
    ideiaMock.generateThumbnail.mockResolvedValue(thumb);
    ideiaMock.generateBlur.mockResolvedValue('data:blur');

    const media = await prepareReferenceMedia(sizedFile('clip.mp4', 'video/mp4', 50_000_000), 'video');

    expect(ideiaMock.generateThumbnail).toHaveBeenCalledWith(frame, 480);
    expect(media).toEqual({
      thumbnail: thumb,
      blurDataUrl: 'data:blur',
      width: 1080,
      height: 1920,
      durationSeconds: 12,
    });
  });

  it('draws a neutral poster with a play glyph when no frame can be decoded (HEVC in Chrome)', async () => {
    frameMock.extractVideoFrame.mockRejectedValue(new Error('decode'));

    const media = await prepareReferenceMedia(
      sizedFile('clip.mov', 'video/quicktime', 5_000_000),
      'video',
    );

    expect(media.thumbnail).toBeInstanceOf(File);
    expect(media.thumbnail?.type).toBe('image/webp');
    expect(drawCalls).toContain('arc');
    expect(ideiaMock.generateThumbnail).not.toHaveBeenCalled();
    expect(media.durationSeconds).toBe(12);
  });

  it('draws a plain neutral tile when asked for no play glyph', async () => {
    const poster = await drawNeutralPoster(false);
    expect(poster.name).toBe('thumb.webp');
    expect(drawCalls).toEqual(['fillRect']);
  });
});
```

Run: `npx vitest run apps/hub/src/services/__tests__/referenceMedia.test.ts`
Expected: FAIL, `Failed to resolve import "../referenceMedia"`.

- [ ] **Step 5: Implement media prep**

Create `apps/hub/src/services/referenceMedia.ts`:

```ts
import { extractVideoFrame } from '@mesaas/ui/video/frame';
import type { ReferenceFileKind } from '../types/postReferences';
import { generateBlur, generateThumbnail, probeImage } from './ideiaMedia';

/** hub-post-references /upload-url rejects a thumbnail above this. */
export const MAX_REFERENCE_THUMB_BYTES = 512 * 1024;
/**
 * Largest edge first. Smaller edges only when an encode lands over the cap: Safari has no WebP
 * encoder and writes PNG for `toBlob('image/webp')`, which is several times larger.
 */
const THUMB_EDGES = [480, 320, 200] as const;
const VIDEO_PROBE_TIMEOUT_MS = 10_000;
const POSTER_W = 480;
const POSTER_H = 270;

export interface ReferenceMedia {
  /** WebP poster/thumbnail; null for PDFs (the server forbids one there). */
  thumbnail: File | null;
  blurDataUrl?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
}

async function webpThumbUnderCap(source: File): Promise<File> {
  for (const edge of THUMB_EDGES) {
    const thumb = await generateThumbnail(source, edge);
    if (thumb.size <= MAX_REFERENCE_THUMB_BYTES) return thumb;
  }
  throw new Error('thumbnail over cap');
}

/**
 * A neutral 16:9 tile, with a play glyph for videos. Used when the browser cannot decode a
 * frame (HEVC .mov in Chrome) or an image, so the `files_video_requires_thumbnail` CHECK and
 * the server's "thumbnail required for image/video" rule still hold.
 */
export function drawNeutralPoster(play: boolean): Promise<File> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = POSTER_W;
    canvas.height = POSTER_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('canvas unavailable'));
      return;
    }
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(0, 0, POSTER_W, POSTER_H);
    if (play) {
      const cx = POSTER_W / 2;
      const cy = POSTER_H / 2;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(cx, cy, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2b2b2b';
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy - 18);
      ctx.lineTo(cx + 18, cy);
      ctx.lineTo(cx - 10, cy + 18);
      ctx.closePath();
      ctx.fill();
    }
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(new File([blob], 'thumb.webp', { type: 'image/webp' }))
          : reject(new Error('poster failed')),
      'image/webp',
      0.8,
    );
  });
}

/** Width, height and duration from the container metadata; null when the browser can't read it. */
export function probeVideo(
  file: File,
): Promise<{ width?: number; height?: number; duration?: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    let done = false;
    const finish = (value: { width?: number; height?: number; duration?: number } | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), VIDEO_PROBE_TIMEOUT_MS);
    video.onloadedmetadata = () =>
      finish({
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
        duration:
          Number.isFinite(video.duration) && video.duration > 0
            ? Math.round(video.duration)
            : undefined,
      });
    video.onerror = () => finish(null);
    video.src = url;
  });
}

/** Everything the finalize call needs besides the file itself, computed in the browser. */
export async function prepareReferenceMedia(
  file: File,
  kind: ReferenceFileKind,
): Promise<ReferenceMedia> {
  if (kind === 'document') return { thumbnail: null };

  if (kind === 'image') {
    const [dims, thumbnail, blur] = await Promise.all([
      probeImage(file).catch(() => null),
      webpThumbUnderCap(file).catch(() => drawNeutralPoster(false)),
      generateBlur(file).catch(() => undefined),
    ]);
    return { thumbnail, blurDataUrl: blur, width: dims?.width, height: dims?.height };
  }

  const [meta, frame] = await Promise.all([
    probeVideo(file),
    extractVideoFrame(file).catch(() => null),
  ]);
  let thumbnail: File;
  let blur: string | undefined;
  if (frame) {
    thumbnail = await webpThumbUnderCap(frame).catch(() => drawNeutralPoster(true));
    blur = await generateBlur(frame).catch(() => undefined);
  } else {
    thumbnail = await drawNeutralPoster(true);
  }
  return {
    thumbnail,
    blurDataUrl: blur,
    width: meta?.width,
    height: meta?.height,
    durationSeconds: meta?.duration,
  };
}
```

Run: `npx vitest run apps/hub/src/services/__tests__/referenceMedia.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Write the failing service test**

Create `apps/hub/src/services/__tests__/postReferences.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFetchMock } from '../../../../../test/shared/fetchMock';
import {
  hasUnsavedWork,
  resetUnsavedWorkForTests,
} from '../../../../../packages/app-lifecycle/src/unsaved-work';

const mediaMock = vi.hoisted(() => ({ prepareReferenceMedia: vi.fn() }));
vi.mock('../referenceMedia', () => mediaMock);

import {
  PostReferenceError,
  addPostReferenceLink,
  fetchPostReferences,
  isAbortError,
  normalizeReferenceUrl,
  removePostReference,
  updatePostReferenceNote,
  uploadPostReference,
  validateReferenceFile,
} from '../postReferences';

const fetchHarness = createFetchMock();

class FakeXHR {
  static all: FakeXHR[] = [];
  method = '';
  url = '';
  headers: Record<string, string> = {};
  status = 200;
  body: unknown;
  upload: {
    onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
  } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = false;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
    FakeXHR.all.push(this);
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  respond(status = 200) {
    this.status = status;
    this.onload?.();
  }
}

function sizedFile(name: string, type: string, size: number): File {
  const f = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

const ITEM = {
  id: 9,
  kind: 'file',
  file_kind: 'image',
  name: 'foto.jpg',
  mime_type: 'image/jpeg',
  size_bytes: 1000,
  duration_seconds: null,
  width: 10,
  height: 10,
  url: 'https://r2/get',
  thumbnail_url: 'https://r2/thumb',
  blur_data_url: null,
  download_url: null,
  link_url: null,
  link_title: null,
  link_domain: null,
  note: null,
  post_approval_id: null,
  created_at: '2026-10-08T12:00:00.000Z',
  can_remove: true,
};

function bodyOf(call: number) {
  return JSON.parse(String(fetchHarness.calls[call].init?.body));
}

describe('postReferences service', () => {
  beforeEach(() => {
    fetchHarness.reset();
    vi.stubGlobal('fetch', fetchHarness.fetchMock);
    FakeXHR.all = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    mediaMock.prepareReferenceMedia.mockReset();
    resetUnsavedWorkForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists a post\'s references with the token and post id', async () => {
    fetchHarness.queueResponse({ json: { can_add: true, items: [ITEM] } });
    const res = await fetchPostReferences('tok', 42);
    expect(res).toEqual({ can_add: true, items: [ITEM] });
    const url = new URL(String(fetchHarness.calls[0].input));
    expect(url.pathname).toBe('/functions/v1/hub-post-references');
    expect(url.searchParams.get('token')).toBe('tok');
    expect(url.searchParams.get('post_id')).toBe('42');
    expect((fetchHarness.calls[0].init?.headers as Record<string, string>).apikey).toBe(
      'anon-key-for-tests',
    );
  });

  it('maps a known server error code and falls back to internal for anything else', async () => {
    fetchHarness.queueResponse({ ok: false, status: 409, json: { error: 'post_not_pending' } });
    await expect(fetchPostReferences('tok', 1)).rejects.toMatchObject({ code: 'post_not_pending' });
    fetchHarness.queueResponse({ ok: false, status: 500, json: { error: 'duplicate key value' } });
    await expect(fetchPostReferences('tok', 1)).rejects.toMatchObject({ code: 'internal' });
    fetchHarness.queueResponse({ ok: false, status: 429, json: { error: 'rate_limited' } });
    await expect(fetchPostReferences('tok', 1)).rejects.toMatchObject({ code: 'rate_limited' });
    // Token failures are Portuguese strings, not codes.
    fetchHarness.queueResponse({ ok: false, status: 404, json: { error: 'Link inválido.' } });
    await expect(fetchPostReferences('tok', 1)).rejects.toMatchObject({ code: 'internal' });
  });

  it('validates type and size on the client', () => {
    expect(validateReferenceFile(sizedFile('a.svg', 'image/svg+xml', 10))).toBe('unsupported_type');
    expect(validateReferenceFile(sizedFile('a.jpg', 'image/jpeg', 25 * 1024 * 1024 + 1))).toBe(
      'too_large',
    );
    expect(validateReferenceFile(sizedFile('a.pdf', 'application/pdf', 1000))).toBeNull();
    expect(validateReferenceFile(sizedFile('v.mp4', 'video/mp4', 200 * 1024 * 1024))).toBeNull();
    expect(validateReferenceFile(sizedFile('v.mp4', 'video/mp4', 200 * 1024 * 1024 + 1))).toBe(
      'too_large',
    );
    // An empty File.type (some Android pickers) falls back to the extension.
    expect(validateReferenceFile(sizedFile('clip.MOV', '', 1000))).toBeNull();
  });

  it('presigns, PUTs file and thumbnail with progress, then finalizes', async () => {
    const thumb = sizedFile('thumb.webp', 'image/webp', 4000);
    mediaMock.prepareReferenceMedia.mockResolvedValue({
      thumbnail: thumb,
      blurDataUrl: 'data:blur',
      width: 1080,
      height: 1350,
    });
    fetchHarness.queueResponse({
      json: {
        upload_url: 'https://r2/put-file',
        r2_key: 'contas/c/files/u.jpg',
        thumbnail_upload_url: 'https://r2/put-thumb',
        thumbnail_r2_key: 'contas/c/files/u.thumb.webp',
      },
    });
    fetchHarness.queueResponse({ status: 201, json: { item: ITEM } });
    const progress: Array<[number, number]> = [];
    const file = sizedFile('foto.jpg', 'image/jpeg', 1000);

    const pending = uploadPostReference('tok', 42, file, {
      note: '  trocar a foto  ',
      onProgress: (loaded, total) => progress.push([loaded, total]),
    });
    await vi.waitFor(() => expect(FakeXHR.all).toHaveLength(2));
    expect(hasUnsavedWork()).toBe(true);

    expect(bodyOf(0)).toEqual({
      token: 'tok',
      post_id: 42,
      filename: 'foto.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 1000,
      thumbnail: { mime_type: 'image/webp', size_bytes: 4000 },
    });
    const [filePut, thumbPut] = FakeXHR.all;
    expect(filePut.url).toBe('https://r2/put-file');
    expect(filePut.headers['Content-Type']).toBe('image/jpeg');
    expect(thumbPut.url).toBe('https://r2/put-thumb');
    expect(thumbPut.headers['Content-Type']).toBe('image/webp');

    filePut.upload.onprogress?.({ lengthComputable: true, loaded: 500, total: 1000 });
    filePut.respond();
    thumbPut.respond();

    await expect(pending).resolves.toEqual(ITEM);
    expect(progress).toEqual([
      [0, 1000],
      [500, 1000],
    ]);
    expect(String(fetchHarness.calls[1].input)).toContain('/hub-post-references/files');
    expect(bodyOf(1)).toEqual({
      token: 'tok',
      post_id: 42,
      r2_key: 'contas/c/files/u.jpg',
      thumbnail_r2_key: 'contas/c/files/u.thumb.webp',
      thumbnail_bytes: 4000,
      mime_type: 'image/jpeg',
      size_bytes: 1000,
      name: 'foto.jpg',
      width: 1080,
      height: 1350,
      duration_seconds: null,
      blur_data_url: 'data:blur',
      note: 'trocar a foto',
    });
    expect(hasUnsavedWork()).toBe(false);
  });

  it('sends a PDF with no thumbnail and a single PUT', async () => {
    mediaMock.prepareReferenceMedia.mockResolvedValue({ thumbnail: null });
    fetchHarness.queueResponse({
      json: {
        upload_url: 'https://r2/put-file',
        r2_key: 'contas/c/files/u.pdf',
        thumbnail_upload_url: null,
        thumbnail_r2_key: null,
      },
    });
    fetchHarness.queueResponse({ json: { item: { ...ITEM, file_kind: 'document' } } });
    const pending = uploadPostReference('tok', 42, sizedFile('a.pdf', 'application/pdf', 900), {});
    await vi.waitFor(() => expect(FakeXHR.all).toHaveLength(1));
    expect(bodyOf(0)).not.toHaveProperty('thumbnail');
    FakeXHR.all[0].respond();
    await pending;
    expect(bodyOf(1)).not.toHaveProperty('thumbnail_r2_key');
    expect(bodyOf(1)).not.toHaveProperty('thumbnail_bytes');
    expect(bodyOf(1)).toMatchObject({
      width: null,
      height: null,
      duration_seconds: null,
      blur_data_url: null,
      note: null,
    });
  });

  it('rejects an invalid file before any request', async () => {
    await expect(
      uploadPostReference('tok', 1, sizedFile('a.svg', 'image/svg+xml', 10), {}),
    ).rejects.toMatchObject({ code: 'unsupported_type' });
    expect(fetchHarness.calls).toHaveLength(0);
  });

  it('aborts the PUTs and never finalizes when the signal fires', async () => {
    mediaMock.prepareReferenceMedia.mockResolvedValue({ thumbnail: null });
    fetchHarness.queueResponse({
      json: { upload_url: 'https://r2/put', r2_key: 'k', thumbnail_upload_url: null, thumbnail_r2_key: null },
    });
    const controller = new AbortController();
    const pending = uploadPostReference('tok', 1, sizedFile('a.pdf', 'application/pdf', 9), {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(FakeXHR.all).toHaveLength(1));
    controller.abort();
    const err = await pending.catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
    expect(FakeXHR.all[0].aborted).toBe(true);
    expect(fetchHarness.calls).toHaveLength(1);
  });

  it('turns a failed PUT into an internal error', async () => {
    mediaMock.prepareReferenceMedia.mockResolvedValue({ thumbnail: null });
    fetchHarness.queueResponse({
      json: { upload_url: 'https://r2/put', r2_key: 'k', thumbnail_upload_url: null, thumbnail_r2_key: null },
    });
    const pending = uploadPostReference('tok', 1, sizedFile('a.pdf', 'application/pdf', 9), {});
    await vi.waitFor(() => expect(FakeXHR.all).toHaveLength(1));
    FakeXHR.all[0].respond(403);
    await expect(pending).rejects.toBeInstanceOf(PostReferenceError);
    await expect(pending).rejects.toMatchObject({ code: 'internal' });
  });

  it('normalizes link URLs like the server', () => {
    expect(normalizeReferenceUrl('  exemplo.com/post ')).toBe('https://exemplo.com/post');
    expect(normalizeReferenceUrl('http://exemplo.com')).toBe('http://exemplo.com/');
    expect(normalizeReferenceUrl('exemplo.com:8080/x')).toBe('https://exemplo.com:8080/x');
    expect(normalizeReferenceUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeReferenceUrl('https://user:pw@exemplo.com')).toBeNull();
    expect(normalizeReferenceUrl('https://exem plo.com')).toBeNull();
    expect(normalizeReferenceUrl('')).toBeNull();
    expect(normalizeReferenceUrl(`https://exemplo.com/${'a'.repeat(2048)}`)).toBeNull();
  });

  it('adds a link with the normalized URL and trimmed title and note', async () => {
    fetchHarness.queueResponse({ status: 201, json: { item: { ...ITEM, kind: 'link' } } });
    await addPostReferenceLink('tok', 42, {
      url: 'exemplo.com/post',
      title: '  Referência ',
      note: '',
    });
    expect(String(fetchHarness.calls[0].input)).toContain('/hub-post-references/links');
    expect(bodyOf(0)).toEqual({
      token: 'tok',
      post_id: 42,
      url: 'https://exemplo.com/post',
      title: 'Referência',
    });
  });

  it('rejects an invalid link without calling the server', async () => {
    await expect(addPostReferenceLink('tok', 1, { url: 'ftp://x.com' })).rejects.toMatchObject({
      code: 'invalid_url',
    });
    expect(fetchHarness.calls).toHaveLength(0);
  });

  it('patches a note and deletes a reference by id', async () => {
    fetchHarness.queueResponse({ json: { item: { ...ITEM, note: 'nova' } } });
    const item = await updatePostReferenceNote('tok', 9, ' nova ');
    expect(item.note).toBe('nova');
    expect(fetchHarness.calls[0].init?.method).toBe('PATCH');
    expect(String(fetchHarness.calls[0].input)).toContain('/hub-post-references/9');
    expect(bodyOf(0)).toEqual({ token: 'tok', note: 'nova' });

    fetchHarness.queueResponse({ json: { ok: true } });
    await removePostReference('tok', 9);
    const url = new URL(String(fetchHarness.calls[1].input));
    expect(url.pathname).toBe('/functions/v1/hub-post-references/9');
    expect(url.searchParams.get('token')).toBe('tok');
    expect(fetchHarness.calls[1].init?.method).toBe('DELETE');
  });

  it('maps a locked delete to PostReferenceError("locked")', async () => {
    fetchHarness.queueResponse({ ok: false, status: 409, json: { error: 'locked' } });
    await expect(removePostReference('tok', 9)).rejects.toMatchObject({ code: 'locked' });
  });
});
```

Run: `npx vitest run apps/hub/src/services/__tests__/postReferences.test.ts`
Expected: FAIL, `Failed to resolve import "../postReferences"`.

- [ ] **Step 7: Implement the service**

All HTTP for references lives here, not in `api.ts`: `api.ts`'s `request/get/post/patch/del`
helpers are module-private (`api.ts:73-100,230-244`), and every Hub page test replaces `../../api`
with a fixed factory, so new exports there would be missing from those mocks.

Create `apps/hub/src/services/postReferences.ts`:

```ts
import { trackUnsavedWork } from '@mesaas/app-lifecycle';
import type {
  ReferenceErrorCode,
  ReferenceFileKind,
  ReferenceItem,
} from '../types/postReferences';
import { prepareReferenceMedia, type ReferenceMedia } from './referenceMedia';

const BASE = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const FN = 'hub-post-references';
const MB = 1024 * 1024;

/** Mirrors REFERENCE_MIME in supabase/functions/_shared/post-references.ts (the server decides). */
export const REFERENCE_MIME: Readonly<
  Record<string, { kind: ReferenceFileKind; maxBytes: number }>
> = {
  'image/jpeg': { kind: 'image', maxBytes: 25 * MB },
  'image/png': { kind: 'image', maxBytes: 25 * MB },
  'image/webp': { kind: 'image', maxBytes: 25 * MB },
  'image/gif': { kind: 'image', maxBytes: 25 * MB },
  'application/pdf': { kind: 'document', maxBytes: 25 * MB },
  'video/mp4': { kind: 'video', maxBytes: 200 * MB },
  'video/quicktime': { kind: 'video', maxBytes: 200 * MB },
  'video/webm': { kind: 'video', maxBytes: 200 * MB },
};

/** Some Android pickers hand over an empty File.type: fall back to the extension. */
const EXTENSION_MIME: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

export const REFERENCE_ACCEPT = Object.keys(REFERENCE_MIME).join(',');
export const MAX_REFERENCES_PER_POST = 10;
export const MAX_REFERENCE_NOTE = 500;
export const MAX_REFERENCE_LINK_TITLE = 120;
export const MAX_REFERENCE_URL = 2048;
/** 200 MB at 1 Mbps is about 27 minutes: past trackUnsavedWork's 30-minute default ceiling. */
const VIDEO_UPLOAD_HOLD_MS = 60 * 60_000;

const ERROR_CODES: ReadonlySet<string> = new Set<ReferenceErrorCode>([
  'unsupported_type',
  'too_large',
  'thumbnail_invalid',
  'reference_limit',
  'quota_exceeded',
  'post_not_pending',
  'invalid_url',
  'invalid_note',
  'not_found',
  'locked',
  'rate_limited',
  'upload_mismatch',
  'internal',
]);

export class PostReferenceError extends Error {
  readonly code: ReferenceErrorCode;
  constructor(code: ReferenceErrorCode) {
    super(code);
    this.name = 'PostReferenceError';
    this.code = code;
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
  );
}

function abortError(): DOMException {
  return new DOMException('Upload cancelled', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

/** The MIME the server will see for this file, or null when it is not an accepted type. */
export function referenceMime(file: File): string | null {
  if (file.type) return REFERENCE_MIME[file.type] ? file.type : null;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MIME[ext] ?? null;
}

export function referenceFileKind(file: File): ReferenceFileKind | null {
  const mime = referenceMime(file);
  return mime ? REFERENCE_MIME[mime].kind : null;
}

/** Client-side mirror of the server's type and size checks. */
export function validateReferenceFile(file: File): ReferenceErrorCode | null {
  const mime = referenceMime(file);
  if (!mime || file.size <= 0) return 'unsupported_type';
  return file.size > REFERENCE_MIME[mime].maxBytes ? 'too_large' : null;
}

function hasControlOrSpace(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f || /\s/u.test(ch)) return true;
  }
  return false;
}

/**
 * Same policy as hub-post-references POST /links (the server is authoritative): trim, add
 * https:// when there is no scheme, no whitespace or control characters, absolute http(s) URL,
 * no credentials, non-empty host, at most 2048 characters.
 */
export function normalizeReferenceUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || hasControlOrSpace(trimmed)) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (candidate.length > MAX_REFERENCE_URL) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || !url.hostname) return null;
  // Same value the server stores (url.href), so the preview matches the saved link.
  return url.href;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** One request to hub-post-references. Errors are always PostReferenceError (or an AbortError). */
async function call<T>(
  method: Method,
  path: string,
  opts: { query?: Record<string, string>; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const url = new URL(`${BASE}/functions/v1/${FN}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      headers:
        opts.body === undefined
          ? { apikey: ANON }
          : { 'Content-Type': 'application/json', apikey: ANON },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new PostReferenceError('internal');
  }
  if (res.ok) return (await res.json()) as T;
  if (res.status === 429) throw new PostReferenceError('rate_limited');
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  const code =
    typeof body.error === 'string' && ERROR_CODES.has(body.error)
      ? (body.error as ReferenceErrorCode)
      : 'internal';
  throw new PostReferenceError(code);
}

export function fetchPostReferences(
  token: string,
  postId: number,
): Promise<{ can_add: boolean; items: ReferenceItem[] }> {
  return call('GET', '', { query: { token, post_id: String(postId) } });
}

/** XHR PUT straight to R2 with upload progress and abort. */
function putWithProgress(
  url: string,
  body: Blob,
  contentType: string,
  opts: { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const { onProgress, signal } = opts;
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const settle = (fn: () => void) => {
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
    }
    xhr.onload = () =>
      settle(() =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new PostReferenceError('internal')),
      );
    xhr.onerror = () => settle(() => reject(new PostReferenceError('internal')));
    xhr.onabort = () => settle(() => reject(abortError()));
    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.send(body);
  });
}

interface PresignResponse {
  upload_url: string;
  r2_key: string;
  thumbnail_upload_url: string | null;
  thumbnail_r2_key: string | null;
}

interface UploadOptions {
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
  note?: string;
}

/**
 * Validate, build the poster/thumbnail, presign, PUT (with progress, abortable), finalize.
 * Every call presigns afresh, so a retry after a failed PUT never reuses an expired URL.
 * The promise holds the unsaved-work registry: a silent version swap must not cut an upload.
 */
export function uploadPostReference(
  token: string,
  postId: number,
  file: File,
  opts: UploadOptions = {},
): Promise<ReferenceItem> {
  const isVideo = referenceFileKind(file) === 'video';
  return trackUnsavedWork(
    uploadUnguarded(token, postId, file, opts),
    isVideo ? VIDEO_UPLOAD_HOLD_MS : undefined,
  );
}

async function uploadUnguarded(
  token: string,
  postId: number,
  file: File,
  { onProgress, signal, note }: UploadOptions,
): Promise<ReferenceItem> {
  const invalid = validateReferenceFile(file);
  if (invalid) throw new PostReferenceError(invalid);
  const mime = referenceMime(file) as string;
  const kind = REFERENCE_MIME[mime].kind;
  throwIfAborted(signal);

  let media: ReferenceMedia;
  try {
    media = await prepareReferenceMedia(file, kind);
  } catch {
    throw new PostReferenceError('internal');
  }
  throwIfAborted(signal);

  const thumb = media.thumbnail;
  const signed = await call<PresignResponse>('POST', '/upload-url', {
    body: {
      token,
      post_id: postId,
      filename: file.name,
      mime_type: mime,
      size_bytes: file.size,
      ...(thumb ? { thumbnail: { mime_type: 'image/webp', size_bytes: thumb.size } } : {}),
    },
    signal,
  });
  if (thumb && (!signed.thumbnail_upload_url || !signed.thumbnail_r2_key)) {
    throw new PostReferenceError('internal');
  }

  onProgress?.(0, file.size);
  await Promise.all([
    putWithProgress(signed.upload_url, file, mime, { onProgress, signal }),
    thumb && signed.thumbnail_upload_url
      ? putWithProgress(signed.thumbnail_upload_url, thumb, 'image/webp', { signal })
      : Promise.resolve(),
  ]);
  throwIfAborted(signal);

  // R2 keys go back exactly as /upload-url returned them (the server checks their shape). PDFs
  // send no thumbnail fields at all: any value there, even 0, is 400 thumbnail_invalid.
  // Finalize answers 201 {item}; `call` checks res.ok, never a literal 200.
  // Finalize is not abortable: once the objects are in R2, a half-sent finalize could still
  // create the row, so a cancel from here on lets it finish (the hook keeps the item).
  const trimmedNote = note?.trim();
  const { item } = await call<{ item: ReferenceItem }>('POST', '/files', {
    body: {
      token,
      post_id: postId,
      r2_key: signed.r2_key,
      ...(thumb && signed.thumbnail_r2_key
        ? { thumbnail_r2_key: signed.thumbnail_r2_key, thumbnail_bytes: thumb.size }
        : {}),
      mime_type: mime,
      size_bytes: file.size,
      name: file.name,
      // The server takes JSON null for every absent optional field.
      width: media.width ?? null,
      height: media.height ?? null,
      duration_seconds: media.durationSeconds ?? null,
      blur_data_url: media.blurDataUrl ?? null,
      note: trimmedNote || null,
    },
  });
  return item;
}

export function addPostReferenceLink(
  token: string,
  postId: number,
  input: { url: string; title?: string; note?: string },
): Promise<ReferenceItem> {
  const url = normalizeReferenceUrl(input.url);
  if (!url) return Promise.reject(new PostReferenceError('invalid_url'));
  const title = input.title?.trim().slice(0, MAX_REFERENCE_LINK_TITLE);
  const note = input.note?.trim();
  if (note && note.length > MAX_REFERENCE_NOTE) {
    return Promise.reject(new PostReferenceError('invalid_note'));
  }
  return trackUnsavedWork(
    call<{ item: ReferenceItem }>('POST', '/links', {
      body: {
        token,
        post_id: postId,
        url,
        ...(title ? { title } : {}),
        ...(note ? { note } : {}),
      },
    }).then((r) => r.item),
  );
}

/** An empty note clears it (the server stores NULL). */
export function updatePostReferenceNote(
  token: string,
  id: number,
  note: string,
): Promise<ReferenceItem> {
  const trimmed = note.trim();
  if (trimmed.length > MAX_REFERENCE_NOTE) {
    return Promise.reject(new PostReferenceError('invalid_note'));
  }
  return trackUnsavedWork(
    call<{ item: ReferenceItem }>('PATCH', `/${id}`, { body: { token, note: trimmed } }).then(
      (r) => r.item,
    ),
  );
}

export async function removePostReference(token: string, id: number): Promise<void> {
  await trackUnsavedWork(call<{ ok: true }>('DELETE', `/${id}`, { query: { token } }));
}
```

Run: `npx vitest run apps/hub/src/services/__tests__/postReferences.test.ts`
Expected: PASS (13 tests).

Server facts this follows (from the hub-post-references task): `/files` and `/links` answer 201
(`res.ok`); token errors are Portuguese strings (`"token required"`, `"Link inválido."`) and map to
`internal`; every other error body is a `ReferenceErrorCode`; PDFs carry no thumbnail fields.

- [ ] **Step 8: Write the failing hook test**

Create `apps/hub/src/hooks/__tests__/usePostReferences.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReferenceItem } from '../../types/postReferences';

const svc = vi.hoisted(() => ({
  fetchPostReferences: vi.fn(),
  uploadPostReference: vi.fn(),
  addPostReferenceLink: vi.fn(),
  updatePostReferenceNote: vi.fn(),
  removePostReference: vi.fn(),
}));
vi.mock('../../services/postReferences', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/postReferences')>()),
  ...svc,
}));

import { PostReferenceError } from '../../services/postReferences';
import { postReferencesKey, usePostReferences } from '../usePostReferences';

function item(id: number, over: Partial<ReferenceItem> = {}): ReferenceItem {
  return {
    id,
    kind: 'file',
    file_kind: 'image',
    name: `f${id}.jpg`,
    mime_type: 'image/jpeg',
    size_bytes: 1000,
    duration_seconds: null,
    width: null,
    height: null,
    url: 'https://r2/get',
    thumbnail_url: null,
    blur_data_url: null,
    download_url: null,
    link_url: null,
    link_title: null,
    link_domain: null,
    note: null,
    post_approval_id: null,
    created_at: '2026-10-08T12:00:00.000Z',
    can_remove: true,
    ...over,
  };
}

function file(name: string, type = 'image/jpeg', size = 1000): File {
  const f = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(initial: { can_add: boolean; items: ReferenceItem[] }) {
  svc.fetchPostReferences.mockResolvedValue(initial);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, ...renderHook(() => usePostReferences('tok', 5), { wrapper }) };
}

describe('usePostReferences', () => {
  beforeEach(() => {
    Object.values(svc).forEach((fn) => fn.mockReset());
  });

  it('loads the list under the hub-post-references key', async () => {
    const { result, qc } = setup({ can_add: true, items: [item(1)] });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.canAdd).toBe(true);
    expect(svc.fetchPostReferences).toHaveBeenCalledWith('tok', 5);
    expect(qc.getQueryData(postReferencesKey(5))).toEqual({ can_add: true, items: [item(1)] });
    expect(postReferencesKey(5)).toEqual(['hub-post-references', 5]);
  });

  it('runs at most two uploads at once and appends each finished item', async () => {
    const { result } = setup({ can_add: true, items: [] });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const pending = [deferred<ReferenceItem>(), deferred<ReferenceItem>(), deferred<ReferenceItem>()];
    let n = 0;
    svc.uploadPostReference.mockImplementation(() => pending[n++].promise);

    let all!: Promise<ReferenceItem[]>;
    act(() => {
      all = result.current.startUploads([file('a.jpg'), file('b.jpg'), file('c.jpg')]);
    });
    expect(result.current.uploads.map((u) => u.status)).toEqual([
      'uploading',
      'uploading',
      'uploading',
    ]);
    expect(result.current.uploadsInFlight).toBe(true);
    expect(svc.uploadPostReference).toHaveBeenCalledTimes(2);

    await act(async () => pending[0].resolve(item(10)));
    await waitFor(() => expect(svc.uploadPostReference).toHaveBeenCalledTimes(3));
    await act(async () => {
      pending[1].resolve(item(11));
      pending[2].resolve(item(12));
    });

    await expect(all).resolves.toEqual([item(10), item(11), item(12)]);
    // TanStack notifies observers on a timer: wait for the cache write to reach the hook.
    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual([10, 11, 12]));
    expect(result.current.uploads).toEqual([]);
    expect(result.current.uploadsInFlight).toBe(false);
    expect(result.current.freshIds).toEqual([10, 11, 12]);
  });

  it('reports progress on the entry', async () => {
    const { result } = setup({ can_add: true, items: [] });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const d = deferred<ReferenceItem>();
    let progress!: (loaded: number, total: number) => void;
    svc.uploadPostReference.mockImplementation(
      (_t: string, _p: number, _f: File, opts: { onProgress: typeof progress }) => {
        progress = opts.onProgress;
        return d.promise;
      },
    );
    act(() => {
      void result.current.startUploads([file('a.mp4', 'video/mp4', 4000)]);
    });
    act(() => progress(1000, 4000));
    expect(result.current.uploads[0]).toMatchObject({
      name: 'a.mp4',
      fileKind: 'video',
      loaded: 1000,
      total: 4000,
      status: 'uploading',
    });
    await act(async () => d.resolve(item(3)));
  });

  it('cancels an upload: aborts its signal and drops the entry', async () => {
    const { result } = setup({ can_add: true, items: [] });
    await waitFor(() => expect(result.current.data).toBeDefined());
    let signal!: AbortSignal;
    svc.uploadPostReference.mockImplementation(
      (_t: string, _p: number, _f: File, opts: { signal: AbortSignal }) => {
        signal = opts.signal;
        return new Promise((_, reject) =>
          opts.signal.addEventListener('abort', () =>
            reject(new DOMException('cancelled', 'AbortError')),
          ),
        );
      },
    );
    let all!: Promise<ReferenceItem[]>;
    act(() => {
      all = result.current.startUploads([file('a.jpg')]);
    });
    const localId = result.current.uploads[0].localId;
    await act(async () => result.current.cancelUpload(localId));
    expect(signal.aborted).toBe(true);
    expect(result.current.uploads).toEqual([]);
    await expect(all).resolves.toEqual([]);
  });

  it('keeps a failed upload as an error entry and retries it with a fresh call', async () => {
    const { result } = setup({ can_add: true, items: [] });
    await waitFor(() => expect(result.current.data).toBeDefined());
    svc.uploadPostReference.mockRejectedValueOnce(new PostReferenceError('internal'));
    await act(async () => {
      await result.current.startUploads([file('a.jpg')]);
    });
    expect(result.current.uploads[0]).toMatchObject({ status: 'error', error: 'internal' });

    svc.uploadPostReference.mockResolvedValueOnce(item(4));
    await act(async () => result.current.retryUpload(result.current.uploads[0].localId));
    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual([4]));
    expect(svc.uploadPostReference).toHaveBeenCalledTimes(2);
    expect(result.current.uploads).toEqual([]);
  });

  it('rejects invalid files and files past the 10-per-post limit without calling the server', async () => {
    const existing = Array.from({ length: 9 }, (_, i) => item(i + 1));
    const { result } = setup({ can_add: true, items: existing });
    await waitFor(() => expect(result.current.items).toHaveLength(9));
    svc.uploadPostReference.mockReturnValue(new Promise(() => {}));
    act(() => {
      void result.current.startUploads([
        file('x.svg', 'image/svg+xml'),
        file('ok.jpg'),
        file('extra.jpg'),
      ]);
    });
    expect(result.current.uploads.map((u) => [u.name, u.status, u.error])).toEqual([
      ['x.svg', 'error', 'unsupported_type'],
      ['ok.jpg', 'uploading', undefined],
      ['extra.jpg', 'error', 'reference_limit'],
    ]);
    expect(svc.uploadPostReference).toHaveBeenCalledTimes(1);
  });

  it('calls onUploaded per finished file', async () => {
    const { result } = setup({ can_add: true, items: [] });
    await waitFor(() => expect(result.current.data).toBeDefined());
    svc.uploadPostReference.mockResolvedValue(item(8));
    const onUploaded = vi.fn();
    await act(async () => {
      await result.current.startUploads([file('a.jpg')], { onUploaded });
    });
    expect(onUploaded).toHaveBeenCalledWith(item(8));
  });

  it('adds a link, updates a note and removes an item in the cache', async () => {
    const { result } = setup({ can_add: true, items: [item(1)] });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    svc.addPostReferenceLink.mockResolvedValue(item(2, { kind: 'link', file_kind: null }));
    await act(async () => {
      await result.current.addLink({ url: 'exemplo.com' });
    });
    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual([1, 2]));

    svc.updatePostReferenceNote.mockResolvedValue(item(1, { note: 'nova' }));
    await act(async () => result.current.updateNote(1, 'nova'));
    await waitFor(() => expect(result.current.items[0].note).toBe('nova'));

    svc.removePostReference.mockResolvedValue(undefined);
    svc.fetchPostReferences.mockResolvedValue({ can_add: true, items: [item(2)] });
    await act(async () => result.current.remove(1));
    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual([2]));
  });

  it('refetches and rethrows when a removal is locked', async () => {
    const { result } = setup({ can_add: true, items: [item(1)] });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    svc.removePostReference.mockRejectedValue(new PostReferenceError('locked'));
    await act(async () => {
      await expect(result.current.remove(1)).rejects.toMatchObject({ code: 'locked' });
    });
    await waitFor(() => expect(svc.fetchPostReferences).toHaveBeenCalledTimes(2));
  });
});
```

Run: `npx vitest run apps/hub/src/hooks/__tests__/usePostReferences.test.tsx`
Expected: FAIL, `Failed to resolve import "../usePostReferences"`.

- [ ] **Step 9: Implement the hook**

Create `apps/hub/src/hooks/usePostReferences.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MAX_REFERENCES_PER_POST,
  PostReferenceError,
  addPostReferenceLink,
  fetchPostReferences,
  isAbortError,
  referenceFileKind,
  removePostReference,
  updatePostReferenceNote,
  uploadPostReference,
  validateReferenceFile,
} from '../services/postReferences';
import type {
  ReferenceErrorCode,
  ReferenceFileKind,
  ReferenceItem,
} from '../types/postReferences';

/** Per post, no token: the contract key. The Hub serves one token per tab. */
export const postReferencesKey = (postId: number) => ['hub-post-references', postId] as const;

const MAX_CONCURRENT_UPLOADS = 2;

export interface UploadEntry {
  localId: string;
  name: string;
  fileKind: ReferenceFileKind;
  loaded: number;
  total: number;
  status: 'uploading' | 'error';
  error?: ReferenceErrorCode;
}

export interface AddReferenceLinkInput {
  url: string;
  title?: string;
  note?: string;
}

type ReferencesData = { can_add: boolean; items: ReferenceItem[] };

interface Job {
  localId: string;
  file: File;
  settle: (item: ReferenceItem | null) => void;
  onUploaded?: (item: ReferenceItem) => void;
}

let localSeq = 0;
const nextLocalId = () => `reference-upload-${++localSeq}`;

function codeOf(err: unknown): ReferenceErrorCode {
  return err instanceof PostReferenceError ? err.code : 'internal';
}

/**
 * The post's references and every write the Hub makes to them. Called once per post card
 * (PostDetailContent) and passed down to the Referências tab, the correction composer, the
 * history tiles and the footer. Uploads run two at a time; unmounting aborts them.
 */
export function usePostReferences(token: string, postId: number) {
  const qc = useQueryClient();
  const key = useMemo(() => postReferencesKey(postId), [postId]);
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchPostReferences(token, postId),
    staleTime: 30_000,
    enabled: token !== '' && postId > 0,
  });

  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [freshIds, setFreshIds] = useState<number[]>([]);
  const files = useRef(new Map<string, File>());
  const controllers = useRef(new Map<string, AbortController>());
  const queue = useRef<Job[]>([]);
  const active = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const ctl = controllers.current;
    const pending = queue.current;
    return () => {
      mounted.current = false;
      for (const c of ctl.values()) c.abort();
      ctl.clear();
      for (const job of pending.splice(0)) job.settle(null);
    };
  }, []);

  const patchUpload = useCallback((localId: string, patch: Partial<UploadEntry>) => {
    if (!mounted.current) return;
    setUploads((list) => list.map((u) => (u.localId === localId ? { ...u, ...patch } : u)));
  }, []);

  const dropUpload = useCallback((localId: string) => {
    files.current.delete(localId);
    controllers.current.delete(localId);
    if (mounted.current) setUploads((list) => list.filter((u) => u.localId !== localId));
  }, []);

  const appendItem = useCallback(
    (item: ReferenceItem) => {
      const old = qc.getQueryData<ReferencesData>(key);
      if (!old) {
        void qc.invalidateQueries({ queryKey: key });
        return;
      }
      if (old.items.some((i) => i.id === item.id)) return;
      const items = [...old.items, item];
      qc.setQueryData<ReferencesData>(key, {
        ...old,
        items,
        can_add: old.can_add && items.length < MAX_REFERENCES_PER_POST,
      });
    },
    [qc, key],
  );

  const replaceItem = useCallback(
    (item: ReferenceItem) => {
      qc.setQueryData<ReferencesData>(key, (old) =>
        old ? { ...old, items: old.items.map((i) => (i.id === item.id ? item : i)) } : old,
      );
    },
    [qc, key],
  );

  // Re-assigned every render so the queue always runs with the current token/post/cache.
  const pump = useRef<() => void>(() => undefined);
  pump.current = () => {
    while (active.current < MAX_CONCURRENT_UPLOADS && queue.current.length > 0) {
      const job = queue.current.shift() as Job;
      const controller = new AbortController();
      controllers.current.set(job.localId, controller);
      active.current += 1;
      uploadPostReference(token, postId, job.file, {
        signal: controller.signal,
        onProgress: (loaded, total) => patchUpload(job.localId, { loaded, total }),
      })
        .then(
          (item) => {
            // Fresh first, so the row mounts with its note field already open.
            if (mounted.current) setFreshIds((ids) => [...ids, item.id]);
            appendItem(item);
            dropUpload(job.localId);
            job.onUploaded?.(item);
            job.settle(item);
          },
          (err: unknown) => {
            controllers.current.delete(job.localId);
            if (isAbortError(err)) {
              dropUpload(job.localId);
            } else {
              const code = codeOf(err);
              patchUpload(job.localId, { status: 'error', error: code });
              if (code === 'post_not_pending' || code === 'reference_limit') {
                void qc.invalidateQueries({ queryKey: key });
              }
            }
            job.settle(null);
          },
        )
        .finally(() => {
          active.current -= 1;
          pump.current();
        });
    }
  };

  const startUploads = useCallback(
    (list: File[], opts?: { onUploaded?: (item: ReferenceItem) => void }) => {
      const current = qc.getQueryData<ReferencesData>(key);
      let room =
        MAX_REFERENCES_PER_POST -
        (current?.items.length ?? 0) -
        queue.current.length -
        active.current;
      const entries: UploadEntry[] = [];
      const results: Array<Promise<ReferenceItem | null>> = [];
      for (const file of list) {
        const localId = nextLocalId();
        const fileKind = referenceFileKind(file) ?? 'document';
        const invalid = validateReferenceFile(file) ?? (room <= 0 ? 'reference_limit' : null);
        const base = { localId, name: file.name, fileKind, loaded: 0, total: file.size };
        if (invalid) {
          entries.push({ ...base, status: 'error', error: invalid });
          results.push(Promise.resolve(null));
          continue;
        }
        room -= 1;
        files.current.set(localId, file);
        entries.push({ ...base, status: 'uploading' });
        results.push(
          new Promise<ReferenceItem | null>((settle) =>
            queue.current.push({ localId, file, settle, onUploaded: opts?.onUploaded }),
          ),
        );
      }
      setUploads((prev) => [...prev, ...entries]);
      pump.current();
      return Promise.all(results).then((items) =>
        items.filter((i): i is ReferenceItem => i !== null),
      );
    },
    [qc, key],
  );

  const cancelUpload = useCallback(
    (localId: string) => {
      controllers.current.get(localId)?.abort();
      const queued = queue.current.findIndex((j) => j.localId === localId);
      if (queued >= 0) queue.current.splice(queued, 1)[0].settle(null);
      dropUpload(localId);
    },
    [dropUpload],
  );

  const retryUpload = useCallback(
    (localId: string) => {
      const file = files.current.get(localId);
      if (!file) return;
      patchUpload(localId, { status: 'uploading', error: undefined, loaded: 0 });
      queue.current.push({ localId, file, settle: () => undefined });
      pump.current();
    },
    [patchUpload],
  );

  const addLink = useCallback(
    async (input: AddReferenceLinkInput) => {
      try {
        const item = await addPostReferenceLink(token, postId, input);
        appendItem(item);
        return item;
      } catch (err) {
        if (codeOf(err) === 'post_not_pending' || codeOf(err) === 'reference_limit') {
          void qc.invalidateQueries({ queryKey: key });
        }
        throw err;
      }
    },
    [token, postId, appendItem, qc, key],
  );

  const updateNote = useCallback(
    async (id: number, note: string) => {
      try {
        replaceItem(await updatePostReferenceNote(token, id, note));
        if (mounted.current) setFreshIds((ids) => ids.filter((x) => x !== id));
      } catch (err) {
        if (codeOf(err) === 'locked' || codeOf(err) === 'not_found') {
          void qc.invalidateQueries({ queryKey: key });
        }
        throw err;
      }
    },
    [token, replaceItem, qc, key],
  );

  const remove = useCallback(
    async (id: number) => {
      try {
        await removePostReference(token, id);
        qc.setQueryData<ReferencesData>(key, (old) =>
          old ? { ...old, items: old.items.filter((i) => i.id !== id) } : old,
        );
      } finally {
        // can_add depends on the count and the post status: let the server say.
        void qc.invalidateQueries({ queryKey: key });
      }
    },
    [token, qc, key],
  );

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: key });
  }, [qc, key]);

  const data = query.data;
  return {
    data,
    isLoading: query.isLoading,
    canAdd: data?.can_add ?? false,
    items: data?.items ?? [],
    uploads,
    uploadsInFlight: uploads.some((u) => u.status === 'uploading'),
    freshIds,
    startUploads,
    cancelUpload,
    retryUpload,
    addLink,
    updateNote,
    remove,
    refresh,
  };
}

export type PostReferencesState = ReturnType<typeof usePostReferences>;
```

`items: data?.items ?? []` returns a new empty array per render when there is no data; consumers
only read it, never use it as an effect dependency.

Run: `npx vitest run apps/hub/src/hooks/__tests__/usePostReferences.test.tsx`
Expected: PASS (9 tests).

- [ ] **Step 10: Typecheck, lint, format, full suite for the touched areas**

```bash
npx prettier --write packages/ui/video apps/hub/src/types/postReferences.ts \
  apps/hub/src/services/referenceMedia.ts apps/hub/src/services/postReferences.ts \
  apps/hub/src/services/ideiaMedia.ts apps/hub/src/hooks/usePostReferences.ts \
  apps/hub/src/services/__tests__/referenceMedia.test.ts \
  apps/hub/src/services/__tests__/postReferences.test.ts \
  apps/hub/src/hooks/__tests__/usePostReferences.test.tsx \
  apps/crm/src/pages/entregas/components/ThumbnailPickerDialog.tsx \
  apps/crm/src/pages/entregas/components/PostMediaGallery.tsx \
  apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npm run lint
npm run format:check
npx vitest run apps/hub packages/ui apps/crm/src/pages/entregas
```

Expected: the three tsc runs print nothing and exit 0; lint exits 0 (warnings allowed, no
errors); `format:check` prints `All matched files use Prettier code style!`; vitest reports all
files passed.

- [ ] **Step 11: Commit**

```bash
git add packages/ui/video apps/crm/src/utils apps/crm/src/pages/entregas/components \
  apps/hub/src/types/postReferences.ts apps/hub/src/services apps/hub/src/hooks
git commit -m "$(cat <<'EOF'
feat(hub): post references data layer (service, media prep, hook)

Moves the video frame helper to packages/ui so the Hub can build reference
posters, with a neutral poster when a frame cannot be decoded.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 8: Referências tab in the Hub post dialog

**Files:**
- Create: `apps/hub/src/components/posts/references/referenceFormat.ts`
- Create: `apps/hub/src/components/posts/references/referenceErrors.ts`
- Create: `apps/hub/src/components/posts/references/ReferenceTiles.tsx` (`ReferenceThumb`, `ReferenceOpen`, `ReferenceTiles`)
- Create: `apps/hub/src/components/posts/references/ReferenceRow.tsx` (`ReferenceRow`, `UploadRow`)
- Create: `apps/hub/src/components/posts/references/AddReferenceSheet.tsx`
- Create: `apps/hub/src/components/posts/references/ReferenceLinkForm.tsx`
- Create: `apps/hub/src/components/posts/references/ReferencePicker.tsx` (additive: hidden input + sheet + link form, shared by the tab and the composer)
- Create: `apps/hub/src/components/posts/references/ReferenceViewer.tsx`
- Create: `apps/hub/src/components/posts/references/PostReferencesPanel.tsx`
- Modify: `apps/hub/src/components/posts/PostDetailDialog.tsx`
- Modify: `packages/i18n/locales/pt/hubPosts.json`, `packages/i18n/locales/en/hubPosts.json`
- Create: `apps/hub/src/hooks/__tests__/postReferencesStub.ts` (test helper, not collected: no `.test.` in the name)
- Modify: `apps/hub/src/components/posts/__tests__/PostDetailDialog.test.tsx`, `apps/hub/src/pages/__tests__/aprovacoesPage.test.tsx`, `apps/hub/src/pages/__tests__/postagensPage.test.tsx`, `apps/hub/src/pages/__tests__/postApprovalBrandPages.test.tsx` (hook stub)
- Modify: `apps/hub/src/lib/__tests__/hubPostsLocale.test.ts`
- Test: `apps/hub/src/components/posts/references/__tests__/referenceErrors.test.ts`
- Test: `apps/hub/src/components/posts/references/__tests__/PostReferencesPanel.test.tsx`
- Test: `apps/hub/src/components/posts/references/__tests__/ReferenceViewer.test.tsx`
- Test: `apps/hub/src/components/posts/__tests__/PostDetailDialog.references.test.tsx`

**Interfaces:**

```ts
// referenceFormat.ts
export const REFERENCE_FIELD: string;   // input/textarea classes, 16px on phones
export function formatMegabytes(bytes: number, locale: string): string;   // "2,4 MB", "38 MB"
export function formatDuration(seconds: number): string;                  // "0:32", "1:02:05"
export function formatReferenceWhen(iso: string, locale: string, t: TFunction<'hubPosts'>, now?: Date): string; // "hoje, 14:32"
export function referenceTitle(item: ReferenceItem): string;
// referenceErrors.ts
export function referenceErrorCode(err: unknown): ReferenceErrorCode;
export function referenceErrorMessage(code: ReferenceErrorCode, t: TFunction<'hubPosts'>, ctx?: { fileKind?: ReferenceFileKind; sizeBytes?: number }): string;
// ReferenceTiles.tsx
export function ReferenceThumb(props: { item: ReferenceItem; size: number }): JSX.Element;
export function ReferenceOpen(props: { item: ReferenceItem; onOpen?: (item: ReferenceItem) => void; label: string; className?: string; decorative?: boolean; children: ReactNode }): JSX.Element;
export function ReferenceTiles(props: { items: ReferenceItem[]; onOpen?: (item: ReferenceItem) => void }): JSX.Element;
// ReferenceRow.tsx
export function ReferenceRow(props: { item; fresh: boolean; onOpen; onSaveNote(id, note): Promise<void>; onRemove(id): Promise<void> }): JSX.Element;
export function UploadRow(props: { entry: UploadEntry; onCancel(localId): void; onRetry(localId): void }): JSX.Element;
// AddReferenceSheet.tsx
export function AddReferenceSheet(props: { open: boolean; onClose(): void; onPickFiles(): void; onPickLink(): void }): JSX.Element | null;
// ReferenceLinkForm.tsx
export function ReferenceLinkForm(props: { open: boolean; onClose(): void; onSubmit(input: AddReferenceLinkInput): Promise<unknown> }): JSX.Element | null;
// ReferencePicker.tsx
export function ReferencePicker(props: { refs: PostReferencesState; variant: 'panel' | 'composer'; disabled?: boolean; onAdded?: (item: ReferenceItem) => void; onOverlayChange?: (open: boolean) => void }): JSX.Element;
// ReferenceViewer.tsx
export function ReferenceViewer(props: { item: ReferenceItem; onClose(): void }): JSX.Element;
// PostReferencesPanel.tsx
export function PostReferencesPanel(props: { post: HubPost; refs: PostReferencesState; onOpen(item: ReferenceItem): void; onOverlayChange?: (open: boolean) => void }): JSX.Element;
```

Design notes that the code below encodes:
- Every overlay (sheet, link form, viewer) is a nested `HubDialog`, which portals into
  `.hub-root` (`components/ui/HubDialog.tsx:18-24`: hub-* rules are scoped to `.hub-root`, and
  `.hub-root` has no transform, so `fixed` is viewport-relative). That is the portal escape the
  `.hub-fade-up` rule asks for, and nesting has precedent: `HomePage.tsx:270` HubDialog contains
  `AgendaCard`, which opens `RemarcarDialog` (another HubDialog). Radix gives Escape to the top
  layer only and pauses the outer focus trap. The outer card still listens to `window` keydown for
  the arrows, so the dialog tracks `overlayOpen` and stands down while any overlay is up.
- Overlays render only while open, so the existing "exactly 2 dialogs" lightbox test
  (`PostDetailDialog.test.tsx:546`) still holds.
- jsdom ignores responsive classes, so the md+ pair ("Adicionar arquivo", "Adicionar link") and the
  phone button ("Adicionar referência") all render in tests; their names are distinct.
- `hub-*` classes take no Tailwind variants: hover and responsive states use
  `bg-[var(--hub-soft)]`-style arbitrary values.
- Inputs are `text-[16px] md:text-[14px]` so iOS does not zoom.

- [ ] **Step 1: i18n keys (pt and en, same keys)**

`apps/hub/src/lib/__tests__/hubPostsLocale.test.ts:14-16` fails CI when pt and en differ.

In `packages/i18n/locales/pt/hubPosts.json`, replace the file's last lines

```json
    "footer": "Em produção: nada para aprovar agora"
  }
}
```

with

```json
    "footer": "Em produção: nada para aprovar agora"
  },
  "references": {
    "tab": "Referências",
    "loading": "Carregando referências...",
    "loadError": "Não foi possível carregar as referências.",
    "emptyTitle": "Nenhuma referência ainda",
    "emptyBody": "Envie fotos, vídeos, PDFs ou links que ajudem a equipe a ajustar este post.",
    "readOnlyPublished": "Post publicado. As referências ficam aqui para consulta.",
    "readOnly": "As referências ficam aqui para consulta.",
    "listLabel": "Referências do post",
    "uploadsLabel": "Envios em andamento",
    "addFile": "Adicionar arquivo",
    "addLink": "Adicionar link",
    "addReference": "Adicionar referência",
    "attach": "Anexar referência",
    "hint": "{{n}} de 10 por post. Fotos e PDFs até 25 MB, vídeos até 200 MB.",
    "sheetTitle": "Adicionar referência",
    "sheetFile": "Foto, vídeo ou PDF",
    "sheetLink": "Link",
    "you": "Você",
    "today": "hoje, {{time}}",
    "yesterday": "ontem, {{time}}",
    "dateTime": "{{date}}, {{time}}",
    "open": "Abrir {{name}}",
    "remove": "Remover referência",
    "removeConfirm": "Remover referência?",
    "noteLabel": "O que mudar com isso? (opcional)",
    "saveNote": "Salvar nota",
    "savingNote": "Salvando...",
    "editNote": "Editar nota",
    "addNote": "Adicionar nota",
    "cancel": "Cancelar",
    "progressLabel": "Envio de {{name}}",
    "uploading": "Enviando {{loaded}} de {{total}}. Não feche esta tela.",
    "cancelUpload": "Cancelar envio de {{name}}",
    "retryUpload": "Tentar novamente",
    "discardUpload": "Descartar",
    "waitUpload": "Aguarde o envio terminar",
    "leaveWhileUploading": "Um envio ainda está em andamento. Sair e cancelar o envio?",
    "link": {
      "title": "Adicionar link",
      "url": "Endereço",
      "urlHint": "Vamos completar com https:// se faltar.",
      "linkTitle": "Título (opcional)",
      "note": "O que a equipe deve ver aqui? (opcional)",
      "submit": "Adicionar link",
      "submitting": "Adicionando..."
    },
    "viewer": {
      "close": "Fechar visualização",
      "playError": "Não foi possível reproduzir aqui. Baixe o arquivo.",
      "openOriginal": "Abrir o arquivo"
    },
    "composer": {
      "staged": "Referências desta correção",
      "unstage": "Tirar {{name}} da correção",
      "helper": "As referências anexadas também ficam na aba Referências deste post."
    },
    "history": {
      "attached_one": "{{count}} referência anexada",
      "attached_other": "{{count}} referências anexadas"
    },
    "errors": {
      "tooLarge": "O arquivo passa do limite: fotos e PDFs até 25 MB, vídeos até 200 MB.",
      "tooLargeVideo": "O vídeo tem {{size}} MB e o limite é 200 MB. Envie uma versão menor ou um link.",
      "tooLargeImage": "A foto tem {{size}} MB e o limite é 25 MB. Envie uma versão menor ou um link.",
      "tooLargeDocument": "O PDF tem {{size}} MB e o limite é 25 MB. Envie uma versão menor ou um link.",
      "unsupportedType": "Esse tipo de arquivo não é aceito. Envie foto, vídeo ou PDF.",
      "referenceLimit": "Este post já tem 10 referências. Remova uma para adicionar outra.",
      "quotaExceeded": "Não foi possível enviar agora: o espaço de arquivos da agência acabou. Avise a equipe.",
      "postNotPending": "Este post não está mais aguardando sua aprovação.",
      "invalidUrl": "Informe um endereço válido, começando com http ou https.",
      "invalidNote": "A nota pode ter até 500 caracteres.",
      "locked": "A equipe já recebeu esta referência. Ela não pode mais ser alterada.",
      "notFound": "Esta referência não está mais disponível.",
      "rateLimited": "Muitas tentativas seguidas. Aguarde um minuto e tente novamente.",
      "generic": "Algo deu errado. Tente novamente."
    }
  }
}
```

In `packages/i18n/locales/en/hubPosts.json`, replace

```json
    "footer": "In production: nothing to approve right now"
  }
}
```

with

```json
    "footer": "In production: nothing to approve right now"
  },
  "references": {
    "tab": "References",
    "loading": "Loading references...",
    "loadError": "Couldn't load the references.",
    "emptyTitle": "No references yet",
    "emptyBody": "Send photos, videos, PDFs or links that help the team adjust this post.",
    "readOnlyPublished": "Post published. The references stay here for reference.",
    "readOnly": "The references stay here for reference.",
    "listLabel": "Post references",
    "uploadsLabel": "Uploads in progress",
    "addFile": "Add file",
    "addLink": "Add link",
    "addReference": "Add reference",
    "attach": "Attach reference",
    "hint": "{{n}} of 10 per post. Photos and PDFs up to 25 MB, videos up to 200 MB.",
    "sheetTitle": "Add reference",
    "sheetFile": "Photo, video or PDF",
    "sheetLink": "Link",
    "you": "You",
    "today": "today, {{time}}",
    "yesterday": "yesterday, {{time}}",
    "dateTime": "{{date}}, {{time}}",
    "open": "Open {{name}}",
    "remove": "Remove reference",
    "removeConfirm": "Remove reference?",
    "noteLabel": "What should change because of this? (optional)",
    "saveNote": "Save note",
    "savingNote": "Saving...",
    "editNote": "Edit note",
    "addNote": "Add note",
    "cancel": "Cancel",
    "progressLabel": "Upload of {{name}}",
    "uploading": "Uploading {{loaded}} of {{total}}. Don't close this screen.",
    "cancelUpload": "Cancel upload of {{name}}",
    "retryUpload": "Try again",
    "discardUpload": "Discard",
    "waitUpload": "Wait for the upload to finish",
    "leaveWhileUploading": "An upload is still in progress. Leave and cancel it?",
    "link": {
      "title": "Add link",
      "url": "Address",
      "urlHint": "We'll add https:// if it's missing.",
      "linkTitle": "Title (optional)",
      "note": "What should the team look at here? (optional)",
      "submit": "Add link",
      "submitting": "Adding..."
    },
    "viewer": {
      "close": "Close preview",
      "playError": "Can't play this here. Download the file.",
      "openOriginal": "Open the file"
    },
    "composer": {
      "staged": "References in this correction",
      "unstage": "Remove {{name}} from the correction",
      "helper": "Attached references also stay in this post's References tab."
    },
    "history": {
      "attached_one": "{{count}} reference attached",
      "attached_other": "{{count}} references attached"
    },
    "errors": {
      "tooLarge": "The file is over the limit: photos and PDFs up to 25 MB, videos up to 200 MB.",
      "tooLargeVideo": "The video is {{size}} MB and the limit is 200 MB. Send a smaller version or a link.",
      "tooLargeImage": "The photo is {{size}} MB and the limit is 25 MB. Send a smaller version or a link.",
      "tooLargeDocument": "The PDF is {{size}} MB and the limit is 25 MB. Send a smaller version or a link.",
      "unsupportedType": "This file type isn't accepted. Send a photo, video or PDF.",
      "referenceLimit": "This post already has 10 references. Remove one to add another.",
      "quotaExceeded": "Couldn't upload right now: the agency's file storage is full. Let the team know.",
      "postNotPending": "This post is no longer waiting for your approval.",
      "invalidUrl": "Enter a valid address, starting with http or https.",
      "invalidNote": "The note can have up to 500 characters.",
      "locked": "The team has already received this reference. It can no longer be changed.",
      "notFound": "This reference is no longer available.",
      "rateLimited": "Too many attempts in a row. Wait a minute and try again.",
      "generic": "Something went wrong. Try again."
    }
  }
}
```

Extend `apps/hub/src/lib/__tests__/hubPostsLocale.test.ts`. Replace

```ts
  it('has no em-dash in any user-facing string', () => {
    expect(
      JSON.stringify(pt.history) + JSON.stringify(pt.correctionReason) + JSON.stringify(pt.posts),
    ).not.toMatch(/—/);
  });
```

with

```ts
  it('has no em-dash in any user-facing string', () => {
    expect(
      JSON.stringify(pt.history) +
        JSON.stringify(pt.correctionReason) +
        JSON.stringify(pt.posts) +
        JSON.stringify(pt.references),
    ).not.toMatch(/—/);
  });

  it('carries the references group with the spec copy', () => {
    expect(pt.references.tab).toBe('Referências');
    expect(pt.references.emptyTitle).toBe('Nenhuma referência ainda');
    expect(pt.references.composer.helper).toBe(
      'As referências anexadas também ficam na aba Referências deste post.',
    );
    expect(pt.references.errors.unsupportedType).toBe(
      'Esse tipo de arquivo não é aceito. Envie foto, vídeo ou PDF.',
    );
    expect(pt.references.history.attached_other).toBe('{{count}} referências anexadas');
  });
```

Run: `npx vitest run apps/hub/src/lib/__tests__/hubPostsLocale.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 2: Format and error helpers (test first)**

Create `apps/hub/src/components/posts/references/__tests__/referenceErrors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import type { TFunction } from 'i18next';
import { PostReferenceError } from '../../../../services/postReferences';
import { referenceErrorCode, referenceErrorMessage } from '../referenceErrors';
import {
  formatDuration,
  formatMegabytes,
  formatReferenceWhen,
  referenceTitle,
} from '../referenceFormat';

const t = i18n.getFixedT('pt', 'hubPosts') as unknown as TFunction<'hubPosts'>;
const MB = 1024 * 1024;

describe('referenceErrorMessage', () => {
  it('uses the spec copy for every code', () => {
    expect(referenceErrorMessage('too_large', t, { fileKind: 'video', sizeBytes: 230 * MB })).toBe(
      'O vídeo tem 230 MB e o limite é 200 MB. Envie uma versão menor ou um link.',
    );
    expect(referenceErrorMessage('too_large', t, { fileKind: 'image', sizeBytes: 30 * MB })).toBe(
      'A foto tem 30 MB e o limite é 25 MB. Envie uma versão menor ou um link.',
    );
    expect(
      referenceErrorMessage('too_large', t, { fileKind: 'document', sizeBytes: 26 * MB }),
    ).toBe('O PDF tem 26 MB e o limite é 25 MB. Envie uma versão menor ou um link.');
    expect(referenceErrorMessage('unsupported_type', t)).toBe(
      'Esse tipo de arquivo não é aceito. Envie foto, vídeo ou PDF.',
    );
    expect(referenceErrorMessage('reference_limit', t)).toBe(
      'Este post já tem 10 referências. Remova uma para adicionar outra.',
    );
    expect(referenceErrorMessage('quota_exceeded', t)).toBe(
      'Não foi possível enviar agora: o espaço de arquivos da agência acabou. Avise a equipe.',
    );
    expect(referenceErrorMessage('post_not_pending', t)).toBe(
      'Este post não está mais aguardando sua aprovação.',
    );
    expect(referenceErrorMessage('invalid_url', t)).toBe(
      'Informe um endereço válido, começando com http ou https.',
    );
    for (const code of ['internal', 'upload_mismatch', 'thumbnail_invalid'] as const) {
      expect(referenceErrorMessage(code, t)).toBe('Algo deu errado. Tente novamente.');
    }
  });

  it('never returns an em dash', () => {
    const codes = [
      'unsupported_type', 'too_large', 'thumbnail_invalid', 'reference_limit', 'quota_exceeded',
      'post_not_pending', 'invalid_url', 'invalid_note', 'not_found', 'locked', 'rate_limited',
      'upload_mismatch', 'internal',
    ] as const;
    for (const code of codes) expect(referenceErrorMessage(code, t)).not.toMatch(/—/);
  });

  it('reads the code off a PostReferenceError and treats anything else as internal', () => {
    expect(referenceErrorCode(new PostReferenceError('locked'))).toBe('locked');
    expect(referenceErrorCode(new Error('boom'))).toBe('internal');
  });
});

describe('reference formatting', () => {
  it('formats sizes in MB with one decimal under 10 MB', () => {
    expect(formatMegabytes(2.4 * MB, 'pt-BR')).toBe('2,4 MB');
    expect(formatMegabytes(38 * MB, 'pt-BR')).toBe('38 MB');
    expect(formatMegabytes(0, 'pt-BR')).toBe('0 MB');
  });

  it('formats durations', () => {
    expect(formatDuration(32)).toBe('0:32');
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('says hoje / ontem for recent references', () => {
    const now = new Date(2026, 9, 8, 18, 0);
    expect(formatReferenceWhen(new Date(2026, 9, 8, 14, 32).toISOString(), 'pt-BR', t, now)).toBe(
      'hoje, 14:32',
    );
    expect(formatReferenceWhen(new Date(2026, 9, 7, 9, 5).toISOString(), 'pt-BR', t, now)).toBe(
      'ontem, 09:05',
    );
  });

  it('titles a link by its title, then its domain', () => {
    const base = {
      id: 1, kind: 'link' as const, file_kind: null, name: null, mime_type: null,
      size_bytes: null, duration_seconds: null, width: null, height: null, url: null,
      thumbnail_url: null, blur_data_url: null, download_url: null,
      link_url: 'https://exemplo.com/p', link_title: null, link_domain: 'exemplo.com',
      note: null, post_approval_id: null, created_at: '2026-10-08T12:00:00Z', can_remove: true,
    };
    expect(referenceTitle(base)).toBe('exemplo.com');
    expect(referenceTitle({ ...base, link_title: 'Post da marca' })).toBe('Post da marca');
  });
});
```

Run: `npx vitest run apps/hub/src/components/posts/references/__tests__/referenceErrors.test.ts`
Expected: FAIL, `Failed to resolve import "../referenceErrors"`.

Create `apps/hub/src/components/posts/references/referenceFormat.ts`:

```ts
import type { TFunction } from 'i18next';
import type { ReferenceItem } from '../../../types/postReferences';

const MB = 1024 * 1024;

/** Inputs in the reference forms: 16px on phones so iOS does not zoom into the field. */
export const REFERENCE_FIELD =
  'w-full border hub-border rounded-lg px-3 py-2.5 text-[16px] md:text-[14px] outline-none hub-bg-card hub-txt placeholder:text-[var(--hub-tx3)] hub-focus-accent focus:ring-2';

/** "2,4 MB" under 10 MB, "38 MB" above. A non-empty file never shows as 0 MB. */
export function formatMegabytes(bytes: number, locale: string): string {
  const mb = bytes <= 0 ? 0 : Math.max(bytes / MB, 0.1);
  const value = new Intl.NumberFormat(locale, {
    maximumFractionDigits: mb < 10 ? 1 : 0,
  }).format(mb);
  return `${value} MB`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "hoje, 14:32", "ontem, 09:05", else "12 de out., 14:32". */
export function formatReferenceWhen(
  iso: string,
  locale: string,
  t: TFunction<'hubPosts'>,
  now: Date = new Date(),
): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days === 0) return t('references.today', 'hoje, {{time}}', { time });
  if (days === 1) return t('references.yesterday', 'ontem, {{time}}', { time });
  const date = d.toLocaleDateString(locale, { day: '2-digit', month: 'short' });
  return t('references.dateTime', '{{date}}, {{time}}', { date, time });
}

export function referenceTitle(item: ReferenceItem): string {
  if (item.kind === 'link') return item.link_title || item.link_domain || item.link_url || '';
  return item.name ?? '';
}
```

Create `apps/hub/src/components/posts/references/referenceErrors.ts`:

```ts
import type { TFunction } from 'i18next';
import { PostReferenceError } from '../../../services/postReferences';
import type { ReferenceErrorCode, ReferenceFileKind } from '../../../types/postReferences';

export function referenceErrorCode(err: unknown): ReferenceErrorCode {
  return err instanceof PostReferenceError ? err.code : 'internal';
}

/** Inline copy for every reference error (rendered with role="alert"). */
export function referenceErrorMessage(
  code: ReferenceErrorCode,
  t: TFunction<'hubPosts'>,
  ctx: { fileKind?: ReferenceFileKind; sizeBytes?: number } = {},
): string {
  switch (code) {
    case 'too_large': {
      if (ctx.sizeBytes == null || !ctx.fileKind) {
        return t(
          'references.errors.tooLarge',
          'O arquivo passa do limite: fotos e PDFs até 25 MB, vídeos até 200 MB.',
        );
      }
      const size = Math.ceil(ctx.sizeBytes / (1024 * 1024));
      if (ctx.fileKind === 'video') {
        return t(
          'references.errors.tooLargeVideo',
          'O vídeo tem {{size}} MB e o limite é 200 MB. Envie uma versão menor ou um link.',
          { size },
        );
      }
      if (ctx.fileKind === 'image') {
        return t(
          'references.errors.tooLargeImage',
          'A foto tem {{size}} MB e o limite é 25 MB. Envie uma versão menor ou um link.',
          { size },
        );
      }
      return t(
        'references.errors.tooLargeDocument',
        'O PDF tem {{size}} MB e o limite é 25 MB. Envie uma versão menor ou um link.',
        { size },
      );
    }
    case 'unsupported_type':
      return t(
        'references.errors.unsupportedType',
        'Esse tipo de arquivo não é aceito. Envie foto, vídeo ou PDF.',
      );
    case 'reference_limit':
      return t(
        'references.errors.referenceLimit',
        'Este post já tem 10 referências. Remova uma para adicionar outra.',
      );
    case 'quota_exceeded':
      return t(
        'references.errors.quotaExceeded',
        'Não foi possível enviar agora: o espaço de arquivos da agência acabou. Avise a equipe.',
      );
    case 'post_not_pending':
      return t(
        'references.errors.postNotPending',
        'Este post não está mais aguardando sua aprovação.',
      );
    case 'invalid_url':
      return t(
        'references.errors.invalidUrl',
        'Informe um endereço válido, começando com http ou https.',
      );
    case 'invalid_note':
      return t('references.errors.invalidNote', 'A nota pode ter até 500 caracteres.');
    case 'locked':
      return t(
        'references.errors.locked',
        'A equipe já recebeu esta referência. Ela não pode mais ser alterada.',
      );
    case 'not_found':
      return t('references.errors.notFound', 'Esta referência não está mais disponível.');
    case 'rate_limited':
      return t(
        'references.errors.rateLimited',
        'Muitas tentativas seguidas. Aguarde um minuto e tente novamente.',
      );
    default:
      return t('references.errors.generic', 'Algo deu errado. Tente novamente.');
  }
}
```

Run: `npx vitest run apps/hub/src/components/posts/references/__tests__/referenceErrors.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 3: Test stub for the hook (shared by every dialog test)**

Create `apps/hub/src/hooks/__tests__/postReferencesStub.ts`:

```ts
import { vi } from 'vitest';
import type { PostReferencesState } from '../usePostReferences';
import type { ReferenceItem } from '../../types/postReferences';

export function makeReferenceItem(id: number, over: Partial<ReferenceItem> = {}): ReferenceItem {
  return {
    id,
    kind: 'file',
    file_kind: 'image',
    name: `f${id}.jpg`,
    mime_type: 'image/jpeg',
    size_bytes: 2_516_582,
    duration_seconds: null,
    width: 1080,
    height: 1350,
    url: `https://r2/get/${id}`,
    thumbnail_url: `https://r2/thumb/${id}`,
    blur_data_url: null,
    download_url: null,
    link_url: null,
    link_title: null,
    link_domain: null,
    note: null,
    post_approval_id: null,
    created_at: '2026-10-08T12:00:00.000Z',
    can_remove: true,
    ...over,
  };
}

/** A settled usePostReferences result; override any field. Defaults: nothing to add, empty. */
export function makePostReferencesStub(
  over: Partial<PostReferencesState> = {},
): PostReferencesState {
  const items = over.items ?? [];
  const canAdd = over.canAdd ?? false;
  return {
    data: { can_add: canAdd, items },
    isLoading: false,
    canAdd,
    items,
    uploads: [],
    uploadsInFlight: false,
    freshIds: [],
    startUploads: vi.fn(async () => []),
    cancelUpload: vi.fn(),
    retryUpload: vi.fn(),
    addLink: vi.fn(),
    updateNote: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    refresh: vi.fn(),
    ...over,
  };
}
```

- [ ] **Step 4: Write the failing panel and viewer tests**

Create `apps/hub/src/components/posts/references/__tests__/PostReferencesPanel.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostReferencesPanel } from '../PostReferencesPanel';
import {
  makePostReferencesStub,
  makeReferenceItem,
} from '../../../../hooks/__tests__/postReferencesStub';
import { PostReferenceError } from '../../../../services/postReferences';
import type { HubPost } from '../../../../types';
import type { PostReferencesState } from '../../../../hooks/usePostReferences';

const MB = 1024 * 1024;

function post(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 1,
    titulo: 'Post',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: 'Corpo',
    scheduled_at: null,
    ig_caption: 'Legenda',
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: null,
    workflow_titulo: null,
    workflow_created_at: null,
    media: [],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    ...over,
  };
}

function renderPanel(refs: PostReferencesState, p: HubPost = post(), onOpen = vi.fn()) {
  render(<PostReferencesPanel post={p} refs={refs} onOpen={onOpen} />);
  return { onOpen };
}

describe('PostReferencesPanel', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows loading until the first response', () => {
    renderPanel(makePostReferencesStub({ data: undefined, isLoading: true }));
    expect(screen.getByText('Carregando referências...')).toBeInTheDocument();
  });

  it('shows the empty state, the add buttons and the hint when the client can add', () => {
    renderPanel(makePostReferencesStub({ canAdd: true }));
    expect(screen.getByText('Nenhuma referência ainda')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar arquivo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Adicionar link' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Adicionar referência' })).toBeEnabled();
    expect(
      screen.getByText('0 de 10 por post. Fotos e PDFs até 25 MB, vídeos até 200 MB.'),
    ).toBeInTheDocument();
  });

  it('is read-only on a published post', () => {
    renderPanel(
      makePostReferencesStub({ canAdd: false, items: [makeReferenceItem(1, { can_remove: false })] }),
      post({ status: 'postado' }),
    );
    expect(
      screen.getByText('Post publicado. As referências ficam aqui para consulta.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adicionar arquivo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover referência' })).not.toBeInTheDocument();
  });

  it('uses the neutral read-only notice outside postado', () => {
    renderPanel(
      makePostReferencesStub({ canAdd: false, items: [makeReferenceItem(1)] }),
      post({ status: 'aprovado_cliente' }),
    );
    expect(screen.getByText('As referências ficam aqui para consulta.')).toBeInTheDocument();
  });

  it('renders file and link rows with note, author, size and domain', () => {
    renderPanel(
      makePostReferencesStub({
        canAdd: true,
        items: [
          makeReferenceItem(1, { name: 'foto.jpg', note: 'Usar esta foto' }),
          makeReferenceItem(2, {
            kind: 'link',
            file_kind: null,
            name: null,
            size_bytes: null,
            url: null,
            thumbnail_url: null,
            link_url: 'https://exemplo.com/p',
            link_title: 'Post da marca',
            link_domain: 'exemplo.com',
          }),
        ],
      }),
    );
    const list = screen.getByRole('list', { name: 'Referências do post' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('foto.jpg')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Usar esta foto')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/^Você · .* · 2,4 MB$/)).toBeInTheDocument();
    const link = within(rows[1]).getByRole('link', { name: 'Abrir Post da marca' });
    expect(link).toHaveAttribute('href', 'https://exemplo.com/p');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(rows[1]).getByText('exemplo.com')).toBeInTheDocument();
    expect(
      screen.getByText('2 de 10 por post. Fotos e PDFs até 25 MB, vídeos até 200 MB.'),
    ).toBeInTheDocument();
  });

  it('opens an image in the viewer and a PDF in a new tab', () => {
    const { onOpen } = renderPanel(
      makePostReferencesStub({
        canAdd: true,
        items: [
          makeReferenceItem(1, { name: 'foto.jpg' }),
          makeReferenceItem(2, {
            name: 'tabela.pdf',
            file_kind: 'document',
            mime_type: 'application/pdf',
            thumbnail_url: null,
            url: 'https://r2/get/2',
          }),
        ],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Abrir foto.jpg' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    expect(screen.getByRole('link', { name: 'Abrir tabela.pdf' })).toHaveAttribute(
      'href',
      'https://r2/get/2',
    );
  });

  it('removes only after the confirm', async () => {
    const refs = makePostReferencesStub({ canAdd: true, items: [makeReferenceItem(1)] });
    renderPanel(refs);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Remover referência' }));
    expect(confirm).toHaveBeenCalledWith('Remover referência?');
    expect(refs.remove).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remover referência' }));
    await waitFor(() => expect(refs.remove).toHaveBeenCalledWith(1));
  });

  it('shows the locked copy when the team already acted', async () => {
    const refs = makePostReferencesStub({
      canAdd: true,
      items: [makeReferenceItem(1)],
      remove: vi.fn(async () => {
        throw new PostReferenceError('locked');
      }),
    });
    renderPanel(refs);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remover referência' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A equipe já recebeu esta referência. Ela não pode mais ser alterada.',
    );
  });

  it('opens the note field for a fresh upload and saves it', async () => {
    const refs = makePostReferencesStub({
      canAdd: true,
      items: [makeReferenceItem(5)],
      freshIds: [5],
    });
    renderPanel(refs);
    const field = screen.getByLabelText('O que mudar com isso? (opcional)');
    fireEvent.change(field, { target: { value: 'Trocar a capa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar nota' }));
    await waitFor(() => expect(refs.updateNote).toHaveBeenCalledWith(5, 'Trocar a capa'));
    await waitFor(() =>
      expect(screen.queryByLabelText('O que mudar com isso? (opcional)')).not.toBeInTheDocument(),
    );
  });

  it('shows upload progress with the size copy and cancels', () => {
    const refs = makePostReferencesStub({
      canAdd: true,
      uploadsInFlight: true,
      uploads: [
        {
          localId: 'u1',
          name: 'video.mp4',
          fileKind: 'video',
          loaded: 24 * MB,
          total: 38 * MB,
          status: 'uploading',
        },
      ],
    });
    renderPanel(refs);
    expect(screen.getByRole('progressbar', { name: 'Envio de video.mp4' })).toHaveAttribute(
      'aria-valuenow',
      '63',
    );
    expect(
      screen.getByText('Enviando 24 MB de 38 MB. Não feche esta tela.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar envio de video.mp4' }));
    expect(refs.cancelUpload).toHaveBeenCalledWith('u1');
    expect(screen.queryByText('Nenhuma referência ainda')).not.toBeInTheDocument();
  });

  it('shows a too-large error without retry, and a generic error with retry', () => {
    const refs = makePostReferencesStub({
      canAdd: true,
      uploads: [
        {
          localId: 'big',
          name: 'big.mov',
          fileKind: 'video',
          loaded: 0,
          total: 230 * MB,
          status: 'error',
          error: 'too_large',
        },
        {
          localId: 'net',
          name: 'foto.jpg',
          fileKind: 'image',
          loaded: 0,
          total: MB,
          status: 'error',
          error: 'internal',
        },
      ],
    });
    renderPanel(refs);
    const alerts = screen.getAllByRole('alert');
    expect(alerts[0]).toHaveTextContent(
      'O vídeo tem 230 MB e o limite é 200 MB. Envie uma versão menor ou um link.',
    );
    expect(alerts[1]).toHaveTextContent('Algo deu errado. Tente novamente.');
    expect(screen.getAllByRole('button', { name: 'Tentar novamente' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(refs.retryUpload).toHaveBeenCalledWith('net');
    fireEvent.click(screen.getAllByRole('button', { name: 'Descartar' })[0]);
    expect(refs.cancelUpload).toHaveBeenCalledWith('big');
  });

  it('starts uploads for every chosen file', () => {
    const refs = makePostReferencesStub({ canAdd: true });
    renderPanel(refs);
    const a = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const b = new File(['b'], 'b.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('reference-file-input-panel'), {
      target: { files: [a, b] },
    });
    expect(refs.startUploads).toHaveBeenCalledWith([a, b], { onUploaded: undefined });
  });

  it('disables adding at 10 references', () => {
    renderPanel(
      makePostReferencesStub({
        canAdd: true,
        items: Array.from({ length: 10 }, (_, i) => makeReferenceItem(i + 1)),
      }),
    );
    expect(screen.getByRole('button', { name: 'Adicionar arquivo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Adicionar referência' })).toBeDisabled();
  });

  it('validates the link address on the client, then adds the link and closes the form', async () => {
    const refs = makePostReferencesStub({
      canAdd: true,
      addLink: vi.fn(async () => makeReferenceItem(9, { kind: 'link' })),
    });
    renderPanel(refs);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar link' }));
    const dialog = screen.getByRole('dialog', { name: 'Adicionar link' });
    const address = within(dialog).getByLabelText('Endereço');
    expect(address).toHaveAttribute('type', 'url');
    expect(address).toHaveAttribute('inputmode', 'url');
    expect(within(dialog).getByText('Vamos completar com https:// se faltar.')).toBeInTheDocument();

    fireEvent.change(address, { target: { value: 'não é endereço' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar link' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Informe um endereço válido, começando com http ou https.',
    );
    expect(refs.addLink).not.toHaveBeenCalled();

    fireEvent.change(address, { target: { value: 'exemplo.com/post' } });
    fireEvent.change(within(dialog).getByLabelText('O que a equipe deve ver aqui? (opcional)'), {
      target: { value: 'O enquadramento' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar link' }));
    await waitFor(() =>
      expect(refs.addLink).toHaveBeenCalledWith({
        url: 'exemplo.com/post',
        title: undefined,
        note: 'O enquadramento',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Adicionar link' })).not.toBeInTheDocument(),
    );
  });

  it('keeps the link form open with the server error', async () => {
    const refs = makePostReferencesStub({
      canAdd: true,
      addLink: vi.fn(async () => {
        throw new PostReferenceError('post_not_pending');
      }),
    });
    renderPanel(refs);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar link' }));
    const dialog = screen.getByRole('dialog', { name: 'Adicionar link' });
    fireEvent.change(within(dialog).getByLabelText('Endereço'), {
      target: { value: 'https://exemplo.com' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar link' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Este post não está mais aguardando sua aprovação.',
    );
  });

  it('opens the phone sheet and goes from it to the link form', () => {
    renderPanel(makePostReferencesStub({ canAdd: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar referência' }));
    const sheet = screen.getByRole('dialog', { name: 'Adicionar referência' });
    expect(within(sheet).getByRole('button', { name: 'Foto, vídeo ou PDF' })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Link' }));
    expect(screen.queryByRole('dialog', { name: 'Adicionar referência' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Adicionar link' })).toBeInTheDocument();
  });

  it('uses 16px inputs on phones', () => {
    renderPanel(makePostReferencesStub({ canAdd: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar link' }));
    expect(screen.getByLabelText('Endereço').className).toContain('text-[16px]');
  });
});
```

Create `apps/hub/src/components/posts/references/__tests__/ReferenceViewer.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReferenceViewer } from '../ReferenceViewer';
import { makeReferenceItem } from '../../../../hooks/__tests__/postReferencesStub';

describe('ReferenceViewer', () => {
  it('shows an image', () => {
    render(<ReferenceViewer item={makeReferenceItem(1, { name: 'foto.jpg' })} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'foto.jpg' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'foto.jpg' })).toHaveAttribute(
      'src',
      'https://r2/get/1',
    );
  });

  it('plays a video inline with controls and falls back to the file on error', () => {
    const item = makeReferenceItem(2, {
      name: 'clip.mov',
      file_kind: 'video',
      mime_type: 'video/quicktime',
    });
    const { container } = render(<ReferenceViewer item={item} onClose={vi.fn()} />);
    const video = document.body.querySelector('video') as HTMLVideoElement;
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('playsinline');
    expect(video).toHaveAttribute('preload', 'metadata');
    fireEvent.error(video);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Não foi possível reproduzir aqui. Baixe o arquivo.',
    );
    expect(screen.getByRole('link', { name: 'Abrir o arquivo' })).toHaveAttribute(
      'href',
      'https://r2/get/2',
    );
    expect(container).toBeDefined();
  });

  it('closes from its button', () => {
    const onClose = vi.fn();
    render(<ReferenceViewer item={makeReferenceItem(1)} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar visualização' }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

Run:

```bash
npx vitest run apps/hub/src/components/posts/references
```

Expected: FAIL, `Failed to resolve import "../PostReferencesPanel"` and `"../ReferenceViewer"`.

- [ ] **Step 5: Thumbnails, tiles and the open target**

Create `apps/hub/src/components/posts/references/ReferenceTiles.tsx`:

```tsx
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Link2, Play } from 'lucide-react';
import { sanitizeExternalUrl } from '../../../lib/security';
import type { ReferenceItem } from '../../../types/postReferences';
import { formatDuration, referenceTitle } from './referenceFormat';

/** Square preview: image thumb, video poster with play and duration, PDF tile, link tile. */
export function ReferenceThumb({ item, size }: { item: ReferenceItem; size: number }) {
  const box = { width: size, height: size };
  const big = size >= 56;
  if (item.kind === 'link' || item.file_kind === 'document') {
    const Icon = item.kind === 'link' ? Link2 : FileText;
    return (
      <span
        style={box}
        className="shrink-0 rounded-[6px] hub-bg-soft hub-tx2 flex flex-col items-center justify-center gap-0.5"
      >
        <Icon size={big ? 20 : 13} aria-hidden="true" />
        {big && item.kind === 'file' && (
          <span className="text-[10px] font-semibold tracking-[0.04em]">PDF</span>
        )}
      </span>
    );
  }
  const src = item.thumbnail_url ?? (item.file_kind === 'image' ? item.url : null);
  return (
    <span style={box} className="relative block shrink-0 rounded-[6px] overflow-hidden hub-bg-soft">
      {item.blur_data_url?.startsWith('data:image/') && (
        <img
          src={item.blur_data_url}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
      {src && (
        <img src={src} alt="" loading="lazy" className="relative w-full h-full object-cover" />
      )}
      {item.file_kind === 'video' && (
        <>
          <span className="absolute inset-0 flex items-center justify-center">
            <span
              className={`${big ? 'w-6 h-6' : 'w-4 h-4'} rounded-full bg-black/55 flex items-center justify-center`}
            >
              <Play
                size={big ? 12 : 8}
                className="text-white fill-white ml-px"
                aria-hidden="true"
              />
            </span>
          </span>
          {big && item.duration_seconds != null && (
            <span className="absolute bottom-1 right-1 rounded-[3px] bg-black/65 px-1 text-[10px] leading-[14px] text-white tabular-nums">
              {formatDuration(item.duration_seconds)}
            </span>
          )}
        </>
      )}
    </span>
  );
}

interface ReferenceOpenProps {
  item: ReferenceItem;
  /** Image/video viewer. Without it, files open in a new tab like PDFs. */
  onOpen?: (item: ReferenceItem) => void;
  label: string;
  className?: string;
  /** A second, mouse-only target for the same item (the row thumb): hidden from AT and Tab. */
  decorative?: boolean;
  children: ReactNode;
}

/** Links and PDFs open in a new tab (sanitized URL); images and videos open the viewer. */
export function ReferenceOpen({
  item,
  onOpen,
  label,
  className,
  decorative = false,
  children,
}: ReferenceOpenProps) {
  const a11y = decorative
    ? { 'aria-hidden': true, tabIndex: -1 }
    : { 'aria-label': label };
  if (item.kind === 'link' || item.file_kind === 'document' || !onOpen) {
    const href = item.kind === 'link' ? item.link_url : item.url;
    return (
      <a
        href={sanitizeExternalUrl(href)}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        {...a11y}
      >
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={() => onOpen(item)} className={className} {...a11y}>
      {children}
    </button>
  );
}

/** 72px tiles under a client correction in the history. */
export function ReferenceTiles({
  items,
  onOpen,
}: {
  items: ReferenceItem[];
  onOpen?: (item: ReferenceItem) => void;
}) {
  const { t } = useTranslation('hubPosts');
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item.id}>
          <ReferenceOpen
            item={item}
            onOpen={onOpen}
            label={t('references.open', 'Abrir {{name}}', { name: referenceTitle(item) })}
            className="block rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hub-acc)]"
          >
            <ReferenceThumb item={item} size={72} />
          </ReferenceOpen>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 6: Rows (reference and upload)**

Create `apps/hub/src/components/posts/references/ReferenceRow.tsx`:

```tsx
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Film, ImageIcon, Loader2, Pencil, Trash2, X } from 'lucide-react';
import type { UploadEntry } from '../../../hooks/usePostReferences';
import { MAX_REFERENCE_NOTE } from '../../../services/postReferences';
import type { ReferenceErrorCode, ReferenceItem } from '../../../types/postReferences';
import { referenceErrorCode, referenceErrorMessage } from './referenceErrors';
import {
  REFERENCE_FIELD,
  formatMegabytes,
  formatReferenceWhen,
  referenceTitle,
} from './referenceFormat';
import { ReferenceOpen, ReferenceThumb } from './ReferenceTiles';

const ICON_BUTTON =
  'w-11 h-11 -mr-2 -mt-2 shrink-0 rounded-full flex items-center justify-center hub-tx3 hover:bg-[var(--hub-soft)] disabled:opacity-50';
const SMALL_BUTTON = 'rounded-[4px] px-3 py-2 min-h-[40px] text-[12.5px] font-semibold';

interface ReferenceRowProps {
  item: ReferenceItem;
  /** Uploaded by this card just now: the note field starts open. */
  fresh: boolean;
  onOpen: (item: ReferenceItem) => void;
  onSaveNote: (id: number, note: string) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
}

export function ReferenceRow({ item, fresh, onOpen, onSaveNote, onRemove }: ReferenceRowProps) {
  const { t, i18n } = useTranslation('hubPosts');
  const locale = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const [editing, setEditing] = useState(fresh && item.can_remove && !item.note);
  const [draft, setDraft] = useState(item.note ?? '');
  const [busy, setBusy] = useState<'note' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();
  const title = referenceTitle(item);
  const openLabel = t('references.open', 'Abrir {{name}}', { name: title });
  const meta = [
    t('references.you', 'Você'),
    formatReferenceWhen(item.created_at, locale, t),
    item.kind === 'file' && item.size_bytes != null
      ? formatMegabytes(item.size_bytes, locale)
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  async function saveNote() {
    if (busy) return;
    setBusy('note');
    setError(null);
    try {
      await onSaveNote(item.id, draft);
      setEditing(false);
    } catch (err) {
      setError(referenceErrorMessage(referenceErrorCode(err), t));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (busy) return;
    if (!window.confirm(t('references.removeConfirm', 'Remover referência?'))) return;
    setBusy('remove');
    setError(null);
    try {
      await onRemove(item.id);
    } catch (err) {
      setError(referenceErrorMessage(referenceErrorCode(err), t));
      setBusy(null);
    }
  }

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <ReferenceOpen
          item={item}
          onOpen={onOpen}
          label={openLabel}
          decorative
          className="shrink-0 rounded-[6px]"
        >
          <ReferenceThumb item={item} size={56} />
        </ReferenceOpen>
        <div className="min-w-0 flex-1 space-y-0.5">
          <ReferenceOpen
            item={item}
            onOpen={onOpen}
            label={openLabel}
            className="block text-left text-[13.5px] font-semibold hub-txt break-words line-clamp-2 hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hub-acc)] rounded-sm"
          >
            {title}
          </ReferenceOpen>
          {item.kind === 'link' && item.link_title && item.link_domain && (
            <p className="text-[12px] hub-tx3 truncate">{item.link_domain}</p>
          )}
          {item.note && !editing && (
            <p className="text-[13px] hub-tx2 whitespace-pre-wrap break-words">{item.note}</p>
          )}
          <p className="text-[12px] hub-tx3">{meta}</p>
          {item.can_remove && !editing && (
            <button
              type="button"
              onClick={() => {
                setDraft(item.note ?? '');
                setEditing(true);
              }}
              className="inline-flex items-center gap-1 min-h-[32px] text-[12px] font-semibold"
              style={{ color: 'var(--hub-acc)' }}
            >
              <Pencil size={12} aria-hidden="true" />
              {item.note
                ? t('references.editNote', 'Editar nota')
                : t('references.addNote', 'Adicionar nota')}
            </button>
          )}
        </div>
        {item.can_remove && (
          <button
            type="button"
            onClick={remove}
            disabled={busy !== null}
            aria-label={t('references.remove', 'Remover referência')}
            className={ICON_BUTTON}
          >
            {busy === 'remove' ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 size={16} aria-hidden="true" />
            )}
          </button>
        )}
      </div>
      {editing && (
        <div className="mt-2 space-y-2 sm:pl-[68px]">
          <label htmlFor={noteId} className="block text-[12.5px] font-semibold hub-tx2">
            {t('references.noteLabel', 'O que mudar com isso? (opcional)')}
          </label>
          <textarea
            id={noteId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_REFERENCE_NOTE}
            rows={2}
            className={`${REFERENCE_FIELD} resize-none`}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(item.note ?? '');
                setError(null);
              }}
              className={`hub-btn-secondary ${SMALL_BUTTON}`}
            >
              {t('references.cancel', 'Cancelar')}
            </button>
            <button
              type="button"
              onClick={saveNote}
              disabled={busy !== null}
              className={`hub-btn-primary ${SMALL_BUTTON} disabled:opacity-50`}
            >
              {busy === 'note'
                ? t('references.savingNote', 'Salvando...')
                : t('references.saveNote', 'Salvar nota')}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-rose-700 dark:text-rose-300">
          {error}
        </p>
      )}
    </li>
  );
}

/** Retrying cannot fix these: the file, the post or the quota has to change first. */
const NOT_RETRYABLE: ReadonlySet<ReferenceErrorCode> = new Set<ReferenceErrorCode>([
  'unsupported_type',
  'too_large',
  'reference_limit',
  'post_not_pending',
  'quota_exceeded',
]);

interface UploadRowProps {
  entry: UploadEntry;
  onCancel: (localId: string) => void;
  onRetry: (localId: string) => void;
}

export function UploadRow({ entry, onCancel, onRetry }: UploadRowProps) {
  const { t, i18n } = useTranslation('hubPosts');
  const locale = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const uploading = entry.status === 'uploading';
  const pct = entry.total > 0 ? Math.min(100, Math.round((entry.loaded / entry.total) * 100)) : 0;
  const Icon = entry.fileKind === 'video' ? Film : entry.fileKind === 'image' ? ImageIcon : FileText;
  const code = entry.error ?? 'internal';
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <span className="w-14 h-14 shrink-0 rounded-[6px] hub-bg-soft hub-tx3 flex items-center justify-center">
          <Icon size={20} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[13.5px] font-semibold hub-txt truncate">{entry.name}</p>
          {uploading ? (
            <>
              <div
                role="progressbar"
                aria-label={t('references.progressLabel', 'Envio de {{name}}', {
                  name: entry.name,
                })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                className="h-1.5 rounded-full hub-bg-soft overflow-hidden"
              >
                <div
                  className="h-full rounded-full transition-[width] duration-200"
                  style={{ width: `${pct}%`, background: 'var(--hub-acc)' }}
                />
              </div>
              <p className="text-[12px] hub-tx3">
                {t(
                  'references.uploading',
                  'Enviando {{loaded}} de {{total}}. Não feche esta tela.',
                  {
                    loaded: formatMegabytes(entry.loaded, locale),
                    total: formatMegabytes(entry.total, locale),
                  },
                )}
              </p>
            </>
          ) : (
            <>
              <p role="alert" className="text-[12px] text-rose-700 dark:text-rose-300">
                {referenceErrorMessage(code, t, {
                  fileKind: entry.fileKind,
                  sizeBytes: entry.total,
                })}
              </p>
              <div className="flex gap-2 pt-1">
                {!NOT_RETRYABLE.has(code) && (
                  <button
                    type="button"
                    onClick={() => onRetry(entry.localId)}
                    className={`hub-btn-secondary ${SMALL_BUTTON}`}
                  >
                    {t('references.retryUpload', 'Tentar novamente')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onCancel(entry.localId)}
                  className={`${SMALL_BUTTON} hub-tx2 hover:bg-[var(--hub-soft)]`}
                >
                  {t('references.discardUpload', 'Descartar')}
                </button>
              </div>
            </>
          )}
        </div>
        {uploading && (
          <button
            type="button"
            onClick={() => onCancel(entry.localId)}
            aria-label={t('references.cancelUpload', 'Cancelar envio de {{name}}', {
              name: entry.name,
            })}
            className={ICON_BUTTON}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}
```

- [ ] **Step 7: Sheet, link form and picker**

Create `apps/hub/src/components/posts/references/AddReferenceSheet.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { ImagePlus, Link2 } from 'lucide-react';
import { HubDialog } from '../../ui/HubDialog';

interface AddReferenceSheetProps {
  open: boolean;
  onClose: () => void;
  onPickFiles: () => void;
  onPickLink: () => void;
}

const OPTION =
  'w-full flex items-center gap-3 rounded-lg px-3 py-3 min-h-[52px] text-left text-[15px] font-semibold hub-txt hover:bg-[var(--hub-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hub-acc)]';

/** Phone bottom sheet (centered card on md+, same as RemarcarDialog): file or link. */
export function AddReferenceSheet({ open, onClose, onPickFiles, onPickLink }: AddReferenceSheetProps) {
  const { t } = useTranslation('hubPosts');
  if (!open) return null;
  return (
    <HubDialog
      open
      onRequestClose={onClose}
      title={t('references.sheetTitle', 'Adicionar referência')}
    >
      <div className="hub-bg-card w-full self-end md:self-center md:w-[min(400px,calc(100vw-3rem))] rounded-t-2xl md:rounded-xl shadow-2xl p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-1">
        <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full hub-bg-soft md:hidden" />
        <button type="button" onClick={onPickFiles} className={OPTION}>
          <ImagePlus size={20} aria-hidden="true" className="hub-tx2" />
          {t('references.sheetFile', 'Foto, vídeo ou PDF')}
        </button>
        <button type="button" onClick={onPickLink} className={OPTION}>
          <Link2 size={20} aria-hidden="true" className="hub-tx2" />
          {t('references.sheetLink', 'Link')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-lg px-3 py-3 min-h-[48px] text-[14px] font-semibold hub-tx2 hover:bg-[var(--hub-soft)]"
        >
          {t('references.cancel', 'Cancelar')}
        </button>
      </div>
    </HubDialog>
  );
}
```

Create `apps/hub/src/components/posts/references/ReferenceLinkForm.tsx`:

```tsx
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, X } from 'lucide-react';
import type { AddReferenceLinkInput } from '../../../hooks/usePostReferences';
import {
  MAX_REFERENCE_LINK_TITLE,
  MAX_REFERENCE_NOTE,
  MAX_REFERENCE_URL,
  normalizeReferenceUrl,
} from '../../../services/postReferences';
import { HubDialog } from '../../ui/HubDialog';
import { referenceErrorCode, referenceErrorMessage } from './referenceErrors';
import { REFERENCE_FIELD } from './referenceFormat';

interface ReferenceLinkFormProps {
  open: boolean;
  onClose: () => void;
  /** Resolves when the link exists (the parent closes the form); rejects with the server error. */
  onSubmit: (input: AddReferenceLinkInput) => Promise<unknown>;
}

/** Bottom sheet on phones, dialog on md+. */
export function ReferenceLinkForm({ open, onClose, onSubmit }: ReferenceLinkFormProps) {
  if (!open) return null;
  return <LinkFormBody onClose={onClose} onSubmit={onSubmit} />;
}

function LinkFormBody({ onClose, onSubmit }: Omit<ReferenceLinkFormProps, 'open'>) {
  const { t } = useTranslation('hubPosts');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { url: useId(), hint: useId(), title: useId(), note: useId() };

  const close = () => {
    if (!busy) onClose();
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!normalizeReferenceUrl(url)) {
      setError(referenceErrorMessage('invalid_url', t));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        url,
        title: title.trim() || undefined,
        note: note.trim() || undefined,
      });
    } catch (err) {
      setError(referenceErrorMessage(referenceErrorCode(err), t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <HubDialog open onRequestClose={close} title={t('references.link.title', 'Adicionar link')}>
      <form
        onSubmit={handleSubmit}
        noValidate
        className="hub-bg-card w-full self-end md:self-center md:w-[min(460px,calc(100vw-3rem))] rounded-t-2xl md:rounded-xl shadow-2xl p-5 space-y-4 max-h-[calc(100dvh-1rem)] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-semibold hub-txt">
            {t('references.link.title', 'Adicionar link')}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label={t('references.cancel', 'Cancelar')}
            className="hub-icon-btn p-1.5 rounded-md hub-tx3"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div>
          <label htmlFor={ids.url} className="block text-[12.5px] font-semibold hub-tx2 mb-1">
            {t('references.link.url', 'Endereço')}
          </label>
          <input
            id={ids.url}
            type="url"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={MAX_REFERENCE_URL}
            aria-describedby={ids.hint}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className={REFERENCE_FIELD}
          />
          <p id={ids.hint} className="mt-1 text-[12px] hub-tx3">
            {t('references.link.urlHint', 'Vamos completar com https:// se faltar.')}
          </p>
        </div>
        <div>
          <label htmlFor={ids.title} className="block text-[12.5px] font-semibold hub-tx2 mb-1">
            {t('references.link.linkTitle', 'Título (opcional)')}
          </label>
          <input
            id={ids.title}
            type="text"
            maxLength={MAX_REFERENCE_LINK_TITLE}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={REFERENCE_FIELD}
          />
        </div>
        <div>
          <label htmlFor={ids.note} className="block text-[12.5px] font-semibold hub-tx2 mb-1">
            {t('references.link.note', 'O que a equipe deve ver aqui? (opcional)')}
          </label>
          <textarea
            id={ids.note}
            maxLength={MAX_REFERENCE_NOTE}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={`${REFERENCE_FIELD} resize-none`}
          />
        </div>
        {error && (
          <p role="alert" className="text-[13px] font-medium text-rose-700 dark:text-rose-300">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="px-4 py-2.5 min-h-[44px] rounded-[4px] hub-btn-secondary text-[13px] font-semibold"
          >
            {t('references.cancel', 'Cancelar')}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-[4px] hub-btn-primary text-[13px] font-semibold disabled:opacity-50"
          >
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
            {t('references.link.submit', 'Adicionar link')}
          </button>
        </div>
      </form>
    </HubDialog>
  );
}
```

Create `apps/hub/src/components/posts/references/ReferencePicker.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Link2, Paperclip, Plus } from 'lucide-react';
import type { AddReferenceLinkInput, PostReferencesState } from '../../../hooks/usePostReferences';
import { REFERENCE_ACCEPT } from '../../../services/postReferences';
import type { ReferenceItem } from '../../../types/postReferences';
import { AddReferenceSheet } from './AddReferenceSheet';
import { ReferenceLinkForm } from './ReferenceLinkForm';

interface ReferencePickerProps {
  refs: PostReferencesState;
  /** panel: "Adicionar arquivo" + "Adicionar link" on md+, one sheet button on phones.
   *  composer: "Anexar referência" opening the sheet everywhere. */
  variant: 'panel' | 'composer';
  disabled?: boolean;
  /** Each reference added through this picker, as soon as it exists (the composer stages it). */
  onAdded?: (item: ReferenceItem) => void;
  /** True while the sheet or the link form is open, so the post card pauses its own keys. */
  onOverlayChange?: (open: boolean) => void;
}

const SECONDARY =
  'inline-flex items-center justify-center gap-1.5 hub-btn-secondary rounded-[4px] px-3 py-2 min-h-[44px] text-[13px] font-semibold disabled:opacity-50';

export function ReferencePicker({
  refs,
  variant,
  disabled = false,
  onAdded,
  onOverlayChange,
}: ReferencePickerProps) {
  const { t } = useTranslation('hubPosts');
  const inputRef = useRef<HTMLInputElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const overlay = sheetOpen || linkOpen;
  const onOverlayChangeRef = useRef(onOverlayChange);
  onOverlayChangeRef.current = onOverlayChange;
  // Balanced open/close reports: the sheet handing over to the link form stays "open".
  useEffect(() => {
    if (!overlay) return;
    onOverlayChangeRef.current?.(true);
    return () => onOverlayChangeRef.current?.(false);
  }, [overlay]);

  function openFilePicker() {
    setSheetOpen(false);
    // Synchronous inside the click, so the browser treats it as a user gesture.
    inputRef.current?.click();
  }

  function handleFiles(list: FileList | null) {
    const files = list ? Array.from(list) : [];
    // Reset so choosing the same file again still fires change.
    if (inputRef.current) inputRef.current.value = '';
    if (files.length > 0) void refs.startUploads(files, { onUploaded: onAdded });
  }

  async function submitLink(input: AddReferenceLinkInput) {
    const item = await refs.addLink(input);
    onAdded?.(item);
    setLinkOpen(false);
  }

  return (
    <>
      {variant === 'panel' ? (
        <>
          <div className="hidden md:flex flex-wrap gap-2">
            <button type="button" onClick={openFilePicker} disabled={disabled} className={SECONDARY}>
              <ImagePlus size={15} aria-hidden="true" />
              {t('references.addFile', 'Adicionar arquivo')}
            </button>
            <button
              type="button"
              onClick={() => setLinkOpen(true)}
              disabled={disabled}
              className={SECONDARY}
            >
              <Link2 size={15} aria-hidden="true" />
              {t('references.addLink', 'Adicionar link')}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            disabled={disabled}
            className={`md:hidden w-full ${SECONDARY}`}
          >
            <Plus size={15} aria-hidden="true" />
            {t('references.addReference', 'Adicionar referência')}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 min-h-[36px] text-[12.5px] font-semibold disabled:opacity-50"
          style={{ color: 'var(--hub-acc)' }}
        >
          <Paperclip size={14} aria-hidden="true" />
          {t('references.attach', 'Anexar referência')}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={REFERENCE_ACCEPT}
        className="hidden"
        data-testid={`reference-file-input-${variant}`}
        onChange={(e) => handleFiles(e.target.files)}
      />
      <AddReferenceSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onPickFiles={openFilePicker}
        onPickLink={() => {
          setSheetOpen(false);
          setLinkOpen(true);
        }}
      />
      <ReferenceLinkForm open={linkOpen} onClose={() => setLinkOpen(false)} onSubmit={submitLink} />
    </>
  );
}
```

- [ ] **Step 8: Viewer and panel**

Create `apps/hub/src/components/posts/references/ReferenceViewer.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { sanitizeExternalUrl } from '../../../lib/security';
import type { ReferenceItem } from '../../../types/postReferences';
import { HubDialog } from '../../ui/HubDialog';
import { referenceTitle } from './referenceFormat';

/**
 * Image or video preview. A nested HubDialog (portalled into .hub-root, not inside the
 * transformed .hub-fade-up page), so Escape closes only this layer.
 */
export function ReferenceViewer({ item, onClose }: { item: ReferenceItem; onClose: () => void }) {
  const { t } = useTranslation('hubPosts');
  const [failed, setFailed] = useState(false);
  const title = referenceTitle(item) || t('references.tab', 'Referências');
  return (
    <HubDialog open onRequestClose={onClose} title={title}>
      <div className="relative flex flex-col items-center gap-3 max-w-[92vw] max-h-[94dvh] px-3">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('references.viewer.close', 'Fechar visualização')}
          className="self-end w-10 h-10 rounded-full bg-white/20 text-white flex items-center justify-center ring-1 ring-white/20 hover:bg-white/30"
        >
          <X size={18} aria-hidden="true" />
        </button>
        {failed ? (
          <div className="hub-bg-card rounded-lg p-5 text-center space-y-2 max-w-[360px]">
            <p role="alert" className="text-[13px] hub-txt">
              {t('references.viewer.playError', 'Não foi possível reproduzir aqui. Baixe o arquivo.')}
            </p>
            <a
              href={sanitizeExternalUrl(item.url)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] font-semibold"
              style={{ color: 'var(--hub-acc)' }}
            >
              {t('references.viewer.openOriginal', 'Abrir o arquivo')}
            </a>
          </div>
        ) : item.file_kind === 'video' ? (
          <video
            src={item.url ?? undefined}
            poster={item.thumbnail_url ?? undefined}
            controls
            playsInline
            preload="metadata"
            onError={() => setFailed(true)}
            className="max-w-[92vw] max-h-[80dvh] rounded bg-black"
          />
        ) : (
          <img
            src={item.url ?? ''}
            alt={title}
            onError={() => setFailed(true)}
            className="max-w-[92vw] max-h-[80dvh] object-contain rounded"
          />
        )}
        {item.note && (
          <p className="max-w-[560px] text-center text-[13px] text-white/90 whitespace-pre-wrap">
            {item.note}
          </p>
        )}
      </div>
    </HubDialog>
  );
}
```

Create `apps/hub/src/components/posts/references/PostReferencesPanel.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Lock, Paperclip } from 'lucide-react';
import type { PostReferencesState } from '../../../hooks/usePostReferences';
import { MAX_REFERENCES_PER_POST } from '../../../services/postReferences';
import type { HubPost } from '../../../types';
import type { ReferenceItem } from '../../../types/postReferences';
import { ReferencePicker } from './ReferencePicker';
import { ReferenceRow, UploadRow } from './ReferenceRow';

interface PostReferencesPanelProps {
  post: HubPost;
  refs: PostReferencesState;
  onOpen: (item: ReferenceItem) => void;
  onOverlayChange?: (open: boolean) => void;
}

/** The Referências tab: rows, uploads in flight, and (while enviado_cliente) the add controls. */
export function PostReferencesPanel({ post, refs, onOpen, onOverlayChange }: PostReferencesPanelProps) {
  const { t } = useTranslation('hubPosts');
  const { data, isLoading, canAdd, items, uploads } = refs;

  if (!data) {
    return (
      <p className="text-[13px] hub-tx3">
        {isLoading
          ? t('references.loading', 'Carregando referências...')
          : t('references.loadError', 'Não foi possível carregar as referências.')}
      </p>
    );
  }

  const inFlight = uploads.filter((u) => u.status === 'uploading').length;
  const atCap = items.length + inFlight >= MAX_REFERENCES_PER_POST;
  const empty = items.length === 0 && uploads.length === 0;

  return (
    <div className="space-y-4">
      {!canAdd && (
        <p className="flex items-start gap-2 rounded-lg hub-bg-soft px-3 py-2.5 text-[12.5px] hub-tx2">
          <Lock size={14} aria-hidden="true" className="mt-[2px] shrink-0 hub-tx3" />
          {post.status === 'postado'
            ? t(
                'references.readOnlyPublished',
                'Post publicado. As referências ficam aqui para consulta.',
              )
            : t('references.readOnly', 'As referências ficam aqui para consulta.')}
        </p>
      )}
      {canAdd && empty && (
        <div className="rounded-lg border border-dashed hub-border px-4 py-6 text-center space-y-1">
          <Paperclip size={20} aria-hidden="true" className="mx-auto hub-tx3" />
          <p className="text-[13.5px] font-semibold hub-txt">
            {t('references.emptyTitle', 'Nenhuma referência ainda')}
          </p>
          <p className="text-[12.5px] hub-tx2">
            {t(
              'references.emptyBody',
              'Envie fotos, vídeos, PDFs ou links que ajudem a equipe a ajustar este post.',
            )}
          </p>
        </div>
      )}
      {uploads.length > 0 && (
        <ul
          aria-label={t('references.uploadsLabel', 'Envios em andamento')}
          className="divide-y divide-[var(--hub-bd)]"
        >
          {uploads.map((entry) => (
            <UploadRow
              key={entry.localId}
              entry={entry}
              onCancel={refs.cancelUpload}
              onRetry={refs.retryUpload}
            />
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <ul
          aria-label={t('references.listLabel', 'Referências do post')}
          className="divide-y divide-[var(--hub-bd)]"
        >
          {items.map((item) => (
            <ReferenceRow
              key={item.id}
              item={item}
              fresh={refs.freshIds.includes(item.id)}
              onOpen={onOpen}
              onSaveNote={refs.updateNote}
              onRemove={refs.remove}
            />
          ))}
        </ul>
      )}
      {canAdd && (
        <div className="space-y-2">
          <ReferencePicker
            refs={refs}
            variant="panel"
            disabled={atCap}
            onOverlayChange={onOverlayChange}
          />
          <p className="text-[12px] hub-tx3">
            {t(
              'references.hint',
              '{{n}} de 10 por post. Fotos e PDFs até 25 MB, vídeos até 200 MB.',
              { n: items.length },
            )}
          </p>
        </div>
      )}
    </div>
  );
}
```

Run: `npx vitest run apps/hub/src/components/posts/references`
Expected: PASS (`referenceErrors` 7, `PostReferencesPanel` 17, `ReferenceViewer` 3).

If `'starts uploads for every chosen file'` fails because jsdom rejects assigning `files`, keep
the test and switch that one interaction to
`await userEvent.upload(screen.getByTestId('reference-file-input-panel'), [a, b])`
(`@testing-library/user-event@14.6.7` is installed); the assertion stays the same.

- [ ] **Step 9: Stub the hook in the existing dialog and page tests**

`PostDetailContent` will call `usePostReferences`, which needs a QueryClient. The dialog test
renders without one (`PostDetailDialog.test.tsx:87-107`, no `QueryClientProvider`), and the page
tests mock `../../api` with fixed factories. Stub the hook in each file that opens the dialog.

In `apps/hub/src/components/posts/__tests__/PostDetailDialog.test.tsx`, after the
`vi.mock('../../../api', ...)` block (ends at line 18), add:

```ts
vi.mock('../../../hooks/usePostReferences', async () => {
  const { makePostReferencesStub } = await import('../../../hooks/__tests__/postReferencesStub');
  const stub = makePostReferencesStub();
  return { usePostReferences: () => stub };
});
```

`PostDetailDialog` is rendered only by `AprovacoesPage` and `PostagensPage`. Add the stub to every
page test that renders either page: `apps/hub/src/pages/__tests__/aprovacoesPage.test.tsx` (after
its `vi.mock('../../api', ...)` block, which ends at line 16),
`apps/hub/src/pages/__tests__/postagensPage.test.tsx` and
`apps/hub/src/pages/__tests__/postApprovalBrandPages.test.tsx` (renders both pages, lines 68-70),
each after its `vi.mock('../../api', ...)` block:

```ts
vi.mock('../../hooks/usePostReferences', async () => {
  const { makePostReferencesStub } = await import('../../hooks/__tests__/postReferencesStub');
  const stub = makePostReferencesStub();
  return { usePostReferences: () => stub };
});
```

Without the stub, a test that opens a post would run the real hook and the real service, whose
`fetch` is not covered by the `../../api` mocks (a network call from jsdom). Confirm coverage:

```bash
grep -rln "PostDetailDialog\|AprovacoesPage\|PostagensPage" apps/hub/src --include='*.test.tsx' \
  | xargs grep -L "usePostReferences"
```

Expected output: only `apps/hub/src/__tests__/router.test.tsx` (it mocks the pages entirely). Any
other file listed renders a page that can open a post: add the same stub there (adjusting the
relative path) before moving on.

- [ ] **Step 10: Write the failing dialog wiring test**

Create `apps/hub/src/components/posts/__tests__/PostDetailDialog.references.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HubContext } from '../../../HubContext';
import type { HubPost, HubPostMedia } from '../../../types';
import {
  makePostReferencesStub,
  makeReferenceItem,
} from '../../../hooks/__tests__/postReferencesStub';

const submitApprovalMock = vi.hoisted(() => vi.fn());
vi.mock('../../../api', () => ({
  submitApproval: submitApprovalMock,
  submitEditSuggestion: vi.fn(),
  fetchPostHistory: vi.fn().mockResolvedValue({ events: [], approvals: [] }),
}));
const refsState = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../../../hooks/usePostReferences', () => ({
  usePostReferences: () => refsState.current,
}));

import { PostDetailDialog } from '../PostDetailDialog';

const hubValue = {
  bootstrap: {
    workspace: { name: 'Mesaas', logo_url: '', brand_color: '#0f766e' },
    cliente_nome: 'C',
    is_active: true,
    cliente_id: 1,
  },
  token: 'token-publico',
  workspace: 'mesaas',
} as never;

const MEDIA: HubPostMedia = {
  id: 1,
  post_id: 1,
  kind: 'image',
  mime_type: 'image/jpeg',
  url: 'https://cdn/a.jpg',
  thumbnail_url: null,
  width: 1080,
  height: 1350,
  duration_seconds: null,
  is_cover: false,
  sort_order: 0,
};

function post(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 1,
    titulo: 'Primeiro',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: 'Corpo',
    scheduled_at: '2026-04-28T10:00:00.000Z',
    ig_caption: 'Legenda um',
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: 1,
    workflow_titulo: 'Editorial',
    workflow_created_at: null,
    media: [MEDIA],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    ...over,
  };
}

function tree(posts: HubPost[], onNavigate: (id: number | null) => void) {
  return (
    <HubContext.Provider value={hubValue}>
      <MemoryRouter>
        <PostDetailDialog
          posts={posts}
          currentId={posts[0].id}
          token="token-publico"
          approvals={[]}
          instagramProfile={null}
          isAutoPublish={() => false}
          onNavigate={onNavigate}
          onApprovalSubmitted={() => undefined}
        />
      </MemoryRouter>
    </HubContext.Provider>
  );
}

function renderDialog(posts: HubPost[] = [post(), post({ id: 2, titulo: 'Segundo' })]) {
  const onNavigate = vi.fn();
  const utils = render(tree(posts, onNavigate));
  return { onNavigate, rerender: () => utils.rerender(tree(posts, onNavigate)) };
}

const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent);

describe('PostDetailDialog references', () => {
  beforeEach(() => {
    submitApprovalMock.mockReset();
    refsState.current = makePostReferencesStub();
  });

  // The default post's body ('Corpo') differs from its caption, so Texto do post shows too:
  // the spec order is Legenda | Texto do post | Referências | Histórico e comentários.
  it('puts Referências between Texto do post and Histórico e comentários, with the count', () => {
    refsState.current = makePostReferencesStub({
      canAdd: true,
      items: [makeReferenceItem(1), makeReferenceItem(2)],
    });
    renderDialog();
    expect(tabNames()).toEqual([
      'Legenda',
      'Texto do post',
      'Referências 2',
      'Histórico e comentários',
    ]);
  });

  it('shows the tab with a zero count while the client can add', () => {
    refsState.current = makePostReferencesStub({ canAdd: true });
    renderDialog();
    expect(tabNames()).toEqual([
      'Legenda',
      'Texto do post',
      'Referências 0',
      'Histórico e comentários',
    ]);
  });

  it('hides the tab when nothing can be added and nothing was added', () => {
    renderDialog([post({ status: 'postado' })]);
    expect(tabNames()).toEqual(['Legenda', 'Texto do post', 'Histórico e comentários']);
  });

  it('keeps a read-only tab on a published post that has references', () => {
    refsState.current = makePostReferencesStub({
      canAdd: false,
      items: [makeReferenceItem(1, { can_remove: false })],
    });
    renderDialog([post({ status: 'postado' })]);
    fireEvent.click(screen.getByRole('tab', { name: /Referências/ }));
    expect(
      screen.getByText('Post publicado. As referências ficam aqui para consulta.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adicionar arquivo' })).not.toBeInTheDocument();
  });

  it('falls back to Legenda when the selected references tab disappears', () => {
    refsState.current = makePostReferencesStub({ canAdd: true });
    const { rerender } = renderDialog();
    fireEvent.click(screen.getByRole('tab', { name: /Referências/ }));
    expect(screen.getByRole('tab', { name: /Referências/ })).toHaveAttribute('aria-selected', 'true');
    refsState.current = makePostReferencesStub({ canAdd: false });
    rerender();
    expect(screen.getByRole('tab', { name: 'Legenda' })).toHaveAttribute('aria-selected', 'true');
  });

  it('disables Aprovar while an upload is in flight and says why', () => {
    refsState.current = makePostReferencesStub({
      canAdd: true,
      uploadsInFlight: true,
      uploads: [
        { localId: 'u', name: 'v.mp4', fileKind: 'video', loaded: 1, total: 2, status: 'uploading' },
      ],
    });
    renderDialog();
    const aprovar = screen.getByRole('button', { name: /Aprovar/ });
    expect(aprovar).toBeDisabled();
    expect(aprovar).toHaveAccessibleDescription('Aguarde o envio terminar');
    expect(screen.getByRole('button', { name: 'Post anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Próximo post' })).toBeDisabled();
  });

  it('asks before closing while an upload is in flight', () => {
    refsState.current = makePostReferencesStub({ canAdd: true, uploadsInFlight: true });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onNavigate } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar postagem' }));
    expect(confirm).toHaveBeenCalledWith(
      'Um envio ainda está em andamento. Sair e cancelar o envio?',
    );
    expect(onNavigate).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('opens an image in the viewer; Escape and arrows stay inside it', () => {
    refsState.current = makePostReferencesStub({
      canAdd: true,
      items: [makeReferenceItem(1, { name: 'foto.jpg' })],
    });
    const { onNavigate } = renderDialog();
    fireEvent.click(screen.getByRole('tab', { name: /Referências/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir foto.jpg' }));
    const viewer = screen.getByRole('dialog', { name: 'foto.jpg' });
    expect(within(viewer).getByRole('img', { name: 'foto.jpg' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNavigate).not.toHaveBeenCalled();

    fireEvent.keyDown(viewer, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'foto.jpg' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Primeiro' })).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('refreshes the references after an approval', async () => {
    const refs = makePostReferencesStub({ canAdd: true });
    refsState.current = refs;
    submitApprovalMock.mockResolvedValue({ ok: true });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /Aprovar/ }));
    await screen.findByText('Post aprovado!');
    expect(refs.refresh).toHaveBeenCalled();
  });
});
```

Run: `npx vitest run apps/hub/src/components/posts/__tests__/PostDetailDialog.references.test.tsx`
Expected: FAIL (no Referências tab yet; `tabNames()` returns `['Legenda', 'Texto do post', 'Histórico e comentários']`).

- [ ] **Step 11: Wire the tab into `PostDetailDialog.tsx`**

All edits in `apps/hub/src/components/posts/PostDetailDialog.tsx`.

(a) React import: add `useId` to the list on lines 1-9:

```ts
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
```

(b) After `import { usePostAdvance, type ConfirmFlash, type SlideDir } from '../../hooks/usePostAdvance';` add:

```ts
import { usePostReferences } from '../../hooks/usePostReferences';
import type { ReferenceItem } from '../../types/postReferences';
```

After `import { SuggestionDiff } from './SuggestionDiff';` add:

```ts
import { PostReferencesPanel } from './references/PostReferencesPanel';
import { ReferenceViewer } from './references/ReferenceViewer';
```

(c) Before `interface PostDetailDialogProps {` add:

```ts
type PostTab = 'content' | 'postText' | 'references' | 'history';
```

and replace `const [tab, setTab] = useState<'content' | 'postText' | 'history'>('content');` with
`const [tab, setTab] = useState<PostTab>('content');`.

(d) Replace

```ts
    draftIgCaption,
  } = edit;
  // Unsent-edit lock for navigation controls: while a save is queued/in flight, and
  // through the confirmation hold after an action.
  const navLocked = submitting || locked || (dirty && !saveFailed);
```

with

```ts
    draftIgCaption,
  } = edit;
  // One references query per post card. The outgoing ghost card reads the same cache entry.
  const refs = usePostReferences(token, post.id);
  const [viewerItem, setViewerItem] = useState<ReferenceItem | null>(null);
  // The add sheet and the link form are nested dialogs: while one is up, this card's arrow
  // keys and close path stand down (Radix already gives Escape to the top layer only).
  const [overlayDepth, setOverlayDepth] = useState(0);
  const handleOverlayChange = useCallback(
    (open: boolean) => setOverlayDepth((d) => Math.max(0, d + (open ? 1 : -1))),
    [],
  );
  const overlayOpen = viewerItem !== null || overlayDepth > 0;
  const waitHintId = useId();
  // Unsent-edit lock for navigation controls: while a save is queued/in flight, through the
  // confirmation hold after an action, and while a reference upload runs (moving would
  // unmount the card, which aborts it).
  const navLocked = submitting || locked || (dirty && !saveFailed) || refs.uploadsInFlight;
```

(e) Replace

```ts
  const tabKeys = showPostTextTab
    ? (['content', 'postText', 'history'] as const)
    : (['content', 'history'] as const);
  // A refetch (or a suggestion-view toggle) can flip showPostTextTab to false while the
  // postText tab is selected: fall back to content so the dialog never renders with no tab
  // selected and no panel shown.
  const activeTab = tab === 'postText' && !showPostTextTab ? 'content' : tab;
```

with

```ts
  // Referências shows while the client can still add (enviado_cliente, under the cap) or once
  // anything was added. A published post with none shows no tab.
  const showReferencesTab = refs.canAdd || refs.items.length > 0;
  const tabKeys: PostTab[] = [
    'content',
    ...(showPostTextTab ? (['postText'] as const) : []),
    ...(showReferencesTab ? (['references'] as const) : []),
    'history',
  ];
  // A refetch (or a suggestion-view toggle) can hide the selected postText or references tab:
  // fall back to content so the dialog never renders with no tab selected and no panel shown.
  const activeTab: PostTab =
    (tab === 'postText' && !showPostTextTab) || (tab === 'references' && !showReferencesTab)
      ? 'content'
      : tab;
```

(f) Replace the `guard` callback

```ts
  const guard = useCallback((): boolean => {
    if (submitting) return false;
    if (dirty && !saveFailed) return false;
    if (!saveFailed && !panelDirty && !historyDirty) return true;
    if (
      !window.confirm(t('shared.discardCorrectionConfirm', 'Descartar as alterações não enviadas?'))
    )
      return false;
    if (saveFailed) discardFailedSave();
    return true;
  }, [dirty, saveFailed, discardFailedSave, submitting, panelDirty, historyDirty, t]);
```

with

```ts
  const guard = useCallback((): boolean => {
    if (submitting) return false;
    if (dirty && !saveFailed) return false;
    const uploading = refs.uploadsInFlight;
    if (!saveFailed && !panelDirty && !historyDirty && !uploading) return true;
    // Still one confirm total. Leaving unmounts the card; usePostReferences aborts on unmount.
    const message = uploading
      ? t(
          'references.leaveWhileUploading',
          'Um envio ainda está em andamento. Sair e cancelar o envio?',
        )
      : t('shared.discardCorrectionConfirm', 'Descartar as alterações não enviadas?');
    if (!window.confirm(message)) return false;
    if (saveFailed) discardFailedSave();
    return true;
  }, [
    dirty,
    saveFailed,
    discardFailedSave,
    submitting,
    panelDirty,
    historyDirty,
    refs.uploadsInFlight,
    t,
  ]);
```

(g) In `close`, replace

```ts
    if (lightboxIdx !== null) return;
    if (!guard()) return;
    onCancelHold();
    onNavigate(null);
  }, [guard, onCancelHold, onNavigate, lightboxIdx]);
```

with

```ts
    if (lightboxIdx !== null || overlayOpen) return;
    if (!guard()) return;
    onCancelHold();
    onNavigate(null);
  }, [guard, onCancelHold, onNavigate, lightboxIdx, overlayOpen]);
```

(h) In the arrow-key effect, replace

```ts
      if (lightboxIdx !== null) return;
      if (e.key === 'ArrowLeft') go(nav.prev);
      if (e.key === 'ArrowRight') go(nav.next);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, nav.prev, nav.next, lightboxIdx, ghost]);
```

with

```ts
      if (lightboxIdx !== null || overlayOpen) return;
      if (e.key === 'ArrowLeft') go(nav.prev);
      if (e.key === 'ArrowRight') go(nav.next);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, nav.prev, nav.next, lightboxIdx, overlayOpen, ghost]);
```

(i) In `submit`, replace

```ts
      else res = await submitApproval(token, post.id, 'aprovado', undefined);
      setPanelDirty(false);
```

with

```ts
      else res = await submitApproval(token, post.id, 'aprovado', undefined);
      setPanelDirty(false);
      // The post just left enviado_cliente: can_add, can_remove and approval links changed.
      refs.refresh();
```

(j) Replace the tab label expression

```tsx
                  {key === 'history'
                    ? t('posts.tabHistory', 'Histórico e comentários')
                    : key === 'postText'
                      ? t('posts.tabPostText', 'Texto do post')
                      : kind === 'text'
                        ? t('posts.tabText', 'Texto')
                        : t('posts.tabCaption', 'Legenda')}
```

with

```tsx
                  {key === 'history' ? (
                    t('posts.tabHistory', 'Histórico e comentários')
                  ) : key === 'postText' ? (
                    t('posts.tabPostText', 'Texto do post')
                  ) : key === 'references' ? (
                    <span className="inline-flex items-center gap-1.5">
                      {t('references.tab', 'Referências')}{' '}
                      {refs.data && (
                        <span className="min-w-[18px] h-[18px] px-1 rounded-full hub-bg-soft hub-tx2 text-[11px] leading-[18px] text-center tabular-nums">
                          {refs.items.length}
                        </span>
                      )}
                    </span>
                  ) : kind === 'text' ? (
                    t('posts.tabText', 'Texto')
                  ) : (
                    t('posts.tabCaption', 'Legenda')
                  )}
```

(k) Insert the panel right before `              <div hidden={activeTab !== 'content'}>`:

```tsx
              {showReferencesTab && activeTab === 'references' && (
                <PostReferencesPanel
                  post={post}
                  refs={refs}
                  onOpen={setViewerItem}
                  onOverlayChange={handleOverlayChange}
                />
              )}
```

(l) Footer. Replace

```tsx
              {isPending ? (
                <div className="flex gap-2">
```

with

```tsx
              {isPending ? (
                <>
                <div className="flex gap-2">
```

replace

```tsx
                      disabled={submitting || locked || approvalBlocked || dirty || panelDirty}
```

with

```tsx
                      disabled={
                        submitting ||
                        locked ||
                        approvalBlocked ||
                        dirty ||
                        panelDirty ||
                        refs.uploadsInFlight
                      }
                      aria-describedby={refs.uploadsInFlight ? waitHintId : undefined}
```

and replace

```tsx
                </div>
              ) : post.status === 'postado' && post.instagram_permalink ? (
```

with

```tsx
                </div>
                {refs.uploadsInFlight && (
                  <p id={waitHintId} className="text-[12px] hub-tx3 text-center">
                    {t('references.waitUpload', 'Aguarde o envio terminar')}
                  </p>
                )}
                </>
              ) : post.status === 'postado' && post.instagram_permalink ? (
```

(m) Render the viewer next to the lightbox. Replace

```tsx
          onStaleUrl={onApprovalSubmitted}
        />
      )}
    </>
  );
}
```

with

```tsx
          onStaleUrl={onApprovalSubmitted}
        />
      )}
      {!ghost && viewerItem && (
        <ReferenceViewer item={viewerItem} onClose={() => setViewerItem(null)} />
      )}
    </>
  );
}
```

Run:

```bash
npx prettier --write apps/hub/src/components/posts/PostDetailDialog.tsx
npx vitest run apps/hub/src/components/posts apps/hub/src/pages/__tests__/aprovacoesPage.test.tsx apps/hub/src/pages/__tests__/postagensPage.test.tsx
```

Expected: PASS, including every pre-existing `PostDetailDialog.test.tsx` case (the stub reports
`canAdd: false` and no items, so the old tab lists and the "2 dialogs" lightbox test are unchanged).

- [ ] **Step 12: Typecheck, lint, format**

```bash
npx prettier --write apps/hub/src/components/posts apps/hub/src/hooks/__tests__/postReferencesStub.ts \
  apps/hub/src/pages/__tests__/aprovacoesPage.test.tsx apps/hub/src/pages/__tests__/postagensPage.test.tsx \
  apps/hub/src/pages/__tests__/postApprovalBrandPages.test.tsx \
  apps/hub/src/lib/__tests__/hubPostsLocale.test.ts
npx tsc -p apps/hub/tsconfig.json --noEmit
npm run lint
npm run format:check
npx vitest run apps/hub
```

Expected: tsc silent, exit 0; lint 0 errors; `All matched files use Prettier code style!`; all Hub
test files pass.

- [ ] **Step 13: Browser check (Hub on :5175, phone and desktop, light and dark)**

`node scripts/with-env.mjs npm run dev:hub --` from the worktree (the `dev:env` pattern: `.env`
comes from the main checkout; there is no `dev:hub:env` script). It must run on :5175, the only
local port prod CORS admits; staging's `ALLOWED_ORIGINS` admits no localhost, so local dev cannot
reach staging. Reads work against prod; for writes either patch `fetch` in the Browser pane to
fake `hub-post-references` responses (memory: hub repro via patched fetch), or check the deployed
staging Hub once `hub-post-references` is on staging. Check at 375px and desktop: tab order and pill, empty
state, the phone sheet sits at the bottom, 16px fields do not zoom on iOS, upload progress row,
note field after upload, viewer over the dialog (Escape closes only the viewer), Aprovar disabled
with the hint during an upload, read-only notice on a published post, and both themes.

- [ ] **Step 14: Commit**

```bash
git add apps/hub/src/components/posts apps/hub/src/hooks/__tests__/postReferencesStub.ts \
  apps/hub/src/pages/__tests__/aprovacoesPage.test.tsx apps/hub/src/pages/__tests__/postagensPage.test.tsx \
  apps/hub/src/pages/__tests__/postApprovalBrandPages.test.tsx \
  apps/hub/src/lib/__tests__/hubPostsLocale.test.ts packages/i18n/locales/pt/hubPosts.json \
  packages/i18n/locales/en/hubPosts.json
git commit -m "$(cat <<'EOF'
feat(hub): Referências tab in the post dialog

Clients attach photos, videos, PDFs and links to a post awaiting approval,
with notes, upload progress and cancel; read-only once the post moves on.
Aprovar waits for uploads in flight.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 9: References in the correction composer and the history

**Files:**
- Modify: `apps/hub/src/api.ts` (`submitApproval` gains `referenceIds`)
- Modify: `apps/hub/src/components/posts/CorrectionPanel.tsx`
- Modify: `apps/hub/src/lib/postHistory.ts` (approval entries carry `approvalId`)
- Modify: `apps/hub/src/components/PostHistoryPanel.tsx`
- Modify: `apps/hub/src/components/posts/PostDetailDialog.tsx` (pass refs to both)
- Modify: `apps/hub/src/__tests__/api.test.ts`
- Modify: `apps/hub/src/lib/__tests__/postHistory.test.ts`
- Modify: `apps/hub/src/components/posts/__tests__/PostDetailDialog.references.test.tsx`
- Test: `apps/hub/src/components/posts/__tests__/CorrectionPanel.references.test.tsx`
- Test: `apps/hub/src/components/__tests__/PostHistoryPanel.references.test.tsx`

**Interfaces:**

```ts
// api.ts
export function submitApproval(
  token: string, post_id: number, action: 'aprovado' | 'correcao' | 'mensagem',
  comentario?: string, motivo?: CorrectionReason, referenceIds?: number[],
): Promise<{ ok: boolean; scheduled?: boolean }>;   // body gets reference_ids only for a non-empty correcao

// CorrectionPanel props (new/changed)
onSubmitCorrection: (comentario: string, motivo: CorrectionReason | null, referenceIds?: number[]) => void;
references?: PostReferencesState;                       // absent: no attach control (old behaviour)
onOpenReference?: (item: ReferenceItem) => void;
onOverlayChange?: (open: boolean) => void;

// postHistory.ts HistoryEntry, approval variant
{ kind: 'approval'; ...; approvalId: number }

// PostHistoryPanel props (new)
references?: ReferenceItem[];
onOpenReference?: (item: ReferenceItem) => void;
```

Call-shape decision (keeps existing assertions intact): `onSubmitCorrection` and
`submitApproval` receive the extra `referenceIds` argument **only when at least one reference is
staged**. `toHaveBeenCalledWith` compares argument arrays by length, so the existing
`CorrectionPanel.test.tsx:88,107` (`('', null)`, `('Trocar a data', 'texto')`),
`PostDetailDialog.test.tsx:502,569` and `api.test.ts:359-373` keep passing unchanged.

- [ ] **Step 1: `submitApproval` sends `reference_ids` (test first)**

In `apps/hub/src/__tests__/api.test.ts`, add inside `describe('hub api client', ...)`, after the
`'sends motivo with a correcao and omits it otherwise'` test:

```ts
  it('sends reference_ids with a correcao only when there are some', async () => {
    fetchHarness.queueResponse({ json: { ok: true } });
    await submitApproval('token-hub', 12, 'correcao', 'Trocar', undefined, [3, 4]);
    expect(JSON.parse(String(fetchHarness.calls[0].init?.body))).toEqual({
      token: 'token-hub',
      post_id: 12,
      action: 'correcao',
      comentario: 'Trocar',
      reference_ids: [3, 4],
    });

    fetchHarness.queueResponse({ json: { ok: true } });
    await submitApproval('token-hub', 12, 'correcao', 'Trocar', undefined, []);
    expect(JSON.parse(String(fetchHarness.calls[1].init?.body))).not.toHaveProperty(
      'reference_ids',
    );

    fetchHarness.queueResponse({ json: { ok: true } });
    await submitApproval('token-hub', 12, 'aprovado', undefined, undefined, [3]);
    expect(JSON.parse(String(fetchHarness.calls[2].init?.body))).not.toHaveProperty(
      'reference_ids',
    );
  });
```

Run: `npx vitest run apps/hub/src/__tests__/api.test.ts`
Expected: FAIL on `reference_ids` missing from the first body.

In `apps/hub/src/api.ts` replace

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
```

with

```ts
export function submitApproval(
  token: string,
  post_id: number,
  action: 'aprovado' | 'correcao' | 'mensagem',
  comentario?: string,
  motivo?: CorrectionReason,
  /** Post references staged in the correction composer; hub-approve links them to the approval. */
  referenceIds?: number[],
) {
  return post<{ ok: boolean; scheduled?: boolean }>('hub-approve', {
    token,
    post_id,
    action,
    comentario,
    ...(motivo ? { motivo } : {}),
    ...(action === 'correcao' && referenceIds && referenceIds.length > 0
      ? { reference_ids: referenceIds }
      : {}),
  });
}
```

Run: `npx vitest run apps/hub/src/__tests__/api.test.ts`
Expected: PASS.

- [ ] **Step 2: Write the failing composer test**

Create `apps/hub/src/components/posts/__tests__/CorrectionPanel.references.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CorrectionPanel } from '../CorrectionPanel';
import type { HubPost } from '../../../types';
import type { useEditSuggestion } from '../../../hooks/useEditSuggestion';
import type { PostReferencesState } from '../../../hooks/usePostReferences';
import type { ReferenceItem } from '../../../types/postReferences';
import {
  makePostReferencesStub,
  makeReferenceItem,
} from '../../../hooks/__tests__/postReferencesStub';

type Edit = ReturnType<typeof useEditSuggestion>;

function makeEdit(): Edit {
  return {
    isEditable: true,
    hasPendingSuggestion: false,
    wasRejected: false,
    saveSuggestion: vi.fn(),
    saveState: 'idle',
    approvalBlocked: false,
    dirty: false,
    saveFailed: false,
    discardFailedSave: vi.fn(),
    draftConteudo: null,
    draftConteudoPlain: 'Corpo do post',
    draftIgCaption: 'Legenda original',
    suggestion: null,
  };
}

const POST: HubPost = {
  id: 10,
  titulo: 'Post',
  tipo: 'feed',
  status: 'enviado_cliente',
  ordem: 1,
  conteudo: null,
  conteudo_plain: 'Corpo do post',
  scheduled_at: null,
  ig_caption: 'Legenda original',
  instagram_permalink: null,
  published_at: null,
  publish_error: null,
  workflow_id: null,
  workflow_titulo: null,
  workflow_created_at: null,
  media: [],
  cover_media: null,
  pending_suggestion: null,
  suggestion_rejected_at: null,
};

const ITEM7 = makeReferenceItem(7, { name: 'f7.jpg' });

/** A stub whose upload "finishes" at once and reports the item through onUploaded. */
function attachingRefs(items: ReferenceItem[] = [ITEM7]): PostReferencesState {
  return makePostReferencesStub({
    canAdd: true,
    items,
    startUploads: vi.fn(async (_files: File[], opts?: { onUploaded?: (i: ReferenceItem) => void }) => {
      opts?.onUploaded?.(ITEM7);
      return [ITEM7];
    }),
  });
}

function renderPanel(references: PostReferencesState | undefined) {
  const onSubmitCorrection = vi.fn();
  const onDirtyChange = vi.fn();
  const element = (refs: PostReferencesState | undefined) => (
    <CorrectionPanel
      post={POST}
      edit={makeEdit()}
      submitting={false}
      onSubmitCorrection={onSubmitCorrection}
      onDirtyChange={onDirtyChange}
      references={refs}
    />
  );
  const utils = render(element(references));
  return {
    onSubmitCorrection,
    onDirtyChange,
    rerender: (refs: PostReferencesState | undefined) => utils.rerender(element(refs)),
  };
}

function attachFile() {
  fireEvent.change(screen.getByTestId('reference-file-input-composer'), {
    target: { files: [new File(['x'], 'f7.jpg', { type: 'image/jpeg' })] },
  });
}

describe('CorrectionPanel references', () => {
  it('has no attach control without references, or when nothing can be added', () => {
    const { rerender } = renderPanel(undefined);
    expect(screen.queryByRole('button', { name: 'Anexar referência' })).not.toBeInTheDocument();
    rerender(makePostReferencesStub({ canAdd: false }));
    expect(screen.queryByRole('button', { name: 'Anexar referência' })).not.toBeInTheDocument();
  });

  it('offers Anexar referência with the helper line, opening the same sheet', () => {
    renderPanel(attachingRefs([]));
    expect(
      screen.getByText('As referências anexadas também ficam na aba Referências deste post.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Anexar referência' }));
    const sheet = screen.getByRole('dialog', { name: 'Adicionar referência' });
    expect(within(sheet).getByRole('button', { name: 'Foto, vídeo ou PDF' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Link' })).toBeInTheDocument();
  });

  it('stages an uploaded reference and sends its id with the correction', () => {
    const { onSubmitCorrection, onDirtyChange } = renderPanel(attachingRefs());
    attachFile();
    const staged = screen.getByRole('list', { name: 'Referências desta correção' });
    expect(within(staged).getByText('f7.jpg')).toBeInTheDocument();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: /Enviar correção/ }));
    expect(onSubmitCorrection).toHaveBeenCalledWith('', null, [7]);
  });

  it('unstaging leaves the reference in place but out of the correction', () => {
    const refs = attachingRefs();
    const { onSubmitCorrection } = renderPanel(refs);
    attachFile();
    fireEvent.click(screen.getByRole('button', { name: 'Tirar f7.jpg da correção' }));
    expect(screen.queryByText('f7.jpg')).not.toBeInTheDocument();
    expect(refs.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Enviar correção/ }));
    expect(onSubmitCorrection).toHaveBeenCalledWith('', null);
  });

  it('drops a staged id once the reference is gone', () => {
    const { onSubmitCorrection, rerender } = renderPanel(attachingRefs());
    attachFile();
    rerender(makePostReferencesStub({ canAdd: true, items: [] }));
    expect(
      screen.queryByRole('button', { name: 'Tirar f7.jpg da correção' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Enviar correção/ }));
    expect(onSubmitCorrection).toHaveBeenCalledWith('', null);
  });

  it('disables Enviar correção while an upload is in flight and says why', () => {
    renderPanel(
      makePostReferencesStub({
        canAdd: true,
        uploadsInFlight: true,
        uploads: [
          {
            localId: 'u',
            name: 'f9.mp4',
            fileKind: 'video',
            loaded: 1,
            total: 2,
            status: 'uploading',
          },
        ],
      }),
    );
    const send = screen.getByRole('button', { name: /Enviar correção/ });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription('Aguarde o envio terminar');
    expect(
      within(screen.getByRole('list', { name: 'Referências desta correção' })).getByText('f9.mp4'),
    ).toBeInTheDocument();
  });

  it('shows a failed upload in the composer with its error copy', () => {
    renderPanel(
      makePostReferencesStub({
        canAdd: true,
        uploads: [
          {
            localId: 'u',
            name: 'x.svg',
            fileKind: 'document',
            loaded: 0,
            total: 10,
            status: 'error',
            error: 'unsupported_type',
          },
        ],
      }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'x.svg: Esse tipo de arquivo não é aceito. Envie foto, vídeo ou PDF.',
    );
  });
});
```

Run: `npx vitest run apps/hub/src/components/posts/__tests__/CorrectionPanel.references.test.tsx`
Expected: FAIL (`Unable to find ... "Anexar referência"`; `references` is not a prop yet).

- [ ] **Step 3: Implement the composer**

All edits in `apps/hub/src/components/posts/CorrectionPanel.tsx`.

(a) Imports. Replace

```ts
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertCircle, Save } from 'lucide-react';
import type { CorrectionReason, HubPost } from '../../types';
import type { useEditSuggestion } from '../../hooks/useEditSuggestion';
```

with

```ts
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertCircle, Loader2, Save, X } from 'lucide-react';
import type { CorrectionReason, HubPost } from '../../types';
import type { useEditSuggestion } from '../../hooks/useEditSuggestion';
import type { PostReferencesState } from '../../hooks/usePostReferences';
import type { ReferenceItem } from '../../types/postReferences';
import { ReferencePicker } from './references/ReferencePicker';
import { ReferenceOpen, ReferenceThumb } from './references/ReferenceTiles';
import { referenceErrorMessage } from './references/referenceErrors';
import { referenceTitle } from './references/referenceFormat';
```

(b) Props. Replace

```ts
  submitting: boolean;
  onSubmitCorrection: (comentario: string, motivo: CorrectionReason | null) => void;
```

with

```ts
  submitting: boolean;
  /** `referenceIds` is passed only when references are staged (so old call shapes still hold). */
  onSubmitCorrection: (
    comentario: string,
    motivo: CorrectionReason | null,
    referenceIds?: number[],
  ) => void;
```

and replace

```ts
  saveSlot?: HTMLElement | null;
}
```

(the end of `CorrectionPanelProps`) with

```ts
  saveSlot?: HTMLElement | null;
  /** The post's references (usePostReferences, called once by the dialog). Absent: no attach. */
  references?: PostReferencesState;
  onOpenReference?: (item: ReferenceItem) => void;
  /** Sheet or link form open, so the dialog pauses its arrow keys and close path. */
  onOverlayChange?: (open: boolean) => void;
}
```

(c) Destructuring. Replace

```ts
  onSavedClean,
  saveSlot,
}: CorrectionPanelProps) {
```

with

```ts
  onSavedClean,
  saveSlot,
  references,
  onOpenReference,
  onOverlayChange,
}: CorrectionPanelProps) {
```

(d) State. Replace

```ts
  const [motivo, setMotivo] = useState<CorrectionReason | null>(null);
```

with

```ts
  const [motivo, setMotivo] = useState<CorrectionReason | null>(null);
  // Ids of references added from this composer and still meant for this correction.
  const [stagedIds, setStagedIds] = useState<number[]>([]);
  const waitHintId = useId();
```

(e) Dirty flags. Replace

```ts
  const panelDirty = contentDirty || comentario.trim() !== '' || motivo !== null;
```

with

```ts
  // Staged references that still exist: one removed in the Referências tab drops out here too
  // (a failed upload never gets staged).
  const stagedItems: ReferenceItem[] = references
    ? stagedIds.flatMap((id) => references.items.filter((item) => item.id === id))
    : [];
  const uploadsInFlight = references?.uploadsInFlight ?? false;
  const panelDirty =
    contentDirty || comentario.trim() !== '' || motivo !== null || stagedItems.length > 0;

  function sendCorrection() {
    const ids = stagedItems.map((item) => item.id);
    if (ids.length > 0) onSubmitCorrection(comentario.trim(), motivo, ids);
    else onSubmitCorrection(comentario.trim(), motivo);
  }
```

(f) Composer UI and the send button. Replace

```tsx
          className="hub-focus-accent w-full rounded-lg border hub-border px-3 py-2.5 text-[13px] resize-none min-h-[70px] hub-bg-card hub-txt placeholder:text-[var(--hub-tx3)] focus:outline-none focus:border-[var(--hub-bd2)] transition-all"
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onSubmitCorrection(comentario.trim(), motivo)}
            disabled={submitting || approvalBlocked || dirty || contentDirty}
            className="flex items-center gap-1.5 hub-btn-secondary rounded-[4px] py-2 px-3 text-[12px] font-semibold disabled:opacity-50 transition-colors"
          >
            <AlertCircle size={14} /> {t('shared.enviarCorrecao', 'Enviar correção')}
          </button>
        </div>
```

with

```tsx
          className="hub-focus-accent w-full rounded-lg border hub-border px-3 py-2.5 text-[13px] resize-none min-h-[70px] hub-bg-card hub-txt placeholder:text-[var(--hub-tx3)] focus:outline-none focus:border-[var(--hub-bd2)] transition-all"
        />
        {references && (references.canAdd || stagedItems.length > 0) && (
          <div className="space-y-2">
            {(stagedItems.length > 0 || references.uploads.length > 0) && (
              <ul
                aria-label={t('references.composer.staged', 'Referências desta correção')}
                className="flex flex-wrap gap-1.5"
              >
                {stagedItems.map((item) => {
                  const name = referenceTitle(item);
                  return (
                    <li
                      key={item.id}
                      className="inline-flex items-center gap-1.5 max-w-full rounded-full border hub-border hub-bg-card py-1 pl-1 pr-1.5"
                    >
                      <ReferenceOpen
                        item={item}
                        onOpen={onOpenReference}
                        label={t('references.open', 'Abrir {{name}}', { name })}
                        className="inline-flex items-center gap-1.5 min-w-0 rounded-full"
                      >
                        <ReferenceThumb item={item} size={24} />
                        <span className="truncate max-w-[160px] text-[12px] hub-txt">{name}</span>
                      </ReferenceOpen>
                      <button
                        type="button"
                        onClick={() => setStagedIds((ids) => ids.filter((id) => id !== item.id))}
                        aria-label={t('references.composer.unstage', 'Tirar {{name}} da correção', {
                          name,
                        })}
                        className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center hub-tx3 hover:bg-[var(--hub-soft)]"
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
                {references.uploads.map((entry) =>
                  entry.status === 'uploading' ? (
                    <li
                      key={entry.localId}
                      className="inline-flex items-center gap-1.5 rounded-full border hub-border px-2.5 py-1 text-[12px] hub-tx3"
                    >
                      <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                      <span className="truncate max-w-[160px]">{entry.name}</span>
                    </li>
                  ) : (
                    <li
                      key={entry.localId}
                      role="alert"
                      className="w-full text-[12px] text-rose-700 dark:text-rose-300"
                    >
                      {entry.name}:{' '}
                      {referenceErrorMessage(entry.error ?? 'internal', t, {
                        fileKind: entry.fileKind,
                        sizeBytes: entry.total,
                      })}
                    </li>
                  ),
                )}
              </ul>
            )}
            {references.canAdd && (
              <ReferencePicker
                refs={references}
                variant="composer"
                disabled={submitting || approvalBlocked}
                onAdded={(item) =>
                  setStagedIds((ids) => (ids.includes(item.id) ? ids : [...ids, item.id]))
                }
                onOverlayChange={onOverlayChange}
              />
            )}
            <p className="text-[12px] hub-tx3">
              {t(
                'references.composer.helper',
                'As referências anexadas também ficam na aba Referências deste post.',
              )}
            </p>
          </div>
        )}
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={sendCorrection}
            disabled={submitting || approvalBlocked || dirty || contentDirty || uploadsInFlight}
            aria-describedby={uploadsInFlight ? waitHintId : undefined}
            className="flex items-center gap-1.5 hub-btn-secondary rounded-[4px] py-2 px-3 text-[12px] font-semibold disabled:opacity-50 transition-colors"
          >
            <AlertCircle size={14} /> {t('shared.enviarCorrecao', 'Enviar correção')}
          </button>
          {uploadsInFlight && (
            <p id={waitHintId} className="text-[12px] hub-tx3">
              {t('references.waitUpload', 'Aguarde o envio terminar')}
            </p>
          )}
        </div>
```

Run:

```bash
npx vitest run apps/hub/src/components/posts/__tests__/CorrectionPanel.references.test.tsx \
  apps/hub/src/components/posts/__tests__/CorrectionPanel.test.tsx \
  apps/hub/src/components/posts/__tests__/CorrectionPanel.formatInFlight.test.tsx
```

Expected: PASS (7 new tests; the existing ones unchanged since `references` is absent there).

- [ ] **Step 4: History entries carry the approval id (test first)**

In `apps/hub/src/lib/__tests__/postHistory.test.ts`, the test whose fixture has
`ap({ id: 10, action: 'correcao', motivo: 'legenda', comentario: 'ajustar', ... })` (lines
259-265) asserts `entries[1]` at line 291. Replace that assertion with:

```ts
    expect(entries[1]).toMatchObject({
      kind: 'approval',
      approvalId: 10,
      action: 'correcao',
      motivo: 'legenda',
      comentario: 'ajustar',
      byTeam: false,
    });
```

Run: `npx vitest run apps/hub/src/lib/__tests__/postHistory.test.ts`
Expected: FAIL (`approvalId` missing).

In `apps/hub/src/lib/postHistory.ts`, in the `HistoryEntry` approval variant replace

```ts
      kind: 'approval';
      key: string;
      at: string;
```

with

```ts
      kind: 'approval';
      key: string;
      /** post_approvals.id: references link to a correction through it. */
      approvalId: number;
      at: string;
```

and in `buildHistoryEntries` replace

```ts
      kind: 'approval',
      key: `approval-${approval.id}`,
      at: approval.created_at,
```

with

```ts
      kind: 'approval',
      key: `approval-${approval.id}`,
      approvalId: approval.id,
      at: approval.created_at,
```

Run: `npx vitest run apps/hub/src/lib/__tests__/postHistory.test.ts`
Expected: PASS (other assertions use `toMatchObject` or map `kind` only, so they are unaffected).

- [ ] **Step 5: Write the failing history tiles test**

Create `apps/hub/src/components/__tests__/PostHistoryPanel.references.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostHistoryPanel } from '../PostHistoryPanel';
import type { HubPost, PostHistoryResponse } from '../../types';
import { makeReferenceItem } from '../../hooks/__tests__/postReferencesStub';

const fetchPostHistoryMock = vi.hoisted(() => vi.fn());
vi.mock('../../api', () => ({
  fetchPostHistory: fetchPostHistoryMock,
  submitApproval: vi.fn(),
}));

const POST: HubPost = {
  id: 7,
  titulo: 'Campanha',
  tipo: 'feed',
  status: 'correcao_cliente',
  ordem: 1,
  conteudo: null,
  conteudo_plain: 'texto',
  scheduled_at: null,
  ig_caption: 'legenda',
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
};

const HISTORY: PostHistoryResponse = {
  events: [],
  approvals: [
    {
      id: 10,
      action: 'correcao',
      comentario: 'ajustar',
      motivo: null,
      is_workspace_user: false,
      created_at: '2026-09-01T12:00:00.000Z',
    },
    {
      id: 11,
      action: 'correcao',
      comentario: 'nota da equipe',
      motivo: null,
      is_workspace_user: true,
      created_at: '2026-09-02T12:00:00.000Z',
    },
  ],
};

describe('PostHistoryPanel reference tiles', () => {
  beforeEach(() => {
    fetchPostHistoryMock.mockReset();
    fetchPostHistoryMock.mockResolvedValue(HISTORY);
  });

  it('shows the references attached to a client correction', async () => {
    const onOpen = vi.fn();
    render(
      <PostHistoryPanel
        post={POST}
        token="t"
        approvals={[]}
        embedded
        onOpenReference={onOpen}
        references={[
          makeReferenceItem(1, { name: 'foto.jpg', post_approval_id: 10 }),
          makeReferenceItem(2, {
            kind: 'link',
            file_kind: null,
            name: null,
            url: null,
            thumbnail_url: null,
            link_url: 'https://exemplo.com/p',
            link_title: 'Post da marca',
            link_domain: 'exemplo.com',
            post_approval_id: 10,
          }),
          makeReferenceItem(3, { name: 'solta.jpg', post_approval_id: null }),
          makeReferenceItem(4, { name: 'equipe.jpg', post_approval_id: 11 }),
        ]}
      />,
    );
    expect(await screen.findByText('2 referências anexadas')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir foto.jpg' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    const link = screen.getByRole('link', { name: 'Abrir Post da marca' });
    expect(link).toHaveAttribute('href', 'https://exemplo.com/p');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('button', { name: 'Abrir solta.jpg' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir equipe.jpg' })).not.toBeInTheDocument();
  });

  it('uses the singular for one reference', async () => {
    render(
      <PostHistoryPanel
        post={POST}
        token="t"
        approvals={[]}
        embedded
        references={[makeReferenceItem(1, { post_approval_id: 10 })]}
      />,
    );
    expect(await screen.findByText('1 referência anexada')).toBeInTheDocument();
  });

  it('renders as before without references', async () => {
    render(<PostHistoryPanel post={POST} token="t" approvals={[]} embedded />);
    expect(await screen.findByText('ajustar')).toBeInTheDocument();
    expect(screen.queryByText(/referência/)).not.toBeInTheDocument();
  });
});
```

Run: `npx vitest run apps/hub/src/components/__tests__/PostHistoryPanel.references.test.tsx`
Expected: FAIL (`Unable to find an element with the text: 2 referências anexadas`).

- [ ] **Step 6: Implement the history tiles**

In `apps/hub/src/components/PostHistoryPanel.tsx`:

(a) After `import { TextDiff } from './TextDiff';` add:

```ts
import { ReferenceTiles } from './posts/references/ReferenceTiles';
import type { ReferenceItem } from '../types/postReferences';
```

(b) Replace

```ts
  /** Reports whether an unsent comment (typed or in flight) exists, so the host can guard navigation. */
  onDirtyChange?: (dirty: boolean) => void;
}
```

with

```ts
  /** Reports whether an unsent comment (typed or in flight) exists, so the host can guard navigation. */
  onDirtyChange?: (dirty: boolean) => void;
  /** The post's references (the dialog's usePostReferences); joined to client corrections by post_approval_id. */
  references?: ReferenceItem[];
  onOpenReference?: (item: ReferenceItem) => void;
}
```

(c) Replace

```ts
  embedded,
  onDirtyChange,
}: PostHistoryPanelProps) {
```

with

```ts
  embedded,
  onDirtyChange,
  references,
  onOpenReference,
}: PostHistoryPanelProps) {
```

(d) Before `function renderEntry(entry: HistoryEntry) {` add:

```tsx
  function renderAttached(approvalId: number) {
    const attached = (references ?? []).filter((r) => r.post_approval_id === approvalId);
    if (attached.length === 0) return null;
    return (
      <div className="pt-1 space-y-1.5">
        <ReferenceTiles items={attached} onOpen={onOpenReference} />
        <p className="text-[12px] hub-tx3">
          {t('references.history.attached', '{{count}} referências anexadas', {
            count: attached.length,
          })}
        </p>
      </div>
    );
  }
```

(e) In the approval branch replace

```tsx
          {entry.comentario && (
            <p className="text-[12px] hub-tx2 whitespace-pre-wrap">{entry.comentario}</p>
          )}
        </li>
      );
    }
```

with

```tsx
          {entry.comentario && (
            <p className="text-[12px] hub-tx2 whitespace-pre-wrap">{entry.comentario}</p>
          )}
          {entry.action === 'correcao' && !entry.byTeam && renderAttached(entry.approvalId)}
        </li>
      );
    }
```

Run:

```bash
npx vitest run apps/hub/src/components/__tests__/PostHistoryPanel.references.test.tsx \
  apps/hub/src/components/__tests__/PostHistoryPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Pass references from the dialog (test first)**

Append to `apps/hub/src/components/posts/__tests__/PostDetailDialog.references.test.tsx`,
inside the `describe` block:

```tsx
  it('sends the staged reference ids with the correction and refreshes', async () => {
    const item = makeReferenceItem(7, { name: 'f7.jpg' });
    const refs = makePostReferencesStub({
      canAdd: true,
      items: [item],
      startUploads: vi.fn(
        async (_files: File[], opts?: { onUploaded?: (i: typeof item) => void }) => {
          opts?.onUploaded?.(item);
          return [item];
        },
      ),
    });
    refsState.current = refs;
    submitApprovalMock.mockResolvedValue({ ok: true });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /Corrigir/ }));
    fireEvent.change(screen.getByTestId('reference-file-input-composer'), {
      target: { files: [new File(['x'], 'f7.jpg', { type: 'image/jpeg' })] },
    });
    expect(screen.getByRole('button', { name: 'Tirar f7.jpg da correção' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Enviar correção/ }));
    await screen.findByText('Correção enviada!');
    expect(submitApprovalMock).toHaveBeenCalledWith(
      'token-publico',
      1,
      'correcao',
      '',
      undefined,
      [7],
    );
    expect(refs.refresh).toHaveBeenCalled();
  });

  it('disables Enviar correção while an upload is in flight', () => {
    refsState.current = makePostReferencesStub({ canAdd: true, uploadsInFlight: true });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /Corrigir/ }));
    expect(screen.getByRole('button', { name: /Enviar correção/ })).toBeDisabled();
  });

  it('shows the attached references under the correction in the history tab', async () => {
    refsState.current = makePostReferencesStub({
      canAdd: false,
      items: [makeReferenceItem(1, { name: 'foto.jpg', post_approval_id: 10 })],
    });
    const { fetchPostHistory } = await import('../../../api');
    vi.mocked(fetchPostHistory).mockResolvedValueOnce({
      events: [],
      approvals: [
        {
          id: 10,
          action: 'correcao',
          comentario: 'ajustar',
          motivo: null,
          is_workspace_user: false,
          created_at: '2026-09-01T12:00:00.000Z',
        },
      ],
    });
    renderDialog([post({ status: 'correcao_cliente' })]);
    fireEvent.click(screen.getByRole('tab', { name: 'Histórico e comentários' }));
    expect(await screen.findByText('1 referência anexada')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir foto.jpg' }));
    expect(screen.getByRole('dialog', { name: 'foto.jpg' })).toBeInTheDocument();
  });
```

Run: `npx vitest run apps/hub/src/components/posts/__tests__/PostDetailDialog.references.test.tsx`
Expected: FAIL (no composer input yet: the dialog does not pass `references`; no tiles in history).

Edits in `apps/hub/src/components/posts/PostDetailDialog.tsx`:

(a) In `submit`, change the signature

```ts
  async function submit(
    action: 'aprovado' | 'correcao',
    comentario = '',
    motivo: CorrectionReason | null = null,
  ) {
```

to

```ts
  async function submit(
    action: 'aprovado' | 'correcao',
    comentario = '',
    motivo: CorrectionReason | null = null,
    referenceIds: number[] = [],
  ) {
```

and replace

```ts
      if (action === 'correcao')
        res = await submitApproval(token, post.id, 'correcao', comentario, motivo ?? undefined);
```

with

```ts
      // reference_ids only when something is staged, so the call keeps its old shape otherwise.
      if (action === 'correcao')
        res =
          referenceIds.length > 0
            ? await submitApproval(
                token,
                post.id,
                'correcao',
                comentario,
                motivo ?? undefined,
                referenceIds,
              )
            : await submitApproval(token, post.id, 'correcao', comentario, motivo ?? undefined);
```

(b) Replace

```tsx
                    onSubmitCorrection={(c, m) => submit('correcao', c, m)}
```

with

```tsx
                    onSubmitCorrection={(c, m, ids) => submit('correcao', c, m, ids)}
                    references={refs}
                    onOpenReference={setViewerItem}
                    onOverlayChange={handleOverlayChange}
```

(c) Replace

```tsx
                    onDirtyChange={handleHistoryDirtyChange}
                    embedded
                  />
```

with

```tsx
                    onDirtyChange={handleHistoryDirtyChange}
                    references={refs.items}
                    onOpenReference={setViewerItem}
                    embedded
                  />
```

Run:

```bash
npx prettier --write apps/hub/src/components/posts/PostDetailDialog.tsx apps/hub/src/components/posts/CorrectionPanel.tsx apps/hub/src/components/PostHistoryPanel.tsx
npx vitest run apps/hub/src/components apps/hub/src/lib apps/hub/src/__tests__/api.test.ts
```

Expected: PASS, including the pre-existing `PostDetailDialog.test.tsx` assertions at lines 502
and 569 (no staged references there, so `submitApproval` keeps its 4- and 5-argument calls).

- [ ] **Step 8: Full gates**

```bash
npx prettier --write apps/hub/src packages/i18n/locales
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run lint
npm run format:check
npm run test
grep -rn "—" apps/hub/src/components/posts/references packages/i18n/locales/pt/hubPosts.json \
  | grep -i "referen" || echo "no em dash in reference copy"
```

Expected: the four tsc runs silent, exit 0; lint 0 errors; prettier clean; vitest all files
passed; last line `no em dash in reference copy`.

- [ ] **Step 9: Browser check**

Same setup as Task 8 Step 13 (local Hub on :5175 via `node scripts/with-env.mjs npm run dev:hub --`
with patched `fetch` for writes, or the deployed staging Hub once `hub-post-references` and the
`reference_ids`-aware `hub-approve` are on staging): Corrigir, Anexar referência (sheet on
phone width), upload a photo, chip appears, "Tirar ... da correção" unstages, Enviar correção is
disabled during an upload with "Aguarde o envio terminar", send with a staged reference, then
open the post's Histórico tab and check the 72px tiles and "1 referência anexada" under the
correction (needs `hub-approve` with `reference_ids` deployed to staging). Light and dark.

- [ ] **Step 10: Commit**

```bash
git add apps/hub/src/api.ts apps/hub/src/__tests__/api.test.ts \
  apps/hub/src/components/posts/CorrectionPanel.tsx apps/hub/src/components/PostHistoryPanel.tsx \
  apps/hub/src/components/posts/PostDetailDialog.tsx apps/hub/src/lib/postHistory.ts \
  apps/hub/src/lib/__tests__/postHistory.test.ts \
  apps/hub/src/components/posts/__tests__/CorrectionPanel.references.test.tsx \
  apps/hub/src/components/posts/__tests__/PostDetailDialog.references.test.tsx \
  apps/hub/src/components/__tests__/PostHistoryPanel.references.test.tsx
git commit -m "$(cat <<'EOF'
feat(hub): attach references to a correction and show them in the history

The correction composer stages references as chips and sends reference_ids
to hub-approve; the history shows them as tiles under the client's correction.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Contract issues

1. **Hook location.** The contract says `usePostReferences` is called once in
   `PostDetailDialog`; it has to live in `PostDetailContent` (the per-post card,
   `PostDetailDialog.tsx:237`), the only place with `post.id`. During a slide the outgoing ghost
   card (`:155-173`) also runs it for its own post; same query key, a cache hit.
2. **Hook return is a superset.** Added `freshIds: number[]` (note field opens for a just
   uploaded item), `retryUpload(localId)` (re-runs the whole upload with a fresh presign, as the
   spec requires), `refresh()` (invalidate after approve/correction), and an optional second
   argument `startUploads(files, { onUploaded })` so the composer can stage each id as soon as it
   exists. `cancelUpload` on an error entry dismisses it. Exported `AddReferenceLinkInput` and
   `PostReferencesState`. `startUploads` resolves with the finalized items only, so the composer
   never stages a failed upload; failures stay in `uploads` as `status: 'error'`.
3. **Query key omits the token** (`['hub-post-references', postId]`), unlike every other Hub key
   (`queries.ts:28,38`). Followed as written; harmless with one token per tab.
4. **`submitApproval` arity.** The contract only says hub-approve's body gains
   `reference_ids`. Plan: a sixth `referenceIds?` parameter, and both `onSubmitCorrection` and
   `submitApproval` are called with the extra argument only when ids are staged, so existing
   exact `toHaveBeenCalledWith` assertions stay valid.
5. **`apps/hub/src/types/postReferences.ts` sits next to `apps/hub/src/types.ts`.** Legal
   (`'../types'` still resolves to the file), but a `types/` folder beside `types.ts` is new in
   the Hub. Kept the contract path.
6. **Components beyond the contract list.** Added `ReferencePicker.tsx` (hidden input + sheet +
   link form, shared by the tab and the composer), `referenceFormat.ts`, and
   `services/referenceMedia.ts` (so the service test can mock canvas/video work). Service also
   exports `REFERENCE_MIME`, `REFERENCE_ACCEPT`, limits, `normalizeReferenceUrl`,
   `referenceMime`, `referenceFileKind`, `isAbortError`.
7. **All reference HTTP lives in `services/postReferences.ts`, not `api.ts`**, because api.ts's
   request helpers are private and every page test replaces `../../api` with a fixed factory.
   Consequence: the dialog and page tests stub the hook (`hooks/__tests__/postReferencesStub.ts`).
8. **Copy not in the spec** (please confirm): `locked` "A equipe já recebeu esta referência. Ela
   não pode mais ser alterada.", `not_found`, `rate_limited`, `invalid_note`, a size-less
   `too_large` fallback, the photo/PDF wording of the 25 MB variants ("A foto tem…", "O PDF
   tem…"), the empty-state body, "Adicionar nota"/"Editar nota", the leave-while-uploading
   confirm, "Descartar", "Abrir o arquivo".
9. **Coordinator facts applied:** `/files` and `/links` 201 handled via `res.ok`; token errors
   (`"token required"`, `"Link inválido."`) map to `internal`; PDFs send no thumbnail fields;
   absent optional finalize fields are sent as JSON `null`; R2 keys are echoed unchanged. Links
   send `title`/`note` only when non-empty (omitted, not null), while `/files` sends JSON `null`
   for absent optionals; the server task should accept both omitted and null on `/links`.
10. **videoFrame move touches the CRM** (Task 7 step 1): two imports and one `vi.mock` path
    change, and the test moves to `packages/ui/video/__tests__/frame.test.ts`. It emits JPEG, so
    the Hub re-encodes the frame to WebP ≤ 512 KB.

## Verified facts

- `apps/hub/src/api.ts:73-100,230-244`: `request/get/post/patch/del` are module-private; `request` throws `Error(body.error)` and retries 429 three times.
- `apps/hub/src/api.ts:123-137`: `submitApproval(token, post_id, action, comentario?, motivo?)` posts to `hub-approve`.
- `apps/hub/src/services/ideiaMedia.ts:24-97`: `probeImage`, `generateThumbnail` (fixed `THUMB_SIZE` 256, webp 0.7), `generateBlur` are private; only `putToR2` and the validator are exported; `uploadIdeiaImage` wraps in `trackUnsavedWork`.
- `packages/app-lifecycle/src/unsaved-work.ts:33-48`: `trackUnsavedWork(work, maxMs = 30 min)`; `resetUnsavedWorkForTests` is not re-exported from `index.ts`.
- `apps/crm/src/utils/videoFrame.ts:1-97`: DOM-only, no CRM imports; returns JPEG `thumb.jpg` ≤ 1920px; importers `ThumbnailPickerDialog.tsx:13`, `PostMediaGallery.tsx:40`, mocked at `PostMediaGallery.test.tsx:21,70`.
- `@mesaas/ui/*` alias: `apps/hub/tsconfig.json:6`, `apps/hub/vite.config.ts:12`, `apps/crm/tsconfig.json:7`, `apps/admin/tsconfig.json:7`, `vitest.config.ts:11`; precedent util `packages/ui/audio/validation.ts`.
- `vitest.config.ts:9`: `@` maps to `apps/crm/src` in tests, so Hub tests use relative imports.
- `PostDetailDialog.tsx:263` tab state; `:311-324` tab keys and fallback; `:289` `navLocked`; `:343-353` `guard`; `:365-372` `close` skips while the lightbox is open; `:379-391` window arrow keys; `:406-442` `submit`; `:708-733` tablist; `:735-810` panels; `:862-873` Aprovar; `:899-906` lightbox.
- `PostDetailDialog.test.tsx:87-107` renders without `QueryClientProvider`; `:14-18` api mock; `:502,569` exact `submitApproval` assertions; `:546` expects exactly 2 dialogs with the lightbox open; default post body 'Corpo' vs caption 'Legenda um' shows "Texto do post" (`lib/postView.ts:174-188`).
- Page tests mocking `../../api` and opening the dialog: `aprovacoesPage.test.tsx:10-16`, `postagensPage.test.tsx:8`; both use `QueryClient({ retry: false })`.
- `CorrectionPanel.tsx:128` `onSubmitCorrection(comentario, motivo)`; `:318` `panelDirty`; `:527-543` comment textarea and Enviar correção; tests assert `('', null)` at `CorrectionPanel.test.tsx:88`.
- `PostHistoryPanel.tsx:23-32` props, `:199-224` approval entry render; only consumer is `PostDetailDialog.tsx:738`.
- `lib/postHistory.ts:28-36,128-140,148`: approval entries drop `approval.id` (`id` stripped at the end); `lib/__tests__/postHistory.test.ts:291` uses `toMatchObject`.
- `components/ui/HubDialog.tsx:18-24,40-43`: portals into `.hub-root` (no transform), `z-[9000]`; nested precedent `pages/HomePage.tsx:270-285` → `agenda/AgendaCard.tsx:63` → `RemarcarDialog.tsx:78` (bottom-sheet classes at `:83`).
- `apps/hub/index.html:37-224`: hub-* rules are `.hub-root .hub-*` hand-written CSS (no Tailwind variants).
- `lib/security.ts:1-14` `sanitizeExternalUrl` (http/https only, no credentials).
- `lib/__tests__/hubPostsLocale.test.ts:14-16` pt/en key parity; `:93-97` em-dash check.
- `packages/i18n/locales/{pt,en}/hubPosts.json` end with the `production` group; plurals `_one/_other` already used (`clients.json:264`); i18next 26.3.6.
- `eslint.config.js`: `react-hooks/refs` off (ref writes during render allowed, as `CorrectionPanel.tsx:176`).
- Versions: vitest 3.2.4 (`restoreAllMocks` leaves `vi.fn` alone), @tanstack/react-query 5.100.5, @radix-ui/react-dialog 1.1.15, lucide-react 0.577.0 (`ImageIcon`, `Film`, `Paperclip`, `ImagePlus`, `Link2` exported), @testing-library/user-event 14.6.7.
- `test/shared/fetchMock.ts`: `createFetchMock()` records `{ input, init }`, ignores `signal`.
- The worktree has no `node_modules`; resolution walks up to `/Users/eduardosouza/Projects/sm-crm/node_modules`.
- `apps/crm/src/utils/__tests__/videoFrame.test.ts` imports only `vitest` and `../videoFrame` (lines 1-3), so moving it next to `frame.ts` needs only the one import edit.
- `PostDetailDialog` is rendered only by `pages/AprovacoesPage.tsx` and `pages/PostagensPage.tsx`; page tests rendering those: `aprovacoesPage`, `postagensPage`, `postApprovalBrandPages` (`:68-70`).
- `package.json:12-16`: `dev:env` / `dev:all:env` wrap `scripts/with-env.mjs`; there is no `dev:hub:env`.


---

### Task 10: CRM post editor shows the client's references

Everything runs from the worktree root
`/Users/eduardosouza/projects/sm-crm/.claude/worktrees/client-file-link-attachments-5a50d3`.
Depends on Task(s) that ship the `post-references` edge function and the `post_references`
table + RLS SELECT policy (the CRM only reads/deletes; nothing here needs them deployed to pass
Vitest, every call is mocked).

**Files:**
- Create: `apps/crm/src/store/postReferences.ts`
- Create: `apps/crm/src/store/__tests__/postReferences.test.ts`
- Create: `apps/crm/src/pages/entregas/components/references/referenceFormat.ts`
- Create: `apps/crm/src/pages/entregas/components/references/usePostReferences.ts`
- Create: `apps/crm/src/pages/entregas/components/references/ReferenceTile.tsx`
- Create: `apps/crm/src/pages/entregas/components/references/ReferenceViewerDialog.tsx`
- Create: `apps/crm/src/pages/entregas/components/references/ReferenceChips.tsx`
- Create: `apps/crm/src/pages/entregas/components/references/PostClientReferences.tsx`
- Create: `apps/crm/src/pages/entregas/components/__tests__/referenceFormat.test.ts`
- Create: `apps/crm/src/pages/entregas/components/__tests__/PostClientReferences.test.tsx`
- Create: `apps/crm/src/pages/entregas/components/__tests__/ReferenceViewerDialog.test.tsx`
- Create: `apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawer.references.test.tsx`
- Modify: `apps/crm/src/pages/entregas/components/PostEditorBody.tsx` (imports, query after the `['post-media']` query at :198-203, section after `<PostMediaGallery>` at :500-515, bubble map at :715-717, viewer before the closing `</div>` at :752, `PostApprovalBubble` at :758-786)
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` (lucide import :5-25, imports after :137, const after :121, query after :358, `refresh()` :418, row prop at :1091-1093, `SortablePostItemProps` :1323, destructure :1384, badge after :1494-1498)
- Modify (test harnesses, add one `vi.mock`): `apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawer.test.tsx`, `WorkflowDrawer.duplicate.test.tsx`, `WorkflowDrawerAutoComplete.test.tsx`, `WorkflowDrawerAutoScheduleNudge.test.tsx`, `StandalonePostDrawer.test.tsx`

**Interfaces:**

```ts
// apps/crm/src/store/postReferences.ts
export type ReferenceFileKind = 'image' | 'video' | 'document';
export interface ReferenceItem { /* exactly the contract shape */ }
export function getPostReferences(postId: number): Promise<ReferenceItem[]>;
export function deletePostReference(id: number): Promise<void>;          // throws Error(code), e.g. 'forbidden'
export function getPostReferenceCounts(postIds: number[]): Promise<Record<number, number>>;

// references/usePostReferences.ts
export function usePostReferences(postId: number | null | undefined, enabled: boolean):
  UseQueryResult<ReferenceItem[]>;                 // key ['post-references', postId], staleTime 5 min

// references/referenceFormat.ts
export function formatReferenceSize(bytes: number | null | undefined): string | null;   // "2,4 MB"
export function formatReferenceDate(iso: string, now?: Date): string;                    // "hoje, 14:32"
export function formatReferenceDuration(seconds: number | null | undefined): string | null; // "0:42"
export function isViewableReference(item: ReferenceItem): boolean;   // image/video file with a url
export function referenceLabel(item: ReferenceItem): string;         // name | link title | domain

// references/*.tsx
export function ReferenceTile(p: { item; canDelete: boolean; onOpen(item); onDeleteRequest(item) }): JSX.Element;
export const VIDEO_PLAYBACK_ERROR: string;
export function ReferenceViewerDialog(p: { item: ReferenceItem | null; onClose(): void }): JSX.Element;
export function ReferenceChips(p: { references: ReferenceItem[]; onOpen(item) }): JSX.Element | null;
export function PostClientReferences(p: { postId: number; references: ReferenceItem[]; onOpen(item) }): JSX.Element | null;
```

Design notes that the steps rely on:
- **Import path.** Components import from `@/store/postReferences`, never from the
  `../../../store` barrel, and the barrel (`store/index.ts`) is NOT changed. Five drawer test
  harnesses mock `@/store` with explicit object factories; Vitest throws on any export missing
  from such a factory, so a barrel import would break all five at render.
- **One fetch per post.** `PostEditorBody` calls `usePostReferences` next to its
  `['post-media']` query (same `isExpanded` gate, before the `if (!isExpanded) return null`
  at :331) and hands the list to both the section and the bubbles. It also owns the single
  viewer dialog, since both the tiles and the chips open it.
- **Trash gate** is `useAuth().can('entregas', 'editar') === true` inside the section,
  mirroring `canDuplicate` at `WorkflowDrawer.tsx:368`. `can()` returns
  `boolean | 'unknown'`; `=== true` hides the trash while membership loads.
- **Grid.** `grid-cols-3 min-[900px]:grid-cols-4` (900px is not a stock Tailwind
  breakpoint). jsdom cannot evaluate it; verify in the browser.
- **Hover overlay** uses `group-hover` + `group-focus-within`, so keyboard users reach
  "Abrir", "Baixar" and the trash by tabbing into the tile.

---

- [ ] **Step 1: Write the failing store test**

Create `apps/crm/src/store/__tests__/postReferences.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SessionResult = { data: { session: { access_token: string } | null } };

const { fromMock, getSessionMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  getSessionMock: vi.fn(
    async (): Promise<SessionResult> => ({ data: { session: { access_token: 'jwt' } } }),
  ),
}));
vi.mock('../core', () => ({
  supabase: { from: fromMock, auth: { getSession: getSessionMock } },
}));

import { deletePostReference, getPostReferenceCounts, getPostReferences } from '../postReferences';

const fetchMock = vi.fn();

describe('store/postReferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists a post's references through post-references with the user JWT", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [{ id: 7 }] })));

    const items = await getPostReferences(12);

    expect(items).toEqual([{ id: 7 }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://mesaas.supabase.co/functions/v1/post-references?post_id=12');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer jwt');
    expect(init.headers.apikey).toBe('anon-key-for-tests');
  });

  it('deletes one reference by id', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    await deletePostReference(7);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://mesaas.supabase.co/functions/v1/post-references/7');
    expect(init.method).toBe('DELETE');
  });

  it("surfaces the function's error code", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    );
    await expect(deletePostReference(7)).rejects.toThrow('forbidden');
  });

  it('falls back to the HTTP status when the body has no code', async () => {
    fetchMock.mockResolvedValue(new Response('oops', { status: 500 }));
    await expect(getPostReferences(1)).rejects.toThrow('HTTP 500');
  });

  it('refuses to call the function without a session', async () => {
    getSessionMock.mockResolvedValueOnce({ data: { session: null } });
    await expect(getPostReferences(1)).rejects.toThrow('Não autenticado');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('counts references per post from one RLS-scoped select', async () => {
    const inMock = vi.fn(async () => ({
      data: [{ post_id: 1 }, { post_id: 1 }, { post_id: 3 }],
      error: null,
    }));
    const selectMock = vi.fn(() => ({ in: inMock }));
    fromMock.mockReturnValue({ select: selectMock });

    await expect(getPostReferenceCounts([1, 2, 3])).resolves.toEqual({ 1: 2, 3: 1 });
    expect(fromMock).toHaveBeenCalledWith('post_references');
    expect(selectMock).toHaveBeenCalledWith('post_id');
    expect(inMock).toHaveBeenCalledWith('post_id', [1, 2, 3]);
  });

  it('skips the query when there are no posts', async () => {
    await expect(getPostReferenceCounts([])).resolves.toEqual({});
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('throws when the count select fails', async () => {
    fromMock.mockReturnValue({
      select: () => ({ in: async () => ({ data: null, error: { message: 'boom' } }) }),
    });
    await expect(getPostReferenceCounts([1])).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -- apps/crm/src/store/__tests__/postReferences.test.ts`
Expected: FAIL, `Failed to resolve import "../postReferences"`.

- [ ] **Step 3: Implement the store module**

Create `apps/crm/src/store/postReferences.ts`:

```ts
import { supabase } from './core';

// Client references on a post (Hub uploads and links). Reads and the team's delete go through
// the `post-references` edge function (signed R2 URLs, entregas/editar check on delete); the
// per-post counts for the drawer badge read `post_references` directly under its SELECT policy.
//
// Deliberately NOT re-exported from `store/index.ts`: the drawer test harnesses mock '@/store'
// with explicit factories, so callers import this module by path.

export type ReferenceFileKind = 'image' | 'video' | 'document';

/** Mirrors `ReferenceItem` in supabase/functions/_shared/post-references.ts. */
export interface ReferenceItem {
  id: number;
  kind: 'file' | 'link';
  file_kind: ReferenceFileKind | null;
  name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  /** Signed GET URL of the original file (3600s). Null for links. */
  url: string | null;
  thumbnail_url: string | null;
  blur_data_url: string | null;
  /** Signed URL with `Content-Disposition: attachment`. Files only. */
  download_url: string | null;
  link_url: string | null;
  link_title: string | null;
  link_domain: string | null;
  note: string | null;
  /** Set when the client attached it to a correction (post_approvals.id). */
  post_approval_id: number | null;
  created_at: string;
  can_remove: boolean;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

async function callPostReferences<T>(
  method: 'GET' | 'DELETE',
  pathSuffix = '',
  query?: Record<string, string>,
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');
  const url = new URL(`${SUPABASE_URL}/functions/v1/post-references${pathSuffix}`);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function getPostReferences(postId: number): Promise<ReferenceItem[]> {
  const { items } = await callPostReferences<{ items: ReferenceItem[] }>('GET', '', {
    post_id: String(postId),
  });
  return items;
}

export async function deletePostReference(id: number): Promise<void> {
  await callPostReferences<{ ok: true }>('DELETE', `/${id}`);
}

/** `{ [post_id]: count }` for the given posts; posts without references are absent. */
export async function getPostReferenceCounts(postIds: number[]): Promise<Record<number, number>> {
  if (postIds.length === 0) return {};
  const { data, error } = await supabase
    .from('post_references')
    .select('post_id')
    .in('post_id', postIds);
  if (error) throw error;
  const counts: Record<number, number> = {};
  for (const row of (data ?? []) as { post_id: number }[]) {
    counts[row.post_id] = (counts[row.post_id] ?? 0) + 1;
  }
  return counts;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm run test -- apps/crm/src/store/__tests__/postReferences.test.ts`
Expected: PASS, `Tests  8 passed (8)`.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/store/postReferences.ts apps/crm/src/store/__tests__/postReferences.test.ts
git commit -m "feat(crm): store for client post references

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Write the failing format-helper test**

Create `apps/crm/src/pages/entregas/components/__tests__/referenceFormat.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  formatReferenceDate,
  formatReferenceDuration,
  formatReferenceSize,
  isViewableReference,
  referenceLabel,
} from '../references/referenceFormat';
import type { ReferenceItem } from '@/store/postReferences';

function item(overrides: Partial<ReferenceItem>): ReferenceItem {
  return {
    id: 1,
    kind: 'file',
    file_kind: 'image',
    name: 'foto.jpg',
    mime_type: 'image/jpeg',
    size_bytes: 1000,
    duration_seconds: null,
    width: null,
    height: null,
    url: 'https://r2.example.com/a.jpg',
    thumbnail_url: null,
    blur_data_url: null,
    download_url: null,
    link_url: null,
    link_title: null,
    link_domain: null,
    note: null,
    post_approval_id: null,
    created_at: '2026-10-08T12:00:00.000Z',
    can_remove: false,
    ...overrides,
  };
}

describe('referenceFormat', () => {
  it('formats sizes in pt-BR', () => {
    expect(formatReferenceSize(2_516_582)).toBe('2,4 MB');
    expect(formatReferenceSize(2 * 1024 * 1024)).toBe('2 MB');
    expect(formatReferenceSize(300 * 1024)).toBe('300 KB');
    expect(formatReferenceSize(10)).toBe('1 KB');
    expect(formatReferenceSize(null)).toBeNull();
    expect(formatReferenceSize(0)).toBeNull();
  });

  it('formats the date relative to today, in local time', () => {
    const now = new Date(2026, 9, 8, 18, 0);
    expect(formatReferenceDate(new Date(2026, 9, 8, 14, 32).toISOString(), now)).toBe(
      'hoje, 14:32',
    );
    expect(formatReferenceDate(new Date(2026, 9, 7, 9, 5).toISOString(), now)).toBe(
      'ontem, 09:05',
    );
    expect(formatReferenceDate(new Date(2026, 9, 3, 8, 0).toISOString(), now)).toBe(
      '3 out, 08:00',
    );
    expect(formatReferenceDate(new Date(2025, 11, 30, 8, 0).toISOString(), now)).toBe(
      '30 dez 2025, 08:00',
    );
    expect(formatReferenceDate('not a date', now)).toBe('');
  });

  it('formats video durations', () => {
    expect(formatReferenceDuration(42)).toBe('0:42');
    expect(formatReferenceDuration(65.4)).toBe('1:05');
    expect(formatReferenceDuration(3725)).toBe('1:02:05');
    expect(formatReferenceDuration(null)).toBeNull();
  });

  it('labels files by name and links by title, then domain', () => {
    expect(referenceLabel(item({ name: 'a.pdf' }))).toBe('a.pdf');
    expect(referenceLabel(item({ name: null }))).toBe('Arquivo');
    expect(
      referenceLabel(item({ kind: 'link', link_title: 'Gostei', link_domain: 'instagram.com' })),
    ).toBe('Gostei');
    expect(referenceLabel(item({ kind: 'link', link_title: ' ', link_domain: 'x.com' }))).toBe(
      'x.com',
    );
  });

  it('only images and videos open in the viewer', () => {
    expect(isViewableReference(item({ file_kind: 'image' }))).toBe(true);
    expect(isViewableReference(item({ file_kind: 'video' }))).toBe(true);
    expect(isViewableReference(item({ file_kind: 'document' }))).toBe(false);
    expect(isViewableReference(item({ kind: 'link', file_kind: null, url: null }))).toBe(false);
    expect(isViewableReference(item({ url: null }))).toBe(false);
  });
});
```

- [ ] **Step 7: Run it and watch it fail**

Run: `npm run test -- apps/crm/src/pages/entregas/components/__tests__/referenceFormat.test.ts`
Expected: FAIL, `Failed to resolve import "../references/referenceFormat"`.

- [ ] **Step 8: Implement the helpers**

Create `apps/crm/src/pages/entregas/components/references/referenceFormat.ts`:

```ts
import type { ReferenceItem } from '@/store/postReferences';
import { MESES_ABREV } from '@/utils/postDate';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "2,4 MB" / "300 KB" (pt-BR decimal comma). Null when unknown. */
export function formatReferenceSize(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "hoje, 14:32", "ontem, 09:05", "3 out, 08:00" (year only when not the current one). */
export function formatReferenceDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (sameLocalDay(d, now)) return `hoje, ${time}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameLocalDay(d, yesterday)) return `ontem, ${time}`;
  const ano = d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} ${MESES_ABREV[d.getMonth()]}${ano}, ${time}`;
}

/** "0:42" / "1:02:05". Null when unknown. */
export function formatReferenceDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** Images and videos open in the in-app viewer; PDFs and links open in a new tab. */
export function isViewableReference(item: ReferenceItem): boolean {
  return (
    item.kind === 'file' &&
    (item.file_kind === 'image' || item.file_kind === 'video') &&
    !!item.url
  );
}

export function referenceLabel(item: ReferenceItem): string {
  if (item.kind === 'link') return item.link_title?.trim() || item.link_domain || 'Link';
  return item.name?.trim() || 'Arquivo';
}
```

- [ ] **Step 9: Run it and watch it pass**

Run: `npm run test -- apps/crm/src/pages/entregas/components/__tests__/referenceFormat.test.ts`
Expected: PASS, `Tests  5 passed (5)`.

- [ ] **Step 10: Write the failing component tests (section + viewer)**

Create `apps/crm/src/pages/entregas/components/__tests__/PostClientReferences.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { makeCan, fakeMembership } from '@/test/makeCan';
import type { ReferenceItem } from '@/store/postReferences';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/store/postReferences', () => ({ deletePostReference: vi.fn() }));

let mockEntregasPerm: 'editar' | 'ver' = 'editar';
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    can: makeCan(
      fakeMembership({
        role: 'agent',
        role_id: 1,
        permissions: { entregas: mockEntregasPerm } as never,
      }),
    ),
  }),
}));

import { PostClientReferences } from '../references/PostClientReferences';
import { deletePostReference } from '@/store/postReferences';

const mockDelete = vi.mocked(deletePostReference);

function ref(overrides: Partial<ReferenceItem> & Pick<ReferenceItem, 'id'>): ReferenceItem {
  return {
    kind: 'file',
    file_kind: 'image',
    name: 'foto.jpg',
    mime_type: 'image/jpeg',
    size_bytes: 2_516_582,
    duration_seconds: null,
    width: 1080,
    height: 1350,
    url: 'https://r2.example.com/full.jpg',
    thumbnail_url: 'https://r2.example.com/thumb.webp',
    blur_data_url: null,
    download_url: 'https://r2.example.com/full.jpg?download=1',
    link_url: null,
    link_title: null,
    link_domain: null,
    note: null,
    post_approval_id: null,
    created_at: new Date().toISOString(),
    can_remove: false,
    ...overrides,
  };
}

const IMAGE = ref({
  id: 1,
  name: 'foto-praia.jpg',
  note: 'Usar esta no lugar da atual',
  post_approval_id: 501,
});
const VIDEO = ref({
  id: 2,
  file_kind: 'video',
  name: 'bastidores.mp4',
  mime_type: 'video/mp4',
  duration_seconds: 42,
  url: 'https://r2.example.com/v.mp4',
  download_url: 'https://r2.example.com/v.mp4?download=1',
});
const PDF = ref({
  id: 3,
  file_kind: 'document',
  name: 'tabela-precos.pdf',
  mime_type: 'application/pdf',
  thumbnail_url: null,
  url: 'https://r2.example.com/t.pdf',
  download_url: 'https://r2.example.com/t.pdf?download=1',
});
const LINK = ref({
  id: 4,
  kind: 'link',
  file_kind: null,
  name: null,
  mime_type: null,
  size_bytes: null,
  width: null,
  height: null,
  url: null,
  thumbnail_url: null,
  download_url: null,
  link_url: 'https://www.instagram.com/p/abc/',
  link_title: 'Post que gostei',
  link_domain: 'instagram.com',
});
const ALL = [IMAGE, VIDEO, PDF, LINK];

function renderSection(references: ReferenceItem[] = ALL, onOpen = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={qc}>
      <PostClientReferences postId={10} references={references} onOpen={onOpen} />
    </QueryClientProvider>,
  );
  return { ...utils, invalidate, onOpen };
}

const tile = (id: number) => screen.getByTestId(`reference-tile-${id}`);

describe('PostClientReferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEntregasPerm = 'editar';
  });

  it('renders nothing when the post has no references', () => {
    const { container } = renderSection([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the header with the count and the source', () => {
    renderSection();
    const section = screen.getByRole('region', { name: 'Referências do cliente' });
    expect(within(section).getByText('4')).toBeInTheDocument();
    expect(within(section).getByText('Enviadas pelo Hub')).toBeInTheDocument();
  });

  it('marks only references attached to a correction with "Na correção"', () => {
    renderSection();
    expect(within(tile(1)).getByText('Na correção')).toBeInTheDocument();
    expect(screen.getAllByText('Na correção')).toHaveLength(1);
  });

  it('shows name, note and "Cliente · data · tamanho" under each tile', () => {
    renderSection();
    expect(within(tile(1)).getByText('foto-praia.jpg')).toBeInTheDocument();
    expect(within(tile(1)).getByText('Usar esta no lugar da atual')).toBeInTheDocument();
    expect(within(tile(1)).getByText(/^Cliente · hoje, \d{2}:\d{2} · 2,4 MB$/)).toBeInTheDocument();
    // Links have no size.
    expect(within(tile(4)).getByText(/^Cliente · hoje, \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('draws the video duration, the PDF tile and the link domain', () => {
    renderSection();
    expect(within(tile(2)).getByText('0:42')).toBeInTheDocument();
    expect(within(tile(3)).getByText('PDF')).toBeInTheDocument();
    expect(within(tile(4)).getByText('instagram.com')).toBeInTheDocument();
  });

  it('links the link title to the sanitized URL in a new tab', () => {
    renderSection();
    const a = within(tile(4)).getByRole('link', { name: 'Post que gostei' });
    expect(a).toHaveAttribute('href', 'https://www.instagram.com/p/abc/');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('never links an unsafe URL', () => {
    renderSection([{ ...LINK, link_url: 'javascript:alert(1)' }]);
    expect(within(tile(4)).getByRole('link', { name: 'Post que gostei' })).toHaveAttribute(
      'href',
      '#',
    );
  });

  it('offers "Baixar" for files and never for links', () => {
    renderSection();
    expect(within(tile(1)).getByRole('link', { name: 'Baixar' })).toHaveAttribute(
      'href',
      'https://r2.example.com/full.jpg?download=1',
    );
    expect(within(tile(3)).getByRole('link', { name: 'Baixar' })).toBeInTheDocument();
    expect(within(tile(4)).queryByRole('link', { name: 'Baixar' })).toBeNull();
  });

  it('"Abrir" opens images and videos in the viewer, PDFs in a new tab', () => {
    const { onOpen } = renderSection();
    fireEvent.click(within(tile(2)).getByRole('button', { name: 'Abrir bastidores.mp4' }));
    expect(onOpen).toHaveBeenCalledWith(VIDEO);
    const pdf = within(tile(3)).getByRole('link', { name: 'Abrir tabela-precos.pdf' });
    expect(pdf).toHaveAttribute('href', 'https://r2.example.com/t.pdf');
    expect(pdf).toHaveAttribute('target', '_blank');
  });

  it('hides the trash without entregas/editar', () => {
    mockEntregasPerm = 'ver';
    renderSection();
    expect(screen.queryByRole('button', { name: 'Excluir referência' })).toBeNull();
  });

  it('confirms, deletes and refreshes both reference queries', async () => {
    mockDelete.mockResolvedValue(undefined);
    const { invalidate } = renderSection();

    fireEvent.click(within(tile(2)).getByRole('button', { name: 'Excluir referência' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Excluir referência?' });
    expect(within(dialog).getByText(/bastidores\.mp4/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(2));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Referência excluída'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['post-references', 10] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['post-reference-counts'] });
  });

  it('explains a permission refusal', async () => {
    mockDelete.mockRejectedValue(new Error('forbidden'));
    renderSection();
    fireEvent.click(within(tile(1)).getByRole('button', { name: 'Excluir referência' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Você não tem permissão para excluir referências.'),
    );
  });

  it('shows a generic error otherwise', async () => {
    mockDelete.mockRejectedValue(new Error('internal'));
    renderSection();
    fireEvent.click(within(tile(1)).getByRole('button', { name: 'Excluir referência' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Não foi possível excluir a referência. Tente novamente.',
      ),
    );
  });

  it('has no em dash in its copy', async () => {
    const { container } = renderSection();
    expect(container.textContent).not.toMatch(/—/);
    fireEvent.click(within(tile(1)).getByRole('button', { name: 'Excluir referência' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).not.toMatch(/—/);
  });
});
```

Create `apps/crm/src/pages/entregas/components/__tests__/ReferenceViewerDialog.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReferenceItem } from '@/store/postReferences';
import { ReferenceViewerDialog, VIDEO_PLAYBACK_ERROR } from '../references/ReferenceViewerDialog';

const base: ReferenceItem = {
  id: 1,
  kind: 'file',
  file_kind: 'image',
  name: 'foto-praia.jpg',
  mime_type: 'image/jpeg',
  size_bytes: 1000,
  duration_seconds: null,
  width: null,
  height: null,
  url: 'https://r2.example.com/full.jpg',
  thumbnail_url: 'https://r2.example.com/thumb.webp',
  blur_data_url: null,
  download_url: 'https://r2.example.com/full.jpg?download=1',
  link_url: null,
  link_title: null,
  link_domain: null,
  note: 'Usar esta',
  post_approval_id: null,
  created_at: '2026-10-08T12:00:00.000Z',
  can_remove: false,
};
const video: ReferenceItem = {
  ...base,
  id: 2,
  file_kind: 'video',
  name: 'clip.mov',
  mime_type: 'video/quicktime',
  url: 'https://r2.example.com/clip.mov',
  download_url: 'https://r2.example.com/clip.mov?download=1',
};

describe('ReferenceViewerDialog', () => {
  it('renders nothing without an item', () => {
    render(<ReferenceViewerDialog item={null} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows an image with its note and a download link', async () => {
    render(<ReferenceViewerDialog item={base} onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'foto-praia.jpg' });
    expect(within(dialog).getByRole('img', { name: 'foto-praia.jpg' })).toHaveAttribute(
      'src',
      'https://r2.example.com/full.jpg',
    );
    expect(within(dialog).getByText('Usar esta')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Baixar' })).toHaveAttribute(
      'href',
      'https://r2.example.com/full.jpg?download=1',
    );
  });

  it('plays a video inline with metadata preload', async () => {
    render(<ReferenceViewerDialog item={video} onClose={vi.fn()} />);
    const el = await screen.findByTestId('reference-viewer-video');
    expect(el).toHaveAttribute('src', 'https://r2.example.com/clip.mov');
    expect(el).toHaveAttribute('controls');
    expect(el).toHaveAttribute('playsinline');
    expect(el).toHaveAttribute('preload', 'metadata');
  });

  it('falls back to the download hint when the browser cannot play the video', async () => {
    render(<ReferenceViewerDialog item={video} onClose={vi.fn()} />);
    fireEvent.error(await screen.findByTestId('reference-viewer-video'));
    expect(screen.getByRole('alert')).toHaveTextContent(VIDEO_PLAYBACK_ERROR);
    expect(VIDEO_PLAYBACK_ERROR).toBe('Não foi possível reproduzir aqui. Baixe o arquivo.');
    expect(screen.queryByTestId('reference-viewer-video')).toBeNull();
    expect(screen.getByRole('link', { name: 'Baixar' })).toBeInTheDocument();
  });

  it('calls onClose when dismissed', async () => {
    const onClose = vi.fn();
    render(<ReferenceViewerDialog item={base} onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 11: Run them and watch them fail**

Run: `npm run test -- apps/crm/src/pages/entregas/components/__tests__/PostClientReferences.test.tsx apps/crm/src/pages/entregas/components/__tests__/ReferenceViewerDialog.test.tsx`
Expected: FAIL, both files with `Failed to resolve import "../references/PostClientReferences"` / `"../references/ReferenceViewerDialog"`.

- [ ] **Step 12: Implement the query hook**

Create `apps/crm/src/pages/entregas/components/references/usePostReferences.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { getPostReferences } from '@/store/postReferences';

// Same cache policy as ['post-media', post.id] (PostEditorBody): every refetch re-signs the R2
// URLs, which swaps every <img src> and re-downloads the thumbnails, so refetch rarely. The
// list still updates on delete (explicit invalidation), on reopening the drawer, and here.
const STALE_MS = 5 * 60 * 1000;
// Signed URLs live 3600s. Refetching every 45 minutes keeps an editor left open from serving
// expired thumbnails and download links. Side effect, accepted: a video playing in the viewer
// at that moment restarts, because its src is re-signed.
const REFRESH_SIGNED_URLS_MS = 45 * 60 * 1000;

/** The client's references for one post. One call per post editor (PostEditorBody), shared by
 *  the references section and the comment bubbles. */
export function usePostReferences(postId: number | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['post-references', postId],
    queryFn: () => getPostReferences(postId as number),
    enabled: enabled && postId != null,
    staleTime: STALE_MS,
    refetchInterval: REFRESH_SIGNED_URLS_MS,
  });
}
```

- [ ] **Step 13: Implement the tile**

Create `apps/crm/src/pages/entregas/components/references/ReferenceTile.tsx`:

```tsx
import { Download, ExternalLink, FileText, Link2, Play, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ReferenceItem } from '@/store/postReferences';
import { sanitizeUrl } from '@/utils/security';
import {
  formatReferenceDate,
  formatReferenceDuration,
  formatReferenceSize,
  isViewableReference,
  referenceLabel,
} from './referenceFormat';

export interface ReferenceTileProps {
  item: ReferenceItem;
  /** `can('entregas', 'editar') === true`, mirrored server-side by post-references DELETE. */
  canDelete: boolean;
  onOpen: (item: ReferenceItem) => void;
  onDeleteRequest: (item: ReferenceItem) => void;
}

const OVERLAY_BTN =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/95 px-2.5 py-1.5 text-[12px] font-semibold text-stone-900 shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white';
const OVERLAY_ICON_BTN =
  'inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/95 text-stone-900 shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white';

function ReferencePreview({ item }: { item: ReferenceItem }) {
  if (item.kind === 'link') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-sky-50 px-2 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
        <Link2 className="h-5 w-5" aria-hidden="true" />
        <span className="max-w-full truncate text-[11px] font-medium">
          {item.link_domain ?? 'Link'}
        </span>
      </div>
    );
  }
  if (item.file_kind === 'document') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
        <FileText className="h-6 w-6" aria-hidden="true" />
        <span className="text-[11px] font-bold tracking-wide">PDF</span>
      </div>
    );
  }
  if (item.file_kind === 'video') {
    const duration = formatReferenceDuration(item.duration_seconds);
    return (
      <div className="relative h-full w-full bg-stone-900">
        {item.thumbnail_url && (
          <img
            src={sanitizeUrl(item.thumbnail_url)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover opacity-80"
          />
        )}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white">
            <Play className="h-4 w-4 translate-x-[1px]" fill="currentColor" aria-hidden="true" />
          </span>
        </span>
        {duration && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-white">
            {duration}
          </span>
        )}
      </div>
    );
  }
  return (
    <img
      src={sanitizeUrl(item.thumbnail_url ?? item.url)}
      alt=""
      loading="lazy"
      className="h-full w-full bg-stone-100 object-cover dark:bg-stone-800"
    />
  );
}

export function ReferenceTile({ item, canDelete, onOpen, onDeleteRequest }: ReferenceTileProps) {
  const label = referenceLabel(item);
  const size = item.kind === 'file' ? formatReferenceSize(item.size_bytes) : null;
  const meta = ['Cliente', formatReferenceDate(item.created_at), size]
    .filter(Boolean)
    .join(' · ');
  const externalHref = sanitizeUrl(item.kind === 'link' ? item.link_url : item.url);
  const downloadHref =
    item.kind === 'file' && item.download_url ? sanitizeUrl(item.download_url) : null;

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid={`reference-tile-${item.id}`}>
      <div className="group relative aspect-square overflow-hidden rounded-xl ring-1 ring-[var(--border-color)]">
        <ReferencePreview item={item} />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
          {isViewableReference(item) ? (
            <button
              type="button"
              className={OVERLAY_BTN}
              onClick={() => onOpen(item)}
              aria-label={`Abrir ${label}`}
            >
              Abrir
            </button>
          ) : (
            <a
              href={externalHref}
              target="_blank"
              rel="noopener noreferrer"
              className={OVERLAY_BTN}
              aria-label={`Abrir ${label}`}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Abrir
            </a>
          )}
          {(downloadHref || canDelete) && (
            <div className="flex items-center gap-1.5">
              {downloadHref && (
                <a
                  href={downloadHref}
                  download={item.name ?? true}
                  className={OVERLAY_ICON_BTN}
                  aria-label="Baixar"
                  title="Baixar"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              )}
              {canDelete && (
                <button
                  type="button"
                  className={OVERLAY_ICON_BTN}
                  onClick={() => onDeleteRequest(item)}
                  aria-label="Excluir referência"
                  title="Excluir referência"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="min-w-0 space-y-0.5">
        {item.kind === 'link' ? (
          <a
            href={externalHref}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-[12.5px] font-semibold text-[var(--text-main)] hover:underline"
            title={label}
          >
            {label}
          </a>
        ) : (
          <p className="truncate text-[12.5px] font-semibold text-[var(--text-main)]" title={label}>
            {label}
          </p>
        )}
        {item.note && (
          <p className="line-clamp-2 break-words text-[12px] text-[var(--text-muted)]">
            {item.note}
          </p>
        )}
        <p className="text-[11px] text-[var(--text-light)]">{meta}</p>
        {item.post_approval_id != null && (
          <Badge variant="warning" size="sm">
            Na correção
          </Badge>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 14: Implement the viewer dialog**

Create `apps/crm/src/pages/entregas/components/references/ReferenceViewerDialog.tsx`:

```tsx
import { useState } from 'react';
import { Download } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { ReferenceItem } from '@/store/postReferences';
import { sanitizeUrl } from '@/utils/security';
import { referenceLabel } from './referenceFormat';

// Reference videos are plain R2 files (never Cloudflare Stream), so codecs the browser cannot
// decode (HEVC .mov in Chrome) fail here; the download is the way out.
export const VIDEO_PLAYBACK_ERROR = 'Não foi possível reproduzir aqui. Baixe o arquivo.';

export interface ReferenceViewerDialogProps {
  /** The image or video to show; null keeps the dialog closed. */
  item: ReferenceItem | null;
  onClose: () => void;
}

export function ReferenceViewerDialog({ item, onClose }: ReferenceViewerDialogProps) {
  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* Keyed by id so the playback-failure flag never leaks into the next item. */}
      {item && <ReferenceViewerContent key={item.id} item={item} />}
    </Dialog>
  );
}

function ReferenceViewerContent({ item }: { item: ReferenceItem }) {
  const [failed, setFailed] = useState(false);
  const label = referenceLabel(item);
  const src = sanitizeUrl(item.url);
  const downloadHref = item.download_url ? sanitizeUrl(item.download_url) : null;

  return (
    <DialogContent className="max-w-3xl">
      <div className="min-w-0 space-y-1 pr-8">
        <DialogTitle className="truncate text-[15px]">{label}</DialogTitle>
        <DialogDescription className={item.note ? 'text-[13px]' : 'sr-only'}>
          {item.note || 'Referência enviada pelo cliente'}
        </DialogDescription>
      </div>
      <div className="flex min-h-[200px] items-center justify-center overflow-hidden rounded-lg bg-stone-950">
        {item.file_kind === 'video' ? (
          failed ? (
            <p role="alert" className="px-6 py-10 text-center text-[13px] text-stone-200">
              {VIDEO_PLAYBACK_ERROR}
            </p>
          ) : (
            <video
              data-testid="reference-viewer-video"
              src={src}
              poster={item.thumbnail_url ? sanitizeUrl(item.thumbnail_url) : undefined}
              controls
              playsInline
              preload="metadata"
              className="max-h-[65vh] w-full"
              onError={() => setFailed(true)}
            />
          )
        ) : (
          <img src={src} alt={label} className="max-h-[65vh] w-full object-contain" />
        )}
      </div>
      {downloadHref && (
        <div className="flex justify-end">
          <a
            href={downloadHref}
            download={item.name ?? true}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--surface-hover)]"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Baixar
          </a>
        </div>
      )}
    </DialogContent>
  );
}
```

- [ ] **Step 15: Implement the bubble chips**

Create `apps/crm/src/pages/entregas/components/references/ReferenceChips.tsx`:

```tsx
import { FileText, Link2, Play } from 'lucide-react';
import type { ReferenceItem } from '@/store/postReferences';
import { sanitizeUrl } from '@/utils/security';
import { isViewableReference, referenceLabel } from './referenceFormat';

const CHIP =
  'inline-flex max-w-full items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] py-1 pl-1 pr-2.5 text-[12px] font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--surface-hover)]';
const THUMB = 'relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md';

function ChipThumb({ item }: { item: ReferenceItem }) {
  if (item.kind === 'link') {
    return (
      <span className={`${THUMB} bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300`}>
        <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    );
  }
  if (item.file_kind === 'document') {
    return (
      <span className={`${THUMB} bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300`}>
        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={`${THUMB} bg-stone-900`}>
      {item.thumbnail_url && (
        <img src={sanitizeUrl(item.thumbnail_url)} alt="" className="h-full w-full object-cover" />
      )}
      {item.file_kind === 'video' && (
        <Play className="absolute h-3 w-3 text-white" fill="currentColor" aria-hidden="true" />
      )}
    </span>
  );
}

export interface ReferenceChipsProps {
  /** References whose post_approval_id is this bubble's approval. */
  references: ReferenceItem[];
  onOpen: (item: ReferenceItem) => void;
}

/** 32px thumb + name chips under a client correction bubble. */
export function ReferenceChips({ references, onOpen }: ReferenceChipsProps) {
  if (references.length === 0) return null;
  return (
    <ul aria-label="Referências anexadas" className="mt-2 flex flex-wrap gap-1.5">
      {references.map((item) => {
        const label = referenceLabel(item);
        const body = (
          <>
            <ChipThumb item={item} />
            <span className="max-w-[160px] truncate">{label}</span>
          </>
        );
        return (
          <li key={item.id} className="min-w-0">
            {isViewableReference(item) ? (
              <button type="button" className={CHIP} onClick={() => onOpen(item)} title={label}>
                {body}
              </button>
            ) : (
              <a
                className={CHIP}
                href={sanitizeUrl(item.kind === 'link' ? item.link_url : item.url)}
                target="_blank"
                rel="noopener noreferrer"
                title={label}
              >
                {body}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 16: Implement the section**

Create `apps/crm/src/pages/entregas/components/references/PostClientReferences.tsx`:

```tsx
import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Paperclip } from 'lucide-react';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/context/AuthContext';
import { deletePostReference, type ReferenceItem } from '@/store/postReferences';
import { ReferenceTile } from './ReferenceTile';
import { referenceLabel } from './referenceFormat';

export interface PostClientReferencesProps {
  postId: number;
  /** From PostEditorBody's single `usePostReferences` call. */
  references: ReferenceItem[];
  /** Opens the editor's viewer dialog (images and videos). */
  onOpen: (item: ReferenceItem) => void;
}

/** "Referências do cliente": what the client attached in the Hub. Read-only for the team
 *  except for deletion; renders nothing when there are none (the team cannot add). */
export function PostClientReferences({ postId, references, onOpen }: PostClientReferencesProps) {
  const qc = useQueryClient();
  const headingId = useId();
  const { can } = useAuth();
  // Same gate as post-references DELETE (hasPermissionFor entregas/editar). 'unknown' while the
  // membership loads hides the trash instead of offering a delete that would 403.
  const canDelete = can('entregas', 'editar') === true;
  const [pendingDelete, setPendingDelete] = useState<ReferenceItem | null>(null);

  const removal = useMutation({
    mutationFn: (id: number) => deletePostReference(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['post-references', postId] });
      // Prefix: the drawer keys counts by workflow id, which this section does not know.
      qc.invalidateQueries({ queryKey: ['post-reference-counts'] });
      toast.success('Referência excluída');
    },
    onError: (err) => {
      toast.error(
        err instanceof Error && err.message === 'forbidden'
          ? 'Você não tem permissão para excluir referências.'
          : 'Não foi possível excluir a referência. Tente novamente.',
      );
    },
  });
  useUnsavedWork(removal.isPending);

  if (references.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-3 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-3"
    >
      <header className="flex flex-wrap items-center gap-2">
        <Paperclip className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
        <h4 id={headingId} className="text-[13px] font-semibold text-[var(--text-main)]">
          Referências do cliente
        </h4>
        <Badge variant="info" size="sm">
          {references.length}
        </Badge>
        <span className="text-[12px] text-[var(--text-light)]">Enviadas pelo Hub</span>
      </header>

      <ul className="grid grid-cols-3 gap-3 min-[900px]:grid-cols-4">
        {references.map((item) => (
          <li key={item.id} className="min-w-0">
            <ReferenceTile
              item={item}
              canDelete={canDelete}
              onOpen={onOpen}
              onDeleteRequest={setPendingDelete}
            />
          </li>
        ))}
      </ul>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir referência?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `${referenceLabel(pendingDelete)} sai deste post para a equipe e para o cliente. Não dá para desfazer.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDelete) removal.mutate(pendingDelete.id);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
```

- [ ] **Step 17: Run the component tests and watch them pass**

Run: `npm run test -- apps/crm/src/pages/entregas/components/__tests__/PostClientReferences.test.tsx apps/crm/src/pages/entregas/components/__tests__/ReferenceViewerDialog.test.tsx`
Expected: PASS, `Test Files  2 passed (2)`, `Tests  19 passed (19)`.

If `getByRole('region', { name: 'Referências do cliente' })` fails: a `<section>` is only a
`region` when it has an accessible name; check the `aria-labelledby`/`useId` wiring rather
than switching the query.

- [ ] **Step 18: Commit**

```bash
git add apps/crm/src/pages/entregas/components/references apps/crm/src/pages/entregas/components/__tests__/referenceFormat.test.ts apps/crm/src/pages/entregas/components/__tests__/PostClientReferences.test.tsx apps/crm/src/pages/entregas/components/__tests__/ReferenceViewerDialog.test.tsx
git commit -m "feat(crm): client references section, tile, viewer and chips

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 19: Mock the new store module in the five drawer harnesses**

These suites render the real `PostEditorBody`/`WorkflowDrawer`. Without a mock the real
module runs against each file's `@/lib/supabase` stub (no `auth`, no `.in()`), which ends in a
query error: no crash, but slow retries and noise. Add the block below right after the
anchor line in each file (vi.mock is hoisted, the position is only for readability):

| File (`apps/crm/src/pages/entregas/components/__tests__/`) | Anchor line |
|---|---|
| `WorkflowDrawer.test.tsx` | `vi.mock('@/services/postMedia', () => ({ listPostMedia: vi.fn(async () => []) }));` (:140) |
| `WorkflowDrawer.duplicate.test.tsx` | same line (:130) |
| `WorkflowDrawerAutoScheduleNudge.test.tsx` | same line (:152) |
| `StandalonePostDrawer.test.tsx` | same line (:103) |
| `WorkflowDrawerAutoComplete.test.tsx` | `vi.mock('../../../../services/postMedia', () => ({ listPostMedia: vi.fn().mockResolvedValue([]) }));` (:64) |

Block to insert after the anchor:

```ts
// PostEditorBody and WorkflowDrawer read client references from this module by path.
vi.mock('@/store/postReferences', () => ({
  getPostReferences: vi.fn(async () => []),
  getPostReferenceCounts: vi.fn(async () => ({})),
  deletePostReference: vi.fn(),
}));
```

- [ ] **Step 20: Write the failing drawer integration test**

Create `apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawer.references.test.tsx`
(harness cloned from `WorkflowDrawer.duplicate.test.tsx`, the smallest working stub set):

```tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BoardCard } from '../../hooks/useEntregasData';
import type { ReferenceItem } from '@/store/postReferences';
import { makeCan, fakeMembership } from '@/test/makeCan';

// Client references in the WorkflowDrawer: the collapsed-row badge (counts query) and, on an
// expanded post, the section under the media plus chips on the client's correction bubble.

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    role: 'owner',
    loading: false,
    profile: null,
    can: makeCan(fakeMembership({ role: 'owner' })),
  }),
}));

vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({
    limits: null,
    features: null,
    planName: null,
    isLoading: false,
    isUnlimited: true,
  }),
}));

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: () => null,
  PointerSensor: class {},
  useSensor: () => ({}),
  useSensors: (...sensors: unknown[]) => sensors,
}));
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: () => null,
  arrayMove: (arr: unknown[]) => arr,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  },
}));

vi.mock('@/store', () => ({
  getWorkflowPostsWithProperties: vi.fn(),
  addWorkflowPost: vi.fn(),
  updateWorkflowPost: vi.fn(),
  isFinalClientApprovalCycle: vi.fn(() => true),
  cardAutoScheduleGates: vi.fn(() => ({ autoPublishOnApproval: true, isFinalApprovalCycle: true })),
  removeWorkflowPost: vi.fn(),
  reorderWorkflowPosts: vi.fn(),
  sendPostsToCliente: vi.fn(),
  getPostApprovals: vi.fn(async () => []),
  getPostStatusEvents: vi.fn(async () => []),
  getPostProcessEvents: vi.fn(async () => []),
  replyToPostApproval: vi.fn(),
  completeEtapa: vi.fn(),
  getPostCommentThreads: vi.fn(async () => []),
  createCommentThread: vi.fn(),
  saveIgCaption: vi.fn(),
  addPostComment: vi.fn(),
  updatePostComment: vi.fn(),
  deletePostComment: vi.fn(),
  resolveCommentThread: vi.fn(),
  reopenCommentThread: vi.fn(),
  deleteCommentThread: vi.fn(),
  getWorkspaceUsers: vi.fn(async () => []),
  getPostEditSuggestions: vi.fn(async () => []),
  acceptEditSuggestion: vi.fn(),
  rejectEditSuggestion: vi.fn(),
  getClientePosts: vi.fn(async () => []),
  createDesign: vi.fn(),
  getDesignForPost: vi.fn(async () => null),
  syncMentions: vi.fn(),
  detachPostsFromWorkflow: vi.fn(),
  detachPostsKeepingProcess: vi.fn(),
  getWorkflows: vi.fn(async () => []),
  movePostsToNewFlow: vi.fn(),
  movePostsToExistingFlow: vi.fn(),
  clonePost: vi.fn(),
  cloneWorkflow: vi.fn(),
}));

vi.mock('@/store/postReferences', () => ({
  getPostReferences: vi.fn(async () => []),
  getPostReferenceCounts: vi.fn(async () => ({})),
  deletePostReference: vi.fn(),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock('@/services/postMedia', () => ({ listPostMedia: vi.fn(async () => []) }));
vi.mock('@/services/inlineImage', () => ({
  uploadInlineImage: vi.fn(),
  extractR2Keys: () => [],
  injectSignedUrls: (doc: unknown) => doc,
  stripSignedUrls: (doc: unknown) => doc,
  resolveInlineImageUrls: vi.fn(async () => ({})),
}));
vi.mock('@/pages/entregas/components/PostEditor', () => ({
  PostEditor: () => <div data-testid="post-editor-stub" />,
}));
vi.mock('@/pages/entregas/components/PropertyPanel', () => ({
  PropertyPanel: () => <div data-testid="property-panel-stub" />,
}));
vi.mock('@/pages/entregas/components/PostCommentSummary', () => ({
  default: () => <div data-testid="post-comment-summary-stub" />,
}));
vi.mock('@/pages/entregas/components/PostTimelinePopover', () => ({
  PostTimelinePopover: () => <div data-testid="post-timeline-popover-stub" />,
}));
vi.mock('@/pages/entregas/components/PostMediaGallery', () => ({
  PostMediaGallery: () => <div data-testid="post-media-gallery-stub" />,
  hasVideoMissingThumbnail: () => false,
}));
vi.mock('@/pages/estudio/ImportToEstudioDialog', () => ({ ImportToEstudioDialog: () => null }));
vi.mock('@/pages/entregas/components/InstagramCaptionField', () => ({
  InstagramCaptionField: () => <div data-testid="ig-caption-stub" />,
}));
vi.mock('@/pages/entregas/components/PlatformSelector', () => ({
  PlatformSelector: () => <div data-testid="platform-selector-stub" />,
}));
vi.mock('@/pages/entregas/components/TikTokSettingsPanel', () => ({
  TikTokSettingsPanel: () => <div data-testid="tiktok-settings-stub" />,
}));
vi.mock('@/pages/entregas/components/ScheduleButton', () => ({
  ScheduleButton: () => <div data-testid="schedule-button-stub" />,
}));
vi.mock('@/components/ui/date-time-picker', () => ({
  DateTimePicker: () => <div data-testid="date-time-picker-stub" />,
}));
vi.mock('@/pages/entregas/components/WorkflowCalendarView', () => ({
  WorkflowCalendarView: () => <div data-testid="workflow-calendar-view-stub" />,
}));
vi.mock('@/pages/entregas/components/WorkflowHistoryView', () => ({
  WorkflowHistoryView: () => <div data-testid="workflow-history-view-stub" />,
}));
vi.mock('@/components/CopyPostLinkButton', () => ({
  CopyPostLinkButton: () => <div data-testid="copy-post-link-stub" />,
}));
vi.mock('@/pages/entregas/components/DiffView', () => ({
  DiffView: () => <div data-testid="diff-view-stub" />,
}));
vi.mock('@/pages/entregas/components/ReadOnlyTipTap', () => ({
  ReadOnlyTipTap: () => <div data-testid="read-only-tiptap-stub" />,
}));

import { WorkflowDrawer } from '../WorkflowDrawer';
import { getPostApprovals, getWorkflowPostsWithProperties } from '@/store';
import { getPostReferenceCounts, getPostReferences } from '@/store/postReferences';

const mockGetPosts = vi.mocked(getWorkflowPostsWithProperties);
const mockGetApprovals = vi.mocked(getPostApprovals);
const mockCounts = vi.mocked(getPostReferenceCounts);
const mockGetReferences = vi.mocked(getPostReferences);

function post(id: number, titulo: string, status = 'rascunho') {
  return {
    id,
    workflow_id: 10,
    titulo,
    conteudo: null,
    conteudo_plain: '',
    tipo: 'feed',
    ordem: id,
    status,
    responsavel_id: null,
    scheduled_at: null,
    ig_caption: null,
    platform: 'instagram',
  } as never;
}

function reference(overrides: Partial<ReferenceItem> & Pick<ReferenceItem, 'id'>): ReferenceItem {
  return {
    kind: 'file',
    file_kind: 'image',
    name: 'foto.jpg',
    mime_type: 'image/jpeg',
    size_bytes: 1024 * 1024,
    duration_seconds: null,
    width: null,
    height: null,
    url: 'https://r2.example.com/full.jpg',
    thumbnail_url: 'https://r2.example.com/thumb.webp',
    blur_data_url: null,
    download_url: 'https://r2.example.com/full.jpg?download=1',
    link_url: null,
    link_title: null,
    link_domain: null,
    note: null,
    post_approval_id: null,
    created_at: new Date().toISOString(),
    can_remove: false,
    ...overrides,
  };
}

const CORRECTION = {
  id: 501,
  post_id: 1,
  token: 't',
  action: 'correcao' as const,
  comentario: 'Trocar a foto da capa',
  is_workspace_user: false,
  created_at: new Date().toISOString(),
};

function renderDrawer(initialPostId?: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const card = {
    workflow: {
      id: 10,
      cliente_id: 42,
      titulo: 'Campanha Julho',
      template_id: null,
      status: 'ativo',
      etapa_atual: 0,
      recorrente: false,
    },
    etapa: {
      id: 1,
      workflow_id: 10,
      ordem: 0,
      nome: 'Aprovação',
      prazo_dias: 3,
      tipo_prazo: 'uteis',
      status: 'ativo',
    },
    cliente: {
      id: 42,
      nome: 'Marca X',
      sigla: 'MX',
      cor: '#000',
      plano: 'pro',
      email: '',
      telefone: '',
      status: 'ativo',
      valor_mensal: 0,
    },
    membro: undefined,
    deadline: null,
    totalEtapas: 1,
    etapaIdx: 0,
    allEtapas: [],
  } as unknown as BoardCard;

  return render(
    <QueryClientProvider client={qc}>
      <WorkflowDrawer
        card={card}
        membros={[]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        initialPostId={initialPostId}
      />
    </QueryClientProvider>,
  );
}

function rowOf(titulo: string) {
  return screen
    .getByRole('checkbox', { name: `Selecionar ${titulo}` })
    .closest('.drawer-post-item') as HTMLElement;
}

describe('WorkflowDrawer: referências do cliente', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPosts.mockResolvedValue([post(1, 'Post A'), post(2, 'Post B')]);
    mockGetApprovals.mockResolvedValue([]);
    mockCounts.mockResolvedValue({});
    mockGetReferences.mockResolvedValue([]);
  });

  it('shows "N referências" on the collapsed row of posts that have them', async () => {
    mockCounts.mockResolvedValue({ 1: 2 });
    renderDrawer();
    await screen.findByRole('checkbox', { name: 'Selecionar Post A' });

    expect(await within(rowOf('Post A')).findByText('2 referências')).toBeInTheDocument();
    expect(within(rowOf('Post B')).queryByText(/referência/)).toBeNull();
    expect(mockCounts).toHaveBeenCalledWith([1, 2]);
  });

  it('uses the singular for one reference', async () => {
    mockCounts.mockResolvedValue({ 2: 1 });
    renderDrawer();
    await screen.findByRole('checkbox', { name: 'Selecionar Post B' });
    expect(await within(rowOf('Post B')).findByText('1 referência')).toBeInTheDocument();
  });

  it('expanded post: section after the media, chips on the correction, viewer on click', async () => {
    mockGetApprovals.mockResolvedValue([CORRECTION]);
    mockGetReferences.mockResolvedValue([
      reference({ id: 1, name: 'foto-praia.jpg', post_approval_id: 501 }),
      reference({
        id: 2,
        file_kind: 'document',
        name: 'tabela.pdf',
        mime_type: 'application/pdf',
        thumbnail_url: null,
      }),
    ]);
    renderDrawer(1);

    const section = await screen.findByRole('region', { name: 'Referências do cliente' });
    expect(mockGetReferences).toHaveBeenCalledWith(1);
    // Rendered right after the media gallery.
    const gallery = screen.getByTestId('post-media-gallery-stub');
    expect(gallery.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const chips = await screen.findByRole('list', { name: 'Referências anexadas' });
    expect(within(chips).getByText('foto-praia.jpg')).toBeInTheDocument();
    expect(within(chips).queryByText('tabela.pdf')).toBeNull();

    fireEvent.click(within(chips).getByRole('button', { name: /foto-praia\.jpg/ }));
    expect(await screen.findByRole('dialog', { name: 'foto-praia.jpg' })).toBeInTheDocument();
  });

  it('no references: no section and no chips', async () => {
    mockGetApprovals.mockResolvedValue([CORRECTION]);
    renderDrawer(1);
    await screen.findByText('Trocar a foto da capa');
    await waitFor(() => expect(mockGetReferences).toHaveBeenCalledWith(1));
    expect(screen.queryByRole('region', { name: 'Referências do cliente' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Referências anexadas' })).toBeNull();
  });
});
```

- [ ] **Step 21: Run it and watch it fail**

Run: `npm run test -- apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawer.references.test.tsx`
Expected: FAIL. The two badge tests time out on `findByText('2 referências')` / `'1 referência'`,
the expanded test times out on `findByRole('region', { name: 'Referências do cliente' })`.
The "no references" test may already pass.

- [ ] **Step 22: Wire the references into PostEditorBody**

In `apps/crm/src/pages/entregas/components/PostEditorBody.tsx`:

(a) After `import { PostMediaGallery } from './PostMediaGallery';` (:22) add:

```ts
import { PostClientReferences } from './references/PostClientReferences';
import { ReferenceViewerDialog } from './references/ReferenceViewerDialog';
import { ReferenceChips } from './references/ReferenceChips';
import { usePostReferences } from './references/usePostReferences';
// By path, not through the '../../../store' barrel: the drawer test harnesses mock '@/store'.
import type { ReferenceItem } from '@/store/postReferences';
```

(b) Directly above `export interface PostEditorBodyProps {` (:89) add:

```ts
// Stable fallback so the per-bubble filter below never sees a new array identity while the
// references query is disabled (collapsed row) or still loading.
const EMPTY_REFERENCES: ReferenceItem[] = [];

```

(c) Replace

```ts
    enabled: isExpanded && !!post.id,
  });

  // TikTok settings completeness/test-mode-banner seam (Task C3), held here rather than
```

with

```ts
    enabled: isExpanded && !!post.id,
  });

  // Client references (Hub). One fetch per post feeds the section under the media gallery and
  // the chips on the client's correction bubbles; same expand gate as the media query above.
  const { data: references = EMPTY_REFERENCES } = usePostReferences(post.id, isExpanded);
  // One viewer for both entry points (tile "Abrir" and bubble chips).
  const [viewingReference, setViewingReference] = useState<ReferenceItem | null>(null);

  // TikTok settings completeness/test-mode-banner seam (Task C3), held here rather than
```

(d) Replace

```tsx
        tiktokPostUrl={post.tiktok_post_url}
      />

      {post.id != null && (
        <div className="flex justify-end">
```

with

```tsx
        tiktokPostUrl={post.tiktok_post_url}
      />

      {post.id != null && (
        <PostClientReferences
          postId={post.id}
          references={references}
          onOpen={setViewingReference}
        />
      )}

      {post.id != null && (
        <div className="flex justify-end">
```

(e) Replace

```tsx
          {approvals.map((a) => (
            <PostApprovalBubble key={a.id} approval={a} />
          ))}
```

with

```tsx
          {approvals.map((a) => (
            <PostApprovalBubble
              key={a.id}
              approval={a}
              references={references.filter((r) => r.post_approval_id === a.id)}
              onOpenReference={setViewingReference}
            />
          ))}
```

(f) Replace

```tsx
          statusEvents={statusEvents}
          approvals={approvals}
        />
      )}
    </div>
  );
}
```

with

```tsx
          statusEvents={statusEvents}
          approvals={approvals}
        />
      )}

      <ReferenceViewerDialog item={viewingReference} onClose={() => setViewingReference(null)} />
    </div>
  );
}
```

(g) Replace

```tsx
function PostApprovalBubble({ approval }: { approval: PostApproval }) {
```

with

```tsx
function PostApprovalBubble({
  approval,
  references,
  onOpenReference,
}: {
  approval: PostApproval;
  /** References the client attached to this correction (post_references.post_approval_id). */
  references: ReferenceItem[];
  onOpenReference: (item: ReferenceItem) => void;
}) {
```

and replace

```tsx
      {approval.comentario && <p className="approval-bubble-text">{approval.comentario}</p>}
    </div>
```

with

```tsx
      {approval.comentario && <p className="approval-bubble-text">{approval.comentario}</p>}
      <ReferenceChips references={references} onOpen={onOpenReference} />
    </div>
```

- [ ] **Step 23: Add the count badge and refresh wiring to WorkflowDrawer**

In `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`:

(a) In the lucide import list replace `  CalendarClock,\n} from 'lucide-react';` with:

```ts
  CalendarClock,
  Paperclip,
} from 'lucide-react';
```

(b) After `import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';` (:137) add:

```ts
import { Badge } from '@/components/ui/badge';
// By path, not through the '../../../store' barrel: the drawer test harnesses mock '@/store'
// with explicit factories, so a new barrel export would be missing from every one of them.
import { getPostReferenceCounts } from '@/store/postReferences';
```

(c) Replace

```ts
const EMPTY_PROCESS_EVENTS: PostProcessEvent[] = [];
```

with

```ts
const EMPTY_PROCESS_EVENTS: PostProcessEvent[] = [];
const EMPTY_REFERENCE_COUNTS: Record<number, number> = {};
```

(d) Replace

```ts
  const { data: editSuggestions = [] } = useQuery({
    queryKey: ['post-edit-suggestions', postIds.join(',')],
    queryFn: () => getPostEditSuggestions(postIds),
    enabled: postIds.length > 0,
  });
```

with

```ts
  const { data: editSuggestions = [] } = useQuery({
    queryKey: ['post-edit-suggestions', postIds.join(',')],
    queryFn: () => getPostEditSuggestions(postIds),
    enabled: postIds.length > 0,
  });

  // Client references per post for the collapsed row's badge: one RLS-scoped select of post_id
  // for the whole workflow, counted client-side. Keyed by workflow (not by postIds), so a post
  // added later is picked up through refresh() below, which invalidates this key; the
  // references section's delete invalidates the ['post-reference-counts'] prefix.
  const { data: referenceCounts = EMPTY_REFERENCE_COUNTS } = useQuery({
    queryKey: ['post-reference-counts', workflowId],
    queryFn: () => getPostReferenceCounts(postIds),
    enabled: postIds.length > 0,
  });
```

(e) In `refresh()` add ONLY the counts key (no URLs in it, cheap). Do NOT add
`['post-references']`: `refresh()` runs on every debounced título save and content autosave
(see `PostEditorBody.tsx:220-221`), and each refetch re-signs every R2 URL, so every thumbnail
in the section, the chips and an open viewer would re-download. `['post-media', post.id]` is
kept out of `refresh()` for the same reason. Replace

```ts
    qc.invalidateQueries({ queryKey: ['post-process-events'] });
    qc.invalidateQueries({ queryKey: ['workflow-events', workflowId] });
```

with

```ts
    qc.invalidateQueries({ queryKey: ['post-process-events'] });
    qc.invalidateQueries({ queryKey: ['post-reference-counts', workflowId] });
    qc.invalidateQueries({ queryKey: ['workflow-events', workflowId] });
```

(f) In the `<SortablePostItem` call replace

```tsx
                          editSuggestion={
                            editSuggestions.find((s) => s.post_id === post.id) ?? null
                          }
```

with

```tsx
                          editSuggestion={
                            editSuggestions.find((s) => s.post_id === post.id) ?? null
                          }
                          referenceCount={referenceCounts[post.id!] ?? 0}
```

(g) In `interface SortablePostItemProps` replace

```ts
  editSuggestion: PostEditSuggestion | null;
  membros: Membro[];
```

with

```ts
  editSuggestion: PostEditSuggestion | null;
  /** Client references on this post (Hub uploads and links), for the collapsed-row badge. */
  referenceCount: number;
  membros: Membro[];
```

(h) In the `function SortablePostItem({` destructuring replace

```ts
  editSuggestion,
  membros,
  replyText,
```

with

```ts
  editSuggestion,
  referenceCount,
  membros,
  replyText,
```

(unique in the file: the destructuring at :1384-1386; `PostEditorBody`'s call passes
`editSuggestion={...}`, which does not match).

(i) Replace

```tsx
          {editSuggestion && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-100 text-amber-800">
              Sugestão pendente
            </span>
          )}
```

with

```tsx
          {editSuggestion && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-100 text-amber-800">
              Sugestão pendente
            </span>
          )}
          {referenceCount > 0 && (
            <Badge
              variant="info"
              size="sm"
              className="inline-flex items-center gap-1"
              title="Referências enviadas pelo cliente no Hub"
            >
              <Paperclip className="h-3 w-3" aria-hidden="true" />
              {referenceCount === 1 ? '1 referência' : `${referenceCount} referências`}
            </Badge>
          )}
```

- [ ] **Step 24: Run the drawer test and watch it pass**

Run: `npm run test -- apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawer.references.test.tsx`
Expected: PASS, `Tests  4 passed (4)`.

- [ ] **Step 25: Regression: every suite that renders the real drawers or the editor**

Run:
```bash
npm run test -- apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawer.test.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawer.duplicate.test.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoComplete.test.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoScheduleNudge.test.tsx apps/crm/src/pages/entregas/components/__tests__/StandalonePostDrawer.test.tsx apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx apps/crm/src/pages/cliente-detalhe/tabs/__tests__/EntregasTab.test.tsx apps/crm/src/pages/entregas/views/__tests__/PostsKanbanAutoScheduleNudge.test.tsx apps/crm/src/pages/entregas/views/__tests__/ConcludedView.test.tsx
```
Expected: PASS, `Test Files  9 passed (9)`, same test count as on `main` for these files
(`EntregasPage`/`EntregasTab` mock both drawers, the views suites do not render them; they are
here as a cheap guard).

- [ ] **Step 26: Typecheck, lint, format**

Run:
```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run lint
npx prettier --write apps/crm/src/store/postReferences.ts apps/crm/src/store/__tests__/postReferences.test.ts apps/crm/src/pages/entregas/components/references apps/crm/src/pages/entregas/components/__tests__/referenceFormat.test.ts apps/crm/src/pages/entregas/components/__tests__/PostClientReferences.test.tsx apps/crm/src/pages/entregas/components/__tests__/ReferenceViewerDialog.test.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawer.references.test.tsx apps/crm/src/pages/entregas/components/PostEditorBody.tsx apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawer.test.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawer.duplicate.test.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoComplete.test.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoScheduleNudge.test.tsx apps/crm/src/pages/entregas/components/__tests__/StandalonePostDrawer.test.tsx
npm run format:check
```
Expected: tsc prints nothing (exit 0); lint ends with `0 errors` (warnings allowed, none new
in these files); `format:check` prints `All matched files use Prettier code style!`.
If prettier rewrote anything, re-run Step 24 and the component tests once.

- [ ] **Step 27: Browser check (light and dark)**

`npm run dev:env`, open a post in `Entregas` that has references in staging/seeded data (or
stub `post-references` with the Browser pane fetch patch, see the memory note "Hub repro via
patched fetch"). Check: section sits directly after the media gallery (PostMediaGallery has no heading of its
own); 4 columns at 1280px, 3 at
800px; hover and Tab both reveal "Abrir", "Baixar", trash; a link tile has no "Baixar"; the
viewer plays an mp4 and shows the fallback copy for an HEVC .mov in Chrome; the collapsed card
shows "N referências"; toggle `data-theme="dark"` and confirm tiles, badge and chips use the
dark tokens. On a touch device (or the pane's mobile preset) the overlay is hover/focus-only:
the first tap on a tile raises it (iOS Safari applies `:hover` on tap), the second hits the
button; confirm that is usable rather than discovering it later.

- [ ] **Step 28: Commit**

```bash
git add apps/crm/src/pages/entregas/components/PostEditorBody.tsx apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawer.references.test.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawer.test.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawer.duplicate.test.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoComplete.test.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoScheduleNudge.test.tsx apps/crm/src/pages/entregas/components/__tests__/StandalonePostDrawer.test.tsx
git commit -m "feat(crm): client references in the post editor, bubbles and drawer card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: CRM notification for client references

**Files:**
- Modify: `apps/crm/src/store/notifications.ts` (union, after `'post_edit_suggestion'` at :7)
- Modify: `apps/crm/src/lib/notification-catalog.ts` (entry after `post_edit_suggestion` at :64-70; this catalog IS the in-app preferences list: `SuasNotificacoesSection.tsx:28` builds its rows from it, and `satisfies Record<NotificationType, …>` at :253 makes the entry mandatory once the union grows)
- Modify: `apps/crm/src/lib/notification-config.ts` (icon import, case after `post_edit_suggestion` at :139-146)
- Create: `apps/crm/src/lib/__tests__/notification-config.post-client-reference.test.ts`
- Modify: `apps/crm/src/__tests__/notification-catalog.test.ts` (:6-7, 30 → 31)
- Modify: `apps/crm/src/pages/configuracao/__tests__/NotificacoesTab.test.tsx` (:8, :202, :208, 30 → 31)

**Interfaces:**

```ts
type NotificationType = ... | 'post_client_reference' | ...;
NOTIFICATION_CATALOG.post_client_reference = {
  category: 'aprovacoes_hub', label: 'Referências do cliente',
  when: 'o cliente anexa fotos, vídeos, PDFs ou links a um post no Hub',
  recipients: RESP_ADMINS, emailEligible: false,
};
getNotificationDisplay('post_client_reference', { client_name, post_title, workflow_id, post_id })
  // => { icon: Paperclip, tone: 'teal', title: '{cliente} enviou referências em {post}', body: '' }
```

Click handling needs no change: `NotificationItem.tsx:27` navigates by `notification.link`,
which `create_post_reference_notification` fills with the same `/entregas?post=` /
`/entregas?drawer=` CASE as edit suggestions. `emailEligible: false` keeps
`EMAIL_ELIGIBLE_TYPES` (and its 16-count test in `notification-prefs-store.test.ts:12`)
unchanged, matching the SQL side where `claim_notification_emails` has its own allowlist.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/lib/__tests__/notification-config.post-client-reference.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { Paperclip } from 'lucide-react';
import { getNotificationDisplay } from '../notification-config';
import { NOTIFICATION_CATALOG, EMAIL_ELIGIBLE_TYPES } from '../notification-catalog';

describe('post_client_reference notification', () => {
  test('names the client and the post, with the paperclip', () => {
    const d = getNotificationDisplay('post_client_reference', {
      client_name: 'Clínica X',
      post_title: 'Post 1',
      workflow_id: 3,
      post_id: 9,
    });
    expect(d.icon).toBe(Paperclip);
    expect(d.tone).toBe('teal');
    expect(d.title).toBe('Clínica X enviou referências em Post 1');
    expect(d.body).toBe('');
  });

  test('falls back when the metadata is missing', () => {
    const d = getNotificationDisplay('post_client_reference', {});
    expect(d.title).toBe('Cliente enviou referências em Post');
  });

  test('appears in the in-app preferences as "Referências do cliente", never by e-mail', () => {
    expect(NOTIFICATION_CATALOG.post_client_reference).toEqual({
      category: 'aprovacoes_hub',
      label: 'Referências do cliente',
      when: 'o cliente anexa fotos, vídeos, PDFs ou links a um post no Hub',
      recipients: 'responsável pelo item + donos e admins',
      emailEligible: false,
    });
    expect(EMAIL_ELIGIBLE_TYPES).not.toContain('post_client_reference');
  });

  test('new copy has no em dash', () => {
    const d = getNotificationDisplay('post_client_reference', {
      client_name: 'A',
      post_title: 'B',
    });
    const entry = NOTIFICATION_CATALOG.post_client_reference;
    for (const text of [d.title, d.body, entry.label, entry.when, entry.recipients]) {
      expect(text).not.toMatch(/—/);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -- apps/crm/src/lib/__tests__/notification-config.post-client-reference.test.ts`
Expected: FAIL. `getNotificationDisplay` hits `default` (title `'Notificação'`, icon `Bell`),
and `NOTIFICATION_CATALOG.post_client_reference` is `undefined`.

- [ ] **Step 3: Add the type to the union**

In `apps/crm/src/store/notifications.ts` replace

```ts
  | 'post_edit_suggestion'
  | 'idea_submitted'
```

with

```ts
  | 'post_edit_suggestion'
  | 'post_client_reference'
  | 'idea_submitted'
```

- [ ] **Step 4: Add the catalog entry (in-app preferences row)**

In `apps/crm/src/lib/notification-catalog.ts` replace

```ts
    when: 'o cliente sugere ou atualiza uma alteração de texto ou legenda no Hub',
    recipients: RESP_ADMINS,
    emailEligible: false,
  },
```

with

```ts
    when: 'o cliente sugere ou atualiza uma alteração de texto ou legenda no Hub',
    recipients: RESP_ADMINS,
    emailEligible: false,
  },
  post_client_reference: {
    category: 'aprovacoes_hub',
    label: 'Referências do cliente',
    when: 'o cliente anexa fotos, vídeos, PDFs ou links a um post no Hub',
    recipients: RESP_ADMINS,
    emailEligible: false,
  },
```

- [ ] **Step 5: Add the display case**

In `apps/crm/src/lib/notification-config.ts`:

(a) In the lucide import list replace

```ts
  MessageSquare,
  Play,
```

with

```ts
  MessageSquare,
  Paperclip,
  Play,
```

(b) Replace

```ts
    case 'idea_submitted':
```

with

```ts
    case 'post_client_reference':
      // One sentence says it all; the RPC coalesces a burst of uploads into one row, so no
      // count. Empty body on purpose: the neighbours' "{client} — {post}" body would repeat
      // the title (and new copy carries no em dash).
      return {
        icon: Paperclip,
        tone: 'teal',
        title: `${client} enviou referências em ${post}`,
        body: '',
      };
    case 'idea_submitted':
```

- [ ] **Step 6: Bump the catalog-size assertions (30 → 31)**

In `apps/crm/src/__tests__/notification-catalog.test.ts` replace

```ts
  it('cobre exatamente os 30 tipos', () => {
    expect(Object.keys(NOTIFICATION_CATALOG)).toHaveLength(30);
```

with

```ts
  it('cobre exatamente os 31 tipos', () => {
    expect(Object.keys(NOTIFICATION_CATALOG)).toHaveLength(31);
```

In `apps/crm/src/pages/configuracao/__tests__/NotificacoesTab.test.tsx`:
- line 8: replace `"6 groups / 30 rows"` with `"6 groups / 31 rows"`;
- replace `it('renders the 6 CATEGORY_LABELS groups and all 30 catalog type rows', async () => {`
  with `it('renders the 6 CATEGORY_LABELS groups and all 31 catalog type rows', async () => {`;
- replace `    expect(Object.keys(NOTIFICATION_CATALOG).length).toBe(30);`
  with `    expect(Object.keys(NOTIFICATION_CATALOG).length).toBe(31);`.

That NotificacoesTab test already iterates every catalog label, so it now also asserts the
"Referências do cliente" row renders in the preferences UI.

- [ ] **Step 7: Run the notification suites and watch them pass**

Run:
```bash
npm run test -- apps/crm/src/lib/__tests__/notification-config.post-client-reference.test.ts apps/crm/src/lib/__tests__/notification-config.edit-suggestion.test.ts apps/crm/src/__tests__/notification-catalog.test.ts apps/crm/src/__tests__/notification-prefs-store.test.ts apps/crm/src/pages/configuracao/__tests__/NotificacoesTab.test.tsx apps/crm/src/components/layout/__tests__/NotificationItem.test.tsx
```
Expected: PASS, `Test Files  6 passed (6)`.

- [ ] **Step 8: Typecheck, lint, format**

Run:
```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run lint
npx prettier --write apps/crm/src/store/notifications.ts apps/crm/src/lib/notification-catalog.ts apps/crm/src/lib/notification-config.ts apps/crm/src/lib/__tests__/notification-config.post-client-reference.test.ts apps/crm/src/__tests__/notification-catalog.test.ts apps/crm/src/pages/configuracao/__tests__/NotificacoesTab.test.tsx
npm run format:check
```
Expected: tsc exit 0 (a missing catalog entry would fail here on the `satisfies` at
`notification-catalog.ts:253`); lint `0 errors`; `All matched files use Prettier code style!`.

- [ ] **Step 9: Commit**

```bash
git add apps/crm/src/store/notifications.ts apps/crm/src/lib/notification-catalog.ts apps/crm/src/lib/notification-config.ts apps/crm/src/lib/__tests__/notification-config.post-client-reference.test.ts apps/crm/src/__tests__/notification-catalog.test.ts apps/crm/src/pages/configuracao/__tests__/NotificacoesTab.test.tsx
git commit -m "feat(crm): post_client_reference notification and preference row

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Contract issues

1. **Counts query key vs. its input.** `['post-reference-counts', workflowId]` is fixed by the
   contract, but the query reads `postIds`. A post added to the workflow does not change the
   key, so its count only appears after an invalidation. Covered: `WorkflowDrawer.refresh()`
   (which every post add/remove/status change calls) invalidates the key, and the section's
   delete invalidates the `['post-reference-counts']` prefix. No contract change needed; noted
   so nobody "fixes" the key by adding `postIds` and breaks the prefix invalidation shape.
2. **Store not in the barrel.** The contract names `apps/crm/src/store/postReferences.ts` and
   its exports; it does not say whether `store/index.ts` re-exports it. This plan deliberately
   does NOT add `export * from './postReferences'`: five drawer harnesses mock `@/store` with
   explicit factories and Vitest throws on access to an export missing from the factory, so any
   consumer importing these functions through the barrel would break them. All consumers import
   `@/store/postReferences` by path.
3. **Extra files beyond the contract's component list** (additive, no renames):
   `references/referenceFormat.ts` (size/date/duration/label helpers; the existing
   `formatBytes` in `pages/arquivos/components/FileGrid.tsx:14` prints "2.4 MB" with a dot and
   lives in a component module) and `references/usePostReferences.ts` (the
   `['post-references', postId]` query, adds `refetchInterval` 45 min so signed URLs, which live
   3600s, do not expire under an editor left open).
4. **Notification copy split.** The spec gives one sentence, "{cliente} enviou referências em
   {post}". It is used as the `title` with an empty `body` (an empty `display:block` span has no
   height in `NotificationItem.tsx:92-103`). The neighbour types' `"${client} — ${post}"` body
   is not copied because it would repeat the title and carry an em dash.
5. **`delete` error code.** The CRM maps only `forbidden` (403 from `post-references`
   DELETE) to specific copy; everything else (including `not_found` when the client removed it
   first) gets the generic toast and the list refreshes on the next invalidation. If the
   function returns `not_found` for an already-deleted reference, consider treating it as
   success (invalidate and no error) in a follow-up; the contract does not pin DELETE's error
   codes beyond `forbidden`.

6. **CRM staleTime.** The contract pins the CRM key `['post-references', postId]` but no
   staleTime (30s is specified only for the Hub hook). The CRM hook uses 5 minutes, matching
   `['post-media', post.id]`, because each refetch re-signs every URL and re-downloads the
   thumbnails (and `refetchOnWindowFocus` would do it on every tab switch at 30s). For the same
   reason `['post-references']` is NOT invalidated by `WorkflowDrawer.refresh()` /
   `StandalonePostDrawer.refresh()`, which run on every título/content autosave; only the
   counts key is. `StandalonePostDrawer.tsx` is therefore unchanged.

## Verified facts (file:line, worktree at 1bd7f4ffb)

- JWT edge-call pattern to copy: `apps/crm/src/services/ideiaMedia.ts:20-45` (`callFn`:
  `supabase.auth.getSession()`, `Authorization: Bearer`, `apikey`, throws `Error(err.error ?? HTTP n)`); same shape in `services/postMedia.ts:15-42`.
- `store/core.ts:1-3` re-exports `supabase` from `@/lib/supabase`; client is untyped
  (`lib/supabase.ts:13`, `createClient(URL, KEY)`), so `.from('post_references')` needs no cast.
- `store/index.ts:1-28` barrel; drawer harnesses mock `@/store` with object factories:
  `WorkflowDrawer.test.tsx:81`, `WorkflowDrawer.duplicate.test.tsx:71`,
  `WorkflowDrawerAutoScheduleNudge.test.tsx:79`, `StandalonePostDrawer.test.tsx:63`;
  `WorkflowDrawerAutoComplete.test.tsx:55` mocks `@/lib/supabase`.
- `EntregasPage.test.tsx:561/603` and `EntregasTab.test.tsx:126/164` mock both drawers.
- `PostEditorBody.tsx`: `['post-media']` query :198-203 (gate `isExpanded && !!post.id`),
  early `return null` :331, `<PostMediaGallery>` :500-515, bubble map :715-717,
  `PostVersionHistorySheet` + closing `</div>` :743-752, `PostApprovalBubble` :758-786.
- `WorkflowDrawer.tsx`: `useAuth()`/`canDuplicate = can('entregas','editar') === true` :367-368;
  per-workflow queries keyed by `postIds.join(',')` :334-358; `refresh()` :409-420, called after every field/content save (anchor
  `['post-process-events']` :418 is unique); `SortablePostItem` call :1078-1145
  (`editSuggestion` prop :1091-1093); props interface :1311-1370; destructuring :1372-1422;
  "Sugestão pendente" :1494-1498; no `Badge` import today.
- `StandalonePostDrawer.tsx`: renders `PostEditorBody` (import :73), `useAuth` :171,
  `refresh()` :245-257 (not changed, see contract issue 6).
- `PostEditorBody.tsx:195-203`: `['post-media', post.id]` uses `staleTime: 5 * 60 * 1000` and is
  absent from both drawers' `refresh()`; `:220-221` documents that every título keystroke save
  round-trips through `updateWorkflowPost` + refresh.
- `AuthContext.tsx:173` `can(module, action?) => PermissionCheck`; `lib/permissions.ts:23`
  `PermissionCheck = boolean | 'unknown'`; test helper `apps/crm/src/test/makeCan.ts`.
- `components/ui/badge.tsx` variants `info`, `warning`, sizes `sm`; `components/ui/dialog.tsx`
  `DialogContent` default `z-[9011]`, built-in Close with sr-only "Close" (:160-166);
  `alert-dialog.tsx` overlay `z-[9010]`; drawer CSS `z-index: 9000/9001` (`apps/crm/style.css:7383/7397`).
- `sanitizeUrl` in `utils/security.ts:17` (falls through to `sanitizeExternalUrl` :1-14, which
  returns `'#'` for non-http(s) and credentials); entregas/other pages import it from
  `@/utils/security`.
- `MESES_ABREV` exported from `utils/postDate.ts:1`.
- `useUnsavedWork` from `@mesaas/app-lifecycle` (`packages/app-lifecycle/src/use-unsaved-work.ts:8`), already used un-mocked in drawer tests via `WorkflowDrawer.tsx:4`.
- Notifications: union `store/notifications.ts:3-33`; display switch
  `lib/notification-config.ts:95-375` (`client`/`post` read from `client_name`/`post_title` at
  :100-101, `post_edit_suggestion` case :139-146, `default` fallback); catalog
  `lib/notification-catalog.ts:44-253` with `satisfies Record<NotificationType, …>` :253,
  `RESP_ADMINS` :38; prefs UI rows built from the catalog at
  `pages/configuracao/tabs/notificacoes/SuasNotificacoesSection.tsx:28`; count assertions
  `__tests__/notification-catalog.test.ts:6-7` and `NotificacoesTab.test.tsx:8,202,208`;
  e-mail count `notification-prefs-store.test.ts:12` (16, unchanged).
- `NotificationItem.tsx:27` navigates by `notification.link`; body span :92-103.
- Vitest: root `vitest.config.ts` defines `VITE_SUPABASE_URL='https://mesaas.supabase.co'`,
  `VITE_SUPABASE_ANON_KEY='anon-key-for-tests'`, includes `apps/**/__tests__/**`;
  `apps/crm/tsconfig.json` excludes `__tests__` from `tsc`.
- Prettier: single quotes, width 100, trailing commas (`.prettierrc`).

---

### Task 12: Integration, docs and full verification

**Files:**
- Modify: `CLAUDE.md` (Gotchas: add `hub-post-references` and `post-references` to the `--no-verify-jwt` list, if Tasks 3/4 did not already)
- Modify: `docs/superpowers/specs/2026-10-08-client-post-references-design.md` (only if implementation diverged; record the divergence)

**Interfaces:**
- Consumes: every task above, merged into this branch.

- [ ] **Step 1: Merge the stream branches** back into `claude/client-file-link-attachments-5a50d3` in order DB → edge → CRM → Hub, resolving conflicts (likely only in `packages/i18n` and test mocks).

- [ ] **Step 2: Fresh deps**

Run: `ls node_modules/.deno 2>/dev/null && npm ci`
Expected: no `.deno` dir, or a clean `npm ci`.

- [ ] **Step 3: All CI gates**

Run each, expect exit 0:
```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run check:functions
npm run test:functions
```
Then `git status --short deno.lock` (revert if `test:functions` dirtied it) and `ls node_modules/.deno` (`npm ci` if present).

- [ ] **Step 4: SQL suite**

Run: `npx supabase db reset` then `bash scripts/test-entitlements.sh`
Expected: all suites pass, including `99_post_references.sql`.

- [ ] **Step 5: Em-dash sweep**

Run: `git diff origin/main -- apps packages ':(exclude)**/__tests__/**' ':(exclude)**/*.test.ts' ':(exclude)**/*.test.tsx' | grep '^+' | grep '—'`
Expected: no output (code comments excepted; inspect any hit).

- [ ] **Step 6: Browser verification**

Hub on :5175 (`npm run dev:hub`) and CRM on :5173, against local Supabase with seeded data (memory: seed login + stub edge functions when needed). Check: Referências tab (desktop + 390px phone), add photo/video/PDF/link, note save, remove, approve disabled during upload, correction with staged references, history tiles; CRM section, viewer, download, delete, "Na correção" badge, comment chips, drawer badge, notification; dark mode on both. Screenshot each.

- [ ] **Step 7: Commit and report**

```bash
git add -A
git commit -m "chore(references): integration fixes and docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Rollback (spec): migration is forward-only; keep `'skipped'` in `files_stream_status_check` while reference videos exist; revert `file-manage` last so reference files never reappear at the Arquivos root.

Deploy order (needs user OK, prod is shared): `db push` staging → deploy `hub-post-references`, `post-references` (`--no-verify-jwt`), `hub-approve`, `file-manage` to staging → staging check → same for prod → only then merge (merge deploys the frontend).
