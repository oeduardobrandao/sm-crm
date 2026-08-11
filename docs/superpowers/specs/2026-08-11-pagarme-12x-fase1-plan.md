# Fase 1 — Pagar.me 12x: fundação (migration + módulos compartilhados)

Fase 1 do plano aprovado de parcelamento 12x via Pagar.me. Objetivo: toda a fundação de dados e
lógica pura, com **zero mudança de comportamento observável** (colunas novas com default
`'stripe'`, nenhum fluxo novo ligado). Contexto essencial: a Stripe segue dona do mensal;
o Pagar.me entrará como segundo provider para o anual em 12x nas fases seguintes.

## Global Constraints

- **Zero mudança de comportamento.** Todo refactor deve ser comportamentalmente idêntico; a
  suíte Deno existente (`npm run test:functions`) deve passar sem alterar expectativas de
  testes existentes, exceto onde a task mandar explicitamente estender um teste.
- Edge functions rodam em **Deno** (imports `npm:` ou relativos `.ts`). Módulos de lógica pura
  em `supabase/functions/_shared/` não podem importar Stripe/Supabase/env (padrão de
  `_shared/billing-logic.ts` e `_shared/dunning-logic.ts`); testes em
  `supabase/functions/__tests__/<nome>_test.ts` com `Deno.test`.
- Segredos via env com throw-if-missing no load do módulo (padrão `_shared/stripe.ts`). Nunca
  logar segredo; nunca CORS wildcard (não se aplica aqui: nenhum endpoint novo nesta fase).
- Depois de rodar `npm run test:functions`, o `deno.lock` da raiz fica sujo: rode
  `git checkout -- deno.lock` antes de commitar.
- Commits pequenos por task, mensagem em inglês no padrão do repo
  (`feat(billing): ...` / `refactor(billing): ...`), terminando com
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Trabalhe SEMPRE dentro do worktree
  `/Users/eduardosouza/Projects/sm-crm/.claude/worktrees/instagram-post-lookback-406f72`
  (confira com `pwd` e `git branch --show-current` = `claude/brasil-12x-installments-469c77`
  antes de editar qualquer arquivo).
- Fatos de sandbox que fundamentam estas specs (não re-questionar): Pagar.me v5 exige `plan_id`
  em subscriptions; status reais observados: `future | active | canceled | failed`; e-mail de
  customer é único (create repetido ATUALIZA o mesmo customer, então um customer pode servir N
  workspaces); webhooks entregam com HTTP Basic simples; entregas chegam fora de ordem no mesmo
  segundo.

## Task 1: Migration de fundação do provider Pagar.me

Criar `supabase/migrations/20260812000001_pagarme_provider.sql` (prefixo deve ficar ACIMA do
tail atual de `origin/main`, que é `20260811000006`; não usar prefixo duplicado — o CI
`migration-version-guard` barra).

Conteúdo, nesta ordem:

1. `workspace_subscriptions` (tabela criada em `supabase/migrations/20260609120003_workspace_subscriptions.sql`; leia-a antes):
   ```sql
   alter table workspace_subscriptions
     add column provider text not null default 'stripe'
       constraint workspace_subscriptions_provider_check check (provider in ('stripe','pagarme')),
     add column pagarme_customer_id text,
     add column pagarme_subscription_id text unique,
     add column installments int,
     add column ever_subscribed_at timestamptz;
   ```
   `pagarme_customer_id` é deliberadamente SEM unique (customer é compartilhado por e-mail
   entre workspaces do mesmo dono). Comentar isso em SQL comment na própria migration.
2. Backfill da flag de trial (a coluna `updated_at` existe na tabela):
   ```sql
   update workspace_subscriptions
     set ever_subscribed_at = coalesce(ever_subscribed_at, updated_at)
     where stripe_subscription_id is not null;
   ```
