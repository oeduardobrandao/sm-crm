# Automação de comentário → DM no Instagram — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Núcleo ManyChat no Mesaas: comentário com palavra-chave num post do Instagram do cliente dispara DM automática (private reply) + resposta pública opcional, configurado numa página global `/automacoes` do CRM.

**Architecture:** Webhook da Meta com durable-ack (padrão `tiktok-webhook`): assinatura `X-Hub-Signature-256` verificada sobre o body cru, entrega normalizada em 1 linha por comentário, 200 sem corpo, processamento em `EdgeRuntime.waitUntil`, cron de retry a cada 5 min. Máquina de estados explícita por envio (`instagram_automation_sends`, `comment_id UNIQUE` = idempotência), claim serializado por advisory lock, efeitos externos persistidos um a um. Gate por `feature_instagram_automation` (INSERT-only; ship dark).

**Tech Stack:** Deno edge functions (Supabase), Postgres (RLS + RPCs SECURITY DEFINER + pg_cron), React 19 + TanStack Query + shadcn/ui, Vitest + deno test.

**Spec:** `docs/superpowers/specs/2026-08-14-instagram-comment-dm-automation-design.md` (fonte de verdade para qualquer dúvida de comportamento).

## Global Constraints

- Migrations numeradas a partir de **`20260815000002`**; antes de CADA `gh pr create`, re-verificar `git ls-tree origin/main:supabase/migrations --name-only | tail` e renumerar acima do tail (CI `migration-version-guard`).
- Escopo Meta novo do v1: **só `instagram_business_manage_comments`** (nunca `instagram_business_manage_messages`).
- Todas as chamadas Graph novas: `Authorization: Bearer`, `AbortSignal.timeout(10_000)`, nunca token em query string.
- Webhook: **sem CORS**, nunca ecoar payload na resposta, corpo de resposta sempre vazio.
- Funções novas: `verify_jwt = false` em `supabase/config.toml` **e** entrada em `REQUIRED_FUNCTIONS` de `supabase/functions/__tests__/config-audit_test.ts` (as duas: `instagram-webhook` e `instagram-automation-cron`).
- Copy PT-BR sem travessão (—) em texto de UI/notificação; usar ponto, dois-pontos ou "·".
- Depois de `npm run test:functions`: `git checkout -- deno.lock` (o comando sempre suja o lock).
- `/automacoes` NÃO entra em `FEATURE_GATED` nem em `AGENT_BLOCKED`; só a criação é gateada.
- Commits frequentes, um por task no mínimo. Nunca commitar com testes falhando.

---

### Task 1: Migration A — flag de plano, UNIQUE em clientes e tabela `instagram_comment_automations`

**Files:**
- Create: `supabase/migrations/20260815000002_instagram_comment_automations.sql`

**Interfaces:**
- Produces: tabela `instagram_comment_automations` com `UNIQUE (id, conta_id)` (alvo da FK composta da Task 2); coluna `plans.feature_instagram_automation`; constraint `clientes_id_conta_uq`.

- [ ] **Step 1: Escrever a migration**

```sql
-- Automação de comentário -> DM no Instagram (núcleo ManyChat).
-- Spec: docs/superpowers/specs/2026-08-14-instagram-comment-dm-automation-design.md
-- Ship dark: a flag nasce false em todos os planos; effective_plan_feature lê
-- colunas dinamicamente, então só a coluna basta (padrão 20260721000001).

ALTER TABLE plans ADD COLUMN IF NOT EXISTS feature_instagram_automation boolean NOT NULL DEFAULT false;

-- Alvo para FK composta tenant-safe (padrão post_status_definitions_id_conta_uq,
-- 20260805000001). clientes.id já é PK; o par (id, conta_id) permite que tabelas
-- filhas amarrem client_id ao conta_id estruturalmente, não só via RLS.
ALTER TABLE clientes ADD CONSTRAINT clientes_id_conta_uq UNIQUE (id, conta_id);

CREATE TABLE instagram_comment_automations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id         uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  client_id        bigint NOT NULL,
  name             text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  -- NULL = todos os posts da conta. Snapshot de permalink/caption para a UI
  -- não depender do sync dos últimos 50 posts (instagram_posts é incompleta).
  ig_media_id      text,
  media_permalink  text,
  media_caption    text,
  keywords         text[] NOT NULL CHECK (array_length(keywords, 1) >= 1),
  dm_message       text NOT NULL CHECK (char_length(dm_message) BETWEEN 1 AND 1000),
  public_reply     text CHECK (public_reply IS NULL OR char_length(public_reply) BETWEEN 1 AND 500),
  ativo            boolean NOT NULL DEFAULT true,
  dms_sent_count   int NOT NULL DEFAULT 0,
  last_triggered_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- Par exportado para a FK composta de instagram_automation_sends (Task 2).
  CONSTRAINT ica_id_conta_uq UNIQUE (id, conta_id),
  -- Um bug do processador (service role, fora da RLS) não consegue apontar
  -- client_id para cliente de outro workspace.
  CONSTRAINT ica_client_same_tenant FOREIGN KEY (client_id, conta_id)
    REFERENCES clientes (id, conta_id) ON DELETE CASCADE
);

CREATE INDEX idx_ica_conta_ativo ON instagram_comment_automations (conta_id) WHERE ativo;
CREATE INDEX idx_ica_client_ativo ON instagram_comment_automations (client_id) WHERE ativo;

CREATE OR REPLACE FUNCTION set_instagram_comment_automations_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER instagram_comment_automations_updated_at
  BEFORE UPDATE ON instagram_comment_automations
  FOR EACH ROW EXECUTE FUNCTION set_instagram_comment_automations_updated_at();

-- Gate INSERT-only (política pós-downgrade da casa: existentes continuam
-- legíveis, tocáveis e executando; só criar novas é bloqueado).
CREATE TRIGGER trg_feature_instagram_automation
  BEFORE INSERT ON instagram_comment_automations
  FOR EACH ROW EXECUTE FUNCTION enforce_plan_feature('feature_instagram_automation', 'direct', 'conta_id');

-- RLS. Desvio INTENCIONAL de post_status_automations (que restringe até o
-- SELECT a owner/admin): aqui agent LÊ para acompanhar resultados, sem mutar.
ALTER TABLE instagram_comment_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY ica_select ON instagram_comment_automations
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY ica_insert ON instagram_comment_automations
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.get_my_role() IN ('owner', 'admin')
  );

CREATE POLICY ica_update ON instagram_comment_automations
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.get_my_role() IN ('owner', 'admin')
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.get_my_role() IN ('owner', 'admin')
  );

CREATE POLICY ica_delete ON instagram_comment_automations
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.get_my_role() IN ('owner', 'admin')
  );

CREATE POLICY service_role_bypass_ica ON instagram_comment_automations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Verificar unicidade do prefixo de versão**

Run: `ls supabase/migrations/ | grep -c "^20260815000002"`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260815000002_instagram_comment_automations.sql
git commit -m "feat(automacoes): migration da tabela de automações + flag de plano"
```

---

### Task 2: Migration B — `instagram_webhook_events`, `instagram_automation_sends` e colunas em `instagram_accounts`

**Files:**
- Create: `supabase/migrations/20260815000003_instagram_automation_events_sends.sql`

**Interfaces:**
- Consumes: `instagram_comment_automations (id, conta_id)` (Task 1).
- Produces: tabelas `instagram_webhook_events` e `instagram_automation_sends` (colunas exatas abaixo, usadas pelas RPCs da Task 3 e pelo processador da Task 9); `instagram_accounts.comments_subscribed_at`; índice `idx_instagram_accounts_ig_user_id`.

- [ ] **Step 1: Escrever a migration**

```sql
-- Evento durável (1 linha POR COMENTÁRIO, não por delivery: entry é array e
-- cada entry pode trazer vários changes) + máquina de estados do envio.
-- Deliberadamente append-only, sem unicidade por comment_id: redelivery gera
-- linha nova e reprocessa idempotente (o efeito externo é deduplicado pelo
-- comment_id UNIQUE de sends); o expurgo de 30 dias limita o crescimento.

CREATE TABLE instagram_webhook_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id  uuid NOT NULL,
  ig_user_id   text NOT NULL,
  comment_id   text,
  raw          jsonb NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX idx_ig_webhook_events_unprocessed
  ON instagram_webhook_events (received_at) WHERE processed_at IS NULL;

-- Service-role only (padrão tiktok_webhook_events): RLS ligada, sem policies.
ALTER TABLE instagram_webhook_events ENABLE ROW LEVEL SECURITY;

-- Envio: evento durável != envio. comment_id UNIQUE = 1 private reply por
-- comentário (limite da própria Meta). FK composta tenant-safe: o worker é
-- service role e um bug não pode casar automação de um workspace com o
-- conta_id de outro.
CREATE TABLE instagram_automation_sends (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id          text NOT NULL UNIQUE,
  automation_id       uuid NOT NULL,
  conta_id            uuid NOT NULL,
  media_id            text,
  commenter_id        text,
  commenter_username  text,
  comment_text        text,
  comment_created_at  timestamptz NOT NULL,
  status              text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'retry', 'sent', 'sent_partial', 'failed', 'skipped')),
  skip_reason         text,
  error_code          text,
  dm_status           text CHECK (dm_status IN ('sent', 'failed')),
  public_reply_status text CHECK (public_reply_status IN ('sent', 'failed', 'unknown')),
  public_reply_id     text,
  processing_at       timestamptz,
  next_attempt_at     timestamptz,
  attempts            int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ias_automation_same_tenant FOREIGN KEY (automation_id, conta_id)
    REFERENCES instagram_comment_automations (id, conta_id) ON DELETE CASCADE
);

CREATE INDEX idx_ias_automation_created ON instagram_automation_sends (automation_id, created_at DESC);
CREATE INDEX idx_ias_conta_created ON instagram_automation_sends (conta_id, created_at DESC);
CREATE INDEX idx_ias_retryable ON instagram_automation_sends (next_attempt_at)
  WHERE status IN ('retry', 'processing');

CREATE OR REPLACE FUNCTION set_instagram_automation_sends_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER instagram_automation_sends_updated_at
  BEFORE UPDATE ON instagram_automation_sends
  FOR EACH ROW EXECUTE FUNCTION set_instagram_automation_sends_updated_at();

-- Log visível na UI: SELECT para qualquer membro do workspace; escrita só
-- service role (sem policies de INSERT/UPDATE/DELETE para authenticated).
ALTER TABLE instagram_automation_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY ias_select ON instagram_automation_sends
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY service_role_bypass_ias ON instagram_automation_sends
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Assinatura do webhook de comments confirmada (POST + GET subscribed_apps).
-- Setada/limpa APENAS pelo callback OAuth e pelo re-check diário do cron.
ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS comments_subscribed_at timestamptz;

-- Lookup do webhook (entry.id -> conta). NÃO-ÚNICO de propósito: a mesma
-- conta IG pode estar conectada em clientes/workspaces distintos; o conflito
-- é resolvido fail-closed no processador (spec, "Resolução de conta duplicada").
CREATE INDEX IF NOT EXISTS idx_instagram_accounts_ig_user_id
  ON instagram_accounts (instagram_user_id);
```

- [ ] **Step 2: Verificar unicidade do prefixo**

