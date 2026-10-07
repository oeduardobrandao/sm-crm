# Automation contacts ("Contatos") — design

**Date:** 2026-10-07
**Status:** approved in brainstorming; revised after Fable + Codex spec reviews
**Area:** CRM › Automações (Instagram comment-to-DM), Cliente › Redes sociais

## Problem

Every Instagram comment that matches an automation keyword produces a row in
`instagram_automation_sends` (who commented, what, when, whether the DM / public
reply went out). Today the only way to see those people is the per-automation log
inside an expanded automation card, capped at the 20 most recent sends
(`getInstagramAutomationSends(automationId, 20)`). There is no cross-automation
view, no de-duplication of people, no export, and deleting an automation deletes
its whole send history (`ias_automation_same_tenant ... ON DELETE CASCADE`).

ManyChat-style tools give agencies a list of everyone who engaged so they can
work that audience. We want the same: a de-duplicated, filterable, exportable
list of people reached by a client's automations, that survives automation
deletion.

### Platform constraint (shapes the scope)

Meta does not allow cold DMs. After the automatic private reply, the business can
only message the person again if they reply, and then within the 24h window.
So "use the list" here means **browse, segment, open the profile, export**. No
broadcast/send-from-Mesaas feature is in scope.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Main use | Browse + export (CSV) |
| Placement | Both: a "Contatos" tab on the Automações page **and** a section in the client's "Redes sociais" tab |
| Retention | Contacts survive automation deletion |
| Who is a contact | Everyone who commented a keyword: every send row with a non-null `commenter_id`, whatever its status (sent, failed, skipped for cooldown / inactive automation / changed target). A `reached` flag ("Recebeu DM") = at least one send with `dm_status = 'sent'`. Default filter shows reached only |
| Storage approach | **A: derived tables maintained by a trigger on sends** (rejected: soft-deleting automations; relaxing the tenant-safe composite FK on sends) |
| Keyword filter | Dropped. Sends do not record which keyword matched; adding it means touching the webhook worker |
| Post filter | Dropped (YAGNI). Note: an automation with `ig_media_id = NULL` covers **all** posts of the account, so for those the automation filter does not segment by post. Accepted limitation; `media_id` stays on sends if a post filter is wanted later |

`reached` is DM-only on purpose. Today the public reply runs only after the DM is
delivered (every DM failure branch in `instagram-webhook/process.ts` returns
before step 4), so including the public reply would add nothing now and would
mislabel a hypothetical future "public reply without DM" path as "Recebeu DM".

## Data model

Migration version must be above main's tail at PR-open time (currently
`20261007000001`; plan uses `20261008000001`, renumber if needed).

### `instagram_automation_contacts` — one row per person per client

```sql
CREATE TABLE instagram_automation_contacts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id              uuid NOT NULL,
  client_id             bigint NOT NULL,
  commenter_id          text NOT NULL,          -- IG-scoped id from the comments webhook
  commenter_username    text,                   -- latest non-null username seen
  first_interaction_at  timestamptz NOT NULL,   -- min(comment_created_at)
  last_interaction_at   timestamptz NOT NULL,   -- max(comment_created_at)
  interactions_count    int NOT NULL DEFAULT 0, -- number of send rows (any status)
  reached               boolean NOT NULL DEFAULT false, -- any send with dm_status = 'sent'
  last_comment_text     text,
  last_automation_id    uuid,                   -- NO FK: survives deletion
  last_automation_name  text,                   -- snapshot
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT iac_client_commenter_uq UNIQUE (client_id, commenter_id),
  CONSTRAINT iac_id_conta_uq UNIQUE (id, conta_id),
  CONSTRAINT iac_client_same_tenant FOREIGN KEY (client_id, conta_id)
    REFERENCES clientes (id, conta_id) ON DELETE CASCADE
);
CREATE INDEX idx_iac_client_last ON instagram_automation_contacts (client_id, last_interaction_at DESC, id DESC);
CREATE INDEX idx_iac_conta_last  ON instagram_automation_contacts (conta_id, last_interaction_at DESC, id DESC);
```

Keyed per **client**, not per workspace: the same IG person commenting on two
different clients' posts is two contacts (two different audiences).

### `instagram_automation_contact_automations` — person × automation

Needed for the automation filter, the "Ver contatos (N)" count, and the
"(removida)" display after deletion.

