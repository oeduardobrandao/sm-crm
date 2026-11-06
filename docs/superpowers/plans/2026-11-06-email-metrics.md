# Métricas de e-mail transacional Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Receber os webhooks do Resend numa tabela própria, marcar cada envio com seu tipo e mostrar no Admin (`/admin/emails`) enviados, taxa de entrega e taxa de bounce por período, no geral e por tipo.

**Architecture:** Uma edge function `resend-webhook` verifica a assinatura Svix e chama uma RPC que faz upsert monotônico em `email_sends` (uma linha por e-mail). Um classificador único (`_shared/email-classify.ts`) decide categoria e tipo pela tag `type` ou, sem tag, pelo remetente e assunto; o mesmo classificador alimenta o backfill. O `platform-admin` ganha `email-metrics` (agrega numa função SQL) e `email-backfill` (pagina `GET /emails` do Resend); o Admin ganha a página.

**Tech Stack:** Deno edge functions, Postgres (Supabase), React 19 + TanStack Query + shadcn no `apps/admin`, Vitest, `deno test`, suítes psql em `supabase/tests/`.

**Spec:** `docs/superpowers/specs/2026-11-06-email-metrics-design.md`

**Mockups:** https://claude.ai/artifact/XRJHWFVgFg2F8iBA5P9cRR

## Global Constraints

- Dois PRs. **PR A** = Tasks 1 a 5 (migration, webhook, classificador, tags), deployado e mergeado antes de segunda 2026-11-09 09:00 SP. **PR B** = Tasks 6 a 8 (ações do `platform-admin` e a página), depois. A migration inteira (inclusive `email_metrics`) vai no PR A, para o PR B não ter migration.
- Migration com prefixo único acima do topo de `main` na hora do `gh pr create` (hoje o topo é `20261120000001`; use `20261121000001` e renumere se `main` andou).
- Valores de tag só `[A-Za-z0-9_-]`.
- Categorias (valores exatos): `notificacoes`, `ciclo_de_vida`, `convites`, `cobranca`, `relatorios`, `afiliados`, `interno`, `externo`, `outros`.
- `last_event` normalizado (valores exatos): `sent`, `delivery_delayed`, `delivered`, `failed`, `suppressed`, `canceled`, `bounced`, `complained`. Precedência: `sent` 0 < `delivery_delayed` 1 < `delivered` 2 < `failed`/`suppressed`/`canceled` 3 < `bounced` 4 < `complained` 5.
- `recipient`, `subject` e `bounce_message` só gravados quando o estado é `bounced`, `complained`, `failed` ou `suppressed`; zerados após 90 dias. `bounce_message` truncado em 500 caracteres.
- `email_sends` e `email_webhook_events`: RLS ligada, `revoke all ... from public, anon, authenticated`, grants só a `service_role`. Funções SQL `security definer`, `set search_path = public`, `revoke execute ... from public, anon, authenticated`, `grant execute ... to service_role`. Nenhuma coluna `cliente_id`.
- `RESEND_WEBHOOK_SECRET` obrigatório, sem default, `throw` no carregamento do módulo. `resend-webhook` deploya com `--no-verify-jwt`.
- Copy do Admin em português, sem travessão. Enviados = tudo menos `failed`/`suppressed`/`canceled`; é a base de todas as taxas.
- Taxa de entrega = (`delivered` + `complained`) / Enviados. Taxa de bounce = `bounced` / Enviados. Taxa de reclamação = `complained` / (`delivered` + `complained`). Base zero → "Sem envios".
- KPIs, gráfico e lista de bounces excluem `interno` e `externo`.
- Limiares: bounce > 4% e reclamação > 0,08% em vermelho.
- Nunca logar payload nem destinatário. Erros genéricos para fora.

## Review Focus

- Evento chega fora de ordem (`delivered` depois de `bounced`, `sent` depois de `delivered`): o estado não regride. Teste psql na Task 2.
- Mesmo `svix-id` entregue duas vezes (retry do Resend): a segunda chamada não altera nada e responde 200. Teste psql na Task 2 e Deno na Task 4.
- Envio às 23h50 em São Paulo com `delivered` às 00h10: conta no dia do envio, não no seguinte, e o fuso é São Paulo, não UTC (um envio às 22h SP é dia seguinte em UTC). Teste psql na Task 3.
- Backfill rodado duas vezes, ou depois do webhook já ter gravado a linha: não duplica nem rebaixa a linha do webhook. Teste Deno na Task 6.
- Assunto com nome de agência contendo acento, emoji ou parênteses (`CONNECT_LINK_SUBJECT`): o matcher ainda reconhece. Teste Deno na Task 1.

---

## PR A

### Task 1: Classificador e assuntos de nurture exportados

**Files:**
- Create: `supabase/functions/_shared/email-classify.ts`
- Modify: `supabase/functions/_shared/nurture-emails.ts` (extrair os assuntos do `switch` de `buildNurtureEmail` para `nurtureSubject(step, p)` exportada; `buildNurtureEmail` passa a usá-la, saída idêntica)
- Test: `supabase/functions/__tests__/email-classify_test.ts`

