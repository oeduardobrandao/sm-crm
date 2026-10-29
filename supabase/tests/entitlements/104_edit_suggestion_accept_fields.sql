\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
-- et_grant_hosted_parity() runs inside each begin/rollback block: at top level its GRANT ALL
-- would commit and leak to every later suite on CI's shared database.

-- accept_edit_suggestion(p_suggestion_id, p_expected_updated_at, p_fields) (migration
-- 20261106000003, spec docs/superpowers/specs/2026-10-29-edit-suggestion-no-auto-reject-design.md §5).
-- Cobre:
-- 104.1 sem conflito e p_fields NULL: aplica só o que o cliente mudou (caso 11807, a legenda da equipe fica)
-- 104.2 conflito na legenda, p_fields = {texto}: texto aplicado, legenda da equipe mantida, sugestão accepted
-- 104.3 conflito e p_fields NULL (CRM antigo, 2 args): suggestion_conflict e nada muda
-- 104.4 conflito, p_fields = {texto, legenda}: a legenda do cliente vence
-- 104.5 p_fields sem interseção com o que mudou (ou vazio): no_fields
-- 104.6 suggested_conteudo NULL com texto escolhido: conteudo fica, conteudo_plain aplicado
-- 104.7 texto: imagem inline nova da equipe é conflito; só formatação não é; original_conteudo NULL lê '{}'
-- 104.8 outra conta: Suggestion not found, nada muda
-- 104.9 suggestion_changed continua valendo
-- 104.10 conflito só conta em campo que o cliente mudou; NULL em original_* lê ''
-- 104.11 grants e assinatura (a de 2 args não existe mais)

create or replace function pg_temp.et_af_doc(txt text) returns jsonb
language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
    jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
      jsonb_build_object('type', 'text', 'text', txt)))))
$$;

