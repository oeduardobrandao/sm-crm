-- supabase/tests/entitlements/99_post_media_notes.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Feedback em mídia (migration 20261025000001, spec 2026-10-22-feedback-em-midia-design).
-- (grants) privilégios de tabela, coluna, sequência e view, ANTES do
--   et_grant_hosted_parity (o helper concede ALL em toda sequência de public);
-- (a) isolamento de leitura entre workspaces;
-- (b) insert do authenticated: nota de cliente recusada, nota interna e
--   resposta da equipe aceitas e visíveis;
-- (c) CHECKs de âncora e da matriz autor/visibilidade;
-- (d) update: só status, resolved_by/resolved_at pelo trigger, outro
--   workspace 0 linhas; post_approval_media_notes só do próprio workspace;
-- (e) resposta do cliente reabre nota resolvida;
-- (f) FK composta do arquivo presa ao workspace;
-- (g) view: slide atual, versão anterior, reordenação;
-- (h) apagar o files anula só file_id (e não trava o DELETE); exclusão do
--   workspace em cascata;
-- (i) anon sem acesso às três tabelas e à view.

create or replace function pg_temp.pmn_env(
  out ws uuid, out usr uuid, out cli bigint, out wf bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max', null);
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws where id = usr;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (usr, ws, 'Cliente', 'C', '#000') returning id into cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (usr, ws, cli, 'WF', 'ativo') returning id into wf;
end $$;

create or replace function pg_temp.pmn_post(p_ws uuid, p_wf bigint)
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into workflow_posts (workflow_id, conta_id, titulo, status)
    values (p_wf, p_ws, 'Post', 'enviado_cliente') returning id into v_id;
  return v_id;
end $$;

create or replace function pg_temp.pmn_file(p_ws uuid, p_kind text default 'image')
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into files (conta_id, r2_key, thumbnail_r2_key, name, kind, mime_type, size_bytes)
    values (p_ws, 'contas/' || p_ws || '/files/' || gen_random_uuid() || '.bin',
            case p_kind when 'video' then 'contas/' || p_ws || '/files/' || gen_random_uuid() || '.thumb.webp' end,
            'midia', p_kind, case p_kind when 'video' then 'video/mp4' else 'image/png' end, 10)
    returning id into v_id;
  return v_id;
end $$;

create or replace function pg_temp.pmn_link(p_ws uuid, p_post bigint, p_file bigint, p_sort int)
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into post_file_links (conta_id, post_id, file_id, sort_order)
    values (p_ws, p_post, p_file, p_sort) returning id into v_id;
  return v_id;
end $$;

-- Nota do cliente (service role): visibility 'client', hub_token, sem usuário.
create or replace function pg_temp.pmn_client_note(p_ws uuid, p_post bigint, p_file bigint,
  p_kind text default 'image')
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into post_media_notes (conta_id, post_id, file_id, slide_index_at_creation,
      media_kind, visibility, author_kind, hub_token, body)
    values (p_ws, p_post, p_file, 0, p_kind, 'client', 'client', 'tok-' || p_ws, 'Troca a cor')
    returning id into v_id;
  return v_id;
end $$;

-- Espera um SQLSTATE exato de p_sql.
create or replace function pg_temp.pmn_expect(p_sql text, p_state text)
returns void language plpgsql as $$
declare v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    v_state := sqlstate;
  end;
  assert v_state = p_state,
    format('esperava SQLSTATE %s, veio %s de: %s', p_state, coalesce(v_state, 'sucesso'), p_sql);
end $$;

-- ---- (grants) privilégios da migration, sem o helper de paridade ----
begin;
do $$
declare v_t text;
begin
  foreach v_t in array array['public.post_media_notes', 'public.post_media_note_replies'] loop
    assert has_table_privilege('authenticated', v_t, 'SELECT'), format('authenticated le %s', v_t);
    assert has_table_privilege('authenticated', v_t, 'INSERT'), format('authenticated insere %s', v_t);
    assert not has_table_privilege('authenticated', v_t, 'DELETE'), format('authenticated nao apaga %s', v_t);
    assert not has_table_privilege('authenticated', v_t, 'TRUNCATE'), format('authenticated nao trunca %s', v_t);
    assert has_table_privilege('service_role', v_t, 'INSERT,UPDATE,DELETE'), format('service_role escreve %s', v_t);
    assert not has_table_privilege('anon', v_t, 'SELECT'), format('anon nao le %s', v_t);
  end loop;
  assert not has_table_privilege('authenticated', 'public.post_media_note_replies', 'UPDATE'),
    'authenticated nao atualiza resposta';
  assert not has_table_privilege('authenticated', 'public.post_media_notes', 'UPDATE'),
    'authenticated sem UPDATE de tabela inteira em notas';
  assert has_column_privilege('authenticated', 'public.post_media_notes', 'status', 'UPDATE'),
    'authenticated atualiza status';
  assert not has_column_privilege('authenticated', 'public.post_media_notes', 'body', 'UPDATE'),
    'authenticated nao atualiza body';
  assert not has_column_privilege('authenticated', 'public.post_media_notes', 'resolved_by', 'UPDATE'),
    'authenticated nao atualiza resolved_by';

  assert has_table_privilege('authenticated', 'public.post_approval_media_notes', 'SELECT'),
    'authenticated le post_approval_media_notes';
  assert not has_table_privilege('authenticated', 'public.post_approval_media_notes', 'INSERT'),
    'authenticated nao insere post_approval_media_notes';
  assert not has_table_privilege('authenticated', 'public.post_approval_media_notes', 'DELETE'),
    'authenticated nao apaga post_approval_media_notes';
  assert has_table_privilege('service_role', 'public.post_approval_media_notes', 'INSERT,DELETE'),
    'service_role escreve post_approval_media_notes';
  assert not has_table_privilege('anon', 'public.post_approval_media_notes', 'SELECT'),
    'anon nao le post_approval_media_notes';

  assert has_table_privilege('authenticated', 'public.post_media_notes_v', 'SELECT'), 'authenticated le a view';
  assert has_table_privilege('service_role', 'public.post_media_notes_v', 'SELECT'), 'service_role le a view';
  assert not has_table_privilege('authenticated', 'public.post_media_notes_v', 'INSERT'), 'view so leitura';
  assert not has_table_privilege('anon', 'public.post_media_notes_v', 'SELECT'), 'anon nao le a view';
  assert (select reloptions from pg_class where oid = 'public.post_media_notes_v'::regclass)
         @> array['security_invoker=true'], 'view com security_invoker';

  foreach v_t in array array['public.post_media_notes_id_seq', 'public.post_media_note_replies_id_seq'] loop
    assert has_sequence_privilege('authenticated', v_t, 'USAGE'), format('authenticated usa %s', v_t);
    assert not has_sequence_privilege('anon', v_t, 'USAGE'), format('anon nao usa %s', v_t);
    assert has_sequence_privilege('service_role', v_t, 'USAGE'), format('service_role usa %s', v_t);
  end loop;

  assert (select relrowsecurity from pg_class where oid = 'public.post_media_notes'::regclass)
     and (select relrowsecurity from pg_class where oid = 'public.post_media_note_replies'::regclass)
     and (select relrowsecurity from pg_class where oid = 'public.post_approval_media_notes'::regclass),
    'RLS ligado nas tres tabelas';
  assert not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('post_media_notes', 'post_media_note_replies', 'post_approval_media_notes')
       and cmd in ('DELETE', 'ALL')
       and roles && array['authenticated', 'public', 'anon']::name[]),
    'nenhuma policy de DELETE/ALL para authenticated, anon ou public';

  raise notice 'PASS 99_post_media_notes (grants) tabelas, colunas, sequencias, view';
