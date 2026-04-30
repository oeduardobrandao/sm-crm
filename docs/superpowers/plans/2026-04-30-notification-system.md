# Notification System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an in-app notification center surfaced via a bell popover in the CRM top bar — covering DB schema, Postgres triggers, two daily edge crons, frontend data layer, UI components, and an Equipe-page admin field for linking membros to CRM users.

**Architecture:** Postgres AFTER triggers (SECURITY DEFINER, owned by `postgres`) write rows to a `notifications` table. The frontend polls every 60s via TanStack Query. Display copy is derived client-side from `type` + `metadata`. Two daily crons (deadline reminders + 90-day cleanup) run via pg_cron + edge functions. Source spec: `docs/superpowers/specs/2026-04-30-notification-system-design.md`.

**Tech Stack:** Postgres (pg_cron, pg_net, vault), Supabase Edge Functions (Deno), React 19, TanStack Query, Radix Popover, lucide-react, date-fns ptBR.

**Branch:** `ebs/notification-center` (already checked out, working tree clean).

**Migration filename:** `supabase/migrations/20260430000001_notifications.sql` (today = 2026-04-30).

**Parallelization notes for subagent dispatch:**
- Tasks 1–6 are **sequential** (single migration file, each task appends).
- Tasks 7 and 8 (edge functions) can run **in parallel** with each other once Task 1 lands.
- Task 9 (cron schedule) depends on Tasks 7 + 8 being deployed; it adds a new migration file.
- Tasks 10–17 are mostly sequential frontend chain; Task 18 (EquipePage) can run in parallel with Tasks 12–17 once Task 10 lands.

---

## File Structure

**New files:**
- `supabase/migrations/20260430000001_notifications.sql` — table, indexes, RLS, column grants, helper fns, trigger fns, triggers, membros ALTER, set_membro_crm_user RPC
- `supabase/migrations/20260430000002_schedule_notification_crons.sql` — pg_cron schedules for deadline + cleanup edge functions
- `supabase/functions/notification-deadline-cron/index.ts` — Deno.serve wiring
- `supabase/functions/notification-deadline-cron/handler.ts` — auth gate factory
- `supabase/functions/notification-cleanup-cron/index.ts` — Deno.serve wiring
- `supabase/functions/notification-cleanup-cron/handler.ts` — auth gate factory
- `apps/crm/src/hooks/useNotifications.ts` — TanStack Query hook
- `apps/crm/src/lib/notification-config.ts` — type → icon/color/title/body map
- `apps/crm/src/components/layout/NotificationBell.tsx` — bell + badge + popover trigger
- `apps/crm/src/components/layout/NotificationPopover.tsx` — popover panel (header + list + empty state)
- `apps/crm/src/components/layout/NotificationList.tsx` — scrollable list
- `apps/crm/src/components/layout/NotificationItem.tsx` — single row
- `apps/crm/src/components/layout/__tests__/NotificationBell.test.tsx`
- `apps/crm/src/components/layout/__tests__/NotificationItem.test.tsx`
- `apps/crm/src/components/layout/__tests__/NotificationPopover.test.tsx`
- `apps/crm/src/hooks/__tests__/useNotifications.test.tsx`

**Modified files:**
- `apps/crm/src/store.ts` — append Notification type + CRUD functions + `setMembroCrmUser` RPC wrapper
- `apps/crm/src/components/layout/TopBarActions.tsx` — replace static bell button with `<NotificationBell />`
- `apps/crm/src/pages/equipe/EquipePage.tsx` — add CRM user dropdown in edit form + "sem conta vinculada" badge
- `supabase/functions/__tests__/cron-auth_test.ts` — append auth-rejection tests for the two new crons

---

## Conventions to follow

- Migrations are pure SQL; do **not** wrap in transactions (Supabase wraps each migration). Use `IF NOT EXISTS` where helpful.
- Edge function pattern: `handler.ts` exports a factory that takes deps (`cronSecret`, `timingSafeEqual`, `run`); `index.ts` imports the factory and calls `Deno.serve()`. See `supabase/functions/express-post-cleanup-cron/` for the template.
- Edge function tests live in `supabase/functions/__tests__/cron-auth_test.ts` (existing file). Append new `Deno.test(...)` blocks following the existing pattern.
- React tests: vitest + `@testing-library/react`, file path `__tests__/<Component>.test.tsx`.
- Imports: `@/` resolves to `apps/crm/src/` in vitest and Vite.
- Toasts: use `toast` from `sonner` (not the legacy `showToast`).
- All UI text is **pt-BR**. Match copy exactly as specified in the spec's `NOTIFICATION_CONFIG` table.

---

## Task 1: Migration scaffold — table, indexes, RLS, column grants

**Files:**
- Create: `supabase/migrations/20260430000001_notifications.sql`

- [ ] **Step 1: Create the migration file with table, type CHECK, indexes, RLS, and column-level grants**

Write the file with this content:

```sql
-- =====================================================================
-- 20260430000001_notifications.sql
-- Notification system: table + RLS + indexes + column grants.
-- Subsequent sections (helpers, triggers, membros ALTER, RPC) are
-- appended in later tasks of the implementation plan.
-- =====================================================================

-- ---------- Table -----------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type          text NOT NULL,
  metadata      jsonb DEFAULT '{}'::jsonb,
  link          text,
  read_at       timestamptz,
  dismissed_at  timestamptz,
  created_at    timestamptz DEFAULT now()
);

-- ---------- Type CHECK -----------------------------------------------
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'post_approved', 'post_correction', 'post_message',
    'idea_submitted', 'briefing_answered',
    'step_activated', 'step_completed', 'post_assigned',
    'workflow_completed', 'deadline_approaching',
    'invite_accepted', 'member_role_changed', 'member_removed'
  )
);

-- ---------- Indexes ---------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_visible
  ON notifications (user_id, created_at DESC)
  WHERE dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_cleanup
  ON notifications (created_at);

-- ---------- RLS + grants ---------------------------------------------
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications
  FOR SELECT USING (user_id = auth.uid());

-- No INSERT policy — SECURITY DEFINER trigger functions (owned by postgres)
-- and the service role are the only writers.

-- No DELETE policy — cleanup cron uses service role.

-- Column-level grants: authenticated can only update read_at + dismissed_at.
REVOKE UPDATE ON notifications FROM authenticated;
GRANT UPDATE (read_at, dismissed_at) ON notifications TO authenticated;

DROP POLICY IF EXISTS notifications_update ON notifications;
CREATE POLICY notifications_update ON notifications
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

- [ ] **Step 2: Verify SQL syntax is valid by reading the file back**

Run: `head -60 supabase/migrations/20260430000001_notifications.sql`
Expected: full file echoes; no obvious typos; `IF NOT EXISTS` present on the table.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260430000001_notifications.sql
git commit -m "feat(notifications): add table, indexes, RLS, column grants"
```

---

## Task 2: Migration — membros.crm_user_id + set_membro_crm_user RPC

**Files:**
- Modify: `supabase/migrations/20260430000001_notifications.sql` (append)

- [ ] **Step 1: Append membros ALTER + RPC**

Append to the migration file:

```sql

-- =====================================================================
-- membros.crm_user_id + privileged RPC
-- =====================================================================

-- Add nullable crm_user_id (links membro → CRM auth user).
-- Distinct from the existing membros.user_id column (which tracks who
-- created the membro record — different concept entirely).
ALTER TABLE membros
  ADD COLUMN IF NOT EXISTS crm_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Existing membros RLS lets any workspace member UPDATE any membro row.
-- Strip authenticated's UPDATE access to crm_user_id specifically so
-- agents cannot redirect admin notifications to themselves.
REVOKE UPDATE (crm_user_id) ON membros FROM authenticated;

-- Privileged setter — only owners/admins can change crm_user_id.
CREATE OR REPLACE FUNCTION set_membro_crm_user(
  p_membro_id bigint,
  p_crm_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_membro_conta uuid;
BEGIN
  SELECT conta_id INTO v_membro_conta FROM membros WHERE id = p_membro_id;
  IF v_membro_conta IS NULL THEN
    RAISE EXCEPTION 'Membro not found';
  END IF;

  SELECT role INTO v_caller_role
    FROM workspace_members
    WHERE user_id = auth.uid()
      AND workspace_id = v_membro_conta;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  UPDATE membros SET crm_user_id = p_crm_user_id WHERE id = p_membro_id;
END;
$$;

REVOKE ALL ON FUNCTION set_membro_crm_user(bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_membro_crm_user(bigint, uuid) TO authenticated;
```

- [ ] **Step 2: Verify by re-reading the file tail**

Run: `tail -50 supabase/migrations/20260430000001_notifications.sql`
Expected: shows the RPC body and the GRANT EXECUTE line.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260430000001_notifications.sql
git commit -m "feat(notifications): add membros.crm_user_id + set_membro_crm_user RPC"
```

---

## Task 3: Migration — helper functions (resolve_notification_targets, insert_notification_batch)

**Files:**
- Modify: `supabase/migrations/20260430000001_notifications.sql` (append)

- [ ] **Step 1: Append helper functions**

```sql

-- =====================================================================
-- Helper functions (SECURITY DEFINER, owned by postgres)
-- =====================================================================

