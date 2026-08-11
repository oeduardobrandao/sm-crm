# Fase 0 — Go/no-go Pagar.me 12x: estado dos 8 critérios

Atualizado 2026-08-11 após execução do spike em sandbox (conta criada pelo Eduardo; chaves de
teste em `~/.pagarme-spike.env`, fora do repo). Evidências: `out/*.log` neste diretório do
scratchpad, com request/response completos. Plano de teste criado: `plan_apRwzBYcjTrZxZoA`
(year, installments [1,12], R$959,00).

> **Escopo deste doc:** status da Fase 0 apenas. O desenho completo (modelo de provider e
> coexistência com Stripe, guard de ownership de webhooks, reserva atômica de checkout,
> fronteira de confiança do webhook, paid-through, admin/MRR provider-aware) está no plano
> aprovado v2 (`~/.claude/plans/swift-inventing-flute.md`), revisado após 8 achados de review.
> Este doc não repete aquele desenho; registra o que o sandbox provou e o que ainda bloqueia.

## Placar: 7 de 8 fechados. Pende só o nº 2 (renovação parcelada — SUPORTE), o único NO-GO possível

### 1. Assinatura year + installments=12 sai parcelada — **PASSOU (sandbox)** ✅

`sub_8RGo0dOHrYSROodX`: subscription `active`, invoice `paid` com `installments: 12`,
transação `captured`, `success: true`, `installments: 12`, `auth_and_capture`, R$959,00
(evidência `out/08` e `out/09`). A nota da doc "deverá ser 1 em recorrências" NÃO se aplica
quando o plano define `installments` — o campo é aceito e propaga até a transação.
Confirmar com o suporte por escrito continua valendo (junto com o nº 2).

### 2. Renovação anual recria as 12 parcelas — **PENDENTE: SUPORTE** ⏳

Sandbox não simula virada de ciclo anual. `next_billing_at: 2027-08-11` registrado; falta a
confirmação escrita de que a cobrança do ciclo 2 nasce parcelada de novo. É o ÚNICO item que
ainda pode virar NO-GO (se a renovação cobrar à vista, o produto "12x" morre na renovação).

### 3. Subscription sem plan_id — **NÃO (docs), fallback validado** ✅

`plan_id` obrigatório. O fallback previsto no plano v2 (objetos plan pré-criados +
coluna `plans.pagarme_plan_id_annual`, resolução que LANÇA em id desconhecido) fica
**decidido como caminho definitivo**; a coluna e a resolução ainda NÃO existem no código,
serão criadas na Fase 1 (migration) e Fase 4 (webhook). O que o sandbox provou: criação de
plan via API funciona (`out/01`). Contrato de erro do webhook para plan id desconhecido:
lançar → 5xx → redelivery (nunca degradar para plano default; é a armadilha de downgrade
que o plano v2 elimina).

### 4. Semântica de start_at futuro — **PASSOU (sandbox)** ✅

`sub_1BGgmEYhGSyDmQjd` com `start_at` +30d: status **`future`**, `installments: 12` mantido,
**nenhuma invoice/charge criada** = cartão NÃO é autorizado na criação (`out/10`-`12`).
Objeto `future` não traz `next_billing_at`/`current_cycle` → fronteira do trial = `start_at`.
Mapeamento temporal do plano confirmado (trialing → current_period_end := start_at).
Consequência aceita: cartão ruim só aparece no dia 30; dunning cobre.

### 5. Idempotency-Key em /subscriptions — **PASSOU (sandbox)** ✅

Duas requests concorrentes com a mesma `Idempotency-key` → duas 200 com o MESMO
`sub_rw3RwXMUgHQdBKXW` (uma criação só; `out/13`). Retenção: 24h prod, 5 min sandbox;
key não retida em 400/500. Reserva atômica local continua necessária (a key só protege a
chamada remota).

### 6. Customer e-mail único, 1:N — **PASSOU (docs + sandbox)** ✅

Segundo create com o mesmo e-mail devolveu o MESMO `cus_xkLyERPTWuwwKNav` atualizado
(`out/14`). Desenho confirmado: `pagarme_customer_id` sem UNIQUE, customer nunca resolve
tenant, resolução só por `pagarme_subscription_id`.

### 7. Webhooks: eventos reais + auth de entrega — **PASSOU (sandbox), 1 ressalva** ✅

**Capturado em 2026-08-11 (21 entregas no bin; evidências `out/21` e `out/23`):**

- **Vocabulário real de eventos**: `subscription.created/updated/canceled`,
  `invoice.created/paid`, `charge.created/paid`. As DUAS famílias (`charge.*` E `invoice.*`)
  disparam para o mesmo ciclo de assinatura → o webhook escolhe UMA família autoritativa para
  estado (charge.*; invoice fica como dado) e ignora a duplicata, como o plano previa.
