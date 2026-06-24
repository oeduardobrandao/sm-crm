# Design: `create_workflow` gains `template_id` (slice 2c-B)

**Date:** 2026-06-24
**Status:** Approved (pending spec review)
**Branch:** `feat/mcp-create-workflow-template`

## Goal

Extend the existing `create_workflow` MCP tool (slice 2a) with an optional
`template_id`. When provided, the new workflow records that `template_id` and its
etapas are instantiated from the template's step structure (instead of the single
default "Conteúdo" step). This makes agent-created workflows carry the agency's
real production flow **and** a template — which closes the loop for
`set_post_property` (post → workflow → template → property definitions) so the
agent can set custom properties on its own posts.

This is capability B of the 2c group. **No migration, no new scope, no frontend
change** — reuses the existing `posts:write` scope that `create_workflow` already
uses.

## Data model (existing)

- **`workflows`**: `…, template_id bigint REFERENCES workflow_templates(id) ON
  DELETE SET NULL, status, etapa_atual, modo_prazo, created_via, …`.
- **`workflow_templates`**: `id, conta_id, nome, etapas (jsonb), modo_prazo`. Each
  `etapas` element: `{ nome, prazo_dias, tipo_prazo: 'uteis'|'corridos',
  responsavel_id?: number|null, tipo?: 'padrao'|'aprovacao_cliente' }`.
- **`workflow_etapas`**: `workflow_id, ordem, nome, prazo_dias, tipo_prazo,
  responsavel_id, tipo, status ('pendente'|'ativo'|'concluido'), iniciado_em,
  concluido_em, data_limite`. No `conta_id` (child of the workflow).

The CRM's create-from-template path (`workflows.ts`) creates the workflow with the
template's `modo_prazo`, then inserts one `workflow_etapa` per template etapa
(first `ativo` + `iniciado_em=now`, rest `pendente`); `data_limite` is computed
only for `modo_prazo='data_entrega'`, else `null`.

## Decision: deadlines deferred (modo_prazo stays `padrao`)

Agent-created workflows are always `modo_prazo='padrao'` with `data_limite=null`,
**regardless of the template's mode**. The agent gets the template's step
*structure* (names, relative `prazo_dias`, `tipo_prazo`, which step is the
`aprovacao_cliente` gate, `responsavel_id`) and the `template_id` link; the
`data_entrega`/`data_fixa` date computation is intentionally **not** reproduced
(it is date-/calendar-dependent and human-owned for now). A human can switch the
workflow's mode and set dates later. Deadlines are scheduling, not content.

## Tool contract

```
create_workflow({
  client_id:   int>0,
  titulo:      string(trim, 1..200),
  template_id?: int>0,          // optional; omit → single default "Conteúdo" etapa
}) → { id, cliente_id, titulo, status:"ativo", etapa_atual:0, template_id, created_via:"agent", created_at }
```

`template_id` is always present in the response (the value, or `null` when
omitted) so the contract is stable.

## `createWorkflow(d, args)` changes (`queries.ts`)

1. **`verifyClient`** (existing) — client belongs to the workspace; else
   `McpInputError("Cliente não encontrado neste workspace.")`.
2. **If `template_id` provided, fetch it (tenant-scoped):**
   ```ts
   let template: any = null;
   if (args.template_id !== undefined) {
     const { data, error } = await d.db
       .from("workflow_templates")
       .select("id, etapas")
       .eq("conta_id", d.ctx.conta_id)
       .eq("id", args.template_id)
       .maybeSingle();
     if (error) throw error;                 // DB error re-thrown BEFORE the not-found check
     if (!data) throw new McpInputError("Modelo (template) não encontrado neste workspace.");
     template = data;
   }
   ```
3. **Insert the workflow** (as today, plus `template_id` explicit):
   ```ts
   const { data: wf, error: wfErr } = await d.db
     .from("workflows")
     .insert({
       conta_id: d.ctx.conta_id, user_id: d.ctx.created_by, cliente_id: args.client_id,
       titulo: args.titulo, status: "ativo", etapa_atual: 0, recorrente: false,
       modo_prazo: "padrao", created_via: "agent",
       template_id: args.template_id ?? null,   // explicit null when omitted
     })
     .select("id, cliente_id, titulo, status, etapa_atual, template_id, created_via, created_at")
     .single();
   if (wfErr) throw wfErr;
   ```
