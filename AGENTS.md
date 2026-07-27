# AGENTS.md — Mesaas CRM

Conventions and review priorities for AI agents working in this repo. Claude Code also reads
`CLAUDE.md`; this file is the shared baseline and is what Codex loads during `codex exec review`.

Mesaas is a social-media-agency CRM. Portuguese-language UI, Brazilian market. Three React apps
on one Supabase backend.

## Layout

npm workspaces (`apps/*`, `packages/*`):

| Path | What it is |
|---|---|
| `apps/crm/` | Internal dashboard. React 19, React Router v7 `createBrowserRouter` + `RouterProvider`, TanStack Query. Port 5173 |
| `apps/hub/` | Client-facing portal. `createBrowserRouter`. Token auth, no login. Port 5175 |
| `apps/admin/` | Platform admin. Port 5177 |
| `packages/ui/`, `packages/i18n/` | Shared primitives and translations |
| `supabase/functions/` | 56 **Deno** edge functions (not Node) |
| `supabase/migrations/` | 161 SQL migrations |
| `workers/media-proxy/` | Cloudflare Worker, deployed manually |
| `docs/superpowers/specs/` | Design specs and implementation plans |

`@/` aliases to `./src/` in each app. ES modules only.

## Verifying a change

**`npm run build` only typechecks the CRM.** CI typechecks all three apps plus the scripts
project separately, so a Hub or Admin change verified with `npm run build` alone can look
green locally and still fail CI. Run the same four the CI runs:

```bash
npx tsc -p apps/crm/tsconfig.json   --noEmit
npx tsc -p apps/hub/tsconfig.json   --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json

npm run test           # vitest
npm run test:functions # deno test for edge functions
npm run lint           # eslint apps/ packages/
npm run format:check   # prettier — apps/**/*.{ts,tsx} and packages/**/*.{ts,tsx} only
```

CI enforces these as separate jobs — `typecheck-and-test`, `edge-function-tests`,
`coverage-threshold`, `format-check`, `migration-version-guard`. A change that skips
`format:check` or `lint` fails CI even when it is otherwise correct.

## Stack facts that are easy to get wrong

- **React 19**, not 18. **Tailwind + Radix (shadcn/ui)** — there is no Ant Design in this repo.
  One Tailwind config at the root covers all three apps; see `DESIGN_SYSTEM.md` for the tokens,
  the per-app split, and the traps (`--radius` defined twice, `hub-*` classes not being Tailwind
  utilities, `#root { overflow-x }` killing `position: sticky`).
- Edge functions are **Deno**. Imports use `npm:` specifiers or relative `.ts` paths. Node
  built-ins and `node_modules` resolution are not available there.
- Icons: `lucide-react` only. Dates: `date-fns` to format, `dayjs` to manipulate — never moment.
- Forms: `react-hook-form` + `zod`. Rich text: TipTap. Toasts: `toast()` from `sonner`
  (the legacy `showToast()` in `router.ts` is for old code only).
- Roles are exactly `owner | admin | agent`, always read from `AuthContext` — never hardcoded.

## Hard rules — treat a violation as a blocking finding

- **CORS**: never `*`. Use `buildCorsHeaders(req)` from `supabase/functions/_shared/cors.ts`.
- **Workspace isolation**: any *user-scoped* edge function must verify `conta_id` ownership
  before returning or mutating data. A missing `conta_id` check there is a cross-tenant leak.
  System handlers are the exception and must not be flagged for it: `platform-admin`
  authorizes against the `platform_admins` table and then deliberately operates on the
  `workspace_id` in the request body, and crons and signed webhooks have no calling member at
  all. For those, check that the trusted identity is established first and that every query is
  still scoped to one derived workspace.
