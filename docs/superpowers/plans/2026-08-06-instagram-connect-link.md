# Link de conexão do Instagram para o cliente final — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agency generate a shareable link so their client can authorize Instagram themselves, without a Mesaas login, when the agency has no access to the client's Instagram credentials.

**Architecture:** A new `instagram_connect_links` row holds a uuid token scoped to one `cliente_id`. A new edge function `instagram-connect-link` owns the public (unauthenticated) surface and the agency-side CRUD; the existing `instagram-integration` OAuth callback gains a branch that recognises a link-originated flow via the HMAC-signed `state`, gates the write behind an atomic conditional UPDATE on the link row, and redirects to a public page instead of the CRM client page.

**Tech Stack:** Deno edge functions (Supabase), Postgres with RLS, React 19 + TypeScript + Vite (CRM app), shadcn/ui, TanStack Query, i18next, Resend. Tests: `deno test` for functions, Vitest for frontend.

**Spec:** `docs/superpowers/specs/2026-08-06-instagram-connect-link-design.md`

## Global Constraints

- **No em-dashes (`—`) in any user-visible copy**, UI or email. Use a period, a colon, or `·`.
- All UI copy is **Portuguese**; add `pt` and `en` keys to `packages/i18n/locales/*/clients.json`.
- **CORS** always via `buildCorsHeaders(req)` from `_shared/cors.ts`. Never wildcard `*`.
- Edge functions **never return raw error detail** to the client. Generic message out, detail to `console.error`.
- Every JWT route **verifies workspace ownership** (`conta_id`) before returning or mutating data.
- **Public link and emails use `appBaseUrl()` (`APP_BASE_URL`)**. `OAUTH_REDIRECT_BASE` is only for the OAuth callback redirect. Never interchange them.
- `created_by` is an **`auth.users.id` uuid**, never `membros.id` (which is `bigserial`).
- Migration filename prefix must be **unique**; re-verify with `git ls-tree origin/main supabase/migrations | tail` immediately before opening the PR.
- Run before pushing: `npm run lint`, `npm run format:check`, the four `tsc` commands, `npm run test`, `npm run test:functions`.
- `npm run test:functions` dirties the root `deno.lock`. Always `git checkout -- deno.lock` afterwards.

---

### Task 1: Migration — table, unique-live index, RPC, notification type

**Files:**
- Create: `supabase/migrations/20260806000002_instagram_connect_links.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: table `instagram_connect_links`; RPC `create_instagram_connect_link(p_cliente_id bigint, p_conta_id uuid, p_created_by uuid, p_ttl_days int) RETURNS TABLE (token uuid, expires_at timestamptz)`; notification type `'instagram_connected_by_client'`.

- [ ] **Step 1: Re-count the notification type list before writing anything**

The spec says 18. Verify, do not trust it:

```bash
sed -n '104,118p' supabase/migrations/20260805000002_post_status_automations.sql | grep -o "'[a-z_]*'" | wc -l
```

Expected: `18`. If it prints anything else, the latest definition moved. Find the real latest with `grep -rn "notifications_type_check" supabase/migrations/*.sql | tail -3` and copy that list instead. Copying a stale list silently breaks inserts of the newer types.

- [ ] **Step 2: Confirm the migration version prefix is free**

```bash
git ls-tree --name-only origin/main supabase/migrations/ | tail -3
```

Expected: nothing named `20260806000002_*`. `20260806000001_atomic_rate_limit.sql` already exists, which is why this is `...0002`. If `...0002` is taken, bump to the next free number and use it consistently below.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260806000002_instagram_connect_links.sql`:

```sql
-- Link de conexão do Instagram enviado pela agência ao cliente final.
-- O cliente abre o link sem login no Mesaas e autoriza o próprio Instagram.

CREATE TABLE IF NOT EXISTS instagram_connect_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id  bigint NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  conta_id    uuid NOT NULL,
  -- auth.users.id de quem gerou. Sem FK de propósito: notifications.user_id tem
  -- ON DELETE CASCADE, e remover um membro não pode apagar links pendentes de clientes.
  created_by  uuid NOT NULL,
  token       uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  -- "última tentativa que passou o portão do callback", não "última conexão bem-sucedida":
  -- o portão precisa marcar antes da escrita em instagram_accounts para ser atômico.
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Um único link não revogado por cliente.
-- O predicado NÃO pode incluir expires_at > now(): predicado de índice parcial exige
-- funções IMMUTABLE e now() é STABLE, então a criação falharia. A metade "não expirado"
-- da liveness é avaliada em tempo de leitura por connectLinkLive().
CREATE UNIQUE INDEX IF NOT EXISTS instagram_connect_links_one_live
  ON instagram_connect_links (cliente_id) WHERE revoked_at IS NULL;

ALTER TABLE instagram_connect_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "instagram_connect_links_workspace_all" ON instagram_connect_links
  FOR ALL USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY "instagram_connect_links_service_role" ON instagram_connect_links
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Revogar-e-inserir em uma transação. Corpo de função é transação, então dois
-- POST simultâneos serializam: um vence, o outro colide no índice único e o
-- handler relê o link vivo.
CREATE OR REPLACE FUNCTION create_instagram_connect_link(
  p_cliente_id bigint,
  p_conta_id   uuid,
  p_created_by uuid,
  p_ttl_days   int DEFAULT 30
)
RETURNS TABLE (token uuid, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Defesa em profundidade: o handler já checa, mas a RPC não confia nele.
  IF NOT EXISTS (
    SELECT 1 FROM clientes c WHERE c.id = p_cliente_id AND c.conta_id = p_conta_id
  ) THEN
    RAISE EXCEPTION 'client % does not belong to workspace %', p_cliente_id, p_conta_id;
  END IF;

  UPDATE instagram_connect_links l
     SET revoked_at = now()
   WHERE l.cliente_id = p_cliente_id AND l.revoked_at IS NULL;

  RETURN QUERY
  INSERT INTO instagram_connect_links AS icl (cliente_id, conta_id, created_by, expires_at)
  VALUES (p_cliente_id, p_conta_id, p_created_by, now() + make_interval(days => p_ttl_days))
  RETURNING icl.token, icl.expires_at;
END;
$$;

-- REVOKE FROM PUBLIC também tira o service_role: re-conceder explicitamente.
REVOKE ALL ON FUNCTION create_instagram_connect_link(bigint, uuid, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_instagram_connect_link(bigint, uuid, uuid, int) TO service_role;

-- ---------- notifications_type_check ---------------------------------
-- Lista copiada da definição MAIS RECENTE (20260805000002_post_status_automations.sql,
-- 18 valores). Este arquivo passa a ser a definição mais recente: a próxima migration
-- que tocar notifications_type_check deve copiar daqui, e não de um arquivo antigo.
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
    'instagram_connected_by_client'
  )
);
```

- [ ] **Step 4: Verify the migration applies against a local database**

```bash
colima start && npx supabase start
```

Then:

```bash
npx supabase db reset
```

Expected: completes without error. The failure this step exists to catch is `functions in index predicate must be marked IMMUTABLE`, which is what an `expires_at > now()` predicate would produce.

- [ ] **Step 5: Verify the one-live-link index actually bites**

```bash
npx supabase db query "insert into clientes (nome, conta_id) values ('t', gen_random_uuid()) returning id;"
```

Take the returned id as `<CID>` and run twice:

```bash
npx supabase db query "insert into instagram_connect_links (cliente_id, conta_id, created_by, expires_at) select id, conta_id, gen_random_uuid(), now() + interval '30 days' from clientes where id = <CID>;"
```

Expected: first succeeds, second fails with `duplicate key value violates unique constraint "instagram_connect_links_one_live"`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260806000002_instagram_connect_links.sql
git commit -m "feat(instagram): tabela e RPC do link de conexão do cliente"
```

---

### Task 2: Pure helpers in `_shared/instagram-connect-link.ts`

**Files:**
- Create: `supabase/functions/_shared/instagram-connect-link.ts`
- Create: `supabase/functions/__tests__/instagram-connect-link_test.ts`

**Interfaces:**
- Consumes: nothing (pure module, no imports beyond types).
- Produces:
  - `interface ConnectLinkRow { token: string; cliente_id: number; conta_id: string; created_by: string; expires_at: string; revoked_at: string | null; used_at: string | null }`
  - `type ConnectLinkStatus = 'live' | 'revoked' | 'expired'`
  - `connectLinkStatus(row: Pick<ConnectLinkRow, 'expires_at' | 'revoked_at'>, nowIso: string): ConnectLinkStatus`
  - `connectLinkLive(row: Pick<ConnectLinkRow, 'expires_at' | 'revoked_at'>, nowIso: string): boolean`
  - `buildConnectUrl(baseUrl: string, token: string): string`
  - `isValidEmail(value: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/instagram-connect-link_test.ts`:

```ts
import { assertEquals } from "./assert.ts";
import {
  buildConnectUrl,
  connectLinkLive,
  connectLinkStatus,
  isValidEmail,
} from "../_shared/instagram-connect-link.ts";

const NOW = "2026-08-06T12:00:00.000Z";
const FUTURE = "2026-09-05T12:00:00.000Z";
const PAST = "2026-08-01T12:00:00.000Z";

Deno.test("connectLinkStatus: live when not revoked and not expired", () => {
  assertEquals(connectLinkStatus({ expires_at: FUTURE, revoked_at: null }, NOW), "live");
});

Deno.test("connectLinkStatus: revoked wins over expiry", () => {
  assertEquals(connectLinkStatus({ expires_at: FUTURE, revoked_at: PAST }, NOW), "revoked");
  assertEquals(connectLinkStatus({ expires_at: PAST, revoked_at: PAST }, NOW), "revoked");
});

Deno.test("connectLinkStatus: expired when past expires_at", () => {
  assertEquals(connectLinkStatus({ expires_at: PAST, revoked_at: null }, NOW), "expired");
});

Deno.test("connectLinkStatus: expiry boundary is exclusive", () => {
  // expires_at == now is already expired: the SQL gate uses `expires_at > now()`,
  // and the two must not disagree about the boundary.
  assertEquals(connectLinkStatus({ expires_at: NOW, revoked_at: null }, NOW), "expired");
});

Deno.test("connectLinkLive: true only for live", () => {
  assertEquals(connectLinkLive({ expires_at: FUTURE, revoked_at: null }, NOW), true);
  assertEquals(connectLinkLive({ expires_at: PAST, revoked_at: null }, NOW), false);
  assertEquals(connectLinkLive({ expires_at: FUTURE, revoked_at: PAST }, NOW), false);
});

Deno.test("buildConnectUrl: joins without double slash", () => {
  assertEquals(buildConnectUrl("https://app.mesaas.com.br", "abc"), "https://app.mesaas.com.br/conectar/abc");
  assertEquals(buildConnectUrl("https://app.mesaas.com.br/", "abc"), "https://app.mesaas.com.br/conectar/abc");
  assertEquals(buildConnectUrl("https://app.mesaas.com.br///", "abc"), "https://app.mesaas.com.br/conectar/abc");
});

Deno.test("isValidEmail: accepts ordinary addresses, rejects junk", () => {
  assertEquals(isValidEmail("cliente@exemplo.com.br"), true);
  assertEquals(isValidEmail("a+tag@b.co"), true);
  assertEquals(isValidEmail("sem-arroba.com"), false);
  assertEquals(isValidEmail("dois@@b.com"), false);
  assertEquals(isValidEmail("espaco @b.com"), false);
  assertEquals(isValidEmail(""), false);
  assertEquals(isValidEmail("a@b"), false);
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm run test:functions -- --filter "connectLinkStatus"
```

Expected: FAIL, module `../_shared/instagram-connect-link.ts` not found.

Note: `--filter` matches **test names**, not filenames.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/instagram-connect-link.ts`:

```ts
/**
 * Link de conexão do Instagram enviado ao cliente final.
 *
 * Só funções puras aqui: sem rede, sem banco, sem Deno.env. Isso é o que torna o
 * portão de liveness testável sem subir nada.
 */

export interface ConnectLinkRow {
  token: string;
  cliente_id: number;
  conta_id: string;
  created_by: string;
  expires_at: string;
  revoked_at: string | null;
  used_at: string | null;
}

export type ConnectLinkStatus = "live" | "revoked" | "expired";

/**
 * "Vivo" tem duas metades, enforçadas em lugares diferentes:
 *  - revoked_at IS NULL: persistido, garantido pelo índice único parcial
 *  - expires_at > now(): avaliado aqui, porque predicado de índice exige IMMUTABLE
 *
 * O limite de expiração é EXCLUSIVO (expires_at == now já é expirado) para casar
 * exatamente com o `.gt('expires_at', now)` do portão SQL no callback.
 */
export function connectLinkStatus(
  row: Pick<ConnectLinkRow, "expires_at" | "revoked_at">,
  nowIso: string,
): ConnectLinkStatus {
  if (row.revoked_at !== null && row.revoked_at !== undefined) return "revoked";
  if (Date.parse(row.expires_at) <= Date.parse(nowIso)) return "expired";
  return "live";
}

export function connectLinkLive(
  row: Pick<ConnectLinkRow, "expires_at" | "revoked_at">,
  nowIso: string,
): boolean {
  return connectLinkStatus(row, nowIso) === "live";
}

/** Base pública do app (APP_BASE_URL) + /conectar/<token>. Nunca OAUTH_REDIRECT_BASE. */
export function buildConnectUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/conectar/${token}`;
}

/**
 * Validação deliberadamente conservadora. O objetivo não é aceitar todo endereço
 * válido por RFC, é impedir que POST /email vire relay para lixo arbitrário.
 */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
npm run test:functions -- --filter "connectLink"
```

Expected: all PASS.

- [ ] **Step 5: Restore deno.lock and commit**

```bash
git checkout -- deno.lock
git add supabase/functions/_shared/instagram-connect-link.ts supabase/functions/__tests__/instagram-connect-link_test.ts
git commit -m "feat(instagram): helpers puros do link de conexão"
```

