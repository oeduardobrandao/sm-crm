# Critical Security Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 critical/high security vulnerabilities: 3 cross-tenant IDOR bugs in `instagram-analytics` and 2 unauthenticated cron endpoints.

**Architecture:** All fixes are additive ownership checks — we insert a DB query to verify `conta_id` ownership before any data fetch, and add the existing `x-cron-secret` header guard pattern to two cron functions. No schema changes needed.

**Tech Stack:** Deno Edge Functions, Supabase JS v2, TypeScript

---

## Files to Modify

| File | Change |
|---|---|
| `supabase/functions/instagram-analytics/index.ts` | Add workspace ownership guard to 5 read endpoints, tag mutation endpoints, and `/generate-report` |
| `supabase/functions/instagram-sync-cron/index.ts` | Add `CRON_SECRET` env var + `x-cron-secret` header check |
| `supabase/functions/instagram-refresh-cron/index.ts` | Add `CRON_SECRET` env var + `x-cron-secret` header check |

---

## Task 1: VULN-001 — Add ownership check to 5 read endpoints in instagram-analytics

**Files:**
- Modify: `supabase/functions/instagram-analytics/index.ts`

The 5 read endpoints (`/overview/:clientId`, `/demographics/:clientId`, `/best-times/:clientId`, `/posts-analytics/:clientId`, `/follower-history/:clientId`) all call `getAccountWithToken()` or `getAccount()` without first verifying the `clientId` belongs to the caller's `conta_id`.

We add a reusable helper `verifyClientOwnership()` that checks the `clientes` table before any data fetch.

- [ ] **Step 1: Add `verifyClientOwnership` helper after the existing `getAccount` helper (around line 134)**

Find this block in `supabase/functions/instagram-analytics/index.ts`:
```typescript
// --- Helper: get account by clientId (no token needed) ---
async function getAccount(serviceClient: any, clientId: string) {
  const { data: account, error } = await serviceClient
    .from('instagram_accounts')
    .select('*')
    .eq('client_id', clientId)
    .single();

  if (error || !account) throw new Error("Account not found");
  return account;
}
```

Replace with:
```typescript
// --- Helper: get account by clientId (no token needed) ---
async function getAccount(serviceClient: any, clientId: string) {
  const { data: account, error } = await serviceClient
    .from('instagram_accounts')
    .select('*')
    .eq('client_id', clientId)
    .single();

  if (error || !account) throw new Error("Account not found");
  return account;
}

// --- Helper: verify that clientId belongs to contaId ---
async function verifyClientOwnership(serviceClient: any, clientId: string, contaId: string): Promise<void> {
  const { data: clientRow } = await serviceClient
    .from('clientes')
    .select('conta_id')
    .eq('id', clientId)
    .single();
  if (!clientRow || clientRow.conta_id !== contaId) {
    throw new Error('Unauthorized');
  }
}
```

- [ ] **Step 2: Add ownership check to `/overview/:clientId` endpoint**

Find:
```typescript
    if (req.method === 'GET' && path.match(/^\/overview\/\d+$/)) {
      const clientId = path.split('/')[2];
      const days = parseInt(url.searchParams.get('days') || '30') || 30;

      const { account, accessToken } = await getAccountWithToken(serviceClient, clientId);
```

Replace with:
```typescript
    if (req.method === 'GET' && path.match(/^\/overview\/\d+$/)) {
      const clientId = path.split('/')[2];
      const days = parseInt(url.searchParams.get('days') || '30') || 30;

      await verifyClientOwnership(serviceClient, clientId, contaId);
      const { account, accessToken } = await getAccountWithToken(serviceClient, clientId);
```

- [ ] **Step 3: Add ownership check to `/demographics/:clientId` endpoint**

Find:
```typescript
    if (req.method === 'GET' && path.match(/^\/demographics\/\d+$/)) {
      const clientId = path.split('/')[2];
      const { account, accessToken } = await getAccountWithToken(serviceClient, clientId);
```

