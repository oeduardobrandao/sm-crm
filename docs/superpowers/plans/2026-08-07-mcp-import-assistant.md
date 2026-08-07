# MCP Importing-Assistant Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `create_client`, `create_member` and `list_members` MCP tools (plus the three scopes backing them) so an agent can import clients and team-roster members when a user migrates from another platform.

**Architecture:** Self-contained service-role logic in `supabase/functions/mcp/queries.ts` following the existing write-tool pattern (`createTask`, `createWorkflowTemplate`): find-or-create by case-insensitive nome within `ctx.conta_id`, fill-empty merge on match, plan-limit translation on insert. Scopes live in two mirrored lists (Deno + Vite). No migrations, no new routes.

**Tech Stack:** Deno edge function (`supabase/functions/mcp/`), zod v3 tool schemas, supabase-js service-role client, Deno tests with the recording fake-db pattern, Vitest for the frontend scope mirror.

**Spec:** `docs/superpowers/specs/2026-08-07-mcp-import-assistant-design.md` — read it before starting. It records the approved decisions (roster-only members, find-or-create semantics, financial fields accepted but never echoed, tie-break rules, audit requirements).

## Global Constraints

- All user-facing strings (tool descriptions, error messages, scope labels) are pt-BR. **No em-dashes** in any user-facing copy.
- Never leak raw DB error text to MCP clients: only `McpInputError` / `McpScopeError` messages go out; everything else is logged and returned generic (the `register()` wrapper already does this — just throw the right types).
- Every query MUST filter/stamp `conta_id = ctx.conta_id` explicitly, including UPDATEs. The MCP function runs service-role; RLS does not protect it.
- Financial values (`valor_mensal`, `custo_mensal`) and `email`/`telefone` are accepted as input but NEVER appear in any tool response or audit metadata.
- `deno test` dirties the root `deno.lock` — run `git checkout -- deno.lock` before committing.
- Commits: pt-BR conventional messages, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

**Test commands used throughout:**

```bash
# Single Deno test file (mirrors npm run test:functions flags):
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/<file>_test.ts

# Full suites:
npm run test:functions
npm run test -- --run src/lib/__tests__/mcp-scopes.test.ts   # from apps/crm? No: run from repo root, see Task 1 Step 4
```

---

### Task 1: Scopes on both sides of the mirror

**Files:**
- Modify: `supabase/functions/_shared/mcp-token.ts:10-19`
- Modify: `apps/crm/src/lib/mcp-scopes.ts`
- Test: `supabase/functions/__tests__/mcp-token_test.ts`
- Test: `apps/crm/src/lib/__tests__/mcp-scopes.test.ts`

**Interfaces:**
- Produces: `MCP_ALLOWED_SCOPES` containing `"clientes:write"`, `"membros:read"`, `"membros:write"`; `MCP_AGENT_PRESET` containing `"membros:read"`. Task 4's `register()` calls rely on these exact scope strings.

- [ ] **Step 1: Write the failing Deno test**

Append to `supabase/functions/__tests__/mcp-token_test.ts`:

```ts
Deno.test("mcp-token: import-assistant scopes are allowlisted", () => {
  for (const s of ["clientes:write", "membros:read", "membros:write"]) {
    assert((MCP_ALLOWED_SCOPES as readonly string[]).includes(s), `${s} in allowlist`);
  }
  assert(validateScopes(["clientes:write", "membros:read", "membros:write"]), "validateScopes accepts them");
});

Deno.test("mcp-token: membros:read joins the agent preset, writes stay out", () => {
  assert((MCP_AGENT_PRESET as readonly string[]).includes("membros:read"), "membros:read in preset");
  assert(!(MCP_AGENT_PRESET as readonly string[]).includes("clientes:write"), "clientes:write NOT in preset");
  assert(!(MCP_AGENT_PRESET as readonly string[]).includes("membros:write"), "membros:write NOT in preset");
});
```

(`MCP_ALLOWED_SCOPES`, `MCP_AGENT_PRESET`, `validateScopes` and `assert` are already imported at the top of this test file.)

- [ ] **Step 2: Run it to verify it fails**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/mcp-token_test.ts
```

Expected: FAIL with `clientes:write in allowlist`.

- [ ] **Step 3: Implement the Deno side**

In `supabase/functions/_shared/mcp-token.ts`, replace the two constants:

```ts
export const MCP_ALLOWED_SCOPES = [
  "clientes:read", "posts:read", "workflows:read", "ideias:read", "tarefas:read", "membros:read",
  "posts:write", "templates:write", "tarefas:write", "clientes:write", "membros:write",
] as const;
export type McpScope = (typeof MCP_ALLOWED_SCOPES)[number];