end $$;
rollback;

-- ---- (a) + (b) leitura isolada, insert do authenticated ----
begin;
select et_grant_hosted_parity(array['post_media_notes','post_media_note_replies','post_approval_media_notes']);
do $$
declare
  a record; b record;
  v_post_a bigint; v_post_b bigint; v_file_a bigint; v_file_b bigint;
  v_note_a bigint; v_note_b bigint; v_team_note bigint; v_reply bigint;
  v_n int; v_state text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  a := pg_temp.pmn_env();
  b := pg_temp.pmn_env();
  v_post_a := pg_temp.pmn_post(a.ws, a.wf);
  v_post_b := pg_temp.pmn_post(b.ws, b.wf);
  v_file_a := pg_temp.pmn_file(a.ws);
  v_file_b := pg_temp.pmn_file(b.ws);
  perform pg_temp.pmn_link(a.ws, v_post_a, v_file_a, 0);
  perform pg_temp.pmn_link(b.ws, v_post_b, v_file_b, 0);
  v_note_a := pg_temp.pmn_client_note(a.ws, v_post_a, v_file_a);
  v_note_b := pg_temp.pmn_client_note(b.ws, v_post_b, v_file_b);
  insert into post_media_note_replies (note_id, conta_id, author_kind, hub_token, body)
    values (v_note_b, b.ws, 'client', 'tok-b', 'Resposta de B');

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', a.usr, 'role', 'authenticated')::text, true);

  -- (a) A vê a sua nota, nada de B (tabela, respostas e view)
  select count(*) into v_n from post_media_notes;
  assert v_n = 1, format('A deveria ver 1 nota, viu %s', v_n);
  select count(*) into v_n from post_media_notes where conta_id = b.ws or id = v_note_b;
  assert v_n = 0, 'A nao pode ver notas de B';
  select count(*) into v_n from post_media_note_replies;
  assert v_n = 0, 'A nao pode ver respostas de B';
  select count(*) into v_n from post_media_notes_v;
  assert v_n = 1, format('A deveria ver 1 linha na view, viu %s', v_n);

  -- (b) nota de cliente pelo authenticated: recusada (RLS ou CHECK)
  v_state := null;
  begin
    insert into post_media_notes (conta_id, post_id, file_id, slide_index_at_creation,
        media_kind, visibility, author_kind, hub_token, body)
      values (a.ws, v_post_a, v_file_a, 0, 'image', 'client', 'client', 'tok', 'Fingindo cliente');
  exception when others then v_state := sqlstate;
  end;
  assert v_state in ('42501', '23514'),
    format('nota de cliente pelo authenticated deveria falhar com 42501/23514, veio %s', coalesce(v_state, 'sucesso'));

  -- (b) nota de equipe com visibility client: recusada (RLS ou CHECK)
  v_state := null;
  begin
    insert into post_media_notes (conta_id, post_id, file_id, slide_index_at_creation,
        media_kind, visibility, author_kind, author_user_id, body)
      values (a.ws, v_post_a, v_file_a, 0, 'image', 'client', 'team', a.usr, 'Visivel ao cliente');
  exception when others then v_state := sqlstate;
  end;
  assert v_state in ('42501', '23514'),
    format('nota de equipe visivel ao cliente deveria falhar, veio %s', coalesce(v_state, 'sucesso'));

  -- (b) nota interna com uid de outra pessoa: recusada pela policy
  perform pg_temp.pmn_expect(format(
    'insert into post_media_notes (conta_id, post_id, file_id, slide_index_at_creation, media_kind, visibility, author_kind, author_user_id, body) values (%L::uuid, %s, %s, 0, %L, %L, %L, %L::uuid, %L)',
    a.ws, v_post_a, v_file_a, 'image', 'internal', 'team', b.usr, 'Em nome de outro'), '42501');

  -- (b) nota interna no workspace B: recusada pela policy
  perform pg_temp.pmn_expect(format(
    'insert into post_media_notes (conta_id, post_id, file_id, slide_index_at_creation, media_kind, visibility, author_kind, author_user_id, body) values (%L::uuid, %s, %s, 0, %L, %L, %L, %L::uuid, %L)',
    b.ws, v_post_b, v_file_b, 'image', 'internal', 'team', a.usr, 'No workspace errado'), '42501');

  -- (b) nota interna própria: aceita e visível (grant + policy + sequência)
  insert into post_media_notes (conta_id, post_id, file_id, slide_index_at_creation,
      media_kind, visibility, author_kind, author_user_id, body, x, y)
    values (a.ws, v_post_a, v_file_a, 0, 'image', 'internal', 'team', a.usr, 'Nota interna', 0.5, 0.25)
    returning id into v_team_note;
  select count(*) into v_n from post_media_notes where id = v_team_note
     and visibility = 'internal' and author_user_id = a.usr and status = 'open';
  assert v_n = 1, 'nota interna visivel apos o insert';

  -- (b) resposta da equipe: aceita e visível
  insert into post_media_note_replies (note_id, conta_id, author_kind, author_user_id, body)
    values (v_note_a, a.ws, 'team', a.usr, 'Ajustado')
    returning id into v_reply;
  select count(*) into v_n from post_media_note_replies where id = v_reply;
  assert v_n = 1, 'resposta da equipe visivel apos o insert';

  -- (b) resposta "de cliente" pelo authenticated: recusada
  v_state := null;
  begin
    insert into post_media_note_replies (note_id, conta_id, author_kind, hub_token, body)
      values (v_note_a, a.ws, 'client', 'tok', 'Fingindo cliente');
  exception when others then v_state := sqlstate;
  end;
  assert v_state in ('42501', '23514'),
    format('resposta de cliente pelo authenticated deveria falhar, veio %s', coalesce(v_state, 'sucesso'));

  -- (b) resposta em nota de B: recusada pela policy
  perform pg_temp.pmn_expect(format(
    'insert into post_media_note_replies (note_id, conta_id, author_kind, author_user_id, body) values (%s, %L::uuid, %L, %L::uuid, %L)',
    v_note_b, b.ws, 'team', a.usr, 'Em B'), '42501');

  -- (b) authenticated não apaga
  perform pg_temp.pmn_expect(format('delete from post_media_notes where id = %s', v_team_note), '42501');
  perform pg_temp.pmn_expect(format('delete from post_media_note_replies where id = %s', v_reply), '42501');
  reset role;

  raise notice 'PASS 99_post_media_notes (a, b) isolamento + insert do authenticated';
