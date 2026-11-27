\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Lembrete de confirmação de e-mail (migration 20261213000001):
-- get_confirm_reminder_candidates(p_now) e claim_confirm_reminder(...).
-- Relógio fixo: T = '2026-11-20 15:00:00+00'. Cada caso é uma transação
-- revertida; o fixture é um insert nu em auth.users, cujo trigger
-- (handle_new_user_workspace) já cria o workspace self-serve com
-- created_by = usuário e a linha 'owner' em workspace_members.

drop function if exists et_confirm_fixture(interval, boolean);

-- Usuário não confirmado criado há p_age antes de T.
create or replace function et_confirm_fixture(p_age interval, p_confirmed boolean default false)
returns uuid language plpgsql as $$
declare
  v_uid uuid := gen_random_uuid();
  v_t timestamptz := '2026-11-20 15:00:00+00';
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, created_at)
    values (v_uid, v_uid || '@et.test',
            case when p_confirmed then v_t else null end,
            '{}'::jsonb, v_t - p_age);
  update profiles set nome = 'Ana Silva' where id = v_uid;
  return v_uid;
end $$;

-- 0. Sanidade do fixture: dono de um workspace criado por ele.
begin;
  do $$
  declare u uuid; n int;
  begin
    u := et_confirm_fixture(interval '2 hours');
    select count(*) into n from workspaces w
      join workspace_members wm on wm.workspace_id = w.id and wm.user_id = u and wm.role = 'owner'
      where w.created_by = u;
    if n < 1 then raise exception 'fixture: usuario nao e dono de workspace proprio'; end if;
  end $$;
rollback;

-- 1. 2h, nao confirmado -> uma linha confirm_reminder_1h
begin;
  do $$
  declare u uuid; r record; n int; v_t timestamptz := '2026-11-20 15:00:00+00';
  begin
    u := et_confirm_fixture(interval '2 hours');
    select count(*) into n from get_confirm_reminder_candidates(v_t) c where c.user_id = u;
    if n <> 1 then raise exception '1h: % linhas, esperado 1', n; end if;
    select * into r from get_confirm_reminder_candidates(v_t) c where c.user_id = u;
    if r.email_type <> 'confirm_reminder_1h' or r.attempts <> 0
       or r.email <> u || '@et.test' or r.nome <> 'Ana Silva' then
      raise exception '1h: linha inesperada %', row_to_json(r);
    end if;
  end $$;
rollback;

-- 2. bordas das janelas
begin;
  do $$
  declare u uuid; r record; v_t timestamptz := '2026-11-20 15:00:00+00';
  begin
    -- exatamente 24h: so o de 24h
    u := et_confirm_fixture(interval '24 hours');
    if (select count(*) from get_confirm_reminder_candidates(v_t) c where c.user_id = u) <> 1 then
      raise exception '24h exato: esperado 1 linha';
    end if;
    select * into r from get_confirm_reminder_candidates(v_t) c where c.user_id = u;
    if r.email_type <> 'confirm_reminder_24h' then
      raise exception '24h exato: tipo % (esperado 24h)', r.email_type;
    end if;
    -- exatamente 1h: o de 1h
    u := et_confirm_fixture(interval '1 hour');
    select * into r from get_confirm_reminder_candidates(v_t) c where c.user_id = u;
    if r.email_type is distinct from 'confirm_reminder_1h' then
      raise exception '1h exato: tipo % (esperado 1h)', r.email_type;
    end if;
    -- 59 min: nada
    u := et_confirm_fixture(interval '59 minutes');
    if exists (select 1 from get_confirm_reminder_candidates(v_t) c where c.user_id = u) then
      raise exception '59min: nao deveria listar';
    end if;
    -- exatamente 72h: ainda 24h? janela e (now-72h, now-24h], entao 72h exato fica fora
    u := et_confirm_fixture(interval '72 hours');
    if exists (select 1 from get_confirm_reminder_candidates(v_t) c where c.user_id = u) then
      raise exception '72h exato: nao deveria listar';
    end if;
    u := et_confirm_fixture(interval '71 hours');
    select * into r from get_confirm_reminder_candidates(v_t) c where c.user_id = u;
    if r.email_type is distinct from 'confirm_reminder_24h' then
      raise exception '71h: tipo % (esperado 24h)', r.email_type;
    end if;
  end $$;
rollback;

-- 3. 30h com 1h enviado recentemente espera; com 1h antigo recebe o de 24h
begin;
  do $$
  declare u uuid; r record; v_t timestamptz := '2026-11-20 15:00:00+00';
  begin
    u := et_confirm_fixture(interval '30 hours');
    insert into lifecycle_emails (email_type, user_id, sent_at, delivered_at, attempts)
      values ('confirm_reminder_1h', u, v_t - interval '6 hours', v_t - interval '6 hours', 1);
    if exists (select 1 from get_confirm_reminder_candidates(v_t) c where c.user_id = u) then
      raise exception '30h com 1h enviado ha 6h: nao deveria listar';
    end if;
    update lifecycle_emails set sent_at = v_t - interval '20 hours', delivered_at = v_t - interval '20 hours'
      where user_id = u and email_type = 'confirm_reminder_1h';
    select * into r from get_confirm_reminder_candidates(v_t) c where c.user_id = u;
    if r.email_type is distinct from 'confirm_reminder_24h' then
      raise exception '30h com 1h antigo: tipo % (esperado 24h)', r.email_type;
    end if;
  end $$;
