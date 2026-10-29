# Cards do Mesaas no Claude e no ChatGPT (MCP Apps)

Status: design, aguardando aprovação. Mockups aprovados: https://claude.ai/artifact/7naK43HtiXBr1xUVXRbrvL
(6 artboards: prévia do post, enviar para aprovação em 3 estados, opções de legenda, calendário do
cliente, anexar imagem do chat, celular escuro).

Replaces the in-app assistant (`2026-10-28-assistente-ia-byok-design.md`, archived). Companion task,
outside this build: the founder applies to "Sign in with ChatGPT" with
`docs/openai-sign-in-with-chatgpt-application.md`.

## 1. Intent

Mesaas customers already pay for Claude or ChatGPT, and almost none have an API key. Anthropic forbids
using a Claude subscription inside Mesaas, so we meet users where their subscription already works:
inside Claude and ChatGPT, through the Mesaas MCP connector that is live today (≈47 tools, OAuth,
role-capped scopes). This project makes that connector visual and actionable with MCP Apps cards
(interactive iframes the host renders in the chat), and publishes it in both hosts' directories so a
normal Plus/Pro/Claude user can install it.

### Facts that shape the design (verified 2026-10-29 unless marked)

- **MCP Apps** (extension `io.modelcontextprotocol/ui`, spec 2026-01-26) is rendered by Claude (web,
  desktop; mobile documented) and ChatGPT. A tool declares `_meta.ui.resourceUri: "ui://…"`; the
  resource is `text/html;profile=mcp-app` with `_meta.ui.csp` / `domain` / `prefersBorder`. The widget
  talks to the host over postMessage JSON-RPC: it receives `ui/notifications/tool-input` and
  `tool-result`, can call server tools (`tools/call`), send a chat message (`ui/message`), open links
  (`ui/open-link`), report size, and reads `HostContext.theme` and `styles.variables`.
  `_meta.ui.visibility: ["app"]` makes a tool callable only from the widget (the host hides it from
  the model).
- **ChatGPT-only:** `_meta["openai/fileParams"]` passes chat files to a tool as
  `{download_url, file_id, mime_type?, file_name?}`; `window.openai.selectFiles` / `uploadFile` /
  `getFileDownloadUrl` let a widget pick files. Whether ChatGPT passes images **it generated** this way
  is reported by the community but not confirmed by OpenAI [unverified].
- **Claude:** `_meta.ui.domain` must be the first 32 hex chars of sha256(server URL) +
  `.claudemcpcontent.com`; `frameDomains` is restricted; inline height auto-fits.
- **SDK:** the server pins `@modelcontextprotocol/sdk@1.25.3`. `@modelcontextprotocol/ext-apps` 1.0–1.3.2
  peer on `^1.24`; 1.4+ needs `^1.29`; 2.x needs SDK v2 and zod 4. `registerTool` / `registerResource`
  on 1.25.3 accept `_meta`, `title` and `annotations`.
- **Directories:** Claude custom connectors work by URL on every plan (Free: one connector), so the
  Claude listing is reach, not access. On ChatGPT, write actions from a custom connector are likely
  limited to Business/Enterprise developer mode [unverified, help center 403], so **Plus/Pro users
  need the published ChatGPT app** for every write card.

## 2. Goals, non-goals, anti-goals

**Goals**
- Four cards, as in the mockups: post preview + save draft; caption options; client calendar; attach
  an image from the chat (ChatGPT).
- From a saved-draft card, **a person's click** sends the post to the client for approval
  (user decision 2026-10-29). The model alone never sends.
- Every tool gets `title` + `readOnlyHint`/`destructiveHint` annotations (both directories require it).
- Listings submitted in the Claude connector directory and the ChatGPT app directory.

