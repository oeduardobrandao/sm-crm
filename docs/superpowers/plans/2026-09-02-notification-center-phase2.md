# Central de Notificações — Fase 2 (Pendências do Hub) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** E-mail digest para o cliente final quando há posts aguardando aprovação ou mensagens não lidas no Hub, com controle na central (coluna nova na matriz), descadastro one-click e enforcement de papel no banco.

**Architecture:** Digest de ESTADO sem tabela de fila: cron a cada 15 min faz claim atômico por cliente (lease `event_claim_through`/`event_claimed_at` separado do cursor entregue `event_cursor_at`), lê a janela `(GREATEST(cursor, now-72h), claim_through]` sobre `post_status_events` + `mensagens`/`mensagens_last_seen`, e só avança o cursor no sucesso — crash re-entrega a mesma janela (lease expira em 30 min), com Idempotency-Key do Resend dedupando reenvio. Guarda `BEFORE INSERT OR UPDATE` em `clientes` (espelho exato do `enforce_cliente_foto_owner_admin`) fecha o buraco de papel; a policy de `workspaces` já é owner/admin, então o toggle geral não precisa de RPC (desvio deliberado da spec, que deixou o mecanismo para o plano).

**Tech Stack:** Postgres (trigger guard + claim RPC + pg_cron/vault), edge functions Deno (cron + unsub), Resend (via `sendViaResend` estendido com headers RFC 8058), React/TanStack na central.

**Spec:** `docs/superpowers/specs/2026-09-02-notification-center-design.md` (Fase 2). Fase 1 = PR #430, MERGEADA e com rollout aplicado em prod.

## Global Constraints

- Copy PT-BR; **NUNCA em-dash em copy de usuário** (ponto/dois-pontos/`·`).
- Migration nova: prefixo `20260904000001` (tail atual de origin/main: `20260903000001`). Re-verificar com `git ls-tree origin/main:supabase/migrations --name-only | tail -3` antes de abrir o PR.
- Suite psql nova: `supabase/tests/entitlements/74_client_event_emails.sql`.
- Guard trigger: detectar service role com `auth.role() = 'service_role'` — NUNCA `current_user`/`session_user`/`auth.uid() IS NULL` (racional documentado em `20260817000001`; SECURITY DEFINER reescreve `current_user` para o owner e desabilitaria a guarda).
- pg_cron: SEMPRE a forma de subselect na VIEW `vault.decrypted_secrets` (names `project_url`/`cron_secret`); a forma de função não existe nesta instância. Migration de schedule só pode ser aplicada APÓS o deploy da função.
- `REVOKE ... FROM PUBLIC` sempre com `GRANT ... TO service_role` explícito em seguida.
- Colunas novas em `clientes` legíveis pelo CRM (`send_event_email`, `event_email_unsub_at`) exigem o trio: re-declarar o `GRANT SELECT (…)` completo, recriar `clientes_v` com as colunas **apendadas estritamente por último**, e `CLIENTE_SAFE_COLUMNS` em `apps/crm/src/store/clients.ts:59`. As colunas de cursor/lease ficam FORA do trio (least privilege: só service role).
- Staging não tem `RESEND_API_KEY`: o cron deve retornar `{skipped:true}` sem claimar (padrão do irmão).
- Bateria antes do push: lint, format:check, 4× tsc, `npm run test`, `npm run test:functions` (restaurar `deno.lock` se sujar).
- Rodar tudo DESTE worktree (`pwd` + `git branch --show-current` = `claude/notification-center-960dfc`).
- ATENÇÃO deploy: o checkout principal (~/Projects/sm-crm) está com main local VELHO — deploys de função e db push são feitos DESTE worktree, que já está linkado ao prod.

---

### Task 1: Migration — colunas, guarda de papel, claim RPC, índice, schedule

**Files:**
- Create: `supabase/migrations/20260904000001_client_event_emails.sql`

