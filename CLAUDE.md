# Mesaas CRM

Social media agency CRM (React + Supabase). Three apps: **CRM** (internal dashboard), **Hub** (client-facing portal), and **Admin** (platform admin). Portuguese-language UI.

## Workflow skills (superpowers)

Reserve the superpowers workflow skills (`brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`, TDD) for **substantial work**: new features or subsystems, multi-file refactors, backend/schema changes, anything touching auth, billing, or migrations, and anything the user frames as an initiative or asks to plan.

Do NOT run them for small, well-understood changes — UI tweaks, copy changes, styling, single-component behavior adjustments, small bug fixes. Just make the change, typecheck, and verify it in the browser. If a "small" change turns out to be bigger than expected, stop and escalate to brainstorming/planning then.

`systematic-debugging` is still fair game any time a bug's cause isn't obvious, regardless of size.

## Commands

```bash
# Development (default = PROD via .env; :staging overlays .env.staging)
npm run dev              # CRM app on :5173      (prod)
npm run dev:env          # same, but loads VITE_* from the main checkout's .env (git worktrees have none)
npm run dev:all:env      # CRM + Hub + Admin (prod), same .env fallback for worktrees
npm run dev:hub          # Hub app on :5175      (prod)
npm run dev:admin        # Admin app on :5177    (prod)
npm run dev:staging      # CRM   against staging Supabase
npm run dev:hub:staging  # Hub   against staging Supabase
npm run dev:admin:staging# Admin against staging Supabase
npm run dev:all          # CRM + Hub + Admin together (prod)    via concurrently
npm run dev:all:staging  # CRM + Hub + Admin together (staging) via concurrently

# Build (always typecheck first)
npm run build            # tsc + vite build for CRM
npm run build:hub        # tsc + vite build for Hub

# Tests
npm run test             # Vitest frontend/unit suite
npm run test:watch       # Vitest in watch mode
npm run test:coverage    # Vitest with V8 coverage
deno test supabase/functions/    # Deno edge-function suite
npm run check:functions  # deno check over the edge functions (test:functions runs --no-check)

# Lint & format (both enforced in CI)
npm run lint             # eslint apps/ packages/ (runs in the lint-and-typecheck job)
npm run format           # prettier --write  (auto-fix apps/** and packages/**)
npm run format:check     # prettier --check  (format-check job gate; run before pushing)

# Supabase
npx supabase functions serve                    # local edge functions
npx supabase functions deploy <name>
npx supabase db push --linked                   # push migrations to staging
```

### What CI actually runs

`.github/workflows/ci.yml` is the source of truth. It fires on pull requests and
pushes to `main` and `staging`, with **ten** jobs:

| Job | Runs |
|---|---|
| `lint-and-typecheck` | `npm run lint`, then `tsc` for **all five** projects (crm, hub, admin, `apps/mcp-widgets`, `tsconfig.scripts.json`), then rebuilds the MCP cards bundle (`npm run build:mcp-widgets`) and fails on `git diff --exit-code supabase/functions/mcp/ui/generated/cards-v1.ts` |
| `unit-tests` (4 shards) | `vitest run --shard=N/4 --coverage --reporter=blob`; each shard uploads its blob |
| `edge-function-tests` | `npm run check:functions` (`deno check` over every `*/index.ts` and `_shared` module), then `npm run test:functions` (Deno) |
| `entitlement-tests` | `supabase start` + `bash scripts/test-entitlements.sh` — the psql RLS/entitlement suites |
| `coverage-threshold` | merges the 4 shard blobs (`vitest --merge-reports`, re-reports any failure) and applies the `vitest.coverage.config.ts` floor, same gate as `npm run coverage:check` |
| `format-check` | `npm run format:check` |
| `migration-version-guard` | fails on duplicate migration version prefixes |
| `e2e` | Playwright |
| `e2e-secrets-guard` | warns when E2E secrets are absent |
| `landing-prerender-smoke` | `vite build` + `npm run prerender` with placeholder `VITE_*`, then asserts `dist/index.html` has `data-ssr="landing"` and `lp2-hero` |

Four things this list is here to prevent:

- **`npm run build` is not the typecheck.** It only covers the CRM. CI
  typechecks five projects separately, so a Hub, Admin, mcp-widgets or scripts break passes
  locally and fails in CI. Run the five `tsc` commands, not `build`. Anything under
  `apps/mcp-widgets/` also needs `npm run build:mcp-widgets` and the regenerated
  `cards-v1.ts` committed, or the diff check fails.
- **`supabase/tests/entitlements/*.sql` IS gated by CI.** It is easy to assume
  otherwise because it needs a local database to run by hand. It does not need
  one to be enforced.
- **A green `e2e` does not always mean e2e ran.** Without the E2E secrets the
  job skips silently, which is exactly why `e2e-secrets-guard` exists: it emits
  a warning naming the missing secrets. Check that warning before trusting a
  green e2e.
- **`test:functions` does not type-check.** It runs `deno test --no-check`, so a
  reference to an out-of-scope variable in an edge function passes the test
  suite. `check:functions` is the only type gate for `supabase/functions/`; it
  runs first in the same job.

Before pushing, run `npm run lint`, `npm run format:check` (`npm run format`
auto-fixes), the five `tsc` commands, `npm run test`, `npm run check:functions`
and `npm run test:functions`.
`npm run test:db` needs Docker locally; CI covers it either way.

Migration filenames must use a unique timestamp version prefix (the digits before the first `_`). Two files sharing a prefix collide in Supabase's `schema_migrations` history table — only the first applies and the second is silently skipped. The `migration-version-guard` CI job fails the build on duplicates.

## Architecture

Monorepo with npm workspaces:

- `apps/crm/` -- Internal CRM dashboard (React 19, React Router v7, TanStack Query)
- `apps/hub/` -- Client-facing portal (React 19, createBrowserRouter)
- `packages/ui/` -- Shared UI primitives
- `apps/mcp-widgets/` -- Cards do MCP (React + Vite, build em arquivo único); `npm run build:mcp-widgets` gera `supabase/functions/mcp/ui/generated/cards-v1.ts`, que se commita e nunca se edita à mão
- `supabase/functions/` -- Deno edge functions (backend)
- `supabase/migrations/` -- SQL migrations

### CRM app structure (`apps/crm/src/`)

- `App.tsx` -- Routes (React Router v7, lazy-loaded pages)
- `main.tsx` -- Bootstrap: `createBrowserRouter` + `RouterProvider` (a data router). Swapping it back to `<BrowserRouter>` is a behaviour change -- data-router APIs like blockers and loaders depend on it
- `store.ts` -- Data layer: types + Supabase CRUD functions (NOT a state manager)
- `lib/supabase.ts` -- Supabase client singleton, auth helpers, profile cache
- `context/AuthContext.tsx` -- Auth provider with roles (owner | admin | agent)
- `router.ts` -- Legacy shim: `showToast()`, `escapeHTML()`, `sanitizeUrl()`
- `services/` -- API service modules (instagram.ts, analytics.ts, postMedia.ts)
- `components/ui/` -- shadcn/ui components (32 components, Radix + Tailwind)
- `pages/` -- Page components organized by route (one folder per page)
- `utils/security.ts` -- URL sanitization utility

### Hub app structure (`apps/hub/src/`)

- Route pattern: `/:workspace/hub/:token` (token-based auth, no login)
- `router.tsx` -- createBrowserRouter with HubShell wrapper
- Pages: Home, Aprovacoes, Postagens, Marca, Paginas, Briefing, Ideias

### Edge functions (`supabase/functions/`)

- Runtime: **Deno** (NOT Node.js). Imports use `npm:` specifier or relative `.ts` paths
- `_shared/cors.ts` -- `buildCorsHeaders(req)` for CORS (never use wildcard `*`)
- `_shared/audit.ts` -- `insertAuditLog()` for audit trail
- `_shared/r2.ts` -- Cloudflare R2 storage client (presigned URLs)
- `mcp/` -- MCP do workspace (chaves `mcp-keys` e OAuth `mcp-oauth-consent`). Escopos em `_shared/mcp-token.ts` (`MCP_ALLOWED_SCOPES`), espelhados no CRM (`apps/crm/src/lib/mcp-scopes.ts`). Os escopos `financeiro:*` são só do dono (`OWNER_ONLY_SCOPES`): a emissão recusa não-dono (`owner_only_scope`, papel de `workspace_members` do workspace da chave/grant) e a ferramenta confere o papel a cada chamada, então um dono rebaixado perde acesso na chamada seguinte. Mudar escopo = redeploy de `mcp`, `mcp-keys` e `mcp-oauth-consent` + CRM
  - Cards (MCP Apps, spec `docs/superpowers/specs/2026-10-29-mcp-apps-cards-design.md`, runbook `docs/mcp-apps-rollout.md`, listagens `docs/mcp-apps-directory-submission.md`): ligados por `MCP_APPS` (`off` padrão | `pilot` | `on`, ver Environment variables); desligado, o `mcp` não registra ferramenta de card nem recurso `ui://` e se comporta como antes. Ferramentas de card: `preview_post`, `show_caption_options`, `show_client_calendar`, `show_attach_image` (todas `client_id`, não `cliente_id`, e `structuredContent` com `card` e `v: 1`)
  - **O agente não envia sozinho.** `send_post_to_client` e `attach_image_to_post` são só do widget (`_meta.ui.visibility: ["app"]`), registradas apenas em conexão OAuth (`key_id` começa com `oauth:`; chave `mesaas_sk_` nunca as vê) e o envio exige o nonce HMAC que o card recebe em `_meta["mesaas/sendNonce"]` do resultado de `create_post`/`update_post` (só deles: `preview_post` não emite nonce, então o card só envia depois de salvar nele mesmo, a partir do status que esse save devolveu; 30 min, nunca no `audit_log`). O `UPDATE` de status e o anexo passam só pelas RPCs `mcp_send_post_to_client` e `mcp_attach_post_file` (EXECUTE só `service_role`, membership por `workspace_members`). Toda ferramenta nova do `mcp` precisa de entrada em `TOOL_META` (título e annotations; teste estrutural) e de `auditArgs` sem texto de post, legenda, nonce ou `download_url`
  - **Revogar conexão OAuth encerra também o lado do Supabase.** O trigger `trg_mcp_oauth_grant_revoked` (em `mcp_oauth_grants` e `admin_mcp_oauth_grants`, migration `20261107000001`) chama `mcp_revoke_oauth_client_access` quando `revoked_at` sai de nulo: revoga o `auth.oauth_consents` e apaga as `auth.sessions` daquele cliente, se não sobrar grant ativo dele em nenhuma das duas tabelas. Sem isso o Supabase reaprovava o consentimento velho e o cliente entrava em loop de 401. A `ConsentPage` chama `prepare-authorization` (`mcp-oauth-consent`) antes do `getAuthorizationDetails` pelo mesmo motivo; não inverta essa ordem
  - **URI versionada:** o recurso é `ui://mesaas/cards-v1.html` e hosts guardam o HTML em cache. Mudança que quebra o formato de um card (`structuredContent`, comportamento do botão) sai como `cards-v2.html`, nunca como edição do v1. Mudou o widget = `npm run build:mcp-widgets`, commit do `cards-v1.ts` e redeploy de `mcp`. Sem `_meta.ui.domain` de propósito (Claude e ChatGPT pedem valores incompatíveis); só `openai/widgetDomain`