-- Post vivo: texto T0 / legenda L0. Sugestão pendente com base original T0 / L0.
-- p_changed e o par sugerido definem o que o cliente mudou.
create or replace function pg_temp.et_af_env(
  p_changed text[], p_sug_doc jsonb, p_sug_plain text, p_sug_cap text,
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
  insert into workflow_posts (conta_id, cliente_id, status, conteudo, conteudo_plain, ig_caption)
    values (ws, v_cli, 'enviado_cliente', pg_temp.et_af_doc('T0'), 'T0', 'L0') returning id into post;
  insert into post_edit_suggestions
    (post_id, conta_id, token,
     original_conteudo, original_conteudo_plain, original_ig_caption,
     suggested_conteudo, suggested_conteudo_plain, suggested_ig_caption, changed_fields, status)
    values (post, ws, 'tok',
            pg_temp.et_af_doc('T0'), 'T0', 'L0',
            p_sug_doc, p_sug_plain, p_sug_cap, p_changed, 'pending')
    returning id into sug;
end $$;

create or replace function pg_temp.et_af_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- 104.1 (o caso 11807)
begin;
select et_grant_hosted_parity();
do $$
declare e record;
begin
  -- o cliente só mudou o texto; o Hub guardou a legenda como estava (L0)
  select * into e from pg_temp.et_af_env(array['conteudo_plain','conteudo'], pg_temp.et_af_doc('T1'), 'T1', 'L0');
  update workflow_posts set ig_caption = 'L-team' where id = e.post;
  perform pg_temp.et_af_as(e.usr);
  perform accept_edit_suggestion(e.sug, null, null);
  execute 'reset role';
  assert (select conteudo_plain from workflow_posts where id = e.post) = 'T1', 'texto do cliente aplicado';
  assert (select conteudo from workflow_posts where id = e.post) = pg_temp.et_af_doc('T1'), 'conteudo do cliente aplicado';
  assert (select ig_caption from workflow_posts where id = e.post) = 'L-team', 'legenda da equipe preservada';
  assert (select status from post_edit_suggestions where id = e.sug) = 'accepted', 'sugestão accepted';
  raise notice 'PASS 104.1 aceitar não reverte a legenda da equipe';
end $$;
rollback;

-- 104.2
begin;
select et_grant_hosted_parity();
do $$
declare e record;
begin
  select * into e from pg_temp.et_af_env(array['conteudo_plain','conteudo','ig_caption'], pg_temp.et_af_doc('T1'), 'T1', 'L-cliente');
  update workflow_posts set ig_caption = 'L-team' where id = e.post;
  perform pg_temp.et_af_as(e.usr);
  perform accept_edit_suggestion(e.sug, null, array['texto']);
  execute 'reset role';
  assert (select conteudo_plain from workflow_posts where id = e.post) = 'T1', 'texto aplicado';
  assert (select ig_caption from workflow_posts where id = e.post) = 'L-team', 'legenda da equipe mantida';
  assert (select status from post_edit_suggestions where id = e.sug) = 'accepted', 'aceitar parcial é accepted';
  raise notice 'PASS 104.2 conflito na legenda, só o texto escolhido';
end $$;
rollback;

-- 104.3 (Review Focus 5): chamada de 2 args (CRM antigo) e de 3 args com NULL
begin;
select et_grant_hosted_parity();
do $$
declare e record; v_raised int := 0;
begin
  select * into e from pg_temp.et_af_env(array['conteudo_plain','conteudo','ig_caption'], pg_temp.et_af_doc('T1'), 'T1', 'L-cliente');
  update workflow_posts set ig_caption = 'L-team' where id = e.post;
  perform pg_temp.et_af_as(e.usr);
  begin
    perform accept_edit_suggestion(e.sug);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'suggestion_conflict', format('wrong msg: %s', sqlerrm);
    v_raised := v_raised + 1;
  end;
  begin
    perform accept_edit_suggestion(e.sug, null, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'suggestion_conflict', format('wrong msg: %s', sqlerrm);
    v_raised := v_raised + 1;
  end;
  execute 'reset role';
  assert v_raised = 2, 'as duas chamadas têm que levantar suggestion_conflict';
  assert (select conteudo_plain from workflow_posts where id = e.post) = 'T0', 'post intocado (texto)';
  assert (select ig_caption from workflow_posts where id = e.post) = 'L-team', 'post intocado (legenda)';
  assert (select status from post_edit_suggestions where id = e.sug) = 'pending', 'sugestão segue pendente';
  raise notice 'PASS 104.3 conflito sem escolha levanta e não muda nada';
end $$;
rollback;

-- 104.4
begin;
select et_grant_hosted_parity();
do $$
declare e record;
begin
  select * into e from pg_temp.et_af_env(array['conteudo_plain','conteudo','ig_caption'], pg_temp.et_af_doc('T1'), 'T1', 'L-cliente');
  update workflow_posts set ig_caption = 'L-team' where id = e.post;
  perform pg_temp.et_af_as(e.usr);
  perform accept_edit_suggestion(e.sug, null, array['texto','legenda']);
  execute 'reset role';
  assert (select conteudo_plain from workflow_posts where id = e.post) = 'T1', 'texto aplicado';
  assert (select ig_caption from workflow_posts where id = e.post) = 'L-cliente', 'a legenda do cliente vence quando escolhida';
  assert (select status from post_edit_suggestions where id = e.sug) = 'accepted', 'accepted';
  raise notice 'PASS 104.4 escolher os dois campos aplica os dois';
end $$;
rollback;

-- 104.5
begin;
select et_grant_hosted_parity();
do $$
declare e record; v_raised int := 0;
begin
  select * into e from pg_temp.et_af_env(array['conteudo_plain','conteudo'], pg_temp.et_af_doc('T1'), 'T1', 'L0');
  perform pg_temp.et_af_as(e.usr);
  begin
    perform accept_edit_suggestion(e.sug, null, array['legenda']);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'no_fields', format('wrong msg: %s', sqlerrm);
    v_raised := v_raised + 1;
  end;
  begin
    perform accept_edit_suggestion(e.sug, null, '{}'::text[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'no_fields', format('wrong msg: %s', sqlerrm);
    v_raised := v_raised + 1;
  end;
  execute 'reset role';
  assert v_raised = 2, 'sem interseção e vazio levantam no_fields';
  assert (select status from post_edit_suggestions where id = e.sug) = 'pending', 'sugestão segue pendente';
  assert (select conteudo_plain from workflow_posts where id = e.post) = 'T0', 'post intocado';
  raise notice 'PASS 104.5 no_fields';
end $$;
rollback;

-- 104.6 (Review Focus 2): sugestão de legenda de Story sem conteudo sugerido
begin;
select et_grant_hosted_parity();
do $$
declare e record;
begin
  select * into e from pg_temp.et_af_env(array['conteudo_plain'], null, 'T1', 'L0');
  perform pg_temp.et_af_as(e.usr);
  perform accept_edit_suggestion(e.sug, null, array['texto']);
  execute 'reset role';
  assert (select conteudo from workflow_posts where id = e.post) = pg_temp.et_af_doc('T0'),
    'conteudo vivo não é apagado por suggested_conteudo NULL';
  assert (select conteudo_plain from workflow_posts where id = e.post) = 'T1', 'conteudo_plain aplicado';
  raise notice 'PASS 104.6 COALESCE mantém o conteudo vivo';
end $$;
rollback;

-- 104.7
begin;
select et_grant_hosted_parity();
do $$
declare e record; v_msg text;
  v_img jsonb := jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
    jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
      jsonb_build_object('type', 'text', 'text', 'T0'))),
    jsonb_build_object('type', 'inlineImage', 'attrs', jsonb_build_object('r2Key', 'contas/x/a.png'))));
  v_bold jsonb := jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
    jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
      jsonb_build_object('type', 'text', 'text', 'T0',
        'marks', jsonb_build_array(jsonb_build_object('type', 'bold')))))));
