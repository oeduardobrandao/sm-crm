# Mensagens Consolidadas (Hub + CRM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Mensagens page in both the Hub (client portal) and the CRM showing one chronological feed of all client↔agency communication (post feedback, edit suggestions, and a new general channel), with post deep-links, unread badges on both sides, and agency author identity.

**Architecture:** Federated feed — existing `post_approvals` and `post_edit_suggestions` stay the source of truth; a new `mensagens` table holds only general-channel messages; one `get_mensagens_feed` SECURITY DEFINER RPC unions the three sources server-side and is consumed by the CRM directly (RLS-scoped) and by a new `hub-mensagens` edge function (token-scoped). Read markers live in `mensagens_last_seen` (one row per CRM user, one per cliente).

**Tech Stack:** React 19 + TanStack Query, Supabase Postgres (RLS + plpgsql RPCs), Deno edge functions, Vitest + `deno test`.

**Spec:** `docs/superpowers/specs/2026-07-31-mensagens-consolidadas-design.md`

## Global Constraints

- Portuguese UI copy. **No em-dashes in any user-facing copy** (use period/colon/"·" instead).
- Migration filename prefix must be unique and above `origin/main`'s tail. Main's tail today is `20260731000002`; this plan uses `20260731000003`. **Re-verify at PR-open time**: `git ls-tree origin/main:supabase/migrations | tail`.
- Edge functions: Deno runtime, `npm:` imports, `buildCorsHeaders(req)` (never `*`), generic error messages to clients (log details internally).
- Feature ships **dark** behind `feature_mensagens` (default false on all plans). Do NOT flip any plan.
- Icons: lucide in pages/Hub, Phosphor CSS classes (`ph-*`) in CRM nav only.
- Toasts in CRM: `toast()` from `sonner`.
- All commits on branch `claude/consolidated-messaging-hub-crm-0776c8`. Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Run commands from the worktree root: `/Users/eduardosouza/Projects/sm-crm/.claude/worktrees/luxus-posts-toggle-kanban-list-923d3e`.
- After any `npm run test:functions` / deno run: `git checkout -- deno.lock` if dirtied.

---

### Task 1: Database migration (schema + RPCs + notification trigger)

**Files:**
- Create: `supabase/migrations/20260731000003_mensagens_consolidadas.sql`

**Interfaces (produced, relied on by every later task):**
- Table `mensagens(id bigserial, conta_id uuid, cliente_id bigint, content text, is_workspace_user boolean, author_user_id uuid NULL, created_at timestamptz)`
- Table `mensagens_last_seen(id, conta_id, cliente_id NULL, user_id NULL, last_seen_at)`
- Column `post_approvals.author_user_id uuid NULL`
- RPC `get_mensagens_feed(p_conta_id uuid DEFAULT NULL, p_cliente_id bigint DEFAULT NULL, p_before timestamptz DEFAULT NULL, p_limit int DEFAULT 50)` returning rows `(source text, item_id bigint, cliente_id bigint, cliente_nome text, post_id bigint, workflow_id bigint, post_titulo text, action text, content text, is_workspace_user boolean, author_user_id uuid, author_name text, author_avatar_url text, created_at timestamptz)`
- RPC `get_mensagens_unread(p_conta_id uuid DEFAULT NULL, p_cliente_id bigint DEFAULT NULL)` returning rows `(cliente_id bigint, unread_count bigint)`
- RPC `mark_mensagens_seen(p_conta_id uuid DEFAULT NULL, p_cliente_id bigint DEFAULT NULL)` returning void
- Notification type `client_message` valid in `notifications_type_check`; trigger `notify_client_message` on `mensagens`

There is no local SQL test harness; this task is verified by the migration-version guard, by Task 2's handler tests (RPCs mocked), and end-to-end on staging in Task 9.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260731000003_mensagens_consolidadas.sql
-- Consolidated client<->agency messaging: general-channel `mensagens` table,
-- per-side read markers, author identity on post_approvals, and the
-- federated-feed RPCs consumed by the CRM (RLS) and hub-mensagens (service role).
-- Spec: docs/superpowers/specs/2026-07-31-mensagens-consolidadas-design.md

-- ============ MENSAGENS (general channel, one conversation per cliente) ============
CREATE TABLE mensagens (
  id                bigserial PRIMARY KEY,
  conta_id          uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cliente_id        bigint NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  content           text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
  is_workspace_user boolean NOT NULL DEFAULT false,
  author_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mensagens_conta_cliente_created_idx
  ON mensagens (conta_id, cliente_id, created_at DESC);

ALTER TABLE mensagens ENABLE ROW LEVEL SECURITY;

-- WITH CHECK pins cliente_id to the row's own workspace (20260728000004 pattern);
-- a plain FK alone would let a member of workspace A point at workspace B's cliente.
CREATE POLICY mensagens_tenant_all ON mensagens
  FOR ALL USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.id = mensagens.cliente_id AND c.conta_id = mensagens.conta_id
    )
  );

CREATE POLICY mensagens_service_role_bypass ON mensagens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============ AUTHOR IDENTITY ON EXISTING POST FEEDBACK ============
-- New agency replies record who wrote them; historical rows stay NULL and
-- render as "Equipe".
ALTER TABLE post_approvals
  ADD COLUMN IF NOT EXISTS author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============ READ MARKERS ============
-- Exactly one of (user_id, cliente_id) is set:
--   user_id set    -> a CRM user's marker (covers the whole workspace feed)
--   cliente_id set -> the client side's marker (one reader entity per cliente)
CREATE TABLE mensagens_last_seen (
  id           bigserial PRIMARY KEY,
  conta_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cliente_id   bigint REFERENCES clientes(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((user_id IS NULL) <> (cliente_id IS NULL))
);

CREATE UNIQUE INDEX mensagens_last_seen_user_uq
  ON mensagens_last_seen (conta_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX mensagens_last_seen_cliente_uq
  ON mensagens_last_seen (conta_id, cliente_id) WHERE cliente_id IS NOT NULL;

-- All reads/writes go through the SECURITY DEFINER RPCs below (plus the
-- service role in the edge function), so no authenticated policy is needed.
ALTER TABLE mensagens_last_seen ENABLE ROW LEVEL SECURITY;

CREATE POLICY mensagens_last_seen_service_role_bypass ON mensagens_last_seen
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============ NOTIFICATIONS: new type + trigger ============
-- Type list copied from the LATEST definition (20260730000006), plus client_message.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'post_approved', 'post_correction', 'post_message',
    'idea_submitted', 'briefing_answered',
    'step_activated', 'step_completed', 'post_assigned',
    'workflow_completed', 'deadline_approaching',
    'invite_accepted', 'member_role_changed', 'member_removed',
    'post_edit_suggestion', 'task_assigned', 'client_message'
  )
);

-- General client message -> notify owners/admins (mirrors trg_notify_post_approval).
CREATE OR REPLACE FUNCTION trg_notify_client_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name text;
  v_targets     uuid[];
