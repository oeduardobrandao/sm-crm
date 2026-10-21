-- Valida supabase/migrations/20260923000002_clear_stale_template_responsavel.sql
-- Casos:
--   (a) DELETE de um membro referenciado numa etapa de template da mesma conta zera
--       só o responsavel_id daquela etapa; nome/prazo_dias/tipo_prazo/tipo preservados
--   (b) outra etapa do MESMO template, referenciando um membro que não foi removido,
--       fica intacta
--   (c) etapa sem responsavel_id (já null) não é tocada nem quebra o UPDATE
--   (d) isolamento: template de OUTRA conta, com uma etapa cujo responsavel_id coincide
--       numericamente com o membro removido, não é tocado (o id pertence a outro membro,
--       de outra conta)
--   (e) DELETE de um membro que nenhum template referencia é um no-op silencioso
--   (f) migrate_workflow_template continua rejeitando um template com responsavel_id que
--       nunca correspondeu a um membro real (invalid_responsavel) -- o trigger novo não
--       afrouxa essa guarda, só evita que ela dispare por lixo que a própria plataforma deixou
--   (g) fim-a-fim: depois do membro removido (via DELETE, disparando a limpeza), migrar um
--       fluxo para esse template não lança mais invalid_responsavel -- fecha o loop do bug
--       original (visto em prod: template "Posts (Estáticos e Carrosséis)", etapa "Design")
--   (h) etapas SEM CHECK na escrita permite um valor não-array (a coluna aceita qualquer
--       jsonb); um template assim na mesma conta não pode quebrar o DELETE de um membro
--       nem ficar alterado -- regressão apontada em review: um UPDATE com
--       jsonb_array_elements correlacionado bateria "cannot extract elements from an
--       object" e reverteria a remoção do próprio membro
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;
do $$
declare
  v_ws uuid; v_ws2 uuid;
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_cli bigint;
  v_membro_stays bigint; v_membro_goes bigint; v_membro_unused bigint; v_membro_other_ws bigint;
  v_tpl bigint; v_tpl_origin bigint; v_tpl_other_conta bigint; v_tpl_poison bigint; v_tpl_malformed bigint;
  v_wf bigint;
  v_etapas jsonb;
  v_new_etapas jsonb;
  v_blocked boolean;
