# Pagar.me 12x — Fase 8: runbook de deploy/flip

Delta de deploy da Fase 8 (preço próprio do 12x + coexistência com o anual à vista). Executar
somente sob ordem explícita do Eduardo — nenhum destes passos roda em CI. Pré-requisito: a
migration `20260815000001_pagarme_installment_price.sql` já existe no branch (coluna
`plans.pagarme_installment_cents`, com backfill id-scoped para `start`/`pro`/`max`).

| Ambiente | project-ref |
|---|---|
| Staging | `wlyzhyfondykzpsiqsce` |
| Prod | `skjzpekeqefvlojenfsw` |

> **Regra de ouro (o link state FLIPA entre sessões — gotcha da casa, já mordeu duas vezes):**
> antes de CADA `db push`, `db query` ou `UPDATE` via SQL editor, rode `cat supabase/.temp/project-ref`
> e confirme que bate com a tabela acima para o ambiente que você pretende tocar. Toda chamada de
> `functions deploy` abaixo carrega `--project-ref <ref>` explícito — nunca depende só do link
> state, justamente para não empurrar um deploy pro projeto errado por causa de uma sessão anterior
> que deixou o link apontando pra outro lugar.

> **Contexto:** o gateway cobra o preço do OBJETO PLAN do Pagar.me; a linha `plans` é o espelho.
> O log CRITICAL de price-drift (Fase 8, Task 2) é o alarme se os dois divergirem — criar/atualizar
> os objetos é sempre um passo manual de ops, nunca automático. O CRM lê `pagarme_installment_cents`
> e `pagarme_12x_enabled` da tabela `plans` (`apps/crm/src/services/billing.ts`,
> `PricingSection.tsx`) via TanStack Query — **isso significa cache, não leitura direta**: a landing
> usa `queryKey: ['landing', 'pricing-plans']` com `staleTime: 5 * 60_000` (5 min,
> `PricingSection.tsx`), e a CobrançaPage usa `queryKey: ['billing', 'plans']` sem `staleTime`
> próprio, herdando o default global de 30s (`QueryClient` em `App.tsx`, `staleTime: 30_000`).
> **Qualquer validação de preço exibido neste runbook precisa assumir catálogo potencialmente
> obsoleto** — dar um reload completo da página (não só re-navegar) ou esperar o `staleTime`
> vencer antes de conferir o número na tela.

## 1. Migration (db push)

Additive-only, segura antes dos deploys de function.

`cat supabase/.temp/project-ref` primeiro — confirme staging antes do push de staging, prod antes
do push de prod:

```bash
npx supabase db push --linked   # staging primeiro, depois prod
```

O backfill embutido na migration (`update plans set pagarme_installment_cents = ... where id =
'start'/'pro'/'max' and pagarme_installment_cents is null`) grava DIRETO os valores-alvo da Fase 8
(9490/12990/18490) — não um valor antigo. Isso existe para o `pagarme-checkout` novo não devolver
`400 plan_not_configured` no instante do deploy da function (Fase 7 já deixou `pagarme_12x_enabled`
`true` em staging). Efeito colateral aceito: assim que este `db push` roda em staging, um
carregamento NOVO (ou um cache já vencido) do card do plano `start` na landing/CobrançaPage passa a
**mostrar** "R$ 94,90" (lê `pagarme_installment_cents` da tabela, sujeito ao cache descrito acima)
enquanto `pagarme_plan_id_annual` ainda aponta pro objeto ANTIGO (total 95900) — ver a ordem da
Seção 2, que existe justamente para fechar essa janela o mais rápido possível.

## 2. STAGING — objetos → linhas → functions → E2E (a flag já está ligada)

**Ordem obrigatória, diferente de prod:** como `pagarme_12x_enabled` já é `true` em staging desde a
Fase 7, a function `pagarme-checkout` ATUAL (pré-Fase 8) já processa checkouts vivos contra o objeto
antigo. Se a function NOVA (que lê `pagarme_installment_cents` para o preço exibido/validado) for
deployada antes de 2.1-2.2, existe uma janela em que o preço anunciado (R$ 94,90 × 12 = R$ 1.138,80)
diverge do que a function nova cobraria pelo objeto ainda antigo (R$ 959,00 total) — a function
velha continua no ar até o deploy, então nenhum checkout real é afetado, mas para eliminar a
divergência por completo o deploy da function fica por ÚLTIMO. A flag não é tocada nesta seção
(fica `true` o tempo todo).

