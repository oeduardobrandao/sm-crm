# Estúdio v2 — CRM shell slice (iframe host)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/estudio/:postId` placeholder with the real OpenPencil iframe host —
the parent side of bridge protocol v1 (docs/estudio-v2-editor-contract.md) — so the new
Estúdio is usable locally end-to-end from inside the CRM.

**Architecture:** A pure `embedHost` module implements the bridge host (origin-checked
message handling, auth handshake incl. forced refresh on `auth:needed`, force-save); a thin
`EstudioPage` renders the header (back / save pill / force save), the iframe, conflict
banner, boot-timeout hint, dirty guards (`useBlocker` — main.tsx is already a data router —
plus `beforeunload`). Dev CORS: the editor iframe origin (localhost:1420) is not in prod
`ALLOWED_ORIGINS`, so in dev the docUrl points at a Vite proxy on the CRM origin
(`/estudio-fn/*` → `{VITE_SUPABASE_URL}/functions/v1/*`) that rewrites
`access-control-allow-origin` to echo localhost origins. Prod keeps the direct Supabase
docUrl and gets its editor origin from `VITE_ESTUDIO_EDITOR_ORIGIN` (unset today → page
shows "unavailable"; wired at cutover). No backend changes, no prod secret changes.

**Tech Stack:** React 19, react-router v7 `useBlocker`, TanStack-free (no queries needed),
i18n namespace `estudio`, Vitest.

## Global constraints

- Bridge protocol v1 frozen — `{v:1,type,...}`; host validates `e.origin === editorOrigin`.
- Editor URL shape frozen: `{EDITOR_ORIGIN}/?embed=1&docUrl=…&parentOrigin=…` (url-encoded).
- `postId` from params: `parseInt(param, 10)` + `isNaN` guard (house rule).
- Feature gate fail-open: blocked only when `features?.feature_estudio === false`
  (same as WorkflowDrawer / nav).
- No prod `ALLOWED_ORIGINS` edit in this slice (secret value unreadable; overwrite risk).

## Tasks

### Task 1: embedHost module + unit tests

**Files:** Create `apps/crm/src/pages/estudio/embedHost.ts`,
`apps/crm/src/pages/estudio/__tests__/embedHost.test.ts`.

- `createEmbedHost({editorOrigin, getAccessToken(force), postToEditor, onEvent, onAuthError})`
  → `{handleMessage, forceSave, sendAuth}`. `ready`→`sendAuth(false)`,
  `auth:needed`→`sendAuth(true)`; known events forwarded to `onEvent`; wrong origin /
  wrong `v` / unknown type dropped.
- `buildEditorUrl(editorOrigin, docUrl, parentOrigin)`;
  `buildDocUrl(postId, {dev, appOrigin, supabaseUrl})` (dev → `/estudio-fn` proxy path).
- Tests: origin filtering, v filtering, auth replies (incl. forced refresh + null-token +
  thrown getAccessToken → onAuthError), event forwarding, forceSave payload, URL builders.

### Task 2: EstudioPage shell + i18n + vite dev proxy

**Files:** Rewrite `apps/crm/src/pages/estudio/EstudioPage.tsx`; modify
`apps/crm/vite.config.ts`, `packages/i18n/locales/{pt,en}/estudio.json`, `.env.example`.

- Page states: invalid postId; feature blocked (`featureBlocked` key); editor origin
  unconfigured (prod, `editor.unavailable`); booting (loading overlay + 8s timeout hint
  `editor.notRunning`); loaded; conflict banner (`editor.conflictBanner` + `editor.reload`
  → remount iframe via key); save pill (`editor.savePill.*`); force save
  (`editor.saveNow`); dirty guards (useBlocker + confirm `editor.unsavedPrompt`,
  beforeunload).
- Auth: `getAccessToken(force)` = `supabase.auth.refreshSession()` when forced else
  `getSession()`; `onAuthStateChange` TOKEN_REFRESHED → proactive `auth` re-send.
- Vite proxy `/estudio-fn` with `proxyRes` ACAO rewrite (echo `http://localhost:<port>`
  origins only).

### Task 3: Verify — suites, build, live E2E

- `npm run test` (vitest), `npm run build` (tsc), format/lint per CI gates.
- Live: preview CRM (prod env) + `op-editor` launch config (fork dev server :1420);
  open post 1041 via `/estudio/1041` → doc loads → edit → autosave → pill "Salvo" →
  rev bumps → render re-fires. Screenshot to user.
- Update docs/estudio-v2-editor-contract.md (host implemented), spike NOTES, memory.
