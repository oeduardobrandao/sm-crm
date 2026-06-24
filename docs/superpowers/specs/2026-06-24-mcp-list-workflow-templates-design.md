# Design: `list_workflow_templates` MCP read tool (slice 2c-1)

**Date:** 2026-06-24
**Status:** Approved (pending spec review)
**Branch:** `feat/mcp-list-workflow-templates`

## Goal

Give MCP agents read access to the workspace's **workflow templates** — the
reusable production-flow blueprints (their steps/etapas) and the custom-property
*schema* attached to each. This lets an agent understand how the agency
structures its work and, in later slices, instantiate a template
(`create_workflow` gains `template_id`) and set custom property values on posts
(`set_post_property`).

This is slice 2c-1, the read foundation. It is the first of four planned 2c
capabilities (the others — template-use, `set_post_property`, and template
creation — are separate later slices). Read-before-write, matching the
`list_pages` / `list_post_feedback` rhythm.

**No migration, no new scope, no frontend change** — reuses the existing
`workflows:read` scope (templates are the blueprints behind "fluxos de produção").

## Data model (existing)

- **`workflow_templates`** (`20260301_baseline_schema.sql:134` + `modo_prazo` via
  `20260421000000_workflow_deadline_modes.sql`): `id`, `user_id`, `conta_id`,
  `nome`, `etapas` (jsonb, default `[]`), `modo_prazo`
  (`padrao|data_fixa|data_entrega`, default `padrao`), `created_at`.
  - Each `etapas` element (CRM `WorkflowTemplateEtapa`): `{ nome, prazo_dias,
    tipo_prazo: 'uteis'|'corridos', responsavel_id?: number|null,
    tipo?: 'padrao'|'aprovacao_cliente' }`. Steps are an ordered JSON array.
- **`template_property_definitions`** (`20260403_custom_properties.sql:6`): `id`,
  `template_id` (→ `workflow_templates`), `conta_id`, `name`, `type`
  (`text|number|select|multiselect|status|date|person|checkbox|url|email|phone|created_time`),
  `config` (jsonb, type-dependent; for `select`/`multiselect`/`status` it carries
  the options), `portal_visible` (bool), `display_order` (int), `created_at`.

Both tables carry `conta_id` directly — the tenant boundary is a direct
`.eq("conta_id", ctx.conta_id)` on each (no join needed), like `list_pages`.

## Tool contract

```
list_workflow_templates() → [
  {
    id: number,                       // handle for slice B (create_workflow template_id)
    nome: string,
    modo_prazo: string | null,        // padrao | data_fixa | data_entrega
    etapas: [
      { nome: string, prazo_dias: number, tipo_prazo: "uteis"|"corridos", tipo: "padrao"|"aprovacao_cliente" }
    ],
    properties: [
      { id: number,                   // handle for slice C (post_property_values.property_definition_id)
        name: string,
        type: string,                 // the property type
        config: object,               // verbatim — type-dependent (select options live here)
        portal_visible: boolean,
        display_order: number }
    ]
  }
]
```

No arguments — templates are workspace-global and few; the tool lists them all.

## `listWorkflowTemplates(d, args)` algorithm (`queries.ts`)

1. **Templates query (tenant-scoped, deterministic order):**
   ```ts
   const { data: templates, error } = await d.db
     .from("workflow_templates")
     .select("id, nome, modo_prazo, etapas")
     .eq("conta_id", d.ctx.conta_id)
     .order("nome", { ascending: true })
     .order("id", { ascending: true });   // tiebreaker → fully deterministic
   if (error) throw error;
   const rows = (templates ?? []) as any[];
   ```
2. **Empty fast-path:** `if (rows.length === 0) return [];` — skips the property
   query entirely when there are no templates.
3. **Property definitions query (tenant boundary + exact grouping):**
   ```ts
   const templateIds = rows.map((t) => t.id);
   const { data: defs, error: defErr } = await d.db
     .from("template_property_definitions")
     .select("id, template_id, name, type, config, portal_visible, display_order")
     .eq("conta_id", d.ctx.conta_id)            // tenant boundary
     .in("template_id", templateIds)            // exact grouping; no orphan rows
     .order("display_order", { ascending: true })
     .order("id", { ascending: true });         // tiebreaker
   if (defErr) throw defErr;
   ```
   The `conta_id` filter is the tenant boundary; the `template_id` filter keeps
   grouping exact (and avoids returning unrelated rows if data ever drifts).
4. **Group properties by `template_id`** into a `Map<number, Property[]>`,
   projecting each def to `{ id, name, type, config, portal_visible, display_order }`
   (drops `template_id`/`conta_id`/`created_at`). Order is preserved from the
   query (display_order, then id).
5. **Assemble** one object per template, preserving the templates' query order:
   ```ts
   return rows.map((t) => ({
     id: t.id,
     nome: t.nome,
     modo_prazo: t.modo_prazo ?? null,
     etapas: projectTemplateEtapas(t.etapas),
     properties: propsByTemplate.get(t.id) ?? [],
   }));
   ```