**Non-goals (v1)**
- Generating images in Mesaas. Claude has no image generation; ChatGPT's own generation is used as-is.
- Scheduling or publishing from the chat. Fullscreen/pip modes. Hub (client portal) cards.
- TikTok and "Geral" captions (`tiktok_caption`, `post_targets.caption`): v1 cards edit `ig_caption` only.
- "Continuar com o ChatGPT" (SIWC as the connector's OAuth): only after OpenAI accepts the application.

**Anti-goals**
- The model sending a post to a client, or any card write without a visible click.
- A card showing another workspace's data, or more than the user's role allows.
- Breaking the existing 47 tools or the people already using the connector without cards.

## 3. Rollout switch (my call)

No plan flag (that means redeploying the eight `_shared/entitlements.ts` importers). The connector is
already gated by `feature_mcp`. Instead, an edge secret `MCP_APPS` = `off` (default) | `pilot` | `on`,
with `MCP_APPS_PILOT_CONTAS` (comma-separated `conta_id`s) for `pilot`. Read per request after
`resolveCtx`: when off for this workspace, the server registers no card tools, no `ui://` resource and
no `_meta.ui`, so it behaves exactly as today. Changing the secret needs no deploy.

## 4. Server changes (`supabase/functions/mcp/`)

### 4.1 Registration
- Move `register()` (`register.ts:79`) from legacy `server.tool(...)` to
  `server.registerTool(name, {title, description, inputSchema, annotations, _meta}, cb)`, keeping its
  scope check, owner-only gate and audit. Add `title` (pt-BR) and annotations to **all** tools
  (`readOnlyHint: true` on reads; writes `readOnlyHint: false`, `destructiveHint` true only for
  deletes and `fechar_periodo`-style irreversible actions; `openWorldHint: true` on
  `send_post_to_client`). A structural test fails if any registered tool lacks them.
- New helper `cardResult(summary, data, meta?)` returning `{content: [{type: "text", text: summary}],
  structuredContent: data, _meta: meta}` (today `jsonResult` sends only text JSON, `register.ts:15`).
  The summary is short pt-BR text for the model; the widget renders `structuredContent`. ChatGPT shows
  `structuredContent` to the model too, so keep it lean (ids, short texts, signed thumbnail URLs; no
  full post bodies beyond what the card shows). Anything only the card needs goes in `_meta`.
- Argument naming: card tools use `client_id`, like the existing read tools.
- No `@modelcontextprotocol/ext-apps` dependency on the server (my call): the `_meta` keys are plain
  objects, which avoids an SDK bump. The widget bundle uses ext-apps' client `App` class (independent
  of the server SDK; pin the latest 1.x that builds with Vite).

### 4.2 The resource
- One resource `ui://mesaas/cards-v1.html` (`text/html;profile=mcp-app`), registered with
  `server.registerResource` only when cards are on. The version is in the URI: a widget change ships
  as `cards-v2` so hosts never serve a stale cached HTML against new tool shapes.
- `_meta.ui`:
  - `csp.resourceDomains`: the origin `signGetUrl` returns (`https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`,
    `_shared/r2.ts:20-25`), computed from env at request time. If the media-proxy worker becomes the
    signing path, its origin instead. `connectDomains`: none (the widget only talks to the host).
  - No `_meta.ui.domain`. The two hosts need incompatible values (Claude: a hash of the exact URL the
    user typed, where a trailing slash changes it, and optional unless the widget runs its own OAuth;
    ChatGPT: an origin, required for a listed plugin with UI), and the stateless server cannot tell
    the hosts apart. Set only `_meta["openai/widgetDomain"] = "https://www.mesaas.com.br"`.
  - `prefersBorder: false` (the card draws its own border).
- The HTML is a generated TS module (`mcp/ui/generated/cards-v1.ts`, `export const CARDS_V1_HTML`),
  pattern of `scripts/build-report-fonts.ts` → `_shared/report-template/fonts.ts`. See §6.

### 4.3 Card tools (model-visible, `_meta.ui.resourceUri: "ui://mesaas/cards-v1.html"`)