```sql
CREATE TABLE instagram_automation_contact_automations (
  contact_id            uuid NOT NULL,
  conta_id              uuid NOT NULL,
  automation_id         uuid NOT NULL,          -- NO FK: survives deletion
  automation_name       text NOT NULL,          -- snapshot, kept fresh while the automation exists
  first_interaction_at  timestamptz NOT NULL,
  last_interaction_at   timestamptz NOT NULL,
  interactions_count    int NOT NULL DEFAULT 0,
  reached               boolean NOT NULL DEFAULT false,
  last_comment_text     text,                   -- latest comment ON THIS automation
  PRIMARY KEY (contact_id, automation_id),
  CONSTRAINT iaca_contact_same_tenant FOREIGN KEY (contact_id, conta_id)
    REFERENCES instagram_automation_contacts (id, conta_id) ON DELETE CASCADE
);
CREATE INDEX idx_iaca_automation ON instagram_automation_contact_automations (automation_id, last_interaction_at DESC);
CREATE INDEX idx_iaca_conta ON instagram_automation_contact_automations (conta_id);
```

The composite FK ties every link row to its contact's workspace structurally (house
pattern: `ica_client_same_tenant`, `ias_automation_same_tenant`), so a trigger or
service-role regression cannot create a cross-workspace link.

### Maintenance trigger on `instagram_automation_sends`

Verified write paths: every INSERT goes through `claim_automation_send` (both
branches `ON CONFLICT (comment_id) DO NOTHING`); `dm_status` is never set on
INSERT, only by `mark_automation_dm_sent` / `process.ts` UPDATEs; `commenter_id`
and `automation_id` are never updated.

Function `sync_instagram_automation_contact()`: plpgsql, `SECURITY DEFINER SET
search_path = public`. Two triggers, named to slot deterministically next to
existing ones:

- `ias_z1_sync_contact_insert` — `AFTER INSERT ... FOR EACH ROW WHEN (NEW.commenter_id IS NOT NULL)`
- `ias_z2_sync_contact_reached` — `AFTER UPDATE OF dm_status ... FOR EACH ROW
  WHEN (OLD.dm_status IS DISTINCT FROM 'sent' AND NEW.dm_status = 'sent' AND NEW.commenter_id IS NOT NULL)`

**INSERT branch:**
1. Resolve `client_id` and `name` from `instagram_comment_automations` by
   `NEW.automation_id` (guaranteed to exist by `ias_automation_same_tenant`).
2. Upsert the contact on `(client_id, commenter_id)` (contact row first, then the
   link row, in both branches: consistent lock order, no deadlock between a
   concurrent INSERT and UPDATE for the same person):
   - `interactions_count = t.interactions_count + 1`
   - `first_interaction_at = least(...)`, `last_interaction_at = greatest(...)`
   - "newer" = `EXCLUDED.last_interaction_at >= t.last_interaction_at`
     (table-qualified reads the pre-update row). Comments can arrive out of order
     (redelivery), so latest-fields are guarded:
     - `last_comment_text`, `last_automation_id`, `last_automation_name`:
       `CASE WHEN newer THEN EXCLUDED.x ELSE t.x END`
     - `commenter_username`: `CASE WHEN newer THEN coalesce(EXCLUDED.u, t.u) ELSE coalesce(t.u, EXCLUDED.u) END`
       (an older comment still fills a NULL username)
   - `reached = t.reached OR EXCLUDED.reached` (always false on INSERT today; kept
     for safety), `updated_at = now()`
3. Upsert the link row on `(contact_id, automation_id)` the same way (its own
   `last_comment_text`).

**UPDATE branch:** set `reached = true` on the contact and the link. Never touches
counts. A later failed send never flips `reached` back.

Idempotent by construction: a redelivered comment hits `ON CONFLICT (comment_id)
DO NOTHING` and never fires a second INSERT trigger.

**Failure policy.** The trigger sits on the DM hot path: an exception would roll
back `claim_automation_send` or `mark_automation_dm_sent` and make the worker
retry or fail a DM. DMs are the product; contacts are derived data. So the body is
wrapped in `BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE WARNING
'sync_instagram_automation_contact: %', SQLERRM; RETURN NULL; END`, and the
tables are rebuildable from sends via a repair function (below).

### Name snapshot freshness