---

### Task 3: The two emails

**Files:**
- Modify: `supabase/functions/_shared/lifecycle-emails.ts` (export `layout` and `sendViaResend`, add `replyTo`)
- Create: `supabase/functions/_shared/instagram-connect-email.ts`
- Create: `supabase/functions/__tests__/instagram-connect-email_test.ts`

**Interfaces:**
- Consumes: `layout`, `sendViaResend`, `LIFECYCLE_FROM` from `lifecycle-emails.ts`; `escapeHtml` from `report-template/escape.ts`.
- Produces:
  - `CONNECT_LINK_SUBJECT: (agencyName: string) => string`
  - `CONNECTED_NOTICE_SUBJECT: string`
  - `buildConnectLinkEmail(p: { agencyName: string; clienteName: string; connectUrl: string; appBaseUrl: string }): string`
  - `buildConnectedNoticeEmail(p: { clienteName: string; igUsername: string; clienteUrl: string; appBaseUrl: string }): string`
  - `sendConnectLinkEmail(p: { to: string; replyTo: string | null; agencyName: string; clienteName: string; connectUrl: string; appBaseUrl: string; idempotencyKey: string }): Promise<void>`
  - `sendConnectedNoticeEmail(p: { to: string; clienteName: string; igUsername: string; clienteUrl: string; appBaseUrl: string; idempotencyKey: string }): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/instagram-connect-email_test.ts`:

```ts
import { assertEquals } from "./assert.ts";
import {
  buildConnectedNoticeEmail,
  buildConnectLinkEmail,
  CONNECT_LINK_SUBJECT,
} from "../_shared/instagram-connect-email.ts";

const BASE = "https://app.mesaas.com.br";

Deno.test("CONNECT_LINK_SUBJECT: leads with the agency name, not with Mesaas", () => {
  // O cliente recebe e-mail de um domínio que ele não conhece, no momento exato em que
  // é convidado a autorizar uma conta. O assunto tem que abrir com quem ele conhece.
  const subject = CONNECT_LINK_SUBJECT("Agência Y");
  assertEquals(subject.startsWith("Agência Y"), true);
});

Deno.test("buildConnectLinkEmail: contains both names and the link", () => {
  const html = buildConnectLinkEmail({
    agencyName: "Agência Y",
    clienteName: "Clínica X",
    connectUrl: `${BASE}/conectar/tok-123`,
    appBaseUrl: BASE,
  });
  assertEquals(html.includes("Agência Y"), true);
  assertEquals(html.includes("Clínica X"), true);
  assertEquals(html.includes(`${BASE}/conectar/tok-123`), true);
});

Deno.test("buildConnectLinkEmail: escapes names into the HTML", () => {
  const html = buildConnectLinkEmail({
    agencyName: '<script>alert(1)</script>',
    clienteName: "Tom & Jerry",
    connectUrl: `${BASE}/conectar/tok-123`,
    appBaseUrl: BASE,
  });
  assertEquals(html.includes("<script>"), false);
  assertEquals(html.includes("Tom &amp; Jerry"), true);
});

Deno.test("buildConnectLinkEmail: no em-dash in user-visible copy", () => {
  const html = buildConnectLinkEmail({
    agencyName: "Agência Y",
    clienteName: "Clínica X",
    connectUrl: `${BASE}/conectar/tok-123`,
    appBaseUrl: BASE,
  });
  assertEquals(html.includes("—"), false);
});

Deno.test("buildConnectedNoticeEmail: names the client and the @username", () => {
  const html = buildConnectedNoticeEmail({
    clienteName: "Clínica X",
    igUsername: "clinicax",
    clienteUrl: `${BASE}/clientes/42`,
    appBaseUrl: BASE,
  });
  assertEquals(html.includes("Clínica X"), true);
  assertEquals(html.includes("@clinicax"), true);
  assertEquals(html.includes(`${BASE}/clientes/42`), true);
  assertEquals(html.includes("—"), false);
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm run test:functions -- --filter "ConnectLinkEmail"
```

Expected: FAIL, module not found.

- [ ] **Step 3: Export the shared shell and add reply-to support**

In `supabase/functions/_shared/lifecycle-emails.ts`:

Change the `layout` declaration from `function layout(` to `export function layout(`.

Change the `sendViaResend` declaration from `async function sendViaResend(` to `export async function sendViaResend(`, add a sixth optional parameter, and pass it through:

```ts
export async function sendViaResend(
  to: string,
  subject: string,
  html: string,
  idempotencyKey: string,
  from: string = LIFECYCLE_FROM,
  replyTo?: string,
): Promise<void> {
```

Inside the same function, replace the `body:` line with:

```ts
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      ...(replyTo ? { reply_to: [replyTo] } : {}),
    }),
```

Leave every other line, including the 409 idempotency handling, untouched.

- [ ] **Step 4: Write the email module**

Create `supabase/functions/_shared/instagram-connect-email.ts`:

```ts
import { escapeHtml } from "./report-template/escape.ts";
import { layout, LIFECYCLE_FROM, sendViaResend } from "./lifecycle-emails.ts";

/**
 * O cliente final recebe este e-mail de um domínio com o qual não tem relação.
 * Isso tem formato de phishing, então: o assunto e a primeira linha abrem com o
 * nome da agência e com o nome do próprio cliente, e o reply-to aponta para o
 * membro que gerou o link, não para o vazio.
 */
export const CONNECT_LINK_SUBJECT = (agencyName: string): string =>
  `${agencyName} precisa conectar seu Instagram`;

export const CONNECTED_NOTICE_SUBJECT = "Instagram conectado pelo cliente";

function ctaButton(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#1a3d2b;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700;font-size:13px">${label}</a>`;
}

export function buildConnectLinkEmail(p: {
  agencyName: string;
  clienteName: string;
  connectUrl: string;
  appBaseUrl: string;
}): string {
  const agency = escapeHtml(p.agencyName);
  const cliente = escapeHtml(p.clienteName);
  const url = escapeHtml(p.connectUrl);
  const base = escapeHtml(p.appBaseUrl);

  const body = `
    <p style="margin:0 0 14px"><strong>${agency}</strong> pediu para conectar o Instagram de <strong>${cliente}</strong> ao Mesaas, a ferramenta que a agência usa para agendar publicações e acompanhar resultados.</p>
    <p style="margin:0 0 14px">Para autorizar, abra o link abaixo e entre com a conta do Instagram de ${cliente}. A agência não vê sua senha em momento algum.</p>
    <p style="margin:0 0 20px">${ctaButton(url, "Conectar Instagram")}</p>
    <p style="margin:0 0 14px;font-size:12px;color:#888780">Se o botão não funcionar, copie e cole este endereço no navegador:<br><span style="word-break:break-all">${url}</span></p>
    <p style="margin:0;font-size:12px;color:#888780">Não esperava este pedido? Responda este e-mail e fale direto com ${agency}.</p>`;

  return layout(body, `Enviado a pedido de ${agency}`, base);
}

export function buildConnectedNoticeEmail(p: {
  clienteName: string;
  igUsername: string;
  clienteUrl: string;
  appBaseUrl: string;
}): string {
  const cliente = escapeHtml(p.clienteName);
  const user = escapeHtml(p.igUsername);
  const url = escapeHtml(p.clienteUrl);
  const base = escapeHtml(p.appBaseUrl);

  const body = `
    <p style="margin:0 0 14px">O cliente <strong>${cliente}</strong> concluiu a conexão do Instagram.</p>
    <p style="margin:0 0 20px">Conta conectada: <strong>@${user}</strong></p>
    <p style="margin:0">${ctaButton(url, "Ver o cliente")}</p>`;

  return layout(body, "Notificação automática do Mesaas", base);
}

export async function sendConnectLinkEmail(p: {
  to: string;
  replyTo: string | null;
  agencyName: string;
  clienteName: string;
  connectUrl: string;
  appBaseUrl: string;
  idempotencyKey: string;
}): Promise<void> {
  await sendViaResend(
    p.to,
    CONNECT_LINK_SUBJECT(p.agencyName),
    buildConnectLinkEmail(p),
    p.idempotencyKey,
    LIFECYCLE_FROM,
    p.replyTo ?? undefined,
  );
}

export async function sendConnectedNoticeEmail(p: {
  to: string;
  clienteName: string;
  igUsername: string;
  clienteUrl: string;
  appBaseUrl: string;
  idempotencyKey: string;
}): Promise<void> {
  await sendViaResend(
    p.to,
    CONNECTED_NOTICE_SUBJECT,
    buildConnectedNoticeEmail(p),
    p.idempotencyKey,
  );
}
```

- [ ] **Step 5: Run the tests and verify they pass**

```bash
npm run test:functions -- --filter "ConnectLinkEmail"
npm run test:functions -- --filter "ConnectedNoticeEmail"
```

Expected: all PASS.

- [ ] **Step 6: Verify nothing else broke**

```bash
npm run test:functions
```

Expected: full suite PASS. This catches a botched edit to `sendViaResend`, which the welcome and thank-you emails share.

- [ ] **Step 7: Restore deno.lock and commit**

```bash
git checkout -- deno.lock
git add supabase/functions/_shared/instagram-connect-email.ts supabase/functions/_shared/lifecycle-emails.ts supabase/functions/__tests__/instagram-connect-email_test.ts
git commit -m "feat(instagram): e-mails do link de conexão, com reply-to para a agência"
```

---

### Task 4: `instagram-connect-link` handler — agency-side routes

**Files:**
- Create: `supabase/functions/instagram-connect-link/handler.ts`
- Create: `supabase/functions/__tests__/instagram-connect-link-handler_test.ts`

**Interfaces:**
- Consumes: `connectLinkLive`, `buildConnectUrl`, `isValidEmail` (Task 2); `sendConnectLinkEmail` (Task 3); `createJsonResponder` from `_shared/http.ts`; `effectivePlanFeature` from `_shared/entitlements-rpc.ts`; `checkRateLimit` from `_shared/rate-limit.ts`.
- Produces: `createConnectLinkHandler(deps: ConnectLinkHandlerDeps): (req: Request) => Promise<Response>` and the exported `ConnectLinkHandlerDeps` interface. Task 5 adds the public routes to this same file; Task 6 wires it.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/instagram-connect-link-handler_test.ts`:

```ts
import { assertEquals } from "./assert.ts";
import { createConnectLinkHandler } from "../instagram-connect-link/handler.ts";

const BASE = "https://app.mesaas.com.br";
const NOW = "2026-08-06T12:00:00.000Z";
const FUTURE = "2026-09-05T12:00:00.000Z";
const USER = "11111111-1111-1111-1111-111111111111";
const CONTA = "22222222-2222-2222-2222-222222222222";
const OTHER_CONTA = "33333333-3333-3333-3333-333333333333";

/** Minimal chainable stub. Each table returns whatever the fixture says. */
function makeDb(fixture: {
  profiles?: unknown;
  clientes?: unknown;
  links?: unknown;
  rpc?: Record<string, unknown>;
  onRpc?: (fn: string, params: Record<string, unknown>) => void;
  onUpdate?: (table: string, values: Record<string, unknown>) => void;
}) {
  const rows: Record<string, unknown> = {
    profiles: fixture.profiles ?? null,
    clientes: fixture.clientes ?? null,
    instagram_connect_links: fixture.links ?? null,
  };
  const build = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "gt", "order", "limit"]) {
      chain[m] = () => chain;
    }
    chain.update = (values: Record<string, unknown>) => {
      fixture.onUpdate?.(table, values);
      return chain;
    };
    chain.maybeSingle = () => Promise.resolve({ data: rows[table], error: null });
    chain.single = () => Promise.resolve({ data: rows[table], error: null });
    return chain;
  };
  return {
    from: (table: string) => build(table),
    rpc: (fn: string, params: Record<string, unknown>) => {
      fixture.onRpc?.(fn, params);
      return Promise.resolve({ data: fixture.rpc?.[fn] ?? null, error: null });
    },
  };
}

function makeDeps(over: Record<string, unknown> = {}) {
  return {
    buildCorsHeaders: () => ({ "Access-Control-Allow-Origin": BASE }),
    createDb: () => makeDb({}),
    now: () => NOW,
    appBaseUrl: () => BASE,
    verifyUser: (_t: string) => Promise.resolve({ id: USER }),
    planFeature: (_db: unknown, _c: string, _f: string) => Promise.resolve(true),
    rateLimit: (_db: unknown, _k: string, _m: number, _w: number) => Promise.resolve(true),
    sendClientEmail: (_p: unknown) => Promise.resolve(),
    createSignedState: () => Promise.resolve("signed.state"),
    metaAppId: () => "app-id",
    metaRedirectUri: () => "https://x/functions/v1/instagram-integration",
    ...over,
  };
}

function req(method: string, path: string, body?: unknown, auth = "Bearer tok") {
  return new Request(`https://x/instagram-connect-link${path}`, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

Deno.test("agency GET: 401 without a bearer token", async () => {
  const h = createConnectLinkHandler(makeDeps());
  const res = await h(req("GET", "?cliente_id=42", undefined, ""));
  assertEquals(res.status, 401);
});

Deno.test("agency GET: 403 when the client belongs to another workspace", async () => {
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({ profiles: { conta_id: CONTA }, clientes: { conta_id: OTHER_CONTA } }),
  }));
  const res = await h(req("GET", "?cliente_id=42"));
  assertEquals(res.status, 403);
});

Deno.test("agency GET: 403 when feature_instagram is off", async () => {
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({ profiles: { conta_id: CONTA }, clientes: { conta_id: CONTA } }),
    planFeature: () => Promise.resolve(false),
  }));
  const res = await h(req("GET", "?cliente_id=42"));
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "feature_disabled");
});

Deno.test("agency GET: returns null when there is no live link", async () => {
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({ profiles: { conta_id: CONTA }, clientes: { conta_id: CONTA }, links: null }),
  }));
  const res = await h(req("GET", "?cliente_id=42"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { link: null });
});

