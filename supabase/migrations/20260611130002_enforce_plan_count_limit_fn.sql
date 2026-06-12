-- Generic BEFORE INSERT count limiter. TG_ARGV:
--   [0] limit_key      e.g. 'max_clients' (a column on plans)
--   [1] ws_mode        'direct' | 'via_clientes'
--   [2] ws_column      column on NEW holding the workspace id (direct),
--                      or the clientes FK column to join through (via_clientes)
--   [3] scope_column   column on NEW that buckets the count (direct mode only)
--   [4] status_pred    optional extra WHERE predicate, e.g. "status = 'ativo'"
create or replace function enforce_plan_count_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit_key text := TG_ARGV[0];
  v_ws_mode   text := TG_ARGV[1];
  v_ws_col    text := TG_ARGV[2];
  v_scope_col text := TG_ARGV[3];
  v_pred      text := coalesce(TG_ARGV[4], '');
  v_ws_id     uuid;
  v_scope_val text;
  v_limit     bigint;
  v_count     bigint;
  v_sql       text;
begin
  -- resolve workspace id from NEW
  if v_ws_mode = 'via_clientes' then
    execute format('select conta_id from clientes where id = ($1).%I', v_ws_col)
      using NEW into v_ws_id;
  else
    execute format('select (($1).%I)::uuid', v_ws_col) using NEW into v_ws_id;
  end if;
  if v_ws_id is null then
    return NEW; -- cannot resolve workspace; defer to other constraints
  end if;

  -- serialize concurrent inserts for this (workspace, limit) to prevent overshoot
  perform pg_advisory_xact_lock(hashtext(v_ws_id::text || ':' || v_limit_key));

  v_limit := effective_plan_limit(v_ws_id, v_limit_key);
  if v_limit is null then
    return NEW; -- unlimited
  end if;

  if v_ws_mode = 'via_clientes' then
    -- workspace-wide count across the clientes join
    v_sql := format(
      'select count(*) from %I t join clientes c on c.id = t.%I where c.conta_id = $1',
      TG_TABLE_NAME, v_ws_col);
    execute v_sql using v_ws_id into v_count;
  else
    execute format('select (($1).%I)::text', v_scope_col) using NEW into v_scope_val;
    -- Cast $1 explicitly; the scope value was read from the same column type,
    -- so casting back via the column avoids implicit text→typed mismatches.
    v_sql := format('select count(*) from %I where %I::text = $1', TG_TABLE_NAME, v_scope_col);
    if v_pred <> '' then
      v_sql := v_sql || ' and ' || v_pred;
    end if;
    execute v_sql using v_scope_val into v_count;
  end if;

  if v_count >= v_limit then
    raise exception 'plan_limit_exceeded:%', v_limit_key using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;
