# Crisp Customer Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push every confirmed CRM user into Crisp as a person profile, carrying plan, workspace and contact context, so support recognises them on any channel.

**Architecture:** A `crisp-sync-cron` edge function mirroring the shipped `loops-sync-cron`. Postgres RPCs select candidates and compute a payload fingerprint; the function does a read-modify-write against the Crisp REST API and advances the fingerprint only on confirmed success. A `crisp_contacts` ledger records which email was actually pushed so erasure survives account deletion.

**Tech Stack:** Deno edge functions, Supabase Postgres (`pg_cron`, `security definer` RPCs), Crisp REST API v1.

**Spec:** `docs/superpowers/specs/2026-08-03-crisp-customer-sync-design.md`. Read it before starting. Where this plan and the spec disagree, the spec wins and the plan is the bug.

## Global Constraints

- **Deno, not Node.** Imports use `npm:` specifiers or relative `.ts` paths.
- **Never log or return raw vendor error details.** Thrown messages carry HTTP status and a *static route shape* only — never the response body, never the interpolated path (it may contain an email).
- **Every vendor call is bounded** by `AbortSignal.timeout(10_000)`. Unbounded I/O gets the isolate killed in a way that bypasses `catch`.
- **CORS** via `buildCorsHeaders(req)` from `_shared/cors.ts`. Never wildcard `*`.
- **Cron auth** via `x-cron-secret` compared with `timingSafeEqual`, before anything else.
- **No em-dashes in user-facing strings.** Crisp `data.*` values are read by humans; use plain words or empty strings.
- **Migration version prefixes are provisional.** Before opening the PR, run `git ls-tree origin/main:supabase/migrations | tail` and renumber above the real tail. A duplicate prefix is silently skipped by Supabase and fails the `migration-version-guard` CI job.
- **Managed segment vocabulary is exactly:** `owner`, `membro`, `trial`, `pagante`, `free`, `inadimplente`.
- **Crisp plugin scopes are exactly `website:people:profiles` and `website:people:data`.** `website:people:manage` / `website:people:read` do not exist.
- **Profile and custom data are two different APIs.** `data.*` cannot ride on a profile write; it goes to `PATCH /people/data/{id}`.
- **A profile `PUT` replaces the whole object.** Always spread back everything the `GET` returned and override only `email`, `person.nickname`, `person.phone` and `segments`.
- **`npm run test:functions` dirties the root `deno.lock`.** Run `git checkout -- deno.lock` before every commit.
- **Before pushing:** `npm run lint`, `npm run format:check`, `npm run test`, `npm run test:functions`.

---

### Task 1: Create the Crisp plugin token and read the quota

**Files:**
- Modify: `docs/superpowers/specs/2026-08-03-crisp-customer-sync-design.md` (record the quota under "Open vendor questions")

**Interfaces:**
- Consumes: nothing.
- Produces: `CRISP_IDENTIFIER`, `CRISP_KEY`, `CRISP_IDENTITY_SECRET`, and the documented daily quota. Task 8's rollout throttle depends on the quota.

**This task needs Crisp dashboard access and is the only task that does.** If the token does not exist yet, skip to Task 2 and return before Task 8 — Tasks 2 through 7 need no live vendor.

- [ ] **Step 1: Create the plugin token with the correct scopes**

In the Crisp Marketplace, create a plugin for the Mesaas website with **exactly these two scopes**:

- `website:people:profiles` — "List and create CRM profiles"
- `website:people:data` — "List and push data in CRM profiles"

`website:people:manage` and `website:people:read` **do not exist**; a production token requested with them is rejected. Development tokens ignore scopes entirely, which is how a wrong scope list passes staging and fails in prod — so verify the two names against the scope picker, do not assume.

Note the identifier and key. In the same dashboard, enable **Identity Verification** for the website and note the signing secret (`CRISP_IDENTITY_SECRET`).

- [ ] **Step 2: Write the credentials to a file, never to a shell argument**

Secrets passed as literal CLI arguments land in shell history and process listings.

```bash
printf '%s' 'PASTE_IDENTIFIER:PASTE_KEY' > /tmp/crisp-probe-creds
chmod 600 /tmp/crisp-probe-creds
```

- [ ] **Step 3: Smoke-test the token against a real route**

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -u "$(cat /tmp/crisp-probe-creds)" \
  -H 'X-Crisp-Tier: plugin' \
  'https://api.crisp.chat/v1/website/bc54b5a7-dc07-46a9-8b6a-1c3ba9923314/people/profile/known%40example.com'
```

Use an email you know exists in Crisp (any address that has ever used the widget). Expect `200`, which also confirms email addressing works as the reference documents. A `401`/`403` means the scopes or the tier header are wrong — fix that before going further.

- [ ] **Step 4: Read the quota headers**

```bash
curl -s -D - -o /dev/null \
  -u "$(cat /tmp/crisp-probe-creds)" \
  -H 'X-Crisp-Tier: plugin' \
  'https://api.crisp.chat/v1/website/bc54b5a7-dc07-46a9-8b6a-1c3ba9923314/people/profiles/1'
```

Read any `X-RateLimit-*` / quota headers in the response and record the numbers. If no quota header is present, record that too — Task 6 then relies on the two-run check instead.

- [ ] **Step 5: Clean up the credentials file**

```bash
rm -f /tmp/crisp-probe-creds
```

- [ ] **Step 6: Record the quota in the spec and commit**

Replace open item 1 under "Open vendor questions" with the observed quota, keeping the surrounding reasoning.

```bash
git add docs/superpowers/specs/2026-08-03-crisp-customer-sync-design.md
git commit -m "docs: registra a quota diaria do plugin do Crisp"
```

---

### Task 2: Crisp REST client

**Files:**
- Create: `supabase/functions/_shared/crisp.ts`
- Test: `supabase/functions/__tests__/crisp-client_test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface CrispPerson { nickname?: string; phone?: string; [key: string]: unknown }`
  - `interface CrispProfileWrite { email: string; person: CrispPerson; segments: string[]; [key: string]: unknown }`
  - `interface CrispProfile { people_id: string; email?: string; segments?: string[]; person?: CrispPerson; [key: string]: unknown }`

  The index signatures are load-bearing, not laziness: `PUT` replaces the whole profile, so the caller must be able to spread back every field the `GET` returned — including fields this repo has never heard of. A closed type would make preserving them a compile error.
  - `getProfile(ref: string, fetchImpl?: typeof fetch): Promise<CrispProfile | null>`
  - `createProfile(p: CrispProfileWrite, fetchImpl?: typeof fetch): Promise<string | null>`
  - `saveProfile(peopleId: string, p: CrispProfileWrite, fetchImpl?: typeof fetch): Promise<void>`
  - `saveData(peopleId: string, data: Record<string, unknown>, fetchImpl?: typeof fetch): Promise<void>`
  - `deleteProfile(ref: string, fetchImpl?: typeof fetch): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/__tests__/crisp-client_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import {
  createProfile,
  deleteProfile,
  getProfile,
  saveData,
  saveProfile,
} from "../_shared/crisp.ts";

Deno.env.set("CRISP_IDENTIFIER", "test-id");
Deno.env.set("CRISP_KEY", "test-key");
Deno.env.set("CRISP_WEBSITE_ID", "ws-abc");

function stubFetch(
  status: number,
  body: unknown = { error: false, data: {} },
  capture?: { req?: Request },
) {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (capture) capture.req = new Request(input as string, init);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
}

Deno.test("getProfile sends plugin auth headers and returns data", async () => {
  const cap: { req?: Request } = {};
  const profile = await getProfile(
    "ana@example.com",
    stubFetch(200, { error: false, data: { people_id: "p-1", segments: ["vip"] } }, cap),
  );

  assertEquals(profile!.people_id, "p-1");
  assertEquals(profile!.segments, ["vip"]);
  assertEquals(cap.req!.headers.get("X-Crisp-Tier"), "plugin");
  assertEquals(cap.req!.headers.get("Authorization"), `Basic ${btoa("test-id:test-key")}`);
  assert(
    cap.req!.url.includes("/website/ws-abc/people/profile/"),
    `unexpected url: ${cap.req!.url}`,
  );
});

Deno.test("getProfile returns null on 404 instead of throwing", async () => {
  assertEquals(await getProfile("nobody@example.com", stubFetch(404)), null);
});

Deno.test("createProfile returns the new people_id", async () => {
  const id = await createProfile(
    { email: "a@b.com", person: { nickname: "Ana" }, segments: ["owner"] },
    stubFetch(201, { error: false, data: { people_id: "p-2" } }),
  );
  assertEquals(id, "p-2");
});

Deno.test("createProfile returns null on 409 so the caller can re-read", async () => {
  const id = await createProfile(
    { email: "a@b.com", person: {}, segments: [] },
    stubFetch(409, { error: true, reason: "people_exists" }),
  );
  assertEquals(id, null);
});

Deno.test("deleteProfile treats 404 as success (already absent)", async () => {
  await deleteProfile("gone@b.com", stubFetch(404));
});

Deno.test("saveData PATCHes the people/data route with a wrapped data object", async () => {
  const cap: { req?: Request } = {};
  await saveData("p-1", { plano: "Pro" }, stubFetch(200, { error: false, data: {} }, cap));

  assertEquals(cap.req!.method, "PATCH");
  assert(
    cap.req!.url.includes("/website/ws-abc/people/data/p-1"),
    `unexpected url: ${cap.req!.url}`,
  );
  assertEquals(await cap.req!.json(), { data: { plano: "Pro" } });
});

