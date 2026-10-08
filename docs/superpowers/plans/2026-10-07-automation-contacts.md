# Automation Contacts ("Contatos") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A de-duplicated, filterable, CSV-exportable list of the people reached by a client's Instagram comment-to-DM automations, surviving automation deletion, shown in a "Contatos" tab on Automações and in the client's "Redes sociais" tab.

**Architecture:** Two derived tables (`instagram_automation_contacts`, `instagram_automation_contact_automations`) maintained by SECURITY DEFINER triggers on `instagram_automation_sends`, plus a non-destructive rebuild function used for backfill, repair, and a BEFORE DELETE snapshot on automations. Two SECURITY INVOKER read RPCs (list + counts) under RLS that mirrors `ica_select`. Frontend: a store module, a URL-owned filters hook, a presentational list, a tab, a client-detail section, and a CSV writer extracted from analytics-fluxos.

**Tech Stack:** Postgres/Supabase (plpgsql, RLS, psql entitlement suites), React 19, TanStack Query, React Router v7 (`useSearchParams`), shadcn/ui, Vitest + Testing Library, i18next.

**Spec:** `docs/superpowers/specs/2026-10-07-automation-contacts-design.md` (read it before any task).

## Global Constraints

- Migration versions: `20261009000001` and `20261009000002` (main took `20261008000001/2`). Re-check `ls supabase/migrations | tail -3` on `origin/main` before opening the PR and renumber if taken.
- A contact = every send row with non-null `commenter_id`, any status. `reached` = at least one send with `dm_status = 'sent'` (DM only, never public reply).
- Contacts keyed per client: `UNIQUE (client_id, commenter_id)`.
- RLS on both tables: `conta_id IN (SELECT public.get_my_conta_id()) AND (SELECT public.has_permission('automacoes', 'ver'))`; no write policies for `authenticated`.
- Grants: tables `REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT SELECT TO authenticated; GRANT ALL TO service_role` (hosted default ACLs grant ALL on new tables to `authenticated`, so it must be revoked explicitly). Read RPCs `REVOKE EXECUTE FROM PUBLIC, anon; GRANT EXECUTE TO authenticated, service_role`. Internal functions `REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role`.
- Hot-path triggers swallow errors (`RAISE WARNING`); the BEFORE DELETE snapshot does NOT.
- `rebuild_instagram_automation_contacts` never deletes rows.
- UI copy pt-BR + en, no em-dashes in user-facing strings. Icons: `lucide-react` only. Toasts: `sonner`.
- `can('automacoes','ver') === true` (never truthy check; `can` returns `boolean | 'unknown'`).
- CSV: UTF-8 BOM, `;` separator, CRLF, quote a field containing any of `,` `;` tab `"` CR LF (controller ruling, Task 3); formula guard on every cell and on every segment after a separator; `commenter_id` never exported.
- Username link only when `/^[A-Za-z0-9._]{1,30}$/`, `https://instagram.com/${encodeURIComponent(u)}` through `sanitizeUrl()`.
- Page size 50 (UI, offset), export chunk 500 (keyset on contact `created_at, id`), RPC limit clamp `[1, 500]`.
- Before pushing: `npm run lint`, `npm run format:check`, the four `tsc` commands, `npm run test`. `npm run test:db` needs Docker locally (colima, see memory); CI runs the suites regardless.
- Deploy: `db push` staging then prod BEFORE merging (merge deploys the frontend at once). No edge-function changes.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261009000001_instagram_automation_contacts.sql` | Tables, RLS, grants, source/rebuild functions, triggers, backfill |
| `supabase/migrations/20261009000002_instagram_automation_contacts_rpcs.sql` | `list_instagram_automation_contacts`, `instagram_automation_contact_counts` |
| `supabase/tests/entitlements/99_instagram_automation_contacts.sql` | CI-gated suite for both migrations |
| `apps/crm/src/lib/csvExport.ts` (+ test) | Shared CSV writer (BOM, EOL, field/row with separator, formula guard, download) |
| `apps/crm/src/pages/analytics-fluxos/csv.ts` | Now imports the writer (unchanged except `;`/tab and post-separator formula cells, now quoted/prefixed) |
| `apps/crm/src/store/instagramContacts.ts` (+ test) | Types, RPC wrappers, export keyset loop, query keys, date mapping |
| `apps/crm/src/pages/automacoes/contacts/profileUrl.ts` (+ test) | Username → safe profile URL or null |
| `apps/crm/src/pages/automacoes/contacts/contactsCsv.ts` (+ test) | `buildContactsCsv`, `contactsCsvFilename`, `exportContactsCsv` |
| `apps/crm/src/pages/automacoes/contacts/useContactsFilters.ts` (+ test) | Filters ⇄ query string, `contactsHref` |
| `apps/crm/src/pages/automacoes/contacts/ContactsList.tsx` | Presentational table (desktop) / cards (mobile) |
| `apps/crm/src/pages/automacoes/contacts/ContactsTab.tsx` (+ test) | Filters, paging, export for the Automações tab |
| `apps/crm/src/pages/automacoes/AutomacoesPage.tsx` (+ existing test) | Tabs, gate with `hasContacts`, "Ver contatos (N)" link, invalidations |
| `apps/crm/src/hooks/useEffectiveNavFeatures.ts` (+ test) | Nav visible with automations OR contacts |
| `apps/crm/src/context/AuthContext.tsx` | `MODULE_QUERY_KEYS.automacoes` gains the new keys |
| `apps/crm/src/pages/cliente-detalhe/components/AutomationContactsSection.tsx` (+ test) | Section in Redes sociais |
| `apps/crm/src/pages/cliente-detalhe/tabs/RedesSociaisTab.tsx` | Renders the section |
| `packages/i18n/locales/{pt,en}/automations.json` | `contacts.*` keys |

**Parallelism:** `{1→2}` (DB) runs alongside the frontend. Frontend order: `{3, 4}` in parallel; then `{5, 6}` (5 needs 3+4, 6 needs 4); then `7` (needs 4, 5, 6); then `{8, 9, 10}` in parallel (8 and 10 need 7; 9 needs only 4); `11` last.

**CSV BOM:** always write it as the escape `'\uFEFF'`, never a literal invisible character (a dropped literal makes every BOM test pass trivially).

---

### Task 1: Contacts tables, maintenance triggers, rebuild + backfill

**Files:**
- Create: `supabase/migrations/20261009000001_instagram_automation_contacts.sql`
- Create: `supabase/tests/entitlements/99_instagram_automation_contacts.sql` (sections 1–7; Task 2 appends 8–9)
- Modify: `supabase/tests/entitlements/96_lockdown_definer_function_grants.sql` (first array, service-role-only set: append `'public.rebuild_instagram_automation_contacts(uuid, uuid)'` and `'public.instagram_automation_contact_source(uuid, uuid)'` so their grants are pinned)

**Interfaces:**
- Produces tables `instagram_automation_contacts`, `instagram_automation_contact_automations` (columns exactly as below), functions `instagram_automation_contact_source(uuid, uuid)`, `rebuild_instagram_automation_contacts(uuid, uuid) RETURNS int`, triggers `ias_z1_sync_contact_insert`, `ias_z2_sync_contact_reached`, `ica_z1_sync_contact_names`, `ica_z2_snapshot_contacts_before_delete`.

- [ ] **Step 1: Write the failing suite (sections 1–7)**

Create `supabase/tests/entitlements/99_instagram_automation_contacts.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Contatos das automações (migrations 20261009000001/2, spec
-- docs/superpowers/specs/2026-10-07-automation-contacts-design.md).
-- Sends are inserted through claim_automation_send (the only real insert
-- path) as the table owner, standing in for the service-role worker.

-- Shared fixture: one workspace, flag on, two clients, two automations on
-- client A, one on client B.
create or replace function et_iac_fixture(
  out ws uuid, out owner uuid, out cli_a bigint, out cli_b bigint,
  out auto_a1 uuid, out auto_a2 uuid, out auto_b1 uuid)
