# Switch seamless: mensal Stripe → anual 12x Pagar.me — Design

Data: 2026-08-14. Status: aprovado (3 decisões de produto + 3 rodadas de review do design;
12 achados P1/P2 incorporados).

## Contexto

Follow-up do "risco aceito v1" do plano do 12x: hoje um assinante mensal Stripe que quer o
anual em 12x precisa cancelar e esperar o fim do ciclo (qualquer linha vigente devolve 409
nos dois checkouts). Objetivo: upgrade sem gap de acesso, sem cobrança dupla e sem novo
trial.

O 12x está ao vivo em prod desde 2026-08-14 e a infra existente já resolve quase tudo:

- `start_at` é plumbing completo no gateway Pagar.me (`pagarme-checkout/gateway.ts:22`,
  `handler.ts:252`); status remoto `future` → local `trialing` com
  `current_period_end = start_at` (`_shared/pagarme-logic.ts:158-171`). O spike da Fase 0
  provou: future sub não autoriza cartão nem cria charge na criação.
- O CAS bind já escreve provider + amount-mirror num único statement, pinado no provider
  observado (`pagarme-checkout/handler.ts:383-409`, `buildPagarmeSubscriptionColumns`).
- `canWebhookWrite` já NEGA todos os eventos Stripe pós-flip, com testes pinando exatamente
  o cenário ("late Stripe deleted after switch does not write",
  `__tests__/pagarme-logic_test.ts:119,131`). Nenhuma mudança em `canWebhookWrite`.
- Pagar.me não tem cancel-at-cycle-end nativo (DELETE é imediato); inofensivo para uma
  future sub (nada cobrado). Stripe tem `cancel_at_period_end` nativo.

## Decisões de produto

1. **Arrependimento = desfazer a troca.** Cancelar o 12x agendado antes do `start_at`
   reativa o mensal Stripe (`cancel_at_period_end=false`) e devolve a linha ao provider
   stripe. O botão de cancelar durante a janela É o undo.
2. **Qualquer plano-alvo.** Switch em qualquer card anual visível (mesmo plano, maior ou
   menor). Plano concedido NO BIND (invariante atual). Copy avisa que os recursos mudam já
   em QUALQUER troca entre planos (não só downgrade).
3. **Elegibilidade: Stripe mensal `active` OU `trialing`** (verificado remotamente).
   `past_due`/`unpaid`, anual à vista → 12x e 12x → mensal ficam fora da v1.

## Decisões de design

4. **Undo com Stripe já morta remotamente** (suporte/portal cancelou o mensal no meio da
   janela): fallback para o cancel comum de trialing (downgrade imediato) limpando marker e
   plano-fonte no mesmo CAS.
5. **Órfã perto da fronteira**: future sub órfã criada <30h antes do `start_at` pode cobrar
   antes do sweep diário (06:00). Residual aceito na v1 (CRITICAL + refund manual); exige
   timeout ambíguo E fronteira próxima, combinação rara.
6. **Contrato do undo**: `POST pagarme-subscription {action:'cancel'}` numa linha em janela
   responde `{ status: 'reverted', access_until: <period end Stripe> }`.
7. **Mensal já com cancel agendado pode fazer switch** (usuário em churn): permitido,
   retenção estritamente melhor. O undo devolve `cancel_at_period_end=false` (benigno,
   copy diz "seu mensal foi reativado").
8. **Corrida de fronteira no undo consolida a troca**: se a 1ª parcela do 12x disparou
   (ativou OU falhou → past_due) enquanto o undo estava em voo, a Stripe já morreu na
   fronteira e não há para onde voltar. O undo aborta consolidando: `cancelNow` da Stripe
   (se renovou por causa do `cap_end=false` do undo) + CRITICAL + 409 com copy própria por
   estado. Manter um 12x em dunning atrás de um "undo" seria o pior resultado.
9. **Idempotência do undo por reconhecimento do estado final**: retry do undo após
   resposta perdida cai nas precondições com a linha já flipada. Regra explícita:
   `provider === 'stripe'` && status in-force && `pagarme_subscription_id` null → 200
   `{status:'reverted', access_until: current_period_end}`, antes do 404. A regra é
   DELIBERADAMENTE ampla: uma assinatura Stripe comum que nunca fez switch também recebe
   200 reverted (no-op inofensivo; antes era 404). Documentar no código e pinar em teste
   de regressão.