**Interfaces:**
- Consumes: `WELCOME_SUBJECT`, `THANKYOU_SUBJECT`, `buildTrialReminderEmail` (`_shared/lifecycle-emails.ts`); `CONNECT_LINK_SUBJECT`, `CONNECTED_NOTICE_SUBJECT` (`_shared/instagram-connect-email.ts`); `buildNurtureEmail`, `NURTURE_STEPS`, `NURTURE_SAMPLE`, `NurtureStep` (`_shared/nurture-emails.ts`); `clientEventSubject` (`client-event-email-cron` / `_shared/client-event-email.ts`, onde estiver exportado); `REPORT_FROM_ADDRESS` (`_shared/report-template/email.ts`).
- Produces:
  - `type EmailCategory = "notificacoes" | "ciclo_de_vida" | "convites" | "cobranca" | "relatorios" | "afiliados" | "interno" | "externo" | "outros"`
  - `type EmailEvent = "sent" | "delivery_delayed" | "delivered" | "failed" | "suppressed" | "canceled" | "bounced" | "complained"`
  - `const EMAIL_TYPES: Record<string, EmailCategory>` com as chaves: `notification_digest`, `client_event`, `agenda_lembrete`, `agenda_cliente` → `notificacoes`; `welcome`, `thank_you`, `trial_reminder`, `nurture_a1`..`nurture_a4`, `nurture_b1`..`nurture_b4`, `nurture_a4_b4`, `instagram_connect`, `instagram_connected` → `ciclo_de_vida`; `invite`, `demo_access` → `convites`; `dunning` → `cobranca`; `report` → `relatorios`; `affiliate_link` → `afiliados`; `founder_signup`, `founder_subscription`, `cron_failure`, `retention_radar` → `interno`.
  - `function classifyEmail(p: { tags?: Record<string, string> | null; from: string; subject: string }): { category: EmailCategory; type: string }`
  - `function normalizeLastEvent(v: string): EmailEvent` (`opened`/`clicked` → `delivered`; `queued`/`scheduled` → `sent`; desconhecido → `sent`)
  - `function eventFromWebhookType(t: string): EmailEvent | null` (`email.sent` → `sent` ... `email.suppressed` → `suppressed`; outros → `null`)
  - `const PII_EVENTS: ReadonlySet<EmailEvent>` = `bounced`, `complained`, `failed`, `suppressed`
  - `function tagValue(s: string): string` (troca qualquer caractere fora de `[A-Za-z0-9_-]` por `_`)

- [ ] **Step 1: Write the failing tests** (`email-classify_test.ts`)
  - `tag conhecida vence o remetente`: `classifyEmail({tags:{type:"nurture_b2"}, from:"Mesaas <alertas@mesaas.com.br>", subject:"x"})` → `{category:"ciclo_de_vida", type:"nurture_b2"}`.
  - `tag desconhecida cai no fallback`: tag `type:"xyz"` com remetente `cobranca@` → `{cobranca, dunning}`.
  - `remetentes fixos`: `alertas@` → `interno`; `cobranca@` → `dunning`; `afiliados@` → `affiliate_link`; `relatorios@` com nome de workspace no display → `report`; `convites@` → `invite`; `convites@` com o assunto do acesso demo (gerado por `buildDemoAccessEmail`/constante exportada de `invite-email.ts`) → `demo_access`.
  - `paridade de assuntos (eduardo@)`: para cada `step` de `NURTURE_STEPS`, gera o assunto por `buildNurtureEmail({...NURTURE_SAMPLE, step, ...})` e espera `nurture_<step>`, exceto `a4` e `b4` → `nurture_a4_b4`; `b1` testado também com `clientCount` 0, 1 e 5 (ou o campo equivalente de `NURTURE_SAMPLE`). `WELCOME_SUBJECT` → `welcome`; `THANKYOU_SUBJECT` → `thank_you`; trial com e sem plano e `daysLeft` 1 e 7 → `trial_reminder`; `CONNECT_LINK_SUBJECT("Agência Ação (SP) 🚀")` → `instagram_connect`; `CONNECTED_NOTICE_SUBJECT` → `instagram_connected`. Remetente nesses casos: `"Eduardo do Mesaas <eduardo@mesaas.com.br>"`.
  - `notificacoes@`: `clientEventSubject("Agência X")` com remetente `"Agência X <notificacoes@mesaas.com.br>"` → `client_event`; assunto desconhecido → `{notificacoes, notificacao}`.
  - `fora do domínio`: `"a@outro.com"` → `{externo, desconhecido}`; `eduardo@` com assunto desconhecido → `{ciclo_de_vida, desconhecido}`; remetente `mesaas.com.br` não mapeado → `{outros, desconhecido}`.
  - `normalizeLastEvent`: `opened`→`delivered`, `clicked`→`delivered`, `queued`→`sent`, `scheduled`→`sent`, `canceled`→`canceled`, `bounced`→`bounced`, `"nope"`→`sent`.
  - `eventFromWebhookType("email.opened")` → `null`; os sete assinados mapeiam.
  - `tagValue("nurture_a1")` → igual; `tagValue("ação")` → `"a__o"`.