### 2.1 Criar os 3 objetos `plan` novos no sandbox

Chave de teste em `~/.pagarme-spike.env` (fora do repo; nunca commitar, nunca passar como
argumento literal de CLI — sempre por redirecionamento de arquivo). Mesmo shape usado no spike
(`docs/superpowers/specs/2026-08-10-pagarme-12x-fase0-spike/spike.ts`, `createPlan()`):
`interval: "year"`, `installments: [1, 12]`, `billing_type: "prepaid"`, preço TOTAL do ano (não a
parcela) em `items[0].pricing_scheme.price`.

**Antes de criar, procure um objeto já existente.** Um `POST` que respondeu 201 mas cujo id se
perdeu (conexão caiu, terminal fechado antes de anotar) não deve ser recriado às cegas — isso
duplica objetos e arrisca colar o id ERRADO na linha `plans` no passo 2.2. Cada objeto criado por
este runbook carrega um `metadata` determinístico (`mesaas_env` + `mesaas_plan` + `total_cents`)
exatamente para tornar essa busca possível:

```bash
set -a; source ~/.pagarme-spike.env; set +a

curl -sS -u "${PAGARME_TEST_SECRET_KEY}:" "https://api.pagar.me/core/v5/plans?size=100" \
  | jq '.data[] | select(.metadata.mesaas_env == "staging" and .metadata.mesaas_plan == "start" and .metadata.total_cents == "113880")'
# repita trocando mesaas_plan/total_cents para "pro"/"155880" e "max"/"221880"
```

Se aparecer um resultado, reuse o `.id` dele e pule direto para o passo 2.2 — NÃO crie outro. Só
rode o `POST` abaixo para o(s) plano(s) sem resultado:

```bash
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
    "metadata": { "mesaas_env": "staging", "mesaas_plan": "start", "total_cents": "113880" }
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
    "metadata": { "mesaas_env": "staging", "mesaas_plan": "pro", "total_cents": "155880" }
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
    "metadata": { "mesaas_env": "staging", "mesaas_plan": "max", "total_cents": "221880" }
  }'
```

Anote os três `id` (`plan_...`) — do resultado da busca ou da resposta do `POST` — vão para o
passo 2.2.

### 2.2 Atualizar as linhas `plans` — UMA instrução por plano, objeto + parcela juntos

Cada `UPDATE` grava `pagarme_plan_id_annual` (o objeto novo do 2.1) e `pagarme_installment_cents`
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

`cat supabase/.temp/project-ref` → confirme `wlyzhyfondykzpsiqsce` antes de rodar. Rode via
`npx supabase db query --linked` ou pelo SQL editor do projeto STAGING.

### 2.3 Deploy das functions (staging) — só agora

```bash
npx supabase functions deploy platform-admin   --project-ref wlyzhyfondykzpsiqsce --no-verify-jwt --use-api
npx supabase functions deploy pagarme-checkout --project-ref wlyzhyfondykzpsiqsce --no-verify-jwt --use-api
npx supabase functions deploy billing-checkout --project-ref wlyzhyfondykzpsiqsce --no-verify-jwt --use-api
```

`--project-ref` explícito em toda chamada — não depende do link state da sessão (ele flipa entre
sessões e é fácil disparar contra o projeto errado). `--use-api` é obrigatório: o bundler local do
Docker está quebrado neste ambiente (bundling server-side). Só depois deste deploy o preço mostrado
e o preço cobrado ficam garantidamente consistentes de ponta a ponta.

### 2.4 Reafirmar a flag

`cat supabase/.temp/project-ref` → confirme `wlyzhyfondykzpsiqsce` antes de rodar:

```sql
update plans set pagarme_12x_enabled = true where id in ('start', 'pro', 'max');
```

A flag já deve estar `true` (Fase 7); rodar mesmo assim documenta que as três linhas foram
revisadas com os objetos novos antes do checkout novo ser considerado "ativo" de fato. Num
catálogo limpo (sem histórico prévio) a flag NÃO se liga sozinha — este passo é obrigatório.

### 2.5 E2E de validação