begin
  v_ws  := et_make_workspace('max');
  v_ws2 := et_make_workspace('max');
  insert into auth.users (id) values (v_owner), (v_other);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner'), (v_other, v_ws2, 'owner');
  update profiles set conta_id = v_ws,  active_workspace_id = v_ws  where id = v_owner;
  update profiles set conta_id = v_ws2, active_workspace_id = v_ws2 where id = v_other;

  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (v_ws, v_owner, 'Cliente A', 'CA', '#000') returning id into v_cli;

  insert into membros (conta_id, user_id, nome) values (v_ws, v_owner, 'Fica') returning id into v_membro_stays;
  insert into membros (conta_id, user_id, nome) values (v_ws, v_owner, 'Sai') returning id into v_membro_goes;
  insert into membros (conta_id, user_id, nome) values (v_ws, v_owner, 'Nunca referenciado') returning id into v_membro_unused;
  insert into membros (conta_id, user_id, nome) values (v_ws2, v_other, 'Membro de outra conta') returning id into v_membro_other_ws;

  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'Template A',
      jsonb_build_array(
        jsonb_build_object('nome','Copy','prazo_dias',2,'tipo_prazo','uteis','responsavel_id',v_membro_goes,'tipo','padrao'),
        jsonb_build_object('nome','Design','prazo_dias',3,'tipo_prazo','uteis','responsavel_id',v_membro_stays,'tipo','padrao'),
        jsonb_build_object('nome','Aprovação','prazo_dias',2,'tipo_prazo','corridos','responsavel_id',null,'tipo','aprovacao_cliente')
      ), 'padrao')
    returning id into v_tpl;

  -- (d) fixture: uma etapa em OUTRA conta cujo responsavel_id numérico é igual ao de
  -- v_membro_goes só por coincidência (pertence a um membro real e distinto dessa
  -- outra conta) -- o DELETE de v_membro_goes não pode tocar aqui.
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws2, v_other, 'Template Outra Conta',
      jsonb_build_array(
        jsonb_build_object('nome','Etapa','prazo_dias',1,'tipo_prazo','uteis','responsavel_id',v_membro_other_ws,'tipo','padrao')
      ), 'padrao')
    returning id into v_tpl_other_conta;

  -- Template com lixo que NUNCA correspondeu a um membro real (não um "removido depois"
  -- -- um id que nunca existiu). Cobre o caso (f): o guard da RPC continua de pé.
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'Template Lixo Nunca Existiu',
      '[{"nome":"Etapa","prazo_dias":1,"tipo_prazo":"uteis","responsavel_id":999999999,"tipo":"padrao"}]'::jsonb,
      'padrao')
    returning id into v_tpl_poison;

  -- (h) etapas não é um array -- a coluna não tem CHECK, então isso é uma linha legal.
  -- Precisa estar na MESMA conta de v_membro_goes: é o DELETE desse membro (abaixo) que
  -- teria que lidar com esta linha ao varrer os templates da conta.
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'Template Malformado', '{"nome":"não é um array"}'::jsonb, 'padrao')
    returning id into v_tpl_malformed;

  -- Fluxo ativo parado num template "de origem" qualquer, para migrar para v_tpl no caso (g).
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'Template Origem',
      '[{"nome":"Solta","prazo_dias":1,"tipo_prazo":"corridos","tipo":"padrao"}]'::jsonb, 'padrao')
    returning id into v_tpl_origin;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'Fluxo Migra', v_tpl_origin, 'ativo', 0, false, 'padrao')
    returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, status, iniciado_em)
    values (v_wf, 0, 'Solta', 1, 'corridos', 'ativo', now());

  -- migrate_workflow_template lê get_my_conta_id() via auth.uid(); sem isso toda
  -- chamada cai em workspace_not_found antes mesmo de checar responsavel_id.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

  -- ---------------------------------------------------------------------
  -- (f) guard da RPC intacto: lixo que nunca existiu continua barrando a migração
  -- ---------------------------------------------------------------------
  v_blocked := false;
  begin
    perform migrate_workflow_template(v_wf, v_tpl_poison,
      '[{"nome":"Etapa","prazo_dias":1,"tipo_prazo":"uteis","responsavel_id":999999999,"tipo":"padrao"}]'::jsonb,
      0, 'padrao', v_tpl_origin, 0);
  exception when others then
    assert sqlerrm like '%invalid_responsavel%', format('esperava invalid_responsavel, veio: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'responsavel_id que nunca existiu deve continuar barrando a migração';

  -- ---------------------------------------------------------------------
  -- (a)-(e) DELETE do membro dispara a limpeza
  -- ---------------------------------------------------------------------
  delete from membros where id = v_membro_unused; -- (e) no-op, nada referencia esse id

  select etapas into v_etapas from workflow_templates where id = v_tpl_other_conta;
  -- (h) v_tpl_malformed já existe na mesma conta neste ponto: se o trigger chamasse
  -- jsonb_array_elements sem checar o tipo primeiro, este DELETE já falharia aqui.
  delete from membros where id = v_membro_goes; -- dispara trg_clear_stale_template_responsavel

  select etapas into v_etapas from workflow_templates where id = v_tpl_malformed;
  assert v_etapas = '{"nome":"não é um array"}'::jsonb,
    '(h) template com etapas malformado (objeto) não deve ser tocado pelo trigger';

  select etapas into v_etapas from workflow_templates where id = v_tpl;
  assert (v_etapas -> 0 ->> 'responsavel_id') is null,
    format('(a) etapa Copy deveria ter responsavel_id nulo após o DELETE, veio: %s', v_etapas -> 0 ->> 'responsavel_id');
  assert (v_etapas -> 0 ->> 'nome') = 'Copy', '(a) nome da etapa deve ser preservado';
  assert (v_etapas -> 0 ->> 'prazo_dias') = '2', '(a) prazo_dias da etapa deve ser preservado';
  assert (v_etapas -> 0 ->> 'tipo_prazo') = 'uteis', '(a) tipo_prazo da etapa deve ser preservado';

  assert (v_etapas -> 1 ->> 'responsavel_id') = v_membro_stays::text,
    '(b) etapa Design (membro não removido) deve permanecer intacta';

  assert (v_etapas -> 2 ->> 'responsavel_id') is null,
    '(c) etapa Aprovação (já sem responsavel_id) continua nula, sem erro';

  select etapas into v_etapas from workflow_templates where id = v_tpl_other_conta;
  assert (v_etapas -> 0 ->> 'responsavel_id') = v_membro_other_ws::text,
    '(d) template de outra conta não deve ser tocado pelo DELETE em v_ws';

  -- ---------------------------------------------------------------------
  -- (g) fim-a-fim: migrar o fluxo para o template já limpo não lança mais invalid_responsavel
  -- ---------------------------------------------------------------------
  select jsonb_agg(jsonb_build_object(
           'nome', x.e ->> 'nome',
           'prazo_dias', (x.e ->> 'prazo_dias')::int,
           'tipo_prazo', x.e ->> 'tipo_prazo',
           'tipo', coalesce(x.e ->> 'tipo', 'padrao'),
           'responsavel_id', nullif(x.e ->> 'responsavel_id', '')::bigint
         ) order by x.ord)
    into v_new_etapas
  from workflow_templates t
  cross join lateral jsonb_array_elements(t.etapas) with ordinality x(e, ord)
  where t.id = v_tpl;

  perform migrate_workflow_template(v_wf, v_tpl, v_new_etapas, 0, 'padrao', v_tpl_origin, 0);

  perform 1 from workflows where id = v_wf and template_id = v_tpl;
  assert found, '(g) migração deve ter sucesso e atualizar o template_id do fluxo';

  raise notice 'PASS clear_stale_template_responsavel';
end $$;
rollback;
