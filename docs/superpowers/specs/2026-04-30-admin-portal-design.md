# Admin Portal — Design Spec

Separate app (`apps/admin/`) in the monorepo for platform-level administration: workspace oversight, plan/limit management, and feature gating.

**MVP scope:** Read-only dashboard + plan template management + per-workspace limit/flag overrides.
**Phase 2 (out of scope):** Global banners, targeted notifications, audit log viewer.

---

## App Structure

New Vite app at `apps/admin/`, following the same pattern as `apps/hub/`.

```
apps/admin/
├── index.html
├── vite.config.ts            # base: '/admin/', outDir: '../../dist/admin'
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.js
└── src/
    ├── main.tsx
    ├── router.tsx              # createBrowserRouter
    ├── lib/
    │   ├── supabase.ts         # Supabase client (same project, anon key)
    │   └── api.ts              # Typed wrapper for platform-admin edge function
    ├── context/
    │   └── AdminAuthContext.tsx # Auth + platform_admins verification
    ├── components/
    │   └── ui/                 # shadcn components (own installation)
    ├── pages/
    │   ├── LoginPage.tsx
    │   ├── DashboardPage.tsx
    │   ├── WorkspacesPage.tsx
    │   ├── WorkspaceDetailPage.tsx
    │   └── PlansPage.tsx
    └── layouts/
        ├── AdminLayout.tsx     # Sidebar + content shell
        └── AdminProtectedRoute.tsx
```

### Deployment

- **Vercel:** Same project as CRM and Hub. Add rewrite `"/admin/(.*)" → "/admin/index.html"` to `vercel.json`.
- **Build:** New `build:admin` script in root `package.json`. Update Vercel `buildCommand` to include it.
- **Vite config:** `base: '/admin/'` (production), `base: '/'` (dev). `outDir: '../../dist/admin'`. Env dir: `../..` (root). Alias `@` → `./src/`.

### UI Stack

Same as CRM: React 19, React Router v7 (`createBrowserRouter`), TanStack Query, shadcn/ui, Tailwind, lucide-react, sonner for toasts. The admin app gets its own `components.json` and shadcn installation. Shared primitives can be imported from `packages/ui`.

Fonts: DM Sans (body), Playfair Display (headings), DM Mono (inputs/data) — same as CRM.

---

## Database Schema

Three new tables. No RLS on any of them — all access goes through edge functions using service-role key.

### `platform_admins`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `user_id` | uuid | unique, FK → `auth.users` | Supabase auth user |
| `email` | text | not null | Denormalized for display |
| `invited_by` | uuid | nullable, FK → `platform_admins.id` | Null for the seed admin |
| `created_at` | timestamptz | default `now()` | |

Seed the first row manually with the platform owner's `user_id`.

### `plans`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `name` | text | not null, unique | e.g., "Free", "Pro", "Enterprise" |
| `resource_limits` | jsonb | not null | `{ "max_clients": 10, "max_members": 3, "max_instagram_accounts": 1, "max_storage_mb": 500 }` |
| `feature_flags` | jsonb | not null | `{ "analytics": false, "post_express": false, "briefing": true, "ideias": false }` |
| `is_default` | boolean | default false | Plan assigned to new workspaces. Only one row should be true. |
| `created_at` | timestamptz | default `now()` | |
| `updated_at` | timestamptz | default `now()` | |

### `workspace_plan_overrides`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `workspace_id` | uuid | unique, FK → `workspaces.id` | One row per workspace |
| `plan_id` | uuid | FK → `plans.id`, not null | Which plan template |
| `resource_overrides` | jsonb | nullable | Only overridden keys, e.g. `{ "max_clients": 25 }` |
| `feature_overrides` | jsonb | nullable | e.g. `{ "analytics": true }` |
| `notes` | text | nullable | Admin notes ("upgraded per request") |
| `updated_by` | uuid | FK → `platform_admins.id` | Who last changed it |
| `created_at` | timestamptz | default `now()` | |
| `updated_at` | timestamptz | default `now()` | |

### Limit Resolution Logic

Effective limits for a workspace are computed by merging the plan defaults with any overrides:

```
effective_limits = { ...plan.resource_limits, ...override.resource_overrides }
effective_flags  = { ...plan.feature_flags,  ...override.feature_overrides  }
```

Override keys win. Fallback chain:
1. Workspace has a row in `workspace_plan_overrides` → use its `plan_id` + overrides
2. No row → use the default plan (`is_default = true` in `plans`)
3. No default plan exists → return `null` (no limits enforced, unlimited access)

---

## Edge Functions

### `platform-admin/index.ts` — Admin-only

Single edge function with action-based routing. All requests use the service-role Supabase client.

**Auth flow (every request):**
1. Extract JWT from `Authorization: Bearer <token>` header
2. `supabaseServiceClient.auth.getUser(token)` → get `user_id`
3. Query `platform_admins` where `user_id` matches → 403 if not found
4. CORS via `buildCorsHeaders(req)` from `_shared/cors.ts`

**Actions:**

