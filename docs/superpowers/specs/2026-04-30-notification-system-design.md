# Notification System — Design Spec

In-app notification center for the CRM. Surfaces events from Hub client actions, workflow progress, and workspace changes via a bell icon popover in the top bar.

## Decisions

- **Delivery:** In-app only, polled every 60 seconds
- **Storage:** One row per recipient in a `notifications` table
- **Creation:** Postgres AFTER triggers on source tables (no application-level inserts)
- **Lifecycle:** Auto-delete after 90 days via daily cron
- **Linking:** New `membros.linked_user_id` column maps team members to CRM users for notification routing

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
| `post_assigned` | workflow_posts | AFTER UPDATE, responsavel_id changed | New responsável's linked user + owners/admins (actor excluded) |
| `workflow_completed` | workflows | AFTER UPDATE, status → 'concluido' | All owners/admins (actor excluded) |
| `deadline_approaching` | workflow_etapas | Daily cron, data_limite within 24h | Step's responsável's linked user + owners/admins |

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
  conta_id      uuid NOT NULL REFERENCES workspaces(id),
  user_id       uuid NOT NULL REFERENCES auth.users(id),
  type          text NOT NULL,
  title         text NOT NULL,
  body          text,
  link          text,
  metadata      jsonb DEFAULT '{}',
  read_at       timestamptz,
  dismissed_at  timestamptz,
  created_at    timestamptz DEFAULT now()
);
```

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

-- Cleanup cron
CREATE INDEX idx_notifications_cleanup
  ON notifications (created_at)
  WHERE created_at < now() - interval '90 days';
```

**RLS:**

```sql
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can read their own notifications
CREATE POLICY notifications_select ON notifications
  FOR SELECT USING (user_id = auth.uid());

-- Users can update read_at/dismissed_at on their own notifications
CREATE POLICY notifications_update ON notifications
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Only service role can insert (triggers use SECURITY DEFINER)
-- Only service role can delete (cleanup cron)
```

### membros — New Column

```sql
ALTER TABLE membros ADD COLUMN linked_user_id uuid REFERENCES auth.users(id);
```

Nullable. Set by owner/admin in the Equipe page to map a team member to their CRM login. Used by notification triggers to resolve the target user for assignment-based notifications.

## Trigger Architecture

### Helper Functions

**resolve_notification_targets(p_conta_id uuid, p_responsavel_id bigint, p_roles_filter text[])**

Returns `uuid[]` of user_ids to notify:

1. If `p_responsavel_id` is provided, look up `membros.linked_user_id` for that membro
2. Add workspace users whose role is in `p_roles_filter` (e.g., `'{owner,admin}'`)
3. Deduplicate — if the responsável is also an admin, they appear once
4. Return the array of unique user_ids

**insert_notification_batch(p_conta_id uuid, p_user_ids uuid[], p_type text, p_title text, p_body text, p_link text, p_metadata jsonb, p_exclude_actor uuid)**

Inserts one notification row per user_id. Skips NULLs in the array. Excludes `p_exclude_actor` from the batch so users don't notify themselves.

Both functions are `SECURITY DEFINER` to bypass RLS for inserts.

### Trigger Map

**Hub / Client Actions** (no actor exclusion — clients are external):

- `post_approvals` AFTER INSERT → JOIN `workflow_posts` on `post_id` to get `responsavel_id` and `workflow_id` → check `action` column → `post_approved` / `post_correction` / `post_message`. The `link` field points to the workflow post detail route.
- `ideias` AFTER INSERT → JOIN `clientes` on `cliente_id` to get `conta_id` and client name → `idea_submitted`
- `hub_briefing_questions` AFTER UPDATE (answer changed from NULL) → `briefing_answered`

**Workflow / Team** (exclude actor via `auth.uid()`):

- `workflow_etapas` AFTER UPDATE (status → 'ativo') → `step_activated`
- `workflow_etapas` AFTER UPDATE (status → 'concluido') → `step_completed`
- `workflow_posts` AFTER UPDATE (responsavel_id changed) → `post_assigned`
- `workflows` AFTER UPDATE (status → 'concluido') → `workflow_completed`

**Workspace** (owner/admin only, exclude actor):

- `workspace_members` AFTER INSERT → `invite_accepted`
- `workspace_members` AFTER UPDATE (role changed) → `member_role_changed`
- `workspace_members` AFTER DELETE → `member_removed`

### Deadline Cron

A daily edge function (`notification-deadline-cron`) queries `workflow_etapas` for steps with `data_limite` within 24 hours that are `status = 'ativo'`, and inserts `deadline_approaching` notifications. Authenticated via `x-cron-secret` header.

### Cleanup Cron

A daily edge function (`notification-cleanup-cron`) deletes notifications older than 90 days. Authenticated via `x-cron-secret` header.

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
// UPDATE notifications SET read_at = now() WHERE read_at IS NULL

dismissNotification(id: string): Promise<void>
// UPDATE notifications SET dismissed_at = now() WHERE id = $1
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

### Notification Type Config

A `NOTIFICATION_CONFIG` constant maps each type to its display properties:

| Type | Icon (lucide-react) | Color |
|------|---------------------|-------|
| `post_approved` | CheckCircle | success (#3ecf8e) |
| `post_correction` | AlertTriangle | warning (#f5a342) |
| `post_message` | MessageSquare | teal (#42c8f5) |
| `idea_submitted` | Lightbulb | primary (#eab308) |
| `briefing_answered` | ClipboardCheck | success (#3ecf8e) |
| `step_activated` | Play | teal (#42c8f5) |
| `step_completed` | CheckSquare | success (#3ecf8e) |
| `post_assigned` | UserPlus | teal (#42c8f5) |
| `workflow_completed` | Trophy | primary (#eab308) |
| `deadline_approaching` | Clock | danger (#f55a42) |
| `invite_accepted` | UserCheck | success (#3ecf8e) |
| `member_role_changed` | Shield | warning (#f5a342) |
| `member_removed` | UserMinus | danger (#f55a42) |

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
- Mark all read icon (checkmark circle) — sets `read_at` on all unread

### Empty State

- Bell icon in muted container
- "Nenhuma notificação" primary text
- "Notificações sobre sua conta e atividades aparecerão aqui" secondary text

## Membros Linking UI

The Equipe page gets a new optional field when editing a membro: a dropdown to select a workspace user to link. This sets `membros.linked_user_id`. Only owners and admins can set this field.

## Files to Create/Modify

### New files
- `supabase/migrations/XXXXXXXX_notifications.sql` — table, indexes, RLS, triggers, helper functions
- `supabase/functions/notification-deadline-cron/index.ts` — daily deadline check
- `supabase/functions/notification-cleanup-cron/index.ts` — daily 90-day cleanup
- `apps/crm/src/hooks/useNotifications.ts` — TanStack Query hook
- `apps/crm/src/components/layout/NotificationBell.tsx` — bell + badge
- `apps/crm/src/components/layout/NotificationPopover.tsx` — popover panel
- `apps/crm/src/components/layout/NotificationList.tsx` — scrollable list
- `apps/crm/src/components/layout/NotificationItem.tsx` — single row

### Modified files
- `apps/crm/src/store.ts` — add Notification type + CRUD functions
- `apps/crm/src/components/layout/TopBarActions.tsx` — replace static bell with NotificationBell
- `apps/crm/src/pages/equipe/EquipePage.tsx` — add linked_user_id dropdown to membro form
