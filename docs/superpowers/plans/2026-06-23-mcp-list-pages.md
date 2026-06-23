# `list_pages` MCP Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only MCP tool `list_pages` that exposes client Hub pages (`hub_pages`) as flattened markdown to agents connected to the Mesaas MCP server.

**Architecture:** A new pure helper `pageContentToMarkdown` (in `mcp/content.ts`) flattens the JSONB block array into a markdown string; a new query `listPages` (in `mcp/queries.ts`) reads `hub_pages` scoped to the workspace and maps content through the helper; one `register()` call in `mcp/tools.ts` wires it up with the existing `clientes:read` scope and automatic audit logging.

**Tech Stack:** Deno edge function (Supabase), `npm:zod@3`, `npm:@supabase/supabase-js@2`, Deno test runner.

## Global Constraints

- **Deno, not Node.** Edge function code; imports use `npm:` specifiers or relative `.ts` paths.
- **Workspace isolation:** every query MUST filter `.eq("conta_id", d.ctx.conta_id)`. `hub_pages` has a `conta_id` column directly (unlike `ideias`, which uses `workspace_id`).
- **No raw error detail to clients** — handled by the `register()` wrapper (`errorResult` returns generic messages, logs internally).
- **Scope:** the new tool uses the existing `clientes:read` scope. No changes to `MCP_ALLOWED_SCOPES`, the key-creation UI, the admin UI, or OAuth consent scopes.
- **Output column name:** keep the raw `cliente_id` (matches `list_ideas`), do not rename to `client_id`.
- **`pageContentToMarkdown` fails closed:** `content` is JSONB (`unknown`); trust neither the top-level value nor any block's shape. Malformed input → `""`.
- **Deno-lock gotcha:** running `deno test` / `deno check` can modify `deno.lock` and `node_modules`, which can later break `npm run build`. This plan does not touch the frontend build, but if `git status` shows `deno.lock` changed and a later step needs `npm run build`, run `git checkout deno.lock && npm ci`.

---

### Task 1: `pageContentToMarkdown` pure helper

**Files:**
- Modify: `supabase/functions/mcp/content.ts` (append new exported function)
- Test: `supabase/functions/__tests__/mcp-content_test.ts` (add import + two `Deno.test` blocks)

**Interfaces:**
- Consumes: nothing (pure function over `unknown`)
- Produces: `pageContentToMarkdown(content: unknown): string`

- [ ] **Step 1: Write the failing tests**

In `supabase/functions/__tests__/mcp-content_test.ts`, add `pageContentToMarkdown` to the existing import from `../mcp/content.ts` (keep alphabetical order):

```ts
import {
  allowlistClient,
  deriveFormatMeta,
  firstLine,
  pageContentToMarkdown,
  performanceTier,
  quartiles,
} from "../mcp/content.ts";
```

Then append these two test blocks at the end of the file:

```ts
Deno.test("pageContentToMarkdown renders block types", () => {
  // markdown passthrough
  assertEquals(
    pageContentToMarkdown([{ type: "markdown", content: "## Estratégia\n- um" }]),
    "## Estratégia\n- um",
  );
  // heading levels + clamp
  assertEquals(pageContentToMarkdown([{ type: "heading", content: "T", level: 1 }]), "# T");
  assertEquals(pageContentToMarkdown([{ type: "heading", content: "T", level: 2 }]), "## T");
  assertEquals(pageContentToMarkdown([{ type: "heading", content: "T", level: 3 }]), "### T");
  assertEquals(pageContentToMarkdown([{ type: "heading", content: "T" }]), "# T"); // absent → 1
  assertEquals(pageContentToMarkdown([{ type: "heading", content: "T", level: 0 }]), "# T"); // clamp low
  assertEquals(pageContentToMarkdown([{ type: "heading", content: "T", level: 7 }]), "### T"); // clamp high
  // link with/without href
  assertEquals(
    pageContentToMarkdown([{ type: "link", content: "Brief", href: "https://x" }]),
    "[Brief](https://x)",
  );
  assertEquals(pageContentToMarkdown([{ type: "link", content: "Brief" }]), "Brief");
  // image (content is the URL)
  assertEquals(
    pageContentToMarkdown([{ type: "image", content: "https://img/x.png" }]),
    "![](https://img/x.png)",
  );
  // paragraph + blank-line join
  assertEquals(
    pageContentToMarkdown([
      { type: "paragraph", content: "um" },
      { type: "paragraph", content: "dois" },
    ]),
    "um\n\ndois",
  );
  // unknown type → paragraph fallback (mirrors Hub renderer default case)
  assertEquals(pageContentToMarkdown([{ type: "callout", content: "nota" }]), "nota");
});

Deno.test("pageContentToMarkdown fails closed on bad input", () => {
  // empty / non-array top-level
  assertEquals(pageContentToMarkdown([]), "");
  assertEquals(pageContentToMarkdown(null), "");
  assertEquals(pageContentToMarkdown(undefined), "");
  assertEquals(pageContentToMarkdown("nope"), "");
  assertEquals(pageContentToMarkdown(42), "");
  // malformed blocks: non-object skipped, non-string content contributes nothing
  assertEquals(
    pageContentToMarkdown(["str", 1, null, { type: "paragraph", content: 5 }]),
    "",
  );
  // non-string type → falls back to paragraph branch, renders its text
  assertEquals(pageContentToMarkdown([{ type: 123, content: "texto" }]), "texto");
  // empty image content skipped
  assertEquals(pageContentToMarkdown([{ type: "image", content: "" }]), "");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/mcp-content_test.ts
```
Expected: FAIL to load — `The requested module '../mcp/content.ts' does not provide an export named 'pageContentToMarkdown'`.