**Interfaces:**
- Consumes: `clientes` (grants/view de `20260817000001`), `workspaces` (policy `ws_update_owner_admin` já owner/admin), `post_status_events`, padrão de guarda de `20260817000001`, padrão de schedule de `20260813000006`.
- Produces: colunas `workspaces.send_client_event_emails` (default false), `clientes.send_event_email` (default true), `clientes.event_email_unsub_at`, `clientes.event_cursor_at`, `clientes.event_claim_through`, `clientes.event_claimed_at`; trigger `trg_cliente_notify_guard`; RPC `claim_client_event_emails(p_now timestamptz, p_limit int)` (service_role only); índice `idx_post_status_events_conta_created`; job pg_cron `client-event-email-cron` a cada 15 min.

- [ ] **Step 1: Escrever a migration** (conteúdo integral; comentários citam os precedentes):

```sql
-- 20260904000001_client_event_emails.sql
-- Central de Notificações, Fase 2 (spec 2026-09-02): digest "Pendências do Hub"
-- para o cliente final. Cursor entregue separado de lease de claim; guarda de
-- papel no banco (clientes_update/insert não checam papel — precedente
-- 20260817000001); workspaces já é owner/admin por policy (20260322), então o
-- toggle geral dispensa RPC/guarda extra.

-- ---------- colunas ------------------------------------------------------
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS send_client_event_emails boolean NOT NULL DEFAULT false;

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS send_event_email boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS event_email_unsub_at timestamptz,
  ADD COLUMN IF NOT EXISTS event_cursor_at timestamptz,
  ADD COLUMN IF NOT EXISTS event_claim_through timestamptz,
  ADD COLUMN IF NOT EXISTS event_claimed_at timestamptz;

-- ---------- allowlist de SELECT (trio da armadilha 20260728000002) --------
-- Re-declara a lista INTEIRA + as 2 colunas novas legíveis pelo CRM.
-- Cursor/lease ficam de fora de propósito (só service role lê/escreve).
REVOKE SELECT ON public.clientes FROM authenticated;
GRANT SELECT (
  id, user_id, conta_id, nome, sigla, cor, plano, email, telefone, status,
  created_at, notion_page_url, data_pagamento, especialidade, data_aniversario,
  dia_entrega, auto_publish_on_approval, send_report_email, include_ai_analysis,
  foto_url, send_event_email, event_email_unsub_at
) ON public.clientes TO authenticated;

-- clientes_v: recriar com as colunas novas APENDADAS POR ÚLTIMO (inserir no
-- meio renomeia colunas por ordinal e a migration falha — 20260817000001).
-- Copiar o SELECT da definição vigente em 20260817000001:22 e apender
-- send_event_email, event_email_unsub_at ao final.
-- (o executor cola aqui a definição vigente + as 2 colunas)

-- ---------- guarda de papel (espelho de enforce_cliente_foto_owner_admin) --
CREATE OR REPLACE FUNCTION public.enforce_cliente_notify_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_changed boolean;
  v_cron_changed boolean;
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- INSERT com valor divergente do default = tentativa de burlar a guarda
    v_user_changed := NEW.send_event_email IS DISTINCT FROM true
                   OR NEW.event_email_unsub_at IS NOT NULL
                   OR NEW.send_report_email IS DISTINCT FROM false;
    v_cron_changed := NEW.event_cursor_at IS NOT NULL
                   OR NEW.event_claim_through IS NOT NULL
                   OR NEW.event_claimed_at IS NOT NULL;
  ELSE
    v_user_changed := NEW.send_event_email IS DISTINCT FROM OLD.send_event_email
                   OR NEW.event_email_unsub_at IS DISTINCT FROM OLD.event_email_unsub_at
                   OR NEW.send_report_email IS DISTINCT FROM OLD.send_report_email;
    v_cron_changed := NEW.event_cursor_at IS DISTINCT FROM OLD.event_cursor_at
                   OR NEW.event_claim_through IS DISTINCT FROM OLD.event_claim_through
                   OR NEW.event_claimed_at IS DISTINCT FROM OLD.event_claimed_at;
  END IF;

  -- cursor/lease: NINGUÉM além do service role escreve.
  IF v_cron_changed THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_user_changed THEN
    IF NOT EXISTS (
      SELECT 1 FROM workspace_members
      WHERE user_id = auth.uid()
        AND workspace_id = NEW.conta_id
        AND role IN ('owner', 'admin')
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cliente_notify_guard ON public.clientes;
CREATE TRIGGER trg_cliente_notify_guard
  BEFORE INSERT OR UPDATE ON public.clientes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_cliente_notify_columns();

-- Nota: send_report_email no INSERT compara com o default REAL da coluna —
-- verificar com \d clientes / migration de origem qual é (o executor confirma;
-- se o default for NULL/true, ajustar a comparação para o default verdadeiro).

-- ---------- claim atômico: lease separado do cursor -----------------------
-- Gates re-checados DENTRO do claim (opt-out tardio é honrado). Conteúdo é
-- verificado pelo worker DEPOIS; cliente sem conteúdo tem o lease liberado
-- sem avançar cursor.
CREATE OR REPLACE FUNCTION claim_client_event_emails(p_now timestamptz, p_limit int)
RETURNS TABLE (
  id bigint, conta_id uuid, nome text, email text,
  event_cursor_at timestamptz, event_claim_through timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE clientes c
     SET event_claim_through = p_now,
         event_claimed_at = p_now
   WHERE c.id IN (
     SELECT c2.id FROM clientes c2
     JOIN workspaces w ON w.id = c2.conta_id
     WHERE w.send_client_event_emails = true
       AND c2.send_event_email = true
       AND c2.status = 'ativo'
       AND coalesce(c2.email, '') <> ''
       AND (c2.event_cursor_at IS NULL OR c2.event_cursor_at < p_now - interval '4 hours')
       AND (c2.event_claimed_at IS NULL OR c2.event_claimed_at < p_now - interval '30 minutes')
     ORDER BY c2.event_cursor_at ASC NULLS FIRST
     LIMIT p_limit
     FOR UPDATE OF c2 SKIP LOCKED
   )
  RETURNING c.id, c.conta_id, c.nome, c.email, c.event_cursor_at, c.event_claim_through;
$$;

-- REVOKE FROM PUBLIC também derruba service_role — re-grant explícito.
REVOKE ALL ON FUNCTION claim_client_event_emails(timestamptz, int)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_client_event_emails(timestamptz, int)
  TO service_role;

-- ---------- índice para a varredura do digest -----------------------------
-- post_status_events só tem (post_id, created_at); a janela por workspace
-- faria seq-scan.
CREATE INDEX IF NOT EXISTS idx_post_status_events_conta_created
  ON post_status_events (conta_id, created_at);

-- ---------- schedule (APLICAR SÓ APÓS deploy da função) -------------------
do $$ begin
  if exists (select 1 from cron.job where jobname = 'client-event-email-cron') then
    perform cron.unschedule('client-event-email-cron');
  end if;
end $$;

select cron.schedule(
  'client-event-email-cron',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
            || '/functions/v1/client-event-email-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
```