4. **Build etapa rows (one batch insert for both paths):**
   ```ts
   const now = d.now?.() ?? new Date().toISOString();
   const base = template ? instantiateTemplateEtapas(template.etapas, now) : [];
   const source = base.length > 0 ? base : [defaultEtapa(now)];
   const rows = source.map((e) => ({ ...e, workflow_id: wf.id }));
   const { error: etErr } = await d.db.from("workflow_etapas").insert(rows);
   if (etErr) {
     await d.db.from("workflows").delete()
       .eq("conta_id", d.ctx.conta_id).eq("id", wf.id);  // compensating cleanup (tenant-scoped)
     throw etErr;
   }
   return wf;
   ```
   where `defaultEtapa(now)` is the current default (without `workflow_id`):
   ```ts
   { ordem: 0, nome: "Conteúdo", prazo_dias: 0, tipo_prazo: "corridos", tipo: "padrao",
     status: "ativo", iniciado_em: now, responsavel_id: null, concluido_em: null, data_limite: null }
   ```

A template whose `etapas` is empty or malformed (→ `instantiateTemplateEtapas`
returns `[]`) falls back to `[defaultEtapa(now)]`, so the board always has a step
at `ordem 0` (the entregas UI does `etapas[etapa_atual] || etapas[0]`).

## `instantiateTemplateEtapas` (pure helper, `content.ts`)

```ts
instantiateTemplateEtapas(rawEtapas: unknown, now: string): {
  ordem: number; nome: string; prazo_dias: number; tipo_prazo: "uteis"|"corridos";
  tipo: "padrao"|"aprovacao_cliente"; responsavel_id: number | null;
  status: "ativo"|"pendente"; iniciado_em: string | null;
  concluido_em: null; data_limite: null;
}[]
```
- Fail closed: `!Array.isArray(rawEtapas)` → `[]`.
- Filter to object elements (skip non-objects); assign **contiguous** `ordem`
  `0..n-1` by position in the filtered list (no gaps).
- Per element: `nome` (string or `""`), `prazo_dias`
  (`Number.isInteger(x) ? x : 0` — the column is `integer`), `tipo_prazo`
  (`"uteis"` else `"corridos"`), `tipo` (`"aprovacao_cliente"` else `"padrao"`),
  **`responsavel_id`** (`Number.isInteger(x) ? x : null` — the column is a `bigint`
  FK; kept, unlike the read projection), `status` (`i===0 ? "ativo" : "pendente"`),
  `iniciado_em` (`i===0 ? now : null`), `concluido_em: null`, `data_limite: null`.
  **No `workflow_id`** — `createWorkflow` attaches it.
