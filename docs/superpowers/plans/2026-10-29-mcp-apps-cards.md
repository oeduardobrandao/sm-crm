# Cards do Mesaas no Claude e no ChatGPT (MCP Apps) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four MCP Apps cards (post preview, caption options, client calendar, attach chat image) and a card-only "send to client" action to the existing Mesaas MCP server, behind an env switch, plus the material for both directory submissions.

**Architecture:** The stateless per-request MCP server (`supabase/functions/mcp/`) gains annotations on every tool, a versioned `ui://mesaas/cards-v1.html` resource, four card tools that return `structuredContent`, and two widget-only tools guarded by OAuth-only registration and an HMAC send nonce. Two SECURITY DEFINER RPCs do the guarded writes. The card UI is a new single-file React app (`apps/mcp-widgets/`) compiled into a generated TS string that the function serves.

**Tech Stack:** Deno edge function, `npm:@modelcontextprotocol/sdk@1.25.3` (unchanged), zod v3, Postgres migrations + psql suites, React 19 + Vite single-file build, `@modelcontextprotocol/ext-apps` 1.x `App` (widget only), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-mcp-apps-cards-design.md` (read it with this plan; section refs below are to it). Mockups: https://claude.ai/artifact/7naK43HtiXBr1xUVXRbrvL

## Global Constraints

- Server SDK stays `npm:@modelcontextprotocol/sdk@1.25.3`; no `@modelcontextprotocol/ext-apps` import under `supabase/functions/`.
- Resource URI exactly `ui://mesaas/cards-v1.html`, mime `text/html;profile=mcp-app`, `_meta.ui.prefersBorder: false`, `_meta.ui.csp.connectDomains: []`, no `_meta.ui.domain`, `_meta["openai/widgetDomain"] = "https://www.mesaas.com.br"`.
- Env switch `MCP_APPS` = `off` (default, also for any unknown value) | `pilot` | `on`; `MCP_APPS_PILOT_CONTAS` comma-separated `conta_id`s. Off ⇒ tool list, tool shapes and resources identical to today except the new `title`/annotations.
- `structuredContent` always has `card` and `v: 1`. Card tools take `client_id` (not `cliente_id`).
- Widget-only tools (`_meta.ui.visibility: ["app"]`) are registered only when cards are on AND `ctx.key_id.startsWith("oauth:")`.
- Send nonce: HMAC-SHA256, key derived with HKDF-SHA256 from `TOKEN_ENCRYPTION_KEY`, info `mcp-send-nonce`, payload `{conta_id, user_id, post_id, exp}`, TTL 30 min, carried in result `_meta["mesaas/sendNonce"]`.
- `post_status_events` source for card sends: `'workspace_user'` (CHECK allows only `workspace_user | client | system`).
- Images: JPEG/PNG only, ≤ 8 MB (8 * 1024 * 1024), fetched only via `fetchImageSafely`, host must be in the `MCP_IMAGE_HOSTS` secret (comma-separated hostnames; empty ⇒ every image refused), `download_url` never in `audit_log`.
- `EDITABLE_STATUSES = ["rascunho","revisao_interna","correcao_cliente"]`; carousel max 10 media items; `tipo` feed or carrossel.
- Send-skipped statuses: `enviado_cliente, aprovado_cliente, agendado, postado, falha_publicacao`.
- Migration versions start at `20261105000001`; renumber above `main`'s tail before opening the PR if `main` moved.
- All user-facing copy pt-BR, sentence case, **no em dashes**. Errors are full actionable sentences.
- Never log or return raw provider/DB errors to the client (existing `errorResult` rules).
- `mcp` deploys with `--no-verify-jwt --use-api` (unchanged).

## Review Focus

1. A card opened earlier whose post has since changed (sent, approved or edited in the CRM): the send must fail with the right one of `already_sent` / `approved` / `stale`, never send twice. Pinned in Task 5.
2. A host without MCP Apps (Claude Code, Codex, a `mesaas_sk_` key): it must never be able to call `send_post_to_client` or `attach_image_to_post`. Pinned in Task 2 (registration) and Task 5 (nonce).
3. A ChatGPT image that is WebP, over 8 MB, or served from an unexpected host: refused with a pt-BR sentence, nothing uploaded or charged. Pinned in Task 6.
4. A caption over 2.200 characters in a preview: the card shows the overflow and disables "Salvar como rascunho" instead of letting `create_post` fail. Pinned in Task 7.
5. A client with no posting history: the calendar shows no "dias de costume" and no gaps (not every empty day flagged). Pinned in Task 4.

