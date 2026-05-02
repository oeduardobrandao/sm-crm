# Global Banners — Design Spec

Platform-wide announcement system. Admins create and manage banners in the admin portal; CRM users see them as horizontal bars below the topbar.

## Targeting

Each banner has a `target_mode`:

- **all** — shown to every workspace
- **plan** — shown to workspaces on specific plan tiers (`target_plan_ids` array)
- **workspace** — shown to specific workspaces (`target_workspace_ids` array)

## Banner Types & Styling

Three preset types, each with a default color scheme:

| Type | Background | Accent | Text |
|------|-----------|--------|------|
| `info` | `rgba(66,200,245,0.08)` | `#42c8f5` | White, links in accent color |
| `warning` | `rgba(245,163,66,0.10)` | `#f5a342` | White, links in accent color |
| `critical` | `rgba(245,90,66,0.12)` | `#f55a42` | Red emphasis, links in accent color |

Admins can optionally set a `custom_color` (hex) that overrides the type's default accent color and tint.

## Content

- Body is stored as markdown in a `content` text column. Raw HTML is not supported — `react-markdown` renders markdown to React elements natively without `dangerouslySetInnerHTML`.
- Optional `link` field — when set, the banner bar wrapper becomes an `<a>` element linking to the URL (sanitized via `sanitizeUrl()` before rendering). If the markdown content itself contains inline links, `link` is ignored to avoid nested `<a>` tags. The dismiss X button uses `stopPropagation` on click.

## Dismissal

- Per-user, permanent (server-side). Stored in `banner_dismissals` join table.
- Admins can mark a banner as non-dismissible (`dismissible = false`) — no X button shown.
- Optimistic UI: banner removed immediately on click, INSERT to `banner_dismissals`, rollback + toast on error.

## Scheduling

- `starts_at` (optional timestamptz) — banner becomes visible at this time. Null = immediately when status is set to active.
- `ends_at` (optional timestamptz) — banner stops being visible after this time. Null = no expiration.
- Status field: `draft`, `active`, `archived`. Only `active` banners within their schedule window are shown to CRM users.
- **No cron job for auto-archival.** The `status` column is not automatically changed when `ends_at` passes — the RLS query filters expired banners out at read time. In the admin UI, banners with `status = 'active'` and `ends_at < now()` display a derived **EXPIRED** badge (computed client-side) so admins can see which banners are past their window without a background job.

## Database Schema

### `global_banners`

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | `uuid PK` | `gen_random_uuid()` | |
| `type` | `text NOT NULL` | | `'info'`, `'warning'`, `'critical'` |
| `content` | `text NOT NULL` | | Markdown body |
| `link` | `text` | | Optional URL |
| `custom_color` | `text` | | Optional hex color override |
| `target_mode` | `text NOT NULL` | | `'all'`, `'plan'`, `'workspace'` |
| `target_plan_ids` | `uuid[]` | | Used when `target_mode = 'plan'` |
| `target_workspace_ids` | `uuid[]` | | Used when `target_mode = 'workspace'` |
| `dismissible` | `boolean` | `true` | Whether users can dismiss |
| `starts_at` | `timestamptz` | | Null = immediately active |
| `ends_at` | `timestamptz` | | Null = no expiration |
| `status` | `text NOT NULL` | `'draft'` | `'draft'`, `'active'`, `'archived'` |
| `created_by` | `uuid` | | FK to `platform_admins` |
| `created_at` | `timestamptz` | `now()` | |
| `updated_at` | `timestamptz` | `now()` | |

### `banner_dismissals`

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | `uuid PK` | `gen_random_uuid()` | |
| `banner_id` | `uuid NOT NULL` | | FK to `global_banners` ON DELETE CASCADE |
| `user_id` | `uuid NOT NULL` | | FK to `auth.users` ON DELETE CASCADE |
| `dismissed_at` | `timestamptz` | `now()` | |
| | `UNIQUE(banner_id, user_id)` | | One dismissal per user per banner |

### Constraints

```sql
CHECK (type IN ('info', 'warning', 'critical'))
CHECK (status IN ('draft', 'active', 'archived'))
CHECK (target_mode IN ('all', 'plan', 'workspace'))
CHECK (target_mode != 'plan' OR (target_plan_ids IS NOT NULL AND array_length(target_plan_ids, 1) > 0))
CHECK (target_mode != 'workspace' OR (target_workspace_ids IS NOT NULL AND array_length(target_workspace_ids, 1) > 0))
CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
CHECK (custom_color IS NULL OR custom_color ~ '^#[0-9a-fA-F]{6}$')
```

An `updated_at` trigger (`SET updated_at = now()` on UPDATE) is created for `global_banners`.

### RLS & Permissions

**Plan resolution for targeting:** The workspace's plan comes from `workspace_plan_overrides.plan_id` (if a row exists), falling back to the default plan (`plans.is_default = true`). This matches the existing resolution logic used by `platform-admin` and `workspace-limits` edge functions. The RLS policy uses a helper subquery:

```sql
-- resolve_workspace_plan(workspace_id) returns the effective plan_id:
--   1. workspace_plan_overrides.plan_id if override row exists
--   2. plans.id WHERE is_default = true (fallback)

CREATE FUNCTION resolve_workspace_plan(ws_id uuid) RETURNS text AS $$
  SELECT COALESCE(
    (SELECT plan_id FROM workspace_plan_overrides WHERE workspace_id = ws_id),
    (SELECT id FROM plans WHERE is_default = true LIMIT 1)
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

**`global_banners` SELECT policy** (authenticated users):
```sql
status = 'active'
AND (starts_at IS NULL OR starts_at <= now())
AND (ends_at IS NULL OR ends_at > now())
AND (
  target_mode = 'all'
  OR (target_mode = 'plan' AND resolve_workspace_plan(
        (SELECT conta_id FROM profiles WHERE id = auth.uid())
      ) = ANY(target_plan_ids))
  OR (target_mode = 'workspace' AND
        (SELECT conta_id FROM profiles WHERE id = auth.uid()) = ANY(target_workspace_ids))
)
```

**`banner_dismissals`:**
- SELECT: `user_id = auth.uid()`
- INSERT: `user_id = auth.uid()`

Admin CRUD bypasses RLS via service role client in `platform-admin` edge function.

## Admin Portal

### Route & Navigation

- Route: `/admin/banners`
- Nav item added to `AdminLayout` NAV_ITEMS (using `Megaphone` icon from lucide-react)

### Banners Page Layout

Table list view (matching Workspaces page pattern):
- Header: title + "New Banner" button
- Filter bar: search input + status dropdown
- Table columns: Content (with target subtitle), Type badge, Target mode, Schedule range, Status badge
- Click row to open edit modal
- Draft banners shown at reduced opacity

### Create/Edit Modal

| Field | Input | Notes |
|-------|-------|-------|
| Content | Textarea (markdown) | Required |
| Link | Text input | Optional URL |
| Type | Dropdown: info, warning, critical | Required |
| Custom Color | Hex input | Optional, overrides type color |
| Target Mode | Radio: All, By Plan, By Workspace | Required |
| Target Plans | Multi-select | Shown when mode = plan |
| Target Workspaces | Search + multi-select | Shown when mode = workspace |
| Dismissible | Checkbox | Default: checked |
| Starts At | Datetime input | Optional |
| Ends At | Datetime input | Optional |
| Status | Dropdown: draft, active, archived | Default: draft |

Live preview strip at the bottom of the modal shows how the banner will render.

Delete button visible only for draft banners.

## CRM Integration

### Component & Positioning

`GlobalBannerContainer` in `apps/crm/src/components/layout/GlobalBannerContainer.tsx`.

The CRM layout uses fixed positioning: TopBar is `position: fixed; top: 0; height: var(--topbar-height)` (52px), Sidebar is `position: fixed; top: var(--topbar-height)`, and `.main-content` uses `margin-top: var(--topbar-height)` to offset below. On mobile (<768px), TopBar is hidden and main-content has `margin-top: 0`.

**Banner positioning:** `GlobalBannerContainer` is `position: fixed; top: var(--topbar-height); left: var(--sidebar-width); right: 0; z-index: 105` (between TopBar at 110 and Sidebar at 100). It renders banners stacked vertically. The component measures its own height via a ref and sets a CSS variable `--banner-height` on the document, which `.main-content` uses as additional top margin: `margin-top: calc(var(--topbar-height) + var(--banner-height, 0px))`. Sidebar top offset is similarly adjusted.

**Mobile:** On mobile, banners render at `top: 0; left: 0` (no topbar, no sidebar offset) and `.main-content` margin adjusts to `var(--banner-height, 0px)`.

**Placement in AppLayout.tsx:** Rendered as a sibling of TopBar, Sidebar, and main — not inside any of them. The component manages its own fixed positioning.

### Data Flow

1. Query `global_banners` via Supabase client (RLS filters automatically)
2. Query `banner_dismissals` for current user
3. Filter out dismissed banners client-side
4. Sort: critical > warning > info, then newest first within each type
5. Render stacked full-width bars with centered text

### React Query Config

- `staleTime: 60_000` (1 min)
- `refetchInterval: 300_000` (5 min)

### Banner Bar Rendering

- Full-width bar below topbar, centered text
- Background tint and border-bottom from type color (or custom color)
- Dismiss X button on the right (if `dismissible = true`), stops link propagation
- If `link` is set, entire bar is clickable
- Markdown content rendered inline

## Platform-Admin Edge Function

New actions in `platform-admin/index.ts`:

| Action | Description |
|--------|-------------|
| `list-banners` | List all banners with optional status filter. Returns dismissal count per banner. |
| `create-banner` | Create banner. Validates required fields. |
| `update-banner` | Update any field. Handles status transitions. |
| `delete-banner` | Hard-delete banner + cascade dismissals. Only allowed for draft status. |