- [ ] **Step 2: Completar a definição de `clientes_v`** — abrir `supabase/migrations/20260817000001_cliente_foto_manual_upload.sql:22`, copiar o `CREATE OR REPLACE VIEW` vigente e apender as 2 colunas ao final do SELECT. Confirmar o default real de `send_report_email` para a comparação de INSERT da guarda.

- [ ] **Step 3: Sanity local se houver Docker** (`npx supabase db reset` — pular sem falhar se indisponível; a Task 2 e o CI cobrem).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260904000001_client_event_emails.sql
git commit -m "feat(notificacoes): migration da fase 2 (colunas de digest do cliente, guarda de papel, claim com lease, índice, cron)"
```

---

### Task 2: Suite psql 74

**Files:**
- Create: `supabase/tests/entitlements/74_client_event_emails.sql`

**Interfaces:**
- Consumes: harness de `_helpers.sql` e o estilo da suite 73 (transação + `set local role` + asserts com `format()`).
- Produces: cobertura CI da guarda e do claim.

- [ ] **Step 1: Ler `_helpers.sql` + suite `73_notification_center.sql`** (harness) e a migration da Task 1.

- [ ] **Step 2: Escrever os casos (lógica verbatim; boilerplate do harness):**

```sql
-- 74_client_event_emails.sql
-- Caso 1: guarda de papel, UPDATE.
--   agent: UPDATE send_event_email -> exception 42501; owner: OK.
--   agent: UPDATE send_report_email -> 42501 (campo antigo agora guardado); owner: OK.
--   owner: UPDATE event_cursor_at -> 42501 (cursor é só do service role).
--   postgres/service: UPDATE event_cursor_at -> OK.
-- Caso 2: guarda de papel, INSERT.
--   agent: INSERT cliente com send_event_email=false -> 42501.
--   agent: INSERT cliente sem tocar os campos guardados -> OK (defaults passam).
--   owner: INSERT com event_email_unsub_at preenchido -> OK (owner pode).
-- Caso 3: claim_client_event_emails gates (como postgres).
--   setup: ws com send_client_event_emails=true, cliente ativo com email.
--   claim retorna a linha; segunda chamada imediata NÃO retorna (lease).
--   flip cada gate individualmente e assert claim vazio:
--     ws.send_client_event_emails=false; c.send_event_email=false;
--     c.status='encerrado'; c.email=NULL; c.event_cursor_at=now() (cooldown).
--   lease expirado: event_claimed_at = now()-31min -> claim retorna de novo.
-- Caso 4: ACL — anon/authenticated sem execute no claim; service_role com.
```

- [ ] **Step 3: Rodar localmente se houver Docker; senão CI gate.** **Step 4: Commit** (`test(notificacoes): suite 74 (guarda de papel e claim com lease)`).

---

### Task 3: Builder do e-mail + token de descadastro + headers no sendViaResend

**Files:**
- Create: `supabase/functions/_shared/client-event-email.ts`
- Modify: `supabase/functions/_shared/lifecycle-emails.ts` (sendViaResend ganha `headers?`)
- Test: `supabase/functions/__tests__/client-event-email_test.ts` (novo) + testes existentes de lifecycle que fixem a assinatura

**Interfaces:**
- Consumes: padrão visual de `_shared/report-template/email.ts` (tabela 560px, logoSection, botão com brandColor, escape via `./escape.ts` relativo àquele módulo — copiar o helper de escape usado); padrão de token de `_shared/report-docs/print-token.ts` (b64url + HMAC-SHA256 + `crypto.subtle.verify`, que é constant-time).
- Produces (a Task 4 e 5 consomem estes nomes):

```ts
// _shared/client-event-email.ts
export interface ClientEventEmailParams {
  clienteNome: string; workspaceName: string; brandColor: string;
  logoUrl: string | null; pendingPosts: { titulo: string }[];
  unreadMessages: number; hubUrl: string; unsubUrl: string;
}
export function buildClientEventEmail(p: ClientEventEmailParams): string;
export function clientEventSubject(workspaceName: string): string; // "Você tem pendências com {ws}"
export async function signUnsubToken(clienteId: number, secret: string): Promise<string>;
export async function verifyUnsubToken(token: string, secret: string): Promise<number | null>;
// sendViaResend(to, subject, html, idempotencyKey, from?, replyTo?, headers?: Record<string,string>)
```

- [ ] **Step 1: Testes deno que falham** — builder: lista os títulos dos posts pendentes (escapados), mostra "X mensagens não lidas" só quando > 0, botão do Hub some com hubUrl vazio, link de descadastro sempre presente, sem em-dash no HTML; token: roundtrip sign→verify devolve o clienteId, assinatura adulterada → null, payload adulterado → null; subject correto.
- [ ] **Step 2: RED.** **Step 3: Implementar** (token: payload `{c: clienteId}` b64url + `.` + sig HMAC-SHA256 do payload com a chave derivada do secret — espelho de `print-token.ts` SEM campo exp: link de unsub é permanente por design; verify via `crypto.subtle.verify`). `sendViaResend`: parâmetro opcional `headers` mergeado no corpo (`headers: {...}` do payload Resend) — verificar nos testes existentes que a assinatura antiga continua compilando (parâmetro opcional ao final).
- [ ] **Step 4: GREEN + `npm run test:functions` completo** (contract sweep de quem mocka sendViaResend). **Step 5: Commit** (`feat(notificacoes): builder do e-mail de pendências, token de descadastro e headers no sendViaResend`).

---

### Task 4: Cron `client-event-email-cron`

**Files:**
- Create: `supabase/functions/client-event-email-cron/index.ts`, `supabase/functions/client-event-email-cron/handler.ts`
- Test: `supabase/functions/__tests__/client-event-email-cron_test.ts`

**Interfaces:**
- Consumes: Task 3 (builder/subject/signUnsubToken/sendViaResend), `resolveHubUrl` (`_shared/hub-url.ts`), `insertAuditLog` (`_shared/audit.ts`), `reportCronFailure` (`_shared/triage.ts`), `timingSafeEqual` (`_shared/crypto.ts`), claim RPC da Task 1. Espelhar a ESTRUTURA de `notification-email-cron` (index com fetch global bounded por `AbortSignal.timeout(10_000)` + IIFE do CRON_SECRET; handler com interface estreita de Db + deps injetadas + verificação `x-cron-secret` timingSafeEqual ANTES de qualquer trabalho).
- Produces: `runClientEventEmailCron(deps): Promise<{claimed, emailed, skippedNoContent, skippedNoHub, failed, released, skipped?}>` e `createClientEventEmailCronHandler({cronSecret, timingSafeEqual, run})`.

- [ ] **Step 1: Testes deno que falham** (fake db no padrão do teste do irmão), casos mínimos:

```
1. sem RESEND_API_KEY (resendEnabled=false): retorna {skipped:true} SEM chamar o claim.
2. claim vazio: no-op.
3. cliente claimado com 2 posts pendentes + 1 mensagem não vista: monta janela
   (GREATEST(cursor, now-72h), claim_through], envia 1 e-mail, avança cursor
   para claim_through e limpa lease; audit log client_event_email_sent.