- [ ] **Step 2: Run, expect FAIL** — `deno test --no-check supabase/functions/__tests__/email-classify_test.ts` → módulo não encontrado.
- [ ] **Step 3: Extract `nurtureSubject` in `nurture-emails.ts`, then implement `email-classify.ts`.** O endereço sai do `from` pelo trecho entre `<` e `>` (ou o `from` inteiro), em minúsculas. Matchers de assunto do `eduardo@` como lista `{type, test: (s) => boolean}` montada a partir das constantes/funções importadas: para assuntos com parte variável, gere o assunto com marcador (ex.: `CONNECT_LINK_SUBJECT("\u0000")`), divida no marcador e teste prefixo + sufixo. Não copie strings literais de assunto. O trial usa regex derivada do texto fixo de `buildTrialReminderEmail` (o builder pode exportar uma função `trialReminderSubject` para isso).
- [ ] **Step 4: Run, expect PASS**, e rode `deno test --no-check supabase/functions/__tests__/nurture-emails_test.ts supabase/functions/__tests__/lifecycle-emails_test.ts` (se existirem) para provar que os assuntos não mudaram.
- [ ] **Step 5: Commit** — `feat(email): classificador de e-mails por tag, remetente e assunto`

### Task 2: Migration: tabelas e `email_sends_apply_event`

**Files:**
- Create: `supabase/migrations/20261121000001_email_sends.sql`
- Test: `supabase/tests/email_sends_rpcs.sql` (roda pelo `scripts/test-entitlements.sh`, loop de `supabase/tests/*.sql`)

**Interfaces:**
- Produces:
  - Tabela `public.email_sends` com as colunas da spec (`email_id text pk`, `category`, `type`, `sent_at`, `last_event` com check nos oito valores normalizados, `bounce_type`, `bounce_subtype`, `bounce_message`, `recipient`, `subject`, `source` com check `webhook|backfill`, `created_at`, `updated_at` default `now()`), índices `(sent_at)` e `(category, sent_at)`.
  - Tabela `public.email_webhook_events(svix_id text primary key, received_at timestamptz not null default now())`.
  - `public._email_event_rank(text) returns int` (immutable).
  - `public.email_sends_apply_event(p_svix_id text, p_email_id text, p_event text, p_sent_at timestamptz, p_category text, p_type text, p_has_tag boolean, p_bounce_type text, p_bounce_subtype text, p_bounce_message text, p_recipient text, p_subject text) returns boolean` — `false` quando o `svix_id` já existia (nada aplicado), `true` caso contrário.

- [ ] **Step 1: Write the failing psql suite.** Siga o formato de `supabase/tests/stream_retention.sql` (`\set ON_ERROR_STOP on`, `begin`, blocos `do $$ ... assert ... $$`, `rollback`). Casos:
  - insere `sent` → linha com `last_event='sent'`, `source='webhook'`, `recipient` nulo mesmo se passado.
  - `delivered` depois → `delivered`; `sent` depois disso (outro svix) → continua `delivered`.
  - `bounced` depois de `delivered` → `bounced`, com `bounce_type`, `recipient`, `subject` gravados; `delivered` depois → continua `bounced`.
  - `complained` vence `bounced`.
  - `delivery_delayed` → `bounced` sobe.
  - mesmo `svix_id` duas vezes → segunda retorna `false`; linha inalterada (compare `updated_at`).
  - `category`/`type` não mudam num segundo evento com outra classificação; mas uma linha `source='backfill'` recebendo evento com `p_has_tag=true` passa a ter a categoria/tipo do evento e `source='webhook'`.
  - `bounce_message` de 800 caracteres grava 500.
  - grants: `has_table_privilege('authenticated','public.email_sends','select')` é falso; `has_function_privilege('authenticated', 'public.email_sends_apply_event(text,text,text,timestamptz,text,text,boolean,text,text,text,text,text)', 'execute')` é falso.