begin
  -- (a) a equipe incluiu uma imagem inline, mesmo plain: conflito de texto
  select * into e from pg_temp.et_af_env(array['conteudo_plain','conteudo'], pg_temp.et_af_doc('T1'), 'T1', 'L0');
  update workflow_posts set conteudo = v_img where id = e.post;
  perform pg_temp.et_af_as(e.usr);
  begin
    perform accept_edit_suggestion(e.sug, null, null);
    assert false, 'imagem nova da equipe devia ser conflito';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text;
    assert v_msg = 'suggestion_conflict', format('esperava suggestion_conflict, veio %s', v_msg);
  end;
  execute 'reset role';

  -- (b) a equipe só deixou uma palavra em negrito (jsonb diferente, plain e imagens iguais): sem conflito
  update workflow_posts set conteudo = v_bold where id = e.post;
  perform pg_temp.et_af_as(e.usr);
  perform accept_edit_suggestion(e.sug, null, null);
  execute 'reset role';
  assert (select conteudo_plain from workflow_posts where id = e.post) = 'T1', 'aceitou sem conflito';
  assert (select status from post_edit_suggestions where id = e.sug) = 'accepted', 'accepted';
  raise notice 'PASS 104.7a/b imagem é conflito, formatação não';
end $$;
rollback;

begin;
select et_grant_hosted_parity();
do $$
declare e record; v_msg text;
begin
  -- (c) original_conteudo NULL lê '{}': a equipe incluir imagem depois ainda é conflito
  select * into e from pg_temp.et_af_env(array['conteudo_plain'], null, 'T1', 'L0');
  update post_edit_suggestions set original_conteudo = null where id = e.sug;
  update workflow_posts set conteudo = jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
    jsonb_build_object('type', 'inlineImage', 'attrs', jsonb_build_object('r2Key', 'contas/x/a.png')))) where id = e.post;
  perform pg_temp.et_af_as(e.usr);
  begin
    perform accept_edit_suggestion(e.sug, null, null);
    assert false, 'original NULL contra imagem viva devia ser conflito';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text;
    assert v_msg = 'suggestion_conflict', format('esperava suggestion_conflict, veio %s', v_msg);
  end;
  execute 'reset role';

  -- (d) os dois NULL: conjuntos iguais, sem conflito
  update post_edit_suggestions set original_conteudo = null where id = e.sug;
  update workflow_posts set conteudo = null where id = e.post;
  perform pg_temp.et_af_as(e.usr);
  perform accept_edit_suggestion(e.sug, null, null);
  execute 'reset role';
  assert (select status from post_edit_suggestions where id = e.sug) = 'accepted', 'NULL contra NULL não é conflito';
  raise notice 'PASS 104.7c/d original_conteudo NULL';
end $$;
rollback;

-- 104.7e: o plain da equipe mudou, é conflito mesmo com as mesmas imagens
begin;
select et_grant_hosted_parity();
do $$
declare e record; v_msg text;
begin
  select * into e from pg_temp.et_af_env(array['conteudo_plain','conteudo'], pg_temp.et_af_doc('T1'), 'T1', 'L0');
  update workflow_posts set conteudo_plain = 'T-team', conteudo = pg_temp.et_af_doc('T-team') where id = e.post;
  perform pg_temp.et_af_as(e.usr);
  begin
    perform accept_edit_suggestion(e.sug, null, null);
    assert false, 'texto da equipe diferente devia ser conflito';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text;
    assert v_msg = 'suggestion_conflict', format('esperava suggestion_conflict, veio %s', v_msg);
  end;
  execute 'reset role';
  perform pg_temp.et_af_as(e.usr);
  perform accept_edit_suggestion(e.sug, null, array['texto']);
  execute 'reset role';
  assert (select conteudo_plain from workflow_posts where id = e.post) = 'T1', 'escolher o texto do cliente resolve';
  raise notice 'PASS 104.7e plain da equipe diferente é conflito';
end $$;
rollback;