- [ ] **Step 3: Implement the helper**

Append to `supabase/functions/mcp/content.ts`:

```ts
/**
 * Flatten the JSONB `hub_pages.content` block array into a single markdown string
 * for agent consumption. Boundary-safe: `content` is JSONB (`unknown`), so this
 * trusts neither the top-level value nor the shape of any block, and fails closed
 * (returns "") on anything malformed. Unknown block types fall back to rendering
 * their text as a paragraph, mirroring the Hub page renderer's default case
 * (apps/hub/src/pages/PaginaPage.tsx).
 */
export function pageContentToMarkdown(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as Record<string, unknown>;
    const type = typeof b.type === "string" ? b.type : "";
    const text = typeof b.content === "string" ? b.content : "";
    const href = typeof b.href === "string" ? b.href : "";
    switch (type) {
      case "markdown":
      case "paragraph":
        if (text) parts.push(text);
        break;
      case "heading": {
        if (!text) break;
        const lvl = Math.min(3, Math.max(1, Math.trunc(Number(b.level)) || 1));
        parts.push(`${"#".repeat(lvl)} ${text}`);
        break;
      }
      case "link":
        if (text) parts.push(href ? `[${text}](${href})` : text);
        break;
      case "image":
        if (text) parts.push(`![](${text})`);
        break;
      default:
        // Unknown type → render text as a paragraph (mirror Hub fallback).
        if (text) parts.push(text);
        break;
    }
  }
  return parts.join("\n\n").trim();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/mcp-content_test.ts
```
Expected: PASS (`pageContentToMarkdown renders block types ... ok`, `pageContentToMarkdown fails closed on bad input ... ok`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/mcp/content.ts supabase/functions/__tests__/mcp-content_test.ts
git commit -m "feat(mcp): pageContentToMarkdown helper for hub_pages content"
```

---

### Task 2: `listPages` query + `list_pages` tool registration

**Files:**
- Modify: `supabase/functions/mcp/queries.ts` (add `pageContentToMarkdown` to the `content.ts` import; append `listPages`)
- Modify: `supabase/functions/mcp/tools.ts` (add `listPages` to the `queries.ts` import; add one `register()` call)

**Interfaces:**
- Consumes: `pageContentToMarkdown(content: unknown): string` (Task 1); `Deps` (existing, `queries.ts:20`); `register(...)` (existing, `tools.ts:42`)
- Produces: `listPages(d: Deps, args: { client_id?: number }): Promise<any[]>`; MCP tool `list_pages`

- [ ] **Step 1: Add the query**

In `supabase/functions/mcp/queries.ts`, add `pageContentToMarkdown` to the existing import block from `./content.ts` (keep alphabetical order):

```ts
import {
  allowlistClient,
  CLIENT_PUBLIC_FIELDS,
  deriveFormatMeta,
  firstLine,
  pageContentToMarkdown,
  performanceTier,
  quartiles,
  Quartiles,
} from "./content.ts";
```

Append at the end of `supabase/functions/mcp/queries.ts`:

```ts
// ---- pages -------------------------------------------------------------------

export async function listPages(
  d: Deps,
  args: { client_id?: number },
): Promise<any[]> {
  let q = d.db
    .from("hub_pages")
    .select("id, cliente_id, title, content, display_order, created_at")
    .eq("conta_id", d.ctx.conta_id);
  if (args.client_id !== undefined) q = q.eq("cliente_id", args.client_id);
  const { data, error } = await q
    .order("cliente_id")
    .order("display_order")
    .order("created_at");
  if (error) throw error;
  return ((data ?? []) as any[]).map((row) => ({
    ...row,
    content: pageContentToMarkdown(row.content),
  }));
}
```

- [ ] **Step 2: Register the tool**

In `supabase/functions/mcp/tools.ts`, add `listPages` to the existing import from `./queries.ts` (keep alphabetical order):

```ts
import {
  Deps,
  getBrandProfile,
  getClient,
  getPerformanceBaseline,
  getPost,
  listClients,
  listIdeas,
  listPages,
  listPosts,
  listWorkflows,
} from "./queries.ts";
```

Inside `registerTools`, after the `list_ideas` registration (the last one, ends at line 113) and before the closing `}`, add:

```ts
  register(server, deps, "list_pages", "clientes:read",
    "Lista as páginas de conteúdo (estratégia, materiais) dos clientes do workspace.",
    { client_id: z.number().int().optional() },
    (a) => listPages(deps, a));
