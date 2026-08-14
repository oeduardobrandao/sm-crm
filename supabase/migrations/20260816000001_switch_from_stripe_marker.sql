-- Switch seamless mensal Stripe -> anual 12x Pagar.me (spec 2026-08-14).

-- 1) Markers do switch + bookkeeping de rotacao do leg D do billing-downgrade-cron.
alter table workspace_subscriptions
  add column switched_from_stripe_subscription_id text,
  add column switched_from_plan_id text,
  add column switch_checked_at timestamptz;

comment on column workspace_subscriptions.switched_from_stripe_subscription_id is
  'Non-null = 12x Pagar.me vinculado por switch a partir deste mensal Stripe. O cron (leg D) confirma o cancel_at_period_end remoto e limpa quando seguro; enquanto a linha esta trialing tambem habilita o undo e o estado "Troca agendada" no frontend.';
comment on column workspace_subscriptions.switched_from_plan_id is
  'Plano-fonte no momento do switch. O undo restaura plan_id daqui: precos Stripe legados nao sao resolviveis via resolvePlanFromPriceId.';
comment on column workspace_subscriptions.switch_checked_at is
  'Bookkeeping do leg D (rotacao justa da fila de markers). Fora dos statements de invariante.';

create index workspace_subscriptions_switch_marker
  on workspace_subscriptions (switch_checked_at, workspace_id)
  where switched_from_stripe_subscription_id is not null;

-- 2) Estado quarantined nas attempts (born-active do switch; decisao 10 do spec).
alter table pagarme_checkout_attempts
  drop constraint pagarme_checkout_attempts_state_check;
alter table pagarme_checkout_attempts
  add constraint pagarme_checkout_attempts_state_check
  check (state in ('pending','succeeded','failed','expired','quarantined'));

-- 3) Garantia atomica da quarentena: o indice so-pending deixa um INSERT concorrente
-- entrar no exato instante em que a attempt sai de pending para quarantined.
drop index one_pending_attempt_per_workspace;
create unique index one_blocking_attempt_per_workspace
  on pagarme_checkout_attempts (workspace_id)
  where state in ('pending','quarantined');
