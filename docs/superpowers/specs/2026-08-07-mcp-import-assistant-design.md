# MCP importing-assistant tools: create_client, create_member, list_members

**Date:** 2026-08-07
**Status:** Approved design, pending implementation plan
**Branch:** `claude/mcp-create-clients-members-b726e9`

## Goal

Let an agent connected to the Mesaas MCP server act as an importing assistant when a
user migrates from another platform (Notion, Trello, ClickUp, spreadsheets). Today the
MCP can create posts, workflows, templates and media, but clients and team members are
read-only or absent, so a migration conversation dead-ends immediately. This adds the
missing create tools.

## Decisions made during brainstorming

1. **"Team members" means `membros` roster rows only.** No auth invites, no emails, no
   `workspace_members` seats. The user invites people to log in later via the Equipe
   page, where the existing invite flow links `membros.crm_user_id`. Rationale: an
   agent must not send emails to real people or consume `max_team_members` seats as a
   side effect of an import.
2. **Find-or-create by name.** A case-insensitive `nome` match within the workspace
   returns the existing row with `already_existed: true` instead of inserting.
   Retries and re-runs are idempotent; no "(2)"-suffix duplicates.
3. **Financial fields are accepted** (`clientes.valor_mensal`, `membros.custo_mensal`),
   matching the CSV wizard precedent (`import_commit_row` accepts `valorMensal` under
   the service role). Known, accepted caveat: an MCP key created by an admin without
   financial access can write financial values the UI hides from them. The CSV wizard
   has the same hole.
4. **Fill-empty merge on match.** Payload values land only where the existing row is
   empty; existing data is never overwritten (details in Semantics below).
5. **Approach A: self-contained MCP tool logic** in `mcp/queries.ts`, mirroring the
   existing write tools (`create_post`, `create_workflow_template`). Rejected:
   reusing the `data-import` RPC (job lifecycle does not map onto an open-ended agent
   conversation; RPC has no `membros` support) and calling the `data-import` edge
   function over HTTP (worst fit). Trade-off accepted: no 7-day undo. Conversational
   imports are incremental and user-confirmed, find-or-create makes retries harmless,
   and every call is audit-logged.

## Scopes

Three new scopes, added in **both** scope lists (they cannot share code across the
Deno/Vite boundary):

| Scope | Meaning | File |
|---|---|---|
| `clientes:write` | criar clientes | `supabase/functions/_shared/mcp-token.ts` (`MCP_ALLOWED_SCOPES`) |
| `membros:read` | ler equipe (roster) | + `apps/crm/src/lib/mcp-scopes.ts` (`SCOPE_OPTIONS`, pt-BR labels) |
| `membros:write` | criar membros da equipe | (same two files) |

- `membros:read` also joins `MCP_AGENT_PRESET` (mcp-token.ts) and `AGENT_PRESET`
  (mcp-scopes.ts): it is a read, like the existing five.
- The write scopes stay **out** of the presets: explicit opt-in, same treatment as
  `posts:write`.
- Existing API keys and OAuth grants never gain new scopes. Users mint a new key or
  re-consent. The scope checkboxes in Configurações render from `SCOPE_OPTIONS`, so
  the UI picks the new scopes up with no further UI work.

## Tools

Three new `register()` entries in `supabase/functions/mcp/tools.ts`; logic in
`supabase/functions/mcp/queries.ts` following the `createWorkflowTemplate` pattern
(service-role client, every query filtered/stamped with `ctx.conta_id`).

### create_client (scope `clientes:write`)

Input (zod shape):

| Field | Type | Notes |
|---|---|---|
| `nome` | string, required | trim, 1..120 |
| `email` | string, optional | |
| `telefone` | string, optional | |
| `especialidade` | string, optional | |
| `valor_mensal` | number ≥ 0, optional | accepted, never echoed back |
| `status` | enum `ativo\|pausado\|encerrado`, optional | default `ativo`, used on insert only |