BEGIN
  BEGIN
    SELECT nome INTO v_client_name FROM clientes WHERE id = NEW.cliente_id;

    v_targets := resolve_notification_targets(NEW.conta_id, NULL, ARRAY['owner','admin']);

    PERFORM insert_notification_batch(
      NEW.conta_id,
      v_targets,
      'client_message',
      '/mensagens',
      jsonb_build_object(
        'client_name', v_client_name,
        'comentario',  left(NEW.content, 280),
        'cliente_id',  NEW.cliente_id
      ),
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_client_message failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_client_message ON mensagens;
CREATE TRIGGER notify_client_message
  AFTER INSERT ON mensagens
  FOR EACH ROW
  WHEN (NEW.is_workspace_user = false)
  EXECUTE FUNCTION trg_notify_client_message();

-- ============ FEED RPC ============
-- Auth model: authenticated CRM callers are scoped to get_my_conta_id()
-- (p_conta_id, if passed, must match). The service role (hub-mensagens edge
-- function, auth.uid() IS NULL) must pass p_conta_id explicitly and, for the
-- hub, always passes p_cliente_id so a client only ever sees their own thread.
-- All references inside the query are table-qualified: the RETURNS TABLE
-- column names would otherwise shadow them in plpgsql.
CREATE OR REPLACE FUNCTION get_mensagens_feed(
  p_conta_id   uuid        DEFAULT NULL,
  p_cliente_id bigint      DEFAULT NULL,
  p_before     timestamptz DEFAULT NULL,
  p_limit      int         DEFAULT 50
)
RETURNS TABLE (
  source            text,
  item_id           bigint,
  cliente_id        bigint,
  cliente_nome      text,
  post_id           bigint,
  workflow_id       bigint,
  post_titulo       text,
  action            text,
  content           text,
  is_workspace_user boolean,
  author_user_id    uuid,
  author_name       text,
  author_avatar_url text,
  created_at        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT public.get_my_conta_id() INTO v_conta;
    IF v_conta IS NULL THEN
      RAISE EXCEPTION 'No active workspace';
    END IF;
    IF p_conta_id IS NOT NULL AND p_conta_id <> v_conta THEN
      RAISE EXCEPTION 'Forbidden';
    END IF;
  ELSE
    IF p_conta_id IS NULL THEN
      RAISE EXCEPTION 'p_conta_id required';
    END IF;
    v_conta := p_conta_id;
  END IF;

  RETURN QUERY
  WITH feed AS (
    SELECT 'post_feedback'::text AS f_source, pa.id AS f_item_id,
           w.cliente_id AS f_cliente_id, wp.id AS f_post_id,
           wp.workflow_id AS f_workflow_id, wp.titulo AS f_post_titulo,
           pa.action AS f_action, pa.comentario AS f_content,
           pa.is_workspace_user AS f_iwu, pa.author_user_id AS f_author,
           pa.created_at AS f_created_at
      FROM post_approvals pa
      JOIN workflow_posts wp ON wp.id = pa.post_id
      JOIN workflows w ON w.id = wp.workflow_id
     WHERE w.conta_id = v_conta
    UNION ALL
    SELECT 'edit_suggestion', es.id,
           w.cliente_id, wp.id, wp.workflow_id, wp.titulo,
           es.status, left(es.suggested_conteudo_plain, 280),
           false, NULL::uuid, es.created_at
      FROM post_edit_suggestions es
      JOIN workflow_posts wp ON wp.id = es.post_id
      JOIN workflows w ON w.id = wp.workflow_id
     WHERE es.conta_id = v_conta
    UNION ALL
    SELECT 'mensagem', m.id,
           m.cliente_id, NULL::bigint, NULL::bigint, NULL::text,
           NULL::text, m.content,
           m.is_workspace_user, m.author_user_id, m.created_at
      FROM mensagens m
     WHERE m.conta_id = v_conta
  )
  SELECT f.f_source, f.f_item_id, f.f_cliente_id, c.nome,
         f.f_post_id, f.f_workflow_id, f.f_post_titulo,
         f.f_action, f.f_content, f.f_iwu,
         f.f_author, mb.nome, mb.avatar_url,
         f.f_created_at
    FROM feed f
    JOIN clientes c ON c.id = f.f_cliente_id
    LEFT JOIN membros mb ON mb.crm_user_id = f.f_author AND mb.conta_id = v_conta
   WHERE (p_cliente_id IS NULL OR f.f_cliente_id = p_cliente_id)
     AND (p_before IS NULL OR f.f_created_at < p_before)
   ORDER BY f.f_created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
END;
$$;

REVOKE ALL ON FUNCTION get_mensagens_feed(uuid, bigint, timestamptz, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_mensagens_feed(uuid, bigint, timestamptz, int)
  TO authenticated, service_role;

-- ============ UNREAD RPC ============
-- Workspace side (auth.uid() set): counts CLIENT-authored items newer than the
-- caller's single marker, grouped per cliente (the CRM sums for the nav badge
-- and uses per-cliente rows for filter chips).
-- Client side (service role): single row for the cliente, counting
-- WORKSPACE-authored items newer than the cliente marker.
CREATE OR REPLACE FUNCTION get_mensagens_unread(
  p_conta_id   uuid   DEFAULT NULL,
  p_cliente_id bigint DEFAULT NULL
)
RETURNS TABLE (cliente_id bigint, unread_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
  v_uid   uuid;
  v_since timestamptz;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NOT NULL THEN
    SELECT public.get_my_conta_id() INTO v_conta;
    IF v_conta IS NULL THEN RETURN; END IF;

    SELECT ls.last_seen_at INTO v_since
      FROM mensagens_last_seen ls
     WHERE ls.conta_id = v_conta AND ls.user_id = v_uid;
    v_since := COALESCE(v_since, '-infinity'::timestamptz);

    RETURN QUERY
    SELECT f.f_cliente_id, count(*)::bigint
      FROM (
        SELECT w.cliente_id AS f_cliente_id, pa.created_at AS f_created_at
          FROM post_approvals pa
          JOIN workflow_posts wp ON wp.id = pa.post_id
          JOIN workflows w ON w.id = wp.workflow_id
         WHERE w.conta_id = v_conta AND pa.is_workspace_user = false
        UNION ALL
        SELECT w.cliente_id, es.created_at
          FROM post_edit_suggestions es
          JOIN workflow_posts wp ON wp.id = es.post_id
          JOIN workflows w ON w.id = wp.workflow_id
         WHERE es.conta_id = v_conta
        UNION ALL
        SELECT m.cliente_id, m.created_at
          FROM mensagens m
         WHERE m.conta_id = v_conta AND m.is_workspace_user = false
      ) f
     WHERE f.f_created_at > v_since
     GROUP BY f.f_cliente_id;
  ELSE
    IF p_conta_id IS NULL OR p_cliente_id IS NULL THEN
      RAISE EXCEPTION 'p_conta_id and p_cliente_id required';
    END IF;

    SELECT ls.last_seen_at INTO v_since
      FROM mensagens_last_seen ls
     WHERE ls.conta_id = p_conta_id AND ls.cliente_id = p_cliente_id;
    v_since := COALESCE(v_since, '-infinity'::timestamptz);

    RETURN QUERY
    SELECT p_cliente_id, count(*)::bigint
      FROM (
        SELECT pa.created_at AS f_created_at
          FROM post_approvals pa
          JOIN workflow_posts wp ON wp.id = pa.post_id
          JOIN workflows w ON w.id = wp.workflow_id
         WHERE w.conta_id = p_conta_id AND w.cliente_id = p_cliente_id
           AND pa.is_workspace_user = true
        UNION ALL
        SELECT m.created_at
          FROM mensagens m
         WHERE m.conta_id = p_conta_id AND m.cliente_id = p_cliente_id
           AND m.is_workspace_user = true
      ) f
     WHERE f.f_created_at > v_since;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION get_mensagens_unread(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_mensagens_unread(uuid, bigint)
  TO authenticated, service_role;

-- ============ MARK-SEEN RPC ============
CREATE OR REPLACE FUNCTION mark_mensagens_seen(
  p_conta_id   uuid   DEFAULT NULL,
  p_cliente_id bigint DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid;
  v_conta uuid;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NOT NULL THEN
    SELECT public.get_my_conta_id() INTO v_conta;
    IF v_conta IS NULL THEN RETURN; END IF;
    INSERT INTO mensagens_last_seen (conta_id, user_id, last_seen_at)
    VALUES (v_conta, v_uid, now())
    ON CONFLICT (conta_id, user_id) WHERE user_id IS NOT NULL
    DO UPDATE SET last_seen_at = now();
  ELSE
    IF p_conta_id IS NULL OR p_cliente_id IS NULL THEN
      RAISE EXCEPTION 'p_conta_id and p_cliente_id required';
    END IF;
    INSERT INTO mensagens_last_seen (conta_id, cliente_id, last_seen_at)
    VALUES (p_conta_id, p_cliente_id, now())
    ON CONFLICT (conta_id, cliente_id) WHERE cliente_id IS NOT NULL
    DO UPDATE SET last_seen_at = now();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION mark_mensagens_seen(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_mensagens_seen(uuid, bigint)
  TO authenticated, service_role;
```

- [ ] **Step 2: Verify migration version prefix is unique**

Run: `ls supabase/migrations | awk -F_ '{print $1}' | sort | uniq -d`
Expected: empty output (no duplicate prefixes).

Run: `git ls-tree origin/main:supabase/migrations --name-only | tail -3`
Expected: tail ends at `20260731000002_invite_membro_link.sql`, i.e. `20260731000003` is above it.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260731000003_mensagens_consolidadas.sql
git commit -m "feat(db): mensagens consolidadas - tabela geral, read markers e RPCs de feed federado

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `hub-mensagens` edge function (TDD)

**Files:**
- Create: `supabase/functions/hub-mensagens/handler.ts`
- Create: `supabase/functions/hub-mensagens/index.ts`
- Test: `supabase/functions/__tests__/hub-mensagens_test.ts`

**Interfaces:**
- Consumes: `resolveHubToken(db, token, now)` from `_shared/hub-token.ts`; `effectivePlanFeature(db, contaId, flag)` from `_shared/entitlements-rpc.ts`; `createJsonResponder` from `_shared/http.ts`; RPCs from Task 1.
- Produces (HTTP contract used by Task 3/4):
  - `GET ?token=…[&before=ISO]` → `{ items: MensagemFeedItem[], unread: number }`
  - `GET ?token=…&count=1` → `{ unread: number }`
  - `POST { token, content }` → `{ ok: true }` (creates a general `mensagens` row, `is_workspace_user=false`; notification fires via DB trigger)
  - `POST /seen { token }` → `{ ok: true }`
  - 400 missing token/content, 404 invalid token, 403 `feature_mensagens` off, 405 other methods.

- [ ] **Step 1: Write the failing Deno tests**

```ts
// supabase/functions/__tests__/hub-mensagens_test.ts
import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createHubMensagensHandler } from "../hub-mensagens/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>) {
  return createHubMensagensHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now: () => "2026-07-31T12:00:00.000Z",
  });
}

// resolveHubToken hits client_hub_tokens + effective_plan_feature (feature_hub_portal),
// then the handler checks effective_plan_feature (feature_mensagens) itself.
function setupToken(db: ReturnType<typeof createSupabaseQueryMock>, mensagensOn = true) {
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queueRpc("effective_plan_feature", { data: true, error: null });
  db.queueRpc("effective_plan_feature", { data: mensagensOn, error: null });
}

const FEED_ROW = {
  source: "post_feedback", item_id: 1, cliente_id: 14, cliente_nome: "ACME",
  post_id: 7, workflow_id: 3, post_titulo: "Post de julho",
  action: "mensagem", content: "Oi!", is_workspace_user: true,
  author_user_id: "u-1", author_name: "Ana", author_avatar_url: null,
  created_at: "2026-07-30T10:00:00.000Z",
};

Deno.test("hub-mensagens: invalid token returns 404", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-mensagens?token=bad"));
  assertEquals(res.status, 404);
});

Deno.test("hub-mensagens: feature_mensagens off returns 403", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db, false);
  const res = await makeHandler(db)(new Request("https://x.test/hub-mensagens?token=t"));
  assertEquals(res.status, 403);
});