- `mcp-admin/` -- MCP do Admin da plataforma (OAuth-only; `platform_admins` + `admin_mcp_oauth_grants`; banners, popups, artigos da KB em Markdown, leituras de workspaces/planos/dashboard, rascunhos do blog). Escopos em `_shared/mcp-admin-scopes.ts`, bundlados também em `mcp-oauth-consent` e espelhados no CRM (`apps/crm/src/lib/mcp-scopes.ts`) e no Admin (`apps/admin/src/lib/mcp-admin-scopes.ts`): mudar escopo = redeploy dos dois + CRM + Admin
- Cron functions authenticate via `x-cron-secret` header (not JWT)
- All other functions verify JWT via `Authorization: Bearer <token>` header

## Code style

- ES modules (`import/export`), never CommonJS
- Path alias: `@/` maps to `./src/` in both CRM and Hub apps
- UI components: shadcn/ui (Radix primitives + Tailwind + `class-variance-authority`)
- Add new shadcn components with `npx shadcn@latest add <component>` (configured in `components.json`)
- Icons: `lucide-react` exclusively
- Date handling: `date-fns` for formatting, `dayjs` for manipulation. Do NOT add moment.js
- Forms: `react-hook-form` + `zod` for validation
- Rich text: TipTap editor
- Toasts: `sonner` via `toast()` from `sonner` (NOT the legacy `showToast()` from router.ts for new code)
- Tailwind theme uses CSS variables (`hsl(var(--primary))` etc.) with dark mode via `[data-theme='dark']` class
- Fonts: SF Pro Text (body/mono) and SF Pro Display (headings) in CRM and Admin; Fraunces + Instrument Sans in Hub. DM Sans/Playfair references left in a few files are dead fallbacks

## Security rules -- NEVER violate these

- ALWAYS use `escapeHTML()` when interpolating user data into raw HTML strings
- ALWAYS use `sanitizeUrl()` for `href` attributes derived from external/user data
- NEVER use wildcard `*` for CORS. Use `buildCorsHeaders(req)` from `_shared/cors.ts`
- NEVER log or return raw error details to clients in edge functions. Return generic messages, log internally
- `TOKEN_ENCRYPTION_KEY` env var is REQUIRED with no fallback -- throw if missing
- Edge function crons MUST verify `x-cron-secret` header before executing
- Edge functions MUST verify workspace ownership (check `conta_id`) before returning data
- NEVER commit `.env`, `.env.local`, `.env.staging`, or credential files

## Environment variables

### CRM app (Vite, prefixed with `VITE_`)
- `VITE_SUPABASE_URL` -- Supabase project URL
- `VITE_SUPABASE_ANON_KEY` -- Supabase anon key

