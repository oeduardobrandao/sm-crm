-- Per-installment price of the 12x annual (in cents). The à vista annual keeps
-- price_brl_annual; the 12x has its own, higher price with the financing embedded.
-- Total charged by the gateway = pagarme_installment_cents * 12 (the Pagar.me plan
-- object must be created at that total).
alter table plans add column pagarme_installment_cents int;

comment on column plans.pagarme_installment_cents is
  'Parcela do 12x em centavos; total = x12. Null = plano sem 12x configurado.';

-- Backfill (accepted external finding): any environment where pagarme_12x_enabled is already
-- true (staging's start, since the Fase 7 E2E) would otherwise 400 plan_not_configured the
-- moment the new pagarme-checkout deploys, until an admin fills the column by hand. The
-- approved parcelas are seeded id-scoped and only where null, so a future admin edit is
-- never clobbered.
update plans set pagarme_installment_cents = 9490  where id = 'start' and pagarme_installment_cents is null;
update plans set pagarme_installment_cents = 12990 where id = 'pro'   and pagarme_installment_cents is null;
update plans set pagarme_installment_cents = 18490 where id = 'max'   and pagarme_installment_cents is null;
