\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- upsert_edit_suggestion com p_touched_fields / p_bases (migration 20261106000002,
-- spec docs/superpowers/specs/2026-10-29-edit-suggestion-no-auto-reject-design.md §1 e §2).
-- A RPC é service_role-only: os casos a chamam direto como postgres.
-- 103.1 sugestão nova, texto tocado: changed_fields mede contra a base enviada pelo Hub
-- 103.2 edição da equipe na legenda entre duas saves de texto não vira mudança do cliente
-- 103.3 campo tocado sem a CHAVE da base (texto: conteudo e conteudo_plain) levanta base_required;
--       chave com valor null vale, e JSON null sugerido == NULL SQL
-- 103.4 painel velho (legenda): a base antiga fica em original_*, o conflito aparece depois
-- 103.5a reverter o texto com a legenda ainda pendente: a linha fica, texto re-baseado no vivo
-- 103.5b reverter o único campo pendente apaga a linha
-- 103.6 save legado (NULL) mantém o corpo antigo: original_* é o primeiro snapshot
-- 103.7 mudança só de formatação (mesmo plain, jsonb diferente) é mudança de texto
-- 103.8 (segurança) o texto do cliente é ignorado quando só a legenda foi tocada
-- 103.9 post fora de enviado_cliente levanta post_not_pending
-- 103.10 _tiptap_inline_image_keys: ordenado, distinto, ignora imagens sem r2Key, NULL -> '{}'

create or replace function pg_temp.et_ub_env(out ws uuid, out post bigint)
language plpgsql as $$
declare v_usr uuid; v_cli bigint;
begin
  ws := et_make_workspace('pro');
  v_usr := gen_random_uuid();
  insert into auth.users (id) values (v_usr);
  insert into workspace_members (user_id, workspace_id, role) values (v_usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws where id = v_usr;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_usr, ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflow_posts (conta_id, cliente_id, status, conteudo, conteudo_plain, ig_caption)
    values (ws, v_cli, 'enviado_cliente',
            '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"T0"}]}]}'::jsonb,
            'T0', 'L0')
    returning id into post;
end $$;

create or replace function pg_temp.et_ub_doc(txt text) returns jsonb
language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
    jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
      jsonb_build_object('type', 'text', 'text', txt)))))
$$;

create or replace function pg_temp.et_ub_pending(p_post bigint) returns post_edit_suggestions
language sql as $$
  select * from post_edit_suggestions where post_id = p_post and status = 'pending'
$$;

-- 103.1
begin;
do $$
declare e record; r jsonb; s post_edit_suggestions;
begin
  select * into e from pg_temp.et_ub_env();
  r := upsert_edit_suggestion(e.post, e.ws, 'tok', pg_temp.et_ub_doc('T1'), 'T1', 'L0',
         array['texto'],
         jsonb_build_object('conteudo', pg_temp.et_ub_doc('T0'), 'conteudo_plain', 'T0', 'ig_caption', 'L0'));
  assert r->>'action' = 'upserted' and (r->>'is_new')::boolean, format('esperava insert: %s', r);
  s := pg_temp.et_ub_pending(e.post);
  assert s.changed_fields @> array['conteudo_plain'], format('conteudo_plain deve mudar: %s', s.changed_fields);
  assert not (s.changed_fields @> array['ig_caption']), format('ig_caption não mudou: %s', s.changed_fields);
  assert s.original_conteudo_plain = 'T0' and s.suggested_conteudo_plain = 'T1',
    format('original/suggested do texto: %s / %s', s.original_conteudo_plain, s.suggested_conteudo_plain);
  assert s.original_ig_caption = 'L0' and s.suggested_ig_caption = 'L0', 'legenda intocada vale o vivo';
  raise notice 'PASS 103.1 texto tocado mede contra a base';
end $$;
rollback;

-- 103.2 (o caso 11807)
begin;
do $$
declare e record; s post_edit_suggestions; r jsonb;
begin
  select * into e from pg_temp.et_ub_env();
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', pg_temp.et_ub_doc('T1'), 'T1', 'L0',
    array['texto'], jsonb_build_object('conteudo', pg_temp.et_ub_doc('T0'), 'conteudo_plain', 'T0'));
  update workflow_posts set ig_caption = 'L-team' where id = e.post;
  -- painel antigo reenvia a legenda velha, mas só tocou o texto
  r := upsert_edit_suggestion(e.post, e.ws, 'tok', pg_temp.et_ub_doc('T2'), 'T2', 'L0', array['texto'], null);
  assert not (r->>'is_new')::boolean, 'segunda save atualiza a mesma linha';
  s := pg_temp.et_ub_pending(e.post);
  assert not (s.changed_fields @> array['ig_caption']), format('legenda velha não é mudança: %s', s.changed_fields);
  assert s.suggested_ig_caption = 'L-team' and s.original_ig_caption = 'L-team',
    format('legenda deve seguir o vivo: %s / %s', s.original_ig_caption, s.suggested_ig_caption);
  assert s.suggested_conteudo_plain = 'T2' and s.original_conteudo_plain = 'T0', 'texto segue do cliente, base preservada';
  raise notice 'PASS 103.2 legenda da equipe não é revertida por save de texto';
