# HTTP, URL, and Dependency Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent unexpected server details and unsafe external URLs from reaching users, and remove known High production dependency advisories.

**Architecture:** Extend the existing Edge JSON helper with one generic internal-error path, apply it only to unexpected 500 responses, and retain explicit domain codes. Give each frontend app one canonical URL policy and route every identified external link/new-window call through it.

**Tech Stack:** Deno Edge Functions, React 19, TypeScript, Vitest, npm audit.

## Global Constraints

- Never expose raw database/API exception messages in unexpected 500 responses.
- Preserve `quota_exceeded`, `plan_limit_exceeded`, validation, auth, conflict, and token-expiry codes.
- External navigation allows only credential-free `http:` and `https:` URLs.
- CRM relative application paths remain allowed; protocol-relative URLs remain blocked.
- Every `_blank` navigation uses `noopener,noreferrer`.
- No unrelated major dependency upgrades.
- Every production change starts with a failing focused test.

---

### Task 1: Add a Shared Unexpected-error Response

**Files:**
- Modify: `supabase/functions/_shared/http.ts`
- Create: `supabase/functions/__tests__/http-errors_test.ts`

**Interfaces:**
- Produces: `internalServerError(json, scope, error): Response`.
- Consumes: the responder returned by `createJsonResponder(cors)`.

- [ ] **Step 1: Write the failing test**

```ts
import { assertEquals } from "./assert.ts";
import { createJsonResponder, internalServerError } from "../_shared/http.ts";

Deno.test("internalServerError logs details but returns a generic payload", async () => {
  const calls: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => calls.push(args);
  try {
    const json = createJsonResponder({ "Access-Control-Allow-Origin": "https://app.example" });
    const response = internalServerError(json, "test-scope", new Error("db password leaked"));
    assertEquals(response.status, 500);
    assertEquals(await response.json(), { error: "Internal server error" });
    assertEquals(calls.length, 1);
    assertEquals(String(calls[0][0]).includes("test-scope"), true);
  } finally {
    console.error = original;
  }
});
```

- [ ] **Step 2: Run and verify RED**

```bash
deno test --no-check supabase/functions/__tests__/http-errors_test.ts
```

Expected: FAIL because `internalServerError` is not exported.

- [ ] **Step 3: Implement the helper**

```ts
export type JsonResponder = (body: unknown, status?: number) => Response;

export function createJsonResponder(cors: Record<string, string>): JsonResponder {
  return (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
}

export function internalServerError(
  json: JsonResponder,
  scope: string,
  error: unknown,
): Response {
  console.error(`[${scope}] unexpected error`, error);
  return json({ error: "Internal server error" }, 500);
}
```

- [ ] **Step 4: Verify GREEN and commit**

```bash
deno test --no-check supabase/functions/__tests__/http-errors_test.ts
git add supabase/functions/_shared/http.ts supabase/functions/__tests__/http-errors_test.ts
git commit -m "fix(api): add generic internal error responder"
```

---

### Task 2: Remove Raw 500 Details from Interactive Functions

**Files:**
- Modify: `supabase/functions/file-manage/handler.ts`
- Modify: `supabase/functions/file-upload-finalize/handler.ts`
- Modify: `supabase/functions/post-media-manage/handler.ts`
- Modify: `supabase/functions/hub-briefing/handler.ts`
- Modify: `supabase/functions/hub-ideias/handler.ts`
- Modify: `supabase/functions/instagram-publish/handler.ts`
- Modify: `supabase/functions/instagram-report-generator/index.ts`
- Modify: `supabase/functions/instagram-analytics/index.ts`
- Modify: `supabase/functions/invite-user/index.ts`
- Modify: `supabase/functions/__tests__/file-manage_test.ts`
- Modify: `supabase/functions/__tests__/file-upload-finalize_test.ts`
- Modify: `supabase/functions/__tests__/post-media-manage_test.ts`
- Modify: `supabase/functions/__tests__/hub-briefing_test.ts`
- Modify: `supabase/functions/__tests__/hub-functions_test.ts`
- Create: `supabase/functions/__tests__/interactive-error-contract_test.ts`

**Interfaces:**
- Consumes: `internalServerError` from Task 1.
- Produces: `{ error: "Internal server error" }` for unexpected interactive 500 responses.

- [ ] **Step 1: Tighten existing handler assertions**

For each queued database failure, parse the response and add the same assertion:

```ts
assertEquals(response.status, 500);
assertEquals(await response.json(), { error: "Internal server error" });
```