4. cursor NULL: limite inferior = now-72h (evento de 80h atrás fica fora).
5. cursor de 5 dias atrás: limite inferior ainda now-72h (GREATEST).
6. post entrou e saiu de enviado_cliente na janela (status atual != enviado_cliente):
   não aparece; post que entrou 2x na janela aparece 1x (dedupe por post).
7. mensagem já vista pelo cliente (mensagens_last_seen.cliente >= created_at): fora.
8. sem conteúdo: lease liberado (claim cols NULL), cursor INTACTO, skippedNoContent++.
9. resolveHubUrl vazio: lease liberado, cursor intacto, skippedNoHub++, sem envio.
10. envio falha (sendEmail rejeita): lease liberado, cursor intacto, failed++ e
    report() chamado com o erro.
11. idempotency key estável e sensível ao conjunto: sha sobre ids compostos
    ordenados 'pse:<id>'/'msg:<id>' prefixados por cliente
    ("client-events:<clienteId>:<sha1-16>").
12. deadline de 60s: clientes restantes têm lease liberado sem envio.
13. handler: sem x-cron-secret correto -> 401 antes de qualquer chamada ao db.
```

- [ ] **Step 2: RED.** **Step 3: Implementar.** Pontos duros do handler (o resto espelha o irmão):

```ts
// janela
const lower = maxDate(row.event_cursor_at, new Date(nowMs - 72 * 3600_000));
const upper = row.event_claim_through;
// aprovações: eventos na janela + status atual ainda enviado_cliente
// SQL via db (service role):
//  select distinct on (e.post_id) e.id, e.post_id, wp.titulo
//    from post_status_events e
//    join workflow_posts wp on wp.id = e.post_id
//   where e.conta_id = :conta and wp.cliente_id = :cliente
//     and e.to_status = 'enviado_cliente'
//     and e.created_at > :lower and e.created_at <= :upper
//     and wp.status = 'enviado_cliente'
//   order by e.post_id, e.created_at desc
// mensagens: from mensagens where conta_id=:conta and cliente_id=:cliente
//   and is_workspace_user = true and created_at > :lower and created_at <= :upper
//   and created_at > coalesce((select last_seen_at from mensagens_last_seen
//        where conta_id=:conta and cliente_id=:cliente), 'epoch')
// release (empty/hub-vazio/falha):
//   update clientes set event_claim_through=null, event_claimed_at=null where id=:id
// sucesso:
//   update clientes set event_cursor_at = :upper, event_claim_through=null,
//     event_claimed_at=null where id=:id
```

(supabase-js não faz DISTINCT ON: implementar o dedupe/latest em TS sobre o
resultado ordenado, ou criar uma RPC de leitura — preferir TS, menos superfície SQL.)
Unsub URL: `${SUPABASE_URL}/functions/v1/client-email-unsub/${await signUnsubToken(id, TOKEN_ENCRYPTION_KEY)}`; headers RFC 8058: `List-Unsubscribe: <unsubUrl>` e `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. From: `` `${workspaceName} <notificacoes@mesaas.com.br>` ``. `TOKEN_ENCRYPTION_KEY` no estilo IIFE que lança.

