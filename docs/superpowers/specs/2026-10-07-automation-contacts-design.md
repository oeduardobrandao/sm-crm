# Automation contacts ("Contatos") — design

**Date:** 2026-10-07
**Status:** approved in brainstorming, pending spec review
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
| Who is a contact | Everyone who commented a keyword (any send with a `commenter_id`); a "Recebeu DM" flag distinguishes who was actually reached. Default filter shows reached only |
| Storage approach | **A: derived contacts tables maintained by a trigger on sends** (rejected: soft-deleting automations; relaxing the tenant-safe composite FK) |
| Keyword filter | Dropped. Sends do not record which keyword matched; adding it means touching the webhook worker. Out of scope |
| Post filter | Dropped. Automation filter covers it (an automation targets one post) |

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
  interactions_count    int NOT NULL DEFAULT 0, -- number of matching comments (send rows)
  reached               boolean NOT NULL DEFAULT false, -- any send with dm_status='sent' OR public_reply_status='sent'
  last_comment_text     text,
  last_automation_id    uuid,                   -- NO FK: survives deletion
  last_automation_name  text,                   -- snapshot
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT iac_client_commenter_uq UNIQUE (client_id, commenter_id),
  CONSTRAINT iac_client_same_tenant FOREIGN KEY (client_id, conta_id)
    REFERENCES clientes (id, conta_id) ON DELETE CASCADE
);
CREATE INDEX idx_iac_client_last ON instagram_automation_contacts (client_id, last_interaction_at DESC, id);
CREATE INDEX idx_iac_conta_last  ON instagram_automation_contacts (conta_id, last_interaction_at DESC, id);
```

Keyed per **client**, not per workspace: the same IG person commenting on two
different clients' posts is two contacts (two different audiences).

### `instagram_automation_contact_automations` — person × automation

Needed for the automation filter, the "Ver contatos (N)" count and the
"Última automação"/"(removida)" display after deletion.

```sql
CREATE TABLE instagram_automation_contact_automations (
  contact_id            uuid NOT NULL REFERENCES instagram_automation_contacts (id) ON DELETE CASCADE,
  automation_id         uuid NOT NULL,          -- NO FK: survives deletion
  conta_id              uuid NOT NULL,
  automation_name       text NOT NULL,          -- snapshot, kept fresh while the automation exists
  first_interaction_at  timestamptz NOT NULL,
  last_interaction_at   timestamptz NOT NULL,
  interactions_count    int NOT NULL DEFAULT 0,
  reached               boolean NOT NULL DEFAULT false,
  PRIMARY KEY (contact_id, automation_id)
);
CREATE INDEX idx_iaca_automation ON instagram_automation_contact_automations (automation_id, last_interaction_at DESC);
```

`conta_id` is denormalized for RLS. Writes come only from the trigger below, which
copies it from the send row, so no extra tenant constraint is needed.

### Maintenance trigger on `instagram_automation_sends`

`AFTER INSERT OR UPDATE OF dm_status, public_reply_status` → `SECURITY DEFINER`
plpgsql function `sync_instagram_automation_contact()`, `SET search_path = public`.

- **INSERT** (row has `commenter_id IS NOT NULL`; rows without it are ignored):
  1. Resolve `client_id` and `name` from `instagram_comment_automations` by
     `NEW.automation_id` (the automation always exists at insert time; the FK
     guarantees it).
  2. Upsert the contact on `(client_id, commenter_id)`:
     `interactions_count + 1`, `first = least(...)`, `last = greatest(...)`,
     `commenter_username = coalesce(NEW.commenter_username, existing)` (only
     overwrite with the newer comment's username when `NEW.comment_created_at >=
     last_interaction_at`), `last_comment_text` / `last_automation_*` likewise only
     when the new comment is the latest, `reached = reached OR <new row reached>`.
  3. Upsert the link row on `(contact_id, automation_id)` the same way.
  - Idempotent by construction: `claim_automation_send` inserts with
    `ON CONFLICT (comment_id) DO NOTHING`, so a redelivered comment never fires a
    second INSERT trigger. Cooldown-skipped sends still insert a row and **do**
    count as an interaction (the person commented again).
- **UPDATE**: only when `reached` flips from false to true for this row
  (`dm_status` or `public_reply_status` became `'sent'`): set `reached = true` on
  the contact and the link. Never touches counts.

Concurrent comments from the same person: both upserts target the same unique key;
`ON CONFLICT DO UPDATE` serializes them. (The claim RPC also holds an advisory lock
per automation×commenter, but the trigger must not rely on it: two different
automations of the same client share a contact row.)

### Name snapshot freshness

`AFTER UPDATE OF name ON instagram_comment_automations` → update
`automation_name` on matching link rows and `last_automation_name` on contacts
whose `last_automation_id` matches. After deletion the snapshot freezes.

"(removida)" is computed at read time: the automation id no longer exists in
`instagram_comment_automations`.

### Backfill (same migration)

From existing `instagram_automation_sends` joined to `instagram_comment_automations`
(sends of already-deleted automations are gone; nothing to recover), with
`commenter_id IS NOT NULL`: aggregate per `(client_id, commenter_id)` and per
`(contact, automation_id)`, taking the latest-row fields via `DISTINCT ON ...
ORDER BY comment_created_at DESC`. Done before creating the trigger, inside the
migration transaction. Volume is small (sends are one row per matching comment).

### RLS

Both tables: `ENABLE ROW LEVEL SECURITY`, mirroring `ica_select`
(20260904000002):

```sql
CREATE POLICY iac_select ON instagram_automation_contacts
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('automacoes', 'ver'))
  );