## `projectTemplateEtapas` (pure helper, `content.ts`)

```ts
projectTemplateEtapas(raw: unknown): { nome: string; prazo_dias: number; tipo_prazo: "uteis"|"corridos"; tipo: "padrao"|"aprovacao_cliente" }[]
```
- **Fail closed on malformed JSONB:** `if (!Array.isArray(raw)) return [];` (mirrors
  `pageContentToMarkdown`'s defensive posture).
- Skip non-object elements; for each object element emit, **preserving array order**:
  - `nome`: `typeof e.nome === "string" ? e.nome : ""`
  - `prazo_dias`: `typeof e.prazo_dias === "number" ? e.prazo_dias : 0`
  - `tipo_prazo`: `e.tipo_prazo === "uteis" ? "uteis" : "corridos"` (column default)
  - `tipo`: `e.tipo === "aprovacao_cliente" ? "aprovacao_cliente" : "padrao"` (system default)
- **Drops `responsavel_id`** — an internal team-member id, irrelevant to a content
  agent and mildly internal. The step structure (including which step is the
  `aprovacao_cliente` client-gate) is preserved.

## Why `config` is exposed verbatim

`template_property_definitions.config` is intentionally type-dependent JSON
(the schema comments it as such, and the existing MCP seed notes the `select`
config shape is not yet fully normalized). Passing it through verbatim is
faithful and robust, and it is exactly what slice C (`set_post_property`) will
read to validate values. Normalizing now would create a second contract to
maintain before C exists. Each property also carries its **`id`** — the handle
C writes against (`post_property_values.property_definition_id`).

## Tenant security

Both reads are scoped by `.eq("conta_id", ctx.conta_id)` directly (the `mcp`
function uses a service-role client, so these app-level filters are the sole
boundary). The property query additionally filters `.in("template_id",
templateIds)` where `templateIds` comes only from this workspace's templates, so
cross-tenant or orphan property rows cannot appear.

## Components / files

- **`mcp/content.ts`** — `projectTemplateEtapas` (pure).
- **`mcp/queries.ts`** — `listWorkflowTemplates(d, args)` (two scoped reads +
  grouping); import `projectTemplateEtapas`.
- **`mcp/tools.ts`** — register `list_workflow_templates` under `workflows:read`
  (no args shape); import `listWorkflowTemplates`.
- **No** migration, **no** `_shared/mcp-token.ts` change, **no** frontend change.

### Tool registration (tools.ts)

```ts
register(server, deps, "list_workflow_templates", "workflows:read",
  "Lista os modelos de fluxo (workflow templates) do workspace: etapas e o esquema de propriedades personalizadas de cada um.",
  {},
  () => listWorkflowTemplates(deps, {}));
```

## Audit

Reads use the existing `register()` audit path with the identity `auditArgs`
(no redactor) — args are empty, so the audit row records the call with no
payload. No change to `register()`.

## Testing

New file `supabase/functions/__tests__/mcp-templates_test.ts`, run with
`npm run test:functions`.

- **`projectTemplateEtapas` (unit):** array of well-formed etapas → projected
  `{nome, prazo_dias, tipo_prazo, tipo}` in order, `responsavel_id` dropped;
  missing `tipo`/`tipo_prazo` → defaults `padrao`/`corridos`; non-array input
  (`null`, `{}`, `"x"`) → `[]`; non-object elements skipped.
- **`listWorkflowTemplates` (recording fake `db`):**
  - Templates read is scoped `.eq("conta_id", "workspace-A")`; properties read is
    scoped `.eq("conta_id", "workspace-A")` **and** `.in("template_id", [...])`
    with exactly the returned template ids.
  - Properties are grouped onto the correct template by `template_id`; each
    property keeps `id` and `config` (verbatim object), drops `template_id`.
  - `etapas` are projected (no `responsavel_id`) and preserve order.
  - **Empty fast-path:** zero templates → returns `[]` and the
    `template_property_definitions` table is **never queried** (assert no `from`
    call on it).
- Typecheck: `deno check --node-modules-dir=auto supabase/functions/mcp/index.ts`.

## Out of scope (YAGNI)

- `workflow_select_options` (per-workflow on-the-fly select additions) — a slice-C
  concern, not template-level schema.
- Any write (template create/edit, instantiate, set property).
- Counts of workflows/clients using each template; resolving `responsavel_id` to
  a name.

## Rollout (gated — explicit go-ahead required)

No migration, no scope change. Deploy `mcp` only (`--no-verify-jwt`) to prod
(`skjzpekeqefvlojenfsw`) + staging (`wlyzhyfondykzpsiqsce`), then restore both
lock files (`git checkout deno.lock supabase/functions/deno.lock`) + `npm ci`.
Smoke-test: a `workflows:read` key/connection runs `list_workflow_templates`
and gets the workspace's templates with etapas + properties; a key without
`workflows:read` is denied.