/** Least-privilege preset for a content-writing agent (read-only). */
export const MCP_AGENT_PRESET: McpScope[] = [
  "clientes:read", "posts:read", "workflows:read", "ideias:read", "tarefas:read", "membros:read",
];
```

Also update the comment above `MCP_ALLOWED_SCOPES` (line 6) to mention clientes/membros writes exist for the importing assistant.

- [ ] **Step 4: Re-run the Deno test — PASS. Then write the failing Vitest**

Append to `apps/crm/src/lib/__tests__/mcp-scopes.test.ts`:

```ts
describe('import assistant scopes (clientes/membros)', () => {
  it('offers clientes:write, membros:read and membros:write as selectable scopes', () => {
    expect(SCOPE_OPTIONS.some((s) => s.value === 'clientes:write')).toBe(true);
    expect(SCOPE_OPTIONS.some((s) => s.value === 'membros:read')).toBe(true);
    expect(SCOPE_OPTIONS.some((s) => s.value === 'membros:write')).toBe(true);
  });
  it('adds membros:read to the preset but keeps the new writes out', () => {
    expect(AGENT_PRESET).toContain('membros:read');
    expect(AGENT_PRESET).not.toContain('clientes:write');
    expect(AGENT_PRESET).not.toContain('membros:write');
  });
});
```

Run from the repo root: `npm run test -- --run mcp-scopes` — expected: FAIL.

- [ ] **Step 5: Implement the frontend mirror**

In `apps/crm/src/lib/mcp-scopes.ts`:

```ts
export const SCOPE_OPTIONS = [
  { value: 'clientes:read', label: 'Clientes (leitura)' },
  { value: 'posts:read', label: 'Posts (leitura)' },
  { value: 'workflows:read', label: 'Fluxos (leitura)' },
  { value: 'ideias:read', label: 'Ideias/Pautas (leitura)' },
  { value: 'tarefas:read', label: 'Tarefas (leitura)' },
  { value: 'membros:read', label: 'Equipe (leitura)' },
  { value: 'posts:write', label: 'Posts (escrita)' },
  { value: 'templates:write', label: 'Modelos (escrita)' },
  { value: 'tarefas:write', label: 'Tarefas (escrita)' },
  { value: 'clientes:write', label: 'Clientes (escrita)' },
  { value: 'membros:write', label: 'Equipe (escrita)' },
] as const;

/** Least-privilege preset for a content agent — read scopes only. Write is opt-in. */
export const AGENT_PRESET: string[] = [
  'clientes:read',
  'posts:read',
  'workflows:read',
  'ideias:read',
  'tarefas:read',
  'membros:read',
];
```

- [ ] **Step 6: Run both test files — PASS**

```bash
npm run test -- --run mcp-scopes
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/mcp-token_test.ts
```

- [ ] **Step 7: Commit**

```bash
git checkout -- deno.lock
git add supabase/functions/_shared/mcp-token.ts apps/crm/src/lib/mcp-scopes.ts supabase/functions/__tests__/mcp-token_test.ts apps/crm/src/lib/__tests__/mcp-scopes.test.ts
git commit -m "feat(mcp): escopos clientes:write, membros:read e membros:write"
```

---

### Task 2: `createClient` query function

**Files:**
- Modify: `supabase/functions/mcp/queries.ts` (append after the `// ---- clients ----` section's last function, `getBrandProfile`)
- Create: `supabase/functions/__tests__/mcp-import_test.ts`

**Interfaces:**
- Consumes: `Deps`, `McpInputError`, `allowlistClient`, `CLIENT_PUBLIC_FIELDS`, `isPlanLimitExceeded` (all already imported in `queries.ts`).
- Produces: `createClient(d: Deps, args: { nome: string; email?: string; telefone?: string; especialidade?: string; valor_mensal?: number; status?: string }): Promise<any>` returning `{ id, nome, sigla, especialidade, cor, status, already_existed: boolean, filled_fields: string[] }`. Also exports helpers `isBlank(v: unknown): boolean` and `deriveSigla(nome: string): string` used by Task 3. Task 4 registers this as the `create_client` tool.

- [ ] **Step 1: Create the test file with the fake-db harness and the createClient tests**

Create `supabase/functions/__tests__/mcp-import_test.ts`. Copy the `makeFakeDb`, `insertPayload`, `updatePayload` and `has` helpers verbatim from `supabase/functions/__tests__/mcp-tarefas_test.ts:7-44` (each test file carries its own copy; that is the established pattern). Then:

```ts
import { assert, assertEquals } from "./assert.ts";
import { createClient } from "../mcp/queries.ts";
import type { Deps } from "../mcp/queries.ts";
import { McpInputError, type McpKeyContext } from "../_shared/mcp-token.ts";

// ... makeFakeDb / insertPayload / updatePayload / has copied here ...

const CTX: McpKeyContext = {
  conta_id: "workspace-A",
  scopes: ["clientes:write", "membros:read", "membros:write"],
  key_id: "k1",
  created_by: "user-1",
};

Deno.test("mcp-import: createClient inserts with derived sigla, defaults and ctx stamps", async () => {
  const { db, calls } = makeFakeDb({
    clientes: [
      { data: [], error: null },  // match scan: no rows
      { data: { id: 7, nome: "Dra. Ana", sigla: "DR", especialidade: null, cor: "#eab308", status: "ativo" }, error: null }, // insert result
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createClient(deps, { nome: "Dra. Ana", email: "ana@x.com", valor_mensal: 1500 });
  assert(has(calls, "clientes", "eq", ["conta_id", "workspace-A"]), "match scan scoped by conta_id");
  const row = insertPayload(calls, "clientes")!;
  assertEquals(row.conta_id, "workspace-A");
  assertEquals(row.user_id, "user-1");
  assertEquals(row.sigla, "DR");
  assertEquals(row.status, "ativo");
  assertEquals(row.valor_mensal, 1500);
  assertEquals(out.already_existed, false);
  assertEquals(out.filled_fields.length, 0);
  assert(!("email" in out), "email never echoed");
  assert(!("valor_mensal" in out), "valor_mensal never echoed");
});

Deno.test("mcp-import: createClient sigla falls back to XX for non-alphabetic nome", async () => {
  const { db, calls } = makeFakeDb({
    clientes: [
      { data: [], error: null },
      { data: { id: 8, nome: "123", sigla: "XX", especialidade: null, cor: "#eab308", status: "ativo" }, error: null },
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  await createClient(deps, { nome: "123" });
  assertEquals(insertPayload(calls, "clientes")!.sigla, "XX");
});

Deno.test("mcp-import: createClient matches existing nome case-insensitively and fills only empty fields", async () => {
  const existing = {
    id: 3, nome: "Dra. Ana ", sigla: "DA", especialidade: null, cor: "#111111",
    status: "pausado", email: "ja@tem.com", telefone: "", valor_mensal: null,
  };
  const { db, calls } = makeFakeDb({
    clientes: [
      { data: [existing], error: null },   // match scan
      { data: null, error: null },         // update result (awaited chain)
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createClient(deps, {
    nome: "dra. ana", email: "novo@x.com", telefone: "1199999", valor_mensal: 2000,
  });
  assertEquals(out.already_existed, true);
  assertEquals(out.id, 3);
  assertEquals(out.status, "pausado", "existing status reported so the agent sees encerrado/pausado matches");
  const patch = updatePayload(calls, "clientes")!;
  assert(!Object.hasOwn(patch, "email"), "non-empty email NOT overwritten");
  assertEquals(patch.telefone, "1199999", "empty telefone filled");
  assertEquals(patch.valor_mensal, 2000, "NULL valor_mensal filled");
  assert(!Object.hasOwn(patch, "nome"), "nome never modified on match");
  assert(!Object.hasOwn(patch, "status"), "status never modified on match");
  assert(has(calls, "clientes", "eq", ["id", 3]), "update targets matched id");
  assertEquals(calls.filter((c) => c.table === "clientes" && c.method === "eq" && c.args[0] === "conta_id").length, 2,
    "BOTH the scan and the update carry conta_id");
  assertEquals(out.filled_fields.sort(), ["telefone", "valor_mensal"]);
  assert(!calls.some((c) => c.table === "clientes" && c.method === "insert"), "no insert on match");
});

Deno.test("mcp-import: createClient valor_mensal 0 on the existing row is real data, not filled", async () => {
  const existing = {
    id: 4, nome: "Beto", sigla: "BE", especialidade: null, cor: "#111111",
    status: "ativo", email: "", telefone: "", valor_mensal: 0,
  };
  const { db, calls } = makeFakeDb({ clientes: [{ data: [existing], error: null }] });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createClient(deps, { nome: "Beto", valor_mensal: 900 });
  assert(!calls.some((c) => c.table === "clientes" && c.method === "update"), "no update: nothing to fill");
  assertEquals(out.filled_fields.length, 0);
});

Deno.test("mcp-import: createClient tie-break picks the first row of the id-ordered scan", async () => {
  const older = { id: 1, nome: "Dupla", sigla: "DU", especialidade: null, cor: "#1", status: "ativo", email: "", telefone: "", valor_mensal: null };
  const newer = { id: 9, nome: "Dupla", sigla: "DU", especialidade: null, cor: "#2", status: "ativo", email: "", telefone: "", valor_mensal: null };
  const { db, calls } = makeFakeDb({
    clientes: [
      { data: [older, newer], error: null },
      { data: null, error: null },
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createClient(deps, { nome: "Dupla", email: "a@b.c" });
  assertEquals(out.id, 1, "oldest row is canonical");
  assert(has(calls, "clientes", "order", ["id", { ascending: true }]), "scan is id-ordered");
  assert(has(calls, "clientes", "eq", ["id", 1]), "update targets the oldest id");
});

Deno.test("mcp-import: createClient plan limit -> McpInputError with pt-BR message", async () => {
  const { db } = makeFakeDb({
    clientes: [
      { data: [], error: null },
      { data: null, error: { message: "new row violates ... plan_limit_exceeded:max_clients" } },
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let msg = "";
  try {
    await createClient(deps, { nome: "Nova" });
  } catch (e) {
    if (e instanceof McpInputError) msg = e.message;
  }
  assertEquals(msg, "Limite de clientes do plano foi atingido.");
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/mcp-import_test.ts
```

