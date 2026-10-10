# Programa de afiliados — design

Data: 2026-10-10

## Objetivo

Qualquer pessoa (social media ou não, com ou sem conta no Mesaas) recebe um link próprio
de divulgação. Quem se cadastra no Mesaas por esse link e **assina pelo Stripe** gera uma
comissão de **20% do valor pago** para o afiliado.

## Decisões

| Tema | Decisão |
|---|---|
| Provedor | Só Stripe. Pagamentos pelo Pagar.me (12x) não geram comissão. Se o workspace migrar para o Pagar.me, as comissões param. |
| Valor | 20% de cada fatura paga (`invoice.amount_paid`), percentual por afiliado (`commission_rate_bps`, padrão 2000) e congelado em cada comissão no momento do pagamento. Mudar o percentual de um afiliado só afeta pagamentos futuros. |
| Duração | Enquanto a assinatura Stripe pagar. Sem teto de meses nesta versão. |
| Quem pode | Qualquer pessoa, por cadastro público em `/afiliados`. Não precisa de conta no Mesaas. |
| Desconto para o indicado | Nenhum nesta versão. |
| Atribuição | Último clique, válido por 60 dias no navegador. Gravada no cadastro, presa ao workspace, imutável. |
| Carência | 30 dias depois do pagamento a comissão passa de "pendente" para "disponível". |
| Repasse | PIX manual, registrado no Admin. |

## Fluxo

1. **Link**: `https://www.mesaas.com.br/?ref=<codigo>` (funciona em qualquer página do site).
   `apps/crm/src/lib/referral.ts` lê o `?ref=` no boot (`main.tsx`) e grava
   `{ code, at }` em `localStorage` (`mesaas:ref`). Um clique novo sobrescreve (último clique).
2. **Cadastro**: `LoginPage` envia `ref_code` nos metadados do `signUp`.
3. **Atribuição** (banco): o trigger `on_auth_user_created_zz_affiliate_referral` roda
   depois de `on_auth_user_created_workspace` (Postgres dispara triggers do mesmo evento em
   ordem alfabética). Ele lê `ref_code`, ignora convites (`conta_id` nos metadados), afiliado
   suspenso/inexistente e autoindicação pelo mesmo e-mail, e grava `affiliate_referrals`
   para o workspace recém-criado. Qualquer erro vira `WARNING`: o cadastro nunca falha por
   causa da indicação.
4. **Comissão** (`stripe-webhook`, `_shared/affiliate-commission.ts`):
   - `invoice.paid` com `amount_paid > 0` → workspace pelo `stripe_customer_id` →
     indicação → afiliado ativo → `affiliate_commissions` (uma por `stripe_invoice_id`,
     idempotente). O trial de 30 dias não gera comissão porque a fatura do trial é zero.
   - `charge.refunded` → `refunded_amount_cents = amount_refunded` (acumulado) na comissão
     da fatura daquela cobrança. A comissão líquida cai na mesma proporção.
   - `charge.dispute.created` → `disputed = true` (líquido zero);
     `charge.dispute.closed` → `disputed = (status = 'lost')`.
   - A fatura da cobrança vem de `charge.invoice`; se o payload não tiver o campo, a cobrança
     é relida pelo SDK (versão de API fixada pelo stripe@17, que traz `invoice`).
5. **Saldo** (calculado, sem cron): `liquido` é coluna gerada
   (`0` se contestada; senão comissão menos a fração estornada).
   - pendente = Σ líquido com `available_at > now()`
   - disponível = Σ líquido com `available_at <= now()` − Σ repasses (pode ficar negativo
     quando um estorno chega depois do repasse; o saldo negativo abate o próximo)
   - pago = Σ repasses
6. **Painel do afiliado**: sem login. O cadastro (e o "reenviar link") manda por e-mail um
   link `/afiliados/painel/<token>`. Só o hash SHA-256 do token fica no banco
   (`affiliate_access_tokens`, validade de 180 dias). Pedir um link novo **não** invalida os
   anteriores, para ninguém derrubar o acesso de outra pessoa pedindo link com o e-mail dela.
   O painel mostra código, link, simulação, saldos, indicações (sem nome nem e-mail do
   indicado, por LGPD: só número, data e situação), comissões e repasses, e o formulário dos
   dados de PIX.
7. **Admin** (`/admin/afiliados`): lista com totais, detalhe com indicações (aqui com o nome
   do workspace), comissões, repasses e dados de PIX; ações: suspender/reativar, alterar
   percentual, registrar repasse (valor ≤ saldo disponível). Escritas vão para o `audit_log`.

## Banco (`20261013000001_affiliate_program.sql`)

- `affiliates`: código único (`^[a-z0-9]{4,32}$`), nome, e-mail único (minúsculo), telefone,
  status `active|suspended`, `commission_rate_bps`, dados de PIX (tipo, chave, CPF/CNPJ,
  titular), `terms_accepted_at`.
- `affiliate_access_tokens`: `token_hash` → afiliado, `expires_at`.
- `affiliate_referrals`: PK `workspace_id` (um afiliado por workspace), `affiliate_id`, `ref_code`.
- `affiliate_commissions`: `stripe_invoice_id` único, valores em centavos, `rate_bps`,
  `refunded_amount_cents`, `disputed`, `net_cents` gerado, `paid_at`, `available_at`.
- `affiliate_payouts`: valor, método (`pix`), referência/comprovante, observação, autor.
- `affiliate_summaries(p_affiliate_id uuid default null)`: totais por afiliado, executável
  só pelo `service_role`.

Todas com RLS ligada e acesso só para `service_role`; `anon`/`authenticated` sem grant.
Todo acesso passa pelas edge functions `affiliate-public` (pública, por token) e
`platform-admin` (admins da plataforma).

## Edge function `affiliate-public`

`verify_jwt = false` (deploy com `--no-verify-jwt`). Ações por POST:

| Ação | Entrada | Limite |
|---|---|---|
| `signup` | nome, e-mail, telefone?, aceite dos termos | 5/h por IP, 3/h por e-mail |
| `send_link` | e-mail | 5/h por IP, 3/h por e-mail |
| `dashboard` | token | 60/min por IP |
| `update_payout` | token, tipo + chave PIX, CPF/CNPJ, titular | 20/h por afiliado |

`signup` e `send_link` sempre respondem igual exista ou não o e-mail (sem enumeração).
Se o e-mail já é afiliado, `signup` só reenvia o link. E-mail via Resend
(`afiliados@mesaas.com.br`); link montado com `APP_BASE_URL`.

## Configuração para o deploy

- Ativar no endpoint de webhook do Stripe (prod e staging): `invoice.paid`,
  `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`. Sem isso nenhuma
  comissão é gerada.
- `npx supabase functions deploy affiliate-public --no-verify-jwt`; redeploy de
  `stripe-webhook` e `platform-admin`.
- Usa `RESEND_API_KEY` e `APP_BASE_URL`, que já existem.

## Fora do escopo (próximos passos)

- Contagem de cliques no link.
- Desconto/cupom para o indicado.
- Teto de meses de comissão.
- Repasse automático (Stripe Connect ou similar) e emissão de RPA/nota.
- Página `/afiliados` prerenderizada para SEO (hoje é servida pelo `app.html`, com noindex).