`structuredContent` always carries `card: "<kind>"`, `v: 1`, and the data below. Every id is checked
against `ctx.conta_id` like the existing queries.

| Tool | Scope | Args | Card |
|---|---|---|---|
| `preview_post` | `posts:read` | `client_id`, `titulo`, `tipo`, `slides[{texto}]` (≤10, carousel), `roteiro?` (reels), `ig_caption`, `post_id?` (when revising a saved post) | Prévia do post. Read-only: renders the proposal, writes nothing. Returns client name, pillar label if given, caption length vs `captionMaxFor()` |
| `show_caption_options` | `posts:read` | `client_id`, `post_id?`, `options[{label, text}]` (2–3) | Opções de legenda |
| `show_client_calendar` | `posts:read` | `client_id`, `from?` (default today, São Paulo), `weeks` (1–6, default 3) | Calendário do cliente |
| `show_attach_image` | `posts:read` | `post_id`, `image` (`openai/fileParams`), `position?` | Anexar imagem (ChatGPT). Returns the post's current media order (signed thumbnails), tipo, status, eligibility |

Descriptions tell the model when to use each (pt-BR), e.g. `preview_post`: "Mostra a prévia de um
post antes de salvar. Use sempre que propuser um post novo." `show_attach_image`: "Só quando o usuário
quer pôr no post uma imagem que está nesta conversa."

### 4.4 Widget-only tools (`_meta.ui.visibility: ["app"]`)

| Tool | Scope | What |
|---|---|---|
| `send_post_to_client` | `posts:write` | args `post_id`, `expected_status`. Sends the post to the client (§5) |
| `attach_image_to_post` | `posts:write` | args `post_id`, `image {download_url, file_id, mime_type?}`, `position` (1–10), `replace` (bool). §4.6 |

The card's own writes that already exist stay model-visible tools called from the widget:
"Salvar como rascunho" → `create_post` (or `update_post` with `post_id`); "Usar esta legenda" →
`update_post {post_id, ig_caption}`. With no `post_id` yet, "Usar esta legenda" sends
`ui/message` ("Usar a opção 2") so the model re-renders `preview_post` with it.

Slides → body (decided): `create_post`/`update_post` take a plain-text `body` that becomes
`conteudo_plain` and the TipTap `conteudo` (`mcp/queries.ts:1286,1324,1378`); there is no carousel
format in the MCP contract, and `slide_1_text` is the first line of `conteudo_plain` (`:522`). So
`body = slides.map(s => s.texto.trim()).join("\n\n")`: one paragraph per slide, slide 1 first, no
"Lâmina N" prefix (it would leak into `slide_1_text`). Reels: `body = roteiro`. When a card re-reads a
saved post, it splits `conteudo_plain` on blank lines. A Deno test pins the round trip and
`slide_1_text`.