Expected: FAIL with `createClient` not exported from `../mcp/queries.ts`.

- [ ] **Step 3: Implement createClient in queries.ts**

Append after `getBrandProfile` (around line 110), still inside the `// ---- clients ----` section:

```ts
// ---- import assistant (create/find clients & members) ------------------------

/** True for null/undefined and blank/whitespace-only strings. */
export function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/**
 * Sigla rule from the CSV import (migration 20260729000004): strip non-ASCII
 * letters, pad with 'XX', take two chars, uppercase. A fully non-alphabetic nome
 * (e.g. "123") still yields a valid 'XX' instead of an empty sigla.
 */
export function deriveSigla(nome: string): string {
  return (nome.replace(/[^a-zA-Z]/g, "") + "XX").slice(0, 2).toUpperCase();
}

const CLIENT_MERGE_FIELDS = "id, nome, sigla, especialidade, cor, status, email, telefone, valor_mensal";

export async function createClient(
  d: Deps,
  args: {
    nome: string;
    email?: string;
    telefone?: string;
    especialidade?: string;
    valor_mensal?: number;
    status?: string;
  },
): Promise<any> {
  const nome = args.nome.trim();
  // Find-or-create: clientes.nome has no unique constraint, so scan the workspace's
  // rows ordered by id and match lower(trim()) in code. The FIRST match of the
  // id-ascending scan is the canonical row, deterministically, on every retry.
  const { data: rows, error: selErr } = await d.db
    .from("clientes")
    .select(CLIENT_MERGE_FIELDS)
    .eq("conta_id", d.ctx.conta_id)
    .order("id", { ascending: true });
  if (selErr) throw selErr;
  const match = ((rows ?? []) as any[]).find(
    (r) => typeof r.nome === "string" && r.nome.trim().toLowerCase() === nome.toLowerCase(),
  );

  if (match) {
    // Fill-empty merge: never overwrite. Text fields fill when blank; valor_mensal
    // fills only when SQL NULL (an explicit 0 is real data, mirroring the CSV wizard).
    const patch: Record<string, unknown> = {};
    for (const f of ["email", "telefone", "especialidade"] as const) {
      const v = args[f];
      if (!isBlank(v) && isBlank(match[f])) patch[f] = (v as string).trim();
    }
    if (args.valor_mensal != null && match.valor_mensal == null) patch.valor_mensal = args.valor_mensal;
    if (Object.keys(patch).length > 0) {
      // WITH CHECK da RLS nao protege writes service-role: conta_id explicito aqui.
      const { error: updErr } = await d.db
        .from("clientes")
        .update(patch)
        .eq("id", match.id)
        .eq("conta_id", d.ctx.conta_id);
      if (updErr) throw updErr;
    }
    return {
      ...allowlistClient({ ...match, ...patch }),
      already_existed: true,
      filled_fields: Object.keys(patch),
    };
  }

  const { data: created, error: insErr } = await d.db
    .from("clientes")
    .insert({
      conta_id: d.ctx.conta_id,
      user_id: d.ctx.created_by,
      nome,
      sigla: deriveSigla(nome),
      cor: "#eab308",
      plano: "",
      email: args.email?.trim() ?? "",
      telefone: args.telefone?.trim() ?? "",
      status: args.status ?? "ativo",
      especialidade: isBlank(args.especialidade) ? null : args.especialidade!.trim(),
      valor_mensal: args.valor_mensal ?? null,
    })
    .select(CLIENT_PUBLIC_FIELDS.join(","))
    .single();
  if (insErr) {
    if (isPlanLimitExceeded(insErr, "max_clients")) {
      throw new McpInputError("Limite de clientes do plano foi atingido.");
    }
    throw insErr;
  }
  return { ...allowlistClient(created as any), already_existed: false, filled_fields: [] };
}
```

