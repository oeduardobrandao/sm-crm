\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
-- et_grant_hosted_parity() runs inside each begin/rollback block: at top level its GRANT ALL
-- would commit and leak to every later suite on CI's shared database.

-- accept_edit_suggestion(p_suggestion_id, p_expected_updated_at, p_fields, p_acknowledged) (migration
-- 20261106000003, spec docs/superpowers/specs/2026-10-29-edit-suggestion-no-auto-reject-design.md §5).
-- Cobre:
-- 104.1 sem conflito e p_fields NULL: aplica só o que o cliente mudou (caso 11807, a legenda da equipe fica)
-- 104.2 conflito na legenda, p_fields = {texto}: texto aplicado, legenda da equipe mantida, sugestão accepted
-- 104.3 conflito e p_fields NULL (CRM antigo, 2 args): suggestion_conflict e nada muda
-- 104.4 conflito, p_fields = {texto, legenda} com p_acknowledged = {legenda}: a legenda do cliente vence
-- 104.4b p_fields = {legenda} com conflito de legenda no servidor e sem reconhecimento: suggestion_conflict, nada muda
-- 104.4c p_fields = {texto} com conflito só na legenda e sem reconhecimento: aplica o texto (legenda fora do conjunto)
-- 104.5 p_fields sem interseção com o que mudou (ou vazio): no_fields
-- 104.6 suggested_conteudo NULL com texto escolhido: conteudo fica, conteudo_plain aplicado
-- 104.7 texto: imagem inline nova da equipe é conflito; só formatação não é; original_conteudo NULL lê '{}'
-- 104.8 outra conta: Suggestion not found, nada muda
-- 104.9 suggestion_changed continua valendo
-- 104.10 conflito só conta em campo que o cliente mudou; NULL em original_* lê ''
-- 104.11 grants e assinatura de 4 args (as de 2 e 3 args não existem mais); upsert só com 9 args
--        (as de 6 e 8 args não existem mais, 20261111000001)
-- 104.12-104.18 legendas de TikTok e Geral (20261111000001), ver o bloco no fim

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
  perform accept_edit_suggestion(e.sug, null, array['texto','legenda'], array['legenda']);
  execute 'reset role';
  assert (select conteudo_plain from workflow_posts where id = e.post) = 'T1', 'texto aplicado';
  assert (select ig_caption from workflow_posts where id = e.post) = 'L-cliente', 'a legenda do cliente vence quando escolhida';
  assert (select status from post_edit_suggestions where id = e.sug) = 'accepted', 'accepted';
  raise notice 'PASS 104.4 escolher os dois campos aplica os dois';
end $$;
rollback;

