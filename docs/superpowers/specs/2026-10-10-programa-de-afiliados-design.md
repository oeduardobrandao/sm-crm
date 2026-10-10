# Programa de afiliados — design

Data: 2026-10-10 (revisado no mesmo dia: comissão por plano com janela de 3 meses e repasse
por Stripe Connect)

## Objetivo

Qualquer pessoa (social media ou não, com ou sem conta no Mesaas) recebe um link próprio
de divulgação. Quem se cadastra no Mesaas por esse link e **assina pelo Stripe** gera
comissão nos primeiros meses pagos, com percentual por plano. O repasse sai pelo
**Stripe Connect**, direto para a conta bancária do afiliado.

## Decisões

| Tema | Decisão |
|---|---|
| Provedor | Só Stripe. Pagamentos pelo Pagar.me (12x) não geram comissão. Se o workspace migrar para o Pagar.me, as comissões param. |
| Tabela de comissões | `affiliate_commission_rules`, por plano: **Start 30%**, **Pro 25%**, **Max 20%**, todos nos **3 primeiros meses pagos**. Editável no Admin; cada comissão copia o percentual do momento do pagamento. Plano sem regra não gera comissão. |
| Janela | Conta meses pagos por workspace a partir do primeiro pagamento (o trial não conta). Fatura mensal consome 1 mês; anual à vista consome até 12 e só a fração dentro da janela comissiona (3/12 do valor numa janela de 3 meses); proration de troca de plano consome 0 e comissiona inteira enquanto a janela estiver aberta, no percentual do plano novo. |
| Quem pode | Qualquer pessoa, por cadastro público em `/afiliados`. Não precisa de conta no Mesaas. |
| Desconto para o indicado | Nenhum nesta versão. |
| Atribuição | Último clique, válido por 60 dias no navegador. Gravada no cadastro, presa ao workspace, imutável. |
| Carência | 30 dias depois do pagamento a comissão passa de "pendente" para "disponível". |
| Repasse | Stripe Connect (conta Express, país BR). Transfer mensal (dia 5) do saldo disponível, a partir de R$ 50 (`AFFILIATE_MIN_PAYOUT_CENTS`). O Stripe faz a verificação do afiliado e o depósito no banco; o Mesaas não guarda CPF nem conta bancária. |
| Fiscal | O cliente continua pagando ao Mesaas (merchant of record): o repasse é um pagamento de serviço do Mesaas ao afiliado e a documentação fiscal (nota do MEI/PJ ou RPA) não é resolvida pelo Stripe. Validar com a contabilidade. |

## Fluxo

1. **Link**: `https://www.mesaas.com.br/?ref=<codigo>` (funciona em qualquer página do site).
   `apps/crm/src/lib/referral.ts` lê o `?ref=` no boot (`main.tsx`) e grava
   `{ code, at }` em `localStorage` (`mesaas:ref`). Um clique novo sobrescreve (último clique).
2. **Cadastro**: `LoginPage` envia `ref_code` nos metadados do `signUp`.
3. **Atribuição** (banco): o trigger `on_auth_user_created_zz_affiliate_referral` roda
   depois de `on_auth_user_created_workspace` (Postgres dispara triggers do mesmo evento em
   ordem alfabética). Ignora convites (`conta_id` nos metadados), afiliado
   suspenso/inexistente e autoindicação pelo mesmo e-mail, e grava `affiliate_referrals`
   para o workspace recém-criado. Qualquer erro vira `WARNING`: o cadastro nunca falha.
4. **Comissão** (`stripe-webhook`, `_shared/affiliate-commission.ts`):
   - `invoice.paid` com `amount_paid > 0` → workspace pelo `stripe_customer_id` →
     indicação → afiliado ativo → plano pelo preço da fatura (linha de maior valor; sem
     preço no payload, a fatura é relida pelo SDK) → regra do plano → meses já consumidos
     pelo workspace → `affiliate_commissions` (uma por `stripe_invoice_id`, idempotente).
   - `charge.refunded` → `refunded_amount_cents = amount_refunded` (acumulado). A comissão
     líquida cai na mesma proporção.
   - `charge.dispute.created` → `disputed = true` (líquido zero);
     `charge.dispute.closed` → `disputed = (status = 'lost')`.
5. **Saldo** (calculado, `affiliate_summaries`): `net_cents` é coluna gerada.
   - pendente = Σ líquido com `available_at > now()`
   - disponível = Σ líquido liberado − repasses `paid` − repasses `pending` (pode ficar
     negativo quando um estorno chega depois do repasse; o negativo abate o próximo)
   - pago = Σ repasses `paid`
6. **Stripe Connect** (`_shared/affiliate-connect.ts`):
   - No painel, "Conectar com Stripe" (`connect_start`) cria a conta Express uma vez
     (chave de idempotência + compare-and-set em `stripe_account_id`) e devolve o link de
     onboarding. A volta cai em `/afiliados/painel/<token>?stripe=retorno`.
   - Sem webhook de Connect: o status (`details_submitted`, capability `transfers`) é relido
     do Stripe ao abrir o painel enquanto a conta não está apta, e pelo cron antes de
     transferir.
   - "Abrir painel do Stripe" (`connect_dashboard`) gera o login link do Express, onde o
     afiliado vê depósitos e troca a conta bancária.