- [ ] **Step 2: Run, expect FAIL** — com Supabase local de pé (`npx supabase start`; ver memória de colima): `psql "$(npx supabase status -o env | sed -n 's/^DB_URL=//p' | tr -d '"')" -f supabase/tests/email_sends_rpcs.sql` → função inexistente. Sem Docker, deixe o CI rodar e marque o passo.
- [ ] **Step 3: Write the migration.** O upsert é `insert ... on conflict (email_id) do update set ... where _email_event_rank(excluded.last_event) > _email_event_rank(email_sends.last_event) or (email_sends.source = 'backfill' and p_has_tag)`, com `last_event` só subindo (`case` pelo rank) e as colunas de PII gravadas só quando o estado novo está no conjunto PII. Antes do upsert, `insert into email_webhook_events ... on conflict do nothing`; sem linha inserida, `return false`. Limpeza oportunista no fim: `if random() < 0.01 then` apague `email_webhook_events` com `received_at < now() - interval '7 days'` e zere `recipient`, `subject`, `bounce_message` de `email_sends` com `sent_at < now() - interval '90 days'` e `recipient is not null`. Cabeçalho da migration com o rollback (drop das funções; as tabelas podem ficar).
- [ ] **Step 4: Run, expect PASS** (mesmo comando).
- [ ] **Step 5: Commit** — `feat(email): tabela email_sends e upsert monotônico dos eventos do Resend`

### Task 3: Função `email_metrics`

**Files:**
- Modify: `supabase/migrations/20261121000001_email_sends.sql` (anexar)
- Test: `supabase/tests/email_sends_rpcs.sql` (anexar)

**Interfaces:**
- Produces: `public.email_metrics(p_start date, p_end date) returns jsonb`, EXECUTE só `service_role`, formato:
  ```
  { "coverage_start": timestamptz|null,
    "by_type": [{ "category", "type", "sent", "delivered", "bounced", "complained", "delayed", "pending", "not_sent" }],
    "daily":   [{ "day": "YYYY-MM-DD", "sent", "delivered", "bounced", "other" }],
    "recent":  [{ "sent_at", "category", "type", "last_event", "bounce_type", "bounce_message", "recipient_masked", "subject" }] }
  ```
  Dia = `(sent_at at time zone 'America/Sao_Paulo')::date` entre `p_start` e `p_end` inclusive. `sent` = linhas fora de `failed|suppressed|canceled`; `delayed` = `delivery_delayed`; `pending` = `sent`; `not_sent` = `failed|suppressed|canceled`. `daily` e `recent` só de categorias fora de `interno`/`externo`; `daily` tem um item por dia do intervalo (zeros incluídos, via `generate_series`); `other` = `sent − delivered − bounced` do dia (inclui reclamações, atrasados e pendentes). `recent` = até 50 linhas com `last_event in ('bounced','complained','failed','suppressed')`, mais recentes primeiro. `recipient_masked` = primeira letra do usuário + `***@` + domínio (`j***@gmail.com`); nulo se `recipient` nulo. Rejeita `p_end < p_start` ou intervalo > 366 dias com `raise exception` (o `platform-admin` valida antes; isto é a rede).