-- same for iaca_select
-- service_role_bypass_* FOR ALL TO service_role
```

No INSERT/UPDATE/DELETE policies for `authenticated`: writes only via the trigger.
Explicit grants: `GRANT SELECT ... TO authenticated`, `REVOKE ALL ... FROM anon`.

### Retention

`instagram_automation_sends` is never purged (the cron's 30-day purge only
touches `instagram_webhook_events`). Contacts live until the client is deleted
(FK cascade from `clientes`, which itself cascades from the workspace).
Disconnecting the IG account does not delete contacts.

## Read API

Plain SQL RPCs, `SECURITY INVOKER` (RLS does the tenant/permission filtering),
`GRANT EXECUTE TO authenticated`:

### `list_instagram_automation_contacts(...)`

```
p_client_id      bigint  DEFAULT NULL   -- NULL = all clients
p_automation_id  uuid    DEFAULT NULL
p_from           timestamptz DEFAULT NULL
p_to             timestamptz DEFAULT NULL
p_reached_only   boolean DEFAULT true
p_search         text    DEFAULT NULL   -- ILIKE on commenter_username, '%' and '_' escaped
p_limit          int     DEFAULT 50     -- clamped to [1, 1000]
p_offset         int     DEFAULT 0
RETURNS TABLE (
  id, client_id, commenter_username, first_interaction_at, last_interaction_at,
  interactions_count, reached, last_comment_text,
  automation_id, automation_name, automation_deleted boolean,
  total_count bigint                     -- count(*) OVER ()
)
```

Semantics:

- Without `p_automation_id`: rows are contacts; counts/dates/reached/last automation
  come from the contact row.
- With `p_automation_id`: rows are contacts joined to that link row; counts, dates
  and `reached` come from the **link** (what this automation did with this person),
  `automation_*` is the filtered automation.
- Date range filters on `last_interaction_at` (of the contact, or of the link when
  an automation is selected). Labelled "Última interação" in the UI.
- `automation_deleted` = `NOT EXISTS (SELECT 1 FROM instagram_comment_automations WHERE id = ...)`.
- Order: `last_interaction_at DESC, id DESC` (stable for offset paging).

### `instagram_automation_contact_counts()`

`RETURNS TABLE (automation_id uuid, automation_name text, client_id bigint,
reached_count bigint, total_count bigint)` grouped over the link table for the
caller's workspace. Feeds "Ver contatos (N)" on cards (N = `reached_count`,
matching the default filter the link lands on) and the automation select in the
Contatos tab, including deleted automations that still have contacts (name from
the snapshot).

## UI

All copy pt-BR (+ en in `packages/i18n/locales/{pt,en}/automations.json`).
No em-dashes in user-facing copy.

### 1. Automações page — tabs "Automações | Contatos"

- Tab state in the query string: `/automacoes?aba=contatos` (no new route, no
  `vercel.json` change). Extra deep-link params: `cliente=<id>`, `automacao=<uuid>`.
- The Contatos tab reuses the page's existing client filter (`clientFilter`) and adds:
  - Automação select (from `instagram_automation_contact_counts()` + live
    automations; deleted ones as "Nome (removida)"), scoped to the selected client.
  - Date range ("Última interação"), using the existing date-range picker primitive.
  - Switch "Só quem recebeu DM" (on by default).
  - Search by @username (debounced 300ms).
- Desktop table columns: @username (link), Cliente (hidden when a client is
  selected), Recebeu DM (badge Sim/Não), Interações, Primeira interação, Última
  interação, Automação (last, or the filtered one; "(removida)" suffix).
- Mobile (< 901px, same breakpoint the page uses via `useIsDesktop(901)`): stacked
  cards with the same fields.
- Pagination: 50 per page, server-side, using `total_count`; "Mostrando X–Y de Z".
- Empty states: no contacts yet ("Quando alguém comentar uma palavra-chave, a
  pessoa aparece aqui."); no results for filters ("Nenhum contato com esses filtros.").
- Username link: `https://instagram.com/<username>` passed through `sanitizeUrl()`,
  `target="_blank" rel="noopener noreferrer"`. Username null → plain "Usuário
  desconhecido", no link. Caveat: the username is a snapshot from the latest
  comment and can be stale.

