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

# Lint & format (both enforced in CI)
npm run lint             # eslint apps/ packages/ (runs in the typecheck-and-test job)
npm run format           # prettier --write  (auto-fix apps/** and packages/**)
npm run format:check     # prettier --check  (format-check job gate; run before pushing)

# Supabase
npx supabase functions serve                    # local edge functions
npx supabase functions deploy <name>
npx supabase db push --linked                   # push migrations to staging
```

### What CI actually runs

`.github/workflows/ci.yml` is the source of truth. It fires on pull requests and
pushes to `main` and `staging`, with **eight** jobs:

| Job | Runs |
|---|---|
| `typecheck-and-test` | `npm run lint`, then `tsc` for **all four** projects (crm, hub, admin, `tsconfig.scripts.json`), then `npm run test:coverage` |
| `edge-function-tests` | `npm run test:functions` (Deno) |
| `entitlement-tests` | `supabase start` + `bash scripts/test-entitlements.sh` — the psql RLS/entitlement suites |
| `coverage-threshold` | `npm run coverage:check` |
| `format-check` | `npm run format:check` |
| `migration-version-guard` | fails on duplicate migration version prefixes |
| `e2e` | Playwright |
| `e2e-secrets-guard` | warns when E2E secrets are absent |

Three things this list is here to prevent:

- **`npm run build` is not the typecheck.** It only covers the CRM. CI
  typechecks four projects separately, so a Hub, Admin or scripts break passes
  locally and fails in CI. Run the four `tsc` commands, not `build`.
- **`supabase/tests/entitlements/*.sql` IS gated by CI.** It is easy to assume
  otherwise because it needs a local database to run by hand. It does not need
  one to be enforced.
- **A green `e2e` does not always mean e2e ran.** Without the E2E secrets the
  job skips silently, which is exactly why `e2e-secrets-guard` exists: it emits
  a warning naming the missing secrets. Check that warning before trusting a
  green e2e.

Before pushing, run `npm run lint`, `npm run format:check` (`npm run format`
auto-fixes), the four `tsc` commands, `npm run test` and `npm run test:functions`.
`npm run test:db` needs Docker locally; CI covers it either way.

Migration filenames must use a unique timestamp version prefix (the digits before the first `_`). Two files sharing a prefix collide in Supabase's `schema_migrations` history table — only the first applies and the second is silently skipped. The `migration-version-guard` CI job fails the build on duplicates.

## Architecture

Monorepo with npm workspaces:

- `apps/crm/` -- Internal CRM dashboard (React 19, React Router v7, TanStack Query)
- `apps/hub/` -- Client-facing portal (React 19, createBrowserRouter)
- `packages/ui/` -- Shared UI primitives
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
- `GEMINI_API_KEY` -- Google Gemini key for AI narrative generation in analytics reports (instagram-analytics, instagram-report-generator-v2). Optional, no default -- AI narrative is skipped when unset
- `REPORT_PRINT_BASE` -- origem pública que serve a página de print do relatório
  de blocos (ex.: https://mesaas.com.br). Usada por report-docs POST /:id/pdf
  para montar a URL que o Gotenberg imprime. Opcional: sem ela (ou sem
  GOTENBERG_URL / INTERNAL_FUNCTION_SECRET) o export responde 503
  pdf_not_configured; as demais rotas seguem normais
- `STRIPE_SECRET_KEY` -- Stripe API secret key. REQUIRED by billing functions, no default -- throw if missing. Also used (optionally) by billing-downgrade-cron for the switch's leg D enforcement; absent, that leg is skipped with `switchSkipped: true`
- `STRIPE_WEBHOOK_SECRET` -- Stripe webhook signing secret. REQUIRED by stripe-webhook, no default -- throw if missing
- `PAGARME_SECRET_KEY` -- Pagar.me v5 API secret for 12x installment billing (pagarme-client). No default; shared client throws on first call when missing
- `PAGARME_WEBHOOK_TOKEN` -- secret path segment of the Pagar.me webhook URL
  (`/pagarme-webhook/{token}`). REQUIRED by pagarme-webhook, no default -- throws at module load
- `PAGARME_WEBHOOK_BASIC` -- `user:password` pair configured in the Pagar.me dashboard webhook
  "Habilitar autenticação" toggle, verified timing-safe on every delivery. REQUIRED by
  pagarme-webhook, no default -- throws at module load
- `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI` -- TikTok Login Kit OAuth (tiktok-integration)
- `TIKTOK_APP_AUDITED` -- unset until TikTok's Content Posting audit passes; while unset, scheduling enforces SELF_ONLY privacy
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
  feature, cleanup included

## Gotchas

- Client detail route is `/clientes/:id` (plural). OAuth redirects MUST use `/clientes/` not `/cliente/`
- `store.ts` exports plain async functions, not hooks. Wrap with `useQuery`/`useMutation` from TanStack Query in components
- `clientId` from URL params: use `parseInt(param, 10)` with `isNaN()` guard, never bare `Number()`
- Page param validation: `Math.max(1, parseInt(pageStr) || 1)`
- localStorage iteration: collect keys first, then remove. Modifying during iteration skips items
- Roles are `owner | admin | agent` -- always check via `AuthContext`, never hardcode
- Supabase edge function deploy always needs `--no-verify-jwt` flag for functions that handle their own auth (OAuth callbacks, cron, hub)
- Hub app uses token-based access (no Supabase auth), builds to `dist/hub/` with base path `/hub/`
- Vercel rewrites in `vercel.json` route Hub URLs to `/hub/index.html` and CRM URLs to `/index.html`
- `membros` and `clientes` use column-level `GRANT SELECT` allowlists (Migration `20260728000002`). Any column added to either table is invisible to the CRM until it is added to the grant, to `membros_v`/`clientes_v`, and to the `*_SAFE_COLUMNS` constants in `store/team.ts` / `store/clients.ts`. The failure surfaces as a confusing missing-column error. The same allowlist also keeps six PostgREST embeds, ten dependent RLS policies and `get_client_health_aggregates()` working -- none of which a `from('clientes')` grep finds.

## Deployment

- Hosting: **Vercel** (CRM + Hub static apps)
- Backend: **Supabase** (Postgres + Edge Functions + Auth)
- Media storage: **Cloudflare R2** (presigned upload URLs)
- `vercel.json` configures rewrites and runs both `build` and `build:hub`

## Reference files

See @DESIGN_SYSTEM.md for colors, typography, spacing, and component styling.
See @README.md for project overview.
