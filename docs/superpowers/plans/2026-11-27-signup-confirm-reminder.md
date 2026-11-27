# Lembrete de confirmação de e-mail: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dono que não confirmou o e-mail recebe lembretes nossos em 1 h e 24 h, com link novo de um clique; link morto no `/login` passa a ter explicação e reenvio.

**Architecture:** Duas RPCs SECURITY DEFINER (candidatos + claim atômico) numa migration nova; varredura nova no `lifecycle-email-cron` com link de `auth.admin.generateLink({type:'magiclink'})`; copy e builder no catálogo lifecycle; tipos novos no `email-classify`; aviso de link vencido na `LoginPage`.

**Tech Stack:** Postgres/Supabase, Deno edge functions, React 19 + react-i18next, Vitest, `deno test`, suíte psql de entitlements.

**Spec:** `docs/superpowers/specs/2026-11-27-signup-confirm-reminder-design.md`

## Global Constraints

- Tipos: `confirm_reminder_1h` e `confirm_reminder_24h` (mesmo nome em `lifecycle_emails.email_type`, tag Resend `type` e `EMAIL_TYPES`, categoria `ciclo_de_vida`).
- Janelas semiabertas: 1h = `p_now - 24h < created_at <= p_now - 1h`; 24h = `p_now - 72h < created_at <= p_now - 24h` e sem `confirm_reminder_1h` com `sent_at > p_now - 12h`.
- Filtro: `email_confirmed_at is null`, `email is not null`, `deleted_at is null`, `is_sso_user = false`, `is_anonymous = false`, `nullif(raw_user_meta_data->>'conta_id','') is null`, dono (`workspace_members.role='owner'`) de workspace com `created_by = user`.
- Claim: elegível sem linha, ou `delivered_at is null and sent_at <= p_now - 1h and attempts < 3`.
- ACL das RPCs: `revoke all ... from public, anon, authenticated; grant execute ... to service_role`.
- Idempotency key: `${email_type}/${user_id}/${attempts}`. Remetente `LIFECYCLE_FROM`. Idioma `langOf.owner(user_id)`.
- `redirectTo`: `${appBaseUrl}/login` (sem barra dupla: `appBaseUrl` pode terminar em `/`).
- Varredura só roda com `RESEND_API_KEY` definido.
- Copy sem travessão (—). pt: assuntos "Falta 1 clique para ativar sua conta no Mesaas" (1h) e "Sua conta no Mesaas está esperando por você" (24h); botão "Confirmar e entrar"; nota "O link vale por 24 horas."; "Se não foi você que criou a conta, é só ignorar este e-mail." en: "One click left to activate your Mesaas account" / "Your Mesaas account is waiting for you" / "Confirm and sign in" / "This link is valid for 24 hours." / "If you didn't create this account, just ignore this email."
- Migration com versão acima do fim de `main` (hoje `20261212000001`): use `20261213000001`.

## Review Focus

1. Pessoa confirma entre a leitura de candidatos e o envio: não pode receber (claim revalida; `data.user.email_confirmed_at` checado). Testes nas Tasks 1 e 3.
2. Cadastro exatamente em `p_now - 24h`: entra só no de 24h... e não no de 1h. Teste na Task 1.
3. Deploy com backlog: usuário criado há 5 dias não confirmado não recebe nada. Teste na Task 1.
4. `generateLink` falha ou devolve sem `action_link`: vira erro do candidato, sem envio, sem `markDelivered`. Teste na Task 3.
5. `/login#error_code=otp_expired&...` com campo de e-mail vazio: aviso aparece, botão de reenvio fica desabilitado até digitar um e-mail. Teste na Task 5.

---

### Task 1: Migration com as duas RPCs + suíte SQL

**Files:**
- Create: `supabase/migrations/20261213000001_confirm_reminder.sql`
- Create: `supabase/tests/entitlements/99_confirm_reminder.sql` (modelo: `99_nurture_candidates.sql`, mesmo estilo de asserts e setup de usuários em `auth.users`)

**Interfaces:**
- Produces: `get_confirm_reminder_candidates(p_now timestamptz) returns table (user_id uuid, email text, nome text, email_type text, attempts int)` (limite 50, `order by created_at asc, user_id asc`).
- Produces: `claim_confirm_reminder(p_user_id uuid, p_email_type text, p_now timestamptz default now()) returns int` (novo `attempts` ou `null`).