**Automation cards:** next to the existing sends log (kept as is), a
"Ver contatos (N)" link that switches to `?aba=contatos&cliente=<client_id>&automacao=<id>`.
Hidden when N = 0.

### 2. Client detail — "Redes sociais" tab

New section "Contatos das automações" under the Instagram section in
`RedesSociaisTab`. Same list component with `clientId` fixed (no Cliente column,
no client filter), showing the 10 most recent reached contacts, plus:
"Ver todos" (→ `/automacoes?aba=contatos&cliente=<id>`) and "Exportar CSV"
(exports all of that client's reached contacts).
Rendered only when the user has `can('automacoes','ver')` and the client has at
least one contact (the 10-row call's `total_count`, with `p_reached_only: false`
for the existence check so a client with only failed sends still shows the section).

### 3. CSV export

Button "Exportar CSV" in both places; exports exactly the active filters.

- Pages through `list_instagram_automation_contacts` in chunks of 1000 until
  `offset >= total_count` (never a single unpaged select; PostgREST max-rows caps it).
  Button shows a spinner and is disabled while running; the work is wrapped in
  `trackUnsavedWork` (CLAUDE.md: silent deploy swap must not kill it mid-run).
- Columns (header row in pt-BR): `usuario`, `perfil_url`, `cliente`, `recebeu_dm`
  (sim/não), `interacoes`, `primeira_interacao`, `ultima_interacao`
  (`yyyy-MM-dd HH:mm`, local time), `automacao`, `ultimo_comentario`.
- UTF-8 with BOM, `;` separator, CRLF, RFC 4180 quoting.
- **CSV formula injection:** any cell starting with `=`, `+`, `-`, `@`, tab or CR
  gets a leading `'`. Comment text is attacker-controlled.
- `commenter_id` is **not** exported (app-scoped Meta id, meaningless outside).
- Filename `contatos-<slug-do-cliente|todos>-<yyyy-MM-dd>.csv`.
- New pure helper `buildContactsCsv(rows, clientesById)` in
  `apps/crm/src/pages/automacoes/contacts/contactsCsv.ts` (unit-tested); download
  via Blob + object URL. `lib/csv.ts` is a parser and stays untouched.
- Copy does not mention Meta custom audiences or any specific downstream use.

### 4. Access and gating

- RLS already restricts to `has_permission('automacoes','ver')`; the UI mirrors it
  with `can('automacoes','ver')` for the tab, the client-detail section and export.
- The Contatos tab lives on the Automações page and inherits whatever gates that
  page (nav visibility / `FeatureGate` for creation). Contacts stay readable after a
  plan downgrade, like the sends log is today (downgrade blocks only creating
  automations).

### 5. Data layer

- `apps/crm/src/store/instagramContacts.ts`: `listInstagramContacts(filters, page)`,
  `exportInstagramContacts(filters)` (the paging loop), `getContactCountsByAutomation()`.
  Re-exported from `store/index.ts`.
- TanStack Query keys: `['instagram-contacts', filters, page]`,
  `['instagram-contact-counts']`. The automation delete/update mutations in
  `AutomacoesPage` also invalidate both (so "(removida)" and names refresh).

### Component layout

- `apps/crm/src/pages/automacoes/contacts/ContactsTab.tsx` — filters + table + paging + export.
- `apps/crm/src/pages/automacoes/contacts/ContactsList.tsx` — table/cards presentational
  component, reused by the client-detail section.
- `apps/crm/src/pages/automacoes/contacts/useContactsFilters.ts` — filters ⇄ query string.
- `apps/crm/src/pages/automacoes/contacts/contactsCsv.ts` — CSV builder + download.
- `apps/crm/src/pages/cliente-detalhe/components/AutomationContactsSection.tsx`.
- `AutomacoesPage.tsx` (853 lines) only gains the tab switch and the card link; the
  new UI lives in the files above.

## Out of scope

- Sending messages / broadcasts to contacts (Meta 24h window).
- Keyword filter; post filter; tags/notes per contact; pushing contacts into Leads.
- Showing contacts in the Hub.
- Contacts from non-automation comments.

## Testing

- **Entitlements suite (CI-gated)** `supabase/tests/entitlements/99_instagram_automation_contacts.sql`:
  - Insert sends → contact + link created; second comment by the same person on
    another automation of the same client → one contact, two links,
    `interactions_count = 2`.
  - Same person on another client → separate contact.
  - Send UPDATE `dm_status='sent'` → `reached` true on both; a later failed send
    does not flip it back.
  - Duplicate `comment_id` via `claim_automation_send` → no double count.
  - Delete automation → contact and link survive; `automation_deleted = true` in the RPC.
  - Rename automation → snapshot updated.
  - Delete client → contacts gone.
  - RLS: other workspace sees nothing; member without `automacoes` 'ver' sees
    nothing; `authenticated` cannot INSERT/UPDATE/DELETE.
  - RPC filters: reached_only, automation, date range, search escaping (`%`, `_`),
    limit clamp, `total_count`.
  - Backfill: a migration-time sanity check (`DO` block) that the contact count
    equals the number of distinct `(client_id, commenter_id)` pairs in sends.
- **Vitest**: `buildContactsCsv` (BOM, `;`, quoting, formula-injection prefix,
  null username), export paging loop (stops at `total_count`, chunks of 1000),
  `useContactsFilters` round-trip with the query string, "Ver contatos" deep link,
  ContactsTab renders empty/error/list states, client-detail section hidden with
  no contacts or no permission.
- **Browser**: both placements, filters, paging, CSV opens in Numbers/Excel with
  accents intact, mobile cards, dark mode.

## Rollout

1. `db push` the migration (staging, then prod) **before** merging: merge deploys
   the frontend immediately.
2. No edge-function changes and no new env vars.
3. Rollback: the frontend can be reverted independently; the tables and trigger
   are additive. Dropping the trigger stops maintenance without affecting sends.

## Open questions

- None blocking. Meta Platform Terms: the export goes to the business that owns
  the IG account the data came from (the same people its own Instagram inbox
  shows), which is the intended use; Mesaas does no third-party transfer. Flagged
  for awareness during App Review, not a blocker.
