# Cobrança em USD (runbook)

Workspaces com `billing_currency = 'usd'` veem preços em dólar e pagam em dólar pela Stripe.
Spec: `docs/superpowers/specs/2026-11-25-usd-billing-design.md`. Este runbook é interno.

## Como funciona

- O dólar é uma `currency_options.usd` nos seis preços Stripe já existentes (BRL continua o
  padrão de `price.currency`). Não há preço novo nem produto novo.
- `workspaces.billing_currency` (`brl` | `usd`) é guardada por trigger e travada no primeiro
  checkout (`billing_currency_locked_at`). O `billing-checkout` sempre manda `currency` e
  `locale` (`pt-BR` para BRL, `en` para USD); a Idempotency-Key leva a moeda.
- A trava (`billing_currency_lock`) roda logo antes de criar ou reaproveitar o customer
  Stripe, depois de todas as recusas. Travada, a ação `set-workspace-currency` do
  `platform-admin` responde 409 `currency_locked`.
- Cadastro nos EUA grava `market = 'us'` e o trigger `on_auth_user_created_zz_billing_market`
  põe USD. Ninguém manda esse mercado até o signup `/en` (parte 2). O trigger engole erros
  (WARNING no log do Postgres), então um cadastro dos EUA pode cair em BRL sem aviso: o Admin
  corrige antes do primeiro checkout.
- A conta Stripe é registrada no Brasil. O modo teste aceitou preço BRL com
  `currency_options.usd` e Checkout de assinatura com `currency: 'usd'` (2026-11-25). A
  cobrança em USD liquida convertida para BRL; conte com cerca de 2% de taxa de cartão
  internacional mais a conversão. O modo live só se confirma na compra real (passo 8).
- Um workspace USD vê "Plano exclusivo" sem botão em todo plano pago sem `price_usd*`.
  Preencha os seis `price_usd` / `price_usd_annual` no Admin antes de virar qualquer
  workspace para USD.
- Promoções em USD: só `percent_off`. Cupons `amount_off` existentes são em BRL e não se
  aplicam a sessões USD. Fatura em USD não gera comissão de afiliado.
- Pagar.me 12x continua só para BRL (a UI do 12x some em workspace USD).
- Exportação CSV do dashboard do Admin: ganhou a coluna "Moeda" e o cabeçalho do valor perdeu
  o "(R$)".
- Nunca some `monthly_cents` / `amount_cents` entre moedas: agrupe por moeda.

## Ordem de deploy

Staging e prod compartilham a mesma conta Stripe live, então o `billing-checkout` novo tem
que estar nos DOIS antes de qualquer `currency_options` entrar num preço live.

1. Migrations, nesta ordem: `20261205000001_usd_billing_schema.sql` e depois
   `20261205000002_usd_billing_rpcs.sql` (renumeradas; confira a ponta de `main` antes do PR
   e renumere se ela andou). O `ALTER TABLE` em `workspaces` pode estourar o `lock_timeout`
   de 5 s no `db push`: rode de novo. Staging recebe as mesmas migrations e functions.
2. `billing-checkout` em prod e em staging. O `supabase/config.toml` já define
   `verify_jwt = false` para ele e a function confere o JWT do usuário sozinha
   (`svc.auth.getUser`); faça o deploy como o do `pagarme-checkout`, com
   `--no-verify-jwt` (o config.toml governa do mesmo jeito).
3. Demais functions:
   - `stripe-webhook`, `pagarme-checkout`, `pagarme-subscription`, `metrics-snapshot-cron`,
     `lifecycle-email-cron`
   - as que empacotam `_shared/affiliate-commission.ts`: `stripe-webhook`,
     `affiliate-public`, `affiliate-payout-cron`, `platform-admin` (inclui
     `workspace-affiliate.ts` e `affiliates.ts`)
   - os oito importadores de `_shared/entitlements.ts`: `automation-media`, `data-import`,
     `equipe-chat-media`, `mcp-keys`, `mcp-oauth-consent`, `paywall-report`, `platform-admin`,
     `workspace-limits`
   - `mcp-admin` (blocos USD do dashboard)

   Flags de deploy (conferidas contra `supabase/config.toml` e o cabeçalho de cada
   `index.ts`):
   - COM `--no-verify-jwt`: `mcp-admin` (sem entrada no config.toml; o cabeçalho manda o
     flag, a function faz a própria auth).
   - Já com `verify_jwt = false` no config.toml (use o flag mesmo assim, como no resto do
     repo): `billing-checkout`, `stripe-webhook`, `pagarme-checkout`, `pagarme-subscription`,
     `metrics-snapshot-cron`, `lifecycle-email-cron`, `affiliate-public`,
     `affiliate-payout-cron`, `platform-admin`, `automation-media`, `equipe-chat-media`,
     `paywall-report`, `workspace-limits`.
   - SEM o flag (verificação de JWT do gateway ligada): `mcp-keys` e `mcp-oauth-consent`
     (os cabeçalhos dizem explicitamente), e `data-import` (sem entrada no config.toml nem
     instrução de flag: segue o padrão do gateway).

