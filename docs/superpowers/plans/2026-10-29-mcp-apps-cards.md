# Cards do Mesaas no Claude e no ChatGPT (MCP Apps) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four MCP Apps cards (post preview, caption options, client calendar, attach chat image) and a card-only "send to client" action to the existing Mesaas MCP server, behind an env switch, plus the material for both directory submissions.

**Architecture:** The stateless per-request MCP server (`supabase/functions/mcp/`) gains annotations on every tool, a versioned `ui://mesaas/cards-v1.html` resource, four card tools that return `structuredContent`, and two widget-only tools guarded by OAuth-only registration and an HMAC send nonce. Two SECURITY DEFINER RPCs do the guarded writes. The card UI is a new single-file React app (`apps/mcp-widgets/`) compiled into a generated TS string that the function serves.

**Tech Stack:** Deno edge function, `npm:@modelcontextprotocol/sdk@1.25.3` (unchanged), zod v3, Postgres migrations + psql suites, React 19 + Vite single-file build, `@modelcontextprotocol/ext-apps` 1.x `App` (widget only), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-mcp-apps-cards-design.md` (read it with this plan; section refs below are to it). Mockups: https://claude.ai/artifact/7naK43HtiXBr1xUVXRbrvL

**Revision 2 (2026-10-29):** incorporates the Fable plan review (SQL suite location, audit redaction, membership recheck, 0-based `sort_order`, zod through fakes, nonce derivation, module layout for parallel lanes). Two deliberate departures from the spec, ruled here: (a) spec §5's "the RPC also verifies the send nonce's fields" is superseded: the nonce is verified in TypeScript before the RPC is called, and the RPC is EXECUTE for `service_role` only, so keeping the HKDF secret out of Postgres; (b) the image host allowlist is the `MCP_IMAGE_HOSTS` secret instead of a code constant, so the pilot can set it without a deploy.

## Global Constraints

- Server SDK stays `npm:@modelcontextprotocol/sdk@1.25.3`; no `@modelcontextprotocol/ext-apps` import under `supabase/functions/`.
- Resource URI exactly `ui://mesaas/cards-v1.html`, mime `text/html;profile=mcp-app`, `_meta.ui.prefersBorder: false`, `_meta.ui.csp.connectDomains: []`, no `_meta.ui.domain`, `_meta["openai/widgetDomain"] = "https://www.mesaas.com.br"`.
- Env switch `MCP_APPS` = `off` (default, also for any unknown value) | `pilot` | `on`; `MCP_APPS_PILOT_CONTAS` comma-separated `conta_id`s. Off ⇒ tool list, tool shapes and resources identical to today except the new `title`/annotations.
- `structuredContent` always has `card` and `v: 1`. Card tools take `client_id` (not `cliente_id`).
- Widget-only tools (`_meta.ui.visibility: ["app"]`) are registered only when cards are on AND `ctx.key_id.startsWith("oauth:")`.
- Send nonce: HMAC-SHA256, key derived with HKDF-SHA256 from `TOKEN_ENCRYPTION_KEY`, info `mcp-send-nonce`, payload `{conta_id, user_id, post_id, exp}` with `exp` in **milliseconds since epoch**, TTL 30 min, carried in result `_meta["mesaas/sendNonce"]`.
- `post_status_events` source for card sends: `'workspace_user'` (CHECK allows only `workspace_user | client | system`).
- Both RPCs recheck membership as `workspace_members(user_id = p_actor, workspace_id = p_conta_id)` only. Never `profiles.active_workspace_id` (the MCP `conta_id` comes from the grant, not the user's active CRM workspace).
- Images: JPEG/PNG only, ≤ 8 MB (8 * 1024 * 1024), fetched only via `fetchImageSafely`, host must be in the `MCP_IMAGE_HOSTS` secret (comma-separated hostnames; empty ⇒ every image refused).
- **Audit redaction:** every new tool passes `auditArgs`. No nonce, `download_url`, slide text, roteiro or caption text ever reaches `audit_log` (`register.ts:44`: "ids/filters only, no payload").
- `post_file_links.sort_order` is **0-based**; tool positions are 1-based, `sort_order = position - 1`.
- `EDITABLE_STATUSES = ["rascunho","revisao_interna","correcao_cliente"]`; carousel max 10 media items; `tipo` feed or carrossel.
- Send-skipped statuses: `enviado_cliente, aprovado_cliente, agendado, postado, falha_publicacao`.
- Migration versions start at `20261105000001`; renumber above `main`'s tail before opening the PR if `main` moved.
- SQL suites live at `supabase/tests/<name>.sql` (top level). `scripts/test-entitlements.sh` never runs a non-numbered file under `supabase/tests/entitlements/`.
- Tests that assert zod limits must parse: a recording fake server validates with `z.object(config.inputSchema).safeParse(args)` before calling the handler (existing fakes call handlers directly, which skips zod).
- All user-facing copy pt-BR, sentence case, **no em dashes**. Errors are full actionable sentences.
- Never log or return raw provider/DB errors to the client (existing `errorResult` rules).
- `mcp` deploys with `--no-verify-jwt --use-api` (unchanged).

## Review Focus

1. A card opened earlier whose post has since changed (sent, approved or edited in the CRM): the send must fail with the right one of `already_sent` / `approved` / `stale` / `failed`, never send twice. Pinned in Tasks 5 and 6.
2. A host without MCP Apps (Claude Code, Codex, a `mesaas_sk_` key): it must never be able to call `send_post_to_client` or `attach_image_to_post`. Pinned in Tasks 2, 6 and 7.
3. A ChatGPT image that is WebP, over 8 MB, from an unexpected host or a private IP: refused with a pt-BR sentence, nothing uploaded or charged. Pinned in Task 7.
4. A caption over 2.200 characters in a preview: the card shows the overflow and disables "Salvar como rascunho" instead of letting `create_post` fail. Pinned in Task 8.
5. A client with no posting history: the calendar shows no "dias de costume" and no gaps (not every empty day flagged). Pinned in Task 4.

## Lanes and waves

Each card module owns its own file and exports `registerXTools(server, deps): void` plus `X_TOOL_META`. Task 2 creates all four modules as stubs and wires them into `tools.ts` and `tool-meta.ts` once, so Tasks 3, 4, 6 and 7 replace their own stub file and touch no shared file (Task 6 also edits `create_post`/`update_post` in `tools.ts` and `previewPost` in `cards.ts`, which is why it waits for Task 3).

- Wave 1 (parallel): Task 1 (annotations), Task 5 (both RPCs + SQL suites), Task 8 (widget app), Task 9 (docs).
- Wave 2: Task 2 (after Task 1).
- Wave 3 (parallel): Tasks 3, 4, 7.
- Wave 4: Task 6 (after Tasks 3 and 5).
- Task 8's last commit regenerates `cards-v1.ts`; it is cherry-picked after Task 2 and wins any conflict on that file.

---

### Task 1: Tool titles and annotations on every tool, via `registerTool`

**Files:**
- Create: `supabase/functions/mcp/tool-meta.ts`
- Modify: `supabase/functions/mcp/register.ts:66-103`
- Modify: every inline fake server with a `tool(name, desc, shape, handler)` method in `supabase/functions/__tests__/mcp-financeiro-helpers.ts` (`fakeServer()`, :63-80), `__tests__/mcp-tarefas_test.ts` (2 fakes), `__tests__/mcp-writes_test.ts` (3 fakes, ~:190/:362/:520), `__tests__/mcp-import_test.ts` (~:278)
- Test: `supabase/functions/__tests__/mcp-annotations_test.ts`

**Interfaces:**
- Produces: `TOOL_META: Record<string, ToolMeta>` with `type ToolMeta = { title: string; readOnly: boolean; destructive?: boolean; openWorld?: boolean }` in `tool-meta.ts` (export the type too); `RegisterOpts` gains `meta?: Record<string, unknown>` (tool `_meta`) and `resultMeta?: (args: any, data: any) => Promise<Record<string, unknown> | undefined>`; `register()` calls `server.registerTool(name, { title, description, inputSchema: shape, annotations, _meta }, cb)` and throws `Error("missing TOOL_META for <name>")` at registration when a name has no entry.
- `annotations` = `{ title, readOnlyHint: readOnly, destructiveHint: destructive ?? false, openWorldHint: openWorld ?? false }`. `_meta` key omitted when `opts.meta` is undefined.

- [ ] **Step 1: Write the failing structural test** `mcp-annotations: every tool has a title and annotations`: a recording fake with `registerTool(name, config, cb)`; `registerTools(fake, deps)` with a ctx holding every scope in `MCP_ALLOWED_SCOPES` and owner role; assert 49 tools recorded, each with non-empty `title`, boolean `annotations.readOnlyHint` and `destructiveHint`; `delete_lancamento`, `delete_funcao`, `fechar_periodo` have `destructiveHint === true`; every `list_*`/`get_*` tool has `readOnlyHint === true`; `create_post` has `readOnlyHint === false`; no tool has `_meta` (cards are off).
- [ ] **Step 2: Run** `deno test --no-check --allow-all supabase/functions/__tests__/mcp-annotations_test.ts` → FAIL.
- [ ] **Step 3: Add `TOOL_META` entries for all 49 tools registered today (24 in `tools.ts`, 25 in `financeiro-tools.ts`)** (pt-BR titles, e.g. `list_clients: { title: "Listar clientes", readOnly: true }`, `create_post: { title: "Criar post em rascunho", readOnly: false }`, `fechar_periodo: { title: "Fechar período", readOnly: false, destructive: true }`) and switch `register()` to `registerTool`; `resultMeta`, when present, is awaited after `run` and its non-empty object is attached as the result's `_meta`.
- [ ] **Step 4: Update every inline fake** to also record `registerTool(name, config, cb)` (same handler map, `config.inputSchema` is the shape).
- [ ] **Step 5: Run** `npm run check:functions && npm run test:functions` → all PASS.
- [ ] **Step 6: Commit** `feat(mcp): títulos e anotações em todas as ferramentas`.

### Task 2: Rollout switch, card resource, `cardResult`, module stubs

**Files:**
- Create: `supabase/functions/mcp/apps.ts`; `supabase/functions/mcp/ui/generated/cards-v1.ts` (placeholder: header `// GENERATED by scripts/build-mcp-widgets.ts. Do not edit.` and `export const CARDS_V1_HTML = "<!doctype html><title>Mesaas</title>";`); stubs `supabase/functions/mcp/cards.ts`, `calendar.ts`, `send.ts`, `attach.ts`, each exporting `registerXTools(_server: any, _deps: Deps): void {}` and `X_TOOL_META: Record<string, ToolMeta> = {}` with X = `Cards` / `Calendar` / `Send` / `Attach`
- Modify: `supabase/functions/mcp/index.ts:117-139`, `supabase/functions/mcp/queries.ts:62-78` (`Deps`), `supabase/functions/mcp/register.ts` (export `cardResult`), `supabase/functions/mcp/tools.ts` (end of `registerTools`), `supabase/functions/mcp/tool-meta.ts` (spread the four `X_TOOL_META`)
- Test: `supabase/functions/__tests__/mcp-apps-switch_test.ts`

**Interfaces:**
- Produces in `apps.ts`:
  - `CARDS_URI = "ui://mesaas/cards-v1.html"`, `CARDS_MIME = "text/html;profile=mcp-app"`
  - `appsEnabledFor(contaId: string, env: { MCP_APPS?: string; MCP_APPS_PILOT_CONTAS?: string }): boolean`
  - `r2OriginFrom(accountId: string | undefined): string | null` → `https://${id}.r2.cloudflarestorage.com` or null
  - `registerCardsResource(server: any, r2Origin: string | null): void` via `server.registerResource("mesaas-cards", CARDS_URI, { mimeType: CARDS_MIME, _meta }, read)`; `_meta = { ui: { prefersBorder: false, csp: { resourceDomains: r2Origin ? [r2Origin] : [], connectDomains: [] } }, "openai/widgetDomain": "https://www.mesaas.com.br" }`; read returns `{ contents: [{ uri: CARDS_URI, mimeType: CARDS_MIME, text: CARDS_V1_HTML, _meta }] }`
  - `cardToolMeta()` → `{ ui: { resourceUri: CARDS_URI } }`; `appOnlyToolMeta()` → `{ ui: { resourceUri: CARDS_URI, visibility: ["app"] } }`
  - `widgetOnly(deps: Deps): boolean` → `deps.apps?.enabled === true && deps.apps.oauth === true`
- `Deps` gains `apps?: { enabled: boolean; oauth: boolean; r2Origin: string | null }`, `resolveDns?: (hostname: string, recordType: "A" | "AAAA") => Promise<string[]>`, `fetchUrl?: (url: string, init: RequestInit) => Promise<Response>` (same types as `mcp-admin/deps.ts:14`).
- `cardResult(summary: string, data: Record<string, unknown>, meta?: Record<string, unknown>)` → `{ content: [{ type: "text", text: summary }], structuredContent: data, ...(meta ? { _meta: meta } : {}) }`.
- End of `registerTools`: `if (deps.apps?.enabled) { registerCardsResource(server, deps.apps.r2Origin); registerCardsTools(server, deps); registerCalendarTools(server, deps); registerSendTools(server, deps); registerAttachTools(server, deps); }`.
- `index.ts`: `apps = { enabled: appsEnabledFor(ctx.conta_id, Deno.env.toObject()), oauth: ctx.key_id.startsWith("oauth:"), r2Origin: r2OriginFrom(Deno.env.get("R2_ACCOUNT_ID")) }`, `resolveDns: (h, t) => Deno.resolveDns(h, t)`, `fetchUrl: (u, i) => fetch(u, i)` (as `mcp-admin/index.ts:130-131`).

- [ ] **Step 1: Write failing tests:**
  - `appsEnabledFor`: `undefined`→false, `"on"`→true, `"pilot"` with `MCP_APPS_PILOT_CONTAS="a, b"` → true for `"b"`, false for `"c"`, `"ON"`/`"yes"`/`"pilot"` with no list → false.
  - `off: tool list identical to baseline`: `apps: {enabled: false, oauth: true, r2Origin: "https://x.r2.cloudflarestorage.com"}` → recorded names deep-equal a checked-in sorted array of today's 49 names, zero `registerResource` calls.
  - `on: resource registered with the exact _meta`: URI, mime, `prefersBorder === false`, `connectDomains` `[]`, `resourceDomains` `["https://x.r2.cloudflarestorage.com"]`, `widgetDomain`, `"domain" in _meta.ui === false`; with `r2Origin: null` → `resourceDomains` `[]`.
  - `widget-only tools need oauth` (`ignore: true` here; Task 7 un-ignores it): with `{enabled: true, oauth: false}` neither `send_post_to_client` nor `attach_image_to_post` is registered; with `oauth: true` both are.
- [ ] **Step 2: Run** `deno test --no-check --allow-all supabase/functions/__tests__/mcp-apps-switch_test.ts` → FAIL.
- [ ] **Step 3: Implement** `apps.ts`, the stubs, `cardResult`, `Deps`, the `registerTools` block, the `tool-meta.ts` spread and the `index.ts` wiring.
- [ ] **Step 4: Run** `npm run check:functions && npm run test:functions` → PASS (one ignored).
- [ ] **Step 5: Commit** `feat(mcp): chave MCP_APPS e recurso ui:// dos cards`.

### Task 3: `preview_post` and `show_caption_options`

**Files:**
- Modify (replace the stub): `supabase/functions/mcp/cards.ts`
- Test: `supabase/functions/__tests__/mcp-cards_test.ts`

**Interfaces:**
- Consumes: `cardResult`, `cardToolMeta`, `register` with `opts.meta`, `Deps`.
- Produces in `cards.ts`:
  - `slidesToBody(slides: { texto: string }[]): string` → `slides.map(s => s.texto.trim()).join("\n\n")`
  - `bodyToSlides(conteudoPlain: string): { texto: string }[]` → split on `/\n\s*\n/`, trim, drop empties
  - `previewPost(d: Deps, a: PreviewArgs): Promise<PreviewData>` with `PreviewArgs = { client_id: number; titulo: string; tipo: "feed" | "carrossel" | "reels" | "stories"; slides?: {texto: string}[]; roteiro?: string; ig_caption: string; post_id?: number; pilar?: string }` (use the existing `Formato` type if `queries.ts` exports one)
  - `captionOptions(d: Deps, a: { client_id: number; post_id?: number; options: { label: string; text: string }[] }): Promise<CaptionOptionsData>`
  - `registerCardsTools(server, deps)` and `CARDS_TOOL_META = { preview_post: { title: "Mostrar prévia do post", readOnly: true }, show_caption_options: { title: "Mostrar opções de legenda", readOnly: true } }`
- `PreviewData` (`structuredContent`): `{ card: "post_preview", v: 1, client: {id, nome}, titulo, tipo, pilar?, slides, roteiro?, ig_caption, caption_len, caption_max, post_id?, body }`; `body` = `slidesToBody(slides)` or `roteiro ?? ""` for reels; `caption_max = captionMaxFor("instagram", tipo) ?? IG_CAPTION_MAX` (`_shared/platform-registry.ts:105-110`).
- `CaptionOptionsData`: `{ card: "caption_options", v: 1, client: {id, nome}, post_id?, options: [{label, text, len}], caption_max }`.
- zod: `slides` max 10, each `texto` 1..2000; `options` length 2..3, `label` 1..60, `text` 1..10000; `ig_caption` max 10000 (the card flags overflow; the server does not reject a long proposal).
- `auditArgs`: preview → `{ client_id, post_id, tipo, slides: slides?.length ?? 0, caption_len }`; options → `{ client_id, post_id, options: options.length }`.

- [ ] **Step 1: Write failing tests** (recording fake that zod-parses, per Global Constraints):
  - `slidesToBody/bodyToSlides round trip`: 3 slides with surrounding whitespace → `bodyToSlides(slidesToBody(s))` deep-equals trimmed input; first line of `slidesToBody(s)` equals slide 1 text.
  - `preview_post: client from another workspace → "Cliente não encontrado neste workspace."`; `post_id of another workspace → "Post não encontrado neste workspace."`.
  - `preview_post: structuredContent has card "post_preview", v 1, caption_len, caption_max 2200`.
  - `preview_post: 11 slides rejected by zod`; `show_caption_options: 1 or 4 options rejected; len per option`.
  - `audit rows carry no slide, roteiro or caption text` (inspect the fake db's `audit_log` insert).
  - `tools absent when apps disabled`.
- [ ] **Step 2: Run** `deno test --no-check --allow-all supabase/functions/__tests__/mcp-cards_test.ts` → FAIL.
- [ ] **Step 3: Implement.** Descriptions: preview_post "Mostra ao usuário a prévia de um post antes de salvar. Use sempre que propuser um post novo ou reescrever um existente."; show_caption_options "Mostra 2 ou 3 opções de legenda lado a lado para o usuário escolher." Summary text: `Prévia de "<titulo>" para <cliente> mostrada ao usuário.` / `Opções de legenda para <cliente> mostradas ao usuário.`
- [ ] **Step 4: Run** `npm run check:functions && npm run test:functions` → PASS.
- [ ] **Step 5: Commit** `feat(mcp): cards de prévia do post e opções de legenda`.

### Task 4: `show_client_calendar`

**Files:**
- Modify (replace the stub): `supabase/functions/mcp/calendar.ts`
- Test: `supabase/functions/__tests__/mcp-calendar_test.ts`

**Interfaces:**
- Produces in `calendar.ts`:
  - `saoPauloMidnightUtc(date: string): Date` (`YYYY-MM-DD`; offset found with `Intl.DateTimeFormat` `timeZone: "America/Sao_Paulo"` for that day, no fixed offset)
  - `mondayOf(date: string): string`
  - `canonicalDate(p: { published_at: string | null; scheduled_at: string | null }): string | null` → `published_at ?? scheduled_at` (deliberate divergence from the CRM grid, which places by `scheduled_at` only: spec §4.5)
  - `usualWeekdays(history: string[] /* canonical ISO datetimes */, from: string): number[]` (0=Mon..6=Sun; a weekday counted once per week; usual when present in ≥4 of the 8 weeks before `from`)
  - `listClientCalendar(d: Deps, a: { client_id: number; from?: string; weeks?: number }): Promise<CalendarData>`
  - `registerCalendarTools(server, deps)`, `CALENDAR_TOOL_META = { show_client_calendar: { title: "Mostrar calendário do cliente", readOnly: true } }`
- `CalendarData`: `{ card: "client_calendar", v: 1, client: {id, nome}, from, weeks, days: [{ date, posts: [{id, titulo, tipo, status}], gap: boolean }], usual_weekdays, open_url }`, `open_url = "https://www.mesaas.com.br/entregas?view=calendar&clientes=<id>"` (matches `serializeEntregasQuery`, which omits the default `mode`).
- `weeks` 1..6, default 3; `from` default = today in São Paulo, always snapped with `mondayOf`.
- `auditArgs`: `{ client_id, from, weeks }`.

- [ ] **Step 1: Write failing tests:**
  - `saoPauloMidnightUtc("2026-11-02")` → `2026-11-02T03:00:00.000Z`; `mondayOf("2026-11-05")` → `"2026-11-02"`.
  - `range is [Mon 00:00 SP, +7·weeks)` (weeks=3, from 2026-11-02): `2026-11-02T02:59:00Z` excluded, `2026-11-02T03:00:00Z` included, `2026-11-23T02:59:00Z` included, `2026-11-23T03:00:00Z` excluded.
  - `post with both dates in range appears once, on published_at's day`.
  - `usualWeekdays: Wednesday in 4 of 8 weeks is usual; in 3 of 8 is not`.
  - `client with no history: usual_weekdays [] and no day has gap true` (Review Focus 5); `gap only on usual weekdays with no post`.
  - `open_url` string exact; `client from another workspace → "Cliente não encontrado neste workspace."`.
- [ ] **Step 2: Run** `deno test --no-check --allow-all supabase/functions/__tests__/mcp-calendar_test.ts` → FAIL.
- [ ] **Step 3: Implement** with one query on `workflow_posts` scoped by `conta_id` and `cliente_id` (the column names `queries.ts:440-450` uses) for posts whose `scheduled_at` or `published_at` falls in `[historyStart, rangeEnd)`; canonical dates and buckets in TS. Description: "Mostra ao usuário as próximas semanas de posts de um cliente, com os dias de costume sem post."
- [ ] **Step 4: Run** `npm run check:functions && npm run test:functions` → PASS.
- [ ] **Step 5: Commit** `feat(mcp): card do calendário do cliente`.

### Task 5: Guarded RPCs (migrations + SQL suites)

**Files:**
- Create: `supabase/migrations/20261105000001_mcp_send_post_to_client.sql`, `supabase/migrations/20261105000002_mcp_attach_post_file.sql`
- Test: `supabase/tests/mcp_send_post_to_client.sql`, `supabase/tests/mcp_attach_post_file.sql` (seed like `supabase/tests/post_media_set_from_uploads.sql:1-15`: `\i supabase/tests/entitlements/_helpers.sql`, `et_make_workspace`)

**Interfaces:**
- `public.mcp_send_post_to_client(p_conta_id uuid, p_post_id bigint, p_expected_status text, p_actor uuid) RETURNS text` ∈ `'sent' | 'already_sent' | 'approved' | 'failed' | 'stale'`. SECURITY DEFINER, `SET search_path = public`, `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role`. Body: membership recheck (Global Constraints) else `RAISE ... ERRCODE 'P0403' 'workspace_unavailable'`; `set_config('app.actor_id', p_actor::text, true)`; `set_config('app.event_source', 'workspace_user', true)`; `UPDATE workflow_posts SET status = 'enviado_cliente', custom_status_id = NULL WHERE id = p_post_id AND conta_id = p_conta_id AND status = p_expected_status AND status NOT IN (<skipped list>)`; on zero rows re-read status: `enviado_cliente`→`already_sent`; `aprovado_cliente|agendado|postado`→`approved`; `falha_publicacao`→`failed`; anything else or no row→`stale`.
- `public.mcp_attach_post_file(p_conta_id uuid, p_post_id bigint, p_actor uuid, p_file jsonb, p_position int, p_replace boolean) RETURNS jsonb` (`{link_id, file_id, sort_order, is_cover, tipo}`), same security header. Errors (SQLSTATE `P0001`, message prefix like `post_media_set_from_uploads`): `invalid_position`, `post_not_found`, `post_not_editable:<status>`, `tipo_not_image:<tipo>`, `media_full`; `quota_exceeded` comes from `file_insert_with_quota`. Steps: membership recheck; `SELECT ... FROM workflow_posts WHERE id = p_post_id AND conta_id = p_conta_id FOR UPDATE`; status in editable list and tipo in (feed, carrossel); `n` = current link count; append requires `n < 10` (else `media_full`) and `1 <= p_position <= n + 1`; replace requires `1 <= p_position <= n`; insert the file via `file_insert_with_quota(p_file)`; **append**: `UPDATE post_file_links SET sort_order = sort_order + 1 WHERE post_id = p_post_id AND sort_order >= p_position - 1` (descending order if a unique index on `(post_id, sort_order)` exists), then if `p_position = 1` `UPDATE ... SET is_cover = false WHERE post_id = p_post_id AND is_cover` and insert with `is_cover = true`, else insert with `is_cover = false`; `origin = 'manual'`, `sort_order = p_position - 1`; **replace**: `UPDATE post_file_links SET file_id = <new> WHERE post_id = p_post_id AND sort_order = p_position - 1` (keeps `sort_order`, `is_cover`; the `trg_file_ref_count_upd` trigger handles ref counts); afterwards `tipo = 'carrossel'` when the link count is > 1 and tipo was `feed` (as `post_media_set_from_uploads` does); `correcao_cliente` → `revisao_interna`.

- [ ] **Step 1: Write the failing send suite:** EXECUTE denied to `anon` and `authenticated`; post in `aprovado_interno` → `sent`, `custom_status_id` NULL, a `post_status_events` row with `source = 'workspace_user'` and actor = `p_actor`; second call `already_sent`; post moved to `revisao_interna`, called with `expected_status = 'aprovado_interno'` → `stale`; `aprovado_cliente` → `approved`; `falha_publicacao` → `failed`; another workspace's post id → `stale`, row unchanged; non-member actor → `workspace_unavailable`.
- [ ] **Step 2: Write the failing attach suite:** carousel with 3 links (cover at sort 0); append at position 1 → new link `is_cover = true` at sort 0, old cover false, orders `0..3` contiguous and unique; append at 3 → shift; replace at 1 → same link id, `is_cover` still true; 10 links + append → `media_full` and no new `files` row; 10 links + replace → ok; append at 12 → `invalid_position`; feed with 1 link + append → tipo `carrossel`; reels → `tipo_not_image:reels`; `aprovado_cliente` → `post_not_editable:aprovado_cliente`; `correcao_cliente` → `revisao_interna`; EXECUTE denied to `authenticated`; non-member actor refused.
- [ ] **Step 3: Run** `SUPABASE_DB_URL=<lane db url> bash scripts/test-entitlements.sh` → both new files FAIL.
- [ ] **Step 4: Implement** both migrations.
- [ ] **Step 5: Run** the full `test-entitlements.sh` → every file PASS.
- [ ] **Step 6: Commit** `feat(db): RPCs protegidas para envio ao cliente e anexo de imagem pelo MCP`.

### Task 6: Send to client from the card

**Files:**
- Create: `supabase/functions/_shared/mcp-send-nonce.ts`
- Modify (replace the stub): `supabase/functions/mcp/send.ts`
- Modify: `supabase/functions/mcp/tools.ts` (`create_post`, `update_post`: `resultMeta` and descriptions), `supabase/functions/mcp/cards.ts` (`preview_post`: `resultMeta`)
- Test: `supabase/functions/__tests__/mcp-send_test.ts`, `supabase/functions/__tests__/mcp-send-nonce_test.ts`

**Interfaces:**
- Consumes: Task 5's `mcp_send_post_to_client` contract; Task 3's `registerCardsTools`; `widgetOnly(deps)`.
- `_shared/mcp-send-nonce.ts`: its own derivation (`crypto.ts` does not export one): `crypto.subtle.importKey("raw", utf8(secret), "HKDF", false, ["deriveKey"])` → `deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: utf8("mcp-send-nonce") }, base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"])`; compare with `timingSafeEqual` exported from `_shared/crypto.ts`.
  - `signSendNonce(secret: string, p: { conta_id: string; user_id: string; post_id: number }, now = Date.now()): Promise<string>` → `base64url(JSON({...p, exp: now + 30 * 60 * 1000})) + "." + base64url(hmac)`
  - `verifySendNonce(secret: string, nonce: string, expect: { conta_id: string; user_id: string; post_id: number }, now = Date.now()): Promise<boolean>` (false on any parse error, mismatch or `now > exp`)
- `send_post_to_client` args `{ post_id: number; expected_status: z.enum(["rascunho","revisao_interna","correcao_cliente","aprovado_interno"]); nonce: string }`, scope `posts:write`, `opts.meta = appOnlyToolMeta()`, registered only when `widgetOnly(deps)`. Order: verify nonce (`conta_id = ctx.conta_id`, `user_id = ctx.created_by`) → video-without-cover check → RPC with `p_actor = ctx.created_by`. Returns `cardResult(msg, { card: "send_result", v: 1, post_id, outcome })`. Messages: `sent` "Post enviado ao cliente para aprovação."; `already_sent` "Este post já está com o cliente."; `approved` "O cliente já aprovou este post."; `failed` "A publicação deste post falhou. Resolva no Mesaas antes de enviar de novo."; `stale` "O post mudou no Mesaas. Atualize o cartão."; bad nonce "Este cartão expirou. Peça ao agente para mostrar o post de novo."; video without cover "Este vídeo está sem capa. Adicione a capa no Mesaas antes de enviar." (video = a linked `files.kind = 'video'` with `thumbnail_r2_key IS NULL`, as `PostMediaGallery.tsx:1554`).
- `auditArgs`: `{ post_id, expected_status, outcome }` (never `nonce`).
- `SEND_TOOL_META = { send_post_to_client: { title: "Enviar post ao cliente", readOnly: false, openWorld: true } }`.
- `resultMeta` on `create_post`, `update_post` and `preview_post` (only when `widgetOnly(deps)` and a `post_id` is known): `{ "mesaas/sendNonce": await signSendNonce(secret, { conta_id: ctx.conta_id, user_id: ctx.created_by, post_id }) }`, `secret = Deno.env.get("TOKEN_ENCRYPTION_KEY")`, throw if missing.
- Descriptions: replace "nunca envia ao cliente" wording in `create_post`/`update_post` with "O agente não envia sozinho ao cliente; um clique do usuário no cartão envia."

- [ ] **Step 1: Write failing tests:**
  - nonce: round trip true; wrong `post_id`, `user_id`, `conta_id` each false; `now + 31 min` false; flipped payload byte false; garbage string false.
  - send: bad nonce → expired-card message, RPC never called (fake db records `rpc` calls).
  - send: each RPC outcome maps to its message (Review Focus 1); `expected_status: "enviado_cliente"` rejected by zod.
  - send: video link without thumbnail → cover message, RPC not called.
  - send: not registered for `mesaas_sk_` keys or with apps off.
  - send: audit row has no `nonce` key.
  - `create_post` result `_meta["mesaas/sendNonce"]` present only with apps on + oauth; absent otherwise; same for `preview_post` with `post_id`.
  - descriptions contain "não envia sozinho".
- [ ] **Step 2: Run** `deno test --no-check --allow-all supabase/functions/__tests__/mcp-send_test.ts supabase/functions/__tests__/mcp-send-nonce_test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run check:functions && npm run test:functions` → PASS.
- [ ] **Step 5: Commit** `feat(mcp): envio ao cliente pelo cartão, com nonce`.

### Task 7: Attach a chat image (ChatGPT)

**Files:**
- Create: `supabase/functions/_shared/image-dimensions.ts`
- Modify (replace the stub): `supabase/functions/mcp/attach.ts`
- Modify: `supabase/functions/__tests__/mcp-apps-switch_test.ts` (un-ignore the widget-only case)
- Test: `supabase/functions/__tests__/mcp-attach_test.ts`, `supabase/functions/__tests__/image-dimensions_test.ts`

**Interfaces:**
- Consumes: Task 5's `mcp_attach_post_file` contract; `Deps.resolveDns`/`fetchUrl` (Task 2); `widgetOnly`; quota precheck as `mcp/media.ts:13-20`; presign as `signPutUrl` in `Deps`.
- `imageDimensions(bytes: Uint8Array, mime: "image/png" | "image/jpeg"): { width: number; height: number } | null` (PNG IHDR; JPEG SOF0/SOF1/SOF2 marker scan).
- `allowedImageHost(url: string, list: string | undefined): boolean` (exact hostname match against the comma list, trimmed, lowercase; empty ⇒ false). On refusal log `[mcp] image host refused: <hostname>` (hostname only).
- `show_attach_image` args `{ post_id: number; image: { download_url: string; file_id: string; mime_type?: string; file_name?: string }; position?: number }`, tool `_meta = { ...cardToolMeta(), "openai/fileParams": ["image"] }`, scope `posts:read`. `structuredContent`: `{ card: "attach_image", v: 1, post: {id, titulo, tipo, status}, client: {id, nome}, media: [{ position, url }], max: 10, eligible: boolean, reason?: string, image: { download_url, file_id }, position? }` (`url` = signed `r2_key` URL, as `queries.ts:592`). `reason` pt-BR, e.g. "Este post está com o cliente. Volte para rascunho no Mesaas para mudar as imagens." / "Posts do tipo reels não recebem imagens."
- `attach_image_to_post` args `{ post_id: number; image: { download_url: string; file_id: string; mime_type?: string }; position: number (1..10); replace: boolean }`, `appOnlyToolMeta()`, scope `posts:write`, registered only when `widgetOnly(deps)`. Flow: host check → `fetchImageSafely({ resolveDns, fetchUrl }, url, { maxBytes: 8 * 1024 * 1024, timeoutMs: 20000 })` → sniff bytes: PNG or JPEG only → quota precheck → presigned PUT to `contas/<conta_id>/files/<uuid>.<png|jpg>` with `AbortSignal.timeout(30000)` → RPC (`p_actor = ctx.created_by`, `p_file` with `r2_key`, `mime_type`, `size_bytes`, `width`, `height`, `name` = `file_name ?? "imagem-do-chat.<ext>"`, `kind: "image"`, plus whatever columns `file_insert_with_quota` requires) → on RPC error insert `{ r2_key }` into `file_deletions` and return the mapped message. Messages: format "Formato não aceito. Use JPG ou PNG."; size "A imagem passa de 8 MB. Gere uma versão menor."; host "Não foi possível baixar esta imagem. Envie de novo pelo chat."; `media_full` "Este post já tem 10 mídias. Substitua uma lâmina."; `post_not_editable:*` and `tipo_not_image:*` reuse the `reason` copy; `quota_exceeded` as `mcp/media.ts` maps it.
- `auditArgs` both tools: `{ post_id, position, replace }` (show: `{ post_id, position }`). Never `download_url`.
- `ATTACH_TOOL_META = { show_attach_image: { title: "Mostrar onde anexar a imagem", readOnly: true }, attach_image_to_post: { title: "Anexar imagem ao post", readOnly: false } }`.

- [ ] **Step 1: Write failing tests:**
  - `imageDimensions` on a 3×2 PNG and a 4×5 JPEG (bytes inline) → exact sizes; garbage → null.
  - `allowedImageHost`: empty list refuses all; exact match only (`evil-files.example` vs `files.example`).
  - attach: host not allowlisted → refused before any fetch (fake `fetchUrl` never called).
  - attach: `download_url` resolving to `10.0.0.1` (fake `resolveDns`) → refused, nothing fetched.
  - attach: WebP bytes → format message; 8 MB + 1 → size message; no PUT and no RPC in both (Review Focus 3).
  - attach: RPC error `media_full` → `file_deletions` insert with the uploaded key and the pt-BR message.
  - attach + show: audit rows have no `download_url`.
  - attach: `position: 11` rejected by zod; not registered for `mesaas_sk_` keys.
  - show: ineligible post (`aprovado_cliente`) → `eligible false` with `reason`; `media[].url` set.
  - un-ignored `widget-only tools need oauth` passes.
- [ ] **Step 2: Run** `deno test --no-check --allow-all supabase/functions/__tests__/mcp-attach_test.ts supabase/functions/__tests__/image-dimensions_test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run check:functions && npm run test:functions` → PASS.
- [ ] **Step 5: Commit** `feat(mcp): anexar imagem do chat ao post`.

### Task 8: The cards bundle (`apps/mcp-widgets/`)

**Files:**
- Create: `apps/mcp-widgets/{package.json,tsconfig.json,vite.config.ts,index.html,dev.html}`, `apps/mcp-widgets/src/{main.tsx,App.tsx,bridge.ts,theme.css,dev.tsx}`, `apps/mcp-widgets/src/cards/{PostPreview.tsx,CaptionOptions.tsx,ClientCalendar.tsx,AttachImage.tsx,SendFlow.tsx,Fallback.tsx}`, `apps/mcp-widgets/src/__tests__/*.test.tsx`, `apps/mcp-widgets/src/__fixtures__/*.json`, `scripts/build-mcp-widgets.ts`
- Modify: root `package.json` (script `build:mcp-widgets`), `tsconfig.scripts.json` (include `scripts/build-mcp-widgets.ts`), `.github/workflows/ci.yml` (lint-and-typecheck: `npx tsc -p apps/mcp-widgets/tsconfig.json --noEmit` and `npm run build:mcp-widgets && git diff --exit-code supabase/functions/mcp/ui/generated/cards-v1.ts`), `vitest.config.ts` only if `apps/**` tests are not already included, `supabase/functions/mcp/ui/generated/cards-v1.ts` (regenerated, last commit)

**Interfaces:**
- Consumes: the `structuredContent` shapes of Tasks 3, 4, 6, 7 (`card` ∈ `post_preview | caption_options | client_calendar | attach_image | send_result`), result `_meta["mesaas/sendNonce"]`, tools `create_post {cliente_id, titulo, tipo, body, ig_caption}`, `update_post {post_id, ig_caption}`, `send_post_to_client {post_id, expected_status, nonce}`, `attach_image_to_post {post_id, image, position, replace}`.
- `package.json` follows `apps/crm/package.json` (name `@sm-crm/mcp-widgets`, private, `type: module`); React 19 (same version as CRM), `lucide-react` (same version as CRM), `@modelcontextprotocol/ext-apps` latest 1.x pinned exactly, `vite-plugin-singlefile` pinned exactly. The lane does not install: it reports the exact additions and the controller runs `npm install` before review.
- `bridge.ts` exports `useHost(): { data: unknown; meta: Record<string, unknown> | undefined; theme: "light" | "dark"; callTool(name: string, args: object): Promise<{ structuredContent?: unknown; isError?: boolean; content?: unknown[] }>; sendMessage(text: string): Promise<void>; openLink(url: string): Promise<void> }` on ext-apps `App`. Components take this as a prop/context so tests pass a fake.
- `scripts/build-mcp-widgets.ts`: runs the Vite single-file build and writes `supabase/functions/mcp/ui/generated/cards-v1.ts` = header + `export const CARDS_V1_HTML = <JSON.stringify(html)>;\n`; prints the size; exits 1 above 500 KB raw.
- `dev.html` + `dev.tsx`: local harness that renders each fixture with a fake host (light and dark toggle), not part of the build output.

- [ ] **Step 1: Write failing Vitest tests (Testing Library, fake host):**
  - `PostPreview` renders slides and "412 de 2.200"-style count; "Salvar como rascunho" calls `create_post` with `{cliente_id, titulo, tipo, body, ig_caption}` from the fixture.
  - `PostPreview` with caption over `caption_max` shows "Legenda acima do limite" and disables save (Review Focus 4).
  - `SendFlow`: after save shows "Enviar para aprovação"; click shows confirmation with "Enviar ao cliente" and "Cancelar"; confirm calls `send_post_to_client` with `{post_id, expected_status, nonce}`; outcome `already_sent` shows its message.
  - `SendFlow` without a nonce in `meta` hides "Enviar para aprovação" and shows "Abrir no Mesaas".
  - `CaptionOptions`: option click selects; "Usar esta legenda" with `post_id` calls `update_post {post_id, ig_caption}`; without `post_id` calls `sendMessage("Usar a opção 2")`.
  - `ClientCalendar`: gap days render "Sem post"; "Sugerir posts para os dias vazios" sends a message naming the gap dates; "Abrir calendário no Mesaas" calls `openLink(open_url)`.
  - `AttachImage`: a slide that has media shows "Substituir a imagem da lâmina N?" and sends `replace: true`; ineligible shows `reason` and no attach button.
  - unknown `card` or `v` renders "Atualize o conector".
  - each card renders in light and dark (`data-theme="dark"` on the root) without error.
  - no rendered string contains "—".
- [ ] **Step 2: Run** `npx vitest run apps/mcp-widgets` → FAIL.
- [ ] **Step 3: Implement** the app per the mockups (Mesaas tokens light/dark, host `styles.variables` override, lucide icons, 44 px targets under 480 px width, stacked buttons on narrow widths, pt-BR copy from the mockups and spec §6).
- [ ] **Step 4: Run** `npx vitest run apps/mcp-widgets`, `npx tsc -p apps/mcp-widgets/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`, `npm run build:mcp-widgets` (report size), `npx eslint apps/mcp-widgets scripts/build-mcp-widgets.ts`, `npx prettier --check <own files>` → PASS.
- [ ] **Step 5: Commit** `feat(mcp-widgets): cards do Mesaas para Claude e ChatGPT`, then a separate last commit `chore(mcp): gera cards-v1.ts` with only the generated file.

### Task 9: Rollout runbook, docs and directory material

**Files:**
- Create: `docs/mcp-apps-rollout.md`, `docs/mcp-apps-directory-submission.md`
- Modify: `CLAUDE.md` and `README.md` (sole owner of both in this plan)

**Interfaces:**
- Consumes: env names `MCP_APPS`, `MCP_APPS_PILOT_CONTAS`, `MCP_IMAGE_HOSTS`; tool names from Tasks 3, 4, 6, 7; migration names from Task 5; `npm run build:mcp-widgets`.

- [ ] **Step 1: Write `docs/mcp-apps-rollout.md`:** spec §9 deploy order with exact commands (migrations; `npx supabase functions deploy mcp --no-verify-jwt --use-api` with `MCP_APPS=off`; `pilot` + `MCP_APPS_PILOT_CONTAS`; checks: Claude hides result `_meta` from the model, ChatGPT `download_url` host and redirects (read the hostname from the `[mcp] image host refused:` log line to fill `MCP_IMAGE_HOSTS`), generated images arrive as file params, card renders without `_meta.ui.domain`; the fallback if Claude exposes `_meta`); KB update text for `limites-e-seguranca-do-agente` and `o-que-o-agente-pode-fazer` and a new article "Cards no Claude e no ChatGPT", as Markdown sections (published later via the Admin MCP; nothing published by this task).
- [ ] **Step 2: Write `docs/mcp-apps-directory-submission.md`:** Claude and ChatGPT checklists from spec §7 with owner (founder or builder) per item; 5 positive ChatGPT test cases (preview + save, caption pick, calendar, attach image, send after confirmation) and 3 negative (client from another workspace, send on an already-sent post, WebP image), each with prompt, expected tool calls and expected result; listing description pt-BR and en; screenshot list; listing country `BR`.
- [ ] **Step 3: Update `CLAUDE.md`:** MCP section (cards, the "o agente não envia sozinho" rule, versioned `ui://` URI rule: a breaking card change ships as `cards-v2.html`), env entries for `MCP_APPS`, `MCP_APPS_PILOT_CONTAS`, `MCP_IMAGE_HOSTS`, CI text "four projects" → five (add `apps/mcp-widgets`) and the regenerated-bundle check; same CI facts in `README.md`.
- [ ] **Step 4: Run** `npx prettier --check docs/mcp-apps-rollout.md docs/mcp-apps-directory-submission.md` (if prettier covers docs) → PASS; grep the two new docs and your CLAUDE.md/README hunks for "—" → none in user-facing copy.
- [ ] **Step 5: Commit** `docs(mcp): runbook e material das listagens dos cards`.

---

## Final gate (controller, after integration)

In a clean `git worktree add --detach` with its own `npm ci`: `npm run lint`, `npm run format:check`, the five `tsc` commands, `npm run test`, `npm run check:functions`, `npm run test:functions`, `npm run build:mcp-widgets && git diff --exit-code supabase/functions/mcp/ui/generated/cards-v1.ts`, `npm run test:db`.

## Rollout (after merge review, not a coding task)

Follow `docs/mcp-apps-rollout.md`: migrations → deploy `mcp` with `MCP_APPS=off` → `pilot` on the founder's workspace and run the spec §9 step 3 checks → KB updates → `on` → directory submissions. If Claude exposes result `_meta` to the model, stop at `pilot` and move the nonce to a widget-only `resources/read` (spec §4.4) before `on`.