- [ ] **Step 1: Escrever a suíte SQL** com estes casos, `p_now` fixo:
  - criado 2 h antes, não confirmado → 1 linha `confirm_reminder_1h`;
  - criado exatamente 24 h antes → só `confirm_reminder_24h`; criado 1 h exata antes → `confirm_reminder_1h`; 59 min antes → nada;
  - criado 30 h antes com `confirm_reminder_1h` `sent_at` 6 h antes → nada; com `sent_at` 20 h antes → `confirm_reminder_24h`;
  - criado 5 dias antes → nada; confirmado → nada; convidado (`conta_id` no metadata) → nada; `is_sso_user = true` → nada;
  - claim: primeira chamada → 1; segunda imediata → null; com `sent_at` 2 h antes e não entregue → 2; com `attempts = 3` → null; entregue → null;
  - claim depois de `update auth.users set email_confirmed_at = now()` → null; claim com tipo `'x'` → null; claim de 1h para criado 30 h antes → null.
  - ACL: `has_function_privilege('authenticated', ..., 'execute')` é false para as duas; `service_role` é true.
- [ ] **Step 2: Rodar e ver falhar:** `bash scripts/test-entitlements.sh` (precisa de Docker/colima; ver memória de Supabase local). Esperado: falha por função inexistente. Sem Docker local, registrar e deixar o CI provar.
- [ ] **Step 3: Escrever a migration.** Um helper interno `_confirm_reminder_eligible(p_user_id uuid, p_email_type text, p_now timestamptz) returns boolean` (`stable`, SECURITY DEFINER, mesma ACL) com o filtro e a janela do tipo, usado pelas duas RPCs. `claim_confirm_reminder` é plpgsql: `perform 1 from auth.users where id = p_user_id for update`; se `not _confirm_reminder_eligible(...)` → `return null`; depois o upsert em `lifecycle_emails` `on conflict (email_type, user_id) do update set sent_at = p_now, attempts = le.attempts + 1, delivered_at = null where le.delivered_at is null and le.sent_at <= p_now - interval '1 hour' and le.attempts < 3 returning attempts` (modelo: `claim_nurture_email` em `20261119000001_nurture_emails.sql:358`). Cabeçalho comentado com o porquê e o rollback (`drop function` das três).
- [ ] **Step 4: Rodar a suíte e ver passar.** Mesmo comando. Esperado: todos os asserts ok.
- [ ] **Step 5: Commit** `feat(db): RPCs do lembrete de confirmação de e-mail`.

### Task 2: Copy, builder e classificação

**Files:**
- Modify: `supabase/functions/_shared/i18n/catalogs/lifecycle.ts` (bloco `confirm` em pt e en)
- Modify: `supabase/functions/_shared/lifecycle-emails.ts`
- Modify: `supabase/functions/_shared/email-classify.ts`
- Modify: `supabase/functions/__tests__/fixtures/lifecycle-cases.ts`, `supabase/functions/__tests__/fixtures/lifecycle-pt.json`
- Test: `supabase/functions/__tests__/lifecycle-emails_test.ts`, `lifecycle-i18n_test.ts`, `email-classify_test.ts` (o `edge-i18n-catalogs_test.ts` já cobre paridade)

**Interfaces:**
- Produces: `export type ConfirmReminderType = "confirm_reminder_1h" | "confirm_reminder_24h"`, `export const CONFIRM_REMINDER_TYPES: readonly ConfirmReminderType[]`.
- Produces: `export function buildConfirmReminderEmail(p: { type: ConfirmReminderType; firstName: string | null; actionLink: string; lang: Lang }): { subject: string; html: string }`.
- Produces: `export async function sendConfirmReminderEmail(p: { to: string; subject: string; html: string; idempotencyKey: string; type: ConfirmReminderType }): Promise<void>` (chama `sendViaResend` com `LIFECYCLE_FROM` e tags `{ type: p.type }`).