end $$;
rollback;

-- ---- (c) CHECKs ----
begin;
do $$
declare
  a record; v_post bigint; v_img bigint; v_vid bigint; v_note bigint;
  v_base text; v_bad text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  a := pg_temp.pmn_env();
  v_post := pg_temp.pmn_post(a.ws, a.wf);
  v_img := pg_temp.pmn_file(a.ws, 'image');
  v_vid := pg_temp.pmn_file(a.ws, 'video');

  v_base := format(
    'insert into post_media_notes (conta_id, post_id, file_id, slide_index_at_creation, media_kind, '
    'visibility, author_kind, author_user_id, hub_token, body, x, y, t_seconds, status, resolved_at) '
    'values (%L::uuid, %s, %%s, %%s, %%L, %%L, %%L, %%L::uuid, %%L, %%L, %%s, %%s, %%s, %%L, %%s)',
    a.ws, v_post);

  -- válidas: cliente com ponto e tempo em vídeo; equipe interna sem âncora extra
  execute format(v_base, v_vid, 0, 'video', 'client', 'client', null, 'tok', 'Ok', 0, 1, 12.5, 'open', 'null');
  execute format(v_base, v_img, 3, 'image', 'internal', 'team', a.usr, null, 'Ok', 'null', 'null', 'null', 'open', 'null');
  execute format(v_base, 'null', 0, 'image', 'internal', 'team', a.usr, null, 'Ok', 'null', 'null', 'null', 'resolved', 'now()');

  foreach v_bad in array array[
    -- x sem y, y sem x
    format(v_base, v_img, 0, 'image', 'client', 'client', null, 'tok', 'x', 0.5, 'null', 'null', 'open', 'null'),
    format(v_base, v_img, 0, 'image', 'client', 'client', null, 'tok', 'x', 'null', 0.5, 'null', 'open', 'null'),
    -- fora de 0..1
    format(v_base, v_img, 0, 'image', 'client', 'client', null, 'tok', 'x', 1.01, 0.5, 'null', 'open', 'null'),
    format(v_base, v_img, 0, 'image', 'client', 'client', null, 'tok', 'x', 0.5, -0.01, 'null', 'open', 'null'),
    -- t_seconds em imagem; t_seconds negativo
    format(v_base, v_img, 0, 'image', 'client', 'client', null, 'tok', 'x', 'null', 'null', 3, 'open', 'null'),
    format(v_base, v_vid, 0, 'video', 'client', 'client', null, 'tok', 'x', 'null', 'null', -1, 'open', 'null'),
    -- matriz autor/visibilidade
    format(v_base, v_img, 0, 'image', 'internal', 'client', null, 'tok', 'x', 'null', 'null', 'null', 'open', 'null'),
    format(v_base, v_img, 0, 'image', 'client', 'team', a.usr, null, 'x', 'null', 'null', 'null', 'open', 'null'),
    -- forma do autor
    format(v_base, v_img, 0, 'image', 'client', 'client', a.usr, 'tok', 'x', 'null', 'null', 'null', 'open', 'null'),
    format(v_base, v_img, 0, 'image', 'client', 'client', null, null, 'x', 'null', 'null', 'null', 'open', 'null'),
    format(v_base, v_img, 0, 'image', 'internal', 'team', a.usr, 'tok', 'x', 'null', 'null', 'null', 'open', 'null'),
    format(v_base, v_img, 0, 'image', 'internal', 'team', null, null, 'x', 'null', 'null', 'null', 'open', 'null'),
    -- domínios
    format(v_base, v_img, -1, 'image', 'client', 'client', null, 'tok', 'x', 'null', 'null', 'null', 'open', 'null'),
    format(v_base, v_img, 0, 'gif', 'client', 'client', null, 'tok', 'x', 'null', 'null', 'null', 'open', 'null'),
    format(v_base, v_img, 0, 'image', 'client', 'client', null, 'tok', '', 'null', 'null', 'null', 'open', 'null'),
    format(v_base, v_img, 0, 'image', 'client', 'client', null, 'tok', repeat('a', 2001), 'null', 'null', 'null', 'open', 'null'),
    format(v_base, v_img, 0, 'image', 'client', 'client', null, 'tok', 'x', 'null', 'null', 'null', 'archived', 'null'),
    -- status x resolved_at
    format(v_base, v_img, 0, 'image', 'client', 'client', null, 'tok', 'x', 'null', 'null', 'null', 'resolved', 'null'),
    format(v_base, v_img, 0, 'image', 'client', 'client', null, 'tok', 'x', 'null', 'null', 'null', 'open', 'now()')
  ] loop
    perform pg_temp.pmn_expect(v_bad, '23514');
  end loop;

  -- respostas: mesma forma de autor, body 1..2000
  v_note := pg_temp.pmn_client_note(a.ws, v_post, v_img);
  insert into post_media_note_replies (note_id, conta_id, author_kind, hub_token, body)
    values (v_note, a.ws, 'client', 'tok', repeat('a', 2000));
  foreach v_bad in array array[
    format('insert into post_media_note_replies (note_id, conta_id, author_kind, author_user_id, hub_token, body) values (%s, %L::uuid, %L, %L::uuid, %L, %L)',
      v_note, a.ws, 'client', a.usr, 'tok', 'x'),
    format('insert into post_media_note_replies (note_id, conta_id, author_kind, author_user_id, hub_token, body) values (%s, %L::uuid, %L, null, null, %L)',
      v_note, a.ws, 'client', 'x'),
    format('insert into post_media_note_replies (note_id, conta_id, author_kind, author_user_id, hub_token, body) values (%s, %L::uuid, %L, %L::uuid, %L, %L)',
      v_note, a.ws, 'team', a.usr, 'tok', 'x'),
    format('insert into post_media_note_replies (note_id, conta_id, author_kind, author_user_id, hub_token, body) values (%s, %L::uuid, %L, null, null, %L)',
      v_note, a.ws, 'team', 'x'),
    format('insert into post_media_note_replies (note_id, conta_id, author_kind, author_user_id, hub_token, body) values (%s, %L::uuid, %L, null, %L, %L)',
      v_note, a.ws, 'robot', 'tok', 'x'),
    format('insert into post_media_note_replies (note_id, conta_id, author_kind, author_user_id, hub_token, body) values (%s, %L::uuid, %L, null, %L, %L)',
      v_note, a.ws, 'client', 'tok', ''),
    format('insert into post_media_note_replies (note_id, conta_id, author_kind, author_user_id, hub_token, body) values (%s, %L::uuid, %L, null, %L, %L)',
      v_note, a.ws, 'client', 'tok', repeat('a', 2001))
  ] loop
    perform pg_temp.pmn_expect(v_bad, '23514');
  end loop;

  raise notice 'PASS 99_post_media_notes (c) checks de ancora, autor e visibilidade';
