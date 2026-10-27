-- Trial-first onboarding: offer marker, reminder ledger columns, candidate RPC,
-- switch marker.
-- Spec: docs/superpowers/specs/2026-10-27-trial-first-onboarding-design.md
--
-- Apply BEFORE deploying lifecycle-email-cron and pagarme-checkout: the cron
-- calls get_trial_reminder_candidates() and writes lifecycle_emails.ref_at /
-- meta, and pagarme-checkout writes workspace_subscriptions.switched_from_trialing.
--
-- Rollback note: drop the two functions and the new columns if needed, but KEEP
-- the lifecycle_emails rows (email_type = 'trial_reminder'). They are the
-- "never send two" ledger; deleting them would let a re-deploy mail the same
-- trial again.

-- 1) Offer marker. Set once, by mark_trial_offer_seen(), the first time the
-- /comecar trial offer is shown to the workspace owner. workspaces has
-- table-level grants, so no grant bookkeeping is needed for the new column.
alter table workspaces
  add column if not exists trial_offer_seen_at timestamptz null;

comment on column workspaces.trial_offer_seen_at is
  'Quando o dono do workspace viu a oferta de teste de 30 dias na tela /comecar pela primeira vez. Escrito so por mark_trial_offer_seen(); null = ainda nao viu. Evita reabrir a tela a cada login.';

-- 2) Reminder ledger columns. ref_at identifies WHICH first charge a row is
-- about: if the trial end moves (extension, switch), ref_at no longer matches
-- current_period_end and the workspace becomes a candidate again with a fresh
-- attempts counter.
alter table lifecycle_emails
  add column if not exists ref_at timestamptz null,
  add column if not exists meta jsonb null;

comment on column lifecycle_emails.ref_at is
  'Data da primeira cobranca a que a linha se refere (trial_reminder: current_period_end no envio). Se current_period_end mudar, a linha deixa de valer e o workspace volta a ser candidato.';
comment on column lifecycle_emails.meta is
  'Anuncio do envio, como enviado: {to, amount_cents, amount_interval, provider, first_charge_at}. Auditoria de "o que prometemos".';

-- 3) Switch marker. Written by pagarme-checkout when a Stripe subscription that
-- was still trialing is switched to Pagar.me 12x, so the trial reminder knows
-- the new row inherits the trial (not a paid-period switch).
alter table workspace_subscriptions
  add column if not exists switched_from_trialing boolean null;

comment on column workspace_subscriptions.switched_from_trialing is
  'true = o switch Stripe -> Pagar.me 12x aconteceu enquanto a assinatura de origem ainda estava em teste (trialing). Escrito por pagarme-checkout. null/false = switch de periodo pago ou sem switch.';

-- 4) mark_trial_offer_seen(): stamp the CALLER's active workspace, owners only,
-- first call wins. Anything else is a silent no-op (the screen must never fail
-- because of bookkeeping). Active workspace = profiles.conta_id.
create or replace function mark_trial_offer_seen()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update workspaces w
     set trial_offer_seen_at = now()
   where w.id = (select p.conta_id from profiles p where p.id = auth.uid())
     and w.trial_offer_seen_at is null
     and exists (
       select 1
       from workspace_members wm
       where wm.workspace_id = w.id
         and wm.user_id = auth.uid()
         and wm.role = 'owner'
     );
end
$$;

revoke all on function mark_trial_offer_seen() from public, anon;
grant execute on function mark_trial_offer_seen() to authenticated;

-- 5) Trial reminder candidates (consumed by lifecycle-email-cron, service role
-- only). A candidate is a trialing subscription whose first charge is 3 to 7
-- days (+1h slack, so a normal hourly send at 7d00m-7d59m still qualifies)
-- away, not cancelling, and not a paid-period switch. Owner resolved exactly as
-- in get_thankyou_email_candidates: workspaces.created_by if still an owner,
-- else oldest owner by joined_at, tie by user_id.
--
-- Ledger (email_type = 'trial_reminder', one row per workspace):
--   - no row                                    -> candidate;
--   - ref_at differs from current_period_end    -> candidate again, and
--     attempts is reported as 0 (a new identity restarts the retry budget);
--   - undelivered claim older than 1h, < 30 attempts -> stale claim, retry.
create or replace function get_trial_reminder_candidates()
returns table (
  workspace_id uuid,
  workspace_name text,
  owner_email text,
  owner_nome text,
  plan_name text,
  provider text,
  amount_cents int,
  amount_interval text,
  billing_interval text,
  first_charge_at timestamptz,
  attempts int
)
language sql
security definer
set search_path = public
as $$
  select ws.id,
         ws.name,
         u.email::text,
         p.nome,
         pl.name,
         s.provider,
         s.amount_cents,
         s.amount_interval,
         s.billing_interval,
         s.current_period_end,
         case
           when le.id is null or le.ref_at is distinct from s.current_period_end then 0
           else le.attempts
         end
  from workspace_subscriptions s
  join workspaces ws on ws.id = s.workspace_id
  cross join lateral (
    select wm.user_id
    from workspace_members wm
    where wm.workspace_id = ws.id and wm.role = 'owner'
    order by (wm.user_id = ws.created_by) desc, wm.joined_at asc, wm.user_id asc
    limit 1
  ) owner_pick
  join auth.users u on u.id = owner_pick.user_id
  left join profiles p on p.id = owner_pick.user_id
  left join plans pl on pl.id = s.plan_id
  left join lifecycle_emails le
    on le.email_type = 'trial_reminder' and le.workspace_id = ws.id
  where s.status = 'trialing'
    and s.cancel_at_period_end = false
    and s.current_period_end is not null
    and s.current_period_end between now() + interval '3 days'
                                 and now() + interval '7 days 1 hour'
    and (s.switched_from_stripe_subscription_id is null
         or s.switched_from_trialing is true)
    and u.email is not null
    and (le.id is null
         or le.ref_at is distinct from s.current_period_end
         or (le.delivered_at is null
             and le.sent_at <= now() - interval '1 hour'
             and le.attempts < 30))
  order by s.current_period_end asc, ws.id asc
  limit 50
$$;

-- REVOKE FROM PUBLIC alone also strips service_role (bit this repo before):
-- name every role and GRANT explicitly. Verify with proacl, not
-- has_function_privilege.
revoke all on function get_trial_reminder_candidates() from public, anon, authenticated;
grant execute on function get_trial_reminder_candidates() to service_role;
