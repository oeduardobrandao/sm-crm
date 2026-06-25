# Design: `create_workflow_template` MCP write tool (slice 2c-D)

**Date:** 2026-06-24
**Status:** Approved (pending spec review)
**Branch:** `feat/mcp-templates-write`

## Goal

Let an agent define a new **workflow template** — its step structure (etapas) and
its custom-property schema (definitions) — under a **new `templates:write` scope**.
This is the last 2c capability. The return mirrors `list_workflow_templates`'
shape (with generated ids), so the agent can immediately use the template in
`create_workflow` and the property ids in `set_post_property`.

This is the most powerful write so far: it defines workspace structure that
propagates into every workflow created from the template. It therefore gets its
own scope (not `posts:write`), kept out of the read-only agent preset.

## Data model (existing)

- **`workflow_templates`**: `id, user_id, conta_id, nome, etapas (jsonb default '[]'),
  modo_prazo (text default 'padrao' CHECK in padrao|data_fixa|data_entrega), created_at`.
  Each `etapas` element: `{ nome, prazo_dias, tipo_prazo: 'uteis'|'corridos',
  responsavel_id?: number|null, tipo?: 'padrao'|'aprovacao_cliente' }`. Array order
  is the step order (no `ordem` field on the template; instantiation assigns it).
- **`template_property_definitions`**: `id, template_id, conta_id, name, type
  (CHECK in text|number|select|multiselect|status|date|person|checkbox|url|email|phone|created_time),
  config (jsonb), portal_visible (bool default false), display_order (int default 0), created_at`.
  For `select`/`multiselect`/`status`, `config.options` is `[{ id, label, color }]`
  (the CRM stores/references the option **id**).
- **Plan caps (BEFORE INSERT triggers, `20260611130003`):**
  `trg_limit_templates` → `max_workflow_templates`; `trg_limit_custom_props` →
  `max_custom_properties_per_template`. Both raise
  `plan_limit_exceeded:<limit_key>` (errcode `P0001`, `enforce_plan_count_limit_fn`).

## Tool contract

```
create_workflow_template({
  nome:        string(trim, 1..120),
  modo_prazo?: "padrao" | "data_fixa" | "data_entrega",   // default "padrao"
  etapas: [{
    nome:        string(trim, 1..120),
    prazo_dias?: int >= 0,                 // default 0
    tipo_prazo?: "uteis" | "corridos",     // default "corridos"
    tipo?:       "padrao" | "aprovacao_cliente",  // default "padrao"
  }],                                       // 1..50
  properties?: [{
    name:           string(trim, 1..120),
    type:           "text"|"url"|"email"|"phone"|"number"|"date"|"checkbox"|"select"|"status"|"multiselect",
    portal_visible?: boolean,              // default false
    options?:       string[],              // labels; required & non-empty for select/status/multiselect, forbidden otherwise
  }],                                       // 0..50
}) → {
  id, nome, modo_prazo,
  etapas: [{ nome, prazo_dias, tipo_prazo, tipo }],
  properties: [{ id, name, type, config, portal_visible, display_order }],
}
```

The **Zod schema** declares most validation (lengths, the type enum — which
**excludes `person`/`created_time`** so they can't be defined — `etapas` `.min(1).max(50)`,
`options` `z.array(z.string().trim().min(1).max(120)).min(1).max(50).optional()`).
Cross-field rules and duplicate checks live in `buildPropertyDefinitions`.

## `createWorkflowTemplate(d, args)` algorithm (`queries.ts`)

1. **Normalize etapas** (pure `normalizeTemplateEtapas`) → `{nome, prazo_dias,
   tipo_prazo, tipo}` with defaults; no `responsavel_id` (the agent doesn't assign
   team members).
2. **Build property defs** if `properties?.length`:
   ```ts
   const genId = d.genId ?? (() => crypto.randomUUID());
   const built = buildPropertyDefinitions(args.properties, genId);
   if ("error" in built) throw new McpInputError(built.error);
   const defs = built.defs;   // else []
   ```
3. **Insert the template:**
   ```ts
   const { data: tpl, error: tErr } = await d.db
     .from("workflow_templates")
     .insert({
       conta_id: d.ctx.conta_id, user_id: d.ctx.created_by,
       nome: args.nome, etapas, modo_prazo: args.modo_prazo ?? "padrao",
     })
     .select("id, nome, modo_prazo")
     .single();
   if (tErr) {
     if (isPlanLimitExceeded(tErr, "max_workflow_templates"))
       throw new McpInputError("Limite de modelos (templates) do plano foi atingido.");
     throw tErr;
   }
   ```