end $$;
rollback;

-- 103.3
begin;
do $$
declare e record; s post_edit_suggestions; v_msg text;
begin
  select * into e from pg_temp.et_ub_env();
  -- sem base nenhuma
  begin
    perform upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T1', 'L0', array['texto'], null);
    assert false, 'texto tocado sem base devia levantar';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    assert v_msg = 'base_required', format('esperava base_required, veio %s', v_msg);
  end;
  -- legenda tocada com bases sem a chave ig_caption
  begin
    perform upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T0', 'L1', array['legenda'],
      jsonb_build_object('conteudo_plain', 'T0'));
    assert false, 'legenda tocada sem a chave da base devia levantar';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    assert v_msg = 'base_required', format('esperava base_required, veio %s', v_msg);
  end;
  -- texto tocado com a base só do plain (falta a chave conteudo)
  begin
    perform upsert_edit_suggestion(e.post, e.ws, 'tok', pg_temp.et_ub_doc('T1'), 'T1', 'L0', array['texto'],
      jsonb_build_object('conteudo_plain', 'T0'));
    assert false, 'texto tocado sem a chave conteudo da base devia levantar';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    assert v_msg = 'base_required', format('esperava base_required, veio %s', v_msg);
  end;
  assert not exists (select 1 from post_edit_suggestions where post_id = e.post), 'nada gravado';
  -- Story: conteudo NULL e legenda NULL no vivo; chave presente com null vale
  update workflow_posts set conteudo = null, conteudo_plain = null, ig_caption = null where id = e.post;
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T0', 'L1', array['legenda'],
    '{"ig_caption": null}'::jsonb);
  s := pg_temp.et_ub_pending(e.post);
  assert s.changed_fields = array['ig_caption'], format('só a legenda mudou: %s', s.changed_fields);
  assert s.original_ig_caption is null and s.suggested_ig_caption = 'L1', 'base null aceita';
  delete from post_edit_suggestions where post_id = e.post;
  -- texto tocado, base conteudo/plain null e conteudo sugerido JSON null: null e NULL são iguais
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', 'null'::jsonb, 'T-novo', 'L1', array['texto'],
    '{"conteudo": null, "conteudo_plain": null}'::jsonb);
  s := pg_temp.et_ub_pending(e.post);
  assert s.changed_fields = array['conteudo_plain'],
    format('JSON null vs NULL não muda conteudo: %s', s.changed_fields);
  assert s.suggested_conteudo is null and s.original_conteudo is null, 'conteudo guardado como NULL SQL';
  raise notice 'PASS 103.3 base_required pela presença da chave';
end $$;
rollback;

-- 103.4 (Review Focus 1)
begin;
do $$
declare e record; r post_edit_suggestions;
begin
  select * into e from pg_temp.et_ub_env();
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', pg_temp.et_ub_doc('T1'), 'T1', 'L0',
    array['texto'], jsonb_build_object('conteudo', pg_temp.et_ub_doc('T0'), 'conteudo_plain', 'T0'));
  update workflow_posts set ig_caption = 'L-team' where id = e.post;
  -- painel aberto antes da edição da equipe: base L0, cliente escreve L-cliente
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', pg_temp.et_ub_doc('T1'), 'T1', 'L-cliente',
    array['legenda'], jsonb_build_object('ig_caption', 'L0'));
  r := pg_temp.et_ub_pending(e.post);
  assert r.original_ig_caption = 'L0', format('original deve ser a base enviada, veio %s', r.original_ig_caption);
  assert r.changed_fields @> array['ig_caption'], 'legenda mudou';
  assert r.suggested_ig_caption = 'L-cliente', 'sugestão guardada';
  assert (select ig_caption from workflow_posts where id = e.post) = 'L-team', 'o post não foi tocado';
  raise notice 'PASS 103.4 base velha vira original, conflito fica visível';
end $$;
rollback;