3. Recriar o CHECK de `workspaces.plan_source` incluindo `'pagarme'`. O check atual foi criado
   inline em `supabase/migrations/20260609120001_billing_workspace_columns.sql:13-14` com os
   valores `('system','stripe','manual')` e nome auto-gerado. Para não depender do nome:
   ```sql
   do $$
   declare c record;
   begin
     for c in
       select conname from pg_constraint
       where conrelid = 'workspaces'::regclass
         and contype = 'c'
         and pg_get_constraintdef(oid) ilike '%plan_source%'
     loop
       execute format('alter table workspaces drop constraint %I', c.conname);
     end loop;
   end $$;
   alter table workspaces add constraint workspaces_plan_source_check
     check (plan_source in ('system','stripe','manual','pagarme'));
   ```
4. `plans`: `add column pagarme_12x_enabled boolean not null default false` (gate de rollout,
   flip sem deploy) e `add column pagarme_plan_id_annual text` (id do objeto plan no Pagar.me;
   obrigatório porque a API v5 exige plan_id em subscriptions).
5. Tabela de reserva atômica de checkout:
   ```sql
   create table pagarme_checkout_attempts (
     id uuid primary key default gen_random_uuid(),
     workspace_id uuid not null references workspaces(id) on delete cascade,
     state text not null default 'pending'
       check (state in ('pending','succeeded','failed','expired')),
     pagarme_subscription_id text,
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   );
   create unique index one_pending_attempt_per_workspace
     on pagarme_checkout_attempts (workspace_id) where state = 'pending';
   ```
6. Ledger de dedup de webhook:
   ```sql
   create table pagarme_webhook_events (
     event_id text primary key,
     type text,
     processed_at timestamptz not null default now()
   );
   ```
7. RLS nas duas tabelas novas: habilitar RLS e política service_role-only, copiando exatamente
   o shape usado em `20260609120003_workspace_subscriptions.sql` (leia as linhas de
   `alter table ... enable row level security` + `create policy` de lá e replique para as duas
   tabelas). Nenhum acesso anon/authenticated.
8. Comentário de cabeçalho na migration explicando em 3-4 linhas o propósito (segundo provider
   de billing, aditivo, comportamento inalterado com defaults).

Verificação da task: `ls supabase/migrations | sort | tail -3` mostra o arquivo acima do tail;
`deno` não se aplica; rode `npm run test:functions` para garantir que nada quebrou (nenhum
teste toca a migration; é smoke) e reverta `deno.lock`.

## Task 2: Cliente HTTP `_shared/pagarme.ts`

Criar `supabase/functions/_shared/pagarme.ts`, espelhando o padrão de `_shared/stripe.ts`
(leia-o): env com throw-if-missing no load do módulo.

Requisitos:

- `const PAGARME_API_BASE = "https://api.pagar.me/core/v5";`
- Env: `PAGARME_SECRET_KEY` obrigatória, throw no load (`throw new Error("PAGARME_SECRET_KEY is required")`).
- Export puro e testável `buildPagarmeAuthHeader(secretKey: string): string` que retorna
  `"Basic " + btoa(secretKey + ":")` (a API autentica com Basic user=secret key, senha vazia).
- Export `pagarmeFetch<T>(method: string, path: string, body?: unknown, opts?: { idempotencyKey?: string }): Promise<T>`:
  - `fetch(PAGARME_API_BASE + path)` com headers `Authorization` (via buildPagarmeAuthHeader),
    `Content-Type: application/json`, e `Idempotency-key: opts.idempotencyKey` quando presente
    (header exatamente com esse casing; a doc do Pagar.me o trata como case-sensitive).
  - `AbortSignal.timeout(5000)` em toda chamada (mesma justificativa do timeout em
    `_shared/stripe-amount.ts`: chamada pendurada não pode segurar handler).
  - Em `!res.ok`: lançar `PagarmeApiError` (classe exportada, `extends Error`) carregando
    `status: number` e `body: unknown` (json parseado com catch → null). NUNCA incluir a
    secret key na mensagem.
  - Em ok: retorna json parseado.
