-- Lembrete de confirmação de e-mail no cadastro (spec
-- docs/superpowers/specs/2026-11-27-signup-confirm-reminder-design.md).
--
-- Donos self-serve que criaram a conta e nunca confirmaram o e-mail recebem
-- até dois lembretes (confirm_reminder_1h, confirm_reminder_24h), enviados pelo
-- lifecycle-email-cron. Três funções, todas só do service_role:
--   _confirm_reminder_eligible(user, tipo, now)  filtro + janela do tipo
--   get_confirm_reminder_candidates(now)         lista (limite 50)
--   claim_confirm_reminder(user, tipo, now)      reserva o envio (attempts ou null)
--
-- Janelas semiabertas, medidas em auth.users.created_at:
--   1h : now - 24h <  created_at <= now - 1h
--   24h: now - 72h <  created_at <= now - 24h, e sem confirm_reminder_1h
--        com sent_at > now - 12h (quem acabou de receber o de 1h espera)
-- Quem se cadastrou há mais de 72 h nunca recebe nada (deploy com backlog).
--
-- O claim revalida a elegibilidade antes do upsert: quem confirmou entre a
-- leitura dos candidatos e o envio não recebe. auth.users não é travada
-- (pertence ao supabase_auth_admin na hospedagem); a corrida restante é
-- aceita, o cron ainda confere email_confirmed_at ao gerar o link.
--
-- Rollback: drop function das três (claim, get_..., _confirm_reminder_eligible).
-- Linhas de lifecycle_emails ficam (nunca apague).

create or replace function public._confirm_reminder_eligible(
  p_user_id uuid,
  p_email_type text,
  p_now timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = p_user_id
      and p_email_type in ('confirm_reminder_1h', 'confirm_reminder_24h')
      and u.email_confirmed_at is null
      and u.email is not null
      and u.deleted_at is null
      and u.is_sso_user = false
      and u.is_anonymous = false
      and nullif(u.raw_user_meta_data ->> 'conta_id', '') is null
      and exists (
        select 1
        from public.workspaces ws
        join public.workspace_members wm
          on wm.workspace_id = ws.id and wm.user_id = u.id and wm.role = 'owner'
        where ws.created_by = u.id
      )
      and case p_email_type
            when 'confirm_reminder_1h' then
              u.created_at >  p_now - interval '24 hours'
              and u.created_at <= p_now - interval '1 hour'
            else
              u.created_at >  p_now - interval '72 hours'
              and u.created_at <= p_now - interval '24 hours'
              and not exists (
                select 1 from public.lifecycle_emails le
                where le.user_id = u.id
                  and le.email_type = 'confirm_reminder_1h'
                  and le.sent_at > p_now - interval '12 hours'
              )
          end
  )
$$;

create or replace function public.get_confirm_reminder_candidates(p_now timestamptz)
returns table (user_id uuid, email text, nome text, email_type text, attempts int)
language sql
stable
security definer
set search_path = public
as $$
  select u.id as user_id,
         u.email::text as email,
         p.nome,
         t.email_type,
         coalesce(le.attempts, 0) as attempts
  from auth.users u
  cross join (values ('confirm_reminder_1h'), ('confirm_reminder_24h')) as t(email_type)
  left join public.lifecycle_emails le
    on le.email_type = t.email_type and le.user_id = u.id
  left join public.profiles p on p.id = u.id
  where u.email_confirmed_at is null
    and u.created_at > p_now - interval '72 hours'
    and u.created_at <= p_now - interval '1 hour'
    and (le.id is null
         or (le.delivered_at is null
             and le.sent_at <= p_now - interval '1 hour'
             and le.attempts < 3))
    and public._confirm_reminder_eligible(u.id, t.email_type, p_now)
  order by u.created_at asc, u.id asc
  limit 50
$$;

create or replace function public.claim_confirm_reminder(
  p_user_id uuid,
  p_email_type text,
  p_now timestamptz default now()
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts int;
begin
  if p_user_id is null
     or not public._confirm_reminder_eligible(p_user_id, p_email_type, p_now) then
    return null;
  end if;

  insert into public.lifecycle_emails as le (email_type, user_id, sent_at, attempts)
  values (p_email_type, p_user_id, p_now, 1)
  on conflict (email_type, user_id) do update
    set sent_at = p_now,
        attempts = le.attempts + 1,
        delivered_at = null
    where le.delivered_at is null
      and le.sent_at <= p_now - interval '1 hour'
      and le.attempts < 3
  returning le.attempts into v_attempts;

  return v_attempts;
end
$$;

-- REVOKE FROM PUBLIC sozinho não tira anon/authenticated no Supabase: nomeie
-- os papéis e conceda explicitamente.
revoke all on function public._confirm_reminder_eligible(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public._confirm_reminder_eligible(uuid, text, timestamptz)
  to service_role;

revoke all on function public.get_confirm_reminder_candidates(timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_confirm_reminder_candidates(timestamptz)
  to service_role;

revoke all on function public.claim_confirm_reminder(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_confirm_reminder(uuid, text, timestamptz)
  to service_role;