Cover at minimum folder insert, file-link finalize, post cover RPC, Hub briefing query, and Hub idea insert.

- [ ] **Step 2: Add a source-level leak guard for large entrypoints**

```ts
import { assertEquals } from "./assert.ts";

const files = [
  "../instagram-publish/handler.ts",
  "../instagram-report-generator/index.ts",
  "../instagram-analytics/index.ts",
  "../invite-user/index.ts",
];

Deno.test("interactive 500 responses do not interpolate raw exception messages", async () => {
  for (const relative of files) {
    const source = await Deno.readTextFile(new URL(relative, import.meta.url));
    assertEquals(source.includes("message: err.message ||"), false, relative);
    assertEquals(source.includes("error: err.message ??"), false, relative);
    assertEquals(source.includes("Erro interno do servidor: ${detail}"), false, relative);
  }
});
```

- [ ] **Step 3: Run tests and verify RED**

```bash
deno test --no-check --allow-env --allow-read supabase/functions/__tests__/http-errors_test.ts supabase/functions/__tests__/file-manage_test.ts supabase/functions/__tests__/file-upload-finalize_test.ts supabase/functions/__tests__/post-media-manage_test.ts supabase/functions/__tests__/hub-briefing_test.ts supabase/functions/__tests__/hub-functions_test.ts supabase/functions/__tests__/interactive-error-contract_test.ts
```

Expected: the generic payload assertions and source guard FAIL.

- [ ] **Step 4: Replace only unexpected 500 branches**

Import `internalServerError` beside `createJsonResponder` and replace responses such as:

```ts
if (createErr) return internalServerError(json, "file-manage:create-folder", createErr);
if (qErr) return internalServerError(json, "hub-briefing:list-questions", qErr);
if (error) return internalServerError(json, "hub-ideias:create", error);
```

Apply a unique scope label to every replacement. Keep domain branches intact, including:

```ts
return json({ error: "quota_exceeded", used, quota }, 413);
return json({ error: "plan_limit_exceeded", resource }, 403);
return json({ error: "Validação falhou", details: validation.errors }, 422);
```

For functions without `createJsonResponder`, return their existing JSON shape with generic copy. `instagram-analytics` retains `code: "TOKEN_EXPIRED"` and a 401 for token expiry, but uses a generic 500 for all unexpected errors. `instagram-publish` may persist a bounded operational failure internally, but its HTTP 500 must be generic.

- [ ] **Step 5: Verify GREEN and commit**

```bash
deno test --no-check --allow-env --allow-read supabase/functions/__tests__/http-errors_test.ts supabase/functions/__tests__/file-manage_test.ts supabase/functions/__tests__/file-upload-finalize_test.ts supabase/functions/__tests__/post-media-manage_test.ts supabase/functions/__tests__/hub-briefing_test.ts supabase/functions/__tests__/hub-functions_test.ts supabase/functions/__tests__/interactive-error-contract_test.ts
git add supabase/functions/_shared/http.ts supabase/functions/file-manage/handler.ts supabase/functions/file-upload-finalize/handler.ts supabase/functions/post-media-manage/handler.ts supabase/functions/hub-briefing/handler.ts supabase/functions/hub-ideias/handler.ts supabase/functions/instagram-publish/handler.ts supabase/functions/instagram-report-generator/index.ts supabase/functions/instagram-analytics/index.ts supabase/functions/invite-user/index.ts supabase/functions/__tests__
git commit -m "fix(api): hide interactive server error details"
```

---

### Task 3: Canonicalize External URL Safety

**Files:**
- Modify: `apps/crm/src/utils/security.ts`
- Modify: `apps/crm/src/router.ts`
- Create: `apps/crm/src/utils/__tests__/security.test.ts`
- Create: `apps/hub/src/lib/security.ts`
- Create: `apps/hub/src/lib/__tests__/security.test.ts`
- Create: `apps/admin/src/lib/security.ts`
- Create: `apps/admin/src/lib/__tests__/security.test.ts`
- Modify: `apps/hub/src/pages/PaginaPage.tsx`
- Modify: `apps/hub/src/pages/MarcaPage.tsx`
- Modify: `apps/hub/src/pages/IdeiasPage.tsx`
- Modify: `apps/hub/src/components/PostCard.tsx`
- Modify: `apps/hub/src/components/OpenPostLink.tsx`
- Modify: `apps/hub/src/components/InstagramPostCard.tsx`
- Modify: `apps/hub/src/components/dashboard/TopPostsRow.tsx`
- Modify: `apps/admin/src/pages/WorkspaceDetailPage.tsx`
- Modify: `apps/crm/src/pages/cliente-detalhe/HubTab.tsx`
- Modify: `apps/crm/src/pages/arquivos/ArquivosPage.tsx`
- Modify: `apps/crm/src/pages/arquivos/components/FileContextMenu.tsx`
- Modify: `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx`