end $$;
rollback;

-- ---- (d) update de status, post_approval_media_notes ----
begin;
select et_grant_hosted_parity(array['post_media_notes','post_media_note_replies','post_approval_media_notes']);
do $$
declare
  a record; b record;
  v_post_a bigint; v_post_b bigint; v_file_a bigint; v_file_b bigint;
  v_note_a bigint; v_note_b bigint; v_appr_a bigint; v_appr_b bigint;
  v_n int; v_row post_media_notes;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  a := pg_temp.pmn_env();
  b := pg_temp.pmn_env();
  v_post_a := pg_temp.pmn_post(a.ws, a.wf);
  v_post_b := pg_temp.pmn_post(b.ws, b.wf);
  v_file_a := pg_temp.pmn_file(a.ws);
  v_file_b := pg_temp.pmn_file(b.ws);
  v_note_a := pg_temp.pmn_client_note(a.ws, v_post_a, v_file_a);
  v_note_b := pg_temp.pmn_client_note(b.ws, v_post_b, v_file_b);
  insert into post_approvals (post_id, action, comentario, is_workspace_user)
    values (v_post_a, 'correcao', 'Ajustes', false) returning id into v_appr_a;
  insert into post_approvals (post_id, action, comentario, is_workspace_user)
    values (v_post_b, 'correcao', 'Ajustes', false) returning id into v_appr_b;
  insert into post_approval_media_notes (post_approval_id, note_id) values (v_appr_a, v_note_a);
  insert into post_approval_media_notes (post_approval_id, note_id) values (v_appr_b, v_note_b);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', a.usr, 'role', 'authenticated')::text, true);

  -- body não é editável pelo authenticated (grant de coluna)
  perform pg_temp.pmn_expect(format(
    'update post_media_notes set body = %L where id = %s', 'Outro texto', v_note_a), '42501');

  -- resolver: 1 linha, resolved_by = uid, resolved_at preenchido
  update post_media_notes set status = 'resolved' where id = v_note_a;
  get diagnostics v_n = row_count;
  assert v_n = 1, format('resolver deveria afetar 1 linha, afetou %s', v_n);
  select * into v_row from post_media_notes where id = v_note_a;
  assert v_row.status = 'resolved' and v_row.resolved_by = a.usr and v_row.resolved_at is not null,
    format('resolvida por A, veio by=%s at=%s', v_row.resolved_by, v_row.resolved_at);
  assert v_row.body = 'Troca a cor', 'body intacto';

  -- reabrir: limpa os dois
  update post_media_notes set status = 'open' where id = v_note_a;
  get diagnostics v_n = row_count;
  assert v_n = 1, 'reabrir afeta 1 linha';
  select * into v_row from post_media_notes where id = v_note_a;
  assert v_row.status = 'open' and v_row.resolved_by is null and v_row.resolved_at is null,
    'reaberta limpa resolved_by e resolved_at';

  -- nota de B: 0 linhas
  update post_media_notes set status = 'resolved' where id = v_note_b;
  get diagnostics v_n = row_count;
  assert v_n = 0, format('update na nota de B deveria afetar 0 linhas, afetou %s', v_n);

  -- respostas não são editáveis
  perform pg_temp.pmn_expect(format(
    'update post_media_note_replies set body = %L where note_id = %s', 'x', v_note_a), '42501');

  -- post_approval_media_notes: só as do próprio workspace, direto e pelo embed
  select count(*) into v_n from post_approval_media_notes;
  assert v_n = 1, format('A deveria ver 1 vinculo de aprovacao, viu %s', v_n);
  select count(*) into v_n from post_approval_media_notes where note_id = v_note_b;
  assert v_n = 0, 'A nao ve o vinculo de B';
  select count(*) into v_n
    from post_approvals pa join post_approval_media_notes pamn on pamn.post_approval_id = pa.id
   where pa.id in (v_appr_a, v_appr_b);
  assert v_n = 1, format('embed por post_approvals deveria trazer 1, trouxe %s', v_n);
  perform pg_temp.pmn_expect(format(
    'insert into post_approval_media_notes (post_approval_id, note_id) values (%s, %s)', v_appr_a, v_note_a),
    '42501');
  reset role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- service role: resolve sem uid; update sem troca de status preserva resolved_*
  update post_media_notes set status = 'resolved' where id = v_note_b;
  select * into v_row from post_media_notes where id = v_note_b;
  assert v_row.resolved_by is null and v_row.resolved_at is not null, 'service role resolve sem uid';
  update post_media_notes set resolved_at = now() - interval '1 day', resolved_by = b.usr
   where id = v_note_b;
  update post_media_notes set body = 'Editado' where id = v_note_b;
  select * into v_row from post_media_notes where id = v_note_b;
  assert v_row.status = 'resolved' and v_row.resolved_by = b.usr
     and v_row.resolved_at = now() - interval '1 day' and v_row.body = 'Editado',
    'update sem troca de status preserva resolved_*';
  assert v_row.updated_at = now(), 'updated_at tocado no update';

  raise notice 'PASS 99_post_media_notes (d) update de status + vinculo de aprovacao';