4. **Insert property defs (if any), with compensating cleanup:**
   ```ts
   let properties: any[] = [];
   if (defs.length > 0) {
     const rows = defs.map((p) => ({ ...p, template_id: tpl.id, conta_id: d.ctx.conta_id }));
     const { data: inserted, error: pErr } = await d.db
       .from("template_property_definitions")
       .insert(rows)
       .select("id, name, type, config, portal_visible, display_order");
     if (pErr) {
       await d.db.from("workflow_templates").delete()
         .eq("id", tpl.id).eq("conta_id", d.ctx.conta_id);   // compensating cleanup
       if (isPlanLimitExceeded(pErr, "max_custom_properties_per_template"))
         throw new McpInputError("Limite de propriedades personalizadas do plano foi atingido.");
       throw pErr;
     }
     properties = (inserted ?? []).sort((a, b) => a.display_order - b.display_order);
   }
   return { id: tpl.id, nome: tpl.nome, modo_prazo: tpl.modo_prazo ?? null, etapas, properties };
   ```

## Pure helpers (`content.ts`)

### `normalizeTemplateEtapas(etapas: unknown): {nome,prazo_dias,tipo_prazo,tipo}[]`
- `!Array.isArray` → `[]` (defensive; Zod guarantees the real path). Skip non-object
  elements. Per element: `nome` (string or `""`), `prazo_dias`
  (`Number.isInteger(x) ? x : 0`), `tipo_prazo` (`"uteis"` else `"corridos"`),
  `tipo` (`"aprovacao_cliente"` else `"padrao"`). No `ordem`, no `responsavel_id`
  (template etapas JSONB has neither; instantiation in slice B assigns `ordem`).

### `buildPropertyDefinitions(properties, genId): { error: string } | { defs: {name,type,config,portal_visible,display_order}[] }`
- **Reject duplicate property names** (exact, post-trim) →
  `{ error: "Nomes de propriedade duplicados: '<name>'." }`.
- Per property (index `i` = `display_order`):
  - `OPTION_TYPES = ["select","status","multiselect"]`:
    - options missing/empty → `{ error: "A propriedade '<name>' (<type>) exige 'options'." }`.
    - **duplicate option labels** (exact, post-trim) →
      `{ error: "Opções duplicadas na propriedade '<name>'." }`.
    - `config = { options: options.map((label) => ({ id: genId(), label, color: "#94a3b8" })) }`.
  - non-option type: options present → `{ error: "A propriedade '<name>' (<type>) não aceita 'options'." }`; else `config = {}`.
  - `def = { name, type, config, portal_visible: portal_visible ?? false, display_order: i }`.
- Return `{ defs }`.

### `isPlanLimitExceeded(error: unknown, limitKey: string): boolean`
- `String((error as { message?: unknown })?.message ?? "").includes("plan_limit_exceeded:" + limitKey)`.
- **Keyed** so the template cap maps only to the template message and the
  property cap only to the property message (never the wrong quota → wrong message).

## Scope plumbing (the deploy gotcha applies)

- **`_shared/mcp-token.ts`** — add `"templates:write"` to `MCP_ALLOWED_SCOPES`
  (bundled into `mcp`, `mcp-oauth-consent`, `mcp-keys`). **Not** in `MCP_AGENT_PRESET`.
- **`apps/crm/src/lib/mcp-scopes.ts`** — add
  `{ value: "templates:write", label: "Modelos (escrita)" }` to `SCOPE_OPTIONS`;
  **not** in the read-only `AGENT_PRESET`.
- **Register** `create_workflow_template` under `templates:write` in `tools.ts`.

## Audit redaction

Redactor logs the template name + structure sizes, never the full etapa/option
detail: `{ nome, etapa_count: etapas?.length ?? 0, property_count: properties?.length ?? 0 }`.

## Tenant security & errors

- `conta_id`/`user_id` stamped on the template; `conta_id` stamped on each property
  def; the compensating delete is `.eq("id", tpl.id).eq("conta_id", ctx.conta_id)`.
- Every DB error is re-thrown (→ generic `"Internal error."` via `errorResult`)
  **except** the two keyed `plan_limit_exceeded` cases (→ friendly `McpInputError`)
  and the `buildPropertyDefinitions` validation errors (→ `McpInputError`).

## Components / files

- **`mcp/content.ts`** — `normalizeTemplateEtapas`, `buildPropertyDefinitions`,
  `isPlanLimitExceeded` (pure).
- **`mcp/queries.ts`** — `createWorkflowTemplate`; add `genId?: () => string` to `Deps`.
- **`mcp/tools.ts`** — register `create_workflow_template` (Zod shape + redactor).
- **`_shared/mcp-token.ts`** — `"templates:write"` in `MCP_ALLOWED_SCOPES`.
- **`apps/crm/src/lib/mcp-scopes.ts`** — `templates:write` option (not in `AGENT_PRESET`).
- **`__tests__/mcp-content_test.ts`** — `normalizeTemplateEtapas`,
  `buildPropertyDefinitions`, `isPlanLimitExceeded` unit tests.
- **`__tests__/mcp-writes_test.ts`** — `createWorkflowTemplate` tests (extend the
  fake `db` if needed — it already has `insert`/`delete`/`select`/`single`).
- **`__tests__/mcp-keys_test.ts`** — update the stale `// write reserved for PR 3`
  comment on line 11 (the `clientes:write` rejection assertion stays valid —
  `clientes:write` is still not a granted scope; only the comment is outdated).