- [ ] **Step 4: GREEN + `npm run test:functions`** (restaurar deno.lock). **Step 5: Commit** (`feat(notificacoes): cron do digest de pendências do Hub para o cliente final`).

---

### Task 5: Edge function `client-email-unsub` (GET confirma, POST muta)

**Files:**
- Create: `supabase/functions/client-email-unsub/index.ts`
- Test: `supabase/functions/__tests__/client-email-unsub_test.ts`

**Interfaces:**
- Consumes: `verifyUnsubToken` (Task 3), `insertAuditLog`, service-role client.
- Produces: rotas `GET /client-email-unsub/:token` (página HTML de confirmação com `<form method="post">` — NUNCA muta) e `POST /client-email-unsub/:token` (muta + página de confirmação). One-click RFC 8058 também chega como POST no mesmo path.

- [ ] **Step 1: Testes que falham:** GET com token válido → 200 HTML contendo o form e NÃO altera o db (fake db assert); POST válido → `send_event_email=false` + `event_email_unsub_at` setado + audit + 200; POST repetido (replay) → 200 idempotente; token inválido/adulterado → 404 com página genérica (sem detalhe); método PUT → 405.
- [ ] **Step 2: RED.** **Step 3: Implementar** — handler factory testável com deps `{db, verifyToken}`; páginas HTML inline PT-BR sem em-dash ("Deixar de receber avisos de {não incluir nome do workspace — o token não o carrega; texto genérico 'desta agência'}?" / "Pronto. Você não vai mais receber estes avisos."); mutação via update service-role (a guarda de papel isenta service role); `verify_jwt=false`.
- [ ] **Step 4: GREEN + suite completa.** **Step 5: Commit** (`feat(notificacoes): endpoint de descadastro do digest do cliente (GET confirma, POST muta)`).

