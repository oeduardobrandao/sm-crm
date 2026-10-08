-- supabase/tests/entitlements/99_post_references.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Referências do cliente no post (migration 20261010000001, spec 2026-10-08).
-- (a) grants da tabela e das RPCs; (b) RLS: isolamento entre workspaces,
-- anon sem acesso, authenticated sem escrita; (c) insert de arquivo: cota,
-- attached_to, stream_status 'skipped' em vídeo (fora da ingest do Stream);
-- (d) insert de link; (e) post_not_found / post_not_pending /
-- reference_limit / quota_exceeded; (f) CHECK de URL; (g) update/delete do
-- cliente: ok, not_found, locked (resposta da equipe, evento de status fora
-- do cliente, post fora de enviado_cliente); (h) órfão apaga o files e
-- devolve a cota; (i) excluir o post cascateia; (j) post_reference_list e
-- can_remove por referência; (k) notificação coalescida em 15 min;
-- (l) exclusão de workspace em cascata; (m) JSON null nos opcionais;
-- (n) upload_mismatch (chave já usada em files); (o) bulk_move_items não
-- move arquivo de referência; (p) arquivo de referência não vira vínculo
-- de post, ideia, relatório nem logo do Hub (reference_file_not_linkable).
--
-- now() é fixo dentro da transação: toda linha com DEFAULT now() tem o mesmo
-- created_at, e "created_at > referência.created_at" nunca é verdade. As
-- linhas que precisam ser POSTERIORES à referência usam now() + 1 segundo; as
-- que precisam ser ANTERIORES, now() - intervalo.

create or replace function pg_temp.pr_env(p_plan text, p_overrides jsonb,
  out ws uuid, out usr uuid, out cli bigint, out wf bigint)
language plpgsql as $$
begin
  ws := et_make_workspace(p_plan, p_overrides);
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws where id = usr;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (usr, ws, 'Cliente', 'C', '#000') returning id into cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (usr, ws, cli, 'WF', 'ativo') returning id into wf;
end $$;

-- Post já em enviado_cliente via INSERT: o trigger de status só dispara em
-- UPDATE, então nenhum post_status_events nasce aqui.
create or replace function pg_temp.pr_post(p_ws uuid, p_wf bigint, p_status text default 'enviado_cliente')
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into workflow_posts (workflow_id, conta_id, titulo, status)
    values (p_wf, p_ws, 'Post', p_status) returning id into v_id;
  return v_id;
end $$;

create or replace function pg_temp.pr_file(p_ws uuid, p_cli bigint, p_post bigint,
  p_kind text default 'image', p_size bigint default 100)
returns post_references language plpgsql as $$
begin
  return post_reference_file_insert(jsonb_build_object(
    'post_id', p_post, 'conta_id', p_ws, 'cliente_id', p_cli,
    'r2_key', 'contas/' || p_ws || '/files/' || gen_random_uuid() || '.bin',
    'thumbnail_r2_key', case when p_kind = 'document' then ''
                             else 'contas/' || p_ws || '/files/' || gen_random_uuid() || '.thumb.webp' end,
    'name', 'arquivo', 'mime_type', case p_kind when 'image' then 'image/png'
                                                when 'video' then 'video/mp4'
                                                else 'application/pdf' end,
    'file_kind', p_kind, 'size_bytes', p_size,
    'width', case when p_kind = 'document' then '' else '1080' end,
    'height', case when p_kind = 'document' then '' else '1350' end,
    'duration_seconds', case when p_kind = 'video' then '12' else '' end,
    'blur_data_url', '', 'note', 'Use esta foto'));
end $$;

create or replace function pg_temp.pr_link(p_ws uuid, p_cli bigint, p_post bigint,
  p_url text default 'https://example.com/a')
returns post_references language plpgsql as $$
begin
  return post_reference_link_insert(jsonb_build_object(
    'post_id', p_post, 'conta_id', p_ws, 'cliente_id', p_cli,
    'url', p_url, 'link_title', 'Exemplo', 'note', ''));
end $$;

-- Roda a RPC esperando P0001 com a mensagem exata.
create or replace function pg_temp.pr_expect(p_sql text, p_code text)
returns void language plpgsql as $$
declare v_raised boolean := false;
begin
  begin
    execute p_sql;
  exception when sqlstate 'P0001' then
    assert sqlerrm = p_code, format('esperava %s, veio %s', p_code, sqlerrm);
    v_raised := true;
  end;
  assert v_raised, format('esperava %s de: %s', p_code, p_sql);
end $$;