Deno.test("errors never leak the response body or the interpolated path", async () => {
  let message = "";
  try {
    await getProfile(
      "secret@customer.com",
      stubFetch(500, { error: true, reason: "secret@customer.com not allowed" }),
    );
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }

  assert(message.includes("500"), `expected the status in: ${message}`);
  assert(!message.includes("secret@customer.com"), `email leaked: ${message}`);
  assert(message.includes(":ref"), `expected the static route shape in: ${message}`);
});

Deno.test("missing credentials throw before any fetch is attempted", async () => {
  const saved = Deno.env.get("CRISP_KEY")!;
  Deno.env.delete("CRISP_KEY");
  let threw = false;
  try {
    await getProfile("a@b.com", () => {
      throw new Error("fetch must not be called");
    });
  } catch (e) {
    threw = (e as Error).message.includes("Crisp credentials not configured");
  } finally {
    Deno.env.set("CRISP_KEY", saved);
  }
  assert(threw, "expected a credentials error");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:functions -- --filter "getProfile"`
Expected: FAIL — `Module not found "../_shared/crisp.ts"`.

- [ ] **Step 3: Write the client**

Create `supabase/functions/_shared/crisp.ts`:

```ts
/**
 * Crisp REST client. Pure I/O: no candidate selection, no ledger writes.
 *
 * Every call is bounded by AbortSignal.timeout — the edge runtime kills isolates
 * on unbounded I/O in ways that bypass catch entirely (documented repo failure
 * mode), and a hang must surface as a normal retryable throw instead.
 *
 * Errors carry the HTTP status and a STATIC route shape. Not the response body
 * (Crisp echoes the person's email in error reasons) and not the interpolated
 * path (the people ref IS often an email). Both would land in cron_failures and
 * in the alert e-mail.
 */

const BASE = "https://api.crisp.chat/v1";

function credentials(): { authorization: string; websiteId: string } {
  const identifier = Deno.env.get("CRISP_IDENTIFIER");
  const key = Deno.env.get("CRISP_KEY");
  const websiteId = Deno.env.get("CRISP_WEBSITE_ID");
  if (!identifier || !key || !websiteId) {
    throw new Error("Crisp credentials not configured");
  }
  return {
    authorization: `Basic ${btoa(`${identifier}:${key}`)}`,
    websiteId,
  };
}

/**
 * The index signatures are deliberate. PUT replaces the WHOLE profile, so the
 * caller has to spread back every field the GET returned -- avatar, address,
 * description, employment, geolocation, and anything Crisp adds after this was
 * written. A closed type would turn preserving them into a compile error, and an
 * allowlist of fields to keep is unmaintainable against a vendor schema we do
 * not control.
 */
export interface CrispPerson {
  nickname?: string;
  phone?: string;
  [key: string]: unknown;
}

export interface CrispProfileWrite {
  email: string;
  person: CrispPerson;
  segments: string[];
  [key: string]: unknown;
}

export interface CrispProfile {
  people_id: string;
  email?: string;
  person?: CrispPerson;
  segments?: string[];
  [key: string]: unknown;
}

async function call(
  method: string,
  path: string,
  routeShape: string,
  body: unknown,
  okStatuses: number[],
  fetchImpl: typeof fetch,
): Promise<Response> {
  const { authorization, websiteId } = credentials();

  const res = await fetchImpl(`${BASE}/website/${websiteId}${path}`, {
    method,
    headers: {
      Authorization: authorization,
      "X-Crisp-Tier": "plugin",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (res.ok || okStatuses.includes(res.status)) return res;
  throw new Error(`Crisp ${method} ${routeShape} failed: ${res.status}`);
}

const PROFILE_SHAPE = "/people/profile/:ref";
const DATA_SHAPE = "/people/data/:ref";

/** Resolve a profile by Crisp people_id or by email. null when absent. */
export async function getProfile(
  ref: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CrispProfile | null> {
  const res = await call(
    "GET",
    `/people/profile/${encodeURIComponent(ref)}`,
    PROFILE_SHAPE,
    undefined,
    [404],
    fetchImpl,
  );
  if (res.status === 404) return null;
  const body = await res.json();
  return (body?.data ?? null) as CrispProfile | null;
}

/**
 * Create a profile. Returns the new people_id, or null when Crisp reports the
 * profile already exists — which is expected for anyone who has used the chat
 * widget, and is a signal to re-read, not a failure.
 */
export async function createProfile(
  p: CrispProfileWrite,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const res = await call("POST", "/people/profile", "/people/profile", p, [409], fetchImpl);
  if (res.status === 409) return null;
  const body = await res.json();
  return (body?.data?.people_id ?? null) as string | null;
}

/**
 * Replace the profile. PUT is a full replace, so the caller MUST echo back any
 * operator-owned field (notepad, company) it read and does not intend to erase.
 */
export async function saveProfile(
  peopleId: string,
  p: CrispProfileWrite,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await call(
    "PUT",
    `/people/profile/${encodeURIComponent(peopleId)}`,
    PROFILE_SHAPE,
    p,
    [],
    fetchImpl,
  );
}

/**
 * Merge custom data keys. PATCH, not PUT: PUT replaces the whole data object and
 * would erase keys written by an operator or another integration. Our key set is
 * fixed and always sent in full, so a merge cannot leave one of ours stale.
 */
export async function saveData(
  peopleId: string,
  data: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await call(
    "PATCH",
    `/people/data/${encodeURIComponent(peopleId)}`,
    DATA_SHAPE,
    { data },
    [],
    fetchImpl,
  );
}

/** 404 means "already absent", which IS the goal state. */
export async function deleteProfile(
  ref: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await call(
    "DELETE",
    `/people/profile/${encodeURIComponent(ref)}`,
    PROFILE_SHAPE,
    undefined,
    [404],
    fetchImpl,
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:functions`
Expected: PASS, all 8 new tests plus the existing suite.

- [ ] **Step 5: Commit**

```bash
git checkout -- deno.lock
git add supabase/functions/_shared/crisp.ts supabase/functions/__tests__/crisp-client_test.ts
git commit -m "feat(crisp): cliente REST com timeout e erros sem PII"
```

---

### Task 3: Ledger migration

**Files:**
- Create: `supabase/migrations/20260804000001_crisp_contacts.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: table `crisp_contacts (id uuid pk, user_id uuid null unique, synced_email text not null, synced_people_id text null, synced_fingerprint text null, synced_at timestamptz not null, deleted_at timestamptz null)`. Task 4's RPCs read and write it.

- [ ] **Step 1: Write the migration**

```sql
-- Vendor-identity ledger: which email address was actually synced to Crisp.
--
-- Crisp keys person profiles by email, so honouring an erasure, an email change
-- or an account deletion requires knowing the address that was sent. None of
-- that is derivable from live state after the fact.
--
-- on delete SET NULL, deliberately NOT cascade: when the account goes, this row
-- must SURVIVE carrying synced_email, because that is the only remaining handle
-- for deleting the profile at Crisp. A cascade would erase the evidence needed
-- to honour the erasure.
--
-- Hence the surrogate `id` primary key: user_id cannot be the PK, because SET
-- NULL on a primary key column is a constraint violation. A nullable UNIQUE
-- user_id gives the one-row-per-user guarantee AND survives the user's deletion.
--
-- synced_people_id is a CACHE, not a record of what was sent — synced_email is
-- that record. Its only job is to save an email-addressed lookup next sweep, so
-- losing it is harmless and the sweep always recovers by email.
--
-- Spec: docs/superpowers/specs/2026-08-03-crisp-customer-sync-design.md
create table if not exists crisp_contacts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid null unique references auth.users(id) on delete set null,
  synced_email       text not null,
  synced_people_id   text null,
  synced_fingerprint text null,
  synced_at          timestamptz not null default now(),
  deleted_at         timestamptz null
);

create index if not exists crisp_contacts_pending_delete
  on crisp_contacts (deleted_at) where deleted_at is null;

alter table crisp_contacts enable row level security;

drop policy if exists "crisp_contacts_service_role" on crisp_contacts;
create policy "crisp_contacts_service_role" on crisp_contacts
  for all to service_role using (true) with check (true);
```

- [ ] **Step 2: Confirm the version prefix does not collide**

```bash
git ls-tree origin/main:supabase/migrations | tail -3
```

Expected: `main`'s tail is below `20260804000001`. If not, renumber now — a shared prefix is silently skipped by Supabase and fails the `migration-version-guard` CI job.

**Do not run `npx supabase db push` from this worktree.** It is Supabase-unlinked and carries no `.env.staging`; a push from here either fails or, worse, targets the wrong project. Applying this migration and verifying the table shape are Task 8, Step 1a.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260804000001_crisp_contacts.sql
git commit -m "feat(crisp): tabela crisp_contacts (ledger de identidade no vendor)"
```

---

### Task 4: Candidate, deletion, record and confirm RPCs

**Files:**
- Create: `supabase/migrations/20260804000002_crisp_sync_rpcs.sql`

**Interfaces:**
- Consumes: `crisp_contacts` (Task 3), `default_plan_id()` (already exists, `20260803000004_loops_sync_rpcs.sql:19`).
- Produces, all consumed by Task 5's handler:
  - `get_crisp_sync_candidates()` returns `(user_id uuid, email text, nome text, phone text, papel text, plano text, assinatura text, plan_source text, workspaces text, workspace_count int, clientes int, cliente_desde text, primary_workspace_id uuid, segments text[], fingerprint text, people_id text)`
  - `get_crisp_contact_deletions()` returns `(id uuid, synced_email text, synced_people_id text)`
  - `record_crisp_contact(p_user_id uuid, p_email text) returns boolean`
  - `confirm_crisp_sync(p_user_id uuid, p_people_id text, p_fingerprint text) returns void`

- [ ] **Step 1: Write the migration**

```sql
-- RPCs for crisp-sync-cron.
-- Spec: docs/superpowers/specs/2026-08-03-crisp-customer-sync-design.md
--
-- Apply AFTER 20260804000001 (crisp_contacts) and BEFORE deploying the function.

-- ---------------------------------------------------------------------------
-- Write protocol, in two halves. Do NOT collapse them back into one call.
--
-- record_crisp_contact runs BEFORE the vendor write and records the EMAIL ONLY.
-- confirm_crisp_sync runs AFTER a confirmed vendor success and advances the
-- fingerprint + people_id.
--
-- An earlier draft wrote the fingerprint up front to save a round trip. That was
-- wrong: a transient failure on a user's FIRST sync would mark them synchronised
-- while no profile existed at Crisp at all, and get_crisp_sync_candidates would
-- then exclude them until their source data happened to change. Silent,
-- permanent, and worst for exactly the population this sync exists to cover.
-- ---------------------------------------------------------------------------
create or replace function record_crisp_contact(p_user_id uuid, p_email text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  -- Own lock namespace, not the loops_contact one: a collision would only
  -- serialise unrelated callers, but the prefix keeps the two independent.
  -- Transaction-scoped, so it releases on commit or crash.
  perform pg_advisory_xact_lock(hashtextextended('crisp_contact:' || p_user_id::text, 0));

  -- SEND-TIME RE-CHECK against the live row. The advisory lock is
  -- transaction-scoped, so it releases when this function commits -- BEFORE the
  -- vendor call. Between the candidate SELECT and that call the user can change
  -- their email, and the deletion sweep (this run or an overlapping one) can
  -- delete the old profile. Without this check the upsert then RECREATES the
  -- profile that was just erased, and the ledger no longer points at it, so
  -- nothing can ever erase it again.
  if not exists (
    select 1 from auth.users u
    where u.id = p_user_id
      and u.email::text = p_email
      and u.email_confirmed_at is not null
  ) then
    return false;
  end if;

  -- A deletion is still OWED at Crisp for a different address on this user's
  -- row. Overwriting synced_email now would strand that address at the vendor
  -- forever, because user_id is UNIQUE and the old value would be gone.
  if exists (
    select 1 from crisp_contacts cc
    where cc.user_id = p_user_id
      and cc.deleted_at is null
      and cc.synced_email is distinct from p_email
  ) then
    return false;
  end if;

  -- Deliberately does NOT touch synced_fingerprint or synced_people_id.
  insert into crisp_contacts (user_id, synced_email, synced_at, deleted_at)
  values (p_user_id, p_email, now(), null)
  on conflict (user_id) do update
    set synced_email = excluded.synced_email,
        synced_at    = excluded.synced_at,
        deleted_at   = null;

  return true;
end $$;

-- coalesce on people_id so a null argument never wipes a known cached id.
create or replace function confirm_crisp_sync(
  p_user_id uuid, p_people_id text, p_fingerprint text
)
returns void
language sql security definer set search_path = public as $$
  update crisp_contacts
     set synced_people_id   = coalesce(p_people_id, synced_people_id),
         synced_fingerprint = p_fingerprint,
         synced_at          = now()
   where user_id = p_user_id
     and deleted_at is null
$$;

-- ---------------------------------------------------------------------------
-- Profiles to remove at Crisp: the account was deleted (user_id nulled by the
-- FK) or the email changed (delete the OLD address).
--
-- No consent-revocation branch, unlike get_loops_contact_deletions: this sync
-- has no consent gate because it is support tooling, not marketing. If a
-- support_profile_opt_out flag is ever added it becomes a third `or` here.
-- ---------------------------------------------------------------------------
create or replace function get_crisp_contact_deletions()
returns table (id uuid, synced_email text, synced_people_id text)
language sql security definer set search_path = public as $$
  select cc.id, cc.synced_email, cc.synced_people_id
  from crisp_contacts cc
  left join auth.users u on u.id = cc.user_id
  where cc.deleted_at is null
    and (cc.user_id is null
         or u.email::text is distinct from cc.synced_email)
  order by cc.synced_at asc
  limit 50
$$;

-- ---------------------------------------------------------------------------
-- Candidates.
--
-- CANONICAL SERIALISATION IS LOad-BEARING. The fingerprint is only as good as
-- the determinism of the strings feeding it:
--   * every string_agg carries an explicit ORDER BY, or PostgreSQL may
--     serialise an UNCHANGED membership set differently between runs and
--     re-push everyone, burning the exact quota this exists to protect;
--   * every nullable is coalesce(x,'') before hashing, or one NULL turns the
--     whole concatenation into NULL and every such user hashes identically;
--   * fields are joined with a literal '|' in a fixed order, so a value
--     containing a comma cannot impersonate a field boundary;
--   * segments are sorted before joining.
--
-- cliente_desde is a DATE, not a day counter. A counter changes at every
-- midnight, so hashing it would re-push every user once a day forever, and
-- hashing around it would display a number that is silently wrong.
-- ---------------------------------------------------------------------------
create or replace function get_crisp_sync_candidates()
returns table (
  user_id              uuid,
  email                text,
  nome                 text,
  phone                text,
  papel                text,
  plano                text,
  assinatura           text,
  plan_source          text,
  workspaces           text,
  workspace_count      int,
  clientes             int,
  cliente_desde        text,
  primary_workspace_id uuid,
  segments             text[],
  fingerprint          text,
  people_id            text
)
language sql security definer set search_path = public as $$
  with membership as (
    select
      u.id                                    as user_id,
      u.email::text                           as email,
      -- Crisp REQUIRES a nickname on profile create and replace, and
      -- profiles.nome is NULLABLE (20260301_baseline_schema.sql:27). Without
      -- this fallback a confirmed user with no name 4xxs on every single sweep,
      -- forever. Same expression handle_new_user_workspace() uses at signup, so
      -- the two never disagree.
      coalesce(nullif(btrim(p.nome), ''), split_part(u.email::text, '@', 1)) as nome,
      -- WhatsApp preferred: matching an inbound WhatsApp is the channel gap
      -- this sync exists to close. btrim + nullif are REQUIRED, not cosmetic --
      -- PerfilTab.tsx writes the raw input straight to both columns, so a
      -- cleared field persists as '' and would otherwise be sent as an empty
      -- phone and hashed as a change.
      coalesce(nullif(btrim(p.whatsapp), ''), nullif(btrim(p.telefone), '')) as phone,
      u.email_confirmed_at                    as confirmed_at,
      wm.role                                 as role,
      wm.joined_at                            as joined_at,
      ws.id                                   as workspace_id,
      ws.name                                 as workspace_name,
      ws.is_internal                          as is_internal,
      ws.plan_source                          as plan_source,
      -- Mirrors resolveEntitlements (_shared/entitlements.ts): plan_id with a
      -- default-plan fallback, and NOTHING else. That is what the product
      -- enforces at every gate, so it is what support must be shown.
      coalesce(ws.plan_id, default_plan_id()) as plan_id,
      s.status                                as sub_status,
      (select count(*)::int from clientes c where c.conta_id = ws.id) as client_count
    from auth.users u
    join profiles p on p.id = u.id
    join workspace_members wm on wm.user_id = u.id
    join workspaces ws on ws.id = wm.workspace_id
    -- workspace_id is the PK of workspace_subscriptions (20260609120003), so
    -- this join cannot multiply rows.
    left join workspace_subscriptions s on s.workspace_id = ws.id
    where u.email is not null
      and u.email_confirmed_at is not null
  ),
  -- The person's PRIMARY workspace: oldest owned, falling back to oldest joined
  -- for members who own none. The workspace_id tiebreak makes the ordering
  -- total, so two runs cannot disagree and the fingerprint cannot oscillate.
  primary_ws as (
    select distinct on (m.user_id)
      m.user_id, m.workspace_id, m.plan_id, m.plan_source, m.sub_status
    from membership m
    order by m.user_id, (m.role = 'owner') desc, m.joined_at asc nulls last, m.workspace_id
  ),
  agg as (
    select
      m.user_id, m.email, m.nome, m.phone,
      max(m.confirmed_at) as confirmed_at,
      -- workspace_members.role, NOT profiles.role: profiles.role is a single
      -- value tied to conta_id (the workspace the account was created against).
      -- Someone who owns one workspace and is an agent in another reads as owner.
      case
        when bool_or(m.role = 'owner') then 'owner'
        when bool_or(m.role = 'admin') then 'admin'
        else 'agent'
      end as papel,
      string_agg(m.workspace_name, ', ' order by m.joined_at asc nulls last, m.workspace_id)
        as workspaces,
      count(*)::int as workspace_count,
      coalesce(sum(m.client_count), 0)::int as clientes,
      bool_and(m.is_internal) as all_internal,
      -- Segments are person-level: bool_or across ALL workspaces, not the
      -- primary one. Someone owning a paid and a free workspace genuinely
      -- carries both `pagante` and `free`, and hiding either would mislead.
      --
      -- 'pagante' follows MRR_STATUSES from _shared/billing-logic.ts exactly:
      -- {active, past_due}. past_due is IN-FORCE revenue that Stripe is
      -- retrying. The Loops predicate deliberately calls that free, because it
      -- answers "should we send a conversion campaign"; support needs the
      -- opposite answer, so the two must NOT be unified.
      bool_or(m.sub_status = 'trialing')                as any_trial,
      bool_or(m.sub_status in ('active', 'past_due'))   as any_paid,
      bool_or(m.sub_status = 'past_due')                as any_overdue,
      bool_or(
        m.plan_id = default_plan_id()
        and (m.sub_status is null
             or m.sub_status not in ('trialing', 'active', 'past_due'))
      ) as any_free
    from membership m
    group by m.user_id, m.email, m.nome, m.phone
  ),
  payload as (
    select
      a.user_id, a.email, a.nome, a.phone, a.papel,
      pl.name                               as plano,
      coalesce(pw.sub_status, 'nenhuma')    as assinatura,
      pw.plan_source                        as plan_source,
      a.workspaces, a.workspace_count, a.clientes,
      to_char(a.confirmed_at, 'YYYY-MM-DD') as cliente_desde,
      pw.workspace_id                       as primary_workspace_id,
      (
        select coalesce(array_agg(seg order by seg), array[]::text[])
        from unnest(
          array[case when a.papel = 'owner' then 'owner' else 'membro' end]
          || case when a.any_trial   then array['trial']        else array[]::text[] end
          || case when a.any_paid    then array['pagante']      else array[]::text[] end
          || case when a.any_overdue then array['inadimplente'] else array[]::text[] end
          || case when a.any_free    then array['free']         else array[]::text[] end
        ) as seg
      ) as segments
    from agg a
    join primary_ws pw on pw.user_id = a.user_id
    left join plans pl on pl.id = pw.plan_id
    -- Seed/demo workspaces. Per-USER aggregate, not per-row set membership:
    -- a user with at least one real workspace is still synced.
    where not a.all_internal
  ),
  fingerprinted as (
    select
      y.*,
      md5(
        coalesce(y.email, '')                      || '|' ||
        coalesce(y.nome, '')                       || '|' ||
        coalesce(y.phone, '')                      || '|' ||
        coalesce(y.papel, '')                      || '|' ||
        coalesce(y.plano, '')                      || '|' ||
        coalesce(y.assinatura, '')                 || '|' ||
        coalesce(y.plan_source, '')                || '|' ||
        coalesce(y.workspaces, '')                 || '|' ||
        y.workspace_count::text                    || '|' ||
        y.clientes::text                           || '|' ||
        coalesce(y.cliente_desde, '')              || '|' ||
        coalesce(y.primary_workspace_id::text, '') || '|' ||
        coalesce(array_to_string(y.segments, ','), '')
      ) as fingerprint
    from payload y
  )
  select
    f.user_id, f.email, f.nome, f.phone, f.papel, f.plano, f.assinatura,
    f.plan_source, f.workspaces, f.workspace_count, f.clientes, f.cliente_desde,
    f.primary_workspace_id, f.segments, f.fingerprint, cc.synced_people_id
  from fingerprinted f
  left join crisp_contacts cc on cc.user_id = f.user_id
  -- A deletion is OWED for this person's previous address. Written as a
  -- correlated `not exists` rather than folded into the left join above ON
  -- PURPOSE: `is distinct from` is two-valued and never yields NULL, so for a
  -- never-synced user the folded form evaluates to `not (TRUE and TRUE)` =
  -- FALSE and silently drops everyone with no ledger row -- which on first
  -- deployment is every single user.
  where not exists (
    select 1 from crisp_contacts cc2
    where cc2.user_id = f.user_id
      and cc2.deleted_at is null
      and cc2.synced_email is distinct from f.email
  )
    and cc.synced_fingerprint is distinct from f.fingerprint
  order by cc.synced_at asc nulls first, f.user_id
  limit 200
$$;

-- ---------------------------------------------------------------------------
-- Lock everything to the service role.
-- REVOKE FROM PUBLIC alone ALSO strips service_role on this instance (it has
-- bitten this repo before). Grant explicitly, and verify with proacl, not
-- has_function_privilege.
-- ---------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'record_crisp_contact(uuid,text)',
    'confirm_crisp_sync(uuid,text,text)',
    'get_crisp_contact_deletions()',
    'get_crisp_sync_candidates()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
```

- [ ] **Step 2: Desk-check the SQL against the plan's stated invariants**

This worktree is Supabase-unlinked, so the RPCs cannot be executed here. Applying them and running the four verification queries is **Task 8, Step 1a**. What you must confirm now, by reading:

1. Every `string_agg` and `array_agg` carries an explicit `ORDER BY`.
2. Every nullable feeding the `md5()` is wrapped in `coalesce(x, '')`, and the separator is a literal `|`.
3. The pending-deletion guard is a correlated `not exists`, **not** folded into the `cc` left join.
4. `record_crisp_contact` performs the live-email re-check **before** the ledger upsert, and does not write `synced_fingerprint` or `synced_people_id`.
5. The grant loop names all four functions with their exact argument-type signatures.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260804000002_crisp_sync_rpcs.sql
git commit -m "feat(crisp): RPCs de candidatos, delecao, record e confirm"
```

---

### Task 5: Sweep handler

**Files:**
- Create: `supabase/functions/crisp-sync-cron/handler.ts`
- Test: `supabase/functions/__tests__/crisp-sync-cron_test.ts`

**Interfaces:**
- Consumes: `CrispProfile`, `CrispProfileWrite`, `CrispPerson` from `_shared/crisp.ts` (Task 2); the RPC row shapes from Task 4.
- Produces:
  - `interface CrispCronDeps` (full shape in Step 3)
  - `runCrispSyncCron(deps: CrispCronDeps): Promise<{ upserted: number; deleted: number; failed: number }>`
  - `MANAGED_SEGMENTS: string[]`
  - `mergeSegments(existing: string[] | undefined, managed: string[]): string[]`
  - `buildPerson(row: CandidateRow): CrispPerson`
  - `buildData(row: CandidateRow, adminUrl: string | null): Record<string, unknown>`

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/__tests__/crisp-sync-cron_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import type { CrispProfile, CrispProfileWrite } from "../_shared/crisp.ts";
import {
  buildPerson,
  type CrispCronDeps,
  mergeSegments,
  runCrispSyncCron,
} from "../crisp-sync-cron/handler.ts";

const CANDIDATE = {
  user_id: "u-1",
  email: "ana@example.com",
  nome: "Ana Silva",
  phone: "+5511999998888",
  papel: "owner",
  plano: "Pro",
  assinatura: "active",
  plan_source: "stripe",
  workspaces: "Agência A",
  workspace_count: 1,
  clientes: 7,
  cliente_desde: "2026-01-15",
  primary_workspace_id: "ws-1",
  segments: ["owner", "pagante"],
  fingerprint: "fp-1",
  people_id: null,
};

function makeDeps(over: Partial<CrispCronDeps> = {}, rpcData: Record<string, unknown[]> = {}) {
  const calls = {
    recorded: [] as string[],
    confirmed: [] as Array<{ userId: string; peopleId: string | null; fingerprint: string }>,
    created: [] as CrispProfileWrite[],
    saved: [] as Array<{ peopleId: string; p: CrispProfileWrite }>,
    data: [] as Array<{ peopleId: string; data: Record<string, unknown> }>,
    deletedRefs: [] as string[],
    markedDeleted: [] as string[],
    reported: [] as unknown[],
  };

  const base: CrispCronDeps = {
    rpc: (name: string) => Promise.resolve({ data: rpcData[name] ?? [], error: null }),
    recordContact: (userId: string) => {
      calls.recorded.push(userId);
      return Promise.resolve(true);
    },
    confirmSync: (userId, peopleId, fingerprint) => {
      calls.confirmed.push({ userId, peopleId, fingerprint });
      return Promise.resolve(true);
    },
    markContactDeleted: (id: string) => {
      calls.markedDeleted.push(id);
      return Promise.resolve();
    },
    getProfile: () => Promise.resolve(null),
    createProfile: (p) => {
      calls.created.push(p);
      return Promise.resolve("p-new");
    },
    saveProfile: (peopleId, p) => {
      calls.saved.push({ peopleId, p });
      return Promise.resolve();
    },
    saveData: (peopleId, data) => {
      calls.data.push({ peopleId, data });
      return Promise.resolve();
    },
    deleteProfile: (ref: string) => {
      calls.deletedRefs.push(ref);
      return Promise.resolve();
    },
    adminUrlFor: (id) => (id ? `https://app.example.com/admin/workspaces/${id}` : null),
    report: (d) => {
      calls.reported.push(d);
      return Promise.resolve();
    },
  };

  return { deps: { ...base, ...over } as CrispCronDeps, calls };
}

Deno.test("mergeSegments drops stale managed tags and keeps operator tags", () => {
  assertEquals(
    mergeSegments(["pagante", "vip", "trial"], ["owner", "free"]),
    ["vip", "owner", "free"],
  );
});

Deno.test("buildPerson omits phone entirely when it is blank", () => {
  assertEquals(buildPerson({ ...CANDIDATE, phone: "   " }), { nickname: "Ana Silva" });
  assertEquals(buildPerson({ ...CANDIDATE, phone: null }), { nickname: "Ana Silva" });
});

Deno.test("buildPerson falls back to the email local-part when nome is blank", () => {
  // Crisp requires a nickname and profiles.nome is nullable, so a confirmed
  // user with no name must not produce a guaranteed 4xx.
  assertEquals(buildPerson({ ...CANDIDATE, nome: null, phone: null }), { nickname: "ana" });
  assertEquals(buildPerson({ ...CANDIDATE, nome: "  ", phone: null }), { nickname: "ana" });
});

Deno.test("deletions run before upserts and use people_id when known", async () => {
  const order: string[] = [];
  const { deps, calls } = makeDeps(
    {
      deleteProfile: (ref: string) => {
        order.push(`delete:${ref}`);
        return Promise.resolve();
      },
      createProfile: () => {
        order.push("create");
        return Promise.resolve("p-new");
      },
    },
    {
      get_crisp_contact_deletions: [
        { id: "cc-1", synced_email: "old@example.com", synced_people_id: "p-old" },
      ],
      get_crisp_sync_candidates: [CANDIDATE],
    },
  );

  const result = await runCrispSyncCron(deps);

  assertEquals(order, ["delete:p-old", "create"]);
  assertEquals(calls.markedDeleted, ["cc-1"]);
  assertEquals(result.deleted, 1);
  assertEquals(result.upserted, 1);
  assertEquals(result.failed, 0);
});

Deno.test("a failing deletion does not abort the upsert sweep", async () => {
  const { deps, calls } = makeDeps(
    { deleteProfile: () => Promise.reject(new Error("Crisp DELETE /people/profile/:ref failed: 503")) },
    {
      get_crisp_contact_deletions: [
        { id: "cc-1", synced_email: "old@example.com", synced_people_id: null },
      ],
      get_crisp_sync_candidates: [CANDIDATE],
    },
  );

  const result = await runCrispSyncCron(deps);

  assertEquals(result.deleted, 0);
  assertEquals(result.upserted, 1);
  assertEquals(result.failed, 1);
  assertEquals(calls.reported.length, 1);
});

Deno.test("recordContact refusal skips the person with no vendor call", async () => {
  const { deps, calls } = makeDeps(
    { recordContact: () => Promise.resolve(false) },
    { get_crisp_sync_candidates: [CANDIDATE] },
  );

  const result = await runCrispSyncCron(deps);

  assertEquals(calls.created.length, 0);
  assertEquals(calls.saved.length, 0);
  assertEquals(calls.confirmed.length, 0);
  assertEquals(result.upserted, 0);
  assertEquals(result.failed, 0);
});

Deno.test("a vendor failure never advances the fingerprint", async () => {
  const { deps, calls } = makeDeps(
    { createProfile: () => Promise.reject(new Error("Crisp POST /people/profile failed: 503")) },
    { get_crisp_sync_candidates: [CANDIDATE] },
  );

  const result = await runCrispSyncCron(deps);

  assertEquals(calls.confirmed, []);
  assertEquals(result.upserted, 0);
  assertEquals(result.failed, 1);
});

Deno.test("a create conflict re-reads and updates instead of failing", async () => {
  const existing: CrispProfile = {
    people_id: "p-widget",
    segments: ["vip", "trial"],
    notepad: "ligou em marco",
  };
  const { deps, calls } = makeDeps(
    {
      getProfile: (ref: string) =>
        Promise.resolve(ref === CANDIDATE.email ? existing : null),
      createProfile: () => Promise.resolve(null),
    },
    { get_crisp_sync_candidates: [CANDIDATE] },
  );

  const result = await runCrispSyncCron(deps);

  assertEquals(result.failed, 0);
  assertEquals(result.upserted, 1);
  assertEquals(calls.saved[0].peopleId, "p-widget");
  assertEquals(calls.confirmed[0].peopleId, "p-widget");
});

Deno.test("a PUT preserves every field the GET returned", async () => {
  // The regression test for the review finding: naming only notepad/company
  // erased everything else the vendor holds.
  const existing: CrispProfile = {
    people_id: "p-1",
    segments: ["vip", "trial", "free"],
    notepad: "cliente antigo",
    company: { name: "Agência A" },
    address: "Rua X, 123",
    description: "indicado pelo Joao",
    person: { nickname: "Antigo", avatar: "https://img.example/a.png" },
    // A field this repo has never heard of. It must survive anyway.
    some_future_crisp_field: { anything: true },
  };
  const { deps, calls } = makeDeps(
    { getProfile: () => Promise.resolve(existing) },
    { get_crisp_sync_candidates: [CANDIDATE] },
  );

  await runCrispSyncCron(deps);

  const written = calls.saved[0].p;
  assertEquals(written.notepad, "cliente antigo");
  assertEquals(written.company, { name: "Agência A" });
  assertEquals(written.address, "Rua X, 123");
  assertEquals(written.description, "indicado pelo Joao");
  assertEquals(written.some_future_crisp_field, { anything: true });
  // Nested preservation: the avatar survives, the nickname is overridden.
  assertEquals(written.person.avatar, "https://img.example/a.png");
  assertEquals(written.person.nickname, "Ana Silva");
  // people_id is the route parameter, not a body field.
  assert(!("people_id" in written), "people_id must not be echoed into the body");
  // `vip` kept (operator tag), `trial`/`free` dropped (stale managed tags),
  // `owner`/`pagante` added.
  assertEquals(written.segments, ["vip", "owner", "pagante"]);
});

Deno.test("data carries admin_url and the workspace context", async () => {
  const { deps, calls } = makeDeps({}, { get_crisp_sync_candidates: [CANDIDATE] });

  await runCrispSyncCron(deps);

  const data = calls.data[0].data;
  assertEquals(data.admin_url, "https://app.example.com/admin/workspaces/ws-1");
  assertEquals(data.plano, "Pro");
  assertEquals(data.assinatura, "active");
  assertEquals(data.clientes, 7);
  assertEquals(data.cliente_desde, "2026-01-15");
});

Deno.test("admin_url is omitted when APP_BASE_URL is unavailable", async () => {
  const { deps, calls } = makeDeps(
    { adminUrlFor: () => null },
    { get_crisp_sync_candidates: [CANDIDATE] },
  );

  await runCrispSyncCron(deps);

  assert(!("admin_url" in calls.data[0].data), "admin_url should be absent");
});

Deno.test("a confirm that matches no row deletes the profile it just wrote", async () => {
  // The mid-flight sweep race: the deletion sweep swept this person while our
  // vendor write was in flight, so the profile we just created is an orphan
  // that get_crisp_contact_deletions can never select. It must be deleted here
  // or the person's PII is stranded at the vendor permanently.
  const { deps, calls } = makeDeps(
    { confirmSync: () => Promise.resolve(false) },
    { get_crisp_sync_candidates: [CANDIDATE] },
  );

  const result = await runCrispSyncCron(deps);

  assertEquals(calls.deletedRefs, ["p-new"]);
  assertEquals(result.upserted, 0);
  assertEquals(result.failed, 1);
});

Deno.test("an empty candidate list performs zero vendor calls and succeeds", async () => {
  const { deps, calls } = makeDeps();

  const result = await runCrispSyncCron(deps);

  assertEquals(calls.created.length, 0);
  assertEquals(calls.saved.length, 0);
  assertEquals(calls.reported.length, 0);
  assertEquals(result, { upserted: 0, deleted: 0, failed: 0 });
});

Deno.test("an RPC error is reported and does not throw", async () => {
  const { deps, calls } = makeDeps({
    rpc: (name: string) =>
      name === "get_crisp_sync_candidates"
        ? Promise.resolve({ data: null, error: { message: "boom" } })
        : Promise.resolve({ data: [], error: null }),
  });

  const result = await runCrispSyncCron(deps);

  assertEquals(result.failed, 1);
  assertEquals(calls.reported.length, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:functions -- --filter "mergeSegments"`
Expected: FAIL — `Module not found "../crisp-sync-cron/handler.ts"`.

- [ ] **Step 3: Write the handler**

Create `supabase/functions/crisp-sync-cron/handler.ts`:

```ts
/**
 * Sweep logic for the Crisp customer sync, dependency-injected so tests can
 * drive it without a network.
 *
 * Per candidate:
 *   record_crisp_contact (email only, atomic, refuses when a deletion is owed)
 *   -> resolve identity (GET by people_id or email)
 *   -> create, or read-modify-write the existing profile
 *   -> PATCH custom data
 *   -> confirm_crisp_sync (people_id + fingerprint) ONLY on success
 *
 * Spec: docs/superpowers/specs/2026-08-03-crisp-customer-sync-design.md
 */

import type { CrispPerson, CrispProfile, CrispProfileWrite } from "../_shared/crisp.ts";

interface DbResult<T> {
  data: T | null;
  error: { message: string } | null;
}

export interface CandidateRow {
  user_id: string;
  email: string;
  nome: string | null;
  phone: string | null;
  papel: string;
  plano: string | null;
  assinatura: string;
  plan_source: string | null;
  workspaces: string | null;
  workspace_count: number;
  clientes: number;
  cliente_desde: string | null;
  primary_workspace_id: string | null;
  segments: string[];
  fingerprint: string;
  people_id: string | null;
}

interface DeletionRow {
  id: string;
  synced_email: string;
  synced_people_id: string | null;
}

export interface CrispCronDeps {
  rpc: (name: string) => Promise<DbResult<unknown>>;
  /** False means a deletion is still owed for a different address: skip entirely. */
  recordContact: (userId: string, email: string) => Promise<boolean>;
  /**
   * Returns FALSE when it matched no row: the deletion sweep swept this person
   * while our vendor call was in flight. The caller must then delete the
   * profile it just wrote. See the call site.
   */
  confirmSync: (
    userId: string,
    peopleId: string | null,
    fingerprint: string,
  ) => Promise<boolean>;
  markContactDeleted: (id: string) => Promise<void>;
  getProfile: (ref: string) => Promise<CrispProfile | null>;
  createProfile: (p: CrispProfileWrite) => Promise<string | null>;
  saveProfile: (peopleId: string, p: CrispProfileWrite) => Promise<void>;
  saveData: (peopleId: string, data: Record<string, unknown>) => Promise<void>;
  deleteProfile: (ref: string) => Promise<void>;
  adminUrlFor: (workspaceId: string | null) => string | null;
  report: (
    detail: { failed: number; errors: Array<{ accountId?: string; error?: string }> },
  ) => Promise<void>;
}

/**
 * The segments this sync owns. Anything outside this list was added by an
 * operator and must survive every write.
 */
export const MANAGED_SEGMENTS = [
  "owner",
  "membro",
  "trial",
  "pagante",
  "free",
  "inadimplente",
];

export function mergeSegments(
  existing: string[] | undefined,
  managed: string[],
): string[] {
  const vocab = new Set(MANAGED_SEGMENTS);
  const kept = (existing ?? []).filter((s) => !vocab.has(s));
  return Array.from(new Set([...kept, ...managed]));
}

export function buildPerson(row: CandidateRow): CrispPerson {
  // Crisp REQUIRES a nickname on create and on replace, and profiles.nome is
  // nullable (20260301_baseline_schema.sql:27). The RPC already applies this
  // fallback; repeated here so the handler cannot emit a 4xx-guaranteed body if
  // the two ever drift. Same expression handle_new_user_workspace() uses.
  const person: CrispPerson = {
    nickname: (row.nome ?? "").trim() || row.email.split("@")[0],
  };
  // The RPC already trims and NULLIFs. Repeated here because sending an empty
  // phone is worse than sending none: Crisp renders it as a real, blank contact
  // method. When we have no phone the field is OMITTED, which leaves any
  // operator-entered number on the profile intact.
  const phone = (row.phone ?? "").trim();
  if (phone) person.phone = phone;
  return person;
}

export function buildData(
  row: CandidateRow,
  adminUrl: string | null,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    plano: row.plano ?? "",
    assinatura: row.assinatura,
    plan_source: row.plan_source ?? "",
    papel: row.papel,
    workspaces: row.workspaces ?? "",
    workspace_count: row.workspace_count,
    clientes: row.clientes,
    cliente_desde: row.cliente_desde ?? "",
  };
  if (adminUrl) data.admin_url = adminUrl;
  return data;
}

export async function runCrispSyncCron(
  deps: CrispCronDeps,
): Promise<{ upserted: number; deleted: number; failed: number }> {
  let upserted = 0;
  let deleted = 0;
  const errors: Array<{ accountId?: string; error?: string }> = [];
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  // --- Deletions FIRST -------------------------------------------------------
  // These are erasure obligations. If the invocation runs out of wall clock the
  // upsert sweep is the right thing to lose: it self-heals next run, an
  // unhonoured erasure does not.
  const delRes = await deps.rpc("get_crisp_contact_deletions");
  if (delRes.error) {
    errors.push({ error: `contact deletions: ${delRes.error.message}` });
  } else {
    for (const d of (delRes.data ?? []) as DeletionRow[]) {
      try {
        await deps.deleteProfile(d.synced_people_id ?? d.synced_email);
        await deps.markContactDeleted(d.id);
        deleted++;
      } catch (e) {
        errors.push({ accountId: d.id, error: msg(e) });
      }
    }
  }

  // --- Upserts ---------------------------------------------------------------
  const candRes = await deps.rpc("get_crisp_sync_candidates");
  if (candRes.error) {
    errors.push({ error: `sync candidates: ${candRes.error.message}` });
  } else {
    for (const c of (candRes.data ?? []) as CandidateRow[]) {
      try {
        // RECORD BEFORE THE VENDOR CALL. The call CREATES the profile, so a
        // success followed by a failed ledger write leaves a person's name,
        // email and phone at a foreign vendor with nothing able to erase them.
        // A refusal means a deletion is owed for their previous address.
        if (!(await deps.recordContact(c.user_id, c.email))) continue;

        const person = buildPerson(c);
        const data = buildData(c, deps.adminUrlFor(c.primary_workspace_id));

        let profile = await deps.getProfile(c.people_id ?? c.email);
        let peopleId: string;

        if (profile) {
          peopleId = profile.people_id;
        } else {
          const created = await deps.createProfile({
            email: c.email,
            person,
            segments: c.segments,
          });
          if (created !== null) {
            peopleId = created;
          } else {
            // Conflict: a chat-widget session already created this person. This
            // is expected, not a failure. Re-read once and fall through.
            profile = await deps.getProfile(c.email);
            if (!profile) {
              throw new Error("Crisp create conflicted but the re-read found no profile");
            }
            peopleId = profile.people_id;
          }
        }

        // Only an EXISTING profile needs the preserve-and-override write. One we
        // just created already carries exactly what we sent.
        //
        // PUT REPLACES the whole profile, so everything the GET returned is
        // spread back and only the fields this sync owns are overridden.
        // Preserve-by-default, override-by-exception: an allowlist of fields to
        // keep (an earlier draft named just notepad and company) silently erases
        // avatar, address, description, employment, geolocation and anything
        // Crisp adds later.
        //
        // people_id is dropped from the body: it is the route parameter, not a
        // profile field.
        if (profile) {
          const { people_id: _peopleId, ...preserved } = profile;
          await deps.saveProfile(peopleId, {
            ...preserved,
            email: c.email,
            // Nested spread for the same reason as the outer one: person carries
            // operator-owned sub-fields (avatar, geolocation) that a flat
            // override would drop.
            person: { ...(profile.person ?? {}), ...person },
            segments: mergeSegments(profile.segments, c.segments),
          });
        }

        await deps.saveData(peopleId, data);

        // THE MID-FLIGHT SWEEP RACE. record_crisp_contact's advisory lock is
        // transaction-scoped and released long before this point, so between it
        // and here the user can change their email and an overlapping run's
        // deletion sweep can delete this profile and stamp deleted_at. Our write
        // above then RECREATED it, and confirm now matches no row.
        //
        // If we merely counted that as success, the profile would sit at the
        // vendor holding a name, an email and a phone, and
        // get_crisp_contact_deletions could never select it -- it filters on the
        // same deleted_at. Unerasable, which is the one outcome this ledger
        // exists to prevent. So delete what we just wrote, then surface it.
        if (!(await deps.confirmSync(c.user_id, peopleId, c.fingerprint))) {
          await deps.deleteProfile(peopleId);
          throw new Error("ledger row swept mid-sync; deleted the orphaned profile");
        }
        upserted++;
      } catch (e) {
        errors.push({ accountId: c.user_id, error: msg(e) });
      }
    }
  }

  if (errors.length > 0) {
    console.error(`[crisp-sync-cron] ${errors.length} failure(s)`, errors);
    await deps.report({ failed: errors.length, errors });
  }
  return { upserted, deleted, failed: errors.length };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:functions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -- deno.lock
git add supabase/functions/crisp-sync-cron/handler.ts supabase/functions/__tests__/crisp-sync-cron_test.ts
git commit -m "feat(crisp): handler do sweep com fingerprint pos-sucesso"
```

---

### Task 6: Function entrypoint, config, and the audit test

**Files:**
- Create: `supabase/functions/crisp-sync-cron/index.ts`
- Modify: `supabase/config.toml`
- Modify: `supabase/functions/__tests__/config-audit_test.ts`

**Interfaces:**
- Consumes: `runCrispSyncCron`, `CrispCronDeps` (Task 5); the client functions (Task 2); the RPCs (Task 4).
- Produces: a deployable `crisp-sync-cron` function. Task 7 schedules it.

- [ ] **Step 1: Add the failing config-audit entry**

In `supabase/functions/__tests__/config-audit_test.ts`, add `"crisp-sync-cron",` to the `REQUIRED_FUNCTIONS` array, in the `// Cron (x-cron-secret)` group immediately after `"invite-expire-cron",`.

- [ ] **Step 2: Run the audit test to verify it fails**

Run: `npm run test:functions -- --filter "config"`
Expected: FAIL — `crisp-sync-cron` is required but has no `verify_jwt = false` entry.

- [ ] **Step 3: Add the config.toml entry**

Append to `supabase/config.toml`:

```toml
[functions.crisp-sync-cron]
verify_jwt = false
```

The audit test reads the line immediately after the `[functions.x]` header, so `verify_jwt = false` must be the very next line with no blank line between them.

- [ ] **Step 4: Run the audit test to verify it passes**

Run: `npm run test:functions -- --filter "config"`
Expected: PASS.

- [ ] **Step 5: Write the entrypoint**

Create `supabase/functions/crisp-sync-cron/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { createJsonResponder } from "../_shared/http.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import {
  createProfile,
  deleteProfile,
  getProfile,
  saveData,
  saveProfile,
} from "../_shared/crisp.ts";
import { type CrispCronDeps, runCrispSyncCron } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => {
    throw new Error("CRON_SECRET is required");
  })();

// Validated HERE, at module load, not lazily inside the client. A missing
// secret would otherwise fail per-candidate only AFTER record_crisp_contact has
// already written the ledger row -- recording a sync that never reached the
// vendor. Failing the whole invocation keeps every candidate retryable once the
// secret is actually set.
for (const name of ["CRISP_WEBSITE_ID", "CRISP_IDENTIFIER", "CRISP_KEY"]) {
  if (!Deno.env.get(name)) throw new Error(`${name} is required`);
}

// APP_BASE_URL is deliberately NOT required: admin_url is a convenience field,
// and appBaseUrl() throws by design. A missing base must degrade to an omitted
// link, never to a dead cron.
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? null;

const CRON_NAME = "crisp-sync-cron";

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = buildCorsHeaders(req);
  const json = createJsonResponder(cors);

  if (!timingSafeEqual(req.headers.get("x-cron-secret") ?? "", CRON_SECRET)) {
    return json({ error: "Unauthorized" }, 401);
  }

  // Bounded global fetch: a stalled PostgREST call would otherwise hang until
  // the edge runtime kills the isolate, bypassing catch and cron-failure triage
  // entirely (documented repo failure mode).
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
    const deps: CrispCronDeps = {
      rpc: (name) =>
        svc.rpc(name) as unknown as Promise<
          { data: unknown; error: { message: string } | null }
        >,
      recordContact: async (userId, email) => {
        const { data, error } = await svc.rpc("record_crisp_contact", {
          p_user_id: userId,
          p_email: email,
        });
        if (error) throw new Error(`contact record failed: ${error.message}`);
        return data === true;
      },
      // Returns false when the RPC matched no row, i.e. the deletion sweep
      // swept this person while our vendor call was in flight. The handler
      // deletes the orphaned profile on false; do NOT collapse this to void.
      confirmSync: async (userId, peopleId, fingerprint) => {
        const { data, error } = await svc.rpc("confirm_crisp_sync", {
          p_user_id: userId,
          p_people_id: peopleId,
          p_fingerprint: fingerprint,
        });
        if (error) throw new Error(`sync confirm failed: ${error.message}`);
        return data === true;
      },
      markContactDeleted: async (id) => {
        // synced_people_id is nulled in the SAME update. On an email change the
        // ledger row is reused by the next upsert, and a retained id would
        // address the profile that was just deleted.
        const { error } = await svc
          .from("crisp_contacts")
          .update({ deleted_at: new Date().toISOString(), synced_people_id: null })
          .eq("id", id);
        if (error) throw new Error(`contact delete record failed: ${error.message}`);
      },
      getProfile,
      createProfile,
      saveProfile,
      saveData,
      deleteProfile,
      adminUrlFor: (workspaceId) =>
        APP_BASE_URL && workspaceId
          ? `${APP_BASE_URL.replace(/\/+$/, "")}/admin/workspaces/${workspaceId}`
          : null,
      report: (detail) => reportCronFailure(svc, CRON_NAME, detail),
    };

    const result = await runCrispSyncCron(deps);
    return json({ success: true, ...result });
  } catch (e) {
    console.error(`[${CRON_NAME}] run failed:`, e instanceof Error ? e.message : String(e));
    await reportCronFailure(svc, CRON_NAME, {
      failed: 1,
      errors: [{ error: e instanceof Error ? e.message : String(e) }],
    });
    return json({ error: "Cron run failed" }, 500);
  }
});
```

- [ ] **Step 6: Document the three new secrets**

An external review caught this as a real gap: a deployment following the repo's documented secret template would leave these unset and every Crisp call would fail before reaching the network.

In `.env.example`, under the existing `# Edge function secrets — set via 'npx supabase secrets set', NOT loaded from this file.` block — the one that already lists `LOOPS_API_KEY` and `POSTHOG_PROJECT_KEY` — append:

```
# Crisp support-chat customer sync (crisp-sync-cron)
# Plugin token from the Crisp Marketplace. Scopes: website:people:profiles + website:people:data
CRISP_WEBSITE_ID=
CRISP_IDENTIFIER=
CRISP_KEY=
```

In `CLAUDE.md`, in the `### Edge functions (Deno.env)` list, after the `LOOPS_API_KEY` entry, add:

```
- `CRISP_WEBSITE_ID`, `CRISP_IDENTIFIER`, `CRISP_KEY` -- Crisp plugin token for the
  support-chat customer sync (crisp-sync-cron). All three REQUIRED by that function,
  no defaults -- index.ts throws at module load if any is missing. Plugin scopes are
  `website:people:profiles` and `website:people:data`
```

- [ ] **Step 7: Run the full verification set**

```bash
npm run test:functions
```

Expected: PASS.

```bash
npm run lint && npm run format:check
```

Expected: both clean. Run `npm run format` if the check fails.

- [ ] **Step 8: Commit**

```bash
git checkout -- deno.lock
git add supabase/functions/crisp-sync-cron/index.ts supabase/config.toml supabase/functions/__tests__/config-audit_test.ts .env.example CLAUDE.md
git commit -m "feat(crisp): entrypoint do cron, config.toml e audit test"
```

---

### Task 7: Crisp Identity Verification

**Files:**
- Create: `supabase/functions/crisp-identity/index.ts`
- Modify: `apps/crm/src/context/AuthContext.tsx:271-287`
- Test: `supabase/functions/__tests__/crisp-identity_test.ts`

**Interfaces:**
- Consumes: `CRISP_IDENTITY_SECRET` (Task 1).
- Produces: `POST /functions/v1/crisp-identity` returning `{ signature: string }` — the HMAC-SHA256 of the authenticated caller's own email, hex-encoded.

**Why this is in scope.** The enrichment shipped by Tasks 2 through 6 is exactly what makes an unsigned `user:email` push dangerous: after it, claiming a customer's email shows the agent their plan, workspace names, client count and an admin deep link. Read "The frontend does change" in the spec before starting.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/crisp-identity_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import { signEmail } from "../crisp-identity/index.ts";

Deno.test("signEmail matches a known-answer HMAC-SHA256 vector", async () => {
  // Independently reproducible:
  //   printf 'ana@example.com' | openssl dgst -sha256 -hmac 'test-secret' -hex
  const sig = await signEmail("ana@example.com", "test-secret");
  assertEquals(sig.length, 64);
  assert(/^[0-9a-f]+$/.test(sig), `expected lowercase hex, got ${sig}`);
});

Deno.test("signEmail is deterministic and email-specific", async () => {
  const a = await signEmail("ana@example.com", "s");
  const b = await signEmail("ana@example.com", "s");
  const c = await signEmail("bruno@example.com", "s");
  assertEquals(a, b);
  assert(a !== c, "different emails must not share a signature");
});
```

Replace the vector assertion with the literal digest once you have run the `openssl` line above.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:functions -- --filter "signEmail"`
Expected: FAIL — `Module not found "../crisp-identity/index.ts"`.

- [ ] **Step 3: Write the endpoint**

Create `supabase/functions/crisp-identity/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createJsonResponder } from "../_shared/http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRISP_IDENTITY_SECRET = Deno.env.get("CRISP_IDENTITY_SECRET") ??
  (() => {
    throw new Error("CRISP_IDENTITY_SECRET is required");
  })();

/** HMAC-SHA256(email) under the Crisp identity secret, lowercase hex. */
export async function signEmail(email: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(email));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = buildCorsHeaders(req);
  const json = createJsonResponder(cors);

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Unauthorized" }, 401);

  // Service-role client + getUser(token). NOT an anon client: this project's
  // tokens are ES256 and an anon client cannot verify them.
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await svc.auth.getUser(token);
  if (error || !data.user?.email) return json({ error: "Unauthorized" }, 401);

  // THE EMAIL COMES FROM THE VERIFIED TOKEN, NEVER FROM THE REQUEST BODY.
  // Signing a caller-supplied address would turn this endpoint into an oracle
  // that mints a valid "verified" badge for any customer on demand -- strictly
  // worse than having no identity verification at all, because the badge would
  // then be actively misleading.
  const signature = await signEmail(data.user.email, CRISP_IDENTITY_SECRET);
  return json({ signature });
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:functions`
Expected: PASS.

- [ ] **Step 5: Wire the frontend**

In `apps/crm/src/context/AuthContext.tsx`, replace the body of the Crisp identification effect (currently at lines 271-287) with:

```tsx
  useEffect(() => {
    if (!userId) return;
    let active = true;

    (async () => {
      if (!user?.email) return;
      let signature: string | undefined;
      try {
        const { data } = await supabase.functions.invoke('crisp-identity');
        signature = (data as { signature?: string } | null)?.signature;
      } catch {
        // Signing is best-effort. A failure means the session shows as
        // Unverified in the inbox, which is the pre-existing behaviour and is
        // strictly better than blocking support access entirely.
      }
      if (!active) return;

      try {
        // Second element is the identity signature. Crisp marks the session
        // Verified only when it validates; unsigned sessions still work.
        window.$crisp?.push(
          signature
            ? ['set', 'user:email', [user.email, signature]]
            : ['set', 'user:email', [user.email]],
        );
      } catch {
        // Never let a support-tooling nicety break auth.
      }
    })();

    return () => {
      active = false;
    };
  }, [userId, user?.email]);

  useEffect(() => {
    if (!userId) return;
    if (profile?.nome) {
      try {
        window.$crisp?.push(['set', 'user:nickname', [profile.nome]]);
      } catch {
        // Never let a support-tooling nicety break auth.
      }
    }
  }, [userId, profile?.nome]);
```

The nickname push is split into its own effect because the email effect is now async: keeping them together would re-issue the signing request on every name change.

- [ ] **Step 6: Add the config entry and deploy**

`crisp-identity` verifies its own JWT via `getUser`, so it needs the same treatment as the other token-auth functions. Add to `supabase/config.toml`:

```toml
[functions.crisp-identity]
verify_jwt = false
```

and add `"crisp-identity",` to `REQUIRED_FUNCTIONS` in `config-audit_test.ts`, in the `// Token/internal auth` group.

- [ ] **Step 7: Verify in the browser**

Start the CRM against staging, sign in, open the chatbox, and confirm in the Crisp inbox that the session shows as **Verified**. Then check the network tab: `crisp-identity` returns 200 with a 64-character hex signature.

```bash
npm run dev:staging
```

Worktrees do not carry `.env.staging` — copy it in first or this command silently hits **prod**.

- [ ] **Step 8: Full verification and commit**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run test && npm run test:functions && npm run lint && npm run format:check
git checkout -- deno.lock
git add supabase/functions/crisp-identity apps/crm/src/context/AuthContext.tsx supabase/config.toml supabase/functions/__tests__/
git commit -m "feat(crisp): identity verification assinada no chatbox"
```

---

### Task 8: Deploy, verify against the live vendor, then schedule

**Files:**
- Create: `supabase/migrations/20260804000003_schedule_crisp_sync_cron.sql`

**Interfaces:**
- Consumes: everything above.
- Produces: a running cron.

**Do not apply the schedule migration before the manual verification in Step 4 passes.** The schedule fires immediately on apply.

- [ ] **Step 1: Set the secrets on staging**

```bash
cat supabase/.temp/project-ref
```

Confirm staging (`wlyzhyfondykzpsiqsce`). Then set the three secrets from a file, never as literal CLI arguments:

```bash
npx supabase secrets set --env-file ./crisp-secrets.env
```

where `crisp-secrets.env` contains `CRISP_WEBSITE_ID=`, `CRISP_IDENTIFIER=`, `CRISP_KEY=`. Delete the file afterwards with `rm -f ./crisp-secrets.env`. Confirm it is not tracked: it must never be committed.

- [ ] **Step 1a: Apply the migrations and run the deferred DB verification**

Tasks 3 and 4 wrote the migrations but could not execute them: the implementation worktree is Supabase-unlinked and carries no `.env.staging`. All live-DB verification lands here.

```bash
cat supabase/.temp/project-ref
```

Confirm staging (`wlyzhyfondykzpsiqsce`), not prod (`skjzpekeqefvlojenfsw`). The link state flips; check it, do not assume. Then:

```bash
npx supabase db push --linked
```

Then the four checks deferred from Tasks 3 and 4:

```bash
npx supabase db query "select column_name, data_type, is_nullable from information_schema.columns where table_name = 'crisp_contacts' order by ordinal_position"
```
Expected: seven rows, `user_id` nullable, `synced_email` not nullable.

```bash
npx supabase db query "select count(*) as candidates, count(distinct fingerprint) as distinct_fingerprints from get_crisp_sync_candidates()"
```
Expected: `candidates` > 0, and `distinct_fingerprints` equal to it. Two users sharing a hash is the NULL-concatenation bug.

```bash
npx supabase db query "select count(*) as drifted from (select user_id, fingerprint from get_crisp_sync_candidates() intersect select user_id, fingerprint from get_crisp_sync_candidates()) s right join (select user_id from get_crisp_sync_candidates()) t using (user_id) where s.fingerprint is null"
```
Expected: `drifted = 0`. Non-zero means an aggregate is missing its `ORDER BY`.

```bash
npx supabase db query "select proname, proacl from pg_proc where proname in ('record_crisp_contact','confirm_crisp_sync','get_crisp_contact_deletions','get_crisp_sync_candidates')"
```
Expected: every `proacl` contains `service_role=X`. An empty one means the `REVOKE` stripped it — re-run the grant loop.

- [ ] **Step 2: Deploy the function**

```bash
npx supabase functions deploy crisp-sync-cron --use-api --no-verify-jwt
```

`--use-api` because the local Docker bundler is broken in this repo. `--no-verify-jwt` because the function authenticates with `x-cron-secret`.

- [ ] **Step 3: Invoke once by hand and read the counts**

```bash
curl -s -X POST \
  -H "x-cron-secret: $(npx supabase secrets list --output json | python3 -c 'import sys,json; print([s for s in json.load(sys.stdin) if s["name"]=="CRON_SECRET"][0]["value"])')" \
  'https://wlyzhyfondykzpsiqsce.supabase.co/functions/v1/crisp-sync-cron'
```

If the secret is not readable that way, read it from the Supabase dashboard and export it to a shell variable first. Expected: `{"success":true,"upserted":N,"deleted":0,"failed":0}` with `N > 0`.

- [ ] **Step 4: Invoke a SECOND time and assert `upserted` is zero**

```bash
curl -s -X POST -H "x-cron-secret: $CRON_SECRET" \
  'https://wlyzhyfondykzpsiqsce.supabase.co/functions/v1/crisp-sync-cron'
```

Expected: `{"success":true,"upserted":0,"deleted":0,"failed":0}`.

**This is the gate.** A non-zero `upserted` means the fingerprint is not stable and the whole quota argument fails. Do not proceed. Diagnose with:

```bash
npx supabase db query "select user_id, fingerprint from get_crisp_sync_candidates() limit 5"
```

and compare against `select user_id, synced_fingerprint from crisp_contacts limit 5`. A mismatch on an unchanged user points at a missing `ORDER BY` in an aggregate or a bare nullable in the `md5()` concatenation.

- [ ] **Step 5: Spot-check a real profile in the Crisp inbox**

Open the Crisp inbox, find a person synced in Step 3, and confirm: nickname, phone, segments, and the `plano` / `clientes` / `admin_url` custom data are present and correct. Confirm no operator-authored notepad, avatar or address was erased.

- [ ] **Step 6: Verify the WhatsApp claim end to end, or record that it failed**

The spec does **not** assume that populating `person.phone` makes an inbound WhatsApp resolve to the profile. Prove it or withdraw it.

From a phone whose number is on a synced person's profile, send a WhatsApp message to the Crisp-connected business number. In the inbox, confirm the conversation attaches to that person's existing profile rather than opening an unlinked one.

Record the result in the spec under "Open vendor questions", item 2. If it does **not** attach, that is not a blocker for this work — email and widget identification still ship — but say so plainly rather than reporting WhatsApp coverage as delivered.

- [ ] **Step 7: Write the schedule migration**

```sql
-- Schedule crisp-sync-cron every 15 minutes.
-- Spec: docs/superpowers/specs/2026-08-03-crisp-customer-sync-design.md
--
-- Apply ONLY AFTER the crisp-sync-cron function is deployed AND 20260804000002
-- is applied: the schedule fires immediately.
--
-- Rollback order is the REVERSE: SELECT cron.unschedule('crisp-sync-cron')
-- first, then undeploy. KEEP the crisp_contacts rows -- they are the record of
-- what was pushed to a foreign vendor, and deleting them destroys the only
-- handle for erasing those profiles later.
--
-- Uses the vault.decrypted_secrets subselect form, NOT vault.decrypted_secret(...)
-- (that function form does not exist on this instance).
--
-- Idempotent: safe to apply twice.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crisp-sync-cron') THEN
    PERFORM cron.unschedule('crisp-sync-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'crisp-sync-cron',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/crisp-sync-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

- [ ] **Step 8: Apply the schedule and confirm the job exists**

```bash
npx supabase db push --linked
npx supabase db query "select jobname, schedule, active from cron.job where jobname = 'crisp-sync-cron'"
```

Expected: one row, `active = t`.

- [ ] **Step 9: Wait one cycle and confirm a clean tick**

After 15 minutes:

```bash
npx supabase db query "select status, return_message, start_time from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'crisp-sync-cron') order by start_time desc limit 3"
```

Expected: `status = succeeded`. **A `succeeded` here only means the HTTP POST was dispatched, not that the sync worked** — this repo has been burned by exactly that assumption. Also check:

```bash
npx supabase db query "select cron_name, detail, created_at from cron_failures where cron_name = 'crisp-sync-cron' order by created_at desc limit 5"
```

Expected: no rows.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/20260804000003_schedule_crisp_sync_cron.sql
git commit -m "feat(crisp): agenda o crisp-sync-cron a cada 15 minutos"
```

- [ ] **Step 11: Re-verify migration numbering, then open the PR**

```bash
git ls-tree origin/main:supabase/migrations | tail -5
```

If `main`'s tail is at or above `20260804000001`, renumber all three migrations above it and re-run `npm run test:functions`. This repo has been hit by a version collision twice; the check is cheap and the failure is silent.

```bash
npm run lint && npm run format:check && npm run test && npm run test:functions
git checkout -- deno.lock
```

Then open the PR. Prod deployment (secrets, `db push`, function deploy, schedule) repeats Steps 1 through 8 against the prod ref after merge.

---

## Self-review

**Spec coverage:** every spec section maps to a task. Architecture table → Tasks 2, 5, 6, 7 and the three migrations in 3, 4, 8. Write protocol → Task 4 (RPCs, including the send-time email re-check) and Task 5 (call order + the "vendor failure never advances the fingerprint" test). Identity resolution → Task 5's create/conflict/re-read branch. Payload + canonical serialisation → Task 4's SQL. Profile-vs-data split → Task 2's `saveData` PATCH and Task 5's separate call. Segments read-modify-write → `mergeSegments` plus the preserve-every-field test. Identity Verification → Task 7. Exclusions → `not a.all_internal` and the confirmed-email predicate. Sweeps ordering → Task 5's deletions-first block. Rollout, including the WhatsApp proof → Task 8.

All fourteen spec tests appear: 1–9 in Task 5, 10 in Task 2, 11 in Task 6, 12–13 in Task 5, 14 in Task 7.

**Type consistency:** `CandidateRow` field names match the RPC's `returns table` columns one-for-one (`phone`, not `telefone`; `primary_workspace_id`, not `admin_workspace_id`). `confirmSync(userId, peopleId, fingerprint)` matches `confirm_crisp_sync(p_user_id, p_people_id, p_fingerprint)`. `recordContact(userId, email)` matches `record_crisp_contact(p_user_id, p_email)` — two arguments, no fingerprint, which is the point of the round-1 review fix. `CrispProfile` and `CrispProfileWrite` carry index signatures (Task 2) so Task 5's preserve-by-default spread typechecks.

**Known soft spots, stated rather than hidden:**

1. Task 8 Step 3's shell incantation for reading `CRON_SECRET` may not work depending on CLI version; the step says to fall back to the dashboard rather than pretending one command always works.
2. Task 7 Step 1's known-answer HMAC vector is left to be filled from the `openssl` line rather than guessed. A wrong literal in a plan is worse than an explicit instruction to compute it.
3. Task 7 rewrites an effect in `AuthContext.tsx` at lines that will have shifted if anything else lands there first. Locate the effect by its comment ("Crisp identification, split out from the profile-hydration effect"), not by line number.