- [ ] **Step 4: Run the test file — PASS**

Same command as Step 2. All 6 `mcp-import` tests green.

- [ ] **Step 5: Run the full Deno suite to catch regressions**

```bash
npm run test:functions
git checkout -- deno.lock
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/mcp/queries.ts supabase/functions/__tests__/mcp-import_test.ts
git commit -m "feat(mcp): createClient com find-or-create por nome e merge de campos vazios"
```

---

### Task 3: `createMember` + `listMembers` query functions

**Files:**
- Modify: `supabase/functions/mcp/content.ts` (append `MEMBER_PUBLIC_FIELDS` + `allowlistMember` right after `allowlistClient`, ~line 177)
- Modify: `supabase/functions/mcp/queries.ts` (append after `createClient` from Task 2; add the two new imports to the existing `./content.ts` import block)
- Test: `supabase/functions/__tests__/mcp-import_test.ts` (append)

**Interfaces:**
- Consumes: `Deps`, `isBlank` (Task 2), fake-db harness already in the test file.
- Produces:
  - `content.ts`: `MEMBER_PUBLIC_FIELDS = ["id", "nome", "cargo", "tipo", "data_pagamento", "crm_user_id", "created_at"] as const` and `allowlistMember(row: Record<string, unknown>): Record<string, unknown>`.
  - `queries.ts`: `createMember(d: Deps, args: { nome: string; cargo?: string; tipo?: string; custo_mensal?: number; data_pagamento?: number }): Promise<any>` and `listMembers(d: Deps): Promise<any[]>`. Both return `MEMBER_PUBLIC_FIELDS` projections; `createMember` adds `already_existed` + `filled_fields`. Task 4 registers them as `create_member` / `list_members`.

- [ ] **Step 1: Append the failing tests**

Append to `supabase/functions/__tests__/mcp-import_test.ts` (extend the import line with `createMember, listMembers`):

```ts
Deno.test("mcp-import: createMember inserts with defaults and ctx stamps, no custo echo", async () => {
  const { db, calls } = makeFakeDb({
    membros: [
      { data: [], error: null },
      { data: { id: 5, nome: "João", cargo: "", tipo: "clt", data_pagamento: null, crm_user_id: null, created_at: "2026-08-07" }, error: null },
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createMember(deps, { nome: "João", custo_mensal: 3000 });
  const row = insertPayload(calls, "membros")!;
  assertEquals(row.conta_id, "workspace-A");
  assertEquals(row.user_id, "user-1");
  assertEquals(row.tipo, "clt");
  assertEquals(row.cargo, "");
  assertEquals(row.avatar_url, "");
  assertEquals(row.custo_mensal, 3000);
  assertEquals(out.already_existed, false);
  assert(!("custo_mensal" in out), "custo_mensal never echoed");
});

Deno.test("mcp-import: createMember matches nome, fills empty cargo and NULL custo only", async () => {
  const existing = { id: 2, nome: "Maria", cargo: "", tipo: "freelancer_mensal", custo_mensal: 0, data_pagamento: 5, crm_user_id: null, created_at: "2026-01-01" };
  const { db, calls } = makeFakeDb({
    membros: [
      { data: [existing], error: null },
      { data: null, error: null },
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createMember(deps, { nome: "MARIA", cargo: "Designer", tipo: "clt", custo_mensal: 4000 });
  const patch = updatePayload(calls, "membros")!;
  assertEquals(patch.cargo, "Designer", "empty cargo filled");
  assert(!Object.hasOwn(patch, "custo_mensal"), "custo 0 is real data, not filled");
  assert(!Object.hasOwn(patch, "tipo"), "tipo never modified on match");
  assert(has(calls, "membros", "eq", ["conta_id", "workspace-A"]), "scan scoped");
  assert(has(calls, "membros", "eq", ["id", 2]), "update targets matched id");
  assertEquals(out.already_existed, true);
  assertEquals(out.filled_fields, ["cargo"]);
  assertEquals(out.tipo, "freelancer_mensal", "existing tipo reported");
});

Deno.test("mcp-import: createMember same nome in another workspace still inserts (scan is conta-scoped)", async () => {
  // The fake db returns what the scan query would: an empty list, BECAUSE the real
  // query filters conta_id. The assertion that matters is the eq('conta_id', ...) call.
  const { db, calls } = makeFakeDb({
    membros: [
      { data: [], error: null },
      { data: { id: 6, nome: "João", cargo: "", tipo: "clt", data_pagamento: null, crm_user_id: null, created_at: "2026-08-07" }, error: null },
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createMember(deps, { nome: "João" });
  assert(has(calls, "membros", "eq", ["conta_id", "workspace-A"]), "scan carries conta_id");
  assertEquals(out.already_existed, false);
});

Deno.test("mcp-import: listMembers projects public fields, scoped and ordered", async () => {
  const { db, calls } = makeFakeDb({
    membros: [{
      data: [{ id: 1, nome: "Ana", cargo: "Social media", tipo: "clt", data_pagamento: 5, crm_user_id: null, created_at: "2026-08-01", custo_mensal: 9999 }],
      error: null,
    }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await listMembers(deps);
  assert(has(calls, "membros", "eq", ["conta_id", "workspace-A"]), "scoped");
  assert(has(calls, "membros", "order", ["created_at", { ascending: false }]), "newest first");
  assertEquals(out.length, 1);
  assert(!("custo_mensal" in out[0]), "custo_mensal stripped even if selected by accident");
  assertEquals(out[0].nome, "Ana");
});
```

