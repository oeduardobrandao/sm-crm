\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- close_suggestion_on_publish (migration 20261106000001) substitui o antigo
-- auto_reject_pending_suggestion: editar o post NÃO fecha mais a sugestão do cliente,
-- só a publicação (status -> 'postado') a encerra, como 'superseded'. Cobre:
-- 102.1 editar a legenda mantém a sugestão pendente
-- 102.2 editar o texto (conteudo_plain + conteudo) mantém a sugestão pendente
-- 102.3 mudar de status sem publicar mantém a sugestão pendente
-- 102.4 publicar fecha como superseded, sem revisor
-- 102.5 publicar um post com status customizado fecha como superseded e limpa o ponteiro
-- 102.6 o backfill reclassifica só as rejeições sem revisor

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

-- 102.1
begin;
do $$
declare e record;
begin
  select * into e from pg_temp.et_es_env();
  update workflow_posts set ig_caption = 'nova' where id = e.post;
  assert (select status from post_edit_suggestions where id = e.sug) = 'pending',
    'editar a legenda não pode fechar a sugestão';
  raise notice 'PASS 102.1 editar a legenda mantém a sugestão pendente';
end $$;
rollback;

-- 102.2
begin;
do $$
declare e record;
begin
  select * into e from pg_temp.et_es_env();
  update workflow_posts set conteudo_plain = 'x', conteudo = '{"type":"doc"}'::jsonb where id = e.post;
  assert (select status from post_edit_suggestions where id = e.sug) = 'pending',
    'editar o texto não pode fechar a sugestão';
  raise notice 'PASS 102.2 editar o texto mantém a sugestão pendente';
end $$;
rollback;

-- 102.3
begin;
do $$
declare e record;
begin
  select * into e from pg_temp.et_es_env();
  update workflow_posts set status = 'revisao_interna' where id = e.post;
  assert (select status from post_edit_suggestions where id = e.sug) = 'pending',
    'revisao_interna não pode fechar a sugestão';
  update workflow_posts set status = 'agendado' where id = e.post;
  assert (select status from post_edit_suggestions where id = e.sug) = 'pending',
    'agendado não pode fechar a sugestão';
  raise notice 'PASS 102.3 mudar de status sem publicar mantém a sugestão pendente';
end $$;
rollback;

-- 102.4
begin;
do $$
declare e record; s record;
begin
  select * into e from pg_temp.et_es_env();
  update workflow_posts set status = 'postado' where id = e.post;
  select status, reviewed_by, reviewed_at into s from post_edit_suggestions where id = e.sug;
  assert s.status = 'superseded', format('publicar fecha como superseded, veio %s', s.status);
  assert s.reviewed_by is null, 'superseded não tem revisor';
  assert s.reviewed_at is not null, 'superseded carimba reviewed_at';
  raise notice 'PASS 102.4 publicar fecha a sugestão como superseded';
end $$;
rollback;

-- 102.5
begin;
do $$
declare e record; v_def uuid; s record;
begin
  select * into e from pg_temp.et_es_env();
  insert into post_status_definitions (conta_id, nome, behaves_as)
    values (e.ws, 'Aprovado pelo diretor', 'aprovado_cliente') returning id into v_def;
  update workflow_posts set status = 'aprovado_cliente', custom_status_id = v_def where id = e.post;
  assert (select custom_status_id from workflow_posts where id = e.post) = v_def, 'post com status customizado';
  assert (select status from post_edit_suggestions where id = e.sug) = 'pending',
    'status customizado não fecha a sugestão';

  update workflow_posts set status = 'postado' where id = e.post;
  assert (select custom_status_id from workflow_posts where id = e.post) is null,
    'z1 limpa o status customizado ao publicar';
  select status, reviewed_by into s from post_edit_suggestions where id = e.sug;
  assert s.status = 'superseded', format('publicar post com status customizado fecha como superseded, veio %s', s.status);
  assert s.reviewed_by is null, 'superseded não tem revisor';
  raise notice 'PASS 102.5 publicar post com status customizado fecha como superseded';
end $$;
rollback;

-- 102.6: a migration já rodou quando a suíte roda, então recria as duas linhas e roda o
-- mesmo UPDATE do backfill (copiado literalmente da migration).
begin;
do $$
declare e record; r_sem bigint; r_com bigint;
begin
  select * into e from pg_temp.et_es_env();
  update post_edit_suggestions set status = 'accepted' where id = e.sug;
  insert into post_edit_suggestions
    (post_id, conta_id, token, suggested_conteudo_plain, changed_fields, status, reviewed_by)
    values (e.post, e.ws, 'tok', 'a', array['conteudo_plain'], 'rejected', null)
    returning id into r_sem;
  insert into post_edit_suggestions
    (post_id, conta_id, token, suggested_conteudo_plain, changed_fields, status, reviewed_by)
    values (e.post, e.ws, 'tok', 'b', array['conteudo_plain'], 'rejected', e.usr)
    returning id into r_com;

  update post_edit_suggestions set status = 'superseded' where status = 'rejected' and reviewed_by is null;

  assert (select status from post_edit_suggestions where id = r_sem) = 'superseded',
    'rejeição automática (sem revisor) vira superseded';
  assert (select status from post_edit_suggestions where id = r_com) = 'rejected',
    'rejeição manual (com revisor) continua rejected';
  raise notice 'PASS 102.6 backfill reclassifica só as rejeições sem revisor';
end $$;
rollback;