Replace with:
```typescript
    if (req.method === 'GET' && path.match(/^\/demographics\/\d+$/)) {
      const clientId = path.split('/')[2];
      await verifyClientOwnership(serviceClient, clientId, contaId);
      const { account, accessToken } = await getAccountWithToken(serviceClient, clientId);
```

- [ ] **Step 4: Add ownership check to `/best-times/:clientId` endpoint**

Find:
```typescript
    if (req.method === 'GET' && path.match(/^\/best-times\/\d+$/)) {
      const clientId = path.split('/')[2];
      const account = await getAccount(serviceClient, clientId);
```

Replace with:
```typescript
    if (req.method === 'GET' && path.match(/^\/best-times\/\d+$/)) {
      const clientId = path.split('/')[2];
      await verifyClientOwnership(serviceClient, clientId, contaId);
      const account = await getAccount(serviceClient, clientId);
```

- [ ] **Step 5: Add ownership check to `/posts-analytics/:clientId` endpoint**

Find:
```typescript
    if (req.method === 'GET' && path.match(/^\/posts-analytics\/\d+$/)) {
      const clientId = path.split('/')[2];
      const days = parseInt(url.searchParams.get('days') || '30') || 30;
      const sortBy = url.searchParams.get('sort') || 'posted_at';
      const rawDir = url.searchParams.get('dir') || 'desc';
      const sortDir = ['asc', 'desc'].includes(rawDir) ? rawDir : 'desc';

      const account = await getAccount(serviceClient, clientId);
```

Replace with:
```typescript
    if (req.method === 'GET' && path.match(/^\/posts-analytics\/\d+$/)) {
      const clientId = path.split('/')[2];
      const days = parseInt(url.searchParams.get('days') || '30') || 30;
      const sortBy = url.searchParams.get('sort') || 'posted_at';
      const rawDir = url.searchParams.get('dir') || 'desc';
      const sortDir = ['asc', 'desc'].includes(rawDir) ? rawDir : 'desc';

      await verifyClientOwnership(serviceClient, clientId, contaId);
      const account = await getAccount(serviceClient, clientId);
```

- [ ] **Step 6: Add ownership check to `/follower-history/:clientId` endpoint**

Find:
```typescript
    if (req.method === 'GET' && path.match(/^\/follower-history\/\d+$/)) {
      const clientId = path.split('/')[2];
      const days = parseInt(url.searchParams.get('days') || '90') || 90;

      const account = await getAccount(serviceClient, clientId);
```