### Edge functions (Deno.env)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `TOKEN_ENCRYPTION_KEY` -- REQUIRED, no default
- `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI` -- Instagram/Meta OAuth
- `OAUTH_REDIRECT_BASE` -- Production URL for OAuth redirects (default: http://localhost:5173)
- `ALLOWED_ORIGINS` -- Comma-separated allowed CORS origins
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` -- Cloudflare R2
- `CRON_SECRET` -- Shared secret for cron function authentication
- `ORPHAN_SCAN_PAGES_PER_RUN` -- listing pages the post-media-cleanup-cron orphan scan
  consumes per prefix per run (default 10, ~1000 keys each). The scan is checkpointed in
  `cron_scan_state`, so this bounds ONE run's memory and wall clock, not how much of the
  bucket eventually gets swept -- a full sweep just spans several runs. It does NOT make
  the cron reap faster either: `MAX_TRASH_PER_RUN` caps removals at 50 per prefix per run
  regardless. Raise it only when `cron_scan_state.cycle_started_at` shows a sweep taking
  too long
- `STREAM_INGEST_BATCH` / `STREAM_SETTLE_BATCH` -- throughput dials for post-media-cleanup-cron's
  Stream ingest-catch-up / settle-pending sweeps (defaults 20 / 50, see stream-steps.ts). Lower
  these if Cloudflare Stream's shared per-account rate-limit budget keeps 429ing (logged as
  `stream-steps:ingest`/`stream-steps:settle`/`stream-steps:reap`); `_shared/stream.ts` already
  retries a lone 429 with backoff, so a 429 reaching these logs means the retry budget was
  exhausted under sustained throttling, not a one-off blip
- `STREAM_REAP_INTERVAL_HOURS` -- hours between the same cron's Stream orphan-reap runs (default
  6). Reap lists the WHOLE Cloudflare Stream account every time it runs -- as the video library
  grows this is the main driver of the account's Stream API request volume, so it's the lever to
  raise if 429s persist. Gated via `cron_scan_state` (scan_key `stream-reap`, migration
  20260913000001 -- reused as-is, `updated_at` alone is the "last successful reap" marker, no new
  migration needed); a missing/never-written row means reap has never run and it runs immediately
  regardless of this interval. `cron_scan_state.updated_at` for that key shows the last actual run.
  The reap's "known" set is `files` + `file_deletions` + `kb_videos` (Central de Ajuda
  tutorials, public playback). Rolling the cron back to a version that doesn't read
  `kb_videos` deletes every tutorial: set this interval to `876000` BEFORE such a deploy
- `SYNC_BATCH_LIMIT` / `SYNC_CONCURRENCY` / `BACKFILL_BATCH_LIMIT` -- throughput dials
  for instagram-sync-cron (defaults 25 / 5 / 3). These, not the customer count, set the
  platform's Instagram capacity: the cron runs hourly, so it performs
  `24 * SYNC_BATCH_LIMIT` account-syncs per day, and the 6h per-account staleness window
  needs 4 of those per account -- **`6 * SYNC_BATCH_LIMIT` connected accounts** before
  metrics start aging past the window (150 at the default 25). Raise both dials together:
  the run is `SYNC_BATCH_LIMIT / SYNC_CONCURRENCY` waves of ~4-8s, so 100/5 is a ~160s
  run while 100/10 keeps it near 40-80s for the same 4x capacity. Batch size is safe to
  raise on the failure side -- the per-account callback swallows its own errors, so
  `runPool`'s abort-on-first-error path is unreachable, and `last_sync_attempt_at` is
  stamped for the whole batch BEFORE any work, so a dead account can never re-claim the
  queue head. Both are plain edge-function secrets: changing them needs no deploy
- `GEOAPIFY_API_KEY` -- Geoapify key for address suggestions in the Agenda "Local" field
  (geo-autocomplete, which proxies Geoapify's autocomplete so the key never reaches the
  browser). Optional, no default: unset, the function answers 503, the CRM pauses its calls
  for 10 minutes and the field stays plain text. Free plan = 3000 requests/day and requires
  the "Powered by Geoapify" / OpenStreetMap credit the suggestion list shows. Limits: 60/min
  per user (`geo-autocomplete:<user>`) and a platform-wide hourly cap
- `GEOAPIFY_HOURLY_CAP` -- platform-wide geo-autocomplete calls per hour (default 120, i.e.
  at most 2880/day, under the free plan's 3000). Hourly because `rate_limit_log` is pruned
  every hour (`rate-limit-cleanup`), so a daily window would never count past one hour.
  Raise it together with the Geoapify plan; changing it needs no deploy
- `MCP_APPS` -- liga os cards do MCP (`mcp`): `off` (padrão, vale também para qualquer valor desconhecido) |
  `pilot` (só os `conta_id` de `MCP_APPS_PILOT_CONTAS`) | `on` (todos). Lida a cada requisição, então mudar não
  precisa de deploy; desligar é o rollback instantâneo. Passo a passo e verificações do piloto em
  `docs/mcp-apps-rollout.md`
- `MCP_APPS_PILOT_CONTAS` -- `conta_id`s separados por vírgula, lidos só com `MCP_APPS=pilot`. Opcional, sem default
- `MCP_IMAGE_HOSTS` -- hostnames (separados por vírgula, igualdade exata) de onde o `attach_image_to_post` aceita
  baixar a imagem do chat. Opcional, sem default: **vazio recusa toda imagem**, então o card de anexar não funciona
  até o piloto preencher (o host sai do log `[mcp] image host refused: <host>`). Sem deploy ao mudar
- `GEMINI_API_KEY` -- Google Gemini key for AI narrative generation in analytics reports (instagram-analytics, instagram-report-generator-v2). Optional, no default -- AI narrative is skipped when unset
- `GSC_SERVICE_ACCOUNT_JSON` -- chave JSON (uma linha) da conta de serviço do Google com acesso
  **Restrito** à propriedade do Search Console; lida só pelo `blog-search-console-cron`
  (cliques, impressões, posição e indexação por post, para o Admin do blog). Opcional, sem
  default: ausente (staging, local), o cron responde 200 `skipped: not_configured` sem tocar em
  nada e o Admin mostra "Search Console não configurado". Nunca na linha de comando: use
  `--env-file` com arquivo temporário. Passo a passo: `docs/search-console-service-account.md`;
  spec `docs/superpowers/specs/2026-10-27-blog-metrics-design.md`
- `GSC_SITE_URL` -- propriedade do Search Console consultada pelo mesmo cron (padrão
  `sc-domain:mesaas.com.br`). Só defina se o site estiver registrado de outra forma (prefixo de
  URL). Secret comum: mudar não precisa de deploy
- `REPORT_PRINT_BASE` -- origem pública que serve a página de print do relatório
  de blocos (ex.: https://mesaas.com.br). Usada por report-docs POST /:id/pdf
  para montar a URL que o Gotenberg imprime. Opcional: sem ela (ou sem
  GOTENBERG_URL / INTERNAL_FUNCTION_SECRET) o export responde 503
  pdf_not_configured; as demais rotas seguem normais
- `VERCEL_BLOG_DEPLOY_HOOK` -- URL do Deploy Hook da Vercel (branch `main`, produção) que o
  `platform-admin` dispara ao aprovar, editar ou despublicar um post do blog: o build seguinte
  roda `blog:sync` e põe o post no ar. Só prod recebe. Opcional, sem default: ausente (staging,
  local), aprovar responde 503 `publish_unavailable` e o Admin mostra "Publicação indisponível
  neste ambiente"; o resto do fluxo do blog segue normal. Spec:
  `docs/superpowers/specs/2026-10-23-blog-automatico-design.md`
- `STRIPE_SECRET_KEY` -- Stripe API secret key. REQUIRED by billing functions, no default -- throw if missing. Also used (optionally) by billing-downgrade-cron for the switch's leg D enforcement; absent, that leg is skipped with `switchSkipped: true`
- `STRIPE_WEBHOOK_SECRET` -- Stripe webhook signing secret. REQUIRED by stripe-webhook, no default -- throw if missing
- `AFFILIATE_MIN_PAYOUT_CENTS` -- repasse mínimo do programa de afiliados, em centavos
  (padrão 5000 = R$ 50; valores inválidos ou abaixo de 100 caem no padrão). Lido pelo
  `affiliate-payout-cron` (saldo abaixo disso acumula para o mês seguinte) e pelo
  `affiliate-public` (só para exibir no painel). Mudar não precisa de deploy
- `PAGARME_SECRET_KEY` -- Pagar.me v5 API secret for 12x installment billing (pagarme-client). No default; shared client throws on first call when missing
- `PAGARME_WEBHOOK_TOKEN` -- secret path segment of the Pagar.me webhook URL
  (`/pagarme-webhook/{token}`). REQUIRED by pagarme-webhook, no default -- throws at module load
- `PAGARME_WEBHOOK_BASIC` -- `user:password` pair configured in the Pagar.me dashboard webhook
  "Habilitar autenticação" toggle, verified timing-safe on every delivery. REQUIRED by
  pagarme-webhook, no default -- throws at module load
- `PAGARME_DASHBOARD_BASE` -- Pagar.me dashboard prefix up to the account, e.g.
  `https://dash.pagar.me/merch_xxx/acc_yyy`. platform-admin appends
  `/subscriptions/{id}/info` to build the "Abrir no Pagar.me" link on the workspace
  detail. Optional, no default: unset or not `https://` means no link (everything else
  still works). Differs per environment (live account in prod, sandbox account in staging)
- `PAGARME_RECIPIENT_ID` -- id do recebedor (`rp_…` em contratos antigos, `re_…` nos novos) da conta Pagar.me, usado por
  platform-admin `get-deposits` para ler saldo, recebíveis (`/payables`) e transferências
  do painel de Depósitos do Admin. Opcional, sem default: ausente, o cartão Pagar.me da
  página Métricas mostra "Não configurado" e o resto da página segue normal. Diferente
  por ambiente (recebedor live em prod, sandbox em staging). O cartão Stripe do mesmo
  painel usa `STRIPE_SECRET_KEY` (Balance, Payouts, Balance Transactions, Account)
- `METRICS_BACKFILL_ALLOWED` -- `true` libera a ação `backfill-metrics` do platform-admin
  (reconstrução do histórico de MRR/churn da página Métricas a partir da Stripe e do Pagar.me).
  Só prod recebe: prod e staging compartilham a conta Stripe, e o handler responde 403 sem
  nenhuma chamada remota quando a secret não é exatamente `true`. O snapshot diário é do
  `metrics-snapshot-cron` (pg_cron `44 2 * * *` UTC = 23:44 em São Paulo), que não depende dela.
- `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI` -- TikTok Login Kit OAuth (tiktok-integration)
- `TIKTOK_APP_AUDITED` -- unset until TikTok's Content Posting audit passes; while unset, scheduling enforces SELF_ONLY privacy
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` -- Google OAuth client for the YouTube + Google Meu Negócio connect flow (google-integration). Both REQUIRED, no default -- throw if missing. Two Cloud projects: prod and staging use different OAuth clients
- `GOOGLE_REDIRECT_URI` -- optional; falls back to `${SUPABASE_URL}/functions/v1/google-integration/callback`. The same string must go in the auth request and the code exchange, and be registered in that Cloud project's OAuth client
- `TIKTOK_URL_VERIFY_FILENAME`, `TIKTOK_URL_VERIFY_CONTENT` -- TikTok URL-prefix verification file (optional; 404 until set)
- `LOOPS_API_KEY` -- Loops REST API key for marketing lifecycle emails. REQUIRED by
  loops-sync-cron, no default -- `_shared/loops.ts` throws if missing
- `CRISP_WEBSITE_ID`, `CRISP_IDENTIFIER`, `CRISP_KEY` -- Crisp API token for the
  support-chat customer sync (crisp-sync-cron). All three REQUIRED by that function,
  no defaults -- index.ts throws at module load if any is missing. Default path is a
  **Website Token** (Crisp app > Settings > Workspace Settings > Advanced Configuration >
  API Token): no Marketplace review, no scopes, 10k req/day
- `CRISP_TIER` -- token family sent as the `X-Crisp-Tier` header. Optional, defaults to
  `website`. Set to `plugin` ONLY for a Marketplace plugin token (multi-workspace,
  configurable quota, scopes `website:people:profiles` + `website:people:data`, 5k/day
  base). Crisp rejects a token presented under the wrong tier
- `CRISP_IDENTITY_SECRET` -- HMAC secret for Crisp chatbox identity verification
  (crisp-identity). REQUIRED, no default -- throws at module load if missing. Must match
  the secret configured in the Crisp dashboard under Settings > Identity Verification
- `POSTHOG_PROJECT_KEY` -- PostHog **project write key** (same value as the frontend's
  `VITE_POSTHOG_KEY`, NOT a personal API key). Optional: server-side capture is a
  silent no-op when unset
- `WHATSAPP_SUPPORT_NUMBER` -- WhatsApp support number for the welcome-email CTA.
  Digits only, no `+` or punctuation. Optional: the CTA is omitted when unset or
  malformed. Must be kept in sync by hand with the CRM's
  `VITE_WHATSAPP_SUPPORT_NUMBER`; nothing verifies the two agree. The CRM
  counterpart is inlined at Vite build time and needs a redeploy to pick up a
  change; this Deno-side one only needs the function itself redeployed
- `META_WEBHOOK_VERIFY_TOKEN` -- Meta webhook verify token for the Instagram
  comment-to-DM automation (instagram-webhook). REQUIRED, no default -- throws
  at module load if missing
- `TRANSCRIBE_WORKER_URL`, `TRANSCRIBE_SECRET` -- Cloudflare Worker `workers/transcribe`
  (Workers AI, Whisper turbo) that transcribes Hub briefing audio answers. Both
  optional, no default: when unset, hub-briefing still stores the audio and marks
  the transcription `failed` (the client sees "Tentar novamente"). The secret must
  match the one set on the worker with `wrangler secret put TRANSCRIBE_SECRET`.
  Also read by `hub-ideias` and `ideia-media-manage` for ideia audio; the worker's
  key allowlist covers `briefing-audio/` and `ideia-audio/`
- `IG_AUTOMATION_SCOPES_LIVE` -- optional, default off (unset/`false`). While off, the
  Instagram OAuth URL only requests the approved trio of base scopes; flipping it to
  `true` adds the optional `instagram_business_manage_comments` AND
  `instagram_business_manage_messages` scopes to the request (Meta's private-replies
  doc lists only the former, but the POST /messages endpoint 403s without the latter --
  proven empirically on staging 2026-08-15). Turn on only after Meta's Advanced Access
  for BOTH scopes is approved, or in staging to test with an account that has a role
  on the app
- `STREAM_ACCOUNT_ID`, `STREAM_API_TOKEN` -- Cloudflare Stream account + API
  token, used by `_shared/stream.ts` to copy videos in, list, and delete them
- `STREAM_CUSTOMER_CODE`, `STREAM_SIGNING_KEY_ID`, `STREAM_SIGNING_KEY_JWK`,
  `STREAM_WEBHOOK_SECRET` -- signed HLS playback (JWT signing) + webhook
  verification for Cloudflare Stream
- All six are optional with no default. `STREAM_ACCOUNT_ID` + `STREAM_API_TOKEN`
  alone gate cleanup (`isStreamCleanupEnabled()` -- list/delete, the
  post-media-cleanup-cron orphan reap and queued-deletion drain); all six
  together additionally gate ingest + signed playback (`isStreamEnabled()`).
  Unsetting only the other four (`STREAM_CUSTOMER_CODE`, `STREAM_SIGNING_KEY_ID`,
  `STREAM_SIGNING_KEY_JWK`, `STREAM_WEBHOOK_SECRET`) is the kill switch --
  ingest and playback stop while cleanup keeps draining queued deletions.
  Losing `STREAM_ACCOUNT_ID` or `STREAM_API_TOKEN` is what disables the whole
  feature, cleanup included. Central de Ajuda tutorial videos (`kb_videos`) are gated only on
  `isStreamCleanupEnabled()` because their playback is public/unsigned, so the four-var kill
  switch above does NOT stop tutorial uploads; without `STREAM_WEBHOOK_SECRET` the webhook
  401s every delivery, so tutorial uploads only settle via the Admin editor's
  `refresh-kb-video` poll

## Gotchas

- Client detail route is `/clientes/:id` (plural). OAuth redirects MUST use `/clientes/` not `/cliente/`
- `store.ts` exports plain async functions, not hooks. Wrap with `useQuery`/`useMutation` from TanStack Query in components
- `clientId` from URL params: use `parseInt(param, 10)` with `isNaN()` guard, never bare `Number()`
- Page param validation: `Math.max(1, parseInt(pageStr) || 1)`
- localStorage iteration: collect keys first, then remove. Modifying during iteration skips items
- Roles are `owner | admin | agent` -- always check via `AuthContext`, never hardcode
- Supabase edge function deploy always needs `--no-verify-jwt` flag for functions that handle their own auth (OAuth callbacks, cron, hub). `hub-briefing`, `hub-agenda`, `hub-post-references`, `hub-media-notes` and `hub-linha-editorial` (token do hub), `agenda-convite` (token do convidado externo), `agenda-cliente-email` (cron, `x-cron-secret`), `briefing-audio`, `geo-autocomplete` and `post-references` (verify the user JWT themselves) need it too, and so do `affiliate-public` (programa de afiliados, link mágico por e-mail trocado por sessão) and `affiliate-payout-cron` (cron, `x-cron-secret`), `blog-view` (contador de views do blog, público e anônimo) and `blog-search-console-cron` (cron, `x-cron-secret`), `tiktok-analytics` (verifies the user JWT itself), and `google-integration` (OAuth callback plus routes that verify the user JWT themselves)
- Hub app uses token-based access (no Supabase auth), builds to `dist/hub/` with base path `/hub/`
- Vercel rewrites in `vercel.json` route Hub URLs to `/hub/index.html` and CRM URLs to `/index.html`
- `membros` and `clientes` use column-level `GRANT SELECT` allowlists (Migration `20260728000002`). Any column added to either table is invisible to the CRM until it is added to the grant, to `membros_v`/`clientes_v`, and to the `*_SAFE_COLUMNS` constants in `store/team.ts` / `store/clients.ts`. The failure surfaces as a confusing missing-column error. The same allowlist also keeps six PostgREST embeds, ten dependent RLS policies and `get_client_health_aggregates()` working -- none of which a `from('clientes')` grep finds.
- Deploys trocam de versão em silêncio (`installSilentUpdate` em `packages/app-lifecycle`). Todo editor fora de modal com conteúdo não persistido ou save em voo chama `useUnsavedWork(condição)`, e toda função de upload envolve a promise em `trackUnsavedWork`. Modais com `confirmClose` já estão cobertos pelo `DialogContent`. A heurística de DOM só segura diálogo aberto, campo focado e controle de formulário que o usuário alterou nesta sessão; um save silencioso em voo só o registro vê. Nunca use `useBlocker` nos apps: o React Router honra só o último blocker registrado e `installSilentUpdate` já registra um, então um segundo desliga a troca silenciosa sem aviso. Spec: `docs/superpowers/specs/2026-09-05-seamless-updates-design.md`

- Google (YouTube + Google Meu Negócio, spec `docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md`): um workspace tem UMA identidade Google em `google_connections`, compartilhada pelos dois produtos. Nunca apague uma linha de `google_connections` fora da RPC de revogação: é ela que aplica a regra de revogação do §4.2 (só revoga no Google quando nenhum produto ainda usa a identidade) e grava `google_revocations`; um delete direto deixa o refresh token vivo no Google e perde o controle dos prazos de exclusão que a política de privacidade promete (YouTube 7 dias, GMN 30 dias). Prod e staging usam projetos Google Cloud separados (clientes OAuth, tela de consentimento e verificação próprios): `GOOGLE_REDIRECT_URI` tem que bater com o registrado no projeto com o qual você está falando. Ordem de deploy: migrations `20261108000001`..`20261108000003` → `google-integration` (com `--no-verify-jwt`) + os oito importadores de `_shared/entitlements.ts` (`automation-media`, `data-import`, `equipe-chat-media`, `mcp-keys`, `mcp-oauth-consent`, `paywall-report`, `platform-admin`, `workspace-limits`) → merge. Redeployar `platform-admin` antes da migration `20261108000001` faz todo save de plano no Admin dar 400. A política de privacidade e os termos (páginas públicas, que as flags de plano não alcançam) só citam YouTube e Google Meu Negócio quando `GOOGLE_LEGAL_TEXT_LIVE` (`apps/crm/src/lib/googleLegalLaunch.ts`) é `true`; fica `false` até a Fase 2 entregar as exclusões que o texto promete. Ligue antes de pedir a verificação do Google e antes de tirar as flags do workspace piloto

- Programa de afiliados (spec `docs/superpowers/specs/2026-10-10-programa-de-afiliados-design.md`): só pagamentos Stripe geram comissão, via `stripe-webhook`, com percentual e janela de meses por plano em `affiliate_commission_rules` (editável no Admin). O repasse é por Stripe Connect (conta Express do afiliado, transfer mensal do `affiliate-payout-cron`), então o Connect precisa estar ativado na conta Stripe. O endpoint do webhook no painel do Stripe precisa ter `invoice.paid`, `charge.refunded`, `charge.dispute.created` e `charge.dispute.closed` ativos, senão nenhuma comissão é registrada. A atribuição é o trigger `on_auth_user_created_zz_affiliate_referral`, que depende de rodar DEPOIS de `on_auth_user_created_workspace` (ordem alfabética): não renomeie nenhum dos dois sem conferir isso
- Financeiro v2 (flag `feature_financeiro_v2`, spec `docs/superpowers/specs/2026-10-23-financeiro-rentabilidade-design.md`): as tabelas `financeiro_*` só aceitam escrita pelas RPCs SECURITY DEFINER (`financeiro_*_salvar`, `financeiro_seed`, reabrir/fechar); nunca escreva nelas direto. As RPCs regravam as colunas legadas (`clientes.valor_mensal`/`data_pagamento`/`status`, `membros.custo_mensal`/`data_pagamento`) a partir da versão vigente no período `aberto`, e os triggers `trg_financeiro_v2_*_legado` fazem o caminho inverso: uma escrita legada (CSV, MCP, conversão de lead, telas antigas) vira versão no início do período aberto, com compare-and-skip como trava contra loop. `_financeiro_calcular` é a única função de rateio; `financeiro_rolar_periodos` (pg_cron `29 * * * *`) fecha períodos com snapshot e abre o próximo, e toda escrita v2 pega `pg_advisory_xact_lock_shared(_financeiro_lock_key(conta))` contra o lock exclusivo do job. Com a flag ligada, os formulários legados de cliente não gravam mensalidade, dia de pagamento nem status (isso vai pela aba Financeiro, que pede "Vale a partir de"). Contratos dos acordos ficam no bucket privado `financeiro-acordos` (`<conta_id>/<membro_id>/<uuid>.<ext>`, URL assinada de 300 s, sem UPDATE/DELETE)
- Linha editorial (flag `feature_linha_editorial`, spec `docs/superpowers/specs/2026-10-26-linha-editorial-design.md`): as quatro tabelas (`linhas_editoriais`, `linha_editorial_colunas`, `linha_editorial_itens`, `linha_editorial_respostas`) têm `REVOKE ALL FROM PUBLIC, anon, authenticated` e grants por coluna para `authenticated`; `status`, `rodada`, `enviada_*`, `decidida_at`, `post_id` e `convertido_*` só mudam pelas RPCs (`linha_editorial_criar`/`enviar`/`recolher`/`converter` no CRM, as de decisão no Hub), e o bloco DO da migration confere o ACL. A flag vale nas policies de escrita e em toda RPC. Ordem de deploy: migrations → `hub-linha-editorial` + `hub-bootstrap` → os oito importadores de `_shared/entitlements.ts` que a spec §9 lista (a coluna `plans.feature_linha_editorial` tem que existir antes, senão todo save de plano no Admin dá 400) → `notification-email-cron` + `client-event-email-cron` → merge. Depois do push em staging, rode `\dp linha_editorial_itens` e espere `authenticated=rd` na tabela (DELETE de linha não convertida) mais os ACLs por coluna

- Métricas do blog (spec `docs/superpowers/specs/2026-10-27-blog-metrics-design.md`, chave do Google em `docs/search-console-service-account.md`). Ordem de deploy: aplique a migration `20261101000001` (views) ANTES de redeployar `platform-admin` (sem ela `blog-metrics` responde 500) e `blog-view` (sem ela nenhuma view é gravada). A `20261101000002` (Search Console) pode vir depois: até lá `blog-metrics` loga a falha de leitura do Google e o Admin mostra as views com "Search Console não configurado". Deploye `blog-search-console-cron` ANTES de aplicar a `20261101000003` (que agenda o cron `38 7 * * *` UTC; agendada antes, o pg_cron bate numa função inexistente todo dia)
- Relatórios multi-plataforma (TikTok nos relatórios, spec `docs/superpowers/specs/2026-10-28-tiktok-analytics-and-multiplatform-reports-design.md` Parte B): a migration `20261103000002` (`report_documents.tiktok_account_id`) vem ANTES de qualquer deploy de `report-docs`: sem a coluna todo `/generate` dá 500 e todo `/refresh-data` falha, inclusive em relatório só de Instagram, porque o insert e o select sempre citam a coluna. A ordem de deploy da function em relação ao merge é a do item de seções abaixo, que vai no mesmo PR e a substitui
- Seções por plataforma nos relatórios (spec `docs/superpowers/specs/2026-10-28-report-platform-sections-design.md`): o layout ganha o marcador `section` (Instagram, TikTok, Geral) e cada widget de plataforma só vive na seção dela. Ordem de deploy: migrations `20261103000002` + `20261103000003` (o trigger `validate_report_layout()` passa a aceitar e exigir as regras de seção) → merge → `report-docs` só depois que o deploy de produção da Vercel desse merge estiver no ar (`instagram-report-generator-v2` não lê layout; só precisa de deploy pelas mudanças da Parte B em `_shared/report-template`). Na ordem inversa o editor antigo (a aba aberta antes do deploy) recebe um relatório com `section`, o `validateLayout` dele recusa e todo autosave falha com toast. Layouts antigos sem `section` seguem válidos e são convertidos na leitura, então a migration antes do merge é segura. Na janela entre o merge e o deploy da function, um modelo padrão do workspace salvo pelo editor novo (já com `section`) é recusado pelo `report-docs` antigo, que loga "template default com layout inválido; usando o padrão do sistema" e gera pelo padrão do sistema: esperado, some com o deploy. **Rollback:** depois que existir um relatório ou modelo com `section` (qualquer geração do `report-docs` novo ou qualquer save do editor novo), nunca volte o frontend para antes desse merge (instant rollback da Vercel ou revert): o editor antigo não salva essas linhas. Voltar só o `report-docs` é seguro (com modelo seccionado ele volta a gerar pelo padrão do sistema, como na janela acima); as linhas seccionadas não precisam de migration de volta
- Onboarding com teste primeiro (spec `docs/superpowers/specs/2026-10-27-trial-first-onboarding-design.md`): o `/comecar` aparece uma vez por workspace, controlado por `workspaces.trial_offer_seen_at` (gravado por `mark_trial_offer_seen()`); o redirecionamento vem de `useTrialOfferRedirect` no `ProtectedRoute`, só para dono elegível (workspace ativo lido, Free resolvido, `plan_source` diferente de `manual`, nunca testou). O lembrete de fim de teste é uma varredura do `lifecycle-email-cron` (`get_trial_reminder_candidates`, `lifecycle_emails.email_type = 'trial_reminder'`, `ref_at` = data da primeira cobrança); o lembrete nativo de trial da Stripe precisa ficar **desligado** (Dashboard > Billing > Customer emails), senão o cliente recebe dois. No Pagar.me `amount_cents` é o total anual e a parcela é `amount_cents / 12`. Páginas estáticas não citam nenhum número de plano que uma edição no Admin mude; se algum dia citarem, editar o plano passa a exigir redeploy do frontend. Ordem de deploy: migration `20261102000001` → `lifecycle-email-cron` + `pagarme-checkout` → merge. Nenhum dos dois lados falha aberto sem a migration: o frontend antes dela quebra a leitura do plano efetivo (`trial_offer_seen_at`), com erro na Cobrança, no `/comecar`, no aviso de teste e nos preços logados; o `pagarme-checkout` antes dela derruba todo checkout do Pagar.me, porque sempre grava `switched_from_trialing`. Rollback: frontend primeiro, depois as functions; nunca apague linhas de `lifecycle_emails`
- Blog automático (spec `docs/superpowers/specs/2026-10-23-blog-automatico-design.md`, brief da rotina em `docs/routines/blog-diario.md`). Os posts da rotina vivem em `blog_posts` e entram no build por `npm run blog:sync`, que roda antes do `build` no `vercel.json`:
  - **Regra de rollback:** com algum post do banco no ar, nunca volte o frontend (instant rollback da Vercel ou revert) para antes do deploy que introduziu o `blog-sync`. Um build mais antigo não tem posts do banco e `/blog/:slug` dá 404 para todos eles. Voltar para qualquer deploy posterior é seguro: cada build sincroniza de novo a partir do banco
  - **Build falhando em `blog:sync`** com post inválido ou slug repetido (arquivo e banco): a mensagem do build nomeia o slug. Despublique ou edite esse post no Admin (`/admin/blog`) e rode o deploy de novo. Enquanto isso todo deploy (inclusive hotfix e preview) segue bloqueado, porque o sync falha fechado
  - `apps/crm/src/content/blog-db/` é gerado por `npm run blog:sync` (um `.json` por post, gitignored). Não edite nem commite: o próximo sync sobrescreve
  - Post escrito à mão novo em `apps/crm/src/content/blog/` exige adicionar slug, título, `description`, `category` e `date` em `supabase/functions/_shared/blog-file-posts.ts` (a rotina lê essa lista para não repetir tema nem slug). O teste de paridade `apps/crm/src/content/__tests__/blog-rules-parity.test.ts` falha se faltar. Essa lista vai empacotada em `blog-view`, `blog-search-console-cron`, `platform-admin` e `mcp-admin`: depois do deploy do frontend, redeploye as quatro, senão `blog-view` descarta em silêncio as views do post novo e ele fica fora da lista do Admin e da inspeção do Google
  - Mudar os escopos `blog:*` (como qualquer escopo do MCP do Admin) = redeploy de `mcp-admin` + `mcp-oauth-consent` + CRM + Admin, e reautorizar o conector com os escopos novos marcados, senão a rotina perde acesso

## Deployment

- Hosting: **Vercel** (CRM + Hub static apps)
- Backend: **Supabase** (Postgres + Edge Functions + Auth)
- Media storage: **Cloudflare R2** (presigned upload URLs)
- `vercel.json` configures rewrites and runs both `build` and `build:hub`
- `npm run prerender` server-renders the landing (`/`): it runs a Vite SSR build of
  `apps/crm/src/entry-server.tsx` (`apps/crm/vite.ssr.config.ts`) into
  `node_modules/.cache/landing-ssr` (never `dist/`), writes the result into `dist/index.html`
  as `<div id="root" data-ssr="landing">`, and `main.tsx` hydrates it. Landing render code must
  be hydration-stable: no browser reads during render (storage, `document`, `matchMedia`); the
  server and the first client render show the anonymous first-visit state, effects adjust after.
  Only `/` is server-rendered; the other prerendered routes keep their `.seo.ts` mirrors
  The SSR bundle is single-file (`inlineDynamicImports`), so every CRM module's top-level code,
  every lazy page and not just the landing, runs in Node at prerender: a module-level
  `window`/`document`/`localStorage` access anywhere breaks the Vercel build (the
  `landing-prerender-smoke` CI job catches it)

## Reference files

See @DESIGN_SYSTEM.md for colors, typography, spacing, and component styling.
See @README.md for project overview.