---

### Task 6: config.toml

**Files:**
- Modify: `supabase/config.toml` (cluster de crons ~L180-195)

- [ ] **Step 1:** Adicionar:

```toml
[functions.client-event-email-cron]
verify_jwt = false

[functions.client-email-unsub]
verify_jwt = false
```

- [ ] **Step 2: Commit** (`chore(notificacoes): verify_jwt=false para as functions da fase 2`). (Sem teste próprio; o CI de deploy usa este arquivo.)

---

### Task 7: Stores do CRM

**Files:**
- Modify: `apps/crm/src/store/clients.ts` (tipo `Cliente` + `CLIENTE_SAFE_COLUMNS`)
- Modify: `apps/crm/src/store/workspace.ts` (`getWorkspaceBranding` + `updateWorkspaceBranding`)
- Test: `apps/crm/src/__tests__/notification-prefs-store.test.ts` ou novo pequeno teste de tipos/colunas

**Interfaces:**
- Produces: `Cliente.send_event_email?: boolean` e `Cliente.event_email_unsub_at?: string | null`; `CLIENTE_SAFE_COLUMNS` com as 2 colunas apendadas; `getWorkspaceBranding()` retornando também `send_client_event_emails: boolean`; `updateWorkspaceBranding(fields: { send_report_email?: boolean; send_client_event_emails?: boolean })`.

