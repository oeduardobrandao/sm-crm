-- Regression tests for public.import_commit_row / public.import_resolve_cliente
-- (supabase/migrations/20260729000004_data_import_jobs.sql).
--
-- These functions are SECURITY DEFINER, so RLS does not protect them, and their
-- p_payload is client-supplied JSON from any authenticated workspace member.
-- Everything asserted below was, at some point, a bug that manual smoke-testing
-- caught -- this file exists so the NEXT edit cannot reintroduce it silently.
-- It automates the operator smoke-test list in that migration's header comment
-- (cases 1-5, 7-9) plus the behaviours the function bodies actually promise.
--
-- NOT covered here: smoke-test case 6, the `select ... for update` row lock that
-- serializes a commit against a concurrent undo. A race needs two concurrent
-- sessions; a single psql script cannot exercise it. See the report / the
-- migration comment for what a real test of it would need.
--
-- Run:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/import_commit_row.sql
-- (also runs as part of `npm run test:db`)

\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;

-- Returns 'SQLSTATE: message' when the call raises, NULL when it does not.
-- Catching `others` (not just P0001) is deliberate: several assertions below
-- pin that a bad payload fails as a legible P0001 rather than as a raw
-- constraint violation (23502 etc.) leaking out of an insert.
create or replace function ic_err(p_conta uuid, p_job bigint, p_key text,
                                  p_kind text, p_payload jsonb)
returns text language plpgsql as $fn$
begin
  perform import_commit_row(p_conta, p_job, p_key, p_kind, p_payload);
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $fn$;

create or replace function ir_err(p_conta uuid, p_job bigint, p_payload jsonb)
returns text language plpgsql as $fn$
begin
  perform import_resolve_cliente(p_conta, p_job, p_payload);
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $fn$;

do $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_u uuid := gen_random_uuid();
  v_job_a bigint; v_job_b bigint;
  v_res jsonb; v_err text;
  v_foreign_cli bigint; v_cli bigint; v_cli2 bigint; v_cli3 bigint;
  v_alpha_id text; v_wf bigint; v_tpl bigint;
  v_future timestamptz := now() + interval '30 days';
  v_past   timestamptz := now() - interval '30 days';
  -- Table-wide invariant baselines, captured BEFORE this test writes anything,
  -- so the assertions can be global scans (the form that survives future edits)
  -- without being polluted by whatever the dev database already happens to hold.
  v_base_pub_violations bigint;
  v_base_null_etapas bigint;