-- 103.5a
begin;
do $$
declare e record; r jsonb; s post_edit_suggestions;
begin
  select * into e from pg_temp.et_ub_env();
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', pg_temp.et_ub_doc('T1'), 'T1', 'L1',
    array['texto','legenda'],
    jsonb_build_object('conteudo', pg_temp.et_ub_doc('T0'), 'conteudo_plain', 'T0', 'ig_caption', 'L0'));
  update workflow_posts set conteudo_plain = 'T-team', conteudo = pg_temp.et_ub_doc('T-team') where id = e.post;
  r := upsert_edit_suggestion(e.post, e.ws, 'tok', pg_temp.et_ub_doc('T0'), 'T0', 'L1', array['texto'], null);
  assert r->>'action' = 'upserted', format('a legenda ainda está pendente: %s', r);
  s := pg_temp.et_ub_pending(e.post);
  assert s.changed_fields = array['ig_caption'], format('só a legenda: %s', s.changed_fields);
  assert s.original_conteudo_plain = 'T-team' and s.suggested_conteudo_plain = 'T-team',
    format('texto re-baseado no vivo: %s / %s', s.original_conteudo_plain, s.suggested_conteudo_plain);
  assert s.original_conteudo = pg_temp.et_ub_doc('T-team') and s.suggested_conteudo = pg_temp.et_ub_doc('T-team'),
    'conteudo re-baseado no vivo';
  assert s.suggested_ig_caption = 'L1' and s.original_ig_caption = 'L0', 'legenda intocada';
  raise notice 'PASS 103.5a reverter o texto re-baseia só o texto';
end $$;
rollback;

-- 103.5b
begin;
do $$
declare e record; r jsonb;
begin
  select * into e from pg_temp.et_ub_env();
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', pg_temp.et_ub_doc('T1'), 'T1', 'L0',
    array['texto'], jsonb_build_object('conteudo', pg_temp.et_ub_doc('T0'), 'conteudo_plain', 'T0'));
  r := upsert_edit_suggestion(e.post, e.ws, 'tok', pg_temp.et_ub_doc('T0'), 'T0', 'L0', array['texto'], null);
  assert r->>'action' = 'deleted' and r->'suggestion' = 'null'::jsonb, format('esperava deleted: %s', r);
  assert not exists (select 1 from post_edit_suggestions where post_id = e.post and status = 'pending'),
    'sem linha pendente';
  raise notice 'PASS 103.5b reverter tudo apaga a linha';
end $$;
rollback;

-- 103.6 (Review Focus 4)
begin;
do $$
declare e record; s post_edit_suggestions;
begin
  select * into e from pg_temp.et_ub_env();
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', pg_temp.et_ub_doc('T1'), 'T1', 'L0',
    array['texto'], jsonb_build_object('conteudo', pg_temp.et_ub_doc('T0'), 'conteudo_plain', 'T0'));
  update workflow_posts set ig_caption = 'L-team' where id = e.post;
  -- aba antiga do Hub: snapshot completo, sem touched_fields
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', pg_temp.et_ub_doc('T1'), 'T1', 'L0');
  s := pg_temp.et_ub_pending(e.post);
  assert s.changed_fields @> array['ig_caption'], format('legado mede contra o vivo: %s', s.changed_fields);
  assert s.original_ig_caption = 'L0', format('original_* continua o primeiro snapshot, veio %s', s.original_ig_caption);
  assert s.suggested_ig_caption = 'L0', 'sugestão legada guardada como veio';
  raise notice 'PASS 103.6 save legado preserva original_* (conflito no accept)';
end $$;
rollback;

-- 103.7
begin;
do $$
declare e record; s post_edit_suggestions; r jsonb;
begin
  select * into e from pg_temp.et_ub_env();
  r := upsert_edit_suggestion(e.post, e.ws, 'tok',
    '{"content":[{"type":"paragraph","attrs":{"textAlign":"center"},"content":[{"type":"text","text":"T0"}]}],"type":"doc"}'::jsonb,
    'T0', 'L0', array['texto'],
    jsonb_build_object('conteudo', pg_temp.et_ub_doc('T0'), 'conteudo_plain', 'T0'));
  assert r->>'action' = 'upserted', format('formatação conta como sugestão: %s', r);
  s := pg_temp.et_ub_pending(e.post);
  assert s.changed_fields = array['conteudo'], format('só conteudo: %s', s.changed_fields);
  -- mesma árvore com chaves em outra ordem não é mudança (jsonb, não ::text)
  r := upsert_edit_suggestion(e.post, e.ws, 'tok',
    '{"content":[{"content":[{"text":"T0","type":"text"}],"type":"paragraph"}],"type":"doc"}'::jsonb,
    'T0', 'L0', array['texto'], null);
  assert r->>'action' = 'deleted', format('ordem de chaves não é mudança: %s', r);
  raise notice 'PASS 103.7 mudança só de formatação é mudança de texto';
