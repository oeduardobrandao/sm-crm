\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Idioma por workspace (migration 20261210000001).
--
-- Prova:
--   1. workspace novo nasce 'pt' com language_set_at nulo;
--   2. o dono troca o idioma por workspace_set_language(): grava language e
--      language_set_at e espelha em auth.users.raw_user_meta_data.language;
--   3. admin não troca pela RPC (42501); valor fora de pt/en dá 22023;
--   4. UPDATE direto de language/language_set_at por dono ou admin autenticado é
--      recusado pelo guard (42501 workspace_language_read_only, não um 42501 de
--      grant/RLS), enquanto o mesmo ator ainda grava name (1 linha);
--   5. cadastro com market = 'us' nasce em 'en' e USD; sem market fica 'pt';
--   6. billing_market_apply() respeita a escolha do dono (language_set_at preenchido)
--      e põe 'en' quando o idioma ainda não foi escolhido;
--   7. authenticated executa a RPC; anon e PUBLIC não.

begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws     uuid;
  v_owner  uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
  v_us     uuid := gen_random_uuid();
  v_br     uuid := gen_random_uuid();
  v_actor  uuid;
  v_ret    text;
  v_lang   text;
  v_cur    text;
  v_set    timestamptz;
  v_meta   text;
  v_rows   bigint;
  v_msg    text;
  v_state  text;
  v_col    text;
  v_fn     text := 'public.workspace_set_language(text)';
begin
  -- 1. default.
  v_ws := et_make_workspace('max');
  select language, language_set_at into v_lang, v_set from workspaces where id = v_ws;
  if v_lang is distinct from 'pt' or v_set is not null then
    raise exception 'new workspace must default to pt with null language_set_at: % %', v_lang, v_set;
  end if;

  insert into auth.users (id) values (v_owner), (v_admin);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'),
    (v_admin, v_ws, 'admin');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
   where id in (v_owner, v_admin);

  -- 3. admin: RPC recusada.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.workspace_set_language('en');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  reset role;
  if v_state is distinct from '42501' then
    raise exception 'admin must be refused by workspace_set_language with 42501, got %', v_state;
  end if;
  if (select language from workspaces where id = v_ws) <> 'pt' then
    raise exception 'admin changed the language through the RPC';
  end if;

  -- 4. UPDATE direto: dono e admin recusados pelo guard; name continua passando.
  foreach v_actor in array array[v_owner, v_admin] loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update workspaces set name = 'ET language renamed' where id = v_ws;
    get diagnostics v_rows = row_count;
    reset role;
    if v_rows <> 1 then
      raise exception 'name update by % must affect 1 row, affected %', v_actor, v_rows;
    end if;

    foreach v_col in array array['language = ''en''', 'language_set_at = now()'] loop
      v_msg := null; v_state := null;
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);
      set local role authenticated;
      begin
        execute format('update public.workspaces set %s where id = $1', v_col) using v_ws;
      exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      end;
      reset role;
      if v_state is distinct from '42501' or v_msg is distinct from 'workspace_language_read_only' then
        raise exception '"%" by % must raise 42501 workspace_language_read_only, got % %',
          v_col, v_actor, v_state, v_msg;
      end if;
    end loop;

    -- reescrever o mesmo valor não é mudança.
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update workspaces set language = 'pt', name = 'ET same language' where id = v_ws;
    get diagnostics v_rows = row_count;
    reset role;
    if v_rows <> 1 then
      raise exception 'same-value language write by % must pass, affected %', v_actor, v_rows;
    end if;
  end loop;

  if (select language from workspaces where id = v_ws) <> 'pt' then
    raise exception 'language changed despite the guard';
  end if;

  -- 3b. valor inválido (dono): 22023.
  v_state := null;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.workspace_set_language('es');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  reset role;
  if v_state is distinct from '22023' then
    raise exception 'unsupported language must raise 22023, got %', v_state;
  end if;

  -- 2. dono troca para en.
  set local role authenticated;
  select public.workspace_set_language('en') into v_ret;
  reset role;
  select language, language_set_at into v_lang, v_set from workspaces where id = v_ws;
  select raw_user_meta_data ->> 'language' into v_meta from auth.users where id = v_owner;
  if v_ret is distinct from 'en' or v_lang is distinct from 'en' or v_set is null
     or v_meta is distinct from 'en' then
    raise exception 'owner switch to en failed: ret % row % set_at % meta %', v_ret, v_lang, v_set, v_meta;
  end if;

  -- 5. cadastro.
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_us, 'wl-us@example.com', jsonb_build_object('empresa', 'US Co', 'market', 'us'));
  select w.language, w.billing_currency, w.language_set_at
    into v_lang, v_cur, v_set
    from workspaces w join profiles p on p.conta_id = w.id where p.id = v_us;
  if v_lang is distinct from 'en' or v_cur is distinct from 'usd' or v_set is not null then
    raise exception 'US signup must be en/usd with null language_set_at: % % %', v_lang, v_cur, v_set;
  end if;

  insert into auth.users (id, email, raw_user_meta_data)
    values (v_br, 'wl-br@example.com', jsonb_build_object('empresa', 'BR Co'));
  select w.language into v_lang
    from workspaces w join profiles p on p.conta_id = w.id where p.id = v_br;
  if v_lang is distinct from 'pt' then
    raise exception 'signup without market must stay pt, got %', v_lang;
  end if;

  -- 6a. dono dos EUA escolhe pt; billing_market_apply() respeita.
  select conta_id into v_ws from profiles where id = v_us;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_us, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.workspace_set_language('pt');
  perform public.billing_market_apply();
  reset role;
  select language, language_set_at into v_lang, v_set from workspaces where id = v_ws;
  if v_lang is distinct from 'pt' or v_set is null then
    raise exception 'billing_market_apply must keep the owner choice (pt): % %', v_lang, v_set;
  end if;

  -- 6b. idioma ainda não escolhido: billing_market_apply() corrige para en.
  update workspaces set language = 'pt', language_set_at = null where id = v_ws;
  set local role authenticated;
  perform public.billing_market_apply();
  reset role;
  select language, language_set_at into v_lang, v_set from workspaces where id = v_ws;
  if v_lang is distinct from 'en' or v_set is not null then
    raise exception 'billing_market_apply must set en when unset: % %', v_lang, v_set;
  end if;

  -- 7. grants.
  if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'authenticated must execute workspace_set_language';
  end if;
  if has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception 'anon must not execute workspace_set_language';
  end if;

  raise notice 'workspace language: ok';
end $$;
rollback;