- [ ] **Step 2: Run to verify FAIL** (same deno test command; `createMember` not exported).

- [ ] **Step 3: Implement**

In `supabase/functions/mcp/content.ts`, right after `allowlistClient` (~line 177):

```ts
/** Roster fields safe for agent consumption. custo_mensal is deliberately absent. */
export const MEMBER_PUBLIC_FIELDS = [
  "id", "nome", "cargo", "tipo", "data_pagamento", "crm_user_id", "created_at",
] as const;

export function allowlistMember(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of MEMBER_PUBLIC_FIELDS) {
    if (f in row) out[f] = row[f];
  }
  return out;
}
```

In `supabase/functions/mcp/queries.ts`: add `allowlistMember` and `MEMBER_PUBLIC_FIELDS` to the existing `./content.ts` import block, then append after `createClient`:

```ts
const MEMBER_MERGE_FIELDS = "id, nome, cargo, tipo, custo_mensal, data_pagamento, crm_user_id, created_at";

export async function createMember(
  d: Deps,
  args: { nome: string; cargo?: string; tipo?: string; custo_mensal?: number; data_pagamento?: number },
): Promise<any> {
  const nome = args.nome.trim();
  // Same find-or-create contract as createClient: id-ordered scan, oldest match wins.
  const { data: rows, error: selErr } = await d.db
    .from("membros")
    .select(MEMBER_MERGE_FIELDS)
    .eq("conta_id", d.ctx.conta_id)
    .order("id", { ascending: true });
  if (selErr) throw selErr;
  const match = ((rows ?? []) as any[]).find(
    (r) => typeof r.nome === "string" && r.nome.trim().toLowerCase() === nome.toLowerCase(),
  );

  if (match) {
    const patch: Record<string, unknown> = {};
    if (!isBlank(args.cargo) && isBlank(match.cargo)) patch.cargo = args.cargo!.trim();
    // 0 is real data: only SQL NULL counts as empty.
    if (args.custo_mensal != null && match.custo_mensal == null) patch.custo_mensal = args.custo_mensal;
    if (Object.keys(patch).length > 0) {
      // WITH CHECK da RLS nao protege writes service-role: conta_id explicito aqui.
      const { error: updErr } = await d.db
        .from("membros")
        .update(patch)
        .eq("id", match.id)
        .eq("conta_id", d.ctx.conta_id);
      if (updErr) throw updErr;
    }
    return {
      ...allowlistMember({ ...match, ...patch }),
      already_existed: true,
      filled_fields: Object.keys(patch),
    };
  }

  const { data: created, error: insErr } = await d.db
    .from("membros")
    .insert({
      conta_id: d.ctx.conta_id,
      user_id: d.ctx.created_by,
      nome,
      cargo: args.cargo?.trim() ?? "",
      tipo: args.tipo ?? "clt",
      avatar_url: "",
      custo_mensal: args.custo_mensal ?? null,
      data_pagamento: args.data_pagamento ?? null,
    })
    .select(MEMBER_PUBLIC_FIELDS.join(","))
    .single();
  if (insErr) throw insErr;
  return { ...allowlistMember(created as any), already_existed: false, filled_fields: [] };
}

export async function listMembers(d: Deps): Promise<any[]> {
  const { data, error } = await d.db
    .from("membros")
    .select(MEMBER_PUBLIC_FIELDS.join(","))
    .eq("conta_id", d.ctx.conta_id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as any[]).map(allowlistMember);
}
```