Deno.test("hub-mensagens: GET returns feed items + unread", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queueRpc("get_mensagens_feed", { data: [FEED_ROW], error: null });
  db.queueRpc("get_mensagens_unread", { data: [{ cliente_id: 14, unread_count: 2 }], error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-mensagens?token=t"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.items.length, 1);
  assertEquals(body.unread, 2);
});

Deno.test("hub-mensagens: GET with count=1 returns only unread", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queueRpc("get_mensagens_unread", { data: [{ cliente_id: 14, unread_count: 5 }], error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-mensagens?token=t&count=1"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.unread, 5);
});

Deno.test("hub-mensagens: POST requires content", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  const res = await makeHandler(db)(new Request("https://x.test/hub-mensagens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t", content: "   " }),
  }));
  assertEquals(res.status, 400);
});

Deno.test("hub-mensagens: POST inserts a general message scoped to the token's cliente", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("mensagens", "insert", { data: { id: 9 }, error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-mensagens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t", content: "Olá equipe!" }),
  }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.ok, true);
});

Deno.test("hub-mensagens: POST /seen marks the cliente marker", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queueRpc("mark_mensagens_seen", { data: null, error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-mensagens/seen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t" }),
  }));
  assertEquals(res.status, 200);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:functions -- --filter "hub-mensagens"`
Expected: FAIL (module `../hub-mensagens/handler.ts` not found). Then `git checkout -- deno.lock` if dirtied. Note: `--filter` matches test NAMES, not filenames.

- [ ] **Step 3: Implement the handler**

```ts
// supabase/functions/hub-mensagens/handler.ts
import { createJsonResponder } from "../_shared/http.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";

type DbClient = {
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

interface HubMensagensHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
}

const MAX_CONTENT = 4000;

function firstUnread(data: unknown): number {
  if (!Array.isArray(data) || data.length === 0) return 0;
  const n = Number((data[0] as { unread_count?: unknown }).unread_count);
  return Number.isFinite(n) ? n : 0;
}

export function createHubMensagensHandler(deps: HubMensagensHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const idx = pathParts.indexOf("hub-mensagens");
    const seg = idx >= 0 ? pathParts.slice(idx + 1) : [];
    const isSeen = seg.length === 1 && seg[0] === "seen";

    const db = deps.createDb();

    const token =
      url.searchParams.get("token") ?? (await req.clone().json().catch(() => ({}))).token;
    if (!token) return json({ error: "token required" }, 400);

    const hubToken = await resolveHubToken(db as any, token, deps.now());
    if (!hubToken) return json({ error: "Link inválido." }, 404);

    const mensagensOn = await effectivePlanFeature(db as any, hubToken.conta_id, "feature_mensagens");
    if (!mensagensOn) return json({ error: "Recurso indisponível." }, 403);

    const contaId = hubToken.conta_id;
    const clienteId = hubToken.cliente_id;

    if (req.method === "GET") {
      const { data: unreadData, error: unreadError } = await db.rpc("get_mensagens_unread", {
        p_conta_id: contaId,
        p_cliente_id: clienteId,
      });
      if (unreadError) {
        console.error("[hub-mensagens] unread error:", unreadError);
        return json({ error: "Erro interno." }, 500);
      }
      const unread = firstUnread(unreadData);

      if (url.searchParams.has("count")) return json({ unread });

      const before = url.searchParams.get("before");
      const { data: items, error } = await db.rpc("get_mensagens_feed", {
        p_conta_id: contaId,
        p_cliente_id: clienteId,
        p_before: before || null,
        p_limit: 50,
      });
      if (error) {
        console.error("[hub-mensagens] feed error:", error);
        return json({ error: "Erro interno." }, 500);
      }
      return json({ items: items ?? [], unread });
    }

    if (req.method === "POST" && isSeen) {
      const { error } = await db.rpc("mark_mensagens_seen", {
        p_conta_id: contaId,
        p_cliente_id: clienteId,
      });
      if (error) {
        console.error("[hub-mensagens] seen error:", error);
        return json({ error: "Erro interno." }, 500);
      }
      return json({ ok: true });
    }

    if (req.method === "POST" && seg.length === 0) {
      const body = await req.json().catch(() => ({}));
      const content = typeof body.content === "string" ? body.content.trim() : "";
      if (!content || content.length > MAX_CONTENT) {
        return json({ error: "Mensagem inválida." }, 400);
      }
      const { error } = await db
        .from("mensagens")
        .insert({
          conta_id: contaId,
          cliente_id: clienteId,
          content,
          is_workspace_user: false,
        })
        .select("id")
        .single();
      if (error) {
        console.error("[hub-mensagens] insert error:", error);
        return json({ error: "Erro interno." }, 500);
      }
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  };
}
```

```ts
// supabase/functions/hub-mensagens/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createHubMensagensHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createHubMensagensHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
  now: () => new Date().toISOString(),
}));
```

Before finalizing, open `supabase/functions/hub-ideias/handler.ts` and the mock at `test/shared/supabaseMock.ts` to confirm the insert-chain shape the mock supports (`.insert().select().single()`); adjust the insert call (or the test queue) to whatever the mock actually implements.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:functions -- --filter "hub-mensagens"`
Expected: all hub-mensagens tests PASS. Then run the FULL suite once (`npm run test:functions`) to catch shared-mock regressions. `git checkout -- deno.lock` after.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hub-mensagens supabase/functions/__tests__/hub-mensagens_test.ts
git commit -m "feat(hub): edge function hub-mensagens - feed, envio geral e read marker

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Hub API wrappers, types, unread hook, nav badge resolver

**Files:**
- Modify: `apps/hub/src/types.ts` (append types)
- Modify: `apps/hub/src/api.ts` (append wrappers)
- Create: `apps/hub/src/hooks/useMensagensUnreadCount.ts`
- Modify: `apps/hub/src/shell/navItems.ts` (badge key on items)
- Modify: `apps/hub/src/shell/HubSidebar.tsx:24-51` (badge resolution)
- Modify: `apps/hub/src/shell/HubMobileNav.tsx` (same two badge sites: the pill bar and the sheet, both currently `path === '/aprovacoes' ? pendingCount : null`)
- Test: `apps/hub/src/shell/__tests__/navItems.test.ts` (extend)

**Interfaces:**
- Produces: `MensagemFeedItem`, `HubMensagensResponse` types; `fetchMensagens(token, before?)`, `fetchMensagensUnread(token)`, `sendHubMensagem(token, content)`, `markMensagensSeen(token)` in `api.ts`; `useMensagensUnreadCount(token, enabled): number`; `NavItem.badge?: 'aprovacoes' | 'mensagens'`.
- Consumes: Task 2's HTTP contract.

- [ ] **Step 1: Add types to `apps/hub/src/types.ts`**

```ts
export interface MensagemFeedItem {
  source: 'post_feedback' | 'edit_suggestion' | 'mensagem';
  item_id: number;
  cliente_id: number;
  cliente_nome: string;
  post_id: number | null;
  workflow_id: number | null;
  post_titulo: string | null;
  action: string | null;
  content: string | null;
  is_workspace_user: boolean;
  author_user_id: string | null;
  author_name: string | null;
  author_avatar_url: string | null;
  created_at: string;
}

export interface HubMensagensResponse {
  items: MensagemFeedItem[];
  unread: number;
}
```

- [ ] **Step 2: Add API wrappers to `apps/hub/src/api.ts`** (import the two new types in the existing `import type` block)

```ts
export function fetchMensagens(token: string, before?: string) {
  return get<HubMensagensResponse>('hub-mensagens', { token, ...(before ? { before } : {}) });
}

export function fetchMensagensUnread(token: string) {
  return get<{ unread: number }>('hub-mensagens', { token, count: '1' });
}

export function sendHubMensagem(token: string, content: string) {
  return post<{ ok: boolean }>('hub-mensagens', { token, content });
}

export function markMensagensSeen(token: string) {
  return post<{ ok: boolean }>('hub-mensagens/seen', { token });
}
```

- [ ] **Step 3: Create the unread hook**

```ts
// apps/hub/src/hooks/useMensagensUnreadCount.ts
import { useQuery } from '@tanstack/react-query';
import { fetchMensagensUnread } from '../api';

/** Polls the Mensagens unread count for the nav badge. Disabled when the
 * feature flag is off so gated workspaces never hit the endpoint. */
export function useMensagensUnreadCount(token: string, enabled: boolean): number {
  const { data } = useQuery({
    queryKey: ['hub-mensagens-count', token],
    queryFn: () => fetchMensagensUnread(token),
    enabled,
    refetchInterval: 60_000,
  });
  return data?.unread ?? 0;
}
```

- [ ] **Step 4: Write the failing navItems test** (append to `apps/hub/src/shell/__tests__/navItems.test.ts`)

```ts
it('declares badge keys for aprovacoes and mensagens only', () => {
  const items = getVisibleNavItems(true);
  expect(items.find((i) => i.path === '/aprovacoes')?.badge).toBe('aprovacoes');
  expect(items.find((i) => i.path === '/mensagens')?.badge).toBe('mensagens');
  expect(items.filter((i) => i.badge).length).toBe(2);
});
```

Run: `npm run test -- navItems`
Expected: FAIL (`badge` is undefined).

- [ ] **Step 5: Generalize `navItems.ts`**

```ts
export type HubBadgeKey = 'aprovacoes' | 'mensagens';

export interface NavItem {
  label: string;
  labelKey: string;
  icon: LucideIcon;
  path: string;
  /** Which live counter renders as this item's badge pill. */
  badge?: HubBadgeKey;
}
```