- [ ] **Step 1: Write the failing psql cases:** fixture com linhas diretas em `email_sends` (insert como superuser no teste): uma `delivered` em `2026-11-09 02:50 UTC` (23h50 SP do dia 8) conta em `2026-11-08`; uma `interno` bounce não aparece em `daily` nem em `recent` mas aparece em `by_type`; `failed` conta em `not_sent` e não em `sent`; `complained` conta em `sent`; `recipient_masked` de `joao@gmail.com` é `j***@gmail.com`; intervalo de 3 dias sem dados devolve 3 itens zerados em `daily`; `p_end < p_start` levanta erro.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** em SQL puro (`language sql stable` ou plpgsql), com os grants do Global Constraints.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(email): agregação email_metrics por período em São Paulo`

### Task 4: Edge function `resend-webhook`

**Files:**
- Create: `supabase/functions/_shared/svix-verify.ts`
- Create: `supabase/functions/resend-webhook/handler.ts`
- Create: `supabase/functions/resend-webhook/index.ts`
- Test: `supabase/functions/__tests__/svix-verify_test.ts`, `supabase/functions/__tests__/resend-webhook_test.ts`
- Modify: `CLAUDE.md` (env var `RESEND_WEBHOOK_SECRET`; `resend-webhook` na lista de `--no-verify-jwt`)

**Interfaces:**
- Consumes: `classifyEmail`, `eventFromWebhookType`, `PII_EVENTS` (Task 1); RPC `email_sends_apply_event` (Task 2).
- Produces:
  - `async function verifySvixSignature(p: { secret: string; id: string | null; timestamp: string | null; signature: string | null; body: string; nowSeconds: number; toleranceSeconds?: number /* default 300 */ }): Promise<boolean>`
  - `interface ResendWebhookDeps { secret: string; now: () => number /* ms */; applyEvent: (args: ApplyEventArgs) => Promise<boolean> }` e `async function handleResendWebhook(req: Request, deps: ResendWebhookDeps): Promise<Response>`; `ApplyEventArgs` espelha os parâmetros da RPC sem o prefixo `p_`.

- [ ] **Step 1: Read** a página da Svix "Verifying payloads manually" e confirme: conteúdo assinado `${id}.${timestamp}.${body}`, chave = base64-decode da parte depois de `whsec_`, HMAC-SHA256, header `v1,<base64>` (vários separados por espaço). Se divergir, siga a Svix e anote no PR.
- [ ] **Step 2: Write failing tests.** `svix-verify_test.ts`: gera assinatura com `crypto.subtle` e segredo `whsec_` + base64 de 24 bytes fixos; aceita a válida; aceita quando a válida é a segunda de duas no header; recusa corpo alterado; recusa timestamp 301 s no passado e no futuro; recusa headers ausentes; recusa `v2,` com a mesma assinatura. `resend-webhook_test.ts` com `applyEvent` falso que grava os argumentos:
  - GET → 405; assinatura inválida → 401 e `applyEvent` não chamado; corpo não-JSON com assinatura válida → 400.
  - `email.opened` assinado → 200 sem chamar `applyEvent`.
  - `email.bounced` com `data.tags = {type:"nurture_a1"}`, `bounce:{type:"Permanent", subType:"Suppressed", message:"x"}`, `to:["a@b.com"]` → `applyEvent` com `event:"bounced"`, `category:"ciclo_de_vida"`, `type:"nurture_a1"`, `hasTag:true`, `sentAt` = `data.created_at`, `recipient:"a@b.com"`, `subject` do payload, `bounceType:"Permanent"`.
  - `email.delivered` → `recipient` e `subject` nulos.
  - `applyEvent` retorna `false` (duplicado) → 200.
  - `applyEvent` lança → 500 e corpo sem a mensagem do erro.
- [ ] **Step 3: Run, expect FAIL** — `deno test --no-check supabase/functions/__tests__/svix-verify_test.ts supabase/functions/__tests__/resend-webhook_test.ts`.
- [ ] **Step 4: Implement.** `verifySvixSignature` com `crypto.subtle.importKey`/`sign` e comparação em tempo constante (compare os bytes decodificados, mesmo comprimento, XOR acumulado). Handler: só POST; `await req.text()` antes de tudo; verifica; `JSON.parse`; `eventFromWebhookType(payload.type)` nulo → 200; senão classifica com `data.tags`, `data.from`, `data.subject` e chama `applyEvent` (`hasTag` = `typeof data.tags?.type === "string"`; `recipient` = `data.to?.[0]`, `subject` e `bounce*` só se o evento está em `PII_EVENTS`). Erro → `console.error("[resend-webhook] apply failed")` sem detalhe de payload, 500. `index.ts`: lê `RESEND_WEBHOOK_SECRET` no topo e `throw` se ausente; cria o client service-role; `applyEvent` chama `svc.rpc("email_sends_apply_event", {...})` e lança em erro; `Deno.serve`.
- [ ] **Step 5: Run, expect PASS**, depois `npm run check:functions`.
- [ ] **Step 6: Update `CLAUDE.md`** (env var com: obrigatório, sem default, throw no carregamento, segredo de assinatura do endpoint do Resend; e `resend-webhook` na lista de `--no-verify-jwt` dos Gotchas).
- [ ] **Step 7: Commit** — `feat(email): webhook do Resend com verificação Svix`

### Task 5: Tags nos envios

**Files:**
- Modify: `supabase/functions/_shared/lifecycle-emails.ts` (`sendViaResend` ganha 9º parâmetro `tags?: Record<string, string>`, enviado como `tags: [{name, value: tagValue(value)}]` só quando presente e não vazio; `sendWelcomeEmail` → `{type:"welcome"}`, `sendThankYouEmail` → `thank_you`, `sendTrialReminderEmail` → `trial_reminder`, `sendFounderSignupNotice` → `founder_signup`, `sendFounderSubscriptionNotice` → `founder_subscription`)
- Modify: `supabase/functions/lifecycle-email-cron/handler.ts` (`sendNurture` ganha `tags: Record<string,string>`; as duas chamadas passam `{type: \`nurture_${step}\`}`) e `lifecycle-email-cron/index.ts` (repassa `p.tags` como 9º argumento)
- Modify: `supabase/functions/_shared/instagram-connect-email.ts` (`instagram_connect`, `instagram_connected`)
- Modify: `supabase/functions/agenda-cliente-email/handler.ts` (`agenda_cliente`, 9º argumento depois de `attachments`), `supabase/functions/agenda-lembretes-email/handler.ts` (`agenda_lembrete`; passe `undefined` nas posições 6 a 8)
- Modify: `supabase/functions/client-event-email-cron/handler.ts` (`sendEmail` ganha `tags`; passa `{type:"client_event"}`) e `client-event-email-cron/index.ts` (repassa)
- Modify: `supabase/functions/_shared/notification-email.ts` (corpo ganha `tags:[{name:"type",value:"notification_digest"}]`)
- Modify: `supabase/functions/report-worker/index.ts`, `supabase/functions/instagram-analytics/index.ts` (corpo ganha `tags:[{name:"type",value:"report"}]`)
- Modify: `CLAUDE.md` (bloco de deploy da feature: ordem da spec, seção "Ordem de deploy")
- Test: suítes existentes em `supabase/functions/__tests__/` de cada arquivo tocado (`lifecycle-emails_test.ts`, `lifecycle-email-cron_test.ts`, e as de agenda/client-event/notification-email que existirem)