`ica_z1_sync_contact_names` — `AFTER UPDATE OF name ON instagram_comment_automations
FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name)` → function
`sync_instagram_automation_contact_names()`, **`SECURITY DEFINER SET search_path =
public`** (the rename runs as `authenticated` under `ica_update`, and the new tables
have no UPDATE policy for it; a plain trigger would silently update 0 rows).
Updates `last_automation_name` on contacts whose `last_automation_id` matches
first, then `automation_name` on matching link rows (same contact-then-link lock
order as the hot path, so a rename concurrent with a send cannot deadlock). After deletion the snapshot freezes.

"(removida)" is computed at read time: the automation id no longer exists in
`instagram_comment_automations`. The contacts RLS predicate is identical to
`ica_select`, so a SECURITY INVOKER `NOT EXISTS` cannot produce a false
"(removida)".

### Backfill and repair (same migration)

`rebuild_instagram_automation_contacts(p_conta_id uuid DEFAULT NULL)`:
`SECURITY DEFINER`, **non-destructive**. It must never delete: sends of deleted
automations are gone, so contacts/links that only exist because of them cannot be
re-derived and are exactly what this feature retains. Steps, scoped to
`p_conta_id` (or all workspaces):
1. Source = `instagram_automation_sends` joined to `instagram_comment_automations`
   (sends carry no `client_id`), `commenter_id IS NOT NULL`.
2. Insert missing contact rows (skeleton) per `(client_id, commenter_id)`,
   `ON CONFLICT DO NOTHING`.
3. Upsert link rows for **live** automations, replacing their values with the exact
   aggregate from sends (count, first/last, reached = `bool_or(dm_status='sent')`,
   latest comment via `DISTINCT ON ... ORDER BY comment_created_at DESC`, current
   automation name). Link rows of deleted automations are left as they are.
4. Recompute each touched contact from **all** its link rows: `first = min`,
   `last = max`, `interactions_count = sum`, `reached = bool_or`,
   `last_comment_text` / `last_automation_*` from the link with the greatest
   `last_interaction_at`; `commenter_username` = latest non-null username among live
   sends, else the existing value.

`REVOKE ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role`. The
migration uses it on empty tables as the backfill; afterwards it is the repair tool
if the trigger ever swallows an error.

Migration order (closes the backfill/trigger race):
1. `LOCK TABLE instagram_automation_sends IN SHARE ROW EXCLUSIVE MODE;` (blocks the
   webhook worker's inserts/updates for the migration's few seconds; writers wait
   on the lock and then proceed).
2. Create tables, functions, RLS.
3. `SELECT rebuild_instagram_automation_contacts();`
4. Create the triggers.
5. Sanity `DO` block: contact count = number of distinct `(a.client_id,
   s.commenter_id)` over sends joined to automations; `RAISE WARNING` on mismatch
   (not EXCEPTION: a failed migration inside a `db push` batch can leave the version
   row recorded with the DDL rolled back; the entitlement suite asserts correctness).

### RLS and grants

Both tables: `ENABLE ROW LEVEL SECURITY`, mirroring `ica_select`
(20260904000002):

```sql
CREATE POLICY iac_select ON instagram_automation_contacts
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('automacoes', 'ver'))
  );
-- iaca_select: same predicate
-- service_role_bypass_iac / _iaca: FOR ALL TO service_role USING (true) WITH CHECK (true)
```

No INSERT/UPDATE/DELETE policies for `authenticated`: writes only via the
SECURITY DEFINER functions. Grants: `REVOKE ALL ... FROM PUBLIC, anon;
GRANT SELECT ... TO authenticated; GRANT ALL ... TO service_role`.

Note: the sends log (`ias_select`) was never rewired to `has_permission` and is
visible to any member; contacts deliberately follow the stricter `ica_select`.

### Retention

`instagram_automation_sends` is never purged (the cron's 30-day purge only touches
`instagram_webhook_events`). Contacts live until the client row is deleted (FK
cascade from `clientes`; `deleteCliente` hard-deletes). Workspace deletion has no
cascade path today (`clientes.conta_id` has no FK to `workspaces`); contacts follow
whatever happens to `clientes`. Disconnecting the IG account does not delete
contacts.

## Read API

Plain SQL RPCs, `SECURITY INVOKER` (RLS does tenant + permission filtering).
Grants for each: `REVOKE EXECUTE ... FROM PUBLIC, anon; GRANT EXECUTE ... TO
authenticated, service_role` (house precedent: 20261002000010).

### `list_instagram_automation_contacts(...)`