Add `badge: 'aprovacoes'` to the Aprovações item and `badge: 'mensagens'` to the Mensagens item in `BASE_NAV_ITEMS`. `getVisibleNavItems` unchanged.

- [ ] **Step 6: Wire the resolver in both nav surfaces**

In `HubSidebar.tsx` (and identically in `HubMobileNav.tsx`, which has TWO badge sites):

```tsx
const pendingCount = usePendingApprovalsCount(token!);
const mensagensUnread = useMensagensUnreadCount(token!, bootstrap.feature_mensagens);
const badgeCounts: Record<HubBadgeKey, number> = {
  aprovacoes: pendingCount,
  mensagens: mensagensUnread,
};
```

and in the item map, replace `const badge = path === '/aprovacoes' ? pendingCount : null;` with (destructure `badge: badgeKey` from the item):

```tsx
const badge = badgeKey ? badgeCounts[badgeKey] : null;
```

Import `useMensagensUnreadCount` and the `HubBadgeKey` type in both files.

- [ ] **Step 7: Run the hub shell tests**

Run: `npm run test -- navItems HubSidebar HubMobileNav`
Expected: PASS (existing HubSidebar/HubMobileNav tests may need a mocked `useMensagensUnreadCount`; if they render the shell with a query client they will pass as-is since the query is disabled when `feature_mensagens` is false in fixtures).

- [ ] **Step 8: Commit**

```bash
git add apps/hub/src/types.ts apps/hub/src/api.ts apps/hub/src/hooks/useMensagensUnreadCount.ts apps/hub/src/shell
git commit -m "feat(hub): badge de mensagens nao lidas na navegacao + wrappers da API

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Hub MensagensPage with the real feed

**Files:**
- Modify: `apps/hub/src/pages/MensagensPage.tsx` (full rewrite, keep named export + flag guard)
- Test: `apps/hub/src/pages/__tests__/mensagensPage.test.tsx` (rewrite the mock-feed assertions)

**Interfaces:**
- Consumes: `fetchMensagens`, `sendHubMensagem`, `markMensagensSeen`, `submitApproval` from `../api`; `useHub()` (`bootstrap`, `token`); `MensagemFeedItem` type.
- Behavior contract: chat-style ascending list; client items right, agency items left with `author_name` (fallback "Equipe"); post-anchored items show a chip linking to `${base}/postagens/${post_id}`; commentless `aprovado`/`correcao` render as centered event rows; `edit_suggestion` renders as an event card; a "Responder" button on post-anchored items switches the composer into reply-to-post mode (sends via `submitApproval(token, post_id, 'mensagem', text)`); default composer sends the general channel; mount marks seen and invalidates `['hub-mensagens-count', token]`.

- [ ] **Step 1: Rewrite the page test**

Keep the existing flag-off test (route guard copy "não está disponível no seu plano"). Replace the seed-message assertions with, mocking `../../api`:

```tsx
// apps/hub/src/pages/__tests__/mensagensPage.test.tsx  (shape; adapt to the file's existing render helper)
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

const { mockFetchMensagens, mockSend, mockSeen, mockSubmitApproval } = vi.hoisted(() => ({
  mockFetchMensagens: vi.fn(),
  mockSend: vi.fn().mockResolvedValue({ ok: true }),
  mockSeen: vi.fn().mockResolvedValue({ ok: true }),
  mockSubmitApproval: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../../api', () => ({
  fetchMensagens: mockFetchMensagens,
  sendHubMensagem: mockSend,
  markMensagensSeen: mockSeen,
  submitApproval: mockSubmitApproval,
}));

const ITEMS = [
  {
    source: 'post_feedback', item_id: 1, cliente_id: 14, cliente_nome: 'ACME',
    post_id: 7, workflow_id: 3, post_titulo: 'Post de julho', action: 'mensagem',
    content: 'Podemos ajustar o CTA?', is_workspace_user: false,
    author_user_id: null, author_name: null, author_avatar_url: null,
    created_at: '2026-07-30T10:00:00.000Z',
  },
  {
    source: 'post_feedback', item_id: 2, cliente_id: 14, cliente_nome: 'ACME',
    post_id: 7, workflow_id: 3, post_titulo: 'Post de julho', action: 'mensagem',
    content: 'Claro, ajustado!', is_workspace_user: true,
    author_user_id: 'u-1', author_name: 'Ana', author_avatar_url: null,
    created_at: '2026-07-30T11:00:00.000Z',
  },
  {
    source: 'mensagem', item_id: 3, cliente_id: 14, cliente_nome: 'ACME',
    post_id: null, workflow_id: null, post_titulo: null, action: null,
    content: 'Obrigado!', is_workspace_user: false,
    author_user_id: null, author_name: null, author_avatar_url: null,
    created_at: '2026-07-30T12:00:00.000Z',
  },
];

// Keep the file's existing render helper (it already wraps HubContext + a
// MemoryRouter at /:workspace/hub/:token/mensagens + a QueryClientProvider,
// with feature_mensagens toggled via the bootstrap fixture) and keep the
// existing flag-off test. Replace the seed-message tests with:

describe('MensagensPage (real feed)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchMensagens.mockResolvedValue({ items: ITEMS, unread: 0 });
  });

  it('renders client and agency bubbles with author identity and post chip', async () => {
    renderPage({ feature_mensagens: true });
    expect(await screen.findByText('Podemos ajustar o CTA?')).toBeInTheDocument();
    expect(screen.getByText('Claro, ajustado!')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    const chips = screen.getAllByRole('link', { name: /Post de julho/ });
    expect(chips[0]).toHaveAttribute('href', expect.stringContaining('/postagens/7'));
  });

  it('sends a general message via the composer', async () => {
    renderPage({ feature_mensagens: true });
    await screen.findByText('Obrigado!');
    await userEvent.type(screen.getByPlaceholderText('Enviar mensagem…'), 'Nova msg');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(mockSend).toHaveBeenCalledWith(expect.any(String), 'Nova msg'));
  });

  it('replies to a post via the Responder flow', async () => {
    renderPage({ feature_mensagens: true });
    await screen.findByText('Podemos ajustar o CTA?');
    await userEvent.click(screen.getAllByRole('button', { name: 'Responder' })[0]);
    await userEvent.type(screen.getByPlaceholderText('Responder sobre o post…'), 'Feito');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() =>
      expect(mockSubmitApproval).toHaveBeenCalledWith(expect.any(String), 7, 'mensagem', 'Feito'),
    );
  });

  it('marks the thread seen on mount', async () => {
    renderPage({ feature_mensagens: true });
    await waitFor(() => expect(mockSeen).toHaveBeenCalledTimes(1));
  });
});
```

Note on the post chip: the feed row carries no post status, so the chip always
renders; `PostagemFocoPage` itself enforces `isClientVisible` and shows its
fallback for a post that left a client-visible status. This is a deliberate
simplification of the spec's "guard with isClientVisible" line — the guard
lives at the destination, not on the chip.

Run: `npm run test -- mensagensPage`
Expected: FAIL (page still renders SEED_MESSAGES).

- [ ] **Step 2: Rewrite `MensagensPage.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FilePen, X } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchMensagens, markMensagensSeen, sendHubMensagem, submitApproval } from '../api';
import type { MensagemFeedItem } from '../types';

const PAGE_SIZE = 50;