-- Resolve recipients for a notification.
-- Returns a deduped uuid[] of CRM user_ids to notify:
--   1. If p_responsavel_id is given, append membros.crm_user_id (may be NULL → skipped)
--   2. Append workspace_members.user_id where role IN p_roles_filter
CREATE OR REPLACE FUNCTION resolve_notification_targets(
  p_workspace_id uuid,
  p_responsavel_id bigint,
  p_roles_filter text[]
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_targets uuid[] := '{}';
  v_responsavel_user uuid;
BEGIN
  IF p_responsavel_id IS NOT NULL THEN
    SELECT crm_user_id INTO v_responsavel_user
      FROM membros
      WHERE id = p_responsavel_id;
    IF v_responsavel_user IS NOT NULL THEN
      v_targets := array_append(v_targets, v_responsavel_user);
    END IF;
  END IF;

  IF p_roles_filter IS NOT NULL AND array_length(p_roles_filter, 1) > 0 THEN
    SELECT array_agg(DISTINCT user_id) INTO v_targets
      FROM (
        SELECT unnest(v_targets) AS user_id
        UNION
        SELECT user_id
          FROM workspace_members
          WHERE workspace_id = p_workspace_id
            AND role = ANY (p_roles_filter)
      ) s
      WHERE user_id IS NOT NULL;
  END IF;

  RETURN COALESCE(v_targets, '{}');
END;
$$;

-- Insert one row per user_id. NULLs in array are skipped.
-- p_exclude_actor (if non-NULL) is removed from the recipient set so
-- users do not notify themselves on CRM-originated actions.
CREATE OR REPLACE FUNCTION insert_notification_batch(
  p_workspace_id uuid,
  p_user_ids uuid[],
  p_type text,
  p_link text,
  p_metadata jsonb,
  p_exclude_actor uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO notifications (workspace_id, user_id, type, metadata, link)
  SELECT p_workspace_id, u, p_type, COALESCE(p_metadata, '{}'::jsonb), p_link
    FROM unnest(p_user_ids) AS u
   WHERE u IS NOT NULL
     AND (p_exclude_actor IS NULL OR u <> p_exclude_actor);
END;
$$;

REVOKE ALL ON FUNCTION resolve_notification_targets(uuid, bigint, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION insert_notification_batch(uuid, uuid[], text, text, jsonb, uuid) FROM PUBLIC;
-- These helpers are only called from trigger functions (also SECURITY DEFINER)
-- so no broader EXECUTE grant is needed.
```

- [ ] **Step 2: Verify**

Run: `grep -c "CREATE OR REPLACE FUNCTION" supabase/migrations/20260430000001_notifications.sql`
Expected: `3` (set_membro_crm_user + resolve_notification_targets + insert_notification_batch).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260430000001_notifications.sql
git commit -m "feat(notifications): add resolve_notification_targets + insert_notification_batch helpers"
```

---

## Task 4: Migration — Hub/Client trigger functions + triggers

**Files:**
- Modify: `supabase/migrations/20260430000001_notifications.sql` (append)

Hub triggers do **not** exclude an actor — clients are external and not represented as CRM users.

- [ ] **Step 1: Append the three Hub trigger functions and their triggers**

```sql

-- =====================================================================
-- Hub / Client triggers
-- All wrapped in EXCEPTION blocks so notification failures never
-- roll back the underlying business operation.
-- =====================================================================

-- post_approvals AFTER INSERT → post_approved | post_correction | post_message
CREATE OR REPLACE FUNCTION trg_notify_post_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_responsavel_id bigint;
  v_workflow_id    bigint;
  v_conta_id       uuid;
  v_cliente_id     bigint;
  v_post_title     text;
  v_client_name    text;
  v_targets        uuid[];
  v_type           text;
  v_link           text;
  v_metadata       jsonb;
BEGIN
  BEGIN
    SELECT wp.responsavel_id, wp.workflow_id, wp.titulo,
           w.conta_id, w.cliente_id
      INTO v_responsavel_id, v_workflow_id, v_post_title, v_conta_id, v_cliente_id
      FROM workflow_posts wp
      JOIN workflows w ON w.id = wp.workflow_id
     WHERE wp.id = NEW.post_id;

    IF v_conta_id IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT nome INTO v_client_name FROM clientes WHERE id = v_cliente_id;

    v_type := CASE NEW.action
      WHEN 'aprovado' THEN 'post_approved'
      WHEN 'correcao' THEN 'post_correction'
      WHEN 'mensagem' THEN 'post_message'
      ELSE NULL
    END;

    IF v_type IS NULL THEN
      RETURN NEW;
    END IF;

    v_targets := resolve_notification_targets(v_conta_id, v_responsavel_id, ARRAY['owner','admin']);
    v_link := '/workflows/' || v_workflow_id || '/posts/' || NEW.post_id;
    v_metadata := jsonb_build_object(
      'client_name', v_client_name,
      'post_title',  v_post_title,
      'workflow_id', v_workflow_id,
      'post_id',     NEW.post_id
    );

    IF v_type IN ('post_correction', 'post_message') THEN
      v_metadata := v_metadata || jsonb_build_object('comentario', NEW.comentario);
    END IF;

    PERFORM insert_notification_batch(v_conta_id, v_targets, v_type, v_link, v_metadata, NULL);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_post_approval failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_post_approval ON post_approvals;
CREATE TRIGGER notify_post_approval
  AFTER INSERT ON post_approvals
  FOR EACH ROW EXECUTE FUNCTION trg_notify_post_approval();

-- ideias AFTER INSERT (status = 'nova') → idea_submitted
CREATE OR REPLACE FUNCTION trg_notify_idea_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name text;
  v_targets     uuid[];
BEGIN
  BEGIN
    IF NEW.status IS DISTINCT FROM 'nova' THEN
      RETURN NEW;
    END IF;

    SELECT nome INTO v_client_name FROM clientes WHERE id = NEW.cliente_id;

    v_targets := resolve_notification_targets(NEW.workspace_id, NULL, ARRAY['owner','admin']);

    PERFORM insert_notification_batch(
      NEW.workspace_id,
      v_targets,
      'idea_submitted',
      '/ideias/' || NEW.id,
      jsonb_build_object(
        'client_name', v_client_name,
        'idea_title',  NEW.titulo,
        'idea_id',     NEW.id
      ),
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_idea_submitted failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_idea_submitted ON ideias;
CREATE TRIGGER notify_idea_submitted
  AFTER INSERT ON ideias
  FOR EACH ROW EXECUTE FUNCTION trg_notify_idea_submitted();

-- hub_briefing_questions AFTER UPDATE (answer NULL→non-NULL) → briefing_answered
CREATE OR REPLACE FUNCTION trg_notify_briefing_answered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id uuid;
  v_client_name  text;
  v_targets      uuid[];
BEGIN
  BEGIN
    SELECT c.conta_id, c.nome
      INTO v_workspace_id, v_client_name
      FROM clientes c
     WHERE c.id = NEW.cliente_id;

    IF v_workspace_id IS NULL THEN
      RETURN NEW;
    END IF;

    v_targets := resolve_notification_targets(v_workspace_id, NULL, ARRAY['owner','admin']);

    PERFORM insert_notification_batch(
      v_workspace_id,
      v_targets,
      'briefing_answered',
      '/clientes/' || NEW.cliente_id,
      jsonb_build_object(
        'client_name',   v_client_name,
        'question_text', NEW.question
      ),
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_briefing_answered failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_briefing_answered ON hub_briefing_questions;
CREATE TRIGGER notify_briefing_answered
  AFTER UPDATE ON hub_briefing_questions
  FOR EACH ROW
  WHEN (OLD.answer IS NULL AND NEW.answer IS NOT NULL)
  EXECUTE FUNCTION trg_notify_briefing_answered();
```

- [ ] **Step 2: Verify all three triggers and functions are present**

Run: `grep -E "CREATE TRIGGER|CREATE OR REPLACE FUNCTION trg_" supabase/migrations/20260430000001_notifications.sql`
Expected: 3 trigger function declarations and 3 CREATE TRIGGER lines.

- [ ] **Step 3: Verify briefing answer column name**

Run: `grep -E "ALTER TABLE hub_briefing_questions|^\s+answer " supabase/migrations/2026*hub_briefing*.sql 2>/dev/null | head -5`
Expected: confirms `answer` is the column name (or, if no match, search the schema baseline). If the column is named differently in this codebase, update the WHEN clause and trigger function to match. (Search in the latest schema before continuing.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260430000001_notifications.sql
git commit -m "feat(notifications): add hub/client trigger functions"
```

---

## Task 5: Migration — Workflow/Team trigger functions + triggers

**Files:**
- Modify: `supabase/migrations/20260430000001_notifications.sql` (append)

These triggers exclude `auth.uid()` so the actor doesn't notify themselves. When `auth.uid()` is NULL (cron, service role), no one is excluded.

- [ ] **Step 1: Append step_activated, step_completed, post_assigned, workflow_completed**

```sql

-- =====================================================================
-- Workflow / Team triggers (actor excluded via auth.uid())
-- =====================================================================

-- workflow_etapas: status → 'ativo' (step_activated)
CREATE OR REPLACE FUNCTION trg_notify_step_activated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta_id      uuid;
  v_client_name   text;
  v_workflow_title text;
  v_targets       uuid[];
BEGIN
  BEGIN
    SELECT w.conta_id, c.nome, w.titulo
      INTO v_conta_id, v_client_name, v_workflow_title
      FROM workflows w
      LEFT JOIN clientes c ON c.id = w.cliente_id
     WHERE w.id = NEW.workflow_id;

    IF v_conta_id IS NULL THEN
      RETURN NEW;
    END IF;

    v_targets := resolve_notification_targets(v_conta_id, NEW.responsavel_id, ARRAY['owner','admin']);

    PERFORM insert_notification_batch(
      v_conta_id,
      v_targets,
      'step_activated',
      '/workflows/' || NEW.workflow_id,
      jsonb_build_object(
        'client_name',     v_client_name,
        'workflow_title',  v_workflow_title,
        'step_name',       NEW.titulo,
        'workflow_id',     NEW.workflow_id,
        'etapa_id',        NEW.id
      ),
      auth.uid()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_step_activated failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_step_activated ON workflow_etapas;
CREATE TRIGGER notify_step_activated
  AFTER UPDATE ON workflow_etapas
  FOR EACH ROW
  WHEN (NEW.status = 'ativo' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_notify_step_activated();

-- workflow_etapas: status → 'concluido' (step_completed, owners/admins only)
CREATE OR REPLACE FUNCTION trg_notify_step_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta_id      uuid;
  v_client_name   text;
  v_workflow_title text;
  v_targets       uuid[];
BEGIN
  BEGIN
    SELECT w.conta_id, c.nome, w.titulo
      INTO v_conta_id, v_client_name, v_workflow_title
      FROM workflows w
      LEFT JOIN clientes c ON c.id = w.cliente_id
     WHERE w.id = NEW.workflow_id;

    IF v_conta_id IS NULL THEN
      RETURN NEW;
    END IF;

    v_targets := resolve_notification_targets(v_conta_id, NULL, ARRAY['owner','admin']);

    PERFORM insert_notification_batch(
      v_conta_id,
      v_targets,
      'step_completed',
      '/workflows/' || NEW.workflow_id,
      jsonb_build_object(
        'client_name',     v_client_name,
        'workflow_title',  v_workflow_title,
        'step_name',       NEW.titulo,
        'workflow_id',     NEW.workflow_id,
        'etapa_id',        NEW.id
      ),
      auth.uid()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_step_completed failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_step_completed ON workflow_etapas;
CREATE TRIGGER notify_step_completed
  AFTER UPDATE ON workflow_etapas
  FOR EACH ROW
  WHEN (NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_notify_step_completed();

-- workflow_posts: responsavel_id changed (and not → NULL) (post_assigned)
CREATE OR REPLACE FUNCTION trg_notify_post_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta_id    uuid;
  v_client_name text;
  v_targets     uuid[];
BEGIN
  BEGIN
    SELECT w.conta_id, c.nome
      INTO v_conta_id, v_client_name
      FROM workflows w
      LEFT JOIN clientes c ON c.id = w.cliente_id
     WHERE w.id = NEW.workflow_id;

    IF v_conta_id IS NULL THEN
      RETURN NEW;
    END IF;

    v_targets := resolve_notification_targets(v_conta_id, NEW.responsavel_id, ARRAY['owner','admin']);

    PERFORM insert_notification_batch(
      v_conta_id,
      v_targets,
      'post_assigned',
      '/workflows/' || NEW.workflow_id || '/posts/' || NEW.id,
      jsonb_build_object(
        'client_name', v_client_name,
        'post_title',  NEW.titulo,
        'workflow_id', NEW.workflow_id,
        'post_id',     NEW.id
      ),
      auth.uid()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_post_assigned failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_post_assigned ON workflow_posts;
CREATE TRIGGER notify_post_assigned
  AFTER UPDATE ON workflow_posts
  FOR EACH ROW
  WHEN (NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id AND NEW.responsavel_id IS NOT NULL)
  EXECUTE FUNCTION trg_notify_post_assigned();

-- workflows: status → 'concluido' (workflow_completed)
CREATE OR REPLACE FUNCTION trg_notify_workflow_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name text;
  v_targets     uuid[];
BEGIN
  BEGIN
    SELECT nome INTO v_client_name FROM clientes WHERE id = NEW.cliente_id;

    v_targets := resolve_notification_targets(NEW.conta_id, NULL, ARRAY['owner','admin']);

    PERFORM insert_notification_batch(
      NEW.conta_id,
      v_targets,
      'workflow_completed',
      '/workflows/' || NEW.id,
      jsonb_build_object(
        'client_name',    v_client_name,
        'workflow_title', NEW.titulo,
        'workflow_id',    NEW.id
      ),
      auth.uid()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_workflow_completed failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_workflow_completed ON workflows;
CREATE TRIGGER notify_workflow_completed
  AFTER UPDATE ON workflows
  FOR EACH ROW
  WHEN (NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_notify_workflow_completed();
```

- [ ] **Step 2: Verify count**

Run: `grep -c "CREATE TRIGGER" supabase/migrations/20260430000001_notifications.sql`
Expected: `7` (3 hub + 4 workflow).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260430000001_notifications.sql
git commit -m "feat(notifications): add workflow/team trigger functions"
```

---

## Task 6: Migration — Workspace trigger functions + triggers

**Files:**
- Modify: `supabase/migrations/20260430000001_notifications.sql` (append)

- [ ] **Step 1: Append the three workspace_members triggers**

```sql

-- =====================================================================
-- Workspace triggers (owners/admins only, actor excluded)
-- =====================================================================

-- INSERT (invite_accepted)
CREATE OR REPLACE FUNCTION trg_notify_invite_accepted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_email text;
  v_user_name  text;
  v_targets    uuid[];
BEGIN
  BEGIN
    SELECT email, COALESCE(raw_user_meta_data->>'full_name', email)
      INTO v_user_email, v_user_name
      FROM auth.users
     WHERE id = NEW.user_id;

    v_targets := resolve_notification_targets(NEW.workspace_id, NULL, ARRAY['owner','admin']);

    PERFORM insert_notification_batch(
      NEW.workspace_id,
      v_targets,
      'invite_accepted',
      '/equipe',
      jsonb_build_object(
        'user_name',  v_user_name,
        'user_email', v_user_email
      ),
      NEW.user_id  -- the user who just joined doesn't need to be told
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_invite_accepted failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_invite_accepted ON workspace_members;
CREATE TRIGGER notify_invite_accepted
  AFTER INSERT ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION trg_notify_invite_accepted();

-- UPDATE role (member_role_changed)
CREATE OR REPLACE FUNCTION trg_notify_role_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_name text;
  v_targets   uuid[];
BEGIN
  BEGIN
    SELECT COALESCE(raw_user_meta_data->>'full_name', email)
      INTO v_user_name
      FROM auth.users
     WHERE id = NEW.user_id;

    v_targets := resolve_notification_targets(NEW.workspace_id, NULL, ARRAY['owner','admin']);

    PERFORM insert_notification_batch(
      NEW.workspace_id,
      v_targets,
      'member_role_changed',
      '/equipe',
      jsonb_build_object(
        'user_name', v_user_name,
        'old_role',  OLD.role,
        'new_role',  NEW.role
      ),
      auth.uid()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_role_changed failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_role_changed ON workspace_members;
CREATE TRIGGER notify_role_changed
  AFTER UPDATE ON workspace_members
  FOR EACH ROW
  WHEN (NEW.role IS DISTINCT FROM OLD.role)
  EXECUTE FUNCTION trg_notify_role_changed();

-- DELETE (member_removed)
CREATE OR REPLACE FUNCTION trg_notify_member_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_name text;
  v_targets   uuid[];
BEGIN
  BEGIN
    SELECT COALESCE(raw_user_meta_data->>'full_name', email)
      INTO v_user_name
      FROM auth.users
     WHERE id = OLD.user_id;

    v_targets := resolve_notification_targets(OLD.workspace_id, NULL, ARRAY['owner','admin']);

    PERFORM insert_notification_batch(
      OLD.workspace_id,
      v_targets,
      'member_removed',
      NULL,  -- no destination route
      jsonb_build_object('user_name', v_user_name),
      auth.uid()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_member_removed failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS notify_member_removed ON workspace_members;
CREATE TRIGGER notify_member_removed
  AFTER DELETE ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION trg_notify_member_removed();
```

- [ ] **Step 2: Verify final trigger count**

Run: `grep -c "CREATE TRIGGER" supabase/migrations/20260430000001_notifications.sql`
Expected: `10` (3 hub + 4 workflow + 3 workspace).

- [ ] **Step 3: Verify migration is syntactically complete by re-reading top to bottom**

Run: `wc -l supabase/migrations/20260430000001_notifications.sql`
Expected: large file (~500–700 lines). Inspect head and tail to confirm the file starts with the comment header and ends with the last trigger.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260430000001_notifications.sql
git commit -m "feat(notifications): add workspace member trigger functions"
```

---

## Task 7: Edge function — notification-cleanup-cron

**Files:**
- Create: `supabase/functions/notification-cleanup-cron/handler.ts`
- Create: `supabase/functions/notification-cleanup-cron/index.ts`
- Modify: `supabase/functions/__tests__/cron-auth_test.ts`

This is the simpler of the two crons. Pattern matches `express-post-cleanup-cron` exactly.

- [ ] **Step 1: Append a failing test for the new cron's auth gate**

Edit `supabase/functions/__tests__/cron-auth_test.ts`. Add this import near the top with the others:

```ts
import { createNotificationCleanupCronHandler } from "../notification-cleanup-cron/handler.ts";
import { createNotificationDeadlineCronHandler } from "../notification-deadline-cron/handler.ts";
```

Then append at the end of the file:

```ts
// ─── notification-cleanup-cron ──────────────────────────────

Deno.test("notification-cleanup-cron rejects requests without the shared cron secret", async () => {
  const handler = createNotificationCleanupCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () => new Response("ok"),
  });

  const response = await handler(new Request("https://example.test/notification-cleanup-cron"));
  assertEquals(response.status, 401);
});

Deno.test("notification-cleanup-cron delegates to run callback when secret is valid", async () => {
  let called = false;
  const handler = createNotificationCleanupCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () => { called = true; return new Response("ok"); },
  });

  const response = await handler(new Request("https://example.test/notification-cleanup-cron", {
    headers: { "x-cron-secret": "segredo-cron" },
  }));
  assertEquals(response.status, 200);
  assertEquals(called, true);
});

// ─── notification-deadline-cron ─────────────────────────────

Deno.test("notification-deadline-cron rejects requests without the shared cron secret", async () => {
  const handler = createNotificationDeadlineCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () => new Response("ok"),
  });

  const response = await handler(new Request("https://example.test/notification-deadline-cron"));
  assertEquals(response.status, 401);
});

Deno.test("notification-deadline-cron delegates to run callback when secret is valid", async () => {
  let called = false;
  const handler = createNotificationDeadlineCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () => { called = true; return new Response("ok"); },
  });

  const response = await handler(new Request("https://example.test/notification-deadline-cron", {
    headers: { "x-cron-secret": "segredo-cron" },
  }));
  assertEquals(response.status, 200);
  assertEquals(called, true);
});
```

- [ ] **Step 2: Run the Deno tests to verify they fail (handlers do not exist yet)**

Run: `deno test supabase/functions/__tests__/cron-auth_test.ts --allow-net --allow-env --allow-read 2>&1 | tail -20`
Expected: failure — module-not-found errors for the two new `handler.ts` paths.

- [ ] **Step 3: Create handler.ts for the cleanup cron**

Create `supabase/functions/notification-cleanup-cron/handler.ts`:

```ts
interface NotificationCleanupCronDeps {
  cronSecret: string;
  run: (req: Request) => Promise<Response>;
  timingSafeEqual: (a: string, b: string) => boolean;
}

export function createNotificationCleanupCronHandler(deps: NotificationCleanupCronDeps) {
  return async (req: Request): Promise<Response> => {
    if (!deps.timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return deps.run(req);
  };
}
```

- [ ] **Step 4: Create index.ts for the cleanup cron**

Create `supabase/functions/notification-cleanup-cron/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { createNotificationCleanupCronHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? (() => { throw new Error("CRON_SECRET is required"); })();

Deno.serve(createNotificationCleanupCronHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async () => {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      const { count, error } = await supabase
        .from("notifications")
        .delete({ count: "exact" })
        .lt("created_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());

      if (error) throw error;

      return new Response(JSON.stringify({ success: true, deleted: count ?? 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("notification-cleanup-cron failed:", message);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
}));
```

- [ ] **Step 5: Commit (tests still partly failing — deadline handler.ts is created in Task 8)**

```bash
git add supabase/functions/notification-cleanup-cron/ supabase/functions/__tests__/cron-auth_test.ts
git commit -m "feat(notifications): add notification-cleanup-cron edge function"
```

---

## Task 8: Edge function — notification-deadline-cron

**Files:**
- Create: `supabase/functions/notification-deadline-cron/handler.ts`
- Create: `supabase/functions/notification-deadline-cron/index.ts`

**Note:** Tests for this handler were already added in Task 7. After this task, all four cron-auth tests should pass.

- [ ] **Step 1: Create handler.ts**

Create `supabase/functions/notification-deadline-cron/handler.ts`:

```ts
interface NotificationDeadlineCronDeps {
  cronSecret: string;
  run: (req: Request) => Promise<Response>;
  timingSafeEqual: (a: string, b: string) => boolean;
}

export function createNotificationDeadlineCronHandler(deps: NotificationDeadlineCronDeps) {
  return async (req: Request): Promise<Response> => {
    if (!deps.timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return deps.run(req);
  };
}
```

- [ ] **Step 2: Create index.ts**

Create `supabase/functions/notification-deadline-cron/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { createNotificationDeadlineCronHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? (() => { throw new Error("CRON_SECRET is required"); })();

Deno.serve(createNotificationDeadlineCronHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async () => {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      // Steps with data_limite = tomorrow's date (date column → timezone-safe via CURRENT_DATE + 1)
      const { data: etapas, error: fetchErr } = await supabase
        .rpc("notification_deadline_candidates");

      if (fetchErr) throw fetchErr;

      const candidates = (etapas ?? []) as Array<{
        etapa_id: number;
        workflow_id: number;
        conta_id: string;
        cliente_id: number | null;
        client_name: string | null;
        workflow_title: string | null;
        step_name: string;
        responsavel_id: number | null;
        deadline_date: string;
      }>;

      let inserted = 0;
      let skipped = 0;

      for (const c of candidates) {
        // Idempotency: skip if a deadline_approaching notification for this etapa
        // was already created today (in any timezone — server time UTC is fine).
        const { data: existing, error: existErr } = await supabase
          .from("notifications")
          .select("id")
          .eq("type", "deadline_approaching")
          .eq("metadata->>etapa_id", String(c.etapa_id))
          .gte("created_at", new Date(Date.UTC(
            new Date().getUTCFullYear(),
            new Date().getUTCMonth(),
            new Date().getUTCDate()
          )).toISOString())
          .limit(1);

        if (existErr) throw existErr;
        if (existing && existing.length > 0) { skipped++; continue; }

        // Resolve recipients via the SQL helper (same one triggers use).
        const { data: targets, error: targetsErr } = await supabase
          .rpc("resolve_notification_targets", {
            p_workspace_id:    c.conta_id,
            p_responsavel_id:  c.responsavel_id,
            p_roles_filter:    ["owner", "admin"],
          });

        if (targetsErr) throw targetsErr;

        const userIds = (targets ?? []) as string[];
        if (userIds.length === 0) { skipped++; continue; }

        const { error: insertErr } = await supabase.rpc("insert_notification_batch", {
          p_workspace_id: c.conta_id,
          p_user_ids:     userIds,
          p_type:         "deadline_approaching",
          p_link:         `/workflows/${c.workflow_id}`,
          p_metadata: {
            client_name:    c.client_name,
            workflow_title: c.workflow_title,
            step_name:      c.step_name,
            workflow_id:    c.workflow_id,
            etapa_id:       c.etapa_id,
            deadline_date:  c.deadline_date,
          },
          p_exclude_actor: null,
        });

        if (insertErr) throw insertErr;
        inserted += userIds.length;
      }

      return new Response(JSON.stringify({ success: true, inserted, skipped }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("notification-deadline-cron failed:", message);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
}));
```

- [ ] **Step 3: Add the SQL helper used by the cron — append to the notifications migration**

Append to `supabase/migrations/20260430000001_notifications.sql`:

```sql

-- =====================================================================
-- Cron support: notification_deadline_candidates
-- Returns active workflow_etapas due tomorrow with the data
-- the deadline cron needs in one call.
-- =====================================================================
CREATE OR REPLACE FUNCTION notification_deadline_candidates()
RETURNS TABLE (
  etapa_id        bigint,
  workflow_id     bigint,
  conta_id        uuid,
  cliente_id      bigint,
  client_name     text,
  workflow_title  text,
  step_name       text,
  responsavel_id  bigint,
  deadline_date   date
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id            AS etapa_id,
    e.workflow_id   AS workflow_id,
    w.conta_id      AS conta_id,
    w.cliente_id    AS cliente_id,
    c.nome          AS client_name,
    w.titulo        AS workflow_title,
    e.titulo        AS step_name,
    e.responsavel_id AS responsavel_id,
    e.data_limite   AS deadline_date
  FROM workflow_etapas e
  JOIN workflows w ON w.id = e.workflow_id
  LEFT JOIN clientes c ON c.id = w.cliente_id
  WHERE e.status = 'ativo'
    AND e.data_limite = CURRENT_DATE + 1;
$$;

REVOKE ALL ON FUNCTION notification_deadline_candidates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notification_deadline_candidates() TO service_role;
```

- [ ] **Step 4: Run the cron-auth test suite — all four new tests should pass**

Run: `deno test supabase/functions/__tests__/cron-auth_test.ts --allow-net --allow-env --allow-read 2>&1 | tail -10`
Expected: all tests pass (count includes the four newly added).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/notification-deadline-cron/ supabase/migrations/20260430000001_notifications.sql
git commit -m "feat(notifications): add notification-deadline-cron edge function"
```

---

## Task 9: Migration — schedule both crons via pg_cron

**Files:**
- Create: `supabase/migrations/20260430000002_schedule_notification_crons.sql`

**Prerequisite:** Both edge functions must be deployed (`npx supabase functions deploy notification-deadline-cron --no-verify-jwt` and same for cleanup) before this migration is pushed. The migration itself only schedules the HTTP calls.

- [ ] **Step 1: Create the cron schedule migration**

```sql
-- Schedule notification crons.
-- Prerequisites:
--   - Vault secrets 'project_url' and 'cron_secret' must exist
--   - Edge functions notification-deadline-cron + notification-cleanup-cron
--     must be deployed with --no-verify-jwt before this migration runs.

-- Daily deadline scan at 12:00 UTC (≈09:00 Brasília), so users see "amanhã" reminders
-- in the morning of the day before the deadline.
SELECT cron.schedule(
  'notification-deadline-cron',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url := vault.decrypted_secret('project_url') || '/functions/v1/notification-deadline-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', vault.decrypted_secret('cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Daily 90-day cleanup at 03:00 UTC (off-peak).
SELECT cron.schedule(
  'notification-cleanup-cron',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := vault.decrypted_secret('project_url') || '/functions/v1/notification-cleanup-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', vault.decrypted_secret('cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

- [ ] **Step 2: Verify file contents**

Run: `cat supabase/migrations/20260430000002_schedule_notification_crons.sql`
Expected: two `cron.schedule` blocks.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260430000002_schedule_notification_crons.sql
git commit -m "feat(notifications): schedule deadline + cleanup crons"
```

---

## Task 10: store.ts — Notification type + CRUD + setMembroCrmUser RPC

**Files:**
- Modify: `apps/crm/src/store.ts`

- [ ] **Step 1: Append types and CRUD functions**

Append to the bottom of `apps/crm/src/store.ts`:

```ts
// =============================================
// NOTIFICATIONS
// =============================================

export type NotificationType =
  | 'post_approved' | 'post_correction' | 'post_message'
  | 'idea_submitted' | 'briefing_answered'
  | 'step_activated' | 'step_completed' | 'post_assigned'
  | 'workflow_completed' | 'deadline_approaching'
  | 'invite_accepted' | 'member_role_changed' | 'member_removed';

export interface Notification {
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

export async function getNotifications(limit = 50, offset = 0): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .is('dismissed_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as Notification[];
}

export async function getUnreadNotificationCount(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
    .is('dismissed_at', null);
  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationAsRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function markAllNotificationsAsRead(): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
    .is('dismissed_at', null);
  if (error) throw error;
}

export async function dismissNotification(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function setMembroCrmUser(membroId: number, crmUserId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_membro_crm_user', {
    p_membro_id:   membroId,
    p_crm_user_id: crmUserId,
  });
  if (error) throw error;
}
```

- [ ] **Step 2: Update the Membro interface to include the new column**

Find the existing `export interface Membro` block in `apps/crm/src/store.ts` (around line 54) and add `crm_user_id?: string | null` to it. The block currently looks like:

```ts
export interface Membro {
  id?: number;
  user_id?: string;
  nome: string;
  cargo: string;
  tipo: 'clt' | 'freelancer_mensal' | 'freelancer_demanda';
  custo_mensal: number | null;
  avatar_url: string;
  conta_id?: string;
  data_pagamento?: number;
}
```

Replace it with:

```ts
export interface Membro {
  id?: number;
  user_id?: string;
  nome: string;
  cargo: string;
  tipo: 'clt' | 'freelancer_mensal' | 'freelancer_demanda';
  custo_mensal: number | null;
  avatar_url: string;
  conta_id?: string;
  data_pagamento?: number;
  crm_user_id?: string | null;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run build 2>&1 | tail -30`
Expected: build succeeds (tsc + vite build green). No new TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/store.ts
git commit -m "feat(notifications): add Notification type + CRUD + setMembroCrmUser to store"
```

---

## Task 11: NOTIFICATION_CONFIG — display config

**Files:**
- Create: `apps/crm/src/lib/notification-config.ts`

- [ ] **Step 1: Create the config module**

```ts
import {
  AlertTriangle, Bell, CheckCircle, CheckSquare, ClipboardCheck, Clock,
  Lightbulb, MessageSquare, Play, Shield, Trophy, UserCheck, UserMinus, UserPlus,
  type LucideIcon,
} from 'lucide-react';
import type { NotificationType } from '../store';

type Tone = 'success' | 'warning' | 'danger' | 'teal' | 'primary';

export interface NotificationDisplay {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  body: string;
}

export const NOTIFICATION_TONE_COLOR: Record<Tone, string> = {
  success: '#3ecf8e',
  warning: '#f5a342',
  danger:  '#f55a42',
  teal:    '#42c8f5',
  primary: '#eab308',
};

export const NOTIFICATION_FALLBACK_ICON: LucideIcon = Bell;

const s = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.length > 0 ? v : fallback;

export function getNotificationDisplay(
  type: NotificationType,
  metadata: Record<string, unknown> | null | undefined,
): NotificationDisplay {
  const m = metadata ?? {};
  const client    = s(m.client_name, 'Cliente');
  const post      = s(m.post_title, 'Post');
  const idea      = s(m.idea_title, 'Ideia');
  const wf        = s(m.workflow_title, 'Workflow');
  const step      = s(m.step_name, 'Etapa');
  const question  = s(m.question_text, 'Briefing');
  const userName  = s(m.user_name, 'Usuário');
  const oldRole   = s(m.old_role, '—');
  const newRole   = s(m.new_role, '—');

  switch (type) {
    case 'post_approved':
      return { icon: CheckCircle, tone: 'success', title: 'Post aprovado', body: `${client} — ${post}` };
    case 'post_correction':
      return { icon: AlertTriangle, tone: 'warning', title: 'Correção solicitada', body: `${client} — ${post}` };
    case 'post_message':
      return { icon: MessageSquare, tone: 'teal', title: 'Nova mensagem do cliente', body: `${client} — ${post}` };
    case 'idea_submitted':
      return { icon: Lightbulb, tone: 'primary', title: 'Nova ideia do cliente', body: `${client} — ${idea}` };
    case 'briefing_answered':
      return { icon: ClipboardCheck, tone: 'success', title: 'Briefing respondido', body: `${client} — ${question}` };
    case 'step_activated':
      return { icon: Play, tone: 'teal', title: 'Nova etapa ativada para você', body: `${client} — Etapa "${step}"` };
    case 'step_completed':
      return { icon: CheckSquare, tone: 'success', title: 'Etapa concluída', body: `${client} — ${wf}` };
    case 'post_assigned':
      return { icon: UserPlus, tone: 'teal', title: 'Post atribuído a você', body: `${client} — ${post}` };
    case 'workflow_completed':
      return { icon: Trophy, tone: 'primary', title: 'Workflow concluído', body: `${client} — ${wf}` };
    case 'deadline_approaching':
      return { icon: Clock, tone: 'danger', title: 'Prazo amanhã', body: `${client} — Etapa "${step}"` };
    case 'invite_accepted':
      return { icon: UserCheck, tone: 'success', title: 'Convite aceito', body: `${userName} entrou no workspace` };
    case 'member_role_changed':
      return { icon: Shield, tone: 'warning', title: 'Cargo alterado', body: `${userName}: ${oldRole} → ${newRole}` };
    case 'member_removed':
      return { icon: UserMinus, tone: 'danger', title: 'Membro removido', body: userName };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build 2>&1 | tail -10`
Expected: build passes.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/lib/notification-config.ts
git commit -m "feat(notifications): add NOTIFICATION_CONFIG display map"
```

---

## Task 12: useNotifications hook

**Files:**
- Create: `apps/crm/src/hooks/useNotifications.ts`
- Create: `apps/crm/src/hooks/__tests__/useNotifications.test.tsx`

- [ ] **Step 1: Write the failing hook test**

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('../../store', () => ({
  getNotifications: vi.fn(),
  getUnreadNotificationCount: vi.fn(),
  markNotificationAsRead: vi.fn(),
  markAllNotificationsAsRead: vi.fn(),
  dismissNotification: vi.fn(),
}));

import { getNotifications, getUnreadNotificationCount } from '../../store';
import { useNotifications } from '../useNotifications';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useNotifications', () => {
  it('fetches the unread count immediately and the list only when popoverOpen is true', async () => {
    vi.mocked(getUnreadNotificationCount).mockResolvedValue(3);
    vi.mocked(getNotifications).mockResolvedValue([]);

    const { result, rerender } = renderHook(
      ({ open }) => useNotifications({ popoverOpen: open }),
      { wrapper: wrapper(), initialProps: { open: false } },
    );

    await waitFor(() => expect(result.current.unreadCount).toBe(3));
    expect(getNotifications).not.toHaveBeenCalled();

    rerender({ open: true });
    await waitFor(() => expect(getNotifications).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run apps/crm/src/hooks/__tests__/useNotifications.test.tsx 2>&1 | tail -20`
Expected: failure — module `../useNotifications` not found.

- [ ] **Step 3: Implement the hook**

Create `apps/crm/src/hooks/useNotifications.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  dismissNotification,
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  type Notification,
} from '../store';

const UNREAD_KEY = ['notifications-unread-count'] as const;
const LIST_KEY = ['notifications'] as const;
const REFETCH_INTERVAL = 60_000;
const STALE_TIME = 30_000;

export interface UseNotificationsOptions {
  popoverOpen: boolean;
}

export function useNotifications({ popoverOpen }: UseNotificationsOptions) {
  const qc = useQueryClient();

  const unreadQuery = useQuery({
    queryKey: UNREAD_KEY,
    queryFn: getUnreadNotificationCount,
    refetchInterval: REFETCH_INTERVAL,
    refetchOnWindowFocus: true,
    staleTime: STALE_TIME,
  });

  const listQuery = useQuery({
    queryKey: LIST_KEY,
    queryFn: () => getNotifications(50, 0),
    enabled: popoverOpen,
    refetchInterval: popoverOpen ? REFETCH_INTERVAL : false,
    refetchOnWindowFocus: true,
    staleTime: STALE_TIME,
  });

  const markAsRead = useMutation({
    mutationFn: (id: string) => markNotificationAsRead(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: LIST_KEY });
      const prev = qc.getQueryData<Notification[]>(LIST_KEY);
      qc.setQueryData<Notification[]>(LIST_KEY, (old) =>
        (old ?? []).map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
      const prevCount = qc.getQueryData<number>(UNREAD_KEY) ?? 0;
      qc.setQueryData<number>(UNREAD_KEY, Math.max(0, prevCount - 1));
      return { prev, prevCount };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(LIST_KEY, ctx.prev);
      if (typeof ctx?.prevCount === 'number') qc.setQueryData(UNREAD_KEY, ctx.prevCount);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.invalidateQueries({ queryKey: UNREAD_KEY });
    },
  });

  const markAllAsRead = useMutation({
    mutationFn: markAllNotificationsAsRead,
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: LIST_KEY });
      const prev = qc.getQueryData<Notification[]>(LIST_KEY);
      const now = new Date().toISOString();
      qc.setQueryData<Notification[]>(LIST_KEY, (old) =>
        (old ?? []).map(n => n.read_at ? n : { ...n, read_at: now }));
      qc.setQueryData<number>(UNREAD_KEY, 0);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(LIST_KEY, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.invalidateQueries({ queryKey: UNREAD_KEY });
    },
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => dismissNotification(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: LIST_KEY });
      const prev = qc.getQueryData<Notification[]>(LIST_KEY);
      qc.setQueryData<Notification[]>(LIST_KEY, (old) =>
        (old ?? []).filter(n => n.id !== id));
      // If the dismissed item was unread, decrement the badge
      const wasUnread = (prev ?? []).find(n => n.id === id && !n.read_at);
      if (wasUnread) {
        const prevCount = qc.getQueryData<number>(UNREAD_KEY) ?? 0;
        qc.setQueryData<number>(UNREAD_KEY, Math.max(0, prevCount - 1));
      }
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(LIST_KEY, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.invalidateQueries({ queryKey: UNREAD_KEY });
    },
  });

  return {
    notifications: listQuery.data ?? [],
    unreadCount: unreadQuery.data ?? 0,
    isLoading: listQuery.isLoading,
    markAsRead: markAsRead.mutate,
    markAllAsRead: markAllAsRead.mutate,
    dismiss: dismiss.mutate,
  };
}
```

- [ ] **Step 4: Run the test — should now pass**

Run: `npx vitest run apps/crm/src/hooks/__tests__/useNotifications.test.tsx 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/hooks/
git commit -m "feat(notifications): add useNotifications TanStack Query hook"
```

---

## Task 13: NotificationItem component

**Files:**
- Create: `apps/crm/src/components/layout/NotificationItem.tsx`
- Create: `apps/crm/src/components/layout/__tests__/NotificationItem.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import NotificationItem from '../NotificationItem';
import type { Notification } from '../../../store';

const baseNotif: Notification = {
  id: '1',
  workspace_id: 'ws',
  user_id: 'u',
  type: 'post_approved',
  metadata: { client_name: 'Foo', post_title: 'Bar' },
  link: '/workflows/1/posts/2',
  read_at: null,
  dismissed_at: null,
  created_at: new Date().toISOString(),
};

describe('NotificationItem', () => {
  it('renders title and body from metadata', () => {
    render(<NotificationItem notification={baseNotif} onMarkAsRead={vi.fn()} onDismiss={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByText('Post aprovado')).toBeInTheDocument();
    expect(screen.getByText(/Foo — Bar/)).toBeInTheDocument();
  });

  it('shows the unread dot when read_at is null', () => {
    render(<NotificationItem notification={baseNotif} onMarkAsRead={vi.fn()} onDismiss={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByTestId('notification-unread-dot')).toBeInTheDocument();
  });

  it('hides the unread dot when read_at is set', () => {
    render(<NotificationItem notification={{ ...baseNotif, read_at: new Date().toISOString() }} onMarkAsRead={vi.fn()} onDismiss={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.queryByTestId('notification-unread-dot')).toBeNull();
  });

  it('calls onMarkAsRead and onNavigate when clicked with a link', () => {
    const onMarkAsRead = vi.fn();
    const onNavigate  = vi.fn();
    render(<NotificationItem notification={baseNotif} onMarkAsRead={onMarkAsRead} onDismiss={vi.fn()} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: /Post aprovado/ }));
    expect(onMarkAsRead).toHaveBeenCalledWith('1');
    expect(onNavigate).toHaveBeenCalledWith('/workflows/1/posts/2');
  });

  it('only marks as read (no navigate) when link is null', () => {
    const onMarkAsRead = vi.fn();
    const onNavigate  = vi.fn();
    render(<NotificationItem notification={{ ...baseNotif, link: null, type: 'member_removed', metadata: { user_name: 'X' } }} onMarkAsRead={onMarkAsRead} onDismiss={vi.fn()} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: /Membro removido/ }));
    expect(onMarkAsRead).toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('calls onDismiss when the X is clicked, without firing onMarkAsRead', () => {
    const onMarkAsRead = vi.fn();
    const onDismiss    = vi.fn();
    render(<NotificationItem notification={baseNotif} onMarkAsRead={onMarkAsRead} onDismiss={onDismiss} onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Dispensar/ }));
    expect(onDismiss).toHaveBeenCalledWith('1');
    expect(onMarkAsRead).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run apps/crm/src/components/layout/__tests__/NotificationItem.test.tsx 2>&1 | tail -15`
Expected: failure — `Cannot find module '../NotificationItem'`.

- [ ] **Step 3: Implement the component**

Create `apps/crm/src/components/layout/NotificationItem.tsx`:

```tsx
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { X } from 'lucide-react';
import type { Notification } from '../../store';
import {
  NOTIFICATION_TONE_COLOR,
  getNotificationDisplay,
} from '../../lib/notification-config';

export interface NotificationItemProps {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onNavigate: (link: string) => void;
}

export default function NotificationItem({ notification, onMarkAsRead, onDismiss, onNavigate }: NotificationItemProps) {
  const display = getNotificationDisplay(notification.type, notification.metadata);
  const Icon = display.icon;
  const color = NOTIFICATION_TONE_COLOR[display.tone];
  const isRead = !!notification.read_at;

  const handleClick = () => {
    if (!isRead) onMarkAsRead(notification.id);
    if (notification.link) onNavigate(notification.link);
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDismiss(notification.id);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={display.title}
      style={{
        display: 'flex',
        gap: '0.75rem',
        alignItems: 'flex-start',
        width: '100%',
        padding: '0.75rem 1rem',
        background: 'transparent',
        border: 'none',
        borderBottom: '1px solid var(--border-color)',
        cursor: 'pointer',
        textAlign: 'left',
        opacity: isRead ? 0.6 : 1,
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <span
        aria-hidden
        style={{
          flex: '0 0 32px',
          width: 32,
          height: 32,
          borderRadius: 8,
          background: `${color}1f`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color,
        }}
      >
        <Icon size={16} />
      </span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: 'block',
          fontSize: '0.82rem',
          fontWeight: isRead ? 400 : 500,
          color: 'var(--text-main)',
          marginBottom: '0.15rem',
        }}>
          {display.title}
        </span>
        <span style={{
          display: 'block',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {display.body}
        </span>
        <span style={{
          display: 'block',
          fontSize: '0.7rem',
          color: 'var(--text-light)',
          marginTop: '0.2rem',
        }}>
          {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true, locale: ptBR })}
        </span>
      </span>

      <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: '0 0 auto' }}>
        {!isRead && (
          <span
            data-testid="notification-unread-dot"
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--primary-color)',
            }}
          />
        )}
        <span
          role="button"
          tabIndex={0}
          aria-label="Dispensar"
          onClick={handleDismiss}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleDismiss(e as unknown as React.MouseEvent); } }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 20,
            height: 20,
            borderRadius: 4,
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          <X size={14} />
        </span>
      </span>
    </button>
  );
}
```

- [ ] **Step 4: Run the test — should pass**

Run: `npx vitest run apps/crm/src/components/layout/__tests__/NotificationItem.test.tsx 2>&1 | tail -10`
Expected: 6/6 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/layout/NotificationItem.tsx apps/crm/src/components/layout/__tests__/NotificationItem.test.tsx
git commit -m "feat(notifications): add NotificationItem component"
```

---

## Task 14: NotificationList component

**Files:**
- Create: `apps/crm/src/components/layout/NotificationList.tsx`

- [ ] **Step 1: Implement the list**

```tsx
import type { Notification } from '../../store';
import NotificationItem from './NotificationItem';

export interface NotificationListProps {
  notifications: Notification[];
  onMarkAsRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onNavigate: (link: string) => void;
}

export default function NotificationList({ notifications, onMarkAsRead, onDismiss, onNavigate }: NotificationListProps) {
  return (
    <div style={{ maxHeight: 'calc(480px - 56px)', overflowY: 'auto' }}>
      {notifications.map(n => (
        <NotificationItem
          key={n.id}
          notification={n}
          onMarkAsRead={onMarkAsRead}
          onDismiss={onDismiss}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build 2>&1 | tail -10`
Expected: build green.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/components/layout/NotificationList.tsx
git commit -m "feat(notifications): add NotificationList component"
```

---

## Task 15: NotificationPopover component

**Files:**
- Create: `apps/crm/src/components/layout/NotificationPopover.tsx`
- Create: `apps/crm/src/components/layout/__tests__/NotificationPopover.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import NotificationPopover from '../NotificationPopover';
import type { Notification } from '../../../store';

const sampleNotif: Notification = {
  id: '1',
  workspace_id: 'ws',
  user_id: 'u',
  type: 'post_approved',
  metadata: { client_name: 'Foo', post_title: 'Bar' },
  link: '/x',
  read_at: null,
  dismissed_at: null,
  created_at: new Date().toISOString(),
};

describe('NotificationPopover', () => {
  it('shows the empty state when no notifications', () => {
    render(<NotificationPopover
      notifications={[]} onMarkAsRead={vi.fn()} onMarkAllAsRead={vi.fn()}
      onDismiss={vi.fn()} onNavigate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Nenhuma notificação')).toBeInTheDocument();
  });

  it('renders notification rows when present', () => {
    render(<NotificationPopover
      notifications={[sampleNotif]} onMarkAsRead={vi.fn()} onMarkAllAsRead={vi.fn()}
      onDismiss={vi.fn()} onNavigate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Post aprovado')).toBeInTheDocument();
  });

  it('toggles between "all" and "unread" filter', () => {
    const read: Notification = { ...sampleNotif, id: '2', read_at: new Date().toISOString() };
    render(<NotificationPopover
      notifications={[sampleNotif, read]} onMarkAsRead={vi.fn()} onMarkAllAsRead={vi.fn()}
      onDismiss={vi.fn()} onNavigate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /Post aprovado/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Apenas não lidas/ }));
    expect(screen.getAllByRole('button', { name: /Post aprovado/ })).toHaveLength(1);
  });

  it('calls onMarkAllAsRead when the mark-all button is clicked', () => {
    const onMarkAllAsRead = vi.fn();
    render(<NotificationPopover
      notifications={[sampleNotif]} onMarkAsRead={vi.fn()} onMarkAllAsRead={onMarkAllAsRead}
      onDismiss={vi.fn()} onNavigate={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Marcar todas como lidas/ }));
    expect(onMarkAllAsRead).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

Run: `npx vitest run apps/crm/src/components/layout/__tests__/NotificationPopover.test.tsx 2>&1 | tail -10`
Expected: failure — module not found.

- [ ] **Step 3: Implement the popover panel**

Create `apps/crm/src/components/layout/NotificationPopover.tsx`:

```tsx
import { useState } from 'react';
import { Bell, CheckCheck, Filter } from 'lucide-react';
import type { Notification } from '../../store';
import NotificationList from './NotificationList';

export interface NotificationPopoverProps {
  notifications: Notification[];
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onDismiss: (id: string) => void;
  onNavigate: (link: string) => void;
  onClose: () => void;
}

type FilterMode = 'all' | 'unread';

export default function NotificationPopover({
  notifications, onMarkAsRead, onMarkAllAsRead, onDismiss, onNavigate, onClose,
}: NotificationPopoverProps) {
  const [filter, setFilter] = useState<FilterMode>('all');
  const visible = filter === 'unread'
    ? notifications.filter(n => !n.read_at)
    : notifications;

  const handleNavigate = (link: string) => { onClose(); onNavigate(link); };

  return (
    <div
      role="dialog"
      aria-label="Notificações"
      style={{
        width: 'min(380px, calc(100vw - 2rem))',
        maxHeight: 480,
        background: 'var(--surface-main)',
        border: '1px solid var(--border-color)',
        borderRadius: 16,
        boxShadow: 'var(--shadow)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.75rem 1rem',
        borderBottom: '1px solid var(--border-color)',
      }}>
        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)' }}>Notificações</span>
        <span style={{ display: 'flex', gap: '0.25rem' }}>
          <button
            type="button"
            onClick={() => setFilter(filter === 'all' ? 'unread' : 'all')}
            aria-label={filter === 'all' ? 'Apenas não lidas' : 'Mostrar todas'}
            style={iconButtonStyle(filter === 'unread')}
          >
            <Filter size={16} />
          </button>
          <button
            type="button"
            onClick={onMarkAllAsRead}
            aria-label="Marcar todas como lidas"
            style={iconButtonStyle(false)}
          >
            <CheckCheck size={16} />
          </button>
        </span>
      </header>

      {visible.length === 0 ? (
        <EmptyState />
      ) : (
        <NotificationList
          notifications={visible}
          onMarkAsRead={onMarkAsRead}
          onDismiss={onDismiss}
          onNavigate={handleNavigate}
        />
      )}

      <footer style={{
        padding: '0.5rem 1rem',
        borderTop: '1px solid var(--border-color)',
        textAlign: 'center',
      }}>
        <button
          type="button"
          disabled
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: '0.75rem',
            cursor: 'not-allowed',
            opacity: 0.6,
          }}
        >
          Ver todas
        </button>
      </footer>
    </div>
  );
}

function iconButtonStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 8,
    background: active ? 'var(--surface-hover)' : 'transparent',
    border: 'none',
    color: active ? 'var(--primary-color)' : 'var(--text-muted)',
    cursor: 'pointer',
  };
}

function EmptyState() {
  return (
    <div style={{
      padding: '2rem 1rem',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '0.5rem',
      textAlign: 'center',
    }}>
      <span style={{
        width: 48,
        height: 48,
        borderRadius: 12,
        background: 'var(--surface-hover)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
      }}>
        <Bell size={20} />
      </span>
      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>Nenhuma notificação</span>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: 240 }}>
        Notificações sobre sua conta e atividades aparecerão aqui
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run the test — should pass**

Run: `npx vitest run apps/crm/src/components/layout/__tests__/NotificationPopover.test.tsx 2>&1 | tail -10`
Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/layout/NotificationPopover.tsx apps/crm/src/components/layout/__tests__/NotificationPopover.test.tsx
git commit -m "feat(notifications): add NotificationPopover component"
```

---

## Task 16: NotificationBell component

**Files:**
- Create: `apps/crm/src/components/layout/NotificationBell.tsx`
- Create: `apps/crm/src/components/layout/__tests__/NotificationBell.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../hooks/useNotifications', () => ({
  useNotifications: vi.fn(),
}));

import { useNotifications } from '../../../hooks/useNotifications';
import NotificationBell from '../NotificationBell';

function renderBell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('NotificationBell', () => {
  it('shows a numeric badge when unreadCount > 0', () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [], unreadCount: 3, isLoading: false,
      markAsRead: vi.fn(), markAllAsRead: vi.fn(), dismiss: vi.fn(),
    });
    renderBell();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('caps the badge at 99+', () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [], unreadCount: 250, isLoading: false,
      markAsRead: vi.fn(), markAllAsRead: vi.fn(), dismiss: vi.fn(),
    });
    renderBell();
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('does not show a badge when unreadCount is 0', () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [], unreadCount: 0, isLoading: false,
      markAsRead: vi.fn(), markAllAsRead: vi.fn(), dismiss: vi.fn(),
    });
    renderBell();
    expect(screen.queryByTestId('notification-badge')).toBeNull();
  });

  it('opens the popover on click', () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [], unreadCount: 0, isLoading: false,
      markAsRead: vi.fn(), markAllAsRead: vi.fn(), dismiss: vi.fn(),
    });
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: 'Notificações' }));
    expect(screen.getByText('Nenhuma notificação')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test — confirm failure**

Run: `npx vitest run apps/crm/src/components/layout/__tests__/NotificationBell.test.tsx 2>&1 | tail -10`
Expected: failure — module not found.

- [ ] **Step 3: Implement the bell**

Create `apps/crm/src/components/layout/NotificationBell.tsx`:

```tsx
import { useState } from 'react';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useNotifications } from '../../hooks/useNotifications';
import NotificationPopover from './NotificationPopover';

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { notifications, unreadCount, markAsRead, markAllAsRead, dismiss } =
    useNotifications({ popoverOpen: open });

  const badge = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="topbar-action-btn" aria-label="Notificações">
          <Bell size={18} />
          {unreadCount > 0 && (
            <span
              data-testid="notification-badge"
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                minWidth: 16,
                height: 16,
                padding: '0 4px',
                borderRadius: 8,
                background: 'var(--primary-color)',
                color: 'var(--dark)',
                fontSize: '0.6rem',
                fontWeight: 700,
                lineHeight: '16px',
                textAlign: 'center',
              }}
            >
              {badge}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="p-0 border-0 bg-transparent shadow-none w-auto"
      >
        <NotificationPopover
          notifications={notifications}
          onMarkAsRead={markAsRead}
          onMarkAllAsRead={markAllAsRead}
          onDismiss={dismiss}
          onNavigate={navigate}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Run the test — should pass**

Run: `npx vitest run apps/crm/src/components/layout/__tests__/NotificationBell.test.tsx 2>&1 | tail -10`
Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/layout/NotificationBell.tsx apps/crm/src/components/layout/__tests__/NotificationBell.test.tsx
git commit -m "feat(notifications): add NotificationBell with badge + popover"
```

---

## Task 17: TopBarActions integration

**Files:**
- Modify: `apps/crm/src/components/layout/TopBarActions.tsx`

- [ ] **Step 1: Replace the static bell with `<NotificationBell />`**

Open `apps/crm/src/components/layout/TopBarActions.tsx`. The current contents are:

```tsx
import { useState, useEffect, useCallback } from 'react';
import { Bell, MessageCircle } from 'lucide-react';

declare global {
  interface Window {
    $crisp?: Array<unknown[]>;
  }
}

export default function TopBarActions() {
  const [crispUnread, setCrispUnread] = useState(false);

  const openCrisp = useCallback(() => {
    window.$crisp?.push(['do', 'chat:show']);
    window.$crisp?.push(['do', 'chat:open']);
    setCrispUnread(false);
  }, []);

  useEffect(() => {
    window.$crisp?.push(['on', 'message:received', () => setCrispUnread(true)]);
    window.$crisp?.push(['on', 'chat:opened', () => setCrispUnread(false)]);
  }, []);

  return (
    <>
      <button type="button" className="topbar-action-btn" aria-label="Notificações">
        <Bell size={18} />
      </button>

      <button
        type="button"
        className="topbar-action-btn"
        aria-label="Chat"
        onClick={openCrisp}
      >
        <MessageCircle size={18} />
        {crispUnread && <span className="unread-dot unread-dot--primary" />}
      </button>
    </>
  );
}
```

Replace with:

```tsx
import { useState, useEffect, useCallback } from 'react';
import { MessageCircle } from 'lucide-react';
import NotificationBell from './NotificationBell';

declare global {
  interface Window {
    $crisp?: Array<unknown[]>;
  }
}

export default function TopBarActions() {
  const [crispUnread, setCrispUnread] = useState(false);

  const openCrisp = useCallback(() => {
    window.$crisp?.push(['do', 'chat:show']);
    window.$crisp?.push(['do', 'chat:open']);
    setCrispUnread(false);
  }, []);

  useEffect(() => {
    window.$crisp?.push(['on', 'message:received', () => setCrispUnread(true)]);
    window.$crisp?.push(['on', 'chat:opened', () => setCrispUnread(false)]);
  }, []);

  return (
    <>
      <NotificationBell />

      <button
        type="button"
        className="topbar-action-btn"
        aria-label="Chat"
        onClick={openCrisp}
      >
        <MessageCircle size={18} />
        {crispUnread && <span className="unread-dot unread-dot--primary" />}
      </button>
    </>
  );
}
```

- [ ] **Step 2: Verify topbar-action-btn has position:relative (required so the bell badge is positioned correctly)**

Run: `grep -n "topbar-action-btn" style.css apps/crm/src/**/*.css 2>/dev/null | head -10`
Expected: find the rule. If `position: relative` is not already there, add it. If the rule lives in `apps/crm/src/styles/topbar.css` or similar, edit there. (The existing crispUnread dot already relies on relative positioning, so it almost certainly is — but verify.)

- [ ] **Step 3: Run the existing AppLayout test suite to confirm nothing broke**

Run: `npx vitest run apps/crm/src/components/layout/__tests__/AppLayout.test.tsx 2>&1 | tail -10`
Expected: green.

- [ ] **Step 4: Typecheck**

Run: `npm run build 2>&1 | tail -10`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/layout/TopBarActions.tsx
git commit -m "feat(notifications): wire NotificationBell into TopBarActions"
```

---

## Task 18: EquipePage — crm_user_id dropdown + unlinked badge

**Files:**
- Modify: `apps/crm/src/pages/equipe/EquipePage.tsx`

The Equipe page already uses TanStack Query, react-hook-form, zod, and a dialog for editing membros. We need to (a) add a "Conta CRM" select in the edit dialog that calls `setMembroCrmUser`, and (b) show a `sem conta vinculada` badge on rows whose `crm_user_id` is null.

- [ ] **Step 1: Read the file to find the edit dialog and the row rendering**

Run: `wc -l apps/crm/src/pages/equipe/EquipePage.tsx && grep -n "DialogContent\|crm_user_id\|setSaving\|Cargo\|tipo\|onSubmit\|TIPO_LABEL" apps/crm/src/pages/equipe/EquipePage.tsx | head -30`
Expected: prints line count + key reference points so the implementer can locate sections.

- [ ] **Step 2: Import `getWorkspaceUsers` and `setMembroCrmUser` from store, and the Badge if not already in scope**

Modify the existing import block. Locate the import line that brings in store functions:

```tsx
import {
  getMembros, addMembro, updateMembro, removeMembro,
  formatBRL, getInitials,
  type Membro,
} from '../../store';
```

Replace with:

```tsx
import {
  getMembros, addMembro, updateMembro, removeMembro,
  getWorkspaceUsers, setMembroCrmUser,
  formatBRL, getInitials,
  type Membro,
} from '../../store';
```

`Badge` is already imported per the inspection above; no change needed.

- [ ] **Step 3: Fetch workspace users alongside membros**

Find the existing `useQuery` call for membros (around line 70):

```tsx
const { data: membros = [], isLoading } = useQuery({ queryKey: ['membros'], queryFn: getMembros });
```

After it, add:

```tsx
const { data: workspaceUsers = [] } = useQuery({
  queryKey: ['workspace-users'],
  queryFn: getWorkspaceUsers,
  enabled: !isAgent,
});
```

`isAgent` is already declared from `useAuth()`.

- [ ] **Step 4: Extend the membro form schema to include the linked CRM user id**

Find:

```tsx
const membroSchema = z.object({
  nome: z.string().min(1, 'Nome obrigatório'),
  cargo: z.string().min(1, 'Cargo obrigatório'),
  tipo: z.enum(['clt', 'freelancer_mensal', 'freelancer_demanda']),
  custo: z.string(),
  diaPag: z.string().refine((v) => v === '' || (Number(v) >= 1 && Number(v) <= 31), 'Dia deve ser entre 1 e 31'),
});
```

Replace with:

```tsx
const membroSchema = z.object({
  nome: z.string().min(1, 'Nome obrigatório'),
  cargo: z.string().min(1, 'Cargo obrigatório'),
  tipo: z.enum(['clt', 'freelancer_mensal', 'freelancer_demanda']),
  custo: z.string(),
  diaPag: z.string().refine((v) => v === '' || (Number(v) >= 1 && Number(v) <= 31), 'Dia deve ser entre 1 e 31'),
  crmUserId: z.string().optional(),
});
```

- [ ] **Step 5: Update the form's `defaultValues` to include `crmUserId: ''`**

Find the `useForm` call:

```tsx
const form = useForm<MembroFormValues>({
  resolver: zodResolver(membroSchema),
  defaultValues: { nome: '', cargo: '', tipo: 'clt', custo: '', diaPag: '' },
});
```

Replace with:

```tsx
const form = useForm<MembroFormValues>({
  resolver: zodResolver(membroSchema),
  defaultValues: { nome: '', cargo: '', tipo: 'clt', custo: '', diaPag: '', crmUserId: '' },
});
```

- [ ] **Step 6: Pre-populate `crmUserId` when opening the edit dialog**

Find the editing trigger that calls `form.reset(...)`. Search for `form.reset` in the file. Each `form.reset` call that opens the edit dialog with an existing membro must include `crmUserId: editing?.crm_user_id ?? ''`. For the "new" path, leave as `''`.

For example, if the existing reset looks like:

```tsx
form.reset({
  nome: editing.nome,
  cargo: editing.cargo,
  tipo: editing.tipo,
  custo: editing.custo_mensal != null ? String(editing.custo_mensal) : '',
  diaPag: editing.data_pagamento ? String(editing.data_pagamento) : '',
});
```

Update it to also set:

```tsx
crmUserId: editing.crm_user_id ?? '',
```

(Search for every `form.reset` invocation and audit it. If any edit-path reset does not include `crmUserId`, add it.)

- [ ] **Step 7: Add the `Conta CRM` select in the dialog form, just below the existing fields**

Locate the `<Form>` JSX inside the edit dialog. After the last `<FormField>` (likely `diaPag`), insert this block (only render it for owners/admins — `!isAgent`):

```tsx
{!isAgent && (
  <FormField
    control={form.control}
    name="crmUserId"
    render={({ field }) => (
      <FormItem>
        <FormLabel>Conta CRM</FormLabel>
        <FormControl>
          <Select value={field.value ?? ''} onValueChange={field.onChange}>
            <SelectTrigger>
              <SelectValue placeholder="Não vinculado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Não vinculado</SelectItem>
              {workspaceUsers.map((u: { user_id: string; full_name?: string; email?: string }) => (
                <SelectItem key={u.user_id} value={u.user_id}>
                  {u.full_name || u.email || u.user_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
)}
```

- [ ] **Step 8: Call `setMembroCrmUser` on save (only if value changed and only on edit, not add)**

Find the `onSubmit` handler. After the `updateMembro` call (or `addMembro` for new — for new we skip the link, since the membro doesn't exist yet to set its crm_user_id; we'd need a follow-up edit). For the **edit** path, after `updateMembro` succeeds, add:

```tsx
const desiredCrmUser = values.crmUserId === '' ? null : values.crmUserId;
const currentCrmUser = editing.crm_user_id ?? null;
if (desiredCrmUser !== currentCrmUser) {
  await setMembroCrmUser(editing.id!, desiredCrmUser);
}
```

For **new** membros: do nothing in this submit. After the user closes the dialog, they can re-open it in edit mode to set the link. (This avoids needing the inserted membro id during the same submit cycle.)

- [ ] **Step 9: Invalidate the `membros` query so the badge refreshes**

The existing flow already does `qc.invalidateQueries({ queryKey: ['membros'] })`. No change needed.

- [ ] **Step 10: Add the "sem conta vinculada" badge on each row**

Locate the per-row rendering (search for where `m.nome` or the row JSX is rendered). After the existing tipo badge — or wherever appropriate inline — render:

```tsx
{!isAgent && !m.crm_user_id && (
  <Badge variant="outline" style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
    sem conta vinculada
  </Badge>
)}
```

If the row has multiple Badge children already, place this one alongside them. The exact position is a style choice — pick a sensible one near the membro's name or tipo.

- [ ] **Step 11: Typecheck**

Run: `npm run build 2>&1 | tail -10`
Expected: green.

- [ ] **Step 12: Manually exercise the dev server**

Run (background): `npm run dev`
Open http://localhost:5173 → Equipe page. Verify:
- A membro with no `crm_user_id` shows the "sem conta vinculada" badge.
- Clicking edit opens the dialog with the new "Conta CRM" select.
- Selecting a workspace user and saving updates the row (badge disappears).
- Selecting "Não vinculado" reverts.
- Logged in as an agent, the select and the badge are NOT shown.

- [ ] **Step 13: Commit**

```bash
git add apps/crm/src/pages/equipe/EquipePage.tsx
git commit -m "feat(notifications): link membros to CRM users in Equipe page"
```

---

## Final integration checklist

After all 18 tasks land, before merging:

- [ ] **Run the full test suites**
  - Run: `npm run test 2>&1 | tail -20`
  - Run: `deno test supabase/functions/ --allow-net --allow-env --allow-read 2>&1 | tail -20`
  - Both must be green.

- [ ] **Build cleanly**
  - Run: `npm run build 2>&1 | tail -10`
  - Expected: tsc + vite build pass.

- [ ] **Manual UI smoke**
  - Run: `npm run dev`
  - Submit a `post_approvals` row from Hub flow → bell badge increments after the next 60s poll.
  - Mark all read → badge clears.
  - Dismiss item → row disappears, badge updates.
  - Click an item with a link → navigates and marks read.

- [ ] **Deployment notes (manual, not part of the plan tasks)**
  - Push migrations: `npm run db:push:staging`
  - Deploy crons: `npx supabase functions deploy notification-deadline-cron --no-verify-jwt && npx supabase functions deploy notification-cleanup-cron --no-verify-jwt`
  - Confirm `CRON_SECRET` and vault secrets `project_url` / `cron_secret` are set in the Supabase project.
  - In production, repeat after staging soak.

---

## Self-Review Notes

Spec coverage map (every spec section → task that implements it):
- Decisions block (polling, storage, creation, content, lifecycle, linking, naming, error handling, volume) → enforced across tasks 1–9.
- `notifications` table + indexes + RLS + column grants → Task 1.
- `membros.crm_user_id` + RLS revoke + `set_membro_crm_user` RPC → Task 2.
- Helper functions (resolve_notification_targets, insert_notification_batch) → Task 3.
- Hub triggers (post_approved/correction/message, idea_submitted, briefing_answered) → Task 4.
- Workflow triggers (step_activated, step_completed, post_assigned, workflow_completed) → Task 5.
- Workspace triggers (invite_accepted, member_role_changed, member_removed) → Task 6.
- Cleanup cron edge function → Task 7.
- Deadline cron edge function + idempotency + `notification_deadline_candidates` SQL helper → Task 8.
- pg_cron schedules → Task 9.
- store.ts CRUD + types + setMembroCrmUser → Task 10.
- NOTIFICATION_CONFIG → Task 11.
- useNotifications hook with separated unread-count vs full-list queries, optimistic updates, 60s polling → Task 12.
- NotificationItem (icon, color, title, body, timestamp, unread dot, dismiss, click → mark read + nav) → Task 13.
- NotificationList → Task 14.
- NotificationPopover (header, filter toggle, mark all, empty state, "Ver todas" disabled) → Task 15.
- NotificationBell (Bell icon + 99+ badge + Popover wiring) → Task 16.
- TopBarActions integration → Task 17.
- EquipePage crm_user_id dropdown via RPC + unlinked badge → Task 18.

Type/name consistency: `Notification`, `NotificationType`, `useNotifications`, `getNotificationDisplay`, `NOTIFICATION_TONE_COLOR`, `setMembroCrmUser`, `resolve_notification_targets`, `insert_notification_batch`, `notification_deadline_candidates`, `trg_notify_*` — all stable across tasks.