end $$;
rollback;

-- ---- (e) resposta do cliente reabre ----
begin;
do $$
declare
  a record; v_post bigint; v_file bigint; v_note bigint; v_row post_media_notes;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  a := pg_temp.pmn_env();
  v_post := pg_temp.pmn_post(a.ws, a.wf);
  v_file := pg_temp.pmn_file(a.ws);
  v_note := pg_temp.pmn_client_note(a.ws, v_post, v_file);

  update post_media_notes set status = 'resolved' where id = v_note;
  -- resposta da equipe não reabre
  insert into post_media_note_replies (note_id, conta_id, author_kind, author_user_id, body)
    values (v_note, a.ws, 'team', a.usr, 'Feito');
  assert (select status from post_media_notes where id = v_note) = 'resolved',
    'resposta da equipe mantem resolvida';

  -- resposta do cliente reabre e limpa resolved_*
  insert into post_media_note_replies (note_id, conta_id, author_kind, hub_token, body)
    values (v_note, a.ws, 'client', 'tok', 'Ainda nao');
  select * into v_row from post_media_notes where id = v_note;
  assert v_row.status = 'open' and v_row.resolved_at is null and v_row.resolved_by is null,
    format('resposta do cliente reabre, veio %s', v_row.status);

  -- em nota já aberta continua aberta
  insert into post_media_note_replies (note_id, conta_id, author_kind, hub_token, body)
    values (v_note, a.ws, 'client', 'tok', 'Mais uma');
  assert (select status from post_media_notes where id = v_note) = 'open', 'continua aberta';

  raise notice 'PASS 99_post_media_notes (e) resposta do cliente reabre';