7. **Repasse** (`affiliate-payout-cron`, pg_cron `47 11 5 * *`):
   1. reconcilia repasses `pending` de execuções interrompidas pelo
      `transfer_group = affiliate_payout_<id>`: achou o transfer → `paid`; não achou →
      cria com a mesma chave de idempotência;
   2. para cada afiliado ativo com conta e saldo ≥ mínimo: relê a conta; com `transfers`
      ativa, grava o repasse `pending` **antes** do transfer e transfere o saldo inteiro.
   - Stripe recusou (4xx) → `failed` e o valor volta ao saldo. Resultado desconhecido
     (rede, timeout, 5xx, 429) → continua `pending` para a reconciliação; nunca transfere
     sem antes procurar pelo `transfer_group`.
8. **Painel do afiliado**: sem login, link `/afiliados/painel/<token>` enviado por e-mail
   (só o hash SHA-256 fica em `affiliate_access_tokens`, validade de 180 dias; pedir link
   novo não invalida os anteriores). Mostra link, tabela de comissões, simulador, saldos,
   indicações (sem nome nem e-mail do indicado, por LGPD), comissões, repasses e o cartão
   do Stripe.
9. **Admin** (`/admin/afiliados`): tabela de comissões editável, lista com saldos e
   situação no Stripe, detalhe com indicações (com o nome do workspace), comissões
   (plano, percentual, meses da janela) e repasses (situação, transfer, código de falha);
   suspender/reativar. Escritas vão para o `audit_log`.

## Banco

`20261013000001_affiliate_program.sql`:

- `affiliates`: código único (`^[a-z0-9]{4,32}$`), nome, e-mail único (minúsculo), telefone,
  status `active|suspended`, `stripe_account_id`, `stripe_details_submitted`,
  `stripe_transfers_active`, `stripe_status_checked_at`, `terms_accepted_at`.
- `affiliate_commission_rules`: `plan_id` (PK, FK `plans`), `rate_bps`, `months`. Semente
  Start 3000/3, Pro 2500/3, Max 2000/3. **Leitura pública** (página do programa).
- `affiliate_access_tokens`: `token_hash` → afiliado, `expires_at`.
- `affiliate_referrals`: PK `workspace_id`, `affiliate_id`, `ref_code`.
- `affiliate_commissions`: `stripe_invoice_id` único, `invoice_amount_cents`, `plan_id`,
  `billing_reason`, `commissionable_cents`, `covered_months`, `rate_bps`,
  `commission_cents`, `refunded_amount_cents`, `disputed`, `net_cents` gerado, `paid_at`,
  `available_at`.
- `affiliate_payouts`: valor, `status pending|paid|failed`, `stripe_account_id`,
  `stripe_transfer_id`, `failure_code`.
- `affiliate_summaries(p_affiliate_id uuid default null)`: totais por afiliado, só
  `service_role`.

`20261013000002_schedule_affiliate_payout_cron.sql`: agenda o cron (aplicar depois do deploy
da função).

Fora a tabela de comissões, tudo é service-role only. Acesso pelas edge functions
`affiliate-public` (pública, por token) e `platform-admin`.

## Edge functions

`affiliate-public` (`verify_jwt = false`):

| Ação | Entrada | Limite |
|---|---|---|
| `signup` | nome, e-mail, telefone?, aceite dos termos | 5/h por IP, 3/h por e-mail |
| `send_link` | e-mail | 5/h por IP, 3/h por e-mail |
| `dashboard` | token | 60/min por IP |
| `connect_start` | token | 60/min por IP, 10/h por afiliado |
| `connect_dashboard` | token | 60/min por IP |

`signup` e `send_link` sempre respondem igual exista ou não o e-mail. Sem
`STRIPE_SECRET_KEY` as ações de Connect respondem 503 e o resto funciona.

`affiliate-payout-cron` (`verify_jwt = false`, `x-cron-secret`): descrito acima. Falhas vão
para `reportCronFailure`.

## Configuração para o deploy

- **Ativar o Stripe Connect** na conta Stripe (perfil da plataforma, contas Express, Brasil).
  Prod e staging compartilham a conta Stripe: testar em modo de teste. Conferir no modo de
  teste que a conta Express BR aceita só a capability `transfers` (sem `card_payments`).
- **Saldo para os transfers**: o transfer sai do saldo *disponível* da conta Stripe do
  Mesaas. Com payout automático diário, o saldo pode estar zerado no dia 5 e o transfer é
  recusado (`balance_insufficient` → repasse `failed`, valor volta ao saldo do afiliado,
  alerta via `reportCronFailure`). Manter um saldo mínimo na conta (configuração de payouts
  do Stripe) ou um calendário de payout que deixe saldo no início do mês.
- No endpoint de webhook do Stripe: `invoice.paid`, `charge.refunded`,
  `charge.dispute.created`, `charge.dispute.closed`.
- Deploy: `affiliate-public` e `affiliate-payout-cron` com `--no-verify-jwt`; redeploy de
  `stripe-webhook` e `platform-admin`. Depois, a migration de agendamento do cron.
- Usa `RESEND_API_KEY`, `APP_BASE_URL`, `STRIPE_SECRET_KEY`, `CRON_SECRET`, que já existem.
  `AFFILIATE_MIN_PAYOUT_CENTS` é opcional (padrão 5000).

## Fora do escopo (próximos passos)

- Contagem de cliques no link.
- Desconto/cupom para o indicado.
- Webhook de Connect (`account.updated`) para status em tempo real.
- Reversão de transfer quando um estorno chega depois do repasse (hoje o negativo abate o
  próximo repasse; se o afiliado nunca mais tiver saldo, o valor fica a descoberto).
- Emissão de RPA/nota e retenções.
- Página `/afiliados` prerenderizada para SEO (hoje é servida pelo `app.html`, com noindex).
