# Automação de comentário → DM no Instagram (núcleo ManyChat)

Data: 2026-08-14 · Status: aprovado (design em 3 partes + revisão externa com 9 apontamentos incorporados)

## Problema

Agências pagam ManyChat à parte para o fluxo mais básico de captação no Instagram:
pessoa comenta uma palavra-chave num post → recebe automaticamente uma DM com um
link (isca digital, checkout, agendamento), opcionalmente com uma resposta pública
no comentário. O Mesaas já conecta a conta Instagram de cada cliente (OAuth,
tokens, publicação, analytics) e pode oferecer isso nativamente.

## Escopo do v1

- Gatilhos por palavra-chave: post específico **ou** todos os posts da conta.
- Ações: DM (private reply) com texto livre + resposta pública opcional.
- **Fora do v1**: fluxos multi-etapa, botões/quick replies, follow-up após a DM
  (exigiria `instagram_business_manage_messages` e a janela de 24h de messaging),
  respostas a replies de comentários, superfície no Hub do cliente.

## Decisões

1. **Arquitetura webhook + durable-ack + cron de retry** (padrão `tiktok-webhook`):
   evento cru persistido antes do 200, processamento em `EdgeRuntime.waitUntil`,
   cron varre retries. DM sai em segundos.
2. **Qualquer post da conta IG**, incluindo os publicados fora do Mesaas.
3. **Escopo novo: só `instagram_business_manage_comments`.** Doc oficial da Meta:
   private reply com Instagram Login exige apenas `instagram_business_basic` +
   `instagram_business_manage_comments` — que também cobre o webhook de
   `comments`, `POST /{comment_id}/replies` e `GET /{comment_id}`.
   `instagram_business_manage_messages` fica fora do v1 (só para follow-ups
   futuros). Menos superfície de App Review.
4. **Ship dark + Meta App Review**: flag de plano `feature_instagram_automation`
   nasce `false` em todos os planos. Teste real via override do workspace
   interno com conta que tem papel no app Meta. Submissão do review depois do
   teste real; liberação nos planos depois da aprovação.
5. **UI: página global `/automacoes`** no sidebar, listando automações de todos
   os clientes do workspace.
6. **Pós-downgrade** (padrão do repositório): gate só em INSERT. Automações
   existentes continuam legíveis, tocáveis (pausar/excluir) e **continuam
   executando**; apenas criar novas é bloqueado. Por isso `/automacoes` **não**
   entra em `FEATURE_GATED` — só a criação é gateada.
7. **Papéis**: mutações só `owner`/`admin` (padrão `post_status_automations`);
   `agent` vê read-only. A página não entra em `AGENT_BLOCKED`.
8. **1 DM por comentário** (limite da própria Meta: uma private reply por
   comentário, janela de 7 dias). Desempate determinístico quando mais de uma
   automação casa.

## Arquitetura

### Fluxo

1. OAuth existente passa a pedir `instagram_business_manage_comments`. No
   callback, quando o escopo vier concedido: `POST
   graph.instagram.com/{v}/me/subscribed_apps?subscribed_fields=comments`,
   confirmação via `GET subscribed_apps`, e persistência em
   `instagram_accounts.comments_subscribed_at`.
2. Comentário → Meta → `POST` na nova função `instagram-webhook`: verifica
   `X-Hub-Signature-256` (HMAC-SHA256 do body cru com `META_APP_SECRET`),
   normaliza a entrega em **1 linha por comentário** em
   `instagram_webhook_events` (insert em lote, awaited; falha → 500 e a Meta
   reentrega), responde 200 com corpo vazio, processa via `waitUntil`.
3. Processador: resolve conta(s) pelo `entry.id` → casa automações ativas →
   claim atômico do envio → private reply + resposta pública → máquina de
   estados do envio.
4. `instagram-automation-cron` (5/5 min): claim RPC sobre **envios** retryable;
   varredura de eventos nunca normalizados; expurgo de eventos processados >30
   dias; re-verificação diária de `subscribed_apps` das contas com automação
   ativa.