-- ---- (a) + (b) grants e RLS ----
begin;
select et_grant_hosted_parity(array['post_references']);
do $$
declare
  a record; b record;
  v_post_a bigint; v_post_b bigint;
  v_n int; v_raised boolean;
  v_fn text;
begin
  assert not has_table_privilege('anon', 'public.post_references', 'SELECT'),
    'anon nao pode ler post_references';
  assert has_table_privilege('authenticated', 'public.post_references', 'SELECT'),
    'authenticated precisa ler post_references';
  assert not has_table_privilege('authenticated', 'public.post_references', 'INSERT'),
    'authenticated nao pode inserir';
  assert not has_table_privilege('authenticated', 'public.post_references', 'UPDATE'),
    'authenticated nao pode atualizar';
  assert not has_table_privilege('authenticated', 'public.post_references', 'DELETE'),
    'authenticated nao pode apagar';
  assert has_table_privilege('service_role', 'public.post_references', 'INSERT'),
    'service_role precisa escrever';

  foreach v_fn in array array[
    'public.post_reference_can_remove(bigint)',
    'public.post_reference_list(bigint, uuid)',
    'public.post_reference_file_insert(jsonb)',
    'public.post_reference_link_insert(jsonb)',
    'public.post_reference_client_update(bigint, uuid, bigint, text)',
    'public.post_reference_client_delete(bigint, uuid, bigint)',
    'public.create_post_reference_notification(bigint)'
  ] loop
    assert has_function_privilege('service_role', v_fn, 'EXECUTE'),
      format('service_role precisa executar %s', v_fn);
    assert not has_function_privilege('anon', v_fn, 'EXECUTE'),
      format('anon nao pode executar %s', v_fn);
    assert not has_function_privilege('authenticated', v_fn, 'EXECUTE'),
      format('authenticated nao pode executar %s', v_fn);
  end loop;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  a := pg_temp.pr_env('max', null);
  b := pg_temp.pr_env('max', null);
  v_post_a := pg_temp.pr_post(a.ws, a.wf);
  v_post_b := pg_temp.pr_post(b.ws, b.wf);
  perform pg_temp.pr_link(a.ws, a.cli, v_post_a);
  perform pg_temp.pr_file(a.ws, a.cli, v_post_a);
  perform pg_temp.pr_link(b.ws, b.cli, v_post_b);

  -- usuário A só vê as duas do workspace A
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', a.usr, 'role', 'authenticated')::text, true);
  select count(*) into v_n from post_references;
  assert v_n = 2, format('A deveria ver 2 referencias, viu %s', v_n);
  select count(*) into v_n from post_references where conta_id = b.ws;
  assert v_n = 0, 'A nao pode ver referencias do workspace B';

  v_raised := false;
  begin
    insert into post_references (post_id, conta_id, kind, url)
      values (v_post_a, a.ws, 'link', 'https://x.com');
  exception when insufficient_privilege then v_raised := true;
  end;
  assert v_raised, 'authenticated nao pode inserir direto';
  reset role;

  -- usuário B só vê a dele
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', b.usr, 'role', 'authenticated')::text, true);
  select count(*) into v_n from post_references;
  assert v_n = 1, format('B deveria ver 1 referencia, viu %s', v_n);
  reset role;

  -- anon: sem privilégio nenhum
  set local role anon;
  v_raised := false;
  begin
    perform 1 from post_references;
  exception when insufficient_privilege then v_raised := true;
  end;
  assert v_raised, 'anon nao pode ler post_references';
  reset role;

  raise notice 'PASS 99_post_references (a, b) grants + RLS';
end $$;
rollback;