```
p_client_id      bigint      DEFAULT NULL  -- NULL = all clients
p_automation_id  uuid        DEFAULT NULL
p_from           timestamptz DEFAULT NULL  -- inclusive
p_to             timestamptz DEFAULT NULL  -- exclusive
p_reached_only   boolean     DEFAULT true
p_search         text        DEFAULT NULL  -- ILIKE on commenter_username; '\', '%', '_' escaped
p_limit          int         DEFAULT 50    -- clamped to [1, 500]
p_offset         int         DEFAULT 0     -- UI paging
p_cursor_at      timestamptz DEFAULT NULL  -- keyset paging (export): rows strictly after
p_cursor_id      uuid        DEFAULT NULL  --   (p_cursor_at, p_cursor_id) in sort order;
                                           --   when a cursor is given, p_offset is ignored
RETURNS TABLE (
  id, client_id, commenter_username, first_interaction_at, last_interaction_at,
  interactions_count, reached, last_comment_text,
  automation_id, automation_name, automation_deleted boolean,
  total_count bigint                        -- count(*) OVER ()
)
```

Semantics:

- Without `p_automation_id`: rows are contacts; all columns from the contact row
  (`automation_*` = last automation).
- With `p_automation_id`: contacts joined to that link row; counts, dates,
  `reached` **and `last_comment_text`** come from the link (what happened with this
  person on this automation).
- Date range filters on `last_interaction_at` (contact's, or link's when an
  automation is selected), `[p_from, p_to)`. The UI maps picked calendar dates in
  the browser's local timezone to `[start of first day, start of the day after the
  last day)`. Labelled "Última interação".
- `automation_deleted` = `NOT EXISTS (SELECT 1 FROM instagram_comment_automations WHERE id = ...)`.
- Order: `last_interaction_at DESC, id DESC`. Cursor predicate:
  `(last_interaction_at, id) < (p_cursor_at, p_cursor_id)`.
- `count(*) OVER ()` yields no row when empty: callers treat "no rows" as total 0.
- `ILIKE '%term%'` is unindexed; fine at expected scale (thousands of contacts per
  workspace).

### `instagram_automation_contact_counts()`

`RETURNS TABLE (automation_id uuid, automation_name text, client_id bigint,
automation_deleted boolean, reached_count bigint, total_count bigint)` grouped over
the link table joined to contacts (for `client_id`) in the caller's workspace. One query serves:
- "Ver contatos (N)" on cards (N = `reached_count`, matching the default filter the
  link lands on);
- the Contatos tab's client and automation selects (including deleted automations
  and clients whose automations were all deleted);
- the client-detail section's existence check.

The page gate and nav (`hasContacts`) use `countInstagramContacts()` (head+count), not this RPC.

## UI

All copy pt-BR + en in `packages/i18n/locales/{pt,en}/automations.json`. No
em-dashes in user-facing copy.

### 1. Automações page — tabs "Automações | Contatos"

- Tab and Contatos filters live in the query string, owned by
  `useContactsFilters` (`/automacoes?aba=contatos&cliente=<id>&automacao=<uuid>&de=<yyyy-MM-dd>&ate=<yyyy-MM-dd>&todos=1&q=<text>`).
  No new route; `/automacoes` is already in `vercel.json`'s named pattern.
- The Automações tab keeps its own local `clientFilter` untouched. The Contatos tab
  has its **own** client select, with options = `clientes` whose id appears in
  `instagram_automation_contact_counts()`. A `cliente` URL value not in that set
  (no contacts) still applies (empty state) and the select shows the client's name.
- Other filters: automation select (from counts, scoped to the selected client;
  deleted ones as "Nome (removida)"), date range ("Última interação", existing
  `DateRangePicker`), switch "Só quem recebeu DM" (on by default; `todos=1` turns it
  off), search by @username (debounced 300ms).
- Desktop table columns: @username (link), Cliente (hidden when a client is
  selected), Recebeu DM (badge Sim/Não), Interações, Primeira interação, Última
  interação, Automação (last, or the filtered one; "(removida)" suffix), Último
  comentário (truncated).
- Mobile (< 901px, `useIsDesktop(901)`): stacked cards with the same fields.
- Pagination: 50 per page via offset, "Mostrando X–Y de Z".
- Empty states: no contacts at all ("Quando alguém comentar uma palavra-chave, a
  pessoa aparece aqui."); no results for filters ("Nenhum contato com esses filtros.").
- Username link: only when the username matches `/^[A-Za-z0-9._]{1,30}$/`, built as
  `https://instagram.com/${encodeURIComponent(u)}` and passed through
  `sanitizeUrl()`, `target="_blank" rel="noopener noreferrer"`. Otherwise plain
  text; null → "Usuário desconhecido". The username is a snapshot from the latest
  comment and can be stale.

