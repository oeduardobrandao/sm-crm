\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare
  v_active uuid; v_trial uuid; v_pastdue uuid; v_canceled uuid; v_nullstatus uuid; v_nosub uuid;
  v jsonb;
  function_ids uuid[];
begin
  v_active     := et_make_workspace('max'); update workspaces set name = 'ET status ativo'      where id = v_active;
  v_trial      := et_make_workspace('max'); update workspaces set name = 'ET status teste'      where id = v_trial;
  v_pastdue    := et_make_workspace('max'); update workspaces set name = 'ET status pendente'   where id = v_pastdue;
  v_canceled   := et_make_workspace('max'); update workspaces set name = 'ET status cancelado'  where id = v_canceled;
  v_nullstatus := et_make_workspace('max'); update workspaces set name = 'ET status nulo'       where id = v_nullstatus;
  v_nosub      := et_make_workspace('max'); update workspaces set name = 'ET status sem linha'  where id = v_nosub;

  insert into workspace_subscriptions (workspace_id, status, plan_id, failed_payment_count) values
    (v_active,     'active',   'max', 0),
    (v_trial,      'trialing', 'max', 0),
    (v_pastdue,    'past_due', 'max', 2),
    (v_canceled,   'canceled', 'max', 0),
    (v_nullstatus, null,       'max', 0);

  execute 'set local role service_role';

  v := admin_list_workspaces(p_search := 'ET status', p_status := 'ativo');
  assert (v ->> 'total')::int = 1 and (v -> 'workspaces' -> 0 ->> 'id')::uuid = v_active,
    format('ativo: expected only %s, got %s', v_active, v -> 'workspaces');

  v := admin_list_workspaces(p_search := 'ET status', p_status := 'teste');
  assert (v ->> 'total')::int = 1 and (v -> 'workspaces' -> 0 ->> 'id')::uuid = v_trial, 'teste filter';

  v := admin_list_workspaces(p_search := 'ET status', p_status := 'pendente');
  assert (v ->> 'total')::int = 1 and (v -> 'workspaces' -> 0 ->> 'id')::uuid = v_pastdue, 'pendente filter';
  assert (v -> 'workspaces' -> 0 -> 'subscription' ->> 'failed_payment_count')::int = 2,
    'subscription json must expose failed_payment_count';

  v := admin_list_workspaces(p_search := 'ET status', p_status := 'cancelado');
  assert (v ->> 'total')::int = 1 and (v -> 'workspaces' -> 0 ->> 'id')::uuid = v_canceled, 'cancelado filter';

  v := admin_list_workspaces(p_search := 'ET status', p_status := 'sem_assinatura');
  select array_agg((w ->> 'id')::uuid) into function_ids from jsonb_array_elements(v -> 'workspaces') w;
  assert (v ->> 'total')::int = 2, format('sem_assinatura: expected 2, got %s', v ->> 'total');
  assert v_nullstatus = any(function_ids) and v_nosub = any(function_ids),
    'sem_assinatura must include both the null-status row and the workspace with no row';

  v := admin_list_workspaces(p_search := 'ET status', p_status := 'garbage');
  assert (v ->> 'total')::int = 6, format('unknown p_status must not filter, got %s', v ->> 'total');

  v := admin_list_workspaces(p_search := 'ET status');
  assert (v ->> 'total')::int = 6, 'null p_status must not filter';

  execute 'reset role';
  raise notice 'PASS 70_admin_list_workspaces_status_filter';
end $$;
rollback;