Deno.test("agency GET: an expired-but-unrevoked row is not reported as a live link", async () => {
  // O índice único só enforça revoked_at IS NULL, então uma linha expirada
  // continua ocupando o slot. A metade "não expirado" é checada aqui.
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({
      profiles: { conta_id: CONTA },
      clientes: { conta_id: CONTA },
      links: { token: "t", expires_at: "2026-08-01T00:00:00.000Z", revoked_at: null, created_by: USER },
    }),
  }));
  const res = await h(req("GET", "?cliente_id=42"));
  assertEquals(await res.json(), { link: null });
});

Deno.test("agency GET: returns url and expiry for a live link", async () => {
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({
      profiles: { conta_id: CONTA },
      clientes: { conta_id: CONTA },
      links: { token: "tok-9", expires_at: FUTURE, revoked_at: null, created_by: USER },
    }),
  }));
  const res = await h(req("GET", "?cliente_id=42"));
  assertEquals(await res.json(), {
    link: { url: `${BASE}/conectar/tok-9`, expires_at: FUTURE },
  });
});

Deno.test("agency POST: calls the RPC and returns the new link", async () => {
  let seen: Record<string, unknown> | null = null;
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({
      profiles: { conta_id: CONTA },
      clientes: { conta_id: CONTA },
      rpc: { create_instagram_connect_link: [{ token: "new-tok", expires_at: FUTURE }] },
      onRpc: (_fn, params) => { seen = params; },
    }),
  }));
  const res = await h(req("POST", "", { cliente_id: 42 }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { link: { url: `${BASE}/conectar/new-tok`, expires_at: FUTURE } });
  assertEquals(seen, { p_cliente_id: 42, p_conta_id: CONTA, p_created_by: USER, p_ttl_days: 30 });
});

Deno.test("agency DELETE: revokes and returns ok", async () => {
  let updated: Record<string, unknown> | null = null;
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({
      profiles: { conta_id: CONTA },
      clientes: { conta_id: CONTA },
      onUpdate: (_t, values) => { updated = values; },
    }),
  }));
  const res = await h(req("DELETE", "?cliente_id=42"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  assertEquals(updated, { revoked_at: NOW });
});

Deno.test("agency POST /email: rejects a malformed address before sending", async () => {
  let sent = 0;
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({
      profiles: { conta_id: CONTA },
      clientes: { conta_id: CONTA, nome: "Clínica X" },
      links: { token: "tok-9", expires_at: FUTURE, revoked_at: null, created_by: USER },
    }),
    sendClientEmail: () => { sent++; return Promise.resolve(); },
  }));
  const res = await h(req("POST", "/email", { cliente_id: 42, email: "sem-arroba" }));
  assertEquals(res.status, 400);
  assertEquals(sent, 0);
});

Deno.test("agency POST /email: 429 when rate limited, and nothing is sent", async () => {
  let sent = 0;
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({
      profiles: { conta_id: CONTA },
      clientes: { conta_id: CONTA, nome: "Clínica X" },
      links: { token: "tok-9", expires_at: FUTURE, revoked_at: null, created_by: USER },
    }),
    rateLimit: () => Promise.resolve(false),
    sendClientEmail: () => { sent++; return Promise.resolve(); },
  }));
  const res = await h(req("POST", "/email", { cliente_id: 42, email: "c@x.com" }));
  assertEquals(res.status, 429);
  assertEquals(sent, 0);
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm run test:functions -- --filter "agency GET"
```

Expected: FAIL, `../instagram-connect-link/handler.ts` not found.

- [ ] **Step 3: Write the handler**

Create `supabase/functions/instagram-connect-link/handler.ts`:

```ts
import { createJsonResponder, internalServerError } from "../_shared/http.ts";
import { buildConnectUrl, connectLinkLive, isValidEmail } from "../_shared/instagram-connect-link.ts";

// deno-lint-ignore no-explicit-any
type DbClient = { from: (table: string) => any; rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };

const TTL_DAYS = 30;
const EMAIL_MAX_PER_HOUR = 5;

export interface ConnectLinkHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  /** APP_BASE_URL. Never OAUTH_REDIRECT_BASE: this URL goes into client emails. */
  appBaseUrl: () => string;
  verifyUser: (bearerToken: string) => Promise<{ id: string } | null>;
  planFeature: (db: DbClient, contaId: string, featureKey: string) => Promise<boolean>;
  rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
  sendClientEmail: (p: {
    to: string;
    replyTo: string | null;
    agencyName: string;
    clienteName: string;
    connectUrl: string;
    appBaseUrl: string;
    idempotencyKey: string;
  }) => Promise<void>;
  createSignedState: (
    clientId: string, userId: string, contaId: string, db: DbClient, linkToken: string,
  ) => Promise<string>;
  metaAppId: () => string;
  metaRedirectUri: () => string;
}

/** Resolves the caller and asserts their workspace owns the client. */
async function authorize(
  deps: ConnectLinkHandlerDeps, db: DbClient, req: Request, clienteId: number,
): Promise<{ userId: string; contaId: string } | { status: number; error: string }> {
  const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!bearer || bearer === "undefined" || bearer === "null") {
    return { status: 401, error: "Não autorizado" };
  }
  const user = await deps.verifyUser(bearer);
  if (!user) return { status: 401, error: "Não autorizado" };

  const { data: profile } = await db.from("profiles").select("conta_id").eq("id", user.id).single();
  const contaId = profile?.conta_id as string | undefined;
  if (!contaId) return { status: 403, error: "Não autorizado" };

  const { data: cliente } = await db.from("clientes").select("conta_id").eq("id", clienteId).single();
  if (!cliente || cliente.conta_id !== contaId) return { status: 403, error: "Não autorizado" };

  if (!(await deps.planFeature(db, contaId, "feature_instagram"))) {
    return { status: 403, error: "feature_disabled" };
  }
  return { userId: user.id, contaId };
}

/** The live link for a client, or null. Expiry is checked here, not by the index. */
async function liveLink(deps: ConnectLinkHandlerDeps, db: DbClient, clienteId: number) {
  const { data } = await db
    .from("instagram_connect_links")
    .select("token, expires_at, revoked_at, created_by")
    .eq("cliente_id", clienteId)
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return null;
  return connectLinkLive(data, deps.now()) ? data : null;
}

function parseClienteId(raw: string | null | undefined): number | null {
  if (!raw || !/^\d+$/.test(String(raw))) return null;
  const n = parseInt(String(raw), 10);
  return isNaN(n) ? null : n;
}

export function createConnectLinkHandler(deps: ConnectLinkHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const url = new URL(req.url);
    const path = url.pathname.replace("/instagram-connect-link", "").replace(/\/$/, "");
    const db = deps.createDb();

    try {
      // ---- Agency: read the current live link -------------------------------
      if (req.method === "GET" && path === "") {
        const clienteId = parseClienteId(url.searchParams.get("cliente_id"));
        if (clienteId === null) return json({ error: "cliente_id inválido" }, 400);
        const auth = await authorize(deps, db, req, clienteId);
        if ("status" in auth) return json({ error: auth.error }, auth.status);

        const link = await liveLink(deps, db, clienteId);
        return json({
          link: link
            ? { url: buildConnectUrl(deps.appBaseUrl(), link.token), expires_at: link.expires_at }
            : null,
        });
      }

      // ---- Agency: generate (revoke-and-insert, atomic in the RPC) ----------
      if (req.method === "POST" && path === "") {
        const body = await req.json().catch(() => ({}));
        const clienteId = parseClienteId(body?.cliente_id);
        if (clienteId === null) return json({ error: "cliente_id inválido" }, 400);
        const auth = await authorize(deps, db, req, clienteId);
        if ("status" in auth) return json({ error: auth.error }, auth.status);

        const { data, error } = await db.rpc("create_instagram_connect_link", {
          p_cliente_id: clienteId,
          p_conta_id: auth.contaId,
          p_created_by: auth.userId,
          p_ttl_days: TTL_DAYS,
        });

        if (error) {
          // Duas abas clicando em "Gerar" ao mesmo tempo: a segunda colide no índice
          // único. Isso não é erro para a agência, é o link que ela já queria.
          console.error("[connect-link] RPC failed, re-reading live link:", error);
          const existing = await liveLink(deps, db, clienteId);
          if (!existing) return json({ error: "Erro interno" }, 500);
          return json({
            link: { url: buildConnectUrl(deps.appBaseUrl(), existing.token), expires_at: existing.expires_at },
          });
        }

        const row = Array.isArray(data) ? data[0] : data;
        if (!row?.token) return json({ error: "Erro interno" }, 500);
        return json({
          link: { url: buildConnectUrl(deps.appBaseUrl(), row.token), expires_at: row.expires_at },
        });
      }

      // ---- Agency: revoke ---------------------------------------------------
      if (req.method === "DELETE" && path === "") {
        const clienteId = parseClienteId(url.searchParams.get("cliente_id"));
        if (clienteId === null) return json({ error: "cliente_id inválido" }, 400);
        const auth = await authorize(deps, db, req, clienteId);
        if ("status" in auth) return json({ error: auth.error }, auth.status);

        await db
          .from("instagram_connect_links")
          .update({ revoked_at: deps.now() })
          .eq("cliente_id", clienteId)
          .is("revoked_at", null);
        return json({ ok: true });
      }

      // ---- Agency: email the link to the client -----------------------------
      if (req.method === "POST" && path === "/email") {
        const body = await req.json().catch(() => ({}));
        const clienteId = parseClienteId(body?.cliente_id);
        if (clienteId === null) return json({ error: "cliente_id inválido" }, 400);
        const to = String(body?.email ?? "").trim();
        if (!isValidEmail(to)) return json({ error: "E-mail inválido" }, 400);

        const auth = await authorize(deps, db, req, clienteId);
        if ("status" in auth) return json({ error: auth.error }, auth.status);

        // Sem isto o endpoint é um relay de e-mail apontável para qualquer
        // destinatário por qualquer membro autenticado.
        const allowed = await deps.rateLimit(
          db, `ig-connect-link-email:${clienteId}`, EMAIL_MAX_PER_HOUR, 3600,
        );
        if (!allowed) return json({ error: "Muitos envios. Tente novamente mais tarde." }, 429);

        const link = await liveLink(deps, db, clienteId);
        if (!link) return json({ error: "Nenhum link ativo" }, 404);

        const { data: cliente } = await db.from("clientes").select("nome").eq("id", clienteId).single();
        const { data: workspace } = await db.from("workspaces").select("name").eq("id", auth.contaId).single();
        const { data: profile } = await db.from("profiles").select("email").eq("id", auth.userId).single();

        await deps.sendClientEmail({
          to,
          replyTo: (profile?.email as string | undefined) ?? null,
          agencyName: (workspace?.name as string | undefined) ?? "Sua agência",
          clienteName: (cliente?.nome as string | undefined) ?? "seu perfil",
          connectUrl: buildConnectUrl(deps.appBaseUrl(), link.token),
          appBaseUrl: deps.appBaseUrl(),
          idempotencyKey: `ig-connect-link:${link.token}:${to}`,
        });
        return json({ ok: true });
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return internalServerError(json, "instagram-connect-link", err);
    }
  };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
npm run test:functions -- --filter "agency "
```

Expected: all 10 agency tests PASS.

- [ ] **Step 5: Restore deno.lock and commit**

```bash
git checkout -- deno.lock
git add supabase/functions/instagram-connect-link/handler.ts supabase/functions/__tests__/instagram-connect-link-handler_test.ts
git commit -m "feat(instagram): rotas da agência para o link de conexão"
```

---

### Task 5: Public routes, plus the function entrypoint and config

**Files:**
- Modify: `supabase/functions/instagram-connect-link/handler.ts`
- Modify: `supabase/functions/__tests__/instagram-connect-link-handler_test.ts`
- Create: `supabase/functions/instagram-connect-link/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: everything from Task 4, plus `createSignedState` from `../instagram-integration/oauth-state.ts` (extended in Task 6; this task passes the extra argument, which the current 4-arg signature simply ignores until then).
- Produces: `GET /public/:token` returning `{ workspace_name, cliente_name, status, connected_username }` and `POST /public/:token/start` returning `{ url }`.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/__tests__/instagram-connect-link-handler_test.ts`:

```ts
function publicReq(method: string, path: string) {
  return new Request(`https://x/instagram-connect-link${path}`, { method });
}

Deno.test("public GET: 404 for an unknown token", async () => {
  const h = createConnectLinkHandler(makeDeps({ createDb: () => makeDb({ links: null }) }));
  const res = await h(publicReq("GET", "/public/nope"));
  assertEquals(res.status, 404);
});

Deno.test("public GET: reports revoked without exposing anything else", async () => {
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({
      links: { token: "t", cliente_id: 42, conta_id: CONTA, created_by: USER,
               expires_at: FUTURE, revoked_at: "2026-08-05T00:00:00.000Z" },
    }),
  }));
  const res = await h(publicReq("GET", "/public/t"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { status: "revoked" });
});

Deno.test("public GET: reports expired", async () => {
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({
      links: { token: "t", cliente_id: 42, conta_id: CONTA, created_by: USER,
               expires_at: "2026-08-01T00:00:00.000Z", revoked_at: null },
    }),
  }));
  assertEquals(await (await h(publicReq("GET", "/public/t"))).json(), { status: "expired" });
});

Deno.test("public GET: live link exposes exactly two names and nothing more", async () => {
  const db = makeDb({
    links: { token: "t", cliente_id: 42, conta_id: CONTA, created_by: USER,
             expires_at: FUTURE, revoked_at: null },
    clientes: { nome: "Clínica X" },
  });
  // workspaces and instagram_accounts resolve through the same stub; the stub returns
  // the `clientes` fixture for `clientes` only, so the others come back null.
  const h = createConnectLinkHandler(makeDeps({ createDb: () => db }));
  const body = await (await h(publicReq("GET", "/public/t"))).json();
  assertEquals(body.status, "live");
  assertEquals(body.cliente_name, "Clínica X");
  assertEquals(Object.keys(body).sort(), ["cliente_name", "connected_username", "status", "workspace_name"]);
});

