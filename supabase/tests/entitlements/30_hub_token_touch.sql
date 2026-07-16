\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint;
  v_tok uuid; v_before timestamptz; v_after timestamptz;
begin
  v_ws := et_make_workspace('start');
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;

  -- CASE 1: inside the window -> renews to ~365d
  insert into client_hub_tokens (cliente_id, conta_id, expires_at)
    values (v_cli, v_ws, now() + interval '10 days')
    returning token into v_tok;
  perform hub_token_touch(v_tok);
  select expires_at into v_after from client_hub_tokens where token = v_tok;
  assert v_after > now() + interval '364 days',
    'touch must renew a token inside the window';

  -- CASE 2: already expired -> must NOT resurrect
  insert into client_hub_tokens (cliente_id, conta_id, expires_at)
    values (v_cli, v_ws, now() - interval '1 day')
    returning token into v_tok;
  select expires_at into v_before from client_hub_tokens where token = v_tok;
  perform hub_token_touch(v_tok);
  select expires_at into v_after from client_hub_tokens where token = v_tok;
  assert v_after = v_before,
    'touch must NEVER resurrect an expired token';

  -- CASE 3: outside the throttle -> must NOT write
  insert into client_hub_tokens (cliente_id, conta_id, expires_at)
    values (v_cli, v_ws, now() + interval '360 days')
    returning token into v_tok;
  select expires_at into v_before from client_hub_tokens where token = v_tok;
  perform hub_token_touch(v_tok);
  select expires_at into v_after from client_hub_tokens where token = v_tok;
  assert v_after = v_before,
    'touch must not write when expires_at is beyond the 350d throttle';

  -- CASE 4: unknown token -> no error, no rows
  perform hub_token_touch(gen_random_uuid());

  raise notice 'PASS 30_hub_token_touch';
end $$;
rollback;