end $$;
rollback;

-- ---- (f) FKs compostas ----
begin;
do $$
declare
  a record; b record;
  v_post_a bigint; v_post_b bigint; v_file_b bigint; v_note_a bigint;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  a := pg_temp.pmn_env();
  b := pg_temp.pmn_env();
  v_post_a := pg_temp.pmn_post(a.ws, a.wf);
  v_post_b := pg_temp.pmn_post(b.ws, b.wf);
  v_file_b := pg_temp.pmn_file(b.ws);

  -- arquivo de B numa nota de A
  perform pg_temp.pmn_expect(format(
    'insert into post_media_notes (conta_id, post_id, file_id, slide_index_at_creation, media_kind, visibility, author_kind, hub_token, body) values (%L::uuid, %s, %s, 0, %L, %L, %L, %L, %L)',
    a.ws, v_post_a, v_file_b, 'image', 'client', 'client', 'tok', 'x'), '23503');
  -- post de B numa nota de A
  perform pg_temp.pmn_expect(format(
    'insert into post_media_notes (conta_id, post_id, file_id, slide_index_at_creation, media_kind, visibility, author_kind, hub_token, body) values (%L::uuid, %s, null, 0, %L, %L, %L, %L, %L)',
    a.ws, v_post_b, 'image', 'client', 'client', 'tok', 'x'), '23503');
  -- resposta com conta_id diferente da nota
  v_note_a := pg_temp.pmn_client_note(a.ws, v_post_a, null);
  perform pg_temp.pmn_expect(format(
    'insert into post_media_note_replies (note_id, conta_id, author_kind, hub_token, body) values (%s, %L::uuid, %L, %L, %L)',
    v_note_a, b.ws, 'client', 'tok', 'x'), '23503');

  raise notice 'PASS 99_post_media_notes (f) FKs compostas presas ao workspace';
