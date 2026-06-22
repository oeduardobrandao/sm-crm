# MCP OAuth 2.1 — claude.ai web connector (scope)

**Status:** scope for review — not yet built
**Depends on:** PR 1 (merged, #130). Lands **after PR 2** (CRM key UI + admin panel).
**Date:** 2026-06-22

## Goal

Let users connect the Mesaas MCP server to **claude.ai web** (and any OAuth-only MCP client) by
pasting a single connector URL — no token handling. claude.ai's custom connectors are
**OAuth-only** (no static-bearer / custom-header field — [anthropics/claude-ai-mcp #112]), so the
server must speak the MCP authorization spec.

Architecture: **Supabase = OAuth 2.1 Authorization Server**, our edge function = **Resource
Server**, **existing Mesaas accounts = identity**. No third-party IdP, no hand-rolled token issuer.
The PR 1 tools are unchanged — this only adds a second way to obtain the request `ctx`
(workspace + scopes). Static `mesaas_sk_…` keys stay for Claude Code / API / headless agents.

## Locked decisions (2026-06-22)
1. **Discovery hosting** — the MCP function serves its **own** Protected Resource Metadata at a
   sub-path and advertises it via the `401 WWW-Authenticate` header (no new infra). Validate
   against claude.ai; a branded custom domain is a later nicety.
2. **Workspace binding** — the user **picks the workspace at consent**; the grant (and therefore
   the token) is bound to that `conta_id` + scopes. Stable regardless of CRM workspace switching.
3. **Sequencing** — ships **after PR 2**, reusing PR 2's scope picker + workspace-binding logic.

---

## The flow

```
claude.ai ──(1) POST /mcp, no token──▶  401 + WWW-Authenticate: Bearer
                                          resource_metadata="https://…/functions/v1/mcp/.well-known/oauth-protected-resource"
claude.ai ──(2) GET that metadata────▶  { resource, authorization_servers: [ "https://<ref>.supabase.co/auth/v1" ] }
claude.ai ──(3) GET AS metadata──────▶  Supabase: …/.well-known/oauth-authorization-server/auth/v1
claude.ai ──(4) DCR register─────────▶  Supabase issues a client_id
claude.ai ──(5) authorize + PKCE─────▶  Supabase → redirects to OUR consent page
   user logs into Mesaas, picks workspace + scopes, approves  ──▶  we record a grant row
claude.ai ──(6) code → token─────────▶  Supabase issues an access token (JWT, sub = user)
claude.ai ──(7) POST /mcp + Bearer───▶  we validate JWT → user → grant → conta_id + scopes → tools
```

## What Supabase provides (so we don't build it)
A complete OAuth 2.1 AS at `/auth/v1`: **dynamic client registration** (optional — must be
enabled), authorize/token endpoints, **PKCE**, refresh-token rotation, and AS discovery at
`https://<ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1`. Auth codes expire in
10 min. ([Supabase OAuth server], [Supabase MCP auth])

## What we build

### 1. Protected Resource Metadata + 401 (RFC 9728)
- The `mcp` function gains a GET route at `…/functions/v1/mcp/.well-known/oauth-protected-resource`
  returning:
  ```jsonc
  {
    "resource": "https://<ref>.supabase.co/functions/v1/mcp",
    "authorization_servers": ["https://<ref>.supabase.co/auth/v1"],
    "scopes_supported": ["clientes:read","posts:read","workflows:read","ideias:read", …],
    "bearer_methods_supported": ["header"]
  }
  ```
- When a request arrives without a valid token, respond `401` with
  `WWW-Authenticate: Bearer resource_metadata="<ABSOLUTE url>", scope="clientes:read posts:read …"`.
  (Today the function returns a bare 401 — we add the header + metadata route.)
- **Spike 1 RESOLVED (✅):** spec confirms clients MUST use the `WWW-Authenticate` `resource_metadata`
  pointer when present, and metadata MAY live at a sub-path of the MCP endpoint — so function-subpath
  works, no custom domain needed. Hard requirements that fell out:
  - `resource_metadata` **MUST be an absolute URL** (relative breaks Claude — claude-code #46539).
  - Include `scope=` in the challenge (spec SHOULD).
  - Implement **RFC 8707**: accept the `resource` param and **validate token audience** (MUST) — see
    residual risk #2 below re: Supabase `aud` support.
  - Residual: claude.ai *web* has discovery flakiness (claude-ai-mcp #217, #34335) — verify
    empirically once deployed; custom domain remains the fallback.

### 2. Dual auth resolver (extend `_shared/mcp-token.ts`)
`resolveCtx(db, authHeader)` → `McpKeyContext`:
- Bearer starts with `mesaas_sk_` → existing `resolveMcpKey` (unchanged).
- Otherwise treat as a **Supabase access token (JWT)**:
  - Validate with a **service-role client + `auth.getUser(token)`** (per our edge-token gotcha —
    never the anon client; see [[feedback_edge_function_user_token_verification]]). Optionally
    verify via **JWKS** + `aud`/`iss`/`exp` for a stateless check.
  - Extract `sub` (user) and `client_id`/`azp` (the registered claude.ai client).
  - Look up the **grant** for `(user_id, client_id)` → `conta_id` + `scopes` (table below).
  - Return the same `ctx` shape the tools already consume — **tools don't change.**

### 3. Consent page (the "authorization endpoint" Supabase delegates to)
A Mesaas page (CRM, reuses PR 2's scope picker) that Supabase redirects to during `authorize`:
- User authenticates (existing Supabase Auth session).
- Shows "**Claude** quer acessar **workspace X** com permissões **Y**" — a **workspace selector**
  (their memberships) + scope checkboxes (default read-only).
- On approve → write a **grant row** and call Supabase to mint the code.
- **Spike 2 RESOLVED (✅):** concrete contract —
  - Configure an **Authorization Path** in Supabase (e.g. `/oauth/consent`); Site URL + path = our
    page. Supabase redirects there with an `authorization_id`.
  - `supabase.auth.oauth.getAuthorizationDetails(authorization_id)` → client + requested scopes.
  - On decision: `supabase.auth.oauth.approveAuthorization(authorization_id)` /
    `denyAuthorization(authorization_id)` — Supabase generates the code internally.
  - Issued token is a Supabase JWT with `user_id` + `client_id` → grant lookup by
    `(user_id, client_id)` (matches §4's table).

### 4. Grant storage
The Supabase JWT carries the *user*, not the workspace/scopes — so persist the consent binding:
```sql
create table mcp_oauth_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  client_id   text not null,                -- the DCR-registered claude.ai client
  conta_id    uuid not null references workspaces(id) on delete cascade,
  scopes      text[] not null default '{}',
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, client_id)
);
```
Reuses the per-table scoping, audit, and scope-gating from PR 1; revocation mirrors `mcp_api_keys`.

### 5. Enable + configure Supabase OAuth server
Turn on the OAuth 2.1 server + **DCR** in project settings; map our domain scopes into the consent.
Gate behind `feature_mcp` like the rest.

---

## Security considerations
- **DCR is open registration** — "any MCP client can register" ([Supabase MCP auth]). Mitigate
  with the mandatory consent step + per-grant workspace/scope binding + audit + revocation.
- **Audience binding** — validate the token's audience/resource is our MCP server; reject tokens
  minted for other resources.
- **Scope enforcement** stays in the tools (PR 1's `requireScope`); OAuth just populates `ctx.scopes`.
- **Consent required** every connect; show clear scope + workspace disclosure.
- **Static keys unaffected** — the `mesaas_sk_` path and its column-grant/secret handling stay.
- Audit every OAuth-authenticated tool call (already done; add `auth: "oauth"` to metadata).

## Testing
- **claude.ai web:** add the connector URL → expect the Mesaas consent page → approve → tools appear.
- Unit: JWT validation (valid / wrong-audience / expired / revoked-grant), grant→ctx mapping,
  the discovery 401 + metadata JSON.
- Keep the PR 1 curl/Inspector harness for the static-key path (regression).

## Spike findings & residual risks (2026-06-22)
1. ~~**claude.ai discovery behavior**~~ — **RESOLVED ✅**: WWW-Authenticate `resource_metadata` is
   honored first per spec; function-subpath metadata is allowed. Requirements baked into §1
   (absolute URL, `scope=`, RFC 8707 audience). Empirical re-check on claude.ai web once deployed.
2. ~~**Supabase authorize hand-off**~~ — **RESOLVED ✅**: `getAuthorizationDetails` /
   `approveAuthorization` / `denyAuthorization` via an Authorization Path. See §3.

   **Residual risks to verify before PR B:**
3. **Supabase OAuth-server maturity** — new feature (supabase discussion #38022); at least one open
   hosted consent-redirect bug (supabase/auth #2408). Confirm it's enabled + stable on prod.
4. **Audience binding** — spec MANDATES it, but Supabase `resource`/`aud` support is unconfirmed.
   If absent, use `client_id` + the grant row as the trust boundary and document the deviation.
5. **Custom domain (deferred)** — `mcp.mesaas.com.br` for a branded URL + root `.well-known`, the
   fallback if claude.ai web discovery proves flaky against the subpath.

## PR slicing (after PR 2)
1. **PR A** — RS discovery (metadata route + `WWW-Authenticate`) + dual-auth resolver + grant table
   + JWT validation. Static keys still work; OAuth path testable with a manually-inserted grant.
2. **PR B** — consent page (reusing PR 2's scope picker) + enable Supabase OAuth/DCR + end-to-end
   claude.ai web connect.
3. **PR C** — polish: revocation UI for OAuth grants (CRM + admin), custom domain (if the spike
   requires it), KB article "Conectar pelo claude.ai".

## Effort / risk
Bigger and more security-sensitive than PR 1 (token validation, audience binding, consent UI), but
Supabase removes the hardest parts (we issue no tokens, run no authorize/token endpoints). Main
unknowns are the two spikes (#1, #2) — both should be de-risked before PR B.

Related: [[project_mcp_agent_plan]], [[feedback_edge_function_user_token_verification]].

[anthropics/claude-ai-mcp #112]: https://github.com/anthropics/claude-ai-mcp/issues/112
[Supabase OAuth server]: https://supabase.com/docs/guides/auth/oauth-server
[Supabase MCP auth]: https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication
