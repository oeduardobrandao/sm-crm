# Hub link lifecycle — auto-renew, rotate, rescue

**Date:** 2026-07-16
**Branch:** `claude/dk-marketing-link-expirado-d0ec2a`
**Status:** approved, pending implementation plan

## Context — the incident that produced this

On 2026-07-16 a DK Marketing Médico client (Vanessa Bessa, `cliente_id = 15`) reported
"Link inválido ou expirado" on her Hub portal. Deactivating and reactivating the link
did not help.

Confirmed against prod (`skjzpekeqefvlojenfsw`):

```
token       49ded0d7-0c34-4b88-8a60-f9d459113f3c
created_at  2026-04-10 17:00:55+00
expires_at  2026-07-16 10:54:01.069126+00
now         2026-07-16 11:23:48+00     → ainda_valido = false
is_active   true      hub_enabled true      (single token row)
```

**Root cause.** Migration `20260417000002_cap_hub_token_expiry.sql` (VULN-005) ran on prod
at `2026-04-17 10:54:01.069126+00` and executed:

```sql
UPDATE client_hub_tokens SET expires_at = now() + interval '90 days'
  WHERE expires_at >= '2099-01-01'::timestamptz;
```

One statement means one `now()` evaluation, so **every legacy hub token in the database —
every workspace, every client — received the identical expiry** and went dark
simultaneously at 2026-07-16 10:54:01 UTC. Vanessa was not the affected client; she was
the first to click.

`resolveHubToken` (`supabase/functions/_shared/hub-token.ts:22`) filters on
`.gt("expires_at", now)`, so an expired token resolves to `null` and `hub-bootstrap`
returns `"Link inválido."`, which the Hub renders as "Link inválido ou expirado."

**Why deactivate/reactivate could not have worked.** `setHubTokenActive`
(`apps/crm/src/store/hub.ts:97`) writes only `is_active`. It never touches `expires_at`.
The toggle is orthogonal to expiry.

**Why nobody saw it coming.** `getHubToken` (`apps/crm/src/store/hub.ts:78`) selects
`id, token, is_active` — not `expires_at`. The CRM cannot render a dead link as dead.

**Remediation already applied** (prod, SQL editor, 2026-07-16): the capped cohort was
extended to `now() + interval '365 days'`, targeted on the exact cohort timestamp
`2026-07-16 10:54:01.069126+00`. Verified: zero tokens with `expires_at <= now()`.
This restored every existing URL without re-issuing anything. It is a stopgap — the whole
cohort now shares a new synchronized expiry of ~2027-07-16, which this design dissolves.

## Goals

1. A hub link in active use must never expire. Today's failure becomes structurally
   impossible rather than merely visible.
2. The agency can rotate a client's link (new URL, old one dead) for security.
3. A lapsed link can be revived without changing its URL.
4. Expiry is visible in the CRM.

## Non-goals

- Roster-wide / dashboard-level expiry warnings. Explicitly decided against: per-client
  visibility only. See Known limitations.
- Email alerts before expiry.
- Changing `resolveHubToken`, `setHubTokenActive`, or `createHubToken` semantics.
- Fixing the dead `!is_active` branch at `apps/hub/src/shell/HubShell.tsx:52`.

## Design decisions and their rationale

| Decision | Chosen | Why |
| --- | --- | --- |
| Expiry model | Sliding window, renewed on use | A manual button depends on a human noticing a date — one forgotten click reproduces the outage. Auto-renew removes the human from the loop. |
| Window length | 365 days since last visit | Matches the existing `20260416000002` default, so one duration exists in the system rather than two. A client who visits once a year never lapses. |
| Renewal chokepoint | `hub-bootstrap` only | `resolveHubToken` is called by every hub endpoint; renewing there is a DB write per API call. `HubShell` always calls `fetchBootstrap` on mount, so bootstrap is one write per visit. |
| Rotation mechanics | In-place `UPDATE` of the existing row | `trg_limit_hub_tokens` is `BEFORE INSERT` and counts **all** rows for the workspace with no status predicate. Rotation-by-INSERT permanently burns a `max_hub_tokens` slot per rotation and eventually fails with `plan_limit_exceeded` — a billing error for a security action. An `UPDATE` never fires the trigger. |
| Rescue extend | Kept, but only rendered when expired/near-expiry | Auto-renew cannot revive a lapsed link (by design). Without a rescue, a dormant client's only path back is a new URL that must be re-sent. |
| RPC security mode | `SECURITY DEFINER` + explicit ownership check | `audit_log` accepts service-role inserts only, so an invoker-mode function cannot write a trail. Rotation is precisely the action worth auditing. |

### The self-healing property

The stopgap left every legacy token sharing an expiry of ~2027-07-16 — the same
synchronized cliff, one year out. Once auto-renew ships, each client's `expires_at` is
pushed forward on their own next visit, at their own time. **The cohort spreads out by
itself and the wave dissolves**, with no roster view required. Only genuinely dormant
clients remain on the original date, which is the correct outcome.

## Component 1 — auto-renew

New SQL function. The throttle and both safety rules live in the `WHERE` clause, so there
is no read-then-write race and no branching logic in the edge function.

```sql
create or replace function hub_token_touch(p_token uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update client_hub_tokens
     set expires_at = now() + interval '365 days'
   where token = p_token
     and expires_at > now()                        -- never resurrect a dead link
     and expires_at < now() + interval '350 days'; -- throttle: ~1 write / 15 days
$$;
```

- `expires_at > now()` — auto-renew only keeps a *living* link alive. It can never
  silently revive a lapsed one. Expiry still means expiry.
- `expires_at < now() + interval '350 days'` — an active client writes roughly once a
  fortnight, not on every page load.
- `SECURITY DEFINER` is not strictly required here (the caller is service-role and already
  bypasses RLS) but is used for consistency with the other two functions and to keep the
  function callable if the caller's key ever changes. It takes no user input beyond the
  token it already holds.

Call site — `supabase/functions/hub-bootstrap/handler.ts`, immediately after
`resolveHubToken` succeeds:

```ts
const hubToken = await resolveHubToken(db as any, token, deps.now(), conta.id);
if (!hubToken) return json({ error: "Link inválido." }, 404);

await deps.touchToken(token);   // never throws; see below
```

`touchToken` is injected through `HubBootstrapHandlerDeps` (matching the existing
`createDb` / `now` injection pattern, which is what makes the handler unit-testable).
Its implementation in `index.ts` wraps the RPC in **both** a timeout (`AbortSignal`) and a
catch that swallows every error.

**This is a hard requirement, not a nicety.** A renewal failure must never break a
client's portal. This repo has a documented history of edge-runtime I/O hangs that kill
the isolate with no error logs and bypass `catch`, so the renewal cannot sit
unguarded on the response path. If `touchToken` cannot complete, bootstrap must still
return the client's portal.

## Component 2 — rotate and rescue extend

```sql
hub_token_rotate(p_token_id uuid) returns table (token uuid, expires_at timestamptz)
hub_token_extend(p_token_id uuid) returns timestamptz
```

Both `SECURITY DEFINER`, `set search_path = public`, and both a single `UPDATE`
(no INSERT → `trg_limit_hub_tokens` never fires → no quota consumed).

- `hub_token_rotate` — sets `token = gen_random_uuid()` and
  `expires_at = now() + interval '365 days'`. The old URL dies the instant it swaps;
  there is no window in which both work. The token must be generated server-side —
  a browser-generated UUID would mean client-trusted randomness for a security credential.
- `hub_token_extend` — sets `expires_at = now() + interval '365 days'` only.

**Ownership enforcement.** `SECURITY DEFINER` bypasses RLS, so ownership cannot be
inferred and must be checked explicitly in each function body:

```sql
select conta_id into v_conta_id from client_hub_tokens where id = p_token_id;
if v_conta_id is null then raise exception 'not_found'; end if;
if v_conta_id not in (select public.get_my_conta_id()) then
  raise exception 'forbidden';
end if;
```

The predicate deliberately mirrors the shape of the existing
`client_hub_tokens_workspace_all` policy (`conta_id IN (SELECT public.get_my_conta_id())`).
Note that `get_my_conta_id()` returns the caller's **`active_workspace_id`**, not a raw
`conta_id` — implementation must verify the exact return shape against the live function
rather than assume a scalar.

**Audit.** Both functions write to `audit_log` before returning:

```
action        'hub_token.rotate' | 'hub_token.extend'
resource_type 'client_hub_tokens'
resource_id   p_token_id::text
conta_id      v_conta_id
actor_user_id auth.uid()
metadata      { cliente_id, old_expires_at, new_expires_at }
```

`metadata` must **never** contain the old or new token value — `audit_log` is readable by
every owner/admin in the workspace, and a token is a bearer credential.

## Component 3 — store layer (`apps/crm/src/store/hub.ts`)

```ts
getHubToken(clienteId)   // + expires_at added to the select   ← the blindness fix
extendHubToken(tokenId)  // supabase.rpc('hub_token_extend', { p_token_id })
rotateHubToken(tokenId)  // supabase.rpc('hub_token_rotate', { p_token_id })
```

