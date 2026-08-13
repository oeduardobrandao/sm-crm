-- Per-installment price of the 12x annual (in cents). The à vista annual keeps
-- price_brl_annual; the 12x has its own, higher price with the financing embedded.
-- Total charged by the gateway = pagarme_installment_cents * 12 (the Pagar.me plan
-- object must be created at that total).
alter table plans add column pagarme_installment_cents int;

comment on column plans.pagarme_installment_cents is
  'Parcela do 12x em centavos; total = x12. Null = plano sem 12x configurado.';