**Pré-requisito do browser:** o dev server / build do CRM usado no teste precisa ter
`VITE_PAGARME_PUBLIC_KEY` (a pk de TESTE) definida — sem ela, `isPagarme12xEnabled()`
(`apps/crm/src/lib/pagarme-gate.ts`) cai silenciosamente para o Stripe: nenhum erro, nenhum aviso,
o dialog de 12x simplesmente não abre e o botão redireciona pro checkout Stripe de sempre. Neste
worktree, `.env.staging` já traz essa chave (herdada da sessão da Fase 7) — confirme com
`grep VITE_PAGARME_PUBLIC_KEY .env.staging` antes de rodar `npm run dev:staging`. **A evidência de
aceite é o `PagarmeCheckoutDialog` abrindo** (campos de cartão/CPF/telefone/endereço, copy "12x de
R$..."), não um redirect para o Stripe.

**Preço exibido na tela: assuma cache obsoleto.** A landing cacheia `['landing', 'pricing-plans']`
por 5 minutos e a CobrançaPage cacheia `['billing', 'plans']` pelo `staleTime` global de 30s (ver
nota de cache no topo do doc) — um preço antigo na tela após o `UPDATE` do passo 2.2 não é prova de
nada. Dê um reload completo (F5/Cmd+R, não só re-navegar dentro do SPA) ou espere o `staleTime`
vencer antes de conferir o número exibido.

**Workspace do teste — use um com histórico de cobrança (`hasEverSubscribed = true`), NUNCA um
workspace novo.** Um workspace elegível a trial cria uma subscription `future` (`start_at` +30d):
nenhuma cobrança imediata é gerada — a linha "assert charged total = 113880" não é verificável
nesse caminho (`resolveStartAt` em `pagarme-checkout/logic.ts`; ver também a nota de sandbox: `future`
não autoriza cartão nem cria invoice). Use o workspace de staging já reaproveitado nas fases
anteriores (tem uma linha `pagarme` `canceled` no histórico — `hasEverSubscribed` fica `true` via
`ever_subscribed_at`/`pagarme_subscription_id`), que dispara cobrança imediata (2º checkout da
Fase 7: `hasEverSubscribed ⇒ cobrança imediata, sub ACTIVE`).

Duas validações, uma para cada caminho possível. **Em nenhum dos dois o dialog devolve o id da
subscription nem o preço do objeto** — a resposta de `pagarme-checkout` ao browser é só
`{ status, trial_ends_at, next_charge_at, installment_amount_cents }`
(`pagarme-checkout/handler.ts`), sem `subscriptionId` nem `items`. A verificação real é sempre uma
correlação autenticada via banco + API do gateway, nunca "ler a resposta do dialog":

1. **Se o workspace disponível for trial-elegível** (sem histórico): depois do checkout, leia o
   `pagarme_subscription_id` gravado para esse workspace (`cat supabase/.temp/project-ref` →
   confirme staging primeiro):

   ```bash
   npx supabase db query --linked \
     -f <(echo "select workspace_id, pagarme_subscription_id, status from workspace_subscriptions where workspace_id = '<uuid-do-workspace-de-teste>';")
   ```

   Com o `pagarme_subscription_id` em mãos, busque a subscription real no sandbox (mesma chave de
   teste do passo 2.1, via arquivo):

   ```bash
   set -a; source ~/.pagarme-spike.env; set +a
   curl -sS -u "${PAGARME_TEST_SECRET_KEY}:" \
     "https://api.pagar.me/core/v5/subscriptions/<pagarme_subscription_id>"
   ```

   Assert `plan.id == <id do objeto novo do plano start, do passo 2.1>` e
   `items[0].pricing_scheme.price == 113880`. Não há cobrança para validar (não existe invoice
   nesse caminho — `future` não autoriza cartão na criação).
2. **Com um workspace `hasEverSubscribed = true`** (o caso preferido): rode o checkout completo e
   assert que o total cobrado no gateway é **113880** — não 95900 (preço antigo do objeto anterior)
   nem 9490 (a parcela sozinha, sem ×12). Confira no dashboard Pagar.me (sandbox) que a
   charge/invoice mostra `installments: 12`.

## 3. PROD — flip

### 3.1 Criar os 3 objetos `plan` novos (live)

Mesmo shape do passo 2.1 — INCLUINDO a busca antes de criar (`GET /plans?size=100` filtrando
`metadata.mesaas_env == "prod"` em vez de `"staging"`) — com a chave LIVE (arquivo local fora do
repo, nunca a mesma `~/.pagarme-spike.env` de sandbox — trocar `PAGARME_TEST_SECRET_KEY` pela
secret key live do arquivo de produção do operador, também via `source`/redirecionamento, nunca em
argumento de CLI). O `metadata` do `POST` fica `{ "mesaas_env": "prod", "mesaas_plan":
"start"|"pro"|"max", "total_cents": "113880"|"155880"|"221880" }`.

### 3.2 Atualizar as linhas `plans`

`cat supabase/.temp/project-ref` → confirme `skjzpekeqefvlojenfsw` antes de rodar. Mesmo shape do
passo 2.2 (objeto + parcela na MESMA instrução), com os `id`s dos objetos live.

### 3.3 Deploy das functions (prod)

```bash
npx supabase functions deploy platform-admin   --project-ref skjzpekeqefvlojenfsw --no-verify-jwt --use-api
npx supabase functions deploy pagarme-checkout --project-ref skjzpekeqefvlojenfsw --no-verify-jwt --use-api
npx supabase functions deploy billing-checkout --project-ref skjzpekeqefvlojenfsw --no-verify-jwt --use-api
```

`--project-ref` explícito em toda chamada (mesmo motivo da Seção 2: não depender do link state da
sessão). Em prod a flag ainda está `false` neste ponto, então (ao contrário de staging) não existe
janela de preço divergente aqui: `isPagarme12xEnabled()` e o gate do backend (`if
(!plan?.pagarme_12x_enabled)`) mantêm o caminho antigo (Stripe à vista) até o passo 3.5. A ordem
objetos → linhas → functions é mantida por consistência operacional com a Seção 2, não por
necessidade.

### 3.4 Gate obrigatório ANTES de ligar a flag

Quatro checagens de zero-margin, todas herdadas do gate de flip da Fase 5 (o downgrade-cron sweep é
pré-condição DURA de habilitar 12x em prod) mais o contrato completo do webhook. Qualquer falha aqui
bloqueia o flip, sem exceção:

**(a) `PAGARME_SECRET_KEY` (live) setada em prod.** Sem ela, o checkout 500a de saída (a key é
lazy-throw) e a varredura de órfãs do `billing-downgrade-cron` fica inoperante
(`remoteSkipped: true` — nenhuma proteção contra assinatura órfã cobrando no dia 30). Confirmar
presença (não valor — `secrets list` devolve hash) com:

```bash
npx supabase secrets list   # confirma que PAGARME_SECRET_KEY aparece na lista
```

**(b) Invocar `billing-downgrade-cron` manualmente e ler a resposta real.** `cat
supabase/.temp/project-ref` → confirme `skjzpekeqefvlojenfsw` antes de rodar qualquer SQL abaixo. O
`CRON_SECRET` de um `.env` local pode estar defasado do secret vivo no vault (foi exatamente o que
aconteceu na Fase 7: `curl` com o `CRON_SECRET` do `.env.staging` deu 401) — a forma confiável é
reproduzir a MESMA chamada que o pg_cron faz, direto no banco, lendo o secret do vault em vez de um
arquivo local:

```sql
-- 1) Disparar a chamada assíncrona (pg_net) com os MESMOS secrets do vault que o job agendado usa.
with req as (
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
            || '/functions/v1/billing-downgrade-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) as request_id
)
select request_id from req;
-- anote o request_id retornado

select pg_sleep(3);   -- dá tempo do pg_net completar a chamada

-- 2) Ler o corpo da resposta real (troque :id pelo request_id anotado acima).
select status_code, content::json
  from net._http_response
 where id = <request_id>;
```

Exigir na resposta: `status_code = 200` e no corpo `{ "success": true, "errors": [],
"sweepTruncated": false, "remoteSkipped": false, ... }`. Qualquer `errors` não-vazio,
`sweepTruncated: true` ou `remoteSkipped: true` bloqueia o flip.

**(c) Sem falhas recentes registradas.**

```sql
select * from cron_failures
 where cron_name = 'billing-downgrade-cron'
   and occurred_at > now() - interval '3 days';
```

Deve devolver zero linhas.

**(d) `orphansUnrecognized` revisado.** Se o corpo da resposta do passo (b) trouxer
`orphansUnrecognized > 0`, cada uma foi logada (`console.warn` em
`billing-downgrade-cron/handler.ts`) — abrir os logs da function no dashboard Supabase e explicar
cada uma antes de prosseguir (assinatura manual sem `metadata.workspace_id`, nunca cancelada
automaticamente).

**(e) Webhook de prod — contrato completo, não só "estar registrado".** Todas as partes abaixo,
juntas, no dashboard Pagar.me:

- **URL:** `https://skjzpekeqefvlojenfsw.supabase.co/functions/v1/pagarme-webhook/<PAGARME_WEBHOOK_TOKEN>`
  (o token é o segmento secreto do path — `PAGARME_WEBHOOK_TOKEN` setado no ambiente da function).
- **Autenticação:** toggle "Habilitar autenticação" ligado, usuário/senha = exatamente o par
  `user:senha` codificado em `PAGARME_WEBHOOK_BASIC` (comparação timing-safe no lado da function).
- **Categorias marcadas: Assinatura + Cobrança + Fatura, as três.** Registro parcial (por exemplo
  só Cobrança) deixa cancelamento e dunning sem reconciliar — `subscription.canceled` e os eventos
  de fatura não chegam.
- **Máximo de tentativas: 3** (o valor testado no spike; o handler já tolera reentrega fora de
  ordem via fetch-before-trust).
- **Uma entrega verificada** antes de ligar a flag — **uma linha recente sozinha não prova nada**:
  pode ser resíduo de uma configuração antiga do endpoint, ou de um registro apontando para outro
  ambiente. A prova é uma linha NOVA, correlacionada com uma ação disparada agora. `cat
  supabase/.temp/project-ref` → confirme `skjzpekeqefvlojenfsw` antes de rodar:

  ```sql
  -- 1) Baseline ANTES de disparar qualquer entrega.
  select count(*), max(processed_at) as ultima_antes
    from pagarme_webhook_events;
  ```

  Anote `ultima_antes`. Em seguida dispare uma entrega — pelo botão de teste do endpoint no
  dashboard Pagar.me, se disponível (tipo esperado: `subscription.created` ou similar da categoria
  Assinatura), ou aguardando a primeira entrega real de um checkout de smoke-test — e confirme o
  delta:

  ```sql
  -- 2) DEPOIS da ação: exige uma linha com processed_at posterior ao baseline.
  select event_id, type, processed_at
    from pagarme_webhook_events
   where processed_at > '<ultima_antes anotado no passo 1>'
   order by processed_at desc;
  ```

  Zero linhas aqui = a entrega não chegou (endpoint errado, Basic auth divergente, ou categoria
  não marcada) — bloqueia o flip até resolver. Uma linha nova com o `type` esperado é a prova real
  de que o registro ATUAL do dashboard entrega pra este endpoint com este `PAGARME_WEBHOOK_BASIC`.

**(f) `VITE_PAGARME_PUBLIC_KEY` (a pk LIVE) configurada no Vercel e o CRM redeployado — ANTES do
passo 3.5.** Ordem já conhecida da Fase 6 (load-bearing): se a flag ligar antes da chave live estar
no ar, o checkbox liga um caminho de frontend que tenta tokenizar sem chave (ou com a de teste).

### 3.5 Ligar a flag — só depois de 3.1 a 3.4 completos

`cat supabase/.temp/project-ref` → confirme `skjzpekeqefvlojenfsw` antes de rodar:

```sql
update plans set pagarme_12x_enabled = true where id in ('start', 'pro', 'max');
```

## Rollback

1. **Desmarcar `pagarme_12x_enabled` PRIMEIRO.** Isso mata todos os pontos de entrada novos do
   12x; o anual à vista via Stripe continua funcionando normalmente.
2. **Deixar os objetos de plano do Pagar.me (antigos e novos) como estão.** Objetos são de graça;
   apagar um objeto com assinaturas vivas nunca é permitido.
3. **Assinaturas já criadas nos objetos novos não são afetadas.** Continuam cobrando e
   reconciliando normalmente — o rollback só impede NOVAS vendas pelo caminho 12x, não mexe em
   nada que já existe.

`cat supabase/.temp/project-ref` → confirme o ambiente correto (staging ou prod, conforme onde o
rollback é necessário) antes de rodar:

```sql
update plans set pagarme_12x_enabled = false where id in ('start', 'pro', 'max');
```

## Riscos aceitos (herdados do plano)

- O gateway cobra o preço do OBJETO PLAN; a linha `plans` é o espelho. O log CRITICAL de
  price-drift (Task 2) é o alarme se divergirem; criar/atualizar os objetos continua sendo um
  passo de ops, fora do código.
- Troca mensal→12x ainda exige cancelar e reassinar (postura v1 inalterada).