end $$;
rollback;

-- 103.8 (segurança): o texto enviado pelo cliente é ignorado quando só a legenda foi tocada
begin;
do $$
declare e record; s post_edit_suggestions; evil jsonb; live_doc jsonb;
begin
  select * into e from pg_temp.et_ub_env();
  select conteudo into live_doc from workflow_posts where id = e.post;
  evil := jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
    jsonb_build_object('type', 'inlineImage', 'attrs', jsonb_build_object('r2Key', 'contas/outra/img.png'))));

  -- (a) linha nova, texto fora de changed_fields: vale o vivo
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', evil, 'EVIL', 'L1', array['legenda'],
    jsonb_build_object('ig_caption', 'L0'));
  s := pg_temp.et_ub_pending(e.post);
  assert s.suggested_conteudo = live_doc and s.suggested_conteudo_plain = 'T0',
    format('texto do cliente vazou: %s / %s', s.suggested_conteudo, s.suggested_conteudo_plain);
  assert s.original_conteudo = live_doc and s.original_conteudo_plain = 'T0', 'base do texto é o vivo';
  assert not (s.changed_fields && array['conteudo','conteudo_plain']), format('texto não mudou: %s', s.changed_fields);
  assert s.changed_fields = array['ig_caption'], format('só a legenda: %s', s.changed_fields);
  delete from post_edit_suggestions where post_id = e.post;

  -- (b) linha existente com texto pendente: vale o guardado
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', pg_temp.et_ub_doc('T1'), 'T1', 'L0', array['texto'],
    jsonb_build_object('conteudo', live_doc, 'conteudo_plain', 'T0'));
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', evil, 'EVIL', 'L1', array['legenda'],
    jsonb_build_object('ig_caption', 'L0'));
  s := pg_temp.et_ub_pending(e.post);
  assert s.suggested_conteudo = pg_temp.et_ub_doc('T1') and s.suggested_conteudo_plain = 'T1',
    format('texto guardado foi sobrescrito: %s / %s', s.suggested_conteudo, s.suggested_conteudo_plain);
  assert s.original_conteudo = live_doc and s.original_conteudo_plain = 'T0', 'base do texto preservada';
  assert s.changed_fields @> array['conteudo','conteudo_plain','ig_caption'], format('changed_fields: %s', s.changed_fields);
  delete from post_edit_suggestions where post_id = e.post;

  -- (c) linha existente só com legenda: o texto fica fora de changed_fields e vale o vivo
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T0', 'L1', array['legenda'],
    jsonb_build_object('ig_caption', 'L0'));
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', evil, 'EVIL', 'L2', array['legenda'], null);
  s := pg_temp.et_ub_pending(e.post);
  assert s.suggested_conteudo = live_doc and s.suggested_conteudo_plain = 'T0',
    'texto do cliente vazou na linha existente';
  assert not (s.changed_fields && array['conteudo','conteudo_plain']), format('texto não mudou: %s', s.changed_fields);
  assert s.suggested_ig_caption = 'L2', 'a legenda tocada foi guardada';
  raise notice 'PASS 103.8 texto do cliente é ignorado com só a legenda tocada';
end $$;
rollback;

-- 103.9
begin;
do $$
declare e record; v_msg text;
begin
  select * into e from pg_temp.et_ub_env();
  update workflow_posts set status = 'aprovado_cliente' where id = e.post;
  begin
    perform upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T1', 'L0', array['texto'],
      jsonb_build_object('conteudo_plain', 'T0'));
    assert false, 'devia levantar post_not_pending';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    assert v_msg = 'post_not_pending', format('esperava post_not_pending, veio %s', v_msg);
  end;
  raise notice 'PASS 103.9 post_not_pending continua valendo';
end $$;
rollback;