-- ---- (c) .. (f) inserts, gates, cota, URL ----
begin;
do $$
declare
  a record; q record;
  v_post bigint; v_post_draft bigint; v_post_lim bigint; v_post_q bigint;
  v_ref post_references; v_f files;
  v_used_before bigint; v_used_after bigint; v_n int;
  v_bad text; v_raised boolean;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  a := pg_temp.pr_env('max', null);
  v_post := pg_temp.pr_post(a.ws, a.wf);
  v_post_draft := pg_temp.pr_post(a.ws, a.wf, 'rascunho');
  v_post_lim := pg_temp.pr_post(a.ws, a.wf);

  -- (c) imagem: cobra a cota, attached_to, sem pasta e sem uploader
  select storage_used_bytes into v_used_before from workspaces where id = a.ws;
  v_ref := pg_temp.pr_file(a.ws, a.cli, v_post, 'image', 100);
  assert v_ref.kind = 'file' and v_ref.file_id is not null and v_ref.url is null,
    'referencia de arquivo com file_id e sem url';
  assert v_ref.note = 'Use esta foto', 'nota gravada';
  select * into v_f from files where id = v_ref.file_id;
  assert v_f.attached_to = 'post_reference', 'files.attached_to = post_reference';
  assert v_f.folder_id is null and v_f.uploaded_by is null, 'fora de pastas, sem uploader';
  assert v_f.kind = 'image' and v_f.stream_status is null, 'imagem sem stream_status';
  assert v_f.reference_count = 1, format('reference_count 1, veio %s', v_f.reference_count);
  select storage_used_bytes into v_used_after from workspaces where id = a.ws;
  assert v_used_after = v_used_before + 100,
    format('cota deveria subir 100 (%s -> %s)', v_used_before, v_used_after);

  -- (c) vídeo: 'skipped' e fora do predicado de ingest do Stream
  --     (stream-steps.ts: kind=video, stream_uid null, stream_status null|pending)
  v_ref := pg_temp.pr_file(a.ws, a.cli, v_post, 'video', 200);
  select * into v_f from files where id = v_ref.file_id;
  assert v_f.stream_status = 'skipped', format('video de referencia skipped, veio %s', v_f.stream_status);
  assert v_f.duration_seconds = 12, 'duration_seconds gravado';
  assert not exists (
    select 1 from files
     where id = v_f.id and kind = 'video' and stream_uid is null
       and (stream_status is null or stream_status = 'pending')),
    'video skipped nao pode casar com a ingest do Stream';

  -- (c) PDF sem thumbnail
  v_ref := pg_temp.pr_file(a.ws, a.cli, v_post, 'document', 50);
  select * into v_f from files where id = v_ref.file_id;
  assert v_f.thumbnail_r2_key is null and v_f.kind = 'document', 'pdf sem thumbnail';

  -- (d) link
  v_ref := pg_temp.pr_link(a.ws, a.cli, v_post, 'https://www.instagram.com/p/abc/?x=1#y');
  assert v_ref.kind = 'link' and v_ref.file_id is null
     and v_ref.url = 'https://www.instagram.com/p/abc/?x=1#y'
     and v_ref.link_title = 'Exemplo' and v_ref.note is null,
    'link gravado, nota vazia vira null';

  -- (e) post de outro cliente / workspace -> post_not_found
  perform pg_temp.pr_expect(format(
    'select pg_temp.pr_link(%L::uuid, %s, %s)', a.ws, a.cli + 100000, v_post), 'post_not_found');
  perform pg_temp.pr_expect(format(
    'select pg_temp.pr_link(%L::uuid, %s, %s)', gen_random_uuid(), a.cli, v_post), 'post_not_found');
  perform pg_temp.pr_expect(format(
    'select pg_temp.pr_file(%L::uuid, %s, %s)', a.ws, a.cli + 100000, v_post), 'post_not_found');

  -- (e) post fora de enviado_cliente -> post_not_pending
  perform pg_temp.pr_expect(format(
    'select pg_temp.pr_link(%L::uuid, %s, %s)', a.ws, a.cli, v_post_draft), 'post_not_pending');
  perform pg_temp.pr_expect(format(
    'select pg_temp.pr_file(%L::uuid, %s, %s)', a.ws, a.cli, v_post_draft), 'post_not_pending');

  -- (e) limite de 10 (arquivos + links)
  for i in 1..9 loop
    perform pg_temp.pr_link(a.ws, a.cli, v_post_lim);
  end loop;
  perform pg_temp.pr_file(a.ws, a.cli, v_post_lim);
  select count(*) into v_n from post_references where post_id = v_post_lim;
  assert v_n = 10, format('10 referencias no post, veio %s', v_n);
  perform pg_temp.pr_expect(format(
    'select pg_temp.pr_link(%L::uuid, %s, %s)', a.ws, a.cli, v_post_lim), 'reference_limit');
  perform pg_temp.pr_expect(format(
    'select pg_temp.pr_file(%L::uuid, %s, %s)', a.ws, a.cli, v_post_lim), 'reference_limit');

  -- (e) cota do plano estourada: nada gravado, cota intacta
  q := pg_temp.pr_env('max', '{"storage_quota_bytes": 1000}'::jsonb);
  v_post_q := pg_temp.pr_post(q.ws, q.wf);
  perform pg_temp.pr_expect(format(
    'select pg_temp.pr_file(%L::uuid, %s, %s, %L, 1001)', q.ws, q.cli, v_post_q, 'image'),
    'quota_exceeded');
  assert not exists (select 1 from files where conta_id = q.ws), 'nenhum files gravado';
  assert not exists (select 1 from post_references where post_id = v_post_q), 'nenhuma referencia gravada';
  assert (select storage_used_bytes from workspaces where id = q.ws) = 0, 'cota intacta';
  v_ref := pg_temp.pr_file(q.ws, q.cli, v_post_q, 'image', 1000);
  assert v_ref.id is not null, 'exatamente no limite passa';

  -- (f) CHECK de URL (rede de segurança)
  foreach v_bad in array array[
    'https://user:pass@x.com', 'https:// x', 'https://', 'ftp://x.com',
    'javascript:alert(1)', 'https://x.com/a b', 'https://x.com/' || chr(10),
    'https://x.com/' || repeat('a', 2048)
  ] loop
    v_raised := false;
    begin
      insert into post_references (post_id, conta_id, kind, url)
        values (v_post, a.ws, 'link', v_bad);
    exception when check_violation then v_raised := true;
    end;
    assert v_raised, format('URL %L deveria violar a CHECK', v_bad);
  end loop;
  insert into post_references (post_id, conta_id, kind, url)
    values (v_post, a.ws, 'link', 'HTTP://Example.com');
  insert into post_references (post_id, conta_id, kind, url)
    values (v_post, a.ws, 'link', 'https://x.com/@perfil');

  -- formato: link com file_id ou arquivo com url falham
  v_raised := false;
  begin
    insert into post_references (post_id, conta_id, kind, file_id, url)
      values (v_post, a.ws, 'file', v_f.id, 'https://x.com');
  exception when check_violation then v_raised := true;
  end;
  assert v_raised, 'arquivo com url deveria violar post_references_shape';

  -- (m) opcionais aceitam JSON null além de ''
  v_ref := post_reference_file_insert(jsonb_build_object(
    'post_id', v_post, 'conta_id', a.ws, 'cliente_id', a.cli,
    'r2_key', 'contas/' || a.ws || '/files/null-test.pdf', 'thumbnail_r2_key', null,
    'name', 'doc.pdf', 'mime_type', 'application/pdf', 'file_kind', 'document',
    'size_bytes', 1, 'width', null, 'height', null, 'duration_seconds', null,
    'blur_data_url', null, 'note', null));
  select * into v_f from files where id = v_ref.file_id;
  assert v_ref.note is null and v_f.thumbnail_r2_key is null and v_f.width is null
     and v_f.height is null and v_f.duration_seconds is null and v_f.blur_data_url is null,
    'JSON null vira NULL no arquivo';
  v_ref := post_reference_link_insert(jsonb_build_object(
    'post_id', v_post, 'conta_id', a.ws, 'cliente_id', a.cli,
    'url', 'https://example.com/null', 'link_title', null, 'note', null));
  assert v_ref.link_title is null and v_ref.note is null, 'JSON null vira NULL no link';

  -- (n) upload_mismatch: chave já existente em files (r2_key ou thumbnail,
  --     de qualquer workspace) ou chave principal = thumbnail
  insert into files (conta_id, r2_key, thumbnail_r2_key, name, kind, mime_type, size_bytes)
    values (q.ws, 'contas/' || q.ws || '/files/midia.mp4', 'contas/' || q.ws || '/files/midia.thumb.webp',
            'midia.mp4', 'video', 'video/mp4', 1);
  select storage_used_bytes into v_used_before from workspaces where id = a.ws;
  select count(*) into v_n from post_references where post_id = v_post;
  foreach v_bad in array array[
    format('{"r2_key": "contas/%s/files/midia.mp4", "thumbnail_r2_key": "contas/%s/files/novo.thumb.webp"}', q.ws, a.ws),
    format('{"r2_key": "contas/%s/files/midia.thumb.webp", "thumbnail_r2_key": "contas/%s/files/novo.thumb.webp"}', q.ws, a.ws),
    format('{"r2_key": "contas/%s/files/novo.png", "thumbnail_r2_key": "contas/%s/files/midia.mp4"}', a.ws, q.ws),
    format('{"r2_key": "contas/%s/files/novo.png", "thumbnail_r2_key": "contas/%s/files/midia.thumb.webp"}', a.ws, q.ws),
    format('{"r2_key": "contas/%s/files/igual.png", "thumbnail_r2_key": "contas/%s/files/igual.png"}', a.ws, a.ws),
    '{"r2_key": "", "thumbnail_r2_key": null}'
  ] loop
    perform pg_temp.pr_expect(format(
      'select post_reference_file_insert(%L::jsonb || %L::jsonb)',
      jsonb_build_object('post_id', v_post, 'conta_id', a.ws, 'cliente_id', a.cli,
        'name', 'x.png', 'mime_type', 'image/png', 'file_kind', 'image', 'size_bytes', 5),
      v_bad), 'upload_mismatch');
  end loop;
  assert (select count(*) from post_references where post_id = v_post) = v_n, 'nada gravado no mismatch';
  assert (select storage_used_bytes from workspaces where id = a.ws) = v_used_before, 'cota intacta no mismatch';

  raise notice 'PASS 99_post_references (c-f, m, n) inserts, gates, cota, URL, nulls, mismatch';