end $$;
rollback;

-- ---- (g) view: slide atual, versão anterior, reordenação ----
begin;
do $$
declare
  a record; v_post bigint;
  v_f0 bigint; v_f1 bigint; v_f2 bigint; v_fnew bigint;
  v_l0 bigint; v_l1 bigint; v_l2 bigint;
  v_note2 bigint; v_note0 bigint; v_v record;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  a := pg_temp.pmn_env();
  v_post := pg_temp.pmn_post(a.ws, a.wf);
  v_f0 := pg_temp.pmn_file(a.ws);
  v_f1 := pg_temp.pmn_file(a.ws);
  v_f2 := pg_temp.pmn_file(a.ws);
  v_fnew := pg_temp.pmn_file(a.ws);
  v_l0 := pg_temp.pmn_link(a.ws, v_post, v_f0, 0);
  v_l1 := pg_temp.pmn_link(a.ws, v_post, v_f1, 1);
  v_l2 := pg_temp.pmn_link(a.ws, v_post, v_f2, 2);
  v_note2 := pg_temp.pmn_client_note(a.ws, v_post, v_f2);
  v_note0 := pg_temp.pmn_client_note(a.ws, v_post, v_f0);

  select * into v_v from post_media_notes_v where id = v_note2;
  assert v_v.current_link_id = v_l2 and v_v.current_slide_index = 2 and not v_v.is_previous_version,
    format('nota no slide 2 atual, veio link=%s idx=%s prev=%s',
           v_v.current_link_id, v_v.current_slide_index, v_v.is_previous_version);
  assert v_v.body = 'Troca a cor' and v_v.conta_id = a.ws and v_v.file_id = v_f2,
    'view expoe as colunas da nota';

  -- reordenação: o índice segue o vínculo (sort_order empatado desempata por id)
  update post_file_links set sort_order = 5 where id = v_l0;
  select * into v_v from post_media_notes_v where id = v_note0;
  assert v_v.current_link_id = v_l0 and v_v.current_slide_index = 2,
    format('slide 0 movido para o fim, veio idx=%s', v_v.current_slide_index);
  assert (select current_slide_index from post_media_notes_v where id = v_note2) = 1,
    'slide 2 sobe para 1';
  update post_file_links set sort_order = 1 where id = v_l2;
  assert (select current_slide_index from post_media_notes_v where id = v_note2) = 1
     and (select current_slide_index from post_media_notes_v where id = v_note0) = 2,
    'empate de sort_order desempata por id';

  -- troca do arquivo no mesmo vínculo (post_file_link_replace): versão anterior
  update post_file_links set file_id = v_fnew where id = v_l2;
  select * into v_v from post_media_notes_v where id = v_note2;
  assert v_v.is_previous_version and v_v.current_link_id is null and v_v.current_slide_index is null,
    'arquivo trocado vira versao anterior';
  assert v_v.slide_index_at_creation = 0 and v_v.file_id = v_f2, 'snapshot e arquivo preservados';

  -- o arquivo volta a um vínculo do post: a nota volta a ser atual
  perform pg_temp.pmn_link(a.ws, v_post, v_f2, 9);
  select * into v_v from post_media_notes_v where id = v_note2;
  assert not v_v.is_previous_version and v_v.current_slide_index = 3, 'arquivo relinkado volta a ser atual';

  raise notice 'PASS 99_post_media_notes (g) view de ancora';