-- 103.10
begin;
do $$
begin
  assert _tiptap_inline_image_keys(null) = '{}'::text[], 'NULL -> vazio';
  assert _tiptap_inline_image_keys('{"type":"doc"}'::jsonb) = '{}'::text[], 'sem imagens -> vazio';
  assert _tiptap_inline_image_keys(jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
      jsonb_build_object('type', 'inlineImage', 'attrs', jsonb_build_object('r2Key', 'b', 'src', 'https://x')),
      jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
        jsonb_build_object('type', 'inlineImage', 'attrs', jsonb_build_object('r2Key', 'a')),
        jsonb_build_object('type', 'inlineImage', 'attrs', jsonb_build_object('r2Key', 'b')),
        jsonb_build_object('type', 'inlineImage', 'attrs', jsonb_build_object('src', 'sem-chave')),
        jsonb_build_object('type', 'text', 'text', 'x', 'attrs', jsonb_build_object('r2Key', 'ignorada')))))))
    = array['a','b'], 'ordenado, distinto, só inlineImage com r2Key';
  raise notice 'PASS 103.10 _tiptap_inline_image_keys';
end $$;
rollback;

-- =====================================================================
-- Legendas de TikTok e Geral (migration 20261112000001, spec
-- docs/superpowers/specs/2026-10-30-hub-captions-per-platform-design.md "PR 2").
-- 103.11 legenda_tiktok tocada mede contra a base; geral intocado vale o vivo; retorno traz os suggested_* novos
-- 103.12 legenda_geral tocada grava geral_target_id = id da linha geral
-- 103.13 base_required para tiktok_caption e geral_caption
-- 103.14 rebase: edição da equipe no TikTok com a legenda do TikTok fora da sugestão; reverter re-baseia no vivo
-- 103.15 target_gone: sem linha tiktok, sem linha geral, linha geral removida e recriada
-- 103.16 ramo legado: linha nova com legendas novas = vivo; preserva tiktok_caption/geral_caption;
--        não apaga a linha que só tem campos novos; changed_fields nunca vira NULL
-- 103.17 tiktok_followed_ig: gravado quando a legenda entra, mantido, limpo quando sai
-- =====================================================================

-- Post T0/L0 com destinos instagram + tiktok + geral: tiktok_caption = p_tt, geral = p_g.
create or replace function pg_temp.et_ub_targets(p_post bigint, p_tt text, p_g text)
returns bigint language plpgsql as $$
declare v_ws uuid; v_gid bigint;
begin
  select conta_id into v_ws from workflow_posts where id = p_post;
  update workflow_posts set tiktok_caption = p_tt where id = p_post;
  insert into post_targets (conta_id, post_id, platform) values (v_ws, p_post, 'tiktok')
    on conflict (post_id, platform) do nothing;
  insert into post_targets (conta_id, post_id, platform, caption) values (v_ws, p_post, 'geral', p_g)
    on conflict (post_id, platform) do update set caption = excluded.caption
    returning id into v_gid;
  return v_gid;
end $$;

-- 103.11
begin;
do $$
declare e record; r jsonb; s post_edit_suggestions;
begin
  select * into e from pg_temp.et_ub_env();
  perform pg_temp.et_ub_targets(e.post, 'TT0', 'G0');
  r := upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T0', 'L0',
         array['legenda_tiktok'], '{"tiktok_caption": "TT0"}'::jsonb,
         '{"tiktok_caption": "TT1"}'::jsonb);
  assert r->>'action' = 'upserted', format('esperava upserted: %s', r);
  assert r->'suggestion'->>'suggested_tiktok_caption' = 'TT1', format('retorno sem suggested_tiktok_caption: %s', r);
  assert r->'suggestion' ? 'suggested_geral_caption', format('retorno sem suggested_geral_caption: %s', r);
  s := pg_temp.et_ub_pending(e.post);
  assert s.changed_fields = array['tiktok_caption'], format('só tiktok_caption: %s', s.changed_fields);
  assert s.original_tiktok_caption = 'TT0' and s.suggested_tiktok_caption = 'TT1', 'base e sugestão do TikTok';
  assert s.original_geral_caption = 'G0' and s.suggested_geral_caption = 'G0', 'geral intocado vale o vivo';
  assert s.geral_target_id is null, 'geral fora de changed_fields: sem geral_target_id';
  assert s.original_ig_caption = 'L0' and s.suggested_ig_caption = 'L0', 'legenda intocada vale o vivo';
  assert (select tiktok_caption from workflow_posts where id = e.post) = 'TT0', 'o post não foi tocado';
  raise notice 'PASS 103.11 legenda_tiktok mede contra a base';
end $$;
rollback;

