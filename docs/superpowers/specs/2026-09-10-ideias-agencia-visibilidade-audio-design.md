# Ideias criadas pela agência, visibilidade no Hub e áudio nas ideias — Design

**Date:** 2026-09-10
**Status:** Approved (ready for implementation plan)
**Mockups:** https://claude.ai/code/artifact/5a4708ac-fc12-4a03-829e-4ec56b67b7e8

## Goal

Three additions to the Ideias feature:

1. Agency users can create ideias from the CRM (`/ideias`), not only receive them from clients.
2. Each agency-created ideia carries a per-ideia toggle that decides whether the client sees it in
   the Hub.
3. The audio recording + Whisper transcription flow that exists for the Hub briefing is added to
   ideias, in both the CRM and the Hub.

## Decisions (locked, confirmed 2026-09-10)

| Decision | Choice |
|---|---|
| Visibility control | Per ideia (`visivel_no_hub`), default **off** for agency-created, always **on** for client-created. No workspace-level setting. |
| Transcript placement | Stored in `audio_transcript` and shown under the player. **Not** appended to `descricao`. `descricao` stays required. |
| Who can write audio | Only the originating side: Hub for `origem = 'cliente'`, CRM for `origem = 'agencia'`. Both sides can play. |
| Plan gate | Reuse `plans.feature_briefing_audio` (Pro, Max, lifetime) as the general audio flag. CRM label becomes "Gravação de áudio". No new plan column. |
| Type of agency-created ideias | Fixed `tipo = 'ideia'`. A solicitação is something the client asks for. |
| Recordings per ideia | One. Re-recording replaces. Same 5 min / 15 MiB limits as briefing. |
| Storage | Briefing's "approach A": columns on `ideias`, own R2 prefix `ideia-audio/`, no side table. |

## Non-goals

- Agency reply in audio (a second recording per ideia).
- Hiding a **client-created** ideia from the client.
- Editing title/description of an agency ideia from the Hub.
- Images in the CRM create dialog (the drawer already handles images after creation).
- A `create_idea` MCP tool.
- Refactoring `_shared/briefing-audio.ts` into a generic module. Ideias get a sibling module that
  reuses the generic helpers; the briefing code path is untouched.

---

## 1. Data model