10. **born-active = quarentena durável**: uma switch sub nascida `active` significa 1ª
    cobrança disparada com a Stripe ainda cobrando, um malfuncionamento do gateway (o
    spike provou que start_at futuro não cobra na criação). Compensação: cancela a sub
    remota E marca a attempt com estado novo `quarantined` (em vez de `failed`), que
    BLOQUEIA novas tentativas de checkout nos dois providers até resolução manual
    (verificar/estornar a cobrança no dashboard Pagar.me e liberar a attempt). `failed`
    liberaria retry com nova idempotency key e possível segunda cobrança. A garantia
    ATÔMICA é o índice único parcial alargado para `state in ('pending','quarantined')`;
    o read prévio serve só à mensagem específica. Sem o índice alargado, um INSERT
    esperando o lock da attempt pending entra no exato momento em que ela vira
    quarantined e cria outra assinatura.
11. **Workspace com `plan_source='manual'` não faz switch**: o `writeWorkspacePlan`
    preserva plano manual, então um comp manual "pro" com mensal Stripe compraria o anual
    "start" e continuaria com recursos pro; a copy de concessão imediata viraria mentira.
    409 pré-reserva; workspaces compados trocam via suporte (mesma filosofia dos planos
    internos).

## Invariantes preservados

- Webhooks nunca trocam provider (`canWebhookWrite` intocado em comportamento).
- Flip de provider + amount-mirror + markers no MESMO statement, CAS no provider observado.
- Mirror = total observado do gateway. Sem novo trial (`hasEverSubscribed`).
- Reserva atômica antes de qualquer chamada remota que CRIE recurso (o retrieve read-only
  da Stripe antes da reserva é exceção documentada, não cria nada).
- Cancel nunca sobrescreve `current_period_end` com null. Hardening Fase 4 intocado.
- Dados de cartão nunca tocam banco/logs/PostHog; copy PT-BR sem travessão.

## Design: backend

### Fluxo do switch (em `pagarme-checkout`, modo `switch: true` no body)

1. **Parse**: `parseCheckoutBody` aceita `switch === true` opcional (presente e
   não-boolean → 400). Clientes velhos sem o campo continuam recebendo 409 (troca de
   provider só em checkout explicitamente autorizado).
2. **Gate local** (novo pure `stripeSwitchSourceEligible(row)`): `(provider ?? 'stripe')
   === 'stripe'` && `stripe_subscription_id` && `status ∈ {active, trialing}` (estrito,
   NÃO `isInForce`; past_due não passa) && `billing_interval !== 'year'` (null passa; o
   local não é confiável, autoridade é o remoto). `pagarmeCheckoutBlocked` fica intocado;
   o handler aplica o carve-out: bloqueado && !(isSwitch && eligible) → 409.