5. Handshake de verificação: `GET` com `hub.mode=subscribe` +
   `hub.verify_token` comparado com `timingSafeEqual` → ecoa `hub.challenge`.
   Env var nova: `META_WEBHOOK_VERIFY_TOKEN`.

### Dados

Numeração de migrations a partir de `20260815000002` (origin/main termina em
`20260815000001`; re-verificar o tail no PR).

**`instagram_comment_automations`** — a regra:

- `id uuid pk`, `conta_id uuid NOT NULL`, `client_id bigint NOT NULL`.
  **Tenancy estrutural, não só RLS**: `UNIQUE (id, conta_id)` na própria
  tabela (alvo da FK composta de sends) e FK composta
  `(client_id, conta_id) → clientes (id, conta_id)` — exige
  `ALTER TABLE clientes ADD CONSTRAINT clientes_id_conta_uq UNIQUE (id,
  conta_id)` (padrão de `20260805000002_post_status_automations.sql:36`).
  RLS adicionalmente com EXISTS de posse do cliente em USING e WITH CHECK
  (`20260806000002_instagram_connect_links.sql`).
- `name text NOT NULL`, `ig_media_id text NULL` (NULL = todos os posts) +
  snapshot `media_permalink`/`media_caption` para a UI não depender do sync dos
  últimos 50 posts.
- `keywords text[] NOT NULL` (≥1), `dm_message text NOT NULL`,
  `public_reply text NULL`, `ativo boolean DEFAULT true`.
- `dms_sent_count int DEFAULT 0`, `last_triggered_at timestamptz`,
  `created_at`/`updated_at` + trigger de `updated_at`.
- RLS: SELECT para qualquer membro do workspace; INSERT/UPDATE/DELETE só
  `get_my_role() in ('owner','admin')`; `service_role_bypass`. **Desvio
  intencional** do padrão `post_status_automations` (que restringe também o
  SELECT a owner/admin): aqui `agent` lê para acompanhar resultados, sem
  mutar.
- Gate INSERT-only:
  `enforce_plan_feature('feature_instagram_automation','direct','conta_id')`.
- Índices parciais `(conta_id) WHERE ativo`, `(client_id) WHERE ativo`.

**`instagram_webhook_events`** — 1 linha por comentário/change, não por
delivery. O `entry` da Meta é array e cada entry pode trazer vários changes;
as fixtures oficiais mostram duas formas (`entry[].changes[]` e
`entry[].field/value`) — o parser trata ambas e itera todas as entries:

- `id uuid pk`, `delivery_id uuid` (agrupa linhas do mesmo POST),
  `ig_user_id text`, `comment_id text`, `raw jsonb` (o change + metadados da
  entry), `received_at`, `processed_at`.
- RLS ligada **sem** policies (só service role). Índice parcial
  `received_at WHERE processed_at IS NULL`.
- Deliberadamente **append-only**, sem unicidade por `comment_id`: redelivery
  gera linha nova e reprocessa de forma idempotente (o efeito externo é
  deduplicado pelo `comment_id UNIQUE` de sends); o expurgo de 30 dias limita
  o crescimento.
- `from`/`parent_id` não são garantidos no payload: fallback =
  `GET /{comment_id}?fields=from,parent_id,text,media,timestamp` com o token
  da conta; se ainda indeterminado → skip seguro (loga, não envia DM).
- **`comment_created_at`**: vem do timestamp do value quando presente, senão
  do fallback GET, senão `received_at` como aproximação conservadora (o
  webhook chega segundos após o comentário). A janela de 7 dias da private
  reply e o corte de retry usam essa coluna — `received_at` sozinho não é a
  base correta do prazo, que conta da criação do comentário.

**`instagram_automation_sends`** — máquina de estados explícita do envio
(evento durável ≠ envio):

- `id uuid pk`, `comment_id text UNIQUE` (idempotência global),
  `automation_id uuid`, `conta_id uuid` (denormalizado p/ RLS) com **FK
  composta tenant-safe `(automation_id, conta_id) →
  instagram_comment_automations (id, conta_id)`** — a escrita é service role
  (fora da RLS), e a FK torna estruturalmente impossível associar a automação
  de um workspace ao `conta_id` de outro. `media_id`, `commenter_id`,
  `commenter_username`, `comment_text` (excerpt),
  `comment_created_at timestamptz` (base da janela de 7 dias),
  `public_reply_id text`.
