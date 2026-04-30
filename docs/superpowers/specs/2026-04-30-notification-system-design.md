# Notification System — Design Spec

In-app notification center for the CRM. Surfaces events from Hub client actions, workflow progress, and workspace changes via a bell icon popover in the top bar.

## Decisions

- **Delivery:** In-app only, polled every 60 seconds. Supabase Realtime is unused in this codebase today; polling is the safe starting point. If multi-tab polling load becomes an issue, migrating the unread count query to a Realtime subscription is the natural next step.
- **Storage:** One row per recipient in a `notifications` table
- **Creation:** Postgres AFTER triggers on source tables (no application-level inserts)
- **Content:** Triggers store only `type` + `metadata`. Title and body are derived client-side from `NOTIFICATION_CONFIG` — this avoids hardcoding Portuguese strings in SQL and allows copy changes without migrations. Templates use graceful fallbacks for missing metadata keys (e.g., `metadata.client_name ?? 'Cliente'`) so old notifications still render if metadata schema evolves.
- **Lifecycle:** Auto-delete after 90 days via daily cron
- **Linking:** New `membros.crm_user_id` column maps team members to CRM users for notification routing. Named `crm_user_id` (not `linked_user_id`) to avoid confusion with the existing `membros.user_id` column, which tracks who *created* the membro record — a different concept entirely.
- **Column naming:** New tables in this codebase have been moving toward `workspace_id` (ideias, workspace_members). The `notifications` table follows this convention and uses `workspace_id` instead of `conta_id`. Note that several source tables still use `conta_id` (workflows, workflow_posts, clientes, membros) — triggers on those tables read `conta_id` from the source row and write it as `workspace_id` into notifications.
- **Trigger safety:** All trigger functions wrap notification logic in `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE WARNING` blocks. A broken notification trigger must never roll back the underlying business operation (post approval, step completion, etc.). Notification failures are logged as warnings but are non-fatal.
- **Volume profile:** A single bulk operation (e.g., advancing a workflow stage that activates 3 etapas at once) fans out to 3 triggers × N recipients. This is fine for v1 at CRM scale. If email/push hooks are added later, they should batch or queue rather than fire inline from the trigger.

## Notification Types

### Hub / Client Actions

| Type | Source table | Trigger | Recipients |
|------|-------------|---------|------------|
| `post_approved` | post_approvals | AFTER INSERT, action = 'aprovado' | Assigned membro's CRM user + owners/admins |
| `post_correction` | post_approvals | AFTER INSERT, action = 'correcao' | Assigned membro's CRM user + owners/admins |
| `post_message` | post_approvals | AFTER INSERT, action = 'mensagem' | Assigned membro's CRM user + owners/admins |
| `idea_submitted` | ideias | AFTER INSERT, status = 'nova' | All owners/admins |
| `briefing_answered` | hub_briefing_questions | AFTER UPDATE, answer changed from NULL | All owners/admins |

### Workflow / Team

| Type | Source table | Trigger | Recipients |
|------|-------------|---------|------------|
| `step_activated` | workflow_etapas | AFTER UPDATE, status → 'ativo' | Step's responsável's CRM user + owners/admins |
| `step_completed` | workflow_etapas | AFTER UPDATE, status → 'concluido' | Owners/admins (actor excluded) |
| `post_assigned` | workflow_posts | AFTER UPDATE, responsavel_id changed (value → value or NULL → value only; value → NULL is ignored — no new responsável to notify) | New responsável's CRM user + owners/admins (actor excluded, including self-assignment) |
| `workflow_completed` | workflows | AFTER UPDATE, status → 'concluido' | All owners/admins (actor excluded) |
| `deadline_approaching` | workflow_etapas | Daily cron, data_limite = tomorrow's date | Step's responsável's CRM user + owners/admins |

### Workspace (owner/admin only)