-- 103.12
begin;
do $$
declare e record; r jsonb; s post_edit_suggestions; v_gid bigint;
begin
  select * into e from pg_temp.et_ub_env();
  v_gid := pg_temp.et_ub_targets(e.post, null, 'G0');
  r := upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T0', 'L0',
         array['legenda_geral'], '{"geral_caption": "G0"}'::jsonb, '{"geral_caption": "G1"}'::jsonb);
  assert r->'suggestion'->>'suggested_geral_caption' = 'G1', format('retorno: %s', r);
  s := pg_temp.et_ub_pending(e.post);
  assert s.changed_fields = array['geral_caption'], format('só geral_caption: %s', s.changed_fields);
  assert s.original_geral_caption = 'G0' and s.suggested_geral_caption = 'G1', 'base e sugestão do Geral';
  assert s.geral_target_id = v_gid, format('geral_target_id %s, esperava %s', s.geral_target_id, v_gid);
  assert s.original_tiktok_caption is null and s.suggested_tiktok_caption is null, 'tiktok nulo intocado';
  -- segunda save do Geral: base guardada continua valendo, id mantido
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T0', 'L0',
    array['legenda_geral'], null, '{"geral_caption": "G2"}'::jsonb);
  s := pg_temp.et_ub_pending(e.post);
  assert s.original_geral_caption = 'G0' and s.suggested_geral_caption = 'G2' and s.geral_target_id = v_gid,
    'segunda save mantém base e id';
  -- save de outro campo não mexe no Geral pendente
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T0', 'L1',
    array['legenda'], '{"ig_caption": "L0"}'::jsonb, null);
  s := pg_temp.et_ub_pending(e.post);
  assert s.changed_fields = array['ig_caption','geral_caption'], format('changed_fields: %s', s.changed_fields);
  assert s.suggested_geral_caption = 'G2' and s.geral_target_id = v_gid, 'Geral pendente preservado';
  raise notice 'PASS 103.12 legenda_geral grava geral_target_id';
end $$;
rollback;

-- 103.13
begin;
do $$
declare e record; v_msg text;
begin
  select * into e from pg_temp.et_ub_env();
  perform pg_temp.et_ub_targets(e.post, 'TT0', 'G0');
  begin
    perform upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T0', 'L0',
      array['legenda_tiktok'], '{"ig_caption": "L0"}'::jsonb, '{"tiktok_caption": "TT1"}'::jsonb);
    assert false, 'tiktok tocado sem base devia levantar';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    assert v_msg = 'base_required', format('esperava base_required, veio %s', v_msg);
  end;
  begin
    perform upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T0', 'L0',
      array['legenda_geral'], null, '{"geral_caption": "G1"}'::jsonb);
    assert false, 'geral tocado sem base devia levantar';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    assert v_msg = 'base_required', format('esperava base_required, veio %s', v_msg);
  end;
  assert not exists (select 1 from post_edit_suggestions where post_id = e.post), 'nada gravado';
  -- base nula presente vale (TikTok sozinho com valor cru nulo): aceitar grava a coluna
  update workflow_posts set tiktok_caption = null where id = e.post;
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T0', 'L0',
    array['legenda_tiktok'], '{"tiktok_caption": null}'::jsonb, '{"tiktok_caption": "TT1"}'::jsonb);
  assert (pg_temp.et_ub_pending(e.post)).changed_fields = array['tiktok_caption'], 'base nula aceita';
  assert (pg_temp.et_ub_pending(e.post)).original_tiktok_caption is null, 'original nulo guardado';
  raise notice 'PASS 103.13 base_required nas legendas novas';
end $$;
rollback;

