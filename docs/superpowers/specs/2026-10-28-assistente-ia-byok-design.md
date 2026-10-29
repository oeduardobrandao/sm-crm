# Assistente de IA com o modelo do usuário (BYOK)

Status: **arquivado em 2026-10-29.** Most customers use a Claude or ChatGPT subscription, not API
keys, and Anthropic forbids using a Claude subscription inside Mesaas. The founder chose to focus on
Mesaas inside Claude/ChatGPT (MCP Apps cards) and on applying to "Sign in with ChatGPT". Kept as the
reference design if API keys (or an approved Sign in with ChatGPT) later make the in-app assistant
worth building. Reviewed by a builder check, Codex and Fable before archiving. Mockups: https://claude.ai/artifact/AZGMm5hDR7aWDJatRcYBTe
(6 artboards: Configuração › Inteligência artificial, painel do assistente, editor de post, painel sem
modelo, celular escuro, widget MCP).

This spec covers the **in-app assistant** (route A). The MCP Apps widgets inside Claude/ChatGPT
(route B, the last artboard) run in parallel under their own spec; see §13.

## 1. Intent

Agencies want to write captions, carousels and reels scripts, generate post images and work the CRM
with the AI model they already pay for, without leaving Mesaas. The user wants Mesaas to be the
harness: it knows the client (briefing, strategy, best posts), it can create drafts, and the model is
the customer's choice.

Mesaas pays nothing for model usage. Every call is billed to the customer's own provider account.

### Policy facts that shape the design (verified 2026-10-28)

- **Anthropic forbids using a Claude.ai subscription (Free/Pro/Max) inside third-party apps.** The Claude
  Code legal page bars offering Claude.ai login or routing requests through plan credentials, and
  bars collecting or storing Claude.ai credentials or session tokens. OpenCode removed the feature after
  legal requests (Feb 2026). Claude is therefore reachable **only via an API key or OpenRouter**.