Run: `ls supabase/migrations/ | awk -F_ '{print $1}' | sort | uniq -d`
Expected: saída vazia

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260815000003_instagram_automation_events_sends.sql
git commit -m "feat(automacoes): migrations de eventos de webhook e máquina de estados de envio"
```

---

### Task 3: Migration C — RPCs de claim/estado + tipo de notificação

**Files:**
- Create: `supabase/migrations/20260815000004_instagram_automation_rpcs.sql`

**Interfaces:**
- Consumes: tabelas das Tasks 1-2.
- Produces (assinaturas exatas, chamadas pelo processador/cron via `svc.rpc(...)`):
  - `claim_automation_send(p_comment_id text, p_automation_id uuid, p_conta_id uuid, p_media_id text, p_commenter_id text, p_commenter_username text, p_comment_text text, p_comment_created_at timestamptz, p_cooldown_hours int DEFAULT 24) RETURNS TABLE (send_id uuid, outcome text)` com outcome `'claimed' | 'duplicate' | 'cooldown'`
  - `claim_retryable_automation_sends(p_limit int DEFAULT 25) RETURNS TABLE (send_id uuid, comment_id text, automation_id uuid, conta_id uuid, media_id text, commenter_id text, comment_created_at timestamptz, dm_status text, public_reply_status text, attempts int, encrypted_access_token text, instagram_user_id text)`
  - `fail_ineligible_automation_sends() RETURNS int`
  - `mark_automation_dm_sent(p_send_id uuid) RETURNS boolean`
  - tipo de notificação `'instagram_automation_failed'`

- [ ] **Step 1: Escrever a migration**

```sql
-- RPCs da automação de comentário -> DM. Todas SECURITY DEFINER, service_role only
-- (REVOKE FROM PUBLIC também tira o service_role: re-conceder explicitamente,
-- gotcha documentado em 20260806000002).

