\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Linha editorial CRM RPCs (20261031000002_linha_editorial_rpcs.sql): criar (idempotent, seeds
-- the default columns), enviar / recolher (state machine), coluna_excluir (strips unconverted
-- values only) and the atomic converter (payload contract, same-client workflow, template
-- definitions, plan limits roll the whole batch back). Every RPC checks the flag first.
-- Per-row approval (20261031000005_linha_item_aprovacao.sql, spec §13): enviar brings rows
-- in ajustes back to pending and keeps approved ones; an agency edit, recolher and the
-- converter never touch a row's approval.

begin;
select et_grant_hosted_parity(array['linhas_editoriais','linha_editorial_colunas','linha_editorial_itens','linha_editorial_respostas']);

-- 'SQLSTATE:message' of the error p_sql raises as p_user (authenticated), or NULL on success
create or replace function pg_temp.erro(p_user uuid, p_sql text) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  return null;
exception when others then
  execute 'reset role';
  return sqlstate || ':' || sqlerrm;
end $f$;
-- first column of p_sql's first row, as text, run as p_user (authenticated); errors propagate
create or replace function pg_temp.val(p_user uuid, p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $f$;
create or replace function pg_temp.usuario(p_ws uuid) returns uuid language plpgsql as $f$
declare v_u uuid := gen_random_uuid();
begin
  insert into auth.users (id) values (v_u);
  insert into workspace_members (user_id, workspace_id, role) values (v_u, p_ws, 'owner');
  update profiles set conta_id = p_ws, active_workspace_id = p_ws where id = v_u;
  return v_u;
end $f$;
-- an item on p_linha, as the owner role
create or replace function pg_temp.item(p_linha uuid, p_data date, p_tipo text, p_titulo text, p_ordem int,
                                        p_valores jsonb default '{}') returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.linha_editorial_itens (linha_id, conta_id, data, tipo, titulo, ordem, valores)
    select p_linha, l.conta_id, p_data, p_tipo, p_titulo, p_ordem, p_valores from public.linhas_editoriais l where l.id = p_linha
    returning id into v;
  return v;
end $f$;
grant execute on all functions in schema pg_temp to authenticated;

do $$
declare
  v_a uuid; v_b uuid; u_a uuid; u_b uuid;
  v_c1 bigint; v_c2 bigint; v_cb bigint;
  v_tpl bigint; v_tpl_outro bigint; v_def bigint; v_def_outro bigint;
  v_wf bigint; v_wf_c2 bigint; v_wf_b bigint; v_wf_lim bigint;
  v_l1 uuid; v_l1b uuid; v_l2 uuid; v_lb uuid; v_lx uuid; v_lr uuid;
  v_r1 uuid; v_r2 uuid; v_r3 uuid; v_r4 uuid;
  v_ia uuid; v_ib uuid; v_iw uuid; v_ix uuid; v_iy uuid; v_iz uuid; v_ie uuid; v_if uuid; v_ig uuid; v_ih uuid;
  v_col uuid; v_res jsonb; v_e text; v_post bigint; v_post2 bigint;
  v_conv constant text := 'select public.linha_editorial_converter(%L, %s, %L::jsonb)';
begin
  -- ---------- fixture ----------
  v_a := et_make_workspace('max');
  v_b := et_make_workspace('max');
  insert into workspace_plan_overrides (workspace_id, feature_overrides) values (v_a, '{"feature_linha_editorial": true}');
  insert into workspace_plan_overrides (workspace_id, feature_overrides) values (v_b, '{"feature_linha_editorial": true}');
  u_a := pg_temp.usuario(v_a);
  u_b := pg_temp.usuario(v_b);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (u_a, v_a, 'Cli 1', 'C1', '#000') returning id into v_c1;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (u_a, v_a, 'Cli 2', 'C2', '#000') returning id into v_c2;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (u_b, v_b, 'Cli B', 'CB', '#000') returning id into v_cb;
  insert into workflow_templates (conta_id, user_id, nome, etapas) values (v_a, u_a, 'T', '[]'::jsonb) returning id into v_tpl;
  insert into workflow_templates (conta_id, user_id, nome, etapas) values (v_a, u_a, 'Outro', '[]'::jsonb) returning id into v_tpl_outro;
  insert into template_property_definitions (template_id, conta_id, name, type) values (v_tpl, v_a, 'Pilar', 'text') returning id into v_def;
  insert into template_property_definitions (template_id, conta_id, name, type) values (v_tpl_outro, v_a, 'Pilar', 'text') returning id into v_def_outro;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, template_id) values (u_a, v_a, v_c1, 'WF', 'ativo', v_tpl) returning id into v_wf;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (u_a, v_a, v_c2, 'WF c2', 'ativo') returning id into v_wf_c2;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (u_b, v_b, v_cb, 'WF B', 'ativo') returning id into v_wf_b;

  -- ---------- criar_idempotent_and_seeds_3_columns ----------
  v_l1 := pg_temp.val(u_a, format('select public.linha_editorial_criar(%s, ''2026-11-01'')', v_c1))::uuid;
  v_l1b := pg_temp.val(u_a, format('select public.linha_editorial_criar(%s, ''2026-11-01'')', v_c1))::uuid;
  assert v_l1 is not null and v_l1 = v_l1b, 'criar is idempotent per client and month';
  assert (select status = 'rascunho' and rodada = 0 and created_by = u_a and conta_id = v_a and cliente_id = v_c1
            from linhas_editoriais where id = v_l1), 'new linha is a rascunho of the caller';
  assert (select count(*) from linha_editorial_colunas where conta_id = v_a) = 3, 'three default columns seeded';
  assert (select array_agg(nome || ':' || tipo order by ordem) from linha_editorial_colunas where conta_id = v_a)
           = array['Pilar:select', 'CTA:select', 'Referência:url'], 'seeded Pilar, CTA, Referência in order';
  assert (select array_agg(o->>'label' order by ord)
            from linha_editorial_colunas c, jsonb_array_elements(c.config->'options') with ordinality as x(o, ord)
           where c.conta_id = v_a and c.nome = 'Pilar') = array['Educação', 'Autoridade', 'Bastidores', 'Conexão'],
    'Pilar options';
  assert (select array_agg(o->>'label' order by ord)
            from linha_editorial_colunas c, jsonb_array_elements(c.config->'options') with ordinality as x(o, ord)
           where c.conta_id = v_a and c.nome = 'CTA') = array['Salvar', 'Comentar', 'Compartilhar', 'Seguir'],
    'CTA options';
  assert not exists (select 1 from linha_editorial_colunas c, jsonb_array_elements(c.config->'options') o
                      where c.conta_id = v_a and (o->>'id' is null or o->>'color' is null)),
    'every option has an id and a color';
  v_l2 := pg_temp.val(u_a, format('select public.linha_editorial_criar(%s, ''2026-12-01'')', v_c1))::uuid;
  assert v_l2 <> v_l1, 'another month is another linha';
  assert (select count(*) from linha_editorial_colunas where conta_id = v_a) = 3, 'no reseed while columns exist';
  -- a conta that already has a column of its own is not seeded
  insert into linha_editorial_colunas (conta_id, nome, tipo, ordem) values (v_b, 'Própria', 'text', 0);
  v_lb := pg_temp.val(u_b, format('select public.linha_editorial_criar(%s, ''2026-11-01'')', v_cb))::uuid;
  assert (select count(*) from linha_editorial_colunas where conta_id = v_b) = 1, 'existing columns are not reseeded';
  v_e := pg_temp.erro(u_a, format('select public.linha_editorial_criar(%s, ''2026-11-15'')', v_c1));
  assert v_e is null and (select count(*) from linhas_editoriais where cliente_id = v_c1 and periodo = '2026-11-01') = 1,
    'a mid-month periodo resolves to the month: ' || coalesce(v_e, '');
  raise notice 'PASS criar_idempotent_and_seeds_3_columns';

  -- ---------- enviar_empty_raises ----------
  v_e := pg_temp.erro(u_a, format('select public.linha_editorial_enviar(%L)', v_l1));
  assert v_e = 'P0001:linha_vazia', 'enviar of an empty linha: ' || coalesce(v_e, 'null');
  raise notice 'PASS enviar_empty_raises';

  -- ---------- enviar_increments_rodada ----------
  v_ia := pg_temp.item(v_l1, '2026-11-03', 'reels', 'Reels A', 0);
  v_e := pg_temp.erro(u_a, format('select public.linha_editorial_enviar(%L)', v_l1));
  assert v_e is null, 'enviar: ' || coalesce(v_e, '');
  assert (select status = 'enviada' and rodada = 1 and enviada_por = u_a and enviada_at is not null
            from linhas_editoriais where id = v_l1), 'enviar sets enviada, rodada 1 and the sender';
  v_e := pg_temp.erro(u_a, format('select public.linha_editorial_enviar(%L)', v_l1));
  assert v_e = 'P0001:status_invalido', 'enviar from enviada refused: ' || coalesce(v_e, 'null');
  update linhas_editoriais set status = 'aprovada' where id = v_l1;
  v_e := pg_temp.erro(u_a, format('select public.linha_editorial_enviar(%L)', v_l1));
  assert v_e is null and (select status = 'enviada' and rodada = 2 from linhas_editoriais where id = v_l1),
    'enviar de novo from aprovada: ' || coalesce(v_e, '');
  update linhas_editoriais set status = 'ajustes' where id = v_l1;
  v_e := pg_temp.erro(u_a, format('select public.linha_editorial_enviar(%L)', v_l1));
  assert v_e is null and (select status = 'enviada' and rodada = 3 from linhas_editoriais where id = v_l1),
    'enviar from ajustes: ' || coalesce(v_e, '');
  raise notice 'PASS enviar_increments_rodada';

  -- ---------- recolher_only_from_enviada ----------
  v_e := pg_temp.erro(u_a, format('select public.linha_editorial_recolher(%L)', v_l1));
  assert v_e is null and (select status = 'rascunho' and rodada = 3 from linhas_editoriais where id = v_l1),
    'recolher from enviada: ' || coalesce(v_e, '');
  v_e := pg_temp.erro(u_a, format('select public.linha_editorial_recolher(%L)', v_l1));
  assert v_e = 'P0001:status_invalido', 'recolher from rascunho refused: ' || coalesce(v_e, 'null');
  update linhas_editoriais set status = 'aprovada' where id = v_l1;
  v_e := pg_temp.erro(u_a, format('select public.linha_editorial_recolher(%L)', v_l1));
  assert v_e = 'P0001:status_invalido', 'recolher from aprovada refused: ' || coalesce(v_e, 'null');
  update linhas_editoriais set status = 'rascunho' where id = v_l1;
  raise notice 'PASS recolher_only_from_enviada';

  -- ---------- enviar_resets_ajustes_keeps_aprovados ----------
  v_lr := pg_temp.val(u_a, format('select public.linha_editorial_criar(%s, ''2027-02-01'')', v_c1))::uuid;
  v_r1 := pg_temp.item(v_lr, '2027-02-03', 'feed', 'Aprovado', 0);
  v_r2 := pg_temp.item(v_lr, '2027-02-04', 'reels', 'Ajuste', 1);
  v_r3 := pg_temp.item(v_lr, '2027-02-05', 'stories', 'Pendente', 2);
  v_e := pg_temp.erro(u_a, format('select public.linha_editorial_enviar(%L)', v_lr));
  assert v_e is null, 'enviar: ' || coalesce(v_e, '');
  assert not exists (select 1 from linha_editorial_itens where linha_id = v_lr and (aprovacao is not null or aprovacao_at is not null)),
    'rows start pending';
  -- the client's row decisions (record_linha_item_decision is covered in 99_linha_editorial_hub)
  update linha_editorial_itens set aprovacao = 'aprovado', aprovacao_at = '2026-01-01 00:00+00' where id = v_r1;
  update linha_editorial_itens set aprovacao = 'ajustes', aprovacao_at = '2026-01-02 00:00+00' where id = v_r2;
  -- an agency edit keeps the approval
  v_e := pg_temp.erro(u_a, format('update public.linha_editorial_itens set titulo = ''Editado'', direcao = ''Nova'', data = ''2027-02-06'', valores = ''{"x": 1}'' where id = %L', v_r1));
  assert v_e is null and (select aprovacao = 'aprovado' and aprovacao_at = '2026-01-01 00:00+00' and titulo = 'Editado'
                            from linha_editorial_itens where id = v_r1),
    'editing an approved row keeps its approval: ' || coalesce(v_e, '');
  -- recolher leaves the decisions alone
  v_e := pg_temp.erro(u_a, format('select public.linha_editorial_recolher(%L)', v_lr));
  assert v_e is null, 'recolher: ' || coalesce(v_e, '');
  assert (select aprovacao = 'aprovado' from linha_editorial_itens where id = v_r1)
     and (select aprovacao = 'ajustes' from linha_editorial_itens where id = v_r2), 'recolher keeps the row decisions';
  -- enviar de novo: ajustes back to pending, approvals carried over, a row added since is pending
  v_r4 := pg_temp.item(v_lr, '2027-02-07', 'feed', 'Nova', 3);
  v_e := pg_temp.erro(u_a, format('select public.linha_editorial_enviar(%L)', v_lr));
  assert v_e is null and (select status = 'enviada' and rodada = 2 from linhas_editoriais where id = v_lr),
    'enviar de novo: ' || coalesce(v_e, '');
  assert (select aprovacao = 'aprovado' and aprovacao_at = '2026-01-01 00:00+00' from linha_editorial_itens where id = v_r1),
    'an approved row stays approved';
  assert (select aprovacao is null and aprovacao_at is null from linha_editorial_itens where id = v_r2),
    'a row in ajustes comes back as pending';
  assert (select count(*) from linha_editorial_itens where id in (v_r3, v_r4) and aprovacao is null and aprovacao_at is null) = 2,
    'pending and new rows stay pending';
  -- from ajustes and from aprovada too
  update linha_editorial_itens set aprovacao = 'ajustes', aprovacao_at = now() where id = v_r3;
  update linhas_editoriais set status = 'ajustes' where id = v_lr;
  v_e := pg_temp.erro(u_a, format('select public.linha_editorial_enviar(%L)', v_lr));
  assert v_e is null and (select aprovacao is null from linha_editorial_itens where id = v_r3),
    'enviar from ajustes resets the row: ' || coalesce(v_e, '');
  update linha_editorial_itens set aprovacao = 'ajustes', aprovacao_at = now() where id = v_r3;
  update linhas_editoriais set status = 'aprovada' where id = v_lr;
  v_e := pg_temp.erro(u_a, format('select public.linha_editorial_enviar(%L)', v_lr));
  assert v_e is null and (select aprovacao is null from linha_editorial_itens where id = v_r3),
    'enviar from aprovada resets the row: ' || coalesce(v_e, '');
  -- the converter keeps the approval
  v_res := pg_temp.val(u_a, format(v_conv, v_lr, 'null', jsonb_build_array(jsonb_build_object('item_id', v_r1))))::jsonb;
  assert (select post_id is not null and aprovacao = 'aprovado' and aprovacao_at = '2026-01-01 00:00+00'
            from linha_editorial_itens where id = v_r1), 'converting a row keeps its approval';
  raise notice 'PASS enviar_resets_ajustes_keeps_aprovados';

  -- ---------- converter_avulso_creates_rascunho_posts ----------
  v_ib := pg_temp.item(v_l1, null, 'feed', 'Feed sem data', 1);
  v_res := pg_temp.val(u_a, format(v_conv, v_l1, 'null', jsonb_build_array(
    jsonb_build_object('item_id', v_ia, 'conteudo', '{"type":"doc","content":[]}'::jsonb, 'conteudo_plain', 'plano A',
                       'property_values', '[]'::jsonb, 'titulo', 'ignorado', 'tipo', 'stories', 'scheduled_at', '2030-01-01'),
    jsonb_build_object('item_id', v_ib, 'conteudo', null, 'conteudo_plain', 'plano B'))))::jsonb;
  assert jsonb_typeof(v_res) = 'array' and jsonb_array_length(v_res) = 2, 'converter returns one entry per item: ' || v_res;
  select (e->>'post_id')::bigint into v_post from jsonb_array_elements(v_res) e where (e->>'item_id')::uuid = v_ia;
  assert (select workflow_id is null and cliente_id = v_c1 and conta_id = v_a and status = 'rascunho'
                 and created_via = 'linha_editorial' and titulo = 'Reels A' and tipo = 'reels' and ordem = 0
                 and board_ordem is null and scheduled_at = '2026-11-03 13:00:00+00'::timestamptz
                 and platform is not null and conteudo_plain = 'plano A' and conteudo->>'type' = 'doc'
            from workflow_posts where id = v_post), 'avulso post built from the item, payload titulo/tipo/schedule ignored';
  assert (select p.scheduled_at is null and p.titulo = 'Feed sem data' and p.conteudo is null and p.created_via = 'linha_editorial'
            from workflow_posts p join linha_editorial_itens i on i.post_id = p.id where i.id = v_ib),
    'an undated item gives an unscheduled post';
  assert (select post_id = v_post and convertido_por = u_a and convertido_at is not null
            from linha_editorial_itens where id = v_ia), 'item points at its post';
  raise notice 'PASS converter_avulso_creates_rascunho_posts';

  -- ---------- converter_twice_raises_ja_convertido ----------
  v_e := pg_temp.erro(u_a, format(v_conv, v_l1, 'null', jsonb_build_array(jsonb_build_object('item_id', v_ia))));
  assert v_e = 'P0001:ja_convertido', 'converting a converted item: ' || coalesce(v_e, 'null');
  raise notice 'PASS converter_twice_raises_ja_convertido';

  -- ---------- converter_fluxo_sets_ordem_by_date ----------
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem, status) values (v_wf, v_a, 'Já no fluxo', 4, 'rascunho');
  v_lx := pg_temp.val(u_a, format('select public.linha_editorial_criar(%s, ''2027-01-01'')', v_c1))::uuid;
  v_ix := pg_temp.item(v_lx, '2027-01-20', 'feed', 'X', 0);
  v_iy := pg_temp.item(v_lx, '2027-01-05', 'carrossel', 'Y', 1);
  v_iz := pg_temp.item(v_lx, null, 'stories', 'Z', 2);
  v_iw := pg_temp.item(v_lx, '2027-01-05', 'reels', 'W', 0);
  v_res := pg_temp.val(u_a, format(v_conv, v_lx, v_wf, jsonb_build_array(
    jsonb_build_object('item_id', v_iz),
    jsonb_build_object('item_id', v_ix, 'property_values',
                       jsonb_build_array(jsonb_build_object('property_definition_id', v_def, 'value', to_jsonb('Educação'::text)))),
    jsonb_build_object('item_id', v_iy),
    jsonb_build_object('item_id', v_iw))))::jsonb;
  assert (select array_agg(i.titulo || '=' || p.ordem order by p.ordem)
            from linha_editorial_itens i join workflow_posts p on p.id = i.post_id where i.linha_id = v_lx)
         = array['W=5', 'Y=6', 'X=7', 'Z=8'], 'fluxo ordem follows date (nulls last), then row ordem, after the max';
  assert not exists (select 1 from linha_editorial_itens i join workflow_posts p on p.id = i.post_id
                      where i.linha_id = v_lx and (p.workflow_id <> v_wf or p.cliente_id <> v_c1 or p.created_via <> 'linha_editorial')),
    'fluxo posts belong to the workflow and its client';
  assert (select value from post_property_values pv join linha_editorial_itens i on i.post_id = pv.post_id
           where i.id = v_ix and pv.property_definition_id = v_def) = to_jsonb('Educação'::text),
    'template property value written';
  raise notice 'PASS converter_fluxo_sets_ordem_by_date';

  -- ---------- converter_duplicate_item_raises ----------
  v_ie := pg_temp.item(v_l1, '2026-11-10', 'feed', 'E', 2);
  v_e := pg_temp.erro(u_a, format(v_conv, v_l1, 'null', jsonb_build_array(
    jsonb_build_object('item_id', v_ie), jsonb_build_object('item_id', v_ie))));
  assert v_e = 'P0001:payload_invalido', 'duplicate item ids: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format(v_conv, v_l1, 'null', '[]'));
  assert v_e = 'P0001:payload_invalido', 'empty payload: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format(v_conv, v_l1, 'null', '[{"item_id": "nao-e-uuid"}]'));
  assert v_e = 'P0001:payload_invalido', 'malformed item id: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format(v_conv, v_l1, 'null', '{"item_id": "x"}'));
  assert v_e = 'P0001:payload_invalido', 'payload not an array: ' || coalesce(v_e, 'null');
  raise notice 'PASS converter_duplicate_item_raises';

  -- ---------- converter_other_linha_item_raises ----------
  v_if := pg_temp.item(v_l2, '2026-12-02', 'feed', 'F', 0);
  v_e := pg_temp.erro(u_a, format(v_conv, v_l1, 'null', jsonb_build_array(
    jsonb_build_object('item_id', v_ie), jsonb_build_object('item_id', v_if))));
  assert v_e = 'P0001:payload_invalido', 'an item of another linha: ' || coalesce(v_e, 'null');
  assert (select post_id is null from linha_editorial_itens where id = v_ie), 'nothing converted';
  raise notice 'PASS converter_other_linha_item_raises';

  -- ---------- converter_other_cliente_workflow_raises ----------
  v_e := pg_temp.erro(u_a, format(v_conv, v_l1, v_wf_c2, jsonb_build_array(jsonb_build_object('item_id', v_ie))));
  assert v_e = 'P0001:workflow_invalido', 'workflow of another client: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format(v_conv, v_l1, v_wf_b, jsonb_build_array(jsonb_build_object('item_id', v_ie))));
  assert v_e = 'P0001:workflow_invalido', 'workflow of another conta: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format(v_conv, v_l1, -1, jsonb_build_array(jsonb_build_object('item_id', v_ie))));
  assert v_e = 'P0001:workflow_invalido', 'missing workflow: ' || coalesce(v_e, 'null');
  raise notice 'PASS converter_other_cliente_workflow_raises';

  -- ---------- converter_foreign_definition_raises ----------
  v_e := pg_temp.erro(u_a, format(v_conv, v_l1, v_wf, jsonb_build_array(jsonb_build_object('item_id', v_ie, 'property_values',
    jsonb_build_array(jsonb_build_object('property_definition_id', v_def_outro, 'value', '"x"'::jsonb))))));
  assert v_e = 'P0001:propriedade_invalida', 'a definition of another template: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format(v_conv, v_l1, 'null', jsonb_build_array(jsonb_build_object('item_id', v_ie, 'property_values',
    jsonb_build_array(jsonb_build_object('property_definition_id', v_def, 'value', '"x"'::jsonb))))));
  assert v_e = 'P0001:propriedade_invalida', 'property values on an avulso post: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format(v_conv, v_l1, v_wf, jsonb_build_array(jsonb_build_object('item_id', v_ie, 'property_values',
    jsonb_build_array(jsonb_build_object('property_definition_id', v_def, 'value', '"x"'::jsonb),
                      jsonb_build_object('property_definition_id', v_def, 'value', '"y"'::jsonb))))));
  assert v_e = 'P0001:propriedade_invalida', 'the same definition twice: ' || coalesce(v_e, 'null');
  assert (select post_id is null from linha_editorial_itens where id = v_ie), 'nothing converted';
  raise notice 'PASS converter_foreign_definition_raises';

  -- ---------- converter_limit_rolls_back ----------
  update plans set max_posts_per_workflow = 1 where id = 'max';
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (u_a, v_a, v_c1, 'WF lim', 'ativo') returning id into v_wf_lim;
  v_ig := pg_temp.item(v_l1, '2026-11-11', 'feed', 'G', 3);
  v_e := pg_temp.erro(u_a, format(v_conv, v_l1, v_wf_lim, jsonb_build_array(
    jsonb_build_object('item_id', v_ie), jsonb_build_object('item_id', v_ig))));
  assert v_e like 'P0001:plan_limit_exceeded:max_posts_per_workflow%', 'limit trips mid-batch: ' || coalesce(v_e, 'null');
  assert (select count(*) from workflow_posts where workflow_id = v_wf_lim) = 0, 'no post survives the failed batch';
  assert not exists (select 1 from linha_editorial_itens where id in (v_ie, v_ig) and post_id is not null),
    'no item keeps a post_id';
  update plans set max_posts_per_workflow = null where id = 'max';
  raise notice 'PASS converter_limit_rolls_back';

  -- ---------- post_delete_releases_item ----------
  delete from workflow_posts where id = v_post;
  assert (select post_id is null and titulo = 'Reels A' and tipo = 'reels' from linha_editorial_itens where id = v_ia),
    'deleting the post releases the row with its values';
  update linha_editorial_itens set convertido_por = u_b, convertido_at = now() - interval '1 day' where id = v_ia;
  v_res := pg_temp.val(u_a, format(v_conv, v_l1, 'null', jsonb_build_array(jsonb_build_object('item_id', v_ia))))::jsonb;
  v_post2 := (v_res->0->>'post_id')::bigint;
  assert v_post2 is not null and v_post2 <> v_post, 'a released row converts again';
  assert (select post_id = v_post2 and convertido_por = u_a and convertido_at = now() from linha_editorial_itens where id = v_ia),
    'reconversion overwrites convertido_at and convertido_por';
  raise notice 'PASS post_delete_releases_item';

  -- ---------- coluna_excluir_keeps_converted_values ----------
  select id into v_col from linha_editorial_colunas where conta_id = v_a and nome = 'CTA';
  update linha_editorial_itens set valores = jsonb_build_object(v_col::text, 'salvar', 'outra', 1) where id = v_ie;
  v_ih := pg_temp.item(v_l1, '2026-11-12', 'feed', 'H', 4, jsonb_build_object(v_col::text, 'seguir'));
  v_res := pg_temp.val(u_a, format(v_conv, v_l1, 'null', jsonb_build_array(jsonb_build_object('item_id', v_ih))))::jsonb;
  v_e := pg_temp.erro(u_a, format('select public.linha_editorial_coluna_excluir(%L)', v_col));
  assert v_e is null, 'coluna_excluir: ' || coalesce(v_e, '');
  assert not exists (select 1 from linha_editorial_colunas where id = v_col), 'column deleted';
  assert (select valores = '{"outra": 1}'::jsonb from linha_editorial_itens where id = v_ie), 'key stripped from an unconverted item';
  assert (select valores ? v_col::text from linha_editorial_itens where id = v_ih), 'a converted item keeps the orphan key';
  v_e := pg_temp.erro(u_a, format('select public.linha_editorial_coluna_excluir(%L)', v_col));
  assert v_e = 'P0001:nao_encontrada', 'deleting a missing column: ' || coalesce(v_e, 'null');
  raise notice 'PASS coluna_excluir_keeps_converted_values';

  -- ---------- other_conta_cannot_call_any_rpc ----------
  select id into v_col from linha_editorial_colunas where conta_id = v_a and nome = 'Pilar';
  v_e := pg_temp.erro(u_b, format('select public.linha_editorial_criar(%s, ''2026-11-01'')', v_c1));
  assert v_e = 'P0001:nao_encontrada', 'criar for another conta''s client: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_b, format('select public.linha_editorial_enviar(%L)', v_l1));
  assert v_e = 'P0001:nao_encontrada', 'enviar another conta''s linha: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_b, format('select public.linha_editorial_recolher(%L)', v_l1));
  assert v_e = 'P0001:nao_encontrada', 'recolher another conta''s linha: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_b, format('select public.linha_editorial_coluna_excluir(%L)', v_col));
  assert v_e = 'P0001:nao_encontrada', 'coluna_excluir another conta''s column: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_b, format(v_conv, v_l1, 'null', jsonb_build_array(jsonb_build_object('item_id', v_ig))));
  assert v_e = 'P0001:nao_encontrada', 'converter another conta''s linha: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_b, format(v_conv, v_lb, v_wf, jsonb_build_array(jsonb_build_object('item_id', v_ig))));
  assert v_e is not null, 'converter with another conta''s workflow and item refused';
  assert exists (select 1 from linha_editorial_colunas where id = v_col)
     and (select status from linhas_editoriais where id = v_l1) = 'rascunho'
     and (select post_id is null from linha_editorial_itens where id = v_ig),
    'other conta changed nothing';
  raise notice 'PASS other_conta_cannot_call_any_rpc';

  -- ---------- rpc_refused_when_flag_off ----------
  delete from workspace_plan_overrides where workspace_id = v_a;
  v_e := pg_temp.erro(u_a, format('select public.linha_editorial_criar(%s, ''2027-05-01'')', v_c1));
  assert v_e = 'P0001:feature_disabled:feature_linha_editorial', 'flag off: criar: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format('select public.linha_editorial_enviar(%L)', v_l1));
  assert v_e = 'P0001:feature_disabled:feature_linha_editorial', 'flag off: enviar: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format('select public.linha_editorial_recolher(%L)', v_l1));
  assert v_e = 'P0001:feature_disabled:feature_linha_editorial', 'flag off: recolher: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format('select public.linha_editorial_coluna_excluir(%L)', v_col));
  assert v_e = 'P0001:feature_disabled:feature_linha_editorial', 'flag off: coluna_excluir: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format(v_conv, v_l1, 'null', jsonb_build_array(jsonb_build_object('item_id', v_ig))));
  assert v_e = 'P0001:feature_disabled:feature_linha_editorial', 'flag off: converter: ' || coalesce(v_e, 'null');
  -- the flag is checked before anything else: even an unknown linha answers feature_disabled
  v_e := pg_temp.erro(u_a, format('select public.linha_editorial_enviar(%L)', gen_random_uuid()));
  assert v_e = 'P0001:feature_disabled:feature_linha_editorial', 'flag off checked first: ' || coalesce(v_e, 'null');
  raise notice 'PASS rpc_refused_when_flag_off';

  -- ---------- grants ----------
  assert not has_function_privilege('anon', 'public.linha_editorial_criar(bigint, date)', 'EXECUTE'), 'anon cannot criar';
  assert not has_function_privilege('anon', 'public.linha_editorial_converter(uuid, bigint, jsonb)', 'EXECUTE'), 'anon cannot convert';
  assert has_function_privilege('authenticated', 'public.linha_editorial_converter(uuid, bigint, jsonb)', 'EXECUTE'), 'authenticated converts';
  assert has_function_privilege('authenticated', 'public.linha_editorial_coluna_excluir(uuid)', 'EXECUTE'), 'authenticated deletes columns';
  assert has_function_privilege('service_role', 'public.linha_editorial_enviar(uuid)', 'EXECUTE'), 'service_role keeps EXECUTE';
  assert exists (select 1 from pg_constraint where conname = 'workflow_posts_created_via_check' and convalidated
                   and pg_get_constraintdef(oid) like '%linha_editorial%'), 'created_via check widened and validated';
  raise notice 'PASS grants';
end $$;

rollback;