- `status text CHECK IN
  ('processing','retry','sent','sent_partial','failed','skipped')`,
  `skip_reason text`, `error_code text`, `dm_status`/`public_reply_status`
  (sub-resultados), `processing_at timestamptz`, `next_attempt_at timestamptz`,
  `attempts int DEFAULT 0`, `created_at timestamptz NOT NULL DEFAULT now()`,
  `updated_at`.
- Fluxo: o claim (INSERT `status='processing', processing_at=now` ON CONFLICT
  DO NOTHING; conflito = outro worker ou redelivery, ignora) acontece numa
  **RPC que toma `pg_advisory_xact_lock` sobre o hash de
  `(automation_id, commenter_id)` e revalida o cooldown na mesma transação**
  (usada pelo webhook e pelo cron) — dois comentários simultâneos do mesmo
  usuário têm `comment_id` distintos e o UNIQUE sozinho não os serializa.
  **Cada efeito externo é persistido separadamente** (as chamadas à Meta não
  participam de transação): DM aceita → `dm_status='sent'` gravado
  imediatamente em statement próprio, e é **nessa transição** (RPC atômica,
  condicional a `dm_status` ainda não ser `sent`) que
  `dms_sent_count`/`last_triggered_at` incrementam — independentemente da
  resposta pública; crash não perde nem duplica contador. Só então a resposta
  pública → grava `public_reply_id` + `public_reply_status`. Retry de linha
  com `dm_status='sent'` **pula a DM** e completa só a resposta pública. DM
  com resultado incerto (timeout) → `retry`; na retentativa, o erro da Meta
  "já existe private reply para este comentário" é mapeado para
  `dm_status='sent'` (auto-correção — a private reply é única por
  comentário). **A resposta pública NÃO é idempotente**: timeout ambíguo →
  reconciliação via `GET /{comment_id}/replies` procurando reply da própria
  conta com o texto configurado (achou → grava `public_reply_id`);
  inconclusivo → `public_reply_status='unknown'`, **sem nova tentativa
  automática** (nunca postar duas vezes). Estados terminais: `sent` (todos os
  efeitos configurados ok), `sent_partial` (DM enviada, resposta pública
  `failed`/`unknown`), `failed`, `skipped`. Erro transitório →
  `status='retry', next_attempt_at=now+backoff, attempts+1`. Cooldown →
  inserido direto como `skipped`/`cooldown`.
- Claim RPC do cron opera sobre sends: `WHERE (status='retry' AND
  next_attempt_at<=now) OR (status='processing' AND
  processing_at<now-interval '10 min')`, `FOR UPDATE SKIP LOCKED`, seta
  `processing`/`processing_at`, devolve `encrypted_access_token`/
  `instagram_user_id` via join (molde de `claim_posts_for_publishing` +
  `20260807000002_claim_skip_nonretryable.sql`). O join **exige conta apta**:
  `authorization_status='active'`, escopo `manage_comments` explícito em
  `permissions[]` e `comments_subscribed_at IS NOT NULL` — backlog de conta
  que perdeu permissão/assinatura (ex.: reconexão sem o escopo) vira
  `failed`/`account_unauthorized` em vez de retry eterno.
- SELECT por RLS de workspace (log na UI); escrita só service role. Índices
  `(automation_id, created_at DESC)`, `(conta_id, created_at DESC)`.

**Resolução de conta duplicada.** `instagram_accounts` só tem
`UNIQUE(client_id)` — o mesmo `instagram_user_id` pode estar ativo em clientes
ou workspaces distintos. Sem retrofit de UNIQUE no v1: candidatos = linhas com
`instagram_user_id = entry.id` e `authorization_status='active'`. Regra de
isolamento: **se automações ativas casam o comentário em MAIS de um workspace,
ninguém envia** (fail-closed: nenhuma linha em sends — não há dono único para o
registro; evento marcado processado; notificação `instagram_automation_failed`
para cada workspace envolvido, dedupe 24h). Um workspace jamais consome o
único private reply de uma conta que outro workspace também administra.
Duplicidade **dentro do mesmo workspace** (dois clientes com a mesma conta IG)
é resolvida pelo desempate normal — é configuração do próprio dono. Índice
novo **não-único** em `instagram_accounts (instagram_user_id)`.

