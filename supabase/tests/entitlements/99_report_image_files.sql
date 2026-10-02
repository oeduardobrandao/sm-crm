\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Bloco de imagem do relatório (migration 20261003000001, spec 2026-10-02).
-- (a) grants da tabela de vínculo; (b) validate_report_layout com imagem;
-- (c) sincronização de vínculos + reference_count; (d) isolamento por tenant;
-- (e) exclusão de arquivo em uso bloqueada; (f) exclusão de relatório libera;
-- (g) exclusão de workspace em cascata não trava.
begin;
select et_grant_hosted_parity(array['report_document_files']);
revoke all on public.report_documents from anon, authenticated;
grant select on public.report_documents to authenticated;
grant update (layout, title) on public.report_documents to authenticated;
do $$
declare
  v_user uuid := gen_random_uuid();
  v_ws_a uuid; v_ws_b uuid;
  v_cli_a bigint; v_cli_b bigint;
  v_doc uuid;
  f_png bigint; f_gif bigint; f_vid bigint; f_b bigint;
  v_n int; v_rc int; v_raised boolean;
  v_lay jsonb;
begin
  -- ---- (a) grants ----
  assert not has_table_privilege('anon', 'public.report_document_files', 'SELECT'),
    'anon nao pode ler report_document_files';
  assert has_table_privilege('authenticated', 'public.report_document_files', 'SELECT'),
    'authenticated precisa ler report_document_files';
  assert not has_table_privilege('authenticated', 'public.report_document_files', 'INSERT'),
    'authenticated nao pode inserir em report_document_files';
  assert not has_table_privilege('authenticated', 'public.report_document_files', 'DELETE'),
    'authenticated nao pode apagar de report_document_files';

  -- ---- fixtures ----
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_ws_a := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws_a, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws_a, 'Cliente A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws_b, 'Cliente B', 'B', '#000') returning id into v_cli_b;

  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes, width, height)
    values (v_ws_a, 'contas/'||v_ws_a||'/files/a.png', 'a.png', 'image', 'image/png', 100, 10, 10)
    returning id into f_png;
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (v_ws_a, 'contas/'||v_ws_a||'/files/a.gif', 'a.gif', 'image', 'image/gif', 100)
    returning id into f_gif;
  insert into files (conta_id, r2_key, thumbnail_r2_key, name, kind, mime_type, size_bytes)
    values (v_ws_a, 'contas/'||v_ws_a||'/files/v.mp4', 'contas/'||v_ws_a||'/files/v.jpg',
            'v.mp4', 'video', 'video/mp4', 100)
    returning id into f_vid;
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (v_ws_b, 'contas/'||v_ws_b||'/files/b.png', 'b.png', 'image', 'image/png', 100)
    returning id into f_b;

  -- ---- (b) validate_report_layout ----
  v_raised := false;
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
    values (v_ws_a, v_cli_a, '2026-09-01', '2026-09-30',
      '{"version":1,"blocks":[{"id":"i","type":"image","size":"full","config":{"src":"https://x"}}]}');
  exception when others then
    if sqlerrm like '%INVALID_LAYOUT%' then v_raised := true; else raise; end if;
  end;
  assert v_raised, 'src no config deveria ser rejeitado';

  v_raised := false;
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
    values (v_ws_a, v_cli_a, '2026-09-01', '2026-09-30',
      '{"version":1,"blocks":[{"id":"i","type":"image","size":"full","config":{"ratio":"5:4"}}]}');
  exception when others then
    if sqlerrm like '%INVALID_LAYOUT%' then v_raised := true; else raise; end if;
  end;
  assert v_raised, 'ratio fora do enum deveria ser rejeitado';

  v_raised := false;
  begin
    insert into report_templates (conta_id, name, layout)
    values (v_ws_a, 'T', jsonb_build_object('version', 1, 'blocks', jsonb_build_array(
      jsonb_build_object('id','i','type','image','size','full','config',
        jsonb_build_object('file_id', f_png, 'width', 10, 'height', 10)))));
  exception when others then
    if sqlerrm like '%INVALID_LAYOUT%' then v_raised := true; else raise; end if;
  end;
  assert v_raised, 'modelo com imagem preenchida deveria ser rejeitado';

  insert into report_templates (conta_id, name, layout)
  values (v_ws_a, 'T ok',
    '{"version":1,"blocks":[{"id":"i","type":"image","size":"half","config":{"ratio":"4:5","fit":"cover","focal":{"x":0.5,"y":0}}}]}');

  -- ---- (c) sync + reference_count ----
  v_lay := jsonb_build_object('version', 1, 'blocks', jsonb_build_array(
    jsonb_build_object('id','i1','type','image','size','full','config',
      jsonb_build_object('file_id', f_png, 'width', 10, 'height', 10)),
    jsonb_build_object('id','i2','type','image','size','half','config',
      jsonb_build_object('file_id', f_gif, 'width', 10, 'height', 10)),
    jsonb_build_object('id','i3','type','image','size','half','config',
      jsonb_build_object('file_id', f_vid, 'width', 10, 'height', 10)),
    jsonb_build_object('id','i4','type','image','size','half','config',
      jsonb_build_object('file_id', f_b, 'width', 10, 'height', 10))));
  insert into report_documents (conta_id, client_id, period_start, period_end, layout)
    values (v_ws_a, v_cli_a, '2026-09-01', '2026-09-30', v_lay) returning id into v_doc;

  select count(*) into v_n from report_document_files where report_id = v_doc;
  assert v_n = 1, format('so o PNG do proprio workspace vincula (gif, video e outro tenant fora), got %s', v_n);
  select reference_count into v_rc from files where id = f_png;
  assert v_rc = 1, format('reference_count do PNG deveria ser 1, got %s', v_rc);
  select reference_count into v_rc from files where id = f_b;
  assert v_rc = 0, 'arquivo de outro workspace nao pode ganhar referencia';

  -- mesma imagem em dois blocos = um vínculo
  update report_documents set layout = jsonb_set(v_lay, '{blocks,1,config,file_id}', to_jsonb(f_png))
   where id = v_doc;
  select count(*) into v_n from report_document_files where report_id = v_doc;
  assert v_n = 1, 'imagem repetida conta uma vez';

  -- tirar a imagem do layout desvincula
  update report_documents set layout = '{"version":1,"blocks":[]}' where id = v_doc;
  select reference_count into v_rc from files where id = f_png;
  assert v_rc = 0, format('remover do layout deveria zerar a referencia, got %s', v_rc);

  -- caminho de produção: authenticated grava layout via PostgREST ->
  -- trigger SECURITY DEFINER -> file_update_reference_count() -> UPDATE files
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  update report_documents set layout = v_lay where id = v_doc;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select reference_count into v_rc from files where id = f_png;
  assert v_rc = 1, format('update como authenticated deveria vincular, got %s', v_rc);

  -- ---- (d) FK composta barra vínculo cross-tenant manual ----
  v_raised := false;
  begin
    insert into report_document_files (report_id, file_id, conta_id) values (v_doc, f_b, v_ws_a);
  exception when foreign_key_violation then v_raised := true;
  end;
  assert v_raised, 'vinculo com arquivo de outro workspace deveria falhar na FK composta';

  -- ---- (e) exclusão de arquivo em uso bloqueada ----
  v_raised := false;
  begin
    delete from files where id = f_png;
  exception when foreign_key_violation then v_raised := true;
  end;
  assert v_raised, 'excluir arquivo em uso por relatorio deveria falhar';

  -- ---- (f) excluir relatório libera ----
  delete from report_documents where id = v_doc;
  select reference_count into v_rc from files where id = f_png;
  assert v_rc = 0, 'excluir o relatorio deveria liberar a referencia';
  delete from files where id = f_png;

  raise notice 'PASS 99_report_image_files (a-f)';
end $$;
rollback;

-- ---- (g) exclusão de workspace em cascata não trava ----
begin;
do $$
declare
  v_user uuid := gen_random_uuid();
  v_ws uuid; v_cli bigint; f bigint;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (v_ws, 'contas/'||v_ws||'/files/a.png', 'a.png', 'image', 'image/png', 100)
    returning id into f;
  insert into report_documents (conta_id, client_id, period_start, period_end, layout)
    values (v_ws, v_cli, '2026-09-01', '2026-09-30', jsonb_build_object('version', 1, 'blocks',
      jsonb_build_array(jsonb_build_object('id','i','type','image','size','full','config',
        jsonb_build_object('file_id', f, 'width', 10, 'height', 10)))));
  delete from workspaces where id = v_ws;
  raise notice 'PASS 99_report_image_files (g) workspace cascade';
end $$;
rollback;