- **Envelope**: `{ id: "hook_...", account, type, created_at, data }` — dedup por `id`.
- **Payload rico**: `data` de charge inclui `invoice` (com `installments` e `subscriptionId`),
  `last_transaction` completo (acquirer_*, gateway_response, installments) e
  `recurrence_cycle` ("first" vs renovação).
- **Auth de entrega = HTTP Basic simples** com as credenciais configuradas no dashboard
  (header `Authorization: Basic ...` capturado e decodificado: exatamente user:senha do
  toggle "Habilitar autenticação"). SEM assinatura HMAC no header. Fronteira de confiança de
  produção: Basic auth com credencial forte (comparação timing-safe) + token no path +
  fetch-before-trust, como no plano v2.
- **Entregas em rajada no mesmo segundo, ordem não garantida** (created chegou com status já
  "paid"; subscription.updated antes/depois de charge.paid) → confirma que o handler NUNCA
  pode aplicar estado do payload; só estado re-buscado.
- **Retentativas**: configuráveis até 3 no dashboard.

**Ressalva (não bloqueia arquitetura):** o simulador aprova QUALQUER cartão no fluxo de
assinatura (testados ...0028 "recusado" e ...0044 "processing→failure": ambos saíram paid),
então payloads de `*.payment_failed` não são produzíveis em sandbox. O shape dos campos de
retry/attempt fica para a resposta do suporte (pergunta 5) e para staging com cartão real.
O dunning do plano já degrada com segurança sem esses campos (first/retry; final só com
estado terminal re-buscado).

#### Histórico da configuração (resolvido)

- `GET /hooks` funciona mas é o LOG de entregas (vazio até existir config); a criação de
  endpoint parece ser dashboard-only, e registrá-la é mudança de configuração da conta →
  aguarda autorização do Eduardo. Bin pronto: `https://webhook.site/57c14c26-9339-4649-bf69-18e0e067bfe8`
  (dados sintéticos apenas).
- **Config do dashboard vista (screenshot 2026-08-11)**: a tela de criação de webhook tem
  toggle **"Habilitar autenticação"** (entrega COM autenticação existe; campos exatos a
  confirmar ao ligar o toggle), **"Máximo de tentativas: até 3"**, status ativo/inativo, e
  eventos por categoria com "marcar todos" (Assinatura, Cobrança e Fatura marcadas — as três
  que o produto usa). Salvar exige a senha do dashboard (digitada pelo Eduardo, nunca
  compartilhada). Criação de endpoint é dashboard-only mesmo (POST /hooks não é config).
- Falta: salvar a config, disparar eventos (subscribe ok + subscribe com cartão recusado
  ...0028 + cancel) e ler payloads/headers no bin (nomes reais de evento, formato da
  autenticação/assinatura de postback).
- Pista da Gestão de Chaves: existe checkbox "assinatura de postback" por chave → entregas
  provavelmente assinadas; verificar header na captura.

### 8. Cancel-at-cycle-end nativo — **NÃO (docs + sandbox)** ✅ (como o plano previa)

`DELETE /subscriptions/{id}` cancelou na hora as três assinaturas vivas, inclusive com ciclo
`billed` pago (`out/15`; `canceled_at` imediato). Paid-through é 100% nosso →
`billing-downgrade-cron` confirmado necessário.

## Achados de implementação (entram nas fases 1+)

1. **Gateway exige telefone do customer** (412 "At least one customer phone is required") e
   **billing_address no cartão** (400 "validation_error | billing | value is required").
   → O dialog de checkout coleta: telefone e CEP/endereço, além de cartão + CPF/CNPJ.
2. **billing_address dentro do token é IGNORADO** e `card_token` direto na subscription
   deduplica para cartão salvo sem endereço. Fluxo correto (= o do plano):
   token → `POST /customers/{id}/cards` `{token, billing_address}` → subscription com `card_id`.
   Attach com mesmo número ATUALIZA o cartão existente (id estável).
3. **Status `failed` existe em subscription** (não documentado no enum future|active|canceled):
   nasce quando a 1ª cobrança falha. Semântica precisa (canceled e incomplete NÃO são
   equivalentes no código atual: em `statusToPlanId`, `incomplete` preserva o plano e
   `canceled` derruba):
   - **No checkout síncrono** (único lugar onde `failed` de 1ª cobrança aparece): devolve
     `invalid_card` ao usuário, **cancela a subscription remota** (ação compensatória, evita
     zumbi), marca a attempt como `failed`, NÃO grava plano nem ownership. Como nenhum plano
     foi concedido, não existe estado a preservar nem a derrubar.
   - **No webhook**: `failed` re-buscado mapeia para `canceled`; inofensivo porque o plano
     nunca foi escrito (e o guard de ownership exige sub id registrado, que nunca foi bindado).
   - **Aberto (pergunta ao suporte)**: qual status a subscription assume quando a cobrança de
     RENOVAÇÃO falha (`failed` também? permanece `active` + charge failed?), e se o Pagar.me
     retenta sozinho. O mapeamento de dunning depende disso.
