# Mesaas CRM

Social media agency CRM (React + Supabase). Two apps: **CRM** (internal dashboard) and **Hub** (client-facing portal). Portuguese-language UI.

## Commands

```bash
# Development
npm run dev              # CRM app on :5173
npm run dev:hub          # Hub app on :5175
npm run dev:staging      # CRM against staging Supabase

# Build (always typecheck first)
npm run build            # tsc + vite build for CRM
npm run build:hub        # tsc + vite build for Hub

# Supabase
npx supabase functions serve                    # local edge functions
npx supabase functions deploy <name>
npx supabase db push --linked                   # push migrations to staging
```

IMPORTANT: There is no test suite, linter, or formatter configured. Typecheck with `npm run build` (runs `tsc` then `vite build`). Always typecheck after making code changes.

## Architecture

Monorepo with npm workspaces:

- `apps/crm/` -- Internal CRM dashboard (React 19, React Router v7, TanStack Query)
- `apps/hub/` -- Client-facing portal (React 19, createBrowserRouter)
- `packages/ui/` -- Shared UI primitives
- `supabase/functions/` -- Deno edge functions (backend)
- `supabase/migrations/` -- SQL migrations

### CRM app structure (`apps/crm/src/`)

- `App.tsx` -- Routes (React Router v7 BrowserRouter, lazy-loaded pages)
- `main.tsx` -- Bootstrap (BrowserRouter wraps App)
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
- Fonts: DM Sans (body), Playfair Display (headings), DM Mono (inputs/data)

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

## Deployment

- Hosting: **Vercel** (CRM + Hub static apps)
- Backend: **Supabase** (Postgres + Edge Functions + Auth)
- Media storage: **Cloudflare R2** (presigned upload URLs)
- `vercel.json` configures rewrites and runs both `build` and `build:hub`

## Reference files

See @DESIGN_SYSTEM.md for colors, typography, spacing, and component styling.
See @README.md for project overview.