language plpgsql as $$
begin
  ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (ws, '{"feature_instagram_automation": true}'::jsonb);
  owner := gen_random_uuid();
  insert into auth.users (id) values (owner);
  insert into workspace_members (user_id, workspace_id, role) values (owner, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws, role = 'owner' where id = owner;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (owner, ws, 'A', 'A', '#000') returning id into cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (owner, ws, 'B', 'B', '#000') returning id into cli_b;
  insert into instagram_comment_automations (conta_id, client_id, name, keywords, dm_message)
    values (ws, cli_a, 'A1', array['x'], 'm') returning id into auto_a1;
  insert into instagram_comment_automations (conta_id, client_id, name, keywords, dm_message)
    values (ws, cli_a, 'A2', array['x'], 'm') returning id into auto_a2;
  insert into instagram_comment_automations (conta_id, client_id, name, keywords, dm_message)
    values (ws, cli_b, 'B1', array['x'], 'm') returning id into auto_b1;
end $$;

-- Claims a send (cooldown 0 so repeat commenters are 'claimed', not skipped).
create or replace function et_iac_send(
  p_comment text, p_auto uuid, p_ws uuid, p_commenter text, p_username text,
  p_text text, p_at timestamptz)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  select send_id into v_id from claim_automation_send(
    p_comment, p_auto, p_ws, 'media-1', p_commenter, p_username, p_text, p_at, 0);
  return v_id;
end $$;

-- 1. Insert → contact + link; same person on a second automation of the same
--    client → one contact, two links, count 2; same person on client B →
--    separate contact. Rows without commenter_id are ignored.
begin;
select et_grant_hosted_parity();
do $$
declare f record; v_n int; v_c record;
begin
  select * into f from et_iac_fixture();
  perform et_iac_send('c1', f.auto_a1, f.ws, 'u1', 'ana', 'quero', '2026-10-01 10:00Z');
  perform et_iac_send('c2', f.auto_a2, f.ws, 'u1', 'ana', 'eu tb', '2026-10-02 10:00Z');
  perform et_iac_send('c3', f.auto_b1, f.ws, 'u1', 'ana', 'oi', '2026-10-03 10:00Z');
  perform et_iac_send('c4', f.auto_a1, f.ws, null, null, 'anon', '2026-10-03 11:00Z');
  -- cooldown-skipped repeat (24h cooldown, u1 already has an in-window send on A1):
  -- status 'skipped', still an interaction
  perform claim_automation_send('c5', f.auto_a1, f.ws, 'media-1', 'u1', 'ana', 'de novo', '2026-10-02 12:00Z', 24);

  select count(*) into v_n from instagram_automation_contacts where conta_id = f.ws;
  assert v_n = 2, format('expected 2 contacts (A and B), got %s', v_n);

  select * into v_c from instagram_automation_contacts where client_id = f.cli_a and commenter_id = 'u1';
  assert v_c.interactions_count = 3, format('count %s (2 claimed + 1 cooldown-skipped)', v_c.interactions_count);
  assert v_c.first_interaction_at = '2026-10-01 10:00Z' and v_c.last_interaction_at = '2026-10-02 12:00Z', 'first/last';
  assert v_c.last_comment_text = 'de novo' and v_c.last_automation_name = 'A1', 'latest fields';
  assert (select status from instagram_automation_sends where comment_id = 'c5') = 'skipped', 'c5 must be cooldown-skipped';
  assert v_c.reached = false, 'not reached before any DM';

  select count(*) into v_n from instagram_automation_contact_automations where contact_id = v_c.id;
  assert v_n = 2, format('expected 2 links, got %s', v_n);
  raise notice 'PASS 99 iac 1 insert/dedupe/per-client';
end $$;
rollback;

-- 2. Out-of-order insert keeps the newer comment's fields; an older comment
--    fills a NULL username. Duplicate comment_id never double counts.
begin;
do $$
declare f record; v_c record;
begin
  select * into f from et_iac_fixture();
  perform et_iac_send('c1', f.auto_a1, f.ws, 'u1', null, 'novo', '2026-10-05 10:00Z');
  perform et_iac_send('c2', f.auto_a1, f.ws, 'u1', 'ana', 'velho', '2026-10-01 10:00Z');
  perform et_iac_send('c2', f.auto_a1, f.ws, 'u1', 'ana', 'velho', '2026-10-01 10:00Z'); -- redelivery
  select * into v_c from instagram_automation_contacts where client_id = f.cli_a and commenter_id = 'u1';
  assert v_c.last_comment_text = 'novo', format('latest text %s', v_c.last_comment_text);
  assert v_c.commenter_username = 'ana', format('username %s', v_c.commenter_username);
  assert v_c.interactions_count = 2, format('dup counted: %s', v_c.interactions_count);
  raise notice 'PASS 99 iac 2 out-of-order + idempotent';
end $$;
rollback;

-- 3. mark_automation_dm_sent → reached on contact and link; a later failed
--    send does not flip it back; a public-reply-only update does not set it.
begin;
do $$
declare f record; v_s1 uuid; v_s2 uuid; v_s3 uuid; v_r boolean; v_lr boolean;
begin
  select * into f from et_iac_fixture();
  v_s1 := et_iac_send('c1', f.auto_a1, f.ws, 'u1', 'ana', 'a', '2026-10-01 10:00Z');
  v_s3 := et_iac_send('c3', f.auto_a1, f.ws, 'u2', 'bia', 'b', '2026-10-01 10:00Z');
  update instagram_automation_sends set public_reply_status = 'sent' where id = v_s3;
  select reached into v_r from instagram_automation_contacts where commenter_id = 'u2';
  assert v_r = false, 'public reply alone must not set reached';

  perform mark_automation_dm_sent(v_s1, 'text');
  select reached into v_r from instagram_automation_contacts where commenter_id = 'u1';
  select l.reached into v_lr from instagram_automation_contact_automations l
    join instagram_automation_contacts c on c.id = l.contact_id where c.commenter_id = 'u1';
  assert v_r and v_lr, 'reached on contact and link';

  v_s2 := et_iac_send('c2', f.auto_a1, f.ws, 'u1', 'ana', 'de novo', '2026-10-02 10:00Z');
  update instagram_automation_sends set status = 'failed', error_code = 'dm_permanent' where id = v_s2;
  select reached into v_r from instagram_automation_contacts where commenter_id = 'u1';
  assert v_r, 'a later failure must not unset reached';
  raise notice 'PASS 99 iac 3 reached';
end $$;
rollback;

-- 4. Delete automation → contact and link survive. Rename (as authenticated)
--    → snapshots updated. Delete client (with automations) → contacts gone,
--    and the delete itself succeeds.
begin;
select et_grant_hosted_parity();
do $$
declare f record; v_n int; v_name text;
begin
  select * into f from et_iac_fixture();
  perform et_iac_send('c1', f.auto_a1, f.ws, 'u1', 'ana', 'a', '2026-10-01 10:00Z');
  perform et_iac_send('c2', f.auto_a2, f.ws, 'u2', 'bia', 'b', '2026-10-01 10:00Z');

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', f.owner, 'role', 'authenticated')::text, true);
  update instagram_comment_automations set name = 'A1 renomeada' where id = f.auto_a1;
  delete from instagram_comment_automations where id = f.auto_a2;
  reset role;

  select last_automation_name into v_name from instagram_automation_contacts where commenter_id = 'u1';
  assert v_name = 'A1 renomeada', format('contact snapshot %s', v_name);
  select automation_name into v_name from instagram_automation_contact_automations where automation_id = f.auto_a1;
  assert v_name = 'A1 renomeada', format('link snapshot %s', v_name);

  select count(*) into v_n from instagram_automation_contact_automations where automation_id = f.auto_a2;
  assert v_n = 1, 'link of the deleted automation must survive';
  select count(*) into v_n from instagram_automation_contacts where commenter_id = 'u2';
  assert v_n = 1, 'contact of the deleted automation must survive';

  delete from clientes where id = f.cli_a;
  select count(*) into v_n from instagram_automation_contacts where client_id = f.cli_a;
  assert v_n = 0, 'client delete cascades contacts';
  select count(*) into v_n from instagram_automation_contact_automations l
    where l.automation_id in (f.auto_a1, f.auto_a2);
  assert v_n = 0, 'client delete cascades links';
  raise notice 'PASS 99 iac 4 retention + rename + client cascade';
end $$;
rollback;

-- 5. Swallowed-error recovery: with the insert trigger disabled, sends land
--    with no contact; deleting the automation snapshots them first.
begin;
do $$
declare f record; v_n int;
begin
  select * into f from et_iac_fixture();
  alter table instagram_automation_sends disable trigger ias_z1_sync_contact_insert;
  perform et_iac_send('c1', f.auto_a1, f.ws, 'u1', 'ana', 'a', '2026-10-01 10:00Z');
  alter table instagram_automation_sends enable trigger ias_z1_sync_contact_insert;
  select count(*) into v_n from instagram_automation_contacts where conta_id = f.ws;
  assert v_n = 0, 'precondition: trigger was off';
  delete from instagram_comment_automations where id = f.auto_a1;
  select count(*) into v_n from instagram_automation_contacts where commenter_id = 'u1';
  assert v_n = 1, 'BEFORE DELETE snapshot must create the contact';
  raise notice 'PASS 99 iac 5 snapshot before delete';
end $$;
rollback;

-- 6. Rebuild reproduces trigger state and is non-destructive.
begin;
do $$
declare f record; v_before jsonb; v_after jsonb; v_n int;
begin
  select * into f from et_iac_fixture();
  perform et_iac_send('c1', f.auto_a1, f.ws, 'u1', 'ana', 'a', '2026-10-01 10:00Z');
  perform et_iac_send('c2', f.auto_a2, f.ws, 'u1', null, 'b', '2026-10-02 10:00Z');
  perform et_iac_send('c3', f.auto_a1, f.ws, 'u2', 'bia', 'c', '2026-10-03 10:00Z');
  select jsonb_agg(to_jsonb(c) - 'updated_at' - 'created_at' order by commenter_id) into v_before
    from instagram_automation_contacts c where conta_id = f.ws;
  perform rebuild_instagram_automation_contacts(f.ws);
  select jsonb_agg(to_jsonb(c) - 'updated_at' - 'created_at' order by commenter_id) into v_after
    from instagram_automation_contacts c where conta_id = f.ws;
  assert v_before = v_after, format('rebuild drift: %s vs %s', v_before, v_after);

  delete from instagram_comment_automations where id = f.auto_a2;
  perform rebuild_instagram_automation_contacts(f.ws);
  select count(*) into v_n from instagram_automation_contact_automations where automation_id = f.auto_a2;
  assert v_n = 1, 'rebuild must keep links of deleted automations';
  select interactions_count into v_n from instagram_automation_contacts where commenter_id = 'u1';
  assert v_n = 2, format('rebuild must keep the deleted automation''s interactions, got %s', v_n);
  raise notice 'PASS 99 iac 6 rebuild';
end $$;
rollback;

-- 7. Security: other workspace sees nothing; authenticated cannot write;
--    composite FK rejects a cross-workspace link; authenticated cannot run
--    rebuild. The two new tables are EXCLUDED from the parity helper: their
--    grants are what this section asserts.
begin;
select et_grant_hosted_parity(array['instagram_automation_contacts', 'instagram_automation_contact_automations']);
do $$
declare f record; g record; v_n int; v_rejected boolean; v_contact uuid;
begin
  select * into f from et_iac_fixture();
  select * into g from et_iac_fixture();
  perform et_iac_send('c1', f.auto_a1, f.ws, 'u1', 'ana', 'a', '2026-10-01 10:00Z');
  select id into v_contact from instagram_automation_contacts where conta_id = f.ws;

  v_rejected := false;
  begin
    insert into instagram_automation_contact_automations
      (contact_id, conta_id, automation_id, automation_name, first_interaction_at, last_interaction_at)
      values (v_contact, g.ws, g.auto_a1, 'x', now(), now());
  exception when foreign_key_violation then v_rejected := true;
  end;
  assert v_rejected, 'composite FK must reject a cross-workspace link';

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', g.owner, 'role', 'authenticated')::text, true);
  select count(*) into v_n from instagram_automation_contacts;
  assert v_n = 0, format('other workspace saw %s contacts', v_n);

  perform set_config('request.jwt.claims',
    json_build_object('sub', f.owner, 'role', 'authenticated')::text, true);
  select count(*) into v_n from instagram_automation_contacts;
  assert v_n = 1, format('owner should see 1, saw %s', v_n);

  v_rejected := false;
  begin
    update instagram_automation_contacts set reached = true;
    get diagnostics v_n = row_count;
    v_rejected := v_n = 0;
  exception when insufficient_privilege then v_rejected := true;
  end;
  assert v_rejected, 'authenticated must not update contacts';

  v_rejected := false;
  begin
    delete from instagram_automation_contacts;
    get diagnostics v_n = row_count;
    v_rejected := v_n = 0;
  exception when insufficient_privilege then v_rejected := true;
  end;
  assert v_rejected, 'authenticated must not delete contacts';

  v_rejected := false;
  begin
    perform rebuild_instagram_automation_contacts(f.ws);
  exception when insufficient_privilege then v_rejected := true;
  end;
  assert v_rejected, 'authenticated must not execute rebuild';
  reset role;
  raise notice 'PASS 99 iac 7 security';
end $$;
rollback;
```

The custom-role "no automacoes 'ver'" case is in Task 2 section 9 (fixture technique from `75_permission_rls_rewire.sql` RW-03).

- [ ] **Step 2: Run the suite and see it fail**

Local Supabase must be up (colima; see memory `reference_local_supabase_colima`). Then:
```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/entitlements/99_instagram_automation_contacts.sql
```
Expected: FAIL — `relation "instagram_automation_contacts" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261009000001_instagram_automation_contacts.sql`:

```sql
-- Contatos das automações do Instagram (spec
-- docs/superpowers/specs/2026-10-07-automation-contacts-design.md).
-- Tabelas DERIVADAS de instagram_automation_sends, mantidas por trigger, que
-- sobrevivem à exclusão da automação (sends cascateiam com ela).

-- Fecha a corrida backfill × trigger: nenhum send novo entre o backfill e o
-- CREATE TRIGGER. O worker espera o lock (segundos) e segue.
LOCK TABLE instagram_automation_sends IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE instagram_automation_contacts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id              uuid NOT NULL,
  client_id             bigint NOT NULL,
  commenter_id          text NOT NULL,
  commenter_username    text,
  first_interaction_at  timestamptz NOT NULL,
  last_interaction_at   timestamptz NOT NULL,
  interactions_count    int NOT NULL DEFAULT 0,
  reached               boolean NOT NULL DEFAULT false,
  last_comment_text     text,
  last_automation_id    uuid,
  last_automation_name  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT iac_client_commenter_uq UNIQUE (client_id, commenter_id),
  CONSTRAINT iac_id_conta_uq UNIQUE (id, conta_id),
  CONSTRAINT iac_client_same_tenant FOREIGN KEY (client_id, conta_id)
    REFERENCES clientes (id, conta_id) ON DELETE CASCADE
);
CREATE INDEX idx_iac_client_last ON instagram_automation_contacts (client_id, last_interaction_at DESC, id DESC);
CREATE INDEX idx_iac_conta_last  ON instagram_automation_contacts (conta_id, last_interaction_at DESC, id DESC);
CREATE INDEX idx_iac_conta_created ON instagram_automation_contacts (conta_id, created_at, id);

CREATE TABLE instagram_automation_contact_automations (
  contact_id            uuid NOT NULL,
  conta_id              uuid NOT NULL,
  automation_id         uuid NOT NULL,
  automation_name       text NOT NULL,
  first_interaction_at  timestamptz NOT NULL,
  last_interaction_at   timestamptz NOT NULL,
  interactions_count    int NOT NULL DEFAULT 0,
  reached               boolean NOT NULL DEFAULT false,
  last_comment_text     text,
  PRIMARY KEY (contact_id, automation_id),
  CONSTRAINT iaca_contact_same_tenant FOREIGN KEY (contact_id, conta_id)
    REFERENCES instagram_automation_contacts (id, conta_id) ON DELETE CASCADE
);
CREATE INDEX idx_iaca_automation ON instagram_automation_contact_automations (automation_id, last_interaction_at DESC);
CREATE INDEX idx_iaca_conta ON instagram_automation_contact_automations (conta_id);

-- RLS: mesmo predicado de ica_select (20260904000002).
ALTER TABLE instagram_automation_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_automation_contact_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY iac_select ON instagram_automation_contacts
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('automacoes', 'ver'))
  );
CREATE POLICY service_role_bypass_iac ON instagram_automation_contacts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY iaca_select ON instagram_automation_contact_automations
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('automacoes', 'ver'))
  );
CREATE POLICY service_role_bypass_iaca ON instagram_automation_contact_automations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Hosted default ACLs dão ALL em tabela nova para anon/authenticated: revoga
-- explicitamente e devolve só SELECT.
REVOKE ALL ON instagram_automation_contacts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON instagram_automation_contact_automations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON instagram_automation_contacts TO authenticated;
GRANT SELECT ON instagram_automation_contact_automations TO authenticated;
GRANT ALL ON instagram_automation_contacts TO service_role;
GRANT ALL ON instagram_automation_contact_automations TO service_role;

-- Fonte única da derivação (rebuild + snapshot). Só sends de automações VIVAS
-- (as de automações excluídas já cascatearam).
CREATE OR REPLACE FUNCTION instagram_automation_contact_source(
  p_conta_id uuid, p_automation_id uuid)
