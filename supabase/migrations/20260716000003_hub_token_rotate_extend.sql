-- CRM-facing Hub token lifecycle actions.
--
-- Both are a single UPDATE and never INSERT. trg_limit_hub_tokens is BEFORE INSERT
-- and counts EVERY row for the workspace with no status predicate, so a
-- rotate-by-INSERT would permanently burn a max_hub_tokens slot per rotation and
-- eventually fail with plan_limit_exceeded — a billing error for a security action.
--
-- SECURITY DEFINER is required so the functions can write audit_log (which accepts
-- service-role inserts only). That bypasses RLS, so ownership is checked by hand.
--
-- get_my_conta_id() returns profiles.active_workspace_id — a NULLABLE scalar uuid
-- (20260315_rls_security_audit.sql:11). IS DISTINCT FROM is mandatory: with `<>` or
-- `NOT IN`, a NULL workspace makes the predicate NULL, the IF never fires, and any
-- caller could mutate any workspace's token.

create or replace function public.hub_token_rotate(p_token_id uuid)
returns table (token uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conta_id uuid;
  v_cliente_id bigint;
  v_old_expires timestamptz;
begin
  select t.conta_id, t.cliente_id, t.expires_at
    into v_conta_id, v_cliente_id, v_old_expires
    from client_hub_tokens t where t.id = p_token_id;

  if v_conta_id is null then raise exception 'not_found'; end if;
  if v_conta_id is distinct from public.get_my_conta_id() then
    raise exception 'forbidden';
  end if;

  update client_hub_tokens t
     set token = gen_random_uuid(),
         expires_at = now() + interval '365 days'
   where t.id = p_token_id
  returning t.token, t.expires_at into token, expires_at;

  insert into audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (v_conta_id, auth.uid(), 'hub_token.rotate', 'client_hub_tokens', p_token_id::text,
          jsonb_build_object('cliente_id', v_cliente_id,
                             'old_expires_at', v_old_expires,
                             'new_expires_at', expires_at));

  return next;
end;
$$;

create or replace function public.hub_token_extend(p_token_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conta_id uuid;
  v_cliente_id bigint;
  v_old_expires timestamptz;
  v_new_expires timestamptz;
begin
  select t.conta_id, t.cliente_id, t.expires_at
    into v_conta_id, v_cliente_id, v_old_expires
    from client_hub_tokens t where t.id = p_token_id;

  if v_conta_id is null then raise exception 'not_found'; end if;
  if v_conta_id is distinct from public.get_my_conta_id() then
    raise exception 'forbidden';
  end if;

  update client_hub_tokens t
     set expires_at = now() + interval '365 days'
   where t.id = p_token_id
  returning t.expires_at into v_new_expires;

  insert into audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (v_conta_id, auth.uid(), 'hub_token.extend', 'client_hub_tokens', p_token_id::text,
          jsonb_build_object('cliente_id', v_cliente_id,
                             'old_expires_at', v_old_expires,
                             'new_expires_at', v_new_expires));

  return v_new_expires;
end;
$$;

revoke all on function public.hub_token_rotate(uuid) from public, anon;
revoke all on function public.hub_token_extend(uuid) from public, anon;
grant execute on function public.hub_token_rotate(uuid) to authenticated;
grant execute on function public.hub_token_extend(uuid) to authenticated;
