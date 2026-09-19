\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Isolamento por workspace de cliente_links, no padrão de
-- 40_cliente_tables_tenant_isolation. O teste PRECISA assumir a role
-- `authenticated` (o dono da tabela ignora RLS).

begin;
-- cliente_links fica de fora: o helper daria ALL a anon e desfaria o REVOKE
-- da migration, que e justamente o que o bloco anon abaixo assere.
select et_grant_hosted_parity(array['cliente_links']);

do $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_user uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint;
  v_seen bigint;
  v_rows bigint;
  v_rejected boolean;
begin
  v_ws_a := et_make_workspace('start');
  v_ws_b := et_make_workspace('start');

  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_user, v_ws_a, 'owner'), (v_user, v_ws_b, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a
   where id = v_user;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws_a, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws_b, 'B', 'B', '#000') returning id into v_cli_b;

  insert into cliente_links (cliente_id, conta_id, titulo, url)
    values (v_cli_a, v_ws_a, 'A-link', 'https://a.example.com'),
           (v_cli_b, v_ws_b, 'B-CONFIDENTIAL', 'https://b.example.com');

  -- Constraints de formato (como dono da tabela, antes de trocar de role).
  v_rejected := false;
  begin
    insert into cliente_links (cliente_id, conta_id, titulo, url)
      values (v_cli_a, v_ws_a, 'js', 'javascript:alert(1)');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'cliente_links: url nao-http(s) foi aceita';

  -- Credenciais embutidas (userinfo antes da primeira / ? #) sao recusadas.
  v_rejected := false;
  begin
    insert into cliente_links (cliente_id, conta_id, titulo, url)
      values (v_cli_a, v_ws_a, 'creds', 'https://u:p@example.com');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'cliente_links: url com credenciais embutidas foi aceita';

  -- ... mas `@` no path (perfil/handle) continua valido. Sub-bloco que desfaz
  -- a linha para nao alterar as contagens de visibilidade abaixo.
  begin
    insert into cliente_links (cliente_id, conta_id, titulo, url)
      values (v_cli_a, v_ws_a, 'handle', 'https://www.tiktok.com/@x');
    raise exception 'rollback-handle-probe' using errcode = 'P0001';
  exception when sqlstate 'P0001' then null; end;

  v_rejected := false;
  begin
    insert into cliente_links (cliente_id, conta_id, titulo, url)
      values (v_cli_a, v_ws_a, '   ', 'https://a.example.com');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'cliente_links: titulo em branco foi aceito';

  -- ---- agir como o usuario: membro dos DOIS workspaces, ATIVO = A ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_seen from cliente_links;
  assert v_seen = 1, format('cliente_links: esperava 1 linha visivel, veio %s', v_seen);
  select count(*) into v_seen from cliente_links where titulo = 'B-CONFIDENTIAL';
  assert v_seen = 0, 'cliente_links: linha de outro workspace visivel';

  -- RLS nega por filtragem, entao assertar linhas afetadas.
  update cliente_links set titulo = 'HACKED' where conta_id = v_ws_b;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, format('cliente_links: atualizou %s linha(s) de outro workspace', v_rows);

  delete from cliente_links where conta_id = v_ws_b;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, format('cliente_links: removeu %s linha(s) de outro workspace', v_rows);

  -- Escritas no proprio workspace continuam funcionando.
  update cliente_links set titulo = 'A-renamed' where conta_id = v_ws_a;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, format('cliente_links: update proprio afetou %s linhas', v_rows);

  insert into cliente_links (cliente_id, conta_id, titulo, url, descricao)
    values (v_cli_a, v_ws_a, 'A-new', 'https://a2.example.com', 'desc');

  -- cliente_id de outro workspace com conta_id proprio: rejeitado.
  v_rejected := false;
  begin
    insert into cliente_links (cliente_id, conta_id, titulo, url)
      values (v_cli_b, v_ws_a, 'cross', 'https://x.example.com');
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'cliente_links: insert com cliente_id de outro workspace NAO foi rejeitado';

  -- Re-apontar cliente_id via UPDATE: rejeitado.
  v_rejected := false;
  begin
    update cliente_links set cliente_id = v_cli_b
     where conta_id = v_ws_a and titulo = 'A-renamed';
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'cliente_links: update re-apontando cliente_id NAO foi rejeitado';

  -- anon nao pode ler a tabela. Assertamos o PRIVILEGIO (nao a contagem de
  -- linhas): a RLS sem politica para anon tambem devolveria 0 linhas, entao a
  -- contagem passaria mesmo sem o REVOKE da migration.
  execute 'reset role';
  execute 'set local role anon';
  v_rejected := false;
  begin
    perform 1 from cliente_links limit 1;
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'cliente_links: anon ainda tem SELECT na tabela';
  execute 'reset role';

  select count(*) into v_seen from cliente_links
   where conta_id = v_ws_b and titulo = 'B-CONFIDENTIAL';
  assert v_seen = 1, 'linha de outro workspace foi alterada ou removida';

  raise notice 'PASS 98_cliente_links_rls';
end $$;
rollback;