---

### Task 1: Tool titles and annotations on every tool, via `registerTool`

**Files:**
- Create: `supabase/functions/mcp/tool-meta.ts`
- Modify: `supabase/functions/mcp/register.ts:66-103`
- Modify (fake servers gain `registerTool`): `supabase/functions/__tests__/mcp-financeiro-helpers.ts:63-80`, `__tests__/mcp-tarefas_test.ts:188-210`, `__tests__/mcp-writes_test.ts`, `__tests__/mcp-import_test.ts`
- Test: `supabase/functions/__tests__/mcp-annotations_test.ts`

**Interfaces:**
- Produces: `TOOL_META: Record<string, { title: string; readOnly: boolean; destructive?: boolean; openWorld?: boolean }>` in `tool-meta.ts`; `RegisterOpts` gains `meta?: Record<string, unknown>` (tool `_meta`) and `resultMeta?: (args: any, data: any) => Promise<Record<string, unknown> | undefined>`; `register()` now calls `server.registerTool(name, { title, description, inputSchema: shape, annotations, _meta }, cb)` and throws `Error("missing TOOL_META for <name>")` at registration when a name has no entry.
- `annotations` = `{ title, readOnlyHint: readOnly, destructiveHint: destructive ?? false, openWorldHint: openWorld ?? false }`.

- [ ] **Step 1: Write the failing structural test** `mcp-annotations: every tool has a title and annotations`: build a recording fake server with `registerTool(name, config, cb)`, call `registerTools(fake, deps)` with a ctx holding every scope in `MCP_ALLOWED_SCOPES`, assert each recorded config has a non-empty `title`, `annotations.readOnlyHint` boolean, `annotations.destructiveHint` boolean; assert `delete_lancamento`, `delete_funcao`, `fechar_periodo` have `destructiveHint === true`; assert every `list_*`/`get_*` tool has `readOnlyHint === true`; assert `create_post` has `readOnlyHint === false`.
- [ ] **Step 2: Run** `deno test --no-check supabase/functions/__tests__/mcp-annotations_test.ts` → FAIL (fake has no `tool` method / no title).
- [ ] **Step 3: Add `TOOL_META` entries for all 49 tools registered today (24 in `tools.ts`, 25 in `financeiro-tools.ts`)** (titles pt-BR, e.g. `list_clients: { title: "Listar clientes", readOnly: true }`, `create_post: { title: "Criar post em rascunho", readOnly: false }`, `fechar_periodo: { title: "Fechar período", readOnly: false, destructive: true }`) and switch `register()` to `registerTool` as in Interfaces; `resultMeta`, when present, is awaited after `run` and its object is attached as the result's `_meta`.
- [ ] **Step 4: Update the four fake servers** to record `registerTool(name, config, cb)` (keep their existing handler maps keyed by name; `config.inputSchema` is the shape).
- [ ] **Step 5: Run** `npm run check:functions && deno test --no-check supabase/functions/__tests__/` → all PASS (existing MCP suites included).
- [ ] **Step 6: Commit** `feat(mcp): títulos e anotações em todas as ferramentas`.

### Task 2: Rollout switch, card resource and `cardResult`

**Files:**
- Create: `supabase/functions/mcp/apps.ts`, `supabase/functions/mcp/ui/generated/cards-v1.ts` (placeholder until Task 7: `export const CARDS_V1_HTML = "<!doctype html><title>Mesaas</title>";` with the GENERATED header)
- Modify: `supabase/functions/mcp/index.ts:117-139`, `supabase/functions/mcp/queries.ts:62-78` (`Deps`), `supabase/functions/mcp/register.ts` (export `cardResult`)
- Test: `supabase/functions/__tests__/mcp-apps-switch_test.ts`