-- 103.14
begin;
do $$
declare e record; s post_edit_suggestions; r jsonb;
begin
  select * into e from pg_temp.et_ub_env();
  perform pg_temp.et_ub_targets(e.post, 'TT0', 'G0');
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', pg_temp.et_ub_doc('T1'), 'T1', 'L0',
    array['texto'], jsonb_build_object('conteudo', pg_temp.et_ub_doc('T0'), 'conteudo_plain', 'T0'));
  -- a equipe edita TikTok e Geral; o próximo save do texto acompanha o vivo
  update workflow_posts set tiktok_caption = 'TT-team' where id = e.post;
  update post_targets set caption = 'G-team' where post_id = e.post and platform = 'geral';
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', pg_temp.et_ub_doc('T2'), 'T2', 'L0', array['texto'], null);
  s := pg_temp.et_ub_pending(e.post);
  assert s.original_tiktok_caption = 'TT-team' and s.suggested_tiktok_caption = 'TT-team', 'tiktok re-baseado no vivo';
  assert s.original_geral_caption = 'G-team' and s.suggested_geral_caption = 'G-team', 'geral re-baseado no vivo';
  -- cliente muda o TikTok e depois volta para a base: o campo sai e re-baseia no vivo
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T2', 'L0',
    array['legenda_tiktok'], '{"tiktok_caption": "TT-team"}'::jsonb, '{"tiktok_caption": "TT-cliente"}'::jsonb);
  assert (pg_temp.et_ub_pending(e.post)).changed_fields @> array['tiktok_caption'], 'tiktok entrou';
  update workflow_posts set tiktok_caption = 'TT-team2' where id = e.post;
  r := upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T2', 'L0',
    array['legenda_tiktok'], null, '{"tiktok_caption": "TT-team"}'::jsonb);
  assert r->>'action' = 'upserted', 'o texto segue pendente';
  s := pg_temp.et_ub_pending(e.post);
  assert not (s.changed_fields @> array['tiktok_caption']), format('tiktok voltou à base: %s', s.changed_fields);
  assert s.original_tiktok_caption = 'TT-team2' and s.suggested_tiktok_caption = 'TT-team2',
    format('re-baseado no vivo: %s / %s', s.original_tiktok_caption, s.suggested_tiktok_caption);
  -- igualdade por COALESCE: '' e NULL são a mesma legenda
  update workflow_posts set tiktok_caption = null where id = e.post;
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T2', 'L0',
    array['legenda_tiktok'], '{"tiktok_caption": null}'::jsonb, '{"tiktok_caption": ""}'::jsonb);
  assert not ((pg_temp.et_ub_pending(e.post)).changed_fields @> array['tiktok_caption']), 'vazio == nulo';
  raise notice 'PASS 103.14 rebase das legendas novas';
end $$;
rollback;

-- 103.15
begin;
do $$
declare e record; v_msg text; v_gid bigint;
begin
  select * into e from pg_temp.et_ub_env();
  -- sem linha tiktok nem geral
  begin
    perform upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T0', 'L0',
      array['legenda_tiktok'], '{"tiktok_caption": null}'::jsonb, '{"tiktok_caption": "TT1"}'::jsonb);
    assert false, 'sem destino tiktok devia levantar';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    assert v_msg = 'target_gone', format('esperava target_gone (tiktok), veio %s', v_msg);
  end;
  begin
    perform upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T0', 'L0',
      array['legenda_geral'], '{"geral_caption": null}'::jsonb, '{"geral_caption": "G1"}'::jsonb);
    assert false, 'sem destino geral devia levantar';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    assert v_msg = 'target_gone', format('esperava target_gone (geral), veio %s', v_msg);
  end;
  assert not exists (select 1 from post_edit_suggestions where post_id = e.post), 'nada gravado';

  -- linha geral removida e recriada com a sugestão pendente: não herda
  v_gid := pg_temp.et_ub_targets(e.post, null, 'G0');
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T0', 'L0',
    array['legenda_geral'], '{"geral_caption": "G0"}'::jsonb, '{"geral_caption": "G1"}'::jsonb);
  delete from post_targets where id = v_gid;
  insert into post_targets (conta_id, post_id, platform, caption) values (e.ws, e.post, 'geral', 'G0');
  begin
    perform upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T0', 'L0',
      array['legenda_geral'], null, '{"geral_caption": "G2"}'::jsonb);
    assert false, 'linha geral recriada devia levantar';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    assert v_msg = 'target_gone', format('esperava target_gone (recriada), veio %s', v_msg);
  end;
  assert (pg_temp.et_ub_pending(e.post)).suggested_geral_caption = 'G1', 'a sugestão não mudou';
  raise notice 'PASS 103.15 target_gone';
end $$;
rollback;