- `Number.isInteger` (stricter than `projectTemplateEtapas`' `typeof === "number"`)
  guards the integer columns: a malformed float/non-number in template JSON becomes
  `0`/`null` rather than failing the batch insert and triggering cleanup.
- It is a **separate** helper from `projectTemplateEtapas` (2c-1) on purpose: the
  read projection drops `responsavel_id` and omits the etapa-lifecycle fields,
  whereas instantiation keeps `responsavel_id` (real execution data) and adds the
  lifecycle fields.

**`responsavel_id` trust (accepted — mirror CRM):** the template stores
`responsavel_id` in JSON with no DB constraint beyond the etapa FK
(`membros(id)`), which is not `conta`-scoped. We copy it verbatim, exactly as the
CRM's own create-from-template path does. A corrupted/cross-tenant template could
therefore assign a foreign `membros` id — but the workflow itself is tenant-scoped
(RLS / `conta_id`), so the worst case is a dangling assignment a foreign member
can't see, not a data leak. We deliberately do **not** add a per-create
membership-validation query (the CRM doesn't, and the blast radius is contained).

## Scope plumbing & audit

- **`tools.ts`** — `create_workflow` zod shape gains
  `template_id: z.number().int().positive().optional()`. The audit redactor gains
  `template_id`: `{ client_id, titulo, template_id }` (an id, not sensitive).
- Reuses `posts:write`. Template fetch is `conta_id`-scoped; workflow insert is
  `conta_id`-pinned (existing); `workflow_etapas` are children of the workflow. DB
  errors re-thrown (mapped to generic by `errorResult`); guard failures throw
  `McpInputError`.

## Components / files

- **`mcp/content.ts`** — `instantiateTemplateEtapas` (pure).
- **`mcp/queries.ts`** — `createWorkflow` (template fetch + instantiation +
  `template_id`); import `instantiateTemplateEtapas`; refactor the default-etapa
  insert to the array form + a `defaultEtapa(now)` builder.
- **`mcp/tools.ts`** — `create_workflow` `template_id` arg + redactor field.
- **`__tests__/mcp-content_test.ts`** — `instantiateTemplateEtapas` unit tests.
- **`__tests__/mcp-writes_test.ts`** — `createWorkflow` template-path tests + the
  **updated** existing default-etapa test (array-insert shape).
- **No** migration, **no** `_shared/mcp-token.ts` change, **no** frontend change.

### Tool registration delta (tools.ts)

```ts
register(server, deps, "create_workflow", "posts:write",
  "Cria um fluxo de produção (necessário para criar posts). Opcionalmente instancia um modelo (template) com suas etapas. Retorna o fluxo criado.",
  {
    client_id: z.number().int().positive(),
    titulo: z.string().trim().min(1).max(200),
    template_id: z.number().int().positive().optional(),
  },
  (a) => createWorkflow(deps, a),
  (a) => ({ client_id: a.client_id, titulo: a.titulo, template_id: a.template_id }));
```

## Testing

Run with `npm run test:functions`.

- **`instantiateTemplateEtapas` (unit, `mcp-content_test.ts`):**
  - Well-formed array → rows with contiguous `ordem`, `responsavel_id` **kept**,
    first `status:"ativo"` + `iniciado_em:now`, rest `"pendente"` + `iniciado_em:null`,
    all `data_limite:null`/`concluido_em:null`; `tipo`/`tipo_prazo` defaults applied;
    **no `workflow_id`** key.
  - Non-array (`null`, `{}`, `"x"`) → `[]`; non-object elements skipped with
    contiguous `ordem` on the survivors.
  - **Integer guards:** a non-integer `prazo_dias` (e.g. `1.5`, `"3"`) → `0`; a
    non-integer `responsavel_id` (e.g. `2.7`, `"x"`) → `null` (the columns are
    `integer`/`bigint`).
- **`createWorkflow` (recording fake `db`, `mcp-writes_test.ts`):**
  - **Updated existing default-etapa test** — no `template_id`: the
    `workflow_etapas` insert payload is now an **array**; assert `rows[0].ordem===0`,
    `rows[0].status==="ativo"`; the workflow insert payload has `template_id: null`.
  - **Template path** — `template_id` provided: the template is fetched
    `.eq("conta_id","workspace-A").eq("id", <tid>)`; the `workflow_etapas` insert is
    an array of the instantiated rows (each carrying `workflow_id`, `responsavel_id`
    preserved, first `ativo`); the workflow insert payload has `template_id: <tid>`.
  - **Template not found** → `McpInputError`, no workflow insert.
  - **Empty/malformed template etapas** (e.g. `etapas: []` or `etapas: null`) →
    falls back to the single default etapa (`rows.length===1`, `rows[0].nome==="Conteúdo"`).
- Typecheck: `deno check --node-modules-dir=auto supabase/functions/mcp/index.ts`.

## Out of scope (YAGNI)

- `data_entrega`/`data_fixa` deadline computation (deferred; deadlines human-owned).
- Choosing/overriding `responsavel_id` (instantiation copies the template's).
- `recorrente`; a separate `create_workflow_from_template` tool (the optional
  param suffices).
- Capability D (`create_workflow_template`) — its own later slice (likely a
  `templates:write` scope).

## Rollout (gated — explicit go-ahead required)

No migration, no scope change. Deploy `mcp` only (`--no-verify-jwt`) to prod
(`skjzpekeqefvlojenfsw`) + staging (`wlyzhyfondykzpsiqsce`), then restore both lock
files (`git checkout deno.lock supabase/functions/deno.lock`) + `npm ci`.
Smoke-test: `list_workflow_templates` → `create_workflow({ client_id, titulo,
template_id })`; confirm the new fluxo appears in entregas with the template's
etapas (first step active) and an "IA" badge; `create_post` into it; then
`set_post_property` on that post succeeds (the workflow now has a template). Confirm
a foreign/unknown `template_id` returns the `McpInputError`, and `create_workflow`
without `template_id` still produces the single default etapa.