**Desempate determinístico** (dentro do workspace): post específico > todos os
posts; depois `created_at ASC`, `id ASC`. A UI documenta: "se mais de uma
automação casar, a mais antiga vence". Sem campo `priority` no v1.

**Outros:**

- `ALTER TABLE plans ADD COLUMN feature_instagram_automation boolean NOT NULL
  DEFAULT false` (padrão `20260721000001_feature_mensagens.sql`).
- `instagram_accounts.comments_subscribed_at timestamptz NULL`.
- Notificação `instagram_automation_failed`: append no CHECK de
  `notifications_type_check` copiando a lista da definição mais recente (hoje
  `20260811000003`; re-verificar). Emitida em falha de autorização, dedupe de
  24h por cliente.
- Migration do pg_cron no formato subselect de `vault.decrypted_secrets`
  (é VIEW, não função — template `20260811000004`), aplicada **depois** do
  deploy da função.

### Regras de processamento

- **Matching** (módulo puro testável): normalização dos dois lados (lowercase
  + NFD sem acentos); palavra/frase inteira contida — `promo` casa "quero a
  promo!" e não casa "compromisso"; keyword com espaços vira frase. Múltiplas
  keywords por automação; qualquer uma dispara.
- **Filtros**: ignora comentários da própria conta (anti-loop com a resposta
  pública); ignora replies (`parent_id` presente); cooldown de 24h por
  (automação, commenter) → `skipped`/`cooldown`.
- **Envio**: DM `POST /{v}/{ig_user_id}/messages` com body
  `{recipient:{comment_id}, message:{text}}`; resposta pública
  `POST /{v}/{comment_id}/replies`. Token em `Authorization: Bearer`, nunca em
  query string.
- **Erros**: transitórios (graph codes 4/9/17/613, reuso de
  `_shared/publish-error-codes.ts`) → `retry` com backoff exponencial (1 min, 5 min, 15 min, 1 h, 6 h), máx. 5 tentativas,
  nunca após 7 dias de `comment_created_at`. Código 190 →
  `authorization_status='expired'` + notificação, sem retry. Permanentes
  (comentário apagado, DM bloqueada pelo destinatário) → `failed`, sem retry,
  sem notificação.
- **Throttle interno**: cap conservador **configurável** (default 700 private
  replies/hora/conta — não há fonte oficial verificável para o limite exato
  da Meta, então não o tratamos como tal) + tratamento dos códigos/headers de
  rate limit da Graph; excedente vira `retry`.
- **Timeout em toda I/O**: todas as chamadas à Graph API no processador e no
  cron passam pelo cliente compartilhado com `AbortSignal.timeout` (~10 s) —
  regra da casa: I/O em handler que assume estado precisa de timeout; um
  fetch pendurado seguraria o lock de `processing` até expirar e permitiria
  reclaims repetidos.
- **Revalidação no envio**: o worker re-lê a automação **e a conta**
  imediatamente antes das chamadas externas — a automação precisa existir e
  estar `ativo` (usa `dm_message`/`public_reply` **atuais**; edições valem
  até o envio real; pausar/excluir entre o claim e o envio vira
  `skipped`/`automation_inactive`) e a conta precisa seguir apta
  (`authorization_status='active'` + escopo explícito +
  `comments_subscribed_at`); resta uma janela de poucos segundos, aceita e
  documentada.
  `sends.automation_id` é FK `ON DELETE CASCADE` — excluir a automação leva o
  log junto, decisão consciente.

### Escopos, reconexão e assinatura

- A string de escopos hoje está triplicada
  (`instagram-integration/index.ts:157`, `:264`,
  `instagram-connect-link/handler.ts:10`) → extrair para
  `_shared/instagram-scopes.ts` e adicionar só
  `instagram_business_manage_comments`.