3. **Verificação remota** (antes da reserva; read-only): novo `_shared/stripe-switch.ts`
   com gateway injetável (factory recebe a key como argumento; `_shared/stripe.ts` lança
   no import e quebraria ambientes dark) e pure `assessStripeSourceSub`: status ∈
   {active,trialing}, `items.data[0].price.recurring.interval === 'month'`, period end
   dual-read (root, depois item; padrão acacia/basil do stripe-webhook), period end > now.
   Falha → 409 (`switch_not_eligible`; fronteira já passada → "Sua renovação está em
   processamento. Tente novamente em alguns minutos."). Tudo com timeout 10s.
4. **Plano-fonte não nulo + plan_source, resolvidos ANTES da reserva**: ler
   `workspaces.plan_id, plan_source`. `plan_source === 'manual'` → 409 pré-reserva
   (decisão 11). Plano-fonte = `workspaces.plan_id ?? row.plan_id` (a fonte efetiva
   declarada pela aplicação vem primeiro; o stripe-webhook grava `plan_id: null` para
   price desconhecido, então o grandfathered chegaria com row.plan_id null e o fallback
   por price falharia no undo). Divergência entre os dois → log. Sem fonte restaurável
   (ambos null) → 409 antes de criar qualquer coisa: um switch cujo undo não consegue
   cumprir "continua como estava" não pode ser aceito.
5. **Gate de quarentena**: existe attempt `quarantined` para o workspace → 409
   "Encontramos uma cobrança que precisa de revisão. Fale com o suporte." (decisão 10),
   antes da reserva. É só a mensagem amigável; a garantia real é o índice único alargado
   (a reserva do passo 6 leva 23505 → 409 se uma quarentena existir).
6. **Reserva atômica**: fluxo existente de `pagarme_checkout_attempts`; o código não
   muda, mas o índice único parcial passa a cobrir `pending` E `quarantined` (migration).
7. **Create Pagar.me**: fluxo existente (customer → card → subscription) com
   `start_at = ceilToUtcMidnightDate(periodEnd da Stripe)` (refactor extraindo o ceil de
   `resolveStartAt`). O `start_at` é date-only (meia-noite UTC), então o ceil empurra a 1ª
   parcela para até 24h DEPOIS do fim do período Stripe. Isso NÃO cria gap de acesso: o
   acesso vem de `workspaces.plan_id`, concedido no bind, e nada o derruba entre a
   fronteira e o start_at (os eventos Stripe da fronteira são negados pelo guard; o leg A
   do cron só derruba linhas canceled). As horas entre a fronteira e o start_at são
   cortesia não cobrada, a direção segura; o floor cobraria o usuário duas vezes pelo
   trecho. NUNCA `resolveTrialDays` neste caminho. Idempotency key da attempt, retry
   ambíguo: existentes.
8. **Status esperado é exatamente `future`**: switch sub nascida `active` = gateway
   cobrou agora com Stripe ainda cobrando → cancela a sub remota + attempt `quarantined`
   + CRITICAL + 500 (decisão 10; NÃO `failed`). Difere do checkout comum, que aceita
   active.
9. **CAS bind**: colunas de `buildPagarmeSubscriptionColumns` + os dois markers
   (`switched_from_stripe_subscription_id = row.stripe_subscription_id`,
   `switched_from_plan_id = <plano-fonte do passo 4>`; o bind sobrescreve `plan_id` com o
   alvo e preços legados não são resolvíveis no undo, então o plano-fonte é persistido
   aqui) + `switch_checked_at = null` (um segundo switch do mesmo workspace entra na
   frente da fila do leg D, não herda a posição antiga), mesmo statement. Pins: os
   existentes (provider observado + stripe_subscription_id) + `.eq('status', row.status)`
   (só no switch): webhook Stripe concorrente que mudou o status entre verify e bind faz
   o CAS falhar → compensating cancel + 409.
10. **Grant do plano**: inalterado. `finishAttempt` no switch move para DEPOIS da perna
    Stripe (passo 11): `succeeded` quando a perna (ou o rollback parcial) deixa a troca de
    pé, `failed` quando o rollback completo desfez tudo. Enquanto isso a attempt segue
    `pending`, bloqueando checkouts concorrentes.
11. **Perna Stripe (última)**: `setCancelAtPeriodEnd(stripe_sub_id, true)` bounded 10s.
    **Falha → rollback completo em-request** (review externo Codex: perto da renovação,
    esperar o cron das 06:00 abriria uma janela real de cobrança dupla, não o residual de
    segundos aceito):
    (i) CAS flip-back num statement, pinado em provider='pagarme' + pagarme_subscription_id
    + status='trialing', via `buildRestoreStripeColumns` (builder compartilhado com o undo,
    em `_shared/pagarme-logic.ts`): provider='stripe', status e `cancel_at_period_end` =
    valores OBSERVADOS no verify (cobre a fonte em churn da decisão 7), plan_id =
    plano-fonte, billing_interval='month', installments=null, current_period_end = period
    end real da Stripe, pagarme_subscription_id=null (leg C varre a future sub se o passo
    iv falhar), markers=null, mirror cleared (auto-cura na leitura do admin);
    (ii) restaura o `cancel_at_period_end` REMOTO ao valor observado (o timeout da perna é
    ambíguo: o `true` pode ter landado; falha aqui → CRITICAL, o mismatch se auto-expõe
    via webhooks Stripe, que voltam a ser aceitos após o flip-back);
    (iii) re-grant do plano-fonte via `writeWorkspacePlan(..., 'stripe')` (falha →
    CRITICAL);
    (iv) DELETE best-effort da future sub Pagar.me (falha → CRITICAL, leg C backstop);
    (v) attempt → `failed` e responde 500 retryable ("Não foi possível concluir a troca.
    Tente novamente.", code `gateway_error`).
    **Rollback parcial** (o CAS do flip-back falhou): a troca fica DE PÉ; 200 `switched` +
    CRITICAL; markers + leg D recuperam (comportamento anterior). Crash entre bind e a
    perna Stripe (sem chance de rollback): markers + leg D, como antes. O webhook
    `customer.subscription.updated` de um cancel bem-sucedido é negado (esperado); a linha
    local nunca espelha o estado Stripe pós-flip: o cron checa o REMOTO.
12. **Response**: shape existente + `switched: true` e `first_charge_at` (o `start_at`
    efetivo; a UI usa esta data autoritativa na tela de sucesso; `trial_ends_at` ignorado
    no modo switch).

### Markers (migration nova)

```sql
alter table workspace_subscriptions
  add column switched_from_stripe_subscription_id text,
  add column switched_from_plan_id text,
  add column switch_checked_at timestamptz;
create index workspace_subscriptions_switch_marker
  on workspace_subscriptions (switch_checked_at, workspace_id)
  where switched_from_stripe_subscription_id is not null;

alter table pagarme_checkout_attempts drop constraint pagarme_checkout_attempts_state_check;
alter table pagarme_checkout_attempts add constraint pagarme_checkout_attempts_state_check
  check (state in ('pending','succeeded','failed','expired','quarantined'));

-- Garantia atômica da quarentena: o índice só-pending deixa um INSERT concorrente entrar
-- no instante em que a attempt sai de pending para quarantined.
drop index one_pending_attempt_per_workspace;
create unique index one_blocking_attempt_per_workspace
  on pagarme_checkout_attempts (workspace_id)
  where state in ('pending','quarantined');
```

(Conferir o nome real do check constraint na migration `20260812000001` antes de
escrever; numerar a migration acima do tail de `origin/main` no momento do PR.)

Os markers servem a: (a) sweep do cron; (b) detecção do undo (marker + trialing) e
restauração do plano-fonte sem depender de price ids legados; (c) sinal do frontend
("Troca agendada"). Escritos só por bind/undo/cron; webhooks não tocam. Enquanto trialing
os markers persistem; limpos pelo cron só quando seguro E status != trialing (sempre os
dois juntos). `switch_checked_at` é bookkeeping do leg D (rotação justa), fora dos
statements de invariante.

### Undo (em `pagarme-subscription`, roteado no `action: 'cancel'`)

Roteamento: antes das precondições atuais, a regra de idempotência (decisão 9): provider
stripe + in-force + sem `pagarme_subscription_id` → 200 `reverted`. Depois, precondição do
undo: marker set && `status === 'trialing'`; nunca chega em `buildCancelColumns` (que
derrubaria o plano na hora). Ordem (TODAS as leituras antes da mutação remota; compensação
imediata em todo exit entre a mutação e o flip confirmado):

1. **Leituras primeiro**: `retrieveSubscription(marker)` (remota terminal canceled/404 →
   decisão 4: cancel comum limpando os dois markers no mesmo CAS); `fetchStripeAmount`
   best-effort (mirror restaurado ou cleared; cleared se auto-cura na leitura do admin);
   plano-fonte = `switched_from_plan_id` (fallback: `resolvePlanFromPriceId` do price
   atual; ambos null → CRITICAL + grant pulado, precedente pagarme-webhook). O CAS do
   passo 3 usa `buildRestoreStripeColumns` (em `_shared/pagarme-logic.ts`, compartilhado
   com o rollback da perna Stripe do checkout), com `cancel_at_period_end: false` (o undo
   acabou de reativar).
2. **Mutação remota**: `setCancelAtPeriodEnd(marker, false)`. O catch da PRÓPRIA mutação
   (timeout é ambíguo: o `false` pode ter landado antes da resposta se perder, o caso
   mais perigoso perto da renovação) tenta imediatamente rearmar
   `setCancelAtPeriodEnd(marker, true)` bounded; só se o rearme também falhar o leg D
   vira backstop (CRITICAL). Depois → 500, NADA local mudou, retryable.
3. **CAS flip-back num statement** (pins: provider='pagarme' + pagarme_subscription_id +
   status='trialing'): provider='stripe', status remoto (active|trialing),
   plan_id = plano-fonte, billing_interval='month', installments=null,
   current_period_end = period end real da Stripe (omitir a chave se ilegível, nunca null
   por cima), cancel_at_period_end=false, pagarme_subscription_id=null (desliga o
   skip_linked → leg C varre a future sub órfã se o passo 5 falhar), os dois
   markers=null, mirror, updated_at.
   Qualquer falha daqui em diante sem flip confirmado (erro/timeout de DB) → compensação
   imediata `setCancelAtPeriodEnd(marker, true)` bounded (falhou também → CRITICAL;
   markers + leg D são o backstop durável) e 500.
   Zero rows → re-read e branch (decisão 8): status active OU past_due (fronteira chegou
   em voo; a 1ª parcela disparou/falhou) → consolida: `cancelNow` da Stripe + CRITICAL +
   409 ("A troca já foi concluída e a primeira parcela foi cobrada." / past_due: "A troca
   já foi concluída e a primeira cobrança está pendente. Atualize o cartão ou cancele a
   assinatura."); status canceled (12x morreu em voo) → um retry do CAS pinado em
   canceled; provider já stripe → 200 `reverted` idempotente.
4. `writeWorkspacePlan(ws, planoFonte, 'stripe')` (falha → CRITICAL + 200, precedente).
5. Best-effort `DELETE` da future sub Pagar.me (nada cobrado); falha → CRITICAL, leg C é
   o backstop (sub fora de linkedIds/pendingIds com metadata.workspace_id → verdict
   cancel no próximo run >1h).
6. Response `{ status: 'reverted', access_until }`. Pós-undo, webhooks Stripe voltam a
   ser aceitos (mesmo provider + mesmo id) e re-sincronizam a linha.

### Cron: leg D novo em `billing-downgrade-cron`

Rows com marker não-null, com rotação justa por `switch_checked_at` (markers persistem a
janela inteira, então tanto um `limit 100` fixo quanto "keyset do menor workspace_id +
cap de páginas" deixam a cauda sem enforcement para sempre; diferente do leg C, cujo
conjunto avança porque órfãs são removidas). Semântica exata (carimbar a própria sort key
durante a paginação quebra offset/keyset ingênuos):

- Fixa `runStartedAt = now()` no início do leg.
- Loop: busca SEMPRE o lote mais antigo com predicado `marker is not null AND
  (switch_checked_at is null OR switch_checked_at < runStartedAt)`, ordenado
  `switch_checked_at asc nulls first, workspace_id asc`, limit 100.
- Cada linha processada recebe `switch_checked_at = now()` (carimbo mesmo no caso "seguro
  mas ainda trialing"), saindo do predicado DESTA execução: dentro do run cada workspace
  aparece exatamente uma vez, sem offset.
- Termina em lote vazio ou no cap de páginas (bound de throughput por run; a próxima
  execução retoma do mais antigo; starvation estruturalmente impossível). Truncamento
  vira flag + entrada em `errors`.

Por linha, retrieve pelo marker (gateway Stripe injetado null-safe; env ausente → skip
com contador):

- 404 / canceled / `cancel_at_period_end=true` → seguro.
- Ativa com `cap_end=false` e janela aberta (provider pagarme + trialing + period end
  remoto ≤ fronteira registrada): `setCancelAtPeriodEnd(true)`; re-read do row depois do
  write: marker sumiu (undo correu no meio) → reverte para `false` (as duas
  intercalações convergem).
- Renovação já disparou ou janela fechou (period end remoto > fronteira, ou status !=
  trialing): `cancelNow` imediato + CRITICAL ("conferir cobrança de renovação para
  refund manual"); `cap_end=true` aqui esperaria mais um mês inteiro.
- Limpa os markers (CAS: workspace_id + marker + status != trialing) só quando seguro E
  fora da janela.

`CronResult` ganha `switchesEnforced, switchesCleared, switchesCanceledNow, switchSkipped,
switchSweepTruncated`.

### Gate de quarentena em `billing-checkout`

`pendingPagarmeAttemptBlocksCheckout` (já consultado lá) ganha o irmão para `quarantined`
(ou o mesmo select passa a cobrir os dois estados): workspace com attempt quarentenada
não abre checkout Stripe nem Pagar.me até resolução manual (decisão 10). Erro de leitura
na checagem de quarentena falha FECHADO, diferente do gate de pending atual, que falha
aberto por design: pending expira sozinho em 15min, quarentena é durável e representa
cobrança possivelmente não estornada.

### Hardening: `billing-portal`

Select ganha `provider, status, switched_from_stripe_subscription_id`; se
`provider==='pagarme'` && (in force || marker) → 409 "Sua assinatura atual é gerenciada
fora do portal Stripe." Sem isso o usuário "renova" o mensal no portal mid-janela, o
webhook é negado e ninguém local percebe (leg D corrigiria em até um dia, mas o buraco
fecha aqui).

## Design: frontend (CRM)

1. **`services/billing.ts`**: select ganha `billing_interval` (gap real: hoje a UI não
   distingue mensal de anual Stripe) e `switched_from_stripe_subscription_id`; interface
   expõe `billingInterval: string | null` e `switchScheduled: boolean` (id cru descartado
   como os demais). `PagarmeCheckoutPayload` ganha `switch?: true`;
   `PagarmeCheckoutResult` ganha `first_charge_at`; `cancelPagarmeSubscription` tipa
   `status: 'canceled' | 'reverted'` + `access_until`.
2. **`plan-display.ts`**: novo pure `switchEligible(subscription)` espelhando o gate do
   backend (provider stripe/null + status active|trialing + billingInterval !== 'year').
   Novo util puro `ceilPeriodEndToUtcDate(iso)` replicando EXATAMENTE a transformação do
   backend (`current_period_end` 15/09 12:00Z vira `start_at` 16/09; exibir a data crua
   prometeria o dia errado), testado com os mesmos casos do `ceilToUtcMidnightDate` do
   Deno. `canUpgradeTo`/`checkoutBlocked` intocados em assinatura; o `renderCta` ganha o
   branch: toggle anual + plano pagarme-gated + `switchEligible` → CTA de switch,
   inclusive no card do plano atual (que hoje mostra só "Plano atual"; o caso mesmo-plano
   é exatamente esse card).
3. **`CobrancaPage.tsx`**:
   - CTA: "Trocar para o anual em 12x" (mesmo plano) / "Mudar para {plano} em 12x"
     (outro), com nota "Primeira parcela prevista para {ceilPeriodEndToUtcDate(...)}. Sem
     cobrança agora." (previsão; a data autoritativa vem no response).
   - Dialog state ganha modo `'switch'`; `handleUpgrade` roteia para ele quando eligible.
   - Manage card na janela (`provider pagarme && trialing && switchScheduled`): badge
     "Troca agendada" (não "Teste"), meta "Primeira cobrança em
     {formatUtcDateBR(current_period_end)}" (aqui a linha local JÁ é o start_at ceiled),
     ações "Atualizar cartão" + "Desfazer a troca" (substitui "Cancelar assinatura").
     Dialog do undo: "Seu plano mensal continua como estava e o 12x agendado é cancelado
     sem cobrança." Sucesso 'reverted' → toast "Troca desfeita. Seu plano mensal continua
     ativo." + `startPlanRefetchPoll()`. O 409 de consolidação (decisão 8) → toast com a
     mensagem do backend + poll.
4. **`PagarmeCheckoutDialog.tsx`**: `mode` ganha `'switch'` + prop `firstChargeAt` (data
   PREVISTA no form, via `ceilPeriodEndToUtcDate`). Copy switch: título "Trocar para o
   anual em 12x"; nota no lugar da de trial: "Sem cobrança agora. A primeira parcela está
   prevista para {data}, quando termina o período que você já pagou." (o form só conhece o
   mirror local: linguagem de previsão em TODO o formulário; definitivo só no sucesso).
   Sucesso usa `first_charge_at` do response (autoritativo): "Troca confirmada!" +
   "Primeira parcela de 12x em {data}." + (mesmo plano) "Até lá nada muda no seu acesso."
   / (troca entre planos) "Os recursos do plano {alvo} passam a valer imediatamente."
   Payload inclui `switch: true`. Sem copy de trial em modo switch.
5. **Sem flag nova**: mesmo gate do 12x (`pagarme_12x_enabled` + `VITE_PAGARME_PUBLIC_KEY`
   + `pagarme_installment_cents > 0`). Rollback = despublicar frontend ou desmarcar o
   plano.

## Cenários de falha/corrida (síntese)

| Cenário | Resultado |
|---|---|
| Crash antes do create | Reserva pending → self-heal 15min / leg B |
| Timeout ambíguo no create | Retry mesma key; órfã → leg C (residual: fronteira <30h, decisão 5) |
| Falha entre create e bind | Compensating cancel da future sub; Stripe intocada (perna é a última) |
| Webhook Stripe concorrente muda status | CAS com pin de status falha → compensa + 409 |
| Perna Stripe falha (sem crash) | Rollback completo em-request → 500 retryable; rollback parcial → 200 + CRITICAL + leg D |
| Crash entre bind e cancel Stripe | Markers set → leg D aplica cap_end=true; renovação já disparou → cancelNow + CRITICAL |
| Double-submit | Unique parcial (pending ou quarantined) → 409 |
| Switch sub nascida active (malfunção) | Cancel remoto + attempt quarantined + 500; checkouts bloqueados até revisão manual |
| Fronteira chega durante o undo (12x active OU past_due) | CAS trialing falha → re-read → consolida: cancelNow Stripe + CRITICAL + 409 copy por estado |
| Timeout ambíguo do cap_end=false do undo | Rearme imediato cap_end=true no catch; falhou também → CRITICAL + leg D |
| Falha de DB/plano entre cap_end=false e flip | Compensação imediata cap_end=true + 500; leg D backstop |
| Retry do undo após resposta perdida | Regra de estado final → 200 reverted (amplitude deliberada, pinada em teste) |
| Undo × leg D | Re-read pós-write do leg D reverte; as duas ordens convergem |
| Portal Stripe mid-janela | Fechado pelo hardening; leg D é o backstop |
| DELETE do undo falha | pagarme_subscription_id limpo → leg C varre a órfã |
| Mais markers que o cap do leg D | Rotação por switch_checked_at garante cobertura eventual; cap é só throughput por run |
| 1ª parcela do 12x falha no start_at | Sub remota ainda viva → past_due + dunning, plano preservado (update-card recupera; comportamento padrão do 12x, sem mudança no pagarme-webhook); sub remota terminal (failed/canceled) → downgrade padrão. Nos dois casos a Stripe já morreu na fronteira, sem cobrança dupla |

Residuais aceitos: renovação mensal disparando na janela de segundos entre verify e bind
(um mês de sobreposição, refund manual); janela trialing fora do MRR (`MRR_STATUSES` só
conta active/past_due; pontual, some quando o 12x ativa).

## Arquivos a modificar

Backend (Deno):

- `supabase/migrations/<versão acima do tail do main>_switch_from_stripe_marker.sql` (novo)
- `supabase/functions/_shared/stripe-switch.ts` (novo: gateway Stripe injetável com
  factory que recebe a key como argumento + assessStripeSourceSub + snapshot/404 helpers;
  consumido por pagarme-checkout, pagarme-subscription E billing-downgrade-cron, cada um
  construindo o gateway atrás de `Deno.env.get("STRIPE_SECRET_KEY")` — null em ambiente
  dark)
- `supabase/functions/_shared/pagarme-logic.ts` (novos pures: buildRestoreStripeColumns,
  stripePortalBlocked; `canWebhookWrite` e demais intocados)
- `supabase/functions/pagarme-checkout/logic.ts` (parse switch,
  stripeSwitchSourceEligible, ceilToUtcMidnightDate, markers em
  buildPagarmeSubscriptionColumns)
- `supabase/functions/pagarme-checkout/handler.ts` + `index.ts` (fluxo switch com
  rollback, dep stripeSwitch)
- `supabase/functions/pagarme-subscription/logic.ts` + `handler.ts` + `index.ts` (undo,
  regra de idempotência, compensação; dep stripeSwitch)
- `supabase/functions/billing-downgrade-cron/handler.ts` + `index.ts` (leg D com rotação;
  dep stripeGateway do _shared/stripe-switch.ts, testes com fake próprio; null → leg
  pulado com flag no CronResult)
- `supabase/functions/billing-checkout/index.ts` (gate de attempt quarentenada,
  fail-closed)
- `supabase/functions/billing-portal/index.ts` (409 para linha pagarme)

Frontend (CRM):

- `apps/crm/src/services/billing.ts`
- `apps/crm/src/pages/configuracao/cobranca/plan-display.ts` + `CobrancaPage.tsx`
- `apps/crm/src/components/billing/PagarmeCheckoutDialog.tsx`

Reuso obrigatório: reserva/self-heal, `buildAttemptIdempotencyKey`, `resolveAmountMirror`,
`mapPagarmeTemporalFields`, `failCompensating`,
`fetchStripeAmount`/`buildAmountColumns`/`clearedAmountColumns`, `resolvePlanFromPriceId`
(só como fallback do plano-fonte), `writeWorkspacePlan`, `grant_pagarme_plan`,
`startPlanRefetchPoll`, `formatUtcDateBR`.

## Testes

Quebram (atualizar): `pagarme-checkout-logic_test.ts:228` (payload exato ganha os dois
markers null); `apps/crm/src/services/__tests__/billing.test.ts` (string do select);
`CobrancaPage.test.tsx` factory do subscription (campos novos) e casos de CTA;
`PagarmeCheckoutDialog.test.tsx` factory de props. Grep pelo shape antigo nas DUAS suítes
antes de mudar assinatura.

Novos (Deno): matriz `stripeSwitchSourceEligible`; `assessStripeSourceSub` (mensal ok,
trialing ok, cap_end=true ok, anual/past_due/fronteira passada/malformado); handler
switch happy path (ordem verify → plano-fonte → carve-out → start_at da fronteira → CAS
com pin de status + os dois markers → grant → setCancelAtPeriodEnd por último → 200
switched + first_charge_at, incluindo switch_checked_at=null no bind); verify-fail 409
antes da reserva (zero attempts); plano-fonte: workspaces.plan_id vem primeiro
(divergência com row.plan_id → log), row.plan_id como fallback, ambos null + price remoto
desconhecido → 409 pré-reserva, `plan_source='manual'` → 409 pré-reserva; born-active →
cancel remoto + attempt QUARANTINED + 500, attempt quarentenada existente → 409 antes da
reserva, e reserva com quarentena concorrente → 23505 → 409; perna Stripe falha →
ROLLBACK completo (CAS flip-back com colunas restauradas incl. cap_end observado, restore
remoto do cap_end, re-grant, DELETE da future sub, attempt failed, 500 retryable) e
variante rollback parcial (CAS do flip-back falha → 200 switched + CRITICAL + attempt
succeeded); CAS zero rows → compensa + 409; stripeSwitch null → 500; switch com price
legado (billing_interval null) persiste plano-fonte; regressão: não-switch continua 409
em linha stripe in-force. billing-checkout: attempt quarentenada → 409; erro de leitura
da quarentena falha FECHADO (contraste pinado com o fail-open do gate de pending). Undo:
roteamento marker+trialing (nunca buildCancelColumns); leituras TODAS antes de
cap_end=false; timeout/erro da PRÓPRIA mutação → rearme remoto cap_end=true verificado no
gateway fake + 500 sem writes locais (e variante em que o rearme falha → CRITICAL); erro
de DB pós-mutação → compensação cap_end=true + 500; falha de lookup de plano com
plano-fonte null → CRITICAL + grant pulado; CAS restaura plan_id = plano-fonte;
zero-rows→active E zero-rows→past_due → cancelNow + 409 (copy distinta, pinada);
zero-rows→canceled → retry; retry pós-undo do estado final → 200 reverted (teste PARTE do
estado pós-undo com resposta perdida); assinatura Stripe comum que nunca fez switch → 200
reverted no-op (regressão da amplitude deliberada, decisão 9); DELETE falha → 200 +
CRITICAL; regressões (cancel sem marker antes existia 404: atualizar; marker + active =
cancel paid-through normal). Leg D: enforce; rotação intra-run: duas páginas numa MESMA
execução, cada workspace exatamente uma vez (predicado runStartedAt exclui os já
carimbados); rotação entre runs: >cap markers, execuções sucessivas cobrem a cauda;
carimbo gravado mesmo no caso "seguro mas trialing"; truncamento vira erro; re-read
reverte; renovação → cancelNow; clear só seguro e fora da janela (os dois markers
juntos); gateway null skip; retrieve falha coleta erro e segue.

Novos (Vitest): switchEligible matrix; `ceilPeriodEndToUtcDate` com os MESMOS casos do
teste Deno do ceil (meia-noite exata, meio-dia, fim de mês); CTA de switch nos cards
(incl. card do plano atual), CTA ausente para anual Stripe/past_due/pagarme; dialog modo
switch (copy com data prevista, payload com switch:true, sem copy de trial, ressalva de
recursos em troca entre planos); sucesso usa first_charge_at; manage card "Troca
agendada" + undo flow + toast 'reverted' + toast do 409 de consolidação.

## Rollout e verificação

1. CI local: lint, format:check, os 4 tsc, `npm run test`, `npm run test:functions`
   (reverter `deno.lock`; `npm ci` depois de deno/deploy antes de confiar em
   prettier/tsc). Migration numerada acima do tail de
   `git ls-tree origin/main:supabase/migrations` no momento do `gh pr create`.
2. Deploy staging: migration (`db push --linked`, conferir `supabase/.temp/project-ref` =
   wlyzhyfondykzpsiqsce) → functions (`--no-verify-jwt --use-api`: pagarme-checkout,
   pagarme-subscription, billing-downgrade-cron, billing-checkout, billing-portal) →
   frontend. Ordem importa: colunas antes das functions; functions antes do frontend que
   manda switch:true.
3. E2E staging: Pagar.me test keys ok, MAS Stripe é conta compartilhada NÃO sandboxed; o
   mensal de teste custa dinheiro real (menor plano, refund depois). Roteiro: assinar
   mensal → switch (future sub no dashboard Pagar.me, cap_end=true no Stripe, linha
   trialing + markers, "Troca agendada" na UI, data prevista = data confirmada) → undo
   (mensal reativado, future sub cancelada, linha stripe/active com plan_id restaurado) →
   switch de novo → invocar o cron com x-cron-secret e conferir contadores do leg D.
4. Prod: mesmo deploy; smoke = abrir a CobrancaPage de um workspace mensal e conferir
   CTA; não executar switch real sem combinar.
5. Runbook da quarentena (decisão 10): o CRITICAL log aponta workspace + sub id; conferir
   no dashboard Pagar.me se a 1ª charge existe e estornar; depois
   `update pagarme_checkout_attempts set state='failed' where id=... and state='quarantined'`
   via `supabase db query` para liberar os checkouts do workspace.