Deno.test("public GET: feature_instagram off is reported as unavailable", async () => {
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({
      links: { token: "t", cliente_id: 42, conta_id: CONTA, created_by: USER,
               expires_at: FUTURE, revoked_at: null },
    }),
    planFeature: () => Promise.resolve(false),
  }));
  assertEquals(await (await h(publicReq("GET", "/public/t"))).json(), { status: "unavailable" });
});

Deno.test("public start: returns the Instagram authorize url with the signed state", async () => {
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({
      links: { token: "t", cliente_id: 42, conta_id: CONTA, created_by: USER,
               expires_at: FUTURE, revoked_at: null },
    }),
  }));
  const res = await h(publicReq("POST", "/public/t/start"));
  assertEquals(res.status, 200);
  const { url } = await res.json();
  assertEquals(url.startsWith("https://www.instagram.com/oauth/authorize?"), true);
  assertEquals(url.includes("state=signed.state"), true);
  assertEquals(url.includes("client_id=app-id"), true);
});

Deno.test("public start: a revoked link cannot start a flow", async () => {
  let minted = 0;
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({
      links: { token: "t", cliente_id: 42, conta_id: CONTA, created_by: USER,
               expires_at: FUTURE, revoked_at: "2026-08-05T00:00:00.000Z" },
    }),
    createSignedState: () => { minted++; return Promise.resolve("signed.state"); },
  }));
  assertEquals((await h(publicReq("POST", "/public/t/start"))).status, 404);
  assertEquals(minted, 0);
});

Deno.test("public start: rate limited, and no state is minted", async () => {
  let minted = 0;
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({
      links: { token: "t", cliente_id: 42, conta_id: CONTA, created_by: USER,
               expires_at: FUTURE, revoked_at: null },
    }),
    rateLimit: () => Promise.resolve(false),
    createSignedState: () => { minted++; return Promise.resolve("signed.state"); },
  }));
  assertEquals((await h(publicReq("POST", "/public/t/start"))).status, 429);
  assertEquals(minted, 0);
});

Deno.test("public routes never require an Authorization header", async () => {
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({ links: null }),
    verifyUser: () => Promise.reject(new Error("verifyUser must not be called on public routes")),
  }));
  assertEquals((await h(publicReq("GET", "/public/whatever"))).status, 404);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
npm run test:functions -- --filter "public "
```

Expected: FAIL with 404 responses where the tests expect 200, because the public branches do not exist yet.

- [ ] **Step 3: Add the public branches to the handler**

In `supabase/functions/instagram-connect-link/handler.ts`, add this constant next to `EMAIL_MAX_PER_HOUR`:

```ts
const START_MAX_PER_HOUR = 10;
const IG_SCOPES = "instagram_business_basic,instagram_business_manage_insights,instagram_business_content_publish";
```

Then insert both branches **immediately after** `const db = deps.createDb();` and **before** the agency `GET` branch, inside the `try`. Public routes come first in the file so that the unauthenticated surface is the first thing a reader sees:

```ts
      // =====================================================================
      // ROTAS PÚBLICAS. Sem JWT, por desenho. Tudo abaixo é alcançável por
      // qualquer pessoa que tenha a URL. Não acrescente nada aqui que leia
      // dados do workspace além do nome da agência e do nome do cliente.
      // =====================================================================

      if (path.startsWith("/public/")) {
        const rest = path.slice("/public/".length);
        const [rawToken, action] = rest.split("/");
        const token = decodeURIComponent(rawToken ?? "");
        if (!token) return json({ error: "Not found" }, 404);

        const { data: link } = await db
          .from("instagram_connect_links")
          .select("token, cliente_id, conta_id, created_by, expires_at, revoked_at")
          .eq("token", token)
          .maybeSingle();
        if (!link) return json({ error: "Not found" }, 404);

        const status = connectLinkStatus(link, deps.now());

        if (req.method === "GET" && !action) {
          if (status !== "live") return json({ status });
          if (!(await deps.planFeature(db, link.conta_id, "feature_instagram"))) {
            return json({ status: "unavailable" });
          }
          const { data: cliente } = await db
            .from("clientes").select("nome").eq("id", link.cliente_id).maybeSingle();
          const { data: workspace } = await db
            .from("workspaces").select("name").eq("id", link.conta_id).maybeSingle();
          const { data: account } = await db
            .from("instagram_accounts")
            .select("username, authorization_status")
            .eq("client_id", link.cliente_id)
            .maybeSingle();
          return json({
            status: "live",
            cliente_name: (cliente?.nome as string | undefined) ?? "",
            workspace_name: (workspace?.name as string | undefined) ?? "",
            connected_username:
              account && account.authorization_status === "active"
                ? ((account.username as string | undefined) ?? null)
                : null,
          });
        }

        if (req.method === "POST" && action === "start") {
          if (status !== "live") return json({ error: "Not found" }, 404);
          if (!(await deps.planFeature(db, link.conta_id, "feature_instagram"))) {
            return json({ error: "Not found" }, 404);
          }
          // Cada start insere uma linha em oauth_states. Sem limite, um endpoint
          // público vira amplificador de escrita.
          const allowed = await deps.rateLimit(
            db, `ig-connect-link-start:${token}`, START_MAX_PER_HOUR, 3600,
          );
          if (!allowed) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);

          // userId do state é o membro que gerou o link: é ele que a auditoria
          // e a notificação vão referenciar.
          const state = await deps.createSignedState(
            String(link.cliente_id), link.created_by, link.conta_id, db, token,
          );
          const authorizeUrl =
            `https://www.instagram.com/oauth/authorize?client_id=${deps.metaAppId()}` +
            `&redirect_uri=${encodeURIComponent(deps.metaRedirectUri())}` +
            `&response_type=code&scope=${IG_SCOPES}&state=${state}`;
          return json({ url: authorizeUrl });
        }

        return json({ error: "Not found" }, 404);
      }