RETURNS TABLE (
  conta_id uuid, client_id bigint, automation_id uuid, automation_name text,
  commenter_id text, commenter_username text, comment_text text,
  comment_created_at timestamptz, reached boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.conta_id, a.client_id, s.automation_id, a.name,
         s.commenter_id, s.commenter_username, s.comment_text,
         s.comment_created_at, (s.dm_status IS NOT DISTINCT FROM 'sent')
    FROM instagram_automation_sends s
    JOIN instagram_comment_automations a ON a.id = s.automation_id
   WHERE s.commenter_id IS NOT NULL
     AND (p_automation_id IS NULL OR s.automation_id = p_automation_id)
     AND (p_conta_id IS NULL OR s.conta_id = p_conta_id);
$$;
REVOKE ALL ON FUNCTION instagram_automation_contact_source(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION instagram_automation_contact_source(uuid, uuid) TO service_role;

-- Reconciliação NÃO destrutiva: nunca apaga (contatos de automações excluídas
-- não são re-deriváveis e são justamente o que a feature retém).
CREATE OR REPLACE FUNCTION rebuild_instagram_automation_contacts(
  p_conta_id uuid DEFAULT NULL, p_automation_id uuid DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_touched int;
BEGIN
  -- 1. Esqueleto dos contatos que faltam.
  INSERT INTO instagram_automation_contacts
    (conta_id, client_id, commenter_id, first_interaction_at, last_interaction_at)
  SELECT src.conta_id, src.client_id, src.commenter_id,
         min(src.comment_created_at), max(src.comment_created_at)
    FROM instagram_automation_contact_source(p_conta_id, p_automation_id) src
   GROUP BY src.conta_id, src.client_id, src.commenter_id
  ON CONFLICT (client_id, commenter_id) DO NOTHING;

  -- 2. Links das automações vivas: valor exato a partir dos sends.
  WITH src AS (
    SELECT * FROM instagram_automation_contact_source(p_conta_id, p_automation_id)
  ), agg AS (
    SELECT src.conta_id, src.client_id, src.automation_id, src.commenter_id,
           min(src.comment_created_at) AS f, max(src.comment_created_at) AS l,
           count(*)::int AS n, bool_or(src.reached) AS r
      FROM src GROUP BY 1, 2, 3, 4
  ), latest AS (
    SELECT DISTINCT ON (src.automation_id, src.commenter_id)
           src.automation_id, src.commenter_id, src.automation_name, src.comment_text
      FROM src ORDER BY src.automation_id, src.commenter_id, src.comment_created_at DESC
  )
  INSERT INTO instagram_automation_contact_automations AS t
    (contact_id, conta_id, automation_id, automation_name, first_interaction_at,
     last_interaction_at, interactions_count, reached, last_comment_text)
  SELECT c.id, agg.conta_id, agg.automation_id, latest.automation_name, agg.f, agg.l,
         agg.n, agg.r, latest.comment_text
    FROM agg
    JOIN latest USING (automation_id, commenter_id)
    JOIN instagram_automation_contacts c
      ON c.client_id = agg.client_id AND c.commenter_id = agg.commenter_id
  ON CONFLICT (contact_id, automation_id) DO UPDATE SET
    automation_name = EXCLUDED.automation_name,
    first_interaction_at = EXCLUDED.first_interaction_at,
    last_interaction_at = EXCLUDED.last_interaction_at,
    interactions_count = EXCLUDED.interactions_count,
    reached = EXCLUDED.reached,
    last_comment_text = EXCLUDED.last_comment_text;

  -- 3. Contatos tocados: agregados a partir de TODOS os seus links (inclusive
  --    de automações excluídas).
  WITH src AS (
    SELECT * FROM instagram_automation_contact_source(p_conta_id, p_automation_id)
  ), touched AS (
    SELECT DISTINCT c.id
      FROM src JOIN instagram_automation_contacts c
        ON c.client_id = src.client_id AND c.commenter_id = src.commenter_id
  ), agg AS (
    SELECT l.contact_id, min(l.first_interaction_at) AS f, max(l.last_interaction_at) AS la,
           sum(l.interactions_count)::int AS n, bool_or(l.reached) AS r
      FROM instagram_automation_contact_automations l
     WHERE l.contact_id IN (SELECT id FROM touched)
     GROUP BY l.contact_id
  ), latest_link AS (
    SELECT DISTINCT ON (l.contact_id) l.contact_id, l.automation_id, l.automation_name, l.last_comment_text
      FROM instagram_automation_contact_automations l
     WHERE l.contact_id IN (SELECT id FROM touched)
     ORDER BY l.contact_id, l.last_interaction_at DESC
  ), latest_user AS (
    SELECT DISTINCT ON (src.client_id, src.commenter_id)
           src.client_id, src.commenter_id, src.commenter_username AS u, src.comment_created_at AS at
      FROM src WHERE src.commenter_username IS NOT NULL
     ORDER BY src.client_id, src.commenter_id, src.comment_created_at DESC
  )
  UPDATE instagram_automation_contacts c SET
    first_interaction_at = agg.f,
    last_interaction_at = agg.la,
    interactions_count = agg.n,
    reached = agg.r,
    last_comment_text = ll.last_comment_text,
    last_automation_id = ll.automation_id,
    last_automation_name = ll.automation_name,
    commenter_username = coalesce(
      (SELECT CASE WHEN lu.at >= c.last_interaction_at OR c.commenter_username IS NULL
                   THEN lu.u ELSE c.commenter_username END
         FROM latest_user lu
        WHERE lu.client_id = c.client_id AND lu.commenter_id = c.commenter_id),
      c.commenter_username),
    updated_at = now()
  FROM agg JOIN latest_link ll USING (contact_id)
  WHERE c.id = agg.contact_id;
  GET DIAGNOSTICS v_touched = ROW_COUNT;
  RETURN v_touched;
END $$;
REVOKE ALL ON FUNCTION rebuild_instagram_automation_contacts(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION rebuild_instagram_automation_contacts(uuid, uuid) TO service_role;

-- Manutenção no caminho quente do DM: erro vira WARNING (o DM é o produto;
-- contato é derivado e o rebuild repara).
CREATE OR REPLACE FUNCTION sync_instagram_automation_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client bigint;
  v_name text;
  v_contact uuid;
  v_reached boolean;
BEGIN
  BEGIN
    SELECT a.client_id, a.name INTO v_client, v_name
      FROM instagram_comment_automations a WHERE a.id = NEW.automation_id;
    IF v_client IS NULL THEN
      RETURN NULL;
    END IF;

    IF TG_OP = 'INSERT' THEN
      v_reached := NEW.dm_status IS NOT DISTINCT FROM 'sent';

      -- Contato primeiro, link depois (mesma ordem de lock nos dois ramos).
      INSERT INTO instagram_automation_contacts AS t
        (conta_id, client_id, commenter_id, commenter_username, first_interaction_at,
         last_interaction_at, interactions_count, reached, last_comment_text,
         last_automation_id, last_automation_name)
      VALUES
        (NEW.conta_id, v_client, NEW.commenter_id, NEW.commenter_username,
         NEW.comment_created_at, NEW.comment_created_at, 1, v_reached, NEW.comment_text,
         NEW.automation_id, v_name)
      ON CONFLICT (client_id, commenter_id) DO UPDATE SET
        interactions_count = t.interactions_count + 1,
        first_interaction_at = least(t.first_interaction_at, EXCLUDED.first_interaction_at),
        last_interaction_at = greatest(t.last_interaction_at, EXCLUDED.last_interaction_at),
        commenter_username = CASE WHEN EXCLUDED.last_interaction_at >= t.last_interaction_at
          THEN coalesce(EXCLUDED.commenter_username, t.commenter_username)
          ELSE coalesce(t.commenter_username, EXCLUDED.commenter_username) END,
        last_comment_text = CASE WHEN EXCLUDED.last_interaction_at >= t.last_interaction_at
          THEN EXCLUDED.last_comment_text ELSE t.last_comment_text END,
        last_automation_id = CASE WHEN EXCLUDED.last_interaction_at >= t.last_interaction_at
          THEN EXCLUDED.last_automation_id ELSE t.last_automation_id END,
        last_automation_name = CASE WHEN EXCLUDED.last_interaction_at >= t.last_interaction_at
          THEN EXCLUDED.last_automation_name ELSE t.last_automation_name END,
        reached = t.reached OR EXCLUDED.reached,
        updated_at = now()
      RETURNING id INTO v_contact;

      INSERT INTO instagram_automation_contact_automations AS t
        (contact_id, conta_id, automation_id, automation_name, first_interaction_at,
         last_interaction_at, interactions_count, reached, last_comment_text)
      VALUES
        (v_contact, NEW.conta_id, NEW.automation_id, v_name, NEW.comment_created_at,
         NEW.comment_created_at, 1, v_reached, NEW.comment_text)
      ON CONFLICT (contact_id, automation_id) DO UPDATE SET
        interactions_count = t.interactions_count + 1,
        first_interaction_at = least(t.first_interaction_at, EXCLUDED.first_interaction_at),
        last_interaction_at = greatest(t.last_interaction_at, EXCLUDED.last_interaction_at),
        last_comment_text = CASE WHEN EXCLUDED.last_interaction_at >= t.last_interaction_at
          THEN EXCLUDED.last_comment_text ELSE t.last_comment_text END,
        automation_name = EXCLUDED.automation_name,
        reached = t.reached OR EXCLUDED.reached;
    ELSE
      -- UPDATE: o WHEN do trigger garante a virada de dm_status para 'sent'.
      SELECT c.id INTO v_contact FROM instagram_automation_contacts c
       WHERE c.client_id = v_client AND c.commenter_id = NEW.commenter_id;
      IF v_contact IS NULL THEN
        RETURN NULL;
      END IF;
      UPDATE instagram_automation_contacts SET reached = true, updated_at = now()
       WHERE id = v_contact AND NOT reached;
      UPDATE instagram_automation_contact_automations SET reached = true
       WHERE contact_id = v_contact AND automation_id = NEW.automation_id AND NOT reached;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sync_instagram_automation_contact: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION sync_instagram_automation_contact() FROM PUBLIC, anon, authenticated;

-- Renomear a automação roda como authenticated (ica_update); as tabelas novas
-- não têm policy de UPDATE para ele, daí SECURITY DEFINER.
CREATE OR REPLACE FUNCTION sync_instagram_automation_contact_names()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    UPDATE instagram_automation_contacts SET last_automation_name = NEW.name, updated_at = now()
     WHERE conta_id = NEW.conta_id AND last_automation_id = NEW.id;
    UPDATE instagram_automation_contact_automations SET automation_name = NEW.name
     WHERE automation_id = NEW.id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sync_instagram_automation_contact_names: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION sync_instagram_automation_contact_names() FROM PUBLIC, anon, authenticated;

-- Antes de a automação sumir (e cascatear os sends), reconcilia os contatos
-- dela: fecha a janela de um erro engolido pelo trigger quente. NÃO engole
-- erro: falhar o delete é melhor que perder contatos. Pula quando o cliente
-- já está sendo excluído (cascata de clientes): os contatos vão junto.
CREATE OR REPLACE FUNCTION snapshot_instagram_automation_contacts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM clientes WHERE id = OLD.client_id) THEN
    PERFORM rebuild_instagram_automation_contacts(OLD.conta_id, OLD.id);
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION snapshot_instagram_automation_contacts() FROM PUBLIC, anon, authenticated;

-- Backfill com a tabela de sends travada, ANTES dos triggers.
SELECT rebuild_instagram_automation_contacts();

CREATE TRIGGER ias_z1_sync_contact_insert
  AFTER INSERT ON instagram_automation_sends
  FOR EACH ROW WHEN (NEW.commenter_id IS NOT NULL)
  EXECUTE FUNCTION sync_instagram_automation_contact();

CREATE TRIGGER ias_z2_sync_contact_reached
  AFTER UPDATE OF dm_status ON instagram_automation_sends
  FOR EACH ROW WHEN (
    OLD.dm_status IS DISTINCT FROM 'sent' AND NEW.dm_status = 'sent'
    AND NEW.commenter_id IS NOT NULL
  )
  EXECUTE FUNCTION sync_instagram_automation_contact();

CREATE TRIGGER ica_z1_sync_contact_names
  AFTER UPDATE OF name ON instagram_comment_automations
  FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION sync_instagram_automation_contact_names();

CREATE TRIGGER ica_z2_snapshot_contacts_before_delete
  BEFORE DELETE ON instagram_comment_automations
  FOR EACH ROW EXECUTE FUNCTION snapshot_instagram_automation_contacts();

-- Sanidade do backfill: WARNING, nunca EXCEPTION (um erro num lote do db push
-- pode gravar a versão com o DDL revertido).
DO $$
DECLARE v_contacts bigint; v_pairs bigint;
BEGIN
  SELECT count(*) INTO v_contacts FROM instagram_automation_contacts;
  SELECT count(DISTINCT (a.client_id, s.commenter_id)) INTO v_pairs
    FROM instagram_automation_sends s
    JOIN instagram_comment_automations a ON a.id = s.automation_id
   WHERE s.commenter_id IS NOT NULL;
  IF v_contacts <> v_pairs THEN
    RAISE WARNING 'instagram_automation_contacts backfill: % contacts vs % pairs', v_contacts, v_pairs;
  END IF;
END $$;
```

- [ ] **Step 4: Apply and run the suite**

```bash
npx supabase db reset --local
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/entitlements/99_instagram_automation_contacts.sql
bash scripts/test-entitlements.sh
```
Expected: `PASS 99 iac 1` … `PASS 99 iac 7`; the full script still green. Suites 65/66/81 DO insert sends with a non-null `commenter_id` (e.g. 65:332, :761), so `ias_z1` fires there; it is expected to be a no-op for their assertions (each block rolls back, and they assert nothing about contacts).

If section 7's UPDATE raises `insufficient_privilege` vs affecting 0 rows, either outcome passes (the test accepts both). If `et_grant_hosted_parity()` grants the new tables more than SELECT to `authenticated`, check the helper's exclusion parameter.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261009000001_instagram_automation_contacts.sql supabase/tests/entitlements/99_instagram_automation_contacts.sql supabase/tests/entitlements/96_lockdown_definer_function_grants.sql
git commit -m "feat(automations): derived contacts tables maintained from sends"
```

---

### Task 2: Read RPCs (list + counts)

**Files:**
- Create: `supabase/migrations/20261009000002_instagram_automation_contacts_rpcs.sql`
- Modify: `supabase/tests/entitlements/99_instagram_automation_contacts.sql` (append sections 8–9)

**Interfaces:**
- Produces RPC `list_instagram_automation_contacts(p_client_id bigint, p_automation_id uuid, p_from timestamptz, p_to timestamptz, p_reached_only boolean, p_search text, p_limit int, p_offset int, p_export boolean, p_cursor_at timestamptz, p_cursor_id uuid)` returning `(id uuid, client_id bigint, commenter_username text, first_interaction_at timestamptz, last_interaction_at timestamptz, interactions_count int, reached boolean, last_comment_text text, automation_id uuid, automation_name text, automation_deleted boolean, created_at timestamptz, total_count bigint)`.
- Produces RPC `instagram_automation_contact_counts()` returning `(automation_id uuid, automation_name text, client_id bigint, automation_deleted boolean, reached_count bigint, total_count bigint)`.

- [ ] **Step 1: Append failing tests (sections 8–9)**

```sql
-- 8. list RPC: filters, link-level values, escaping, clamp, keyset, empty.
begin;
select et_grant_hosted_parity();
do $$
declare f record; v_s uuid; v_n int; r record; v_last record;
begin
  select * into f from et_iac_fixture();
  v_s := et_iac_send('c1', f.auto_a1, f.ws, 'u1', 'ana_1', 'a1 text', '2026-10-01 10:00Z');
  perform mark_automation_dm_sent(v_s, 'text');
  perform et_iac_send('c2', f.auto_a2, f.ws, 'u1', 'ana_1', 'a2 text', '2026-10-05 10:00Z');
  perform et_iac_send('c3', f.auto_a1, f.ws, 'u2', 'bia%x', 'b', '2026-10-03 10:00Z');
  perform et_iac_send('c4', f.auto_b1, f.ws, 'u3', 'caio', 'c', '2026-10-04 10:00Z');
  -- now() is constant inside the transaction: stagger created_at so the keyset
  -- leg on created_at is actually exercised.
  update instagram_automation_contacts
     set created_at = created_at - make_interval(mins => (case commenter_id when 'u1' then 2 when 'u2' then 1 else 0 end))
   where conta_id = f.ws;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', f.owner, 'role', 'authenticated')::text, true);

  select count(*) into v_n from list_instagram_automation_contacts();
  assert v_n = 1, format('default reached_only: 1 row, got %s', v_n);

  select count(*) into v_n from list_instagram_automation_contacts(p_reached_only => false);
  assert v_n = 3, format('all: 3, got %s', v_n);

  select * into r from list_instagram_automation_contacts(p_reached_only => false) limit 1;
  assert r.total_count = 3 and r.commenter_username = 'ana_1', 'order by last_interaction desc + total';

  select * into r from list_instagram_automation_contacts(
    p_automation_id => f.auto_a1, p_reached_only => false) where id = (
      select id from instagram_automation_contacts where commenter_id = 'u1');
  assert r.last_comment_text = 'a1 text' and r.last_interaction_at = '2026-10-01 10:00Z'
    and r.automation_name = 'A1' and r.interactions_count = 1, 'link-level values when filtered';

  select count(*) into v_n from list_instagram_automation_contacts(p_client_id => f.cli_b, p_reached_only => false);
  assert v_n = 1, 'client filter';

  select count(*) into v_n from list_instagram_automation_contacts(
    p_reached_only => false, p_from => '2026-10-03 00:00Z', p_to => '2026-10-04 00:00Z');
  assert v_n = 1, format('[from,to) range, got %s', v_n);

  select count(*) into v_n from list_instagram_automation_contacts(p_reached_only => false, p_search => '_');
  assert v_n = 1, format('_ must be literal, got %s', v_n);
  select count(*) into v_n from list_instagram_automation_contacts(p_reached_only => false, p_search => '%');
  assert v_n = 1, format('%% must be literal, got %s', v_n);

  select count(*) into v_n from list_instagram_automation_contacts(p_reached_only => false, p_limit => 100000);
  assert v_n = 3, 'clamp does not drop rows below 500';
  select count(*) into v_n from list_instagram_automation_contacts(p_reached_only => false, p_limit => 0);
  assert v_n = 1, 'limit clamps up to 1';

  -- keyset: first page of 2, then the rest after the cursor
  select * into v_last from (
    select * from list_instagram_automation_contacts(p_reached_only => false, p_export => true, p_limit => 2)
  ) x order by created_at desc, id desc limit 1;
  select count(*) into v_n from list_instagram_automation_contacts(
    p_reached_only => false, p_export => true, p_limit => 2,
    p_cursor_at => v_last.created_at, p_cursor_id => v_last.id);
  assert v_n = 1, format('keyset remainder 1, got %s', v_n);

  select count(*) into v_n from list_instagram_automation_contacts(p_search => 'ninguem');
  assert v_n = 0, 'empty result returns no rows';

  reset role;
  delete from instagram_comment_automations where id = f.auto_a2;
  set local role authenticated;
  select automation_deleted into r from list_instagram_automation_contacts(
    p_automation_id => f.auto_a2, p_reached_only => false);
  assert r.automation_deleted, 'deleted automation flagged';
  reset role;
  raise notice 'PASS 99 iac 8 list rpc';
end $$;
rollback;

-- 9. counts RPC + grants + custom role without automacoes 'ver'.
begin;
select et_grant_hosted_parity();
do $$
declare f record; v_s uuid; r record; v_rejected boolean; v_n int;
  v_none uuid := gen_random_uuid(); v_role uuid;
begin
  select * into f from et_iac_fixture();
  insert into auth.users (id) values (v_none);
  insert into workspace_roles (conta_id, nome, permissions)
    values (f.ws, 'IAC sem automacoes', '{"automacoes":"none"}'::jsonb) returning id into v_role;
  insert into workspace_members (user_id, workspace_id, role, role_id)
    values (v_none, f.ws, 'agent', v_role);
  update profiles set conta_id = f.ws, active_workspace_id = f.ws where id = v_none;
  v_s := et_iac_send('c1', f.auto_a1, f.ws, 'u1', 'ana', 'a', '2026-10-01 10:00Z');
  perform mark_automation_dm_sent(v_s, 'text');
  perform et_iac_send('c2', f.auto_a1, f.ws, 'u2', 'bia', 'b', '2026-10-02 10:00Z');

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', f.owner, 'role', 'authenticated')::text, true);
  select * into r from instagram_automation_contact_counts() where automation_id = f.auto_a1;
  assert r.reached_count = 1 and r.total_count = 2 and r.client_id = f.cli_a
    and r.automation_name = 'A1' and not r.automation_deleted, format('counts %s', row_to_json(r));
  reset role;

  set local role anon;
  v_rejected := false;
  begin
    perform * from list_instagram_automation_contacts();
  exception when insufficient_privilege then v_rejected := true;
  end;
  assert v_rejected, 'anon must not execute list';
  v_rejected := false;
  begin
    perform * from instagram_automation_contact_counts();
  exception when insufficient_privilege then v_rejected := true;
  end;
  assert v_rejected, 'anon must not execute counts';
  reset role;

  -- Custom role with automacoes = 'none' sees nothing (table nor RPC).
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_none, 'role', 'authenticated')::text, true);
  select count(*) into v_n from instagram_automation_contacts;
  assert v_n = 0, format('no-permission role saw %s contacts', v_n);
  select count(*) into v_n from list_instagram_automation_contacts(p_reached_only => false);
  assert v_n = 0, format('no-permission role saw %s rows via RPC', v_n);
  reset role;
  raise notice 'PASS 99 iac 9 counts + grants';
end $$;
rollback;
```

- [ ] **Step 2: Run, expect FAIL** (`function list_instagram_automation_contacts() does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- RPCs de leitura dos contatos das automações. SECURITY INVOKER: a RLS das
-- tabelas (mesmo predicado de ica_select) faz o filtro de tenant/permissão.

CREATE OR REPLACE FUNCTION list_instagram_automation_contacts(
  p_client_id      bigint      DEFAULT NULL,
  p_automation_id  uuid        DEFAULT NULL,
  p_from           timestamptz DEFAULT NULL,
  p_to             timestamptz DEFAULT NULL,
  p_reached_only   boolean     DEFAULT true,
  p_search         text        DEFAULT NULL,
  p_limit          int         DEFAULT 50,
  p_offset         int         DEFAULT 0,
  p_export         boolean     DEFAULT false,
  p_cursor_at      timestamptz DEFAULT NULL,
  p_cursor_id      uuid        DEFAULT NULL)
RETURNS TABLE (
  id uuid, client_id bigint, commenter_username text,
  first_interaction_at timestamptz, last_interaction_at timestamptz,
  interactions_count int, reached boolean, last_comment_text text,
  automation_id uuid, automation_name text, automation_deleted boolean,
  created_at timestamptz, total_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH base AS (
    SELECT c.id, c.client_id, c.commenter_username, c.created_at,
           CASE WHEN p_automation_id IS NULL THEN c.first_interaction_at ELSE l.first_interaction_at END AS first_interaction_at,
           CASE WHEN p_automation_id IS NULL THEN c.last_interaction_at ELSE l.last_interaction_at END AS last_interaction_at,
           CASE WHEN p_automation_id IS NULL THEN c.interactions_count ELSE l.interactions_count END AS interactions_count,
           CASE WHEN p_automation_id IS NULL THEN c.reached ELSE l.reached END AS reached,
           CASE WHEN p_automation_id IS NULL THEN c.last_comment_text ELSE l.last_comment_text END AS last_comment_text,
           CASE WHEN p_automation_id IS NULL THEN c.last_automation_id ELSE l.automation_id END AS automation_id,
           CASE WHEN p_automation_id IS NULL THEN c.last_automation_name ELSE l.automation_name END AS automation_name
      FROM instagram_automation_contacts c
      LEFT JOIN instagram_automation_contact_automations l
        ON p_automation_id IS NOT NULL AND l.contact_id = c.id AND l.automation_id = p_automation_id
     WHERE (p_automation_id IS NULL OR l.contact_id IS NOT NULL)
       AND (p_client_id IS NULL OR c.client_id = p_client_id)
  ), filtered AS (
    SELECT b.* FROM base b
     WHERE (NOT coalesce(p_reached_only, true) OR b.reached)
       AND (p_from IS NULL OR b.last_interaction_at >= p_from)
       AND (p_to IS NULL OR b.last_interaction_at < p_to)
       AND (coalesce(p_search, '') = ''
            OR b.commenter_username ILIKE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  ), counted AS (
    SELECT f.*, count(*) OVER () AS total_count FROM filtered f
  )
  SELECT x.id, x.client_id, x.commenter_username, x.first_interaction_at, x.last_interaction_at,
         x.interactions_count, x.reached, x.last_comment_text, x.automation_id, x.automation_name,
         (x.automation_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM instagram_comment_automations a WHERE a.id = x.automation_id)) AS automation_deleted,
         x.created_at, x.total_count
    FROM counted x
   WHERE NOT coalesce(p_export, false) OR p_cursor_at IS NULL
      OR (x.created_at, x.id) > (p_cursor_at, p_cursor_id)
   ORDER BY
     CASE WHEN coalesce(p_export, false) THEN x.created_at END ASC,
     CASE WHEN coalesce(p_export, false) THEN x.id END ASC,
     CASE WHEN NOT coalesce(p_export, false) THEN x.last_interaction_at END DESC,
     CASE WHEN NOT coalesce(p_export, false) THEN x.id END DESC
   LIMIT greatest(1, least(coalesce(p_limit, 50), 500))
  OFFSET CASE WHEN coalesce(p_export, false) THEN 0 ELSE greatest(0, coalesce(p_offset, 0)) END;
$$;

REVOKE EXECUTE ON FUNCTION list_instagram_automation_contacts(bigint, uuid, timestamptz, timestamptz, boolean, text, int, int, boolean, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION list_instagram_automation_contacts(bigint, uuid, timestamptz, timestamptz, boolean, text, int, int, boolean, timestamptz, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION instagram_automation_contact_counts()
RETURNS TABLE (
  automation_id uuid, automation_name text, client_id bigint,
  automation_deleted boolean, reached_count bigint, total_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT l.automation_id, max(l.automation_name), c.client_id,
         NOT EXISTS (SELECT 1 FROM instagram_comment_automations a WHERE a.id = l.automation_id),
         count(*) FILTER (WHERE l.reached), count(*)
    FROM instagram_automation_contact_automations l
    JOIN instagram_automation_contacts c ON c.id = l.contact_id
   GROUP BY l.automation_id, c.client_id;
$$;

REVOKE EXECUTE ON FUNCTION instagram_automation_contact_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION instagram_automation_contact_counts() TO authenticated, service_role;
```

- [ ] **Step 4: Run** `npx supabase db reset --local && bash scripts/test-entitlements.sh` → all PASS including `99 iac 8`, `99 iac 9`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261009000002_instagram_automation_contacts_rpcs.sql supabase/tests/entitlements/99_instagram_automation_contacts.sql
git commit -m "feat(automations): list + counts RPCs for automation contacts"
```

---

### Task 3: Shared CSV writer (`lib/csvExport.ts`)

**Files:**
- Create: `apps/crm/src/lib/csvExport.ts`, `apps/crm/src/lib/__tests__/csvExport.test.ts`
- Modify: `apps/crm/src/pages/analytics-fluxos/csv.ts` (lines 20–54, 206–217)

**Interfaces:**
- Produces: `CSV_BOM: string`, `CSV_EOL: '\r\n'`, `csvField(value: string | number, separator?: string): string`, `csvRow(cells: (string | number)[], separator?: string): string`, `downloadCsv(csv: string, filename: string): void`. Default separator `','`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { CSV_BOM, CSV_EOL, csvField, csvRow } from '../csvExport';

describe('csvExport', () => {
  it('exposes BOM and CRLF', () => {
    expect(CSV_BOM).toBe('\uFEFF');
    expect(CSV_EOL).toBe('\r\n');
  });

  it('quotes the active separator only', () => {
    expect(csvField('a;b', ';')).toBe('"a;b"');
    expect(csvField('a,b', ';')).toBe('a,b');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('a;b')).toBe('a;b');
  });

  it('quotes quotes and line breaks, doubling quotes', () => {
    expect(csvField('diz "oi"', ';')).toBe('"diz ""oi"""');
    expect(csvField('l1\nl2', ';')).toBe('"l1\nl2"');
    expect(csvField('l1\rl2', ';')).toBe('"l1\rl2"');
  });

  it('neutralizes formulas, including behind leading whitespace/control chars', () => {
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvField('  +1')).toBe("'  +1");
    expect(csvField('\t-2')).toBe("'\t-2");
    expect(csvField('@x')).toBe("'@x");
    expect(csvField('=1;2', ';')).toBe('"\'=1;2"');
  });

  it('joins rows with the separator', () => {
    expect(csvRow(['a', 1, 'b;c'], ';')).toBe('a;1;"b;c"');
    expect(csvRow(['a', 1])).toBe('a,1');
  });
});
```

- [ ] **Step 2:** `npx vitest run apps/crm/src/lib/__tests__/csvExport.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
/**
 * Shared CSV writer. Excel only reads a UTF-8 CSV as UTF-8 when it opens with
 * the byte order mark. Moved from pages/analytics-fluxos/csv.ts so the
 * automation contacts export (`;`-separated) and analytics (`,`) share one
 * formula guard.
 */
export const CSV_BOM = '\uFEFF';

export const CSV_EOL = '\r\n';

/**
 * A field a spreadsheet would evaluate: one of `= + - @` as the first character
 * that is not whitespace or a control character. Excel and Sheets trim the
 * leading run before parsing, so the guard must look past it.
 */
const FORMULA_LEAD = /^[\s\p{Cc}]*[=+\-@]/u;

/**
 * One CSV field: formula-neutralized first, then quoted. The apostrophe must go
 * in BEFORE the quotes, or it ends up outside them and the cell evaluates. A
 * field is quoted when it contains the active separator, a quote or a line
 * break, so `;` output quotes semicolons and `,` output keeps its old shape.
 */
export function csvField(value: string | number, separator = ','): string {
  let out = String(value);
  if (FORMULA_LEAD.test(out)) out = `'${out}`;
  if (out.includes(separator) || /["\n\r]/.test(out)) out = `"${out.replace(/"/g, '""')}"`;
  return out;
}

export function csvRow(cells: (string | number)[], separator = ','): string {
  return cells.map((c) => csvField(c, separator)).join(separator);
}

/** Hands the built CSV to the browser as a download. */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
```

In `apps/crm/src/pages/analytics-fluxos/csv.ts`: delete the local `CSV_BOM`, `EOL`, `FORMULA_LEAD`, `field`, `row` and `downloadCsv` definitions (and their doc comments) and add at the top:

```ts
import { CSV_BOM, CSV_EOL as EOL, csvRow as row } from '@/lib/csvExport';

export { CSV_BOM, downloadCsv } from '@/lib/csvExport';
```

(Existing importers keep working: `AnalyticsFluxosPage.tsx` imports `downloadCsv` from `./csv`; its test imports `CSV_BOM` from `../csv`.)

- [ ] **Step 4:** `npx vitest run apps/crm/src/lib/__tests__/csvExport.test.ts apps/crm/src/pages/analytics-fluxos` → PASS (analytics CSV tests unchanged and green).

- [ ] **Step 5: Commit** `git commit -am "refactor(csv): extract shared CSV writer with separator-aware quoting"` (add the new files first).

---

### Task 4: Store module `instagramContacts.ts` + query keys

**Files:**
- Create: `apps/crm/src/store/instagramContacts.ts`, `apps/crm/src/store/__tests__/instagramContacts.test.ts`
- Modify: `apps/crm/src/store/index.ts` (add `export * from './instagramContacts';` after line 14), `apps/crm/src/context/AuthContext.tsx:131-137`

**Interfaces:**
- Produces:
```ts
export const CONTACTS_KEY = 'instagram-contacts';
export const CONTACT_COUNTS_KEY = ['instagram-contact-counts'] as const;
export const CONTACTS_COUNT_KEY = ['instagram-contacts-count'] as const;
export const CONTACTS_PAGE_SIZE = 50;
export const CONTACTS_EXPORT_CHUNK = 500;
export interface InstagramContact { id: string; client_id: number; commenter_username: string | null; first_interaction_at: string; last_interaction_at: string; interactions_count: number; reached: boolean; last_comment_text: string | null; automation_id: string | null; automation_name: string | null; automation_deleted: boolean; created_at: string; }
export interface ContactFilters { clientId: number | null; automationId: string | null; from: string | null; to: string | null; reachedOnly: boolean; search: string; }  // from/to = 'yyyy-MM-dd' local calendar dates
export interface ContactPage { rows: InstagramContact[]; total: number }
export interface ContactAutomationCount { automation_id: string; automation_name: string; client_id: number; automation_deleted: boolean; reached_count: number; total_count: number }
export function contactFiltersToRpcArgs(f: ContactFilters): Record<string, unknown>
export function listInstagramContacts(f: ContactFilters, page: number, pageSize?: number): Promise<ContactPage>
export function fetchAllInstagramContacts(f: ContactFilters): Promise<InstagramContact[]>
export function getContactCounts(): Promise<ContactAutomationCount[]>
export function countInstagramContacts(): Promise<number>
```

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpc, mockFrom } = vi.hoisted(() => ({ mockRpc: vi.fn(), mockFrom: vi.fn() }));

vi.mock('../core', () => ({
  supabase: { rpc: mockRpc, from: mockFrom },
  getUserId: vi.fn(),
  getContaId: vi.fn(),
  getCurrentProfile: vi.fn(),
  clearProfileCache: vi.fn(),
}));

import {
  contactFiltersToRpcArgs,
  countInstagramContacts,
  fetchAllInstagramContacts,
  listInstagramContacts,
  type ContactFilters,
} from '../instagramContacts';

const F: ContactFilters = {
  clientId: null, automationId: null, from: null, to: null, reachedOnly: true, search: '',
};

function row(id: string, created_at: string) {
  return { id, created_at, total_count: 3 };
}

describe('instagramContacts store', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps local calendar dates to [start of first day, start of day after last)', () => {
    const args = contactFiltersToRpcArgs({ ...F, from: '2026-10-01', to: '2026-10-03', search: ' ana ' });
    expect(args.p_from).toBe(new Date(2026, 9, 1).toISOString());
    expect(args.p_to).toBe(new Date(2026, 9, 4).toISOString());
    expect(args.p_search).toBe('ana');
    expect(args.p_reached_only).toBe(true);
  });

  it('sends nulls for empty filters', () => {
    expect(contactFiltersToRpcArgs(F)).toEqual({
      p_client_id: null, p_automation_id: null, p_from: null, p_to: null,
      p_reached_only: true, p_search: null,
    });
  });

  it('lists a page with offset and reads total from the first row (0 when empty)', async () => {
    mockRpc.mockResolvedValueOnce({ data: [row('a', 't1')], error: null });
    const page = await listInstagramContacts(F, 3);
    expect(mockRpc).toHaveBeenCalledWith('list_instagram_automation_contacts',
      expect.objectContaining({ p_limit: 50, p_offset: 100 }));
    expect(page.total).toBe(3);

    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    expect((await listInstagramContacts(F, 1)).total).toBe(0);
  });

  it('pages the export by keyset until a short page', async () => {
    const full = Array.from({ length: 500 }, (_, i) => row(`id${i}`, `2026-10-01T00:00:${String(i % 60).padStart(2, '0')}Z`));
    mockRpc
      .mockResolvedValueOnce({ data: full, error: null })
      .mockResolvedValueOnce({ data: [row('last', '2026-10-02T00:00:00Z')], error: null });
    const all = await fetchAllInstagramContacts(F);
    expect(all).toHaveLength(501);
    expect(mockRpc).toHaveBeenNthCalledWith(1, 'list_instagram_automation_contacts',
      expect.objectContaining({ p_export: true, p_limit: 500, p_cursor_at: null, p_cursor_id: null }));
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'list_instagram_automation_contacts',
      expect.objectContaining({ p_cursor_at: full[499].created_at, p_cursor_id: 'id499' }));
  });

  it('throws RPC errors', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('boom') });
    await expect(listInstagramContacts(F, 1)).rejects.toThrow('boom');
  });

  it('counts contacts with head+count', async () => {
    const select = vi.fn().mockResolvedValue({ count: 7, error: null });
    mockFrom.mockReturnValue({ select });
    expect(await countInstagramContacts()).toBe(7);
    expect(mockFrom).toHaveBeenCalledWith('instagram_automation_contacts');
    expect(select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
  });
});
```

- [ ] **Step 2:** `npx vitest run apps/crm/src/store/__tests__/instagramContacts.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
import { supabase } from './core';

// =============================================
// INSTAGRAM AUTOMATION CONTACTS (instagram_automation_contacts)
// =============================================
// Derived, de-duplicated list of people who commented an automation keyword,
// maintained by triggers on instagram_automation_sends and surviving
// automation deletion. Spec: docs/superpowers/specs/2026-10-07-automation-contacts-design.md

export const CONTACTS_KEY = 'instagram-contacts';
export const CONTACT_COUNTS_KEY = ['instagram-contact-counts'] as const;
export const CONTACTS_COUNT_KEY = ['instagram-contacts-count'] as const;
export const CONTACTS_PAGE_SIZE = 50;
export const CONTACTS_EXPORT_CHUNK = 500;

export interface InstagramContact {
  id: string;
  client_id: number;
  commenter_username: string | null;
  first_interaction_at: string;
  last_interaction_at: string;
  interactions_count: number;
  reached: boolean;
  last_comment_text: string | null;
  automation_id: string | null;
  automation_name: string | null;
  automation_deleted: boolean;
  created_at: string;
}

/** `from`/`to` are local calendar dates (`yyyy-MM-dd`), both inclusive. */
export interface ContactFilters {
  clientId: number | null;
  automationId: string | null;
  from: string | null;
  to: string | null;
  reachedOnly: boolean;
  search: string;
}

export interface ContactPage {
  rows: InstagramContact[];
  total: number;
}

export interface ContactAutomationCount {
  automation_id: string;
  automation_name: string;
  client_id: number;
  automation_deleted: boolean;
  reached_count: number;
  total_count: number;
}

type ContactRow = InstagramContact & { total_count: number };

function localDayStart(ymd: string, addDays = 0): string {
  const [y, m, d] = ymd.split('-').map((p) => parseInt(p, 10));
  return new Date(y, m - 1, d + addDays).toISOString();
}

/** The RPC filters on `[p_from, p_to)`: the picked days map to the start of the
 * first day and the start of the day AFTER the last one, in local time. */
export function contactFiltersToRpcArgs(f: ContactFilters): Record<string, unknown> {
  const search = f.search.trim();
  return {
    p_client_id: f.clientId,
    p_automation_id: f.automationId,
    p_from: f.from ? localDayStart(f.from) : null,
    p_to: f.to ? localDayStart(f.to, 1) : null,
    p_reached_only: f.reachedOnly,
    p_search: search === '' ? null : search,
  };
}

function stripTotal(rows: ContactRow[]): InstagramContact[] {
  return rows.map(({ total_count: _total, ...rest }) => rest);
}

export async function listInstagramContacts(
  f: ContactFilters,
  page: number,
  pageSize = CONTACTS_PAGE_SIZE,
): Promise<ContactPage> {
  const { data, error } = await supabase.rpc('list_instagram_automation_contacts', {
    ...contactFiltersToRpcArgs(f),
    p_limit: pageSize,
    p_offset: (Math.max(1, page) - 1) * pageSize,
  });
  if (error) throw error;
  const rows = (data ?? []) as ContactRow[];
  return { rows: stripTotal(rows), total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
}

/** Every contact matching the filters, keyset-paged on the immutable
 * (created_at, id) so a contact that interacts mid-export can't be skipped. */
export async function fetchAllInstagramContacts(f: ContactFilters): Promise<InstagramContact[]> {
  const out: InstagramContact[] = [];
  let cursorAt: string | null = null;
  let cursorId: string | null = null;
  for (;;) {
    const { data, error } = await supabase.rpc('list_instagram_automation_contacts', {
      ...contactFiltersToRpcArgs(f),
      p_export: true,
      p_limit: CONTACTS_EXPORT_CHUNK,
      p_cursor_at: cursorAt,
      p_cursor_id: cursorId,
    });
    if (error) throw error;
    const rows = (data ?? []) as ContactRow[];
    out.push(...stripTotal(rows));
    if (rows.length < CONTACTS_EXPORT_CHUNK) return out;
    const last = rows[rows.length - 1];
    cursorAt = last.created_at;
    cursorId = last.id;
  }
}

export async function getContactCounts(): Promise<ContactAutomationCount[]> {
  const { data, error } = await supabase.rpc('instagram_automation_contact_counts');
  if (error) throw error;
  return ((data ?? []) as ContactAutomationCount[]).map((r) => ({
    ...r,
    reached_count: Number(r.reached_count),
    total_count: Number(r.total_count),
  }));
}

export async function countInstagramContacts(): Promise<number> {
  const { count, error } = await supabase
    .from('instagram_automation_contacts')
    .select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}
```

In `apps/crm/src/context/AuthContext.tsx`, `MODULE_QUERY_KEYS.automacoes` becomes:

```ts
  automacoes: [
    'instagram-automations',
    'instagram-automations-count',
    'instagram-automation-sends',
    'ig-automation-ready-account',
    'automation-production-covers',
    'instagram-contacts',
    'instagram-contact-counts',
    'instagram-contacts-count',
  ],
```

- [ ] **Step 4:** run the test → PASS. `npx tsc -p apps/crm/tsconfig.json --noEmit` → clean.
- [ ] **Step 5: Commit** `feat(automations): store module for automation contacts`.

---

### Task 5: Profile URL + contacts CSV builder

**Files:**
- Create: `apps/crm/src/pages/automacoes/contacts/profileUrl.ts`, `apps/crm/src/pages/automacoes/contacts/contactsCsv.ts`, `apps/crm/src/pages/automacoes/contacts/__tests__/contactsCsv.test.ts`

**Interfaces:**
- Consumes: `InstagramContact`, `ContactFilters`, `fetchAllInstagramContacts` (Task 4); `CSV_BOM`, `CSV_EOL`, `csvRow`, `downloadCsv` (Task 3); `slugifyTitle` from `@/lib/briefingExport`.
- Produces: `instagramProfileUrl(username: string | null): string | null`; `buildContactsCsv(rows: InstagramContact[], clientesById: Map<number, string>): string`; `contactsCsvFilename(clienteNome: string | null, now?: Date): string`; `exportContactsCsv(filters: ContactFilters, clientesById: Map<number, string>, clienteNome: string | null): Promise<number>` (returns rows exported).

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { instagramProfileUrl } from '../profileUrl';
import { buildContactsCsv, contactsCsvFilename } from '../contactsCsv';
import type { InstagramContact } from '@/store';

const base: InstagramContact = {
  id: 'c1', client_id: 14, commenter_username: 'ana.souza', first_interaction_at: '2026-10-01T13:05:00.000Z',
  last_interaction_at: '2026-10-02T13:05:00.000Z', interactions_count: 2, reached: true,
  last_comment_text: 'quero; o link', automation_id: 'a1', automation_name: 'Promo', automation_deleted: false,
  created_at: '2026-10-01T13:05:01.000Z',
};

describe('instagramProfileUrl', () => {
  it('builds a link only for valid handles', () => {
    expect(instagramProfileUrl('ana.souza_1')).toBe('https://instagram.com/ana.souza_1');
    expect(instagramProfileUrl(null)).toBeNull();
    expect(instagramProfileUrl('ana/../x')).toBeNull();
    expect(instagramProfileUrl('a'.repeat(31))).toBeNull();
  });
});

describe('buildContactsCsv', () => {
  it('writes BOM, pt-BR header, ; separator, CRLF, sorted by last interaction desc', () => {
    const older = { ...base, id: 'c2', commenter_username: 'bia', last_interaction_at: '2026-09-01T10:00:00.000Z', reached: false };
    const csv = buildContactsCsv([older, base], new Map([[14, 'ACME']]));
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('usuario;perfil_url;cliente;recebeu_dm;interacoes;primeira_interacao;ultima_interacao;automacao;ultimo_comentario');
    expect(lines[1].startsWith('ana.souza;https://instagram.com/ana.souza;ACME;sim;2;')).toBe(true);
    expect(lines[1].endsWith(';Promo;"quero; o link"')).toBe(true);
    expect(lines[2]).toContain('bia;https://instagram.com/bia;ACME;não;');
  });

  it('handles unknown usernames, removed automations, removed clients and formulas', () => {
    const row = { ...base, commenter_username: null, automation_deleted: true, last_comment_text: '=HYPERLINK("x")' };
    const line = buildContactsCsv([row], new Map()).slice(1).split('\r\n')[1];
    expect(line.startsWith(';;;sim;')).toBe(true);
    expect(line).toContain('Promo (removida)');
    expect(line.endsWith(`;"'=HYPERLINK(""x"")"`)).toBe(true);
  });
});

describe('contactsCsvFilename', () => {
  it('slugs the client name or uses todos', () => {
    const now = new Date(2026, 9, 7);
    expect(contactsCsvFilename('Clínica Sorriso', now)).toBe('contatos-clinica-sorriso-2026-10-07.csv');
    expect(contactsCsvFilename(null, now)).toBe('contatos-todos-2026-10-07.csv');
  });
});
```

Note: the "removed client" cell is empty (no map entry). The dates are local time `yyyy-MM-dd HH:mm` via `date-fns` `format`; don't assert their exact text (timezone-dependent).

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: Implement**

`profileUrl.ts`:
```ts
import { sanitizeUrl } from '@/utils/security';

/** Instagram handles: letters, digits, `.` and `_`, at most 30 chars. Anything
 * else (a stale or odd snapshot) renders as plain text, never a link. */
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;

export function instagramProfileUrl(username: string | null): string | null {
  if (!username || !HANDLE.test(username)) return null;
  const url = sanitizeUrl(`https://instagram.com/${encodeURIComponent(username)}`);
  return url === '#' ? null : url;
}
```

`contactsCsv.ts`:
```ts
import { format } from 'date-fns';
import { trackUnsavedWork } from '@mesaas/app-lifecycle';
import { CSV_BOM, CSV_EOL, csvRow, downloadCsv } from '@/lib/csvExport';
import { slugifyTitle } from '@/lib/briefingExport';
import { fetchAllInstagramContacts, type ContactFilters, type InstagramContact } from '@/store';
import { instagramProfileUrl } from './profileUrl';

const SEP = ';';

const HEADER = [
  'usuario', 'perfil_url', 'cliente', 'recebeu_dm', 'interacoes',
  'primeira_interacao', 'ultima_interacao', 'automacao', 'ultimo_comentario',
];

function when(iso: string): string {
  return format(new Date(iso), 'yyyy-MM-dd HH:mm');
}

export function buildContactsCsv(
  rows: InstagramContact[],
  clientesById: Map<number, string>,
): string {
  const sorted = [...rows].sort((a, b) =>
    b.last_interaction_at.localeCompare(a.last_interaction_at),
  );
  const lines = [csvRow(HEADER, SEP)];
  for (const r of sorted) {
    const automacao = r.automation_name
      ? r.automation_deleted ? `${r.automation_name} (removida)` : r.automation_name
      : '';
    lines.push(
      csvRow(
        [
          r.commenter_username ?? '',
          instagramProfileUrl(r.commenter_username) ?? '',
          clientesById.get(r.client_id) ?? '',
          r.reached ? 'sim' : 'não',
          r.interactions_count,
          when(r.first_interaction_at),
          when(r.last_interaction_at),
          automacao,
          r.last_comment_text ?? '',
        ],
        SEP,
      ),
    );
  }
  return CSV_BOM + lines.join(CSV_EOL);
}

export function contactsCsvFilename(clienteNome: string | null, now: Date = new Date()): string {
  const slug = clienteNome ? slugifyTitle(clienteNome) : 'todos';
  return `contatos-${slug}-${format(now, 'yyyy-MM-dd')}.csv`;
}

/** Fetches every matching contact and downloads the file. Tracked as unsaved
 * work so a silent deploy swap can't kill it mid-run. */
export async function exportContactsCsv(
  filters: ContactFilters,
  clientesById: Map<number, string>,
  clienteNome: string | null,
): Promise<number> {
  const rows = await trackUnsavedWork(fetchAllInstagramContacts(filters));
  downloadCsv(buildContactsCsv(rows, clientesById), contactsCsvFilename(clienteNome));
  return rows.length;
}
```

The automation name `(removida)` suffix in CSV is pt-only by design (the file headers are pt-BR).

- [ ] **Step 4:** run → PASS. If `slugifyTitle('')` fallback `'briefing'` ever matters it doesn't here (names are non-empty).
- [ ] **Step 5: Commit** `feat(automations): contacts CSV builder and profile link helper`.

---

### Task 6: URL-owned filters hook

**Files:**
- Create: `apps/crm/src/pages/automacoes/contacts/useContactsFilters.ts`, `apps/crm/src/pages/automacoes/contacts/__tests__/useContactsFilters.test.tsx`

**Interfaces:**
- Consumes: `ContactFilters` (Task 4).
- Produces:
```ts
export type AutomacoesTab = 'automacoes' | 'contatos';
export interface ContactsUrlState extends ContactFilters { page: number }
export function parseContactsParams(sp: URLSearchParams): ContactsUrlState
export function writeContactsParams(sp: URLSearchParams, patch: Partial<ContactsUrlState>): URLSearchParams
export function contactsHref(opts?: { clientId?: number | null; automationId?: string | null }): string
export function useAutomacoesTab(): [AutomacoesTab, (tab: AutomacoesTab) => void, boolean]  // third = `aba` explicitly set in the URL
export function useContactsFilters(): { state: ContactsUrlState; setFilters: (patch: Partial<ContactFilters>) => void; setPage: (page: number) => void }
```
Params: `aba`, `cliente`, `automacao`, `de`, `ate`, `todos=1` (reachedOnly false), `q`, `pagina`.

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  contactsHref, parseContactsParams, useContactsFilters, writeContactsParams,
} from '../useContactsFilters';

describe('contacts URL state', () => {
  it('parses defaults and guards bad numbers', () => {
    const s = parseContactsParams(new URLSearchParams('aba=contatos&cliente=abc&pagina=-3'));
    expect(s).toEqual({
      clientId: null, automationId: null, from: null, to: null,
      reachedOnly: true, search: '', page: 1,
    });
  });

  it('round-trips every field', () => {
    const sp = writeContactsParams(new URLSearchParams('aba=contatos'), {
      clientId: 14, automationId: 'a1', from: '2026-10-01', to: '2026-10-07',
      reachedOnly: false, search: 'ana', page: 3,
    });
    expect(parseContactsParams(sp)).toEqual({
      clientId: 14, automationId: 'a1', from: '2026-10-01', to: '2026-10-07',
      reachedOnly: false, search: 'ana', page: 3,
    });
    expect(sp.get('aba')).toBe('contatos');
  });

  it('resets the page when a filter changes', () => {
    const sp = writeContactsParams(new URLSearchParams('aba=contatos&pagina=4'), { search: 'x' });
    expect(sp.get('pagina')).toBeNull();
  });

  it('clearing the client also clears the automation', () => {
    const sp = writeContactsParams(new URLSearchParams('cliente=14&automacao=a1'), { clientId: null });
    expect(sp.get('cliente')).toBeNull();
    expect(sp.get('automacao')).toBeNull();
  });

  it('builds deep links', () => {
    expect(contactsHref()).toBe('/automacoes?aba=contatos');
    expect(contactsHref({ clientId: 14, automationId: 'a1' })).toBe('/automacoes?aba=contatos&cliente=14&automacao=a1');
  });

  it('hook reads and writes the router search params', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={['/automacoes?aba=contatos&cliente=14']}>{children}</MemoryRouter>
    );
    const { result } = renderHook(() => useContactsFilters(), { wrapper });
    expect(result.current.state.clientId).toBe(14);
    act(() => result.current.setFilters({ reachedOnly: false }));
    expect(result.current.state.reachedOnly).toBe(false);
    act(() => result.current.setPage(2));
    expect(result.current.state.page).toBe(2);
  });
});
```

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: Implement**

```ts
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ContactFilters } from '@/store';

export type AutomacoesTab = 'automacoes' | 'contatos';

export interface ContactsUrlState extends ContactFilters {
  page: number;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function parseContactsParams(sp: URLSearchParams): ContactsUrlState {
  const cliente = parseInt(sp.get('cliente') ?? '', 10);
  const de = sp.get('de');
  const ate = sp.get('ate');
  return {
    clientId: isNaN(cliente) ? null : cliente,
    automationId: sp.get('automacao') || null,
    from: de && YMD.test(de) ? de : null,
    to: ate && YMD.test(ate) ? ate : null,
    reachedOnly: sp.get('todos') !== '1',
    search: sp.get('q') ?? '',
    page: Math.max(1, parseInt(sp.get('pagina') ?? '', 10) || 1),
  };
}

function setOrDelete(sp: URLSearchParams, key: string, value: string | null) {
  if (value === null || value === '') sp.delete(key);
  else sp.set(key, value);
}

/** Applies a patch; any filter change (anything but `page`) resets to page 1.
 * Clearing or changing the client drops the automation (it belongs to one). */
export function writeContactsParams(
  sp: URLSearchParams,
  patch: Partial<ContactsUrlState>,
): URLSearchParams {
  const next = new URLSearchParams(sp);
  if ('clientId' in patch) {
    setOrDelete(next, 'cliente', patch.clientId == null ? null : String(patch.clientId));
    if (!('automationId' in patch)) next.delete('automacao');
  }
  if ('automationId' in patch) setOrDelete(next, 'automacao', patch.automationId ?? null);
  if ('from' in patch) setOrDelete(next, 'de', patch.from ?? null);
  if ('to' in patch) setOrDelete(next, 'ate', patch.to ?? null);
  if ('reachedOnly' in patch) setOrDelete(next, 'todos', patch.reachedOnly === false ? '1' : null);
  if ('search' in patch) setOrDelete(next, 'q', patch.search ?? null);
  if ('page' in patch) {
    setOrDelete(next, 'pagina', patch.page && patch.page > 1 ? String(patch.page) : null);
  } else {
    next.delete('pagina');
  }
  return next;
}

export function contactsHref(
  opts: { clientId?: number | null; automationId?: string | null } = {},
): string {
  const sp = new URLSearchParams({ aba: 'contatos' });
  if (opts.clientId != null) sp.set('cliente', String(opts.clientId));
  if (opts.automationId) sp.set('automacao', opts.automationId);
  return `/automacoes?${sp.toString()}`;
}

/** Third value: whether `aba` is explicitly in the URL. The page forces the
 * Contatos tab in the contacts-only (downgraded, no automations) state ONLY
 * while the user hasn't picked a tab, so `setTab` always writes `aba`. */
export function useAutomacoesTab(): [AutomacoesTab, (tab: AutomacoesTab) => void, boolean] {
  const [sp, setSp] = useSearchParams();
  const explicit = sp.has('aba');
  const tab: AutomacoesTab = sp.get('aba') === 'contatos' ? 'contatos' : 'automacoes';
  const setTab = useCallback(
    (t: AutomacoesTab) =>
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('aba', t);
          return next;
        },
        { replace: true },
      ),
    [setSp],
  );
  return [tab, setTab, explicit];
}

export function useContactsFilters() {
  const [sp, setSp] = useSearchParams();
  const state = useMemo(() => parseContactsParams(sp), [sp]);
  const setFilters = useCallback(
    (patch: Partial<ContactFilters>) =>
      setSp((prev) => writeContactsParams(prev, patch), { replace: true }),
    [setSp],
  );
  const setPage = useCallback(
    (page: number) => setSp((prev) => writeContactsParams(prev, { page }), { replace: true }),
    [setSp],
  );
  return { state, setFilters, setPage };
}
```

- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(automations): URL-owned contacts filters`.

---

### Task 7: i18n + `ContactsList` + `ContactsTab`

**Files:**
- Modify: `packages/i18n/locales/pt/automations.json`, `packages/i18n/locales/en/automations.json` (add a top-level `"contacts"` object)
- Create: `apps/crm/src/pages/automacoes/contacts/ContactsList.tsx`, `apps/crm/src/pages/automacoes/contacts/ContactsTab.tsx`, `apps/crm/src/pages/automacoes/contacts/__tests__/ContactsTab.test.tsx`

**Interfaces:**
- Consumes: Tasks 4–6.
- Produces: `ContactsList({ rows, clientesById, showClient, isDesktop }: { rows: InstagramContact[]; clientesById: Map<number, string>; showClient: boolean; isDesktop: boolean })` (default export none, named export `ContactsList`); `ContactsTab()` (named export, no props).

- [ ] **Step 1: i18n keys**

pt (`automations.json`, new top-level key; no em-dashes):
```json
"contacts": {
  "tabAutomations": "Automações",
  "tabContacts": "Contatos",
  "intro": "Pessoas que comentaram uma palavra-chave das suas automações.",
  "filterClient": "Cliente",
  "allClients": "Todos os clientes",
  "filterAutomation": "Automação",
  "allAutomations": "Todas as automações",
  "removed": "{{name}} (removida)",
  "filterPeriod": "Última interação",
  "reachedOnly": "Só quem recebeu DM",
  "searchPlaceholder": "Buscar @usuário",
  "export": "Exportar CSV",
  "exporting": "Exportando…",
  "exportDone": "{{count}} contatos exportados.",
  "exportError": "Não foi possível exportar os contatos.",
  "col": {
    "user": "Usuário",
    "client": "Cliente",
    "reached": "Recebeu DM",
    "interactions": "Interações",
    "first": "Primeira interação",
    "last": "Última interação",
    "automation": "Automação",
    "comment": "Último comentário"
  },
  "yes": "Sim",
  "no": "Não",
  "unknownUser": "Usuário desconhecido",
  "showing": "Mostrando {{from}}-{{to}} de {{total}}",
  "prev": "Anterior",
  "next": "Próxima",
  "emptyNone": "Quando alguém comentar uma palavra-chave, a pessoa aparece aqui.",
  "emptyFiltered": "Nenhum contato com esses filtros.",
  "emptyNoneReached": "Ninguém recebeu a DM ainda.",
  "loadError": "Não foi possível carregar os contatos.",
  "retry": "Tentar de novo",
  "viewContacts": "Ver contatos ({{count}})",
  "sectionTitle": "Contatos das automações",
  "viewAll": "Ver todos"
}
```
en: same keys — "Automations", "Contacts", "People who commented a keyword from your automations.", "Client", "All clients", "Automation", "All automations", "{{name}} (removed)", "Last interaction", "Only who got the DM", "Search @user", "Export CSV", "Exporting…", "{{count}} contacts exported.", "Could not export the contacts.", col: "User", "Client", "Got DM", "Interactions", "First interaction", "Last interaction", "Automation", "Last comment"; "Yes", "No", "Unknown user", "Showing {{from}}-{{to}} of {{total}}", "Previous", "Next", "When someone comments a keyword, they show up here.", "No contacts match these filters.", "Nobody got the DM yet.", "Could not load the contacts.", "Try again", "View contacts ({{count}})", "Automation contacts", "View all".

- [ ] **Step 2: Failing ContactsTab test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { mockList, mockCounts, mockClientes, mockExport } = vi.hoisted(() => ({
  mockList: vi.fn(), mockCounts: vi.fn(), mockClientes: vi.fn(), mockExport: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
    i18n: { language: 'pt' },
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('../contactsCsv', () => ({ exportContactsCsv: mockExport }));
vi.mock('../../../../store', async () => {
  const actual = await vi.importActual<typeof import('../../../../store')>('../../../../store');
  return { ...actual, listInstagramContacts: mockList, getContactCounts: mockCounts, getClientes: mockClientes };
});

import { ContactsTab } from '../ContactsTab';

const ROW = {
  id: 'c1', client_id: 14, commenter_username: 'ana', first_interaction_at: '2026-10-01T10:00:00Z',
  last_interaction_at: '2026-10-02T10:00:00Z', interactions_count: 2, reached: true,
  last_comment_text: 'quero', automation_id: 'a1', automation_name: 'Promo', automation_deleted: true,
  created_at: '2026-10-01T10:00:00Z',
};

function renderTab(url = '/automacoes?aba=contatos') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}><ContactsTab /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContactsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientes.mockResolvedValue([{ id: 14, nome: 'ACME' }]);
    mockCounts.mockResolvedValue([
      { automation_id: 'a1', automation_name: 'Promo', client_id: 14, automation_deleted: true, reached_count: 1, total_count: 1 },
    ]);
  });

  it('lists contacts with link, client, removed automation and paging text', async () => {
    mockList.mockResolvedValue({ rows: [ROW], total: 1 });
    renderTab();
    const link = await screen.findByRole('link', { name: '@ana' });
    expect(link).toHaveAttribute('href', 'https://instagram.com/ana');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('ACME', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByText('contacts.removed:{"name":"Promo"}')).toBeInTheDocument();
    expect(screen.getByText('contacts.showing:{"from":1,"to":1,"total":1}')).toBeInTheDocument();
  });

  it('passes URL filters to the store (deep link)', async () => {
    mockList.mockResolvedValue({ rows: [], total: 0 });
    renderTab('/automacoes?aba=contatos&cliente=14&automacao=a1&todos=1');
    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 14, automationId: 'a1', reachedOnly: false }), 1),
    );
  });

  it('shows the none-yet empty state with no contacts at all, filtered state otherwise', async () => {
    mockCounts.mockResolvedValue([]);
    mockList.mockResolvedValue({ rows: [], total: 0 });
    renderTab();
    expect(await screen.findByText('contacts.emptyNone')).toBeInTheDocument();
  });

  it('shows the error state with retry', async () => {
    mockList.mockRejectedValue(new Error('boom'));
    renderTab();
    expect(await screen.findByText('contacts.loadError')).toBeInTheDocument();
  });

  it('exports with the active filters', async () => {
    mockList.mockResolvedValue({ rows: [ROW], total: 1 });
    mockExport.mockResolvedValue(1);
    renderTab('/automacoes?aba=contatos&cliente=14');
    await screen.findByRole('link', { name: '@ana' });
    fireEvent.click(screen.getByRole('button', { name: 'contacts.export' }));
    await waitFor(() => expect(mockExport).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 14 }), expect.any(Map), 'ACME'));
  });
});
```

- [ ] **Step 3:** run → FAIL.

- [ ] **Step 4: Implement `ContactsList.tsx`**

```tsx
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { enUS, ptBR } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { InstagramContact } from '@/store';
import { instagramProfileUrl } from './profileUrl';

function fmt(iso: string, lang: string) {
  return format(new Date(iso), "dd MMM yyyy '·' HH:mm", { locale: lang.startsWith('en') ? enUS : ptBR });
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function UserCell({ username }: { username: string | null }) {
  const { t } = useTranslation('automations');
  const url = instagramProfileUrl(username);
  if (!username) return <span style={{ color: 'var(--text-muted)' }}>{t('contacts.unknownUser')}</span>;
  if (!url) return <span style={{ fontWeight: 600 }}>@{username}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }} className="hover:underline">
      @{username}
    </a>
  );
}

export function ContactsList({
  rows, clientesById, showClient, isDesktop,
}: {
  rows: InstagramContact[];
  clientesById: Map<number, string>;
  showClient: boolean;
  isDesktop: boolean;
}) {
  const { t, i18n } = useTranslation('automations');
  const automation = (r: InstagramContact) =>
    !r.automation_name ? '' : r.automation_deleted ? t('contacts.removed', { name: r.automation_name }) : r.automation_name;
  const reached = (r: InstagramContact) => (
    <Badge variant={r.reached ? 'success' : 'neutral'} size="sm">
      {r.reached ? t('contacts.yes') : t('contacts.no')}
    </Badge>
  );

  if (!isDesktop) {
    return (
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {rows.map((r) => (
          <div key={r.id} className="card" style={{ padding: '0.875rem 1rem', fontSize: '0.85rem' }}>
            <div className="flex items-center justify-between gap-2">
              <UserCell username={r.commenter_username} />
              {reached(r)}
            </div>
            <div style={{ color: 'var(--text-muted)', marginTop: 6, display: 'grid', gap: 2 }}>
              {showClient && <span>{clientesById.get(r.client_id) ?? ''}</span>}
              <span>{automation(r)} · {t('contacts.col.interactions')}: {r.interactions_count}</span>
              <span>{t('contacts.col.last')}: {fmt(r.last_interaction_at, i18n.language)}</span>
              {r.last_comment_text && <span>"{truncate(r.last_comment_text, 80)}"</span>}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="card animate-up" style={{ padding: '0.25rem 0', overflowX: 'auto' }}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('contacts.col.user')}</TableHead>
            {showClient && <TableHead>{t('contacts.col.client')}</TableHead>}
            <TableHead>{t('contacts.col.reached')}</TableHead>
            <TableHead>{t('contacts.col.interactions')}</TableHead>
            <TableHead>{t('contacts.col.first')}</TableHead>
            <TableHead>{t('contacts.col.last')}</TableHead>
            <TableHead>{t('contacts.col.automation')}</TableHead>
            <TableHead>{t('contacts.col.comment')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell><UserCell username={r.commenter_username} /></TableCell>
              {showClient && <TableCell>{clientesById.get(r.client_id) ?? ''}</TableCell>}
              <TableCell>{reached(r)}</TableCell>
              <TableCell>{r.interactions_count}</TableCell>
              <TableCell style={{ whiteSpace: 'nowrap' }}>{fmt(r.first_interaction_at, i18n.language)}</TableCell>
              <TableCell style={{ whiteSpace: 'nowrap' }}>{fmt(r.last_interaction_at, i18n.language)}</TableCell>
              <TableCell>{automation(r)}</TableCell>
              <TableCell style={{ color: 'var(--text-muted)', maxWidth: 280 }}>
                {r.last_comment_text ? `"${truncate(r.last_comment_text, 80)}"` : ''}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 5: Implement `ContactsTab.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Download } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import {
  CONTACTS_KEY, CONTACTS_PAGE_SIZE, CONTACT_COUNTS_KEY,
  getClientes, getContactCounts, listInstagramContacts, sortClientesByNome,
} from '../../../store';
import { ContactsList } from './ContactsList';
import { exportContactsCsv } from './contactsCsv';
import { useContactsFilters } from './useContactsFilters';

