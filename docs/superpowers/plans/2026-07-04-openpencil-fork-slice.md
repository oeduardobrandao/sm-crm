# Estúdio v2 — Slice 1: Editor Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the spike's embed probe into the production editor app: a minimal-diff GitHub fork of OpenPencil with a hardened embed mode (auth, rev-guarded persistence, postMessage bridge, clean chrome), verified in the browser and deployed dark to Vercel.

**Architecture:** All changes live behind `embedConfig` (null → app behaves exactly like upstream, keeping rebases trivial). The editor is backend-agnostic: it talks to whatever `docUrl` it is given using a frozen HTTP contract, and to its parent window using a frozen bridge protocol — those two contracts are this slice's real deliverable, implemented later by the endpoint slice (post-design-manage) and the CRM-shell slice respectively. Until then the enhanced local stub plays the backend and a host page plays the CRM.

**Tech Stack:** Fork of `open-pencil/open-pencil` at tag `v0.13.2` (branch `mesaas`), Vue 3, bun, `bun:test` for unit tests, Vercel CLI deploy (dark).

## Global Constraints

- Fork base is pinned to tag **v0.13.2**; the work branch is `mesaas`; `master` stays tracking upstream for future rebases.
- **Minimal-diff discipline:** every change to an upstream file is guarded by `embedConfig` (or a one-line import) and marked with a `// MESAAS:` comment. New code goes in new files under `src/app/embed/`.
- Clones of the fork need `GIT_LFS_SKIP_SMUDGE=1` (upstream's LFS backend rejects anonymous pulls; objects are test fixtures only). Record this in the fork's `UPSTREAM.md`.
- Dev server needs `bun --bun run dev` (their Vite config uses `util.styleText`, needs Node ≥ 20.12; system Node is 20.11).
- No secrets in the fork repo, ever. Auth tokens arrive only via postMessage, never via URL.
- Verification for UI behavior is done in the browser via the preview harness (stub `spike-stub` + host page), like the spike.
- The sm-crm side of this slice is docs only (`docs/estudio-v2-editor-contract.md`); no CRM code changes yet.

## The two frozen contracts (deliverable — copied verbatim into `docs/estudio-v2-editor-contract.md` in Task 5)

**HTTP document contract** (editor ⇄ backend, later implemented by post-design-manage):

```
GET  {docUrl}
  → 200, body: .fig bytes, headers: x-rev: <int>
  → 401 (bad/expired token) | 403 (not owner) | 404 (no design)
PUT  {docUrl}, body: .fig bytes,
     headers: authorization: Bearer <token>, x-expected-rev: <int>, content-type: application/octet-stream
  → 200, headers: x-rev: <new int>
  → 409 (stale rev) | 401 | 403 | 413 (too large) | 422 (invalid doc)
Both requests carry authorization: Bearer <token>. CORS: exposed header x-rev.
```

**Bridge protocol v1** (postMessage, every message `{ v: 1, type, ... }`):

```
editor → parent:  ready
                  doc:loaded   { rev }
                  save:ok      { rev, bytes }
                  save:conflict{ rev }            // autosave suspended until reload
                  save:error   { message }
                  auth:needed                     // 401 seen; parent should re-send auth
                  dirty        { dirty: boolean }
parent → editor:  auth         { accessToken }
                  save                            // force immediate save
Editor accepts parent messages ONLY from the origin in ?parentOrigin=<origin> and
posts outbound messages to that origin. No parentOrigin param → bridge disabled
(standalone dev mode; auth header omitted).
Editor URL shape: /?embed=1&docUrl=<url>&parentOrigin=<origin>
```

---

### Task 1: Create the GitHub fork, `mesaas` branch, and UPSTREAM.md

**Files:**
- Fork repo (GitHub): `open-pencil` under the user's account, branch `mesaas`
- Create in fork: `UPSTREAM.md`
- Local working copy: `~/Projects/open-pencil-spike` (gains `fork` remote; probe commit is the branch's starting point)

**Interfaces:**
- Produces: fork remote + `mesaas` branch that Tasks 2–5 commit to; `UPSTREAM.md` documenting the diff surface and rebase procedure.

- [ ] **Step 1: Fork on GitHub and wire the remote**

```bash
gh repo fork open-pencil/open-pencil --clone=false
cd ~/Projects/open-pencil-spike
git remote add fork "https://github.com/$(gh api user --jq .login)/open-pencil.git"
git switch -c mesaas   # from spike/embed (which sits on v0.13.2 + probe commit)
```

- [ ] **Step 2: Write UPSTREAM.md**

```markdown
# Mesaas fork of OpenPencil

Base: upstream tag `v0.13.2`. Work branch: `mesaas`. `master` tracks upstream.

## Diff surface (keep this list exact)
- `src/app/embed/` — all Mesaas embed-mode code (new files only)
- `src/app/document/io/source.ts` — embed save + autosave gate (marked `// MESAAS:`)
- `src/app/editor/session/modules.ts` — embed boot hook (marked `// MESAAS:`)
- `src/main.ts` — embed chrome install + PWA skip (marked `// MESAAS:`)
- `src/views/EditorView.vue` — chrome v-ifs + automation/collab guards (marked `// MESAAS:`)
- `vercel.json`, `UPSTREAM.md` — deploy/docs (new files)

## Rebase procedure
1. `git fetch upstream && git switch master && git merge --ff-only upstream/master`
2. `git switch mesaas && git rebase <new-tag>` — conflicts can only occur in the files above
3. Re-run the embed test suite + browser loop before pushing.

## Clone note
Upstream uses git-lfs with an auth-required backend; clone with
`GIT_LFS_SKIP_SMUDGE=1` (LFS objects are test fixtures, not needed to build/run).
Dev: `bun install && bun --bun run dev`.
```

- [ ] **Step 3: Commit and push the branch**

```bash
git add UPSTREAM.md && git commit -m "docs: UPSTREAM.md — fork contract and rebase procedure"
git push -u fork mesaas
```

Expected: branch visible on the GitHub fork with the probe commit + UPSTREAM.md.

---

### Task 2: Harden the embed module — parentOrigin, auth, conflict handling (+ tests)

**Files:**
- Rewrite: `src/app/embed/index.ts` (fork)
- Create: `src/app/embed/embed.test.ts` (fork)

**Interfaces:**
- Consumes: query params `embed`, `docUrl`, `parentOrigin`.
- Produces (used by Tasks 3–4): `embedConfig: { docUrl, parentOrigin } | null`, `setAccessToken(t)`, `fetchEmbedDocument(): Promise<{ file: File, rev: number }>`, `saveEmbedDocument(bytes): Promise<number>` (returns new rev; throws `EmbedConflictError` on 409, `EmbedAuthError` on 401), `isSaveSuspended()`.

- [ ] **Step 1: Check the repo's unit-test runner**

```bash
cd ~/Projects/open-pencil-spike && grep -rn '"test"' package.json && ls tests/ | head -5
```

If unit tests run via `bun test`, write the new test file in `bun:test` style (below). If the repo uses another runner for `src/**/*.test.ts`, match it — same cases, different imports.

- [ ] **Step 2: Write the failing tests**

```ts
// src/app/embed/embed.test.ts
import { expect, mock, test } from 'bun:test'
import { EmbedAuthError, EmbedConflictError, createEmbedClient } from './client'

const cfg = { docUrl: 'https://api.test/doc?post_id=1', parentOrigin: 'https://crm.test' }

test('GET sends bearer token and captures rev', async () => {
  const fetchMock = mock(async () =>
    new Response(new Uint8Array([1, 2]), { status: 200, headers: { 'x-rev': '7' } }))
  const client = createEmbedClient(cfg, fetchMock as unknown as typeof fetch)
  client.setAccessToken('tok-1')
  const { rev } = await client.fetchDocument()
  expect(rev).toBe(7)
  expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer tok-1')
})

test('PUT sends x-expected-rev and updates rev from response', async () => {
  const fetchMock = mock(async (url: string, init: RequestInit) =>
    init.method === 'PUT'
      ? new Response('ok', { status: 200, headers: { 'x-rev': '8' } })
      : new Response(new Uint8Array([1]), { status: 200, headers: { 'x-rev': '7' } }))
  const client = createEmbedClient(cfg, fetchMock as unknown as typeof fetch)
  client.setAccessToken('tok-1')
  await client.fetchDocument()
  const rev = await client.saveDocument(new Uint8Array([9]))
  expect(rev).toBe(8)
  const putInit = fetchMock.mock.calls[1][1]
  expect(putInit.headers['x-expected-rev']).toBe('7')
})

test('409 throws EmbedConflictError and suspends saving', async () => {
  const fetchMock = mock(async (_u: string, init?: RequestInit) =>
    init?.method === 'PUT'
      ? new Response('conflict', { status: 409 })
      : new Response(new Uint8Array([1]), { status: 200, headers: { 'x-rev': '7' } }))
  const client = createEmbedClient(cfg, fetchMock as unknown as typeof fetch)
  client.setAccessToken('tok-1')
  await client.fetchDocument()
  await expect(client.saveDocument(new Uint8Array([9]))).rejects.toBeInstanceOf(EmbedConflictError)
  expect(client.isSaveSuspended()).toBe(true)
  await expect(client.saveDocument(new Uint8Array([9]))).rejects.toThrow(/suspended/)
})

test('401 throws EmbedAuthError and does NOT suspend', async () => {
  const fetchMock = mock(async (_u: string, init?: RequestInit) =>
    init?.method === 'PUT'
      ? new Response('unauthorized', { status: 401 })
      : new Response(new Uint8Array([1]), { status: 200, headers: { 'x-rev': '7' } }))
  const client = createEmbedClient(cfg, fetchMock as unknown as typeof fetch)
  client.setAccessToken('expired')
  await client.fetchDocument()
  await expect(client.saveDocument(new Uint8Array([9]))).rejects.toBeInstanceOf(EmbedAuthError)
  expect(client.isSaveSuspended()).toBe(false)
})
```

- [ ] **Step 3: Run tests, verify they fail** (`bun test src/app/embed/` → module not found)

- [ ] **Step 4: Implement**

Split the module: `src/app/embed/client.ts` (pure, testable — no window access) and `src/app/embed/index.ts` (reads `location.search`, exports the singleton wired to real `fetch`).

```ts
// src/app/embed/client.ts
export class EmbedConflictError extends Error {}
export class EmbedAuthError extends Error {}

export type EmbedConfig = { docUrl: string; parentOrigin: string | null }

export function createEmbedClient(cfg: EmbedConfig, fetchImpl: typeof fetch = fetch) {
  let rev: number | null = null
  let token: string | null = null
  let suspended = false

  function authHeaders(): Record<string, string> {
    return token ? { authorization: `Bearer ${token}` } : {}
  }

  async function fetchDocument(): Promise<{ file: File; rev: number }> {
    const res = await fetchImpl(cfg.docUrl, { headers: authHeaders() })
    if (res.status === 401) throw new EmbedAuthError('unauthorized')
    if (!res.ok) throw new Error(`doc fetch failed: ${res.status}`)
    rev = Number(res.headers.get('x-rev') ?? '0')
    const bytes = await res.arrayBuffer()
    return { file: new File([bytes], 'embedded.fig', { type: 'application/octet-stream' }), rev }
  }

  async function saveDocument(bytes: Uint8Array): Promise<number> {
    if (suspended) throw new Error('saving suspended after conflict')
    const res = await fetchImpl(cfg.docUrl, {
      method: 'PUT',
      headers: {
        ...authHeaders(),
        'content-type': 'application/octet-stream',
        ...(rev !== null ? { 'x-expected-rev': String(rev) } : {})
      },
      body: bytes as unknown as BodyInit
    })
    if (res.status === 409) {
      suspended = true
      throw new EmbedConflictError('stale rev')
    }
    if (res.status === 401) throw new EmbedAuthError('unauthorized')
    if (!res.ok) throw new Error(`save failed: ${res.status}`)
    rev = Number(res.headers.get('x-rev') ?? String((rev ?? 0) + 1))
    return rev
  }

  return {
    fetchDocument,
    saveDocument,
    setAccessToken: (t: string) => { token = t },
    isSaveSuspended: () => suspended,
    currentRev: () => rev
  }
}
```

`index.ts` parses `?embed=1&docUrl=&parentOrigin=`, exports `embedConfig` and the singleton client, and re-exports the old function names (`fetchEmbedDocument`, `saveEmbedDocument`) as thin wrappers so `source.ts`/`modules.ts` hooks keep working. Tests construct their own client per case — no module-reset helper needed.

- [ ] **Step 5: Run tests to green** (`bun test src/app/embed/`), **Step 6: Commit** (`feat(embed): auth + rev-guarded client with conflict suspension`)

---

### Task 3: postMessage bridge (+ tests)

**Files:**
- Create: `src/app/embed/bridge.ts`, `src/app/embed/bridge.test.ts` (fork)
- Modify: `src/app/document/io/source.ts` (emit save events), `src/app/editor/session/modules.ts` (dirty watch, auth wiring, doc:loaded)

**Interfaces:**
- Consumes: `embedConfig.parentOrigin`, embed client from Task 2.
- Produces: `bridge.emit(type, payload)`, `bridge.on('auth' | 'save', handler)`; wired so the CRM shell slice only needs to implement the parent half of the protocol.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/embed/bridge.test.ts
import { expect, mock, test } from 'bun:test'
import { createBridge } from './bridge'

test('emit posts versioned message to parent origin only', () => {
  const post = mock(() => {})
  const b = createBridge('https://crm.test', { postMessage: post } as unknown as Window)
  b.emit('save:ok', { rev: 3, bytes: 100 })
  expect(post).toHaveBeenCalledWith({ v: 1, type: 'save:ok', rev: 3, bytes: 100 }, 'https://crm.test')
})

test('inbound messages are dropped unless origin matches', () => {
  const got: string[] = []
  const b = createBridge('https://crm.test', { postMessage: () => {} } as unknown as Window)
  b.on('auth', (m) => got.push((m as { accessToken: string }).accessToken))
  b.handleMessage({ origin: 'https://evil.test', data: { v: 1, type: 'auth', accessToken: 'x' } } as MessageEvent)
  b.handleMessage({ origin: 'https://crm.test', data: { v: 1, type: 'auth', accessToken: 'ok' } } as MessageEvent)
  b.handleMessage({ origin: 'https://crm.test', data: { v: 2, type: 'auth', accessToken: 'v2' } } as MessageEvent)
  expect(got).toEqual(['ok'])
})
```

- [ ] **Step 2: Run to verify failure, then implement**

```ts
// src/app/embed/bridge.ts
type Handler = (msg: Record<string, unknown>) => void

export function createBridge(parentOrigin: string, parent: Window) {
  const handlers = new Map<string, Handler[]>()

  function emit(type: string, payload: Record<string, unknown> = {}) {
    parent.postMessage({ v: 1, type, ...payload }, parentOrigin)
  }

  function on(type: string, fn: Handler) {
    handlers.set(type, [...(handlers.get(type) ?? []), fn])
  }

  function handleMessage(e: MessageEvent) {
    if (e.origin !== parentOrigin) return
    const d = e.data as { v?: number; type?: string } | null
    if (!d || d.v !== 1 || !d.type) return
    for (const fn of handlers.get(d.type) ?? []) fn(d as Record<string, unknown>)
  }

  return { emit, on, handleMessage }
}
```

`index.ts` instantiates it when `embedConfig?.parentOrigin` is set (`window.parent`, `addEventListener('message', bridge.handleMessage)`), else exports a no-op bridge (emit/on do nothing) so call sites never branch.

- [ ] **Step 3: Wire events at the seams (all `// MESAAS:` marked)**

- `source.ts` `saveToEmbed()`: on success `bridge.emit('save:ok', { rev, bytes })`; on `EmbedConflictError` → toast (their `toast.error`) + `bridge.emit('save:conflict', { rev: client.currentRev() })`; on `EmbedAuthError` → `bridge.emit('auth:needed')`; other errors → `bridge.emit('save:error', { message })` + toast.
- `modules.ts` embed boot: `bridge.emit('ready')` before fetching; `bridge.on('auth', m => client.setAccessToken(m.accessToken))`; **await the first `auth` message before fetching the doc** (with a 5s timeout → visible error state), then `doc:loaded { rev }` after `openFigFile`; `bridge.on('save', () => saveFigFile())`; a `watch` on `state.sceneVersion !== savedVersion` → `dirty { dirty }` (debounced 300ms).
- Remove the spike's `window.__opSession` handle; replace with `if (import.meta.env.DEV) window.__opSession = ...` (dev-only probe).

- [ ] **Step 4: Tests green + typecheck (`bun test src/app/embed/ && bun --bun vite build --mode development` or their `bun run check` if present), Step 5: Commit** (`feat(embed): postMessage bridge v1 — auth handshake, save events, dirty tracking`)

---

### Task 4: Chrome + behavior pass in embed mode

**Files (fork, all `// MESAAS:` marked):**
- Modify: `src/views/EditorView.vue` (v-if chrome, skip `connectAutomation`/`spawnMCPIfNeeded`/`CollabPanel`)
- Modify: `src/main.ts` (skip PWA registration in embed; keep `installEmbedChrome` only if still needed after v-ifs)
- Modify: `src/app/editor/session/modules.ts` (boot focus on the content page)

**Interfaces:**
- Consumes: `embedConfig` from Task 2.
- Produces: the editor surface the CRM will actually show users.

- [ ] **Step 1: Guard the automation/collab/PWA machinery**

In `EditorView.vue` (script): `if (!embedConfig) { automationCleanup.value = connectAutomation(...) ... }` and skip `spawnMCPIfNeeded`. In the template: `v-if="!embedConfig"` on `<CollabPanel />`, the Share button block, and the menubar component (locate the File/Edit/View menubar component in the template around lines 114–221 — it renders `[role=menubar]`; apply `v-if` at its mount point). In `main.ts`: wrap the `virtual:pwa-register` import in `if (!embedConfig)`. Also hide their AI chat panel mount if it renders in embed (search the template for the chat component; same `v-if`).

- [ ] **Step 2: Boot focus on the content page**

In the embed boot hook (after `openFigFile` resolves): find the first page that has children (`graph.getPages().find(p => p.childIds.length > 0)`) and set `state.currentPageId` to it, then `fitCurrentPageToViewport()`. Remove the probe's CSS `installEmbedChrome` menubar rule if the v-if now covers it (keep the function only if some chrome has no component seam).

- [ ] **Step 3: Update the host page to speak the protocol**

Rewrite `spike/openpencil/embed.html` (sm-crm) as the CRM-shell simulator: iframe with `?embed=1&docUrl=http://localhost:3112/doc&parentOrigin=http://localhost:3112`, JS that answers `ready` with `auth { accessToken: 'dev-token' }`, logs every bridge event into a visible `<pre id="log">`, and a "Force save" button posting `save`. Update `spike/openpencil/stub-server.mjs`: require `authorization: Bearer dev-token` on GET/PUT (else 401) — now it tests the auth path too.

- [ ] **Step 4: Browser-verify the full loop (preview harness)**

Start `spike-stub` + `op-editor` (launch.json), open `http://localhost:3112/embed-page`, verify in order: editor boots ONLY after auth handshake; content page focused (frames visible, not empty Page 1); menubar/Share/collab/chat absent; console free of Automation-websocket retries; edit → `dirty {true}` then `save:ok` in the host log → stub rev bumps; "Force save" works; stale-rev curl replay → 409; after a forced conflict (curl a PUT first, then edit in editor) → `save:conflict` in log + autosave stops. Screenshot for the record.

- [ ] **Step 5: Commit** (`feat(embed): production chrome — no automation/collab/menubar/PWA, auth-gated boot, content-page focus`)

---

### Task 5: Build, dark deploy, contract doc, wrap-up

**Files:**
- Create in fork: `vercel.json`
- Create in sm-crm: `docs/estudio-v2-editor-contract.md`
- Modify in sm-crm: `spike/openpencil/NOTES.md` (slice-1 results), memory update

**Interfaces:**
- Produces: deployed dark editor URL; the contract doc that the endpoint slice (HTTP) and CRM-shell slice (bridge + URL shape) implement against.

- [ ] **Step 1: Production build locally**

```bash
cd ~/Projects/open-pencil-spike && bun run build
```

Expected: `dist/` with the SPA. If their full build's lint stage flags our new files, fix style (don't skip lint — CI parity).

- [ ] **Step 2: vercel.json (SPA rewrites) + dark deploy via CLI**

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

```bash
npx vercel link --yes --project mesaas-estudio && npx vercel deploy --prod --yes
```

Turn OFF deployment protection is NOT needed here (dark app, humans only via CRM later) — but record the URL. Verify the deployed app loads standalone (no embed params → upstream behavior) and renders the editor shell.

- [ ] **Step 3: Write `docs/estudio-v2-editor-contract.md`** — copy the two frozen contracts from this plan's header verbatim, plus the editor URL shape and deployment URL.

- [ ] **Step 4: Push fork, commit sm-crm docs, update memory**

```bash
cd ~/Projects/open-pencil-spike && git push fork mesaas
cd /Users/eduardosouza/Projects/sm-crm
git add docs/estudio-v2-editor-contract.md spike/openpencil/embed.html spike/openpencil/stub-server.mjs spike/openpencil/NOTES.md
git commit -m "feat(estudio-v2): slice 1 — editor fork contract doc + host-page protocol simulator"
```

Report: fork URL, deployed URL, verification evidence, and anything that should amend the next slice's assumptions.