| Action | Method | Description |
|--------|--------|-------------|
| `verify-admin` | POST | Returns `{ is_admin: true }` if caller is in `platform_admins`. Used by `AdminAuthContext` on login. |
| `list-workspaces` | POST | All workspaces with owner profile (name, email), member count, client count, plan name, override status. Supports `search` (text) and `plan_id` (filter) params. Paginated (offset/limit). |
| `get-workspace` | POST | Single workspace: owner, all members (name, email, role, joined_at), current plan, resolved limits/flags, usage stats (client count, member count, integration count, storage used). |
| `list-plans` | POST | All plan templates with workspace count per plan. |
| `create-plan` | POST | New plan template. Params: `name`, `resource_limits`, `feature_flags`, `is_default`. If `is_default: true`, unset previous default. |
| `update-plan` | POST | Modify a plan's name, limits, or flags. Params: `plan_id` + fields to update. |
| `delete-plan` | POST | Remove a plan. Fails if any workspace is assigned to it. |
| `set-workspace-plan` | POST | Assign a workspace to a plan. Creates or updates `workspace_plan_overrides` row with `plan_id`, clears existing overrides. |
| `set-workspace-overrides` | POST | Set `resource_overrides` and/or `feature_overrides` for a workspace. Merges with existing overrides. Params: `workspace_id`, `resource_overrides`, `feature_overrides`, `notes`. |
| `clear-workspace-overrides` | POST | Reset a workspace to plan defaults by nulling `resource_overrides` and `feature_overrides`. |
| `list-admins` | POST | All platform admins with email, invited_by, created_at. |
| `invite-admin` | POST | Add a user to `platform_admins` by email. The email must belong to an existing Supabase auth account. Sets `invited_by` to the caller. |
| `remove-admin` | POST | Remove a platform admin. Cannot remove yourself. |

Deploy with `--no-verify-jwt` since the function handles its own auth.

### `workspace-limits/index.ts` — CRM-facing, read-only

Called by the CRM app with a normal user JWT. Returns the resolved limits and feature flags for the caller's workspace.

**Auth flow:**
1. Extract JWT from `Authorization: Bearer <token>`
2. `supabaseServiceClient.auth.getUser(token)` → get user
3. Query `profiles` for `conta_id` (workspace ID)
4. Query `workspace_plan_overrides` joined with `plans` for that workspace
5. Merge and return resolved limits

**Response:**
```json
{
  "plan_name": "Pro",
  "limits": {
    "max_clients": 15,
    "max_members": 10,
    "max_instagram_accounts": 3,
    "max_storage_mb": 2000
  },
  "features": {
    "analytics": true,
    "post_express": true,
    "briefing": true,
    "ideias": false
  }
}
```

Fallback chain: workspace override → default plan → `null`. When `null`, no limits are enforced.

Deploy with `--no-verify-jwt`.

---

## Admin App Pages

### Layout Shell (`AdminLayout.tsx`)

Full-width sidebar (220px) — not icon-only like the CRM since there are fewer nav items. Dark theme matching the CRM design system (`--sidebar-bg: #12151a`).

Sidebar contents:
- Logo: "mesaas" (Playfair Display, yellow) + "ADMIN" label (small, uppercase, muted)
- Nav items: Dashboard, Workspaces, Plans, Admins
- Bottom: current admin's name and email

### Login Page

Standalone page at `/admin/login`. Email + password form. Same visual style as the CRM auth pages (light mode forced, `#eaf0dc` background). On successful auth, calls `verify-admin` action — if not a platform admin, signs out and shows "Acesso não autorizado".

### Dashboard Page

- **KPI row:** 4 cards — Total Workspaces, Total Users, Active Plans, Workspaces with Overrides
- **Recent Workspaces table:** Last 10 created workspaces with name, owner, plan badge, member count, created date. Clickable rows → Workspace Detail.

### Workspaces Page

- **Search bar:** Text search across workspace name and owner email
- **Plan filter:** Dropdown to filter by plan
- **Table columns:** Workspace name, Owner email, Plan (color-coded badge), Clients (current/limit), Members (current/limit), Created date, Arrow link to detail
- **"OVERRIDES" badge** shown next to workspace name when `resource_overrides` or `feature_overrides` are non-null
- Paginated (20 per page)

### Workspace Detail Page

- **Header:** Back link, workspace logo/initials, name, owner email, created date, plan badge
- **Two-column layout:**
  - **Resource Limits card:** Each limit as a row — label, editable value (DM Mono), and "plan: X" or "override (plan: X)" indicator. Overridden values highlighted in yellow.
  - **Feature Flags card:** Each flag as a row — label, ON/OFF toggle, and plan/override indicator. Overridden values in yellow.
- **Members table:** Name, email, role (color-coded), joined date. Read-only.
- **Plan selector:** Dropdown to change the workspace's plan (triggers `set-workspace-plan`).
- **Save/Reset buttons:** Save applies overrides via `set-workspace-overrides`. Reset clears overrides via `clear-workspace-overrides`.
- **Notes field:** Free-text admin notes, saved with overrides.