- **Auth**: every function authenticates *something* before doing work, but the mechanism
  depends on the caller. Check which class a function belongs to before calling its auth wrong:

  | Class | Mechanism |
  |---|---|
  | Cron (`*-cron`) and `report-worker` | `x-cron-secret` header, verified before any work |
  | Provider webhooks | `stripe-webhook` verifies the `stripe-signature`; `tiktok-webhook` is deliberately public (`verify_jwt = false`) and authenticates on `client_key` + known `user_openid` |
  | Hub (`hub-*`) | Hub token from the URL — the client portal has no Supabase auth |
  | OAuth callbacks | Signed `state` parameter (e.g. `instagram-integration`) |
  | Report generators | `X-Internal-Token` matched against `INTERNAL_FUNCTION_SECRET`, **or** `x-cron-secret` |

  Judge a function by what it accepts *inbound*. `report-worker` is the trap: it authenticates
  callers with `x-cron-secret` only, and merely *sends* `X-Internal-Token` when it fans out to
  a generator. That outbound header is caller behaviour, not its auth class.
  | Everything else | JWT via `Authorization: Bearer` |

- **Secrets**: `TOKEN_ENCRYPTION_KEY` is required with no fallback — throw if missing. Never
  commit a real `.env`, `.env.local` or `.env.staging`. The `*.example` templates
  (`.env.example`, `.env.e2e.local.example`) *are* tracked and should be updated when a new
  variable is introduced.
- **Error handling**: never return or log raw error details to clients from an edge function.
  Generic message out, details to the internal log.
- **HTML/URLs**: `escapeHTML()` for user data interpolated into raw HTML; `sanitizeUrl()` for any
  `href` built from external or user data.

## Traps that have actually caused incidents here

Weight these heavily in review — each one has shipped a real bug:

- **Duplicate migration version prefix.** Two files sharing the digits before the first `_`
  collide in `schema_migrations`; the second is *silently skipped* on remote databases. The
  `migration-version-guard` CI job exists because this shipped twice.
- **`post_file_links` cover flips must be two separate statements.** The `one_cover` partial
  unique index is non-deferrable, so a single reassigning `UPDATE` hits an intermittent
  duplicate-key error mid-statement.
- **RLS**: `get_my_conta_id()` returns `active_workspace_id`, not `conta_id`. When it is NULL the
  app still renders but every query returns empty.
- **Edge runtime kills bypass `catch`** with no error logged, and the `aws-sdk` R2 client hangs
  100% of the time on the edge runtime. Use presigned URL + plain `fetch` + `AbortSignal`, and
  put a timeout on every I/O call inside a handler that sets state.
- **`REVOKE ... FROM PUBLIC` also strips `service_role`**, silently breaking edge-function calls
  to a `SECURITY DEFINER` RPC. Check `proacl`, not `has_function_privilege`.
- **Route is `/clientes/:id`** (plural). OAuth redirects using `/cliente/` 404.
- **Param parsing**: `parseInt(param, 10)` with an `isNaN` guard, never bare `Number()`. Page
  params: `Math.max(1, parseInt(pageStr) || 1)`.
- **localStorage iteration**: collect keys first, then remove. Mutating during iteration skips
  entries.
- **Contract changes break both test suites.** A changed shape needs updates in `apps/**/__tests__`
  *and* `supabase/functions/__tests__`.
- **`#root { overflow-x }`** in the CRM global CSS silently disables `position: sticky` in both
  apps.

## What a useful review looks like here

Prioritise, in order:

1. Cross-tenant data exposure — a missing or wrong `conta_id` / RLS check.
2. Contract drift between the React app, the edge function, and the SQL migration for the same
   feature. These three change together and reviews usually only look at one.
3. Migration safety — version-prefix collisions, non-idempotent DDL, missing rollback story.
4. Auth and secret handling in edge functions.
5. Correctness bugs with a concrete failing input.

Do not report formatting, import ordering, or naming taste — Prettier and ESLint own those and
they gate CI already. Anchor every finding to a specific file and line, and say what input or
state makes it fail. If nothing substantive turns up, say so in one line rather than padding.