**Visibility is enforced by the host, so it is not enough on its own.** A host without MCP Apps
ignores `_meta.ui` and lists `send_post_to_client` to its model: Claude Code, Codex, Cursor, scheduled
routines, any `mesaas_sk_` key consumer. The stateless server cannot see the client's capabilities
(they travel only in `initialize`). So "the model never sends" rests on two server-side checks:
1. **OAuth only.** `send_post_to_client` and `attach_image_to_post` are registered only when
   `ctx.key_id` starts with `oauth:` (`_shared/mcp-oauth.ts:207`); static `mesaas_sk_` keys never
   see them. (Static keys are also why `ctx.created_by` would be the key's creator, not the clicker.)
2. **A per-post send nonce delivered to the card, not the model.** Results of `create_post`,
   `update_post` and `preview_post` (when `post_id` is set) carry `_meta["mesaas/sendNonce"]`: an HMAC
   (key derived with HKDF from `TOKEN_ENCRYPTION_KEY`, purpose `mcp-send-nonce`) over
   `{conta_id, user_id, post_id, exp: now + 30 min}`. `send_post_to_client` requires it and checks
   every field. Result `_meta` is delivered to the widget and hidden from the model on ChatGPT
   (documented); on Claude this must be confirmed in the pilot (§9 step 3). If Claude shows result
   `_meta` to the model, the nonce moves into a widget-only `resources/read` the card calls, and the
   pilot does not go to `on` until that holds.
   Residual: an OAuth client without MCP Apps whose model can read result `_meta` could still send.
   It is the same user, within `posts:write`, and the status guard in §5 limits it to one send.

### 4.5 Calendar data
- New query `listClientCalendar(client_id, from, weeks)`. `from` is a date `YYYY-MM-DD` in
  `America/Sao_Paulo`, snapped back to that week's Monday; the range is `[from 00:00, from + 7·weeks
  days 00:00)` in São Paulo, converted to UTC with a real time-zone conversion (no fixed offset).
- One row per post. Canonical date = `published_at` when published, else `scheduled_at`
  (`20260427000001_instagram_publishing.sql:48`); a post is in range when its canonical date is, so a
  published post never appears twice. Fields: id, titulo, tipo, status, canonical date.
  `list_posts` does not return `scheduled_at` today and has no date filter.
- "Dias de costume" (my call): a weekday is usual when the client had a post scheduled or published
  on it (canonical date, São Paulo) in at least 4 of the 8 weeks before `from`. A usual weekday in
  range with no post is a gap. No dependency on `feature_best_times`.
- "Sugerir posts para os dias vazios" → `ui/message` naming the gap dates; "Abrir calendário no
  Mesaas" → `ui/open-link` to Entregas in calendar view filtered by the client, using the URL state
  Entregas already serializes (`clientes=<id>` plus its view param, `pages/entregas/viewQuery.ts`;
  the builder copies the exact keys from there). No CRM change. Not `/calendario`, which is the agenda.

### 4.6 Attaching a chat image
- `fetchImageSafely(deps, image.download_url, {maxBytes: 8 MB, timeoutMs: 20 s})`
  (`_shared/safe-image-fetch.ts:274`), with `resolveDns`/`fetchUrl` wired from `Deno.resolveDns` and
  `fetch` the way `mcp-admin/index.ts` does (the MCP `Deps` has neither today). Mime from
  `sniffImageBytes`, JPEG/PNG only (WebP/GIF refused: "Formato não aceito. Use JPG ou PNG.").
- **Host allowlist:** on Claude the model can pass any public URL as `image.download_url`, so the tool
  only accepts the OpenAI file host(s) observed in the first real ChatGPT test, kept in one constant.
  `download_url` never reaches `audit_log` (`auditArgs` logs `post_id`, `position`, `replace` only).
- **Redirects:** `fetchImageSafely` refuses any 3xx (`redirect: "manual"`, `:300-305`). The first test
  records whether ChatGPT's `download_url` redirects. If it does, add a bounded redirect option
  (at most 3 hops, each re-validated against https, DNS/private-IP rules and the allowlist) to
  `fetchImageSafely`, never a plain `redirect: "follow"`.
- Width/height: a small `_shared/image-dimensions.ts` reads PNG IHDR and JPEG SOF; unknown → NULL
  (both nullable in `file_insert_with_quota`).
- Order of operations:
  1. Fetch and sniff (above); cheap eligibility pre-check (below) and a quota precheck (as
     `mcp/media.ts:13-20` does) so most refusals happen before any upload.
  2. Presigned PUT + plain `fetch` + `AbortSignal` to `contas/<conta>/files/<uuid>.<ext>`.
  3. **One** SECURITY DEFINER RPC `mcp_attach_post_file(p_conta_id, p_post_id, p_actor, p_file jsonb,
     p_position, p_replace)`, EXECUTE to `service_role` only, in a single transaction: re-check
     membership (pattern of `post_file_link_replace`, `20260916000001_post_file_link_replace.sql:47-54`),
     lock the post row `FOR UPDATE` (serializes two clicks and the publishers, same lock that RPC
     takes), re-check eligibility, then create the `files` row through `file_insert_with_quota`'s
     logic (quota charged in the same transaction) and either
     - **append/insert** (`p_replace = false`): refuse when the post already has 10 items, before
       creating anything; shift `sort_order` of links at `>= p_position` by one and insert the new link
       with `origin = 'manual'`. Cover: `post_file_links_one_cover` is a non-deferrable partial unique
       index (`20260425000001:83`; the repo has hit its duplicate-key error before). At position 1,
       demote the current cover (`is_cover = false`) in one statement, then insert the new link with
       `is_cover = true`; elsewhere insert with `is_cover = false`. An empty post gets its cover from
       the existing `post_file_link_auto_cover` trigger;
     - **replace** (`p_replace = true`): swap `file_id` on the existing link at that position, keeping
       the link row, its `sort_order` and `is_cover` (same identity-preserving approach as
       `post_file_link_replace`). Deleting and re-inserting would fire `post_file_link_reassign_cover`
       (`20260425000002_file_system_triggers.sql:176`) and move the cover to the next slide. The old
       file stays in Arquivos. Allowed at 10 items.
     - Like `post_media_set_from_uploads`, a post in `correcao_cliente` moves to `revisao_interna`
       when its media changes (consistent with the connector's existing media write).
  4. If the RPC fails (race lost, quota, limit), the function enqueues the uploaded key in
     `file_deletions` (the existing deletion queue) and returns the RPC's pt-BR error. Anything a kill
     leaves behind is an unreferenced object under `contas/`, which the existing orphan scan reaps
     after 24 h. Retrying is safe: each attempt uploads a new key.
- `replace` is decided by the card: picking a slide that already has an image asks "Substituir a
  imagem da lâmina N?".
- Eligibility: post in the workspace, `status` in `EDITABLE_STATUSES` (`rascunho`, `revisao_interna`,
  `correcao_cliente`, `queries.ts:1338`), `tipo` feed or carrossel, at most 10 media items for an
  append. Errors are actionable pt-BR sentences (directory requirement).
- "Escolher outra imagem": ChatGPT `selectFiles`, then `getFileDownloadUrl`, then the same tool.
  Feature-detected; hidden on hosts without it.
- First build task includes a real test: generate an image in ChatGPT and confirm it reaches
  `show_attach_image` as a file param. If it does not, v1 supports uploaded images only and the card
  copy says "Envie a imagem nesta conversa" instead.

## 5. Sending to the client

Today the CRM sends with plain table updates under RLS (`store/posts.ts` `sendPostToCliente` ~:1424,
`sendSelectedPostsToCliente` ~:1400); side effects are triggers (`record_post_status_event`,
status automations), the Hub's read and `client-event-email-cron`'s digest. The connector runs with the
service role, so it needs its own guarded write:

- SECURITY DEFINER RPC `mcp_send_post_to_client(p_conta_id, p_post_id, p_expected_status, p_actor uuid)`,
  EXECUTE to `service_role` only. It `set_config('app.actor_id', p_actor, true)` and
  `set_config('app.event_source', 'workspace_user', true)` (pattern of
  `20260807000001_publish_error_code.sql:33`) so `post_status_events` records who sent it.
  `post_status_events.source` only allows `workspace_user | client | system`
  (`20260606000001_post_status_events.sql:16-17`) and the trigger swallows a violation as a warning,
  so `'mcp'` would silently drop the event and the client digest. A person clicking the card is a
  workspace user acting; the MCP origin is already in `audit_log` (`mcp.send_post_to_client`). Then
  `UPDATE workflow_posts SET status = 'enviado_cliente', custom_status_id = NULL WHERE id = p_post_id
  AND conta_id = p_conta_id AND status = p_expected_status AND status NOT IN (<SELECTION_SEND_SKIPPED_STATUSES>)`.
  Zero rows → the RPC re-reads the post and returns a distinct code: `already_sent`
  (`enviado_cliente`: "Este post já está com o cliente."), `approved` (`aprovado_cliente`, `agendado`,
  `postado`: "O cliente já aprovou este post."), `stale` (anything else: "O post mudou no Mesaas.
  Atualize o cartão.").
- The RPC also verifies the send nonce's fields match its arguments (§4.4) before updating.
- `run_post_status_automations` passes `auth.uid()` as the notification actor
  (`20260805000002:246`), which is NULL under the service role: automations still run, the
  notification just has no actor name. Accepted for v1.
- Preconditions mirrored from the CRM: a video without a thumbnail is refused (`hasVideoMissingThumbnail`,
  `PostMediaGallery.tsx:1554`, used at `WorkflowDrawer.tsx:763`). Scope `posts:write` (= `entregas:editar`).
- The card's two-step flow (mockup board 2) is the only caller: "Enviar para aprovação" opens the
  inline confirmation, "Enviar ao cliente" calls the tool.
- Docs that say the agent never sends must change to "o agente não envia sozinho; um clique seu no
  cartão envia": `create_post`/`update_post` descriptions (`tools.ts`) and the KB articles
  `limites-e-seguranca-do-agente` and `o-que-o-agente-pode-fazer` (edited through the Admin MCP).

## 6. The widget bundle (`apps/mcp-widgets/`, new workspace)

- React 19 + TypeScript + Vite with a single-file build (all JS/CSS inlined; no external requests,
  matching `connectDomains: []`). ext-apps `App` for the bridge. Hand-written CSS on the Mesaas tokens
  (light and dark), overridden by host `styles.variables` where the host provides them; theme from
  `HostContext.theme`. lucide-react icons. pt-BR copy, sentence case, no em dashes.
- One app, four cards, switched on `structuredContent.card`; unknown `card` or `v` renders a small
  "Atualize o conector" fallback.
- `npm run build:mcp-widgets` writes `supabase/functions/mcp/ui/generated/cards-v1.ts` (header
  "GENERATED, do not edit"), committed. CI: a step in `lint-and-typecheck` (the job that has Node and
  `npm ci`; `edge-function-tests` only sets up Deno) rebuilds and runs `git diff --exit-code` on that
  file, so a stale bundle cannot merge. The same job gets a fifth `tsc` for `apps/mcp-widgets`, and
  CLAUDE.md/README's "four projects" lines are updated. Size budget 500 KB raw (React 19 + lucide +
  ext-apps `App` with its zod); if it lands far above, switch the bundle to Preact. The builder
  reports the real size.
- ext-apps version for the widget: the widget is its own npm workspace, so it can use the latest 1.x
  (1.7.5 at writing) regardless of the server's SDK pin.
- Dev harness: a local page that mounts the widget with fixture `structuredContent` through ext-apps'
  `app-bridge`, for Vitest and for manual checks without a host.
- Accessibility: real buttons, focus states, 44 px targets on phone widths, text contrast 4.5:1 in
  both themes.

## 7. Directory submissions (checklist; owner in brackets)

Shared:
- Reviewer account: a populated demo workspace (reuse the Admin's "Conta demo" flow), no MFA [builder
  prepares, founder approves].
- Public docs: KB articles updated (§5) plus one "Cards no Claude e no ChatGPT" article with screenshots
  [builder drafts via Admin MCP].
- Privacy policy `/politica-de-privacidade` and terms `/termos-de-uso` on www.mesaas.com.br exist;
  check they mention the connector and the data it reads [founder].
- Allowed link URIs for `ui/open-link`: `https://www.mesaas.com.br`, the CRM app origin.