end $$;
rollback;

-- ---- (g) .. (j) update/delete do cliente, órfão, cascata, lista ----
begin;
do $$
declare
  a record; b record;
  v_post bigint; v_post_ev bigint; v_post_cli_ev bigint; v_post_moved bigint;
  v_post_null bigint; v_post_list bigint; v_post_del bigint; v_post_b bigint;
  r_file post_references; r_link post_references; r_ev post_references;
  r_cli_ev post_references; r_moved post_references; r_null post_references;
  r_old post_references; r_new post_references; r_b post_references;
  r_del1 post_references; r_del2 post_references;
  v_used bigint; v_used_before bigint; v_key text; v_n int;
  v_list record; v_rows int := 0;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  a := pg_temp.pr_env('max', null);
  b := pg_temp.pr_env('max', null);
  v_post := pg_temp.pr_post(a.ws, a.wf);
  v_post_ev := pg_temp.pr_post(a.ws, a.wf);
  v_post_cli_ev := pg_temp.pr_post(a.ws, a.wf);
  v_post_moved := pg_temp.pr_post(a.ws, a.wf);
  v_post_null := pg_temp.pr_post(a.ws, a.wf);
  v_post_b := pg_temp.pr_post(b.ws, b.wf);

  r_file := pg_temp.pr_file(a.ws, a.cli, v_post, 'image', 300);
  r_link := pg_temp.pr_link(a.ws, a.cli, v_post);
  r_b := pg_temp.pr_link(b.ws, b.cli, v_post_b);

  -- (g) ok: nota editada; '' vira null
  assert post_reference_client_update(r_link.id, a.ws, a.cli, 'Nova nota') = 'ok', 'update ok';
  assert (select note from post_references where id = r_link.id) = 'Nova nota', 'nota atualizada';
  assert post_reference_client_update(r_link.id, a.ws, a.cli, '') = 'ok', 'update vazio ok';
  assert (select note from post_references where id = r_link.id) is null, 'nota vazia vira null';

  -- (g) not_found: outro cliente, outro workspace, referência de B, id inexistente
  assert post_reference_client_update(r_link.id, a.ws, a.cli + 100000, 'x') = 'not_found', 'outro cliente';
  assert post_reference_client_update(r_link.id, b.ws, a.cli, 'x') = 'not_found', 'outro workspace';
  assert post_reference_client_delete(r_b.id, a.ws, a.cli) = 'not_found', 'referencia de B pelo token de A';
  assert post_reference_client_delete(-1, a.ws, a.cli) = 'not_found', 'id inexistente';
  assert exists (select 1 from post_references where id = r_b.id), 'referencia de B intacta';

  -- (h) delete ok: órfão apaga o files, devolve a cota, enfileira o R2
  select r2_key into v_key from files where id = r_file.file_id;
  select storage_used_bytes into v_used_before from workspaces where id = a.ws;
  assert post_reference_client_delete(r_file.id, a.ws, a.cli) = 'ok', 'delete ok';
  assert not exists (select 1 from post_references where id = r_file.id), 'referencia apagada';
  assert not exists (select 1 from files where id = r_file.file_id), 'files orfao apagado';
  select storage_used_bytes into v_used from workspaces where id = a.ws;
  assert v_used = v_used_before - 300, format('cota devolvida (%s -> %s)', v_used_before, v_used);
  assert exists (select 1 from file_deletions where r2_key = v_key), 'R2 enfileirado';

  -- (g) locked: resposta da equipe depois da referência
  insert into post_approvals (post_id, action, comentario, is_workspace_user, created_at)
    values (v_post, 'mensagem', 'Recebido', true, now() + interval '1 second');
  assert post_reference_client_update(r_link.id, a.ws, a.cli, 'x') = 'locked', 'update locked apos resposta';
  assert post_reference_client_delete(r_link.id, a.ws, a.cli) = 'locked', 'delete locked apos resposta';
  assert exists (select 1 from post_references where id = r_link.id), 'referencia travada continua';

  -- (g) resposta da equipe com created_at NULL nunca trava
  r_null := pg_temp.pr_link(a.ws, a.cli, v_post_null);
  insert into post_approvals (post_id, action, comentario, is_workspace_user, created_at)
    values (v_post_null, 'mensagem', 'Sem data', true, null);
  assert post_reference_client_update(r_null.id, a.ws, a.cli, 'ok') = 'ok', 'created_at NULL nao trava';

  -- (g) locked: evento de status fora do cliente (reenvio da equipe) depois
  r_ev := pg_temp.pr_link(a.ws, a.cli, v_post_ev);
  insert into post_status_events (post_id, conta_id, from_status, to_status, source, created_at)
    values (v_post_ev, a.ws, 'correcao_cliente', 'enviado_cliente', 'workspace_user',
            now() + interval '1 second');
  assert post_reference_client_delete(r_ev.id, a.ws, a.cli) = 'locked', 'delete locked apos reenvio';

  -- evento do próprio cliente não trava
  r_cli_ev := pg_temp.pr_link(a.ws, a.cli, v_post_cli_ev);
  insert into post_status_events (post_id, conta_id, from_status, to_status, source, created_at)
    values (v_post_cli_ev, a.ws, 'enviado_cliente', 'enviado_cliente', 'client',
            now() + interval '1 second');
  assert post_reference_client_update(r_cli_ev.id, a.ws, a.cli, 'ok') = 'ok', 'evento do cliente nao trava';

  -- (g) locked: post saiu de enviado_cliente
  r_moved := pg_temp.pr_link(a.ws, a.cli, v_post_moved);
  update workflow_posts set status = 'aprovado_cliente' where id = v_post_moved;
  assert post_reference_client_delete(r_moved.id, a.ws, a.cli) = 'locked', 'post aprovado trava';

  -- (j) lista: ordem por created_at, can_remove por referência
  v_post_list := pg_temp.pr_post(a.ws, a.wf);
  r_old := pg_temp.pr_file(a.ws, a.cli, v_post_list, 'image', 10);
  r_new := pg_temp.pr_link(a.ws, a.cli, v_post_list);
  update post_references set created_at = now() - interval '1 hour' where id = r_old.id;
  insert into post_approvals (post_id, action, comentario, is_workspace_user, created_at)
    values (v_post_list, 'mensagem', 'Entre as duas', true, now() - interval '30 minutes');
  for v_list in select * from post_reference_list(v_post_list, a.ws) loop
    v_rows := v_rows + 1;
    if v_rows = 1 then
      assert v_list.id = r_old.id, 'mais antiga primeiro';
      assert v_list.can_remove = false, 'antiga travada pela resposta posterior';
      assert v_list.kind = 'file' and v_list.file_kind = 'image'
         and v_list.size_bytes = 10 and v_list.width = 1080 and v_list.height = 1350
         and v_list.r2_key like 'contas/' || a.ws || '/files/%'
         and v_list.thumbnail_r2_key like '%.thumb.webp'
         and v_list.mime_type = 'image/png' and v_list.name = 'arquivo',
        'campos do arquivo na lista';
    else
      assert v_list.id = r_new.id, 'mais nova depois';
      assert v_list.can_remove = true, 'nova continua removivel';
      assert v_list.kind = 'link' and v_list.file_kind is null and v_list.url is not null,
        'link sem campos de arquivo';
    end if;
  end loop;
  assert v_rows = 2, format('lista com 2 linhas, veio %s', v_rows);
  select count(*) into v_n from post_reference_list(v_post_list, b.ws);
  assert v_n = 0, 'lista com conta errada vem vazia';
  assert post_reference_can_remove(r_old.id) = false and post_reference_can_remove(r_new.id) = true,
    'can_remove direto bate com a lista';

  -- (h) remoção da equipe (DELETE direto do service role) também limpa
  select storage_used_bytes into v_used_before from workspaces where id = a.ws;
  delete from post_references where id = r_old.id;
  assert not exists (select 1 from files where id = r_old.file_id), 'delete da equipe apaga o files';
  assert (select storage_used_bytes from workspaces where id = a.ws) = v_used_before - 10,
    'delete da equipe devolve a cota';

  -- (i) excluir o post cascateia referências e arquivos
  v_post_del := pg_temp.pr_post(a.ws, a.wf);
  r_del1 := pg_temp.pr_file(a.ws, a.cli, v_post_del, 'video', 500);
  r_del2 := pg_temp.pr_link(a.ws, a.cli, v_post_del);
  select storage_used_bytes into v_used_before from workspaces where id = a.ws;
  delete from workflow_posts where id = v_post_del;
  assert not exists (select 1 from post_references where post_id = v_post_del), 'referencias cascateadas';
  assert not exists (select 1 from files where id = r_del1.file_id), 'arquivo do post apagado';
  assert (select storage_used_bytes from workspaces where id = a.ws) = v_used_before - 500,
    'cota devolvida na exclusao do post';

  raise notice 'PASS 99_post_references (g-j) update/delete, orfao, cascata, lista';
