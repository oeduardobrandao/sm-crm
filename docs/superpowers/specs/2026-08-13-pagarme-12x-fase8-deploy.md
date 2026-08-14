# Pagar.me 12x — Fase 8: runbook de deploy/flip

Delta de deploy da Fase 8 (preço próprio do 12x + coexistência com o anual à vista). Executar
somente sob ordem explícita do Eduardo — nenhum destes passos roda em CI. Pré-requisito: a
migration `20260815000001_pagarme_installment_price.sql` já existe no branch (coluna
`plans.pagarme_installment_cents`, com backfill id-scoped para `start`/`pro`/`max`).

> **Contexto:** o gateway cobra o preço do OBJETO PLAN do Pagar.me; a linha `plans` é o espelho.
> O log CRITICAL de price-drift (Fase 8, Task 2) é o alarme se os dois divergirem — criar/atualizar
> os objetos é sempre um passo manual de ops, nunca automático.

## 1. Migration (db push)

Additive-only, segura antes dos deploys de function:

```bash
npx supabase db push --linked   # staging primeiro, depois prod (ver refs abaixo)
```

- **Staging:** `wlyzhyfondykzpsiqsce`
- **Prod:** `skjzpekeqefvlojenfsw`

`cat supabase/.temp/project-ref` antes de cada push — o link state flipa entre sessões e é fácil
empurrar para o projeto errado.

O backfill embutido na migration (`update plans set pagarme_installment_cents = ... where id =
'start'/'pro'/'max' and pagarme_installment_cents is null`) já resolve o caso staging: como
`pagarme_12x_enabled` já está `true` lá desde o E2E da Fase 7, sem esse backfill o `pagarme-checkout`
novo devolveria `400 plan_not_configured` no instante do deploy da function, antes de qualquer admin
preencher a coluna à mão. Rodar a migration ANTES do deploy das functions evita essa janela.

## 2. Deploy das functions (ambos os ambientes)

```bash
npx supabase functions deploy platform-admin   --no-verify-jwt --use-api
npx supabase functions deploy pagarme-checkout --no-verify-jwt --use-api
npx supabase functions deploy billing-checkout --no-verify-jwt --use-api
```

Rodar em staging e em prod (troque o link/project-ref entre as duas rodadas). `--use-api` é
obrigatório aqui: o bundler local do Docker está quebrado neste ambiente (bundling server-side).

## 3. STAGING — criar objetos de plano novos + configurar as linhas + ligar a flag

### 3.1 Criar os 3 objetos `plan` novos no sandbox

Chave de teste em `~/.pagarme-spike.env` (fora do repo; nunca commitar, nunca passar como
argumento literal de CLI — sempre por redirecionamento de arquivo). Mesmo shape usado no spike
(`docs/superpowers/specs/2026-08-10-pagarme-12x-fase0-spike/spike.ts`, `createPlan()`):
`interval: "year"`, `installments: [1, 12]`, `billing_type: "prepaid"`, preço TOTAL do ano (não a
parcela) em `items[0].pricing_scheme.price`.

```bash
set -a; source ~/.pagarme-spike.env; set +a   # exporta PAGARME_TEST_SECRET_KEY sem ecoar no shell

# start — total 113880 (= 9490 × 12)
curl -sS -u "${PAGARME_TEST_SECRET_KEY}:" \
  -H 'Content-Type: application/json' \
  -X POST https://api.pagar.me/core/v5/plans \
  -d '{
    "name": "Start anual 12x (fase 8)",
    "interval": "year",
    "interval_count": 1,
    "billing_type": "prepaid",
    "payment_methods": ["credit_card"],
    "installments": [1, 12],
    "currency": "BRL",
    "items": [
      { "name": "Plano Start anual", "quantity": 1,
        "pricing_scheme": { "scheme_type": "unit", "price": 113880 } }
    ],
    "metadata": { "plan_id": "start", "fase": "8" }
  }'

# pro — total 155880 (= 12990 × 12)
curl -sS -u "${PAGARME_TEST_SECRET_KEY}:" \
  -H 'Content-Type: application/json' \
  -X POST https://api.pagar.me/core/v5/plans \
  -d '{
    "name": "Pro anual 12x (fase 8)",
    "interval": "year",
    "interval_count": 1,
    "billing_type": "prepaid",
    "payment_methods": ["credit_card"],
    "installments": [1, 12],
    "currency": "BRL",
    "items": [
      { "name": "Plano Pro anual", "quantity": 1,
        "pricing_scheme": { "scheme_type": "unit", "price": 155880 } }
    ],
    "metadata": { "plan_id": "pro", "fase": "8" }
  }'

# max — total 221880 (= 18490 × 12)
curl -sS -u "${PAGARME_TEST_SECRET_KEY}:" \
  -H 'Content-Type: application/json' \
  -X POST https://api.pagar.me/core/v5/plans \
  -d '{
    "name": "Max anual 12x (fase 8)",
    "interval": "year",
    "interval_count": 1,
    "billing_type": "prepaid",
    "payment_methods": ["credit_card"],
    "installments": [1, 12],
    "currency": "BRL",
    "items": [
      { "name": "Plano Max anual", "quantity": 1,
        "pricing_scheme": { "scheme_type": "unit", "price": 221880 } }
    ],
    "metadata": { "plan_id": "max", "fase": "8" }
  }'
```