**Interfaces:**
- Consumes: `tagValue` (Task 1).
- Produces: `sendViaResend(to, subject, html, idempotencyKey, from?, replyTo?, headers?, attachments?, tags?)`.

- [ ] **Step 1: Write failing tests:** `sendViaResend` com `fetch` stubado: sem `tags` o corpo JSON não tem a chave `tags` (payload idêntico ao de hoje); com `{type:"welcome"}` o corpo tem `tags:[{name:"type",value:"welcome"}]`. No `lifecycle-email-cron_test.ts`, o `sendNurture` falso recebe `tags.type === "nurture_a1"` para um candidato do passo a1 e `nurture_<step>` no preview. Nas suítes de agenda-cliente, agenda-lembretes e client-event, o `sendEmail` falso recebe a tag certa. Para `notification-email`, stub de `fetch` confere `tags`.
- [ ] **Step 2: Run, expect FAIL** — `npm run test:functions` (ou os arquivos específicos).
- [ ] **Step 3: Implement** as mudanças listadas em Files. `grep -rn "sendViaResend(\|api.resend.com" supabase/functions --include='*.ts'` ao final: todo envio fora da lista de "não muda" da spec (`notify.ts`, `dunning-email.ts`, `invite-email.ts`, `affiliate-public/email.ts`, `retention-radar-cron`) tem tag.
- [ ] **Step 4: Run, expect PASS** — `npm run test:functions`, `npm run check:functions`.
- [ ] **Step 5: Add the deploy-order block to `CLAUDE.md`** (Gotchas, um item "Métricas de e-mail (spec ...)"), copiando a ordem da spec: migration → endpoint no Resend com os sete eventos e segredo → `RESEND_WEBHOOK_SECRET` via `--env-file` → `resend-webhook --no-verify-jwt` → remetentes com tags (`lifecycle-email-cron` primeiro) → merge do PR A; PR B: `platform-admin` → merge. E a nota de staging sem `RESEND_API_KEY`.
- [ ] **Step 6: Commit** — `feat(email): tag type em todos os envios de remetente compartilhado`
- [ ] **Step 7: PR A.** Rode os gates do CLAUDE.md (`npm run lint`, `npm run format:check`, os cinco `tsc`, `npm run test`, `npm run check:functions`, `npm run test:functions`). Abra o PR com a ordem de deploy no corpo. Deploy em prod é do usuário (passos manuais no painel do Resend); o PR só mergeia depois do deploy.

## PR B

### Task 6: Ações `email-metrics` e `email-backfill` no `platform-admin`

**Files:**
- Create: `supabase/functions/platform-admin/email-metrics.ts`
- Create: `supabase/functions/platform-admin/email-backfill.ts`
- Modify: `supabase/functions/platform-admin/index.ts` (dois `case`, junto de `get-deposits`)
- Test: `supabase/functions/__tests__/platform-admin-email-metrics_test.ts`

**Interfaces:**
- Consumes: `classifyEmail`, `normalizeLastEvent`, `PII_EVENTS` (Task 1); RPC `email_metrics` (Task 3); tabela `email_sends`.
- Produces:
  - `function parseEmailMetricsRange(body: unknown): { start: string; end: string } | { error: string }` — exige `start`/`end` `YYYY-MM-DD` válidos, `end >= start`, no máximo 366 dias.
  - `async function handleEmailMetrics(svc, body, headers): Promise<Response>` → 400 com erro genérico na validação; senão `svc.rpc("email_metrics", {p_start, p_end})` e devolve o JSON; erro de RPC → 500 genérico.
  - `interface BackfillDeps { listPage: (cursor: string | null) => Promise<{ data: ResendListItem[]; has_more: boolean }>; insertRows: (rows: EmailSendRow[]) => Promise<number>; sleep: (ms: number) => Promise<void> }`
  - `async function runEmailBackfill(cursor: string | null, deps: BackfillDeps, maxPages = 20): Promise<{ inserted: number; scanned: number; nextCursor: string | null; oldestReached: string | null; done: boolean }>`
  - `async function handleEmailBackfill(svc, body, headers): Promise<Response>` (lê `RESEND_API_KEY`; ausente → 503 `{error:"resend_not_configured"}`).
  - `ResendListItem = { id: string; from: string; subject: string; created_at: string; last_event: string; to: string[] }`; `EmailSendRow` = colunas de `email_sends` com `source:"backfill"`.