end $$;
rollback;

-- ---- (k) notificação coalescida ----
begin;
do $$
declare
  a record;
  v_post bigint; v_n int; v_notif notifications;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  a := pg_temp.pr_env('max', null);
  v_post := pg_temp.pr_post(a.ws, a.wf);
  perform pg_temp.pr_link(a.ws, a.cli, v_post);

  assert create_post_reference_notification(v_post) = 1, 'primeira chamada notifica o owner';
  select * into v_notif from notifications
   where user_id = a.usr and type = 'post_client_reference';
  assert v_notif.workspace_id = a.ws, 'workspace da notificacao';
  assert v_notif.link = '/entregas?drawer=' || a.wf, format('link do fluxo, veio %s', v_notif.link);
  assert v_notif.metadata->>'post_id' = v_post::text
     and v_notif.metadata->>'client_name' = 'Cliente'
     and v_notif.metadata->>'post_title' = 'Post'
     and (v_notif.metadata->>'workflow_id')::bigint = a.wf,
    'metadata da notificacao';

  -- segunda dentro de 15 min, não lida: nada novo
  assert create_post_reference_notification(v_post) = 0, 'segunda chamada coalescida';
  select count(*) into v_n from notifications
   where user_id = a.usr and type = 'post_client_reference';
  assert v_n = 1, format('uma notificacao so, veio %s', v_n);

  -- lida: a próxima volta a notificar
  update notifications set read_at = now()
   where user_id = a.usr and type = 'post_client_reference';
  assert create_post_reference_notification(v_post) = 1, 'depois de lida notifica de novo';

  -- não lida mas com mais de 15 min: notifica de novo
  update notifications set created_at = now() - interval '16 minutes'
   where user_id = a.usr and type = 'post_client_reference' and read_at is null;
  assert create_post_reference_notification(v_post) = 1, 'apos 15 min notifica de novo';
  select count(*) into v_n from notifications
   where user_id = a.usr and type = 'post_client_reference';
  assert v_n = 3, format('tres notificacoes no total, veio %s', v_n);

  -- post inexistente: 0, sem erro
  assert create_post_reference_notification(-1) = 0, 'post inexistente';

  raise notice 'PASS 99_post_references (k) notificacao coalescida';