- O escopo novo é **opcional** no check `MISSING_PERMISSIONS` (o trio básico
  continua obrigatório) e **fail-closed no registro**: nunca entra no fallback
  otimista de `permissions[]` (hoje o callback grava os escopos pedidos quando
  a Meta omite a lista); só é persistido quando vier explícito na resposta.
- `canAutomate` por conta = escopo explícito concedido **e**
  `comments_subscribed_at` preenchido. Cron re-verifica diariamente a
  assinatura das contas com automação ativa; se caiu, limpa e notifica.
- **Reconexão zera antes de regravar**: o callback limpa
  `comments_subscribed_at` e remove o escopo opcional de `permissions[]` no
  início do processamento, re-adicionando só com concessão explícita + nova
  confirmação da assinatura — reconectar sem o escopo não deixa `canAutomate`
  verdadeiro por resíduo da autorização anterior.
- Contas conectadas antes da mudança → página de Automações mostra
  "Reconectar Instagram para habilitar" (derivação no padrão do `canPublish`
  em `store/integrations.ts`).
- Extrair a constante de versão da Graph API (hoje só
  `_shared/instagram-publish-utils.ts:158` pina `v22.0`).

### Edge functions

- **`instagram-webhook`** (nova): `index.ts` (env + DI) / `handler.ts` (puro),
  padrão `tiktok-webhook`. **Sem CORS** (server-to-server, como os webhooks de
  billing). `verify_jwt = false` no `config.toml` + registro em
  `REQUIRED_FUNCTIONS` do `__tests__/config-audit_test.ts`. Nunca ecoa payload
  na resposta.
- **`instagram-automation-cron`** (nova): `x-cron-secret` + `timingSafeEqual`;
  claim RPC de sends; sweep de eventos órfãos; expurgo 30d; re-check de
  assinaturas; `reportCronFailure` de `_shared/triage.ts`. Também exige
  `verify_jwt = false` no `config.toml` + registro em `REQUIRED_FUNCTIONS`
  (como todo cron da casa — sem isso o gateway exige JWT e o `x-cron-secret`
  nunca chega a autenticar).
- **`instagram-integration`** (alterada): escopo novo + `subscribed_apps`
  (POST + GET de confirmação) no callback + `comments_subscribed_at`.
- CRUD das automações: PostgREST + RLS via `store/` — sem edge function.
- Cliente compartilhado novo `_shared/instagram-messaging.ts` (forma de
  `_shared/tiktok.ts`), reusando `decryptToken` (já exportado de
  `_shared/instagram-publish-utils.ts`). `throwGraphError` e a constante de
  versão `GRAPH_BASE` são **privados** hoje — a extração os move para um
  módulo público compartilhado (`_shared/instagram-graph.ts`) consumido pelo
  cliente novo e pelo publish-utils.

## UI (CRM)

- **Página `/automacoes`** (`apps/crm/src/pages/automacoes/`): lista global —
  nome, cliente + avatar, alvo (thumbnail do post ou "Todos os posts"), chips
  de keywords, DMs enviadas, última ativação, `Switch` ativo, editar/excluir —
  com filtro por cliente e empty state. Expandir uma automação mostra o log de
  envios (de `instagram_automation_sends`). Controles de mutação escondidos
  para `agent`.
- Dialog criar/editar: cliente (só com IG conectado; sem `canAutomate` → CTA
  "Reconectar"), alvo (todos os posts | grid dos últimos posts sincronizados
  via `GET /posts/:clientId` — máx. 50, limitação conhecida), keywords
  (chips), mensagem da DM (textarea), resposta pública opcional. Form no
  padrão `AutomationsSection` do `StatusTab.tsx`; criação envolta em
  `FeatureGate`.
- **Gating**: `/automacoes` fora de `FEATURE_GATED`; só criação gateada
  (`FeatureGate` + trigger de INSERT). Nav visível quando
  `feature_instagram_automation` **ou** `count(automations) > 0` (head-count
  via RLS, cache TanStack ~5 min; pequena extensão do gating do
  `nav-data.ts`). Ship dark preservado: flag off + zero automações =
  invisível; URL direta nesse estado → empty state com upsell.