- [ ] **Step 1: Read** a doc de `GET /emails` e confirme qual cursor (`after` ou `before`) anda para e-mails mais antigos, já que a lista vem do mais novo para o mais velho. Use esse.
- [ ] **Step 2: Write failing tests:** `parseEmailMetricsRange` aceita `2026-11-01..2026-11-07`, recusa data inválida (`2026-02-30`), `end < start`, 367 dias, campos ausentes. `runEmailBackfill` com `listPage` falso de 3 páginas (`has_more` true, true, false): para em `done:true`, `nextCursor` = id do último item da última página lida, `oldestReached` = menor `created_at`, `sleep` chamado entre páginas com 120; com `maxPages=2` para em `done:false`; linhas montadas com `source:"backfill"`, `last_event` normalizado (`opened` → `delivered`), `recipient`/`subject` só para `bounced`; `insertRows` recebe a contagem de inseridos que devolve (simule 0 na segunda chamada com os mesmos ids para provar idempotência).
- [ ] **Step 3: Run, expect FAIL** — `deno test --no-check supabase/functions/__tests__/platform-admin-email-metrics_test.ts`.
- [ ] **Step 4: Implement.** `insertRows` real: `svc.from("email_sends").upsert(rows, { onConflict: "email_id", ignoreDuplicates: true }).select("email_id")` e devolve o tamanho. `listPage` real: `fetch("https://api.resend.com/emails?limit=100&<cursor>=...")` com `AbortSignal.timeout(10_000)`; 429 → espera `retry-after` uma vez e tenta de novo; outro erro → lança (o handler devolve 502 genérico). Nada de payload no log.
- [ ] **Step 5: Run, expect PASS**, `npm run check:functions`.
- [ ] **Step 6: Commit** — `feat(admin): ações email-metrics e email-backfill no platform-admin`

### Task 7: API e view-model do Admin

**Files:**
- Modify: `apps/admin/src/lib/api.ts` (tipos `EmailMetricsResponse` espelhando o JSON da Task 3, `EmailBackfillResult` da Task 6; `getEmailMetrics(start, end)` e `runEmailBackfill(cursor)` via `adminApi`)
- Create: `apps/admin/src/pages/emails/email-metrics-view.ts`
- Test: `apps/admin/src/pages/emails/__tests__/email-metrics-view.test.ts`

**Interfaces:**
- Produces:
  - `const EMAIL_CATEGORY_LABELS: Record<string, string>` = `notificacoes` "Notificações", `ciclo_de_vida` "Ciclo de vida", `convites` "Convites", `cobranca` "Cobrança", `relatorios` "Relatórios", `afiliados` "Afiliados", `interno` "Interno", `externo` "Externo", `outros` "Outros".
  - `const EMAIL_TYPE_LABELS: Record<string, string>` (ex.: `notification_digest` "Resumo de notificações", `client_event` "Avisos ao cliente", `agenda_lembrete` "Lembretes da agenda", `agenda_cliente` "Convites da agenda", `welcome` "Boas-vindas", `thank_you` "Agradecimento de assinatura", `trial_reminder` "Fim do teste", `nurture_a1`.."Nurture A1".., `nurture_a4_b4` "Nurture A4 ou B4", `instagram_connect` "Link de conexão do Instagram", `instagram_connected` "Instagram conectado", `invite` "Convite de equipe", `demo_access` "Acesso demo", `dunning` "Cobrança pendente", `report` "Relatório mensal", `affiliate_link` "Link de afiliado", `founder_signup` "Aviso de cadastro", `founder_subscription` "Aviso de assinatura", `cron_failure` "Falha de rotina", `retention_radar` "Radar de retenção", `desconhecido` "Não identificado", `notificacao` "Notificação").
  - `function typeLabel(t: string): string` (cai no valor cru).
  - `const BOUNCE_ALERT = 0.04`, `const COMPLAINT_ALERT = 0.0008`.
  - `interface Counts { sent: number; delivered: number; bounced: number; complained: number; delayed: number; pending: number; not_sent: number }`
  - `function rates(c: Counts): { delivery: number | null; bounce: number | null; complaint: number | null }` (fórmulas do Global Constraints; `null` quando a base é zero).
  - `function formatRate(r: number | null): string` (`null` → "Sem envios"; senão `pt-BR` com uma casa, ou duas abaixo de 1%: `0,08%`).
  - `function buildEmailView(res: EmailMetricsResponse): { kpis: Counts & ReturnType<typeof rates>; categories: Array<{ category: string; label: string; counts: Counts; rates: ...; types: Array<{ type; label; counts; rates }> }>; excluded: Array<same shape> /* interno, externo, só se tiverem linhas */; daily; recent; coverageStart: string | null }` — KPIs somam só categorias de cliente; categorias ordenadas por `sent` desc; tipos por `sent` desc.
  - `function presetRange(preset: "7d" | "30d" | "90d", today: Date): { start: string; end: string }` (datas em São Paulo, `end` = hoje, `7d` = hoje e os 6 dias anteriores).