Claude (claude.com/docs/connectors/building/submission.md): annotations on every tool, separate read
and write tools (already true), names ≤64 chars, no prompt-injection-like descriptions, actionable
errors, card screenshots for the carousel [builder]; submit [founder].

ChatGPT (developers.openai.com/plugins/deploy/submission.md): organization verification and domain
verification [founder]; plugin ZIP (manifest, icon, descriptions) [builder]; support URL; exactly
5 positive and 3 negative test cases [builder drafts]; demo video [founder records]; target countries
`BR` (my call); OAuth works end to end from ChatGPT on prod (staging's OAuth server is off) [builder
verifies before submitting].

## 8. Tests

- Deno: every tool has `title` + annotations (structural); `MCP_APPS=off` yields today's tool list
  exactly (snapshot); `pilot` only for listed `conta_id`s; each card tool returns `structuredContent`
  with `card`/`v`; `send_post_to_client` status matrix (from each status, stale, skipped statuses,
  video without thumbnail, other workspace) and the `post_status_events` row exists with the actor
  and source `workspace_user`; `attach_image_to_post` eligibility, JPEG/PNG only, 8 MB cap,
  private-IP URL refused, position shift, append refused at 10, replace at 10 allowed, replace of
  slide 1 keeps it as cover, insert at position 1 becomes cover without a duplicate-key error, a
  failed RPC enqueues the uploaded key in `file_deletions`, non-allowlisted image host refused,
  `download_url` absent from the audit row; widget-only tools absent for `mesaas_sk_` keys; send
  refused without a nonce, with an expired one, or one for another post/user/workspace; distinct
  `already_sent`/`approved`/`stale` codes; slides↔body round trip;
  calendar range boundaries in São Paulo, no duplicate published post, gap heuristic.