-- 103.16
begin;
do $$
declare e record; s post_edit_suggestions; r jsonb;
begin
  -- (a) linha nova pelo ramo legado: legendas novas = vivo, fora de changed_fields
  select * into e from pg_temp.et_ub_env();
  perform pg_temp.et_ub_targets(e.post, 'TT0', 'G0');
  r := upsert_edit_suggestion(e.post, e.ws, 'tok', pg_temp.et_ub_doc('T1'), 'T1', 'L0');
  assert r->'suggestion' ? 'suggested_tiktok_caption' and r->'suggestion' ? 'suggested_geral_caption',
    format('retorno legado sem as chaves novas: %s', r);
  s := pg_temp.et_ub_pending(e.post);
  assert not (s.changed_fields && array['tiktok_caption','geral_caption']), format('legado: %s', s.changed_fields);
  assert s.original_tiktok_caption = 'TT0' and s.suggested_tiktok_caption = 'TT0', 'tiktok = vivo';
  assert s.original_geral_caption = 'G0' and s.suggested_geral_caption = 'G0', 'geral = vivo';
  assert s.geral_target_id is null and s.tiktok_followed_ig is null, 'legado não grava id nem followed';
  delete from post_edit_suggestions where post_id = e.post;

  -- (b) Hub novo sugeriu TikTok e Geral; aba antiga salva texto: as entradas novas ficam
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T0', 'L0',
    array['legenda_tiktok','legenda_geral'], '{"tiktok_caption": "TT0", "geral_caption": "G0"}'::jsonb,
    '{"tiktok_caption": "TT1", "geral_caption": "G1"}'::jsonb);
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', pg_temp.et_ub_doc('T1'), 'T1', 'L0');
  s := pg_temp.et_ub_pending(e.post);
  assert s.changed_fields @> array['conteudo_plain','tiktok_caption','geral_caption'],
    format('entradas novas preservadas: %s', s.changed_fields);
  assert s.suggested_tiktok_caption = 'TT1' and s.suggested_geral_caption = 'G1'
     and s.original_tiktok_caption = 'TT0' and s.original_geral_caption = 'G0', 'colunas novas intocadas';
  assert s.geral_target_id is not null, 'geral_target_id intocado';

  -- (c) aba antiga com texto e legenda iguais ao vivo: a linha NÃO é apagada
  r := upsert_edit_suggestion(e.post, e.ws, 'tok', pg_temp.et_ub_doc('T0'), 'T0', 'L0');
  assert r->>'action' = 'upserted', format('a linha com campos novos não pode sumir: %s', r);
  s := pg_temp.et_ub_pending(e.post);
  assert s.changed_fields @> array['tiktok_caption','geral_caption']
     and not (s.changed_fields && array['conteudo','conteudo_plain','ig_caption']),
    format('só os campos novos: %s', s.changed_fields);
  delete from post_edit_suggestions where post_id = e.post;

  -- (d) linha só com a legenda: legado não deixa changed_fields NULL
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T0', 'L1', array['legenda'], '{"ig_caption": "L0"}'::jsonb);
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', pg_temp.et_ub_doc('T0'), 'T0', 'L2');
  s := pg_temp.et_ub_pending(e.post);
  assert s.changed_fields is not null and s.changed_fields = array['ig_caption'],
    format('changed_fields: %s', s.changed_fields);
  -- (e) e sem nada mudado de fato, apaga como antes
  r := upsert_edit_suggestion(e.post, e.ws, 'tok', pg_temp.et_ub_doc('T0'), 'T0', 'L0');
  assert r->>'action' = 'deleted', format('legado sem mudança apaga: %s', r);
  raise notice 'PASS 103.16 ramo legado preserva os campos novos';
end $$;
rollback;

-- 103.17
begin;
do $$
declare e record; s post_edit_suggestions;
begin
  select * into e from pg_temp.et_ub_env();
  perform pg_temp.et_ub_targets(e.post, null, 'G0');
  -- legenda entra com o TikTok seguindo o Instagram
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T0', 'L1', array['legenda'], '{"ig_caption": "L0"}'::jsonb);
  assert (pg_temp.et_ub_pending(e.post)).tiktok_followed_ig is true, 'tiktok nulo: seguia o Instagram';
  -- a equipe dá legenda própria ao TikTok; o valor gravado não muda enquanto a legenda fica
  update workflow_posts set tiktok_caption = 'TT-proprio' where id = e.post;
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T0', 'L2', array['legenda'], null);
  assert (pg_temp.et_ub_pending(e.post)).tiktok_followed_ig is true, 'mantido enquanto a legenda fica';
  -- texto entra e a legenda sai: limpa
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', pg_temp.et_ub_doc('T1'), 'T1', 'L0',
    array['texto','legenda'], jsonb_build_object('conteudo', pg_temp.et_ub_doc('T0'), 'conteudo_plain', 'T0'));
  s := pg_temp.et_ub_pending(e.post);
  assert not (s.changed_fields @> array['ig_caption']), format('legenda saiu: %s', s.changed_fields);
  assert s.tiktok_followed_ig is null, 'limpo quando a legenda sai';
  -- legenda volta a entrar com o TikTok próprio: false
  perform upsert_edit_suggestion(e.post, e.ws, 'tok', null, 'T1', 'L3', array['legenda'], '{"ig_caption": "L0"}'::jsonb);
  assert (pg_temp.et_ub_pending(e.post)).tiktok_followed_ig is false, 'tiktok próprio: não seguia';
  raise notice 'PASS 103.17 tiktok_followed_ig';
end $$;
rollback;