end $$;
rollback;

-- ---- (l) exclusão de workspace em cascata não trava ----
-- Três caminhos chegam em post_references (conta_id, post, files) e o trigger
-- de órfão apaga files que o mesmo statement já está apagando.
begin;
do $$
declare
  a record; v_post bigint;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  a := pg_temp.pr_env('max', null);
  v_post := pg_temp.pr_post(a.ws, a.wf);
  perform pg_temp.pr_file(a.ws, a.cli, v_post, 'image', 100);
  perform pg_temp.pr_file(a.ws, a.cli, v_post, 'video', 100);
  perform pg_temp.pr_link(a.ws, a.cli, v_post);
  delete from workspaces where id = a.ws;
  assert not exists (select 1 from post_references where conta_id = a.ws), 'referencias cascateadas';
  assert not exists (select 1 from files where conta_id = a.ws), 'arquivos cascateados';
  raise notice 'PASS 99_post_references (l) workspace cascade';
end $$;
rollback;

-- ---- (o) bulk_move_items não move arquivo de referência ----
begin;
do $$
declare
  a record; v_post bigint; v_ref post_references;
  v_folder bigint; v_plain bigint; v_res json;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  a := pg_temp.pr_env('max', null);
  v_post := pg_temp.pr_post(a.ws, a.wf);
  v_ref := pg_temp.pr_file(a.ws, a.cli, v_post, 'image', 10);
  insert into folders (conta_id, name) values (a.ws, 'Pasta') returning id into v_folder;
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (a.ws, 'contas/' || a.ws || '/files/solto.png', 'solto.png', 'image', 'image/png', 10)
    returning id into v_plain;

  v_res := bulk_move_items(a.ws, array[v_ref.file_id], '{}'::bigint[], v_folder);
  assert v_res->>'code' = 'invalid_files', format('referencia deveria ser invalid_files, veio %s', v_res);
  assert (select folder_id from files where id = v_ref.file_id) is null, 'referencia continua fora de pastas';

  v_res := bulk_move_items(a.ws, array[v_ref.file_id, v_plain], '{}'::bigint[], v_folder);
  assert v_res->>'code' = 'invalid_files', 'lote misto e recusado inteiro';
  assert (select folder_id from files where id = v_plain) is null, 'nada movido no lote recusado';

  v_res := bulk_move_items(a.ws, array[v_plain], '{}'::bigint[], v_folder);
  assert (v_res->>'ok')::boolean and (select folder_id from files where id = v_plain) = v_folder,
    'arquivo comum continua movendo';

  raise notice 'PASS 99_post_references (o) bulk_move_items';