Anote os três `id` (`plan_...`) da resposta — vão para o passo 3.2.

### 3.2 Atualizar as linhas `plans` — UMA instrução por plano, objeto + parcela juntos

Cada `UPDATE` grava `pagarme_plan_id_annual` (o objeto novo do 3.1) e `pagarme_installment_cents`
na MESMA instrução, para nunca deixar uma linha com o objeto novo e a parcela antiga (ou
vice-versa) visível entre dois updates:

```sql
update plans
   set pagarme_plan_id_annual = 'plan_XXXXXXXXXXXXXXXX',  -- id retornado para "start"
       pagarme_installment_cents = 9490
 where id = 'start';

update plans
   set pagarme_plan_id_annual = 'plan_YYYYYYYYYYYYYYYY',  -- id retornado para "pro"
       pagarme_installment_cents = 12990
 where id = 'pro';

update plans
   set pagarme_plan_id_annual = 'plan_ZZZZZZZZZZZZZZZZ',  -- id retornado para "max"
       pagarme_installment_cents = 18490
 where id = 'max';
```

Rode via `npx supabase db query --linked` (staging) ou pelo SQL editor do projeto.

### 3.3 Ligar a flag — SÓ DEPOIS das três linhas acima estarem completas

```sql
update plans set pagarme_12x_enabled = true where id in ('start', 'pro', 'max');
```

A flag NÃO se liga sozinha: um catálogo limpo fica Stripe-only sem este passo explícito. Em
staging ela já pode estar `true` de antes (Fase 7) — reafirme o valor mesmo assim, para deixar
claro que as três linhas foram revisadas com os objetos novos antes do flip ficar "ativo" de fato.

### 3.4 Reconfirmar com E2E

Rodar o checkout 12x completo em staging uma vez e assertar que o total cobrado no gateway é
**113880** (plano start) — não 95900 (preço antigo) nem 9490 (a parcela sozinha, sem ×12).
Conferir no dashboard Pagar.me (sandbox) que a charge/invoice mostra `installments: 12`.

## 4. PROD — flip

Mesma sequência do passo 3, com a chave LIVE no momento do flip (arquivo local fora do repo,
nunca a mesma `~/.pagarme-spike.env` de sandbox — trocar `PAGARME_TEST_SECRET_KEY` pela secret key
live do arquivo de produção do operador, também via `source`/redirecionamento, nunca em argumento
de CLI). Mesma ordem: objetos → configuração das linhas → flag por último.

Checklist de flip já conhecido (pré-existente, ainda vale aqui):

- `VITE_PAGARME_PUBLIC_KEY` (a pk LIVE) precisa estar configurada e o CRM redeployado **ANTES**
  de marcar `pagarme_12x_enabled = true` em prod — senão o checkbox liga um caminho de frontend
  que ainda tenta tokenizar com a chave de teste (ou sem chave nenhuma).
- Webhook de prod precisa estar registrado no dashboard Pagar.me (Basic auth configurada,
  `PAGARME_WEBHOOK_TOKEN` e `PAGARME_WEBHOOK_BASIC` no ambiente da function) antes do flip —
  senão as primeiras assinaturas reais não reconciliam.

## Rollback

1. **Desmarcar `pagarme_12x_enabled` PRIMEIRO.** Isso mata todos os pontos de entrada novos do
   12x; o anual à vista via Stripe continua funcionando normalmente.
2. **Deixar os objetos de plano do Pagar.me (antigos e novos) como estão.** Objetos são de graça;
   apagar um objeto com assinaturas vivas nunca é permitido.
3. **Assinaturas já criadas nos objetos novos não são afetadas.** Continuam cobrando e
   reconciliando normalmente — o rollback só impede NOVAS vendas pelo caminho 12x, não mexe em
   nada que já existe.

```sql
update plans set pagarme_12x_enabled = false where id in ('start', 'pro', 'max');
```

## Riscos aceitos (herdados do plano)

- O gateway cobra o preço do OBJETO PLAN; a linha `plans` é o espelho. O log CRITICAL de
  price-drift (Task 2) é o alarme se divergirem; criar/atualizar os objetos continua sendo um
  passo de ops, fora do código.
- Troca mensal→12x ainda exige cancelar e reassinar (postura v1 inalterada).