function ymdToDate(ymd: string | null): Date | undefined {
  if (!ymd) return undefined;
  const [y, m, d] = ymd.split('-').map((p) => parseInt(p, 10));
  return new Date(y, m - 1, d);
}

export function ContactsTab() {
  const { t } = useTranslation('automations');
  const isDesktop = useIsDesktop(901);
  const { state, setFilters, setPage } = useContactsFilters();
  const { page, ...filters } = state;

  const [searchInput, setSearchInput] = useState(state.search);
  useEffect(() => setSearchInput(state.search), [state.search]);
  useEffect(() => {
    if (searchInput === state.search) return;
    const id = setTimeout(() => setFilters({ search: searchInput }), 300);
    return () => clearTimeout(id);
  }, [searchInput, state.search, setFilters]);

  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const countsQuery = useQuery({ queryKey: CONTACT_COUNTS_KEY, queryFn: getContactCounts });
  const counts = useMemo(() => countsQuery.data ?? [], [countsQuery.data]);

  const clientesById = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of clientes) if (c.id != null) m.set(c.id, c.nome);
    return m;
  }, [clientes]);

  const clientOptions = useMemo(() => {
    const ids = new Set(counts.map((c) => c.client_id));
    if (filters.clientId != null) ids.add(filters.clientId);
    return sortClientesByNome(clientes.filter((c) => c.id != null && ids.has(c.id)));
  }, [clientes, counts, filters.clientId]);

  const automationOptions = useMemo(
    () => counts.filter((c) => filters.clientId == null || c.client_id === filters.clientId),
    [counts, filters.clientId],
  );

  const listQuery = useQuery({
    queryKey: [CONTACTS_KEY, filters, page],
    queryFn: () => listInstagramContacts(filters, page),
    placeholderData: (prev) => prev,
  });

  const [exporting, setExporting] = useState(false);
  const onExport = async () => {
    setExporting(true);
    try {
      const nome = filters.clientId != null ? clientesById.get(filters.clientId) ?? null : null;
      const n = await exportContactsCsv(filters, clientesById, nome);
      toast.success(t('contacts.exportDone', { count: n }));
    } catch {
      toast.error(t('contacts.exportError'));
    } finally {
      setExporting(false);
    }
  };

  const total = listQuery.data?.total ?? 0;
  const rows = listQuery.data?.rows ?? [];
  const from = total === 0 ? 0 : (page - 1) * CONTACTS_PAGE_SIZE + 1;
  const to = Math.min(page * CONTACTS_PAGE_SIZE, total);
  const range: DateRange | undefined = filters.from
    ? { from: ymdToDate(filters.from), to: ymdToDate(filters.to) }
    : undefined;
  const hasAnyContact = counts.some((c) => c.total_count > 0);

  return (
    <div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 1rem' }}>
        {t('contacts.intro')}
      </p>

      <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: '1rem' }}>
        <div style={{ width: 220 }}>
          <Select
            value={filters.clientId == null ? 'todos' : String(filters.clientId)}
            onValueChange={(v) => setFilters({ clientId: v === 'todos' ? null : parseInt(v, 10) })}
          >
            <SelectTrigger aria-label={t('contacts.filterClient')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">{t('contacts.allClients')}</SelectItem>
              {clientOptions.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div style={{ width: 240 }}>
          <Select
            value={filters.automationId ?? 'todas'}
            onValueChange={(v) => setFilters({ automationId: v === 'todas' ? null : v })}
          >
            <SelectTrigger aria-label={t('contacts.filterAutomation')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">{t('contacts.allAutomations')}</SelectItem>
              {automationOptions.map((a) => (
                <SelectItem key={a.automation_id} value={a.automation_id}>
                  {a.automation_deleted ? t('contacts.removed', { name: a.automation_name }) : a.automation_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DateRangePicker
          value={range}
          placeholder={t('contacts.filterPeriod')}
          onChange={(r) =>
            setFilters({
              from: r?.from ? format(r.from, 'yyyy-MM-dd') : null,
              to: r?.to ? format(r.to, 'yyyy-MM-dd') : r?.from ? format(r.from, 'yyyy-MM-dd') : null,
            })
          }
        />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t('contacts.searchPlaceholder')}
          aria-label={t('contacts.searchPlaceholder')}
          style={{ width: 200 }}
        />
        <label className="flex items-center gap-2" style={{ fontSize: '0.85rem' }}>
          <Switch
            checked={filters.reachedOnly}
            onCheckedChange={(v) => setFilters({ reachedOnly: v })}
          />
          {t('contacts.reachedOnly')}
        </label>
        <div style={{ marginLeft: 'auto' }}>
          <Button variant="outline" onClick={onExport} disabled={exporting || total === 0}>
            {exporting ? <Spinner size="sm" /> : <Download className="h-4 w-4" style={{ marginRight: '0.5rem' }} />}
            {exporting ? t('contacts.exporting') : t('contacts.export')}
          </Button>
        </div>
      </div>

      {listQuery.isPending ? (
        <div className="flex justify-center p-8"><Spinner size="lg" /></div>
      ) : listQuery.isError ? (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>{t('contacts.loadError')}</p>
          <Button variant="outline" onClick={() => listQuery.refetch()}>{t('contacts.retry')}</Button>
        </div>
      ) : rows.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>
          {hasAnyContact ? t('contacts.emptyFiltered') : t('contacts.emptyNone')}
        </p>
      ) : (
        <>
          <ContactsList rows={rows} clientesById={clientesById} showClient={filters.clientId == null} isDesktop={isDesktop} />
          <div className="flex items-center justify-between" style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            <span>{t('contacts.showing', { from, to, total })}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                {t('contacts.prev')}
              </Button>
              <Button variant="outline" size="sm" disabled={to >= total} onClick={() => setPage(page + 1)}>
                {t('contacts.next')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

Check before relying on them: `Badge` accepts `variant="neutral"|"success"` and `size="sm"` (used that way in `AutomacoesPage.tsx`); `Button` has `size="sm"`; `Spinner` `size` values `sm|lg`; `Input` exists at `@/components/ui/input`. If `listQuery.isPending` stays true with `placeholderData`, use `isLoading`.

- [ ] **Step 6:** `npx vitest run apps/crm/src/pages/automacoes/contacts` → PASS. Adjust the `ACME` cell query if the Select also renders "ACME" (the `selector: 'td'` handles it).
- [ ] **Step 7: Commit** `feat(automations): Contatos tab with filters, paging and CSV export`.

---

### Task 8: Wire into `AutomacoesPage` (tabs, gate, card link, invalidations)

**Files:**
- Modify: `apps/crm/src/pages/automacoes/AutomacoesPage.tsx`
- Modify: `apps/crm/src/pages/automacoes/__tests__/AutomacoesPage.test.tsx`

**Interfaces:**
- Consumes: `ContactsTab`, `useAutomacoesTab`, `contactsHref`, `getContactCounts`, `countInstagramContacts`, `CONTACT_COUNTS_KEY`, `CONTACTS_COUNT_KEY`, `CONTACTS_KEY`.

- [ ] **Step 1: Update existing test mocks + add failing tests**

In the test's `vi.hoisted` add `mockGetContactCounts: vi.fn()`, `mockCountContacts: vi.fn()`; add both to the `../../../store` mock (`getContactCounts: mockGetContactCounts, countInstagramContacts: mockCountContacts`); mock the tab so the page test stays focused:

```tsx
vi.mock('../contacts/ContactsTab', () => ({
  ContactsTab: () => <div data-testid="contacts-tab" />,
}));
```

In `beforeEach`: `mockGetContactCounts.mockResolvedValue([]); mockCountContacts.mockResolvedValue(0);`

Change `renderPage` to accept a URL: `function renderPage(url = '/automacoes')` and pass it to `initialEntries`.

New tests (inside the top-level describe):

```tsx
  describe('contatos', () => {
    it('switches to the Contatos tab from the tab bar', async () => {
      renderPage();
      // Radix Tabs activate on mouseDown/keyDown/focus, not click.
      fireEvent.mouseDown(await screen.findByRole('tab', { name: 'contacts.tabContacts' }));
      expect(await screen.findByTestId('contacts-tab')).toBeInTheDocument();
    });

    it('opens on Contatos from ?aba=contatos', async () => {
      renderPage('/automacoes?aba=contatos');
      expect(await screen.findByTestId('contacts-tab')).toBeInTheDocument();
    });

    it('shows "Ver contatos (N)" in the expanded card with a deep link, hidden when N = 0', async () => {
      mockGetContactCounts.mockResolvedValue([
        { automation_id: 'auto-1', automation_name: 'Promo de agosto', client_id: 14, automation_deleted: false, reached_count: 3, total_count: 4 },
      ]);
      renderPage();
      // The expandable row is a TableRow/div with aria-expanded, not a button.
      // jsdom's matchMedia stub is false, so the page renders the MOBILE branch.
      const row = (await screen.findByText('Promo de agosto')).closest('[aria-expanded]')!;
      fireEvent.click(row);
      const link = await screen.findByRole('link', { name: 'contacts.viewContacts:{"count":3}' });
      expect(link).toHaveAttribute('href', '/automacoes?aba=contatos&cliente=14&automacao=auto-1');
    });
  });
```

In `describe('gate de página (flag off)')` add:

```tsx
    it('0 automações mas com contatos → página abre em Contatos, sem paywall', async () => {
      mockGetAutomations.mockResolvedValue([]);
      mockCountContacts.mockResolvedValue(5);
      renderPage();
      expect(await screen.findByTestId('contacts-tab')).toBeInTheDocument();
      expect(screen.queryByTestId('upgrade-locked-screen')).not.toBeInTheDocument();
    });

    it('contagem de contatos pendente → spinner, NUNCA paywall', async () => {
      mockGetAutomations.mockResolvedValue([]);
      mockCountContacts.mockReturnValue(new Promise(() => {}));
      const { container } = renderPage();
      await waitFor(() => expect(container.querySelector('.animate-spin')).toBeInTheDocument());
      expect(screen.queryByTestId('upgrade-locked-screen')).not.toBeInTheDocument();
    });

    it('contagem de contatos em erro → fail open (página, sem paywall)', async () => {
      mockGetAutomations.mockResolvedValue([]);
      mockCountContacts.mockRejectedValue(new Error('boom'));
      renderPage();
      expect(await screen.findByTestId('contacts-tab')).toBeInTheDocument();
      expect(screen.queryByTestId('upgrade-locked-screen')).not.toBeInTheDocument();
    });
```

The existing "0 automações (sucesso) → paywall" test keeps passing because `mockCountContacts` resolves 0.

- [ ] **Step 2:** `npx vitest run apps/crm/src/pages/automacoes/__tests__/AutomacoesPage.test.tsx` → new tests FAIL.

- [ ] **Step 3: Implement in `AutomacoesPage.tsx`**

Imports: add `Users` to the lucide import; add
```tsx
import { Link } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ContactsTab } from './contacts/ContactsTab';
import { contactsHref, useAutomacoesTab } from './contacts/useContactsFilters';
```
and to the store import list: `getContactCounts, countInstagramContacts, CONTACT_COUNTS_KEY, CONTACTS_COUNT_KEY, CONTACTS_KEY`.

Inside the component, after `sendsQuery`:
```tsx
  const [tab, setTab, tabExplicit] = useAutomacoesTab();
  const countsQuery = useQuery({ queryKey: CONTACT_COUNTS_KEY, queryFn: getContactCounts });
  const reachedByAutomation = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of countsQuery.data ?? []) m.set(c.automation_id, c.reached_count);
    return m;
  }, [countsQuery.data]);
  const contactsCountQuery = useQuery({
    queryKey: CONTACTS_COUNT_KEY,
    queryFn: countInstagramContacts,
    staleTime: 300_000,
  });
  // Fail open: the locked screen is an upsell only (RLS guards the data), so an
  // errored count must never hide retained contacts behind it.
  const hasContacts = contactsCountQuery.isError || (contactsCountQuery.data ?? 0) > 0;
```

`invalidate` also invalidates the three contact keys:
```tsx
    qc.invalidateQueries({ queryKey: [CONTACTS_KEY] });
    qc.invalidateQueries({ queryKey: CONTACT_COUNTS_KEY });
    qc.invalidateQueries({ queryKey: CONTACTS_COUNT_KEY });
```

Gate (replace the three `flagOff` blocks' conditions):
```tsx
  if (flagOff && (automationsQuery.isPending || (automations.length === 0 && contactsCountQuery.isPending))) { /* existing spinner */ }
  if (flagOff && automationsQuery.isError) { /* existing error */ }
  if (flagOff && automations.length === 0 && !hasContacts) { /* existing UpgradeLockedScreen */ }
```

Locked-but-has-contacts: the page renders normally and forces the Contatos tab. Right after the gate:
```tsx
  const contactsOnly = flagOff && automations.length === 0;
  // Forced only until the user picks a tab, so Automações stays reachable.
  const activeTab = contactsOnly && !tabExplicit ? 'contatos' : tab;
```

After the `tiebreakHint` paragraph, before the checklist, insert the tab bar and branch the rest of the body:
```tsx
      <Tabs value={activeTab} onValueChange={(v) => setTab(v as 'automacoes' | 'contatos')} style={{ marginBottom: '1rem' }}>
        <TabsList>
          <TabsTrigger value="automacoes">{t('contacts.tabAutomations')}</TabsTrigger>
          <TabsTrigger value="contatos">{t('contacts.tabContacts')}</TabsTrigger>
        </TabsList>
      </Tabs>

      {activeTab === 'contatos' ? (
        <ContactsTab />
      ) : (
        <>
          {/* existing checklist, client Select, list (desktop table / mobile cards) unchanged */}
        </>
      )}
```
Move the `tiebreakHint` paragraph and the "Nova automação" header button inside the Automações branch only if it reads oddly on Contatos during the browser check; default: leave the header as is.

When `contactsOnly` is true and the user switches to Automações, nothing extra is needed: the header's `FeatureGate`-locked create button is the upgrade copy, and the list shows its existing empty state.

"Ver contatos (N)" link: in both expanded areas (desktop `TableCell` around line 525 and mobile block around line 686), right before `<SendsLog …/>`:
```tsx
                          {(reachedByAutomation.get(a.id) ?? 0) > 0 && (
                            <Link
                              to={contactsHref({ clientId: a.client_id, automationId: a.id })}
                              className="inline-flex items-center gap-1.5 hover:underline"
                              style={{ fontSize: '0.8rem', fontWeight: 600, marginTop: '0.5rem' }}
                            >
                              <Users className="h-3.5 w-3.5" />
                              {t('contacts.viewContacts', { count: reachedByAutomation.get(a.id) })}
                            </Link>
                          )}
```

- [ ] **Step 4:** run the page test file → all PASS (old + new). `npx tsc -p apps/crm/tsconfig.json --noEmit` clean.
- [ ] **Step 5: Commit** `feat(automations): Contatos tab, contacts-aware gate and card link on Automações`.

---

### Task 9: Nav visibility with contacts

**Files:**
- Modify: `apps/crm/src/hooks/useEffectiveNavFeatures.ts`
- Test: `apps/crm/src/hooks/__tests__/useEffectiveNavFeatures.test.ts` (exists; append the new describe block)

**Interfaces:**
- `buildEffectiveNavFeatures(features, hasAutomations, hasContacts = false)` keeps its first two params (existing callers/tests unaffected).

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildEffectiveNavFeatures } from '../useEffectiveNavFeatures';

describe('buildEffectiveNavFeatures with contacts', () => {
  it('keeps automacoes visible when only contacts remain', () => {
    expect(buildEffectiveNavFeatures({ feature_instagram_automation: false }, false, true))
      .toEqual({ feature_instagram_automation: true });
  });
  it('stays hidden with neither', () => {
    expect(buildEffectiveNavFeatures({ feature_instagram_automation: false }, false, false))
      .toEqual({ feature_instagram_automation: false });
  });
});
```

- [ ] **Step 2:** run → FAIL (third arg ignored).

- [ ] **Step 3: Implement**

```ts
import { useQuery } from '@tanstack/react-query';
import { CONTACTS_COUNT_KEY, countInstagramAutomations, countInstagramContacts } from '@/store';

export function buildEffectiveNavFeatures(
  features: Record<string, boolean> | null,
  hasAutomations: boolean,
  hasContacts = false,
): Record<string, boolean> | null {
  if (!features) return features;
  return {
    ...features,
    feature_instagram_automation:
      features.feature_instagram_automation || hasAutomations || hasContacts,
  };
}

export function useEffectiveNavFeatures(
  features: Record<string, boolean> | null,
): Record<string, boolean> | null {
  const { data: count } = useQuery({
    queryKey: ['instagram-automations-count'],
    queryFn: countInstagramAutomations,
    staleTime: 300_000,
  });
  const contacts = useQuery({
    queryKey: CONTACTS_COUNT_KEY,
    queryFn: countInstagramContacts,
    staleTime: 300_000,
  });
  // Errored count fails open (retained contacts must stay reachable).
  const hasContacts = contacts.isError || (contacts.data ?? 0) > 0;
  return buildEffectiveNavFeatures(features, (count ?? 0) > 0, hasContacts);
}
```
Keep the existing doc comments, extending the first one with "OR whether it has retained automation contacts (they survive automation deletion)".

- [ ] **Step 4:** run → PASS; then `npx vitest run apps/crm/src/components/layout apps/crm/src/hooks` to confirm. No existing test needs a new mock (Sidebar/MobileNav tests mock `useEffectiveNavFeatures` wholesale; AppLayout mocks `../Sidebar`).
- [ ] **Step 5: Commit** `feat(automations): keep nav item while retained contacts exist`.

---

### Task 10: Client detail section

**Files:**
- Create: `apps/crm/src/pages/cliente-detalhe/components/AutomationContactsSection.tsx`, `apps/crm/src/pages/cliente-detalhe/components/__tests__/AutomationContactsSection.test.tsx`
- Modify: `apps/crm/src/pages/cliente-detalhe/tabs/RedesSociaisTab.tsx` (render after `<InstagramSection …/>`)

**Interfaces:**
- Produces: `AutomationContactsSection({ clienteId, clienteNome }: { clienteId: number; clienteNome: string })`.

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { mockList, mockCounts, mockCan } = vi.hoisted(() => ({
  mockList: vi.fn(), mockCounts: vi.fn(), mockCan: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
    i18n: { language: 'pt' },
  }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ can: mockCan }) }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/store', async () => {
  const actual = await vi.importActual<typeof import('@/store')>('@/store');
  return { ...actual, listInstagramContacts: mockList, getContactCounts: mockCounts };
});

import { AutomationContactsSection } from '../AutomationContactsSection';

const ROW = {
  id: 'c1', client_id: 14, commenter_username: 'ana', first_interaction_at: '2026-10-01T10:00:00Z',
  last_interaction_at: '2026-10-02T10:00:00Z', interactions_count: 1, reached: true,
  last_comment_text: null, automation_id: 'a1', automation_name: 'Promo', automation_deleted: false,
  created_at: '2026-10-01T10:00:00Z',
};

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><AutomationContactsSection clienteId={14} clienteNome="ACME" /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AutomationContactsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(true);
    mockList.mockResolvedValue({ rows: [ROW], total: 1 });
  });

  it('renders the 10 latest reached contacts with Ver todos', async () => {
    mockCounts.mockResolvedValue([{ automation_id: 'a1', automation_name: 'Promo', client_id: 14, automation_deleted: false, reached_count: 1, total_count: 1 }]);
    renderSection();
    expect(await screen.findByText('contacts.sectionTitle')).toBeInTheDocument();
    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ clientId: 14, reachedOnly: true }), 1, 10),
    );
    expect(screen.getByRole('link', { name: 'contacts.viewAll' })).toHaveAttribute('href', '/automacoes?aba=contatos&cliente=14');
  });

  it('is hidden when the client has no contacts', async () => {
    mockCounts.mockResolvedValue([{ automation_id: 'a9', automation_name: 'X', client_id: 99, automation_deleted: false, reached_count: 1, total_count: 1 }]);
    const { container } = renderSection();
    await waitFor(() => expect(mockCounts).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden without automacoes:ver (including unknown)', async () => {
    mockCan.mockReturnValue('unknown');
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
    expect(mockCounts).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: Implement**

```tsx
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/context/AuthContext';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import {
  CONTACTS_KEY, CONTACT_COUNTS_KEY, getContactCounts, listInstagramContacts,
  type ContactFilters,
} from '@/store';
import { ContactsList } from '../../automacoes/contacts/ContactsList';
import { exportContactsCsv } from '../../automacoes/contacts/contactsCsv';
import { contactsHref } from '../../automacoes/contacts/useContactsFilters';

const PREVIEW = 10;

export function AutomationContactsSection({
  clienteId, clienteNome,
}: { clienteId: number; clienteNome: string }) {
  const { t } = useTranslation('automations');
  const { can } = useAuth();
  const allowed = can('automacoes', 'ver') === true;
  const isDesktop = useIsDesktop(901);

  const filters: ContactFilters = useMemo(
    () => ({ clientId: clienteId, automationId: null, from: null, to: null, reachedOnly: true, search: '' }),
    [clienteId],
  );

  const countsQuery = useQuery({ queryKey: CONTACT_COUNTS_KEY, queryFn: getContactCounts, enabled: allowed });
  const hasContacts = (countsQuery.data ?? []).some((c) => c.client_id === clienteId && c.total_count > 0);

  const listQuery = useQuery({
    queryKey: [CONTACTS_KEY, filters, 1, PREVIEW],
    queryFn: () => listInstagramContacts(filters, 1, PREVIEW),
    enabled: allowed && hasContacts,
  });

  const [exporting, setExporting] = useState(false);
  const clientesById = useMemo(() => new Map([[clienteId, clienteNome]]), [clienteId, clienteNome]);

  if (!allowed || !hasContacts) return null;

  const onExport = async () => {
    setExporting(true);
    try {
      const n = await exportContactsCsv(filters, clientesById, clienteNome);
      toast.success(t('contacts.exportDone', { count: n }));
    } catch {
      toast.error(t('contacts.exportError'));
    } finally {
      setExporting(false);
    }
  };

  const rows = listQuery.data?.rows ?? [];

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <div className="flex items-center justify-between gap-2" style={{ marginBottom: '0.75rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>{t('contacts.sectionTitle')}</h3>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onExport} disabled={exporting || rows.length === 0}>
            {exporting ? <Spinner size="sm" /> : <Download className="h-4 w-4" style={{ marginRight: '0.4rem' }} />}
            {t('contacts.export')}
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to={contactsHref({ clientId: clienteId })}>{t('contacts.viewAll')}</Link>
          </Button>
        </div>
      </div>
      {listQuery.isLoading ? (
        <div className="flex justify-center p-4"><Spinner size="sm" /></div>
      ) : rows.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('contacts.emptyNoneReached')}</p>
      ) : (
        <ContactsList rows={rows} clientesById={clientesById} showClient={false} isDesktop={isDesktop} />
      )}
    </section>
  );
}
```

(Confirm `Button` supports `asChild` — shadcn default does. If the "Ver todos" link's accessible name test fails due to `asChild`, keep the test assertion on `role: 'link'`.)

In `RedesSociaisTab.tsx`, import and render right after `<InstagramSection … />`:
```tsx
      <AutomationContactsSection clienteId={clienteId} clienteNome={cliente?.nome ?? ''} />
```

- [ ] **Step 4:** run → PASS; `npx vitest run apps/crm/src/pages/cliente-detalhe` stays green. No existing test needs a new mock (ClienteDetalhePage.test stubs the redes-sociais route).
- [ ] **Step 5: Commit** `feat(clientes): automation contacts section in Redes sociais`.

---

### Task 11: Full verification + browser check

- [ ] **Step 1: Gates**

```bash
npm run lint
npm run format:check || npm run format
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
bash scripts/test-entitlements.sh
```
All green. If any Deno run happened in the worktree first, `ls node_modules/.deno` → `npm ci` before judging (memory `project_deno_npm_node_modules_gotcha`).

- [ ] **Step 2: Browser** (`npm run dev:env`, seed login per memory `reference_seed_login_browser_verification`; local DB with the migrations or staging after `db push`). Check:
  - Automações: tab bar; Contatos tab with filters; deep link from a card's "Ver contatos (N)"; pagination; search debounce; reached toggle; date range end day included.
  - Export: CSV opens in Numbers/Excel with accents and a comment containing `;` intact in one column.
  - Client detail › Redes sociais: section appears only with contacts; "Ver todos" lands filtered.
  - Mobile (375px): stacked cards; dark mode.
  - Downgraded workspace (override flag off) with contacts and no automations: page opens on Contatos, nav item visible.

- [ ] **Step 3: Commit** any fixes; then follow memory rules: migrations to staging and prod BEFORE merge, PR with Codex review.