**Automation cards:** next to the existing sends log (kept as is), a
"Ver contatos (N)" link to `?aba=contatos&cliente=<client_id>&automacao=<id>`.
Hidden when N = 0.

### 2. Client detail — "Redes sociais" tab

New section "Contatos das automações" under the Instagram section in
`RedesSociaisTab` (component loads the `automations` namespace; the tab itself uses
`clients`). Same list component with `clientId` fixed (no Cliente column, no
filters), showing the 10 most recent reached contacts, plus "Ver todos"
(→ `/automacoes?aba=contatos&cliente=<id>`) and "Exportar CSV" (all of that
client's reached contacts).

Rendered only when `can('automacoes','ver') === true` and
`instagram_automation_contact_counts()` has a row for this `client_id` with
`total_count > 0`. If the client has contacts but none reached, the section shows
the "none reached yet" empty copy and "Ver todos" (which the user can switch to
"todos").

### 3. CSV export

"Exportar CSV" button in both places; exports exactly the active filters.

- Pages through `list_instagram_automation_contacts` with **keyset** paging
  (`p_cursor_at/p_cursor_id`, 500 per call) until a call returns fewer than 500
  rows. Keyset (not offset) so contacts updated mid-export cannot shift rows into
  gaps; rows de-duplicated by `id` client-side as a belt-and-braces. Button shows a
  spinner and is disabled while running; wrapped in `trackUnsavedWork`.
- Columns (pt-BR header): `usuario`, `perfil_url`, `cliente`, `recebeu_dm`
  (sim/não), `interacoes`, `primeira_interacao`, `ultima_interacao`
  (`yyyy-MM-dd HH:mm`, local time), `automacao`, `ultimo_comentario`.
- UTF-8 with BOM, `;` separator, CRLF, RFC 4180 quoting.
- Formula-injection guard on every cell (comment text is attacker-controlled).
- `commenter_id` is **not** exported (app-scoped Meta id, meaningless outside).
- Filename `contatos-<slugify(cliente.nome)|todos>-<yyyy-MM-dd>.csv` (`clientes`
  has no slug column).
- **Reuse, don't copy:** extract `CSV_BOM`, field quoting, the formula guard
  (`FORMULA_LEAD` + `'` prefix) and `downloadCsv` from
  `apps/crm/src/pages/analytics-fluxos/csv.ts` into `apps/crm/src/lib/csvExport.ts`
  with a `separator` parameter (analytics keeps `,`); analytics-fluxos imports it
  back unchanged in behaviour. The new `buildContactsCsv(rows, clientesById)` in
  `apps/crm/src/pages/automacoes/contacts/contactsCsv.ts` composes it.
  `StepCommit.tsx`'s second copy is left alone (out of scope). `lib/csv.ts` is a
  parser and stays untouched.
- Copy does not mention Meta custom audiences or any specific downstream use.

### 4. Access and gating

- RLS restricts to `has_permission('automacoes','ver')`; the UI mirrors it with
  `can('automacoes','ver') === true` (`can()` returns `boolean | 'unknown'`) for the
  tab, the client-detail section and export.
- Contacts stay reachable after a plan downgrade **even when every automation was
  deleted**:
  - `AutomacoesPage`'s locked condition (`flagOff && automations.length === 0`,
    AutomacoesPage.tsx:254/:308) becomes `flagOff && automations.length === 0 &&
    !hasContacts`; with the flag off and only contacts, the page opens on the
    Contatos tab and the Automações tab shows the existing upgrade copy instead of
    the create button.
  - The nav item rule (`useEffectiveNavFeatures`, visible after downgrade while
    `countInstagramAutomations() > 0`) becomes `automations > 0 || contacts > 0`,
    with `contacts` from a head+count select on `instagram_automation_contacts`
    (same 5-min staleTime; invalidated with the automations count).

### 5. Data layer

- `apps/crm/src/store/instagramContacts.ts`: `listInstagramContacts(filters, page)`,
  `exportInstagramContacts(filters)` (keyset loop), `getContactCounts()`,
  `countInstagramContacts()`. Re-exported from `store/index.ts`.
