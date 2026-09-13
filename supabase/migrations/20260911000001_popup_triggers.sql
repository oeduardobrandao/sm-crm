-- Gatilhos de popup por situacao de cobranca + frequencia diaria
-- (spec docs/superpowers/specs/2026-09-06-popup-triggers-design.md).
--
-- O gatilho e uma condicao lida na hora, na policy de SELECT, como o targeting por
-- plano: quando a assinatura sai da situacao, o popup some sozinho. Nada e criado
-- ou arquivado por evento (ver o comentario do DunningBanner no CRM).

alter table global_popups
  add column trigger text,
  add column trigger_days int;

alter table global_popups
  add constraint global_popups_trigger_check
    check (trigger is null or trigger in ('payment_pending', 'trial_ending', 'plan_downgraded')),
  -- coalesce obrigatorio: com trigger NULL, `trigger = 'trial_ending'` e NULL e
  -- `NULL = true` e NULL, que passa no CHECK. Sem ele, trigger NULL com
  -- trigger_days preenchido seria aceito.
  add constraint global_popups_trigger_days_check
    check (coalesce(trigger = 'trial_ending', false) = (trigger_days is not null)),
  add constraint global_popups_trigger_days_range_check
    check (trigger_days is null or trigger_days between 1 and 60);

alter table global_popups drop constraint global_popups_frequency_check;
alter table global_popups
  add constraint global_popups_frequency_check
    check (frequency in ('once', 'until_cta', 'daily'));
-- global_popups_ack_frequency_check (not (require_ack and frequency = 'until_cta'))
-- fica como esta: daily combina com confirmacao obrigatoria.

-- Sem parametro de usuario: le auth.uid() por dentro, entao via /rpc um usuario so
-- consegue perguntar sobre si mesmo. Dono resolvido por workspace_members, a mesma
-- regra da policy workspace_subscriptions_owner_read (20260804000001); o papel
-- global em profiles.role esta errado para isso.
create or replace function popup_trigger_matches(p_trigger text, p_days int)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select case
    when p_trigger is null then true
    else coalesce((
      select case p_trigger
        when 'payment_pending' then s.status = 'past_due'
        when 'trial_ending' then
          s.status = 'trialing'
          and s.current_period_end is not null
          and s.current_period_end > now()
          and s.current_period_end <= now() + make_interval(days => p_days)
        when 'plan_downgraded' then s.status = 'unpaid'
        else false
      end
      from profiles pr
      join workspace_members wm
        on wm.workspace_id = pr.conta_id
       and wm.user_id = pr.id
       and wm.role = 'owner'
      join workspace_subscriptions s on s.workspace_id = pr.conta_id
      where pr.id = auth.uid()
    ), false)
  end
$$;

-- Funcoes nascem executaveis por PUBLIC; security definer exige fechar isso.
-- O CLI local tambem concede EXECUTE direto a anon (nao via PUBLIC) na ACL
-- default do schema, entao revoke all ... from public sozinho nao bastaria.
revoke all on function popup_trigger_matches(text, int) from public, anon;
grant execute on function popup_trigger_matches(text, int) to authenticated;

drop policy "Authenticated users can read active popups matching their workspace" on global_popups;
create policy "Authenticated users can read active popups matching their workspace"
  on global_popups for select to authenticated
  using (
    status = 'active'
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
    and popup_trigger_matches(trigger, trigger_days)
    and (
      target_mode = 'all'
      or (
        target_mode = 'plan'
        and resolve_workspace_plan(
          (select conta_id from profiles where id = auth.uid())
        ) = any(target_plan_ids)
      )
      or (
        target_mode = 'workspace'
        and (select conta_id from profiles where id = auth.uid()) = any(target_workspace_ids)
      )
    )
  );