- **`__tests__/mcp-oauth_test.ts`** — check its scope examples don't assume
  `templates:write` is rejected (as was done when `posts:write` was added).
- **No migration.**

### Tool registration (tools.ts)

```ts
const PROPERTY_TYPE = z.enum([
  "text","url","email","phone","number","date","checkbox","select","status","multiselect",
]);

register(server, deps, "create_workflow_template", "templates:write",
  "Cria um modelo de fluxo (template): etapas e, opcionalmente, o esquema de propriedades personalizadas. Retorna o modelo criado.",
  {
    nome: z.string().trim().min(1).max(120),
    modo_prazo: z.enum(["padrao", "data_fixa", "data_entrega"]).optional(),
    etapas: z.array(z.object({
      nome: z.string().trim().min(1).max(120),
      prazo_dias: z.number().int().min(0).optional(),
      tipo_prazo: z.enum(["uteis", "corridos"]).optional(),
      tipo: z.enum(["padrao", "aprovacao_cliente"]).optional(),
    })).min(1).max(50),
    properties: z.array(z.object({
      name: z.string().trim().min(1).max(120),
      type: PROPERTY_TYPE,
      portal_visible: z.boolean().optional(),
      options: z.array(z.string().trim().min(1).max(120)).min(1).max(50).optional(),
    })).max(50).optional(),
  },
  (a) => createWorkflowTemplate(deps, a),
  (a) => ({ nome: a.nome, etapa_count: a.etapas?.length ?? 0, property_count: a.properties?.length ?? 0 }));
```

## Testing

Run with `npm run test:functions`.

- **`normalizeTemplateEtapas` (unit):** well-formed → `{nome,prazo_dias,tipo_prazo,tipo}`
  (no `ordem`/`responsavel_id`), defaults applied; non-array → `[]`; non-integer
  `prazo_dias` → `0`; non-object elements skipped.
- **`buildPropertyDefinitions` (unit):**
  - select/status/multiselect with `options` → `config.options` = `[{id,label,color}]`
    with `genId`-generated ids (inject a deterministic `genId`) and default color;
    `display_order` = index; `portal_visible` defaults `false`.
  - non-option type with `options` → `{error}`; option type without `options` → `{error}`.
  - duplicate property names → `{error}`; duplicate option labels within a property → `{error}`.
  - non-option type → `config: {}`.
- **`isPlanLimitExceeded` (unit):** message `"plan_limit_exceeded:max_workflow_templates"`
  matches key `max_workflow_templates` but **not** `max_custom_properties_per_template`,
  and vice-versa; non-matching/empty message → `false`.
- **`createWorkflowTemplate` (recording fake `db`):**
  - Happy path (etapas + a select property): template insert payload has `conta_id`,
    `user_id`, `nome`, `modo_prazo` default `"padrao"`, normalized `etapas`; property
    insert payload rows carry `template_id` + `conta_id` + generated option-id `config`;
    return includes `id`, `etapas`, and `properties` (with ids).
  - `modo_prazo` honored when provided.
  - No `properties` → no `template_property_definitions` insert; `properties: []`.
  - Template cap (`plan_limit_exceeded:max_workflow_templates` error on the template
    insert) → friendly `McpInputError`; no property insert.
  - **Property insert failure → compensating delete** of the template
    (`.eq("id", …).eq("conta_id", "workspace-A")` recorded) then throw; a
    `max_custom_properties_per_template` error → friendly `McpInputError`.
  - `buildPropertyDefinitions` validation error (e.g. dup names) → `McpInputError`,
    no template insert.
  - **Audit redaction (tool-wrapper test):** invoking the handler logs
    `metadata.args` with `nome`/`etapa_count`/`property_count` and **not** the full
    etapa/option arrays.
- Typecheck: `deno check --node-modules-dir=auto supabase/functions/mcp/index.ts`.

## Out of scope (YAGNI)

- `person`/`created_time` property types; updating/deleting templates or property
  defs; per-option color control (labels only, default color).
- A DB transaction/RPC for template+defs atomicity (compensating delete covers the
  failure path).
- Retrofitting friendly cap messages onto `create_post`/`create_workflow` (a tiny
  separate follow-up).

## Rollout (gated — the heavier one; scope change)

**No migration.** A scope was added, so per the scope-change deploy rule:

1. Deploy **all three** functions to prod (`skjzpekeqefvlojenfsw`) + staging
   (`wlyzhyfondykzpsiqsce`): `mcp` (`--no-verify-jwt`), `mcp-oauth-consent` and
   `mcp-keys` (JWT-on, no flag). After each batch, restore both lock files + `npm ci`.
2. Deploy the **CRM (Vercel)** for the `mcp-scopes.ts` mirror (so the key-creation
   UI + OAuth consent page offer "Modelos (escrita)").
3. Smoke test: a `templates:write` key/connection runs `create_workflow_template`
   with etapas + a select property; confirm the template appears in
   `list_workflow_templates` with the etapas + the property (option ids present);
   `create_workflow({ template_id })` instantiates it; a `posts:write`-only key is
   permission-denied; a duplicate-option-label call returns the `McpInputError`.