begin
  select count(*) into v_base_pub_violations from workflow_posts
    where published_at is not null and status <> 'postado';
  select count(*) into v_base_null_etapas from workflow_templates where etapas is null;

  -- 'max' plan: all limit triggers (trg_limit_clientes / _workflows / _templates /
  -- _posts) and feature gates are unlimited there, so nothing below trips a quota.
  v_ws_a := et_make_workspace('max');
  v_ws_b := et_make_workspace('max');
  insert into auth.users (id) values (v_u) on conflict do nothing;

  insert into import_jobs (conta_id, created_by, source, total_rows)
    values (v_ws_a, v_u, 'notion', 100) returning id into v_job_a;
  insert into import_jobs (conta_id, created_by, source, total_rows)
    values (v_ws_b, v_u, 'notion', 10) returning id into v_job_b;

  -- A cliente owned by the OTHER workspace: the cross-tenant target below.
  insert into clientes (conta_id, user_id, nome, sigla, cor, email)
    values (v_ws_b, v_u, 'Foreign Co', 'FC', '#000', 'foreign@b.com')
    returning id into v_foreign_cli;

  -- ==================================================================
  -- (1) TENANT ISOLATION -- both routes into a cliente id
  -- ==================================================================

  -- (1a) clienteRef {type:'existing'} naming another workspace's cliente.
  v_err := ic_err(v_ws_a, v_job_a, 'k-tenant-existing', 'container', jsonb_build_object(
    'titulo', 'stolen container',
    'clienteRef', jsonb_build_object('type', 'existing', 'clienteId', v_foreign_cli)));
  assert v_err is not null, '1a: cross-tenant clienteRef{existing} did NOT raise';
  assert v_err like 'P0001: cliente % does not belong to this workspace',
    '1a: wrong error for cross-tenant clienteRef{existing}: ' || v_err;
  assert not exists (select 1 from workflows where conta_id = v_ws_a),
    '1a: cross-tenant clienteRef{existing} created a workflow anyway';
  assert not exists (select 1 from workflows where cliente_id = v_foreign_cli),
    '1a: workflow attached to the foreign cliente';
  assert not exists (select 1 from import_job_items
                      where job_id = v_job_a and source_row_key = 'k-tenant-existing'),
    '1a: bookkeeping recorded for a refused cross-tenant row';

  -- Same guard on the ideia path (a second caller of import_resolve_cliente).
  v_err := ic_err(v_ws_a, v_job_a, 'k-tenant-ideia', 'ideia', jsonb_build_object(
    'titulo', 'stolen ideia',
    'clienteRef', jsonb_build_object('type', 'existing', 'clienteId', v_foreign_cli)));
  assert v_err like 'P0001: cliente % does not belong to this workspace',
    '1a2: cross-tenant clienteRef{existing} on kind=ideia not refused: ' || coalesce(v_err, '<no raise>');

  -- (1b) mergeClienteId naming another workspace's cliente.
  -- THE REAL HOLE THIS PINS: the merge UPDATE was always conta-scoped, but its
  -- result was never checked -- a zero-row UPDATE passed silently and the
  -- bookkeeping row below it still mapped source_row_key -> the FOREIGN cliente
  -- id, which import_resolve_cliente later handed to workflows/ideias inserts.
  v_err := ic_err(v_ws_a, v_job_a, 'k-tenant-merge', 'cliente', jsonb_build_object(
    'mergeClienteId', v_foreign_cli, 'email', 'attacker@evil.com',
    'telefone', '11999999999', 'valorMensal', 9999));
  assert v_err is not null, '1b: cross-tenant mergeClienteId did NOT raise';
  assert v_err like 'P0001: cliente % does not belong to this workspace',
    '1b: wrong error for cross-tenant mergeClienteId: ' || v_err;
  assert not exists (select 1 from import_job_items
                      where job_id = v_job_a and source_row_key = 'k-tenant-merge'),
    '1b: a FOREIGN cliente id was recorded in import_job_items (cross-tenant hole)';
  assert (select email from clientes where id = v_foreign_cli) = 'foreign@b.com',
    '1b: the foreign workspace''s cliente was mutated';
  assert (select valor_mensal from clientes where id = v_foreign_cli) is null,
    '1b: the foreign workspace''s valor_mensal was mutated';
  -- ...and the mapping must not be resolvable afterwards either.
  v_err := ir_err(v_ws_a, v_job_a, jsonb_build_object(
    'clienteRef', jsonb_build_object('type', 'created', 'sourceKey', 'k-tenant-merge')));
  assert v_err like 'P0001: cliente % not committed yet',
    '1b: refused merge left a resolvable mapping: ' || coalesce(v_err, '<resolved!>');

  -- clienteRef{existing} with NO clienteId must be refused, not resolved.
  -- (`(...)::bigint` yields NULL, and `where id = NULL` matches nothing, so the
  -- ownership check is what refuses it -- pin that it stays that way.)
  v_err := ir_err(v_ws_a, v_job_a, jsonb_build_object(
    'clienteRef', jsonb_build_object('type', 'existing')));
  assert v_err like 'P0001: cliente % does not belong to this workspace',
    '1a3: clienteRef{existing} with a NULL clienteId was not refused: ' || coalesce(v_err, '<resolved!>');
  -- an unrecognized clienteRef type falls through to the 'created' branch and is
  -- refused there rather than silently resolving to anything.
  v_err := ir_err(v_ws_a, v_job_a, jsonb_build_object(
    'clienteRef', jsonb_build_object('type', 'whatever', 'clienteId', v_foreign_cli)));
  assert v_err like 'P0001: cliente % not committed yet',
    '1a4: unknown clienteRef type was not refused: ' || coalesce(v_err, '<resolved!>');

  -- (1c) a mergeClienteId that exists nowhere is refused the same way (clear
  -- error instead of a downstream FK failure).
  v_err := ic_err(v_ws_a, v_job_a, 'k-merge-ghost', 'cliente',
                  jsonb_build_object('mergeClienteId', 999999999, 'email', 'x@y.z'));
  assert v_err like 'P0001: cliente % does not belong to this workspace',
    '1c: nonexistent mergeClienteId not refused: ' || coalesce(v_err, '<no raise>');

  -- (1d) import_resolve_cliente re-asserts ownership on the 'created' branch too,
  -- so a future writer that poisons import_job_items cannot leak a foreign cliente.
  insert into import_job_items (job_id, conta_id, table_name, row_id, source_row_key, ordinal)
    values (v_job_a, v_ws_a, 'clientes', v_foreign_cli::text, 'k-poisoned', 0);
  v_err := ir_err(v_ws_a, v_job_a, jsonb_build_object(
    'clienteRef', jsonb_build_object('type', 'created', 'sourceKey', 'k-poisoned')));
  assert v_err like 'P0001: cliente % does not belong to this workspace',
    '1d: poisoned bookkeeping row resolved to a foreign cliente: ' || coalesce(v_err, '<resolved!>');
  delete from import_job_items where job_id = v_job_a and source_row_key = 'k-poisoned';

  -- (1e) the JOB itself is conta-scoped: another workspace cannot write to it.
  v_err := ic_err(v_ws_b, v_job_a, 'k-wrong-conta', 'cliente',
                  jsonb_build_object('nome', 'Trespasser'));
  assert v_err like 'P0001: import job not found or being undone',
    '1e: job_id from another workspace was writable: ' || coalesce(v_err, '<no raise>');
  assert not exists (select 1 from clientes where nome = 'Trespasser'),
    '1e: cross-workspace job write created a cliente';

  -- ==================================================================
  -- (2) IDEMPOTENT RESUME
  -- ==================================================================
  v_res := import_commit_row(v_ws_a, v_job_a, 'k-cli-alpha', 'cliente', jsonb_build_object(
    'nome', 'Alpha Clinica', 'email', 'alpha@a.com', 'valorMensal', 1200,
    'provenance', jsonb_build_object('tool', 'notion', 'url', 'https://n/1')));
  assert (v_res->>'skipped')::boolean = false, '2: first commit reported skipped';
  assert v_res->>'table' = 'clientes', '2: wrong table in result';
  v_alpha_id := v_res->>'row_id';
  assert v_alpha_id is not null, '2: no row_id returned';

  -- second call, identical key
  v_res := import_commit_row(v_ws_a, v_job_a, 'k-cli-alpha', 'cliente', jsonb_build_object(
    'nome', 'Alpha Clinica DIFFERENT', 'email', 'other@a.com'));
  assert (v_res->>'skipped')::boolean = true, '2: re-commit was not skipped';
  assert v_res->>'row_id' = v_alpha_id, '2: re-commit returned a DIFFERENT row_id';
  assert (select count(*) from clientes where conta_id = v_ws_a and nome like 'Alpha Clinica%') = 1,
    '2: re-commit created a second cliente row';
  assert (select count(*) from import_job_items
           where job_id = v_job_a and source_row_key = 'k-cli-alpha') = 1,
    '2: re-commit created a second bookkeeping row';
  assert (select email from clientes where id = v_alpha_id::bigint) = 'alpha@a.com',
    '2: re-commit overwrote the existing row';
  assert (select provenance->>'tool' from import_job_items
           where job_id = v_job_a and source_row_key = 'k-cli-alpha' and ordinal = 0) = 'notion',
    '2: provenance not recorded on the bookkeeping row';

  -- clienteRef{created} resolves through that bookkeeping row.
  v_res := import_commit_row(v_ws_a, v_job_a, 'k-cont-1', 'container', jsonb_build_object(
    'titulo', 'Calendario Julho',
    'clienteRef', jsonb_build_object('type', 'created', 'sourceKey', 'k-cli-alpha')));
  v_wf := (v_res->>'row_id')::bigint;
  assert (select cliente_id from workflows where id = v_wf) = v_alpha_id::bigint,
    '2: container did not resolve clienteRef{created}';
  assert (select created_via from workflows where id = v_wf) = 'human',
    '2: imported workflow marked created_via=agent (renders a false "IA" badge)';

  -- ==================================================================
  -- (3) POST STATUS CLAMP -- exhaustive
  -- 'agendado'/'falha_publicacao' must be unreachable at ANY casing: an
  -- 'agendado' row would be claimed by instagram-publish-cron / tiktok-publish-cron
  -- with no media attached.
  -- ==================================================================
  declare
    v_pid bigint;
    v_cases text[] := array['agendado', 'Agendado', 'AGENDADO', '  agendado  ',
                            'falha_publicacao', 'Falha_Publicacao', ' FALHA_PUBLICACAO '];
    v_c text; v_n int := 0;
  begin
    foreach v_c in array v_cases loop
      v_n := v_n + 1;
      v_res := import_commit_row(v_ws_a, v_job_a, 'k-post-forbidden-' || v_n, 'post',
        jsonb_build_object('containerKey', 'k-cont-1', 'titulo', 'p' || v_n,
                           'status', v_c, 'scheduledAt', v_future));
      v_pid := (v_res->>'row_id')::bigint;
      assert (select status from workflow_posts where id = v_pid) = 'rascunho',
        '3: status ' || quote_literal(v_c) || ' survived the clamp as '
        || (select status from workflow_posts where id = v_pid);
      assert (select published_at from workflow_posts where id = v_pid) is null,
        '3: clamped ' || quote_literal(v_c) || ' row got a published_at';
    end loop;
    -- Belt and braces at the set level: nothing this job wrote may hold a
    -- cron-claimable status.
    assert not exists (
      select 1 from workflow_posts where conta_id = v_ws_a
        and status in ('agendado', 'falha_publicacao')),
      '3: an agendado/falha_publicacao post exists in the imported workspace';
  end;

  -- 'postado' + FUTURE date -> downgraded, date preserved on scheduled_at,
  -- published_at NULL (the CRM reads published_at alone as "this is live").
  declare v_pid bigint;
  begin
    v_res := import_commit_row(v_ws_a, v_job_a, 'k-post-future', 'post',
      jsonb_build_object('containerKey', 'k-cont-1', 'titulo', 'future',
                         'status', 'postado', 'publishedAt', v_future));
    v_pid := (v_res->>'row_id')::bigint;
    assert (select status from workflow_posts where id = v_pid) = 'aprovado_cliente',
      '3: future-dated postado did not downgrade to aprovado_cliente';
    assert (select published_at from workflow_posts where id = v_pid) is null,
      '3: downgraded future postado still got a published_at';
    assert (select scheduled_at from workflow_posts where id = v_pid) = v_future,
      '3: downgraded future postado lost its source date (should move to scheduled_at)';
  end;

  -- same, arriving under scheduledAt instead of publishedAt
  declare v_pid bigint;
  begin
    v_res := import_commit_row(v_ws_a, v_job_a, 'k-post-future-sched', 'post',
      jsonb_build_object('containerKey', 'k-cont-1', 'titulo', 'future2',
                         'status', 'postado', 'scheduledAt', v_future));
    v_pid := (v_res->>'row_id')::bigint;
    assert (select status from workflow_posts where id = v_pid) = 'aprovado_cliente',
      '3: future scheduledAt postado did not downgrade';
    assert (select published_at from workflow_posts where id = v_pid) is null,
      '3: future scheduledAt postado got a published_at';
  end;

  -- 'postado' + PAST date -> preserved, published_at set from the source date.
  declare v_pid bigint;
  begin
    v_res := import_commit_row(v_ws_a, v_job_a, 'k-post-past', 'post',
      jsonb_build_object('containerKey', 'k-cont-1', 'titulo', 'past',
                         'status', ' Postado ', 'publishedAt', v_past));
    v_pid := (v_res->>'row_id')::bigint;
    assert (select status from workflow_posts where id = v_pid) = 'postado',
      '3: past-dated postado was not preserved (casing/whitespace should normalize)';
    assert (select published_at from workflow_posts where id = v_pid) = v_past,
      '3: past-dated postado did not get published_at from the source date';
  end;

  -- 'postado' with NO date at all -> downgrades. Found last, easy to regress:
  -- coalesce(v_source_at, now()) > now() collapses to `now() > now()` = false,
  -- so without the explicit dateless branch the row lands 'postado' with no
  -- real publication behind it.
  --
  -- READ THIS BEFORE TRUSTING (4) TO COVER THIS CASE: the published_at invariant
  -- does NOT catch a regression here. workflow_posts has a BEFORE trigger,
  -- set_workflow_posts_published_at, that fills published_at := now() whenever
  -- status = 'postado' and published_at is null. So a regressed dateless row
  -- lands status='postado' WITH published_at = the import's own clock -- i.e. it
  -- claims to have been published at import time, and is internally CONSISTENT,
  -- so the (4) scan passes it. (The migration's smoke-test note 8 predicts
  -- 'postado' + published_at NULL; the trigger makes that impossible.) The
  -- status assertion below is the only thing standing between this bug and prod.
  declare v_pid bigint;
  begin
    v_res := import_commit_row(v_ws_a, v_job_a, 'k-post-dateless', 'post',
      jsonb_build_object('containerKey', 'k-cont-1', 'titulo', 'dateless',
                         'status', 'postado'));
    v_pid := (v_res->>'row_id')::bigint;
    assert (select status from workflow_posts where id = v_pid) = 'rascunho',
      '3: DATELESS postado did not downgrade to rascunho (landed '
      || (select status from workflow_posts where id = v_pid) || ')';
    assert (select published_at from workflow_posts where id = v_pid) is null,
      '3: dateless postado got a published_at';
    assert (select scheduled_at from workflow_posts where id = v_pid) is null,
      '3: dateless postado invented a scheduled_at';
  end;

  -- a recognized, permitted status is passed through untouched
  declare v_pid bigint;
  begin
    v_res := import_commit_row(v_ws_a, v_job_a, 'k-post-revisao', 'post',
      jsonb_build_object('containerKey', 'k-cont-1', 'titulo', 'rev',
                         'status', ' Revisao_Interna '));
    v_pid := (v_res->>'row_id')::bigint;
    assert (select status from workflow_posts where id = v_pid) = 'revisao_interna',
      '3: an allowed status was not preserved through lower/trim';
  end;

  -- anything unrecognized degrades to rascunho rather than raising
  declare v_pid bigint;
  begin
    v_res := import_commit_row(v_ws_a, v_job_a, 'k-post-garbage', 'post',
      jsonb_build_object('containerKey', 'k-cont-1', 'titulo', 'garbage',
                         'status', 'publicado_no_linkedin'));
    v_pid := (v_res->>'row_id')::bigint;
    assert (select status from workflow_posts where id = v_pid) = 'rascunho',
      '3: unrecognized status did not degrade to rascunho';
  end;

  -- ==================================================================
  -- (4) published_at INVARIANT, as a table-wide scan
  -- (the form that keeps biting on rows this test never named)
  -- ==================================================================
  assert (select count(*) from workflow_posts
           where published_at is not null and status <> 'postado') = v_base_pub_violations,
    '4: published_at is set on a row whose status is not postado';

  -- ==================================================================
  -- (5) TIPO CLAMP -- normalize what we recognize, degrade what we do not.
  -- tipo is CHECK-constrained, so an unclamped 'Vídeo' would LOSE the row.
  -- ==================================================================
  declare
    v_pid bigint; v_n int := 0;
    v_in  text[] := array['Carrossel', ' REELS ', 'stories', 'Vídeo', 'video', 'carousel'];
    v_out text[] := array['carrossel', 'reels',   'stories', 'feed',  'feed',  'feed'];
  begin
    while v_n < array_length(v_in, 1) loop
      v_n := v_n + 1;
      v_res := import_commit_row(v_ws_a, v_job_a, 'k-post-tipo-' || v_n, 'post',
        jsonb_build_object('containerKey', 'k-cont-1', 'titulo', 't' || v_n,
                           'tipo', v_in[v_n]));
      v_pid := (v_res->>'row_id')::bigint;
      assert (select tipo from workflow_posts where id = v_pid) = v_out[v_n],
        '5: tipo ' || quote_literal(v_in[v_n]) || ' -> '
        || (select tipo from workflow_posts where id = v_pid)
        || ', expected ' || v_out[v_n];
    end loop;
  end;

  -- absent tipo / absent titulo: both fall back rather than raising. titulo is
  -- NOT NULL and naming it in the column list defeats its default, so a
  -- caption-only calendar row must still land.
  declare v_pid bigint;
  begin
    v_res := import_commit_row(v_ws_a, v_job_a, 'k-post-bare', 'post',
      jsonb_build_object('containerKey', 'k-cont-1'));
    v_pid := (v_res->>'row_id')::bigint;
    assert (select tipo from workflow_posts where id = v_pid) = 'feed', '5: absent tipo not defaulted to feed';
    assert (select titulo from workflow_posts where id = v_pid) = '', '5: absent titulo not defaulted to empty';
    assert (select status from workflow_posts where id = v_pid) = 'rascunho', '5: absent status not defaulted to rascunho';
  end;

  -- ordem is derived per container and keeps increasing across a resumed batch
  assert (select count(distinct ordem) from workflow_posts where workflow_id = v_wf)
       = (select count(*) from workflow_posts where workflow_id = v_wf),
    '5: duplicate ordem within a container';
  assert (select min(ordem) from workflow_posts where workflow_id = v_wf) = 0,
    '5: container post ordem does not start at 0';

  -- ==================================================================
  -- (6) MERGE SEMANTICS -- fill only what is empty, never overwrite
  -- ==================================================================
  insert into clientes (conta_id, user_id, nome, sigla, cor, email, telefone,
                        especialidade, notion_page_url, valor_mensal)
    values (v_ws_a, v_u, 'Existing Co', 'EC', '#111', 'keep@a.com', '',
            'Dermatologia', null, 800)
    returning id into v_cli;

  v_res := import_commit_row(v_ws_a, v_job_a, 'k-merge-1', 'cliente', jsonb_build_object(
    'mergeClienteId', v_cli, 'email', 'overwrite@x.com', 'telefone', '11988887777',
    'especialidade', 'Cardiologia', 'notionPageUrl', 'https://notion/x',
    'valorMensal', 2000,
    'provenance', jsonb_build_object('tool', 'notion')));
  assert (v_res->>'skipped')::boolean = false, '6: merge reported skipped';
  assert v_res->>'row_id' = v_cli::text, '6: merge returned the wrong row_id';
  assert (select email from clientes where id = v_cli) = 'keep@a.com',
    '6: merge OVERWROTE a populated email';
  assert (select especialidade from clientes where id = v_cli) = 'Dermatologia',
    '6: merge OVERWROTE a populated especialidade';
  assert (select telefone from clientes where id = v_cli) = '11988887777',
    '6: merge did not fill an empty-string telefone';
  assert (select notion_page_url from clientes where id = v_cli) = 'https://notion/x',
    '6: merge did not fill a NULL notion_page_url';
  -- valor_mensal's fill condition is deliberately narrower than the text columns:
  -- `coalesce(valor_mensal, ...)`, i.e. only a genuine SQL NULL is fillable.
  -- 800 is a real value and must survive.
  assert (select valor_mensal from clientes where id = v_cli) = 800,
    '6: merge OVERWROTE a populated valor_mensal';
  -- bookkeeping: flagged merged so undo can never delete a pre-existing cliente
  assert (select merged from import_job_items
           where job_id = v_job_a and source_row_key = 'k-merge-1' and ordinal = 0) = true,
    '6: merge bookkeeping row not flagged merged=true (undo would DELETE the customer''s cliente)';
  assert (select table_name from import_job_items
           where job_id = v_job_a and source_row_key = 'k-merge-1' and ordinal = 0) = 'clientes',
    '6: merge bookkeeping row has the wrong table_name';
  assert (select provenance->>'tool' from import_job_items
           where job_id = v_job_a and source_row_key = 'k-merge-1' and ordinal = 0) = 'notion',
    '6: merge bookkeeping row lost provenance';

  -- a merged cliente is still a valid clienteRef{created} target...
  v_res := import_commit_row(v_ws_a, v_job_a, 'k-cont-merged', 'container', jsonb_build_object(
    'titulo', 'from merged',
    'clienteRef', jsonb_build_object('type', 'created', 'sourceKey', 'k-merge-1')));
  assert (select cliente_id from workflows where id = (v_res->>'row_id')::bigint) = v_cli,
    '6: a merged cliente is not resolvable via clienteRef{created}';

  -- ...and a re-commit of the merge is still skipped
  v_res := import_commit_row(v_ws_a, v_job_a, 'k-merge-1', 'cliente',
    jsonb_build_object('mergeClienteId', v_cli, 'email', 'again@x.com'));
  assert (v_res->>'skipped')::boolean = true, '6: re-committed merge was not skipped';
  assert v_res->>'row_id' = v_cli::text, '6: re-committed merge returned a different row_id';
  assert (select count(*) from import_job_items
           where job_id = v_job_a and source_row_key = 'k-merge-1') = 1,
    '6: re-committed merge wrote a second bookkeeping row';

  -- valor_mensal NULL -> filled
  insert into clientes (conta_id, user_id, nome, sigla, cor, valor_mensal)
    values (v_ws_a, v_u, 'Null Valor', 'NV', '#111', null) returning id into v_cli2;
  perform import_commit_row(v_ws_a, v_job_a, 'k-merge-null-valor', 'cliente',
    jsonb_build_object('mergeClienteId', v_cli2, 'valorMensal', 1500));
  assert (select valor_mensal from clientes where id = v_cli2) = 1500,
    '6: merge did not fill a NULL valor_mensal';

  -- valor_mensal 0 -> NOT filled. 0 is what this same function writes for a new
  -- client with no value, and what the CRM's own forms write -- treating it as
  -- "empty" would silently overwrite a real pro-bono/$0 client.
  insert into clientes (conta_id, user_id, nome, sigla, cor, valor_mensal)
    values (v_ws_a, v_u, 'Zero Valor', 'ZV', '#111', 0) returning id into v_cli3;
  perform import_commit_row(v_ws_a, v_job_a, 'k-merge-zero-valor', 'cliente',
    jsonb_build_object('mergeClienteId', v_cli3, 'valorMensal', 500));
  assert (select valor_mensal from clientes where id = v_cli3) = 0,
    '6: merge overwrote a deliberate valor_mensal = 0';

  -- row_id is canonicalized to Postgres's own bigint rendering, not the raw
  -- client text, so a later text comparison can still match it.
  declare v_c4 bigint;
  begin
    insert into clientes (conta_id, user_id, nome, sigla, cor)
      values (v_ws_a, v_u, 'Padded Id', 'PI', '#111') returning id into v_c4;
    v_res := import_commit_row(v_ws_a, v_job_a, 'k-merge-padded', 'cliente',
      jsonb_build_object('mergeClienteId', '  ' || v_c4::text || '  ', 'telefone', '1'));
    assert v_res->>'row_id' = v_c4::text,
      '6: row_id not canonicalized (got ' || (v_res->>'row_id') || ')';
    assert (select row_id from import_job_items
             where job_id = v_job_a and source_row_key = 'k-merge-padded' and ordinal = 0) = v_c4::text,
      '6: bookkeeping row_id not canonicalized';
    -- and it still resolves
    assert (select import_resolve_cliente(v_ws_a, v_job_a, jsonb_build_object(
             'clienteRef', jsonb_build_object('type', 'created', 'sourceKey', 'k-merge-padded')))) = v_c4,
      '6: canonicalized merge row does not resolve';
  end;

  -- ==================================================================
  -- (8) workflow_templates.etapas IS NEVER SQL NULL
  -- StepTemplate.tsx reads t.etapas.length for EVERY template in the picker,
  -- so one NULL row breaks the Entregas wizard for the whole workspace.
  -- ==================================================================
  v_res := import_commit_row(v_ws_a, v_job_a, 'k-tpl-empty', 'template',
    jsonb_build_object('nome', 'Sem etapas'));
  assert (select etapas from workflow_templates where id = (v_res->>'row_id')::bigint) = '[]'::jsonb,
    '8: template with MISSING etapas did not land as ''[]'' (wizard-breaking NULL)';

  v_res := import_commit_row(v_ws_a, v_job_a, 'k-tpl-empty-arr', 'template',
    jsonb_build_object('nome', 'Array vazio', 'etapas', '[]'::jsonb));
  assert (select etapas from workflow_templates where id = (v_res->>'row_id')::bigint) = '[]'::jsonb,
    '8: template with EMPTY etapas array did not land as ''[]''';

  v_res := import_commit_row(v_ws_a, v_job_a, 'k-tpl', 'template',
    jsonb_build_object('nome', 'Padrao', 'etapas', jsonb_build_array('Briefing', 'Design', 'Aprovacao')));
  v_tpl := (v_res->>'row_id')::bigint;
  assert jsonb_array_length((select etapas from workflow_templates where id = v_tpl)) = 3,
    '8: template etapas not materialized';
  assert (select etapas->0->>'nome' from workflow_templates where id = v_tpl) = 'Briefing',
    '8: template etapa lost its name / order';
  assert (select etapas->0->>'tipo' from workflow_templates where id = v_tpl) = 'padrao',
    '8: template etapa missing the tipo key the wizard expects';

  -- table-wide, same reasoning as (4)
  assert (select count(*) from workflow_templates where etapas is null) = v_base_null_etapas,
    '8: a workflow_templates row has SQL NULL etapas';

  -- entrega materializes etapas FROM the template, with concluido/ativo/pendente
  -- around etapaIndex and data_limite only on the current one.
  declare v_ent bigint;
  begin
    v_res := import_commit_row(v_ws_a, v_job_a, 'k-entrega', 'entrega', jsonb_build_object(
      'titulo', 'Entrega 1', 'templateKey', 'k-tpl', 'etapaIndex', 1,
      'dueDate', '2026-09-15',
      'clienteRef', jsonb_build_object('type', 'created', 'sourceKey', 'k-cli-alpha')));
    v_ent := (v_res->>'row_id')::bigint;
    assert (select count(*) from workflow_etapas where workflow_id = v_ent) = 3,
      '8: entrega did not materialize the template etapas';
    assert (select status from workflow_etapas where workflow_id = v_ent and ordem = 0) = 'concluido',
      '8: prior etapa not concluido';
    assert (select status from workflow_etapas where workflow_id = v_ent and ordem = 1) = 'ativo',
      '8: current etapa not ativo';
    assert (select status from workflow_etapas where workflow_id = v_ent and ordem = 2) = 'pendente',
      '8: later etapa not pendente';
    assert (select data_limite from workflow_etapas where workflow_id = v_ent and ordem = 1) = date '2026-09-15',
      '8: data_limite missing or timezone-shifted on the current etapa';
    assert (select data_limite from workflow_etapas where workflow_id = v_ent and ordem = 0) is null,
      '8: data_limite set on a non-current etapa';
    -- one bookkeeping row per etapa, at ordinals 1..n (ordinal 0 is the workflow)
    assert (select count(*) from import_job_items
             where job_id = v_job_a and source_row_key = 'k-entrega'
               and table_name = 'workflow_etapas') = 3,
      '8: etapa bookkeeping rows missing (undo would orphan them)';
    assert (select count(*) from import_job_items
             where job_id = v_job_a and source_row_key = 'k-entrega' and ordinal = 0
               and table_name = 'workflows') = 1,
      '8: entrega primary bookkeeping row missing';
  end;

  -- ==================================================================
  -- (9) MISSING / BLANK nome raises legibly -- never a bare NOT NULL
  -- violation from the NULL-propagating sigla expression.
  -- ==================================================================
  v_err := ic_err(v_ws_a, v_job_a, 'k-nome-null', 'cliente',
                  jsonb_build_object('nome', null, 'email', 'a@b.c'));
  assert v_err like 'P0001: import row % has no usable nome (cliente name)',
    '9: JSON-null nome did not raise the legible error: ' || coalesce(v_err, '<no raise>');

  v_err := ic_err(v_ws_a, v_job_a, 'k-nome-absent', 'cliente',
                  jsonb_build_object('email', 'a@b.c'));
  assert v_err like 'P0001: import row % has no usable nome (cliente name)',
    '9: absent nome did not raise the legible error: ' || coalesce(v_err, '<no raise>');

  v_err := ic_err(v_ws_a, v_job_a, 'k-nome-blank', 'cliente',
                  jsonb_build_object('nome', '   '));
  assert v_err like 'P0001: import row % has no usable nome (cliente name)',
    '9: whitespace-only nome did not raise the legible error: ' || coalesce(v_err, '<no raise>');

  -- a present but entirely non-alphabetic nome is usable, and sigla falls back
  v_res := import_commit_row(v_ws_a, v_job_a, 'k-nome-digits', 'cliente',
                             jsonb_build_object('nome', '123'));
  assert (select sigla from clientes where id = (v_res->>'row_id')::bigint) = 'XX',
    '9: non-alphabetic nome did not fall back to sigla XX';
  assert (select sigla from clientes where id = v_alpha_id::bigint) = 'AL',
    '9: sigla not derived from the first two letters of nome';

  -- unknown kind is rejected before anything is written
  v_err := ic_err(v_ws_a, v_job_a, 'k-bogus-kind', 'planilha', jsonb_build_object('nome', 'X'));
  assert v_err like 'P0001: unknown import kind %',
    '9: unknown kind not rejected: ' || coalesce(v_err, '<no raise>');

  -- dependency ordering errors are legible too
  v_err := ic_err(v_ws_a, v_job_a, 'k-post-orphan', 'post',
                  jsonb_build_object('containerKey', 'k-nope', 'titulo', 'orphan'));
  assert v_err like 'P0001: container % not committed yet',
    '9: post with an uncommitted container not rejected: ' || coalesce(v_err, '<no raise>');
  v_err := ic_err(v_ws_a, v_job_a, 'k-entrega-orphan', 'entrega', jsonb_build_object(
    'titulo', 'E', 'templateKey', 'k-nope',
    'clienteRef', jsonb_build_object('type', 'created', 'sourceKey', 'k-cli-alpha')));
  assert v_err like 'P0001: template % not committed yet',
    '9: entrega with an uncommitted template not rejected: ' || coalesce(v_err, '<no raise>');

  -- ideia path: resolves its cliente, defaults descricao, links keeps its default
  declare v_ide uuid;
  begin
    v_res := import_commit_row(v_ws_a, v_job_a, 'k-ideia', 'ideia', jsonb_build_object(
      'titulo', 'Ideia 1',
      'clienteRef', jsonb_build_object('type', 'existing', 'clienteId', v_cli)));
    v_ide := (v_res->>'row_id')::uuid;
    assert (select cliente_id from ideias where id = v_ide) = v_cli, '9: ideia cliente not resolved';
    assert (select descricao from ideias where id = v_ide) = '', '9: ideia descricao not defaulted';
    assert (select status from ideias where id = v_ide) = 'nova', '9: ideia status not nova';
  end;

  -- ==================================================================
  -- (7) JOB STATE GATING  (run last: it mutates the job's status)
  -- ==================================================================
  -- 'completed' stays writable -- a retry after a failed FINAL batch re-runs
  -- from batch 0 against an already-completed job.
  update import_jobs set status = 'completed' where id = v_job_a;
  v_res := import_commit_row(v_ws_a, v_job_a, 'k-after-completed', 'cliente',
                             jsonb_build_object('nome', 'Late Arrival'));
  assert (v_res->>'skipped')::boolean = false, '7: completed job refused a retry write';

  declare v_before bigint;
  begin
    select count(*) into v_before from import_job_items where job_id = v_job_a;

    update import_jobs set status = 'undoing', undo_started_at = now() where id = v_job_a;
    v_err := ic_err(v_ws_a, v_job_a, 'k-during-undo', 'cliente',
                    jsonb_build_object('nome', 'Racer'));
    assert v_err like 'P0001: import job not found or being undone',
      '7: commit accepted against an UNDOING job (orphans rows the undo never sees): '
      || coalesce(v_err, '<no raise>');
    assert not exists (select 1 from clientes where conta_id = v_ws_a and nome = 'Racer'),
      '7: undoing job still inserted a cliente';

    update import_jobs set status = 'undone' where id = v_job_a;
    v_err := ic_err(v_ws_a, v_job_a, 'k-after-undo', 'cliente',
                    jsonb_build_object('nome', 'Zombie'));
    assert v_err like 'P0001: import job not found or being undone',
      '7: commit accepted against an UNDONE job: ' || coalesce(v_err, '<no raise>');
    assert not exists (select 1 from clientes where conta_id = v_ws_a and nome = 'Zombie'),
      '7: undone job still inserted a cliente';

    assert (select count(*) from import_job_items where job_id = v_job_a) = v_before,
      '7: bookkeeping rows were written to a job under undo';
  end;

  -- a job id that does not exist at all
  v_err := ic_err(v_ws_a, 999999999, 'k-ghost-job', 'cliente', jsonb_build_object('nome', 'X'));
  assert v_err like 'P0001: import job not found or being undone',
    '7: nonexistent job not rejected: ' || coalesce(v_err, '<no raise>');

  -- ==================================================================
  -- FINAL SWEEP: re-assert the table-wide invariants after every write above.
  -- ==================================================================
  assert (select count(*) from workflow_posts
           where published_at is not null and status <> 'postado') = v_base_pub_violations,
    'FINAL: published_at set on a non-postado row';
  assert (select count(*) from workflow_templates where etapas is null) = v_base_null_etapas,
    'FINAL: workflow_templates.etapas is SQL NULL';
  assert not exists (select 1 from workflow_posts where conta_id = v_ws_a
                      and status in ('agendado', 'falha_publicacao')),
    'FINAL: a cron-claimable status reached an imported post';
  -- nothing this job wrote may reference the other workspace
  assert not exists (
    select 1 from import_job_items i join clientes c on c.id::text = i.row_id
     where i.job_id = v_job_a and i.table_name = 'clientes' and c.conta_id <> v_ws_a),
    'FINAL: a bookkeeping row points at a cliente in another workspace';
  assert not exists (select 1 from workflows where conta_id = v_ws_a and cliente_id in
                      (select id from clientes where conta_id <> v_ws_a)),
    'FINAL: an imported workflow is attached to another workspace''s cliente';

  raise notice 'import_commit_row: all cases passed';
end $$;

rollback;