Derived on insert: `sigla` reproducing the CSV-import rule in TypeScript: strip
non-ASCII-letters from `nome`, append `'XX'`, take the first two chars, uppercase —
so a fully non-alphabetic nome (e.g. "123") still yields `'XX'` instead of an
invalid empty sigla. (The SQL original at `20260729000004:305-321` additionally
coalesces an absent nome to `''`; unnecessary here because `nome` is zod-required,
but the non-alphabetic fallback must be kept.) Also on insert: `cor` default
`#eab308`; `plano: ''`; `user_id: ctx.created_by`; `conta_id: ctx.conta_id`.

Returns: `{ id, nome, sigla, status, email, telefone, especialidade, already_existed,
filled_fields }`. No financial fields in any response, keeping parity with
`list_clients`/`get_client` ("campos não sensíveis").

### create_member (scope `membros:write`)

Input:

| Field | Type | Notes |
|---|---|---|
| `nome` | string, required | trim, 1..120 |
| `cargo` | string, optional | default `''` |
| `tipo` | enum `clt\|freelancer_mensal\|freelancer_demanda`, optional | default `clt`, insert only |
| `custo_mensal` | number ≥ 0, optional | accepted, never echoed back |
| `data_pagamento` | int 1..31, optional | insert only, not filled on match |

Insert also stamps `user_id`, `conta_id`, `avatar_url: ''`.
Returns: `{ id, nome, cargo, tipo, data_pagamento, already_existed, filled_fields }`.

### list_members (scope `membros:read`)

Returns the roster minus `custo_mensal`:
`id, nome, cargo, tipo, data_pagamento, crm_user_id, created_at`, ordered by
`created_at` desc. No filters (rosters are small).

## Semantics: find-or-create + fill-empty

- Match: `lower(trim(nome))` equality within `ctx.conta_id`. The conta_id scoping is
  the security boundary; the service role sees every workspace.
- Tie-break: there is no unique constraint on `clientes.nome` or `membros.nome`, so
  multiple rows can match (hand-created duplicates exist in prod). The match query
  must use `order by id asc limit 1`: the oldest row is the canonical match, and the
  same input always resolves to the same row. Without the explicit ordering, Postgres
  row order is unspecified and retries could update different rows.
- The fill-empty UPDATE must carry `conta_id = ctx.conta_id` in addition to the
  matched id. RLS `WITH CHECK` does not protect service-role writes; every write
  scopes tenant explicitly by hand (standing lesson recorded at
  `mcp/queries.ts:666`). Low-risk here since the id comes from the just-scoped
  SELECT, but the double filter is the codebase's rule, not an optimization.
- Miss: insert, return `already_existed: false`, `filled_fields: []`.
- Hit: update only empty fields from the payload, return the (possibly updated) row
  with `already_existed: true` and `filled_fields` naming exactly what was written.
  - Text fields (`email`, `telefone`, `especialidade`, `cargo`) fill when the existing
    value is `null`, `''`, or whitespace-only (compare after trim).
  - `valor_mensal` / `custo_mensal` fill only when `NULL`. An explicit `0` is real
    data and stays: identical to the CSV wizard's merge, tested at
    `supabase/migrations/20260729000004_data_import_jobs.sql:40-49`.
  - `nome`, `status`, `cor`, `sigla`, `tipo`, `avatar_url`, `data_pagamento` are never
    modified on a match.
  - The response includes the existing row's `status` (clients) so the agent notices
    when it matched an `encerrado` client.
  - No fillable fields in the payload: return the match untouched,
    `filled_fields: []`.

Concurrency note: find-then-insert is not atomic. Two simultaneous calls with the same
nome can both miss and insert twice. Accepted for v1: conversational imports are
sequential, and there is no unique index on `clientes.nome` to lean on. Not adding one
(hand-created duplicates may already exist in production data).

## Errors and limits