`getHubToken`'s return type gains `expires_at: string`. `setHubTokenActive` and
`createHubToken` are unchanged.

## Component 4 — UI (`apps/crm/src/pages/cliente-detalhe/HubTab.tsx`, Acesso tab)

A status line under the existing URL row, formatted with `date-fns` in pt-BR:

| Condition | Rendering |
| --- | --- |
| `> 30 days` | muted — `Expira em 16/07/2027` |
| `<= 30 days` | amber — `Expira em 12 dias (16/07/2027)` |
| expired | red + `Expirado` badge — `Expirou em 16/07/2026` |

Buttons, alongside the existing `Copiar` / `Preview` / `Desativar`:

- **`Gerar novo link`** — `destructive` variant, gated behind a shadcn `AlertDialog`. The
  copy states plainly that the current link stops working immediately and that the client
  must be sent the new one. Rotation instantly breaks a bookmarked link — that is the
  point, but it must not be reachable by a stray click.
- **`Estender +1 ano`** — rendered **only** when the link is expired or `<= 30 days` from
  expiry. Because auto-renew throttles at 350 days, an active client's link never enters
  that range, so this control is invisible in normal operation and appears only for
  genuinely dormant clients. This is what keeps it from being the unscalable manual
  maintenance that was rejected.

Both mutations invalidate `['hub-token', clienteId]` and are disabled while in flight to
prevent double-fire.

## Error handling

- RPC errors surface via `toast()` from `sonner` in plain Portuguese. `forbidden` →
  "Sem permissão para este cliente."; `not_found` → "Link não encontrado."; anything else
  → a generic failure message. Raw Postgres error text is never shown.
- `touchToken` failures are silent by design: swallowed, never surfaced to the client, and
  never allowed to affect the bootstrap response.

## Testing

**pgTAP** (`supabase/tests/`)
- `hub_token_touch` does **not** renew a token whose `expires_at <= now()` (never resurrects)
- `hub_token_touch` does **not** write when `expires_at > now() + 350 days` (throttle holds)
- `hub_token_touch` **does** renew a token inside the window
- `hub_token_rotate` changes `token` and leaves `client_hub_tokens` row-count unchanged
  (proves the quota is untouched and `trg_limit_hub_tokens` never fired)
- `hub_token_rotate` / `hub_token_extend` raise `forbidden` for a caller in another
  workspace — the explicit check that replaces RLS. Use `et_make_workspace` for fixtures.
- `audit_log` gains a row on rotate/extend, and its `metadata` contains no token value

**Deno** (`supabase/functions/__tests__/hub-bootstrap_test.ts`)
- `touchToken` is called when `resolveHubToken` succeeds
- `touchToken` is **not** called when `resolveHubToken` returns null
- a throwing/hanging `touchToken` still yields a 200 bootstrap response

**Vitest / RTL**
- `store.hub.test.ts` — `getHubToken` returns `expires_at`; extend/rotate call the right RPC
- `HubTab` — the three colour states render at the right thresholds; `Estender` is absent
  when the link is healthy; `Gerar novo link` is gated behind the confirm dialog

## Deployment notes

- Migration: `supabase/migrations/20260716000001_hub_token_lifecycle.sql` (all three
  functions). Version verified free as of 2026-07-16: 137 migration files, 137 unique
  versions, no collisions, and nothing at `20260716*`.
- The previously-recorded duplicate-timestamp blocker at `20260625000001` **no longer
  exists** — only one file carries that version now. Do not assume `db push` is blocked
  for that reason. Still run `migration list` and `db push --dry-run` against the intended
  target first to confirm scope: `db push` applies *all* migrations missing from the
  target's history, not just the new one.
- **Confirm the target before any `--linked` command.** `cat supabase/.temp/project-ref`
  returns a bare ref with no environment label; this checkout is currently linked to
  **staging** (`wlyzhyfondykzpsiqsce`). Prod is `skjzpekeqefvlojenfsw`.
- Edge deploy: `hub-bootstrap` only, with `--use-api` (the local Docker bundler is broken
  in this repo).
- Order: migration first, then `hub-bootstrap`. The function is additive and unused until
  the edge function calls it, so there is no window where the two are inconsistent.

## Known limitations

- **Roster-wide discovery remains absent** by explicit decision. The 2027-07-16 cohort
  cliff is dissolved by auto-renew for every client who visits before then; a client who
  does not visit for a year lapses silently and is discovered only when they call. The
  `Estender` rescue makes that a seconds-long fix rather than a re-issue.
- Auto-renew is driven by *client* visits. A client who never opens their portal will lapse
  even while the agency actively posts for them. This is the intended security trade-off:
  the window measures client access, not agency activity.
