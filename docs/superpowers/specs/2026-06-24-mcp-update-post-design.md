# Design: `update_post` MCP write tool (posts-write slice 2b)

**Date:** 2026-06-24
**Status:** Approved (pending spec review)
**Branch:** `feat/mcp-update-post`

## Goal

Give MCP agents the ability to **revise** an existing draft post: edit its
content and advance its status within an internal-only boundary. This closes the
loop the read tools opened — an agent can read client feedback
(`list_post_feedback`), then act on it by editing the draft and resubmitting it
for internal review.

This is slice 2b of posts-write. Slice 2a (`create_workflow` + `create_post`,
shipped in #146) established the write plumbing: the `posts:write` scope,
write-side tenant ownership checks, audit redaction, the `created_via` provenance
column, and `buildTiptapDoc`. 2b reuses all of it — **no new scope, no migration,
no frontend change**.

One tool, gated by the existing `posts:write` scope:

- `update_post({ post_id, titulo?, tipo?, body?, ig_caption?, status? })` —
  partial-updates a post that is in an agent-editable status.

**Why one tool, not two (`update_post` + `set_post_status`):** content and status
share the same row and the same ownership/editability check. Status is just
another optional field gated by its own allowlist; splitting them would double the
round-trips and the attack surface for no benefit.

## The status model (existing)

`workflow_posts.status` lifecycle (CHECK constraint, `20260406_workflow_posts_status_agendado.sql`):

```
rascunho → revisao_interna → aprovado_interno → enviado_cliente
  → aprovado_cliente / correcao_cliente → agendado → postado   (+ falha_publicacao)
```

- **Internal (pre-client):** `rascunho`, `revisao_interna`, `aprovado_interno`.
- **Client boundary:** `enviado_cliente` is the first status the client sees.
- **Correction loop:** `correcao_cliente` means the client reviewed the post and
  asked for changes — the work is back in the agency's court.

## Agent boundary (the heart of the slice)

Two allowlists, defined as constants in `queries.ts`:

```ts
const EDITABLE_STATUSES = ["rascunho", "revisao_interna", "correcao_cliente"];
const AGENT_SETTABLE_STATUSES = ["rascunho", "revisao_interna"];
```

- **Editable source statuses** — the agent may call `update_post` on a post only
  when its current status is in `EDITABLE_STATUSES`. `correcao_cliente` is
  included because the client has handed the post back for changes; revising it
  is the entire point of the feedback loop.
- **Settable destination statuses** — `status` may only be set to a value in
  `AGENT_SETTABLE_STATUSES`. `aprovado_interno` and every client-facing/publish
  status are excluded.

**The hard rule:** the agent can never *set* a client-facing or publish status,
and can never *edit* a post currently in `enviado_cliente`, `aprovado_cliente`,
`agendado`, `postado`, or `falha_publicacao` (awaiting/with the client, or
scheduled/published). A human always performs internal approval, sending to the
client, scheduling, and publishing.

**`correcao_cliente` semantics (explicit):** the agent may revise a
`correcao_cliente` post. An edit leaves the post in `correcao_cliente` **unless**
the agent also passes `status: "revisao_interna"` to resubmit it — an edit never
silently changes status. The board therefore keeps showing "client requested
correction" until someone advances the post, which is accurate.

**Ownership, not authorship:** the agent may edit any post in an editable status
regardless of `created_via` (human or agent). The status guard is the boundary,
not who created the row. This is required for the correction loop —
`correcao_cliente` posts are almost always human-created (a human sent them to
the client). `created_via` is **creation** provenance and is **never** flipped on
edit, so the CRM "IA" badge keeps meaning "who created this."

## Tool contract

```
update_post({
  post_id:     int>0,
  titulo?:     string(trim, 1..200),
  tipo?:       "feed" | "reels" | "stories" | "carrossel",
  body?:       string(max 10000),    // plain text → conteudo (TipTap) + conteudo_plain
  ig_caption?: string(max 2200),     // Instagram caption limit
  status?:     "rascunho" | "revisao_interna",   // zod enum = AGENT_SETTABLE_STATUSES
}) → { id, workflow_id, titulo, tipo, status, ig_caption, created_via, updated_at }
```

Partial update: only provided fields change; at least one updatable field is
required.

### `updatePost(d, args)` algorithm (`queries.ts`)

1. **At-least-one-field check.** `register()` takes a `ZodRawShape`, which cannot
   express an object-level `.refine`, so the check lives here:
   ```ts
   const FIELDS = ["titulo", "tipo", "body", "ig_caption", "status"];
   if (!FIELDS.some((f) => Object.hasOwn(args, f)))
     throw new McpInputError("Informe ao menos um campo para atualizar.");
   ```
2. **Defensive status validation** (defense-in-depth — tests and any future
   caller bypass the zod enum):
   ```ts
   if (Object.hasOwn(args, "status") && !AGENT_SETTABLE_STATUSES.includes(args.status))
     throw new McpInputError("Status inválido para edição pelo agente.");
   ```
3. **Prefetch for granular errors.** Read the post by tenant + id:
   ```ts
   const { data: existing } = await d.db
     .from("workflow_posts")
     .select("id, status")
     .eq("conta_id", d.ctx.conta_id)
     .eq("id", args.post_id)
     .maybeSingle();
   if (!existing)
     throw new McpInputError("Post não encontrado neste workspace.");
   if (!EDITABLE_STATUSES.includes(existing.status))
     throw new McpInputError(
       `Post em estado '${existing.status}' não pode ser editado pelo agente.`);
   ```
4. **Build the payload with presence checks** (so `""` clears, never ignored):
   ```ts
   const payload: Record<string, unknown> = {};
   if (Object.hasOwn(args, "titulo"))     payload.titulo = args.titulo;
   if (Object.hasOwn(args, "tipo"))       payload.tipo = args.tipo;
   if (Object.hasOwn(args, "body")) {
     payload.conteudo = buildTiptapDoc(args.body);   // "" → valid empty doc
     payload.conteudo_plain = args.body ?? "";
   }
   if (Object.hasOwn(args, "ig_caption")) payload.ig_caption = args.ig_caption; // "" stored as-is, renders empty
   if (Object.hasOwn(args, "status"))     payload.status = args.status;
   ```
5. **Atomic guarded update** (re-checks tenant + editability so a status race
   between prefetch and write cannot slip a now-client-facing post through):
   ```ts
   const { data, error } = await d.db
     .from("workflow_posts")
     .update(payload)
     .eq("conta_id", d.ctx.conta_id)
     .eq("id", args.post_id)
     .in("status", EDITABLE_STATUSES)
     .select("id, workflow_id, titulo, tipo, status, ig_caption, created_via, updated_at")
     .maybeSingle();
   if (error) throw error;
   if (!data)
     throw new McpInputError("Post não pôde ser atualizado (estado alterado). Tente novamente.");
   return data;
   ```

The prefetch gives the friendly "not found" vs "not editable in state X"
messages; the guarded `.update()` is the real atomic tenant + editability
boundary. A null result means the row changed status between check and write.

## `body` handling

`body` is **plain text** (not markdown). It is converted with the existing
`buildTiptapDoc` helper (slice 2a, `content.ts`) into a core-node-only TipTap doc
stored in `conteudo`, with `conteudo_plain` set to the raw text. This guards
against the "missing node/mark type silently blanks the Hub post body" failure.
`body: ""` produces a valid empty doc (`{doc, [{paragraph}]}`) and clears
`conteudo_plain`.

## Free behaviors (no code needed)

- **Status timeline:** the `workflow_posts_status_event` trigger
  (`20260606000001_post_status_events.sql`) records any status change to
  `post_status_events`. The `mcp` function uses a service-role client with no
  `auth.uid()` and sets no transaction GUCs, so an agent status change logs as
  `source='system'`, `actor_user_id=null`. Accepted for v1 — the **audit log**
  carries the real actor (the key owner). Attributing the timeline event to the
  key owner via the `app.actor_id` GUC is deferred.
- **`updated_at`:** maintained by the `workflow_posts_updated_at` trigger.

## Audit redaction (write tools must not log payload)

`update_post` carries `body`/`ig_caption` payload, so it passes an `auditArgs`
redactor to `register()` (the optional mapper added in slice 2a). It logs ids +
presence/length only, never content, and uses `Object.hasOwn` to mirror the
payload's clear-on-empty-string semantics:

```ts
(a) => ({
  post_id: a.post_id,
  has_titulo: Object.hasOwn(a, "titulo"),
  tipo: a.tipo,
  status: a.status,
  has_body: Object.hasOwn(a, "body"),
  body_len: a.body?.length ?? 0,
  has_ig_caption: Object.hasOwn(a, "ig_caption"),
  ig_caption_len: a.ig_caption?.length ?? 0,
})
```

`audit()`'s `resource_id` derivation already includes `post_id`
(`tools.ts:44`), so update calls record the post id.

## Error handling

`errorResult` (`tools.ts`, unchanged from 2a) already special-cases:
- `McpScopeError` → `"Permission denied: missing scope 'posts:write'."`
- `McpInputError` → its own message (safe — describes the caller's own workspace).
- Everything else → generic `"Internal error."` + internal `console.error`.

All `update_post` validation failures throw `McpInputError`, so the agent gets an
actionable message while raw DB errors never leak.

## Components / files

- **`mcp/queries.ts`** — add `EDITABLE_STATUSES` + `AGENT_SETTABLE_STATUSES`
  constants and the `updatePost(d, args)` helper. Reuses the imported
  `buildTiptapDoc` and `McpInputError`.
- **`mcp/tools.ts`** — register `update_post` under `posts:write` with the zod
  shape and the audit redactor. Import `updatePost`.
- **`__tests__/mcp-writes_test.ts`** — extend the recording fake `db` with
  `update` (chainable, returning a queued response from `.maybeSingle()`); add
  the tests below.
- **No** migration, **no** `_shared/mcp-token.ts` change, **no** frontend change.

### `update_post` tool registration (tools.ts)

```ts
register(server, deps, "update_post", "posts:write",
  "Edita um post existente (título, formato, corpo, legenda) e pode avançar o status apenas para rascunho ou revisão interna. O agente nunca envia ao cliente nem publica.",
  {
    post_id: z.number().int().positive(),
    titulo: z.string().trim().min(1).max(200).optional(),
    tipo: z.enum(["feed", "reels", "stories", "carrossel"]).optional(),
    body: z.string().max(10000).optional(),
    ig_caption: z.string().max(2200).optional(),
    status: z.enum(["rascunho", "revisao_interna"]).optional(),
  },
  (a) => updatePost(deps, a),
  (a) => ({ /* redactor above */ }));
```

## Testing

All in `__tests__/mcp-writes_test.ts`, run with `npm run test:functions`.

- **Ownership scoping** — `update_post` prefetch queries `workflow_posts` with
  `.eq("conta_id", "workspace-A")`; a missing/foreign post → `McpInputError`, no
  `update` recorded.
- **Editability guard** — a post in a non-editable status (e.g.
  `enviado_cliente`, `postado`) → `McpInputError`, no `update` recorded.
- **Atomic guard** — the recorded `update` call carries
  `.eq("conta_id", "workspace-A")`, `.eq("id", post_id)`, and
  `.in("status", EDITABLE_STATUSES)`; a null `.maybeSingle()` result (simulated
  race) → `McpInputError`.
- **Presence semantics** — `body: ""` builds a payload with `conteudo` = a TipTap
  doc (not a raw string) and `conteudo_plain: ""`; omitting `ig_caption` leaves
  it out of the payload entirely (untouched); passing `ig_caption: ""` includes
  it (cleared).
- **At-least-one-field** — calling with only `post_id` → `McpInputError`, no
  prefetch/update.
- **Destination allowlist (data layer)** — `updatePost` with a `status` outside
  `AGENT_SETTABLE_STATUSES` (e.g. `enviado_cliente`) → `McpInputError`, no
  payload constructed / no `update` recorded. The happy-path payload only ever
  carries an allowlisted status.
- **Audit redaction (tool-wrapper test)** — register `update_post` against a fake
  `server` + fake `db` with `ctx.scopes=['posts:write']`; invoke the captured
  handler with `body`/`ig_caption`; assert the recorded `audit` insert's
  `metadata.args` **excludes** the raw `body`/`ig_caption` strings and carries
  `body_len`/`ig_caption_len` + `has_*` flags.

Typecheck: `deno check --node-modules-dir=auto supabase/functions/mcp/index.ts`.

## Out of scope (YAGNI)

- `set_post_property` (modo / anotação) — the per-`workflow_template` property
  definitions are only seeded "at feature enablement," and the seed's `select`
  config shape is not yet aligned with the CRM renderer. Its own later slice.
- Media attach/upload, scheduling.
- Any client-facing or publish status; `aprovado_interno` as a destination.
- GUC-based timeline attribution (status events stay `source='system'`).
- A `last_edited_via` column — the audit log already records who edited.

## Rollout (gated — explicit go-ahead required)

1. **No migration.** `created_via` already exists on prod (applied in slice 2a).
2. Deploy the function: `npx supabase functions deploy mcp --no-verify-jwt
   --project-ref <prod>`, then restore **both** lock files
   (`git checkout deno.lock supabase/functions/deno.lock`) + `npm ci`. Because
   2b adds no scope, only `mcp` needs deploying — not the
   `mcp-oauth-consent` / `mcp-keys` bundle, and no Vercel redeploy.
3. **Staging:** staging still lacks the `created_via` column (slice 2a's
   migration was never applied there). Apply the slice 2a migration
   (`ALTER TABLE workflows / workflow_posts ADD COLUMN IF NOT EXISTS created_via
   text NOT NULL DEFAULT 'human' CHECK (created_via IN ('human','agent'))`) via
   the staging SQL editor **before** deploying `mcp` to staging.
4. Smoke-test: a `posts:write` key runs `create_post` → `update_post` (edit body,
   set `status: "revisao_interna"`); confirm the draft changes in entregas and a
   `system` status event appears in the timeline; confirm `update_post` on an
   `enviado_cliente`/`postado` post returns the `McpInputError`; confirm a
   `posts:read`-only key gets permission-denied.
