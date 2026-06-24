# Design: `set_post_property` MCP write tool (slice 2c-C)

**Date:** 2026-06-24
**Status:** Approved (pending spec review)
**Branch:** `feat/mcp-set-post-property`

## Goal

Let an MCP agent write a custom property *value* on a post — e.g. tag a post's
`modo` (a `select`) or fill an `anotação` (`text`). This pairs with
`list_workflow_templates` (slice 2c-1): the agent reads the template's property
**schema** there, and writes a **value** here. Values are validated against the
real CRM-defined property definition (type + options), template-constrained, and
confined to the agent's internal-editable post statuses.

This is capability C of the 2c group. **No migration, no new scope, no frontend
change** — reuses the existing `posts:write` scope and the `EDITABLE_STATUSES`
constant from slice 2b.

## Data model (existing)

- **`post_property_values`** (`20260403_custom_properties.sql:25`): `id`, `post_id`
  (→ `workflow_posts`), `property_definition_id` (→ `template_property_definitions`),
  `value` (jsonb), `updated_at`. `UNIQUE (post_id, property_definition_id)`.
  **No `conta_id` and no `status` column** — so a status/editability guard cannot
  be applied atomically to the value write (see "Write atomicity").
- **`template_property_definitions`**: `id`, `template_id`, `conta_id`, `name`,
  `type`, `config` (jsonb, type-dependent), `portal_visible`, `display_order`.
- **`workflow_select_options`** (`…:39`): per-workflow on-the-fly select options:
  `workflow_id`, `property_definition_id`, `conta_id`, `option_id` (uuid), `label`,
  `color`.
- A post's properties are keyed to its **workflow's template's** definitions; the
  CRM renders a post's properties from `getPropertyDefinitions(workflow.template_id)`.

### Value encoding per `type` (how the CRM stores `post_property_values.value`)

- `text`/`url`/`email`/`phone` → a **string**
- `number` → a **number** (or `null`)
- `date` → an ISO date **string** `YYYY-MM-DD`
- `checkbox` → a **boolean**
- `select`/`status` → the **option id** string — a template option's
  `config.options[].id`, or a `workflow_select_options.option_id` (uuid)
- `multiselect` → an **array of option id strings**
- `person` (membros id) and `created_time` (auto/computed) → **not agent-settable**

## Tool contract

```
set_post_property({
  post_id:     int>0,
  property_id: int>0,                              // template_property_definitions.id (from list_workflow_templates)
  value:       string | number | boolean | string[] | null,   // null clears the property
}) → { post_id, property_id, value, status }       // status reflects any auto-move
```

One property per call.

## `setPostProperty(d, args)` algorithm (`queries.ts`)

1. **Fetch post + its template (tenant-scoped):**
   ```ts
   const { data: post, error: postErr } = await d.db
     .from("workflow_posts")
     .select("id, status, workflow_id, workflows!inner(template_id, conta_id)")
     .eq("conta_id", d.ctx.conta_id)
     .eq("workflows.conta_id", d.ctx.conta_id)   // defense-in-depth (service-role bypasses RLS)
     .eq("id", args.post_id)
     .maybeSingle();
   if (postErr) throw postErr;
   ```
   - not found → `McpInputError("Post não encontrado neste workspace.")`
   - `status ∉ EDITABLE_STATUSES` (`["rascunho","revisao_interna","correcao_cliente"]`, reused from slice 2b) → `McpInputError("Post em estado '<status>' não pode ser editado pelo agente.")`
   - `post.workflows.template_id` is null → `McpInputError("O fluxo deste post não usa um modelo, então não há propriedades para definir.")`
2. **Fetch the definition + verify it belongs to the post's template:**
   ```ts
   const { data: def, error: defErr } = await d.db
     .from("template_property_definitions")
     .select("id, template_id, name, type, config")
     .eq("conta_id", d.ctx.conta_id)
     .eq("id", args.property_id)
     .maybeSingle();
   if (defErr) throw defErr;
   ```
   - not found → `McpInputError("Propriedade não encontrada neste workspace.")`
   - `def.template_id !== post.workflows.template_id` → `McpInputError("Esta propriedade não pertence ao modelo do fluxo deste post.")` ← the template constraint
3. **Build the allowed option-id set** — only for `select`/`status`/`multiselect`:
   ```ts
   const allowed = new Set(extractTemplateOptionIds(def.config));
   if (["select","status","multiselect"].includes(def.type)) {
     const { data: wso, error: wsoErr } = await d.db
       .from("workflow_select_options")
       .select("option_id")
       .eq("conta_id", d.ctx.conta_id)
       .eq("workflow_id", post.workflow_id)
       .eq("property_definition_id", args.property_id);
     if (wsoErr) throw wsoErr;
     for (const o of wso ?? []) allowed.add(o.option_id);
   }
   ```
   (For non-option types `allowed` is unused.)
