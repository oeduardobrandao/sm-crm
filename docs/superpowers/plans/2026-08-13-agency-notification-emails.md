# Agency-user Notification Emails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email agency users a single consolidated digest of their high-value in-app notifications (publish failures, client corrections/messages, deadlines, assignments, mentions), gated by per-user per-type opt-out preferences.

**Architecture:** Supersede the `mention-email-cron` with a generalized `notification-email-cron`. Eligibility + preference opt-out + workspace-membership + the read/dismissed/emailed re-checks all live inside ONE atomic claim RPC (`claim_notification_emails`, `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING`), mirroring the repo's Loops `claim_marketing_email` precedent. The cron groups claimed rows per user, renders an urgency-ordered digest, and sends via Resend. A new Settings › Notificações tab writes per-user preferences.

**Tech Stack:** Deno edge functions (Supabase), Postgres (RLS + SECURITY DEFINER RPC + pg_cron), Resend REST API, React 19 + TanStack Query + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-13-agency-notification-emails-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **No em dashes in user-facing copy.** Use period, colon, or "·". Applies to every PT string (subjects, headings, tab labels, descriptions).
- **The 8 email-worthy types (verbatim):** `post_publish_failed`, `post_correction`, `post_message`, `client_message`, `deadline_approaching`, `task_assigned`, `post_assigned`, `mention`. The prefs `type` also allows `'__all__'` (master pause).
- **`notifications.id` is `uuid`** (not `bigint`). All TypeScript touching it uses `string`, never `number`. (The old mention handler mis-annotated it `number`; do not copy that.)
- **Cron auth:** verify `x-cron-secret` (timing-safe) BEFORE any work. Never wildcard CORS; use `buildCorsHeaders(req)`. Never return raw error detail to clients; log internally, return generic.
- **Bound every edge I/O** with `AbortSignal.timeout(10_000)` (Resend fetch AND the supabase client's `global.fetch`) — an unbounded fetch can outlive the isolate and bypass `catch`.
- **`REVOKE … FROM PUBLIC` also strips `service_role`** on this instance. After revoking, `GRANT EXECUTE … TO service_role` explicitly; verify with `proacl`, not `has_function_privilege`.
- **Migration version prefixes** must be unique AND sit above `origin/main`'s migrations tail. `origin/main` already holds `20260813000001_pagarme_dunning_key` and `20260813000002_grant_pagarme_plan`, so this plan uses `20260813000003` (prefs table, Task 1 — already committed), `20260813000004` (claim RPC, Task 2), `20260813000005` (reschedule, Task 6). **Re-verify at PR-open time** with `git ls-tree origin/main:supabase/migrations | tail` and renumber above the tail if main advances further (the `migration-version-guard` CI job fails on duplicates; this repo has hit collisions before).
- **Icons:** `lucide-react` only. Toggles: shadcn `Switch` (`@/components/ui/switch`).
- **`store/*` exports plain async functions;** components wrap them in TanStack Query `useQuery`/`useMutation`.
- **`npm run test:functions` dirties root `deno.lock`** — run `git checkout -- deno.lock` afterward.
- **Deploy edge crons** with `--no-verify-jwt --use-api`.

## File Structure

**Create:**
- `supabase/migrations/20260813000003_notification_email_prefs.sql` — prefs table + CHECK + RLS + grants. (Task 1, already committed.)
- `supabase/migrations/20260813000004_claim_notification_emails.sql` — atomic claim RPC + partial index + explicit `service_role` grant.
- `supabase/migrations/20260813000005_reschedule_notification_email_cron.sql` — unschedule `mention-email-cron`, schedule `notification-email-cron`.
- `supabase/functions/_shared/notification-email.ts` — digest item resolution + HTML render + subject + `sendNotificationDigestEmail` + idempotency-key helper. (Supersedes `_shared/mention-email.ts`.)
- `supabase/functions/notification-email-cron/handler.ts` — DI business logic (claim RPC → group → order → send → reset/release/deadline).
- `supabase/functions/notification-email-cron/index.ts` — auth wrapper + bounded fetch + wiring.
- `supabase/functions/__tests__/notification-email_test.ts` — pure resolver/render/subject unit tests.
- `supabase/functions/__tests__/notification-email-cron_test.ts` — handler orchestration tests.
- `supabase/tests/entitlements/64_notification_email_prefs.sql` — RLS + atomic-claim security tests.
- `apps/crm/src/store/notificationPrefs.ts` — types + `getNotificationEmailPrefs` / `setNotificationEmailPref` / `setMasterEmailPause`.
- `apps/crm/src/pages/configuracao/tabs/NotificacoesTab.tsx` — the settings UI.
- `apps/crm/src/pages/configuracao/__tests__/NotificacoesTab.test.tsx` — tab behavior test.

**Modify:**
- `supabase/config.toml` — add `[functions.notification-email-cron]` / `verify_jwt = false`.
- `apps/crm/src/store/index.ts` — add `export * from './notificationPrefs'`.
- `apps/crm/src/pages/configuracao/configTabs.ts` — add the Notificações tab.
- `apps/crm/src/App.tsx` — lazy import + route for the tab.

**Delete (in Task 6, after the new cron passes):**
- `supabase/functions/mention-email-cron/handler.ts`, `.../index.ts`
- `supabase/functions/_shared/mention-email.ts`
- `supabase/functions/__tests__/mention-email-cron_test.ts`

---

### Task 1: Preferences table migration

**Files:**
- Create: `supabase/migrations/20260813000001_notification_email_prefs.sql`
- Test: `supabase/tests/entitlements/64_notification_email_prefs.sql` (Part A; Part B added in Task 2)

**Interfaces:**
- Produces: table `notification_email_prefs (user_id uuid, type text, enabled boolean, updated_at timestamptz, PK(user_id,type))`; RLS restricting all access to `user_id = auth.uid()`.

- [ ] **Step 1: Write the migration**

```sql
-- 20260813000001_notification_email_prefs.sql
-- Per-user, per-type opt-out for agency notification emails. Stores only
-- overrides: NO row = default ON. A row enabled=false = opted out of that type.
-- type='__all__' with enabled=false = master "pause all email" switch.
create table if not exists notification_email_prefs (
  user_id    uuid    not null references auth.users(id) on delete cascade,
  type       text    not null,
  enabled    boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, type),
  constraint notification_email_prefs_type_check check (type in (
    'post_publish_failed','post_correction','post_message','client_message',
    'deadline_approaching','task_assigned','post_assigned','mention','__all__'
  ))
);

alter table notification_email_prefs enable row level security;

drop policy if exists nep_select on notification_email_prefs;
create policy nep_select on notification_email_prefs
  for select using (user_id = auth.uid());
drop policy if exists nep_insert on notification_email_prefs;
create policy nep_insert on notification_email_prefs
  for insert with check (user_id = auth.uid());
drop policy if exists nep_update on notification_email_prefs;
create policy nep_update on notification_email_prefs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists nep_delete on notification_email_prefs;
create policy nep_delete on notification_email_prefs
  for delete using (user_id = auth.uid());

-- RLS is the gate; there is no privilege-escalation column here (unlike membros),
-- so a plain full-table grant to authenticated is correct.
grant select, insert, update, delete on notification_email_prefs to authenticated;
```

- [ ] **Step 2: Write the RLS entitlement test (Part A)**

Read `supabase/tests/entitlements/_helpers.sql` and `.../58_loops_candidates.sql` first for the `set local role authenticated` / `request.jwt.claim.sub` idiom used to impersonate a user.

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Part A: notification_email_prefs RLS — a user sees/writes only their own rows.
begin;
select et_grant_hosted_parity();
do $$
declare v_u1 uuid := gen_random_uuid(); v_u2 uuid := gen_random_uuid(); v_n int;
begin
  insert into auth.users (id, email) values (v_u1, 'u1@x.test'), (v_u2, 'u2@x.test');
  -- Seed one pref for each user as the table owner (bypasses RLS).
  insert into notification_email_prefs (user_id, type, enabled)
    values (v_u1, 'mention', false), (v_u2, 'mention', false);

  -- Impersonate u1: RLS must expose only u1's row.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_u1::text, true);
  select count(*) into v_n from notification_email_prefs;
  assert v_n = 1, format('u1 must see exactly 1 row, saw %s', v_n);

  -- u1 cannot write a row for u2 (WITH CHECK).
  begin
    insert into notification_email_prefs (user_id, type, enabled)
      values (v_u2, 'post_message', false);
    assert false, 'u1 inserting a pref for u2 must be denied by RLS';
  exception when insufficient_privilege or check_violation then null;
  end;

  reset role;
  raise notice 'PASS 64 Part A notification_email_prefs RLS';
end $$;
rollback;
```

- [ ] **Step 3: Run the entitlement test (if Docker/colima is up)**

Run: `bash scripts/test-entitlements.sh` (or the psql invocation it wraps against local supabase).
Expected: `PASS 64 Part A …`. If no local DB, note that CI's `entitlement-tests` job enforces it; do not skip writing the test.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260813000001_notification_email_prefs.sql \
        supabase/tests/entitlements/64_notification_email_prefs.sql
git commit -m "feat(notifications): notification_email_prefs table + RLS"
```

---

### Task 2: Atomic claim RPC migration

**Files:**
- Create: `supabase/migrations/20260813000004_claim_notification_emails.sql`
- Test: `supabase/tests/entitlements/64_notification_email_prefs.sql` (append Part B)

**Interfaces:**
- Consumes: `notification_email_prefs` (Task 1), `notifications`, `workspace_members`.
- Produces: `claim_notification_emails(p_settle_before timestamptz, p_after timestamptz, p_limit int) RETURNS TABLE (id uuid, user_id uuid, type text, metadata jsonb, link text, created_at timestamptz)` — atomically stamps `emailed_at` and returns claimed rows. `EXECUTE` granted to `service_role` only.

- [ ] **Step 1: Write the migration**

```sql
-- 20260813000004_claim_notification_emails.sql
-- Atomic claim for the notification digest cron. Every predicate — type set,
-- settle/age window, read/dismissed/emailed re-check, workspace membership, and
-- preference opt-out — is embedded in ONE statement so the send/no-send decision
-- is atomic with the claim. Mirrors claim_marketing_email (20260803000004):
--   * membership EXISTS closes the removed-user leak (a user removed from a
--     workspace keeps their notification rows; nothing deletes them).
--   * pref NOT EXISTS closes the opt-out race (a candidate-then-claim design
--     could stamp emailed_at on a row the user opted out of between the two).
--   * FOR UPDATE SKIP LOCKED keeps concurrent cron runs disjoint.
create or replace function claim_notification_emails(
  p_settle_before timestamptz,
  p_after         timestamptz,
  p_limit         int
)
returns table (id uuid, user_id uuid, type text, metadata jsonb, link text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  update notifications n
     set emailed_at = now()
   where n.id in (
     select n2.id from notifications n2
     where n2.type = any (array[
       'post_publish_failed','post_correction','post_message','client_message',
       'deadline_approaching','task_assigned','post_assigned','mention'
     ])
       and n2.read_at is null and n2.dismissed_at is null and n2.emailed_at is null
       and n2.created_at <= p_settle_before and n2.created_at >= p_after
       and exists (
         select 1 from workspace_members wm
         where wm.workspace_id = n2.workspace_id and wm.user_id = n2.user_id
       )
       and not exists (
         select 1 from notification_email_prefs p
         where p.user_id = n2.user_id and p.enabled = false
           and (p.type = n2.type or p.type = '__all__')
       )
     order by n2.created_at asc
     limit p_limit
     for update skip locked
   )
  returning n.id, n.user_id, n.type, n.metadata, n.link, n.created_at;
$$;

-- Keep the cross-user sweep cheap.
create index if not exists idx_notifications_email_pending
  on notifications (created_at)
  where read_at is null and dismissed_at is null and emailed_at is null;

-- REVOKE FROM PUBLIC also strips service_role on this instance — re-grant it.
revoke all on function claim_notification_emails(timestamptz, timestamptz, int)
  from public, anon, authenticated;
grant execute on function claim_notification_emails(timestamptz, timestamptz, int)
  to service_role;
```

- [ ] **Step 2: Append the claim-security entitlement test (Part B)**

Append to `supabase/tests/entitlements/64_notification_email_prefs.sql`. This is the security boundary and can only be proven against a real DB.

```sql
-- Part B: claim_notification_emails predicates.
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws  uuid := et_make_workspace('free');
  v_in  uuid := gen_random_uuid();   -- member, opted in
  v_out uuid := gen_random_uuid();   -- member, opted out of post_message
  v_gone uuid := gen_random_uuid();  -- was a member, now removed
  v_settle timestamptz := now() - interval '11 minutes';
  v_claimed int;
  v_has_gone int;
begin
  insert into auth.users (id, email) values
    (v_in,'in@x.test'), (v_out,'out@x.test'), (v_gone,'gone@x.test');
  insert into workspace_members (workspace_id, user_id, role) values
    (v_ws, v_in, 'admin'), (v_ws, v_out, 'admin');
  -- v_gone is intentionally NOT in workspace_members (removed), but still has a row.

  insert into notifications (workspace_id, user_id, type, metadata, link, created_at) values
    (v_ws, v_in,   'post_message', '{}'::jsonb, '/x', now() - interval '20 minutes'),
    (v_ws, v_out,  'post_message', '{}'::jsonb, '/x', now() - interval '20 minutes'),
    (v_ws, v_gone, 'post_message', '{}'::jsonb, '/x', now() - interval '20 minutes');

  -- v_out opts out of post_message; v_in opts out of nothing.
  insert into notification_email_prefs (user_id, type, enabled)
    values (v_out, 'post_message', false);

  select count(*) into v_claimed
    from claim_notification_emails(v_settle, now() - interval '24 hours', 100);

  -- Only v_in is claimed: v_out is opted out, v_gone is no longer a member.
  assert v_claimed = 1, format('expected 1 claimed, got %s', v_claimed);

  select count(*) into v_has_gone
    from notifications where user_id = v_gone and emailed_at is not null;
  assert v_has_gone = 0, 'removed user notification must NOT be claimed (emailed_at stays NULL)';

  raise notice 'PASS 64 Part B claim_notification_emails membership + opt-out';
end $$;
rollback;

-- Part C: authenticated cannot execute the claim RPC.
begin;
select et_grant_hosted_parity();
do $$
begin
  set local role authenticated;
  begin
    perform claim_notification_emails(now(), now() - interval '24 hours', 1);
    assert false, 'authenticated must NOT be able to execute claim_notification_emails';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'PASS 64 Part C claim RPC is service_role-only';
end $$;
rollback;
```

- [ ] **Step 3: Run the entitlement test**

Run: `bash scripts/test-entitlements.sh`
Expected: `PASS 64 Part B …` and `PASS 64 Part C …`. (If no local DB: CI enforces.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260813000004_claim_notification_emails.sql \
        supabase/tests/entitlements/64_notification_email_prefs.sql
git commit -m "feat(notifications): atomic claim_notification_emails RPC"
```

---

### Task 3: Shared digest module (pure resolver + renderer)

**Files:**
- Create: `supabase/functions/_shared/notification-email.ts`
- Test: `supabase/functions/__tests__/notification-email_test.ts`

**Interfaces:**
- Consumes: `getPublishErrorDisplay` from `_shared/publish-error-codes.ts` (returns `{ titulo, explicacao }` — there is NO `solução` field); `escapeHtml` from `_shared/report-template/escape.ts`; `appBaseUrl` from `_shared/app-url.ts`.
- Produces:
  - `interface DigestItem { priority: number; heading: string; body?: string; context?: string; link: string }`
  - `resolveDigestItem(row: { type: string; metadata: Record<string, unknown> | null; link: string | null }): DigestItem`
  - `digestSubject(items: DigestItem[]): string`
  - `buildDigestHtml(items: DigestItem[], appBase: string): string`
  - `buildDigestIdempotencyKey(userId: string, ids: string[]): Promise<string>`
  - `sendNotificationDigestEmail(p: { to: string; items: DigestItem[]; idempotencyKey: string }): Promise<{ skipped: boolean }>`

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/functions/__tests__/notification-email_test.ts
import { assert, assertEquals } from "./assert.ts";
import {
  buildDigestIdempotencyKey,
  digestSubject,
  resolveDigestItem,
} from "../_shared/notification-email.ts";

Deno.test("resolveDigestItem: publish failure reuses getPublishErrorDisplay copy", () => {
  const item = resolveDigestItem({
    type: "post_publish_failed",
    metadata: { publish_error_code: "TOKEN_EXPIRED", client_name: "ACME", post_title: "Lançamento" },
    link: "/entregas?drawer=1&post=2",
  });
  assertEquals(item.priority, 1);
  assertEquals(item.heading, "Conexão com o Instagram expirou");
  assert(item.body!.includes("Reconecte"));
  assertEquals(item.context, "ACME · Lançamento");
  assertEquals(item.link, "/entregas?drawer=1&post=2");
});

Deno.test("resolveDigestItem: mention priority is last, uses actor + excerpt", () => {
  const item = resolveDigestItem({
    type: "mention",
    metadata: { actor_name: "Ana", context_title: "Post A", excerpt: "veja isso" },
    link: "/x",
  });
  assertEquals(item.priority, 5);
  assertEquals(item.heading, "Ana mencionou você");
  assertEquals(item.body, "veja isso");
  assertEquals(item.context, "Post A");
});

Deno.test("resolveDigestItem: unknown/missing metadata degrades gracefully, no throw", () => {
  const item = resolveDigestItem({ type: "task_assigned", metadata: null, link: null });
  assertEquals(item.priority, 4);
  assertEquals(item.link, "/");
  assert(item.heading.length > 0);
});

Deno.test("digestSubject: single vs multiple", () => {
  const one = digestSubject([{ priority: 1, heading: "x", link: "/" }]);
  const many = digestSubject([
    { priority: 1, heading: "x", link: "/" },
    { priority: 2, heading: "y", link: "/" },
    { priority: 5, heading: "z", link: "/" },
  ]);
  assert(!one.includes("—"), "no em dash in subject");
  assertEquals(many, "Você tem 3 novidades no Mesaas");
});

Deno.test("buildDigestIdempotencyKey: stable for same id set, differs when it changes", async () => {
  const a = await buildDigestIdempotencyKey("u1", ["b", "a"]);
  const b = await buildDigestIdempotencyKey("u1", ["a", "b"]); // order-insensitive
  const c = await buildDigestIdempotencyKey("u1", ["a", "b", "c"]);
  assertEquals(a, b);
  assert(a !== c);
  assert(a.startsWith("notif-digest:u1:"));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:functions -- --filter "resolveDigestItem"` (then `git checkout -- deno.lock`)
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the module**

```ts
// supabase/functions/_shared/notification-email.ts
import { escapeHtml } from "./report-template/escape.ts";
import { appBaseUrl } from "./app-url.ts";
import { getPublishErrorDisplay } from "./publish-error-codes.ts";

export interface DigestItem {
  priority: number;
  heading: string;
  body?: string;
  context?: string;
  link: string;
}

const DIGEST_FROM = "Mesaas <notificacoes@mesaas.com.br>";

function s(metadata: Record<string, unknown> | null, key: string): string | undefined {
  const v = metadata?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function ctx(a?: string, b?: string): string | undefined {
  return [a, b].filter(Boolean).join(" · ") || undefined;
}

/** Map a claimed notification row to a rendered digest item. Metadata keys are
 * read defensively (verified against the emitting triggers); anything missing
 * degrades to a generic line rather than throwing. Priority = urgency order. */
export function resolveDigestItem(
  row: { type: string; metadata: Record<string, unknown> | null; link: string | null },
): DigestItem {
  const m = row.metadata;
  const link = row.link ?? "/";
  switch (row.type) {
    case "post_publish_failed": {
      const d = getPublishErrorDisplay(s(m, "publish_error_code"));
      return { priority: 1, heading: d.titulo, body: d.explicacao, context: ctx(s(m, "client_name"), s(m, "post_title")), link };
    }
    case "post_correction":
      return { priority: 2, heading: "Correção solicitada pelo cliente", body: s(m, "comentario"), context: ctx(s(m, "client_name"), s(m, "post_title")), link };
    case "post_message":
      return { priority: 2, heading: "Nova mensagem no post", body: s(m, "comentario"), context: ctx(s(m, "client_name"), s(m, "post_title")), link };
    case "client_message":
      return { priority: 2, heading: "Nova mensagem do cliente", body: s(m, "comentario"), context: s(m, "client_name"), link };
    case "deadline_approaching":
      return { priority: 3, heading: "Prazo se aproximando", body: ctx(s(m, "workflow_title"), s(m, "step_name")), context: s(m, "client_name"), link };
    case "task_assigned":
      return { priority: 4, heading: "Tarefa atribuída a você", body: s(m, "task_title"), context: s(m, "client_name"), link };
    case "post_assigned":
      return { priority: 4, heading: "Post atribuído a você", body: s(m, "post_title"), context: s(m, "client_name"), link };
    case "mention":
      return { priority: 5, heading: `${s(m, "actor_name") ?? "Alguém"} mencionou você`, body: s(m, "excerpt"), context: s(m, "context_title"), link };
    default:
      return { priority: 9, heading: "Nova notificação no Mesaas", context: undefined, link };
  }
}

export function digestSubject(items: DigestItem[]): string {
  if (items.length === 1) {
    // Name the single item by its heading (already em-dash-free).
    return `${items[0].heading} no Mesaas`;
  }
  return `Você tem ${items.length} novidades no Mesaas`;
}

function itemRow(it: DigestItem, appBase: string): string {
  const link = escapeHtml(`${appBase}${it.link}`);
  const heading = escapeHtml(it.heading);
  const context = it.context
    ? `<p style="margin:2px 0 0;font-size:12px;color:#888780">${escapeHtml(it.context)}</p>`
    : "";
  const body = it.body
    ? `<p style="margin:6px 0 0;padding:10px 12px;background:#f5f3ee;border-radius:8px;font-size:13px;color:#444441">${escapeHtml(it.body)}</p>`
    : "";
  return `<tr><td style="padding:14px 0;border-bottom:1px solid #ece9e2">
    <p style="margin:0;font-size:14px;color:#1a3d2b"><strong>${heading}</strong></p>
    ${context}${body}
    <p style="margin:8px 0 0"><a href="${link}" style="color:#1a3d2b;font-weight:700;font-size:13px;text-decoration:none">Abrir no Mesaas &rarr;</a></p>
  </td></tr>`;
}

/** Same visual family as _shared/mention-email.ts / lifecycle-emails.ts. */
export function buildDigestHtml(items: DigestItem[], appBase: string): string {
  const rows = items.map((it) => itemRow(it, appBase)).join("");
  return `<!DOCTYPE html>
<html lang="pt-BR"><body style="margin:0;background:#f5f3ee;font-family:Arial,Helvetica,sans-serif;color:#1a3d2b">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden">
      <tr><td style="background:#1a3d2b;padding:26px 28px;text-align:center;color:#ffffff;font-size:18px;font-weight:700">Novidades no Mesaas</td></tr>
      <tr><td style="padding:24px 28px"><table width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
      <tr><td style="padding:18px 28px;background:#f5f3ee;text-align:center;font-size:11px;color:#888780;line-height:1.5">
        Você recebeu este e-mail porque tem notificações não lidas no Mesaas. Ajuste em Configurações · Notificações.<br>Mesaas · gestão inteligente para social media managers
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

/** Stable per (user, exact claimed id set); order-insensitive. Used as the
 * Resend Idempotency-Key so a transient-retry re-claim of the same batch is
 * 409'd (deduped) rather than re-sent. */
export async function buildDigestIdempotencyKey(userId: string, ids: string[]): Promise<string> {
  const payload = [...ids].sort().join(",");
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(payload));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `notif-digest:${userId}:${hex.slice(0, 16)}`;
}

export async function sendNotificationDigestEmail(
  p: { to: string; items: DigestItem[]; idempotencyKey: string },
): Promise<{ skipped: boolean }> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return { skipped: true };
  if (p.items.length === 0) return { skipped: true };

  const base = appBaseUrl();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": p.idempotencyKey,
    },
    body: JSON.stringify({
      from: DIGEST_FROM,
      to: [p.to],
      subject: digestSubject(p.items),
      html: buildDigestHtml(p.items, base),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  // 409 = this Idempotency-Key was already accepted (a prior retry after an
  // ambiguous failure already landed this exact digest). Treat as a successful,
  // deduped send, not a failure — otherwise the caller resets the claim and
  // re-sends until the key expires, producing the duplicate the key exists to
  // prevent. Mirrors _shared/lifecycle-emails.ts.
  if (res.status === 409) return { skipped: false };
  if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
  return { skipped: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:functions -- --filter "resolveDigestItem"` and `--filter "digestSubject"` and `--filter "buildDigestIdempotencyKey"` (then `git checkout -- deno.lock`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/notification-email.ts \
        supabase/functions/__tests__/notification-email_test.ts
git commit -m "feat(notifications): shared digest email module"
git checkout -- deno.lock
```

---

### Task 4: Cron handler (DI business logic)

**Files:**
- Create: `supabase/functions/notification-email-cron/handler.ts`
- Test: `supabase/functions/__tests__/notification-email-cron_test.ts`

**Interfaces:**
- Consumes: `DigestItem`, `resolveDigestItem`, `buildDigestIdempotencyKey`, `sendNotificationDigestEmail` (Task 3); the `claim_notification_emails` RPC (Task 2).
- Produces:
  - `runNotificationEmailCron(deps: NotificationEmailCronDeps): Promise<NotificationEmailCronResult>`
  - `createNotificationEmailCronHandler(deps): (req: Request) => Promise<Response>`
  - types `NotificationEmailCronDeps`, `NotificationEmailDb`, `ClaimedNotificationRow`, `NotificationEmailCronResult`
- Constants: `CLAIM_BATCH_SIZE = 100`, `SEND_DEADLINE_MS = 60_000`, settle window 10 min, age window 24 h.

**Design note:** the claim is now ONE `db.rpc("claim_notification_emails", …)` call (the SQL does the FOR UPDATE SKIP LOCKED + re-checks), so the concurrency/opt-out/membership races are covered by the Task 2 entitlement test, not here. This handler's tests cover orchestration: skip-without-claiming, one-send-per-user, urgency ordering, per-user failure reset, deadline release, unresolved-email failure, and triage report.

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/functions/__tests__/notification-email-cron_test.ts
import { assert, assertEquals } from "./assert.ts";
import {
  createNotificationEmailCronHandler,
  type ClaimedNotificationRow,
  type NotificationEmailCronDeps,
  type NotificationEmailDb,
  runNotificationEmailCron,
} from "../notification-email-cron/handler.ts";
import type { DigestItem } from "../_shared/notification-email.ts";

const NOW = new Date("2026-08-13T12:00:00.000Z");

/** Fake db: one rpc (returns a preset claim set) + a from().update().in() reset
 * spy + auth.admin.getUserById. */
function makeFakeDb(
  claimReturn: ClaimedNotificationRow[],
  userEmails: Record<string, string | null | undefined>,
) {
  const resetCalls: string[][] = [];
  let rpcCalls = 0;
  const db = {
    resetCalls,
    rpcCallCount: () => rpcCalls,
    rpc(_fn: string, _args: unknown) {
      rpcCalls++;
      return Promise.resolve({ data: claimReturn, error: null });
    },
    from(_t: string) {
      return {
        update(_patch: { emailed_at: null }) {
          return { in(_c: string, ids: string[]) { resetCalls.push(ids); return Promise.resolve({ error: null }); } };
        },
      };
    },
    auth: { admin: { getUserById(id: string) {
      return Promise.resolve(
        id in userEmails
          ? { data: { user: { email: userEmails[id] ?? null } }, error: null }
          : { data: { user: null }, error: { message: "not found" } },
      );
    } } },
  };
  return db;
}

function claimed(over: Partial<ClaimedNotificationRow> & { id: string; user_id: string }): ClaimedNotificationRow {
  return { type: "mention", metadata: { actor_name: "Ana", context_title: "Post" }, link: "/x", created_at: "2026-08-13T11:00:00.000Z", ...over };
}

function makeDeps(db: ReturnType<typeof makeFakeDb>, over?: Partial<NotificationEmailCronDeps>) {
  const sent: Array<{ to: string; items: DigestItem[] }> = [];
  const deps: NotificationEmailCronDeps = {
    db: db as unknown as NotificationEmailDb,
    now: () => NOW,
    resendEnabled: true,
    sendDigest: (p) => { sent.push({ to: p.to, items: p.items }); return Promise.resolve({ skipped: false }); },
    ...over,
  };
  return { deps, sent };
}

Deno.test("RESEND unset: skipped, rpc never called", async () => {
  const db = makeFakeDb([claimed({ id: "1", user_id: "u1" })], { u1: "a@x.test" });
  const { deps, sent } = makeDeps(db, { resendEnabled: false });
  const r = await runNotificationEmailCron(deps);
  assertEquals(r, { claimed: 0, emailed: 0, failed: 0, released: 0, skipped: true });
  assertEquals(db.rpcCallCount(), 0);
  assertEquals(sent.length, 0);
});

Deno.test("one send per user, items ordered by urgency (publish failure first, mention last)", async () => {
  const db = makeFakeDb([
    claimed({ id: "1", user_id: "u1", type: "mention", metadata: { actor_name: "Ana", context_title: "P" } }),
    claimed({ id: "2", user_id: "u1", type: "post_publish_failed", metadata: { publish_error_code: "NO_MEDIA" } }),
    claimed({ id: "3", user_id: "u2", type: "task_assigned", metadata: { task_title: "T" } }),
  ], { u1: "a@x.test", u2: "b@x.test" });
  const { deps, sent } = makeDeps(db);
  const r = await runNotificationEmailCron(deps);
  assertEquals(r.claimed, 3);
  assertEquals(r.emailed, 2);
  assertEquals(sent.length, 2);
  const u1 = sent.find((s) => s.to === "a@x.test")!;
  assertEquals(u1.items.map((i) => i.priority), [1, 5]); // publish failure before mention
});

Deno.test("failed send resets that user's ids only", async () => {
  const db = makeFakeDb([
    claimed({ id: "1", user_id: "u1" }),
    claimed({ id: "2", user_id: "u2" }),
  ], { u1: "a@x.test", u2: "b@x.test" });
  const { deps } = makeDeps(db, {
    sendDigest: (p) => p.to === "b@x.test" ? Promise.reject(new Error("down")) : Promise.resolve({ skipped: false }),
  });
  const r = await runNotificationEmailCron(deps);
  assertEquals(r.emailed, 1);
  assertEquals(r.failed, 1);
  assertEquals(db.resetCalls, [["2"]]);
});

Deno.test("unresolved email is a failure and resets the claim", async () => {
  const db = makeFakeDb([claimed({ id: "1", user_id: "u1" })], { u1: null });
  const { deps, sent } = makeDeps(db);
  const r = await runNotificationEmailCron(deps);
  assertEquals(r.emailed, 0);
  assertEquals(r.failed, 1);
  assertEquals(sent.length, 0);
  assertEquals(db.resetCalls, [["1"]]);
});

Deno.test("deadline mid-loop releases remaining users' ids", async () => {
  const db = makeFakeDb([
    claimed({ id: "1", user_id: "u1" }),
    claimed({ id: "2", user_id: "u2" }),
    claimed({ id: "3", user_id: "u3" }),
  ], { u1: "a@x.test", u2: "b@x.test", u3: "c@x.test" });
  let i = 0;
  const nowMs = () => [0, 0, 70_000][Math.min(i++, 2)];
  const { deps, sent } = makeDeps(db, { nowMs });
  const r = await runNotificationEmailCron(deps);
  assertEquals(r.emailed, 1);
  assertEquals(r.released, 2);
  assertEquals(sent.length, 1);
  assertEquals(db.resetCalls.length, 1);
  assertEquals(db.resetCalls[0].sort(), ["2", "3"]);
});

Deno.test("handler rejects a wrong cron secret with 401", async () => {
  const handler = createNotificationEmailCronHandler({
    cronSecret: "seg", timingSafeEqual: (a, b) => a === b, run: () => Promise.resolve(new Response("ok")),
  });
  const res = await handler(new Request("https://x.test/", { headers: { "x-cron-secret": "no" } }));
  assertEquals(res.status, 401);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:functions -- --filter "one send per user"` (then `git checkout -- deno.lock`)
Expected: FAIL (handler not found).

- [ ] **Step 3: Implement the handler**

```ts
// supabase/functions/notification-email-cron/handler.ts
import {
  buildDigestIdempotencyKey,
  type DigestItem,
  resolveDigestItem,
} from "../_shared/notification-email.ts";

interface DbError { message: string }

export interface ClaimedNotificationRow {
  id: string;
  user_id: string;
  type: string;
  metadata: Record<string, unknown> | null;
  link: string | null;
  created_at: string;
}

export interface NotificationEmailDb {
  rpc(
    fn: "claim_notification_emails",
    args: { p_settle_before: string; p_after: string; p_limit: number },
  ): Promise<{ data: ClaimedNotificationRow[] | null; error: DbError | null }>;
  from(table: "notifications"): {
    update(patch: { emailed_at: null }): {
      in(column: "id", ids: string[]): PromiseLike<{ error: DbError | null }>;
    };
  };
  auth: {
    admin: {
      getUserById(userId: string): Promise<{
        data: { user: { email?: string | null } | null } | null;
        error: DbError | null;
      }>;
    };
  };
}

export interface NotificationEmailCronDeps {
  db: NotificationEmailDb;
  now: () => Date;
  nowMs?: () => number;
  resendEnabled: boolean;
  sendDigest: (p: { to: string; items: DigestItem[]; idempotencyKey: string }) => Promise<{ skipped: boolean }>;
  report?: (detail: { failed: number; errors: Array<{ accountId?: string; error: string }> }) => Promise<void>;
}

export interface NotificationEmailCronResult {
  claimed: number; emailed: number; failed: number; released: number; skipped: boolean;
}

const TEN_MINUTES_MS = 10 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const CLAIM_BATCH_SIZE = 100;
const SEND_DEADLINE_MS = 60_000;

async function releaseClaims(db: NotificationEmailDb, ids: string[]): Promise<void> {
  const { error } = await db.from("notifications").update({ emailed_at: null }).in("id", ids);
  if (error) console.error(`[notification-email-cron] release failed for ${ids.length} ids:`, error.message);
}

export async function runNotificationEmailCron(
  deps: NotificationEmailCronDeps,
): Promise<NotificationEmailCronResult> {
  if (!deps.resendEnabled) return { claimed: 0, emailed: 0, failed: 0, released: 0, skipped: true };

  const clockNow = deps.nowMs ?? Date.now;
  const startedAt = clockNow();
  const now = deps.now();
  const settleBefore = new Date(now.getTime() - TEN_MINUTES_MS).toISOString();
  const after = new Date(now.getTime() - TWENTY_FOUR_HOURS_MS).toISOString();

  const { data, error } = await deps.db.rpc("claim_notification_emails", {
    p_settle_before: settleBefore, p_after: after, p_limit: CLAIM_BATCH_SIZE,
  });
  if (error) throw new Error(`claim_notification_emails failed: ${error.message}`);
  const rows = (data ?? []) as ClaimedNotificationRow[];
  if (rows.length === 0) return { claimed: 0, emailed: 0, failed: 0, released: 0, skipped: false };

  const byUser = new Map<string, ClaimedNotificationRow[]>();
  for (const row of rows) {
    const list = byUser.get(row.user_id);
    if (list) list.push(row); else byUser.set(row.user_id, [row]);
  }
  const userEntries = Array.from(byUser.entries());

  let emailed = 0, failed = 0, released = 0;
  const errors: Array<{ accountId?: string; error: string }> = [];

  for (let i = 0; i < userEntries.length; i++) {
    if (clockNow() - startedAt > SEND_DEADLINE_MS) {
      const remainingIds = userEntries.slice(i).flatMap(([, rs]) => rs.map((r) => r.id));
      released += remainingIds.length;
      await releaseClaims(deps.db, remainingIds);
      break;
    }
    const [userId, userRows] = userEntries[i];
    try {
      const { data: userData, error: userErr } = await deps.db.auth.admin.getUserById(userId);
      if (userErr) throw new Error(userErr.message);
      const email = userData?.user?.email;
      if (!email) throw new Error("user has no email on file");

      const items = userRows.map((r) => resolveDigestItem(r)).sort((a, b) => a.priority - b.priority);
      const idempotencyKey = await buildDigestIdempotencyKey(userId, userRows.map((r) => r.id));
      await deps.sendDigest({ to: email, items, idempotencyKey });
      emailed++;
    } catch (e) {
      failed++;
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ accountId: userId, error: message });
      console.error(`[notification-email-cron] send failed for user=${userId}:`, message);
      await releaseClaims(deps.db, userRows.map((r) => r.id));
    }
  }

  if (errors.length > 0 && deps.report) await deps.report({ failed: errors.length, errors });
  return { claimed: rows.length, emailed, failed, released, skipped: false };
}

// ─── Auth wrapper (mention-email-cron's shape) ──────────────────────────────
interface NotificationEmailCronHandlerDeps {
  cronSecret: string;
  run: (req: Request) => Promise<Response>;
  timingSafeEqual: (a: string, b: string) => boolean;
}

export function createNotificationEmailCronHandler(deps: NotificationEmailCronHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    if (!deps.timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json" },
      });
    }
    return deps.run(req);
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:functions -- --filter "notification-email-cron"` and the named tests above (then `git checkout -- deno.lock`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/notification-email-cron/handler.ts \
        supabase/functions/__tests__/notification-email-cron_test.ts
git commit -m "feat(notifications): notification-email-cron handler"
git checkout -- deno.lock
```

---

### Task 5: Cron entrypoint + config.toml

**Files:**
- Create: `supabase/functions/notification-email-cron/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `createNotificationEmailCronHandler`, `runNotificationEmailCron`, `NotificationEmailCronDeps` (Task 4); `sendNotificationDigestEmail` (Task 3); `reportCronFailure` (`_shared/triage.ts`); `timingSafeEqual` (`_shared/crypto.ts`); `buildCorsHeaders` (`_shared/cors.ts`); `createJsonResponder` (`_shared/http.ts`).

- [ ] **Step 1: Write the entrypoint** (mirrors `mention-email-cron/index.ts`, bounded fetch included)

```ts
// supabase/functions/notification-email-cron/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createJsonResponder } from "../_shared/http.ts";
import { sendNotificationDigestEmail } from "../_shared/notification-email.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import {
  createNotificationEmailCronHandler,
  type NotificationEmailCronDeps,
  runNotificationEmailCron,
} from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? (() => { throw new Error("CRON_SECRET is required"); })();
const CRON_NAME = "notification-email-cron";

Deno.serve(createNotificationEmailCronHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async (req: Request): Promise<Response> => {
    const cors = buildCorsHeaders(req);
    const json = createJsonResponder(cors);
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, {
            ...init,
            signal: init?.signal
              ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)])
              : AbortSignal.timeout(10_000),
          }),
      },
    });
    try {
      const deps: NotificationEmailCronDeps = {
        db: svc as unknown as NotificationEmailCronDeps["db"],
        now: () => new Date(),
        resendEnabled: !!Deno.env.get("RESEND_API_KEY"),
        sendDigest: sendNotificationDigestEmail,
        report: (detail) => reportCronFailure(svc, CRON_NAME, detail),
      };
      const result = await runNotificationEmailCron(deps);
      return json({ success: true, ...result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[${CRON_NAME}] run failed:`, message);
      await reportCronFailure(svc, CRON_NAME, { failed: 1, errors: [{ error: message }] });
      return json({ error: "Internal server error" }, 500);
    }
  },
}));
```

- [ ] **Step 2: Add the config.toml entry**

Add near the other cron entries in `supabase/config.toml`:

```toml
[functions.notification-email-cron]
verify_jwt = false
```

- [ ] **Step 3: Typecheck the function bundle**

Run: `npm run test:functions -- --filter "notification-email-cron"` (compiles the entrypoint's imports transitively; then `git checkout -- deno.lock`)
Expected: PASS (no import/type errors).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/notification-email-cron/index.ts supabase/config.toml
git commit -m "feat(notifications): notification-email-cron entrypoint + config"
git checkout -- deno.lock
```

---

### Task 6: Retire the mention cron + reschedule pg_cron

**Files:**
- Create: `supabase/migrations/20260813000005_reschedule_notification_email_cron.sql`
- Delete: `supabase/functions/mention-email-cron/{handler,index}.ts`, `supabase/functions/_shared/mention-email.ts`, `supabase/functions/__tests__/mention-email-cron_test.ts`

**Interfaces:**
- Consumes: `mention` folds into the new cron (Task 3 already handles `type: "mention"`), so deleting the mention-specific path loses no behavior.

- [ ] **Step 1: Verify nothing else imports the mention module**

Run: `grep -rn "mention-email" supabase/functions | grep -v "supabase/functions/mention-email-cron"`
Expected: only `__tests__/mention-email-cron_test.ts` (which is also being deleted). If any OTHER file imports it, stop and reconcile before deleting.

- [ ] **Step 2: Delete the superseded files**

```bash
git rm supabase/functions/mention-email-cron/handler.ts \
       supabase/functions/mention-email-cron/index.ts \
       supabase/functions/_shared/mention-email.ts \
       supabase/functions/__tests__/mention-email-cron_test.ts
```

(Leave the `[functions.mention-email-cron]` block in `config.toml` for now; harmless, removed in a cleanup pass. Optional: remove it in this commit.)

- [ ] **Step 3: Write the reschedule migration**

```sql
-- 20260813000005_reschedule_notification_email_cron.sql
-- Supersede mention-email-cron with notification-email-cron (all 8 types incl.
-- mention). MUST be applied AFTER the notification-email-cron function is
-- deployed — the schedule fires immediately (same rule as 20260803000007).
-- Rollback: unschedule 'notification-email-cron', re-schedule 'mention-email-cron'.
-- Uses the vault.decrypted_secrets subselect form (the vault.decrypted_secret(...)
-- function form does not exist on this instance).
do $$ begin
  if exists (select 1 from cron.job where jobname = 'mention-email-cron') then
    perform cron.unschedule('mention-email-cron');
  end if;
  if exists (select 1 from cron.job where jobname = 'notification-email-cron') then
    perform cron.unschedule('notification-email-cron');
  end if;
end $$;

select cron.schedule(
  'notification-email-cron',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
            || '/functions/v1/notification-email-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
```

- [ ] **Step 4: Verify the function suite still compiles after deletion**

Run: `npm run test:functions` (full suite; then `git checkout -- deno.lock`)
Expected: PASS with no dangling imports.

- [ ] **Step 5: Commit**

```bash
git add -A supabase/functions supabase/migrations/20260813000005_reschedule_notification_email_cron.sql
git commit -m "feat(notifications): supersede mention-email-cron, reschedule pg_cron"
git checkout -- deno.lock
```

---

### Task 7: Frontend store — preferences CRUD

**Files:**
- Create: `apps/crm/src/store/notificationPrefs.ts`
- Modify: `apps/crm/src/store/index.ts`

**Interfaces:**
- Consumes: `supabase` from `./core`.
- Produces:
  - `type NotificationEmailType` (the 8 types)
  - `EMAIL_NOTIFICATION_TYPES: { type: NotificationEmailType; label: string; description: string }[]`
  - `MASTER_PAUSE_TYPE = '__all__'`
  - `getNotificationEmailPrefs(): Promise<Record<string, boolean>>` — map of `type → enabled`, absent = default true
  - `setNotificationEmailPref(type: NotificationEmailType | '__all__', enabled: boolean): Promise<void>`

- [ ] **Step 1: Implement the store module**

```ts
// apps/crm/src/store/notificationPrefs.ts
import { supabase } from './core';

export type NotificationEmailType =
  | 'post_publish_failed'
  | 'post_correction'
  | 'post_message'
  | 'client_message'
  | 'deadline_approaching'
  | 'task_assigned'
  | 'post_assigned'
  | 'mention';

export const MASTER_PAUSE_TYPE = '__all__' as const;

/** UI order + PT copy. No em dashes (period/colon/·). */
export const EMAIL_NOTIFICATION_TYPES: {
  type: NotificationEmailType;
  label: string;
  description: string;
}[] = [
  { type: 'post_publish_failed', label: 'Falha ao publicar', description: 'Quando um post agendado falha ao ser publicado no Instagram.' },
  { type: 'post_correction', label: 'Correção do cliente', description: 'Quando um cliente pede alteração em um post.' },
  { type: 'post_message', label: 'Mensagem em um post', description: 'Quando um cliente comenta em um post específico.' },
  { type: 'client_message', label: 'Mensagem do cliente', description: 'Quando um cliente envia uma mensagem na conversa.' },
  { type: 'deadline_approaching', label: 'Prazo se aproximando', description: 'Quando uma etapa vence no dia seguinte.' },
  { type: 'task_assigned', label: 'Tarefa atribuída a você', description: 'Quando uma tarefa é atribuída a você.' },
  { type: 'post_assigned', label: 'Post atribuído a você', description: 'Quando um post é atribuído a você.' },
  { type: 'mention', label: 'Menções', description: 'Quando alguém menciona você com @.' },
];

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw error ?? new Error('Not authenticated');
  return data.user.id;
}

/** Returns a map of type → enabled. Types absent from the map default to true. */
export async function getNotificationEmailPrefs(): Promise<Record<string, boolean>> {
  const { data, error } = await supabase
    .from('notification_email_prefs')
    .select('type, enabled');
  if (error) throw error;
  const map: Record<string, boolean> = {};
  for (const row of data ?? []) map[row.type as string] = row.enabled as boolean;
  return map;
}

export async function setNotificationEmailPref(
  type: NotificationEmailType | typeof MASTER_PAUSE_TYPE,
  enabled: boolean,
): Promise<void> {
  const user_id = await currentUserId();
  const { error } = await supabase
    .from('notification_email_prefs')
    .upsert({ user_id, type, enabled, updated_at: new Date().toISOString() }, { onConflict: 'user_id,type' });
  if (error) throw error;
}
```

- [ ] **Step 2: Export from the store barrel**

Add to `apps/crm/src/store/index.ts` (after the `notifications` line):

```ts
export * from './notificationPrefs';
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/store/notificationPrefs.ts apps/crm/src/store/index.ts
git commit -m "feat(notifications): store fns for email preferences"
```

---

### Task 8: Settings › Notificações tab

**Files:**
- Create: `apps/crm/src/pages/configuracao/tabs/NotificacoesTab.tsx`
- Create: `apps/crm/src/pages/configuracao/__tests__/NotificacoesTab.test.tsx`
- Modify: `apps/crm/src/pages/configuracao/configTabs.ts`
- Modify: `apps/crm/src/App.tsx`

**Interfaces:**
- Consumes: `getNotificationEmailPrefs`, `setNotificationEmailPref`, `EMAIL_NOTIFICATION_TYPES`, `MASTER_PAUSE_TYPE` (Task 7); shadcn `Switch`; `toast` from `sonner`.

- [ ] **Step 1: Register the tab in `configTabs.ts`**

Add `Bell` to the `lucide-react` import, and insert this entry immediately after the `perfil` entry (keep the `Conta` group adjacent):

```ts
{ path: 'notificacoes', label: 'Notificações', roles: ALL, group: 'Conta', icon: Bell },
```

- [ ] **Step 2: Add the route in `App.tsx`**

Add the lazy import near the other config-tab imports:

```ts
const NotificacoesTab = lazy(() => import('./pages/configuracao/tabs/NotificacoesTab'));
```

Add the route inside the `/configuracao` `<Route>` block (after `perfil`):

```tsx
<Route path="notificacoes" element={<NotificacoesTab />} />
```

(`/configuracao/*` is already covered by the `vercel.json` named route pattern; a new child needs no `vercel.json` change. Verify by confirming a sibling like `/configuracao/armazenamento` works in prod.)

- [ ] **Step 3: Write the failing test**

```tsx
// apps/crm/src/pages/configuracao/__tests__/NotificacoesTab.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const setPref = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../store', () => ({
  getNotificationEmailPrefs: vi.fn().mockResolvedValue({ mention: false }),
  setNotificationEmailPref: (...a: unknown[]) => setPref(...a),
  MASTER_PAUSE_TYPE: '__all__',
  EMAIL_NOTIFICATION_TYPES: [
    { type: 'post_publish_failed', label: 'Falha ao publicar', description: 'x' },
    { type: 'mention', label: 'Menções', description: 'y' },
  ],
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import NotificacoesTab from '../tabs/NotificacoesTab';

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><NotificacoesTab /></QueryClientProvider>);
}

describe('NotificacoesTab', () => {
  beforeEach(() => setPref.mockClear());

  it('reflects stored prefs (mention off) and toggling calls the setter', async () => {
    renderTab();
    // mention comes seeded false; the publish-failure default is on.
    const mention = await screen.findByLabelText('Menções');
    expect((mention as HTMLInputElement).checked).toBe(false);
    fireEvent.click(mention);
    await waitFor(() => expect(setPref).toHaveBeenCalledWith('mention', true));
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npm run test -- NotificacoesTab`
Expected: FAIL (component not found).

- [ ] **Step 5: Implement the tab**

```tsx
// apps/crm/src/pages/configuracao/tabs/NotificacoesTab.tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import {
  getNotificationEmailPrefs,
  setNotificationEmailPref,
  EMAIL_NOTIFICATION_TYPES,
  MASTER_PAUSE_TYPE,
  type NotificationEmailType,
} from '../../../store';

export default function NotificacoesTab() {
  const qc = useQueryClient();
  const { data: prefs, isLoading } = useQuery({
    queryKey: ['notification-email-prefs'],
    queryFn: getNotificationEmailPrefs,
  });

  const mutation = useMutation({
    mutationFn: (v: { type: NotificationEmailType | typeof MASTER_PAUSE_TYPE; enabled: boolean }) =>
      setNotificationEmailPref(v.type, v.enabled),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['notification-email-prefs'] });
      const prev = qc.getQueryData<Record<string, boolean>>(['notification-email-prefs']);
      qc.setQueryData<Record<string, boolean>>(['notification-email-prefs'], (old) => ({ ...(old ?? {}), [v.type]: v.enabled }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['notification-email-prefs'], ctx.prev);
      toast.error('Não foi possível salvar a preferência.');
    },
    onSuccess: () => toast.success('Preferência salva.'),
  });

  if (isLoading) return <div className="flex justify-center p-8"><Spinner /></div>;

  const isEnabled = (type: string) => prefs?.[type] !== false; // absent = default on
  const paused = prefs?.[MASTER_PAUSE_TYPE] === false;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Notificações por e-mail</h2>
        <p className="text-sm text-[color:var(--text-muted)]">
          Escolha quais eventos você quer receber por e-mail. Você continua vendo tudo no sino do app.
        </p>
      </div>

      <label className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <span>
          <span className="block font-medium">Pausar todos os e-mails</span>
          <span className="block text-sm text-[color:var(--text-muted)]">Nenhum e-mail de notificação será enviado enquanto ativo.</span>
        </span>
        <Switch
          aria-label="Pausar todos os e-mails"
          checked={paused}
          onCheckedChange={(v) => mutation.mutate({ type: MASTER_PAUSE_TYPE, enabled: !v })}
        />
      </label>

      <div className="space-y-2">
        {EMAIL_NOTIFICATION_TYPES.map((t) => (
          <label key={t.type} className={`flex items-center justify-between gap-4 rounded-lg border p-4 ${paused ? 'opacity-50' : ''}`}>
            <span>
              <span className="block font-medium">{t.label}</span>
              <span className="block text-sm text-[color:var(--text-muted)]">{t.description}</span>
            </span>
            <Switch
              aria-label={t.label}
              disabled={paused}
              checked={isEnabled(t.type)}
              onCheckedChange={(v) => mutation.mutate({ type: t.type, enabled: v })}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
```

Note on the master switch: the `Switch` is "paused = on" but the stored value is `enabled`. `checked={paused}` shows the pause state; `onCheckedChange={(v) => mutate({ type: '__all__', enabled: !v })}` stores `enabled=false` when the user turns pause ON. The per-type switches store `enabled` directly.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -- NotificacoesTab`
Expected: PASS.

- [ ] **Step 7: Typecheck + lint + format**

Run:
```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run lint
npm run format:check
```
Expected: PASS (run `npm run format` to auto-fix if format:check flags files).

- [ ] **Step 8: Commit**

```bash
git add apps/crm/src/pages/configuracao/tabs/NotificacoesTab.tsx \
        apps/crm/src/pages/configuracao/__tests__/NotificacoesTab.test.tsx \
        apps/crm/src/pages/configuracao/configTabs.ts apps/crm/src/App.tsx
git commit -m "feat(notifications): Settings > Notificacoes email preferences tab"
```

---

### Task 9: Full verification + deploy runbook

**Files:** none (verification + docs).

- [ ] **Step 1: Run the full CI-equivalent gate locally**

```bash
npx tsc -p apps/crm/tsconfig.json   --noEmit
npx tsc -p apps/hub/tsconfig.json   --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run lint
npm run format:check
npm run test
npm run test:functions ; git checkout -- deno.lock
```
Expected: all PASS. (`entitlement-tests` needs Docker/colima locally; CI enforces it regardless — run `bash scripts/test-entitlements.sh` if a local DB is up.)

- [ ] **Step 2: Confirm migration prefixes are still above origin/main's tail**

Run: `git ls-tree origin/main:supabase/migrations | tail`
If main advanced past `20260813000003`, renumber the three migration files above the new tail (and re-run the guard mentally: unique prefixes). This repo has hit version collisions before.

- [ ] **Step 3: Deploy (record the order; the reschedule fires immediately)**

1. `supabase/config.toml` change ships with the code (already committed in Task 5).
2. Deploy the function FIRST:
   `npx supabase functions deploy notification-email-cron --no-verify-jwt --use-api`
3. Then one `db push` applies all three pending migrations (table, claim RPC, reschedule) together:
   `npx supabase db push --linked`
4. `git checkout -- deno.lock` (the deploy may dirty it).
5. Verify the pg_cron swap: `select jobname from cron.job where jobname in ('mention-email-cron','notification-email-cron')` — expect ONLY `notification-email-cron`.
6. Optional cleanup: delete the dormant `mention-email-cron` function from Supabase and remove its `config.toml` block in a follow-up.

**Env/caveats:** `RESEND_API_KEY`, `ALERT_EMAIL`, `CRON_SECRET`, `APP_BASE_URL` must be present (same set the mention cron used). Staging has no `RESEND_API_KEY`, so the cron skips-without-claiming there; end-to-end delivery is verified on prod (first real qualifying event → Resend dashboard). First pg_cron tick is silent on failure — check `cron.job_run_details` after deploy.

- [ ] **Step 4: Commit any renumbering / final notes**

```bash
git add -A && git commit -m "chore(notifications): finalize migration ordering for deploy"
```

---

## Self-Review Notes (for the plan author)

- **Spec coverage:** scope/type-set (Tasks 2–3), prefs table + RLS (Task 1), atomic claim closing P0/P1 (Task 2), digest render + publish-copy reuse + idempotency key (Task 3), cron orchestration + delivery guarantee (Task 4), config.toml P2 (Task 5), supersede + reschedule (Task 6), preferences store (Task 7), settings UI (Task 8), full verification + deploy (Task 9). ✓
- **`notifications.id` is `uuid`/`string`** everywhere in Tasks 3–4 and 7. ✓
- **Metadata keys** used in `resolveDigestItem` are the verified emitter keys: `post_publish_failed`(`publish_error_code/client_name/post_title`), `post_correction`/`post_message`(`comentario/client_name/post_title`), `client_message`(`comentario/client_name`), `task_assigned`(`task_title/client_name`), `post_assigned`(`post_title/client_name`), `mention`(`actor_name/context_title/excerpt`). `deadline_approaching`(`workflow_title/step_name/client_name`) — confirm against `notification-deadline-cron` metadata during Task 3; the defensive `s()` fallback keeps it safe if a key differs.