| Type | Source table | Trigger | Recipients |
|------|-------------|---------|------------|
| `invite_accepted` | workspace_members | AFTER INSERT | Owners/admins only |
| `member_role_changed` | workspace_members | AFTER UPDATE, role changed | Owners/admins only (actor excluded) |
| `member_removed` | workspace_members | AFTER DELETE | Owners/admins only (actor excluded) |

## Database Schema

### notifications table

```sql
CREATE TABLE notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type          text NOT NULL,
  metadata      jsonb DEFAULT '{}',
  link          text,
  read_at       timestamptz,
  dismissed_at  timestamptz,
  created_at    timestamptz DEFAULT now()
);
```

No `title` or `body` columns — display text is derived client-side from `type` + `metadata` via `NOTIFICATION_CONFIG`. This keeps copy out of SQL.

**Type constraint:**

```sql
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'post_approved', 'post_correction', 'post_message',
    'idea_submitted', 'briefing_answered',
    'step_activated', 'step_completed', 'post_assigned',
    'workflow_completed', 'deadline_approaching',
    'invite_accepted', 'member_role_changed', 'member_removed'
  )
);
```

**Indexes:**

```sql
-- Primary query: my unread notifications, newest first
CREATE INDEX idx_notifications_user_unread
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

-- Popover list: all my non-dismissed notifications
CREATE INDEX idx_notifications_user_visible
  ON notifications (user_id, created_at DESC)
  WHERE dismissed_at IS NULL;

-- Cleanup cron — plain index on created_at for the daily DELETE
CREATE INDEX idx_notifications_cleanup
  ON notifications (created_at);
```

**RLS + column-level grants:**

```sql
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can read their own notifications
CREATE POLICY notifications_select ON notifications
  FOR SELECT USING (user_id = auth.uid());

-- No INSERT policy — triggers insert via SECURITY DEFINER helper owned by postgres
-- No DELETE policy — cleanup cron uses service role

-- Column-level grant: authenticated users can only update read_at and dismissed_at
REVOKE UPDATE ON notifications FROM authenticated;
GRANT UPDATE (read_at, dismissed_at) ON notifications TO authenticated;

-- Scoped UPDATE policy (combined with column-level grants above)
CREATE POLICY notifications_update ON notifications
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

### membros — New Column

```sql
ALTER TABLE membros ADD COLUMN crm_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
```

Nullable. Named `crm_user_id` to distinguish from the existing `user_id` column (which tracks who created the membro record). Set by owner/admin in the Equipe page to map a team member to their CRM login. Used by notification triggers to resolve the target user for assignment-based notifications. If the linked CRM user is deleted, the reference is nulled out automatically.

**RLS enforcement for crm_user_id:** The existing membros RLS lets any workspace member UPDATE any membro row with no role check. To prevent agents from changing `crm_user_id` (privilege escalation — an agent could redirect admin notifications to themselves):

```sql
-- Remove UPDATE access to crm_user_id from authenticated role
REVOKE UPDATE (crm_user_id) ON membros FROM authenticated;

