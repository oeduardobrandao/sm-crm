\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- admin_list_workspaces com origem de aquisição (migration 20261209000002).
--
-- Prova:
--   1. existe uma única função admin_list_workspaces (o DROP da assinatura de
--      11 argumentos não deixou sobrecarga para trás);
--   2. cada workspace traz acquisition_channel: 'demo' quando demo_created_at
--      está preenchido (vence o canal guardado), senão o canal de
--      workspace_acquisition, senão 'no_data';
--   3. p_channels filtra por esse canal calculado (lista por vírgula, OR entre
--      valores); 'direct' não casa com 'unknown'; total acompanha o filtro;
--   4. a chamada com os 11 argumentos nomeados antigos (sem p_channels) segue
--      funcionando e não filtra;
--   5. authenticated e anon não executam; service_role executa.

begin;
do $$
declare
  v_meta    uuid;
  v_unknown uuid;
  v_none    uuid;
  v_demo    uuid;
  v         jsonb;
  v_ids     uuid[];
  v_n       bigint;
  v_fn      text := 'public.admin_list_workspaces(text,text,int,int,timestamptz,text,boolean,text,timestamptz,text,text,text)';
  v_ch      text;
  r         record;
begin
  -- 1.
  select count(*) into v_n
    from pg_proc
   where proname = 'admin_list_workspaces' and pronamespace = 'public'::regnamespace;
  if v_n <> 1 then
    raise exception 'expected exactly one admin_list_workspaces, found %', v_n;
  end if;

  v_meta    := et_make_workspace('free'); update workspaces set name = 'ET acq chan meta'    where id = v_meta;
  v_unknown := et_make_workspace('free'); update workspaces set name = 'ET acq chan unknown' where id = v_unknown;
  v_none    := et_make_workspace('free'); update workspaces set name = 'ET acq chan none'    where id = v_none;
  v_demo    := et_make_workspace('free'); update workspaces set name = 'ET acq chan demo',
                                                                demo_created_at = now() where id = v_demo;

  insert into workspace_acquisition (workspace_id, first_touch, last_touch, channel, campaign, captured) values
    (v_meta, '{"utm_source":"meta","utm_medium":"paid"}', null, 'meta_ads', 'lp-nov', true),
    (v_unknown, null, null, 'unknown', null, false),
    -- a demo com canal guardado: 'demo' tem que vencer.
    (v_demo, '{"utm_source":"meta","utm_medium":"paid"}', null, 'meta_ads', null, true);

  set local role service_role;

  -- 2 + 4. sem filtro, com os 11 argumentos nomeados antigos.
  v := admin_list_workspaces(
    p_search := 'ET acq chan', p_plan_id := null, p_offset := 0, p_limit := 20, p_as_of := null,
    p_status := null, p_has_overrides := null, p_activity := null, p_created_since := null,
    p_sort := 'created_at', p_dir := 'desc');
  if (v ->> 'total')::int <> 4 then
    raise exception 'old 11-arg call must return the 4 seeded workspaces, got %', v ->> 'total';
  end if;
  for r in
    select * from (values
      (v_meta, 'meta_ads'), (v_unknown, 'unknown'), (v_none, 'no_data'), (v_demo, 'demo')
    ) as t(id, expected)
  loop
    if (select w ->> 'acquisition_channel'
          from jsonb_array_elements(v -> 'workspaces') w
         where (w ->> 'id')::uuid = r.id) is distinct from r.expected then
      raise exception 'workspace % must carry acquisition_channel %, got %', r.id, r.expected,
        (select w ->> 'acquisition_channel' from jsonb_array_elements(v -> 'workspaces') w
          where (w ->> 'id')::uuid = r.id);
    end if;
  end loop;

  -- 3. filtros.
  for r in
    select * from (values
      ('meta_ads', array[v_meta]),
      ('no_data', array[v_none]),
      ('direct', array[]::uuid[]),
      ('demo', array[v_demo]),
      ('unknown', array[v_unknown]),
      ('meta_ads,unknown', array[v_meta, v_unknown]),
      (' meta_ads , , demo ', array[v_meta, v_demo])
    ) as t(channels, expected)
  loop
    v := admin_list_workspaces(p_search := 'ET acq chan', p_channels := r.channels);
    select coalesce(array_agg((w ->> 'id')::uuid), '{}') into v_ids
      from jsonb_array_elements(v -> 'workspaces') w;
    if not (v_ids @> r.expected and r.expected @> v_ids) then
      raise exception 'p_channels=% must return %, got %', r.channels, r.expected, v_ids;
    end if;
    if (v ->> 'total')::int <> cardinality(r.expected) then
      raise exception 'p_channels=% total must be %, got %', r.channels, cardinality(r.expected), v ->> 'total';
    end if;
  end loop;

  -- NULL, '' e lista só de brancos não filtram.
  foreach v_ch in array array[null, '', ' , '] loop
    v := admin_list_workspaces(p_search := 'ET acq chan', p_channels := v_ch);
    if (v ->> 'total')::int <> 4 then
      raise exception 'p_channels=% must not filter, got total %', quote_nullable(v_ch), v ->> 'total';
    end if;
  end loop;

  -- posicional curto (como 99_usd_billing_candidates) segue resolvendo.
  v := admin_list_workspaces('ET acq chan', null, 0, 10);
  if (v ->> 'total')::int <> 4 then
    raise exception 'short positional call must still work, got total %', v ->> 'total';
  end if;

  reset role;

  -- 5. grants.
  if has_function_privilege('authenticated', v_fn, 'EXECUTE')
     or has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception 'authenticated/anon must not execute %', v_fn;
  end if;
  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'service_role must execute %', v_fn;
  end if;
end;
$$;
rollback;