```

- [ ] **Step 3: Typecheck the MCP module**

The query helper has no unit test by codebase convention (matches `listIdeas` et al.), so verification is a typecheck of the whole module graph plus the full suite.

Run:
```bash
deno check --node-modules-dir=auto supabase/functions/mcp/index.ts
```
(The `--node-modules-dir=auto` flag is required — without it, plain `deno check`
fails resolving `npm:@modelcontextprotocol/sdk`, a pre-existing environment quirk
the repo's `test:functions` script works around the same way.)
Expected: no output / exit 0 (no type errors). `index.ts` imports `tools.ts` → `queries.ts` → `content.ts`, so this checks all changed files.

- [ ] **Step 4: Run the full edge-function test suite**

Run:
```bash
npm run test:functions
```
Expected: PASS — all existing tests plus the two `pageContentToMarkdown` tests from Task 1. No failures.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/mcp/queries.ts supabase/functions/mcp/tools.ts
git commit -m "feat(mcp): add list_pages tool exposing client hub pages"
```

---

### Task 3: Rollout (deploy) — requires explicit go-ahead

**Files:** none (operational step)

**Interfaces:** none

> ⚠️ Outward-facing/prod change. Do NOT run without the user's explicit confirmation and the target project (prod ref `skjzpekeqefvlojenfsw`). The `mcp` function handles its own auth, so it MUST be deployed with `--no-verify-jwt`.

- [ ] **Step 1: Deploy the function**

```bash
npx supabase functions deploy mcp --no-verify-jwt
```
Expected: deploy succeeds for the `mcp` function.

- [ ] **Step 2: Restore deno.lock if polluted**

The deploy may modify `deno.lock`/`node_modules`. Check and restore:
```bash
git status --short deno.lock
# if modified:
git checkout deno.lock && npm ci
```

- [ ] **Step 3: Smoke-test live**

From an MCP client authenticated to a workspace that has at least one Hub page (a key with the `clientes:read` scope), call `list_pages` (optionally with a `client_id`) and confirm it returns the page(s) with `content` as a markdown string. Confirm a key WITHOUT `clientes:read` gets a permission-denied error.

---

## Notes / out of scope

- No write/edit/delete tools; no new scope; no pagination; no Hub/CRM UI changes (per spec).
- If a user-facing list of MCP tools exists (e.g. the Claude connector docs page), adding `list_pages` there is a separate, optional follow-up — the spec scoped UI changes out.

## Self-Review

- **Spec coverage:** tool contract (Task 2 register, `clientes:read`, optional `client_id`, output columns, deterministic order) ✓; `pageContentToMarkdown` defensive helper with per-type rendering, clamp, fail-closed, Hub fallback (Task 1) ✓; query with `{ data, error }` throw + workspace filter (Task 2) ✓; error handling inherited from `register()` ✓; tests incl. malformed/non-array/unknown-fallback (Task 1) ✓; correct test command (`npm run test:functions`) ✓.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `pageContentToMarkdown(content: unknown): string` defined in Task 1, imported and used identically in Task 2; `listPages(d: Deps, args: { client_id?: number })` produced in Task 2 step 1, consumed in Task 2 step 2; `cliente_id` column name consistent between query select and spec output.