-- 104.4b: a tela estava velha (nenhum conflito visto), mas o servidor vê o conflito da legenda
begin;
select et_grant_hosted_parity();
do $$
declare e record; v_raised int := 0;
begin
  select * into e from pg_temp.et_af_env(array['conteudo_plain','conteudo','ig_caption'], pg_temp.et_af_doc('T1'), 'T1', 'L-cliente');
  update workflow_posts set ig_caption = 'L-team' where id = e.post;
  perform pg_temp.et_af_as(e.usr);
  begin
    perform accept_edit_suggestion(e.sug, null, array['legenda'], '{}'::text[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'suggestion_conflict', format('wrong msg: %s', sqlerrm);
    v_raised := v_raised + 1;
  end;
  begin
    perform accept_edit_suggestion(e.sug, null, array['legenda'], null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'suggestion_conflict', format('wrong msg: %s', sqlerrm);
    v_raised := v_raised + 1;
  end;
  begin
    -- reconhecer outro campo não vale para a legenda
    perform accept_edit_suggestion(e.sug, null, array['texto','legenda'], array['texto']);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'suggestion_conflict', format('wrong msg: %s', sqlerrm);
    v_raised := v_raised + 1;
  end;
  execute 'reset role';
  assert v_raised = 3, 'sem reconhecer a legenda, o conflito do servidor levanta';
  assert (select conteudo_plain from workflow_posts where id = e.post) = 'T0', 'post intocado (texto)';
  assert (select ig_caption from workflow_posts where id = e.post) = 'L-team', 'post intocado (legenda)';
  assert (select status from post_edit_suggestions where id = e.sug) = 'pending', 'sugestão segue pendente';
  raise notice 'PASS 104.4b conflito do servidor com p_fields explícito';
end $$;
rollback;

-- 104.4c: o conflito é da legenda e o conjunto aplicado é só o texto
begin;
select et_grant_hosted_parity();
do $$
declare e record;
begin
  select * into e from pg_temp.et_af_env(array['conteudo_plain','conteudo','ig_caption'], pg_temp.et_af_doc('T1'), 'T1', 'L-cliente');
  update workflow_posts set ig_caption = 'L-team' where id = e.post;
  perform pg_temp.et_af_as(e.usr);
  perform accept_edit_suggestion(e.sug, null, array['texto'], '{}'::text[]);
  execute 'reset role';
  assert (select conteudo_plain from workflow_posts where id = e.post) = 'T1', 'texto aplicado';
  assert (select ig_caption from workflow_posts where id = e.post) = 'L-team', 'legenda da equipe mantida';
  assert (select status from post_edit_suggestions where id = e.sug) = 'accepted', 'accepted';
  raise notice 'PASS 104.4c conflito fora do conjunto aplicado não bloqueia';
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
  perform accept_edit_suggestion(e.sug, null, array['texto'], array['texto']);
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
  assert to_regprocedure('public.accept_edit_suggestion(bigint, timestamptz, text[])') is null,
    'a assinatura de 3 args tem que sumir (chamada com 3 args resolveria ambígua)';
  assert to_regprocedure('public.accept_edit_suggestion(bigint, timestamptz, text[], text[])') is not null,
    'a assinatura de 4 args existe';
  assert to_regprocedure('public.accept_edit_suggestion(bigint)') is null, 'a de 1 arg continua fora';
  assert has_function_privilege('anon', 'public.accept_edit_suggestion(bigint, timestamptz, text[], text[])', 'EXECUTE') = false,
    'anon não executa accept_edit_suggestion';
  assert has_function_privilege('authenticated', 'public.accept_edit_suggestion(bigint, timestamptz, text[], text[])', 'EXECUTE'),
    'authenticated executa (o CRM chama)';
  assert has_function_privilege('service_role', 'public.accept_edit_suggestion(bigint, timestamptz, text[], text[])', 'EXECUTE'),
    'service_role mantém execute';
  -- upsert (20261111000001): só a de 9 args, service_role-only
  assert to_regprocedure('public.upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text)') is null,
    'a assinatura de 6 args do upsert tem que sumir';
  assert to_regprocedure('public.upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text, text[], jsonb)') is null,
    'a assinatura de 8 args do upsert tem que sumir (chamada com 8 args resolveria ambígua)';
  assert to_regprocedure('public.upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text, text[], jsonb, jsonb)') is not null,
    'a assinatura de 9 args do upsert existe';
  assert has_function_privilege('anon', 'public.upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text, text[], jsonb, jsonb)', 'EXECUTE') = false,
    'anon não executa o upsert';
  assert has_function_privilege('authenticated', 'public.upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text, text[], jsonb, jsonb)', 'EXECUTE') = false,
    'authenticated não executa o upsert (só o hub-edit-suggestion, com service_role)';
  assert has_function_privilege('service_role', 'public.upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text, text[], jsonb, jsonb)', 'EXECUTE'),
    'service_role executa o upsert';
  raise notice 'PASS 104.11 grants e assinatura (accept e upsert)';
end $$;
rollback;

-- =====================================================================
-- Legendas de TikTok e Geral (migration 20261111000001, spec
-- docs/superpowers/specs/2026-10-30-hub-captions-per-platform-design.md "PR 2").
-- 104.12 legenda_tiktok aplicada; o resto do post intocado
-- 104.13 legenda_geral aplicada em post_targets
-- 104.14 conflito no TikTok e no Geral: sem reconhecimento levanta, com p_acknowledged aplica
-- 104.15 p_fields NULL (CRM antigo) com campo novo mudado: suggestion_conflict, nada muda
-- 104.16 target_gone: linha geral removida, recriada (id <> geral_target_id), linha tiktok removida
-- 104.17 target_locked: TikTok em processando/publicado; Geral segue aceitável
-- 104.18 campo novo fora de p_fields fica como está; os quatro juntos num aceite
-- =====================================================================

-- Destinos tiktok (status p_tt_status) e geral (legenda p_g) + tiktok_caption = p_tt no post.
-- Devolve o id da linha geral.
create or replace function pg_temp.et_af_targets(p_post bigint, p_tt text, p_g text, p_tt_status text default 'pendente')
returns bigint language plpgsql as $$
declare v_ws uuid; v_gid bigint;
begin
  select conta_id into v_ws from workflow_posts where id = p_post;
  update workflow_posts set tiktok_caption = p_tt where id = p_post;
  insert into post_targets (conta_id, post_id, platform) values (v_ws, p_post, 'tiktok')
    on conflict (post_id, platform) do nothing;
  update post_targets set status = p_tt_status where post_id = p_post and platform = 'tiktok';
  insert into post_targets (conta_id, post_id, platform, caption) values (v_ws, p_post, 'geral', p_g)
    on conflict (post_id, platform) do update set caption = excluded.caption
    returning id into v_gid;
  return v_gid;
end $$;

-- Sugestão com TikTok TT0 -> TT1 e Geral G0 -> G1 (bases = vivo de partida), mais o que
-- p_changed disser. geral_target_id = a linha geral viva.
create or replace function pg_temp.et_af_env_captions(
  p_changed text[], p_tt_status text default 'pendente',
  out ws uuid, out usr uuid, out post bigint, out sug bigint, out gid bigint)
language plpgsql as $$
declare e record;
begin
  select * into e from pg_temp.et_af_env(p_changed, pg_temp.et_af_doc('T1'), 'T1', 'L1');
  ws := e.ws; usr := e.usr; post := e.post; sug := e.sug;
  gid := pg_temp.et_af_targets(post, 'TT0', 'G0', p_tt_status);
  update post_edit_suggestions set
    original_tiktok_caption = 'TT0', suggested_tiktok_caption = 'TT1',
    original_geral_caption = 'G0', suggested_geral_caption = 'G1',
    geral_target_id = gid
  where id = sug;
end $$;

-- 104.12
begin;
select et_grant_hosted_parity();
do $$
declare e record;
begin
  select * into e from pg_temp.et_af_env_captions(array['tiktok_caption']);
  perform pg_temp.et_af_as(e.usr);
  perform accept_edit_suggestion(e.sug, null, array['legenda_tiktok']);
  execute 'reset role';
  assert (select tiktok_caption from workflow_posts where id = e.post) = 'TT1', 'legenda do TikTok aplicada';
  assert (select ig_caption from workflow_posts where id = e.post) = 'L0', 'legenda do Instagram intocada';
  assert (select conteudo_plain from workflow_posts where id = e.post) = 'T0', 'texto intocado';
  assert (select caption from post_targets where id = e.gid) = 'G0', 'Geral intocado';
  assert (select status from post_edit_suggestions where id = e.sug) = 'accepted', 'accepted';
  raise notice 'PASS 104.12 legenda_tiktok aplicada';
end $$;
rollback;

-- 104.13
begin;
select et_grant_hosted_parity();
do $$
declare e record;
begin
  select * into e from pg_temp.et_af_env_captions(array['geral_caption']);
  perform pg_temp.et_af_as(e.usr);
  perform accept_edit_suggestion(e.sug, null, array['legenda_geral']);
  execute 'reset role';
  assert (select caption from post_targets where id = e.gid) = 'G1', 'legenda Geral aplicada';
  assert (select tiktok_caption from workflow_posts where id = e.post) = 'TT0', 'TikTok intocado';
  assert (select ig_caption from workflow_posts where id = e.post) = 'L0', 'Instagram intocado';
  assert (select status from post_edit_suggestions where id = e.sug) = 'accepted', 'accepted';
  raise notice 'PASS 104.13 legenda_geral aplicada';
end $$;
rollback;

-- 104.14
begin;
select et_grant_hosted_parity();
do $$
declare e record; v_raised int := 0;
begin
  select * into e from pg_temp.et_af_env_captions(array['tiktok_caption','geral_caption']);
  update workflow_posts set tiktok_caption = 'TT-team' where id = e.post;
  update post_targets set caption = 'G-team' where id = e.gid;
  perform pg_temp.et_af_as(e.usr);
  begin
    perform accept_edit_suggestion(e.sug, null, array['legenda_tiktok'], '{}'::text[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'suggestion_conflict', format('wrong msg: %s', sqlerrm);
    v_raised := v_raised + 1;
  end;
  begin
    perform accept_edit_suggestion(e.sug, null, array['legenda_geral'], array['legenda_tiktok']);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'suggestion_conflict', format('wrong msg: %s', sqlerrm);
    v_raised := v_raised + 1;
  end;
  assert v_raised = 2, 'conflito sem reconhecimento levanta, por campo';
  assert (select tiktok_caption from workflow_posts where id = e.post) = 'TT-team', 'TikTok intocado';
  assert (select caption from post_targets where id = e.gid) = 'G-team', 'Geral intocado';
  perform accept_edit_suggestion(e.sug, null, array['legenda_tiktok','legenda_geral'],
                                 array['legenda_tiktok','legenda_geral']);
  execute 'reset role';
  assert (select tiktok_caption from workflow_posts where id = e.post) = 'TT1', 'o cliente vence no TikTok';
  assert (select caption from post_targets where id = e.gid) = 'G1', 'o cliente vence no Geral';
  raise notice 'PASS 104.14 conflito nas legendas novas';
end $$;
rollback;

-- 104.15
begin;
select et_grant_hosted_parity();
do $$
declare e record; v_raised int := 0;
begin
  -- sem conflito nenhum: só ter um campo novo mudado já recusa o CRM antigo
  select * into e from pg_temp.et_af_env_captions(array['conteudo_plain','geral_caption']);
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
  assert v_raised = 2, 'CRM antigo com Geral mudado levanta';
  update post_edit_suggestions set changed_fields = array['tiktok_caption'] where id = e.sug;
  perform pg_temp.et_af_as(e.usr);
  begin
    perform accept_edit_suggestion(e.sug);
    assert false, 'CRM antigo com TikTok mudado devia levantar';
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'suggestion_conflict', format('wrong msg: %s', sqlerrm);
  end;
  execute 'reset role';
  assert (select conteudo_plain from workflow_posts where id = e.post) = 'T0', 'texto intocado';
  assert (select tiktok_caption from workflow_posts where id = e.post) = 'TT0', 'TikTok intocado';
  assert (select caption from post_targets where id = e.gid) = 'G0', 'Geral intocado';
  assert (select status from post_edit_suggestions where id = e.sug) = 'pending', 'segue pendente';
  raise notice 'PASS 104.15 p_fields NULL com campo novo: suggestion_conflict';
end $$;
rollback;

-- 104.16
begin;
select et_grant_hosted_parity();
do $$
declare e record; v_msg text;
begin
  -- (a) linha geral removida
  select * into e from pg_temp.et_af_env_captions(array['conteudo_plain','geral_caption']);
  delete from post_targets where id = e.gid;
  perform pg_temp.et_af_as(e.usr);
  begin
    perform accept_edit_suggestion(e.sug, null, array['texto','legenda_geral']);
    assert false, 'Geral removido devia levantar';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text;
    assert v_msg = 'target_gone', format('esperava target_gone, veio %s', v_msg);
  end;
  execute 'reset role';
  assert (select conteudo_plain from workflow_posts where id = e.post) = 'T0', 'nada muda (texto)';
  -- (b) recriada: id diferente de geral_target_id
  insert into post_targets (conta_id, post_id, platform, caption) values (e.ws, e.post, 'geral', 'G0');
  perform pg_temp.et_af_as(e.usr);
  begin
    perform accept_edit_suggestion(e.sug, null, array['legenda_geral']);
    assert false, 'Geral recriado devia levantar';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text;
    assert v_msg = 'target_gone', format('esperava target_gone (recriado), veio %s', v_msg);
  end;
  -- só o texto ainda aceita: o Geral fora de p_fields não conta
  perform accept_edit_suggestion(e.sug, null, array['texto']);
  execute 'reset role';
  assert (select conteudo_plain from workflow_posts where id = e.post) = 'T1', 'texto aplicado';
  assert (select caption from post_targets where post_id = e.post and platform = 'geral') = 'G0', 'Geral novo intocado';
  raise notice 'PASS 104.16a/b target_gone no Geral';
end $$;
rollback;

begin;
select et_grant_hosted_parity();
do $$
declare e record; v_msg text;
begin
  -- (c) linha tiktok removida
  select * into e from pg_temp.et_af_env_captions(array['tiktok_caption']);
  delete from post_targets where post_id = e.post and platform = 'tiktok';
  perform pg_temp.et_af_as(e.usr);
  begin
    perform accept_edit_suggestion(e.sug, null, array['legenda_tiktok']);
    assert false, 'TikTok removido devia levantar';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text;
    assert v_msg = 'target_gone', format('esperava target_gone (tiktok), veio %s', v_msg);
  end;
  execute 'reset role';
  assert (select tiktok_caption from workflow_posts where id = e.post) = 'TT0', 'nada muda';
  assert (select status from post_edit_suggestions where id = e.sug) = 'pending', 'segue pendente';
  raise notice 'PASS 104.16c target_gone no TikTok';
end $$;
rollback;

-- 104.17
begin;
select et_grant_hosted_parity();
do $$
declare e record; v_msg text; v_st text;
begin
  foreach v_st in array array['processando', 'publicado'] loop
    select * into e from pg_temp.et_af_env_captions(array['tiktok_caption','geral_caption'], v_st);
    perform pg_temp.et_af_as(e.usr);
    begin
      perform accept_edit_suggestion(e.sug, null, array['legenda_tiktok','legenda_geral']);
      assert false, format('TikTok %s devia levantar', v_st);
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_msg = message_text;
      assert v_msg = 'target_locked', format('esperava target_locked (%s), veio %s', v_st, v_msg);
    end;
    execute 'reset role';
    assert (select tiktok_caption from workflow_posts where id = e.post) = 'TT0', 'TikTok intocado';
    assert (select caption from post_targets where id = e.gid) = 'G0', 'Geral intocado (nada muda)';
    -- sem o TikTok, o Geral segue aceitável
    perform pg_temp.et_af_as(e.usr);
    perform accept_edit_suggestion(e.sug, null, array['legenda_geral']);
    execute 'reset role';
    assert (select caption from post_targets where id = e.gid) = 'G1', 'Geral aplicado';
    assert (select tiktok_caption from workflow_posts where id = e.post) = 'TT0', 'TikTok publicado não muda';
  end loop;
  raise notice 'PASS 104.17 target_locked';
end $$;
rollback;

-- 104.18
begin;
select et_grant_hosted_parity();
do $$
declare e record;
begin
  -- (a) campo novo fora de p_fields fica como está
  select * into e from pg_temp.et_af_env_captions(array['ig_caption','tiktok_caption','geral_caption']);
  perform pg_temp.et_af_as(e.usr);
  perform accept_edit_suggestion(e.sug, null, array['legenda']);
  execute 'reset role';
  assert (select ig_caption from workflow_posts where id = e.post) = 'L1', 'legenda aplicada';
  assert (select tiktok_caption from workflow_posts where id = e.post) = 'TT0', 'TikTok fora de p_fields fica';
  assert (select caption from post_targets where id = e.gid) = 'G0', 'Geral fora de p_fields fica';
end $$;
rollback;

begin;
select et_grant_hosted_parity();
do $$
declare e record;
begin
  -- (b) os quatro campos num aceite só
  select * into e from pg_temp.et_af_env_captions(
    array['conteudo_plain','conteudo','ig_caption','tiktok_caption','geral_caption']);
  perform pg_temp.et_af_as(e.usr);
  perform accept_edit_suggestion(e.sug, null, array['texto','legenda','legenda_tiktok','legenda_geral']);
  execute 'reset role';
  assert (select conteudo_plain from workflow_posts where id = e.post) = 'T1', 'texto';
  assert (select ig_caption from workflow_posts where id = e.post) = 'L1', 'legenda';
  assert (select tiktok_caption from workflow_posts where id = e.post) = 'TT1', 'TikTok';
  assert (select caption from post_targets where id = e.gid) = 'G1', 'Geral';
  assert (select status from post_edit_suggestions where id = e.sug) = 'accepted', 'accepted';
  raise notice 'PASS 104.18 campos fora de p_fields ficam; os quatro juntos aplicam';
end $$;
rollback;