4. **Validate** `value` against `def.type`:
   ```ts
   const err = validatePropertyValue(def.type, args.value, allowed);
   if (err) throw new McpInputError(err);
   ```
   This rejects `person`/`created_time`/unknown types, type-mismatches, and
   invalid/unknown option ids. **`null` clears any *settable* property type;
   non-settable types (`person`/`created_time`/unknown) cannot be set or cleared
   by the agent** (the non-settable check runs before the null-clear shortcut).
5. **Write — status-first for `correcao_cliente`, then upsert** (see "Write atomicity"):
   ```ts
   let status = post.status;
   if (post.status === "correcao_cliente") {
     const { data: moved, error: moveErr } = await d.db
       .from("workflow_posts")
       .update({ status: "revisao_interna" })
       .eq("conta_id", d.ctx.conta_id)
       .eq("id", args.post_id)
       .eq("status", "correcao_cliente")     // guarded; abort if it changed
       .select("id")
       .maybeSingle();
     if (moveErr) throw moveErr;
     if (!moved) throw new McpInputError("O status do post mudou; tente novamente.");
     status = "revisao_interna";
   }
   const { error } = await d.db
     .from("post_property_values")
     .upsert(
       { post_id: args.post_id, property_definition_id: args.property_id,
         value: args.value, updated_at: d.now?.() ?? new Date().toISOString() },
       { onConflict: "post_id,property_definition_id" },
     );
   if (error) throw error;
   return { post_id: args.post_id, property_id: args.property_id, value: args.value, status };
   ```

## Write atomicity (the chosen approach)

`post_property_values` has no `conta_id`/`status` column, so — unlike
`update_post`'s single-row `.update(...).in("status", EDITABLE_STATUSES)` — the
value write cannot be atomically gated on the post's status. Chosen app-level
posture (no migration):

- **`correcao_cliente` (client-visible in the Hub):** do the guarded status move
  to `revisao_interna` **first**, aborting if it returns no row, **then** upsert the
  value. So a `portal_visible` value is never written while the post is still in
  the client's view.
- **`rascunho`/`revisao_interna` (not in `PostagensPage` `VISIBLE_STATUSES`):**
  upsert directly — the post is not client-visible at write time.
- **Documented residual race (accepted):** if a `rascunho`/`revisao_interna` post
  is moved to a client-facing status by another actor in the tiny window between
  the prefetch and the upsert, the value lands on a now-client-facing post. Low
  severity — it is a metadata field, the window is milliseconds, and closing it
  fully would require an RPC/transaction (explicitly deferred). The
  upsert-then-degradation note also covers the rare case where the `correcao_cliente`
  move succeeds but the upsert then fails: the post is safely out of view and the
  agent can retry.

## Pure helpers (`content.ts`)

```ts
extractTemplateOptionIds(config: unknown): string[]
```
- If `config` is a plain object and `config.options` is an array, return each
  element's `id` that is a string; otherwise `[]`. Fully defensive (config /
  options / element / id may be malformed).

```ts
validatePropertyValue(type: string, value: unknown, allowedOptionIds: Set<string>): string | null
```
Returns a caller-safe error message, or `null` if valid.
- Non-settable `type` (`person`, `created_time`, or anything not in the settable
  set) → `"Tipo de propriedade '<type>' não pode ser definido pelo agente."`
  (checked **before** the null-clear shortcut, so a non-settable type cannot be
  set *or* cleared).
- `value === null` → `null` (valid clear) for any settable type.
- `text`/`url`/`email`/`phone` → must be a string.
- `number` → must be a number.
- `checkbox` → must be a boolean.
- `date` → must be a string matching `/^\d{4}-\d{2}-\d{2}$/` (light validation,
  matching the CRM `<input type=date>`; not full calendar validation).
- `select`/`status` → must be a string in `allowedOptionIds`.
- `multiselect` → must be an array where every element is a string in
  `allowedOptionIds`.

Settable set: `text,url,email,phone,number,date,checkbox,select,status,multiselect`.

## Scope & tenant security

- Reuses **`posts:write`**. Every read/write is `conta_id`-scoped (service-role
  client → app-level filters are the sole boundary). The post fetch additionally
  filters the embedded `workflows.conta_id` (defense-in-depth against an
  inconsistent row, since RLS is bypassed); the option lookup is also
  `workflow_id`- and `property_definition_id`-scoped; the value write is
  template-constrained (step 2). The `correcao_cliente` move is guarded on
  `conta_id`+`id`+`status`. Every read/write/move re-throws its DB `error` (mapped
  to a generic message by `errorResult`); only the app-level guard failures throw
  `McpInputError`.

## Audit redaction