- TanStack Query keys `['instagram-contacts', filters, page]`,
  `['instagram-contact-counts']`, `['instagram-contacts-count']`. Added to
  `MODULE_QUERY_KEYS.automacoes` in `AuthContext.tsx` so a role change drops them.
  Automation delete/update mutations in `AutomacoesPage` also invalidate them.

### Component layout

- `apps/crm/src/pages/automacoes/contacts/ContactsTab.tsx` — filters + table + paging + export.
- `apps/crm/src/pages/automacoes/contacts/ContactsList.tsx` — table/cards presentational
  component, reused by the client-detail section.
- `apps/crm/src/pages/automacoes/contacts/useContactsFilters.ts` — filters ⇄ query string.
- `apps/crm/src/pages/automacoes/contacts/contactsCsv.ts` — CSV builder.
- `apps/crm/src/lib/csvExport.ts` — shared CSV writer (extracted).
- `apps/crm/src/pages/cliente-detalhe/components/AutomationContactsSection.tsx`.
- `AutomacoesPage.tsx` (853 lines) only gains the tab switch, the gate tweak and the
  card link.

## Out of scope

- Sending messages / broadcasts to contacts (Meta 24h window).
- Keyword filter; post filter; tags/notes per contact; pushing contacts into Leads.
- Showing contacts in the Hub.
- Contacts from non-automation comments.
- Rewiring `ias_select` to `has_permission`.

## Testing

- **Entitlements suite (CI-gated)**
  `supabase/tests/entitlements/99_instagram_automation_contacts.sql`
  (`\i _helpers.sql`, `select et_grant_hosted_parity();`):
  - Sends inserted via `claim_automation_send` → contact + link; second comment by
    the same person on another automation of the same client → one contact, two
    links, `interactions_count = 2`; cooldown-skipped send counts.
  - Same person on another client → separate contact.
  - Out-of-order insert (older `comment_created_at` after a newer one) → latest
    fields keep the newer comment; NULL username filled by the older one.
  - `mark_automation_dm_sent` → `reached` true on contact and link; a later failed
    send does not flip it back; public-reply-only update does not set `reached`.
  - Duplicate `comment_id` → no double count.
  - Delete automation → contact and link survive; RPC `automation_deleted = true`.
  - Rename automation (as `authenticated`) → snapshots updated.
  - Delete client → contacts and links gone.
  - Composite FK rejects a link row whose `conta_id` differs from its contact's.
  - RLS: other workspace sees nothing; member without `automacoes` 'ver' sees
    nothing; `authenticated` cannot INSERT/UPDATE/DELETE; `anon` cannot execute the
    RPCs; `authenticated` cannot execute `rebuild_instagram_automation_contacts`.
  - RPC: reached_only, automation filter (link-level comment/dates), `[from, to)`,
    search escaping, limit clamp, keyset cursor, empty → no rows.
  - `rebuild_instagram_automation_contacts()` reproduces trigger-maintained state,
    and run after an automation was deleted it keeps that automation's contacts
    and link rows intact (non-destructive).
- **Vitest**: `csvExport` (BOM, separator, quoting, formula guard) incl. existing
  analytics-fluxos CSV tests still green; `buildContactsCsv` (null username, sim/não,
  dates); export keyset loop (stops on short page, de-dupes); `useContactsFilters`
  round-trip; "Ver contatos" deep link; ContactsTab empty/error/list states;
  AutomacoesPage gate with `flagOff` + no automations + contacts → Contatos tab, not
  locked screen; client-detail section hidden without contacts or permission.
- **Browser**: both placements, filters, paging, CSV opens in Numbers/Excel with
  accents intact, mobile cards, dark mode.

## Rollout

1. `db push` the migration (staging, then prod) **before** merging: merge deploys
   the frontend immediately.
2. No edge-function changes and no new env vars.
3. Rollback: the frontend can be reverted independently; tables, functions and
   triggers are additive. Dropping the two `ias_z*` triggers stops maintenance
   without affecting sends; `rebuild_instagram_automation_contacts()` resyncs after
   re-adding them.

## Open questions

- None blocking. Meta Platform Terms: the export goes to the business that owns the
  IG account the data came from (the same people its own Instagram inbox shows);
  Mesaas does no third-party transfer. Flagged for awareness during App Review.