- Fiação da rota (contrato do CI `vercel-routing.test.ts`): `App.tsx`,
  `APP_ROUTE_PREFIXES` em `content/site-meta.ts`, os **dois** regex do
  `vercel.json` (noindex + rewrite `/app.html`), `nav-data.ts`,
  `lib/entitlement-errors.ts` (`FEATURE_LABELS`), `useWorkspaceLimits.ts`
  (`FeatureFlags`), admin `lib/api.ts` (`Plan` + `FEATURE_FLAG_KEYS/LABELS`).
- `store/instagramAutomations.ts` (funções async puras, padrão
  `store/postStatuses.ts`) + barrel `store/index.ts`;
  `handleEntitlementMutationError` explícito nos catch de mutação (o
  `MutationCache` global não vê denials de trigger em writes diretos).
- Notificação nova em `store/notifications.ts` (union) +
  `lib/notification-config.ts` (case) + teste.

## Testes

- **Deno** (`npm run test:functions`): handshake GET (token certo/errado);
  assinatura inválida → drop; falha no insert → 500; parser com múltiplas
  entries e ambas as formas de payload; redelivery → conflito ignorado; skip
  de comentário próprio/reply/fallback GET; matching (acentos, frase, palavra
  inteira); cooldown, incluindo **cooldown concorrente** (dois comentários
  simultâneos do mesmo commenter → 1 DM, via advisory lock); claim
  concorrente; máquina de estados (retry com backoff, 190, permanente,
  efeitos persistidos separadamente, contador na transição de `dm_status`,
  retry com `dm_status='sent'` pula a DM, "já respondido" → auto-correção,
  resposta pública ambígua → reconciliação via GET replies ou `unknown` sem
  repost, `sent_partial`); revalidação no envio (pausada/excluída → skipped;
  conta inapta → `account_unauthorized`); conta duplicada (conflito
  cross-workspace → fail-closed + notificação; intra-workspace → desempate);
  cron (claim, purge, re-check). Restaurar `deno.lock` depois
  (`git checkout -- deno.lock`).
- **Vitest** (`npm run test`): store, página, notification-config, nav
  "flag OR count>0"; os testes de contrato de rota/nav existentes cobram a
  fiação.
- **SQL entitlements**: `supabase/tests/entitlements/65_instagram_automations.sql`
  — gate de INSERT, tenancy, agent não muta (owner/admin sim), downgrade
  mantém existentes.
- Antes do push: 4 `tsc` (crm, hub, admin, scripts) + `npm run lint` +
  `npm run format:check`.

## Runbook — teste real e App Review

1. Deploy completo em produção com a flag desligada em todos os planos
   (invisível para todo mundo).
2. Override no workspace interno; conta IG real **com papel no app Meta**
   (nunca o workspace DK TESTE — tokens de IG falsos).
3. Reconectar o IG → verificar `canAutomate` → criar automação → comentar a
   keyword → DM chega + resposta pública + log/contadores na UI.
4. Painel da Meta (ação do usuário): configurar o webhook do produto
   Instagram — callback `https://<projeto>.supabase.co/functions/v1/instagram-webhook`
   + `META_WEBHOOK_VERIFY_TOKEN` — e assinar o campo `comments`.
5. Submeter App Review de `instagram_business_manage_comments` (Advanced
   Access): screencast do fluxo completo (conectar → criar automação →
   comentar → DM chega) + justificativa: automação de atendimento a
   comentários para contas profissionais gerenciadas por agências.
6. Após aprovação: ligar `feature_instagram_automation` nos planos escolhidos
   (admin).

## Deploy (ordem)

1. Migrations (staging primeiro; re-verificar prefixos contra origin/main).
2. Functions com `--use-api --no-verify-jwt`: `instagram-webhook`,
   `instagram-automation-cron`, `instagram-integration`.
3. Secret `META_WEBHOOK_VERIFY_TOKEN` via `supabase secrets` (file-redirection,
   nunca literal em CLI).
4. Painel da Meta (webhook + campo `comments`).
5. Migration do pg_cron por último (função já no ar).
6. Frontend via merge (Vercel).