rollback;

-- 4. exclusoes
begin;
  do $$
  declare u uuid; v_t timestamptz := '2026-11-20 15:00:00+00';
  begin
    u := et_confirm_fixture(interval '5 days');
    if exists (select 1 from get_confirm_reminder_candidates(v_t) c where c.user_id = u) then
      raise exception '5 dias: backlog nao deveria listar';
    end if;
    u := et_confirm_fixture(interval '2 hours', true);
    if exists (select 1 from get_confirm_reminder_candidates(v_t) c where c.user_id = u) then
      raise exception 'confirmado: nao deveria listar';
    end if;
    u := et_confirm_fixture(interval '2 hours');
    update auth.users set raw_user_meta_data = jsonb_build_object('conta_id', gen_random_uuid()::text) where id = u;
    if exists (select 1 from get_confirm_reminder_candidates(v_t) c where c.user_id = u) then
      raise exception 'convidado: nao deveria listar';
    end if;
    u := et_confirm_fixture(interval '2 hours');
    update auth.users set is_sso_user = true where id = u;
    if exists (select 1 from get_confirm_reminder_candidates(v_t) c where c.user_id = u) then
      raise exception 'sso: nao deveria listar';
    end if;
  end $$;
rollback;

-- 5. claim
begin;
  do $$
  declare u uuid; n int; v_t timestamptz := '2026-11-20 15:00:00+00';
  begin
    u := et_confirm_fixture(interval '2 hours');
    n := claim_confirm_reminder(u, 'confirm_reminder_1h', v_t);
    if n is distinct from 1 then raise exception 'claim 1: % (esperado 1)', n; end if;
    n := claim_confirm_reminder(u, 'confirm_reminder_1h', v_t);
    if n is not null then raise exception 'claim imediato: % (esperado null)', n; end if;
    -- 2h depois, ainda nao entregue, ainda dentro da janela de 24h: tentativa 2
    n := claim_confirm_reminder(u, 'confirm_reminder_1h', v_t + interval '2 hours');
    if n is distinct from 2 then raise exception 'claim retry: % (esperado 2)', n; end if;
    -- teto de 3 tentativas
    update lifecycle_emails set attempts = 3, sent_at = v_t - interval '5 hours'
      where user_id = u and email_type = 'confirm_reminder_1h';
    n := claim_confirm_reminder(u, 'confirm_reminder_1h', v_t);
    if n is not null then raise exception 'claim attempts=3: % (esperado null)', n; end if;
    -- entregue: nunca mais
    update lifecycle_emails set attempts = 1, delivered_at = v_t - interval '5 hours'
      where user_id = u and email_type = 'confirm_reminder_1h';
    n := claim_confirm_reminder(u, 'confirm_reminder_1h', v_t);
    if n is not null then raise exception 'claim entregue: % (esperado null)', n; end if;
  end $$;
rollback;

-- 6. claim revalida
begin;
  do $$
  declare u uuid; n int; v_t timestamptz := '2026-11-20 15:00:00+00';
  begin
    -- confirmou entre a leitura e o envio
    u := et_confirm_fixture(interval '2 hours');
    update auth.users set email_confirmed_at = v_t where id = u;
    n := claim_confirm_reminder(u, 'confirm_reminder_1h', v_t);
    if n is not null then raise exception 'claim apos confirmar: % (esperado null)', n; end if;
    if exists (select 1 from lifecycle_emails where user_id = u) then
      raise exception 'claim recusado nao deveria gravar linha';
    end if;
    -- tipo invalido
    u := et_confirm_fixture(interval '2 hours');
    n := claim_confirm_reminder(u, 'x', v_t);
    if n is not null then raise exception 'claim tipo x: % (esperado null)', n; end if;
    -- 1h para quem tem 30h: fora da janela
    u := et_confirm_fixture(interval '30 hours');
    n := claim_confirm_reminder(u, 'confirm_reminder_1h', v_t);
    if n is not null then raise exception 'claim 1h com 30h: % (esperado null)', n; end if;
    n := claim_confirm_reminder(u, 'confirm_reminder_24h', v_t);
    if n is distinct from 1 then raise exception 'claim 24h com 30h: % (esperado 1)', n; end if;
  end $$;
rollback;

-- 7. ACL
do $$
declare f text;
begin
  foreach f in array array[
    'public._confirm_reminder_eligible(uuid, text, timestamptz)',
    'public.get_confirm_reminder_candidates(timestamptz)',
    'public.claim_confirm_reminder(uuid, text, timestamptz)'
  ] loop
    if has_function_privilege('authenticated', f, 'execute')
       or has_function_privilege('anon', f, 'execute') then
      raise exception 'ACL: % executavel por anon/authenticated', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception 'ACL: % nao executavel por service_role', f;
    end if;
  end loop;
end $$;

drop function et_confirm_fixture(interval, boolean);