- [ ] **Step 4: Run the test file — PASS. Then run `npm run test:functions` for regressions.**

- [ ] **Step 5: Commit**

```bash
git checkout -- deno.lock
git add supabase/functions/mcp/content.ts supabase/functions/mcp/queries.ts supabase/functions/__tests__/mcp-import_test.ts
git commit -m "feat(mcp): createMember e listMembers (roster da equipe, sem custo_mensal)"
```

---

### Task 4: Tool registration + audit resource_id extension

**Files:**
- Modify: `supabase/functions/mcp/tools.ts` (audit helper ~line 52; imports ~line 5-26; new registrations appended after the `update_task` block at the end of `registerTools`)
- Test: `supabase/functions/__tests__/mcp-import_test.ts` (append)

**Interfaces:**
- Consumes: `createClient` (Task 2), `createMember`, `listMembers` (Task 3), scopes (Task 1).
- Produces: MCP tools `create_client`, `create_member`, `list_members` live on the server; `audit()` recognizes `member_id` and `template_id` as `resource_id` sources.

- [ ] **Step 1: Append the failing tool-level tests**

Append to `mcp-import_test.ts` (add `import { registerTools } from "../mcp/tools.ts";` — the fake server pattern is `mcp-tarefas_test.ts:146-157`):

```ts
function makeFakeServer() {
  return {
    handlers: {} as Record<string, (a: unknown) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>>,
    // deno-lint-ignore no-explicit-any
    tool(name: string, _d: any, _s: any, h: any) { this.handlers[name] = h; },
  };
}

Deno.test("mcp-import: create_client denies a ctx missing clientes:write", async () => {
  const { db } = makeFakeDb({});
  const deniedCtx: McpKeyContext = { conta_id: "workspace-A", scopes: ["clientes:read"], key_id: "k1", created_by: "user-1" };
  const server = makeFakeServer();
  registerTools(server as any, { db, ctx: deniedCtx } as unknown as Deps);
  const result = await server.handlers["create_client"]({ nome: "X" });
  assert(result.isError === true, "denied");
  assert(result.content[0].text.includes("clientes:write"), "names the missing scope");
});

Deno.test("mcp-import: create_member and list_members deny ctxs missing membros scopes", async () => {
  const { db } = makeFakeDb({});
  const deniedCtx: McpKeyContext = { conta_id: "workspace-A", scopes: ["clientes:read"], key_id: "k1", created_by: "user-1" };
  const server = makeFakeServer();
  registerTools(server as any, { db, ctx: deniedCtx } as unknown as Deps);
  const created = await server.handlers["create_member"]({ nome: "X" });
  assert(created.isError === true && created.content[0].text.includes("membros:write"), "create_member denied");
  const listed = await server.handlers["list_members"]({});
  assert(listed.isError === true && listed.content[0].text.includes("membros:read"), "list_members denied");
});

Deno.test("mcp-import: create_client audit row carries client_id, no nome/email in metadata", async () => {
  const { db, calls } = makeFakeDb({
    clientes: [
      { data: [], error: null },
      { data: { id: 7, nome: "Dra. Ana", sigla: "DR", especialidade: null, cor: "#eab308", status: "ativo" }, error: null },
    ],
  });
  const server = makeFakeServer();
  registerTools(server as any, { db, ctx: CTX } as unknown as Deps);
  await server.handlers["create_client"]({ nome: "Dra. Ana", email: "ana@x.com" });
  const auditRow = insertPayload(calls, "audit_log")! as Record<string, any>;
  assertEquals(auditRow.resource_id, "7", "resource_id from client_id");
  const meta = JSON.stringify(auditRow.metadata);
  assert(!meta.includes("Dra. Ana"), "no nome in audit metadata");
  assert(!meta.includes("ana@x.com"), "no email in audit metadata");
});

Deno.test("mcp-import: create_member audit row carries member_id via the extended extraction", async () => {
  const { db, calls } = makeFakeDb({
    membros: [
      { data: [], error: null },
      { data: { id: 5, nome: "João", cargo: "", tipo: "clt", data_pagamento: null, crm_user_id: null, created_at: "2026-08-07" }, error: null },
    ],
  });
  const server = makeFakeServer();
  registerTools(server as any, { db, ctx: CTX } as unknown as Deps);
  await server.handlers["create_member"]({ nome: "João" });
  const auditRow = insertPayload(calls, "audit_log")! as Record<string, any>;
  assertEquals(auditRow.resource_id, "5", "resource_id from member_id");
});
```