**Interfaces:**
- Produces in `apps.ts`:
  - `CARDS_URI = "ui://mesaas/cards-v1.html"`, `CARDS_MIME = "text/html;profile=mcp-app"`
  - `appsEnabledFor(contaId: string, env: { MCP_APPS?: string; MCP_APPS_PILOT_CONTAS?: string }): boolean`
  - `registerCardsResource(server: any, r2Origin: string): void` (uses `server.registerResource("mesaas-cards", CARDS_URI, { mimeType: CARDS_MIME, _meta: {...} }, read)`; read returns `{ contents: [{ uri: CARDS_URI, mimeType: CARDS_MIME, text: CARDS_V1_HTML, _meta: same }] }`)
  - `cardToolMeta(): Record<string, unknown>` → `{ ui: { resourceUri: CARDS_URI } }`; `appOnlyToolMeta()` → `{ ui: { resourceUri: CARDS_URI, visibility: ["app"] } }`
- `Deps` gains `apps?: { enabled: boolean; oauth: boolean }`.
- `cardResult(summary: string, data: Record<string, unknown>, meta?: Record<string, unknown>)` → `{ content: [{ type: "text", text: summary }], structuredContent: data, ...(meta ? { _meta: meta } : {}) }`.
- `r2Origin` = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` (from `_shared/r2.ts` env).

- [ ] **Step 1: Write failing tests:**
  - `appsEnabledFor: off by default, on, pilot list, garbage value is off` (`undefined`→false, `"on"`→true, `"pilot"` with `MCP_APPS_PILOT_CONTAS="a, b"` → true for `"b"`, false for `"c"`, `"ON"`/`"yes"` → false).
  - `off: tool list identical to baseline` — register with `apps: {enabled: false, oauth: true}` and assert the recorded tool names equal a checked-in array of today's 49 names and no `registerResource` call.
  - `on: resource registered with the exact _meta` — assert URI, mime, `_meta.ui.prefersBorder === false`, `_meta.ui.csp.connectDomains` deep-equals `[]`, `resourceDomains` deep-equals `[r2Origin]`, `_meta["openai/widgetDomain"] === "https://www.mesaas.com.br"`, and `"domain" in _meta.ui === false`.
  - `widget-only tools need oauth` — with `{enabled: true, oauth: false}` neither `send_post_to_client` nor `attach_image_to_post` is registered (both added in Tasks 5–6; this test lists them now and stays red until then, or mark it `ignore: true` until Task 6 and un-ignore there).
- [ ] **Step 2: Run** `deno test --no-check supabase/functions/__tests__/mcp-apps-switch_test.ts` → FAIL.
- [ ] **Step 3: Implement `apps.ts` and wire `index.ts`:** compute `enabled = appsEnabledFor(ctx.conta_id, Deno.env.toObject())`, `oauth = ctx.key_id.startsWith("oauth:")`; pass `apps` in deps; call `registerCardsResource` only when enabled.
- [ ] **Step 4: Run** the new test plus the whole `__tests__/` folder → PASS (except an ignored widget-only case).
- [ ] **Step 5: Commit** `feat(mcp): chave MCP_APPS e recurso ui:// dos cards`.

### Task 3: `preview_post` and `show_caption_options`

**Files:**
- Create: `supabase/functions/mcp/cards.ts`
- Modify: `supabase/functions/mcp/tools.ts` (register the two tools only when `deps.apps?.enabled`), `supabase/functions/mcp/tool-meta.ts`
- Test: `supabase/functions/__tests__/mcp-cards_test.ts`

**Interfaces:**
- Produces in `cards.ts`:
  - `slidesToBody(slides: { texto: string }[]): string` → `slides.map(s => s.texto.trim()).join("\n\n")`
  - `bodyToSlides(conteudoPlain: string): { texto: string }[]` → split on `/\n\s*\n/`, trim, drop empties
  - `previewPost(d: Deps, a: PreviewArgs): Promise<ReturnType<typeof cardResult>>` where `PreviewArgs = { client_id: number; titulo: string; tipo: Formato; slides?: {texto: string}[]; roteiro?: string; ig_caption: string; post_id?: number; pilar?: string }`
  - `captionOptions(d: Deps, a: { client_id: number; post_id?: number; options: { label: string; text: string }[] })`
- `preview_post` `structuredContent`: `{ card: "post_preview", v: 1, client: {id, nome}, titulo, tipo, pilar?, slides, roteiro?, ig_caption, caption_len, caption_max, post_id?, body }` where `body` is what "Salvar como rascunho" passes to `create_post`, `caption_max = captionMaxFor("instagram", tipo)` (`_shared/platform-registry.ts:105`).
- `show_caption_options` `structuredContent`: `{ card: "caption_options", v: 1, client: {id, nome}, post_id?, options: [{label, text, len}], caption_max }`.
- zod: `slides` max 10, each `texto` 1..2000; `options` length 2..3; `ig_caption` max 10000 (the card flags overflow, the server does not reject a long proposal).