### Plans Page

- **Card grid:** One card per plan template (3 columns)
- Each card shows: plan name (colored for Pro/Enterprise), DEFAULT badge if applicable, resource limits list, feature flags list (ON/OFF colored), workspace count
- **"+ New Plan" button** opens a modal/drawer with form: name, resource limits (4 number inputs), feature flags (4 toggles)
- Click a card to edit it (same form, pre-filled)
- Delete button on edit form (disabled if workspaces are assigned)

### Admins Page

- **Table:** All platform admins — email, invited by (name), added date
- **"+ Convidar Admin" button:** Text input for email. On submit, calls `invite-admin`. Shows error if email has no Supabase auth account.
- **Remove button** per row (disabled for the current user — can't remove yourself)

---

## CRM-Side Enforcement

### `useWorkspaceLimits()` Hook

New TanStack Query hook in `apps/crm/src/hooks/useWorkspaceLimits.ts`:

```ts
function useWorkspaceLimits() → {
  limits: ResourceLimits | null,
  features: FeatureFlags | null,
  planName: string | null,
  isLoading: boolean,
  isUnlimited: boolean  // true when no plan is assigned
}
```

Calls `workspace-limits` edge function. Stale time: 5 minutes. Retry on error.

### Resource Limit Enforcement

UI-level checks before create actions:
- **Clients:** Disable "Novo Cliente" button when `clientCount >= limits.max_clients`. Show tooltip "Limite de clientes atingido".
- **Members:** Disable invite when `memberCount >= limits.max_members`. Show tooltip "Limite de membros atingido".
- **Instagram accounts:** Disable connect when at capacity.
- **Storage:** Check before file uploads.

Backend enforcement in relevant edge functions (create-client, invite-user, etc.): query current count vs. resolved limit, reject with 403 and message if exceeded.

### Feature Flag Enforcement

Route-level gating in `ProtectedRoute.tsx`:
- Extend the existing `AGENT_BLOCKED` pattern with a `FEATURE_GATED` map: `{ '/analytics': 'analytics', '/post-express': 'post_express', '/ideias': 'ideias' }`
- If `features[flag] === false`, redirect to a generic "Recurso indisponível" page or show an upgrade prompt
- Sidebar nav items for disabled features: grayed out with a lock icon, non-clickable

### Graceful Fallback

When `useWorkspaceLimits()` returns `null` (no plan assigned), all limits are treated as unlimited and all features as enabled. This ensures existing workspaces continue working until plans are created and assigned.

---

## Auth Flow

### Admin Login
1. User navigates to `/admin/login`
2. `supabase.auth.signInWithEmailAndPassword(email, password)`
3. On success, `AdminAuthContext` calls `platform-admin` with action `verify-admin`
4. If verified → redirect to `/admin/dashboard`
5. If not verified → sign out, show "Acesso não autorizado" error

### Session Persistence
`supabase.auth.onAuthStateChange` listener in `AdminAuthContext`. On `SIGNED_IN` or `TOKEN_REFRESHED`, re-verify `platform_admins` membership (cached in TanStack Query, stale time 10 minutes).

### Admin Invite Flow
1. Existing admin enters an email on the Admins page
2. `invite-admin` action checks if email has a Supabase auth account
3. If yes → insert into `platform_admins` with `invited_by` set to caller
4. If no auth account → return error "Usuário não encontrado. O usuário precisa criar uma conta primeiro."

### Route Protection
`AdminProtectedRoute` wraps all routes except `/admin/login`. Checks: (1) authenticated via Supabase, (2) verified as platform admin. If either fails, redirect to `/admin/login`.

---

## Deployment Changes

### `vercel.json`

Add rewrite before the CRM catch-all:

```json
{
  "source": "/admin/(.*)",
  "destination": "/admin/index.html"
}
```

### `package.json`

Add scripts:
```json
{
  "dev:admin": "vite --config apps/admin/vite.config.ts --port 5177",
  "build:admin": "tsc -p apps/admin/tsconfig.json && vite build --config apps/admin/vite.config.ts"
}
```

Update `buildCommand` in `vercel.json`:
```json
{
  "buildCommand": "npm run build && npm run build:hub && npm run build:admin"
}
```

### Edge Functions

Deploy both new functions with `--no-verify-jwt`:
```bash
npx supabase functions deploy platform-admin --no-verify-jwt
npx supabase functions deploy workspace-limits --no-verify-jwt
```

---

## Phase 2 — Future Scope (Not in MVP)

- **Global banners:** `platform_banners` table (message, type, start_at, end_at, dismissible). CRM fetches active banners via a public edge function. Shown as a top bar in AppLayout.
- **Targeted notifications:** `platform_notifications` table (workspace_id, message, type, read). Admin can send to specific workspaces. Shown in the CRM's existing notification system.
- **Audit log viewer:** Admin page to browse the existing `audit_log` table cross-workspace.
- **Usage analytics:** Charts showing workspace growth, resource utilization trends.