-- 104.8
begin;
select et_grant_hosted_parity();
do $$
declare a record; b record; v_raised boolean := false;
begin
  select * into a from pg_temp.et_af_env(array['conteudo_plain'], null, 'T1', 'L0');
  select * into b from pg_temp.et_af_env(array['conteudo_plain'], null, 'T1', 'L0');
  perform pg_temp.et_af_as(a.usr);
  begin
    perform accept_edit_suggestion(b.sug, null, array['texto']);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'Suggestion not found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'aceitar sugestão de outra conta tem que falhar';
  assert (select status from post_edit_suggestions where id = b.sug) = 'pending', 'sugestão da outra conta segue pendente';
  assert (select conteudo_plain from workflow_posts where id = b.post) = 'T0', 'post da outra conta intocado';
  raise notice 'PASS 104.8 outra conta: Suggestion not found';
end $$;
rollback;

-- 104.9
begin;
select et_grant_hosted_parity();
do $$
declare e record; v_updated timestamptz; v_raised boolean := false;
begin
  select * into e from pg_temp.et_af_env(array['conteudo_plain'], null, 'T1', 'L0');
  select updated_at into v_updated from post_edit_suggestions where id = e.sug;
  perform pg_temp.et_af_as(e.usr);
  begin
    perform accept_edit_suggestion(e.sug, v_updated - interval '1 second', array['texto']);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'suggestion_changed', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'p_expected_updated_at velho levanta suggestion_changed';
  perform accept_edit_suggestion(e.sug, v_updated, array['texto']);
  execute 'reset role';
  assert (select status from post_edit_suggestions where id = e.sug) = 'accepted', 'com o updated_at certo aceita';
  raise notice 'PASS 104.9 suggestion_changed';
end $$;
rollback;

-- 104.10
begin;
select et_grant_hosted_parity();
do $$
declare e record; v_msg text;
begin
  -- (a) a equipe mexeu no TEXTO, o cliente só mudou a legenda: texto não é campo mudado, sem conflito
  select * into e from pg_temp.et_af_env(array['ig_caption'], pg_temp.et_af_doc('T0'), 'T0', 'L-cliente');
  update workflow_posts set conteudo_plain = 'T-team', conteudo = pg_temp.et_af_doc('T-team') where id = e.post;
  perform pg_temp.et_af_as(e.usr);
  perform accept_edit_suggestion(e.sug, null, null);
  execute 'reset role';
  assert (select ig_caption from workflow_posts where id = e.post) = 'L-cliente', 'legenda do cliente aplicada';
  assert (select conteudo_plain from workflow_posts where id = e.post) = 'T-team', 'texto da equipe preservado';
  assert (select conteudo from workflow_posts where id = e.post) = pg_temp.et_af_doc('T-team'), 'conteudo da equipe preservado';
  raise notice 'PASS 104.10a conflito só conta em campo mudado';
end $$;
rollback;

begin;
select et_grant_hosted_parity();
do $$
declare e record;
begin
  -- (b) original_ig_caption NULL e vivo '' são iguais (lê ''): sem conflito
  select * into e from pg_temp.et_af_env(array['ig_caption'], pg_temp.et_af_doc('T0'), 'T0', 'L-cliente');
  update post_edit_suggestions set original_ig_caption = null where id = e.sug;
  update workflow_posts set ig_caption = '' where id = e.post;
  perform pg_temp.et_af_as(e.usr);
  perform accept_edit_suggestion(e.sug, null, null);
  execute 'reset role';
  assert (select ig_caption from workflow_posts where id = e.post) = 'L-cliente', 'NULL e vazio não conflitam';
  raise notice 'PASS 104.10b NULL em original_* lê vazio';
end $$;
rollback;

-- 104.11
begin;
do $$
begin
  assert to_regprocedure('public.accept_edit_suggestion(bigint, timestamptz)') is null,
    'a assinatura de 2 args tem que sumir (chamada com 2 args resolveria ambígua)';
  assert to_regprocedure('public.accept_edit_suggestion(bigint)') is null, 'a de 1 arg continua fora';
  assert has_function_privilege('anon', 'public.accept_edit_suggestion(bigint, timestamptz, text[])', 'EXECUTE') = false,
    'anon não executa accept_edit_suggestion';
  assert has_function_privilege('authenticated', 'public.accept_edit_suggestion(bigint, timestamptz, text[])', 'EXECUTE'),
    'authenticated executa (o CRM chama)';
  assert has_function_privilege('service_role', 'public.accept_edit_suggestion(bigint, timestamptz, text[])', 'EXECUTE'),
    'service_role mantém execute';
  raise notice 'PASS 104.11 grants e assinatura';
end $$;
rollback;