- [ ] **Step 1: Teste que falha** (assert de que `CLIENTE_SAFE_COLUMNS` contém as novas colunas e não contém `event_cursor_at`). **Step 2: Implementar** (colunas apendadas AO FINAL da string; select do branding ganha a coluna). **Step 3: GREEN + tsc.** **Step 4: Commit** (`feat(notificacoes): stores expõem toggles de pendências do Hub`).

---

### Task 8: Central UI — coluna "Pendências do Hub" na matriz

**Files:**
- Modify: `apps/crm/src/pages/configuracao/tabs/notificacoes/SeusClientesSection.tsx`
- Test: `apps/crm/src/pages/configuracao/__tests__/NotificacoesTab.test.tsx`

**Interfaces:**
- Consumes: Task 7. Estrutura atual da seção: grid `grid-cols-[1fr_170px]` repetido em 3 pontos (header L99-107, master L109-118, linhas L140-167), busca entre master e lista, doc-comment L20-23 dizendo que a coluna chega na Fase 2 (atualizar).
- Produces: matriz com `grid-cols-[1fr_170px_170px]` nos 3 pontos.

- [ ] **Step 1: Testes que falham:**

```
1. header mostra "Pendências do Hub" + subtexto "posts a aprovar e mensagens
   não lidas · máx. 1 e-mail a cada 4h".
2. master da coluna chama updateWorkspaceBranding({ send_client_event_emails: true }).
3. célula por cliente chama updateCliente(id, { send_event_email: false }).
4. cliente com event_email_unsub_at: switch desabilitado/dimmed + nota
   "desativado pelo cliente"; clicar abre AlertDialog de confirmação; confirmar
   chama updateCliente(id, { send_event_email: true, event_email_unsub_at: null }).
5. cliente sem e-mail: "·" nas duas colunas.
6. cliente com status != 'ativo': tag muted "(pausado)"/"(encerrado)" ao lado
   do nome (o gate real é server-side; a tag só explica).
```

- [ ] **Step 2: RED.** **Step 3: Implementar** (AlertDialog do shadcn já existe em `components/ui/alert-dialog`; copy do diálogo: "O cliente pediu para não receber estes e-mails. Reativar mesmo assim?" + botões "Reativar" / "Cancelar"; mutations otimistas no padrão vigente da seção). Atualizar o doc-comment L20-23. **Step 4: GREEN + suite + tsc + lint + format.** **Step 5: Commit** (`feat(notificacoes): coluna Pendências do Hub na matriz de clientes`).

---