Property values can be free text (e.g. a client annotation), so the redactor logs
ids + kind/size only — never the raw value:
```ts
(a) => {
  const v = a.value;
  return {
    post_id: a.post_id,
    property_id: a.property_id,
    value_kind: v === null ? "null" : Array.isArray(v) ? "array" : typeof v,
    value_len: typeof v === "string" ? v.length : undefined,
    value_count: Array.isArray(v) ? v.length : undefined,
  };
}
```

## Error handling

All validation failures throw `McpInputError` (caller-safe message); raw DB
errors are re-thrown and mapped to the generic `"Internal error."` by the
existing `errorResult` (no change to `tools.ts`'s error path).

## Components / files

- **`mcp/content.ts`** — `extractTemplateOptionIds`, `validatePropertyValue` (pure).
- **`mcp/queries.ts`** — `setPostProperty` (reuses `EDITABLE_STATUSES`).
- **`mcp/tools.ts`** — register `set_post_property` under `posts:write` + the audit
  redactor; import `setPostProperty`.
- **`__tests__/mcp-content_test.ts`** — `extractTemplateOptionIds` +
  `validatePropertyValue` unit tests.
- **`__tests__/mcp-writes_test.ts`** — `setPostProperty` query tests + the audit
  redaction tool-wrapper test (extend the recording fake `db` with `upsert`).
- **No** migration, **no** `_shared/mcp-token.ts` change, **no** frontend change.

### Tool registration (tools.ts)

```ts
register(server, deps, "set_post_property", "posts:write",
  "Define o valor de uma propriedade personalizada de um post (ex.: modo, anotação). A propriedade deve pertencer ao modelo do fluxo do post.",
  {
    post_id: z.number().int().positive(),
    property_id: z.number().int().positive(),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
  },
  (a) => setPostProperty(deps, a),
  (a) => ({ /* redactor above */ }));
```

## Testing

Run with `npm run test:functions`.

- **`extractTemplateOptionIds` (unit, `mcp-content_test.ts`):** well-formed config
  `{options:[{id:"a"},{id:"b"}]}` → `["a","b"]`; missing/non-array `options` → `[]`;
  non-object config (null/array/scalar) → `[]`; elements lacking a string `id`
  skipped.
- **`validatePropertyValue` (unit, `mcp-content_test.ts`):** each settable type
  happy + type-mismatch (returns a message); `null` → valid for a settable type;
  `person`/`created_time` → rejection message even for `null`; `select` value in
  vs not in `allowedOptionIds`; `multiselect` all-valid vs one-invalid; `date`
  format pass/fail.
- **`setPostProperty` (recording fake `db`, `mcp-writes_test.ts` — extend the fake
  with `upsert`):**
  - post fetch scoped `.eq("conta_id","workspace-A")`; missing post → `McpInputError`,
    no upsert.
  - non-editable status → `McpInputError`, no upsert.
  - workflow without `template_id` → `McpInputError`, no upsert.
  - property from a **different** template → `McpInputError`, no upsert.
  - option lookup (select) scoped `.eq("conta_id"…).eq("workflow_id"…).eq("property_definition_id"…)`;
    invalid option → `McpInputError`, no upsert; a valid `workflow_select_options`
    option → upsert succeeds.
  - happy upsert payload: `{ post_id, property_definition_id, value, updated_at }`
    with `updated_at` from the injected `d.now`, `onConflict: "post_id,property_definition_id"`.
  - `correcao_cliente`: the guarded `workflow_posts` status `update`
    (`.eq("status","correcao_cliente")` → `revisao_interna`) is recorded **before**
    the `post_property_values` upsert; the returned `status` is `revisao_interna`;
    a null result from the guarded move → `McpInputError` and **no** upsert.
  - **Audit redaction (tool-wrapper test):** invoking the registered handler with a
    string `value` records `metadata.args` that **excludes** the raw value string
    and carries `value_kind`/`value_len`.
- Typecheck: `deno check --node-modules-dir=auto supabase/functions/mcp/index.ts`.

## Out of scope (YAGNI)

- Creating new select options (`workflow_select_options` writes).
- `person` / `created_time` types; batch multi-property set.
- An RPC/transaction for fully-atomic write (the residual race is documented/accepted).
- The dead MCP auto-seed (`MCP_SEED_DEFS` modo/anotação) — C uses real CRM template
  definitions.

## Rollout (gated — explicit go-ahead required)

No migration, no scope change. Deploy `mcp` only (`--no-verify-jwt`) to prod
(`skjzpekeqefvlojenfsw`) + staging (`wlyzhyfondykzpsiqsce`), then restore both lock
files (`git checkout deno.lock supabase/functions/deno.lock`) + `npm ci`.
Smoke-test: a `posts:write` connection reads `list_workflow_templates`, picks a
template-based post in `rascunho`, and sets a `select` (`modo`) + a `text`
(`anotação`); confirm an out-of-template property id, a non-editable post, and an
invalid option each return the `McpInputError`; confirm setting a property on a
`correcao_cliente` post moves it to `revisao_interna`.