- Teste `supabase/functions/__tests__/pagarme-client_test.ts`: apenas o que é puro —
  `buildPagarmeAuthHeader` (valor exato para um sk de exemplo) e `PagarmeApiError` (status/body
  preservados, mensagem sem o body inteiro). NÃO testar `pagarmeFetch` (exigiria env+rede);
  para o módulo importar sem env em teste, o throw de env deve estar em função
  `requirePagarmeKey()` chamada dentro de `pagarmeFetch`, não no top-level do módulo — ajuste o
  padrão: o throw acontece na PRIMEIRA chamada, não no import (documente no comentário do
  módulo por que difere de `_shared/stripe.ts`: módulo precisa ser importável pelos testes de
  lógica sem env).

Verificação: `npm run test:functions` verde; reverter `deno.lock`.

## Task 3: Lógica pura `_shared/pagarme-logic.ts` + testes

Criar `supabase/functions/_shared/pagarme-logic.ts` (ZERO imports de rede/env/Supabase; padrão
de `_shared/billing-logic.ts` — leia-o, e leia também `statusToPlanId` lá definido) e
`supabase/functions/__tests__/pagarme-logic_test.ts`.

Funções e contratos:

1. `normalizePagarmeStatus(remote: string): "trialing" | "active" | "canceled" | null`
   - `"future"` → `"trialing"` (assinatura com start_at futuro = nosso trial; NUNCA persistimos
     "future"); `"active"` → `"active"`; `"canceled"` → `"canceled"`; `"failed"` → `"canceled"`
     (status real não documentado, observado quando a 1ª cobrança falha; nenhum plano foi
     concedido nesse caso, então a semântica de canceled é segura); qualquer outro → `null`
     (chamador loga e NÃO escreve).
2. `isInForce(status: string | null | undefined): boolean` — true para
   `active | trialing | past_due`.
3. `isPaidThrough(row: { status?: string | null; cancel_at_period_end?: boolean | null; current_period_end?: string | null }, now: Date): boolean`
   — true quando `status === "canceled"` E `cancel_at_period_end` E `current_period_end` existe
   e é > now. (Assinante 12x cancelado que já pagou o ano: mantém acesso até o fim do período.)