- [ ] **Step 1: Testes que falham:** em `lifecycle-emails_test.ts`, `buildConfirmReminderEmail` pt/1h tem o assunto exato da Global Constraints, contém o `actionLink` escapado num `href` (usar `escapeHTML` e passar por `sanitizeUrl` do padrão do arquivo), contém "Confirmar e entrar" e "O link vale por 24 horas.", não contém "—"; nome `"<b>Ana</b>"` sai escapado; en/24h tem o assunto en. Em `email-classify_test.ts`: os dois assuntos pt e os dois en classificam como o tipo certo; `EMAIL_TYPES` tem os dois em `ciclo_de_vida`. Em `lifecycle-i18n_test.ts`: caso novo `confirm-1h-pt` e `confirm-24h-pt` batem com `lifecycle-pt.json`.
- [ ] **Step 2: Rodar e ver falhar:** `deno test --no-check supabase/functions/__tests__/lifecycle-emails_test.ts supabase/functions/__tests__/email-classify_test.ts supabase/functions/__tests__/lifecycle-i18n_test.ts`.
- [ ] **Step 3: Implementar** catálogo (mesmo esqueleto/HTML do welcome: preheader, saudação com nome ou anônima, um parágrafo, botão, nota, rodapé), builder, sender, e no `email-classify.ts` as entradas em `EMAIL_TYPES` e matchers `exact` para pt e en (`lifecycleText("en")`). Gerar a saída pt atual do builder para os dois casos novos e acrescentar as chaves ao `lifecycle-pt.json` (o fixture trava as saídas existentes; as novas entram com o texto aprovado acima).
- [ ] **Step 4: Rodar e ver passar** (mesmo comando) e `deno test --no-check supabase/functions/__tests__/edge-i18n-catalogs_test.ts`.
- [ ] **Step 5: Commit** `feat(email): copy e classificação do lembrete de confirmação`.

### Task 3: Varredura no `lifecycle-email-cron`

**Files:**
- Modify: `supabase/functions/lifecycle-email-cron/handler.ts`, `supabase/functions/lifecycle-email-cron/index.ts`
- Test: `supabase/functions/__tests__/lifecycle-email-cron_test.ts` (harness `makeFakeDb` / `makeDeps`, linha ~293)

**Interfaces:**
- Consumes: as duas RPCs (Task 1), `buildConfirmReminderEmail`, `sendConfirmReminderEmail`, `CONFIRM_REMINDER_TYPES` (Task 2).
- Produces em `LifecycleCronDeps`: `confirmReminderEnabled: boolean`; `generateConfirmLink(email: string, redirectTo: string): Promise<{ actionLink: string; userId: string; confirmed: boolean }>`; `sendConfirmReminder: typeof sendConfirmReminderEmail`. Retorno de `runLifecycleEmailCron` ganha `confirmRemindersSent: number`.

- [ ] **Step 1: Testes que falham** (todos com `confirmReminderEnabled: true` salvo o primeiro):
  - desligado: não chama a RPC de candidatos;
  - candidato 1h: claim recebe `(user_id, 'confirm_reminder_1h', nowIso)`, link gerado com `redirectTo` `https://app.mesaas.com.br/login` mesmo com `appBaseUrl` terminando em `/`, envio com chave `confirm_reminder_1h/<uid>/1`, tag/tipo certo, `markDelivered` chamado, contador 1;
  - claim devolve `null`: nem link nem envio;
  - link com `confirmed: true` ou `userId` diferente: sem envio, sem `markDelivered`, sem erro;
  - `generateConfirmLink` lança: erro registrado com `accountId`, sem envio, sem `markDelivered`;
  - envio lança: erro registrado, sem `markDelivered`;
  - erro na RPC de candidatos: entra em `errors`, as outras varreduras seguem.
- [ ] **Step 2: Rodar e ver falhar:** `deno test --no-check supabase/functions/__tests__/lifecycle-email-cron_test.ts`.
- [ ] **Step 3: Implementar** a varredura logo depois do welcome, seguindo o padrão do nurture para claim por RPC (`handler.ts:661-700`). No `index.ts`: `confirmReminderEnabled: Boolean(Deno.env.get("RESEND_API_KEY"))`; `generateConfirmLink` com `svc.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo } })`, lançando quando `error` ou sem `properties.action_link`, devolvendo `userId: data.user.id` e `confirmed: Boolean(data.user.email_confirmed_at)`; `sendConfirmReminder: sendConfirmReminderEmail`. Ajustar a interface `LifecycleDb` só se o tipo de `rpc` exigir.
- [ ] **Step 4: Rodar e ver passar**, mais `npm run check:functions`.
- [ ] **Step 5: Commit** `feat(lifecycle): lembretes de confirmação de e-mail em 1h e 24h`.