- SQL: both RPCs EXECUTE only by `service_role`.
- Vitest (apps/mcp-widgets): each card renders from fixtures in light and dark, unknown `card`
  fallback, two-step send, caption pick, slide pick + replace prompt.
- Manual on prod with `MCP_APPS=pilot` (the founder's workspace): Claude web, Claude desktop, Claude
  mobile, ChatGPT web, ChatGPT mobile. Record what each host renders.

## 9. Deploy order

1. Migration (`mcp_send_post_to_client`, `mcp_attach_post_file`).
2. Deploy `mcp` (`--no-verify-jwt --use-api`, as today) with `MCP_APPS=off`: tool list unchanged except
   the new titles/annotations.
3. `MCP_APPS=pilot` + `MCP_APPS_PILOT_CONTAS=<founder's conta>`; manual host matrix (§8). The pilot
   must also confirm, before step 4: Claude does not show result `_meta` (the send nonce) to the
   model (§4.4); ChatGPT's `download_url` host and redirect behaviour (§4.6); whether a
   ChatGPT-generated image arrives as a file param; that the card renders in Claude without
   `_meta.ui.domain`.
4. KB and tool-description updates; then `MCP_APPS=on`.
5. Directory submissions (§7).
6. Merge (no CRM change in v1 besides docs, so order relative to the merge is free).

Rollback: `MCP_APPS=off` (instant). Hosts may cache the resource; the versioned URI keeps old caches
harmless.

## 10. Out of scope / follow-ups

- "Continuar com o ChatGPT" as connector login, and the in-app "Usar seu plano do ChatGPT" (text only:
  SIWC's plan-billed scope excludes image generation), both after OpenAI accepts the application.
- TikTok/Geral captions, more cards (approval feedback, analytics), fullscreen editor.
- A dedicated "Agentes (MCP)" permission module (noted in an earlier project, not needed here).

## 11. Calls I made (check these)

- Env switch `MCP_APPS` with a pilot list instead of a plan flag (§3).
- No ext-apps on the server; plain `_meta` on SDK 1.25.3 (§4.1).
- One versioned resource for all cards (§4.2).
- `send_post_to_client` under the existing `posts:write` scope, no new scope (users keep their current
  authorizations), registered for OAuth connections only and guarded by a card-only nonce (§4.4).
- No `_meta.ui.domain`; only `openai/widgetDomain` (§4.2).
- "Dias de costume" = 4 of the last 8 weeks (§4.5).
- ChatGPT listing targets Brazil (§7).
- v1 edits `ig_caption` only (§2).
