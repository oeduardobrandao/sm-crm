# Design: `list_pages` MCP tool

**Date:** 2026-06-23
**Status:** Approved (pending spec review)
**Branch:** `feat/mcp-list-pages`

## Goal

Expose the client Hub pages (`hub_pages` — strategy docs / materials such as
"Estratégia de Conteúdo") as a read-only MCP tool. An agent connected to the
Mesaas MCP server should be able to read the content strategy and other written
materials an agency has prepared for a client.

This extends the existing MCP read surface (`list_clients`, `get_client`,
`get_brand_profile`, `list_posts`, `get_post`, `list_ideas`, `list_workflows`,
`get_performance_baseline`) with one more tool. No behavioural change to existing
tools.

## Data model (existing)

Pages are stored in `hub_pages`:

| Column          | Type          | Notes                                          |
| --------------- | ------------- | ---------------------------------------------- |
| `id`            | uuid          | PK                                             |
| `conta_id`      | uuid          | Workspace — used for MCP scoping               |
| `cliente_id`    | bigint        | FK → `clientes(id)` ON DELETE CASCADE          |
| `title`         | text          | Page title                                     |
| `content`       | jsonb         | Array of content blocks (default `[]`)         |
| `display_order` | int           | Sort order (default 0)                         |
| `created_at`    | timestamptz   | Creation timestamp                             |

`content` is a JSONB array of blocks. The CRM editor (`HubTab.tsx`) writes a
single `markdown` block: `[{ type: 'markdown', content: '<markdown string>' }]`.
The schema also permits `heading`, `paragraph`, `image`, and `link` blocks
(see `apps/hub/src/types.ts` → `HubContentBlock`):

```ts
interface HubContentBlock {
  type: 'paragraph' | 'heading' | 'image' | 'link' | 'markdown';
  content: string;   // text, or URL for image, or link text for link
  href?: string;     // link target (link blocks only)
  level?: 1 | 2 | 3; // heading level (heading blocks only)
}
```

## Tool contract

```
list_pages(client_id?: number) → Page[]
```

- **Scope:** `clientes:read` (same scope as `get_brand_profile`; pages are
  client-level Hub content). No new scope, no changes to `MCP_ALLOWED_SCOPES`,
  the key-creation UI, or OAuth consent scopes.
- **Input shape:** `{ client_id: z.number().int().optional() }`. Optional —
  filters to a single client; omitted returns every page in the workspace.
  Mirrors `list_ideas` / `list_posts`.
- **Output:** array ordered by `display_order`, each item:

  ```jsonc
  {
    "id": "…",
    "cliente_id": 123,
    "title": "Estratégia de Conteúdo",
    "content": "## Estratégia…\n\n- …",   // flattened markdown string
    "display_order": 0,
    "created_at": "2026-…"
  }
  ```

  `content` is flattened from the block array into a single markdown **string**.
  For the common single-`markdown`-block case this is effectively a passthrough.
  Returns `[]` when the client has no pages (consistent with the other list
  tools). Output keeps the raw column name `cliente_id` to match `list_ideas`.

## Components / files

### 1. `supabase/functions/mcp/content.ts` — new pure helper

```ts
export function pageContentToMarkdown(content: unknown): string
```

- **Signature is `unknown`, not `unknown[]`.** First line guards:
  `if (!Array.isArray(content)) return "";` — fails closed on `null` or any
  non-array JSONB value. This is boundary code, so it must not assume shape.
- Renders each block by `type`:
  - `markdown` → `content` as-is
  - `heading` → `'#'.repeat(block.level ?? 1) + ' ' + content`
  - `paragraph` → `content`
  - `link` → `[content](href)` when `href` is present, otherwise bare `content`
  - `image` → `![](content)` (`content` is the image URL; there is no alt field)
  - unknown / unrecognised `type` → skipped
- Joins rendered blocks with a blank line (`\n\n`) and `.trim()`s the final
  result, so an empty/`[]` array yields `""`.

Lives alongside the other pure helpers (`deriveFormatMeta`, `quartiles`,
`allowlistClient`) so it is unit-testable without a database.

### 2. `supabase/functions/mcp/queries.ts` — new query

```ts
export async function listPages(
  d: Deps,
  args: { client_id?: number },
): Promise<any[]> {
  let q = d.db
    .from("hub_pages")
    .select("id, cliente_id, title, content, display_order, created_at")
    .eq("conta_id", d.ctx.conta_id);
  if (args.client_id !== undefined) q = q.eq("cliente_id", args.client_id);
  const { data, error } = await q.order("display_order");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...row,
    content: pageContentToMarkdown(row.content),
  }));
}
```

- Selects **only** the six output columns (no `conta_id` in the projection).
- Filters `conta_id = d.ctx.conta_id` (workspace isolation, identical to every
  other query helper).
- Optional `cliente_id` filter; orders by `display_order`.
- **Destructures `{ data, error }` and `throw`s on `error`** — many existing
  helpers only destructure `{ data }`, so this is the explicit choice that makes
  "query failures surface as generic MCP errors" actually true. The thrown error
  is caught by the `register()` wrapper's `try/catch → errorResult`, which
  returns a generic message (no raw detail leaked).
- Maps each row's `content` through `pageContentToMarkdown`.

### 3. `supabase/functions/mcp/tools.ts` — register the tool

```ts
import { /* … */ listPages } from "./queries.ts";

register(server, deps, "list_pages", "clientes:read",
  "Lista as páginas de conteúdo (estratégia, materiais) dos clientes do workspace.",
  { client_id: z.number().int().optional() },
  (a) => listPages(deps, a));
```

Audit logging is automatic via the `register()` wrapper.

## Error handling

Entirely inherited from the `register()` wrapper:

- `requireScope(deps.ctx, "clientes:read")` throws `McpScopeError` when the key /
  grant lacks the scope → `errorResult`.
- `listPages` throwing on a Supabase error → caught by the same `try/catch` →
  generic error result. No raw DB error detail returned to the client.
- Workspace isolation enforced by the `conta_id` filter; a key for workspace A
  can never read workspace B's pages.

## Testing

Unit tests for `pageContentToMarkdown` in
`supabase/functions/__tests__/mcp-content_test.ts`:

1. single `markdown` block → passthrough of the markdown string
2. `heading` blocks render `#` / `##` / `###` by `level` (and default to `#`
   when `level` is absent)
3. `link` block → `[text](href)`; `link` without `href` → bare text
4. `image` block → `![](url)` using `content` as the URL
5. `paragraph` block → text; multiple blocks joined with a blank line
6. unknown `type` → skipped
7. `[]` → `""`
8. **non-array / `null` content → `""`** (the fail-closed guard)

Run with `deno test supabase/functions/`.

`listPages` and the `tools.ts` registration follow the existing
untested-by-convention pattern (matching `listIdeas` et al.), so no query-level
tests are added. If a registry / tool-count assertion exists in the test suite
it will be updated, but the current pattern is registration-only with no such
count check.

## Out of scope (YAGNI)

- No write / edit / delete tools — read-only, like the rest of the MCP surface.
- No new scope and no key-UI / admin-UI / OAuth-consent changes.
- No pagination — pages are few per client.
- No structured (non-flattened) content output — the markdown string is the
  useful form for an agent.