**Interfaces:**
- Produces in each app: `sanitizeExternalUrl(value): string` returning `#` for unsafe input.
- CRM additionally produces `sanitizeUrl(value)` for safe relative app paths and `openExternalUrl(value)` for isolated windows.

- [ ] **Step 1: Write the sanitizer matrix tests**

```ts
it.each([
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "//evil.example/path",
  "https://user:password@example.com/private",
  "not a url",
])("blocks unsafe external URL %s", (value) => {
  expect(sanitizeExternalUrl(value)).toBe("#");
});

it("allows credential-free HTTP(S)", () => {
  expect(sanitizeExternalUrl("https://example.com/a?q=1")).toBe("https://example.com/a?q=1");
});
```

For CRM add:

```ts
expect(sanitizeUrl("/clientes/42")).toBe("/clientes/42");
expect(sanitizeUrl("//evil.example")).toBe("#");
```

- [ ] **Step 2: Run tests and verify RED**

```bash
npm run test -- apps/crm/src/utils/__tests__/security.test.ts apps/hub/src/lib/__tests__/security.test.ts apps/admin/src/lib/__tests__/security.test.ts
```

Expected: FAIL because Hub/Admin canonical modules do not exist and CRM allows URL credentials.

- [ ] **Step 3: Implement the canonical policy**

Use this external implementation in Hub/Admin and as the absolute branch in CRM:

```ts
export function sanitizeExternalUrl(value: string | null | undefined): string {
  if (!value) return "#";
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (url.username || url.password) return "#";
    return url.protocol === "http:" || url.protocol === "https:" ? trimmed : "#";
  } catch {
    return "#";
  }
}
```

CRM `sanitizeUrl` first accepts `/`, `./`, `../`, and `#` while rejecting `//`, then delegates absolute input to `sanitizeExternalUrl`. Make `router.ts` re-export `sanitizeUrl` instead of duplicating it. Implement CRM isolated windows as:

```ts
export function openExternalUrl(value: string | null | undefined): Window | null {
  const safe = sanitizeExternalUrl(value);
  if (safe === "#") return null;
  return window.open(safe, "_blank", "noopener,noreferrer");
}
```

- [ ] **Step 4: Route every identified external link through the helpers**

Use `href={sanitizeExternalUrl(value)}` in the listed Hub/Admin components and `href={sanitizeUrl(value)}` in CRM. Replace each dynamic `window.open(value, "_blank")` in the listed CRM files with `openExternalUrl(value)`. Preserve `rel="noopener noreferrer"` on anchors.

Add component assertions to existing PaginaPage and TopPostsRow tests that a `javascript:` URL renders as `href="#"`. The Admin utility matrix plus `build:admin` covers WorkspaceDetail because that page has no existing component-test harness.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npm run test -- apps/crm/src/utils/__tests__/security.test.ts apps/hub/src/lib/__tests__/security.test.ts apps/admin/src/lib/__tests__/security.test.ts apps/hub/src/pages/__tests__/contentPages.test.tsx apps/hub/src/components/__tests__/TopPostsRow.test.tsx
npm run build
npm run build:hub
npm run build:admin
git add apps/crm/src apps/hub/src apps/admin/src
git commit -m "fix(security): sanitize external navigation URLs"
```

---

### Task 4: Update Vulnerable Production Dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: current dependency ranges.
- Produces: an audit report with no known High production advisories for `react-router`, `react-router-dom`, or `ws`.

- [ ] **Step 1: Capture the failing audit**

```bash
npm audit --omit=dev
```

Expected before update: non-zero exit with High advisories involving `react-router` and `ws`.

- [ ] **Step 2: Update only compatible dependency lines**

```bash
npm update react-router-dom @supabase/supabase-js ws
```

Inspect `git diff -- package.json package-lock.json`; reject unrelated major upgrades.

- [ ] **Step 3: Verify the audit and application compatibility**

```bash
npm audit --omit=dev
npm run test -- apps/hub/src/__tests__/router.test.tsx
npm run build
npm run build:hub
npm run build:admin
```

Expected: audit exits zero for the three known production advisories; tests and builds PASS. If an unrelated advisory remains, record its package/path/severity in the final report instead of forcing a major upgrade.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "fix(deps): update vulnerable production packages"
```