-- Claim atômico do envio. Advisory lock transacional sobre (automation, commenter):
-- dois comentários SIMULTÂNEOS do mesmo usuário têm comment_id distintos e o
-- UNIQUE sozinho não os serializa; o lock força o segundo a esperar o commit do
-- primeiro e aí o cooldown (revalidado NA MESMA transação) o pega.
CREATE OR REPLACE FUNCTION claim_automation_send(
  p_comment_id text,
  p_automation_id uuid,
  p_conta_id uuid,
  p_media_id text,
  p_commenter_id text,
  p_commenter_username text,
  p_comment_text text,
  p_comment_created_at timestamptz,
  p_cooldown_hours int DEFAULT 24
) RETURNS TABLE (send_id uuid, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('instagram_automation_sends'),
    hashtext(p_automation_id::text || ':' || coalesce(p_commenter_id, ''))
  );

  -- Um envio em voo (processing/retry) reserva o cooldown; se ele falhar no fim,
  -- perdemos um DM do segundo comentário, o que é preferível a DM duplicada.
  IF p_commenter_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM instagram_automation_sends s
    WHERE s.automation_id = p_automation_id
      AND s.commenter_id = p_commenter_id
      AND s.comment_id <> p_comment_id
      AND (s.dm_status = 'sent' OR s.status IN ('processing', 'retry'))
      AND s.created_at > now() - make_interval(hours => p_cooldown_hours)
  ) THEN
    INSERT INTO instagram_automation_sends
      (comment_id, automation_id, conta_id, media_id, commenter_id,
       commenter_username, comment_text, comment_created_at, status, skip_reason)
    VALUES
      (p_comment_id, p_automation_id, p_conta_id, p_media_id, p_commenter_id,
       p_commenter_username, p_comment_text, p_comment_created_at, 'skipped', 'cooldown')
    ON CONFLICT (comment_id) DO NOTHING;
    RETURN QUERY SELECT NULL::uuid, 'cooldown'::text;
    RETURN;
  END IF;

  INSERT INTO instagram_automation_sends
    (comment_id, automation_id, conta_id, media_id, commenter_id,
     commenter_username, comment_text, comment_created_at, status, processing_at)
  VALUES
    (p_comment_id, p_automation_id, p_conta_id, p_media_id, p_commenter_id,
     p_commenter_username, p_comment_text, p_comment_created_at, 'processing', now())
  ON CONFLICT (comment_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 'duplicate'::text;
  ELSE
    RETURN QUERY SELECT v_id, 'claimed'::text;
  END IF;
END $$;

REVOKE ALL ON FUNCTION claim_automation_send(text, uuid, uuid, text, text, text, text, timestamptz, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_automation_send(text, uuid, uuid, text, text, text, text, timestamptz, int) TO service_role;

-- Claim do cron sobre ENVIOS retryable (não sobre eventos): retry vencido ou
-- processing órfão (janela de 10 min, padrão claim_posts_for_publishing).
-- O join EXIGE conta apta: backlog de conta que perdeu permissão/assinatura
-- não é claimado aqui; fail_ineligible_automation_sends o encerra.
CREATE OR REPLACE FUNCTION claim_retryable_automation_sends(p_limit int DEFAULT 25)
RETURNS TABLE (
  send_id uuid,
  comment_id text,
  automation_id uuid,
  conta_id uuid,
  media_id text,
  commenter_id text,
  comment_created_at timestamptz,
  dm_status text,
  public_reply_status text,
  attempts int,
  encrypted_access_token text,
  instagram_user_id text
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH claimed AS (
    SELECT s.id
    FROM instagram_automation_sends s
    JOIN instagram_comment_automations a ON a.id = s.automation_id
    JOIN instagram_accounts ia ON ia.client_id = a.client_id
      AND ia.authorization_status = 'active'
      AND ia.comments_subscribed_at IS NOT NULL
      AND 'instagram_business_manage_comments' = ANY (ia.permissions)
    WHERE ((s.status = 'retry' AND s.next_attempt_at <= now())
        OR (s.status = 'processing' AND s.processing_at < now() - interval '10 minutes'))
      AND s.comment_created_at > now() - interval '7 days'
    FOR UPDATE OF s SKIP LOCKED
    LIMIT p_limit
  ),
  updated AS (
    UPDATE instagram_automation_sends
    SET status = 'processing', processing_at = now()
    WHERE id IN (SELECT id FROM claimed)
    RETURNING *
  )
  SELECT
    u.id, u.comment_id, u.automation_id, u.conta_id, u.media_id, u.commenter_id,
    u.comment_created_at, u.dm_status, u.public_reply_status, u.attempts,
    ia.encrypted_access_token, ia.instagram_user_id
  FROM updated u
  JOIN instagram_comment_automations a ON a.id = u.automation_id
  JOIN instagram_accounts ia ON ia.client_id = a.client_id;
$$;

REVOKE ALL ON FUNCTION claim_retryable_automation_sends(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_retryable_automation_sends(int) TO service_role;

-- Encerra envios que nunca mais serão elegíveis: janela de 7 dias vencida ou
-- conta que perdeu a aptidão (permissão/assinatura/status). Roda no cron antes
-- do claim.
CREATE OR REPLACE FUNCTION fail_ineligible_automation_sends()
RETURNS int LANGUAGE sql SECURITY DEFINER AS $$
  WITH failed AS (
    UPDATE instagram_automation_sends s
    SET status = 'failed',
        error_code = CASE
          WHEN s.comment_created_at <= now() - interval '7 days' THEN 'reply_window_expired'
          ELSE 'account_unauthorized'
        END
    WHERE ((s.status = 'retry' AND s.next_attempt_at <= now())
        OR (s.status = 'processing' AND s.processing_at < now() - interval '10 minutes'))
      AND (
        s.comment_created_at <= now() - interval '7 days'
        OR NOT EXISTS (
          SELECT 1
          FROM instagram_comment_automations a
          JOIN instagram_accounts ia ON ia.client_id = a.client_id
          WHERE a.id = s.automation_id
            AND ia.authorization_status = 'active'
            AND ia.comments_subscribed_at IS NOT NULL
            AND 'instagram_business_manage_comments' = ANY (ia.permissions)
        )
      )
    RETURNING 1
  )
  SELECT count(*)::int FROM failed;
$$;

REVOKE ALL ON FUNCTION fail_ineligible_automation_sends() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fail_ineligible_automation_sends() TO service_role;

-- Transição atômica dm_status -> 'sent' + contador. O incremento acontece
-- EXATAMENTE na transição (condicional, mesma transação): DM enviada conta
-- mesmo que a resposta pública falhe depois (sent_partial); crash não perde
-- nem duplica contador; retry/redelivery caem no IS DISTINCT FROM e não
-- incrementam de novo.
CREATE OR REPLACE FUNCTION mark_automation_dm_sent(p_send_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_automation uuid;
BEGIN
  UPDATE instagram_automation_sends
     SET dm_status = 'sent'
   WHERE id = p_send_id AND dm_status IS DISTINCT FROM 'sent'
  RETURNING automation_id INTO v_automation;

  IF v_automation IS NULL THEN
    RETURN false;
  END IF;

  UPDATE instagram_comment_automations
     SET dms_sent_count = dms_sent_count + 1, last_triggered_at = now()
   WHERE id = v_automation;

  RETURN true;
END $$;

REVOKE ALL ON FUNCTION mark_automation_dm_sent(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_automation_dm_sent(uuid) TO service_role;

-- ---------- notifications_type_check ---------------------------------
-- ATENÇÃO: copiar a lista da definição MAIS RECENTE no momento de escrever
-- (hoje 20260811000003_storage_autoclean_notification.sql, 21 valores) e
-- apenas ACRESCENTAR 'instagram_automation_failed'. Este arquivo passa a ser
-- a definição mais recente: a próxima migration copia DAQUI.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'post_approved', 'post_correction', 'post_message',
    'idea_submitted', 'briefing_answered',
    'step_activated', 'step_completed', 'post_assigned',
    'workflow_completed', 'deadline_approaching',
    'invite_accepted', 'member_role_changed', 'member_removed',
    'post_edit_suggestion', 'task_assigned', 'client_message',
    'mention', 'post_status_automation',
    'instagram_connected_by_client',
    'post_publish_failed', 'storage_autoclean_report',
    'instagram_automation_failed'
  )
);
```

- [ ] **Step 2: Conferir a lista do CHECK contra a definição mais recente**

Run: `grep -rl "notifications_type_check" supabase/migrations/ | sort | tail -2`
Expected: o penúltimo arquivo é `20260811000003_storage_autoclean_notification.sql`; conferir que a lista acima = lista dele + `instagram_automation_failed`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260815000004_instagram_automation_rpcs.sql
git commit -m "feat(automacoes): RPCs de claim/estado e tipo de notificação"
```

---

### Task 4: Shared — escopos e helpers Graph extraídos

**Files:**
- Create: `supabase/functions/_shared/instagram-scopes.ts`
- Create: `supabase/functions/_shared/instagram-graph.ts`
- Modify: `supabase/functions/_shared/instagram-publish-utils.ts` (remover `const GRAPH_BASE` e `function throwGraphError` locais; importar de `instagram-graph.ts`)
- Modify: `supabase/functions/instagram-integration/index.ts:157` (scope na URL) e `:264` (`REQUESTED_SCOPES`)
- Modify: `supabase/functions/instagram-connect-link/handler.ts:10` (`IG_SCOPES`)
- Test: `supabase/functions/__tests__/instagram-scopes_test.ts`

**Interfaces:**
- Produces:
  - `IG_BASE_SCOPES: readonly string[]` (o trio atual, obrigatório), `IG_OPTIONAL_SCOPES: readonly string[]` (`['instagram_business_manage_comments']`), `IG_ALL_SCOPES: readonly string[]`
  - `buildScopeParam(includeOptional: boolean): string` — join por vírgula do trio, com os opcionais anexados só quando `includeOptional`. Os call sites decidem por `Deno.env.get('IG_AUTOMATION_SCOPES_LIVE') === 'true'` (lido no `index.ts` de cada função e passado adiante; em `instagram-connect-link` vira dep injetada no handler). ANTES do Advanced Access, pedir o escopo para usuário sem papel no app pode quebrar o dialog de OAuth; a env var mantém produção no trio até o review aprovar.
  - `GRAPH_VERSION = "v22.0"`, `GRAPH_BASE = "https://graph.instagram.com/v22.0"`, `throwGraphError(data: any): never` (mesmo corpo de hoje, agora exportado)

- [ ] **Step 1: Teste falhando**

```ts
// supabase/functions/__tests__/instagram-scopes_test.ts
import { assert, assertEquals } from "./assert.ts";
import {
  buildScopeParam, IG_ALL_SCOPES, IG_BASE_SCOPES, IG_OPTIONAL_SCOPES,
} from "../_shared/instagram-scopes.ts";

Deno.test("base scopes são exatamente o trio historicamente pedido", () => {
  assertEquals([...IG_BASE_SCOPES], [
    "instagram_business_basic",
    "instagram_business_manage_insights",
    "instagram_business_content_publish",
  ]);
});

Deno.test("único escopo opcional do v1 é manage_comments (nunca manage_messages)", () => {
  assertEquals([...IG_OPTIONAL_SCOPES], ["instagram_business_manage_comments"]);
  assert(!IG_ALL_SCOPES.includes("instagram_business_manage_messages"));
});

Deno.test("buildScopeParam: trio sem a flag; trio + opcionais com a flag", () => {
  assertEquals(buildScopeParam(false), IG_BASE_SCOPES.join(","));
  assertEquals(buildScopeParam(true), IG_ALL_SCOPES.join(","));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:functions -- --filter "escopo"`
Expected: FAIL (módulo inexistente)

- [ ] **Step 3: Implementar**

```ts
// supabase/functions/_shared/instagram-scopes.ts
// Fonte ÚNICA da string de escopos (antes triplicada em instagram-integration
// e instagram-connect-link). Os opcionais NUNCA entram no check
// MISSING_PERMISSIONS nem no fallback otimista de permissions[] (fail-closed:
// só são registrados quando a Meta os devolve explicitamente).
export const IG_BASE_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_insights",
  "instagram_business_content_publish",
] as const;

export const IG_OPTIONAL_SCOPES = ["instagram_business_manage_comments"] as const;

export const IG_ALL_SCOPES: readonly string[] = [...IG_BASE_SCOPES, ...IG_OPTIONAL_SCOPES];

/** Os opcionais só entram na URL de OAuth quando IG_AUTOMATION_SCOPES_LIVE
 * estiver ligada (Advanced Access aprovado, ou staging para teste com conta
 * com papel no app): pedir escopo sem Advanced Access para usuário sem papel
 * pode quebrar o dialog de login da Meta. */
export function buildScopeParam(includeOptional: boolean): string {
  return (includeOptional ? IG_ALL_SCOPES : IG_BASE_SCOPES).join(",");
}
```

```ts
// supabase/functions/_shared/instagram-graph.ts
// Versão e helper de erro Graph, antes privados em instagram-publish-utils.
export const GRAPH_VERSION = "v22.0";
export const GRAPH_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;

// deno-lint-ignore no-explicit-any
export function throwGraphError(data: any): never {
  const err: any = new Error(data.error.message);
  if (data.error.code === 190) err.code = "TOKEN_EXPIRED";
  if (typeof data.error.code === "number") err.graphCode = data.error.code;
  if (typeof data.error.error_subcode === "number") err.graphSubcode = data.error.error_subcode;
  if (typeof data.error.fbtrace_id === "string") err.fbtraceId = data.error.fbtrace_id;
  throw err;
}
```

Em `instagram-publish-utils.ts`: apagar as definições locais e adicionar
`import { GRAPH_BASE, throwGraphError } from "./instagram-graph.ts";`.

Em `instagram-integration/index.ts`: importar `buildScopeParam` e `IG_BASE_SCOPES`;
no topo do módulo, `const IG_SCOPES_LIVE = Deno.env.get("IG_AUTOMATION_SCOPES_LIVE") === "true";`
na URL de autorização (linha ~157) trocar a string literal por
`${buildScopeParam(IG_SCOPES_LIVE)}`; na linha ~264 trocar
`const REQUESTED_SCOPES = [...]` por `const REQUESTED_SCOPES = [...IG_BASE_SCOPES];`
(o check MISSING_PERMISSIONS continua só sobre o trio).

Em `instagram-connect-link`: o `index.ts` lê a env
(`automationScopesLive: Deno.env.get("IG_AUTOMATION_SCOPES_LIVE") === "true"`)
e injeta como dep; `handler.ts` troca `const IG_SCOPES = "..."` por
`buildScopeParam(deps.automationScopesLive)` no ponto de uso (linha ~217) —
handlers não leem `Deno.env` (convenção index/handler).

- [ ] **Step 4: Rodar testes (novos + suite inteira, para pegar regressão do publish-utils)**

Run: `npm run test:functions && git checkout -- deno.lock`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/instagram-scopes.ts supabase/functions/_shared/instagram-graph.ts \
  supabase/functions/_shared/instagram-publish-utils.ts supabase/functions/instagram-integration/index.ts \
  supabase/functions/instagram-connect-link/handler.ts supabase/functions/__tests__/instagram-scopes_test.ts
git commit -m "refactor(instagram): escopos e helpers Graph em módulos compartilhados"
```

---

### Task 5: Shared — módulo puro de matching (TDD)

**Files:**
- Create: `supabase/functions/_shared/instagram-comment-matching.ts`
- Test: `supabase/functions/__tests__/instagram-comment-matching_test.ts`

**Interfaces:**
- Produces:
  - `normalizeForMatch(s: string): string` (NFD sem acentos + lowercase)
  - `matchesKeywords(commentText: string, keywords: string[]): boolean` (palavra/frase inteira contida)
  - `interface AutomationCandidate { id: string; conta_id: string; client_id: number; ig_media_id: string | null; created_at: string }`
  - `pickWinner<T extends AutomationCandidate>(matched: T[]): T | null` (específico > global, `created_at` ASC, `id` ASC)

- [ ] **Step 1: Testes falhando**

```ts
// supabase/functions/__tests__/instagram-comment-matching_test.ts
import { assert, assertEquals } from "./assert.ts";
import {
  matchesKeywords, normalizeForMatch, pickWinner,
} from "../_shared/instagram-comment-matching.ts";

Deno.test("normaliza acentos e caixa", () => {
  assertEquals(normalizeForMatch("ÉBOOK Grátis"), "ebook gratis");
});

Deno.test("casa palavra inteira, não substring", () => {
  assert(matchesKeywords("quero a promo!", ["promo"]));
  assert(matchesKeywords("PROMO", ["promo"]));
  assert(matchesKeywords("mande o ébook", ["ebook"]));
  assert(!matchesKeywords("assumi um compromisso", ["promo"]));
  assert(!matchesKeywords("promoção imperdível", ["promo"]));
});

Deno.test("keyword com espaços vira frase", () => {
  assert(matchesKeywords("EU QUERO muito", ["eu quero"]));
  assert(!matchesKeywords("eu não quero", ["eu quero"]));
});

Deno.test("qualquer keyword da lista dispara; lista vazia nunca", () => {
  assert(matchesKeywords("link por favor", ["promo", "link"]));
  assert(!matchesKeywords("link por favor", []));
});

Deno.test("desempate: específico > global, depois created_at ASC, id ASC", () => {
  const base = { conta_id: "w1", client_id: 1 };
  const globalOld = { ...base, id: "b", ig_media_id: null, created_at: "2026-01-01T00:00:00Z" };
  const specificNew = { ...base, id: "c", ig_media_id: "m1", created_at: "2026-06-01T00:00:00Z" };
  const specificOld = { ...base, id: "a", ig_media_id: "m1", created_at: "2026-01-01T00:00:00Z" };
  assertEquals(pickWinner([globalOld, specificNew, specificOld])?.id, "a");
  assertEquals(pickWinner([globalOld])?.id, "b");
  assertEquals(pickWinner([]), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:functions -- --filter "desempate"`
Expected: FAIL (módulo inexistente)

- [ ] **Step 3: Implementar**

```ts
// supabase/functions/_shared/instagram-comment-matching.ts
// Matching puro (sem I/O) da automação de comentário -> DM. PT-BR: comparação
// sem acentos e sem caixa; keyword casa como palavra/frase INTEIRA (limites =
// qualquer coisa que não seja letra/dígito unicode), então "promo" não casa
// "compromisso" nem "promoção".

export function normalizeForMatch(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesKeywords(commentText: string, keywords: string[]): boolean {
  const text = normalizeForMatch(commentText).replace(/\s+/g, " ").trim();
  return keywords.some((k) => {
    const kw = normalizeForMatch(k).replace(/\s+/g, " ").trim();
    if (!kw) return false;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(kw)}($|[^\\p{L}\\p{N}])`, "u");
    return re.test(text);
  });
}

export interface AutomationCandidate {
  id: string;
  conta_id: string;
  client_id: number;
  ig_media_id: string | null;
  created_at: string;
}

/** Específico > global, depois created_at ASC, id ASC (spec: "a mais antiga vence"). */
export function pickWinner<T extends AutomationCandidate>(matched: T[]): T | null {
  if (matched.length === 0) return null;
  const sorted = [...matched].sort((a, b) =>
    ((a.ig_media_id ? 0 : 1) - (b.ig_media_id ? 0 : 1)) ||
    a.created_at.localeCompare(b.created_at) ||
    a.id.localeCompare(b.id)
  );
  return sorted[0];
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:functions -- --filter "matching" && git checkout -- deno.lock`
Expected: PASS (rodar também os testes de Step 1 por nome se o filter não pegar todos)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/instagram-comment-matching.ts supabase/functions/__tests__/instagram-comment-matching_test.ts
git commit -m "feat(automacoes): módulo puro de matching de keywords"
```

---

### Task 6: Shared — cliente de mensagens/comentários (TDD)

**Files:**
- Create: `supabase/functions/_shared/instagram-messaging.ts`
- Test: `supabase/functions/__tests__/instagram-messaging_test.ts`

**Interfaces:**
- Consumes: `GRAPH_BASE` (Task 4).
- Produces (todas com `fetchFn` injetável, default `fetch`, e `AbortSignal.timeout(10_000)`):
  - `class IgApiError extends Error { kind: 'transient' | 'token_expired' | 'already_replied' | 'permanent' | 'timeout'; graphCode?: number; graphSubcode?: number; httpStatus?: number }`
  - `sendPrivateReply(deps, args: { igUserId: string; token: string; commentId: string; text: string }): Promise<void>` — `POST {GRAPH_BASE}/{igUserId}/messages` body `{recipient:{comment_id}, message:{text}}`
  - `replyToComment(deps, args: { commentId: string; token: string; text: string }): Promise<{ replyId: string }>` — `POST {GRAPH_BASE}/{commentId}/replies` body `{message}`
  - `fetchComment(deps, args: { commentId: string; token: string }): Promise<{ id: string; from?: { id: string; username?: string }; parent_id?: string; text?: string; media?: { id: string }; timestamp?: string }>`
  - `fetchReplies(deps, args: { commentId: string; token: string }): Promise<Array<{ id: string; text?: string; from?: { id: string } }>>`
  - `subscribeToComments(deps, token: string): Promise<void>` — `POST {GRAPH_BASE}/me/subscribed_apps?subscribed_fields=comments`
  - `fetchSubscribedFields(deps, token: string): Promise<string[]>` — `GET {GRAPH_BASE}/me/subscribed_apps`
  - `classifyIgError(err: unknown): IgApiError['kind']`
  - `deps` = `{ fetchFn?: typeof fetch; timeoutMs?: number }`

- [ ] **Step 1: Testes falhando** (mock de `fetchFn`; casos essenciais)

```ts
// supabase/functions/__tests__/instagram-messaging_test.ts
import { assert, assertEquals } from "./assert.ts";
import {
  classifyIgError, fetchSubscribedFields, IgApiError, replyToComment, sendPrivateReply,
} from "../_shared/instagram-messaging.ts";

function fakeFetch(status: number, body: unknown): typeof fetch {
  // deno-lint-ignore no-explicit-any
  return ((input: any, init: any) => {
    fakeFetch.last = { url: String(input), init };
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
}
// deno-lint-ignore no-explicit-any
fakeFetch.last = null as any;

Deno.test("sendPrivateReply: POST /messages com Bearer e recipient.comment_id", async () => {
  const fetchFn = fakeFetch(200, { message_id: "m1" });
  await sendPrivateReply({ fetchFn }, { igUserId: "17840001", token: "tk", commentId: "c1", text: "oi" });
  assert(fakeFetch.last.url.endsWith("/17840001/messages"));
  assertEquals(fakeFetch.last.init.headers["Authorization"], "Bearer tk");
  assertEquals(JSON.parse(fakeFetch.last.init.body), {
    recipient: { comment_id: "c1" }, message: { text: "oi" },
  });
});

Deno.test("replyToComment devolve o id da reply", async () => {
  const fetchFn = fakeFetch(200, { id: "r9" });
  const out = await replyToComment({ fetchFn }, { commentId: "c1", token: "tk", text: "respondido" });
  assertEquals(out.replyId, "r9");
});

Deno.test("erro 190 vira kind token_expired; 4/9/17/613 viram transient", async () => {
  for (const [code, kind] of [[190, "token_expired"], [4, "transient"], [613, "transient"]] as const) {
    const fetchFn = fakeFetch(400, { error: { message: "x", code } });
    try {
      await sendPrivateReply({ fetchFn }, { igUserId: "1", token: "t", commentId: "c", text: "y" });
      assert(false, "devia lançar");
    } catch (e) {
      assert(e instanceof IgApiError);
      assertEquals((e as IgApiError).kind, kind);
    }
  }
});

Deno.test("mensagem de 'private reply já enviada' vira kind already_replied", () => {
  const err = new IgApiError("The comment has already received a private reply", { graphCode: 10 });
  assertEquals(classifyIgError(err), "already_replied");
});

Deno.test("fetchSubscribedFields devolve nomes dos campos assinados", async () => {
  const fetchFn = fakeFetch(200, { data: [{ subscribed_fields: ["comments"] }] });
  assertEquals(await fetchSubscribedFields({ fetchFn }, "tk"), ["comments"]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:functions -- --filter "sendPrivateReply"`
Expected: FAIL

- [ ] **Step 3: Implementar**

```ts
// supabase/functions/_shared/instagram-messaging.ts
// Cliente de comentários/DM (Instagram Login). REGRAS DA CASA aplicadas aqui:
// Bearer no header (nunca token em query string) e AbortSignal.timeout em TODA
// chamada (um fetch pendurado seguraria o lock de 'processing' do envio).
import { GRAPH_BASE } from "./instagram-graph.ts";

export interface IgMessagingDeps {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

type IgErrorKind = "transient" | "token_expired" | "already_replied" | "permanent" | "timeout";

const TRANSIENT_GRAPH_CODES = new Set([1, 2, 4, 9, 17, 613]);
// A Meta não documenta um código estável para "já existe private reply";
// classificação por mensagem, com o erro completo logado para observabilidade.
const ALREADY_REPLIED_RE = /already.*(private reply|received)|one private reply/i;

export class IgApiError extends Error {
  kind: IgErrorKind;
  graphCode?: number;
  graphSubcode?: number;
  httpStatus?: number;
  constructor(message: string, opts: { kind?: IgErrorKind; graphCode?: number; graphSubcode?: number; httpStatus?: number } = {}) {
    super(message);
    this.graphCode = opts.graphCode;
    this.graphSubcode = opts.graphSubcode;
    this.httpStatus = opts.httpStatus;
    this.kind = opts.kind ?? classifyRaw(message, opts.graphCode);
  }
}

function classifyRaw(message: string, graphCode?: number): IgErrorKind {
  if (graphCode === 190) return "token_expired";
  if (ALREADY_REPLIED_RE.test(message)) return "already_replied";
  if (graphCode !== undefined && TRANSIENT_GRAPH_CODES.has(graphCode)) return "transient";
  return "permanent";
}

export function classifyIgError(err: unknown): IgErrorKind {
  if (err instanceof IgApiError) {
    if (ALREADY_REPLIED_RE.test(err.message)) return "already_replied";
    return err.kind;
  }
  if (err instanceof DOMException && err.name === "TimeoutError") return "timeout";
  return "permanent";
}

async function igRequest(
  deps: IgMessagingDeps,
  method: "GET" | "POST",
  path: string,
  token: string,
  body?: unknown,
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 10_000;
  let res: Response;
  try {
    res = await fetchFn(`${GRAPH_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new IgApiError("graph request timed out", { kind: "timeout" });
    }
    throw new IgApiError(e instanceof Error ? e.message : String(e), { kind: "transient" });
  }
  const data = await res.json().catch(() => ({}));
  if (data.error) {
    console.error("[instagram-messaging] graph error:", JSON.stringify(data.error));
    throw new IgApiError(String(data.error.message ?? "graph error"), {
      graphCode: typeof data.error.code === "number" ? data.error.code : undefined,
      graphSubcode: typeof data.error.error_subcode === "number" ? data.error.error_subcode : undefined,
      httpStatus: res.status,
    });
  }
  if (!res.ok) {
    throw new IgApiError(`graph http ${res.status}`, { httpStatus: res.status, kind: "transient" });
  }
  return data;
}

export async function sendPrivateReply(
  deps: IgMessagingDeps,
  args: { igUserId: string; token: string; commentId: string; text: string },
): Promise<void> {
  await igRequest(deps, "POST", `/${args.igUserId}/messages`, args.token, {
    recipient: { comment_id: args.commentId },
    message: { text: args.text },
  });
}

export async function replyToComment(
  deps: IgMessagingDeps,
  args: { commentId: string; token: string; text: string },
): Promise<{ replyId: string }> {
  const data = await igRequest(deps, "POST", `/${args.commentId}/replies`, args.token, {
    message: args.text,
  });
  return { replyId: String(data.id ?? "") };
}

export interface IgCommentDetails {
  id: string;
  from?: { id: string; username?: string };
  parent_id?: string;
  text?: string;
  media?: { id: string };
  timestamp?: string;
}

export async function fetchComment(
  deps: IgMessagingDeps,
  args: { commentId: string; token: string },
): Promise<IgCommentDetails> {
  return await igRequest(
    deps, "GET", `/${args.commentId}?fields=from,parent_id,text,media,timestamp`, args.token,
  ) as IgCommentDetails;
}

export async function fetchReplies(
  deps: IgMessagingDeps,
  args: { commentId: string; token: string },
): Promise<Array<{ id: string; text?: string; from?: { id: string } }>> {
  const data = await igRequest(deps, "GET", `/${args.commentId}/replies?fields=id,text,from`, args.token);
  return Array.isArray(data.data) ? data.data : [];
}

export async function subscribeToComments(deps: IgMessagingDeps, token: string): Promise<void> {
  await igRequest(deps, "POST", `/me/subscribed_apps?subscribed_fields=comments`, token);
}

export async function fetchSubscribedFields(deps: IgMessagingDeps, token: string): Promise<string[]> {
  const data = await igRequest(deps, "GET", `/me/subscribed_apps`, token);
  const rows = Array.isArray(data.data) ? data.data : [];
  return rows.flatMap((r: { subscribed_fields?: string[] }) => r.subscribed_fields ?? []);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:functions && git checkout -- deno.lock`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/instagram-messaging.ts supabase/functions/__tests__/instagram-messaging_test.ts
git commit -m "feat(automacoes): cliente compartilhado de comentários e private reply"
```

---

### Task 7: Webhook — parser de payload (TDD)

**Files:**
- Create: `supabase/functions/instagram-webhook/parse.ts`
- Test: `supabase/functions/__tests__/instagram-webhook-parse_test.ts`

**Interfaces:**
- Produces:
  - `interface NormalizedCommentEvent { igUserId: string; commentId: string; mediaId?: string; parentId?: string; commenterId?: string; commenterUsername?: string; text?: string; timestamp?: string; raw: unknown }`
  - `parseWebhookDelivery(body: unknown): NormalizedCommentEvent[]` — itera TODAS as entries; aceita as DUAS formas (`entry[].changes[]` com `field === "comments"` E `entry[].field/value` no nível da entry); ignora fields desconhecidos; nunca lança.

- [ ] **Step 1: Testes falhando**

```ts
// supabase/functions/__tests__/instagram-webhook-parse_test.ts
import { assertEquals } from "./assert.ts";
import { parseWebhookDelivery } from "../instagram-webhook/parse.ts";

const value = (id: string) => ({
  id,
  from: { id: "u1", username: "fulano" },
  media: { id: "media9" },
  text: "quero a promo",
});

Deno.test("forma entry[].changes[]: múltiplas entries e múltiplos changes", () => {
  const out = parseWebhookDelivery({
    object: "instagram",
    entry: [
      { id: "acc1", time: 1723640400, changes: [
        { field: "comments", value: value("c1") },
        { field: "comments", value: value("c2") },
        { field: "mentions", value: { id: "x" } },
      ]},
      { id: "acc2", time: 1723640401, changes: [{ field: "comments", value: value("c3") }] },
    ],
  });
  assertEquals(out.map((e) => [e.igUserId, e.commentId]), [["acc1", "c1"], ["acc1", "c2"], ["acc2", "c3"]]);
  assertEquals(out[0].commenterId, "u1");
  assertEquals(out[0].mediaId, "media9");
});

Deno.test("forma entry[].field/value (fixture de comentário próprio da Meta)", () => {
  const out = parseWebhookDelivery({
    object: "instagram",
    entry: [{ id: "acc1", time: 1723640400, field: "comments", value: value("c4") }],
  });
  assertEquals(out.length, 1);
  assertEquals(out[0].commentId, "c4");
});

Deno.test("payload sem comentários, malformado ou vazio -> []", () => {
  assertEquals(parseWebhookDelivery({ object: "instagram", entry: [] }), []);
  assertEquals(parseWebhookDelivery({}), []);
  assertEquals(parseWebhookDelivery(null), []);
  assertEquals(parseWebhookDelivery({ entry: [{ id: "a", changes: [{ field: "story_insights", value: {} }] }] }), []);
});

Deno.test("value sem from/parent_id não quebra; timestamp epoch vira ISO", () => {
  const out = parseWebhookDelivery({
    entry: [{ id: "acc1", time: 1723640400, changes: [{ field: "comments", value: { id: "c5", created_time: 1723640400 } }] }],
  });
  assertEquals(out[0].commenterId, undefined);
  assertEquals(out[0].timestamp, new Date(1723640400 * 1000).toISOString());
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:functions -- --filter "entry"`
Expected: FAIL

- [ ] **Step 3: Implementar**

```ts
// supabase/functions/instagram-webhook/parse.ts
// Normaliza uma entrega da Meta em 1 evento POR COMENTÁRIO. `entry` é array;
// cada entry pode trazer vários changes; as fixtures oficiais mostram DUAS
// formas (entry[].changes[] e entry[].field/value) e o parser aceita ambas.
// from/parent_id/text NÃO são garantidos: o processador tem fallback via GET.
// NUNCA lança: payload que não parseia devolve [] (nada durável a persistir).

export interface NormalizedCommentEvent {
  igUserId: string;
  commentId: string;
  mediaId?: string;
  parentId?: string;
  commenterId?: string;
  commenterUsername?: string;
  text?: string;
  timestamp?: string;
  raw: unknown;
}

// deno-lint-ignore no-explicit-any
function toEvent(igUserId: string, change: any): NormalizedCommentEvent | null {
  const value = change?.value;
  const commentId = value?.id;
  if (typeof commentId !== "string" || !commentId) return null;
  const epoch = typeof value.created_time === "number" ? value.created_time
    : typeof value.timestamp === "number" ? value.timestamp : null;
  return {
    igUserId,
    commentId,
    mediaId: typeof value.media?.id === "string" ? value.media.id : undefined,
    parentId: typeof value.parent_id === "string" ? value.parent_id : undefined,
    commenterId: typeof value.from?.id === "string" ? value.from.id : undefined,
    commenterUsername: typeof value.from?.username === "string" ? value.from.username : undefined,
    text: typeof value.text === "string" ? value.text : undefined,
    timestamp: epoch !== null ? new Date(epoch * 1000).toISOString()
      : typeof value.timestamp === "string" ? value.timestamp : undefined,
    raw: change,
  };
}

// deno-lint-ignore no-explicit-any
export function parseWebhookDelivery(body: any): NormalizedCommentEvent[] {
  const out: NormalizedCommentEvent[] = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const igUserId = typeof entry?.id === "string" ? entry.id : String(entry?.id ?? "");
    if (!igUserId) continue;
    const changes = Array.isArray(entry.changes)
      ? entry.changes
      : entry.field !== undefined ? [{ field: entry.field, value: entry.value }] : [];
    for (const change of changes) {
      if (change?.field !== "comments") continue;
      const ev = toEvent(igUserId, change);
      if (ev) out.push(ev);
    }
  }
  return out;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:functions && git checkout -- deno.lock`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/instagram-webhook/parse.ts supabase/functions/__tests__/instagram-webhook-parse_test.ts
git commit -m "feat(automacoes): parser normalizado do webhook de comentários"
```

---

### Task 8: Webhook — handler HTTP (handshake, assinatura, durable-ack) (TDD)

**Files:**
- Create: `supabase/functions/instagram-webhook/handler.ts`
- Create: `supabase/functions/instagram-webhook/index.ts`
- Modify: `supabase/config.toml` (adicionar `[functions.instagram-webhook]` + `verify_jwt = false`)
- Modify: `supabase/functions/__tests__/config-audit_test.ts` (adicionar `"instagram-webhook"` a `REQUIRED_FUNCTIONS`, seção "Token/internal auth")
- Test: `supabase/functions/__tests__/instagram-webhook_test.ts`

**Interfaces:**
- Consumes: `parseWebhookDelivery` (Task 7), `timingSafeEqual` de `_shared/crypto.ts`.
- Produces: `createInstagramWebhookHandler(deps: InstagramWebhookDeps): (req: Request) => Promise<Response>` com
  `interface InstagramWebhookDeps { createServiceDb: () => DbClient; metaAppSecret: string; verifyToken: string; waitUntil: (p: Promise<void>) => void; processDelivery?: (svc: DbClient, rows: EventRow[]) => Promise<void>; randomUUID?: () => string }`
  e `interface EventRow { id: string; delivery_id: string; ig_user_id: string; comment_id: string; raw: unknown }`.
  A Task 9 injeta o `processDelivery` real; até lá o default é um no-op logado.

- [ ] **Step 1: Testes falhando** (usar `createSupabaseQueryMock` de `supabase/functions/test/shared/supabaseMock.ts` e o padrão `baseDeps` com `unreachable` de `tiktok-webhook_test.ts` como referência de estilo)

```ts
// supabase/functions/__tests__/instagram-webhook_test.ts
import { assert, assertEquals } from "./assert.ts";
import { createInstagramWebhookHandler } from "../instagram-webhook/handler.ts";
import { createSupabaseQueryMock } from "../test/shared/supabaseMock.ts";

const SECRET = "app-secret";
const VERIFY = "verify-token";

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}

function makeDeps(db: ReturnType<typeof createSupabaseQueryMock>, overrides = {}) {
  const processed: unknown[] = [];
  let bg: Promise<void> | null = null;
  return {
    processed,
    awaitBg: async () => { if (bg) await bg; },
    deps: {
      createServiceDb: () => db.client,
      metaAppSecret: SECRET,
      verifyToken: VERIFY,
      waitUntil: (p: Promise<void>) => { bg = p; },
      processDelivery: (_svc: unknown, rows: unknown[]) => { processed.push(...rows); return Promise.resolve(); },
      randomUUID: () => "fixed-id",
      ...overrides,
    },
  };
}

const BODY = JSON.stringify({
  object: "instagram",
  entry: [{ id: "acc1", time: 1, changes: [{ field: "comments", value: { id: "c1", text: "promo" } }] }],
});

Deno.test("GET handshake: verify_token certo ecoa hub.challenge", async () => {
  const db = createSupabaseQueryMock();
  const { deps } = makeDeps(db);
  const handler = createInstagramWebhookHandler(deps);
  const res = await handler(new Request(
    `https://x/instagram-webhook?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=42`,
  ));
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "42");
});

Deno.test("GET handshake: verify_token errado -> 403 sem corpo", async () => {
  const db = createSupabaseQueryMock();
  const handler = createInstagramWebhookHandler(makeDeps(db).deps);
  const res = await handler(new Request("https://x/instagram-webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42"));
  assertEquals(res.status, 403);
  assertEquals(await res.text(), "");
});

Deno.test("POST com assinatura válida: insere linhas normalizadas, 200 vazio, processa depois", async () => {
  const db = createSupabaseQueryMock();
  const ctx = makeDeps(db);
  const handler = createInstagramWebhookHandler(ctx.deps);
  const res = await handler(new Request("https://x/instagram-webhook", {
    method: "POST",
    headers: { "X-Hub-Signature-256": await sign(BODY) },
    body: BODY,
  }));
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "");
  const inserts = db.calls.filter((c) => c.table === "instagram_webhook_events" && c.operation === "insert");
  assertEquals(inserts.length, 1);
  await ctx.awaitBg();
  assertEquals(ctx.processed.length, 1);
});

Deno.test("POST com assinatura inválida: 401, sem insert, sem processamento", async () => {
  const db = createSupabaseQueryMock();
  const ctx = makeDeps(db);
  const handler = createInstagramWebhookHandler(ctx.deps);
  const res = await handler(new Request("https://x/instagram-webhook", {
    method: "POST",
    headers: { "X-Hub-Signature-256": "sha256=deadbeef" },
    body: BODY,
  }));
  assertEquals(res.status, 401);
  assertEquals(db.calls.filter((c) => c.operation === "insert").length, 0);
  assertEquals(ctx.processed.length, 0);
});

Deno.test("POST sem eventos de comentário: 200, sem insert", async () => {
  const db = createSupabaseQueryMock();
  const ctx = makeDeps(db);
  const handler = createInstagramWebhookHandler(ctx.deps);
  const body = JSON.stringify({ object: "instagram", entry: [] });
  const res = await handler(new Request("https://x/instagram-webhook", {
    method: "POST", headers: { "X-Hub-Signature-256": await sign(body) }, body,
  }));
  assertEquals(res.status, 200);
  assertEquals(db.calls.filter((c) => c.operation === "insert").length, 0);
});

Deno.test("falha no insert -> 500 (Meta reentrega), sem processamento", async () => {
  const db = createSupabaseQueryMock({ failInsertOn: "instagram_webhook_events" });
  const ctx = makeDeps(db);
  const handler = createInstagramWebhookHandler(ctx.deps);
  const res = await handler(new Request("https://x/instagram-webhook", {
    method: "POST", headers: { "X-Hub-Signature-256": await sign(BODY) }, body: BODY,
  }));
  assertEquals(res.status, 500);
  assertEquals(ctx.processed.length, 0);
});
```

Nota: se `createSupabaseQueryMock` não suportar `failInsertOn`, seguir o mecanismo
que `tiktok-webhook_test.ts` usa para simular falha de insert (ler o mock em
`supabase/functions/test/shared/supabaseMock.ts` antes de escrever).

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:functions -- --filter "handshake"`
Expected: FAIL

- [ ] **Step 3: Implementar handler + index + config**

```ts
// supabase/functions/instagram-webhook/handler.ts
// Receiver de webhooks de comentário da Meta (Instagram Login). Endpoint
// PÚBLICO (config.toml: verify_jwt = false); a autenticação é a assinatura
// X-Hub-Signature-256 (HMAC-SHA256 do body CRU com META_APP_SECRET) e, no GET
// de verificação, o hub.verify_token. SEM CORS de propósito: tráfego
// servidor-a-servidor, como stripe-webhook/pagarme-webhook. Nunca ecoar o
// payload: toda resposta tem corpo vazio (exceto o hub.challenge do handshake,
// que é o protocolo da Meta).
//
// Durable-ack (padrão tiktok-webhook):
//   1. valida assinatura sincronamente (falha -> 401, nada persiste);
//   2. normaliza a entrega em 1 linha POR COMENTÁRIO e insere TUDO em um
//      lote, awaited, ANTES do 200 (falha -> 500, a Meta reentrega);
//   3. responde 200 vazio;
//   4. só então processa via waitUntil (Task 9 injeta o processador real).
import { timingSafeEqual } from "../_shared/crypto.ts";
import { parseWebhookDelivery } from "./parse.ts";

type DbClient = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
};

export interface EventRow {
  id: string;
  delivery_id: string;
  ig_user_id: string;
  comment_id: string;
  raw: unknown;
}

export interface InstagramWebhookDeps {
  createServiceDb: () => DbClient;
  metaAppSecret: string;
  verifyToken: string;
  waitUntil: (p: Promise<void>) => void;
  processDelivery?: (svc: DbClient, rows: EventRow[]) => Promise<void>;
  randomUUID?: () => string;
}

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createInstagramWebhookHandler(deps: InstagramWebhookDeps) {
  const randomUUID = deps.randomUUID ?? (() => crypto.randomUUID());
  const processDelivery = deps.processDelivery ??
    ((_svc: DbClient, rows: EventRow[]) => {
      console.log(`[instagram-webhook] processDelivery ausente; ${rows.length} evento(s) ficam para o cron`);
      return Promise.resolve();
    });

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    // Handshake de verificação da Meta (configuração do app no painel).
    if (req.method === "GET") {
      const mode = url.searchParams.get("hub.mode") ?? "";
      const token = url.searchParams.get("hub.verify_token") ?? "";
      const challenge = url.searchParams.get("hub.challenge") ?? "";
      if (mode === "subscribe" && timingSafeEqual(token, deps.verifyToken)) {
        return new Response(challenge, { status: 200 });
      }
      return new Response(null, { status: 403 });
    }

    if (req.method !== "POST") {
      return new Response(null, { status: 405 });
    }

    // Body CRU antes de qualquer parse: a assinatura é sobre os bytes exatos.
    const bodyText = await req.text();
    const header = req.headers.get("X-Hub-Signature-256") ?? "";
    const expected = `sha256=${await hmacSha256Hex(deps.metaAppSecret, bodyText)}`;
    if (!header || !timingSafeEqual(header, expected)) {
      console.error("[instagram-webhook] assinatura inválida; descartando");
      return new Response(null, { status: 401 });
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return new Response(null, { status: 200 });
    }

    const events = parseWebhookDelivery(body);
    if (events.length === 0) {
      return new Response(null, { status: 200 });
    }

    const svc = deps.createServiceDb();
    const deliveryId = randomUUID();
    const rows: EventRow[] = events.map((e) => ({
      id: randomUUID(),
      delivery_id: deliveryId,
      ig_user_id: e.igUserId,
      comment_id: e.commentId,
      raw: e.raw,
    }));

    const { error } = await svc.from("instagram_webhook_events").insert(rows);
    if (error) {
      console.error("[instagram-webhook] falha ao persistir eventos; 500 para a Meta reentregar:", error.message);
      return new Response(null, { status: 500 });
    }

    deps.waitUntil(processDelivery(svc, rows));
    return new Response(null, { status: 200 });
  };
}
```

```ts
// supabase/functions/instagram-webhook/index.ts
// Env wiring apenas; lógica em handler.ts / process.ts.
import { createClient } from "npm:@supabase/supabase-js@2";
import { createInstagramWebhookHandler } from "./handler.ts";
import { createProcessDelivery } from "./process.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_APP_SECRET = Deno.env.get("META_APP_SECRET");
const META_WEBHOOK_VERIFY_TOKEN = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN");
if (!META_APP_SECRET) throw new Error("META_APP_SECRET is required");
if (!META_WEBHOOK_VERIFY_TOKEN) throw new Error("META_WEBHOOK_VERIFY_TOKEN is required");

Deno.serve(createInstagramWebhookHandler({
  createServiceDb: () => createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY),
  metaAppSecret: META_APP_SECRET,
  verifyToken: META_WEBHOOK_VERIFY_TOKEN,
  processDelivery: createProcessDelivery({}),
  // deno-lint-ignore no-undef -- EdgeRuntime é global do Supabase Edge Runtime.
  waitUntil: (promise) => { EdgeRuntime.waitUntil(promise); },
}));
```

Nota: até a Task 9 existir, criar `process.ts` com um stub exportando
`createProcessDelivery = () => async () => {}` para o index compilar; a Task 9
o substitui pela implementação real (o teste do handler injeta o próprio
`processDelivery`, então não depende do stub).

`supabase/config.toml` (junto dos outros blocos):

```toml
[functions.instagram-webhook]
verify_jwt = false
```

`config-audit_test.ts`: adicionar `"instagram-webhook",` na seção
"Token/internal auth" de `REQUIRED_FUNCTIONS`.

- [ ] **Step 4: Rodar e ver passar (inclui config-audit)**

Run: `npm run test:functions && git checkout -- deno.lock`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/instagram-webhook/ supabase/config.toml \
  supabase/functions/__tests__/config-audit_test.ts supabase/functions/__tests__/instagram-webhook_test.ts
git commit -m "feat(automacoes): webhook da Meta com handshake, assinatura e durable-ack"
```

---

### Task 9: Webhook — processador de eventos (TDD)

**Files:**
- Create: `supabase/functions/instagram-webhook/process.ts` (substitui o stub)
- Create: `supabase/functions/_shared/automation-notify.ts`
- Test: `supabase/functions/__tests__/instagram-webhook-process_test.ts`

**Interfaces:**
- Consumes: matching (Task 5), messaging (Task 6), RPCs (Task 3), `decryptToken` de `_shared/instagram-publish-utils.ts`, `EventRow` (Task 8).
- Produces:
  - `createProcessDelivery(deps: ProcessDeps): (svc: DbClient, rows: EventRow[]) => Promise<void>`
  - `executeSend(ctx, send: ClaimedSend): Promise<void>` — exportada, REUSADA pelo cron (Task 10); `interface ClaimedSend { send_id: string; comment_id: string; automation_id: string; conta_id: string; commenter_id: string | null; comment_created_at: string; dm_status: string | null; public_reply_status: string | null; attempts: number; encrypted_access_token: string; instagram_user_id: string }`
  - `interface ProcessDeps { fetchFn?: typeof fetch; decryptToken?: (t: string) => Promise<string>; now?: () => Date; hourlyCap?: number }`
  - `notifyAutomationFailure(svc, args: { contaId: string; clientId: number; reason: 'token_expired' | 'subscription_lost' | 'duplicate_account_conflict' }): Promise<void>` (em `automation-notify.ts`, dedupe 24h por cliente)

**Lógica exigida (do spec, verbatim em comportamento):**

`processDelivery` para cada linha de evento:
1. Candidatos: `instagram_accounts` com `instagram_user_id = row.ig_user_id`, `authorization_status='active'`, `permissions` contendo `instagram_business_manage_comments`, `comments_subscribed_at IS NOT NULL`. Zero candidatos → stamp `processed_at`, fim.
2. Automações ativas dos clientes candidatos, filtradas por `ig_media_id IS NULL OR ig_media_id = mediaId`.
3. Se faltar `commenterId`/`text`/`parentId`/`timestamp` no evento → `fetchComment` (token do primeiro candidato); ainda indeterminado (sem `from` ou sem `text`) → stamp processed + log, fim (skip seguro, sem DM).
4. `comment_created_at` = timestamp do value, senão do GET, senão `received_at`.
5. Skips: `commenterId === igUserId` (comentário próprio) ou `parentId` presente (reply) → stamp processed.
6. `matchesKeywords(text, a.keywords)` por automação; nenhum match → stamp processed.
7. Conflito cross-workspace: `new Set(matched.map(m => m.conta_id)).size > 1` → `notifyAutomationFailure` (reason `duplicate_account_conflict`) para CADA workspace envolvido, stamp processed, fim. NENHUMA linha em sends.
8. `pickWinner(matched)` → RPC `claim_automation_send(...)`; outcome `duplicate`/`cooldown` → stamp processed, fim.
9. Throttle: count de sends com `dm_status='sent'` e `updated_at > now()-1h` das automações do mesmo `client_id`; `>= hourlyCap` (default 700) → `UPDATE ... SET status='retry', next_attempt_at=now()+10min, attempts=attempts` (sem incrementar), stamp processed, fim.
10. `executeSend(...)`, depois stamp processed. `processDelivery` NUNCA lança (try/catch por linha; crash deixa `processed_at` NULL para o sweep do cron).

`executeSend`:
1. Revalidação: re-lê a automação (`ativo`, `dm_message`, `public_reply`, `client_id`) e a conta apta; automação sumiu/pausada → `status='skipped', skip_reason='automation_inactive'`; conta inapta → `status='failed', error_code='account_unauthorized'`.
2. `decryptToken(encrypted_access_token)`.
3. Se `dm_status !== 'sent'`: `sendPrivateReply`. Sucesso ou `classifyIgError === 'already_replied'` → RPC `mark_automation_dm_sent(send_id)`. `token_expired` → `UPDATE instagram_accounts SET authorization_status='expired'` + `notifyAutomationFailure(reason 'token_expired')` + `status='failed', error_code='token_expired'`, fim. `transient`/`timeout` → backoff `[60, 300, 900, 3600, 21600][attempts]` segundos: `status='retry', next_attempt_at, attempts+1`; `attempts >= 5` ou `comment_created_at <= now()-7d` → `status='failed', error_code='retry_exhausted'`, fim. `permanent` → `status='failed', error_code='dm_permanent'`, fim.
4. Resposta pública (se `public_reply` configurada e `public_reply_status !== 'sent'`): `replyToComment`. Sucesso → grava `public_reply_id`, `public_reply_status='sent'`. `timeout` → `fetchReplies` e procurar reply com `from.id === instagram_user_id` e `text === public_reply`; achou → `sent` + id; não achou/erro → `public_reply_status='unknown'` (NUNCA repostar). Erro não-timeout → `public_reply_status='failed'`.
5. Fechamento: `status='sent'` se (sem `public_reply` ou `public_reply_status==='sent'`), senão `status='sent_partial'`. `UPDATE ... WHERE id = send_id AND status = 'processing'`.

`notifyAutomationFailure`: SELECT em `notifications` por `type='instagram_automation_failed'`, `workspace_id=contaId`, `metadata->>'client_id' = clientId`, `created_at > now()-24h`, LIMIT 1; se vazio → RPC `resolve_notification_targets(contaId, null, ARRAY['owner','admin'])` → RPC `insert_notification_batch(contaId, targets, 'instagram_automation_failed', '/automacoes', jsonb com {client_id, reason})`. Nunca lança (try/catch + log).

- [ ] **Step 1: Testes falhando** — cobrir com o `createSupabaseQueryMock` + deps fake: (a) comentário próprio → nenhuma RPC de claim; (b) reply (`parentId`) → idem; (c) match feliz → claim chamado, `sendPrivateReply` chamado, `mark_automation_dm_sent` chamado, reply pública postada, update final `sent`; (d) outcome `cooldown` → nenhum send; (e) conflito cross-workspace (2 contas em workspaces distintos com automações que casam) → nenhuma claim + 2 notificações; (f) `token_expired` → conta marcada `expired` + notificação + `failed`; (g) transient com `attempts=0` → `retry` com `next_attempt_at` +60s; (h) retry com `dm_status='sent'` → NÃO chama `sendPrivateReply`, só a reply pública; (i) reply pública timeout + `fetchReplies` encontra → `sent` com id; não encontra → `unknown` e nunca reposta. Seguir o estilo `baseDeps`/`unreachable` de `tiktok-webhook_test.ts` (asserção por omissão).

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:functions -- --filter "process"`
Expected: FAIL

- [ ] **Step 3: Implementar `process.ts` e `automation-notify.ts` conforme a lógica acima** (usar `deps.fetchFn` repassado ao cliente de messaging; `decryptToken` default importado de `instagram-publish-utils.ts`; constante `BACKOFF_SECONDS = [60, 300, 900, 3600, 21600]` exportada para o teste)

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:functions && git checkout -- deno.lock`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/instagram-webhook/process.ts supabase/functions/_shared/automation-notify.ts \
  supabase/functions/__tests__/instagram-webhook-process_test.ts supabase/functions/instagram-webhook/index.ts
git commit -m "feat(automacoes): processador de comentários com claim, DM e resposta pública"
```

---

### Task 10: Cron de retry/manutenção + schedule (TDD)

**Files:**
- Create: `supabase/functions/instagram-automation-cron/handler.ts`
- Create: `supabase/functions/instagram-automation-cron/index.ts`
- Create: `supabase/migrations/20260815000005_schedule_instagram_automation_cron.sql`
- Modify: `supabase/config.toml` (+ `[functions.instagram-automation-cron]` `verify_jwt = false`)
- Modify: `supabase/functions/__tests__/config-audit_test.ts` (+ `"instagram-automation-cron"` na seção Cron)
- Test: `supabase/functions/__tests__/instagram-automation-cron_test.ts`

**Interfaces:**
- Consumes: `executeSend` + `createProcessDelivery` (Task 9), RPCs (Task 3), `fetchSubscribedFields` (Task 6), `reportCronFailure` de `_shared/triage.ts`, `timingSafeEqual`.
- Produces: `createInstagramAutomationCronHandler(deps)` com `deps = { cronSecret: string; createServiceDb; timingSafeEqual; fetchFn?; decryptToken?; now? }`.

**Fases do handler (nesta ordem; cada uma em try/catch próprio, erros acumulados e reportados via `reportCronFailure` no final se `failed > 0`):**
1. Auth: `x-cron-secret` com `timingSafeEqual`; falha → 401.
2. `fail_ineligible_automation_sends()` (RPC) — loga o count.
3. Sweep de eventos órfãos: `SELECT` de `instagram_webhook_events` com `processed_at IS NULL AND received_at < now() - 10min` LIMIT 50 → re-rodar `processDelivery` (idempotente: claims caem em conflito).
4. Retries: `claim_retryable_automation_sends(25)` → `executeSend` para cada linha.
5. Re-check diário de assinaturas: contas com automação ativa e `comments_subscribed_at < now() - 24h` → `fetchSubscribedFields`; sem `"comments"` → `UPDATE instagram_accounts SET comments_subscribed_at = NULL` + `notifyAutomationFailure(reason 'subscription_lost')`; com → `comments_subscribed_at = now()`.
6. Purge: `DELETE FROM instagram_webhook_events WHERE processed_at IS NOT NULL AND received_at < now() - 30 dias`.
7. Resposta 200 JSON `{ ok: true, failed: N }` (sem detalhes internos).

- [ ] **Step 1: Testes falhando** — (a) sem/errado `x-cron-secret` → 401 e NENHUMA chamada de DB (padrão `cron-auth_test.ts`); (b) happy path chama as RPCs na ordem e retorna 200; (c) claim devolve 1 send → `executeSend` chamado com ela; (d) assinatura caiu → update para NULL + notificação.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:functions -- --filter "cron"`
Expected: FAIL nos novos (os `cron-auth` antigos seguem passando)

- [ ] **Step 3: Implementar handler + index (index injeta `CRON_SECRET` com throw se ausente, mesmo shape de `instagram-sync-cron/index.ts`) + config.toml + REQUIRED_FUNCTIONS + migration de schedule:**

```sql
-- supabase/migrations/20260815000005_schedule_instagram_automation_cron.sql
-- Retry/manutenção da automação de comentário -> DM, a cada 5 minutos.
-- Must be applied AFTER the instagram-automation-cron function is deployed.
-- Rollback order é o INVERSO: cron.unschedule primeiro, depois undeploy.
-- vault.decrypted_secrets é VIEW (subselect form) -- ver nota em 20260617120000.
-- Idempotente: seguro aplicar duas vezes.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'instagram-automation-cron') THEN
    PERFORM cron.unschedule('instagram-automation-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'instagram-automation-cron',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/instagram-automation-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:functions && git checkout -- deno.lock`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/instagram-automation-cron/ supabase/migrations/20260815000005_schedule_instagram_automation_cron.sql \
  supabase/config.toml supabase/functions/__tests__/config-audit_test.ts supabase/functions/__tests__/instagram-automation-cron_test.ts
git commit -m "feat(automacoes): cron de retry, sweep, re-check de assinatura e purge"
```

---

### Task 11: OAuth — escopo opcional fail-closed + subscribed_apps no callback

**Files:**
- Modify: `supabase/functions/instagram-integration/index.ts` (região do callback, ~linhas 264-279 e o upsert de `instagram_accounts` ~500-560)
- Create: `supabase/functions/_shared/instagram-permissions.ts`
- Test: `supabase/functions/__tests__/instagram-permissions_test.ts`

**Interfaces:**
- Produces: `resolveGrantedPermissions(reported: unknown): { permissions: string[]; hasCommentsScope: boolean }` — helper puro extraído para ser testável (o monólito `instagram-integration` não tem DI).

**Comportamento (spec, seção "Escopos"):**
- `reported` = `slTokenData.permissions`. Se NÃO for array não-vazio: `permissions = [...IG_BASE_SCOPES]` (fallback otimista SÓ do trio; o opcional NUNCA entra por fallback), `hasCommentsScope = false`.
- Se for array: `permissions = reported` filtrado a strings; `hasCommentsScope = reported.includes('instagram_business_manage_comments')`.
- No callback, na escrita de `instagram_accounts` (connect E reconnect): SEMPRE incluir `comments_subscribed_at: null` no objeto gravado (reset antes de regravar: reconectar sem o escopo não deixa canAutomate por resíduo).
- Depois da escrita, se `hasCommentsScope`: `subscribeToComments` + `fetchSubscribedFields`; se a lista confirmar `"comments"` → `UPDATE instagram_accounts SET comments_subscribed_at = now() WHERE id = ...`. Qualquer erro: `console.error` e segue (conexão não falha; canAutomate fica false e a UI mostra o CTA de reconectar).

- [ ] **Step 1: Teste falhando do helper**

```ts
// supabase/functions/__tests__/instagram-permissions_test.ts
import { assert, assertEquals } from "./assert.ts";
import { resolveGrantedPermissions } from "../_shared/instagram-permissions.ts";
import { IG_BASE_SCOPES } from "../_shared/instagram-scopes.ts";

Deno.test("sem permissions da Meta: fallback otimista SÓ do trio, nunca do opcional", () => {
  for (const reported of [undefined, null, [], "x"]) {
    const out = resolveGrantedPermissions(reported);
    assertEquals(out.permissions, [...IG_BASE_SCOPES]);
    assertEquals(out.hasCommentsScope, false);
  }
});

Deno.test("com permissions explícitas: registra o que veio e detecta o escopo", () => {
  const out = resolveGrantedPermissions([...IG_BASE_SCOPES, "instagram_business_manage_comments"]);
  assert(out.hasCommentsScope);
  assert(out.permissions.includes("instagram_business_manage_comments"));
  const sem = resolveGrantedPermissions([...IG_BASE_SCOPES]);
  assertEquals(sem.hasCommentsScope, false);
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npm run test:functions -- --filter "permissions"` → FAIL

- [ ] **Step 3: Implementar o helper e ligá-lo no callback** (substituir o bloco `grantedPermissions` das linhas ~265-268 pelo helper; manter o check MISSING_PERMISSIONS sobre `IG_BASE_SCOPES`; adicionar o reset + subscribe + verify conforme o comportamento acima, usando `subscribeToComments`/`fetchSubscribedFields` da Task 6 com o token longo já em mãos)

- [ ] **Step 4: Rodar e ver passar** — `npm run test:functions && git checkout -- deno.lock` → PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/instagram-permissions.ts supabase/functions/instagram-integration/index.ts \
  supabase/functions/__tests__/instagram-permissions_test.ts
git commit -m "feat(automacoes): escopo opcional fail-closed + assinatura de comments no callback"
```

---

### Task 12: Flag em todas as camadas + store + notificação (frontend/backend wiring)

**Files:**
- Modify: `supabase/functions/_shared/entitlements.ts` (append `"feature_instagram_automation"` em `FEATURE_COLUMNS`)
- Modify: `apps/crm/src/hooks/useWorkspaceLimits.ts` (+ `feature_instagram_automation: boolean;` em `FeatureFlags`)
- Modify: `apps/crm/src/lib/entitlement-errors.ts` (+ `feature_instagram_automation: 'Automações do Instagram',` em `FEATURE_LABELS`)
- Modify: `apps/admin/src/lib/api.ts` (+ em `FEATURE_FLAG_KEYS` e `FEATURE_FLAG_LABELS: feature_instagram_automation: 'Instagram Automation'`; + campo no `interface Plan` se os demais flags aparecem lá)
- Modify: `apps/crm/src/store/notifications.ts` (+ `| 'instagram_automation_failed'`)
- Modify: `apps/crm/src/lib/notification-config.ts` (novo case)
- Modify: `apps/crm/src/store/integrations.ts` (`IgAccountStatus` ganha `canAutomate`; o select passa a incluir `comments_subscribed_at`)
- Create: `apps/crm/src/store/instagramAutomations.ts`
- Modify: `apps/crm/src/store/index.ts` (+ `export * from './instagramAutomations';`)
- Test: `apps/crm/src/__tests__/store.instagramAutomations.test.ts`, atualizar `apps/crm/src/__tests__/notification-config.test.ts`

**Interfaces:**
- Produces (consumidas pela página na Task 13):

```ts
export interface InstagramCommentAutomation {
  id: string; conta_id: string; client_id: number; name: string;
  ig_media_id: string | null; media_permalink: string | null; media_caption: string | null;
  keywords: string[]; dm_message: string; public_reply: string | null;
  ativo: boolean; dms_sent_count: number; last_triggered_at: string | null;
  created_at: string; updated_at: string;
}
export interface InstagramAutomationSend {
  id: string; comment_id: string; automation_id: string; conta_id: string;
  media_id: string | null; commenter_id: string | null; commenter_username: string | null;
  comment_text: string | null; comment_created_at: string;
  status: 'processing' | 'retry' | 'sent' | 'sent_partial' | 'failed' | 'skipped';
  skip_reason: string | null; error_code: string | null;
  dm_status: 'sent' | 'failed' | null; public_reply_status: 'sent' | 'failed' | 'unknown' | null;
  attempts: number; created_at: string;
}
getInstagramAutomations(): Promise<InstagramCommentAutomation[]>            // order created_at asc
createInstagramAutomation(payload: Pick<..., 'client_id'|'name'|'ig_media_id'|'media_permalink'|'media_caption'|'keywords'|'dm_message'|'public_reply'>): Promise<InstagramCommentAutomation>  // conta_id via getContaId()
updateInstagramAutomation(id: string, payload: Partial<Pick<..., 'name'|'ig_media_id'|'media_permalink'|'media_caption'|'keywords'|'dm_message'|'public_reply'|'ativo'>>): Promise<InstagramCommentAutomation>
deleteInstagramAutomation(id: string): Promise<void>
getInstagramAutomationSends(automationId: string, limit = 20): Promise<InstagramAutomationSend[]>
countInstagramAutomations(): Promise<number>                                // select head:true, count:'exact'
```
- `IgAccountStatus.canAutomate = permissions.includes('instagram_business_manage_comments') && comments_subscribed_at != null`.

- [ ] **Step 1: Testes falhando** — `store.instagramAutomations.test.ts` no molde exato de `store.postStatuses.test.ts` (mock do supabase; asserta tabela/verbos/payload com `conta_id` injetado); em `notification-config.test.ts` um case para `instagram_automation_failed` (espera `tone: 'danger'` e título "Automação do Instagram com problema").

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run apps/crm/src/__tests__/store.instagramAutomations.test.ts` → FAIL

- [ ] **Step 3: Implementar** — store no padrão `postStatuses.ts` (funções async puras, `getContaId()` no create); case novo em `notification-config.ts`:

```ts
case 'instagram_automation_failed':
  return {
    icon: Instagram,
    tone: 'danger',
    title: 'Automação do Instagram com problema',
    body: 'Uma automação de comentários parou de enviar. Reconecte o Instagram do cliente para reativar.',
  };
```

(usar o import de ícone `Instagram` de `lucide-react`, já usado no app; se o arquivo usa outro conjunto, escolher um dos ícones já importados com tom de alerta). Flags: append nas 4 listas espelhadas + `FeatureFlags`. `admin/src/pages/plan-form.ts` deriva `DEFAULT_FEATURES` de `FEATURE_FLAG_KEYS` sozinho: rodar `npx vitest run apps/admin/src/pages/__tests__/plan-form.test.ts` para confirmar que não quebrou.

- [ ] **Step 4: Rodar e ver passar** — `npm run test` → PASS (inclui os contract tests que ainda não mudaram)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/entitlements.ts apps/crm/src/hooks/useWorkspaceLimits.ts \
  apps/crm/src/lib/entitlement-errors.ts apps/admin/src/lib/api.ts apps/crm/src/store/ \
  apps/crm/src/lib/notification-config.ts apps/crm/src/__tests__/
git commit -m "feat(automacoes): flag em todas as camadas, store e notificação"
```

---

### Task 13: Página `/automacoes` + rota + nav (flag OR count)

**Files:**
- Create: `apps/crm/src/pages/automacoes/AutomacoesPage.tsx`
- Create: `apps/crm/src/pages/automacoes/AutomationFormDialog.tsx`
- Create: `apps/crm/src/hooks/useEffectiveNavFeatures.ts`
- Modify: `apps/crm/src/App.tsx` (lazy import + `<Route path="/automacoes" .../>` dentro do bloco `<ProtectedRoute><AppLayout/></ProtectedRoute>`)
- Modify: `apps/crm/src/content/site-meta.ts` (+ `'automacoes',` em `APP_ROUTE_PREFIXES`)
- Modify: `vercel.json` (+ `automacoes` nas DUAS alternations: linha do header noindex e linha do rewrite `/app.html`)
- Modify: `apps/crm/src/components/layout/nav-data.ts` (item novo + `NAV_FEATURE`)
- Modify: os componentes que chamam `getNavGroups`/`getMoreSheetGroups` (localizar com `grep -rn "getNavGroups\|getMoreSheetGroups" apps/crm/src --include="*.tsx"`; tipicamente `Sidebar.tsx` e `MobileNav.tsx`) para passar `features` através de `buildEffectiveNavFeatures`
- Modify: dicionários i18n com as chaves `nav.*` (localizar com `grep -rn "nav.mensagens" packages/ apps/crm/src` e adicionar `nav.automacoes` = "Automações" nos mesmos arquivos)
- Test: `apps/crm/src/pages/automacoes/__tests__/AutomacoesPage.test.tsx`, `apps/crm/src/hooks/__tests__/useEffectiveNavFeatures.test.ts`

**Interfaces:**
- Consumes: store (Task 12), `useEntitlements`/`useWorkspaceLimits`, `FeatureGate`, `handleEntitlementMutationError`, `getInstagramPosts(clientId, page)` de `services/instagram.ts` (grid de posts), `getInstagramAccountStatuses` (CTA reconectar).
- Produces: rota `/automacoes` acessível SEM flag (fora de `FEATURE_GATED`); item de nav `automacoes` (grupo `gestao`, `icon: 'ph-robot'`, `labelKey: 'nav.automacoes'`).

**Comportamento da página (spec, seção UI):**
- Lista todas as automações do workspace (query key module-level `const AUTOMATIONS_KEY = ['instagram-automations']`), com: `name`, nome do cliente + avatar (join client-side com a lista de clientes já disponível no store), alvo (thumbnail/permalink de `media_permalink` ou o texto "Todos os posts"), chips de `keywords`, `dms_sent_count`, `last_triggered_at` formatado, `Switch` de `ativo` (mutation `updateInstagramAutomation`), menu editar/excluir (AlertDialog de confirmação no delete).
- Filtro por cliente (Select). Linha expandível mostra os últimos envios (`getInstagramAutomationSends`, 20) com username, quando, status (badge por status: `sent` verde, `sent_partial` amarelo, `failed` vermelho, `skipped` neutro, `retry`/`processing` azul).
- Botão "Nova automação" envolto em `<FeatureGate flag="feature_instagram_automation" label="Automações do Instagram">`; lista/toggle/excluir NUNCA gateados (política pós-downgrade). Com flag off e zero automações, a página é o empty state com o upsell do FeatureGate.
- Dica fixa no header da lista: "Se mais de uma automação casar com o mesmo comentário, a mais antiga vence."
- Controles de mutação escondidos quando `role === 'agent'` (via `useAuth()`).
- `AutomationFormDialog` (criar/editar): Select de cliente (apenas clientes com IG conectado; se `canAutomate === false` para o cliente escolhido, mostrar aviso com CTA "Reconectar Instagram" linkando `/clientes/{id}`); alvo: radio "Todos os posts" | "Post específico" (grid paginado de `getInstagramPosts(clientId, page)` com thumbnails clicáveis; guarda `ig_media_id` + `media_permalink` + `media_caption` truncada); input de keywords em chips (Enter adiciona, X remove, mínimo 1); textarea `dm_message` (obrigatória, contador 1000); textarea `public_reply` opcional (contador 500); submit com `useMutation` + `handleEntitlementMutationError(err, workspaceId)` no `onError` (gotcha: trigger de INSERT não passa pelo MutationCache global).
- `useEffectiveNavFeatures`: `buildEffectiveNavFeatures(features, hasAutomations)` exportada pura: retorna `features` com `feature_instagram_automation: features.feature_instagram_automation || hasAutomations`; o hook usa `useQuery({ queryKey: ['instagram-automations-count'], queryFn: countInstagramAutomations, staleTime: 300_000 })`.

- [ ] **Step 1: Testes falhando** — `useEffectiveNavFeatures.test.ts` testa a função pura (flag off + count 0 → off; flag off + count 3 → on; flag on → on). `AutomacoesPage.test.tsx` no estilo dos page tests existentes: renderiza lista mockada, empty state com flag off, esconde botões de mutação para agent. Atualizar snapshot/asserções de `vercel-routing.test.ts`/`nav-data.test.ts` só se falharem (eles derivam das listas).

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run apps/crm/src/pages/automacoes apps/crm/src/hooks/__tests__/useEffectiveNavFeatures.test.ts` → FAIL

- [ ] **Step 3: Implementar página, dialog, hook, rota, prefixos, vercel.json, nav e i18n** (item de nav no grupo `gestao`:)

```ts
{
  id: 'automacoes',
  route: '/automacoes',
  label: 'Automações',
  labelKey: 'nav.automacoes',
  icon: 'ph-robot',
},
```
e em `NAV_FEATURE`: `automacoes: 'feature_instagram_automation',` (o override do hook decide a visibilidade real).

- [ ] **Step 4: Rodar TODA a suite (contract tests de rota/nav inclusos)**

Run: `npm run test`
Expected: PASS, incluindo `vercel-routing.test.ts`, `nav-data.test.ts`, `Sidebar.test.tsx`, `MobileNav.test.tsx`, `ProtectedRoute.test.tsx`, `App.test.tsx`

- [ ] **Step 5: Verificação visual**

Run: `npm run dev` e abrir `http://localhost:5173/automacoes` no browser preview: página carrega (vazia), nav não mostra o item (flag off e zero automações em prod). Nada de screenshot de estado com dados reais de cliente.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/automacoes/ apps/crm/src/hooks/ apps/crm/src/App.tsx \
  apps/crm/src/content/site-meta.ts vercel.json apps/crm/src/components/layout/ packages/
git commit -m "feat(automacoes): página global /automacoes com nav flag-ou-count"
```

---

### Task 14: Teste SQL de entitlements + verificação final + docs

**Files:**
- Create: `supabase/tests/entitlements/65_instagram_automations.sql`
- Modify: `CLAUDE.md` (documentar na seção de env vars das edge functions: `META_WEBHOOK_VERIFY_TOKEN` (obrigatória no instagram-webhook, throw no boot); `IG_AUTOMATION_SCOPES_LIVE` (opcional, default off: enquanto desligada a URL de OAuth pede só o trio aprovado; ligar SÓ depois do Advanced Access de manage_comments, ou em staging para teste); `AUTOMATION_HOURLY_CAP` opcional se implementado como env)
- Modify: `.env.example` (AGENTS.md exige atualizar os templates `*.example` quando uma variável nova é introduzida — achado externo P2. Adicionar, na seção de secrets de edge functions junto de STRIPE_*: `META_WEBHOOK_VERIFY_TOKEN=choose-a-long-random-string` e `IG_AUTOMATION_SCOPES_LIVE=false` com comentário de rollout: "manter false até o Advanced Access de instagram_business_manage_comments; ligar = OAuth passa a pedir o escopo novo")
- Modify: `README.md` (contagem de edge functions: "54" vira o número real após as 2 novas; conferir com `ls supabase/functions | grep -v _shared | grep -v __tests__ | grep -v test | wc -l`)

- [ ] **Step 1: Ler o harness antes de escrever**

Run: `cat supabase/tests/entitlements/_helpers.sql supabase/tests/entitlements/62_post_status_automations.sql`
(o arquivo 65 DEVE usar os mesmos helpers/estrutura; não inventar fixtures próprias)

- [ ] **Step 2: Escrever `65_instagram_automations.sql`** cobrindo, com asserts explícitos no estilo do 62:
  1. Flag OFF: INSERT em `instagram_comment_automations` por owner falha com `feature_disabled:feature_instagram_automation`.
  2. Flag ON: INSERT por owner passa; INSERT/UPDATE/DELETE por **agent** falham (RLS); SELECT por agent retorna a linha (desvio intencional documentado no spec).
  3. Downgrade (flag volta a OFF): UPDATE de `ativo` e DELETE da automação existente continuam passando; novo INSERT volta a falhar.
  4. Tenant-safety estrutural: INSERT com `client_id` de outro workspace falha na FK composta `ica_client_same_tenant`; INSERT direto em `instagram_automation_sends` (como service role) com `automation_id` de um workspace e `conta_id` de outro falha na FK `ias_automation_same_tenant`.
  5. RLS de sends: membro do workspace A não vê sends do workspace B.

- [ ] **Step 3: Rodar localmente SE Docker/colima disponível** (`colima start` + `supabase start` + `bash scripts/test-entitlements.sh`); senão, marcar para verificação no CI (o job `entitlement-tests` roda a suite inteira).

- [ ] **Step 4: Verificação final completa (a mesma bateria do CI)**

```bash
npm run lint
npm run format:check || npm run format
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions
git checkout -- deno.lock
git status --short   # nada inesperado sujo (checar node_modules/.deno pollution)
```
Expected: tudo verde. Se `ls node_modules/.deno` existir, rodar `npm ci` DENTRO do worktree antes de confiar em prettier/tsc.

- [ ] **Step 5: Commit final**

```bash
git add supabase/tests/entitlements/65_instagram_automations.sql CLAUDE.md README.md
git commit -m "test(automacoes): suíte SQL de entitlements + docs de env vars"
```

---

## Fora do escopo destas tasks (deploy, ações manuais)

Ordem de deploy e ações do usuário estão no spec (seções "Runbook" e "Deploy"): migrations staging→prod, deploy das functions com `--use-api --no-verify-jwt`, secret `META_WEBHOOK_VERIFY_TOKEN` por file-redirection, configuração do webhook no painel Meta, migration do pg_cron POR ÚLTIMO, teste real com conta com papel no app (nunca DK TESTE), App Review de `instagram_business_manage_comments`, flip da flag nos planos via admin.