One migration: `supabase/migrations/20260922000001_ideias_agencia_audio.sql` (version prefix must
stay above `origin/main`'s tail at PR-open time; re-check then).

### 1.1 Origin and visibility

```sql
ALTER TABLE ideias ADD COLUMN origem text NOT NULL DEFAULT 'cliente';
ALTER TABLE ideias ADD CONSTRAINT ideias_origem_check CHECK (origem IN ('cliente','agencia'));
-- Backfill existing (client) rows as visible, then flip the default to hidden so an
-- agency insert that omits the column never leaks to the Hub. Client rows are forced
-- visible on INSERT by the guard trigger (1.3) and kept visible by the CHECK.
ALTER TABLE ideias ADD COLUMN visivel_no_hub boolean NOT NULL DEFAULT true;
ALTER TABLE ideias ALTER COLUMN visivel_no_hub SET DEFAULT false;
ALTER TABLE ideias ADD CONSTRAINT ideias_cliente_visivel_check CHECK (origem <> 'cliente' OR visivel_no_hub);
CREATE INDEX ideias_cliente_visivel_idx ON ideias (cliente_id) WHERE visivel_no_hub;

-- Tenant pin: the client must belong to the ideia's workspace. Until now the CRM could
-- insert any cliente_id (RLS only checks workspace_id) and the Hub GET, running as
-- service role and filtering by cliente_id, would show that row to another tenant's client.
-- clientes_id_conta_uq already exists (20260815000002).
ALTER TABLE ideias ADD CONSTRAINT ideias_cliente_workspace_fk
  FOREIGN KEY (cliente_id, workspace_id) REFERENCES clientes (id, conta_id) ON DELETE CASCADE;

ALTER TABLE membros ADD CONSTRAINT membros_id_conta_uq UNIQUE (id, conta_id);
ALTER TABLE ideias ADD COLUMN autor_membro_id integer;
ALTER TABLE ideias ADD CONSTRAINT ideias_autor_fk
  FOREIGN KEY (autor_membro_id, workspace_id) REFERENCES membros (id, conta_id)
  ON DELETE SET NULL (autor_membro_id);
```

- Existing rows, Hub inserts and the data-import RPC (`20260729000004`, inserts without `origem`)
  all read as `cliente` + visible. Nothing changes for them. The composite client FK is
  validated against existing rows; a pre-existing cross-tenant row would make the migration
  fail loudly, which is the right outcome.
- The CHECK makes "client-created implies visible" a database invariant.
- **`origem` is immutable and authenticated inserts are agency-only**, enforced in the
  `ideia_audio_guard` trigger (1.3): on UPDATE, any change to `origem` raises `forbidden`
  for every role; on INSERT by a role other than `service_role`, `origem` must be `'agencia'`.
  On INSERT with `origem = 'cliente'` the trigger sets `visivel_no_hub := true`, so the column
  default (`false`) only ever applies to agency rows: omitting the field hides, never exposes.
  Without this a CRM member could flip a client row to `agencia`, hide it, and defeat the CHECK.
- `autor_membro_id` is set by the CRM on insert to the current member's `membros.id`, resolved
  through `membros.crm_user_id = auth user id` (the `useCurrentMembro` hook). The drawer's
  existing `membros.user_id === profile.id` lookup is wrong (that column is the record creator)
  and is corrected in the same change. Nullable; NULL on client-created rows. The composite FK
  pins the author to the ideia's workspace.
- The Hub GET also adds `.eq("workspace_id", conta_id)` from the token as defense in depth.

### 1.2 Notification trigger

`trg_notify_idea_submitted` (last defined in `20260730000009`) is recreated with one extra guard at
the top: `IF NEW.origem = 'agencia' THEN RETURN NEW; END IF;`. Owners/admins are not notified
about their own team's ideias. Body otherwise identical.

### 1.3 Audio columns (mirror of `20260907000001_briefing_audio.sql`)

```sql
ALTER TABLE ideias
  ADD COLUMN audio_r2_key text,
  ADD COLUMN audio_mime text,
  ADD COLUMN audio_size_bytes bigint,
  ADD COLUMN audio_duration_seconds int,
  ADD COLUMN audio_transcript text,
  ADD COLUMN audio_transcription_status text,
  ADD COLUMN audio_recorded_at timestamptz;

ALTER TABLE ideias
  ADD CONSTRAINT ideias_audio_status_chk CHECK (audio_transcription_status IS NULL OR audio_transcription_status IN ('pending','done','failed')),
  ADD CONSTRAINT ideias_audio_size_chk   CHECK (audio_size_bytes IS NULL OR audio_size_bytes > 0),
  ADD CONSTRAINT ideias_audio_key_tenant_chk CHECK (audio_r2_key IS NULL OR audio_r2_key LIKE 'ideia-audio/' || workspace_id::text || '/%');
```

Triggers, copied from the briefing migration with the table swapped:

- `ideia_audio_guard()` BEFORE INSERT OR UPDATE, SECURITY DEFINER: any change to any `audio_*`
  column by a role other than `service_role` raises `forbidden` (ERRCODE 42501). Needed because
  the CRM writes `ideias` through PostgREST under RLS with no column allowlist (status, comment,
  and now `visivel_no_hub`, `origem`, `autor_membro_id` on insert). The same trigger enforces
  the `origem` rules from 1.1: immutable on UPDATE (all roles), `'agencia'` required on
  non-service-role INSERT.
- `ideia_audio_after_change()` AFTER UPDATE OF `audio_r2_key` OR DELETE: enqueues
  `OLD.audio_r2_key` into `post_media_deletions` and decrements `workspaces.storage_used_bytes`
  by `OLD.audio_size_bytes`. Sole decrement point. Deleting an ideia (Hub, CRM, or client
  cascade) therefore cleans up its audio and quota.

RPCs, SECURITY DEFINER, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO service_role`:

```sql
ideia_audio_finalize(p_workspace_id uuid, p_ideia_id uuid, p_origem text,
                     p_key text, p_bytes bigint, p_mime text, p_duration int) RETURNS jsonb
ideia_audio_release(p_workspace_id uuid, p_ideia_id uuid, p_origem text) RETURNS text
ideia_audio_apply_transcript(p_workspace_id uuid, p_ideia_id uuid, p_key text,
                             p_text text, p_duration int) RETURNS ideias
```

Differences from the briefing RPCs:

- Scoping tuple is `(workspace_id, ideia_id)`; `p_origem` replaces `p_cliente_id`: the row must
  match `origem = p_origem`, else `ideia_not_found`. This is how "only the originating side
  writes" is enforced at the database, independent of the edge-function checks. The Hub wrapper
  passes `'cliente'` and additionally filters `cliente_id`; the CRM wrapper passes `'agencia'`.
- `apply_transcript` writes `audio_transcript`, `audio_transcription_status = 'done'`,
  `audio_duration_seconds = coalesce(existing, p_duration)`. It does **not** touch `descricao`.
  Guard: `audio_r2_key = p_key AND audio_transcription_status IS DISTINCT FROM 'done'`.
- Key prefix check inside `finalize`: `p_key LIKE 'ideia-audio/' || p_workspace_id || '/' || p_ideia_id || '/%'` else `invalid_key`.
- Quota: same `effective_plan_limit(workspace_id, 'storage_quota_bytes')` netting out the
  ideia's current `audio_size_bytes`; `quota_exceeded` on overflow. Lock order: workspace row,
  then ideia row.

### 1.4 Entitlement

No plan column change. The CRM label in `apps/crm/src/lib/entitlement-errors.ts` changes from
"Briefing por áudio" to "Gravação de áudio". `hub-bootstrap` keeps returning
`feature_briefing_audio`; the Hub ideias page reads the same field.

---

## 2. Backend

### 2.1 `_shared/ideia-audio.ts` (new)

Sibling of `_shared/briefing-audio.ts`. Imports and reuses from it: `normalizeAudioMime`,
`extFromAudioMime`, `normalizeDuration`, `buildAudioView`, `makeWorkerTranscriber`,
`BRIEFING_AUDIO_MIME` (re-exported as `IDEIA_AUDIO_MIME`), `MAX_AUDIO_BYTES`,
`MAX_AUDIO_SECONDS`, `STALE_PENDING_MS`, the `AudioView` / `Transcriber` types. If any of those
is not currently exported, export it (no behaviour change).

Own constants: `IDEIA_AUDIO_KEY_PREFIX = "ideia-audio/"`, `IDEIA_AUDIO_COLUMNS` (same seven
column names).

Exports, all taking `{ db, workspace_id, ideia_id, origem, cliente_id? }` as scope:

- `presignIdeiaAudio({ ..., mime_type, size_bytes, signPutUrl, randomUUID? })` → `{ upload_url, r2_key, mime_type }`. Validates mime (415) and size (400), loads the row by
  `id + workspace_id + origem` (+ `cliente_id` when given) (404), best-effort quota pre-check
  netting out the current audio (413), key `ideia-audio/{workspace_id}/{ideia_id}/{uuid}.{ext}`.
- `finalizeIdeiaAudio({ ..., r2_key, mime_type, size_bytes, duration_seconds, headObject, signGetUrl, transcribe })` → `IdeiaAudioResponse`. Prefix + `..` check, HEAD check (size and
  content-type must match), RPC `ideia_audio_finalize`, then synchronous transcription (same
  `runTranscription` shape: capture key before the call, `failed` on empty/throw, orphan-key
  safe). `reserved:false` reroutes to transcribe-only, as in briefing.
- `transcribeIdeiaAudio({ ... })` → same envelope. Retry path.
- `removeIdeiaAudio({ ... })` → `{ ok: true }`. RPC `ideia_audio_release`; the trigger handles R2
  enqueue + quota.
- `loadIdeiaAudioView({ db, workspace_id, ideia_id, signGetUrl })` → `AudioView | null`. Read
  path for both apps. No `origem` filter (both sides can play).

Envelope: `IdeiaAudioResponse { ok: boolean; audio: AudioView | null; transcript: string | null }`.

Error mapping identical to briefing: `quota_exceeded → 413`, `ideia_not_found → 404`,
`invalid_key | invalid_bytes → 400`, anything else → 500 with a generic message.

### 2.2 `hub-ideias` (token-authed, extended in place)

New routes, parsed with the existing segment logic:

| Route | Body | Gate |
|---|---|---|
| `POST /hub-ideias/audio-upload-url` | `{ token, ideia_id, mime_type, size_bytes }` | plan flag, write rate limit |
| `POST /hub-ideias/:id/audio` | `{ token, r2_key, mime_type, size_bytes, duration_seconds }` | plan flag, write rate limit |
| `POST /hub-ideias/:id/audio/transcribe` | `{ token }` | plan flag, write rate limit |
| `DELETE /hub-ideias/:id/audio?token=` | — | no plan gate (deliberate, as briefing) |

All four pass `origem: 'cliente'` and the token's `cliente_id`. Plan gate:
`effectivePlanFeature(conta_id, 'feature_briefing_audio')` → 403 "Recurso indisponível no plano
atual.". Rate limit key `hub-write:hub-ideias-audio:{conta}:{cliente}` at 20/3600.

Visibility and ownership changes to existing routes:

- `GET /hub-ideias`: add `.eq("visivel_no_hub", true)`; select `origem` and the audio columns;
  return `origem` and `audio: buildAudioView(...)` per ideia (signing wrapped per row, a failure
  yields `audio: null`).
- `PATCH /hub-ideias/:id`, `DELETE /hub-ideias/:id`, `POST /hub-ideias/upload-url`,
  `POST /hub-ideias/:id/files`, `DELETE /hub-ideias/:id/files/:fileId`: the target row must have
  `origem = 'cliente'`, else 404. (404, not 403, so the Hub cannot probe hidden agency rows.)
- `POST /hub-ideias` (create): unchanged; `origem` defaults to `cliente`. Any `origem` /
  `visivel_no_hub` / `audio_*` keys in the body are ignored.

Audio writes on the Hub are **not** gated by `checkLock` (same rule as images: they do not touch
the locked text fields).

### 2.3 `ideia-media-manage` (JWT-authed, extended in place)

| Route | Body | Notes |
|---|---|---|
| `GET /ideia-media-manage/audio?ideia_id=` | — | `loadIdeiaAudioView`; 404 when no audio |
| `POST /ideia-media-manage/audio-upload-url` | `{ ideia_id, mime_type, size_bytes }` | `origem: 'agencia'`, plan flag |
| `POST /ideia-media-manage/:id/audio` | `{ r2_key, mime_type, size_bytes, duration_seconds }` | `origem: 'agencia'`, plan flag |
| `POST /ideia-media-manage/:id/audio/transcribe` | — | `origem: 'agencia'`, plan flag |
| `DELETE /ideia-media-manage/:id/audio` | — | `origem: 'agencia'`, no plan gate |

Auth and workspace resolution exactly as the existing routes in this function. `index.ts` wires
`signGetUrl`, `signPutUrl`, `headObjectSigned` and `makeWorkerTranscriber` from
`TRANSCRIBE_WORKER_URL` / `TRANSCRIBE_SECRET`, as `hub-briefing/index.ts` does.

### 2.4 Worker and cron

- `workers/transcribe/src/index.ts`: `KEY_PREFIX` becomes an allowlist
  `['briefing-audio/', 'ideia-audio/']`; the check becomes `some(p => key.startsWith(p))`.
  Manual deploy (no CI), see rollout.
- `post-media-cleanup-cron/orphan-scan.ts`: add
  `{ prefix: "ideia-audio/", refs: [{ table: "ideias", columns: ["audio_r2_key"] }] }` to
  `SCAN_TARGETS` and `"ideias"` to the `ScanTable` union.

### 2.5 MCP

`list_ideas` select adds `origem, visivel_no_hub, audio_transcript`. Read-only; no new tool.

---

## 3. CRM

### 3.1 Store (`apps/crm/src/store/ideias.ts`)

- `Ideia` gains `origem: 'cliente' | 'agencia'`, `autor_membro_id: number | null`,
  `visivel_no_hub: boolean`, `autor: { nome: string } | null`, and the seven audio fields
  (`audio_r2_key`, `audio_transcription_status`, `audio_duration_seconds`, `audio_transcript`,
  and the rest typed but unused by the UI).
- `getIdeias` select adds those columns and `autor:membros!autor_membro_id(nome)`.
- New `createIdeia({ cliente_id, titulo, descricao, links, visivel_no_hub, autor_membro_id })`
  → inserts `{ workspace_id: await getContaId(), origem: 'agencia', tipo: 'ideia', status: 'nova', ...fields }`
  and returns the row id. `workspace_id` is NOT NULL with no default, so the store resolves it
  from the profile like the tarefas store does. Direct Supabase insert; RLS insert policy, the
  `feature_ideas` plan trigger and the new composite FKs apply.
- New `updateIdeiaVisibilidade(ideiaId, visivel)` → `update({ visivel_no_hub })`.

### 3.2 Service (`apps/crm/src/services/ideiaAudio.ts`, new)

Mirrors `apps/hub/src/services/briefingAudio.ts` against `ideia-media-manage`:
`fetchIdeiaAudio(ideiaId)`, `uploadIdeiaAudio({ ideiaId, blob, mime, durationSeconds, onPhase })`
(presign → PUT → finalize), `retryIdeiaTranscription(ideiaId)`, `deleteIdeiaAudio(ideiaId)`.
The CRM's `services/ideiaMedia.ts` has a private `putToR2(url, file: File)`; it becomes
`export function putToR2(url: string, body: Blob, contentType: string)` (the image callers pass
`file.type`), matching the Hub's exported helper. Mime/size validation, `pickRecorderMime`,
`MAX_AUDIO_SECONDS`, `MAX_AUDIO_BYTES` and `describeAudioError` move to a shared module
`packages/ui/audio/validation.ts` (pure TypeScript, no `@/` imports) so both apps and the shared
recorder import one copy. `describeAudioError` gains the `ideia_not_found` / "Ideia não
encontrada." mapping → "Esta ideia não está mais disponível. Recarregue a página.".

### 3.3 Shared recorder (`packages/ui/AudioRecorder/index.tsx`, moved from the Hub)

The Hub's `AudioRecorder` moves to `packages/ui` next to `AudioPlayer`, keeping its props
(`phase`, `disabled`, `onRecorded`) and behaviour. Its imports of `MAX_AUDIO_SECONDS` and
`pickRecorderMime` from the Hub service are re-pointed at `packages/ui/audio/validation.ts`, and
`AudioPlayer` is imported relatively (`../AudioPlayer`).

**Hand-off contract (unchanged from today):** the recorder owns record → preview; `onRecorded`
fires only when the user confirms the preview, and the recorder then resets to idle. Two new
optional props: `sendLabel` (default "Enviar") and `hint` (default "Até 5:00 por resposta."). The
create dialogs pass `sendLabel="Usar este áudio"`, resolve `onRecorded` immediately by holding
`{ blob, mime, durationSeconds }` in their own state, and render their own held state (player +
"Gravar novamente" + "Descartar") while the recorder sits idle. The Hub briefing page keeps the
defaults and its upload-in-`onRecorded` behaviour. Hub-only classes are replaced by the same
CSS-variable contract the player uses, extended with variables for the buttons and text:
`--audio-btn-bg`, `--audio-btn-fg` (primary, already used by the player),
`--audio-btn2-bg`, `--audio-btn2-fg`, `--audio-btn2-bd` (secondary), `--audio-track`,
`--audio-fill`, `--audio-muted` (hint text), `--audio-radius`. `HUB_AUDIO_VARS` and
`CRM_AUDIO_VARS` are extended to cover them. The Hub's briefing page and its tests import from
the new path; `apps/hub/src/components/AudioRecorder.tsx` is deleted.

Ideias pass `hint="Até 5:00."`.

### 3.4 Ideias page (`pages/ideias/IdeiasPage.tsx`)

- Header: "Nova ideia" button, `variant="default"`, shown when `can('ideias','editar')`.
- Table: new column "Origem" between Tipo and Status, rendering a badge (Cliente / Agência). For
  agency rows with `visivel_no_hub = false`, an `EyeOff` icon with tooltip "Oculta do Hub" next
  to the badge.
- Tooltip on the page title updated: "Ideias enviadas pelos clientes no portal ou criadas pela
  equipe."

### 3.5 Create dialog (`components/ideias/NovaIdeiaDialog.tsx`, new)

shadcn `Dialog`, `react-hook-form` + `zod`:

- Fields: cliente (Select, required, sorted pt-BR), título (required, max 200), descrição
  (required), links (repeatable; empty rows dropped; each remaining value must parse as an
  absolute `http:` or `https:` URL, else the row shows "Informe um link completo, começando
  com https://" and blocks submit). The Hub renders links with `sanitizeExternalUrl`, which
  rejects relative URLs, so only absolute HTTP(S) links are stored.
- "Visível no Hub do cliente" `Switch`, default off, with the two-state hint from the mockup.
- Áudio block: `AudioRecorder` with `sendLabel="Usar este áudio"`, `hint="Até 5:00."`. On
  `onRecorded` the dialog stores `{ blob, mime, durationSeconds }` in state (resolving at once)
  and renders its held state: `AudioPlayer` on an object URL, "Gravar novamente" (shows the
  recorder again) and "Descartar". Hidden when `!isRecordingSupported()` or the workspace lacks
  `feature_briefing_audio` (from `useWorkspaceLimits`).
- Submit: `createIdeia` → if a recording is held, `uploadIdeiaAudio` with phase feedback on the
  button ("Enviando áudio…", "Transcrevendo…"). Audio failure after a successful create shows a
  toast "Ideia criada, mas o áudio falhou. Abra a ideia para tentar de novo." and still closes.
  Invalidates `['hub-ideias-all']` and `['ideias']`; opens the drawer on the new row.

### 3.6 Drawer (`components/ideias/IdeiaDrawer.tsx`)

- Header badges add the Origem badge; meta line adds "· por {autor.nome}" for agency rows.
- New block (agency rows only, `can('ideias','editar')`): "Visível no Hub do cliente" switch →
  `updateIdeiaVisibilidade`, optimistic, toast on error.
- New block "Áudio", rendered when `audio_r2_key` is set **or** the row is agency-origin and the
  user may edit:
  - Player via `AudioPlayer` with the signed URL from `fetchIdeiaAudio` (TanStack Query keyed
    `['ideia-audio', id, audio_r2_key, audio_transcription_status]`, `staleTime` 30 min).
  - Status badge: Transcrito / Transcrição pendente / Falha na transcrição, with "Tentar
    novamente" on failure.
  - Transcript box under the player when `audio_transcript` is set.
  - Agency rows with edit permission: `AudioRecorder` ("Gravar novamente" when audio exists) and
    "Remover áudio" (confirm via `AlertDialog`). Client rows: play only.

### 3.7 Client detail tab

The client-detail Ideias tab reuses the drawer, so it gets the drawer changes for free. It does
not get a create button in this iteration.

---

## 4. Hub

### 4.1 Types and API (`apps/hub/src/types.ts`, `apps/hub/src/api.ts`)

- `HubIdeia` gains `origem: 'cliente' | 'agencia'` and `audio: HubAudio | null` (same shape as
  `BriefingAudio`; rename that type to `HubAudio` with a `BriefingAudio` alias kept).
- New wrappers: `presignIdeiaAudio`, `finalizeIdeiaAudio`, `retryIdeiaTranscription`,
  `deleteIdeiaAudio`.

### 4.2 Service (`apps/hub/src/services/ideiaAudio.ts`, new)

`uploadIdeiaAudio({ token, ideiaId, blob, mime, durationSeconds, onPhase })` wrapped in
`trackUnsavedWork`, same shape as `uploadBriefingAudio`. Validation and error copy from the shared
`packages/ui/audio/validation.ts`.

### 4.3 Ideias page (`apps/hub/src/pages/IdeiasPage.tsx`)

- `audioEnabled = bootstrap.feature_briefing_audio === true`.
- `isMutable(ideia)` additionally requires `ideia.origem === 'cliente'`.
- Create modal: Áudio block below Descrição (mockup), rendered when
  `audioEnabled && isRecordingSupported()`, using the same held-state contract as the CRM dialog
  (`sendLabel="Usar este áudio"`, blob kept in modal state, player + "Gravar novamente" +
  "Descartar"). After `createIdeia` succeeds, `uploadIdeiaAudio` runs with phase feedback on
  the submit button. Failure after
  create: toast "Ideia enviada, mas o áudio falhou. Tente de novo no card." and close.
- Card:
  - Agency rows: chip "Sugestão da agência"; no Editar / Excluir.
  - Audio section when `ideia.audio` is set: label "Áudio · {status}", `AudioPlayer`, transcript
    box when `transcript` present, "Tentar novamente" on `failed` (only when `audioEnabled`).
  - Client rows that satisfy `isMutable`: "Gravar novamente" (recorder inline, replaces on send)
    and "Remover áudio". These are gated by `isMutable`, not only by origin, so a client cannot
    swap the audio after the agency has already reacted or replied. (This is stricter than the
    server, which only checks origin; the server rule stays simple and the UI rule is the
    product choice.)

---

## 5. Error handling

- All new edge routes return generic messages; details go to logs.
- Hub 404 for any write against an agency-origin row (see 2.2).
- Transcription failure never fails the upload: the row stays with status `failed` and both apps
  offer retry.
- Missing `TRANSCRIBE_WORKER_URL` / `TRANSCRIBE_SECRET` → `makeWorkerTranscriber` returns null →
  status `failed`, same as briefing.
- Worker not yet redeployed with the new prefix → worker returns 400 → transcriber yields null →
  status `failed`, retry works after the deploy.
- `visivel_no_hub = false` on a client row is rejected by the CHECK; the CRM never offers the
  switch there, and the store function is not called for client rows.

---

## 6. Testing

Deno (`supabase/functions/__tests__/`):
- `ideia-audio_test.ts`: presign validation (415/400/404/413), origin mismatch → 404, finalize
  prefix/size/content-type checks, RPC error mapping, transcription success / empty / throw /
  orphan key, remove, `loadIdeiaAudioView` stale-pending.
- `hub-ideias_test.ts`: GET filters `visivel_no_hub`, returns `origem` + `audio`; PATCH / DELETE /
  image routes 404 on agency rows; the four audio routes (auth, plan gate 403, rate limit,
  happy path); create ignores `origem` / `visivel_no_hub` in the body. Update the existing
  "GET select includes tipo and tarefa_id" assertion.
- `ideia-media-manage_test.ts`: the five audio routes, 401/403 paths, origin enforcement.
- `orphan-scan_test.ts`: new target present and scanned.
- `mcp` queries test: select string includes the new columns.

SQL (`supabase/tests/ideia_audio_rpcs.sql`, picked up by `scripts/test-entitlements.sh`):
finalize reserve / idempotent / replace decrements once / over-quota / `invalid_key` /
`ideia_not_found` on wrong origin / release / row DELETE enqueues / tenant CHECK / guard blocks
`authenticated` on `audio_*` while `status` and `visivel_no_hub` stay writable / apply_transcript
does not touch `descricao` / `ideias_cliente_visivel_check` rejects hidden client rows /
notification trigger skips `agencia`.

Vitest:
- `apps/crm/src/__tests__/store.ideias.test.ts`: `createIdeia` insert shape, `updateIdeiaVisibilidade`, select includes new columns.
- `apps/crm/src/components/ideias/__tests__/NovaIdeiaDialog.test.tsx`: validation, submit
  without audio, submit with audio (upload called after create), audio failure toast, gate
  hides recorder.
- `apps/crm/src/components/ideias/__tests__/IdeiaDrawer.test.tsx`: origin badge + author line,
  visibility switch only on agency rows, audio block states, recorder only on agency rows.
- `apps/crm/src/services/__tests__/ideiaAudio.test.ts`.
- `packages/ui/AudioRecorder/__tests__/index.test.tsx`: the existing 11 cases moved, plus the
  `hint` prop.
- `apps/hub/src/pages/__tests__/ideiasPage.test.tsx`: agency card read-only + chip, audio in
  modal (held then uploaded after create), card player / retry / re-record / remove gating,
  plan gate hides recorder.
- `apps/hub/src/services/__tests__/ideiaAudio.test.ts`, `apps/hub/src/__tests__/api.test.ts`.

Worker: `workers/transcribe/src/index.test.ts` gains prefix allowlist cases (run locally).

---

## 7. Rollout

1. Re-verify the migration version prefix against `origin/main` at PR-open time.
2. Apply the migration to staging, then prod (`npx supabase db push --linked`, before merge, per
   house rule: merge deploys the frontend immediately).
3. Deploy the transcribe worker (`cd workers/transcribe && npx wrangler deploy`, manual).
4. Deploy edge functions with `--use-api`: `hub-ideias` (`--no-verify-jwt`), `ideia-media-manage`
   (`--no-verify-jwt`), `post-media-cleanup-cron` (`--no-verify-jwt`), `mcp`.
5. Merge. Vercel builds CRM + Hub.
6. Smoke: create an agency ideia hidden from the Hub, confirm it is absent from the client's
   portal; flip visibility, confirm it appears read-only; record audio on both sides and confirm
   the transcript; delete the ideia and confirm a `post_media_deletions` row for its key.

### Rollback

The migration is additive and stays in place on any rollback; only the edge functions and the
frontends are reverted. Reverted functions have no audio routes, so no new objects land under
`ideia-audio/`, and objects already uploaded remain referenced by `ideias.audio_r2_key`, which
keeps the orphan scan from touching them and keeps `storage_used_bytes` consistent. If the
columns ever have to be dropped, run first, as service role:
`UPDATE ideias SET audio_r2_key = NULL, audio_size_bytes = NULL, audio_mime = NULL,
audio_duration_seconds = NULL, audio_transcript = NULL, audio_transcription_status = NULL,
audio_recorded_at = NULL WHERE audio_r2_key IS NOT NULL;` so the after-change trigger queues
every key into `post_media_deletions` and refunds the quota, then drop the columns. A rollout
that stops after step 2 (schema applied, functions not deployed) is safe for the same reason:
nothing can upload, and the Hub still serves the old function.

Until step 3 is done, ideia recordings save with status `failed` and retry succeeds after the
worker deploy. Until step 4, the CRM and Hub bundles hit old functions: the create dialog works
(direct insert), the audio blocks 404 gracefully, and the Hub still shows all rows (the
visibility filter lives in `hub-ideias`). Therefore steps 2 to 4 must complete before step 5.