- [ ] **Step 1: Write failing tests:**
  - `slidesToBody/bodyToSlides round trip and slide_1_text` — 3 slides with inner whitespace → `bodyToSlides(slidesToBody(s))` deep-equals trimmed input; first line of `slidesToBody(s)` equals slide 1 text (matches `firstLine` used for `slide_1_text`, `queries.ts:522`).
  - `preview_post: client from another workspace → McpInputError "Cliente não encontrado neste workspace."` (fake db returns no row for `conta_id`).
  - `preview_post: post_id of another workspace → "Post não encontrado neste workspace."`.
  - `preview_post: structuredContent has card, v, caption_len, caption_max 2200 and no conteudo/ig_caption of other posts`.
  - `show_caption_options: rejects 1 or 4 options; returns len per option`.
  - `tools absent when apps disabled`.
- [ ] **Step 2: Run** `deno test --no-check supabase/functions/__tests__/mcp-cards_test.ts` → FAIL.
- [ ] **Step 3: Implement** `cards.ts`, register both tools with `opts.meta = cardToolMeta()` and descriptions from spec §4.3 ("Mostra a prévia de um post antes de salvar. Use sempre que propuser um post novo."), return via `cardResult` with a one-line pt-BR summary (e.g. `Prévia de "<titulo>" para <cliente> mostrada ao usuário.`). Add `TOOL_META` entries (`readOnly: true`).
- [ ] **Step 4: Run** → PASS; `npm run check:functions` → PASS.
- [ ] **Step 5: Commit** `feat(mcp): cards de prévia do post e opções de legenda`.

### Task 4: `show_client_calendar`

**Files:**
- Create: `supabase/functions/mcp/calendar.ts`
- Modify: `supabase/functions/mcp/tools.ts`, `supabase/functions/mcp/tool-meta.ts`
- Test: `supabase/functions/__tests__/mcp-calendar_test.ts`

**Interfaces:**
- Produces in `calendar.ts`:
  - `saoPauloMidnightUtc(date: string): Date` (date `YYYY-MM-DD`; uses `Intl.DateTimeFormat` with `timeZone: "America/Sao_Paulo"` to find the offset for that instant, no fixed offset)
  - `mondayOf(date: string): string`
  - `canonicalDate(p: { published_at: string | null; scheduled_at: string | null; published: boolean }): string | null`
  - `usualWeekdays(history: string[] /* canonical ISO datetimes */, from: string): number[]` (0=Mon..6=Sun; weekday counted once per week; usual when present in ≥4 of the 8 weeks before `from`)
  - `listClientCalendar(d: Deps, a: { client_id: number; from?: string; weeks?: number }): Promise<CalendarData>`
