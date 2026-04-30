# Notification System — Design Spec

In-app notification center for the CRM. Surfaces events from Hub client actions, workflow progress, and workspace changes via a bell icon popover in the top bar.

## Decisions

- **Delivery:** In-app only, polled every 60 seconds. Supabase Realtime is unused in this codebase today; polling is the safe starting point. If multi-tab polling load becomes an issue, migrating the unread count query to a Realtime subscription is the natural next step.
- **Storage:** One row per recipient in a `notifications` table
- **Creation:** Postgres AFTER triggers on source tables (no application-level inserts)
- **Content:** Triggers store only `type` + `metadata`. Title and body are derived client-side from `NOTIFICATION_CONFIG` — this avoids hardcoding Portuguese strings in SQL and allows copy changes without migrations.
- **Lifecycle:** Auto-delete after 90 days via daily cron
- **Linking:** New `membros.linked_user_id` column maps team members to CRM users for notification routing
- **Column naming:** New tables in this codebase have been moving toward `workspace_id` (ideias, workspace_members). The `notifications` table follows this convention and uses `workspace_id` instead of `conta_id`.

## Notification Types

### Hub / Client Actions

| Type | Source table | Trigger | Recipients |
|------|-------------|---------|------------|
| `post_approved` | post_approvals | AFTER INSERT, action = 'aprovado' | Assigned membro's linked user + owners/admins |
| `post_correction` | post_approvals | AFTER INSERT, action = 'correcao' | Assigned membro's linked user + owners/admins |
| `post_message` | post_approvals | AFTER INSERT, action = 'mensagem' | Assigned membro's linked user + owners/admins |
| `idea_submitted` | ideias | AFTER INSERT, status = 'nova' | All owners/admins |
| `briefing_answered` | hub_briefing_questions | AFTER UPDATE, answer changed from NULL | All owners/admins |

### Workflow / Team

| Type | Source table | Trigger | Recipients |
|------|-------------|---------|------------|
| `step_activated` | workflow_etapas | AFTER UPDATE, status → 'ativo' | Step's responsável's linked user + owners/admins |
| `step_completed` | workflow_etapas | AFTER UPDATE, status → 'concluido' | Owners/admins (actor excluded) |
| `post_assigned` | workflow_posts | AFTER UPDATE, responsavel_id changed | New responsável's linked user + owners/admins (actor excluded, including self-assignment — self-assigning produces no notification) |
| `workflow_completed` | workflows | AFTER UPDATE, status → 'concluido' (NOT from 'arquivado') | All owners/admins (actor excluded) |
| `deadline_approaching` | workflow_etapas | Daily cron, data_limite = tomorrow's date | Step's responsável's linked user + owners/admins |

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

-- No UPDATE policy — writes go through SECURITY DEFINER RPCs
-- No INSERT policy — triggers insert via SECURITY DEFINER helper owned by postgres
-- No DELETE policy — cleanup cron uses service role

-- Column-level grant: authenticated users can only update read_at and dismissed_at
REVOKE UPDATE ON notifications FROM authenticated;
GRANT UPDATE (read_at, dismissed_at) ON notifications TO authenticated;
```

Then add a scoped UPDATE policy:

```sql
CREATE POLICY notifications_update ON notifications
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

Combined with the column-level REVOKE/GRANT, this lets users only update `read_at` and `dismissed_at` on their own rows.

### membros — New Column

```sql
ALTER TABLE membros ADD COLUMN linked_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
```

Nullable. Set by owner/admin in the Equipe page to map a team member to their CRM login. Used by notification triggers to resolve the target user for assignment-based notifications. If the linked CRM user is deleted, the reference is nulled out automatically.

## Trigger Architecture

### Ownership and RLS Bypass

All helper functions and trigger functions are:
- Owned by `postgres` (the role that owns the `notifications` table)
- Declared as `SECURITY DEFINER`

This ensures triggers bypass RLS when inserting notifications. No INSERT policy is needed — the absence of one plus RLS enabled means only SECURITY DEFINER functions (owned by the table owner) and service role can insert.

### Helper Functions

**resolve_notification_targets(p_workspace_id uuid, p_responsavel_id bigint, p_roles_filter text[])**

Returns `uuid[]` of user_ids to notify:

1. If `p_responsavel_id` is provided, look up `membros.linked_user_id` for that membro (may be NULL)
2. Add workspace users whose role is in `p_roles_filter` (e.g., `'{owner,admin}'`) via `workspace_members`
3. Deduplicate — if the responsável is also an admin, they appear once
4. Return the array of unique non-NULL user_ids

**insert_notification_batch(p_workspace_id uuid, p_user_ids uuid[], p_type text, p_link text, p_metadata jsonb, p_exclude_actor uuid DEFAULT NULL)**

Inserts one notification row per user_id. Skips NULLs in the array. Excludes `p_exclude_actor` from the batch so users don't notify themselves.

Both functions are `SECURITY DEFINER` owned by `postgres`.

### Actor Exclusion Behavior

For CRM-originated triggers (workflow_etapas, workflow_posts, workspace_members), the actor is excluded via `auth.uid()`. When `auth.uid()` is NULL (cron jobs, service-role admin tooling without a JWT), no one is excluded — all target users get notified. This is intentional: cron-generated notifications (like deadline reminders) have no human actor to exclude.

### Trigger Map

