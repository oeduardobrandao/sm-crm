-- Correlação de dunning do Pagar.me: última chave charge_id:attempt processada.
-- Mesmo par charge+attempt = redelivery (nunca re-avança estágio nem re-envia e-mail);
-- par novo = retry real (avança). Ver buildChargeDunningKey em _shared/pagarme-logic.ts.
alter table workspace_subscriptions add column pagarme_dunning_key text;

comment on column workspace_subscriptions.pagarme_dunning_key is
  'Last processed Pagar.me charge-failure dunning key (charge_id:attempt). Redeliveries repeat the key and never advance the dunning stage.';