- **"Sign in with ChatGPT"** (OpenID Connect + PKCE, may bill the user's Plus/Pro plan) exists but is a
  limited trial for selected partners. v1 ships a disabled row "Em breve". Applying to OpenAI is a
  manual task for the founder, outside this build.
- **Google** bans reuse of Gemini CLI/Antigravity OAuth in third-party tools. Gemini only via AI Studio key.
- **OpenRouter OAuth PKCE** returns a user-owned API key billed to the user's OpenRouter credits. One
  connection reaches Claude, GPT, Gemini and the image models. This is the recommended path.
- **Claude does not generate images.** Images go through Gemini (Nano Banana family) or OpenAI
  (gpt-image family), directly or via OpenRouter. Rough cost: US$ 0,03 to 0,07 per image on mid-tier
  models, US$ 0,13 to 0,24 at premium quality.

## 2. Goals, non-goals, anti-goals

**Goals**
- Connect a model in under a minute: OpenRouter in one OAuth click, or paste a key (Anthropic, OpenAI, Gemini).
- A global, context-aware side panel (⌘J) on every CRM page, plus inline actions in the post editor
  and in Ideias.
- The assistant reads what the user's role can read and proposes writes; every write waits for a
  confirm card. It never schedules, sends to the client or publishes.
- Image generation into a post's media, with the estimated cost shown before charging.
- Shipped dark behind `feature_assistente_ia`; launch turns it on for every paid plan.

**Non-goals (v1)**
- Using any consumer subscription inside Mesaas (forbidden or gated, see §1).
- Mesaas-paid usage, quotas or credits.
- Token streaming (SSE). Progress is shown per step (§6.1).
- Server-side conversation history. Conversations live in the browser tab (§6.5).
- The Hub (client portal). Financeiro, Equipe and client/workflow creation tools (§7).
- MCP Apps widgets (separate spec, §13).

**Anti-goals (failure even if it works)**
- A key ever reaching the browser after it is saved, or appearing in a log, audit row or error message.
- The assistant changing data without a click on a confirm card, or reaching anything outside the
  user's role.
- Model output rendered as HTML.
- An Anthropic OAuth or setup token accepted as a key (it would put the customer's account at risk).

## 3. Feature flag and plans

- New plan column `plans.feature_assistente_ia boolean NOT NULL DEFAULT false`, added to
  `FEATURE_COLUMNS` in `supabase/functions/_shared/entitlements.ts`.
- **"For now" = dark.** The schema migration leaves the column `false` on every plan. Testing uses the
  per-workspace override (`workspace_plan_overrides.feature_overrides = {"feature_assistente_ia": true}`,
  set from the Admin's workspace detail). Launch is a later one-line migration:
  `UPDATE plans SET feature_assistente_ia = true WHERE id IN ('start','pro','max','lifetime');`
  (pattern of `20260907000002_plans_feature_briefing_audio.sql`). This reading of "all paid plans, but
  behind a flag for now" is my call; flip the launch migration if it is meant to be on now.
- Plans created after launch: the column default stays `false` (a default of `true` would also
  enable a future free-type plan). The flag is in the Admin plan form (`FEATURE_FLAG_KEYS`), so whoever
  creates a paid plan ticks "Assistente de IA" there, as with every other paid feature.
- Server gate: `effectivePlanFeature(db, conta_id, 'feature_assistente_ia')` (`_shared/entitlements-rpc.ts`)
  on **every** request of both new functions. It does not depend on `feature_mcp`: the assistant
  invokes tools in-process (§7) and never passes through `resolveCtx`, where `feature_mcp` is enforced.
- CRM gate: fail-closed `features?.feature_assistente_ia === true` (convention in
  `hooks/useWorkspaceLimits.ts:64-72`). Do **not** rely on `FeatureGate`/`hasFeature`, which are
  fail-open and would show the feature to everyone until `workspace-limits` redeploys.
- Files a new flag touches (from the Linha editorial spec §9): the migration; `FEATURE_COLUMNS`;
  Admin `apps/admin/src/lib/api.ts` (`Plan` interface, `FEATURE_FLAG_KEYS`, `FEATURE_FLAG_LABELS`
  "Assistente de IA") and `apps/admin/src/lib/__tests__/featureFlags.test.ts`; CRM `FeatureFlags`
  (`useWorkspaceLimits.ts`) and `lib/entitlement-errors.ts`; a Deno test
  `__tests__/entitlements_feature_assistente_ia_test.ts`. Not the Hub.

## 4. Data model (one migration, plus the launch migration later)

Every table below: `REVOKE ALL ... FROM PUBLIC, anon, authenticated` (name the roles explicitly),
then `GRANT ALL ... TO service_role`, plus `GRANT USAGE, SELECT` on each `bigserial` sequence to
`service_role` (local and CI lack the hosted default ACL; shape of
`20260925000030_tarefa_series.sql:411-413`). Access only through the new edge functions with the
service role. No CRM `from(...)` on them.

### `ai_connections`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| conta_id | uuid not null | workspace |
| owner_user_id | uuid null | null = workspace connection; set = a member's personal connection |
| provider | text not null | `openrouter` \| `anthropic` \| `openai` \| `google` (check constraint) |
| encrypted_key | text not null | `encryptText(key, TOKEN_ENCRYPTION_KEY, 'ai-key-<provider>')` from `_shared/crypto.ts` |
| key_hint | text not null | last 4 chars, for "sk-ant-•••• a9F2" |
| status | text not null | `verificada` \| `invalida` |
| verified_at | timestamptz | last successful verify |
| created_by | uuid not null | |
| created_at / updated_at | timestamptz | |

Unique `(conta_id, provider) WHERE owner_user_id IS NULL` and `(conta_id, owner_user_id, provider)`.
User FKs follow the repo's `auth.users` delete convention: `owner_user_id` → ON DELETE CASCADE (a
deleted member's personal keys go with them); `created_by` must not block a user delete (NOT NULL
columns cannot SET NULL), so either make it nullable with SET NULL or drop the FK. Builder's call.

### `ai_workspace_settings`
`conta_id uuid pk`, `default_text` jsonb (`{provider, model}`), `default_image` jsonb,
`team_uses_workspace_connections boolean default true`, `show_image_cost boolean default true`,
`monthly_alert_usd numeric(10,2) null`, `updated_at`.

### `ai_usage_log`
`id bigserial`, `conta_id`, `user_id`, `provider`, `model`, `kind` (`text` \| `image`),
`input_tokens int`, `output_tokens int`, `images int`, `est_cost_usd numeric(10,4) null`, `created_at`.
Index `(conta_id, created_at)`. Cost: use the provider-reported cost when the response carries one
(OpenRouter usage accounting; builder verifies the field), else a static price map in
`_shared/ai-prices.ts`; unknown model = null cost, shown as "sem estimativa".

### `ai_turns` and `ai_pending_actions` (server-side guards, not history)
The browser holds the conversation (§6.5), so the server keeps only what it must trust:
- `ai_turns`: `id uuid pk`, `conta_id`, `user_id`, `steps int default 0`, `created_at`. One row per
  user message. Every `/step` calls the SQL function `ai_turn_step(p_turn_id, p_user_id, p_conta_id)`
  (EXECUTE to `service_role` only; PostgREST cannot express `steps = steps + 1 ... RETURNING`), which
  does `UPDATE ... SET steps = steps + 1 WHERE id = p_turn_id AND user_id = p_user_id AND conta_id =
  p_conta_id AND steps < 8 RETURNING steps`; no row back = refuse. The client cannot reset the cap.
- `ai_pending_actions`: `id uuid pk`, `turn_id`, `conta_id`, `user_id`, `tool_call_id text`, `tool`,
  `args jsonb` (normalized, post-parse; for compound actions an ordered list of steps), `status`
  (`pendente` \| `executando` \| `executada` \| `falhou` \| `recusada` \| `expirada`), `expires_at`
  (now + 30 min), `result jsonb null`, `created_at`. Written when a step returns `needs_confirm`.
  A confirm **claims** it: `.update({status:'executando'}).eq('id').eq('user_id').eq('conta_id')
  .eq('turn_id').eq('status','pendente').gt('expires_at', now).select()`; no row back = already
  used or expired, so a replayed confirm runs nothing. The tool context is built from the row's
  `conta_id`, with membership re-checked. Success writes `executada` + `result`; an `isError`
  envelope from `register()` (`mcp/register.ts:96-101`) or a throw writes `falhou` and the tool
  result carries the generic error, so the model can tell the user. A second confirm of an
  `executada` action returns the stored `result` (idempotent), never a second write. A row stuck in
  `executando` (edge kill) is reported as `falhou` once `expires_at` passes. The appended tool result
  always carries the row's `tool_call_id`.
- Args stored here carry captions and bodies, so they stay in this table only (7-day retention below)
  and never reach `audit_log`: before the in-process path runs a tool, confirm each allowlisted write
  has an `auditArgs` that logs ids and lengths only (`create_post`, `update_post`, `create_task`,
  `update_task` do; check `set_post_property` and add one if missing).
- Retention: rows older than 7 days are deleted by the existing hourly cleanup path or a small
  addition to `notification-cleanup-cron` (builder's call).

### `ai_generated_images` (staging for image generations)
`id uuid pk`, `conta_id`, `user_id`, `r2_key text unique`, `mime_type` (`image/png` \| `image/jpeg`),
`size_bytes int`, `width int`, `height int`, `provider`, `model`, `expires_at` (now + 7 days),
`attached_post_id bigint null`, `attached_at timestamptz null`, `created_at`. See §6.4.

### Monthly alert claim
`ai_usage_alerts`: `conta_id`, `month date`, `created_at`, primary key `(conta_id, month)`. See §9.

## 5. Connections (edge function `ai-connections`)

Verifies the user token itself with the service-role client + `getUser` (repo convention for this
project's ES256 tokens), so like the other self-verifying functions it ships with
`verify_jwt = false` in `supabase/config.toml` and deploys with `--no-verify-jwt`; the gateway would
otherwise 401 every call. Same for `assistente-ia`. Add both to the CLAUDE.md `--no-verify-jwt` list.
Every action checks the flag and that the caller is a member of the active workspace (§6.1).

| action | who | what |
|---|---|---|
| `list` | any member | connections visible to the caller (workspace ones + own), never the key; plus settings and the month's usage estimate |
| `save-key` | workspace: `configuracoes:editar`; personal: self | validate format, verify with a cheap call, encrypt, upsert |
| `openrouter-exchange` | same as save-key | body `{code, code_verifier, scope}`; POST `https://openrouter.ai/api/v1/auth/keys`; store the returned key |
| `delete` | workspace: `configuracoes:editar`; personal: self | delete the row. Copy reminds the user to revoke the key at the provider too |
| `verify` | same as save-key | re-run the verify call, update `status`/`verified_at` |
| `save-settings` | `configuracoes:editar` | `ai_workspace_settings` upsert |

**Key validation**
- Anthropic: must start with `sk-ant-api`. Anything else (notably `sk-ant-oat`, OAuth/setup tokens)
  is refused: "Use uma chave de API do Console da Anthropic. Tokens da assinatura do Claude não são aceitos."
- Verify calls (no tokens spent): Anthropic `GET /v1/models`; OpenAI `GET /v1/models`; Gemini
  `GET /v1beta/models` with the key in the `x-goog-api-key` header (never `?key=` in a URL, here or in
  any Gemini call, since URLs end up in logs); OpenRouter `GET /api/v1/key`. All with `AbortSignal` (10 s).
- Provider error bodies are logged internally and never returned; the client gets
  "Chave recusada pelo provedor" or "Não foi possível verificar agora".
- Rate limit `ai-connections:<user_id>` 20/600 s (`_shared/rate-limit.ts`).

**OpenRouter PKCE (CRM side)**
- "Conectar com OpenRouter" generates `code_verifier` (S256), keeps it in `sessionStorage` with the
  target scope (workspace or personal), and redirects to
  `https://openrouter.ai/auth?callback_url=<origin>/configuracao/ia/openrouter&code_challenge=...&code_challenge_method=S256`.
- Callback route `/configuracao/ia/openrouter` reads `code`, calls `openrouter-exchange`, clears
  sessionStorage and returns to the settings tab with a toast. `/configuracao` is already in the
  `vercel.json` named rewrite list; confirm the sub-path resolves in a Vercel preview.

**Which connection a request uses:** the member's personal connection for the chosen provider first;
else the workspace's, only when `team_uses_workspace_connections` is true. None: the panel shows the
empty state (artboard "Painel sem modelo conectado"), with the member-without-permission variant
when the caller cannot manage workspace connections.

## 6. The assistant loop (edge function `assistente-ia`)

### 6.1 Shape: client-driven steps

Edge limits are 150 s response / 400 s wall clock, and runtime kills skip `catch`. So **one request
= one model call plus execution of its read-tool calls**. The CRM loops:

```
POST /step { turn_id?, conversation: Message[], context, model?, confirm? }
  -> { turn_id, appended: Message[], state: 'continue' | 'done' | 'needs_confirm', pending?, usage }
```

A new user message omits `turn_id`; the server creates the `ai_turns` row and returns its id. Every
later step of that message sends it back, and the server's atomic counter enforces the cap (§4).

**Conversation integrity.** The client sends the whole `conversation` so the model has its history,
but the server executes **only** tool calls from the model response it just received in this
request, never ones present in the client payload. A confirm runs the stored tool and args (or the
re-parsed "Ajustar" args); any `tool` or `args` the client sends otherwise are ignored. A forged
assistant message in `conversation` can at most mislead the model, which then proposes a write that
still needs a confirm card.

**Several tool calls in one response.** Parallel tool use is disabled at the provider layer where the
API allows it (Anthropic `disable_parallel_tool_use`, OpenAI `parallel_tool_calls: false`). When a
response still carries several calls, the server runs the reads, stops at the first write (that one
becomes the pending action), and answers every other call with a tool result "não executado: uma ação
por vez", so every `tool_call_id` has a result and the provider accepts the next request.

**Workspace.** `conta_id` is the caller's active workspace (`profiles.conta_id` of the JWT user),
checked against `workspace_members`; never a body field. `profiles.conta_id` can be NULL in prod:
then the function answers 400 "Selecione um workspace" and the panel shows it.

- `continue`: the model called read tools; the server ran them and appended the results. The client
  calls `/step` again. Progress lines like "Li a estratégia de conteúdo" come from these steps.
- `needs_confirm`: the model called a write tool. The server does **not** run it; it parses the
  args, stores an `ai_pending_actions` row and returns
  `pending = {action_id, tool_call_id, tool, args, preview}`; the panel renders the confirm card.
- `done`: final assistant text.
- Confirm: the client resends with `confirm = {action_id, approved, args?}`. The server claims the
  action atomically (§4): single use, 30-minute expiry, same user and workspace. If the user edited
  args via "Ajustar", the edited args are re-parsed with the tool's strict zod shape and replace the
  stored ones; otherwise the stored args run. Rejected: the row becomes `recusada` and a tool result
  "o usuário recusou" is appended. Either way the loop continues. Edited args are acceptable because
  the tool runs with the caller's own role caps (§7).
- Caps: 8 steps per user message (server counter, §4), 60 s `AbortSignal` per model call, 20 s per
  tool call, conversation payload cap of 200 KB with the oldest tool results truncated first.
- Rate limits: `assistente:<user_id>` 60 steps/600 s; `assistente-img:<conta_id>` 40 images/3600 s.

### 6.2 Provider layer (my call)

Vercel AI SDK v5 with exact pins: `npm:ai@5.x.y`, `@ai-sdk/anthropic`, `@ai-sdk/openai`,
`@ai-sdk/google`, and OpenRouter via its AI SDK provider or the OpenAI-compatible base URL. Probed
2026-10-28: imports, `tool()` and `stepCountIs` run and pass `deno check` under Deno 2.7.12. The
builder's **first task** deploys a hello-world of this stack to staging to confirm it bundles on the
Supabase edge runtime; if it does not, fall back to small per-provider `fetch` adapters (shape of
`_shared/report-template/ai.ts`). Tool schemas come from the zod shapes (`zod-to-json-schema` is
already in `deno.lock`). We drive steps ourselves (one model call per request), not the SDK's
multi-step loop.

### 6.3 Context and prompt

- `context = {page, cliente_id?, post_id?, ideia_id?}` from the current route (client detail,
  post drawers, ideia detail). The panel shows it as chips ("Contexto: Dra. Marina Arrais").
- System prompt (pt-BR, in `_shared/assistente-prompt.ts`): role (assistente de uma agência de social
  media), house rules (pt-BR, no em dashes, never claim "aprovado pela Meta"), that writes need
  confirmation and it cannot schedule or publish, and that with a `cliente_id` it should read
  `get_brand_profile`, `list_pages` (strategy) and the best posts before writing. Context is fetched
  through tools, not pre-stuffed.
- **Tool results are untrusted.** Briefings and Hub pages are written by the agency's clients. The
  prompt fences tool results as data; the confirm card is the backstop against an injected write.

### 6.4 Images

Assistant-only tool `gerar_imagem {prompt, aspect: '1:1'|'4:5'|'9:16', n: 1..4, post_id?, lamina?,
use_brand: boolean}`. It costs money, so in the panel it is a **write** (confirm card with
"≈ US$ X por imagem"). In the editor the "Gerar" button click is the confirmation.

- The default image model comes from `ai_workspace_settings.default_image`. If the chosen connection
  cannot make images (Anthropic), the panel offers the other connected providers; with none, it says so.
- `use_brand` appends the client's colors and fonts from `get_brand_profile` to the prompt.
- **Format and size contract.** Post images are JPEG/PNG only and the media limit is 8 MB (the same
  contract `mcp/media.ts:63-80` enforces with a HEAD check of size and content type). So each
  provider adapter requests PNG or JPEG output explicitly (OpenAI `output_format`; Gemini returns
  inline PNG; via OpenRouter, the adapter checks the returned mime). Anything else, or over 8 MB, is
  discarded with "O modelo devolveu um formato que o Mesaas não aceita. Tente outro modelo." No
  transcoding in the isolate. URL results go **only** through `fetchImageSafely`
  (`_shared/safe-image-fetch.ts:274`: https only, no credentials or port, DNS resolution with
  private-IP block, `redirect: manual`, capped body), and the real mime comes from `sniffImageBytes`
  (line 168), never the provider's header. "Outro modelo" on OpenRouter can route to any model, so a
  result URL is untrusted. The adapter records the real byte length and reads width/height from the
  PNG/JPEG header.
- **Time budget.** The `n` images of one request are generated in parallel, each under its own 60 s
  `AbortSignal`, so the request stays inside the 150 s response limit.
- **Staging.** Each accepted image is uploaded (presigned PUT + plain `fetch` + `AbortSignal`, never
  the aws-sdk client in an isolate) to `contas/<conta_id>/files/ai/<uuid>.<ext>` and recorded in
  `ai_generated_images`. Previews are signed GET URLs. No `files` row yet, so no quota charge.
- **Orphan scanner.** Add `{ table: "ai_generated_images", columns: ["r2_key"] }` to the `contas/`
  refs in `post-media-cleanup-cron/orphan-scan.ts` (`ScanTable` union too), so staged objects are
  live while their row exists. Without it they would be reaped after 24 h
  (`CANDIDATE_AGE_MS`). Expired, unattached rows are deleted by the same cron (new small step); the
  next orphan sweep then removes the object. Rollback hazard: a cron version without this ref deletes
  every staged image older than 24 h, which only affects unattached previews (attached ones have
  `files`/`post_media` rows).
- **Attachment never replaces or deletes existing media, and never changes the post's status.**
  `set_post_media` is a full replacement (its RPC `post_media_set_from_uploads` unlinks every current
  item, garbage-collects them and can move `correcao_cliente` back to `revisao_interna`), so the
  assistant does **not** use it. "Usar a opção N" is a confirmed write (`anexar_imagem`) that
  **appends** the way the editor's own uploads do (`apps/crm/src/services/postMedia.ts:246-279` →
  `file-upload-finalize/handler.ts:112,138-152`): `assistente-ia` calls the `file_insert_with_quota`
  RPC with the service role (quota is charged here) and inserts the `post_file_links` row
  `{post_id, file_id, conta_id, sort_order}` in-process, with `sort_order` placing it at lâmina N.
  Not `post-media-finalize`, which is the legacy `post_media` path and requires keys under
  `contas/<conta>/posts/<post_id>/`. The staging prefix `contas/<conta>/files/ai/` already satisfies
  the `files` path. "Lâmina N" in the mockup is the Nth item of the post's media order, not a new slot
  model; empty slides are positions without media yet.
- **Eligibility, server-side** (the editor's finalize only checks ownership, `handler.ts:45-46`):
  mirror `set_post_media` (`mcp/media.ts:33-40`; `EDITABLE_STATUSES` in `mcp/queries.ts`). Refuse
  `tipo` outside feed/carrossel and statuses outside `EDITABLE_STATUSES`; the `ai_generated_images`
  row must match `conta_id` and `user_id` and must not be attached already. Hiding the button on reels
  and stories is not the gate.
- Feed posts that already have an image: the card says "Substituir a imagem atual?" and the action
  removes the old item through the editor's normal delete path before appending. Reels and stories:
  "Gerar imagem" is not shown.
- After attaching, the staging row gets `attached_post_id`/`attached_at` and is kept (not expired).
  `attached_post_id` is `REFERENCES workflow_posts(id) ON DELETE CASCADE`. The `files` row then also
  references the object. Removing the image from the post later uses the editor's normal unlink
  (`post-media-manage` DELETE), which leaves the file in Arquivos, the editor's usual semantics.
- "Gerar imagens antes" in the create-post card: images are generated and staged first (a
  `gerar_imagem` confirm), then one **compound** pending action "Criar rascunho com imagens" stores
  both steps (`create_post` args + the staged image ids) and runs them in order on one confirm.
- **Editor popover** uses a dedicated route `POST /gerar-imagem {post_id, lamina, prompt, aspect, n,
  use_brand}` on `assistente-ia`: no model loop, same flag, membership and rate limits. The "Gerar"
  click is the user's consent to spend; "Usar a opção N" then calls `POST /anexar-imagem` with the
  staged id, which runs the same server-side checks as `anexar_imagem`. There is never a client flag
  that auto-approves a pending action.
- Memory: 4 images at 2K stay well under the 256 MB isolate ceiling; never decode or re-encode in the isolate.

### 6.5 Conversation state (my call)

Kept in the panel's React state, mirrored to `sessionStorage` per tab (try/catch) so a reload keeps
it. "Nova conversa" clears it. Server persistence is a follow-up. While a step is in flight or a
confirm card is pending, the panel calls `useUnsavedWork(true)` so a silent deploy update does not
drop it (never `useBlocker`).

## 7. Tools (in-process MCP tool layer)

Reuse `supabase/functions/mcp/` tools in-process, the way the tests already do with a fake server
(`{ tool: (name, _d, shape, cb) => map.set(name, {shape, run: cb}) }`). The assistant function must do
the three things the MCP transport normally does:
1. **Context**: synthesize `McpKeyContext` `{conta_id, created_by: user.id, key_id: 'assistente:<user_id>',
   role, can_write_financials: false, scopes}` with
   `scopes = permittedMcpScopes(db, user.id, conta_id, ASSISTANT_SCOPES)` (its 4th argument is the
   scope filter, `_shared/mcp-oauth.ts:125-130`). Audit rows then read
   `mcp.<tool>` with `metadata.key_id = 'assistente:…'`, which tells them apart from MCP keys.
2. **Validation**: `z.object(shape).strict().parse(args)` before `run`.
3. **Rate limit**: §6.1.

`ASSISTANT_SCOPES = posts:read, posts:write, workflows:read, clientes:read, ideias:read, tarefas:read, tarefas:write`.

| Reads (run without asking) | Writes (confirm card) |
|---|---|
| `list_clients`, `get_client`, `get_brand_profile`, `list_pages`, `get_performance_baseline`, `list_posts`, `get_post`, `list_post_feedback`, `list_ideas`, `list_workflows`, `list_tasks` | `create_post`, `update_post`, `set_post_property`, `create_task`, `update_task`, plus two assistant-only tools: `gerar_imagem` and `anexar_imagem` (§6.4) |

Excluded in v1: every `financeiro:*` tool, `membros:*` (incl. `create_member`), `create_client`,
`create_workflow`, `create_workflow_template`, `list_workflow_templates`, and `create_media_upload` /
`set_post_media` (replacement semantics, §6.4).

**Area entitlements.** `feature_assistente_ia` grants no access to areas the plan lacks. MCP tools
check scope and role but not every area flag (e.g. `list_ideas` ignores `feature_ideas`). So the
assistant wrapper keeps a `TOOL_FEATURES` map checked with `effectivePlanFeature` before each tool
runs, and hides gated tools from the model's tool list: `list_ideas` → `feature_ideas`;
`get_performance_baseline` → `feature_analytics_reports` (how the CRM gates `/analytics`,
`ProtectedRoute.tsx:15-17`); `set_post_property` → `feature_custom_properties`.
The builder confirms each mapping against how the CRM gates the same area, and adds any tool whose
CRM screen is behind a flag.

Scheduling and publishing are already impossible through these tools: `create_post` always creates a
draft and `update_post` only accepts `status` in `rascunho | revisao_interna`. The assistant wrapper
still rejects any args outside the allowlisted shapes (strict parse), so a future widening of an MCP
tool does not silently widen the assistant.

The confirm card preview (`pending.preview`) is built server-side per tool (client name, post type,
slide count, "Sem data. Não agenda nem publica.") and rendered as React text, never HTML.

## 8. CRM UI (per the mockups)

- **Settings tab** `configuracao/ia` in `configTabs.ts` (group `avancado`, next to `mcp`, permission
  `all`; manage controls disabled without `configuracoes:editar`), gated by the fail-closed flag at
  **both** levels: the nav (the registry only models permissions, so add an optional
  `feature?: keyof FeatureFlags` to `ConfigTab` that the strip and its direct-URL guard both read,
  fail-closed `=== true`) and the route element in `App.tsx`, so `/configuracao/ia` and
  `/configuracao/ia/openrouter` render the not-found/upsell state when the flag is off.
  Sections: Conexões (OpenRouter, Anthropic, OpenAI, Gemini, "Entrar com o ChatGPT" disabled with
  "Em breve"), Modelos padrão, Quem usa e quanto (team switch, monthly alert, month estimate), and the
  "Use o Mesaas dentro do Claude ou do ChatGPT" card linking to the existing `configuracao/mcp`
  page. Phone variant under `configuracao/phone/`.
- **Personal connections**: a "Minhas conexões de IA" block in `configuracao/perfil`.
- **Panel**: mounted once in `AppLayout.tsx` global mounts; toggle button "Assistente ⌘J" in
  `TopBarActions.tsx`. Desktop: right-side panel (about 420 to 460 px). Below 768 px: full-screen
  sheet (artboard "Celular"). Model picker in the composer (connected providers × a short curated model
  list per provider in `apps/crm/src/lib/ai-models.ts`, plus "Outro modelo" free text for OpenRouter ids).
  Check ⌘J against existing shortcuts.
- **Inline actions**:
  - `InstagramCaptionField` / `DestinationCaptionField`: "Gerar legenda", "Encurtar",
    "Mais próximo do tom da marca". The suggestion lands highlighted with "Aceitar" / "Desfazer";
    nothing is saved until accepted and the normal save runs.
  - `PostMediaGallery`: "Gerar imagem" opens the image popover (prompt, aspect, brand toggle,
    4 options, cost line, "Usar a opção N").
  - Ideia detail: "Desenvolver com o assistente" opens the panel with `ideia_id` context.
  - Each inline action is one short `/step` sequence with a fixed instruction and only the read tools
    it needs; it never writes on its own.
- Model text: render with the repo's existing safe markdown path with raw HTML disabled, links through
  `sanitizeUrl()`; if none fits, plain text with line breaks. Builder's call within that rule.
- All copy pt-BR, sentence case, no em dashes; strings in `packages/i18n/locales/{pt,en}/`.
- Icons: lucide-react (Sparkles for the assistant). Phosphor only inside existing nav chrome.

## 9. Usage and the monthly alert

- Every model call and image appends `ai_usage_log`. Settings shows "Gasto estimado em <mês>: US$ X ·
  N gerações", labelled as an estimate.
- One SECURITY DEFINER RPC `ai_usage_record(...)` (EXECUTE granted to `service_role` only) inserts the
  log row, sums the month, and when the sum crosses `monthly_alert_usd` does
  `INSERT INTO ai_usage_alerts (conta_id, month) VALUES (...) ON CONFLICT DO NOTHING RETURNING`; only
  the caller that got a row back inserts the notifications for owners/admins (from
  `workspace_members`) in the existing Central de Notificações, inside the same transaction.
  Concurrent calls cannot double-notify.
- `notifications.type` has a CHECK constraint (`20260430000001_notifications.sql:25-29`; recreate it
  from its latest definition in the migrations) and its columns are `workspace_id`, `user_id`, `type`,
  `metadata`, `link`. The migration adds `ai_usage_alert` to the CHECK, the RPC writes those columns
  (`metadata = {month, threshold_usd, estimated_usd}`, `link = '/configuracao/ia'`), and the CRM
  notification center gets a render entry for the type. Without the CHECK change the insert raises
  and rolls back the usage log on every later call.
  (`alert_notified_month` in `ai_workspace_settings` is dropped in favour of this table.)
  No blocking; the hard cap belongs on the provider side (OpenRouter key limit).
  Copy: "O gasto estimado com IA passou de US$ 30 neste mês."

## 10. Security checklist

- Keys: encrypted at rest, decrypted only inside `assistente-ia`/`ai-connections` for the outgoing
  call, never returned, never logged; logs and audit carry provider + model only.
- CORS via `buildCorsHeaders(req)`; generic error messages out, details in logs.
- Every query scoped by `conta_id`; membership checked before anything.
- Strict zod on all inputs, including confirmed args.
- No HTML from the model; URLs sanitized.
- New tables revoked from `anon`/`authenticated` and granted to `service_role`; an entitlement SQL
  test asserts the ACL (`supabase/tests/entitlements/`).
- Writes are single-use server-side (`ai_pending_actions`); the step cap is server-side (`ai_turns`).

## 11. Tests

- Deno: Anthropic token-prefix rejection; verify-call error not leaked; scope intersection (an agent
  role never gains a scope); a write tool never runs without an approved, claimed pending action; a
  replayed or expired confirm runs nothing; the step counter refuses step 9 whatever the client
  sends; strict parse refuses extra args; area-flag-off hides and refuses the mapped tool; flag off →
  403 on both functions; personal-then-workspace connection lookup; non-PNG/JPEG or >8 MB image
  discarded; orphan scan treats `ai_generated_images.r2_key` as live; a tool call present only in the
  client's `conversation` never runs; a failed write leaves the action `falhou`, not consumed with no
  result; several tool calls in one response yield one pending action and a result for every call id;
  `anexar_imagem` refuses reels/stories, non-editable statuses, another user's or an attached staging
  row; image URLs only via `fetchImageSafely` (private IP refused); Gemini key never in a URL.
- SQL: two concurrent `ai_usage_record` calls crossing the threshold create one alert and one set
  of notifications.
- Vitest: panel states (empty, member without permission, steps, confirm, error), caption
  accept/undo, fail-closed flag hides the tab, panel and inline buttons.
- SQL: ACL on every new table (no `anon`/`authenticated` privileges, `service_role` ALL).

## 12. Deploy order

1. Migration (tables + `plans.feature_assistente_ia` default false). It must land before step 2:
   `platform-admin` spreads `FEATURE_COLUMNS` into plan writes, so without the column every Admin plan
   save returns 400.
2. Redeploy the eight `_shared/entitlements.ts` importers: `workspace-limits`, `platform-admin`,
   `paywall-report`, `automation-media`, `data-import`, `equipe-chat-media`, `mcp-keys`,
   `mcp-oauth-consent`.
3. Deploy `post-media-cleanup-cron` with the `ai_generated_images` ref (§6.4), then
   `ai-connections` and `assistente-ia` (both `--no-verify-jwt`, §5). The cron must go first, or
   staged previews older than 24 h get reaped.
4. Merge (Vercel deploys the CRM and Admin).
5. Turn on the override for the founder's workspace and test end to end on prod.
6. Later: the launch migration for `start/pro/max/lifetime`, only after step 2's `workspace-limits`
   redeploy is live (otherwise the CRM's fail-closed gate keeps the feature hidden while the server
   already accepts requests).

Rollback: frontend first, then functions. Tables can stay.

## 13. Out of this spec

- **Route B, MCP Apps widgets** (carousel preview + "Criar rascunho no Mesaas" inside Claude/ChatGPT):
  separate spec. First check whether `@modelcontextprotocol/sdk@1.25.3` (pinned in `mcp/index.ts`)
  supports the MCP Apps `ui://` resource extension or needs an upgrade or extension package.
- "Entrar com o ChatGPT": the founder applies via OpenAI's interest form; integration is a follow-up
  once accepted.
- SSE streaming, server-side conversation history, a Hub assistant, Financeiro and Equipe tools.

## 14. Calls I made (check these)

- "Behind a flag for now" = dark everywhere, launch migration later (§3).
- Client-driven step loop, no streaming in v1 (§6.1).
- Vercel AI SDK v5 as provider layer, with a staging bundling check first (§6.2).
- Conversations in the tab only (§6.5).
- Tool allowlist and exclusions (§7).
- Personal connection wins over the workspace one (§5).
- Alert is a notification, not a block (§9).
- "Usar a opção N" appends and reorders, never replaces; feed posts ask before replacing (§6.4).
- The mockup's "Criado pelo assistente · revisado por você" line is dropped from v1: no origin field
  on posts. The audit trail (`metadata.key_id = 'assistente:…'`) keeps the record if it is wanted later.