end $$;
rollback;

-- ---- (h) apagar o files anula só file_id; workspace em cascata ----
begin;
do $$
declare
  a record; v_post bigint; v_file bigint; v_link bigint; v_note bigint; v_appr bigint;
  v_row post_media_notes; v_n int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  a := pg_temp.pmn_env();
  v_post := pg_temp.pmn_post(a.ws, a.wf);
  v_file := pg_temp.pmn_file(a.ws);
  v_link := pg_temp.pmn_link(a.ws, v_post, v_file, 0);
  v_note := pg_temp.pmn_client_note(a.ws, v_post, v_file);
  insert into post_media_note_replies (note_id, conta_id, author_kind, hub_token, body)
    values (v_note, a.ws, 'client', 'tok', 'Resposta');

  -- a nota não segura o arquivo (sem reference_count)
  assert (select reference_count from files where id = v_file) = 1, 'so o vinculo conta referencia';

  delete from post_file_links where id = v_link;
  delete from files where id = v_file;
  get diagnostics v_n = row_count;
  assert v_n = 1, 'DELETE de files nao pode ser bloqueado pela nota';
  select * into v_row from post_media_notes where id = v_note;
  assert v_row.id is not null and v_row.file_id is null and v_row.conta_id = a.ws and v_row.post_id = v_post,
    'nota sobrevive com file_id null e conta_id intacto';
  assert (select is_previous_version from post_media_notes_v where id = v_note), 'midia removida = versao anterior';

  -- excluir o post cascateia nota e resposta
  delete from workflow_posts where id = v_post;
  assert not exists (select 1 from post_media_notes where id = v_note), 'nota cascateada com o post';
  assert not exists (select 1 from post_media_note_replies where note_id = v_note), 'resposta cascateada';

  -- excluir o workspace com nota, resposta, arquivo e vínculo de aprovação
  v_post := pg_temp.pmn_post(a.ws, a.wf);
  v_file := pg_temp.pmn_file(a.ws);
  v_note := pg_temp.pmn_client_note(a.ws, v_post, v_file);
  insert into post_media_note_replies (note_id, conta_id, author_kind, hub_token, body)
    values (v_note, a.ws, 'client', 'tok', 'Resposta');
  insert into post_approvals (post_id, action, comentario, is_workspace_user)
    values (v_post, 'correcao', 'x', false) returning id into v_appr;
  insert into post_approval_media_notes (post_approval_id, note_id) values (v_appr, v_note);
  delete from workspaces where id = a.ws;
  assert not exists (select 1 from post_media_notes where conta_id = a.ws), 'notas cascateadas';
  assert not exists (select 1 from post_media_note_replies where conta_id = a.ws), 'respostas cascateadas';
  assert not exists (select 1 from post_approval_media_notes where note_id = v_note), 'vinculos cascateados';

  raise notice 'PASS 99_post_media_notes (h) files apagado anula so file_id, cascatas';
end $$;
rollback;

-- ---- (i) anon sem acesso ----
begin;
do $$
declare v_rel text; v_raised boolean;
begin
  set local role anon;
  foreach v_rel in array array['post_media_notes', 'post_media_note_replies',
                               'post_approval_media_notes', 'post_media_notes_v'] loop
    v_raised := false;
    begin
      execute format('select 1 from public.%I', v_rel);
    exception when insufficient_privilege then v_raised := true;
    end;
    assert v_raised, format('anon nao pode ler %s', v_rel);
  end loop;
  reset role;
  raise notice 'PASS 99_post_media_notes (i) anon sem acesso';
end $$;
rollback;