function itemKey(m: MensagemFeedItem) {
  return `${m.source}-${m.item_id}`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Centered event row: commentless approvals/corrections and edit suggestions. */
function isEventRow(m: MensagemFeedItem) {
  if (m.source === 'edit_suggestion') return true;
  return m.source === 'post_feedback' && m.action !== 'mensagem' && !m.content?.trim();
}

function eventLabel(m: MensagemFeedItem) {
  if (m.source === 'edit_suggestion') return 'Você sugeriu edições no texto';
  return m.action === 'aprovado' ? 'Você aprovou o post' : 'Você pediu correção';
}

export function MensagensPage() {
  const { bootstrap } = useHub();
  const { workspace, token } = useParams<{ workspace: string; token: string }>();
  const base = `/${workspace}/hub/${token}`;
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<{ post_id: number; titulo: string } | null>(null);

  const enabled = bootstrap.feature_mensagens;

  const feed = useInfiniteQuery({
    queryKey: ['hub-mensagens', token],
    queryFn: ({ pageParam }) => fetchMensagens(token!, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.items.length === PAGE_SIZE ? last.items[last.items.length - 1].created_at : undefined,
    enabled,
  });

  useEffect(() => {
    if (!enabled || !token) return;
    markMensagensSeen(token).then(() => {
      qc.invalidateQueries({ queryKey: ['hub-mensagens-count', token] });
    });
  }, [enabled, token, qc]);

  const items = useMemo(() => {
    const all = (feed.data?.pages ?? []).flatMap((p) => p.items);
    return [...all].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [feed.data]);

  const send = useMutation({
    mutationFn: async (text: string) => {
      if (replyTo) return submitApproval(token!, replyTo.post_id, 'mensagem', text);
      return sendHubMensagem(token!, text);
    },
    onSuccess: () => {
      setDraft('');
      setReplyTo(null);
      qc.invalidateQueries({ queryKey: ['hub-mensagens', token] });
    },
  });

  if (!enabled) {
    return (
      <div className="flex flex-col gap-4 hub-fade-up">
        <header>
          <h1 className="font-display text-[1.7rem] sm:text-[2.4rem] font-medium tracking-tight hub-txt">
            Mensagens
          </h1>
        </header>
        <p className="text-sm hub-tx2">
          Este recurso ainda não está disponível no seu plano. Fale com sua agência para saber mais.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 hub-fade-up">
      <header>
        <h1 className="font-display text-[1.7rem] sm:text-[2.4rem] font-medium tracking-tight hub-txt">
          Mensagens
        </h1>
        <p className="text-sm hub-tx2 mt-1">
          Toda a conversa com a equipe em um só lugar: mensagens, aprovações e sugestões.
        </p>
      </header>
      <div className="hub-card flex flex-col min-h-[480px] overflow-hidden">
        <div
          className="flex-1 overflow-y-auto p-5 flex flex-col gap-3"
          style={{ background: 'var(--hub-bg)' }}
        >
          {feed.hasNextPage && (
            <button
              onClick={() => feed.fetchNextPage()}
              disabled={feed.isFetchingNextPage}
              className="self-center text-[12px] font-semibold hub-tx3 hover:hub-txt"
            >
              {feed.isFetchingNextPage ? 'Carregando…' : 'Carregar mensagens anteriores'}
            </button>
          )}
          {feed.isLoading && <p className="text-sm hub-tx3 self-center py-8">Carregando…</p>}
          {feed.isError && (
            <p className="text-sm hub-tx3 self-center py-8">Não foi possível carregar as mensagens.</p>
          )}
          {!feed.isLoading && !feed.isError && items.length === 0 && (
            <p className="text-sm hub-tx3 self-center py-8">
              Nenhuma mensagem ainda. Envie a primeira!
            </p>
          )}
          {items.map((m) => {
            const mine = !m.is_workspace_user;
            if (isEventRow(m)) {
              return (
                <div key={itemKey(m)} className="self-center flex items-center gap-2 text-[12px] hub-tx3">
                  {m.source === 'edit_suggestion' ? <FilePen size={13} /> : <CheckCircle2 size={13} />}
                  <span>{eventLabel(m)}</span>
                  {m.post_id != null && (
                    <Link to={`${base}/postagens/${m.post_id}`} className="underline hover:hub-txt">
                      {m.post_titulo ?? 'ver post'}
                    </Link>
                  )}
                  <span>· {formatTime(m.created_at)}</span>
                </div>
              );
            }
            return (
              <div key={itemKey(m)} className={`max-w-[78%] ${mine ? 'self-end' : 'self-start'}`}>
                {!mine && (
                  <div className="text-[11px] font-semibold hub-tx3 mb-0.5">
                    {m.author_name ?? 'Equipe'}
                  </div>
                )}
                <div
                  className={`px-3.5 py-2.5 rounded-2xl text-sm ${mine ? 'hub-btn-primary' : 'hub-bg-card'}`}
                  style={mine ? undefined : { boxShadow: 'inset 0 0 0 1px var(--hub-bd)' }}
                >
                  {m.post_id != null && (
                    <Link
                      to={`${base}/postagens/${m.post_id}`}
                      className="block text-[11px] font-semibold underline opacity-80 mb-1"
                    >
                      {m.post_titulo ?? 'Post'}
                      {m.action === 'correcao' ? ' · correção' : m.action === 'aprovado' ? ' · aprovação' : ''}
                    </Link>
                  )}
                  {m.content}
                </div>
                <div
                  className={`mt-1 flex items-center gap-2 text-[11px] hub-tx3 ${mine ? 'justify-end' : ''}`}
                >
                  <span>{formatTime(m.created_at)}</span>
                  {m.post_id != null && (
                    <button
                      onClick={() => setReplyTo({ post_id: m.post_id!, titulo: m.post_titulo ?? 'Post' })}
                      className="font-semibold hover:hub-txt"
                    >
                      Responder
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="p-3.5 border-t hub-border flex flex-col gap-2">
          {replyTo && (
            <div className="flex items-center gap-2 text-[12px] hub-tx2">
              <span>
                Respondendo sobre: <strong>{replyTo.titulo}</strong>
              </span>
              <button onClick={() => setReplyTo(null)} aria-label="Cancelar resposta">
                <X size={13} />
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim() && !send.isPending) send.mutate(draft.trim());
              }}
              placeholder={replyTo ? 'Responder sobre o post…' : 'Enviar mensagem…'}
              className="flex-1 px-[18px] py-3 rounded-full border hub-border-strong text-sm outline-none"
              style={{ background: 'var(--hub-bg)', color: 'var(--hub-txt)' }}
            />
            <button
              onClick={() => draft.trim() && send.mutate(draft.trim())}
              disabled={send.isPending || !draft.trim()}
              className="px-5 py-3 rounded-full text-[13px] font-semibold hub-btn-primary disabled:opacity-50"
            >
              Enviar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run the page tests**

Run: `npm run test -- mensagensPage`
Expected: PASS. Also run `npm run test -- router` (route still resolves the named export).

- [ ] **Step 4: Commit**

```bash
git add apps/hub/src/pages/MensagensPage.tsx apps/hub/src/pages/__tests__/mensagensPage.test.tsx
git commit -m "feat(hub): pagina Mensagens com feed real, resposta por post e canal geral

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: CRM data layer + notification type + author identity

**Files:**
- Create: `apps/crm/src/store/mensagens.ts`
- Modify: `apps/crm/src/store/index.ts` (add `export * from './mensagens';`)
- Modify: `apps/crm/src/store/posts.ts:746` (`replyToPostApproval` records author)
- Modify: `apps/crm/src/hooks/useWorkspaceLimits.ts` (`FeatureFlags` + `feature_mensagens: boolean`)
- Modify: `apps/crm/src/store/notifications.ts` (`NotificationType` + `'client_message'`)
- Modify: `apps/crm/src/lib/notification-config.ts` (case for `client_message`)
- Test: `apps/crm/src/store/__tests__/mensagens.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 7–8):
  - `MensagemFeedItem` (same shape as the Hub type, exported from `store/mensagens.ts`)
  - `getMensagensFeed(params: { clienteId?: number; before?: string; limit?: number }): Promise<MensagemFeedItem[]>`
  - `getMensagensUnread(): Promise<{ cliente_id: number; unread_count: number }[]>`
  - `sendMensagem(clienteId: number, content: string): Promise<void>`
  - `markMensagensSeen(): Promise<void>`
- Consumes: `supabase`, `getUserId`, `getContaId` from `./core` (same pattern as `store/tarefas.ts`).

- [ ] **Step 1: Write the failing store test**

```ts
// apps/crm/src/store/__tests__/mensagens.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpc, mockFrom, mockGetContaId, mockGetUserId } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
  mockGetContaId: vi.fn(),
  mockGetUserId: vi.fn(),
}));

vi.mock('../core', () => ({
  supabase: { rpc: mockRpc, from: mockFrom },
  getContaId: mockGetContaId,
  getUserId: mockGetUserId,
  getCurrentProfile: vi.fn(),
  clearProfileCache: vi.fn(),
}));

import { getMensagensFeed, getMensagensUnread, sendMensagem, markMensagensSeen } from '../mensagens';

describe('store/mensagens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContaId.mockResolvedValue('ws-1');
    mockGetUserId.mockResolvedValue('user-1');
  });

  it('getMensagensFeed calls the RPC with cliente/before params', async () => {
    mockRpc.mockResolvedValue({ data: [{ source: 'mensagem', item_id: 1 }], error: null });
    const rows = await getMensagensFeed({ clienteId: 14, before: '2026-07-30T00:00:00Z' });
    expect(mockRpc).toHaveBeenCalledWith('get_mensagens_feed', {
      p_cliente_id: 14,
      p_before: '2026-07-30T00:00:00Z',
      p_limit: 50,
    });
    expect(rows).toHaveLength(1);
  });

  it('getMensagensUnread returns the per-cliente rows', async () => {
    mockRpc.mockResolvedValue({ data: [{ cliente_id: 14, unread_count: 3 }], error: null });
    const rows = await getMensagensUnread();
    expect(mockRpc).toHaveBeenCalledWith('get_mensagens_unread', {});
    expect(rows[0].unread_count).toBe(3);
  });

  it('sendMensagem inserts a workspace-authored row with author identity', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert });
    await sendMensagem(14, 'Olá!');
    expect(mockFrom).toHaveBeenCalledWith('mensagens');
    expect(insert).toHaveBeenCalledWith({
      conta_id: 'ws-1',
      cliente_id: 14,
      content: 'Olá!',
      is_workspace_user: true,
      author_user_id: 'user-1',
    });
  });

  it('markMensagensSeen calls the RPC', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await markMensagensSeen();
    expect(mockRpc).toHaveBeenCalledWith('mark_mensagens_seen', {});
  });

  it('throws on RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getMensagensFeed({})).rejects.toBeTruthy();
  });
});
```

Run: `npm run test -- store/__tests__/mensagens`
Expected: FAIL (`../mensagens` does not exist).

- [ ] **Step 2: Implement `apps/crm/src/store/mensagens.ts`**

```ts
import { supabase, getContaId, getUserId } from './core';

export interface MensagemFeedItem {
  source: 'post_feedback' | 'edit_suggestion' | 'mensagem';
  item_id: number;
  cliente_id: number;
  cliente_nome: string;
  post_id: number | null;
  workflow_id: number | null;
  post_titulo: string | null;
  action: string | null;
  content: string | null;
  is_workspace_user: boolean;
  author_user_id: string | null;
  author_name: string | null;
  author_avatar_url: string | null;
  created_at: string;
}

export interface MensagensUnreadRow {
  cliente_id: number;
  unread_count: number;
}

const FEED_PAGE_SIZE = 50;

export async function getMensagensFeed(params: {
  clienteId?: number;
  before?: string;
  limit?: number;
}): Promise<MensagemFeedItem[]> {
  const rpcParams: Record<string, unknown> = { p_limit: params.limit ?? FEED_PAGE_SIZE };
  if (params.clienteId != null) rpcParams.p_cliente_id = params.clienteId;
  if (params.before) rpcParams.p_before = params.before;
  const { data, error } = await supabase.rpc('get_mensagens_feed', rpcParams);
  if (error) throw error;
  return (data ?? []) as MensagemFeedItem[];
}

export async function getMensagensUnread(): Promise<MensagensUnreadRow[]> {
  const { data, error } = await supabase.rpc('get_mensagens_unread', {});
  if (error) throw error;
  return (data ?? []) as MensagensUnreadRow[];
}

export async function sendMensagem(clienteId: number, content: string): Promise<void> {
  const conta_id = await getContaId();
  const author_user_id = await getUserId();
  const { error } = await supabase.from('mensagens').insert({
    conta_id,
    cliente_id: clienteId,
    content,
    is_workspace_user: true,
    author_user_id,
  });
  if (error) throw error;
}

export async function markMensagensSeen(): Promise<void> {
  const { error } = await supabase.rpc('mark_mensagens_seen', {});
  if (error) throw error;
}
```

Note for the test's first assertion: `getMensagensFeed({ clienteId, before })` builds params conditionally, so the expected object in the test is exactly `{ p_cliente_id: 14, p_before: '…', p_limit: 50 }`.

- [ ] **Step 3: Wire the remaining small edits**

1. `apps/crm/src/store/index.ts`: add `export * from './mensagens';` next to the `tarefas` line.
2. `apps/crm/src/store/posts.ts` `replyToPostApproval`: import `getUserId` from `./core` (extend the existing import) and change the insert to:

```ts
export async function replyToPostApproval(
  postId: number,
  _workflowId: number,
  comentario: string,
): Promise<void> {
  const author_user_id = await getUserId();
  const { error } = await supabase.from('post_approvals').insert({
    post_id: postId,
    token: null,
    action: 'mensagem',
    comentario,
    is_workspace_user: true,
    author_user_id,
  });
  if (error) throw error;
}
```

Then grep for existing tests asserting this insert shape (`grep -rn "replyToPostApproval" apps/crm/src/__tests__ apps/crm/src/**/__tests__`) and update their expected payloads to include `author_user_id`.

3. `apps/crm/src/hooks/useWorkspaceLimits.ts`: add `feature_mensagens: boolean;` to `FeatureFlags` (the edge function already returns it via `_shared/entitlements.ts` `FEATURE_COLUMNS`).
4. `apps/crm/src/store/notifications.ts`: add `| 'client_message'` to `NotificationType`.
5. `apps/crm/src/lib/notification-config.ts`: add a case mirroring `post_message` (it uses `m.comentario`; check the exact shape of the `post_message` case in the same switch and match it):

```ts
case 'client_message':
  return {
    icon: MessageSquare,
    tone: 'teal',
    title: 'Nova mensagem do cliente',
    body: `${client}: ${s(m.comentario, '')}`,
  };
```

- [ ] **Step 4: Run tests**

Run: `npm run test -- store/__tests__/mensagens notification`
Expected: PASS, including any notification-config tests (if a test enumerates all `NotificationType`s, add the new case there).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/store apps/crm/src/hooks/useWorkspaceLimits.ts apps/crm/src/lib/notification-config.ts
git commit -m "feat(crm): store de mensagens, autor nas respostas e notificacao client_message

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: CRM routing + nav plumbing for `/mensagens`

**Files:**
- Modify: `apps/crm/src/App.tsx` (lazy import + route)
- Modify: `apps/crm/src/components/layout/nav-data.ts` (item + `NAV_FEATURE`)
- Modify: `apps/crm/src/content/site-meta.ts` (`APP_ROUTE_PREFIXES`)
- Modify: `vercel.json` (BOTH alternation regexes: line 38 header + line 70 rewrite)

**Interfaces:**
- Consumes: `MensagensPage` default export at `apps/crm/src/pages/mensagens/MensagensPage.tsx` (created in Task 7; a placeholder here keeps typecheck green — see Step 1).
- Produces: route `/mensagens` gated by `feature_mensagens`.

- [ ] **Step 1: Create a minimal placeholder page so this task typechecks independently**

```tsx
// apps/crm/src/pages/mensagens/MensagensPage.tsx  (replaced with the real page in Task 7)
export default function MensagensPage() {
  return null;
}
```

- [ ] **Step 2: Register the route in `App.tsx`**

Add with the other lazy consts: `const MensagensPage = lazy(() => import('./pages/mensagens/MensagensPage'));` and inside the protected block (next to `/tarefas`): `<Route path="/mensagens" element={<MensagensPage />} />`.

- [ ] **Step 3: Nav item + feature gate in `nav-data.ts`**

In the `crm` group, after `ideias`:

```ts
{
  id: 'mensagens',
  route: '/mensagens',
  label: 'Mensagens',
  labelKey: 'nav.mensagens',
  icon: 'ph-chat-circle-text',
},
```

And in `NAV_FEATURE`: `mensagens: 'feature_mensagens',`.
(i18n `nav.mensagens` already exists in both `packages/i18n/locales/pt/common.json` and `en/common.json` — verify, do not duplicate.)

- [ ] **Step 4: Route prefix in `site-meta.ts` and `vercel.json`**

Add `'mensagens',` to `APP_ROUTE_PREFIXES` (after `'ideias',`). In `vercel.json`, add `|mensagens` inside BOTH alternations (the `X-Robots-Tag` header source at line 38 and the `/app.html` rewrite source at line 70) — keep the two regexes byte-identical, e.g. `…|ideias|mensagens|ajuda|importar…`.

- [ ] **Step 5: Run the guard test**

Run: `npm run test -- vercel-routing nav`
Expected: PASS (`vercel-routing.test.ts` asserts every prefix appears in the rewrite + noindex header; nav-data tests, if any assert item counts, updated accordingly).

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/App.tsx apps/crm/src/components/layout/nav-data.ts apps/crm/src/content/site-meta.ts apps/crm/src/pages/mensagens vercel.json
git commit -m "feat(crm): rota /mensagens com gate feature_mensagens e rewrites no vercel.json

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: CRM MensagensPage (feed, filters, reply, composer)

**Files:**
- Replace: `apps/crm/src/pages/mensagens/MensagensPage.tsx`
- Create: `apps/crm/src/pages/mensagens/mensagensLogic.ts`
- Create: `apps/crm/src/pages/mensagens/hooks/useMensagensData.ts`
- Create: `apps/crm/src/pages/mensagens/components/MensagemFeedCard.tsx`
- Test: `apps/crm/src/pages/mensagens/__tests__/mensagensLogic.test.ts`
- Test: `apps/crm/src/pages/mensagens/__tests__/MensagensPage.test.tsx`

**Interfaces:**
- Consumes: `getMensagensFeed`, `getMensagensUnread`, `sendMensagem`, `markMensagensSeen`, `replyToPostApproval`, `getClientes`, types `MensagemFeedItem`, `MensagensUnreadRow` from `@/store`; `useEntitlements` (route guard); `toast` from `sonner`.
- Produces: page behavior — newest-first feed across all clients; client `<select>` filter + type filter chips; post-anchored items deep-link to `/entregas?drawer=<workflow_id>`; per-item inline reply for post-anchored items via `replyToPostApproval`; general composer enabled only when a client is selected; mount marks seen and invalidates `['mensagens-unread']`.

- [ ] **Step 1: Write the failing logic tests**

```ts
// apps/crm/src/pages/mensagens/__tests__/mensagensLogic.test.ts
import { describe, it, expect } from 'vitest';
import { feedItemKey, matchesTipo, unreadTotal, TIPO_FILTERS } from '../mensagensLogic';
import type { MensagemFeedItem } from '@/store';

const base: MensagemFeedItem = {
  source: 'mensagem', item_id: 1, cliente_id: 14, cliente_nome: 'ACME',
  post_id: null, workflow_id: null, post_titulo: null, action: null,
  content: 'oi', is_workspace_user: false,
  author_user_id: null, author_name: null, author_avatar_url: null,
  created_at: '2026-07-30T10:00:00Z',
};

describe('mensagensLogic', () => {
  it('feedItemKey is unique across sources', () => {
    expect(feedItemKey(base)).toBe('mensagem-1');
    expect(feedItemKey({ ...base, source: 'post_feedback' })).toBe('post_feedback-1');
  });

  it('matchesTipo routes each source/action to the right filter', () => {
    const postMsg = { ...base, source: 'post_feedback' as const, action: 'mensagem' };
    const aprovacao = { ...base, source: 'post_feedback' as const, action: 'aprovado' };
    const sugestao = { ...base, source: 'edit_suggestion' as const };
    expect(matchesTipo(base, 'mensagens')).toBe(true);
    expect(matchesTipo(postMsg, 'mensagens')).toBe(true);
    expect(matchesTipo(aprovacao, 'mensagens')).toBe(false);
    expect(matchesTipo(aprovacao, 'aprovacoes')).toBe(true);
    expect(matchesTipo(sugestao, 'sugestoes')).toBe(true);
    for (const f of TIPO_FILTERS) expect(matchesTipo(base, 'todas')).toBe(true);
  });

  it('unreadTotal sums per-cliente rows', () => {
    expect(unreadTotal([{ cliente_id: 1, unread_count: 2 }, { cliente_id: 2, unread_count: 3 }])).toBe(5);
    expect(unreadTotal([])).toBe(0);
  });
});
```

Run: `npm run test -- mensagensLogic`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement `mensagensLogic.ts`**

```ts
import type { MensagemFeedItem, MensagensUnreadRow } from '@/store';

export type MensagensTipoFilter = 'todas' | 'mensagens' | 'aprovacoes' | 'sugestoes';

export const TIPO_FILTERS: { id: MensagensTipoFilter; label: string }[] = [
  { id: 'todas', label: 'Todas' },
  { id: 'mensagens', label: 'Mensagens' },
  { id: 'aprovacoes', label: 'Aprovações' },
  { id: 'sugestoes', label: 'Sugestões' },
];

export function feedItemKey(i: MensagemFeedItem): string {
  return `${i.source}-${i.item_id}`;
}

export function matchesTipo(i: MensagemFeedItem, tipo: MensagensTipoFilter): boolean {
  switch (tipo) {
    case 'todas':
      return true;
    case 'mensagens':
      return i.source === 'mensagem' || (i.source === 'post_feedback' && i.action === 'mensagem');
    case 'aprovacoes':
      return i.source === 'post_feedback' && (i.action === 'aprovado' || i.action === 'correcao');
    case 'sugestoes':
      return i.source === 'edit_suggestion';
  }
}

export function unreadTotal(rows: MensagensUnreadRow[]): number {
  return rows.reduce((sum, r) => sum + r.unread_count, 0);
}
```

- [ ] **Step 3: Run logic tests**

Run: `npm run test -- mensagensLogic`
Expected: PASS.

- [ ] **Step 4: Implement the data hook**

```ts
// apps/crm/src/pages/mensagens/hooks/useMensagensData.ts
import { useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMensagensFeed,
  getMensagensUnread,
  sendMensagem,
  markMensagensSeen,
  replyToPostApproval,
  getClientes,
} from '@/store';

const PAGE_SIZE = 50;

export function useMensagensData(clienteId: number | null) {
  const qc = useQueryClient();

  const feed = useInfiniteQuery({
    queryKey: ['mensagens-feed', clienteId],
    queryFn: ({ pageParam }) =>
      getMensagensFeed({ clienteId: clienteId ?? undefined, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.length === PAGE_SIZE ? last[last.length - 1].created_at : undefined,
  });

  const unread = useQuery({ queryKey: ['mensagens-unread'], queryFn: getMensagensUnread });
  const clientes = useQuery({ queryKey: ['clientes'], queryFn: getClientes });

  // Opening the page marks the whole feed seen for this user.
  useEffect(() => {
    markMensagensSeen().then(() => {
      qc.invalidateQueries({ queryKey: ['mensagens-unread'] });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const invalidateFeed = () => {
    qc.invalidateQueries({ queryKey: ['mensagens-feed'] });
  };

  const sendGeneral = useMutation({
    mutationFn: ({ cliente, content }: { cliente: number; content: string }) =>
      sendMensagem(cliente, content),
    onSuccess: invalidateFeed,
  });

  const replyToPost = useMutation({
    mutationFn: ({ postId, workflowId, content }: { postId: number; workflowId: number; content: string }) =>
      replyToPostApproval(postId, workflowId, content),
    onSuccess: invalidateFeed,
  });

  return { feed, unread, clientes, sendGeneral, replyToPost };
}
```

(Confirm the `getClientes` export name/signature in `apps/crm/src/store/clients.ts` before wiring — it is paged internally and takes no required args.)

- [ ] **Step 5: Implement the feed card component**

```tsx
// apps/crm/src/pages/mensagens/components/MensagemFeedCard.tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, FilePen, MessageCircle, Send } from 'lucide-react';
import type { MensagemFeedItem } from '@/store';

interface Props {
  item: MensagemFeedItem;
  onReply: (postId: number, workflowId: number, content: string) => Promise<unknown>;
}

const ACTION_LABEL: Record<string, string> = {
  aprovado: 'Aprovou o post',
  correcao: 'Pediu correção',
  mensagem: 'Mensagem',
  pending: 'Sugestão de edição enviada',
  accepted: 'Sugestão de edição aceita',
  rejected: 'Sugestão de edição rejeitada',
};

export function MensagemFeedCard({ item, onReply }: Props) {
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const isAgency = item.is_workspace_user;
  const author = isAgency ? (item.author_name ?? 'Equipe') : item.cliente_nome;
  const headline =
    item.source === 'edit_suggestion'
      ? (ACTION_LABEL[item.action ?? 'pending'] ?? 'Sugestão de edição')
      : item.source === 'post_feedback' && item.action !== 'mensagem'
        ? (ACTION_LABEL[item.action ?? ''] ?? item.action)
        : null;

  async function submitReply() {
    if (!draft.trim() || item.post_id == null || item.workflow_id == null) return;
    setSending(true);
    try {
      await onReply(item.post_id, item.workflow_id, draft.trim());
      setDraft('');
      setReplying(false);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm">
        {item.source === 'edit_suggestion' ? (
          <FilePen size={15} className="shrink-0" />
        ) : item.action === 'aprovado' ? (
          <CheckCircle2 size={15} className="shrink-0" />
        ) : (
          <MessageCircle size={15} className="shrink-0" />
        )}
        <span className="font-semibold">{author}</span>
        <span className="text-[var(--text-light)]">· {item.cliente_nome}</span>
        <span className="ml-auto text-xs text-[var(--text-light)]">
          {new Date(item.created_at).toLocaleString('pt-BR', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
      {headline && <div className="text-xs font-semibold text-[var(--text-muted)]">{headline}</div>}
      {item.content && <p className="text-sm whitespace-pre-wrap">{item.content}</p>}
      <div className="flex items-center gap-3 text-xs">
        {item.workflow_id != null && (
          <Link
            to={`/entregas?drawer=${item.workflow_id}`}
            className="font-semibold underline text-[var(--text-muted)] hover:text-[var(--text-main)]"
          >
            {item.post_titulo ?? 'Ver post'}
          </Link>
        )}
        {item.post_id != null && item.source !== 'edit_suggestion' && (
          <button
            onClick={() => setReplying((v) => !v)}
            className="font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
          >
            Responder
          </button>
        )}
      </div>
      {replying && (
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitReply();
            }}
            placeholder="Responder ao cliente…"
            className="flex-1 rounded-md border border-[var(--border-color)] bg-transparent px-3 py-2 text-sm outline-none"
            autoFocus
          />
          <button
            onClick={submitReply}
            disabled={sending || !draft.trim()}
            aria-label="Enviar resposta"
            className="rounded-md px-3 py-2 text-sm font-semibold bg-[var(--primary-color)] disabled:opacity-50"
          >
            <Send size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Implement the page**

```tsx
// apps/crm/src/pages/mensagens/MensagensPage.tsx
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import { useMensagensData } from './hooks/useMensagensData';
import { MensagemFeedCard } from './components/MensagemFeedCard';
import { feedItemKey, matchesTipo, TIPO_FILTERS, type MensagensTipoFilter } from './mensagensLogic';

export default function MensagensPage() {
  const [clienteId, setClienteId] = useState<number | null>(null);
  const [tipo, setTipo] = useState<MensagensTipoFilter>('todas');
  const [draft, setDraft] = useState('');
  const { feed, unread, clientes, sendGeneral, replyToPost } = useMensagensData(clienteId);

  const items = useMemo(
    () => (feed.data?.pages ?? []).flat().filter((i) => matchesTipo(i, tipo)),
    [feed.data, tipo],
  );

  // Per-client unread map for the filter labels (spec: filter shows per-client unread).
  const unreadByCliente = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of unread.data ?? []) map.set(r.cliente_id, r.unread_count);
    return map;
  }, [unread.data]);

  async function submitGeneral() {
    if (!draft.trim() || clienteId == null) return;
    try {
      await sendGeneral.mutateAsync({ cliente: clienteId, content: draft.trim() });
      setDraft('');
    } catch {
      toast.error('Não foi possível enviar a mensagem.');
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <header>
        <h1 className="text-2xl font-semibold">Mensagens</h1>
        <p className="text-sm text-[var(--text-muted)]">
          Toda a comunicação com os clientes em um só lugar. Cada item leva ao post de origem.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={clienteId ?? ''}
          onChange={(e) => setClienteId(e.target.value ? Number(e.target.value) : null)}
          aria-label="Filtrar por cliente"
          className="rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2 text-sm"
        >
          <option value="">Todos os clientes</option>
          {(clientes.data ?? []).map((c) => {
            const n = unreadByCliente.get(c.id) ?? 0;
            return (
              <option key={c.id} value={c.id}>
                {n > 0 ? `${c.nome} (${n})` : c.nome}
              </option>
            );
          })}
        </select>
        <div className="flex gap-1">
          {TIPO_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setTipo(f.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold border ${
                tipo === f.id
                  ? 'bg-[var(--primary-color)] border-transparent'
                  : 'border-[var(--border-color)] text-[var(--text-muted)]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {clienteId != null && (
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitGeneral();
            }}
            placeholder="Enviar mensagem geral para este cliente…"
            className="flex-1 rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2 text-sm outline-none"
          />
          <button
            onClick={submitGeneral}
            disabled={sendGeneral.isPending || !draft.trim()}
            aria-label="Enviar mensagem"
            className="rounded-md px-4 py-2 text-sm font-semibold bg-[var(--primary-color)] disabled:opacity-50"
          >
            <Send size={15} />
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {feed.isLoading && <p className="text-sm text-[var(--text-muted)] py-8 text-center">Carregando…</p>}
        {feed.isError && (
          <p className="text-sm text-[var(--text-muted)] py-8 text-center">
            Não foi possível carregar as mensagens.
          </p>
        )}
        {!feed.isLoading && !feed.isError && items.length === 0 && (
          <p className="text-sm text-[var(--text-muted)] py-8 text-center">
            Nenhuma mensagem por aqui ainda.
          </p>
        )}
        {items.map((item) => (
          <MensagemFeedCard
            key={feedItemKey(item)}
            item={item}
            onReply={(postId, workflowId, content) =>
              replyToPost
                .mutateAsync({ postId, workflowId, content })
                .catch(() => toast.error('Não foi possível enviar a resposta.'))
            }
          />
        ))}
        {feed.hasNextPage && (
          <button
            onClick={() => feed.fetchNextPage()}
            disabled={feed.isFetchingNextPage}
            className="self-center text-sm font-semibold text-[var(--text-muted)] py-2"
          >
            {feed.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Write the page test**

```tsx
// apps/crm/src/pages/mensagens/__tests__/MensagensPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { mockFeed, mockUnread, mockClientes, mockSend, mockReply, mockSeen } = vi.hoisted(() => ({
  mockFeed: vi.fn(),
  mockUnread: vi.fn(),
  mockClientes: vi.fn(),
  mockSend: vi.fn().mockResolvedValue(undefined),
  mockReply: vi.fn().mockResolvedValue(undefined),
  mockSeen: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/store', () => ({
  getMensagensFeed: mockFeed,
  getMensagensUnread: mockUnread,
  getClientes: mockClientes,
  sendMensagem: mockSend,
  replyToPostApproval: mockReply,
  markMensagensSeen: mockSeen,
}));

import MensagensPage from '../MensagensPage';

const ITEMS = [
  {
    source: 'post_feedback', item_id: 1, cliente_id: 14, cliente_nome: 'ACME',
    post_id: 7, workflow_id: 3, post_titulo: 'Post de julho', action: 'correcao',
    content: 'Trocar a foto', is_workspace_user: false,
    author_user_id: null, author_name: null, author_avatar_url: null,
    created_at: '2026-07-30T10:00:00.000Z',
  },
  {
    source: 'mensagem', item_id: 2, cliente_id: 14, cliente_nome: 'ACME',
    post_id: null, workflow_id: null, post_titulo: null, action: null,
    content: 'Obrigado!', is_workspace_user: false,
    author_user_id: null, author_name: null, author_avatar_url: null,
    created_at: '2026-07-30T12:00:00.000Z',
  },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/mensagens']}>
        <MensagensPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MensagensPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFeed.mockResolvedValue(ITEMS);
    mockUnread.mockResolvedValue([]);
    mockClientes.mockResolvedValue([{ id: 14, nome: 'ACME' }]);
  });

  it('renders feed items with the post deep link', async () => {
    renderPage();
    expect(await screen.findByText('Trocar a foto')).toBeInTheDocument();
    expect(screen.getByText('Obrigado!')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Post de julho' })).toHaveAttribute(
      'href',
      '/entregas?drawer=3',
    );
  });

  it('shows the general composer only after selecting a client, then sends', async () => {
    renderPage();
    await screen.findByText('Obrigado!');
    expect(screen.queryByPlaceholderText(/mensagem geral/)).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por cliente'), '14');
    const input = await screen.findByPlaceholderText(/mensagem geral/);
    await userEvent.type(input, 'Olá{Enter}');
    await waitFor(() => expect(mockSend).toHaveBeenCalledWith(14, 'Olá'));
  });

  it('replies inline to a post item', async () => {
    renderPage();
    await screen.findByText('Trocar a foto');
    await userEvent.click(screen.getByRole('button', { name: 'Responder' }));
    await userEvent.type(screen.getByPlaceholderText('Responder ao cliente…'), 'Feito{Enter}');
    await waitFor(() => expect(mockReply).toHaveBeenCalledWith(7, 3, 'Feito'));
  });

  it('marks the feed seen on mount', async () => {
    renderPage();
    await waitFor(() => expect(mockSeen).toHaveBeenCalledTimes(1));
  });
});
```

If other store exports are needed by transitive imports, extend the `vi.mock('@/store', …)` factory rather than importing the real module.

Run: `npm run test -- pages/mensagens`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/crm/src/pages/mensagens
git commit -m "feat(crm): pagina Mensagens - feed consolidado com filtros, resposta e canal geral

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: CRM nav unread badge

**Files:**
- Create: `apps/crm/src/hooks/useMensagensUnread.ts`
- Modify: `apps/crm/src/components/layout/Sidebar.tsx` (renderGroup item row)
- Modify: `apps/crm/src/components/layout/MobileNav.tsx` (same treatment on its item rows)
- Modify: `apps/crm/style.css` (`.nav-badge--count` style)

**Interfaces:**
- Consumes: `getMensagensUnread` from `@/store`, `unreadTotal` from `@/pages/mensagens/mensagensLogic`, `useWorkspaceLimits` (gate).
- Produces: `useMensagensUnread(): number` — total unread, polled every 60s, `0` while the flag is off.

- [ ] **Step 1: Implement the hook**

```ts
// apps/crm/src/hooks/useMensagensUnread.ts
import { useQuery } from '@tanstack/react-query';
import { getMensagensUnread } from '@/store';
import { unreadTotal } from '@/pages/mensagens/mensagensLogic';
import { useWorkspaceLimits } from './useWorkspaceLimits';

/** Total client-authored items newer than this user's read marker. Polled for
 * the sidebar badge; disabled while feature_mensagens is off or unknown. */
export function useMensagensUnread(): number {
  const { features } = useWorkspaceLimits();
  const enabled = features?.feature_mensagens === true;
  const { data } = useQuery({
    queryKey: ['mensagens-unread'],
    queryFn: getMensagensUnread,
    enabled,
    refetchInterval: 60_000,
  });
  return enabled && data ? unreadTotal(data) : 0;
}
```

- [ ] **Step 2: Render the pill in `Sidebar.tsx`**

Call `const mensagensUnread = useMensagensUnread();` at the top of the component. In `renderGroup`'s non-disabled, non-newTab branch (the plain `<a>` item), after the `<span>{t(item.labelKey, item.label)}</span>`:

```tsx
{item.id === 'mensagens' && mensagensUnread > 0 && (
  <span className="nav-badge nav-badge--count" data-testid="mensagens-nav-badge">
    {mensagensUnread > 99 ? '99+' : mensagensUnread}
  </span>
)}
```

`renderGroup` is defined inside the component body, so the variable is in scope. Apply the same snippet to the equivalent item row in `MobileNav.tsx` (find the nav item map that renders `nav-badge` for disabled items and mirror the placement).

- [ ] **Step 3: Add the pill style to `style.css`**

Next to the existing `.nav-badge` rule (search `nav-badge` in `apps/crm/style.css`):

```css
.nav-badge--count {
  background: var(--primary-color);
  color: #12151a;
  font-size: 10px;
  font-weight: 700;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
```

- [ ] **Step 4: Run layout tests + typecheck**

Run: `npm run test -- Sidebar MobileNav && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS / no errors (existing Sidebar tests may need the store mock extended with `getMensagensUnread`; the query is disabled when features are null in fixtures, so most pass untouched).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/hooks/useMensagensUnread.ts apps/crm/src/components/layout apps/crm/style.css
git commit -m "feat(crm): badge de mensagens nao lidas na sidebar e nav mobile

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Full verification + staging E2E

**Files:** none (verification only; fix regressions as found).

- [ ] **Step 1: Full local gates (same four typechecks CI runs)**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p tsconfig.scripts.json
```

```bash
npm run test
```

```bash
npm run test:functions && git checkout -- deno.lock
```

```bash
npm run lint && npm run format:check
```

Expected: all pass. Run `npm run format` first if format:check fails.

- [ ] **Step 2: Deploy to STAGING** (verify link first: `cat supabase/.temp/project-ref` must be `wlyzhyfondykzpsiqsce`; re-link if it shows prod)

```bash
npx supabase db push --linked
npx supabase functions deploy hub-mensagens --no-verify-jwt --use-api
```

Enable the flag on the staging test workspace's plan (SQL editor or psql): `UPDATE plans SET feature_mensagens = true WHERE id = (SELECT plan_id FROM workspaces WHERE id = '<staging test workspace uuid>');`

- [ ] **Step 3: Browser E2E on staging** (per `<verification_workflow>`; CRM `npm run dev:staging`, Hub `npm run dev:hub:staging` — hub must run on an ALLOWED_ORIGINS port, 5174)

1. Hub: Mensagens nav item visible; page loads real history (old approval comments appear without backfill).
2. Hub: send a correction comment on a post in Aprovações → CRM `/mensagens` shows it with the post chip; chip opens `/entregas?drawer=…`.
3. CRM: nav badge shows unread; opening `/mensagens` clears it; inline reply on the post item → appears in Hub Mensagens with the member's name.
4. General channel: CRM select client + send; Hub sees it (badge increments, then clears on open); Hub replies via composer; CRM bell shows "Nova mensagem do cliente".
5. Hub "Responder" on a post item sends a post-anchored message (verify it lands in the CRM drawer thread too).
6. Check `read_console_messages` and network for errors on both apps; screenshot both Mensagens pages as proof.

- [ ] **Step 4: Commit any fixes, then final gates again if anything changed**

---

## Deployment notes (post-merge, production)

1. `npx supabase db push --linked` against PROD (re-link; verify `supabase/.temp/project-ref` = `skjzpekeqefvlojenfsw`); confirm migration `20260731000003` applied (DDL vs history — check both).
2. `npx supabase functions deploy hub-mensagens --no-verify-jwt --use-api`.
3. Vercel deploys CRM + Hub via merge.
4. Feature stays dark; flipping `feature_mensagens` per plan is a separate pricing decision (admin panel already edits the flag).