**Hub / Client Actions** (no actor exclusion — clients are external):

- `post_approvals` AFTER INSERT → JOIN `workflow_posts` on `post_id` to get `responsavel_id` and `workflow_id`, JOIN `workflows` to get `workspace_id` and `cliente_id` → check `action` column → `post_approved` / `post_correction` / `post_message`. Metadata includes client name, post title. Link points to workflow post detail route.
- `ideias` AFTER INSERT → use `NEW.workspace_id` directly (ideias has its own `workspace_id` column) → `idea_submitted`. Metadata includes client name, idea title.
- `hub_briefing_questions` AFTER UPDATE (answer changed from NULL) → `briefing_answered`

**Workflow / Team** (exclude actor via `auth.uid()`):

- `workflow_etapas` AFTER UPDATE (status → 'ativo') → `step_activated`
- `workflow_etapas` AFTER UPDATE (status → 'concluido') → `step_completed`
- `workflow_posts` AFTER UPDATE (responsavel_id changed) → `post_assigned`. Actor is excluded — this means self-assignment produces no notification, which is intentional (you don't need to be told about your own action).
- `workflows` AFTER UPDATE (status → 'concluido' AND OLD.status != 'arquivado') → `workflow_completed`. The extra OLD.status check prevents double-notification if a workflow transits through 'concluido' on the way to 'arquivado'.

**Workspace** (owner/admin only, exclude actor):

- `workspace_members` AFTER INSERT → `invite_accepted`
- `workspace_members` AFTER UPDATE (role changed) → `member_role_changed`
- `workspace_members` AFTER DELETE → `member_removed`

### Notification Metadata by Type

Each trigger stores structured metadata for client-side rendering:

| Type | metadata keys |
|------|---------------|
| `post_approved` | `client_name`, `post_title`, `workflow_id`, `post_id` |
| `post_correction` | `client_name`, `post_title`, `workflow_id`, `post_id`, `comentario` |
| `post_message` | `client_name`, `post_title`, `workflow_id`, `post_id`, `comentario` |
| `idea_submitted` | `client_name`, `idea_title`, `idea_id` |
| `briefing_answered` | `client_name`, `question_label` |
| `step_activated` | `client_name`, `workflow_title`, `step_name`, `workflow_id` |
| `step_completed` | `client_name`, `workflow_title`, `step_name`, `workflow_id` |
| `post_assigned` | `client_name`, `post_title`, `workflow_id`, `post_id` |
| `workflow_completed` | `client_name`, `workflow_title`, `workflow_id` |
| `deadline_approaching` | `client_name`, `workflow_title`, `step_name`, `workflow_id`, `deadline_date` |
| `invite_accepted` | `user_name`, `user_email` |
| `member_role_changed` | `user_name`, `old_role`, `new_role` |
| `member_removed` | `user_name` |

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

### Notification Display Config

`NOTIFICATION_CONFIG` maps each type to its icon, color, and a function that derives title/body from metadata:

| Type | Icon (lucide-react) | Color | Title template (pt-BR) |
|------|---------------------|-------|------------------------|
| `post_approved` | CheckCircle | success (#3ecf8e) | "Post aprovado" / body: "{client_name} — {post_title}" |
| `post_correction` | AlertTriangle | warning (#f5a342) | "Correção solicitada" / body: "{client_name} — {post_title}" |
| `post_message` | MessageSquare | teal (#42c8f5) | "Nova mensagem do cliente" / body: "{client_name} — {post_title}" |
| `idea_submitted` | Lightbulb | primary (#eab308) | "Nova ideia do cliente" / body: "{client_name} — {idea_title}" |
| `briefing_answered` | ClipboardCheck | success (#3ecf8e) | "Briefing respondido" / body: "{client_name} — {question_label}" |
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
- Click → mark as read + navigate to `link` + close popover
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

The Equipe page gets a new optional field when editing a membro: a dropdown to select a workspace user to link. This sets `membros.linked_user_id`. Only owners and admins can set this field.

**Unlinked members warning:** The Equipe page shows a subtle indicator on membros that have no `linked_user_id` set — e.g., a small "sem conta vinculada" badge. This surfaces the foot-gun where a membro assigned as `responsavel_id` on posts/steps wouldn't receive notifications because they're not linked to a CRM user. No blocking modal — just visibility.

## Files to Create/Modify

### New files
- `supabase/migrations/XXXXXXXX_notifications.sql` — table, indexes, RLS, column grants, triggers, helper functions, membros ALTER
- `supabase/functions/notification-deadline-cron/index.ts` — daily deadline check with idempotency
- `supabase/functions/notification-cleanup-cron/index.ts` — daily 90-day cleanup
- `apps/crm/src/hooks/useNotifications.ts` — TanStack Query hook
- `apps/crm/src/components/layout/NotificationBell.tsx` — bell + badge
- `apps/crm/src/components/layout/NotificationPopover.tsx` — popover panel
- `apps/crm/src/components/layout/NotificationList.tsx` — scrollable list
- `apps/crm/src/components/layout/NotificationItem.tsx` — single row

### Modified files
- `apps/crm/src/store.ts` — add Notification type + CRUD functions
- `apps/crm/src/components/layout/TopBarActions.tsx` — replace static bell with NotificationBell
- `apps/crm/src/pages/equipe/EquipePage.tsx` — add linked_user_id dropdown + unlinked warning badge