```

Update the import at the top of the file to add `connectLinkStatus`:

```ts
import { buildConnectUrl, connectLinkLive, connectLinkStatus, isValidEmail } from "../_shared/instagram-connect-link.ts";
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
npm run test:functions -- --filter "public "
npm run test:functions -- --filter "agency "
```

Expected: all PASS, agency tests still green.

- [ ] **Step 5: Write the function entrypoint**

Create `supabase/functions/instagram-connect-link/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { appBaseUrl } from "../_shared/app-url.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { sendConnectLinkEmail } from "../_shared/instagram-connect-email.ts";
import { createSignedState } from "../instagram-integration/oauth-state.ts";
import { createConnectLinkHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_APP_ID = Deno.env.get("META_APP_ID")!;

const svc = () =>
  createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

Deno.serve(
  createConnectLinkHandler({
    buildCorsHeaders,
    createDb: () => svc(),
    now: () => new Date().toISOString(),
    appBaseUrl,
    // Service-role client + getUser(token). Never the anon client: user JWTs are
    // ES256 and the anon client cannot verify them.
    verifyUser: async (bearer) => {
      const { data, error } = await svc().auth.getUser(bearer);
      if (error || !data.user) return null;
      return { id: data.user.id };
    },
    // deno-lint-ignore no-explicit-any
    planFeature: (db, contaId, key) => effectivePlanFeature(db as any, contaId, key),
    // deno-lint-ignore no-explicit-any
    rateLimit: (db, key, max, win) => checkRateLimit(db as any, key, max, win),
    sendClientEmail: sendConnectLinkEmail,
    createSignedState: (clientId, userId, contaId, db, linkToken) =>
      createSignedState(clientId, userId, contaId, db, linkToken),
    metaAppId: () => META_APP_ID,
    metaRedirectUri: () =>
      Deno.env.get("META_REDIRECT_URI") ?? `${SUPABASE_URL}/functions/v1/instagram-integration`,
  }),
);
```

- [ ] **Step 6: Register the function in config.toml**

At the top of `supabase/config.toml`, directly above the existing `[functions.instagram-integration]` block, add:

```toml
[functions.instagram-connect-link]
verify_jwt = false
```

This is where the repo versions that flag for the other 20+ functions that handle their own auth. The `--no-verify-jwt` deploy flag alone leaves no record.

- [ ] **Step 7: Run the whole function suite, restore deno.lock and commit**

```bash
npm run test:functions
git checkout -- deno.lock
git add supabase/functions/instagram-connect-link/ supabase/functions/__tests__/instagram-connect-link-handler_test.ts supabase/config.toml
git commit -m "feat(instagram): rotas públicas do link de conexão e entrypoint da function"
```

---

### Task 6: Carry the link token through the signed OAuth state

**Files:**
- Modify: `supabase/functions/instagram-integration/oauth-state.ts`
- Create: `supabase/functions/__tests__/instagram-oauth-state_test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `createSignedState(clientId, userId, contaId, serviceClient, linkToken?)`; `verifySignedState(state)` returns `{ clientId, userId, contaId, nonce, linkToken?: string }`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/instagram-oauth-state_test.ts`:

```ts
import { assertEquals } from "./assert.ts";

Deno.env.set("TOKEN_ENCRYPTION_KEY", "test-key-0123456789abcdef0123456789");

const { createSignedState, verifySignedState } = await import("../instagram-integration/oauth-state.ts");

/** oauth_states writes are irrelevant here; swallow them. */
function fakeDb() {
  const chain = {
    delete: () => chain,
    lt: () => Promise.resolve({ data: null, error: null }),
    insert: () => Promise.resolve({ data: null, error: null }),
  };
  return { from: () => chain };
}

Deno.test("signed state: round-trips the link token", async () => {
  // deno-lint-ignore no-explicit-any
  const state = await createSignedState("42", "user-1", "conta-1", fakeDb() as any, "tok-9");
  const parsed = await verifySignedState(state);
  assertEquals(parsed.clientId, "42");
  assertEquals(parsed.userId, "user-1");
  assertEquals(parsed.contaId, "conta-1");
  assertEquals(parsed.linkToken, "tok-9");
});

Deno.test("signed state: agency flow has no link token", async () => {
  // Compatibilidade: states já em voo, criados antes desta mudança, precisam
  // continuar verificando. Ausente significa fluxo da agência.
  // deno-lint-ignore no-explicit-any
  const state = await createSignedState("42", "user-1", "conta-1", fakeDb() as any);
  const parsed = await verifySignedState(state);
  assertEquals(parsed.linkToken, undefined);
});

Deno.test("signed state: a forged link token fails the signature", async () => {
  // O cliente final controla a URL de volta, então o linkToken TEM que estar
  // dentro do payload assinado. Aqui montamos um payload novo com outro token e
  // reaproveitamos a assinatura do original: a verificação precisa recusar.
  // deno-lint-ignore no-explicit-any
  const state = await createSignedState("42", "user-1", "conta-1", fakeDb() as any, "tok-9");
  const sig = state.slice(state.indexOf(".") + 1);
  const forgedPayload = JSON.stringify({
    clientId: "42", userId: "user-1", contaId: "conta-1",
    nonce: "n", iat: Date.now(), linkToken: "tok-ATACANTE",
  });
  const forgedB64 = btoa(forgedPayload)
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  let threw = false;
  try {
    await verifySignedState(`${forgedB64}.${sig}`);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm run test:functions -- --filter "signed state"
```

Expected: the round-trip test FAILS because `parsed.linkToken` is `undefined`.

- [ ] **Step 3: Extend the state module**

In `supabase/functions/instagram-integration/oauth-state.ts`, replace `createSignedState` and `verifySignedState` with:

```ts
// deno-lint-ignore no-explicit-any
export async function createSignedState(
  clientId: string,
  userId: string,
  contaId: string,
  serviceClient: any,
  linkToken?: string,
): Promise<string> {
  await serviceClient.from('oauth_states').delete().lt('expires_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());
  // linkToken só entra no payload quando existe: um state do fluxo da agência
  // continua byte-a-byte no formato antigo.
  const payload = JSON.stringify({
    clientId,
    userId,
    contaId,
    nonce: crypto.randomUUID(),
    iat: Date.now(),
    ...(linkToken ? { linkToken } : {}),
  });
  const key = await getHmacKey();
  const enc = new TextEncoder();
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const payloadB64 = toUrlSafeBase64(btoa(payload));
  const sigB64 = toUrlSafeBase64(btoa(String.fromCharCode(...new Uint8Array(sigBuf))));
  const parsed = JSON.parse(payload);
  await serviceClient.from('oauth_states').insert({
    nonce: parsed.nonce,
    client_id: parseInt(clientId, 10),
    conta_id: contaId,
    initiated_by: userId,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  return payloadB64 + '.' + sigB64;
}

export async function verifySignedState(
  state: string,
): Promise<{ clientId: string; userId: string; contaId: string; nonce: string; linkToken?: string }> {
  const s = decodeURIComponent(state);
  const dotIdx = s.indexOf('.');
  if (dotIdx === -1) throw new Error('Invalid state format');
  const payloadB64 = s.slice(0, dotIdx);
  const sigB64 = s.slice(dotIdx + 1);
  const payload = atob(fromUrlSafeBase64(payloadB64));
  const key = await getHmacKey();
  const enc = new TextEncoder();
  const sigBytes = Uint8Array.from(atob(fromUrlSafeBase64(sigB64)), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload));
  if (!valid) throw new Error('State signature invalid');
  const parsed = JSON.parse(payload);
  if (Date.now() - parsed.iat > 10 * 60 * 1000) throw new Error('State expired');
  return {
    clientId: parsed.clientId,
    userId: parsed.userId,
    contaId: parsed.contaId,
    nonce: parsed.nonce,
    linkToken: parsed.linkToken,
  };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
npm run test:functions -- --filter "signed state"
```

Expected: all three PASS.

- [ ] **Step 5: Restore deno.lock and commit**

```bash
git checkout -- deno.lock
git add supabase/functions/instagram-integration/oauth-state.ts supabase/functions/__tests__/instagram-oauth-state_test.ts
git commit -m "feat(instagram): state assinado carrega o token do link de conexão"
```

---

### Task 7: Callback branch — atomic gate, notification, redirects

**Files:**
- Modify: `supabase/functions/instagram-integration/oauth-error.ts`
- Modify: `supabase/functions/instagram-integration/index.ts`
- Modify: `supabase/functions/__tests__/instagram-oauth-classify_test.ts`
- Create: `supabase/functions/instagram-connect-link/gate.ts`
- Create: `supabase/functions/__tests__/instagram-connect-link-gate_test.ts`

**Interfaces:**
- Consumes: `verifySignedState` (Task 6); `sendConnectedNoticeEmail` (Task 3).
- Produces: `consumeConnectLink(db, token, nowIso)` returning `{ cliente_id, conta_id, created_by } | null`; `notifyConnectLinkUsed(deps, p)`; error code `'link_revoked'`.

- [ ] **Step 1: Write the failing test for the atomic gate**

Create `supabase/functions/__tests__/instagram-connect-link-gate_test.ts`:

```ts
import { assertEquals } from "./assert.ts";
import { consumeConnectLink } from "../instagram-connect-link/gate.ts";

const NOW = "2026-08-06T12:00:00.000Z";

/** Records the exact filter chain so the test can assert the gate is one
 *  conditional UPDATE and not a read followed by a write. */
function makeDb(returned: unknown) {
  const calls: string[] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["eq", "is", "gt", "select"]) {
    chain[m] = (...args: unknown[]) => { calls.push(`${m}(${args.join(",")})`); return chain; };
  }
  chain.update = (values: Record<string, unknown>) => {
    calls.push(`update(${Object.keys(values).join(",")})`);
    return chain;
  };
  chain.maybeSingle = () => Promise.resolve({ data: returned, error: null });
  return { db: { from: (t: string) => { calls.push(`from(${t})`); return chain; } }, calls };
}

Deno.test("consumeConnectLink: returns the row when the gate passes", async () => {
  const { db } = makeDb({ cliente_id: 42, conta_id: "c", created_by: "u" });
  // deno-lint-ignore no-explicit-any
  const got = await consumeConnectLink(db as any, "tok", NOW);
  assertEquals(got, { cliente_id: 42, conta_id: "c", created_by: "u" });
});

Deno.test("consumeConnectLink: returns null when no row matches", async () => {
  const { db } = makeDb(null);
  // deno-lint-ignore no-explicit-any
  assertEquals(await consumeConnectLink(db as any, "tok", NOW), null);
});

Deno.test("consumeConnectLink: is a single conditional UPDATE, not read-then-write", async () => {
  // Este teste é o que sustenta a afirmação "revogação é real". Se alguém trocar
  // o gate por um select seguido de update, a corrida volta e este teste cai.
  const { db, calls } = makeDb({ cliente_id: 42, conta_id: "c", created_by: "u" });
  // deno-lint-ignore no-explicit-any
  await consumeConnectLink(db as any, "tok", NOW);
  assertEquals(calls.filter((c) => c.startsWith("update(")).length, 1);
  assertEquals(calls.some((c) => c === "is(revoked_at,null)"), true);
  assertEquals(calls.some((c) => c === `gt(expires_at,${NOW})`), true);
  assertEquals(calls.some((c) => c === "eq(token,tok)"), true);
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm run test:functions -- --filter "consumeConnectLink"
```

Expected: FAIL, `../instagram-connect-link/gate.ts` not found.

- [ ] **Step 3: Write the gate module**

Create `supabase/functions/instagram-connect-link/gate.ts`:

```ts
// deno-lint-ignore no-explicit-any
type DbClient = { from: (table: string) => any };

export interface ConsumedLink {
  cliente_id: number;
  conta_id: string;
  created_by: string;
}

/**
 * Portão atômico do callback.
 *
 * Uma releitura de revoked_at seguida do upsert em instagram_accounts NÃO basta:
 * a revogação pode cair entre as duas. Este UPDATE condicional com RETURNING é
 * uma única operação no banco, exatamente o padrão que o callback já usa para
 * consumir o nonce do oauth_states.
 *
 * Zero linhas devolvidas significa revogado, expirado, ou token inexistente, e o
 * chamador precisa abortar ANTES de escrever em instagram_accounts.
 *
 * Efeito colateral de semântica: used_at passa a ser "última tentativa que passou
 * o portão". Se o upsert seguinte falhar, used_at fica marcado assim mesmo. É a
 * troca certa: o portão precisa vir antes da escrita.
 */
export async function consumeConnectLink(
  db: DbClient,
  token: string,
  nowIso: string,
): Promise<ConsumedLink | null> {
  const { data } = await db
    .from("instagram_connect_links")
    .update({ used_at: nowIso })
    .eq("token", token)
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .select("cliente_id, conta_id, created_by")
    .maybeSingle();
  return (data as ConsumedLink | null) ?? null;
}
```

- [ ] **Step 4: Run the gate tests and verify they pass**

```bash
npm run test:functions -- --filter "consumeConnectLink"
```

Expected: all three PASS.

- [ ] **Step 5: Add the `link_revoked` error code with a failing test first**

Append to `supabase/functions/__tests__/instagram-oauth-classify_test.ts`:

```ts
Deno.test("classifyOAuthError: connect link revoked during the flow", () => {
  assertEquals(classifyOAuthError("CONNECT_LINK_REVOKED", noParams), "link_revoked");
});
```

Run it:

```bash
npm run test:functions -- --filter "connect link revoked"
```

Expected: FAIL, returns `"1"`.

Then in `supabase/functions/instagram-integration/oauth-error.ts`, add this line inside `classifyOAuthError` **before** the final `return '1';`:

```ts
  if (/^CONNECT_LINK_REVOKED/.test(msg)) return 'link_revoked';
```

Re-run: expected PASS.

- [ ] **Step 6: Wire the callback branch**

In `supabase/functions/instagram-integration/index.ts`:

Add to the imports at the top:

```ts
import { consumeConnectLink } from "../instagram-connect-link/gate.ts";
import { sendConnectedNoticeEmail } from "../_shared/instagram-connect-email.ts";
import { appBaseUrl } from "../_shared/app-url.ts";
```

Change the state destructuring in the callback branch from:

```ts
        const { clientId, nonce, contaId, userId } = await verifySignedState(state || '');
```

to:

```ts
        const { clientId, nonce, contaId, userId, linkToken } = await verifySignedState(state || '');
```

Immediately **before** the `const { data: priorAccount } = await serviceClient` block, insert the gate:

```ts
        // Portão do link de conexão. Precisa vir ANTES do upsert: uma revogação
        // que caia entre uma releitura e a escrita passaria batido.
        if (linkToken) {
            const consumed = await consumeConnectLink(serviceClient, linkToken, new Date().toISOString());
            if (!consumed) throw new Error('CONNECT_LINK_REVOKED');
            if (String(consumed.cliente_id) !== String(clientId)) {
                // O state é assinado, então isto não deveria acontecer. Se acontecer,
                // algo está muito errado e não escrevemos nada.
                console.error('[IG-CALLBACK] link/state client mismatch', consumed.cliente_id, clientId);
                throw new Error('CONNECT_LINK_REVOKED');
            }
        }
```

Change the audit metadata line from:

```ts
          metadata: { ig_username: igProfile.username || '', ig_business_id: igBusinessId },
```

to:

```ts
          metadata: {
            ig_username: igProfile.username || '',
            ig_business_id: igBusinessId,
            ...(linkToken ? { via: 'connect_link' } : {}),
          },
```

Immediately **before** the `const connectedMarker = ...` line, insert the notification and email:

```ts
        // Aviso à agência. Melhor-esforço: a conexão já está persistida e uma falha
        // aqui não pode desfazê-la nem bloquear o redirect do cliente.
        if (linkToken) {
            try {
                await serviceClient.from('notifications').insert({
                    workspace_id: contaId,
                    user_id: userId,
                    type: 'instagram_connected_by_client',
                    metadata: { client_name: igProfile.username || '', ig_username: igProfile.username || '' },
                    link: `/clientes/${clientId}`,
                });
            } catch (e) {
                // created_by pode ter sido removido entre gerar o link e o callback:
                // notifications.user_id tem FK com ON DELETE CASCADE, então o insert falha.
                console.error('[IG-CALLBACK] notification insert failed (non-fatal):', e);
            }
            try {
                const { data: cliente } = await serviceClient
                    .from('clientes').select('nome').eq('id', clientId).maybeSingle();
                const { data: profile } = await serviceClient
                    .from('profiles').select('email').eq('id', userId).maybeSingle();
                if (profile?.email) {
                    const base = appBaseUrl();
                    await sendConnectedNoticeEmail({
                        to: profile.email,
                        clienteName: cliente?.nome ?? '',
                        igUsername: igProfile.username || '',
                        clienteUrl: `${base.replace(/\/+$/, '')}/clientes/${clientId}`,
                        appBaseUrl: base,
                        idempotencyKey: `ig-connected-notice:${linkToken}:${igBusinessId}`,
                    });
                }
            } catch (e) {
                console.error('[IG-CALLBACK] connected notice email failed (non-fatal):', e);
            }
        }
```

Change the success redirect from:

```ts
        const connectedMarker = isFirstConnection ? 'new' : 'reconnect';
        return Response.redirect(
            `${OAUTH_REDIRECT_BASE}/clientes/${clientId}?ig_connected=${connectedMarker}`,
            302,
        );
```

to:

```ts
        const connectedMarker = isFirstConnection ? 'new' : 'reconnect';
        // O cliente final não tem login no CRM: mandá-lo para /clientes/:id o joga
        // na tela de login. OAUTH_REDIRECT_BASE (e não APP_BASE_URL) porque este é
        // o redirect do callback OAuth, não um link enviado por e-mail.
        if (linkToken) {
            return Response.redirect(
                `${OAUTH_REDIRECT_BASE}/conectar/${linkToken}?ig_connected=${connectedMarker}`,
                302,
            );
        }
        return Response.redirect(
            `${OAUTH_REDIRECT_BASE}/clientes/${clientId}?ig_connected=${connectedMarker}`,
            302,
        );
```

In the `catch` block, change the state parsing from:

```ts
      let redirectClientId: string | undefined;
      let stateNonce: string | undefined;
      try {
        const parsedState = await verifySignedState(stateParam || '');
        redirectClientId = parsedState.clientId;
        stateNonce = parsedState.nonce;
      } catch { /* ignore */ }
```

to:

```ts
      let redirectClientId: string | undefined;
      let stateNonce: string | undefined;
      let redirectLinkToken: string | undefined;
      try {
        const parsedState = await verifySignedState(stateParam || '');
        redirectClientId = parsedState.clientId;
        stateNonce = parsedState.nonce;
        redirectLinkToken = parsedState.linkToken;
      } catch { /* ignore */ }
```

And change the final target assignment from:

```ts
      const target = redirectClientId
        ? `${OAUTH_REDIRECT_BASE}/clientes/${redirectClientId}?ig_error=${igErrorCode}`
        : `${OAUTH_REDIRECT_BASE}?ig_error=${igErrorCode}`;
```

to:

```ts
      const target = redirectLinkToken
        ? `${OAUTH_REDIRECT_BASE}/conectar/${redirectLinkToken}?ig_error=${igErrorCode}`
        : redirectClientId
          ? `${OAUTH_REDIRECT_BASE}/clientes/${redirectClientId}?ig_error=${igErrorCode}`
          : `${OAUTH_REDIRECT_BASE}?ig_error=${igErrorCode}`;
```

- [ ] **Step 7: Run the whole function suite**

```bash
npm run test:functions
```

Expected: all PASS.

- [ ] **Step 8: Restore deno.lock and commit**

```bash
git checkout -- deno.lock
git add supabase/functions/instagram-integration/ supabase/functions/instagram-connect-link/gate.ts supabase/functions/__tests__/
git commit -m "feat(instagram): callback reconhece o link de conexão com portão atômico"
```

---

### Task 8: CRM — shared Instagram OAuth error mapping

**Files:**
- Create: `apps/crm/src/lib/instagram-oauth-errors.ts`
- Create: `apps/crm/src/lib/__tests__/instagram-oauth-errors.test.ts`
- Modify: `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx:294-321`
- Modify: `packages/i18n/locales/pt/clients.json`, `packages/i18n/locales/en/clients.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `type IgErrorAction = { kind: 'off_meta' } | { kind: 'toast'; level: 'info' | 'error'; i18nKey: string }`; `resolveIgError(code: string | null): IgErrorAction | null`.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/lib/__tests__/instagram-oauth-errors.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { resolveIgError } from '../instagram-oauth-errors';

describe('resolveIgError', () => {
  test('null when there is no error code', () => {
    expect(resolveIgError(null)).toBeNull();
    expect(resolveIgError('')).toBeNull();
  });

  test('off_meta_activity opens the dedicated dialog', () => {
    expect(resolveIgError('off_meta_activity')).toEqual({ kind: 'off_meta' });
  });

  test('cancelled is informational, not an error', () => {
    expect(resolveIgError('cancelled')).toEqual({
      kind: 'toast',
      level: 'info',
      i18nKey: 'detail.igCancelled',
    });
  });

  test('known codes map to their own copy', () => {
    expect(resolveIgError('no_business_account')).toEqual({
      kind: 'toast', level: 'error', i18nKey: 'detail.igNotBusiness',
    });
    expect(resolveIgError('link_revoked')).toEqual({
      kind: 'toast', level: 'error', i18nKey: 'detail.igLinkRevoked',
    });
  });

  test('unknown codes fall back to the generic message', () => {
    expect(resolveIgError('1')).toEqual({
      kind: 'toast', level: 'error', i18nKey: 'detail.igError',
    });
    expect(resolveIgError('something-new')).toEqual({
      kind: 'toast', level: 'error', i18nKey: 'detail.igError',
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm run test -- instagram-oauth-errors
```

Expected: FAIL, cannot resolve `../instagram-oauth-errors`.

- [ ] **Step 3: Write the module**

Create `apps/crm/src/lib/instagram-oauth-errors.ts`:

```ts
/**
 * Mapeia o código `ig_error` que o callback do OAuth devolve na URL para a
 * orientação que a interface mostra.
 *
 * Compartilhado entre a página do cliente (CRM, autenticada) e a página pública
 * /conectar/:token. Sem isto as duas divergem em silêncio, e a pessoa que mais
 * precisa da orientação, o cliente final, é justamente quem fica com a cópia pior.
 *
 * Os códigos vêm de supabase/functions/instagram-integration/oauth-error.ts.
 */
export type IgErrorAction =
  | { kind: 'off_meta' }
  | { kind: 'toast'; level: 'info' | 'error'; i18nKey: string };

const KNOWN_ERROR_KEYS: Record<string, string> = {
  no_business_account: 'detail.igNotBusiness',
  missing_permissions: 'detail.igMissingPermissions',
  state_expired: 'detail.igStateExpired',
  account_restricted: 'detail.igRestricted',
  rate_limited: 'detail.igRateLimited',
  link_revoked: 'detail.igLinkRevoked',
};

export function resolveIgError(code: string | null): IgErrorAction | null {
  if (!code) return null;
  if (code === 'off_meta_activity') return { kind: 'off_meta' };
  if (code === 'cancelled') return { kind: 'toast', level: 'info', i18nKey: 'detail.igCancelled' };
  const known = KNOWN_ERROR_KEYS[code];
  return { kind: 'toast', level: 'error', i18nKey: known ?? 'detail.igError' };
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
npm run test -- instagram-oauth-errors
```

Expected: PASS.

- [ ] **Step 5: Add the new i18n key**

In `packages/i18n/locales/pt/clients.json`, inside the `detail` object next to `igError`, add:

```json
    "igLinkRevoked": "Este link de conexão foi revogado ou expirou. Peça um novo link para a agência.",
```

In `packages/i18n/locales/en/clients.json`, in the same place:

```json
    "igLinkRevoked": "This connection link was revoked or has expired. Ask your agency for a new one.",
```

- [ ] **Step 6: Rewire the client page to use the shared module**

In `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx`, add to the imports:

```ts
import { resolveIgError } from '../../lib/instagram-oauth-errors';
```

Replace the body of the `useEffect` at lines 294 to 321 with:

```tsx
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const igError = params.get('ig_error');
    const action = resolveIgError(igError);
    if (action?.kind === 'off_meta') {
      setIgOffMetaOpen(true);
    } else if (action?.kind === 'toast') {
      if (action.level === 'info') toast.info(t(action.i18nKey));
      else toast.error(t(action.i18nKey));
    }
    if (params.get('tt_error') === '1') {
      toast.error(t('detail.ttError'));
    }
    if (igError || params.get('tt_error')) {
      params.delete('ig_error');
      params.delete('tt_error');
      const qs = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    }
  }, [t]);
```

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run test -- instagram-oauth-errors
```

Expected: no type errors, tests PASS.

```bash
git add apps/crm/src/lib/instagram-oauth-errors.ts apps/crm/src/lib/__tests__/instagram-oauth-errors.test.ts apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx packages/i18n/locales/pt/clients.json packages/i18n/locales/en/clients.json
git commit -m "refactor(instagram): extrai mapeamento de erros do OAuth para módulo compartilhado"
```

---

### Task 9: CRM — service module and the notification type

**Files:**
- Create: `apps/crm/src/services/connectLink.ts`
- Create: `apps/crm/src/services/__tests__/connectLink.test.ts`
- Modify: `apps/crm/src/store/notifications.ts:3-20`
- Modify: `apps/crm/src/lib/notification-config.ts`
- Modify: `packages/i18n/locales/pt/clients.json`, `packages/i18n/locales/en/clients.json`

**Interfaces:**
- Consumes: `supabase` from `../lib/supabase`.
- Produces:
  - `interface ConnectLink { url: string; expires_at: string }`
  - `getConnectLink(clienteId: number): Promise<ConnectLink | null>`
  - `createConnectLink(clienteId: number): Promise<ConnectLink>`
  - `revokeConnectLink(clienteId: number): Promise<void>`
  - `emailConnectLink(clienteId: number, email: string): Promise<void>`
  - `type PublicConnectStatus = 'live' | 'revoked' | 'expired' | 'unavailable' | 'not_found'`
  - `interface PublicConnectInfo { status: PublicConnectStatus; cliente_name: string; workspace_name: string; connected_username: string | null }`
  - `getPublicConnectInfo(token: string): Promise<PublicConnectInfo>`
  - `startPublicConnect(token: string): Promise<string>`

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/services/__tests__/connectLink.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'jwt-1' } } })),
    },
  },
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import {
  createConnectLink,
  getConnectLink,
  getPublicConnectInfo,
  revokeConnectLink,
  startPublicConnect,
} from '../connectLink';

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('connectLink service', () => {
  beforeEach(() => fetchMock.mockReset());

  test('getConnectLink returns null when there is no live link', async () => {
    fetchMock.mockResolvedValue(ok({ link: null }));
    expect(await getConnectLink(42)).toBeNull();
  });

  test('getConnectLink sends the bearer token', async () => {
    fetchMock.mockResolvedValue(ok({ link: { url: 'u', expires_at: 'e' } }));
    expect(await getConnectLink(42)).toEqual({ url: 'u', expires_at: 'e' });
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-1');
  });

  test('createConnectLink posts the cliente_id', async () => {
    fetchMock.mockResolvedValue(ok({ link: { url: 'u', expires_at: 'e' } }));
    await createConnectLink(42);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ cliente_id: 42 });
  });

  test('revokeConnectLink issues a DELETE with the cliente_id in the query', async () => {
    fetchMock.mockResolvedValue(ok({ ok: true }));
    await revokeConnectLink(42);
    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('DELETE');
    expect(String(url)).toContain('cliente_id=42');
  });

  test('createConnectLink throws on a non-ok response', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 403, json: async () => ({ error: 'feature_disabled' }),
    } as unknown as Response);
    await expect(createConnectLink(42)).rejects.toThrow('feature_disabled');
  });

  test('getPublicConnectInfo sends no Authorization header', async () => {
    fetchMock.mockResolvedValue(ok({ status: 'live', cliente_name: 'X', workspace_name: 'Y', connected_username: null }));
    const info = await getPublicConnectInfo('tok');
    expect(info.status).toBe('live');
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>)?.Authorization).toBeUndefined();
  });

  test('getPublicConnectInfo maps a 404 to not_found instead of throwing', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) } as unknown as Response);
    expect((await getPublicConnectInfo('tok')).status).toBe('not_found');
  });

  test('startPublicConnect returns the authorize url', async () => {
    fetchMock.mockResolvedValue(ok({ url: 'https://www.instagram.com/oauth/authorize?x=1' }));
    expect(await startPublicConnect('tok')).toBe('https://www.instagram.com/oauth/authorize?x=1');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm run test -- connectLink
```

Expected: FAIL, cannot resolve `../connectLink`.

- [ ] **Step 3: Write the service**

Create `apps/crm/src/services/connectLink.ts`:

```ts
import { supabase } from '../lib/supabase';

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/instagram-connect-link`;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export interface ConnectLink {
  url: string;
  expires_at: string;
}

export type PublicConnectStatus = 'live' | 'revoked' | 'expired' | 'unavailable' | 'not_found';

export interface PublicConnectInfo {
  status: PublicConnectStatus;
  cliente_name: string;
  workspace_name: string;
  connected_username: string | null;
}

async function authedHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    apikey: ANON,
    Authorization: `Bearer ${session?.access_token}`,
    'Content-Type': 'application/json',
  };
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'Erro na requisição');
  }
  return (await res.json()) as T;
}

export async function getConnectLink(clienteId: number): Promise<ConnectLink | null> {
  const res = await fetch(`${FN_URL}?cliente_id=${clienteId}`, { headers: await authedHeaders() });
  const data = await unwrap<{ link: ConnectLink | null }>(res);
  return data.link;
}

export async function createConnectLink(clienteId: number): Promise<ConnectLink> {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: await authedHeaders(),
    body: JSON.stringify({ cliente_id: clienteId }),
  });
  const data = await unwrap<{ link: ConnectLink }>(res);
  return data.link;
}

export async function revokeConnectLink(clienteId: number): Promise<void> {
  const res = await fetch(`${FN_URL}?cliente_id=${clienteId}`, {
    method: 'DELETE',
    headers: await authedHeaders(),
  });
  await unwrap<{ ok: boolean }>(res);
}

export async function emailConnectLink(clienteId: number, email: string): Promise<void> {
  const res = await fetch(`${FN_URL}/email`, {
    method: 'POST',
    headers: await authedHeaders(),
    body: JSON.stringify({ cliente_id: clienteId, email }),
  });
  await unwrap<{ ok: boolean }>(res);
}

// --- Rotas públicas. Sem Authorization: quem chama é o cliente final, sem login. ---

export async function getPublicConnectInfo(token: string): Promise<PublicConnectInfo> {
  const res = await fetch(`${FN_URL}/public/${encodeURIComponent(token)}`, {
    headers: { apikey: ANON },
  });
  // Um token desconhecido é 404 e é um estado normal da página, não uma exceção.
  if (res.status === 404) {
    return { status: 'not_found', cliente_name: '', workspace_name: '', connected_username: null };
  }
  const data = await unwrap<Partial<PublicConnectInfo> & { status: PublicConnectStatus }>(res);
  return {
    status: data.status,
    cliente_name: data.cliente_name ?? '',
    workspace_name: data.workspace_name ?? '',
    connected_username: data.connected_username ?? null,
  };
}

export async function startPublicConnect(token: string): Promise<string> {
  const res = await fetch(`${FN_URL}/public/${encodeURIComponent(token)}/start`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
  });
  const data = await unwrap<{ url: string }>(res);
  return data.url;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
npm run test -- connectLink
```

Expected: all 8 PASS.

- [ ] **Step 5: Add the notification type to the closed union**

In `apps/crm/src/store/notifications.ts`, add to the `NotificationType` union, after `| 'post_status_automation'`:

```ts
  | 'instagram_connected_by_client';
```

(Move the semicolon so `'post_status_automation'` ends with a newline and the new member carries the `;`.)

- [ ] **Step 6: Add the notification display with a failing test first**

Create `apps/crm/src/lib/__tests__/notification-config.instagram.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { getNotificationDisplay } from '../notification-config';

describe('instagram_connected_by_client notification', () => {
  test('names the client and the connected account', () => {
    const d = getNotificationDisplay('instagram_connected_by_client', {
      client_name: 'Clínica X',
      ig_username: 'clinicax',
    });
    expect(d.title).toBe('Instagram conectado pelo cliente');
    expect(d.body).toBe('Clínica X · @clinicax');
  });

  test('falls back cleanly when metadata is missing', () => {
    const d = getNotificationDisplay('instagram_connected_by_client', {});
    expect(d.body).toBe('Cliente');
  });

  test('no em-dash in the copy', () => {
    const d = getNotificationDisplay('instagram_connected_by_client', {
      client_name: 'Clínica X',
      ig_username: 'clinicax',
    });
    expect(`${d.title}${d.body}`).not.toContain('—');
  });
});
```

Run it:

```bash
npm run test -- notification-config.instagram
```

Expected: FAIL (falls through to the default branch).

Then in `apps/crm/src/lib/notification-config.ts`, add `Instagram` to the `lucide-react` import list and add this case immediately before the `case 'task_assigned':` line:

```tsx
    case 'instagram_connected_by_client': {
      const igUser = s(m.ig_username, '');
      return {
        icon: Instagram,
        tone: 'success',
        title: 'Instagram conectado pelo cliente',
        body: igUser ? `${client} · @${igUser}` : client,
      };
    }
```

Re-run: expected PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run test -- connectLink notification-config.instagram
```

Expected: no type errors, all PASS.

```bash
git add apps/crm/src/services/connectLink.ts apps/crm/src/services/__tests__/connectLink.test.ts apps/crm/src/store/notifications.ts apps/crm/src/lib/notification-config.ts apps/crm/src/lib/__tests__/notification-config.instagram.test.ts
git commit -m "feat(instagram): serviço do link de conexão e notificação de conexão pelo cliente"
```

---

### Task 10: CRM — the public `/conectar/:token` page and its routing

**Files:**
- Create: `apps/crm/src/pages/conectar/ConectarPage.tsx`
- Create: `apps/crm/src/pages/conectar/__tests__/ConectarPage.test.tsx`
- Modify: `apps/crm/src/App.tsx`
- Modify: `apps/crm/src/content/site-meta.ts`
- Modify: `vercel.json`
- Modify: `packages/i18n/locales/pt/clients.json`, `packages/i18n/locales/en/clients.json`

**Interfaces:**
- Consumes: `getPublicConnectInfo`, `startPublicConnect` (Task 9); `resolveIgError` (Task 8).
- Produces: default-exported `ConectarPage` component mounted at `/conectar/:token`.

- [ ] **Step 1: Add the i18n keys**

In `packages/i18n/locales/pt/clients.json`, add a new top-level `connect` object (sibling of `detail`):

```json
  "connect": {
    "title": "Conectar Instagram",
    "intro": "{{agency}} pediu para conectar o Instagram de {{client}} ao Mesaas.",
    "explain": "Ao continuar você entra com a conta do Instagram e autoriza o acesso. Sua senha não é vista nem armazenada pelo Mesaas nem pela agência.",
    "cta": "Conectar Instagram",
    "connecting": "Abrindo o Instagram...",
    "successTitle": "Tudo certo",
    "successBody": "A conta @{{username}} foi conectada. Você já pode fechar esta página.",
    "alreadyTitle": "Já está conectado",
    "alreadyBody": "A conta @{{username}} já está conectada. Nada a fazer aqui.",
    "invalidTitle": "Link inválido",
    "invalidBody": "Este link não existe. Confira o endereço ou peça um novo para a agência.",
    "revokedTitle": "Link revogado",
    "revokedBody": "A agência revogou este link. Peça um novo para continuar.",
    "expiredTitle": "Link expirado",
    "expiredBody": "Este link passou da validade. Peça um novo para a agência.",
    "unavailableTitle": "Indisponível no momento",
    "unavailableBody": "A conexão com o Instagram não está disponível para esta agência agora. Fale com quem enviou o link.",
    "startError": "Não foi possível abrir o Instagram. Tente novamente em alguns instantes."
  },
```

In `packages/i18n/locales/en/clients.json`, the same object with English strings:

```json
  "connect": {
    "title": "Connect Instagram",
    "intro": "{{agency}} asked to connect {{client}}'s Instagram to Mesaas.",
    "explain": "Continuing takes you to Instagram to sign in and authorize access. Neither Mesaas nor the agency sees or stores your password.",
    "cta": "Connect Instagram",
    "connecting": "Opening Instagram...",
    "successTitle": "All set",
    "successBody": "The account @{{username}} is connected. You can close this page.",
    "alreadyTitle": "Already connected",
    "alreadyBody": "The account @{{username}} is already connected. Nothing to do here.",
    "invalidTitle": "Invalid link",
    "invalidBody": "This link does not exist. Check the address or ask your agency for a new one.",
    "revokedTitle": "Link revoked",
    "revokedBody": "The agency revoked this link. Ask for a new one to continue.",
    "expiredTitle": "Link expired",
    "expiredBody": "This link is past its expiry date. Ask your agency for a new one.",
    "unavailableTitle": "Not available right now",
    "unavailableBody": "Instagram connection is not available for this agency at the moment. Contact whoever sent you the link.",
    "startError": "Could not open Instagram. Please try again in a moment."
  },
```

- [ ] **Step 2: Write the failing test**

Create `apps/crm/src/pages/conectar/__tests__/ConectarPage.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const getPublicConnectInfo = vi.fn();
const startPublicConnect = vi.fn();

vi.mock('../../../services/connectLink', () => ({
  getPublicConnectInfo: (...a: unknown[]) => getPublicConnectInfo(...a),
  startPublicConnect: (...a: unknown[]) => startPublicConnect(...a),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

import ConectarPage from '../ConectarPage';

function renderAt(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/conectar/tok-1${search}`]}>
      <Routes>
        <Route path="/conectar/:token" element={<ConectarPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ConectarPage', () => {
  beforeEach(() => {
    getPublicConnectInfo.mockReset();
    startPublicConnect.mockReset();
  });

  test('live link shows both names and the connect button', async () => {
    getPublicConnectInfo.mockResolvedValue({
      status: 'live', cliente_name: 'Clínica X', workspace_name: 'Agência Y', connected_username: null,
    });
    renderAt();
    await waitFor(() => expect(screen.getByRole('button')).toBeInTheDocument());
    expect(screen.getByText(/Clínica X/)).toBeInTheDocument();
    expect(screen.getByText(/Agência Y/)).toBeInTheDocument();
  });

  test('clicking connect navigates to the Instagram url', async () => {
    getPublicConnectInfo.mockResolvedValue({
      status: 'live', cliente_name: 'Clínica X', workspace_name: 'Agência Y', connected_username: null,
    });
    startPublicConnect.mockResolvedValue('https://www.instagram.com/oauth/authorize?x=1');
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign, search: '' },
      writable: true,
    });
    renderAt();
    await waitFor(() => expect(screen.getByRole('button')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button'));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://www.instagram.com/oauth/authorize?x=1'),
    );
  });

  test('revoked link shows the revoked state and no button', async () => {
    getPublicConnectInfo.mockResolvedValue({
      status: 'revoked', cliente_name: '', workspace_name: '', connected_username: null,
    });
    renderAt();
    await waitFor(() => expect(screen.getByText('connect.revokedTitle')).toBeInTheDocument());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('expired link shows the expired state', async () => {
    getPublicConnectInfo.mockResolvedValue({
      status: 'expired', cliente_name: '', workspace_name: '', connected_username: null,
    });
    renderAt();
    await waitFor(() => expect(screen.getByText('connect.expiredTitle')).toBeInTheDocument());
  });

  test('unknown token shows the invalid state', async () => {
    getPublicConnectInfo.mockResolvedValue({
      status: 'not_found', cliente_name: '', workspace_name: '', connected_username: null,
    });
    renderAt();
    await waitFor(() => expect(screen.getByText('connect.invalidTitle')).toBeInTheDocument());
  });

  test('an already-connected account shows the already state', async () => {
    getPublicConnectInfo.mockResolvedValue({
      status: 'live', cliente_name: 'Clínica X', workspace_name: 'Agência Y', connected_username: 'clinicax',
    });
    renderAt();
    await waitFor(() => expect(screen.getByText('connect.alreadyTitle')).toBeInTheDocument());
  });

  test('ig_connected in the url shows success without calling the api again', async () => {
    getPublicConnectInfo.mockResolvedValue({
      status: 'live', cliente_name: 'Clínica X', workspace_name: 'Agência Y', connected_username: 'clinicax',
    });
    renderAt('?ig_connected=new');
    await waitFor(() => expect(screen.getByText('connect.successTitle')).toBeInTheDocument());
  });

  test('ig_error in the url shows the shared error copy', async () => {
    getPublicConnectInfo.mockResolvedValue({
      status: 'live', cliente_name: 'Clínica X', workspace_name: 'Agência Y', connected_username: null,
    });
    renderAt('?ig_error=link_revoked');
    await waitFor(() => expect(screen.getByText('detail.igLinkRevoked')).toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Run the test and verify it fails**

```bash
npm run test -- ConectarPage
```

Expected: FAIL, cannot resolve `../ConectarPage`.

- [ ] **Step 4: Write the page**

Create `apps/crm/src/pages/conectar/ConectarPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Instagram, CircleAlert, CircleCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { resolveIgError } from '../../lib/instagram-oauth-errors';
import {
  getPublicConnectInfo,
  startPublicConnect,
  type PublicConnectInfo,
} from '../../services/connectLink';

/**
 * Página pública do link de conexão. Sem login, alcançável por qualquer pessoa
 * que tenha a URL. Não mostre aqui nada além do nome da agência e do nome do
 * cliente: é tudo o que o endpoint público devolve, de propósito.
 */
export default function ConectarPage() {
  const { token } = useParams<{ token: string }>();
  const { t } = useTranslation('clients');

  const [info, setInfo] = useState<PublicConnectInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(false);

  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const igConnected = params.get('ig_connected');
  const igErrorAction = resolveIgError(params.get('ig_error'));

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setLoading(false);
      return;
    }
    getPublicConnectInfo(token)
      .then((res) => {
        if (!cancelled) setInfo(res);
      })
      .catch(() => {
        if (!cancelled) {
          setInfo({
            status: 'not_found',
            cliente_name: '',
            workspace_name: '',
            connected_username: null,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleConnect = useCallback(async () => {
    if (!token) return;
    setStarting(true);
    setStartError(false);
    try {
      const url = await startPublicConnect(token);
      window.location.assign(url);
    } catch {
      setStartError(true);
      setStarting(false);
    }
  }, [token]);

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-sm">
        {children}
      </div>
    </div>
  );

  if (loading) return shell(<Spinner size="lg" />);

  if (igConnected) {
    return shell(
      <>
        <CircleCheck className="mx-auto mb-4 h-10 w-10 text-[var(--success)]" />
        <h1 className="mb-2 text-xl font-semibold">{t('connect.successTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('connect.successBody', { username: info?.connected_username ?? '' })}
        </p>
      </>,
    );
  }

  const status = info?.status ?? 'not_found';

  if (status !== 'live') {
    const byStatus: Record<string, { title: string; body: string }> = {
      revoked: { title: 'connect.revokedTitle', body: 'connect.revokedBody' },
      expired: { title: 'connect.expiredTitle', body: 'connect.expiredBody' },
      unavailable: { title: 'connect.unavailableTitle', body: 'connect.unavailableBody' },
      not_found: { title: 'connect.invalidTitle', body: 'connect.invalidBody' },
    };
    const copy = byStatus[status] ?? byStatus.not_found;
    return shell(
      <>
        <CircleAlert className="mx-auto mb-4 h-10 w-10 text-[var(--warning)]" />
        <h1 className="mb-2 text-xl font-semibold">{t(copy.title)}</h1>
        <p className="text-sm text-muted-foreground">{t(copy.body)}</p>
      </>,
    );
  }

  if (info?.connected_username) {
    return shell(
      <>
        <CircleCheck className="mx-auto mb-4 h-10 w-10 text-[var(--success)]" />
        <h1 className="mb-2 text-xl font-semibold">{t('connect.alreadyTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('connect.alreadyBody', { username: info.connected_username })}
        </p>
      </>,
    );
  }

  return shell(
    <>
      <Instagram className="mx-auto mb-4 h-10 w-10 text-[var(--primary-color)]" />
      <h1 className="mb-3 text-xl font-semibold">{t('connect.title')}</h1>
      <p className="mb-3 text-sm">
        {t('connect.intro', {
          agency: info?.workspace_name ?? '',
          client: info?.cliente_name ?? '',
        })}
      </p>
      <p className="mb-6 text-sm text-muted-foreground">{t('connect.explain')}</p>

      {igErrorAction?.kind === 'toast' && (
        <p className="mb-4 text-sm text-[var(--danger-text)]">{t(igErrorAction.i18nKey)}</p>
      )}
      {igErrorAction?.kind === 'off_meta' && (
        <p className="mb-4 text-sm text-[var(--danger-text)]">{t('detail.igOffMetaIntro')}</p>
      )}
      {startError && (
        <p className="mb-4 text-sm text-[var(--danger-text)]">{t('connect.startError')}</p>
      )}

      <Button className="w-full" onClick={handleConnect} disabled={starting}>
        {starting ? t('connect.connecting') : t('connect.cta')}
      </Button>
    </>,
  );
}
```

- [ ] **Step 5: Run the tests and verify they pass**

```bash
npm run test -- ConectarPage
```

Expected: all 8 PASS.

- [ ] **Step 6: Register the route in all three places**

In `apps/crm/src/App.tsx`, add the lazy import immediately after the `LoginPage` line (line 17), matching the file's existing default-export lazy style:

```tsx
const ConectarPage = lazy(() => import('./pages/conectar/ConectarPage'));
```

Add the route immediately after the `/login` route (line 126), **outside** the `ProtectedRoute` wrapper that starts around line 170:

```tsx
              <Route path="/conectar/:token" element={<ConectarPage />} />
```

In `apps/crm/src/content/site-meta.ts`, add `'conectar',` to `APP_ROUTE_PREFIXES`, right after `'comecar',`.

In `vercel.json`, add `conectar|` to **both** places the app-route alternation appears: the `X-Robots-Tag` header source and the `/app.html` rewrite source. Both become:

```
/(login|configurar-senha|workspace-setup|comecar|conectar|oauth|dashboard|clientes|financeiro|contratos|leads|equipe|configuracao|calendario|entregas|tarefas|post-express|arquivos|analytics-fluxos|analytics|ideias|mensagens|ajuda|importar)(/.*)?
```

- [ ] **Step 7: Verify the routing guard passes**

```bash
npm run test -- vercel-routing
```

Expected: PASS. A failure here means `conectar` reached only one of `APP_ROUTE_PREFIXES` / `vercel.json`, which is exactly the bug that produces "works in dev, 404 in production".

- [ ] **Step 8: Typecheck and commit**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run test -- ConectarPage vercel-routing
```

Expected: no type errors, all PASS.

```bash
git add apps/crm/src/pages/conectar/ apps/crm/src/App.tsx apps/crm/src/content/site-meta.ts vercel.json packages/i18n/locales/pt/clients.json packages/i18n/locales/en/clients.json
git commit -m "feat(instagram): página pública /conectar/:token"
```

---

### Task 11: CRM — the agency dialog and the client page row

**Files:**
- Create: `apps/crm/src/components/instagram/ConnectLinkDialog.tsx`
- Create: `apps/crm/src/components/instagram/__tests__/ConnectLinkDialog.test.tsx`
- Modify: `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx` (the `InstagramSection` component)
- Modify: `packages/i18n/locales/pt/clients.json`, `packages/i18n/locales/en/clients.json`

**Interfaces:**
- Consumes: `getConnectLink`, `createConnectLink`, `revokeConnectLink`, `emailConnectLink` (Task 9).
- Produces: `ConnectLinkDialog({ clienteId, clienteEmail, open, onOpenChange })`, plus a `ConnectLinkRow({ clienteId, clienteEmail })` exported from the same file and rendered by `InstagramSection`.

- [ ] **Step 1: Add the i18n keys**

In `packages/i18n/locales/pt/clients.json`, inside the `connect` object added in Task 10, add:

```json
    "generate": "Gerar link para o cliente",
    "dialogTitle": "Link de conexão do Instagram",
    "dialogIntro": "Envie este link para o cliente. Ele autoriza o Instagram sem precisar de login no Mesaas.",
    "copy": "Copiar link",
    "copied": "Link copiado",
    "emailLabel": "Enviar por e-mail",
    "emailPlaceholder": "email@cliente.com.br",
    "send": "Enviar",
    "sent": "E-mail enviado",
    "sendError": "Não foi possível enviar o e-mail. Tente novamente.",
    "revoke": "Revogar",
    "revoked": "Link revogado",
    "revokeConfirm": "Revogar este link? Quem já o recebeu não vai mais conseguir usá-lo.",
    "activeUntil": "Link de conexão ativo até {{date}}",
    "generateError": "Não foi possível gerar o link. Tente novamente."
```

In `packages/i18n/locales/en/clients.json`, the English equivalents in the same object:

```json
    "generate": "Generate a link for the client",
    "dialogTitle": "Instagram connection link",
    "dialogIntro": "Send this link to the client. They authorize Instagram without needing a Mesaas login.",
    "copy": "Copy link",
    "copied": "Link copied",
    "emailLabel": "Send by email",
    "emailPlaceholder": "email@client.com",
    "send": "Send",
    "sent": "Email sent",
    "sendError": "Could not send the email. Please try again.",
    "revoke": "Revoke",
    "revoked": "Link revoked",
    "revokeConfirm": "Revoke this link? Anyone who already has it will no longer be able to use it.",
    "activeUntil": "Connection link active until {{date}}",
    "generateError": "Could not generate the link. Please try again."
```

- [ ] **Step 2: Write the failing test**

Create `apps/crm/src/components/instagram/__tests__/ConnectLinkDialog.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const getConnectLink = vi.fn();
const createConnectLink = vi.fn();
const revokeConnectLink = vi.fn();
const emailConnectLink = vi.fn();

vi.mock('../../../services/connectLink', () => ({
  getConnectLink: (...a: unknown[]) => getConnectLink(...a),
  createConnectLink: (...a: unknown[]) => createConnectLink(...a),
  revokeConnectLink: (...a: unknown[]) => revokeConnectLink(...a),
  emailConnectLink: (...a: unknown[]) => emailConnectLink(...a),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

import { ConnectLinkRow } from '../ConnectLinkDialog';

function renderRow(email: string | null = 'c@x.com') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConnectLinkRow clienteId={42} clienteEmail={email} />
    </QueryClientProvider>,
  );
}

describe('ConnectLinkRow', () => {
  beforeEach(() => {
    getConnectLink.mockReset();
    createConnectLink.mockReset();
    revokeConnectLink.mockReset();
    emailConnectLink.mockReset();
  });

  test('with no live link, offers to generate one', async () => {
    getConnectLink.mockResolvedValue(null);
    renderRow();
    await waitFor(() => expect(screen.getByText('connect.generate')).toBeInTheDocument());
    expect(screen.queryByText(/connect\.activeUntil/)).not.toBeInTheDocument();
  });

  test('with a live link, shows the expiry and a revoke action', async () => {
    getConnectLink.mockResolvedValue({
      url: 'https://app.mesaas.com.br/conectar/tok-1',
      expires_at: '2026-09-05T12:00:00.000Z',
    });
    renderRow();
    // O link pendente precisa ser VISÍVEL sem abrir nada: a agência não revoga
    // o que não sabe que existe.
    await waitFor(() => expect(screen.getByText(/connect\.activeUntil/)).toBeInTheDocument());
    expect(screen.getByText('connect.revoke')).toBeInTheDocument();
  });

  test('revoking calls the service and clears the row', async () => {
    getConnectLink.mockResolvedValue({
      url: 'https://app.mesaas.com.br/conectar/tok-1',
      expires_at: '2026-09-05T12:00:00.000Z',
    });
    revokeConnectLink.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderRow();
    await waitFor(() => expect(screen.getByText('connect.revoke')).toBeInTheDocument());
    getConnectLink.mockResolvedValue(null);
    await userEvent.click(screen.getByText('connect.revoke'));
    await waitFor(() => expect(revokeConnectLink).toHaveBeenCalledWith(42));
  });

  test('declining the confirm does not revoke', async () => {
    getConnectLink.mockResolvedValue({
      url: 'https://app.mesaas.com.br/conectar/tok-1',
      expires_at: '2026-09-05T12:00:00.000Z',
    });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderRow();
    await waitFor(() => expect(screen.getByText('connect.revoke')).toBeInTheDocument());
    await userEvent.click(screen.getByText('connect.revoke'));
    expect(revokeConnectLink).not.toHaveBeenCalled();
  });

  test('generating calls the service', async () => {
    getConnectLink.mockResolvedValue(null);
    createConnectLink.mockResolvedValue({
      url: 'https://app.mesaas.com.br/conectar/tok-2',
      expires_at: '2026-09-05T12:00:00.000Z',
    });
    renderRow();
    await waitFor(() => expect(screen.getByText('connect.generate')).toBeInTheDocument());
    await userEvent.click(screen.getByText('connect.generate'));
    await waitFor(() => expect(createConnectLink).toHaveBeenCalledWith(42));
  });
});
```

- [ ] **Step 3: Run the test and verify it fails**

```bash
npm run test -- ConnectLinkDialog
```

Expected: FAIL, cannot resolve `../ConnectLinkDialog`.

- [ ] **Step 4: Write the component**

Create `apps/crm/src/components/instagram/ConnectLinkDialog.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Copy, Link2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  createConnectLink,
  emailConnectLink,
  getConnectLink,
  revokeConnectLink,
  type ConnectLink,
} from '../../services/connectLink';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-BR');
  } catch {
    return iso;
  }
}

/**
 * Linha compacta na seção de Instagram da página do cliente.
 *
 * Um link reutilizável de 30 dias é uma credencial de vida longa que pode ficar
 * parada num grupo de WhatsApp. A mitigação é justamente esta linha: o link
 * pendente fica VISÍVEL, com a validade e o botão de revogar ao lado, sem que
 * ninguém precise abrir um diálogo para lembrar que ele existe.
 */
export function ConnectLinkRow({
  clienteId,
  clienteEmail,
}: {
  clienteId: number;
  clienteEmail: string | null;
}) {
  const { t } = useTranslation('clients');
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: link } = useQuery({
    queryKey: ['connect-link', clienteId],
    queryFn: () => getConnectLink(clienteId),
  });

  const generate = useMutation({
    mutationFn: () => createConnectLink(clienteId),
    onSuccess: (created: ConnectLink) => {
      qc.setQueryData(['connect-link', clienteId], created);
      setOpen(true);
    },
    onError: () => toast.error(t('connect.generateError')),
  });

  const revoke = useMutation({
    mutationFn: () => revokeConnectLink(clienteId),
    onSuccess: () => {
      qc.setQueryData(['connect-link', clienteId], null);
      setOpen(false);
      toast.success(t('connect.revoked'));
    },
  });

  const handleRevoke = () => {
    if (!window.confirm(t('connect.revokeConfirm'))) return;
    revoke.mutate();
  };

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {link ? (
          <>
            <span className="text-sm text-muted-foreground">
              {t('connect.activeUntil', { date: formatDate(link.expires_at) })}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
              <Link2 className="mr-1.5 h-4 w-4" />
              {t('connect.dialogTitle')}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleRevoke} disabled={revoke.isPending}>
              {t('connect.revoke')}
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
          >
            <Link2 className="mr-1.5 h-4 w-4" />
            {t('connect.generate')}
          </Button>
        )}
      </div>

      {link && (
        <ConnectLinkDialog
          clienteId={clienteId}
          clienteEmail={clienteEmail}
          link={link}
          open={open}
          onOpenChange={setOpen}
          onRevoke={handleRevoke}
        />
      )}
    </>
  );
}

export function ConnectLinkDialog({
  clienteId,
  clienteEmail,
  link,
  open,
  onOpenChange,
  onRevoke,
}: {
  clienteId: number;
  clienteEmail: string | null;
  link: ConnectLink;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRevoke: () => void;
}) {
  const { t } = useTranslation('clients');
  const [email, setEmail] = useState(clienteEmail ?? '');

  const send = useMutation({
    mutationFn: () => emailConnectLink(clienteId, email.trim()),
    onSuccess: () => toast.success(t('connect.sent')),
    onError: () => toast.error(t('connect.sendError')),
  });

  const copy = async () => {
    await navigator.clipboard.writeText(link.url);
    toast.success(t('connect.copied'));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('connect.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('connect.dialogIntro')}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
          <Button variant="outline" onClick={copy}>
            <Copy className="mr-1.5 h-4 w-4" />
            {t('connect.copy')}
          </Button>
        </div>

        <div className="mt-2">
          <label className="mb-1.5 block text-sm font-medium">{t('connect.emailLabel')}</label>
          <div className="flex gap-2">
            <Input
              type="email"
              value={email}
              placeholder={t('connect.emailPlaceholder')}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button onClick={() => send.mutate()} disabled={send.isPending || !email.trim()}>
              <Mail className="mr-1.5 h-4 w-4" />
              {t('connect.send')}
            </Button>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {t('connect.activeUntil', { date: formatDate(link.expires_at) })}
          </span>
          <Button variant="ghost" size="sm" onClick={onRevoke}>
            {t('connect.revoke')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Run the tests and verify they pass**

```bash
npm run test -- ConnectLinkDialog
```

Expected: all 5 PASS.

- [ ] **Step 6: Mount the row in the client page**

In `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx`, add to the imports:

```tsx
import { ConnectLinkRow } from '../../components/instagram/ConnectLinkDialog';
```

Extend the `InstagramSection` props type with `clienteEmail`:

```tsx
export function InstagramSection({
  clienteId,
  clienteEmail,
  loadingIg,
  igSummary,
  refetchIg,
  onNavigateAnalytics,
}: {
  clienteId: number;
  clienteEmail: string | null;
  loadingIg: boolean;
  igSummary: any;
  refetchIg: () => void;
  onNavigateAnalytics: () => void;
}) {
```

Inside the returned JSX, immediately after the `<div ref={igConnectRef} />` element (add that element's sibling, not a replacement), render the row so it appears both when connected and when not:

```tsx
      {!loadingIg && !isNaN(clienteId) && (
        <ConnectLinkRow clienteId={clienteId} clienteEmail={clienteEmail} />
      )}
```

At the `<InstagramSection ... />` call site (around line 1520), add the prop between `clienteId` and `loadingIg`:

```tsx
        clienteEmail={cliente?.email ?? null}
```

`cliente` is already in scope at line 415 (`const cliente: Cliente | undefined = (clientes ?? []).find((c) => c.id === clienteId);`), and `email` is in `CLIENTE_SAFE_COLUMNS` in `apps/crm/src/store/clients.ts:59`, so it is actually populated. Before the roster query resolves, `cliente` is `undefined` and the prop is `null`; the dialog then starts with an empty email field, which is fine.

- [ ] **Step 7: Verify in the browser**

Start the CRM against staging:

```bash
cp ../../../.env.staging . 2>/dev/null; npm run dev:staging
```

Note: worktrees do not carry `.env.staging`. Without it, `npm run dev:staging` silently hits **production**. Copy it first, and confirm the Supabase URL in the browser's network tab is the staging project before clicking anything.

Then, using the preview browser tools: open a client that has no Instagram connected, click "Gerar link para o cliente", confirm the dialog shows a URL and an expiry, copy it, open it in a fresh tab, and confirm the public page renders the agency and client names with a working button. Then click "Revogar" and reload the public page: it must show the revoked state.

- [ ] **Step 8: Typecheck, lint, format and commit**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run lint
npm run format
npm run test
npm run test:functions
git checkout -- deno.lock
```

Expected: all green.

```bash
git add apps/crm/src/components/instagram/ apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx packages/i18n/locales/pt/clients.json packages/i18n/locales/en/clients.json
git commit -m "feat(instagram): diálogo do link de conexão e revogação na página do cliente"
```

---

## Before opening the PR

- [ ] Re-verify the migration prefix against main. It moves while you work:

```bash
git ls-tree --name-only origin/main supabase/migrations/ | tail -3
```

If anything on main now shares your prefix, rename your file to the next free number. Two files with the same version prefix collide in `schema_migrations` and the second is silently skipped.

- [ ] Confirm `APP_BASE_URL` is set on both Supabase projects. Without it, link generation throws:

```bash
npx supabase secrets list | grep APP_BASE_URL
```

- [ ] Confirm which project is linked before any push. The link state flips between worktrees:

```bash
cat supabase/.temp/project-ref
```

Staging is `wlyzhyfondykzpsiqsce`, production is `skjzpekeqefvlojenfsw`.

- [ ] Full gate:

```bash
npm run lint && npm run format:check && npm run test && npm run test:functions
git checkout -- deno.lock
```

## Deploy, after merge

Order matters. The migration must land before the functions, and both must land
before the CRM, or a client who opens a link hits a function that queries a table
that does not exist yet.

- [ ] **Staging first.** Confirm the link, then push the migration:

```bash
cat supabase/.temp/project-ref
```

Expected: `wlyzhyfondykzpsiqsce`. Then:

```bash
npx supabase db push --linked
```

- [ ] Deploy both functions to staging. `--use-api` because the local Docker bundler is broken; `--no-verify-jwt` because both handle their own auth:

```bash
npx supabase functions deploy instagram-connect-link --no-verify-jwt --use-api
```

```bash
npx supabase functions deploy instagram-integration --no-verify-jwt --use-api
```

- [ ] **End-to-end on staging, in a private window.** This is the only place the "no login required" claim is actually proven, because a normal window carries your CRM session and will hide a bug where the page depends on it. Generate a link, open it privately, complete the Instagram authorization, and confirm: the public page shows the success screen, the client page shows the connected account, the notification appears in the bell, and the email arrives.

- [ ] **Production.** Re-check the link (it flips between worktrees), then repeat the migration and both function deploys:

```bash
cat supabase/.temp/project-ref
```

Expected: `skjzpekeqefvlojenfsw`.

- [ ] The CRM ships with the Vercel build on merge. No separate step, but the public route only exists in production once that build is live, so do not send a real client a link before the deploy finishes.

- [ ] Verify the `used_at` and `revoked_at` columns are actually moving after the first real use:

```bash
npx supabase db query "select cliente_id, expires_at, revoked_at, used_at from instagram_connect_links order by created_at desc limit 5;"
```
