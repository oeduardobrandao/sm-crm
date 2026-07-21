\set ON_ERROR_STOP on
begin;
do $$
declare
  v_no_pw    uuid := gen_random_uuid();
  v_empty_pw uuid := gen_random_uuid();
  v_real_pw  uuid := gen_random_uuid();
begin
  insert into auth.users (id, encrypted_password) values (v_no_pw, null);
  insert into auth.users (id, encrypted_password) values (v_empty_pw, '');
  insert into auth.users (id, encrypted_password) values (v_real_pw, '$2a$10$C6UzMDM.H6dfI/f/IKcEe.');

  assert user_has_password(v_no_pw) = false, 'NULL password must read as false';
  assert user_has_password(v_empty_pw) = false, 'empty-string password must read as false';
  assert user_has_password(v_real_pw) = true, 'real hash must read as true';
  assert user_has_password(gen_random_uuid()) is null, 'unknown user must read as null';

  assert has_function_privilege('authenticated', 'public.user_has_password(uuid)', 'execute') = false,
    'authenticated must NOT be able to execute user_has_password';
  assert has_function_privilege('anon', 'public.user_has_password(uuid)', 'execute') = false,
    'anon must NOT be able to execute user_has_password';

  raise notice 'user_has_password: all cases passed';
end $$;
rollback;