4. `canWebhookWrite(existing: { provider?: string | null; stripe_subscription_id?: string | null; pagarme_subscription_id?: string | null; status?: string | null; cancel_at_period_end?: boolean | null; current_period_end?: string | null } | null, incoming: { provider: "stripe" | "pagarme"; subscriptionId: string; isAuthorizedBind?: boolean }, now: Date): boolean`
   Regra central do plano: **webhooks nunca trocam o provider da linha**; rebind só em evento
   de checkout autorizado. Matriz normativa (cada linha vira teste nomeado):
   - Linha inexistente (`existing === null`): stripe com `isAuthorizedBind` → true; qualquer
     outro caso → false. Nota de intenção (governa a Fase 4, não esta função): quando
     `canWebhookWrite` devolve false por assinatura desconhecida/ainda não bindada, o HANDLER
     responde **5xx** (não ack) e só insere no ledger de dedup APÓS handle bem-sucedido — as
     retentativas do Pagar.me são limitadas a 3, então a janela de corrida entre a criação
     remota no checkout e a escrita local se resolve num retry, e uma assinatura genuinamente
     alheia (criada à mão no dashboard) morre após 3 tentativas sem envenenar nada.
   - Provider da linha ≠ provider do evento e a assinatura do dono está in-force OU
     paid-through → **false** (teste nomeado: "late Stripe deleted after switch does not
     write"; teste nomeado: "late Stripe deleted does not write during pagarme paid-through").
   - Provider da linha ≠ provider do evento, dona NÃO in-force nem paid-through, e o evento é
     stripe com `isAuthorizedBind` → true (workspace que churnou do Pagar.me pode voltar via
     novo checkout Stripe). Sem `isAuthorizedBind` → false (teste nomeado: "webhook never
     switches provider").
   - Provider igual, id do evento === id registrado na linha (`stripe_subscription_id` ou
     `pagarme_subscription_id` conforme o provider) → true.
   - Provider igual, linha sem id registrado (null) → true somente com `isAuthorizedBind`
     (primeiro bind); senão false.
   - Provider igual, id diferente do registrado → `isAuthorizedBind` ? true (rebind autorizado,
     ex.: nova assinatura após churn) : false (teste nomeado: "payment_failed for an
     unregistered subscription does not write").
5. `resolvePagarmePlanTarget(status: "trialing" | "active" | "canceled" | "past_due", subscribedPlanId: string, defaultPlanId: string, row: { cancel_at_period_end?: boolean | null; current_period_end?: string | null }, now: Date): string | null`
   - `trialing`/`active` → `subscribedPlanId`; `past_due` → `null` (graça, como
     `statusToPlanId`); `canceled` com `isPaidThrough` → `null` (acesso até o fim; downgrade é
     do cron); `canceled` sem paid-through → `defaultPlanId`.
6. `mapPagarmeTemporalFields(sub: { status: string; start_at?: string | null; next_billing_at?: string | null; current_cycle?: { end_at?: string | null } | null }): { current_period_end: string | null }`
   - `future` → `start_at` (fronteira do trial = primeira cobrança; observado em sandbox: sub
     future NÃO tem next_billing_at/current_cycle); `active` → `current_cycle.end_at`, senão
     `next_billing_at`, senão null; demais → null.
7. `buildChargeDunningKey(chargeId: string, attempt: number | null | undefined): string` →
   `` `${chargeId}:${attempt ?? "na"}` `` e
   `shouldAdvanceDunning(lastKey: string | null | undefined, incomingKey: string): boolean` →
   true só quando `incomingKey !== lastKey` (retries reais avançam o estágio; redeliveries do
   mesmo charge+attempt não; sandbox não produz payload de falha, então a chave usa só o que é
   estável: charge id + attempt quando existir).

Testes: um `Deno.test` por linha da matriz de `canWebhookWrite` com os nomes citados, mais
casos de cada função (incluindo `normalizePagarmeStatus("weird")` → null e paid-through com
`current_period_end` no passado → false). Use datas fixas (`new Date("2026-08-11T00:00:00Z")`),
nunca `Date.now()` direto em asserts.

Verificação: `npm run test:functions` verde (novos testes incluídos); reverter `deno.lock`.

## Task 4: Extrações compartilhadas (plan-writer, dunning-notify, hasEverSubscribed)

Refactor comportamentalmente idêntico. Leia antes: `supabase/functions/stripe-webhook/index.ts`
(inteiro), `supabase/functions/_shared/billing-logic.ts`,
`supabase/functions/_shared/dunning-email.ts`, `supabase/functions/billing-checkout/index.ts`.

1. Criar `supabase/functions/_shared/plan-writer.ts`: mover a função `writeWorkspacePlan` de
   `stripe-webhook/index.ts` (linhas ~240-246) para cá com assinatura
   `writeWorkspacePlan(svc, workspaceId: string, planId: string, planSource: "stripe" | "pagarme")`.
   Preservar EXATAMENTE o guard existente: lê `workspaces.plan_source`; se `'manual'` (comp de
   admin), não escreve; senão escreve `plan_id` + `plan_source = planSource`. `stripe-webhook`
   passa `"stripe"`. Manter o comentário original que explica o guard.
2. Criar `supabase/functions/_shared/dunning-notify.ts`: mover `notifyOwnerOfFailure` de
   `stripe-webhook/index.ts` (linhas ~192-231) para cá, JUNTO com suas dependências locais:
   - o helper `formatAttemptLabel` (definido logo abaixo, ~linhas 233-237) migra para
     `dunning-notify.ts` (não é usado por mais ninguém no stripe-webhook; confirme com grep);
   - `appBaseUrl` continua importado de `../_shared/app-url.ts` (o novo módulo importa de
     `./app-url.ts`);
   - `sendDunningEmail`/`selectDunningStage` importados como hoje (`./dunning-email.ts`,
     `./dunning-logic.ts`).
   Assinatura provider-neutra (remove o tipo `Stripe.Invoice` da interface):
   `notifyOwnerOfFailure(svc, workspaceId: string, inputs: { attemptCount: number; nextPaymentAttempt: number | null }, episode: { next_payment_attempt: string | null })`
   — internamente idêntica (lookup do owner em workspace_members → auth.admin e-mail,
   `selectDunningStage(inputs.attemptCount, inputs.nextPaymentAttempt)`,
   `formatAttemptLabel(episode.next_payment_attempt)`, `sendDunningEmail`, engolir TODOS os
   erros com o mesmo comentário de por quê). O call site em `handlePaymentFailed` adapta os
   campos da invoice Stripe para esse shape. Comportamento byte-idêntico para o fluxo Stripe
   (mesmos e-mails, mesmos estágios, mesma billingUrl).
3. Em `_shared/billing-logic.ts`, adicionar:
   ```ts
   export function hasEverSubscribed(row: { ever_subscribed_at?: string | null; stripe_subscription_id?: string | null; pagarme_subscription_id?: string | null } | null | undefined): boolean
   ```
   → true se qualquer um dos três for truthy. Doc-comment: flag permanente de elegibilidade de
   trial, provider-agnóstica.
4. Em `billing-checkout/index.ts`: incluir `ever_subscribed_at, pagarme_subscription_id` no
   select da linha ~66-69 e trocar `resolveTrialDays(Boolean(subRow?.stripe_subscription_id))`
   (linha ~92) por `resolveTrialDays(hasEverSubscribed(subRow))`. Comportamento hoje idêntico
   (colunas novas são null em todas as linhas).
5. Testes: estender `supabase/functions/__tests__/billing-logic_test.ts` com casos de
   `hasEverSubscribed` (null row, só stripe id, só pagarme id, só ever_subscribed_at, nenhum).
   A suíte existente inteira deve continuar verde SEM tocar em nenhuma expectativa existente.

Verificação: `npm run test:functions` completo verde; reverter `deno.lock`. Grep para garantir
que `stripe-webhook/index.ts` não define mais `writeWorkspacePlan` nem `notifyOwnerOfFailure`
localmente e importa dos novos módulos.

## Task 5: `revertPlanTarget` provider-aware

Leia `supabase/functions/platform-admin/revert-target.ts` (19 linhas) e ache o call site com
`grep -rn "revertPlanTarget" supabase/functions/`.

1. Nova assinatura:
   `revertPlanTarget(sub: { status?: string | null; plan_id?: string | null; provider?: string | null; cancel_at_period_end?: boolean | null; current_period_end?: string | null } | null, defaultPlanId: string, now: Date): { plan_source: "stripe" | "pagarme" | "system"; plan_id: string }`
   Regras, nesta ordem:
   - Assinatura viva (mesma regra atual de DEAD_STATUSES) com `plan_id` → devolve
     `plan_source: sub.provider === "pagarme" ? "pagarme" : "stripe"` (default stripe preserva
     o comportamento atual para linhas sem provider) + `plan_id` da assinatura.
   - **Paid-through NÃO é morta**: `status === "canceled"` com `cancel_at_period_end` e
     `current_period_end > now` (use `isPaidThrough` de `_shared/pagarme-logic.ts`, criado na
     Task 3) → tratar como viva: devolve o provider da linha + `plan_id` da assinatura.
     Racional: um 12x cancelado que já pagou o ano mantém acesso até o fim do período;
     descompar esse workspace não pode rebaixá-lo para free na hora (o downgrade é do
     cron/webhook no fim do período).
   - Senão (morta de verdade), `system` + defaultPlanId como hoje.
   Atualizar o doc-comment: descompar uma assinatura Pagar.me viva (ou paid-through) devolve o
   controle ao webhook/checkout do provider dela, nunca à Stripe.
2. No call site (platform-admin), incluir `provider, cancel_at_period_end, current_period_end`
   no select da linha de `workspace_subscriptions` que alimenta essa função, e passar
   `new Date()` como `now`.
3. Testes: localizar o teste existente de revert-target (`grep -rln "revertPlanTarget" supabase/functions/__tests__/`)
   e estender: assinatura pagarme viva → `plan_source: "pagarme"`; sem provider → `"stripe"`
   (regressão); morta → `"system"`; **canceled paid-through (period_end futuro) → provider da
   linha, não system**; canceled com period_end no passado → `"system"`. Expectativas
   existentes intocadas. Datas fixas nos testes, nunca `Date.now()` em asserts.

Verificação: `npm run test:functions` verde; reverter `deno.lock`.