- [ ] **Step 2: Run to verify FAIL** (`create_client` handler undefined).

- [ ] **Step 3: Implement in tools.ts**

(a) Extend the queries import (line 5-26) with `createClient, createMember, listMembers`.

(b) In `audit()` (~line 52), replace the `resource_id` line:

```ts
    resource_id: String(
      (args.post_id ?? args.client_id ?? args.workflow_id ?? args.member_id ?? args.template_id ?? "") || "",
    ),
```

(`template_id` fixes the pre-existing hole where `create_workflow_template` audit rows had an empty resource_id.)

(c) Add near the other enums (~line 91): `const TIPO_MEMBRO = z.enum(["clt", "freelancer_mensal", "freelancer_demanda"]);`

(d) Append inside `registerTools`, after the `update_task` registration:

```ts
  register(server, deps, "create_client", "clientes:write",
    "Cria um cliente no workspace. Se já existir um cliente com o mesmo nome, retorna o existente e preenche apenas os campos vazios (already_existed: true, filled_fields). Pensado para importação de outras plataformas.",
    {
      nome: z.string().trim().min(1).max(120),
      email: z.string().trim().max(200).optional(),
      telefone: z.string().trim().max(40).optional(),
      especialidade: z.string().trim().max(200).optional(),
      valor_mensal: z.number().min(0).optional(),
      status: STATUS_CLIENTE.optional(),
    },
    (a) => createClient(deps, a),
    (a, r) => ({
      client_id: (r as { id?: number })?.id,
      already_existed: (r as { already_existed?: boolean })?.already_existed,
      filled_fields: (r as { filled_fields?: string[] })?.filled_fields,
      has_email: !!a.email,
      has_telefone: !!a.telefone,
      has_valor_mensal: a.valor_mensal != null,
    }));

  register(server, deps, "list_members", "membros:read",
    "Lista os membros da equipe (roster interno, campos não sensíveis).",
    {},
    () => listMembers(deps));

  register(server, deps, "create_member", "membros:write",
    "Cria um membro da equipe (roster interno). Não envia convite de login nem e-mail. Se já existir um membro com o mesmo nome, retorna o existente e preenche apenas os campos vazios.",
    {
      nome: z.string().trim().min(1).max(120),
      cargo: z.string().trim().max(120).optional(),
      tipo: TIPO_MEMBRO.optional(),
      custo_mensal: z.number().min(0).optional(),
      data_pagamento: z.number().int().min(1).max(31).optional(),
    },
    (a) => createMember(deps, a),
    (a, r) => ({
      member_id: (r as { id?: number })?.id,
      already_existed: (r as { already_existed?: boolean })?.already_existed,
      filled_fields: (r as { filled_fields?: string[] })?.filled_fields,
      has_cargo: !!a.cargo,
      has_custo_mensal: a.custo_mensal != null,
    }));
```

- [ ] **Step 4: Run the test file — PASS. Then the full Deno suite.**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/mcp-import_test.ts
npm run test:functions
git checkout -- deno.lock
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/mcp/tools.ts supabase/functions/__tests__/mcp-import_test.ts
git commit -m "feat(mcp): ferramentas create_client, create_member e list_members com auditoria por id"
```

---

### Task 5: Full verification sweep

**Files:** none new — this is the CI-parity gate.

- [ ] **Step 1: Typecheck all four projects (CI checks each separately; `npm run build` is NOT enough)**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
```

Expected: all clean.

- [ ] **Step 2: Full test suites**

```bash
npm run test           # Vitest
npm run test:functions # Deno
git checkout -- deno.lock
```

- [ ] **Step 3: Lint + format**

```bash
npm run lint
npm run format:check   # if it fails: npm run format, re-stage, re-run
```

- [ ] **Step 4: Fix anything the sweep surfaced, re-run the failing gate, commit any fixes**

```bash
git add -A ':!deno.lock'
git commit -m "chore(mcp): ajustes de lint/format da suite de importação"   # only if there were fixes
```

---

## Deployment notes (post-merge, not part of this plan's tasks)

- `npx supabase functions deploy mcp --use-api` (memory: local Docker bundler broken; `mcp` handles its own auth via key/OAuth — it is deployed with `--no-verify-jwt`, same as today).
- Existing MCP keys/OAuth grants do NOT gain the new scopes: mint a new key or re-consent on `/oauth/consent`.
- The MCP connector on claude.ai goes stale after a redeploy — reconnect the connector (memory: `project_mcp_attach_image_to_post`).
- Verify link state before any supabase CLI call: `cat supabase/.temp/project-ref` (prod=`skjzpekeqefvlojenfsw`).
