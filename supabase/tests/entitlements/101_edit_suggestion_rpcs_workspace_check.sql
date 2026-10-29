\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
-- et_grant_hosted_parity() runs inside each begin/rollback block: at top level its GRANT ALL
-- would commit and leak to every later suite on CI's shared database.

-- accept_edit_suggestion / reject_edit_suggestion workspace check (migration
-- 20261105000001). Both are SECURITY DEFINER and granted to authenticated, so
-- RLS does not apply inside them. Cobre:
-- 101.0 aceitar sugestão de outra conta falha e não toca post nem sugestão
-- 101.1 rejeitar sugestão de outra conta falha e não toca a sugestão
-- 101.2 a própria conta continua aceitando e rejeitando
-- 101.3 id inexistente e id de outra conta dão o mesmo erro

create or replace function pg_temp.et_es_env(
  out ws uuid, out usr uuid, out post bigint, out sug bigint)
language plpgsql as $$
declare v_cli bigint;
begin
  ws := et_make_workspace('pro');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws where id = usr;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflow_posts (conta_id, cliente_id, status, conteudo_plain, ig_caption)
    values (ws, v_cli, 'enviado_cliente', 'texto da equipe', 'legenda da equipe') returning id into post;
  insert into post_edit_suggestions
    (post_id, conta_id, token, original_conteudo_plain, original_ig_caption,
     suggested_conteudo_plain, suggested_ig_caption, changed_fields, status)
    values (post, ws, 'tok', 'texto da equipe', 'legenda da equipe',
            'texto do cliente', 'legenda da equipe', array['conteudo_plain'], 'pending')
    returning id into sug;
end $$;

create or replace function pg_temp.et_es_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- 101.0
begin;
select et_grant_hosted_parity();
do $$
declare a record; b record; v_raised boolean := false;
begin
  select * into a from pg_temp.et_es_env();
  select * into b from pg_temp.et_es_env();
  perform pg_temp.et_es_as(a.usr);
  begin
    perform accept_edit_suggestion(b.sug);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'Suggestion not found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'aceitar sugestão de outra conta tem que falhar';
  assert (select status from post_edit_suggestions where id = b.sug) = 'pending', 'sugestão da outra conta segue pendente';
  assert (select conteudo_plain from workflow_posts where id = b.post) = 'texto da equipe', 'post da outra conta intocado';
  raise notice 'PASS 101.0 aceitar sugestão de outra conta falha sem efeito';
end $$;
rollback;

-- 101.1
begin;
select et_grant_hosted_parity();
do $$
declare a record; b record; v_raised boolean := false;
begin
  select * into a from pg_temp.et_es_env();
  select * into b from pg_temp.et_es_env();
  perform pg_temp.et_es_as(a.usr);
  begin
    perform reject_edit_suggestion(b.sug);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'Suggestion not found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'rejeitar sugestão de outra conta tem que falhar';
  assert (select status from post_edit_suggestions where id = b.sug) = 'pending', 'sugestão da outra conta segue pendente';
  raise notice 'PASS 101.1 rejeitar sugestão de outra conta falha sem efeito';
end $$;
rollback;

-- 101.2
begin;
select et_grant_hosted_parity();
do $$
declare a record; a2 record;
begin
  select * into a from pg_temp.et_es_env();
  perform pg_temp.et_es_as(a.usr);
  perform accept_edit_suggestion(a.sug);
  execute 'reset role';
  assert (select status from post_edit_suggestions where id = a.sug) = 'accepted', 'a própria conta aceita';
  assert (select conteudo_plain from workflow_posts where id = a.post) = 'texto do cliente', 'aceitar aplica o texto';

  -- segunda sugestão no mesmo workspace, para o caminho de rejeitar
  insert into post_edit_suggestions
    (post_id, conta_id, token, suggested_conteudo_plain, changed_fields, status)
    values (a.post, a.ws, 'tok', 'outro texto', array['conteudo_plain'], 'pending')
    returning id into a2;
  perform pg_temp.et_es_as(a.usr);
  perform reject_edit_suggestion(a2.id);
  execute 'reset role';
  assert (select status from post_edit_suggestions where id = a2.id) = 'rejected', 'a própria conta rejeita';
  assert (select reviewed_by from post_edit_suggestions where id = a2.id) = a.usr, 'reviewed_by é quem rejeitou';
  raise notice 'PASS 101.2 a própria conta aceita e rejeita';
end $$;
rollback;

-- 101.3
begin;
select et_grant_hosted_parity();
do $$
declare a record; v_msg text;
begin
  select * into a from pg_temp.et_es_env();
  perform pg_temp.et_es_as(a.usr);
  begin
    perform accept_edit_suggestion(-1);
  exception when sqlstate 'P0001' then
    v_msg := sqlerrm;
  end;
  execute 'reset role';
  assert v_msg = 'Suggestion not found', format('id inexistente: %s', v_msg);
  raise notice 'PASS 101.3 id inexistente dá o mesmo erro que id de outra conta';
end $$;
rollback;