4. Merge do frontend.
5. Stripe `currency_options` (ver abaixo), só com aprovação explícita do dono.
6. Admin: preencher os seis `price_usd*` (29/279, 49/469, 79/759).
7. Conferir a configuração do portal de cobrança (ver abaixo).
8. Compra real em USD num workspace interno (`is_internal`) virado para USD, depois reembolso
   na Stripe e cancelamento da assinatura.

## Stripe: adicionar USD aos seis preços live

SÓ COM A APROVAÇÃO EXPLÍCITA DO DONO. Nunca como efeito colateral de deploy. Ensaie antes com
cópias em modo teste (sem `--live`): `currency: 'usd'` mostra o valor em dólar e
`currency: 'brl'` continua mostrando BRL, inclusive a partir de IP/VPN dos EUA.

| Plano | Mensal (centavos USD) | Preço mensal                     | Anual (centavos USD) | Preço anual                      |
| ----- | --------------------- | -------------------------------- | -------------------- | -------------------------------- |
| Start | 2900                  | `price_1TP7roRiNt9jHv2Z9a50L6PS` | 27900                | `price_1TP7roRiNt9jHv2ZixyiogIT` |
| Pro   | 4900                  | `price_1TP7vHRiNt9jHv2Z7gKaMT6i` | 46900                | `price_1TP7vHRiNt9jHv2ZI6q361GL` |
| Max   | 7900                  | `price_1TP7x7RiNt9jHv2Z7Jt3MjRP` | 75900                | `price_1TP7x7RiNt9jHv2ZOih72LqG` |

Primeiro confirme os ids no banco (devem bater com a tabela acima):

```sql
select id, stripe_price_id, stripe_price_id_annual from plans where id in ('start','pro','max');
```

Depois, para cada preço, confira o `tax_behavior`:

```bash
stripe prices retrieve --live price_1TP7roRiNt9jHv2Z9a50L6PS
```

Se `tax_behavior` for `inclusive` ou `exclusive`, copie o mesmo valor para a opção USD
(`-d "currency_options[usd][tax_behavior]=<valor>"`). Se for `unspecified`, não envie.

```bash
# Start
stripe prices update --live price_1TP7roRiNt9jHv2Z9a50L6PS -d "currency_options[usd][unit_amount]=2900"
stripe prices update --live price_1TP7roRiNt9jHv2ZixyiogIT -d "currency_options[usd][unit_amount]=27900"
# Pro
stripe prices update --live price_1TP7vHRiNt9jHv2Z7gKaMT6i -d "currency_options[usd][unit_amount]=4900"
stripe prices update --live price_1TP7vHRiNt9jHv2ZI6q361GL -d "currency_options[usd][unit_amount]=46900"
# Max
stripe prices update --live price_1TP7x7RiNt9jHv2Z7Jt3MjRP -d "currency_options[usd][unit_amount]=7900"
stripe prices update --live price_1TP7x7RiNt9jHv2ZOih72LqG -d "currency_options[usd][unit_amount]=75900"
```

Verifique cada um com um retrieve do preço usando `-d "expand[]=currency_options"` (o retrieve com `items.data.price.currency_options` funciona; o `list` com
expand `data.items.data.price.currency_options` é recusado pela Stripe por passar de 4
níveis, e o código já busca preço por id):

```bash
stripe prices retrieve --live <id> -d "expand[]=currency_options"
```

## Portal de cobrança

O `billing-portal` não mudou. A troca de plano no portal fica dentro da moeda da assinatura.
No painel da Stripe (Billing > Customer portal), todo preço oferecido para troca de plano
tem que ser um dos seis acima (os que ganharam USD) ou sair da lista. Um preço sem opção USD
quebra a troca de uma assinatura em dólar.

## Destravar a moeda de um workspace (SQL manual)

```sql
update public.workspaces set billing_currency_locked_at = null where id = '<workspace_id>';
```

Só é seguro quando o workspace NÃO tem customer Stripe e NÃO tem linha em
`workspace_subscriptions` com `provider`. Com customer, a moeda dele na Stripe já está fixa e
trocar `billing_currency` desalinha a cobrança. Depois de destravar, troque a moeda pela ação
do Admin (`set-workspace-currency`).

## Rollback

- Frontend primeiro. As edge functions podem ficar.
- Remover `currency_options` da Stripe só é seguro enquanto não existir assinatura em USD.
  Com assinatura USD ativa, cancele/migre antes.
- As migrations podem ficar (aditivas).