- `structuredContent`: `{ card: "client_calendar", v: 1, client: {id, nome}, from, weeks, days: [{ date, posts: [{id, titulo, tipo, status}], gap: boolean }], usual_weekdays, open_url }`, with `open_url` = `https://www.mesaas.com.br/entregas?` + the keys `pages/entregas/viewQuery.ts` serializes for "calendar view + clientes=<id>" (copy the exact key names from that file; add a unit test there is not needed, assert the built string in this task's test).
- `weeks` 1..6, default 3; `from` default = today in São Paulo.

- [ ] **Step 1: Write failing tests:**
  - `saoPauloMidnightUtc("2026-11-02")` → `2026-11-02T03:00:00.000Z`.
  - `mondayOf("2026-11-05")` → `"2026-11-02"`.
  - `range is [Mon 00:00 SP, +7·weeks)`: a post at `2026-11-02T02:59:00Z` (Nov 1 23:59 SP) is excluded, one at `2026-11-02T03:00:00Z` included, one at `2026-11-23T02:59:00Z` included, `2026-11-23T03:00:00Z` excluded (weeks=3).
  - `published post with scheduled_at and published_at both in range appears once, on published_at's day`.
  - `usualWeekdays: Wednesday in 4 of 8 weeks is usual; in 3 of 8 is not`.
  - `client with no history: usual_weekdays = [] and no day has gap = true` (Review Focus 5).
  - `gap only on usual weekdays with no post`.
  - `client from another workspace → "Cliente não encontrado neste workspace."`.
- [ ] **Step 2: Run** `deno test --no-check supabase/functions/__tests__/mcp-calendar_test.ts` → FAIL.
- [ ] **Step 3: Implement** two queries scoped by `conta_id` + `cliente_id`: posts whose `scheduled_at` or `published_at` falls in `[historyStart, rangeEnd)` (history = 8 weeks before `from`), then compute canonical dates in TS. Register with `cardToolMeta()`, `readOnly: true`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(mcp): card do calendário do cliente`.

### Task 5: Send to client (nonce + RPC + widget-only tool)

**Files:**
- Create: `supabase/migrations/20261105000001_mcp_send_post_to_client.sql`, `supabase/functions/_shared/mcp-send-nonce.ts`, `supabase/functions/mcp/send.ts`
- Modify: `supabase/functions/mcp/tools.ts` (register `send_post_to_client`; add `resultMeta` nonce to `create_post`, `update_post`, `preview_post`; update `create_post`/`update_post` descriptions), `supabase/functions/mcp/tool-meta.ts`
- Test: `supabase/functions/__tests__/mcp-send_test.ts`, `supabase/tests/entitlements/mcp_send_post_to_client.sql`

**Interfaces:**
- Produces in `_shared/mcp-send-nonce.ts`:
  - `signSendNonce(secret: string, p: { conta_id: string; user_id: string; post_id: number }, now?: number): Promise<string>` → `base64url(JSON payload with exp) + "." + base64url(HMAC)`
  - `verifySendNonce(secret: string, nonce: string, expect: { conta_id: string; user_id: string; post_id: number }, now?: number): Promise<boolean>` (timing-safe compare, exp checked)
- RPC `public.mcp_send_post_to_client(p_conta_id uuid, p_post_id bigint, p_expected_status text, p_actor uuid) RETURNS text` returning `'sent' | 'already_sent' | 'approved' | 'stale'`; SECURITY DEFINER, `SET search_path = public`; `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role`. Body per spec §5: `set_config('app.actor_id', p_actor::text, true)`, `set_config('app.event_source', 'workspace_user', true)`, conditional `UPDATE ... SET status='enviado_cliente', custom_status_id = NULL`; on zero rows re-read status: `enviado_cliente`→`already_sent`; `aprovado_cliente|agendado|postado`→`approved`; else `stale`.
- `send_post_to_client` args `{ post_id: number; expected_status: string; nonce: string }`, scope `posts:write`, `opts.meta = appOnlyToolMeta()`, registered only when `deps.apps?.enabled && deps.apps.oauth`. Returns `cardResult` with `{ card: "send_result", v: 1, post_id, outcome }` and pt-BR messages from spec §5. Video without thumbnail → `McpInputError("Este vídeo está sem capa. Adicione a capa no Mesaas antes de enviar.")`.
- `resultMeta` on `create_post`/`update_post`/`preview_post` (when `post_id` known and apps enabled and oauth): `{ "mesaas/sendNonce": await signSendNonce(TOKEN_ENCRYPTION_KEY, {conta_id, user_id: ctx.created_by, post_id}) }`. `TOKEN_ENCRYPTION_KEY` missing ⇒ throw (CLAUDE.md rule).
- `TOOL_META.send_post_to_client = { title: "Enviar post ao cliente", readOnly: false, openWorld: true }`.

- [ ] **Step 1: Write failing Deno tests:**
  - `nonce: valid round trip; wrong post_id, user_id, conta_id each false; expired (now + 31 min) false; tampered payload false`.
  - `send: missing nonce → error, RPC never called` (fake db records no `rpc`).
  - `send: maps RPC outcomes to pt-BR` — `already_sent` → "Este post já está com o cliente.", `approved` → "O cliente já aprovou este post.", `stale` → "O post mudou no Mesaas. Atualize o cartão." (Review Focus 1).
  - `send: not registered for mesaas_sk_ keys` (un-ignore the Task 2 case).
  - `create_post result carries _meta["mesaas/sendNonce"] only for oauth + apps on`.
  - `create_post/update_post descriptions no longer say "nunca envia ao cliente"` and contain "não envia sozinho".
- [ ] **Step 2: Write the failing SQL suite** `mcp_send_post_to_client.sql` (pattern of existing `supabase/tests/entitlements/*.sql`, `_helpers.sql`): seed a workspace, member, post in `aprovado_interno`; assert `anon`/`authenticated` cannot EXECUTE; as service role `sent` and a `post_status_events` row with `source = 'workspace_user'` and `actor_user_id = p_actor`; second call `already_sent`; post moved to `revisao_interna` then called with `expected_status = 'aprovado_interno'` → `stale`; `aprovado_cliente` → `approved`; another workspace's id → `stale` and no change.
- [ ] **Step 3: Run** Deno test → FAIL; `npm run test:db` (needs Docker) → FAIL.
- [ ] **Step 4: Implement** migration, nonce module, `send.ts`, registrations and description changes ("O agente não envia sozinho ao cliente; um clique do usuário no cartão envia.").
- [ ] **Step 5: Run** both suites → PASS; `npm run check:functions` → PASS.
- [ ] **Step 6: Commit** `feat(mcp): envio ao cliente pelo cartão, com nonce e RPC protegida`.

### Task 6: Attach a chat image (ChatGPT)

**Files:**
- Create: `supabase/migrations/20261105000002_mcp_attach_post_file.sql`, `supabase/functions/_shared/image-dimensions.ts`, `supabase/functions/mcp/attach.ts`
- Modify: `supabase/functions/mcp/queries.ts` (`Deps` gains `resolveDns?`, `fetchUrl?`), `supabase/functions/mcp/index.ts` (wire `Deno.resolveDns` and `fetch` as `mcp-admin/index.ts:130` does), `supabase/functions/mcp/tools.ts`, `supabase/functions/mcp/tool-meta.ts`
- Test: `supabase/functions/__tests__/mcp-attach_test.ts`, `supabase/functions/__tests__/image-dimensions_test.ts`, `supabase/tests/entitlements/mcp_attach_post_file.sql`

**Interfaces:**
- `imageDimensions(bytes: Uint8Array, mime: "image/png" | "image/jpeg"): { width: number; height: number } | null` (PNG IHDR; JPEG SOF0/SOF2 scan).
- `allowedImageHost(url: string, env: string | undefined): boolean` in `attach.ts` (hostname exact match against the comma list; empty ⇒ false). On refusal log `[mcp] image host refused: <hostname>` (hostname only, never the URL).
- RPC `public.mcp_attach_post_file(p_conta_id uuid, p_post_id bigint, p_actor uuid, p_file jsonb, p_position int, p_replace boolean) RETURNS jsonb` (`{link_id, file_id, sort_order, is_cover}`), SECURITY DEFINER, service_role only. Raises `P0400 invalid_position`, `P0404 post_not_found`, `P0409 post_not_editable:<status>`, `P0409 tipo_not_image:<tipo>`, `P0409 media_full`, `quota_exceeded`. Steps exactly as spec §4.6 step 3: membership recheck (pattern `20260916000001_post_file_link_replace.sql:47-54`), `SELECT ... FOR UPDATE` on the post, eligibility, files row via the same logic as `file_insert_with_quota` (call it), then append (shift `sort_order >= p_position` by 1; at position 1 first `UPDATE ... SET is_cover = false WHERE is_cover`, then insert with `is_cover = true`; elsewhere `is_cover = false`; `origin = 'manual'`) or replace (swap `file_id` on the link at that position, keep `sort_order`/`is_cover`); if status is `correcao_cliente`, set `revisao_interna`.
- `show_attach_image` args `{ post_id: number; image: { download_url: string; file_id: string; mime_type?: string; file_name?: string }; position?: number }`, tool `_meta` = `{ ...cardToolMeta(), "openai/fileParams": ["image"] }`, `readOnly: true`. `structuredContent`: `{ card: "attach_image", v: 1, post: {id, titulo, tipo, status}, client: {id, nome}, media: [{position, thumbnail_url}], max: 10, eligible: boolean, reason?: string, image: {download_url, file_id} }`.
- `attach_image_to_post` args `{ post_id; image: {download_url, file_id, mime_type?}; position: 1..10; replace: boolean }`, `appOnlyToolMeta()`, oauth + apps only, `auditArgs: (a) => ({ post_id: a.post_id, position: a.position, replace: a.replace })`. Flow: host check → `fetchImageSafely({resolveDns, fetchUrl}, url, {maxBytes: 8*1024*1024, timeoutMs: 20000})` → JPEG/PNG check → quota precheck (as `mcp/media.ts:13-20`) → presigned PUT to `contas/<conta>/files/<uuid>.<ext>` with `AbortSignal.timeout(30000)` → RPC → on RPC error insert `{r2_key}` into `file_deletions` and return the mapped message.

- [ ] **Step 1: Write failing tests:**
  - `imageDimensions` on a 3×2 PNG and a 4×5 JPEG fixture (bytes inline) → exact sizes; garbage → null.
  - `allowedImageHost: empty env refuses all; exact match only (no suffix match: "evil-files.example" vs "files.example")`.
  - `attach: WebP refused "Formato não aceito. Use JPG ou PNG."; >8 MB refused; no PUT and no RPC in both cases` (Review Focus 3).
  - `attach: host not allowlisted refused before any fetch`.
  - `attach: RPC error → file_deletions insert with the uploaded key, pt-BR message for media_full ("Este post já tem 10 mídias. Substitua uma lâmina.")`.
  - `attach: audit row has no download_url`.
  - `attach: not registered for mesaas_sk_ keys`.
- [ ] **Step 2: Write the failing SQL suite** `mcp_attach_post_file.sql`: carousel with 3 links (cover at 1); append at 1 → new link `is_cover = true`, old cover false, orders 1..4 contiguous and unique, no duplicate-key error; append at 3 → shift; replace at 1 → same link id, `is_cover` still true, old file still in `files`; 10 links + append → `media_full`, no new `files` row; 10 links + replace → ok; reels post → `tipo_not_image`; `aprovado_cliente` → `post_not_editable`; `correcao_cliente` becomes `revisao_interna`; EXECUTE denied to `authenticated`.
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement** the migration, `image-dimensions.ts`, `attach.ts`, deps wiring and both tool registrations.
- [ ] **Step 5: Run** `deno test --no-check supabase/functions/__tests__/` and `npm run test:db` → PASS; `npm run check:functions` → PASS.
- [ ] **Step 6: Commit** `feat(mcp): anexar imagem do chat ao post`.

### Task 7: The cards bundle (`apps/mcp-widgets/`)

**Files:**
- Create: `apps/mcp-widgets/{package.json,tsconfig.json,vite.config.ts,index.html}`, `apps/mcp-widgets/src/{main.tsx,App.tsx,bridge.ts,theme.css}`, `apps/mcp-widgets/src/cards/{PostPreview.tsx,CaptionOptions.tsx,ClientCalendar.tsx,AttachImage.tsx,SendFlow.tsx,Fallback.tsx}`, `apps/mcp-widgets/src/__tests__/*.test.tsx`, `apps/mcp-widgets/src/__fixtures__/*.json`, `scripts/build-mcp-widgets.ts`
- Modify: root `package.json` (script `build:mcp-widgets`), `.github/workflows/ci.yml` (lint-and-typecheck: `npx tsc -p apps/mcp-widgets/tsconfig.json --noEmit` and `npm run build:mcp-widgets && git diff --exit-code supabase/functions/mcp/ui/generated/cards-v1.ts`), `vitest.config.ts` only if `apps/mcp-widgets/**/__tests__` is not already included, `CLAUDE.md` and `README.md` ("four projects" → five, CI table row), `supabase/functions/mcp/ui/generated/cards-v1.ts` (regenerated)

**Interfaces:**
- Consumes: the `structuredContent` shapes from Tasks 3–6 (`card` ∈ `post_preview | caption_options | client_calendar | attach_image | send_result`), result `_meta["mesaas/sendNonce"]`, tools `create_post`, `update_post`, `send_post_to_client`, `attach_image_to_post`.
- `bridge.ts` exports `useHost(): { data: unknown; meta: Record<string, unknown> | undefined; theme: "light" | "dark"; callTool(name: string, args: object): Promise<CallToolResult>; sendMessage(text: string): Promise<void>; openLink(url: string): Promise<void> }` built on ext-apps `App` (latest 1.x, exact pin).
- `scripts/build-mcp-widgets.ts`: runs the Vite single-file build and writes `supabase/functions/mcp/ui/generated/cards-v1.ts` with the header `// GENERATED by scripts/build-mcp-widgets.ts. Do not edit.` and `export const CARDS_V1_HTML = <JSON.stringify(html)>;`. Fails if the HTML exceeds 500 KB raw and prints the size either way.

- [ ] **Step 1: Write failing Vitest tests (Testing Library):**
  - `PostPreview renders slides, caption count "412 de 2.200" style, and "Salvar como rascunho" calls create_post with {cliente_id, titulo, tipo, body, ig_caption}` (body from fixture equals `slidesToBody` output).
  - `PostPreview with caption over caption_max shows "Legenda acima do limite" and disables save` (Review Focus 4).
  - `SendFlow: after save the card shows "Enviar para aprovação"; first click shows the confirmation with "Enviar ao cliente" and "Cancelar"; confirm calls send_post_to_client with {post_id, expected_status, nonce}; outcome already_sent shows "Este post já está com o cliente."`.
  - `SendFlow without a nonce in _meta hides "Enviar para aprovação" and shows "Abrir no Mesaas"`.
  - `CaptionOptions: clicking an option selects it; "Usar esta legenda" with post_id calls update_post {post_id, ig_caption}; without post_id calls sendMessage("Usar a opção 2")`.
  - `ClientCalendar: gap days render "Sem post"; "Sugerir posts para os dias vazios" sends a message naming the gap dates; "Abrir calendário no Mesaas" calls openLink(open_url)`.
  - `AttachImage: picking a slide with media shows "Substituir a imagem da lâmina N?" and sends replace: true; ineligible post shows reason and no attach button`.
  - `unknown card or v renders "Atualize o conector"`.
  - `dark theme sets data-theme="dark" on the root`.
- [ ] **Step 2: Run** `npx vitest run apps/mcp-widgets` → FAIL.
- [ ] **Step 3: Implement** the app per the mockups (Mesaas tokens, light/dark, host `styles.variables` override, lucide icons, 44 px targets under 480 px width, pt-BR copy from the mockups and spec), `bridge.ts`, and the build script; regenerate `cards-v1.ts`.
- [ ] **Step 4: Run** `npx vitest run apps/mcp-widgets`, `npx tsc -p apps/mcp-widgets/tsconfig.json --noEmit`, `npm run build:mcp-widgets` (report size), `npm run lint`, `npm run format:check` → PASS.
- [ ] **Step 5: Commit** `feat(mcp-widgets): cards do Mesaas para Claude e ChatGPT`.

### Task 8: Rollout runbook, docs and directory material

**Files:**
- Create: `docs/mcp-apps-rollout.md` (deploy order spec §9 with exact commands, the pilot checklist of spec §9 step 3, and how to read the observed `download_url` host from the function logs to fill `MCP_IMAGE_HOSTS`), `docs/mcp-apps-directory-submission.md` (Claude and ChatGPT checklists from spec §7 with owners; the 5 positive and 3 negative ChatGPT test cases written out; the listing description in pt-BR and en; screenshot list)
- Modify: `CLAUDE.md` (MCP section: cards, `MCP_APPS`/`MCP_APPS_PILOT_CONTAS`/`MCP_IMAGE_HOSTS` env entries, the "o agente não envia sozinho" rule, versioned `ui://` URI rule)

- [ ] **Step 1: Write both docs.** Test cases must cover: preview + save, caption pick, calendar, attach image, send after confirmation (positive); a client from another workspace, a send on an already-sent post, a WebP image (negative).
- [ ] **Step 2: Add the KB update text** for `limites-e-seguranca-do-agente` and `o-que-o-agente-pode-fazer`, plus a new article "Cards no Claude e no ChatGPT", as Markdown sections in `docs/mcp-apps-rollout.md` (published later through the Admin MCP at rollout step 4; nothing is published by this task).
- [ ] **Step 3: Run the full pre-push gate:** `npm run lint`, `npm run format:check`, the five `tsc` commands, `npm run test`, `npm run check:functions`, `npm run test:functions` → all PASS.
- [ ] **Step 4: Commit** `docs(mcp): runbook e material das listagens dos cards`.

---

## Rollout (after merge review, not a coding task)

Follow `docs/mcp-apps-rollout.md`: migrations → deploy `mcp` with `MCP_APPS=off` → `pilot` on the founder's workspace and run the spec §9 step 3 checks (Claude hides result `_meta` from the model; ChatGPT `download_url` host/redirects; generated images as file params; card renders without `_meta.ui.domain`) → KB updates → `on` → directory submissions. If Claude exposes result `_meta` to the model, stop at `pilot` and move the nonce to a widget-only `resources/read` (spec §4.4) before `on`.
