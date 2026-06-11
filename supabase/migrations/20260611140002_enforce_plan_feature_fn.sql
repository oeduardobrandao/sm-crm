-- Generic BEFORE INSERT [OR UPDATE] feature gate. TG_ARGV:
--   [0] feature_key   e.g. 'feature_ideas'
--   [1] ws_mode       'direct' | 'via_clientes'
--   [2] ws_column     workspace-id column on NEW (direct) or clientes FK (via_clientes)
create or replace function enforce_plan_feature()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_feature_key text := TG_ARGV[0];
  v_ws_mode     text := TG_ARGV[1];
  v_ws_col      text := TG_ARGV[2];
  v_ws_id       uuid;
begin
  if v_ws_mode = 'via_clientes' then
    execute format('select conta_id from clientes where id = ($1).%I', v_ws_col)
      using NEW into v_ws_id;
  else
    execute format('select (($1).%I)::uuid', v_ws_col) using NEW into v_ws_id;
  end if;
  if v_ws_id is null then
    return NEW; -- cannot resolve; defer
  end if;

  if not effective_plan_feature(v_ws_id, v_feature_key) then
    raise exception 'feature_disabled:%', v_feature_key using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;