end $$;
rollback;

-- ---- (p) arquivo de referência nunca é vinculado em outra tabela ----
begin;
do $$
declare
  a record; v_post bigint; v_post2 bigint; v_ref post_references;
  v_plain bigint; v_plain2 bigint; v_ideia uuid; v_link bigint; v_ok boolean;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  a := pg_temp.pr_env('max', null);
  v_post := pg_temp.pr_post(a.ws, a.wf);
  v_post2 := pg_temp.pr_post(a.ws, a.wf, 'rascunho');
  v_ref := pg_temp.pr_file(a.ws, a.cli, v_post, 'image', 10);
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (a.ws, 'contas/' || a.ws || '/files/p1.png', 'p1.png', 'image', 'image/png', 10)
    returning id into v_plain;
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (a.ws, 'contas/' || a.ws || '/files/p2.png', 'p2.png', 'image', 'image/png', 10)
    returning id into v_plain2;
  insert into ideias (workspace_id, cliente_id, titulo, descricao)
    values (a.ws, a.cli, 'Ideia', 'x') returning id into v_ideia;

  -- arquivo comum continua vinculando nas quatro tabelas
  insert into post_file_links (conta_id, post_id, file_id) values (a.ws, v_post2, v_plain)
    returning id into v_link;
  insert into ideia_files (ideia_id, file_id, conta_id) values (v_ideia, v_plain, a.ws);
  insert into hub_brand (cliente_id, logo_file_id) values (a.cli, v_plain);
  insert into report_documents (conta_id, client_id, period_start, period_end, layout)
    values (a.ws, a.cli, '2026-09-01', '2026-09-30', jsonb_build_object('version', 1, 'blocks',
      jsonb_build_array(jsonb_build_object('id','i','type','image','size','full','config',
        jsonb_build_object('file_id', v_plain, 'width', 10, 'height', 10)))));
  assert exists (select 1 from report_document_files where file_id = v_plain), 'arquivo comum vincula ao relatorio';

  -- referência: cada tabela recusa
  perform pg_temp.pr_expect(format(
    'insert into post_file_links (conta_id, post_id, file_id) values (%L::uuid, %s, %s)',
    a.ws, v_post2, v_ref.file_id), 'reference_file_not_linkable');
  perform pg_temp.pr_expect(format(
    'update post_file_links set file_id = %s where id = %s', v_ref.file_id, v_link),
    'reference_file_not_linkable');
  perform pg_temp.pr_expect(format(
    'insert into ideia_files (ideia_id, file_id, conta_id) values (%L::uuid, %s, %L::uuid)',
    v_ideia, v_ref.file_id, a.ws), 'reference_file_not_linkable');
  perform pg_temp.pr_expect(format(
    'update hub_brand set logo_file_id = %s where cliente_id = %s', v_ref.file_id, a.cli),
    'reference_file_not_linkable');
  perform pg_temp.pr_expect(format(
    'insert into report_documents (conta_id, client_id, period_start, period_end, layout) values (%L::uuid, %s, %L, %L, %L::jsonb)',
    a.ws, a.cli, '2026-09-01', '2026-09-30', jsonb_build_object('version', 1, 'blocks',
      jsonb_build_array(jsonb_build_object('id','i','type','image','size','full','config',
        jsonb_build_object('file_id', v_ref.file_id, 'width', 10, 'height', 10))))::text),
    'reference_file_not_linkable');

  -- post_file_link_replace com arquivo de referência: recusa, vínculo intacto
  perform pg_temp.pr_expect(format(
    'select post_file_link_replace(%L::uuid, %L::uuid, %s, %s, %L)',
    a.ws, a.usr, v_link, v_ref.file_id, 'contas/' || a.ws || '/files/p1.png'),
    'reference_file_not_linkable');
  assert (select file_id from post_file_links where id = v_link) = v_plain, 'vinculo intacto';
  -- e com arquivo comum continua trocando
  v_ok := post_file_link_replace(a.ws, a.usr, v_link, v_plain2, 'contas/' || a.ws || '/files/p1.png');
  assert v_ok and (select file_id from post_file_links where id = v_link) = v_plain2,
    'replace com arquivo comum continua funcionando';

  raise notice 'PASS 99_post_references (p) reference_file_not_linkable';
end $$;
rollback;