- [ ] **Step 1: Write failing tests:** `rates` com `{sent:100, delivered:95, complained:1, bounced:3, ...}` → entrega 0,96, bounce 0,03, reclamação 1/96; base zero → `null` e `formatRate(null)` = "Sem envios"; `formatRate(0.0008)` = "0,08%", `formatRate(0.961)` = "96,1%"; `buildEmailView` exclui `interno` e `externo` dos KPIs e os põe em `excluded`; ordenação por `sent`; `typeLabel("xyz")` = "xyz"; `presetRange("7d", new Date("2026-11-09T02:00:00Z"))` → `{start:"2026-11-02", end:"2026-11-08"}` (ainda dia 8 em SP).
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run apps/admin/src/pages/emails`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(admin): view-model das métricas de e-mail`

### Task 8: Página `/admin/emails`

**Files:**
- Create: `apps/admin/src/pages/EmailsPage.tsx`, `apps/admin/src/pages/emails/EmailsKpis.tsx`, `EmailsDailyChart.tsx`, `EmailsTable.tsx`, `EmailsRecentBounces.tsx`, `EmailsBackfill.tsx`, `useEmailMetrics.ts`
- Modify: `apps/admin/src/router.tsx` (rota `emails`, lazy), `apps/admin/src/lib/nav-items.ts` (`NavId` `'emails'`, item "E-mails", ícone `Mail`, logo depois de Métricas, tile na mesma família de cor)
- Test: `apps/admin/src/pages/__tests__/EmailsPage.test.tsx`

**Interfaces:**
- Consumes: Task 7 inteira; componentes `PageHeader`, `ErrorState`, `EmptyState`, `ui/table`, `ui/skeleton`, `ui/dropdown-menu`, `useIsPhone`, `SegmentedControl` (`@mesaas/ios-kit`) e o padrão de gráfico de `pages/metricas/charts.tsx`.
- Produces: `useEmailMetrics(range)` com `queryKey: ['admin','email-metrics', start, end]`, `staleTime` 60 s.

- [ ] **Step 1: Look at the mockups artifact** (link no cabeçalho do plano) e em `MetricasPage.tsx` + `pages/metricas/*Desktop.tsx`/`*Phone.tsx` para o padrão desktop/phone.
- [ ] **Step 2: Write failing tests** (mock de `../lib/api`): renderiza "E-mails"; com resposta de fixture mostra o KPI "Enviados" com o total sem Interno, a taxa de bounce acima de 4% com classe/atributo de alerta (`data-alert="true"`), a linha "Interno (fora do total)"; expandir uma categoria mostra os tipos com rótulo; resposta vazia mostra "Nenhum e-mail no período"; erro mostra o `ErrorState`; o rodapé contém "Os convites de equipe e de acesso demo estão incluídos."; trocar o segmento para "30 dias" chama `getEmailMetrics` com o intervalo de 30 dias; o backfill chama `runEmailBackfill` em laço até `done` e mostra "Importados N e-mails, desde DD/MM/AAAA".
- [ ] **Step 3: Run, expect FAIL** — `npx vitest run apps/admin/src/pages/__tests__/EmailsPage.test.tsx`.
- [ ] **Step 4: Implement.** Copy fixa (exata):
  - Título "E-mails"; subtítulo "Envios transacionais pelo Resend".
  - Segmentos "7 dias", "30 dias", "90 dias", "Personalizado".
  - KPIs "Enviados", "Taxa de entrega", "Taxa de bounce", "Reclamações".
  - Colunas "Tipo", "Enviados", "Entregues", "Taxa de entrega", "Bounces", "Taxa de bounce", "Reclamações", "Não enviados".
  - Card "Bounces e reclamações recentes"; vazio "Nenhum bounce ou reclamação no período".
  - Rodapé: "Dados desde DD/MM/AAAA. E-mails de login, confirmação de cadastro e recuperação de senha, e os convites enviados pelo sistema de login, saem por outro servidor e não aparecem aqui. Os convites de equipe e de acesso demo estão incluídos." (Antes de fixar, confira em `invite-user`/`_shared/invite-actions.ts` que os convites de equipe saem pelo `invite-email.ts`; se algum sair pelo Supabase Auth, ajuste o texto.)
  - Menu "Importar histórico do Resend"; confirmação "Importar os e-mails que o Resend ainda guarda? Linhas já recebidas pelo webhook não mudam."; progresso "Importando... N e-mails".
- [ ] **Step 5: Run, expect PASS**; `npx tsc -p apps/admin/tsconfig.json --noEmit`; `npm run lint`.
- [ ] **Step 6: Verify in the browser.** `npm run dev:admin` pelo `preview_start` (ou `dev:env` no worktree). Sem login de admin local, intercepte o `fetch` do `platform-admin` no Browser pane com a fixture do teste (memória "Hub repro via patched fetch") e confira desktop e `resize_window` mobile, claro e escuro. Screenshot no PR.
- [ ] **Step 7: Commit** — `feat(admin): página de métricas de e-mail`
- [ ] **Step 8: PR B** com os gates do CLAUDE.md; deploy de `platform-admin` antes do merge.