### Task 9: Gating de papel nas telas antigas de Relatórios

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/tabs/RelatoriosTab.tsx`
- Test: teste existente da tab (ou novo caso no arquivo de testes da pasta)

**Contexto:** a guarda da Task 1 agora rejeita (42501) escrita de `send_report_email` por `agent` — a UI precisa refletir, senão o agent vê um toggle que sempre erra.

- [ ] **Step 1: Teste que falha:** com papel agent, os switches de relatório aparecem desabilitados com tooltip/nota "Apenas donos e admins alteram e-mails de cliente." (workspace RelatoriosTab já era owner/admin-gated por policy — verificar se a tela esconde; se não, mesmo tratamento).
- [ ] **Step 2: Implementar** (papel via `workspaceRole` do AuthContext, mesmo padrão `isOwnerOrAdmin` de MembrosTab/SeusClientesSection). **Step 3: GREEN.** **Step 4: Commit** (`fix(notificacoes): telas de relatório respeitam a guarda de papel`).

---

### Task 10: Verificação final + PR

- [ ] **Step 1: Bateria completa** (lint, format:check, 4× tsc, `npm run test`, `npm run test:functions` + restore deno.lock).
- [ ] **Step 2: Re-verificar prefixo da migration** vs `origin/main` tail (`git fetch` antes); renumerar se main andou.
- [ ] **Step 3: Push + PR**:

```bash
git push -u origin claude/notification-center-960dfc
gh pr create --title "feat(notificacoes): Pendências do Hub, e-mail para o cliente final (Fase 2)" --body "$(cat <<'EOF'
Fase 2 da Central de Notificações: digest de e-mail para o cliente final quando
há posts aguardando aprovação ou mensagens não lidas no Hub.

- Cron client-event-email-cron (15 min): digest de ESTADO com cursor entregue
  separado de lease de claim (crash re-entrega a mesma janela; Resend
  Idempotency-Key dedupa), janela máxima de 72h, gates: workspace opt-in +
  cliente + status ativo + e-mail + feature_hub_portal/Hub acessível + cooldown 4h.
- Guarda BEFORE INSERT OR UPDATE em clientes: send_report_email,
  send_event_email e event_email_unsub_at viram owner/admin; cursor/lease só
  service role. Telas antigas de relatório ganham o gating correspondente.
- Descadastro: GET mostra confirmação, POST muta (scanners de link não
  descadastram); one-click RFC 8058; token HMAC permanente, replay idempotente.
- Central: coluna "Pendências do Hub" na matriz de clientes, com estado
  "desativado pelo cliente" e reativação com confirmação explícita.

Spec: docs/superpowers/specs/2026-09-02-notification-center-design.md (Fase 2).

Rollout (imediatamente após o merge, DESTE worktree que está linkado ao prod):
1. npx supabase functions deploy client-event-email-cron --no-verify-jwt --use-api
2. npx supabase functions deploy client-email-unsub --no-verify-jwt --use-api
3. npx supabase db push --linked   # migration + schedule (função JÁ deployada)
Workspace default OFF: nenhum cliente recebe e-mail até o dono ligar o geral.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4:** Tratar o review externo (se o Codex autenticar) com receiving-code-review.

---

## Rollout pós-merge (ordem obrigatória)

1. Deploy das DUAS functions ANTES do `db push` — a migration agenda o cron e ele dispara imediatamente; sem a função no ar, o primeiro tick 404a e o triage acusa falha.
2. `npx supabase db push --linked` deste worktree (linkado ao prod `skjzpekeqefvlojenfsw`; conferir `cat supabase/.temp/project-ref`).
3. Smoke: ligar `send_client_event_emails` num workspace de teste com cliente que tem pendência real e e-mail próprio; conferir recebimento, link do Hub, e o fluxo GET→POST do descadastro; conferir `cron.job_run_details` do primeiro tick.
4. Vercel automático no merge (frontend).