### Task 4: Rótulos no Admin

**Files:**
- Modify: `apps/admin/src/pages/emails/email-metrics-view.ts` (mapa de rótulos, perto de `trial_reminder: 'Fim do teste'`, linha 29)
- Test: o teste existente dessa view, se houver (`grep -rl email-metrics-view apps/admin/src`); senão, sem teste novo.

- [ ] **Step 1:** Acrescentar `confirm_reminder_1h: 'Confirmação de e-mail (1 h)'` e `confirm_reminder_24h: 'Confirmação de e-mail (24 h)'`; se houver teste do mapa, acrescentar o assert.
- [ ] **Step 2:** `npx tsc -p apps/admin/tsconfig.json --noEmit` e o teste, se houver. Esperado: sem erro.
- [ ] **Step 3: Commit** `feat(admin): rótulos dos lembretes de confirmação`.

### Task 5: Aviso de link vencido no `/login`

**Files:**
- Modify: `apps/crm/src/pages/login/LoginPage.tsx`, `packages/i18n/locales/pt/auth.json`, `packages/i18n/locales/en/auth.json`
- Test: `apps/crm/src/pages/login/__tests__/LoginPage.test.tsx`

**Interfaces:**
- Consumes: `resendButton(email)` e `handleResend` existentes (`LoginPage.tsx:138` e `:373`).
- Produces: chaves `auth.linkExpired.title` ("Este link expirou ou já foi usado" / "This link has expired or was already used") e `auth.linkExpired.description` ("Entre com seu e-mail e senha, ou digite seu e-mail abaixo e peça um novo link de confirmação." / "Sign in with your email and password, or type your email below and request a new confirmation link.").

- [ ] **Step 1: Testes que falham:** com `window.location.hash = '#error=access_denied&error_code=otp_expired&error_description=x'` antes do render, aparece `role="status"` com o título; botão de reenvio desabilitado com o campo de e-mail do login vazio; ao digitar um e-mail e clicar, `resendSignupConfirmation` é chamado com esse e-mail; o hash é limpo (`history.replaceState` sem o hash). Sem hash de erro, o aviso não aparece.
- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run apps/crm/src/pages/login/__tests__/LoginPage.test.tsx`.
- [ ] **Step 3: Implementar:** ler o hash uma vez no mount (estado `linkExpired`), só quando `error_code` for `otp_expired` ou `error` for `access_denied`; limpar o hash com `history.replaceState(null, '', pathname + search)`; renderizar o aviso no mesmo lugar e com as mesmas classes do `unconfirmedEmail` (`auth-notice`), usando `resendButton(loginEmail.trim())` e desabilitando quando vazio. Nada de leitura de `window` durante o render (a página entra no prerender: ler dentro de `useEffect`).
- [ ] **Step 4: Rodar e ver passar**, mais `npx tsc -p apps/crm/tsconfig.json --noEmit` e o `noHardcodedPortuguese.test.ts`.
- [ ] **Step 5: Commit** `feat(login): aviso de link de confirmação vencido`.

### Task 6: Gates, staging e PR

- [ ] **Step 1:** Rodar os gates do CLAUDE.md: `npm run lint`, `npm run format:check`, os cinco `tsc`, `npm run test`, `npm run check:functions`, `npm run test:functions`. Esperado: tudo verde.
- [ ] **Step 2: Portão de staging (bloqueia o merge).** Com aprovação do dono antes de cada escrita: aplicar a migration em staging; criar um usuário de teste não confirmado; gerar o link com a service role (`generateLink` magiclink, `redirectTo` `<APP_BASE_URL de staging>/login`); conferir (a) clicar confirma `email_confirmed_at` e abre o CRM logado, (b) gerar um segundo link e abrir o primeiro: registrar o resultado (esperado: aviso da Task 5), (c) `redirect_to` do `action_link` é o pedido. Registrar os três no PR. Se (a) falhar, parar e voltar ao spec.
- [ ] **Step 3:** Push e PR com a ordem de deploy do spec (migration → `lifecycle-email-cron` `--no-verify-jwt` → `resend-webhook` e `platform-admin` → merge) e o portão de prod (conferir `redirect_to` em prod antes de deployar o cron).