4. **`/charges?subscription_id=` NÃO filtra** (devolve charges da conta toda);
   `/invoices?subscription_id=` filtra. Webhook/reconciliação: consultar invoices.
5. **Múltiplas assinaturas ativas por customer são permitidas** — o 409 de duplicidade é
   inteiramente nosso (guard provider-agnóstico + reserva atômica).
6. Charge carrega `recurrence_cycle: "first"` (distingue 1ª cobrança de renovação — útil pro
   webhook diferenciar ciclo 1 de ciclo N).
7. Token de cartão: TTL 60s confirmado no response (`expires_at` = created + 1 min).
8. **Política do customer compartilhado (mesmo e-mail em N workspaces)**: o checkout SEMPRE
   envia os dados atuais do owner (last-write-wins no perfil compartilhado: telefone/endereço;
   aceito, o perfil não é exibido no produto) e NUNCA lista nem reutiliza cartões existentes
   do customer: o fluxo é sempre token novo → attach → usar o `card_id` retornado nessa
   response. A associação de tenant é exclusivamente `workspace_id` → `pagarme_subscription_id`;
   nenhum `card_id` cruza workspaces (update de cartão é escopado pela subscription da linha).
9. **Contrato do checkout ganha telefone + endereço** (achados 1-2): request do
   `pagarme-checkout` passa a incluir `phone {ddd, number}` e `billing_address {cep, line_1,
   city, state}`, validados no cliente (zod) e re-validados na function; nada disso é
   armazenado no nosso banco: passa direto ao Pagar.me. Sequência de falha: attach ok +
   subscription falha → cartão fica no customer (inócuo) e a subscription falha é cancelada
   (achado 3); token expirado (60s) → tokenizar de novo no retry do submit.
10. **Métricas/admin**: linha pagarme nasce com amount-mirror `95900/BRL/year` → MRR existente
    (`toMonthlyCents` ÷12) reporta R$79,92/mês, idêntico a uma anual Stripe. Reportamos valor
    de CONTRATO (R$959/ano), não caixa por parcela; conciliação de recebíveis fica no
    dashboard Pagar.me na v1. Admin não consulta Stripe para linhas pagarme (gate por
    `provider`, plano v2).
11. **Redelivery/fora-de-ordem**: o handler nunca escreve estado do payload; escreve o estado
    RE-BUSCADO da API no momento do processamento (fetch-before-trust = fonte monotônica).
    Um `canceled` atrasado redisparado re-busca e encontra o estado atual; dedup por
    `event_id` em tabela própria por provider (`pagarme_webhook_events`, sem colisão com o
    ledger Stripe). Dunning ordena por `charge_id` + attempt, não por chegada de evento.

## Roteiro para o suporte Pagar.me (pergunta 2 é a decisiva)

1. Plano year com `installments: [12]`: confirmam que a cobrança sai parcelada? (já provamos em
   sandbox; queremos confirmação de que produção se comporta igual)
2. **Na renovação automática do ciclo 2, a nova cobrança nasce parcelada em 12x de novo, sem
   ação do cliente?**
3. `POST /subscriptions` honra `Idempotency-key`? (provado em sandbox; confirmar produção)
4. Em `future`, cartão não é autorizado na criação — correto? Existe como forçar validação
   do cartão no ato (zero-dollar auth)?
5. Em ciclos de assinatura, quais eventos disparam (`charge.*` vs `invoice.*`)? Payload de
   falha traz attempt count e próximo retry? Qual a política de retry? E quando a cobrança de
   RENOVAÇÃO falha: a subscription vira `failed`, permanece `active`, ou outro status?
6. A config de webhook aceita header customizado / Basic auth? As entregas são assinadas
   (checkbox "assinatura de postback" na Gestão de Chaves)?

## Resultado

- [ ] **GO**: depende apenas da resposta do suporte à pergunta 2 (renovação recria as 12
      parcelas). Critério 7 fechado em 2026-08-11 com payloads reais + fronteira de confiança
      validada (Basic auth + fetch-before-trust + dedup por `hook_id`). A pergunta 5 (payload
      de falha) é informativa: refina o dunning, não bloqueia o GO.
- [ ] NO-GO: se o suporte negar a renovação parcelada.