-- Create a SECURITY DEFINER RPC that checks caller role
CREATE OR REPLACE FUNCTION set_membro_crm_user(p_membro_id bigint, p_crm_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_conta_id uuid;
BEGIN
  SELECT role INTO v_caller_role
    FROM workspace_members
    WHERE user_id = auth.uid()
      AND workspace_id = (SELECT conta_id FROM membros WHERE id = p_membro_id);

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  UPDATE membros SET crm_user_id = p_crm_user_id WHERE id = p_membro_id;
END;
$$;
```

## Trigger Architecture

### Ownership and RLS Bypass

All helper functions and trigger functions are:
- Owned by `postgres` (the role that owns the `notifications` table)
- Declared as `SECURITY DEFINER`

This ensures triggers bypass RLS when inserting notifications. No INSERT policy is needed — the absence of one plus RLS enabled means only SECURITY DEFINER functions (owned by the table owner) and service role can insert.

### Error Handling

All trigger functions wrap their notification logic in:

```sql
BEGIN
  -- notification insert logic
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notification trigger failed: % %', SQLERRM, SQLSTATE;
END;
```

This ensures a buggy notification trigger never rolls back the underlying operation. A failed post approval, step completion, or workspace change would be far worse than a missed notification.

### Helper Functions

**resolve_notification_targets(p_workspace_id uuid, p_responsavel_id bigint, p_roles_filter text[])**

Returns `uuid[]` of user_ids to notify:

1. If `p_responsavel_id` is provided, look up `membros.crm_user_id` for that membro (may be NULL)
2. Add workspace users whose role is in `p_roles_filter` (e.g., `'{owner,admin}'`) via `workspace_members`
3. Deduplicate — if the responsável is also an admin, they appear once
4. Return the array of unique non-NULL user_ids

Note: `resolve_notification_targets` takes `workspace_id` as its parameter. Triggers on tables that use `conta_id` (workflows, workflow_etapas via JOIN, workflow_posts, membros) pass their `conta_id` value as the `workspace_id` argument — same UUID, different column name.

**insert_notification_batch(p_workspace_id uuid, p_user_ids uuid[], p_type text, p_link text, p_metadata jsonb, p_exclude_actor uuid DEFAULT NULL)**

Inserts one notification row per user_id. Skips NULLs in the array. Excludes `p_exclude_actor` from the batch so users don't notify themselves.

Both functions are `SECURITY DEFINER` owned by `postgres`.

### Actor Exclusion Behavior

For CRM-originated triggers (workflow_etapas, workflow_posts, workspace_members), the actor is excluded via `auth.uid()`. When `auth.uid()` is NULL (cron jobs, service-role admin tooling without a JWT), no one is excluded — all target users get notified. This is intentional: cron-generated notifications (like deadline reminders) have no human actor to exclude.

### Trigger WHEN Clauses

Every trigger uses explicit `WHEN` clauses to prevent firing on no-op updates:

| Trigger | WHEN clause |
|---------|-------------|
| `step_activated` | `WHEN (NEW.status = 'ativo' AND OLD.status IS DISTINCT FROM NEW.status)` |
| `step_completed` | `WHEN (NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM NEW.status)` |
| `post_assigned` | `WHEN (NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id AND NEW.responsavel_id IS NOT NULL)` |
| `workflow_completed` | `WHEN (NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM NEW.status)` |
| `member_role_changed` | `WHEN (NEW.role IS DISTINCT FROM OLD.role)` |
| `briefing_answered` | `WHEN (OLD.answer IS NULL AND NEW.answer IS NOT NULL)` |

`IS DISTINCT FROM` handles NULL safely and prevents re-firing when an UPDATE touches the row without changing the relevant column.

`post_assigned` additionally requires `NEW.responsavel_id IS NOT NULL` — un-assignment (value → NULL) does not fire the trigger because there is no new responsável to notify. Owners/admins learn about un-assignments through other channels (the workflow board itself).

### Trigger Map

**Hub / Client Actions** (no actor exclusion — clients are external):

- `post_approvals` AFTER INSERT → JOIN `workflow_posts` on `post_id` to get `responsavel_id` and `workflow_id`, JOIN `workflows` to get `conta_id` (→ `workspace_id`) and `cliente_id`, JOIN `clientes` to get client name → check `action` column → `post_approved` / `post_correction` / `post_message`. Metadata includes client name, post title. Link points to workflow post detail route.
- `ideias` AFTER INSERT → use `NEW.workspace_id` directly (ideias has its own `workspace_id` column), JOIN `clientes` on `cliente_id` to get client name → `idea_submitted`. Metadata includes client name, idea title.
- `hub_briefing_questions` AFTER UPDATE → WHEN `OLD.answer IS NULL AND NEW.answer IS NOT NULL` → `briefing_answered`

**Workflow / Team** (exclude actor via `auth.uid()`):

- `workflow_etapas` AFTER UPDATE → WHEN `NEW.status = 'ativo' AND OLD.status IS DISTINCT FROM NEW.status` → JOIN `workflows` to get `conta_id` (→ `workspace_id`) → `step_activated`
- `workflow_etapas` AFTER UPDATE → WHEN `NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM NEW.status` → JOIN `workflows` to get `conta_id` (→ `workspace_id`) → `step_completed`
- `workflow_posts` AFTER UPDATE → WHEN `NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id AND NEW.responsavel_id IS NOT NULL` → JOIN `workflows` via `workflow_id` to get `conta_id` (→ `workspace_id`) → `post_assigned`
- `workflows` AFTER UPDATE → WHEN `NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM NEW.status` → use `NEW.conta_id` (→ `workspace_id`) → `workflow_completed`

**Workspace** (owner/admin only, exclude actor):

- `workspace_members` AFTER INSERT → `invite_accepted`
- `workspace_members` AFTER UPDATE → WHEN `NEW.role IS DISTINCT FROM OLD.role` → `member_role_changed`
- `workspace_members` AFTER DELETE → `member_removed`

### Notification Metadata by Type

Each trigger stores structured metadata for client-side rendering:

| Type | metadata keys |
|------|---------------|
| `post_approved` | `client_name`, `post_title`, `workflow_id`, `post_id` |
| `post_correction` | `client_name`, `post_title`, `workflow_id`, `post_id`, `comentario` |
| `post_message` | `client_name`, `post_title`, `workflow_id`, `post_id`, `comentario` |
| `idea_submitted` | `client_name`, `idea_title`, `idea_id` |
| `briefing_answered` | `client_name`, `question_text` |
| `step_activated` | `client_name`, `workflow_title`, `step_name`, `workflow_id`, `etapa_id` |
| `step_completed` | `client_name`, `workflow_title`, `step_name`, `workflow_id`, `etapa_id` |
| `post_assigned` | `client_name`, `post_title`, `workflow_id`, `post_id` |
| `workflow_completed` | `client_name`, `workflow_title`, `workflow_id` |
| `deadline_approaching` | `client_name`, `workflow_title`, `step_name`, `workflow_id`, `etapa_id`, `deadline_date` |
| `invite_accepted` | `user_name`, `user_email` |
| `member_role_changed` | `user_name`, `old_role`, `new_role` |
| `member_removed` | `user_name` |

Note: `briefing_answered` reads the `question` column from `hub_briefing_questions` and stores it as `question_text` in metadata. The `question` column contains the question label text.

### Deadline Cron

A daily edge function (`notification-deadline-cron`) queries `workflow_etapas` for steps where `data_limite = CURRENT_DATE + 1` (tomorrow) and `status = 'ativo'`. Uses `CURRENT_DATE + 1` rather than an interval to avoid timezone ambiguity — `data_limite` is a `date` column, not `timestamptz`.

**Idempotency:** The cron deduplicates via `NOT EXISTS (SELECT 1 FROM notifications WHERE type = 'deadline_approaching' AND metadata->>'etapa_id' = etapa.id::text AND created_at >= CURRENT_DATE)`. This prevents duplicate notifications if the cron runs multiple times in a day (manual rerun, redeploy retry, schedule overlap).

Authenticated via `x-cron-secret` header.

### Cleanup Cron

A daily edge function (`notification-cleanup-cron`) deletes notifications older than 90 days:

```sql
DELETE FROM notifications WHERE created_at < now() - interval '90 days';
```

Authenticated via `x-cron-secret` header. Uses service role to bypass RLS.

## Frontend Data Layer

### store.ts Functions

```typescript
getNotifications(limit?: number, offset?: number): Promise<Notification[]>
// SELECT * FROM notifications WHERE dismissed_at IS NULL ORDER BY created_at DESC
// RLS handles user_id filtering

getUnreadNotificationCount(): Promise<number>
// SELECT count(*) FROM notifications WHERE read_at IS NULL AND dismissed_at IS NULL
// Lightweight query for badge — runs every 60s

markNotificationAsRead(id: string): Promise<void>
// UPDATE notifications SET read_at = now() WHERE id = $1

markAllNotificationsAsRead(): Promise<void>
// UPDATE notifications SET read_at = now() WHERE read_at IS NULL AND dismissed_at IS NULL
// Scoped to non-dismissed only — avoids touching dismissed rows

dismissNotification(id: string): Promise<void>
// UPDATE notifications SET dismissed_at = now() WHERE id = $1
```

### Notification Type — TypeScript

```typescript
interface Notification {
  id: string;
  workspace_id: string;
  user_id: string;
  type: NotificationType;
  metadata: Record<string, unknown>;
  link: string | null;
  read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
}

type NotificationType =
  | 'post_approved' | 'post_correction' | 'post_message'
  | 'idea_submitted' | 'briefing_answered'
  | 'step_activated' | 'step_completed' | 'post_assigned'
  | 'workflow_completed' | 'deadline_approaching'
  | 'invite_accepted' | 'member_role_changed' | 'member_removed';
```

### useNotifications Hook

Custom hook wrapping TanStack Query. Returns:

- `notifications: Notification[]` — non-dismissed, newest first
- `unreadCount: number` — for badge display
- `markAsRead(id)` — mutation with optimistic update
- `markAllAsRead()` — mutation with optimistic update
- `dismiss(id)` — mutation with optimistic removal

Query configuration:

| Setting | Unread count query | Full list query |
|---------|-------------------|-----------------|
| queryKey | `['notifications-unread-count']` | `['notifications']` |
| refetchInterval | 60,000ms (always) | 60,000ms (only while popover open) |
| refetchOnWindowFocus | true | true |
| staleTime | 30,000ms | 30,000ms |
| enabled | always | only when popover is open |

**Pagination:** `getNotifications` defaults to `limit = 50`. The popover loads the first 50 non-dismissed notifications. If there are more, a "Ver todas" link at the bottom of the list navigates to a future full-page notifications view (not in scope for v1 — the link is rendered but disabled). For v1, 50 is sufficient for typical CRM usage.

### Notification Display Config

`NOTIFICATION_CONFIG` maps each type to its icon, color, and a function that derives title/body from metadata. Template interpolation falls back gracefully for missing keys (e.g., `metadata.client_name ?? 'Cliente'`):

| Type | Icon (lucide-react) | Color | Title template (pt-BR) |
|------|---------------------|-------|------------------------|
| `post_approved` | CheckCircle | success (#3ecf8e) | "Post aprovado" / body: "{client_name} — {post_title}" |
| `post_correction` | AlertTriangle | warning (#f5a342) | "Correção solicitada" / body: "{client_name} — {post_title}" |
| `post_message` | MessageSquare | teal (#42c8f5) | "Nova mensagem do cliente" / body: "{client_name} — {post_title}" |
| `idea_submitted` | Lightbulb | primary (#eab308) | "Nova ideia do cliente" / body: "{client_name} — {idea_title}" |
| `briefing_answered` | ClipboardCheck | success (#3ecf8e) | "Briefing respondido" / body: "{client_name} — {question_text}" |
| `step_activated` | Play | teal (#42c8f5) | "Nova etapa ativada para você" / body: "{client_name} — Etapa \"{step_name}\"" |
| `step_completed` | CheckSquare | success (#3ecf8e) | "Etapa concluída" / body: "{client_name} — {workflow_title}" |
| `post_assigned` | UserPlus | teal (#42c8f5) | "Post atribuído a você" / body: "{client_name} — {post_title}" |
| `workflow_completed` | Trophy | primary (#eab308) | "Workflow concluído" / body: "{client_name} — {workflow_title}" |
| `deadline_approaching` | Clock | danger (#f55a42) | "Prazo amanhã" / body: "{client_name} — Etapa \"{step_name}\"" |
| `invite_accepted` | UserCheck | success (#3ecf8e) | "Convite aceito" / body: "{user_name} entrou no workspace" |
| `member_role_changed` | Shield | warning (#f5a342) | "Cargo alterado" / body: "{user_name}: {old_role} → {new_role}" |
| `member_removed` | UserMinus | danger (#f55a42) | "Membro removido" / body: "{user_name}" |

## UI Components

### Component Tree

```
TopBarActions (existing)
  ├── NotificationBell — bell icon + unread count badge
  │   └── NotificationPopover — Radix Popover
  │       ├── Header — "Notificações" + filter icon + mark all read
  │       ├── NotificationList — scrollable list
  │       │   └── NotificationItem — single notification row
  │       └── Empty state — "Nenhuma notificação"
  └── CrispButton (existing, unchanged)
```

### NotificationBell

- Replaces the current static `<button>` with bell icon in TopBarActions
- Shows unread count badge (primary yellow, 99+ cap) when count > 0
- No badge shown when count is 0

### NotificationPopover

- Component: Radix Popover (shadcn/ui)
- Width: 380px desktop, `calc(100vw - 2rem)` mobile
- Max height: 480px with `overflow-y: auto`
- Position: right-aligned to bell button
- Border radius: 16px
- Background: `var(--surface-main)` with border

### NotificationItem

- Icon badge (32x32px, rounded 8px, color-coded background)
- Title (0.82rem, weight 500 unread / 400 read)
- Body text (0.75rem, muted, truncated with ellipsis)
- Relative timestamp via `date-fns` `formatDistanceToNow` with pt-BR locale
- Unread dot (8px, primary yellow) on the right for unread items
- Read items rendered at 0.6 opacity
- **Click behavior depends on `link`:**
  - If `link` is non-null → mark as read + navigate to route + close popover
  - If `link` is null (e.g., `member_removed`, `member_role_changed`) → mark as read only, no navigation
- Dismiss via hover X button

### Popover Header

- "Notificações" title (weight 700)
- Filter icon — toggles between showing all / unread only
- Mark all read icon (checkmark circle) — sets `read_at` on all non-dismissed unread

### Empty State

- Bell icon in muted container
- "Nenhuma notificação" primary text
- "Notificações sobre sua conta e atividades aparecerão aqui" secondary text

## Membros Linking UI

The Equipe page gets a new optional field when editing a membro: a dropdown to select a workspace user to link. This sets `membros.crm_user_id` via the `set_membro_crm_user` RPC (not a direct UPDATE). Only owners and admins can call this RPC.

**Unlinked members warning:** The Equipe page shows a subtle indicator on membros that have no `crm_user_id` set — e.g., a small "sem conta vinculada" badge. This surfaces the foot-gun where a membro assigned as `responsavel_id` on posts/steps wouldn't receive notifications because they're not linked to a CRM user. No blocking modal — just visibility.

## Files to Create/Modify

### New files
- `supabase/migrations/XXXXXXXX_notifications.sql` — table, indexes, RLS, column grants, triggers, helper functions, membros ALTER, set_membro_crm_user RPC
- `supabase/functions/notification-deadline-cron/index.ts` — daily deadline check with idempotency
- `supabase/functions/notification-cleanup-cron/index.ts` — daily 90-day cleanup
- `apps/crm/src/hooks/useNotifications.ts` — TanStack Query hook
- `apps/crm/src/components/layout/NotificationBell.tsx` — bell + badge
- `apps/crm/src/components/layout/NotificationPopover.tsx` — popover panel
- `apps/crm/src/components/layout/NotificationList.tsx` — scrollable list
- `apps/crm/src/components/layout/NotificationItem.tsx` — single row

### Modified files
- `apps/crm/src/store.ts` — add Notification type + CRUD functions + set_membro_crm_user RPC call
- `apps/crm/src/components/layout/TopBarActions.tsx` — replace static bell with NotificationBell
- `apps/crm/src/pages/equipe/EquipePage.tsx` — add crm_user_id dropdown via RPC + unlinked warning badge