- `clientes` insert trips `trg_limit_clientes` when the plan is full. Catch with the
  existing `isPlanLimitExceeded(err, "max_clients")` helper (defined in
  `mcp/content.ts:517`, already imported by `queries.ts`) and rethrow as
  `McpInputError("Limite de clientes do plano foi atingido.")`.
- `membros` has no count trigger (roster is unlimited, consistent with the UI;
  `max_team_members` applies to `workspace_members` seats, which this feature never
  touches).
- Everything else follows the standard wrapper: missing scope returns
  "Permission denied: missing scope '...'", unexpected errors are logged internally
  and a generic message goes out. Never leak raw DB error text.

## Audit

The `register()` wrapper audits every call as `mcp.<tool>`. `auditArgs` callbacks
record result ids and the `already_existed` / `filled_fields` outcome, and omit
`nome`, `email`, and financial values.

Two precisions the wrapper forces:

- **`resource_id` extraction must be extended.** The `audit()` helper
  (`mcp/tools.ts:52`) derives `resource_id` from a hardcoded key list
  (`post_id ?? client_id ?? workflow_id`). `create_client`'s `auditArgs` returns
  `client_id: result.id` (recognized as-is); for `create_member`, extend the
  extraction list with `member_id` and return `member_id: result.id`. While touching
  that line, also add `template_id`: `create_workflow_template`'s audit rows land
  with an empty `resource_id` today for the same reason.
- **Omitting names is a deliberate choice, not the existing pattern.** The majority
  of current write tools log their title field in cleartext (`create_post` and
  `create_workflow` log `titulo`, `create_workflow_template` logs `nome`); only long
  bodies are redacted, and only `create_task` omits its title. Client and member
  `nome`/`email` are personal data about real people rather than content titles, so
  these tools follow the conservative minority pattern: ids and outcome flags only.

## Testing

Deno tests in `supabase/functions/__tests__/` mirroring the existing MCP suites:

1. create_client / create_member: insert path returns `already_existed: false`; row
   lands with derived `sigla` / defaults.
2. Match path: `already_existed: true`; fill-empty writes only empty fields;
   `valor_mensal = 0` stays `0`; `nome`/`status`/`tipo` untouched.
3. Name match is conta_id-scoped: same nome in another workspace still inserts.
4. Plan-limit translation: `max_clients` trigger error becomes the pt-BR
   McpInputError message.
5. No financial fields in any response (create_client, create_member, list_members).
6. Scope gating: tools reject a ctx missing the scope (covered by the register
   wrapper; one test per new scope).
7. Tie-break determinism: two same-nome rows in the workspace; the older id is
   matched and updated on every retry.
8. Audit resource_id: `create_client` and `create_member` audit rows carry the
   created/matched row id (via `client_id` / the new `member_id` extraction).

Contract-change pass (per repo convention): grep both test suites
(`apps/**/__tests__`, `supabase/functions/__tests__`) for assertions on
`MCP_ALLOWED_SCOPES`, `SCOPE_OPTIONS`, `AGENT_PRESET` or the scope mirror, and update
them alongside the scope additions.

## Files touched

- `supabase/functions/_shared/mcp-token.ts` (scopes + agent preset)
- `supabase/functions/mcp/tools.ts` (three register entries)
- `supabase/functions/mcp/queries.ts` (createClient, createMember, listMembers)
- `apps/crm/src/lib/mcp-scopes.ts` (mirror + pt-BR labels)
- Tests on both sides

No migrations. No new routes. No vercel.json changes. No UI changes beyond the
auto-rendered scope checkboxes.

## Out of scope

- Auth invites / login seats via MCP (deliberately excluded, see Decision 1)
- Undo for MCP-created rows (audit log covers traceability)
- update_client / update_member / delete tools
- Importing entities the MCP already covers (posts, workflows, templates, ideias)
- Unique index on `clientes.nome`
- Copy changes to the Configurações MCP guide page (optional follow-up: one line about
  re-consenting to pick up new scopes)