Replace with:
```typescript
    if (req.method === 'GET' && path.match(/^\/follower-history\/\d+$/)) {
      const clientId = path.split('/')[2];
      const days = parseInt(url.searchParams.get('days') || '90') || 90;

      await verifyClientOwnership(serviceClient, clientId, contaId);
      const account = await getAccount(serviceClient, clientId);
```

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/instagram-analytics/index.ts
git commit -m "fix(security): add workspace ownership check to all 5 read endpoints in instagram-analytics (VULN-001)"
```

---

## Task 2: VULN-002 — Add ownership check to tag mutation endpoints

**Files:**
- Modify: `supabase/functions/instagram-analytics/index.ts`

The POST `/posts/:postId/tags` and DELETE `/posts/:postId/tags/:tagId` endpoints accept a caller-supplied `postId` but never verify the post belongs to the caller's workspace.

We add a post ownership check that verifies `conta_id` on the `instagram_posts` table (which has a `instagram_account_id` FK; we join through `instagram_accounts` which has `client_id`, and `clientes` which has `conta_id`).

> Note: The `instagram_posts` table does not directly store `conta_id`. We verify by checking that the post's account belongs to a client in the caller's workspace.

- [ ] **Step 1: Add `verifyPostOwnership` helper after `verifyClientOwnership`**

After the `verifyClientOwnership` function added in Task 1, add:

```typescript
// --- Helper: verify that a post belongs to contaId ---
async function verifyPostOwnership(serviceClient: any, postId: string, contaId: string): Promise<void> {
  const { data: post } = await serviceClient
    .from('instagram_posts')
    .select('instagram_account_id, instagram_accounts!inner(client_id, clientes!inner(conta_id))')
    .eq('id', parseInt(postId))
    .single();
  const postContaId = (post as any)?.instagram_accounts?.clientes?.conta_id;
  if (!post || postContaId !== contaId) {
    throw new Error('Unauthorized');
  }
}
```

- [ ] **Step 2: Add ownership check to `POST /posts/:postId/tags`**

Find:
```typescript
    if (req.method === 'POST' && path.match(/^\/posts\/\d+\/tags$/)) {
      const postId = path.split('/')[2];
      const body = await req.json();
      const { tag_id } = body;
      if (!tag_id) throw new Error("tag_id is required");

      const { error } = await serviceClient
```

Replace with:
```typescript
    if (req.method === 'POST' && path.match(/^\/posts\/\d+\/tags$/)) {
      const postId = path.split('/')[2];
      const body = await req.json();
      const { tag_id } = body;
      if (!tag_id) throw new Error("tag_id is required");

      await verifyPostOwnership(serviceClient, postId, contaId);
      const { error } = await serviceClient
```

- [ ] **Step 3: Add ownership check to `DELETE /posts/:postId/tags/:tagId`**

Find:
```typescript
    if (req.method === 'DELETE' && path.match(/^\/posts\/\d+\/tags\/\d+$/)) {
      const parts = path.split('/');
      const postId = parts[2];
      const tagId = parts[4];
      await serviceClient
```

Replace with:
```typescript
    if (req.method === 'DELETE' && path.match(/^\/posts\/\d+\/tags\/\d+$/)) {
      const parts = path.split('/');
      const postId = parts[2];
      const tagId = parts[4];
      await verifyPostOwnership(serviceClient, postId, contaId);
      await serviceClient
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/instagram-analytics/index.ts
git commit -m "fix(security): add post ownership check to tag mutation endpoints (VULN-002)"
```

---

## Task 3: VULN-003 — Fix ownership check order in `/generate-report/:clientId`

**Files:**
- Modify: `supabase/functions/instagram-analytics/index.ts`

Currently `getAccount()` is called at line 803 before the client ownership is verified. The fix is to use `verifyClientOwnership` (already added in Task 1) before the `getAccount()` call.

- [ ] **Step 1: Add ownership check before `getAccount` in `/generate-report`**

Find:
```typescript
    if (req.method === 'POST' && path.match(/^\/generate-report\/\d+$/)) {
      const clientId = path.split('/')[2];
      const body = await req.json().catch(() => ({}));

      // Default to previous month
      const now = new Date();
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const month = body.month || `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
      const force = body.force === true;

      const account = await getAccount(serviceClient, clientId);
```

Replace with:
```typescript
    if (req.method === 'POST' && path.match(/^\/generate-report\/\d+$/)) {
      const clientId = path.split('/')[2];
      const body = await req.json().catch(() => ({}));

      // Default to previous month
      const now = new Date();
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const month = body.month || `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
      const force = body.force === true;

      await verifyClientOwnership(serviceClient, clientId, contaId);
      const account = await getAccount(serviceClient, clientId);
```

- [ ] **Step 2: Fix ownership check order in `/ai-analysis/:clientId` (VULN-007)**

Currently `getAccount()` is called before the client ownership check. Reorder to check first.

Find:
```typescript
    if (req.method === 'POST' && path.match(/^\/ai-analysis\/\d+$/)) {
      const clientId = path.split('/')[2];
      const body = await req.json().catch(() => ({}));

      // Verify account belongs to user's conta
      const account = await getAccount(serviceClient, clientId);
      const { data: client } = await serviceClient
        .from('clientes')
        .select('nome, especialidade')
        .eq('id', clientId)
        .eq('conta_id', contaId)
        .single();
      if (!client) throw new Error("Client not found");
```

Replace with:
```typescript
    if (req.method === 'POST' && path.match(/^\/ai-analysis\/\d+$/)) {
      const clientId = path.split('/')[2];
      const body = await req.json().catch(() => ({}));

      // Verify account belongs to user's conta before fetching any data
      await verifyClientOwnership(serviceClient, clientId, contaId);
      const account = await getAccount(serviceClient, clientId);
      const { data: client } = await serviceClient
        .from('clientes')
        .select('nome, especialidade')
        .eq('id', clientId)
        .eq('conta_id', contaId)
        .single();
      if (!client) throw new Error("Client not found");
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/instagram-analytics/index.ts
git commit -m "fix(security): verify client ownership before account fetch in generate-report and ai-analysis (VULN-003, VULN-007)"
```

---

## Task 4: VULN-005 — Add `x-cron-secret` auth to instagram-sync-cron

**Files:**
- Modify: `supabase/functions/instagram-sync-cron/index.ts`

The cron handler at line 223 accepts any HTTP request with no authentication. We add the same guard used in `analytics-report-cron/index.ts:7,16`.

- [ ] **Step 1: Add `CRON_SECRET` constant and auth guard**

Find the top-level constants block in `supabase/functions/instagram-sync-cron/index.ts`:
```typescript
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY") ?? (() => { throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required"); })();
```

Replace with:
```typescript
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY") ?? (() => { throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required"); })();
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? (() => { throw new Error('CRON_SECRET is required'); })();
```

- [ ] **Step 2: Add auth check at the start of the Deno.serve handler**

Find:
```typescript
// --- Cron Handler ---
Deno.serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
```

Replace with:
```typescript
// --- Cron Handler ---
Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/instagram-sync-cron/index.ts
git commit -m "fix(security): add x-cron-secret authentication to instagram-sync-cron (VULN-005)"
```

---

## Task 5: VULN-005 — Add `x-cron-secret` auth to instagram-refresh-cron

**Files:**
- Modify: `supabase/functions/instagram-refresh-cron/index.ts`

Same pattern as Task 4, applied to the refresh cron.

- [ ] **Step 1: Add `CRON_SECRET` constant**

Find the top-level constants block in `supabase/functions/instagram-refresh-cron/index.ts`:
```typescript
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY") ?? (() => { throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required"); })();
```

Replace with:
```typescript
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY") ?? (() => { throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required"); })();
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? (() => { throw new Error('CRON_SECRET is required'); })();
```

- [ ] **Step 2: Add auth check at the start of the Deno.serve handler**

Find:
```typescript
// --- Cron Handler ---
Deno.serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
```

Replace with:
```typescript
// --- Cron Handler ---
Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/instagram-refresh-cron/index.ts
git commit -m "fix(security): add x-cron-secret authentication to instagram-refresh-cron (VULN-005)"
```

---

## Self-Review

**Spec coverage:**
- VULN-001 (5 read endpoints): covered in Task 1 ✓
- VULN-002 (tag mutation endpoints): covered in Task 2 ✓
- VULN-003 (generate-report): covered in Task 3 ✓
- VULN-005 (sync-cron + refresh-cron): covered in Tasks 4 & 5 ✓
- VULN-007 (ai-analysis ordering): covered in Task 3 Step 2 ✓

**Placeholder scan:** No TBDs, no vague instructions — all steps show exact diffs.

**Type consistency:** `verifyClientOwnership` and `verifyPostOwnership` signatures are consistent across all usages. Both throw `Error('Unauthorized')` which is caught by the outer try/catch returning a 500; if you want 403 instead, change the throw to `return json({ error: 'Unauthorized' }, 403)` at each call site — but since `verifyClientOwnership` is a helper function that throws, the outer handler's catch block will return a 500. If 403 is preferred, inline the check at each call site instead of using a throwing helper.

> **Important:** The current outer catch block in `instagram-analytics/index.ts` returns a 500 for all thrown errors. The `Unauthorized` message will be visible to the client. This is acceptable — it leaks that the resource exists but not its contents. If you want to return 404 instead (to avoid confirming existence), change the throw message to `'Not found'` or add a status code to the error.
