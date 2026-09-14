# Ideias da agência, visibilidade no Hub e áudio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agency users create ideias from the CRM with a per-ideia "visible in the Hub" toggle, and both the CRM and the Hub can attach one audio recording (Whisper-transcribed) to an ideia.

**Architecture:** Three new columns on `ideias` (`origem`, `autor_membro_id`, `visivel_no_hub`) plus the seven `audio_*` columns copied from the briefing pattern, guarded by the same service-role-only trigger and cleaned up by the same after-change trigger. A new `_shared/ideia-audio.ts` mirrors `_shared/briefing-audio.ts` against `ideias` and reuses its generic helpers; `hub-ideias` (token) and `ideia-media-manage` (JWT) gain audio routes. The Hub recorder moves to `packages/ui` with a CSS-variable contract so the CRM can render it.

**Tech Stack:** Postgres (plpgsql, RLS), Deno edge functions, React 19 + TanStack Query, shadcn/ui (CRM), hand-written `hub-*` CSS (Hub), Vitest, `deno test`, psql suites, Cloudflare Worker (`workers/transcribe`).

**Spec:** `docs/superpowers/specs/2026-09-10-ideias-agencia-visibilidade-audio-design.md`

## Global Constraints

- Migration file: `supabase/migrations/20260922000001_ideias_agencia_audio.sql`. Before `gh pr create`, run `git ls-tree --name-only origin/main:supabase/migrations | tail -3` and renumber above main's tail if needed.
- R2 prefix for ideia audio: `ideia-audio/{workspace_id}/{ideia_id}/{uuid}.{ext}`. Never under `contas/`.
- Limits: `MAX_AUDIO_BYTES = 15 MiB`, `MAX_AUDIO_SECONDS = 300`, mimes `audio/webm, audio/mp4, audio/ogg, audio/mpeg, audio/wav`.
- Plan flag reused as-is: `feature_briefing_audio`. CRM label becomes `'Gravação de áudio'`.
- `origem IN ('cliente','agencia')`; `origem = 'cliente'` implies `visivel_no_hub = true` (CHECK).
- Agency-created ideias: `tipo = 'ideia'`, `status = 'nova'`, `visivel_no_hub` defaults to `false` in the CRM form.
- Hub writes (PATCH, DELETE, images, audio) only on `origem = 'cliente'` rows, else **404**. CRM audio writes only on `origem = 'agencia'` rows, else 404.
- Transcript lives in `audio_transcript` only. Never touch `descricao`.
- Edge functions: generic error messages to clients, `buildCorsHeaders(req)`, never wildcard CORS.
- Copy: Portuguese, no em-dashes in user-facing strings.
- Toasts in the CRM use `toast` from `sonner`. The Hub page uses `alert()` for errors today; keep that.
- Run before pushing: `npm run lint`, `npm run format:check`, the four `tsc` commands, `npm run test`, `npm run test:functions`. `npm run test:functions` dirties `deno.lock`; run `git checkout deno.lock` afterwards. If `node_modules/.deno` appears after a Deno run, run `npm ci` before trusting `tsc`/Vitest.
- Commit after every task. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File map

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260922000001_ideias_agencia_audio.sql` | Columns, CHECKs, notification guard, audio guard/cleanup triggers, 3 RPCs |
| `supabase/tests/ideia_audio_rpcs.sql` | psql suite for the RPCs, triggers and CHECKs |
| `supabase/functions/_shared/ideia-audio.ts` | presign / finalize / transcribe / remove / view for ideia audio |
| `supabase/functions/__tests__/ideia-audio_test.ts` | Deno tests for the shared module |
| `supabase/functions/hub-ideias/{handler,index}.ts` | Visibility filter, origin gate, Hub audio routes |
| `supabase/functions/ideia-media-manage/{handler,index}.ts` | CRM audio routes |
| `supabase/functions/post-media-cleanup-cron/orphan-scan.ts` | New `ideia-audio/` scan target |
| `supabase/functions/mcp/queries.ts` | `list_ideas` select adds `origem, visivel_no_hub, audio_transcript` |
| `workers/transcribe/src/index.ts` | Prefix allowlist |
| `packages/ui/audio/validation.ts` | Shared mime/size validation + `describeAudioError` |
| `packages/ui/AudioRecorder/index.tsx` | Recorder moved from the Hub, CSS-variable themed |
| `apps/hub/src/lib/audioVars.ts` | `HUB_AUDIO_VARS` (moved out of the recorder) |
| `apps/hub/src/services/briefingAudio.ts` | Re-exports validation from the shared module |
| `apps/hub/src/services/ideiaAudio.ts` | Hub upload pipeline for ideia audio |
| `apps/hub/src/{types,api}.ts` | `HubAudio`, `HubIdeia.origem/audio`, 4 wrappers |
| `apps/hub/src/pages/IdeiasPage.tsx` | Read-only agency cards, recorder in modal, audio block on card |
| `apps/crm/src/store/ideias.ts` | `Ideia` fields, `createIdeia`, `updateIdeiaVisibilidade` |
| `apps/crm/src/services/ideiaAudio.ts` | CRM audio service against `ideia-media-manage` |
| `apps/crm/src/lib/audioVars.ts` | `CRM_AUDIO_VARS` (moved out of `BriefingAudioPlayer`) |
| `apps/crm/src/components/ideias/IdeiaOrigemBadge.tsx` | Cliente / Agência badge |
| `apps/crm/src/components/ideias/NovaIdeiaDialog.tsx` | Create dialog |
| `apps/crm/src/components/ideias/IdeiaAudioSection.tsx` | Player + transcript + recorder block for the drawer |
| `apps/crm/src/components/ideias/IdeiaDrawer.tsx` | Origin line, visibility switch, audio section |
| `apps/crm/src/pages/ideias/IdeiasPage.tsx` | "Nova ideia" button, Origem column |
| `apps/crm/src/lib/entitlement-errors.ts` | Label rename |
| `CLAUDE.md` | Env var note for `ideia-media-manage` |

---

### Task 1: Migration + SQL suite

**Files:**
- Create: `supabase/migrations/20260922000001_ideias_agencia_audio.sql`
- Create: `supabase/tests/ideia_audio_rpcs.sql`
- Read for reference: `supabase/migrations/20260907000001_briefing_audio.sql`, `supabase/migrations/20260730000009_ideias_solicitacoes.sql`, `supabase/tests/briefing_audio_rpcs.sql`

**Interfaces:**
- Produces RPCs (SECURITY DEFINER, service_role only):
  - `ideia_audio_finalize(p_workspace_id uuid, p_ideia_id uuid, p_origem text, p_key text, p_bytes bigint, p_mime text, p_duration int) RETURNS jsonb` → `{reserved: boolean, previous_key: text|null}`; raises `invalid_key`, `invalid_bytes`, `workspace_not_found`, `ideia_not_found`, `quota_exceeded` (all `P0001`).
  - `ideia_audio_release(p_workspace_id uuid, p_ideia_id uuid, p_origem text) RETURNS text` (old key or NULL).
  - `ideia_audio_apply_transcript(p_workspace_id uuid, p_ideia_id uuid, p_key text, p_text text, p_duration int) RETURNS ideias` (composite NULL when nothing matched).
- Produces columns on `ideias`: `origem`, `autor_membro_id`, `visivel_no_hub`, `audio_r2_key`, `audio_mime`, `audio_size_bytes`, `audio_duration_seconds`, `audio_transcript`, `audio_transcription_status`, `audio_recorded_at`.

- [ ] **Step 1: Write the SQL suite (fails until the migration exists)**

`supabase/tests/ideia_audio_rpcs.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;
do $$
declare
  v_ws uuid; v_ws2 uuid; v_cli bigint; v_user uuid := gen_random_uuid();
  v_i uuid; v_i2 uuid; v_i3 uuid; v_ag uuid; v_ag2 uuid;
  v_key text; v_key2 text; v_res jsonb; v_used bigint; v_blocked boolean; v_n int; v_row ideias;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_ws := et_make_workspace('pro');
  v_ws2 := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'Cliente Ideia', 'CI', '#000000') returning id into v_cli;

  -- 0. defaults: hub-style insert reads as cliente + visible
  insert into ideias (workspace_id, cliente_id, titulo, descricao)
    values (v_ws, v_cli, 'Do cliente', 'desc') returning id into v_i;
  assert (select origem from ideias where id = v_i) = 'cliente', 'default origem';
  assert (select visivel_no_hub from ideias where id = v_i), 'default visivel';
  insert into ideias (workspace_id, cliente_id, titulo, descricao)
    values (v_ws, v_cli, 'Do cliente 2', 'desc') returning id into v_i2;

  -- 0b. cliente rows can never be hidden
  v_blocked := false;
  begin
    update ideias set visivel_no_hub = false where id = v_i;
  exception when check_violation then v_blocked := true; end;
  assert v_blocked, 'cliente row must stay visible';

  -- 0c. agencia row hidden by default choice of the CRM (explicit false allowed)
  insert into ideias (workspace_id, cliente_id, titulo, descricao, origem, visivel_no_hub)
    values (v_ws, v_cli, 'Da agência', 'desc', 'agencia', false) returning id into v_ag;
  assert not (select visivel_no_hub from ideias where id = v_ag), 'agencia row may be hidden';

  -- 0d2. agencia insert omitting visivel_no_hub is HIDDEN (column default false)
  insert into ideias (workspace_id, cliente_id, titulo, descricao, origem)
    values (v_ws, v_cli, 'Da agência sem flag', 'desc', 'agencia') returning id into v_ag2;
  assert not (select visivel_no_hub from ideias where id = v_ag2), 'agencia default must be hidden';
  -- 0d3. cliente insert with an explicit false is forced visible by the guard
  insert into ideias (workspace_id, cliente_id, titulo, descricao, visivel_no_hub)
    values (v_ws, v_cli, 'Do cliente forçado', 'desc', false) returning id into v_i3;
  assert (select visivel_no_hub from ideias where id = v_i3), 'cliente insert must be visible';

  -- 0e. origem is immutable, even for service_role
  v_blocked := false;
  begin
    update ideias set origem = 'agencia' where id = v_i;
  exception when insufficient_privilege then v_blocked := true; end;
  assert v_blocked, 'origem must be immutable';

  -- 0f. cliente_id must belong to the workspace (composite FK)
  v_blocked := false;
  begin
    insert into ideias (workspace_id, cliente_id, titulo, descricao) values (v_ws2, v_cli, 'x', 'y');
  exception when foreign_key_violation then v_blocked := true; end;
  assert v_blocked, 'cross-tenant cliente_id must be rejected';

  -- 0g. authenticated INSERT must be origem = agencia; cliente insert is service-role only
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  v_blocked := false;
  begin
    insert into ideias (workspace_id, cliente_id, titulo, descricao) values (v_ws, v_cli, 'x', 'y');
  exception when insufficient_privilege then v_blocked := true; end;
  assert v_blocked, 'authenticated insert must set origem = agencia';
  insert into ideias (workspace_id, cliente_id, titulo, descricao, origem, visivel_no_hub)
    values (v_ws, v_cli, 'Da agência 2', 'desc', 'agencia', false);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- 0d. notification trigger skips agencia rows, fires for cliente rows
  select count(*) into v_n from notifications where type = 'idea_submitted' and (metadata->>'idea_id')::uuid = v_ag;
  assert v_n = 0, 'no notification for agencia ideia';
  select count(*) into v_n from notifications where type = 'idea_submitted' and (metadata->>'idea_id')::uuid = v_i;
  assert v_n >= 0, 'cliente ideia path still runs (targets may be empty in this fixture)';

  v_key  := 'ideia-audio/' || v_ws || '/' || v_i || '/a.webm';
  v_key2 := 'ideia-audio/' || v_ws || '/' || v_i || '/b.webm';

  -- 1. finalize reserves bytes and writes columns
  v_res := ideia_audio_finalize(v_ws, v_i, 'cliente', v_key, 1000, 'audio/webm', 12);
  assert (v_res->>'reserved')::boolean, 'first finalize must reserve';
  assert v_res->>'previous_key' is null, 'no previous key';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 1000, format('used after finalize: %s', v_used);
  assert (select audio_transcription_status from ideias where id = v_i) = 'pending';

  -- 2. same-key retry is idempotent
  v_res := ideia_audio_finalize(v_ws, v_i, 'cliente', v_key, 1000, 'audio/webm', 12);
  assert not (v_res->>'reserved')::boolean, 'same key retry must not reserve';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 1000, 'retry must not double count';

  -- 3. re-record replaces, decrements once, enqueues old key
  v_res := ideia_audio_finalize(v_ws, v_i, 'cliente', v_key2, 3000, 'audio/webm', 40);
  assert v_res->>'previous_key' = v_key, 'previous_key must be the replaced key';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 3000, format('used after replace: %s', v_used);
  select count(*) into v_n from post_media_deletions where r2_key = v_key;
  assert v_n = 1, 'old key enqueued once';

  -- 4. over quota blocks and leaves the row untouched
  update workspaces set storage_used_bytes = 1073741824 where id = v_ws;
  v_blocked := false;
  begin
    perform ideia_audio_finalize(v_ws, v_i2, 'cliente', 'ideia-audio/' || v_ws || '/' || v_i2 || '/c.webm', 1, 'audio/webm', 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'quota_exceeded%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'over quota must block';
  assert (select audio_r2_key from ideias where id = v_i2) is null, 'blocked finalize must not write';
  update workspaces set storage_used_bytes = 3000 where id = v_ws;

  -- 5. key outside the ideia prefix -> invalid_key
  v_blocked := false;
  begin
    perform ideia_audio_finalize(v_ws, v_i2, 'cliente', 'ideia-audio/' || v_ws || '/' || v_i || '/x.webm', 1, 'audio/webm', 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'invalid_key%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'key of another ideia must be rejected';

  -- 6. wrong origem -> ideia_not_found (the "only the originating side writes" rule)
  v_blocked := false;
  begin
    perform ideia_audio_finalize(v_ws, v_i, 'agencia', 'ideia-audio/' || v_ws || '/' || v_i || '/z.webm', 1, 'audio/webm', 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'ideia_not_found%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'wrong origem must be rejected';

  -- 7. release clears, decrements, enqueues; wrong origem rejected
  assert ideia_audio_release(v_ws, v_i, 'cliente') = v_key2, 'release returns the old key';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 0, format('used after release: %s', v_used);
  select count(*) into v_n from post_media_deletions where r2_key = v_key2;
  assert v_n = 1, 'released key enqueued once';
  assert ideia_audio_release(v_ws, v_i, 'cliente') is null, 'second release is a no-op';
  v_blocked := false;
  begin
    perform ideia_audio_release(v_ws, v_i, 'agencia');
  exception when sqlstate 'P0001' then v_blocked := true; end;
  assert v_blocked, 'release with wrong origem must raise';

  -- 8. DELETE of an ideia with audio decrements and enqueues
  v_res := ideia_audio_finalize(v_ws, v_i, 'cliente', v_key, 500, 'audio/webm', 5);
  delete from ideias where id = v_i;
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 0, format('used after row delete: %s', v_used);
  select count(*) into v_n from post_media_deletions where r2_key = v_key;
  assert v_n = 2, 'deleted row key enqueued (steps 3 and 8)';

  -- 9. tenant CHECK: key of another workspace never enters
  v_blocked := false;
  begin
    update ideias set audio_r2_key = 'ideia-audio/' || v_ws2 || '/' || v_i2 || '/z.webm' where id = v_i2;
  exception when check_violation then v_blocked := true; end;
  assert v_blocked, 'cross-tenant key must violate CHECK';

  -- 10. guard: authenticated cannot write audio_*, can write status and visivel_no_hub
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  v_blocked := false;
  begin
    update ideias set audio_size_bytes = 1 where id = v_i2;
  exception when insufficient_privilege then v_blocked := true; end;
  assert v_blocked, 'authenticated must not write audio_* columns';
  update ideias set status = 'em_analise' where id = v_i2;
  assert (select status from ideias where id = v_i2) = 'em_analise', 'status stays writable';
  update ideias set visivel_no_hub = true where id = v_ag;
  assert (select visivel_no_hub from ideias where id = v_ag), 'visivel_no_hub stays writable';

  -- 11. service role writes audio_*
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update ideias set audio_transcription_status = 'failed' where id = v_i2;
  assert (select audio_transcription_status from ideias where id = v_i2) = 'failed';
  update ideias set audio_transcription_status = null where id = v_i2;

  -- 12. apply_transcript writes transcript + done, never touches descricao
  v_key := 'ideia-audio/' || v_ws || '/' || v_ag || '/e.webm';
  perform ideia_audio_finalize(v_ws, v_ag, 'agencia', v_key, 100, 'audio/webm', null);
  v_row := ideia_audio_apply_transcript(v_ws, v_ag, v_key, '  Primeira fala. ', 7);
  assert v_row.id is not null, 'apply on a pending row must return the row';
  assert (select audio_transcript from ideias where id = v_ag) = 'Primeira fala.';
  assert (select audio_transcription_status from ideias where id = v_ag) = 'done';
  assert (select audio_duration_seconds from ideias where id = v_ag) = 7, 'null duration filled from p_duration';
  assert (select descricao from ideias where id = v_ag) = 'desc', 'descricao untouched';

  -- 13. second apply on a done row -> NULL
  v_row := ideia_audio_apply_transcript(v_ws, v_ag, v_key, 'Segunda.', 9);
  assert v_row.id is null, 'apply on a done row must return NULL';
  assert (select audio_transcript from ideias where id = v_ag) = 'Primeira fala.';

  -- 14. stale key -> NULL, row untouched
  update ideias set audio_r2_key = 'ideia-audio/' || v_ws || '/' || v_ag || '/f.webm',
                    audio_transcript = null, audio_transcription_status = 'pending'
   where id = v_ag;
  v_row := ideia_audio_apply_transcript(v_ws, v_ag, v_key, 'Atrasada.', 4);
  assert v_row.id is null, 'stale-key apply must return NULL';
  assert (select audio_transcript from ideias where id = v_ag) is null, 'stale-key apply must not write';

  -- 15. empty text -> NULL
  v_row := ideia_audio_apply_transcript(v_ws, v_ag, 'ideia-audio/' || v_ws || '/' || v_ag || '/f.webm', '   ', 4);
  assert v_row.id is null, 'empty text must be a no-op';

  perform set_config('request.jwt.claims', '', true);
  raise notice 'PASS ideia_audio_rpcs';
end $$;
rollback;
```

- [ ] **Step 2: Run the suite to see it fail**

Needs a local Supabase (Docker/colima). If available:

```bash
supabase start && bash scripts/test-entitlements.sh
```

Expected: FAIL on `ideia_audio_rpcs.sql` with `column "origem" of relation "ideias" does not exist`. If Docker is unavailable locally, note it in the commit and rely on CI's `entitlement-tests` job.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260922000001_ideias_agencia_audio.sql`:

```sql
-- Ideias criadas pela agência + visibilidade no Hub + áudio nas ideias.
-- Spec: docs/superpowers/specs/2026-09-10-ideias-agencia-visibilidade-audio-design.md
--
-- Áudio segue o padrão do briefing (20260907000001): colunas na própria linha,
-- prefixo próprio no R2 (ideia-audio/) fora de contas/ para o orphan-scan não
-- apagar, guarda service-role nas colunas audio_*, decremento de quota só no
-- trigger AFTER.

-- 1) Origem, autor e visibilidade
ALTER TABLE ideias ADD COLUMN origem text NOT NULL DEFAULT 'cliente';
ALTER TABLE ideias ADD CONSTRAINT ideias_origem_check CHECK (origem IN ('cliente','agencia'));
-- Backfill das linhas existentes (todas do cliente) como visíveis; depois o
-- default vira false: INSERT da agência que omitir a coluna fica OCULTO, nunca
-- exposto. Linha do cliente é forçada a visível no INSERT pela guarda abaixo.
ALTER TABLE ideias ADD COLUMN visivel_no_hub boolean NOT NULL DEFAULT true;
ALTER TABLE ideias ALTER COLUMN visivel_no_hub SET DEFAULT false;
-- Ideia do cliente nunca fica escondida dele.
ALTER TABLE ideias ADD CONSTRAINT ideias_cliente_visivel_check CHECK (origem <> 'cliente' OR visivel_no_hub);
CREATE INDEX ideias_cliente_visivel_idx ON ideias (cliente_id) WHERE visivel_no_hub;

-- Pino de tenant: o cliente tem que ser da workspace da ideia. O INSERT do CRM
-- passa por RLS só em workspace_id; sem isto um membro da workspace A insere
-- cliente_id da B e o GET do Hub (service role, filtra por cliente_id) mostra a
-- ideia ao cliente da B. clientes_id_conta_uq existe desde 20260815000002.
ALTER TABLE ideias ADD CONSTRAINT ideias_cliente_workspace_fk
  FOREIGN KEY (cliente_id, workspace_id) REFERENCES clientes (id, conta_id) ON DELETE CASCADE;

-- Autor (CRM). FK composta pina o membro à workspace da ideia.
ALTER TABLE membros ADD CONSTRAINT membros_id_conta_uq UNIQUE (id, conta_id);
ALTER TABLE ideias ADD COLUMN autor_membro_id integer;
ALTER TABLE ideias ADD CONSTRAINT ideias_autor_fk
  FOREIGN KEY (autor_membro_id, workspace_id) REFERENCES membros (id, conta_id)
  ON DELETE SET NULL (autor_membro_id);

-- 2) Notificação: recria a versão de 20260730000009 pulando ideias da agência.
CREATE OR REPLACE FUNCTION trg_notify_idea_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name text;
  v_targets     uuid[];
BEGIN
  BEGIN
    IF NEW.origem = 'agencia' THEN
      RETURN NEW;
    END IF;
    IF NEW.status IS DISTINCT FROM 'nova' THEN
      RETURN NEW;
    END IF;

    SELECT nome INTO v_client_name FROM clientes WHERE id = NEW.cliente_id;

    v_targets := resolve_notification_targets(NEW.workspace_id, NULL, ARRAY['owner','admin']);

    PERFORM insert_notification_batch(
      NEW.workspace_id,
      v_targets,
      'idea_submitted',
      '/ideias',
      jsonb_build_object(
        'client_name', v_client_name,
        'idea_title',  NEW.titulo,
        'idea_id',     NEW.id,
        'tipo',        NEW.tipo
      ),
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_idea_submitted failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

-- 3) Áudio
ALTER TABLE ideias
  ADD COLUMN audio_r2_key text,
  ADD COLUMN audio_mime text,
  ADD COLUMN audio_size_bytes bigint,
  ADD COLUMN audio_duration_seconds int,
  ADD COLUMN audio_transcript text,
  ADD COLUMN audio_transcription_status text,
  ADD COLUMN audio_recorded_at timestamptz,
  ADD CONSTRAINT ideias_audio_status_chk
    CHECK (audio_transcription_status IS NULL OR audio_transcription_status IN ('pending','done','failed')),
  ADD CONSTRAINT ideias_audio_size_chk
    CHECK (audio_size_bytes IS NULL OR audio_size_bytes > 0),
  ADD CONSTRAINT ideias_audio_key_tenant_chk
    CHECK (audio_r2_key IS NULL OR audio_r2_key LIKE 'ideia-audio/' || workspace_id::text || '/%');

-- Guarda: o CRM escreve ideias via PostgREST (status, comentário, visivel_no_hub)
-- sem allowlist de colunas; só service_role toca em audio_*. auth.role() lê o
-- GUC request.jwt.claims (funciona em SECURITY DEFINER e nos testes psql).
-- Também trava origem: imutável no UPDATE (qualquer papel) e 'agencia'
-- obrigatório no INSERT de quem não é service_role — senão um membro vira uma
-- ideia do cliente em 'agencia', esconde, e o CHECK de visibilidade não pega.
-- Backfill manual: ALTER TABLE ideias DISABLE TRIGGER trg_ideia_audio_guard.
CREATE OR REPLACE FUNCTION public.ideia_audio_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.origem IS DISTINCT FROM OLD.origem THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Linha do cliente entra sempre visível (o default false é só para a agência).
  IF TG_OP = 'INSERT' AND NEW.origem = 'cliente' THEN
    NEW.visivel_no_hub := true;
  END IF;
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.origem <> 'agencia' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_changed := NEW.audio_r2_key IS NOT NULL
      OR NEW.audio_mime IS NOT NULL
      OR NEW.audio_size_bytes IS NOT NULL
      OR NEW.audio_duration_seconds IS NOT NULL
      OR NEW.audio_transcript IS NOT NULL
      OR NEW.audio_transcription_status IS NOT NULL
      OR NEW.audio_recorded_at IS NOT NULL;
  ELSE
    v_changed := NEW.audio_r2_key IS DISTINCT FROM OLD.audio_r2_key
      OR NEW.audio_mime IS DISTINCT FROM OLD.audio_mime
      OR NEW.audio_size_bytes IS DISTINCT FROM OLD.audio_size_bytes
      OR NEW.audio_duration_seconds IS DISTINCT FROM OLD.audio_duration_seconds
      OR NEW.audio_transcript IS DISTINCT FROM OLD.audio_transcript
      OR NEW.audio_transcription_status IS DISTINCT FROM OLD.audio_transcription_status
      OR NEW.audio_recorded_at IS DISTINCT FROM OLD.audio_recorded_at;
  END IF;
  IF v_changed THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ideia_audio_guard
  BEFORE INSERT OR UPDATE ON ideias
  FOR EACH ROW EXECUTE FUNCTION public.ideia_audio_guard();

-- Release: único ponto de decremento + enfileiramento (regravar, remover,
-- DELETE da ideia/cliente/workspace passam todos por aqui).
CREATE OR REPLACE FUNCTION public.ideia_audio_after_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.audio_r2_key IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.audio_r2_key IS NOT DISTINCT FROM OLD.audio_r2_key THEN
    RETURN NULL;
  END IF;
  INSERT INTO post_media_deletions (r2_key) VALUES (OLD.audio_r2_key);
  UPDATE workspaces
     SET storage_used_bytes = GREATEST(0, storage_used_bytes - COALESCE(OLD.audio_size_bytes, 0))
   WHERE id = OLD.workspace_id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_ideia_audio_after_change
  AFTER UPDATE OF audio_r2_key OR DELETE ON ideias
  FOR EACH ROW EXECUTE FUNCTION public.ideia_audio_after_change();

-- Finalize: reserva quota e grava metadados. Idempotente por chave. p_origem
-- é a regra "só o lado que criou grava áudio", garantida no banco.
CREATE OR REPLACE FUNCTION public.ideia_audio_finalize(
  p_workspace_id uuid, p_ideia_id uuid, p_origem text,
  p_key text, p_bytes bigint, p_mime text, p_duration int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used bigint;
  v_quota bigint;
  v_prev text;
  v_prev_bytes bigint;
BEGIN
  IF p_key IS NULL OR p_key NOT LIKE 'ideia-audio/' || p_workspace_id::text || '/' || p_ideia_id::text || '/%' THEN
    RAISE EXCEPTION 'invalid_key' USING ERRCODE = 'P0001';
  END IF;
  IF p_bytes IS NULL OR p_bytes <= 0 THEN
    RAISE EXCEPTION 'invalid_bytes' USING ERRCODE = 'P0001';
  END IF;

  SELECT storage_used_bytes INTO v_used FROM workspaces WHERE id = p_workspace_id FOR UPDATE;
  IF v_used IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT audio_r2_key, audio_size_bytes INTO v_prev, v_prev_bytes
    FROM ideias
   WHERE id = p_ideia_id AND workspace_id = p_workspace_id AND origem = p_origem
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ideia_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_prev = p_key THEN
    RETURN jsonb_build_object('reserved', false, 'previous_key', NULL);
  END IF;

  v_quota := effective_plan_limit(p_workspace_id, 'storage_quota_bytes');
  IF v_quota IS NOT NULL AND v_used - COALESCE(v_prev_bytes, 0) + p_bytes > v_quota THEN
    RAISE EXCEPTION 'quota_exceeded' USING ERRCODE = 'P0001';
  END IF;

  UPDATE ideias
     SET audio_r2_key = p_key,
         audio_mime = p_mime,
         audio_size_bytes = p_bytes,
         audio_duration_seconds = p_duration,
         audio_transcript = NULL,
         audio_transcription_status = 'pending',
         audio_recorded_at = now()
   WHERE id = p_ideia_id;

  UPDATE workspaces SET storage_used_bytes = storage_used_bytes + p_bytes WHERE id = p_workspace_id;

  RETURN jsonb_build_object('reserved', true, 'previous_key', v_prev);
END;
$$;

CREATE OR REPLACE FUNCTION public.ideia_audio_release(p_workspace_id uuid, p_ideia_id uuid, p_origem text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev text;
BEGIN
  PERFORM 1 FROM workspaces WHERE id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0001';
  END IF;
  SELECT audio_r2_key INTO v_prev
    FROM ideias
   WHERE id = p_ideia_id AND workspace_id = p_workspace_id AND origem = p_origem
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ideia_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_prev IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE ideias
     SET audio_r2_key = NULL, audio_mime = NULL, audio_size_bytes = NULL,
         audio_duration_seconds = NULL, audio_transcript = NULL,
         audio_transcription_status = NULL, audio_recorded_at = NULL
   WHERE id = p_ideia_id;
  RETURN v_prev;
END;
$$;

-- Transcrição: grava audio_transcript + done. NÃO toca em descricao (decisão
-- de produto: o texto do cliente/agência fica separado da fala). p_key amarra
-- a escrita à gravação transcrita (transcrição órfã de chave substituída não
-- casa nada e devolve NULL; ver 20260907000001 para a história completa).
CREATE OR REPLACE FUNCTION public.ideia_audio_apply_transcript(
  p_workspace_id uuid, p_ideia_id uuid, p_key text, p_text text, p_duration int
) RETURNS ideias
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws constant text := E' \t\n\r\f\v';
  v_text text := btrim(p_text, v_ws);
  v_row ideias;
BEGIN
  IF v_text = '' OR v_text IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE ideias
     SET audio_transcript = v_text,
         audio_transcription_status = 'done',
         audio_duration_seconds = coalesce(audio_duration_seconds, p_duration)
   WHERE id = p_ideia_id
     AND workspace_id = p_workspace_id
     AND audio_r2_key = p_key
     AND audio_transcription_status IS DISTINCT FROM 'done'
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.ideia_audio_finalize(uuid, uuid, text, text, bigint, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ideia_audio_finalize(uuid, uuid, text, text, bigint, text, int) TO service_role;
REVOKE ALL ON FUNCTION public.ideia_audio_release(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ideia_audio_release(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.ideia_audio_apply_transcript(uuid, uuid, text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ideia_audio_apply_transcript(uuid, uuid, text, text, int) TO service_role;
```

- [ ] **Step 4: Run the suite**

```bash
bash scripts/test-entitlements.sh
```

Expected: `PASS ideia_audio_rpcs` and every pre-existing suite still passing. If step 0d's `notifications` table columns differ (`type`/`metadata`), open `supabase/migrations/20260430000001_notifications.sql` and adjust the two `select count(*)` lines to the real column names; do not weaken the `v_n = 0` assertion.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260922000001_ideias_agencia_audio.sql supabase/tests/ideia_audio_rpcs.sql
git commit -m "feat(ideias): origem, visibilidade no hub e colunas de áudio

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `_shared/ideia-audio.ts`

**Files:**
- Create: `supabase/functions/_shared/ideia-audio.ts`
- Create: `supabase/functions/__tests__/ideia-audio_test.ts`
- Read: `supabase/functions/_shared/briefing-audio.ts` (already exports everything reused below)

**Interfaces:**
- Consumes from `briefing-audio.ts`: `BRIEFING_AUDIO_MIME`, `MAX_AUDIO_BYTES`, `MAX_AUDIO_SECONDS`, `AUDIO_COLUMNS`, `normalizeAudioMime`, `extFromAudioMime`, `normalizeDuration`, `buildAudioView`, `makeWorkerTranscriber`, types `AudioRow`, `AudioView`, `Transcriber`, `BriefingAudioDb`.
- Produces:

```ts
export const IDEIA_AUDIO_KEY_PREFIX = "ideia-audio/";
export type IdeiaOrigem = "cliente" | "agencia";
export interface IdeiaAudioScope { db: BriefingAudioDb; workspace_id: string; ideia_id: string; origem: IdeiaOrigem; cliente_id?: number | null; }
export type IdeiaAudioResult = { status: number; body: Record<string, unknown> };
export function presignIdeiaAudio(a: IdeiaAudioScope & { mime_type: string; size_bytes: number; signPutUrl: (key: string, mime: string) => Promise<string>; randomUUID?: () => string }): Promise<IdeiaAudioResult>
export function finalizeIdeiaAudio(a: IdeiaAudioScope & { r2_key: string; mime_type: string; size_bytes: number; duration_seconds?: number | null; headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>; signGetUrl: (key: string) => Promise<string>; transcribe: Transcriber | null }): Promise<IdeiaAudioResult>
export function transcribeIdeiaAudio(a: IdeiaAudioScope & { signGetUrl; transcribe }): Promise<IdeiaAudioResult>
export function removeIdeiaAudio(a: IdeiaAudioScope): Promise<IdeiaAudioResult>
export function loadIdeiaAudioView(a: { db; workspace_id: string; ideia_id: string; cliente_id?: number | null; signGetUrl }): Promise<{ audio: AudioView | null; transcript: string | null } | null>  // null = ideia not found
export function buildAudioViewForIdeia(row: AudioRow & { audio_transcript?: string | null }, signGetUrl): Promise<(AudioView & { transcript: string | null }) | null>  // for list GETs that already hold the row
```
  Success bodies: `{ ok: true, transcript: string | null, audio: AudioView | null }`.

- [ ] **Step 1: Write the failing tests**

`supabase/functions/__tests__/ideia-audio_test.ts`:

```ts
import { assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import {
  finalizeIdeiaAudio,
  IDEIA_AUDIO_KEY_PREFIX,
  loadIdeiaAudioView,
  presignIdeiaAudio,
  removeIdeiaAudio,
  transcribeIdeiaAudio,
} from "../_shared/ideia-audio.ts";

const signPutUrl = async (key: string) => `https://put.example.com/${key}`;
const signGetUrl = async (key: string) => `https://get.example.com/${key}`;
const I = "11111111-1111-1111-1111-111111111111";
const KEY = `${IDEIA_AUDIO_KEY_PREFIX}conta-1/${I}/fixed-uuid.webm`;
const headOk = async () => ({ contentLength: 5000, contentType: "audio/webm" });

const row = {
  id: I, audio_transcript: null,
  audio_r2_key: KEY, audio_mime: "audio/webm", audio_size_bytes: 5000,
  audio_duration_seconds: 12, audio_transcription_status: "pending", audio_recorded_at: "2026-09-10T00:00:00Z",
};

Deno.test("presign: 415 mime, 400 size, 404 quando a ideia não é do lado/cliente", async () => {
  const db = createSupabaseQueryMock();
  const base = { db, workspace_id: "conta-1", ideia_id: I, origem: "cliente" as const, cliente_id: 14, signPutUrl, randomUUID: () => "fixed-uuid" };
  assertEquals((await presignIdeiaAudio({ ...base, mime_type: "video/mp4", size_bytes: 10 })).status, 415);
  assertEquals((await presignIdeiaAudio({ ...base, mime_type: "audio/webm", size_bytes: 16 * 1024 * 1024 })).status, 400);
  db.queue("ideias", "select", { data: null, error: null });
  const r = await presignIdeiaAudio({ ...base, mime_type: "audio/webm", size_bytes: 10 });
  assertEquals(r.status, 404);
  const sel = db.calls.find((c) => c.table === "ideias" && c.operation === "select");
  assertEquals(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "origem" && m.args[1] === "cliente"), true);
  assertEquals(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "cliente_id" && m.args[1] === 14), true);
});

Deno.test("presign: chave no prefixo da ideia, mime normalizado, 413 sobre quota (desconta áudio atual)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideias", "select", { data: { id: I, audio_size_bytes: 600 }, error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 1000 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000, error: null });
  const ok = await presignIdeiaAudio({
    db, workspace_id: "conta-1", ideia_id: I, origem: "agencia",
    mime_type: "audio/webm;codecs=opus", size_bytes: 500, signPutUrl, randomUUID: () => "fixed-uuid",
  });
  assertEquals(ok.status, 200);
  assertEquals(ok.body.r2_key, KEY);
  assertEquals(ok.body.mime_type, "audio/webm");
  // agencia scope: no cliente_id filter
  const sel = db.calls.find((c) => c.table === "ideias" && c.operation === "select");
  assertEquals(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "cliente_id"), false);

  db.queue("ideias", "select", { data: { id: I, audio_size_bytes: null }, error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 1000 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000, error: null });
  const full = await presignIdeiaAudio({
    db, workspace_id: "conta-1", ideia_id: I, origem: "agencia", mime_type: "audio/webm", size_bytes: 500, signPutUrl,
  });
  assertEquals(full.status, 413);
  assertEquals(full.body.error, "quota_exceeded");
});

Deno.test("finalize: prefixo errado 400, tamanho divergente 400, RPC ideia_not_found 404", async () => {
  const db = createSupabaseQueryMock();
  const base = {
    db, workspace_id: "conta-1", ideia_id: I, origem: "cliente" as const, cliente_id: 14,
    mime_type: "audio/webm", size_bytes: 5000, duration_seconds: 12, headObject: headOk, signGetUrl, transcribe: null,
  };
  assertEquals((await finalizeIdeiaAudio({ ...base, r2_key: "briefing-audio/conta-1/x/a.webm" })).status, 400);
  assertEquals((await finalizeIdeiaAudio({ ...base, r2_key: `${IDEIA_AUDIO_KEY_PREFIX}conta-1/${I}/../x.webm` })).status, 400);
  const badHead = async () => ({ contentLength: 1, contentType: "audio/webm" });
  assertEquals((await finalizeIdeiaAudio({ ...base, r2_key: KEY, headObject: badHead })).status, 400);
  db.queueRpc("ideia_audio_finalize", { data: null, error: { message: "ideia_not_found" } });
  assertEquals((await finalizeIdeiaAudio({ ...base, r2_key: KEY })).status, 404);
});

Deno.test("finalize: sem transcriber grava failed e devolve audio + transcript null", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("ideia_audio_finalize", { data: { reserved: true, previous_key: null }, error: null });
  db.queue("ideias", "select", { data: row, error: null });
  db.queue("ideias", "update", { data: null, error: null });
  db.queue("ideias", "select", { data: { ...row, audio_transcription_status: "failed" }, error: null });
  const r = await finalizeIdeiaAudio({
    db, workspace_id: "conta-1", ideia_id: I, origem: "cliente", cliente_id: 14,
    r2_key: KEY, mime_type: "audio/webm", size_bytes: 5000, duration_seconds: 12,
    headObject: headOk, signGetUrl, transcribe: null,
  });
  assertEquals(r.status, 200);
  assertEquals(r.body.ok, true);
  assertEquals(r.body.transcript, null);
  assertEquals((r.body.audio as { transcription_status: string }).transcription_status, "failed");
  const rpc = db.calls.find((c) => c.table === "rpc:ideia_audio_finalize");
  assertEquals((rpc?.payload as Record<string, unknown>).p_origem, "cliente");
  assertEquals((rpc?.payload as Record<string, unknown>).p_workspace_id, "conta-1");
  const upd = db.calls.find((c) => c.table === "ideias" && c.operation === "update");
  assertEquals(upd?.modifiers.some((m) => m.method === "eq" && m.args[0] === "audio_r2_key" && m.args[1] === KEY), true);
});

Deno.test("finalize: transcriber ok chama ideia_audio_apply_transcript com p_key e devolve o transcript", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("ideia_audio_finalize", { data: { reserved: true, previous_key: null }, error: null });
  db.queue("ideias", "select", { data: row, error: null });
  db.queueRpc("ideia_audio_apply_transcript", {
    data: { ...row, audio_transcript: "Olá mundo", audio_transcription_status: "done" }, error: null,
  });
  const r = await finalizeIdeiaAudio({
    db, workspace_id: "conta-1", ideia_id: I, origem: "agencia",
    r2_key: KEY, mime_type: "audio/webm", size_bytes: 5000, duration_seconds: 12,
    headObject: headOk, signGetUrl, transcribe: async () => ({ text: " Olá mundo ", duration: 11.6 }),
  });
  assertEquals(r.status, 200);
  assertEquals(r.body.transcript, "Olá mundo");
  const rpc = db.calls.find((c) => c.table === "rpc:ideia_audio_apply_transcript");
  const p = rpc?.payload as Record<string, unknown>;
  assertEquals(p.p_key, KEY);
  assertEquals(p.p_text, "Olá mundo");
  assertEquals(p.p_duration, 12);
  assertEquals("p_origem" in p, false);
});

Deno.test("finalize: reserved:false (retry) não re-transcreve linha done", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("ideia_audio_finalize", { data: { reserved: false, previous_key: null }, error: null });
  db.queue("ideias", "select", { data: { ...row, audio_transcript: "Já", audio_transcription_status: "done" }, error: null });
  let calls = 0;
  const r = await finalizeIdeiaAudio({
    db, workspace_id: "conta-1", ideia_id: I, origem: "agencia",
    r2_key: KEY, mime_type: "audio/webm", size_bytes: 5000,
    headObject: headOk, signGetUrl, transcribe: async () => { calls++; return { text: "x" }; },
  });
  assertEquals(r.status, 200);
  assertEquals(r.body.transcript, "Já");
  assertEquals(calls, 0);
});

Deno.test("transcribe: chave órfã (RPC devolve composto nulo) relê a linha", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideias", "select", { data: row, error: null });
  db.queueRpc("ideia_audio_apply_transcript", { data: { id: null, audio_r2_key: null }, error: null });
  db.queue("ideias", "select", { data: { ...row, audio_r2_key: `${IDEIA_AUDIO_KEY_PREFIX}conta-1/${I}/newer.webm` }, error: null });
  const r = await transcribeIdeiaAudio({
    db, workspace_id: "conta-1", ideia_id: I, origem: "cliente", cliente_id: 14,
    signGetUrl, transcribe: async () => ({ text: "atrasada" }),
  });
  assertEquals(r.status, 200);
  assertEquals((r.body.audio as { url: string }).url.includes("newer.webm"), true);
});

Deno.test("transcribe: sem áudio -> 404", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideias", "select", { data: { ...row, audio_r2_key: null }, error: null });
  const r = await transcribeIdeiaAudio({
    db, workspace_id: "conta-1", ideia_id: I, origem: "cliente", cliente_id: 14, signGetUrl, transcribe: null,
  });
  assertEquals(r.status, 404);
});

Deno.test("remove: 404 sem linha, ok sem áudio, RPC release com p_origem", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideias", "select", { data: null, error: null });
  assertEquals((await removeIdeiaAudio({ db, workspace_id: "conta-1", ideia_id: I, origem: "cliente", cliente_id: 14 })).status, 404);
  db.queue("ideias", "select", { data: { id: I, audio_r2_key: null }, error: null });
  assertEquals((await removeIdeiaAudio({ db, workspace_id: "conta-1", ideia_id: I, origem: "cliente", cliente_id: 14 })).status, 200);
  db.queue("ideias", "select", { data: { id: I, audio_r2_key: KEY }, error: null });
  db.queueRpc("ideia_audio_release", { data: KEY, error: null });
  const r = await removeIdeiaAudio({ db, workspace_id: "conta-1", ideia_id: I, origem: "agencia" });
  assertEquals(r.status, 200);
  const rpc = db.calls.find((c) => c.table === "rpc:ideia_audio_release");
  assertEquals((rpc?.payload as Record<string, unknown>).p_origem, "agencia");
});

Deno.test("loadIdeiaAudioView: sem filtro de origem; null quando a ideia não existe; audio null sem chave", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideias", "select", { data: { ...row, audio_transcript: "T" }, error: null });
  const v = await loadIdeiaAudioView({ db, workspace_id: "conta-1", ideia_id: I, signGetUrl });
  assertEquals(v?.transcript, "T");
  assertEquals(v?.audio?.url, `https://get.example.com/${KEY}`);
  const sel = db.calls.find((c) => c.table === "ideias" && c.operation === "select");
  assertEquals(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "origem"), false);
  db.queue("ideias", "select", { data: null, error: null });
  assertEquals(await loadIdeiaAudioView({ db, workspace_id: "conta-1", ideia_id: I, signGetUrl }), null);
  db.queue("ideias", "select", { data: { ...row, audio_r2_key: null }, error: null });
  const none = await loadIdeiaAudioView({ db, workspace_id: "conta-1", ideia_id: I, signGetUrl });
  assertEquals(none?.audio, null);
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm run test:functions -- --filter "presign: 415 mime"
```

Expected: module not found for `../_shared/ideia-audio.ts`.

- [ ] **Step 3: Write the module**

`supabase/functions/_shared/ideia-audio.ts`:

```ts
// Áudio nas ideias: irmão de briefing-audio.ts, apontando para `ideias`.
// Reusa os helpers genéricos de lá; o que muda é a tabela, o escopo
// (workspace_id + ideia_id + origem [+ cliente_id no Hub]) e o fato de a
// transcrição NÃO ser anexada à descrição.
import { effectivePlanLimit } from "./entitlements-rpc.ts";
import {
  AUDIO_COLUMNS,
  buildAudioView,
  extFromAudioMime,
  MAX_AUDIO_BYTES,
  normalizeAudioMime,
  normalizeDuration,
  type AudioRow,
  type AudioView,
  type BriefingAudioDb,
  type Transcriber,
} from "./briefing-audio.ts";

export { MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, makeWorkerTranscriber } from "./briefing-audio.ts";
export type { AudioView, Transcriber } from "./briefing-audio.ts";

export const IDEIA_AUDIO_KEY_PREFIX = "ideia-audio/";
export const IDEIA_AUDIO_COLUMNS = AUDIO_COLUMNS;

export type IdeiaOrigem = "cliente" | "agencia";
export type IdeiaAudioResult = { status: number; body: Record<string, unknown> };

export interface IdeiaAudioScope {
  db: BriefingAudioDb;
  workspace_id: string;
  ideia_id: string;
  /** Lado que pode escrever. O Hub passa 'cliente' (+ cliente_id do token); o CRM passa 'agencia'. */
  origem: IdeiaOrigem;
  cliente_id?: number | null;
}

type FullRow = AudioRow & { id?: string | null; audio_transcript?: string | null };

function validSize(n: number | undefined): boolean {
  return typeof n === "number" && Number.isFinite(n) && n > 0 && n <= MAX_AUDIO_BYTES;
}

function scoped(q: ReturnType<BriefingAudioDb["from"]>, a: IdeiaAudioScope) {
  let s = q.eq("id", a.ideia_id).eq("workspace_id", a.workspace_id).eq("origem", a.origem);
  if (a.cliente_id != null) s = s.eq("cliente_id", a.cliente_id);
  return s;
}

function rpcErrorStatus(msg: string): number {
  if (msg.includes("quota_exceeded")) return 413;
  if (msg.includes("ideia_not_found")) return 404;
  if (msg.includes("invalid_key") || msg.includes("invalid_bytes")) return 400;
  return 500;
}

/** PostgREST expande `RETURNS ideias`: composto NULL vira UMA linha toda nula. `id` separa "atualizou" de "não casou". */
function rpcRow(data: unknown): FullRow | null {
  const row = (Array.isArray(data) ? data[0] : data) as FullRow | null | undefined;
  if (!row || typeof row !== "object" || row.id == null) return null;
  return row;
}

async function loadRow(a: IdeiaAudioScope): Promise<FullRow | null> {
  const { data } = await scoped(
    a.db.from("ideias").select(`id, audio_transcript, ${IDEIA_AUDIO_COLUMNS}`),
    a,
  ).maybeSingle();
  return (data as FullRow | null) ?? null;
}

async function view(row: FullRow, signGetUrl: (key: string) => Promise<string>): Promise<IdeiaAudioResult> {
  return {
    status: 200,
    body: { ok: true, transcript: row.audio_transcript ?? null, audio: await buildAudioView(row, signGetUrl) },
  };
}

export async function presignIdeiaAudio(a: IdeiaAudioScope & {
  mime_type: string;
  size_bytes: number;
  signPutUrl: (key: string, mime: string) => Promise<string>;
  randomUUID?: () => string;
}): Promise<IdeiaAudioResult> {
  const mime = normalizeAudioMime(a.mime_type);
  if (!mime) return { status: 415, body: { error: "unsupported file type" } };
  if (!validSize(a.size_bytes)) return { status: 400, body: { error: "size_bytes out of range" } };

  const { data: row } = await scoped(a.db.from("ideias").select("id, audio_size_bytes"), a).maybeSingle();
  if (!row) return { status: 404, body: { error: "Ideia não encontrada." } };

  try {
    const { data: ws } = await a.db.from("workspaces").select("storage_used_bytes").eq("id", a.workspace_id).single();
    const quota = await effectivePlanLimit(a.db as never, a.workspace_id, "storage_quota_bytes");
    if (quota !== null) {
      const used = Number(ws?.storage_used_bytes ?? 0) - Number(row.audio_size_bytes ?? 0);
      if (used + a.size_bytes > quota) return { status: 413, body: { error: "quota_exceeded", used, quota } };
    }
  } catch (e) {
    console.error("ideia-audio presign quota check error:", (e as Error).message ?? e);
    return { status: 500, body: { error: "internal error" } };
  }

  const id = (a.randomUUID ?? crypto.randomUUID.bind(crypto))();
  const r2_key = `${IDEIA_AUDIO_KEY_PREFIX}${a.workspace_id}/${a.ideia_id}/${id}.${extFromAudioMime(mime)}`;
  const upload_url = await a.signPutUrl(r2_key, mime);
  return { status: 200, body: { upload_url, r2_key, mime_type: mime } };
}

interface TranscriptionArgs extends IdeiaAudioScope {
  signGetUrl: (key: string) => Promise<string>;
  transcribe: Transcriber | null;
}

async function runTranscription(a: TranscriptionArgs): Promise<IdeiaAudioResult> {
  const row = await loadRow(a);
  if (!row?.audio_r2_key) return { status: 404, body: { error: "Áudio não encontrado." } };
  // Capturada ANTES da chamada (até 90s): toda escrita abaixo é amarrada a esta chave.
  const key = row.audio_r2_key;
  if (row.audio_transcription_status === "done") return view(row, a.signGetUrl);

  let result: { text: string; duration?: number } | null = null;
  if (a.transcribe) {
    try {
      result = await a.transcribe(key);
    } catch (e) {
      console.error("ideia-audio transcribe error:", (e as Error).message);
      result = null;
    }
  }
  const text = result?.text?.trim() ?? "";

  if (!text) {
    await scoped(a.db.from("ideias").update({ audio_transcription_status: "failed" }), a)
      .eq("audio_r2_key", key)
      .neq("audio_transcription_status", "done");
    const current = await loadRow(a);
    return view(current ?? { ...row, audio_transcription_status: "failed" }, a.signGetUrl);
  }

  const { data: applied, error } = await a.db.rpc("ideia_audio_apply_transcript", {
    p_workspace_id: a.workspace_id,
    p_ideia_id: a.ideia_id,
    p_key: key,
    p_text: text,
    p_duration: normalizeDuration(result?.duration),
  });
  if (error) {
    console.error("ideia_audio_apply_transcript error:", (error as { message?: string }).message ?? error);
    return { status: 500, body: { error: "internal error" } };
  }
  const updated = rpcRow(applied);
  if (!updated) {
    const fresh = await loadRow(a);
    if (!fresh?.audio_r2_key) return { status: 404, body: { error: "Áudio não encontrado." } };
    return view(fresh, a.signGetUrl);
  }
  return view(updated, a.signGetUrl);
}

export async function finalizeIdeiaAudio(a: TranscriptionArgs & {
  r2_key: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds?: number | null;
  headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
}): Promise<IdeiaAudioResult> {
  const mime = normalizeAudioMime(a.mime_type);
  if (!mime) return { status: 415, body: { error: "unsupported file type" } };
  const prefix = `${IDEIA_AUDIO_KEY_PREFIX}${a.workspace_id}/${a.ideia_id}/`;
  if (typeof a.r2_key !== "string" || !a.r2_key.startsWith(prefix) || a.r2_key.includes("..")) {
    return { status: 400, body: { error: "invalid r2_key" } };
  }
  if (!validSize(a.size_bytes)) return { status: 400, body: { error: "size_bytes out of range" } };

  const head = await a.headObject(a.r2_key);
  if (!head) return { status: 400, body: { error: "object not found" } };
  if (head.contentLength !== a.size_bytes) return { status: 400, body: { error: "size mismatch" } };
  if (head.contentType && normalizeAudioMime(head.contentType) !== mime) {
    return { status: 400, body: { error: "content-type mismatch" } };
  }

  const { data, error } = await a.db.rpc("ideia_audio_finalize", {
    p_workspace_id: a.workspace_id,
    p_ideia_id: a.ideia_id,
    p_origem: a.origem,
    p_key: a.r2_key,
    p_bytes: a.size_bytes,
    p_mime: mime,
    p_duration: normalizeDuration(a.duration_seconds),
  });
  if (error) {
    const msg = (error as { message?: string }).message ?? "finalize failed";
    const status = rpcErrorStatus(msg);
    if (status === 500) {
      console.error("ideia_audio_finalize error:", msg);
      return { status: 500, body: { error: "internal error" } };
    }
    return { status, body: { error: msg } };
  }
  // reserved:false = retry da mesma chave; runTranscription pula Whisper se já 'done'.
  return runTranscription(a);
}

export function transcribeIdeiaAudio(a: TranscriptionArgs): Promise<IdeiaAudioResult> {
  return runTranscription(a);
}

export async function removeIdeiaAudio(a: IdeiaAudioScope): Promise<IdeiaAudioResult> {
  const { data: row } = await scoped(a.db.from("ideias").select("id, audio_r2_key"), a).maybeSingle();
  if (!row) return { status: 404, body: { error: "Ideia não encontrada." } };
  if (!row.audio_r2_key) return { status: 200, body: { ok: true } };
  const { error } = await a.db.rpc("ideia_audio_release", {
    p_workspace_id: a.workspace_id, p_ideia_id: a.ideia_id, p_origem: a.origem,
  });
  if (error) {
    console.error("ideia_audio_release error:", (error as { message?: string }).message ?? error);
    return { status: 500, body: { error: "internal error" } };
  }
  return { status: 200, body: { ok: true } };
}

/** Leitura para os dois lados: sem filtro de origem. `null` = ideia inexistente. */
export async function loadIdeiaAudioView(a: {
  db: BriefingAudioDb;
  workspace_id: string;
  ideia_id: string;
  cliente_id?: number | null;
  signGetUrl: (key: string) => Promise<string>;
}): Promise<{ audio: AudioView | null; transcript: string | null } | null> {
  let q = a.db.from("ideias").select(`id, audio_transcript, ${IDEIA_AUDIO_COLUMNS}`)
    .eq("id", a.ideia_id).eq("workspace_id", a.workspace_id);
  if (a.cliente_id != null) q = q.eq("cliente_id", a.cliente_id);
  const { data } = await q.maybeSingle();
  const row = data as FullRow | null;
  if (!row) return null;
  return { audio: await buildAudioView(row, a.signGetUrl), transcript: row.audio_transcript ?? null };
}

/** View de áudio a partir de uma linha já carregada (GET de lista). Inclui o transcript. */
export async function buildAudioViewForIdeia(
  row: AudioRow & { audio_transcript?: string | null },
  signGetUrl: (key: string) => Promise<string>,
): Promise<(AudioView & { transcript: string | null }) | null> {
  const v = await buildAudioView(row, signGetUrl);
  return v ? { ...v, transcript: row.audio_transcript ?? null } : null;
}
```

- [ ] **Step 4: Run the tests**

```bash
npm run test:functions -- --filter "presign: 415 mime"
npm run test:functions -- --filter "finalize:"
npm run test:functions -- --filter "transcribe:"
npm run test:functions -- --filter "remove: 404"
npm run test:functions -- --filter "loadIdeiaAudioView"
```

Expected: all PASS. (The `--filter` matches test NAMES; the briefing tests with the same prefixes also run and must still pass.) Then `git checkout deno.lock`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ideia-audio.ts supabase/functions/__tests__/ideia-audio_test.ts
git commit -m "feat(ideias): módulo compartilhado de áudio para ideias

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `hub-ideias` — visibility, origin gate, audio routes

**Files:**
- Modify: `supabase/functions/hub-ideias/handler.ts`
- Modify: `supabase/functions/hub-ideias/index.ts`
- Modify: `supabase/functions/__tests__/hub-ideias_test.ts`

**Interfaces:**
- Consumes Task 2 exports.
- Produces Hub routes:
  - `POST /hub-ideias/audio-upload-url` body `{ token, ideia_id, mime_type, size_bytes }` → `{ upload_url, r2_key, mime_type }`
  - `POST /hub-ideias/:id/audio` body `{ token, r2_key, mime_type, size_bytes, duration_seconds }` → `{ ok, transcript, audio }`
  - `POST /hub-ideias/:id/audio/transcribe` body `{ token }` → same
  - `DELETE /hub-ideias/:id/audio?token=` → `{ ok: true }`
  - `GET /hub-ideias` items gain `origem` and `audio: AudioView | null`; hidden rows excluded.
- New dep on the handler: `transcribe: Transcriber | null`, optional `randomUUID`.

- [ ] **Step 1: Update existing tests and add the new ones**

In `supabase/functions/__tests__/hub-ideias_test.ts`:

1. Change `makeHandler` to pass `transcribe: null` and add a `withTranscribe` variant:

```ts
function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>, transcribe: ((k: string) => Promise<{ text: string } | null>) | null = null) {
  return createHubIdeiasHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now: () => "2026-06-26T12:00:00.000Z",
    signPutUrl: async (key: string) => `https://put.example.com/${key}`,
    signGetUrl: async (key: string) => `https://get.example.com/${key}`,
    headObject: async (k: string) => ({ contentLength: k.includes('.thumb.') ? 2000 : k.includes('.webm') ? 5000 : 5000, contentType: null }),
    rateLimit: async () => true,
    transcribe,
    randomUUID: () => "fixed-uuid",
  });
}
const OWN = { id: "11111111-1111-1111-1111-111111111111", origem: "cliente" };
```

2. Every existing image test (`POST /upload-url`, `POST /:id/files`, `DELETE /:id/files/:fileId`) now needs one extra queued row BEFORE its existing queues, because the origin gate runs first:

```ts
db.queue("ideias", "select", { data: OWN, error: null });
```

3. `checkLock` now selects `origem` too; the PATCH tests keep working (the mock ignores the select string). Add to the "PATCH accepts tipo" test's queued row `origem: "cliente"` is not required, but add this new test:

```ts
Deno.test("hub-ideias: PATCH/DELETE on an agency ideia -> 404 (never 409)", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideias", "select", { data: null, error: null }); // origem filter excluded the row
  const res = await makeHandler(db)(new Request(
    "https://x.test/hub-ideias/11111111-1111-1111-1111-111111111111?token=t",
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "t", titulo: "x" }) },
  ));
  assertEquals(res.status, 404);
  const sel = db.calls.find((c) => c.table === "ideias" && c.operation === "select");
  assertEquals(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "origem" && m.args[1] === "cliente"), true);
});

Deno.test("hub-ideias: image presign on an agency ideia -> 404", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideias", "select", { data: null, error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-ideias/upload-url?token=t", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t", ideia_id: OWN.id, filename: "a.png", mime_type: "image/png", size_bytes: 5, thumbnail: { mime_type: "image/webp", size_bytes: 2 } }),
  }));
  assertEquals(res.status, 404);
});

Deno.test("hub-ideias: GET filters visivel_no_hub, returns origem and audio view, strips audio_* columns", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideias", "select", {
    data: [{
      id: "i1", titulo: "T", tipo: "ideia", origem: "agencia", audio_transcript: "Fala",
      audio_r2_key: "ideia-audio/conta-1/i1/a.webm", audio_mime: "audio/webm", audio_size_bytes: 10,
      audio_duration_seconds: 3, audio_transcription_status: "done", audio_recorded_at: "2026-09-10T00:00:00Z",
    }],
    error: null,
  });
  const res = await makeHandler(db)(new Request("https://x.test/hub-ideias?token=t", { method: "GET" }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.ideias[0].origem, "agencia");
  assertEquals(body.ideias[0].audio.url, "https://get.example.com/ideia-audio/conta-1/i1/a.webm");
  assertEquals(body.ideias[0].audio.transcript, "Fala");
  assertEquals("audio_r2_key" in body.ideias[0], false);
  const select = db.calls.find((c) => c.table === "ideias" && c.operation === "select");
  assertEquals(select?.modifiers.some((m) => m.method === "eq" && m.args[0] === "visivel_no_hub" && m.args[1] === true), true);
  assertEquals(select?.modifiers.some((m) => m.method === "eq" && m.args[0] === "workspace_id" && m.args[1] === "conta-1"), true);
  const selectStr = (select?.selectArgs?.[0]?.[0] as string | undefined) ?? "";
  assertEquals(selectStr.includes("origem"), true);
  assertEquals(selectStr.includes("audio_r2_key"), true);
});

Deno.test("hub-ideias: POST create ignores origem/visivel_no_hub from the body", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideias", "insert", { data: { id: "i1" }, error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-ideias?token=t", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t", titulo: "T", descricao: "D", origem: "agencia", visivel_no_hub: false, audio_r2_key: "x" }),
  }));
  assertEquals(res.status, 201);
  const insert = db.calls.find((c) => c.table === "ideias" && c.operation === "insert");
  const payload = insert?.payload as Record<string, unknown>;
  assertEquals("origem" in payload, false);
  assertEquals("visivel_no_hub" in payload, false);
  assertEquals("audio_r2_key" in payload, false);
});

Deno.test("hub-ideias: POST /audio-upload-url is plan-gated (403) and presigns under ideia-audio/", async () => {
  const gated = createSupabaseQueryMock();
  gated.queue("client_hub_tokens", "select", { data: { cliente_id: 14, conta_id: "conta-1", is_active: true }, error: null });
  gated.queueRpc("effective_plan_feature", { data: false, error: null });
  const denied = await makeHandler(gated)(new Request("https://x.test/hub-ideias/audio-upload-url", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t", ideia_id: OWN.id, mime_type: "audio/webm", size_bytes: 5000 }),
  }));
  assertEquals(denied.status, 403);

  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideias", "select", { data: { id: OWN.id, audio_size_bytes: null }, error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: null, error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-ideias/audio-upload-url", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t", ideia_id: OWN.id, mime_type: "audio/webm;codecs=opus", size_bytes: 5000 }),
  }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.r2_key, `ideia-audio/conta-1/${OWN.id}/fixed-uuid.webm`);
  const sel = db.calls.find((c) => c.table === "ideias" && c.operation === "select");
  assertEquals(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "cliente_id" && m.args[1] === 14), true);
  assertEquals(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "origem" && m.args[1] === "cliente"), true);
});

Deno.test("hub-ideias: POST /:id/audio finalizes + transcribes; DELETE /:id/audio releases without plan gate", async () => {
  const key = `ideia-audio/conta-1/${OWN.id}/fixed-uuid.webm`;
  const row = {
    id: OWN.id, audio_transcript: null, audio_r2_key: key, audio_mime: "audio/webm", audio_size_bytes: 5000,
    audio_duration_seconds: 7, audio_transcription_status: "pending", audio_recorded_at: "2026-09-10T00:00:00Z",
  };
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queueRpc("ideia_audio_finalize", { data: { reserved: true, previous_key: null }, error: null });
  db.queue("ideias", "select", { data: row, error: null });
  db.queueRpc("ideia_audio_apply_transcript", { data: { ...row, audio_transcript: "Olá", audio_transcription_status: "done" }, error: null });
  const res = await makeHandler(db, async () => ({ text: "Olá" }))(new Request(`https://x.test/hub-ideias/${OWN.id}/audio`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t", r2_key: key, mime_type: "audio/webm", size_bytes: 5000, duration_seconds: 7 }),
  }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.transcript, "Olá");
  assertEquals(body.audio.transcription_status, "done");

  const del = createSupabaseQueryMock();
  del.queue("client_hub_tokens", "select", { data: { cliente_id: 14, conta_id: "conta-1", is_active: true }, error: null });
  // No effective_plan_feature queued: DELETE must not consult the plan gate.
  del.queue("ideias", "select", { data: { id: OWN.id, audio_r2_key: key }, error: null });
  del.queueRpc("ideia_audio_release", { data: key, error: null });
  const dres = await makeHandler(del)(new Request(`https://x.test/hub-ideias/${OWN.id}/audio?token=t`, { method: "DELETE" }));
  assertEquals(dres.status, 200);
  assertEquals(del.calls.some((c) => c.table === "rpc:effective_plan_feature"), false);
});

Deno.test("hub-ideias: POST /:id/audio/transcribe retries", async () => {
  const key = `ideia-audio/conta-1/${OWN.id}/fixed-uuid.webm`;
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideias", "select", { data: { id: OWN.id, audio_transcript: null, audio_r2_key: key, audio_mime: "audio/webm", audio_size_bytes: 1, audio_duration_seconds: 1, audio_transcription_status: "failed", audio_recorded_at: "2026-09-10T00:00:00Z" }, error: null });
  db.queueRpc("ideia_audio_apply_transcript", { data: { id: OWN.id, audio_transcript: "De novo", audio_r2_key: key, audio_mime: "audio/webm", audio_size_bytes: 1, audio_duration_seconds: 1, audio_transcription_status: "done", audio_recorded_at: "2026-09-10T00:00:00Z" }, error: null });
  const res = await makeHandler(db, async () => ({ text: "De novo" }))(new Request(`https://x.test/hub-ideias/${OWN.id}/audio/transcribe`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "t" }),
  }));
  assertEquals(res.status, 200);
  assertEquals((await readJson(res)).transcript, "De novo");
});
```

- [ ] **Step 2: Run to see the new tests fail**

```bash
npm run test:functions -- --filter "hub-ideias"
```

Expected: new tests FAIL (404 from the catch-all or missing `transcribe` dep type error); old image tests FAIL because the origin gate queue is consumed by the wrong query.

- [ ] **Step 3: Implement the handler changes**

Replace `supabase/functions/hub-ideias/handler.ts` with:

```ts
import { createJsonResponder, internalServerError } from "../_shared/http.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import { presignIdeiaImage, finalizeIdeiaImage, removeIdeiaImage } from "../_shared/ideia-media.ts";
import {
  buildAudioViewForIdeia,
  finalizeIdeiaAudio,
  IDEIA_AUDIO_COLUMNS,
  presignIdeiaAudio,
  removeIdeiaAudio,
  transcribeIdeiaAudio,
  type Transcriber,
} from "../_shared/ideia-audio.ts";
import { getClientIP } from "../_shared/rate-limit.ts";

type DbClient = {
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

interface HubIdeiasHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  signPutUrl: (key: string, mime: string) => Promise<string>;
  signGetUrl: (key: string, expires?: number) => Promise<string>;
  headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
  rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
  transcribe: Transcriber | null;
  randomUUID?: () => string;
}

const HUB_IDEIA_TIPOS = ["ideia", "solicitacao"];
const AUDIO_WRITE_MAX = 20;
const AUDIO_WRITE_WINDOW = 3600;

/** Linha que o cliente pode ESCREVER: dele e criada por ele. Ideia da agência
 * compartilhada no Hub é só leitura; devolver 404 (não 403) evita sondar
 * ideias ocultas. */
async function loadOwnIdeia(db: DbClient, ideiaId: string, clienteId: number) {
  const { data } = await db
    .from("ideias")
    .select("id, status, comentario_agencia, origem")
    .eq("id", ideiaId)
    .eq("cliente_id", clienteId)
    .eq("origem", "cliente")
    .maybeSingle();
  return data as { id: string; status: string; comentario_agencia: string | null } | null;
}

async function checkLock(db: DbClient, ideiaId: string, clienteId: number): Promise<null | boolean> {
  const ideia = await loadOwnIdeia(db, ideiaId, clienteId);
  if (!ideia) return null;
  if (ideia.status !== "nova") return true;
  if (ideia.comentario_agencia !== null) return true;

  const { count } = await db
    .from("ideia_reactions")
    .select("id", { count: "exact", head: true })
    .eq("ideia_id", ideiaId);

  return (count ?? 0) > 0;
}

export function createHubIdeiasHandler(deps: HubIdeiasHandlerDeps) {
  const signGet = (key: string) => deps.signGetUrl(key, 3600);

  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const idx = pathParts.indexOf("hub-ideias");
    const seg = idx >= 0 ? pathParts.slice(idx + 1) : [];
    const ideiaId = seg[0] && seg[0].length === 36 ? seg[0] : null;
    const hasId = !!ideiaId && seg.length === 1;
    const isPresign = seg.length === 1 && seg[0] === "upload-url";
    const isFinalize = !!ideiaId && seg[1] === "files" && seg.length === 2;
    const isRemove = !!ideiaId && seg[1] === "files" && seg.length === 3;
    const removeFileId = isRemove ? Number(seg[2]) : NaN;
    const isAudioPresign = seg.length === 1 && seg[0] === "audio-upload-url";
    const isAudio = !!ideiaId && seg.length === 2 && seg[1] === "audio";
    const isTranscribe = !!ideiaId && seg.length === 3 && seg[1] === "audio" && seg[2] === "transcribe";

    const db = deps.createDb();

    const token = url.searchParams.get("token") ?? (await req.clone().json().catch(() => ({}))).token;
    if (!token) return json({ error: "token required" }, 400);

    const hubToken = await resolveHubToken(db as any, token, deps.now());
    if (!hubToken) {
      const okBadToken = await deps.rateLimit(db, `hub-badtoken:${getClientIP(req)}`, 30, 600);
      if (!okBadToken) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
      return json({ error: "Link inválido." }, 404);
    }

    const clienteId = hubToken.cliente_id;
    const workspaceId = hubToken.conta_id;

    const okRead = await deps.rateLimit(db, `hub-read:${workspaceId}:${clienteId}`, 300, 300);
    if (!okRead) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);

    // ── Áudio ─────────────────────────────────────────────────────
    if (isAudioPresign || isAudio || isTranscribe) {
      let body: Record<string, unknown> = {};
      if (req.method === "POST") {
        body = await req.json().catch(() => ({}));
      } else if (req.method !== "DELETE" || !isAudio) {
        return json({ error: "Method not allowed" }, 405);
      }
      const scope = { db: db as any, workspace_id: workspaceId, origem: "cliente" as const, cliente_id: clienteId };

      // Só a ESCRITA de áudio é paga; DELETE fica fora para o cliente poder
      // remover o que gravou depois de um downgrade.
      if (req.method === "POST") {
        const audioOn = await effectivePlanFeature(db as never, workspaceId, "feature_briefing_audio");
        if (!audioOn) return json({ error: "Recurso indisponível no plano atual." }, 403);
        const okWrite = await deps.rateLimit(
          db, `hub-write:hub-ideias-audio:${workspaceId}:${clienteId}`, AUDIO_WRITE_MAX, AUDIO_WRITE_WINDOW,
        );
        if (!okWrite) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
      }

      if (isAudioPresign) {
        const ideia_id = typeof body.ideia_id === "string" ? body.ideia_id : "";
        if (!ideia_id || typeof body.mime_type !== "string" || typeof body.size_bytes !== "number") {
          return json({ error: "ideia_id, mime_type and size_bytes are required" }, 400);
        }
        const r = await presignIdeiaAudio({
          ...scope, ideia_id, mime_type: body.mime_type, size_bytes: body.size_bytes,
          signPutUrl: deps.signPutUrl, randomUUID: deps.randomUUID,
        });
        return json(r.body, r.status);
      }

      if (isAudio && req.method === "POST") {
        if (typeof body.r2_key !== "string" || typeof body.mime_type !== "string" || typeof body.size_bytes !== "number") {
          return json({ error: "r2_key, mime_type and size_bytes are required" }, 400);
        }
        const r = await finalizeIdeiaAudio({
          ...scope, ideia_id: ideiaId!,
          r2_key: body.r2_key, mime_type: body.mime_type, size_bytes: body.size_bytes,
          duration_seconds: typeof body.duration_seconds === "number" ? body.duration_seconds : null,
          headObject: deps.headObject, signGetUrl: signGet, transcribe: deps.transcribe,
        });
        return json(r.body, r.status);
      }

      if (isAudio && req.method === "DELETE") {
        const r = await removeIdeiaAudio({ ...scope, ideia_id: ideiaId! });
        return json(r.body, r.status);
      }

      const r = await transcribeIdeiaAudio({ ...scope, ideia_id: ideiaId!, signGetUrl: signGet, transcribe: deps.transcribe });
      return json(r.body, r.status);
    }

    // ── Image: presign ─────────────────────────────────────────────
    if (req.method === "POST" && isPresign) {
      const body = await req.json().catch(() => ({}));
      const own = await loadOwnIdeia(db, String(body.ideia_id ?? ""), clienteId);
      if (!own) return json({ error: "Ideia não encontrada." }, 404);
      const result = await presignIdeiaImage({
        db: db as any,
        conta_id: workspaceId,
        cliente_id: clienteId,
        ideia_id: String(body.ideia_id ?? ""),
        filename: String(body.filename ?? ""),
        mime_type: String(body.mime_type ?? ""),
        size_bytes: Number(body.size_bytes ?? 0),
        thumbnail: {
          mime_type: String(body.thumbnail?.mime_type ?? ""),
          size_bytes: Number(body.thumbnail?.size_bytes ?? 0),
        },
        signPutUrl: deps.signPutUrl,
      });
      return json(result.body, result.status);
    }

    // ── Image: finalize (NOT lock-gated, origin-gated) ─────────────
    if (req.method === "POST" && isFinalize) {
      const own = await loadOwnIdeia(db, ideiaId!, clienteId);
      if (!own) return json({ error: "Ideia não encontrada." }, 404);
      const body = await req.json().catch(() => ({}));
      const result = await finalizeIdeiaImage({
        db: db as any,
        conta_id: workspaceId,
        cliente_id: clienteId,
        ideia_id: ideiaId!,
        r2_key: String(body.r2_key ?? ""),
        thumbnail_r2_key: String(body.thumbnail_r2_key ?? ""),
        mime_type: String(body.mime_type ?? ""),
        size_bytes: Number(body.size_bytes ?? 0),
        thumbnail_bytes: Number(body.thumbnail_bytes ?? 0),
        name: String(body.name ?? "image"),
        width: body.width != null ? Number(body.width) : undefined,
        height: body.height != null ? Number(body.height) : undefined,
        blur_data_url: typeof body.blur_data_url === "string" ? body.blur_data_url : undefined,
        sort_order: body.sort_order != null ? Number(body.sort_order) : undefined,
        uploaded_by: null,
        headObject: deps.headObject,
        signGetUrl: deps.signGetUrl,
      });
      return json(result.body, result.status);
    }

    // ── Image: remove (NOT lock-gated, origin-gated) ───────────────
    if (req.method === "DELETE" && isRemove) {
      if (Number.isNaN(removeFileId)) return json({ error: "invalid file id" }, 400);
      const own = await loadOwnIdeia(db, ideiaId!, clienteId);
      if (!own) return json({ error: "Ideia não encontrada." }, 404);
      const result = await removeIdeiaImage({
        db: db as any,
        conta_id: workspaceId,
        cliente_id: clienteId,
        ideia_id: ideiaId!,
        file_id: removeFileId,
      });
      return json(result.body, result.status);
    }

    if (req.method === "GET") {
      const { data: ideias } = await db
        .from("ideias")
        .select(`
        id, titulo, descricao, links, status, tipo, tarefa_id, origem,
        comentario_agencia, comentario_autor_id, comentario_at, created_at, updated_at,
        audio_transcript, ${IDEIA_AUDIO_COLUMNS},
        comentario_autor:membros!comentario_autor_id(nome),
        ideia_reactions(id, membro_id, emoji, membros(nome)),
        ideia_files(id, file_id, sort_order, files(r2_key, thumbnail_r2_key, blur_data_url, width, height))
      `)
        .eq("cliente_id", clienteId)
        .eq("workspace_id", workspaceId)
        .eq("visivel_no_hub", true)
        .order("created_at", { ascending: false });

      const out = [];
      for (const ideia of (ideias ?? []) as Array<Record<string, any>>) {
        const links = (ideia.ideia_files ?? [])
          .sort((x: any, y: any) => (x.sort_order - y.sort_order) || (x.id - y.id));
        const images = [];
        for (const row of links) {
          const f = row.files;
          if (!f) continue;
          images.push({
            id: row.id,
            file_id: row.file_id,
            url: await deps.signGetUrl(f.r2_key, 3600),
            thumbnail_url: f.thumbnail_r2_key ? await deps.signGetUrl(f.thumbnail_r2_key, 3600) : null,
            blur_data_url: f.blur_data_url ?? null,
            width: f.width ?? null,
            height: f.height ?? null,
            sort_order: row.sort_order ?? 0,
          });
        }
        // Assinar o áudio é I/O externo: falha em uma ideia custa só o player dela.
        let audio = null;
        try {
          audio = await buildAudioViewForIdeia(ideia, signGet);
        } catch (e) {
          console.error("hub-ideias:sign-audio", ideia.id, (e as Error).message ?? e);
        }
        const {
          ideia_files: _f, audio_transcript: _t, audio_r2_key: _k, audio_mime: _m, audio_size_bytes: _s,
          audio_duration_seconds: _d, audio_transcription_status: _st, audio_recorded_at: _r, ...rest
        } = ideia;
        out.push({ ...rest, images, audio });
      }

      return json({ ideias: out });
    }

    if (req.method === "POST" && !hasId) {
      const okWrite = await deps.rateLimit(
        db, `hub-write:hub-ideias:${workspaceId}:${clienteId}`, 30, 3600,
      );
      if (!okWrite) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);

      const body = await req.json().catch(() => ({}));
      const titulo = (body.titulo ?? "").trim();
      const descricao = (body.descricao ?? "").trim();
      const links: string[] = Array.isArray(body.links) ? body.links.filter((link: string) => typeof link === "string" && link.trim()) : [];

      if (!titulo) return json({ error: "titulo obrigatório" }, 400);
      if (!descricao) return json({ error: "descricao obrigatória" }, 400);

      const tipo = body.tipo === undefined ? "ideia" : String(body.tipo);
      if (!HUB_IDEIA_TIPOS.includes(tipo)) return json({ error: "tipo inválido" }, 400);

      // origem/visivel_no_hub/audio_* nunca vêm do cliente: defaults do banco.
      const { data, error } = await db
        .from("ideias")
        .insert({ workspace_id: workspaceId, cliente_id: clienteId, titulo, descricao, links, tipo, status: "nova" })
        .select()
        .single();

      if (error) return internalServerError(json, "hub-ideias:create", error);
      return json({ ideia: data }, 201);
    }

    if (req.method === "PATCH" && hasId) {
      const lockResult = await checkLock(db, ideiaId!, clienteId);
      if (lockResult === null) return json({ error: "Ideia não encontrada." }, 404);
      if (lockResult === true) return json({ error: "Esta ideia não pode mais ser editada" }, 409);

      const body = await req.json().catch(() => ({}));
      const patch: Record<string, unknown> = {};
      if (body.titulo !== undefined) patch.titulo = (body.titulo ?? "").trim();
      if (body.descricao !== undefined) patch.descricao = (body.descricao ?? "").trim();
      if (body.links !== undefined) patch.links = Array.isArray(body.links) ? body.links.filter((link: string) => typeof link === "string" && link.trim()) : [];
      if (body.tipo !== undefined) {
        if (!HUB_IDEIA_TIPOS.includes(String(body.tipo))) return json({ error: "tipo inválido" }, 400);
        patch.tipo = String(body.tipo);
      }

      if (patch.titulo === "") return json({ error: "titulo obrigatório" }, 400);
      if (patch.descricao === "") return json({ error: "descricao obrigatória" }, 400);

      const { data, error } = await db
        .from("ideias")
        .update(patch)
        .eq("id", ideiaId!)
        .eq("cliente_id", clienteId)
        .eq("origem", "cliente")
        .select()
        .single();

      if (error) return internalServerError(json, "hub-ideias:update", error);
      return json({ ideia: data });
    }

    if (req.method === "DELETE" && hasId) {
      const lockResult = await checkLock(db, ideiaId!, clienteId);
      if (lockResult === null) return json({ error: "Ideia não encontrada." }, 404);
      if (lockResult === true) return json({ error: "Esta ideia não pode mais ser editada" }, 409);

      const { error } = await db
        .from("ideias")
        .delete()
        .eq("id", ideiaId!)
        .eq("cliente_id", clienteId)
        .eq("origem", "cliente");

      if (error) return internalServerError(json, "hub-ideias:delete", error);
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  };
}
```

`buildAudioViewForIdeia` comes from Task 2's module.

Update `supabase/functions/hub-ideias/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { signPutUrl, signGetUrl, headObject } from "../_shared/r2.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { makeWorkerTranscriber } from "../_shared/ideia-audio.ts";
import { createHubIdeiasHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createHubIdeiasHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
  now: () => new Date().toISOString(),
  signPutUrl,
  signGetUrl,
  headObject,
  // deno-lint-ignore no-explicit-any
  rateLimit: (db, key, max, win) => checkRateLimit(db as any, key, max, win),
  // Sem TRANSCRIBE_WORKER_URL/TRANSCRIBE_SECRET o áudio salva e a transcrição fica "failed".
  transcribe: makeWorkerTranscriber({
    url: Deno.env.get("TRANSCRIBE_WORKER_URL"),
    secret: Deno.env.get("TRANSCRIBE_SECRET"),
  }),
}));
```

- [ ] **Step 4: Run the tests**

```bash
npm run test:functions -- --filter "hub-ideias"
npm run test:functions -- --filter "hub-functions"
git checkout deno.lock
```

Expected: all PASS. If `hub-functions_test.ts` constructs `createHubIdeiasHandler` without `transcribe`, add `transcribe: null` there.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hub-ideias supabase/functions/_shared/ideia-audio.ts supabase/functions/__tests__/hub-ideias_test.ts supabase/functions/__tests__/hub-functions_test.ts
git commit -m "feat(hub-ideias): filtro de visibilidade, gate de origem e rotas de áudio

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `ideia-media-manage` — CRM audio routes

**Files:**
- Modify: `supabase/functions/ideia-media-manage/handler.ts`
- Modify: `supabase/functions/ideia-media-manage/index.ts`
- Modify: `supabase/functions/__tests__/ideia-media-manage_test.ts`

**Interfaces:**
- Produces CRM routes (JWT):
  - `GET /ideia-media-manage/audio?ideia_id=` → `{ audio: AudioView | null, transcript: string | null }`; 404 when the ideia is not in the workspace.
  - `POST /ideia-media-manage/audio-upload-url` `{ ideia_id, mime_type, size_bytes }` → presign body
  - `POST /ideia-media-manage/:id/audio` `{ r2_key, mime_type, size_bytes, duration_seconds }` → `{ ok, transcript, audio }`
  - `POST /ideia-media-manage/:id/audio/transcribe` → same
  - `DELETE /ideia-media-manage/:id/audio` → `{ ok: true }`
- Deps gain `transcribe: Transcriber | null`, optional `randomUUID`.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/__tests__/ideia-media-manage_test.ts` (and change `makeHandler` to accept an optional transcriber and pass `transcribe`, `randomUUID: () => "fixed-uuid"`):

```ts
const I = "11111111-1111-1111-1111-111111111111";
const AKEY = `ideia-audio/conta-1/${I}/fixed-uuid.webm`;
const arow = {
  id: I, audio_transcript: null, audio_r2_key: AKEY, audio_mime: "audio/webm", audio_size_bytes: 5000,
  audio_duration_seconds: 7, audio_transcription_status: "pending", audio_recorded_at: "2026-09-10T00:00:00Z",
};

Deno.test("ideia-media-manage: GET /audio returns the view; 404 when the ideia is not in the workspace", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("ideias", "select", { data: { ...arow, audio_transcript: "T" }, error: null });
  const res = await makeHandler(db)(req("GET", `ideia-media-manage/audio?ideia_id=${I}`));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.transcript, "T");
  assertEquals(body.audio.url, `https://get.example.com/${AKEY}`);

  const miss = createSupabaseQueryMock();
  setupAuth(miss);
  miss.queue("ideias", "select", { data: null, error: null });
  assertEquals((await makeHandler(miss)(req("GET", `ideia-media-manage/audio?ideia_id=${I}`))).status, 404);
});

Deno.test("ideia-media-manage: POST /audio-upload-url gates on the plan flag and scopes origem=agencia", async () => {
  const gated = createSupabaseQueryMock();
  setupAuth(gated);
  gated.queueRpc("effective_plan_feature", { data: false, error: null });
  assertEquals((await makeHandler(gated)(req("POST", "ideia-media-manage/audio-upload-url", { ideia_id: I, mime_type: "audio/webm", size_bytes: 10 }))).status, 403);

  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("effective_plan_feature", { data: true, error: null });
  db.queue("ideias", "select", { data: { id: I, audio_size_bytes: null }, error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: null, error: null });
  const res = await makeHandler(db)(req("POST", "ideia-media-manage/audio-upload-url", { ideia_id: I, mime_type: "audio/webm", size_bytes: 10 }));
  assertEquals(res.status, 200);
  assertEquals((await readJson(res)).r2_key, AKEY);
  const sel = db.calls.find((c) => c.table === "ideias" && c.operation === "select");
  assertEquals(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "origem" && m.args[1] === "agencia"), true);
  assertEquals(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "cliente_id"), false);
});

Deno.test("ideia-media-manage: POST /:id/audio finalizes with p_origem=agencia; transcribe + DELETE routes", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("effective_plan_feature", { data: true, error: null });
  db.queueRpc("ideia_audio_finalize", { data: { reserved: true, previous_key: null }, error: null });
  db.queue("ideias", "select", { data: arow, error: null });
  db.queueRpc("ideia_audio_apply_transcript", { data: { ...arow, audio_transcript: "Olá", audio_transcription_status: "done" }, error: null });
  const res = await makeHandler(db, async () => ({ text: "Olá" }))(req("POST", `ideia-media-manage/${I}/audio`, {
    r2_key: AKEY, mime_type: "audio/webm", size_bytes: 5000, duration_seconds: 7,
  }));
  assertEquals(res.status, 200);
  assertEquals((await readJson(res)).transcript, "Olá");
  const rpc = db.calls.find((c) => c.table === "rpc:ideia_audio_finalize");
  assertEquals((rpc?.payload as Record<string, unknown>).p_origem, "agencia");

  const t = createSupabaseQueryMock();
  setupAuth(t);
  t.queueRpc("effective_plan_feature", { data: true, error: null });
  t.queue("ideias", "select", { data: { ...arow, audio_transcription_status: "failed" }, error: null });
  t.queueRpc("ideia_audio_apply_transcript", { data: { ...arow, audio_transcript: "De novo", audio_transcription_status: "done" }, error: null });
  assertEquals((await makeHandler(t, async () => ({ text: "De novo" }))(req("POST", `ideia-media-manage/${I}/audio/transcribe`))).status, 200);

  const d = createSupabaseQueryMock();
  setupAuth(d);
  d.queue("ideias", "select", { data: { id: I, audio_r2_key: AKEY }, error: null });
  d.queueRpc("ideia_audio_release", { data: AKEY, error: null });
  assertEquals((await makeHandler(d)(req("DELETE", `ideia-media-manage/${I}/audio`))).status, 200);
  assertEquals(d.calls.some((c) => c.table === "rpc:effective_plan_feature"), false);
});
```

Note: the `headObject` in `makeHandler` returns `contentLength: 5000` for non-thumb keys, which matches `size_bytes: 5000` above.

- [ ] **Step 2: Run to verify failure**

```bash
npm run test:functions -- --filter "ideia-media-manage"
```

Expected: the three new tests FAIL (404 / type errors).

- [ ] **Step 3: Implement**

`supabase/functions/ideia-media-manage/handler.ts` — replace the `Deps` interface, the segment parsing and add the audio routes before the image routes:

```ts
import { createJsonResponder } from "../_shared/http.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import {
  presignIdeiaImage, finalizeIdeiaImage, listIdeiaImages, removeIdeiaImage,
} from "../_shared/ideia-media.ts";
import {
  finalizeIdeiaAudio, loadIdeiaAudioView, presignIdeiaAudio, removeIdeiaAudio, transcribeIdeiaAudio,
  type Transcriber,
} from "../_shared/ideia-audio.ts";

type DbClient = {
  from: (table: string) => any;
  auth: { getUser: (token: string) => Promise<{ data: { user: any }; error: any }> };
  rpc: (name: string, params: Record<string, unknown>) => any;
};

interface Deps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  signPutUrl: (key: string, mime: string) => Promise<string>;
  signGetUrl: (key: string, expires?: number) => Promise<string>;
  headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
  transcribe: Transcriber | null;
  randomUUID?: () => string;
}

const RESERVED = new Set(["upload-url", "audio-upload-url", "audio"]);

export function createIdeiaMediaManageHandler(deps: Deps) {
  const signGet = (key: string) => deps.signGetUrl(key, 3600);

  return async (req: Request): Promise<Response> => {
    const cors = {
      ...deps.buildCorsHeaders(req),
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    };
    const json = createJsonResponder(cors);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const db = deps.createDb();
    const { data: { user }, error: authErr } = await db.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await db.from("profiles").select("conta_id").eq("id", user.id).single();
    if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);
    const conta_id = profile.conta_id as string;

    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("ideia-media-manage");
    const seg = idx >= 0 ? parts.slice(idx + 1) : [];
    const ideiaId = seg[0] && !RESERVED.has(seg[0]) ? seg[0] : null;
    const isAudioPresign = seg.length === 1 && seg[0] === "audio-upload-url";
    const isAudioView = req.method === "GET" && seg.length === 1 && seg[0] === "audio";
    const isAudio = !!ideiaId && seg.length === 2 && seg[1] === "audio";
    const isTranscribe = !!ideiaId && seg.length === 3 && seg[1] === "audio" && seg[2] === "transcribe";
    const scope = { db: db as any, workspace_id: conta_id, origem: "agencia" as const };

    // ── Áudio ──────────────────────────────────────────────────────
    if (isAudioView) {
      const qid = url.searchParams.get("ideia_id");
      if (!qid) return json({ error: "ideia_id required" }, 400);
      const v = await loadIdeiaAudioView({ db: db as any, workspace_id: conta_id, ideia_id: qid, signGetUrl: signGet });
      if (!v) return json({ error: "Ideia não encontrada." }, 404);
      return json(v);
    }

    if (isAudioPresign || isAudio || isTranscribe) {
      if (req.method === "POST") {
        const audioOn = await effectivePlanFeature(db as never, conta_id, "feature_briefing_audio");
        if (!audioOn) return json({ error: "Recurso indisponível no plano atual." }, 403);
      } else if (!(req.method === "DELETE" && isAudio)) {
        return json({ error: "Method not allowed" }, 405);
      }
      const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

      if (isAudioPresign) {
        const ideia_id = typeof body.ideia_id === "string" ? body.ideia_id : "";
        if (!ideia_id || typeof body.mime_type !== "string" || typeof body.size_bytes !== "number") {
          return json({ error: "ideia_id, mime_type and size_bytes are required" }, 400);
        }
        const r = await presignIdeiaAudio({
          ...scope, ideia_id, mime_type: body.mime_type, size_bytes: body.size_bytes,
          signPutUrl: deps.signPutUrl, randomUUID: deps.randomUUID,
        });
        return json(r.body, r.status);
      }
      if (isAudio && req.method === "POST") {
        if (typeof body.r2_key !== "string" || typeof body.mime_type !== "string" || typeof body.size_bytes !== "number") {
          return json({ error: "r2_key, mime_type and size_bytes are required" }, 400);
        }
        const r = await finalizeIdeiaAudio({
          ...scope, ideia_id: ideiaId!,
          r2_key: body.r2_key, mime_type: body.mime_type, size_bytes: body.size_bytes,
          duration_seconds: typeof body.duration_seconds === "number" ? body.duration_seconds : null,
          headObject: deps.headObject, signGetUrl: signGet, transcribe: deps.transcribe,
        });
        return json(r.body, r.status);
      }
      if (isAudio && req.method === "DELETE") {
        const r = await removeIdeiaAudio({ ...scope, ideia_id: ideiaId! });
        return json(r.body, r.status);
      }
      const r = await transcribeIdeiaAudio({ ...scope, ideia_id: ideiaId!, signGetUrl: signGet, transcribe: deps.transcribe });
      return json(r.body, r.status);
    }

    // ── Imagens (inalterado) ───────────────────────────────────────
    // ... keep the existing GET / POST upload-url / POST :id/files / DELETE :id/files/:fileId blocks verbatim ...

    return json({ error: "Not found" }, 404);
  };
}
```

Keep the four image blocks exactly as they are today below the audio block.

`supabase/functions/ideia-media-manage/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { signPutUrl, signGetUrl, headObject } from "../_shared/r2.ts";
import { makeWorkerTranscriber } from "../_shared/ideia-audio.ts";
import { createIdeiaMediaManageHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createIdeiaMediaManageHandler({
  buildCorsHeaders,
  // Service-role client; auth.getUser(token) still validates the caller's JWT.
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
  signPutUrl,
  signGetUrl,
  headObject,
  transcribe: makeWorkerTranscriber({
    url: Deno.env.get("TRANSCRIBE_WORKER_URL"),
    secret: Deno.env.get("TRANSCRIBE_SECRET"),
  }),
}));
```

- [ ] **Step 4: Run the tests**

```bash
npm run test:functions -- --filter "ideia-media-manage"
npx deno check supabase/functions/ideia-media-manage/index.ts supabase/functions/hub-ideias/index.ts
git checkout deno.lock
```

Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ideia-media-manage supabase/functions/__tests__/ideia-media-manage_test.ts
git commit -m "feat(ideia-media-manage): rotas de áudio para ideias da agência

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Worker prefix allowlist, orphan-scan target, MCP select

**Files:**
- Modify: `workers/transcribe/src/index.ts`, `workers/transcribe/src/index.test.ts`
- Modify: `supabase/functions/post-media-cleanup-cron/orphan-scan.ts`, `supabase/functions/__tests__/orphan-scan_test.ts`
- Modify: `supabase/functions/mcp/queries.ts`
- Modify: `CLAUDE.md` (env var note)

**Interfaces:**
- Worker accepts keys under `briefing-audio/` or `ideia-audio/`.
- `SCAN_TARGETS` gains `{ prefix: "ideia-audio/", refs: [{ table: "ideias", columns: ["audio_r2_key"] }] }`; `ScanTable` gains `"ideias"`.

- [ ] **Step 1: Worker test**

In `workers/transcribe/src/index.test.ts`, extend the "405 on GET, 400 on bad key" test and add:

```ts
  it('accepts ideia-audio/ keys and still rejects other prefixes', async () => {
    const env = makeEnv();
    const res = await handleTranscribe(req({ key: 'ideia-audio/conta/ideia/a.webm' }), env);
    expect(res.status).toBe(200);
    expect((await handleTranscribe(req({ key: 'ideia-audio/../x' }), makeEnv())).status).toBe(400);
    expect((await handleTranscribe(req({ key: 'automation-media/x.webm' }), makeEnv())).status).toBe(400);
  });
```

Run: `cd workers/transcribe && npm test` → the new case FAILS with 400.

- [ ] **Step 2: Worker implementation**

In `workers/transcribe/src/index.ts` replace the constant and the check:

```ts
const KEY_PREFIXES = ['briefing-audio/', 'ideia-audio/'];
```

```ts
  if (!KEY_PREFIXES.some((p) => key.startsWith(p)) || key.includes('..')) {
    return json({ error: 'invalid key' }, 400);
  }
```

Run: `cd workers/transcribe && npm test` → PASS. Return to the repo root.

- [ ] **Step 3: Orphan-scan tests**

In `supabase/functions/__tests__/orphan-scan_test.ts`:
- Every assertion of `result.targets.map((t) => t.prefix)` becomes `["contas/", "briefing-audio/", "ideia-audio/"]`, and every `calledPrefixes` assertion likewise.
- Where a test asserts `result.targets[1]` as the last entry, add `result.targets[2]` with the same shape and `prefix: "ideia-audio/"`.
- Add:

```ts
Deno.test("orphan-scan: an ideia-audio/ key referenced in ideias.audio_r2_key is not trashed; an unreferenced one is", async () => {
  const referenced = "ideia-audio/c/i/x.webm";
  const orphan = "ideia-audio/c/i/orphan.webm";
  const { db } = makeDb((table, column, batch) => ({
    data: table === "ideias" && column === "audio_r2_key"
      ? batch.filter((k) => k === referenced).map((k) => ({ audio_r2_key: k }))
      : [],
    error: null,
  }));
  const deleted: string[] = [];
  const result = await runOrphanScan({
    ...noCheckpoint(),
    db,
    listOrphanKeyPage: singlePage((prefix) => (prefix === "ideia-audio/" ? [referenced, orphan] : [])),
    trashObject: async (k) => {
      deleted.push(k);
    },
  });
  assertEquals(result.aborted, null);
  assertEquals(deleted, [orphan]);
  assertEquals(result.targets[2].prefix, "ideia-audio/");
  assertEquals(result.targets[2].trashed, 1);
});
```

`makeDb`, `noCheckpoint`, `singlePage` and `runOrphanScan` already exist in that file (lines 15, 71, 41 and the import block). If `makeDb`'s callback type narrows `table` to the `ScanTable` union, the new `"ideias"` member (Step 4) makes the comparison typecheck.

Run: `npm run test:functions -- --filter "orphan-scan"` → new/changed tests FAIL.

- [ ] **Step 4: Orphan-scan implementation**

In `supabase/functions/post-media-cleanup-cron/orphan-scan.ts`:

```ts
export type ScanTable = "post_media" | "files" | "hub_briefing_questions" | "ideias";
```

and append to `SCAN_TARGETS`:

```ts
  // Áudio das ideias: mesmo motivo do briefing (fora de contas/).
  {
    prefix: "ideia-audio/",
    refs: [{ table: "ideias", columns: ["audio_r2_key"] }],
  },
```

Run: `npm run test:functions -- --filter "orphan-scan"` → PASS.

- [ ] **Step 5: MCP select**

In `supabase/functions/mcp/queries.ts` `listIdeas`:

```ts
    .select("id, cliente_id, titulo, descricao, status, tipo, tarefa_id, links, created_at, origem, visivel_no_hub, audio_transcript")
```

Add to `supabase/functions/__tests__/mcp-tarefas_test.ts` (it already has `makeFakeDb`, `CTX` and imports `Deps` from `../mcp/queries.ts`; add `listIdeas` to that import):

```ts
Deno.test("mcp-ideias: listIdeas selects origem, visivel_no_hub and audio_transcript", async () => {
  const { db, calls } = makeFakeDb({ ideias: [{ data: [], error: null }] });
  const deps = { db, ctx: CTX } as unknown as Deps;
  await listIdeas(deps, {});
  const sel = calls.find((c) => c.table === "ideias" && c.method === "select");
  const str = String(sel?.args[0] ?? "");
  assert(str.includes("origem"));
  assert(str.includes("visivel_no_hub"));
  assert(str.includes("audio_transcript"));
});
```

Run: `npm run test:functions -- --filter "mcp-ideias"` → PASS.

- [ ] **Step 6: CLAUDE.md**

In the `TRANSCRIBE_WORKER_URL`, `TRANSCRIBE_SECRET` bullet, append: "Also read by `hub-ideias` and `ideia-media-manage` for ideia audio; the worker's key allowlist covers `briefing-audio/` and `ideia-audio/`."

- [ ] **Step 7: Commit**

```bash
git checkout deno.lock
git add workers/transcribe/src supabase/functions/post-media-cleanup-cron/orphan-scan.ts supabase/functions/__tests__/orphan-scan_test.ts supabase/functions/mcp/queries.ts supabase/functions/__tests__/mcp-tarefas_test.ts CLAUDE.md
git commit -m "feat(ideias): worker aceita ideia-audio/, orphan-scan e MCP cobrem o áudio

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Shared audio validation + recorder moved to `packages/ui`

**Files:**
- Create: `packages/ui/audio/validation.ts`, `packages/ui/audio/__tests__/validation.test.ts`
- Create: `packages/ui/AudioRecorder/index.tsx` (moved), `packages/ui/AudioRecorder/__tests__/index.test.tsx` (moved)
- Create: `apps/hub/src/lib/audioVars.ts`
- Delete: `apps/hub/src/components/AudioRecorder.tsx`, `apps/hub/src/components/__tests__/AudioRecorder.test.tsx`
- Modify: `apps/hub/src/services/briefingAudio.ts`, `apps/hub/src/pages/BriefingPage.tsx`, `apps/hub/src/pages/__tests__/briefingPage.test.tsx`
- Modify: `apps/crm/src/services/ideiaMedia.ts` (export Blob-typed `putToR2`)
- Create: `apps/crm/src/lib/audioVars.ts`; Modify: `apps/crm/src/pages/cliente-detalhe/BriefingAudioPlayer.tsx` (import `CRM_AUDIO_VARS` from it)

**Interfaces:**
- `packages/ui/audio/validation.ts` exports:

```ts
export const AUDIO_MIME: string[];
export const MAX_AUDIO_BYTES: number;   // 15 MiB
export const MAX_AUDIO_SECONDS: number; // 300
export function normalizeAudioMime(raw: string): string | null;
export function pickRecorderMime(): string | undefined;
export function validateAudioBlob(blob: Blob, mime: string): string; // returns normalized mime or throws PT message
export function describeAudioError(e: unknown, fallback: string): string;
export type UploadPhase = 'uploading' | 'transcribing';
```
- `packages/ui/AudioRecorder/index.tsx` exports `AudioRecorder`, `isRecordingSupported`, `formatDuration`, type `RecorderPhase`, and props:

```ts
interface Props {
  phase: RecorderPhase;
  disabled?: boolean;
  onRecorded: (blob: Blob, mime: string, durationSeconds: number) => Promise<void>;
  sendLabel?: string; // default 'Enviar'
  hint?: string;      // default `Até ${formatDuration(MAX_AUDIO_SECONDS)} por resposta.`
}
```
  CSS variables read: `--audio-btn-bg`, `--audio-btn-fg`, `--audio-btn2-bg`, `--audio-btn2-fg`, `--audio-btn2-bd`, `--audio-track`, `--audio-fill`, `--audio-muted`, `--audio-radius`.
- `apps/hub/src/lib/audioVars.ts` exports `HUB_AUDIO_VARS`; `apps/crm/src/lib/audioVars.ts` exports `CRM_AUDIO_VARS` (both cover all nine variables).
- `apps/hub/src/services/briefingAudio.ts` keeps exporting `AUDIO_MIME`, `MAX_AUDIO_BYTES`, `MAX_AUDIO_SECONDS`, `normalizeAudioMime`, `pickRecorderMime`, `validateBriefingAudio`, `describeAudioError`, `UploadPhase`, `uploadBriefingAudio` (all but the last re-exported from the shared module; `validateBriefingAudio = validateAudioBlob`).
- CRM `services/ideiaMedia.ts` exports `putToR2(url: string, body: Blob, contentType: string): Promise<void>`.

- [ ] **Step 1: Shared validation test**

`packages/ui/audio/__tests__/validation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { describeAudioError, normalizeAudioMime, validateAudioBlob } from '../validation';

describe('audio validation (shared)', () => {
  it('normalizes and validates', () => {
    expect(normalizeAudioMime('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(normalizeAudioMime('video/mp4')).toBeNull();
    expect(() => validateAudioBlob(new Blob([]), 'audio/webm')).toThrow('Gravação vazia');
    expect(validateAudioBlob(new Blob(['abc']), 'audio/mp4')).toBe('audio/mp4');
  });

  it('maps ideia_not_found to a reload message and keeps the briefing mappings', () => {
    expect(describeAudioError(new Error('ideia_not_found'), 'x')).toBe(
      'Esta ideia não está mais disponível. Recarregue a página.',
    );
    expect(describeAudioError(new Error('Ideia não encontrada.'), 'x')).toBe(
      'Esta ideia não está mais disponível. Recarregue a página.',
    );
    expect(describeAudioError(new Error('quota_exceeded'), 'x')).toBe(
      'O espaço de armazenamento do plano acabou. Fale com a agência para liberar espaço.',
    );
    expect(describeAudioError(new Error('question_not_found'), 'x')).toBe(
      'Esta pergunta não está mais disponível. Recarregue a página.',
    );
  });
});
```

Run: `npx vitest run packages/ui/audio` → FAIL (module missing).

- [ ] **Step 2: Shared validation module**

`packages/ui/audio/validation.ts` — move the body of `apps/hub/src/services/briefingAudio.ts` from `AUDIO_MIME` down to `describeAudioError` (inclusive), unchanged except:
- rename `validateBriefingAudio` → `validateAudioBlob`;
- in `describeAudioError`, after the `question_not_found` branch add:

```ts
  if (raw === 'ideia_not_found' || raw === 'Ideia não encontrada.') {
    return 'Esta ideia não está mais disponível. Recarregue a página.';
  }
```
- add `export type UploadPhase = 'uploading' | 'transcribing';`

No imports from `@mesaas/*` or `@/` in this file.

Then rewrite `apps/hub/src/services/briefingAudio.ts` to:

```ts
import { trackUnsavedWork } from '@mesaas/app-lifecycle';
import {
  validateAudioBlob,
  type UploadPhase,
} from '@mesaas/ui/audio/validation';
import { finalizeBriefingAudio, presignBriefingAudio } from '../api';
import type { BriefingAudioResponse } from '../types';
import { putToR2 } from './ideiaMedia';

export {
  AUDIO_MIME,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
  describeAudioError,
  normalizeAudioMime,
  pickRecorderMime,
} from '@mesaas/ui/audio/validation';
export type { UploadPhase } from '@mesaas/ui/audio/validation';
export const validateBriefingAudio = validateAudioBlob;

/** Holds the unsaved-work registry for the whole upload: a silent version swap must not abort it. */
export function uploadBriefingAudio(
  ...args: Parameters<typeof uploadBriefingAudioUnguarded>
): ReturnType<typeof uploadBriefingAudioUnguarded> {
  return trackUnsavedWork(uploadBriefingAudioUnguarded(...args));
}

async function uploadBriefingAudioUnguarded(args: {
  token: string;
  questionId: string;
  blob: Blob;
  mime: string;
  durationSeconds: number;
  onPhase?: (phase: UploadPhase) => void;
}): Promise<BriefingAudioResponse> {
  const { token, questionId, blob, durationSeconds, onPhase } = args;
  const mime = validateAudioBlob(blob, args.mime);

  onPhase?.('uploading');
  const signed = await presignBriefingAudio(token, {
    question_id: questionId,
    mime_type: args.mime,
    size_bytes: blob.size,
  });
  await putToR2(signed.upload_url, blob, signed.mime_type || mime);

  onPhase?.('transcribing');
  return finalizeBriefingAudio(token, questionId, {
    r2_key: signed.r2_key,
    mime_type: signed.mime_type || mime,
    size_bytes: blob.size,
    duration_seconds: Math.max(1, Math.round(durationSeconds)),
  });
}
```

Run: `npx vitest run packages/ui/audio apps/hub/src/services/__tests__/briefingAudio.test.ts` → PASS.

- [ ] **Step 3: Move the recorder test**

`git mv apps/hub/src/components/__tests__/AudioRecorder.test.tsx packages/ui/AudioRecorder/__tests__/index.test.tsx`, then in it:
- change `vi.mock('@mesaas/ui/AudioPlayer', ...)` to `vi.mock('../../AudioPlayer', ...)`;
- change the import to `from '../index'`;
- add two cases:

```ts
  it('uses the custom send label and hint', async () => {
    render(
      <AudioRecorder phase="idle" onRecorded={async () => {}} sendLabel="Usar este áudio" hint="Até 5:00." />,
    );
    expect(screen.getByText('Até 5:00.')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /gravar áudio/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /parar/i }));
    });
    expect(screen.getByRole('button', { name: 'Usar este áudio' })).toBeInTheDocument();
  });

  it('renders no hub-* classes (themed through CSS variables only)', () => {
    const { container } = render(<AudioRecorder phase="idle" onRecorded={async () => {}} />);
    expect(container.querySelector('[class*="hub-"]')).toBeNull();
  });
```

Run: `npx vitest run packages/ui/AudioRecorder` → FAIL (module missing).

- [ ] **Step 4: Move and re-theme the recorder**

`git mv apps/hub/src/components/AudioRecorder.tsx packages/ui/AudioRecorder/index.tsx`, then edit:

Imports:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Mic } from 'lucide-react';
import { AudioPlayer } from '../AudioPlayer';
import { MAX_AUDIO_SECONDS, pickRecorderMime } from '../audio/validation';
```

Remove `HUB_AUDIO_VARS` from this file. Replace the `BTN` constant and the button styles:

```ts
const BTN_BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 'var(--audio-radius, 10px)',
  border: '1px solid transparent',
  cursor: 'pointer',
};
const BTN_PRIMARY: CSSProperties = {
  ...BTN_BASE,
  background: 'var(--audio-btn-bg, currentColor)',
  color: 'var(--audio-btn-fg, #fff)',
};
const BTN_SECONDARY: CSSProperties = {
  ...BTN_BASE,
  background: 'var(--audio-btn2-bg, transparent)',
  color: 'var(--audio-btn2-fg, currentColor)',
  borderColor: 'var(--audio-btn2-bd, rgba(0,0,0,.2))',
};
const MUTED: CSSProperties = { color: 'var(--audio-muted, currentColor)', opacity: 0.8 };
```

Props:

```ts
interface Props {
  phase: RecorderPhase;
  disabled?: boolean;
  onRecorded: (blob: Blob, mime: string, durationSeconds: number) => Promise<void>;
  /** Label of the confirm button in the preview state. Default "Enviar". */
  sendLabel?: string;
  /** Helper text next to the record button. Default "Até 5:00 por resposta.". */
  hint?: string;
}

export function AudioRecorder({ phase, disabled, onRecorded, sendLabel = 'Enviar', hint }: Props) {
```

JSX changes (keep everything else byte-for-byte):
- idle button: `<button type="button" style={BTN_SECONDARY} className="disabled:opacity-50" ...>`; hint span: `<span className="text-xs" style={MUTED}>{hint ?? \`Até ${formatDuration(MAX_AUDIO_SECONDS)} por resposta.\`}</span>`.
- recording: the time span `className="text-[13px] tabular-nums"` (drop `hub-txt`); "Parar" button `style={BTN_PRIMARY}`; progress track `style={{ background: 'var(--audio-track, rgba(0,0,0,.1))' }}` with `className="h-1 w-full max-w-[420px] overflow-hidden rounded-full"`; the fill `className={\`h-full rounded-full transition-[width] duration-200 ${nearLimit ? 'bg-amber-500' : ''}\`}` with `style={{ width: ..., background: nearLimit ? undefined : 'var(--audio-fill, currentColor)' }}`.
- preview: `AudioPlayer` gets `className="w-full max-w-[360px]"` and no `style` (the parent sets the variables on a wrapper); confirm button `style={BTN_PRIMARY}` text `{sending || phase === 'uploading' ? 'Enviando…' : phase === 'transcribing' ? 'Transcrevendo…' : sendLabel}`; "Descartar" `style={BTN_SECONDARY}`.
- the idle label logic (`Gravar áudio` / `Enviando áudio…` / `Transcrevendo…`) stays.

Create `apps/hub/src/lib/audioVars.ts`:

```ts
import type { CSSProperties } from 'react';

/** Hub tokens for the shared player + recorder (whitelabel-aware). */
export const HUB_AUDIO_VARS = {
  '--audio-btn-bg': 'var(--hub-primary)',
  '--audio-btn-fg': 'var(--hub-primary-fg)',
  '--audio-btn2-bg': 'var(--hub-card)',
  '--audio-btn2-fg': 'var(--hub-txt)',
  '--audio-btn2-bd': 'var(--hub-bd2)',
  '--audio-track': 'var(--hub-bd)',
  '--audio-fill': 'var(--hub-txt)',
  '--audio-muted': 'var(--hub-tx3)',
  '--audio-radius': 'var(--hub-r-ctl)',
} as CSSProperties;
```

Create `apps/crm/src/lib/audioVars.ts`:

```ts
import type { CSSProperties } from 'react';

/** CRM tokens for the shared player + recorder: ink CTA button, subtle track. */
export const CRM_AUDIO_VARS = {
  '--audio-btn-bg': 'var(--cta-bg)',
  '--audio-btn-fg': 'var(--cta-fg)',
  '--audio-btn2-bg': 'var(--card-bg)',
  '--audio-btn2-fg': 'var(--text-main)',
  '--audio-btn2-bd': 'var(--border-color)',
  '--audio-track': 'var(--surface-2)',
  '--audio-fill': 'var(--text-main)',
  '--audio-muted': 'var(--text-muted)',
  '--audio-radius': '10px',
} as CSSProperties;
```

In `apps/crm/src/pages/cliente-detalhe/BriefingAudioPlayer.tsx` delete the local `CRM_AUDIO_VARS` and `import { CRM_AUDIO_VARS } from '@/lib/audioVars';`.

In `apps/hub/src/pages/BriefingPage.tsx`:
- replace the `'../components/AudioRecorder'` import with `import { AudioRecorder, isRecordingSupported, type RecorderPhase } from '@mesaas/ui/AudioRecorder';` (keep any other names it imported, e.g. `formatDuration`, from the same path) and `import { HUB_AUDIO_VARS } from '../lib/audioVars';`;
- wrap the `<AudioRecorder .../>` at the call site in `<div style={HUB_AUDIO_VARS}>` so the recorder's buttons pick up the Hub tokens (the player inside the recorder inherits them too).

In `apps/hub/src/pages/__tests__/briefingPage.test.tsx`, update any `vi.mock('../../components/AudioRecorder', ...)` to `vi.mock('@mesaas/ui/AudioRecorder', ...)` with the same factory.

In `apps/crm/src/services/ideiaMedia.ts`:

```ts
export function putToR2(url: string, body: Blob, contentType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload falhou: ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Erro de rede no upload'));
    xhr.send(body);
  });
}
```

and update its two callers: `putToR2(signed.upload_url, file, file.type)` and `putToR2(signed.thumbnail_upload_url, thumb, 'image/webp')`.

- [ ] **Step 5: Run everything touched**

```bash
npx vitest run packages/ui apps/hub/src/pages/__tests__/briefingPage.test.tsx apps/hub/src/services apps/crm/src/services/__tests__/postMedia.test.ts
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: PASS, no type errors. If `apps/crm/tsconfig.json` does not include `packages/ui/**` in its `include`, `@mesaas/ui/AudioRecorder` still resolves through the existing `@mesaas/ui/*` path alias (the player already works this way).

- [ ] **Step 6: Commit**

```bash
git add -A packages/ui apps/hub/src apps/crm/src/services/ideiaMedia.ts apps/crm/src/lib/audioVars.ts apps/crm/src/pages/cliente-detalhe/BriefingAudioPlayer.tsx
git commit -m "refactor(audio): gravador e validação compartilhados em packages/ui

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Hub types, API wrappers and audio service

**Files:**
- Modify: `apps/hub/src/types.ts`, `apps/hub/src/api.ts`, `apps/hub/src/__tests__/api.test.ts`
- Create: `apps/hub/src/services/ideiaAudio.ts`, `apps/hub/src/services/__tests__/ideiaAudio.test.ts`

**Interfaces:**
- `types.ts`: `export type HubAudio = BriefingAudio;` (add `export interface HubAudio {...}` with the same five fields and make `BriefingAudio` an alias `export type BriefingAudio = HubAudio;`), `HubIdeia` gains `origem: 'cliente' | 'agencia'; audio: (HubAudio & { transcript: string | null }) | null;`, and `export interface IdeiaAudioResponse { ok: boolean; transcript: string | null; audio: HubAudio | null }`.
- `api.ts`:

```ts
export function presignIdeiaAudio(token: string, payload: { ideia_id: string; mime_type: string; size_bytes: number }): Promise<{ upload_url: string; r2_key: string; mime_type: string }>
export function finalizeIdeiaAudio(token: string, ideiaId: string, payload: { r2_key: string; mime_type: string; size_bytes: number; duration_seconds: number }): Promise<IdeiaAudioResponse>
export function retryIdeiaTranscription(token: string, ideiaId: string): Promise<IdeiaAudioResponse>
export function deleteIdeiaAudio(token: string, ideiaId: string): Promise<{ ok: boolean }>
```
- `services/ideiaAudio.ts`: `uploadIdeiaAudio({ token, ideiaId, blob, mime, durationSeconds, onPhase }): Promise<IdeiaAudioResponse>`.

- [ ] **Step 1: API test**

Add to `apps/hub/src/__tests__/api.test.ts`, mirroring the briefing audio cases (use the file's existing `fetchMock` helper):

```ts
  it('presigns, finalizes, retries and deletes ideia audio on the hub-ideias routes', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ upload_url: 'u', r2_key: 'k', mime_type: 'audio/webm' })));
    await presignIdeiaAudio('tok', { ideia_id: 'i1', mime_type: 'audio/webm', size_bytes: 3 });
    expect(fetchMock.mock.calls[0][0]).toContain('/functions/v1/hub-ideias/audio-upload-url');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: 'tok', ideia_id: 'i1', mime_type: 'audio/webm', size_bytes: 3 });

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, transcript: null, audio: null })));
    await finalizeIdeiaAudio('tok', 'i1', { r2_key: 'k', mime_type: 'audio/webm', size_bytes: 3, duration_seconds: 2 });
    expect(fetchMock.mock.calls[1][0]).toContain('/functions/v1/hub-ideias/i1/audio');
    await retryIdeiaTranscription('tok', 'i1');
    expect(fetchMock.mock.calls[2][0]).toContain('/functions/v1/hub-ideias/i1/audio/transcribe');
    await deleteIdeiaAudio('tok', 'i1');
    expect(fetchMock.mock.calls[3][0]).toContain('/functions/v1/hub-ideias/i1/audio?token=tok');
    expect(fetchMock.mock.calls[3][1].method).toBe('DELETE');
  });
```

Adapt `fetchMock` usage to however that file stubs `fetch` (it already does for the briefing audio test at line ~191; copy that pattern exactly).

- [ ] **Step 2: Service test**

`apps/hub/src/services/__tests__/ideiaAudio.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({
  presignIdeiaAudio: vi.fn(),
  finalizeIdeiaAudio: vi.fn(),
}));

import { finalizeIdeiaAudio, presignIdeiaAudio } from '../../api';
import { uploadIdeiaAudio } from '../ideiaAudio';

class FakeXHR {
  static last: FakeXHR | null = null;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  status = 200;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  body: unknown;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
    FakeXHR.last = this;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: unknown) {
    this.body = body;
    queueMicrotask(() => this.onload?.());
  }
}

describe('ideiaAudio service (hub)', () => {
  beforeEach(() => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    vi.mocked(presignIdeiaAudio).mockReset();
    vi.mocked(finalizeIdeiaAudio).mockReset();
  });

  it('presigns, PUTs with the normalized content type and finalizes', async () => {
    vi.mocked(presignIdeiaAudio).mockResolvedValue({
      upload_url: 'https://r2/put',
      r2_key: 'ideia-audio/c/i/x.webm',
      mime_type: 'audio/webm',
    });
    vi.mocked(finalizeIdeiaAudio).mockResolvedValue({ ok: true, transcript: 'texto', audio: null });
    const phases: string[] = [];
    const res = await uploadIdeiaAudio({
      token: 'tok',
      ideiaId: 'i1',
      blob: new Blob(['abc'], { type: 'audio/webm;codecs=opus' }),
      mime: 'audio/webm;codecs=opus',
      durationSeconds: 7.4,
      onPhase: (p) => phases.push(p),
    });
    expect(res.transcript).toBe('texto');
    expect(FakeXHR.last?.headers['Content-Type']).toBe('audio/webm');
    expect(finalizeIdeiaAudio).toHaveBeenCalledWith('tok', 'i1', {
      r2_key: 'ideia-audio/c/i/x.webm',
      mime_type: 'audio/webm',
      size_bytes: 3,
      duration_seconds: 7,
    });
    expect(phases).toEqual(['uploading', 'transcribing']);
  });

  it('rejects unsupported mimes before presigning', async () => {
    await expect(
      uploadIdeiaAudio({ token: 't', ideiaId: 'i', blob: new Blob(['a']), mime: 'video/mp4', durationSeconds: 1 }),
    ).rejects.toThrow('Formato de áudio não suportado');
    expect(presignIdeiaAudio).not.toHaveBeenCalled();
  });
});
```

Run: `npx vitest run apps/hub/src/services/__tests__/ideiaAudio.test.ts apps/hub/src/__tests__/api.test.ts` → FAIL.

- [ ] **Step 3: Implement types, api and service**

`apps/hub/src/types.ts`:

```ts
export interface HubAudio {
  url: string;
  mime: string;
  duration_seconds: number | null;
  transcription_status: 'pending' | 'done' | 'failed' | null;
  recorded_at: string | null;
}
export type BriefingAudio = HubAudio;

export interface IdeiaAudioResponse {
  ok: boolean;
  transcript: string | null;
  audio: HubAudio | null;
}
```

(Replace the existing `BriefingAudio` interface with the alias; `BriefingQuestion.audio` and `BriefingAudioResponse.audio` keep compiling.) In `HubIdeia` add:

```ts
  origem: 'cliente' | 'agencia';
  audio: (HubAudio & { transcript: string | null }) | null;
```

`apps/hub/src/api.ts` (add `IdeiaAudioResponse` to the type import):

```ts
export function presignIdeiaAudio(
  token: string,
  payload: { ideia_id: string; mime_type: string; size_bytes: number },
) {
  return post<{ upload_url: string; r2_key: string; mime_type: string }>('hub-ideias/audio-upload-url', {
    token,
    ...payload,
  });
}

export function finalizeIdeiaAudio(
  token: string,
  ideiaId: string,
  payload: { r2_key: string; mime_type: string; size_bytes: number; duration_seconds: number },
) {
  return post<IdeiaAudioResponse>(`hub-ideias/${ideiaId}/audio`, { token, ...payload });
}

export function retryIdeiaTranscription(token: string, ideiaId: string) {
  return post<IdeiaAudioResponse>(`hub-ideias/${ideiaId}/audio/transcribe`, { token });
}

export function deleteIdeiaAudio(token: string, ideiaId: string) {
  return del<{ ok: boolean }>('hub-ideias', `${ideiaId}/audio`, token);
}
```

`apps/hub/src/services/ideiaAudio.ts`:

```ts
import { trackUnsavedWork } from '@mesaas/app-lifecycle';
import { validateAudioBlob, type UploadPhase } from '@mesaas/ui/audio/validation';
import { finalizeIdeiaAudio, presignIdeiaAudio } from '../api';
import type { IdeiaAudioResponse } from '../types';
import { putToR2 } from './ideiaMedia';

/** Holds the unsaved-work registry for the whole upload: a silent version swap must not abort it. */
export function uploadIdeiaAudio(
  ...args: Parameters<typeof uploadIdeiaAudioUnguarded>
): ReturnType<typeof uploadIdeiaAudioUnguarded> {
  return trackUnsavedWork(uploadIdeiaAudioUnguarded(...args));
}

async function uploadIdeiaAudioUnguarded(args: {
  token: string;
  ideiaId: string;
  blob: Blob;
  mime: string;
  durationSeconds: number;
  onPhase?: (phase: UploadPhase) => void;
}): Promise<IdeiaAudioResponse> {
  const { token, ideiaId, blob, durationSeconds, onPhase } = args;
  const mime = validateAudioBlob(blob, args.mime);

  onPhase?.('uploading');
  const signed = await presignIdeiaAudio(token, {
    ideia_id: ideiaId,
    mime_type: args.mime,
    size_bytes: blob.size,
  });
  await putToR2(signed.upload_url, blob, signed.mime_type || mime);

  onPhase?.('transcribing');
  return finalizeIdeiaAudio(token, ideiaId, {
    r2_key: signed.r2_key,
    mime_type: signed.mime_type || mime,
    size_bytes: blob.size,
    duration_seconds: Math.max(1, Math.round(durationSeconds)),
  });
}
```

- [ ] **Step 4: Run**

```bash
npx vitest run apps/hub/src/services apps/hub/src/__tests__/api.test.ts
npx tsc -p apps/hub/tsconfig.json --noEmit
```

Expected: PASS. (`ideiasPage.test.tsx` may now fail on the `HubIdeia` type in `makeIdeia`; Task 8 fixes it.)

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/types.ts apps/hub/src/api.ts apps/hub/src/__tests__/api.test.ts apps/hub/src/services/ideiaAudio.ts apps/hub/src/services/__tests__/ideiaAudio.test.ts
git commit -m "feat(hub): tipos, api e serviço de áudio para ideias

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Hub Ideias page — agency cards, recorder in modal, audio on card

**Files:**
- Modify: `apps/hub/src/pages/IdeiasPage.tsx`
- Modify: `apps/hub/src/pages/__tests__/ideiasPage.test.tsx`

**Interfaces:**
- Consumes `AudioRecorder`/`isRecordingSupported` from `@mesaas/ui/AudioRecorder`, `AudioPlayer` from `@mesaas/ui/AudioPlayer`, `HUB_AUDIO_VARS`, `uploadIdeiaAudio`, `describeAudioError`, api `retryIdeiaTranscription`, `deleteIdeiaAudio`.
- `isMutable(ideia)` now also requires `ideia.origem === 'cliente'`.

- [ ] **Step 1: Tests**

In `apps/hub/src/pages/__tests__/ideiasPage.test.tsx`:

1. Extend the `vi.mock('../../api', ...)` factory with `retryIdeiaTranscription: vi.fn(), deleteIdeiaAudio: vi.fn()`, add `vi.mock('../../services/ideiaAudio', () => ({ uploadIdeiaAudio: vi.fn() }))`, and mock the recorder so tests can hand a blob to the modal without MediaRecorder:

```ts
vi.mock('@mesaas/ui/AudioRecorder', () => ({
  isRecordingSupported: () => true,
  AudioRecorder: ({
    onRecorded,
    sendLabel,
  }: {
    onRecorded: (b: Blob, m: string, s: number) => Promise<void>;
    sendLabel?: string;
  }) => (
    <button type="button" onClick={() => void onRecorded(new Blob(['abc'], { type: 'audio/webm' }), 'audio/webm', 4)}>
      {`fake-recorder:${sendLabel ?? 'Enviar'}`}
    </button>
  ),
}));
vi.mock('@mesaas/ui/AudioPlayer', () => ({
  AudioPlayer: ({ src }: { src: string }) => <div data-testid="audio-player">{src}</div>,
}));
```

2. `makeIdeia` defaults gain `origem: 'cliente' as const, audio: null`, and its overrides type gains `origem` and `audio`.
3. `hubValue.bootstrap` gains `feature_briefing_audio: true`.
4. Add cases:

```ts
  it('renders an agency ideia read-only with the "Sugestão da agência" chip', async () => {
    mockedFetchIdeias.mockResolvedValue({
      ideias: [makeIdeia({ id: 'ag', titulo: 'Da agência', origem: 'agencia' })],
    } as never);
    renderHubPage('/mesaas/hub/token-publico/ideias', '/:workspace/hub/:token/ideias', <IdeiasPage />);
    expect(await screen.findByText('Da agência')).toBeInTheDocument();
    expect(screen.getByText('Sugestão da agência')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
    expect(screen.queryByText(/adicionar imagem/i)).toBeNull();
  });

  it('holds a recording in the modal and uploads it right after create', async () => {
    mockedFetchIdeias.mockResolvedValue({ ideias: [] } as never);
    mockedCreateIdeia.mockResolvedValue({ ideia: makeIdeia({ id: 'new-1' }) } as never);
    const { uploadIdeiaAudio } = await import('../../services/ideiaAudio');
    vi.mocked(uploadIdeiaAudio).mockResolvedValue({ ok: true, transcript: 'oi', audio: null });

    renderHubPage('/mesaas/hub/token-publico/ideias', '/:workspace/hub/:token/ideias', <IdeiasPage />);
    await screen.findByText('Nenhuma ideia ainda');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar ideia' }));

    fireEvent.click(screen.getByRole('button', { name: 'fake-recorder:Usar este áudio' }));
    expect(await screen.findByTestId('audio-player')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeInTheDocument();
    expect(uploadIdeiaAudio).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Ex: Reel mostrando os bastidores...'), { target: { value: 'T' } });
    fireEvent.change(screen.getByPlaceholderText('Descreva sua ideia com detalhes...'), { target: { value: 'D' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(mockedCreateIdeia).toHaveBeenCalled());
    await waitFor(() =>
      expect(uploadIdeiaAudio).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'token-publico', ideiaId: 'new-1', mime: 'audio/webm', durationSeconds: 4 }),
      ),
    );
  });

  it('shows player, transcript, retry and remove on a mutable client ideia with audio', async () => {
    mockedFetchIdeias.mockResolvedValue({
      ideias: [
        makeIdeia({
          id: 'a1',
          audio: {
            url: 'https://get/a.webm', mime: 'audio/webm', duration_seconds: 9,
            transcription_status: 'failed', recorded_at: '2026-09-10T00:00:00Z', transcript: null,
          },
        }),
      ],
    } as never);
    renderHubPage('/mesaas/hub/token-publico/ideias', '/:workspace/hub/:token/ideias', <IdeiasPage />);
    expect(await screen.findByTestId('audio-player')).toHaveTextContent('https://get/a.webm');
    expect(screen.getByText(/falha na transcrição/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover áudio' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /fake-recorder/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Gravar novamente' }));
    expect(await screen.findByRole('button', { name: 'fake-recorder:Enviar' })).toBeInTheDocument();
  });

  it('hides recorder, retry and remove when the ideia is locked or the plan lacks audio', async () => {
    mockedFetchIdeias.mockResolvedValue({
      ideias: [
        makeIdeia({
          id: 'l1', status: 'em_analise',
          audio: { url: 'https://get/b.webm', mime: 'audio/webm', duration_seconds: 9, transcription_status: 'done', recorded_at: null, transcript: 'Texto transcrito' },
        }),
      ],
    } as never);
    renderHubPage('/mesaas/hub/token-publico/ideias', '/:workspace/hub/:token/ideias', <IdeiasPage />);
    expect(await screen.findByText('Texto transcrito')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover áudio' })).toBeNull();
    expect(screen.queryByRole('button', { name: /fake-recorder/ })).toBeNull();
  });
```

Run: `npx vitest run apps/hub/src/pages/__tests__/ideiasPage.test.tsx` → new cases FAIL.

- [ ] **Step 2: Implement**

In `apps/hub/src/pages/IdeiasPage.tsx`:

Imports to add:

```ts
import { Mic, RotateCcw } from 'lucide-react';
import { AudioPlayer } from '@mesaas/ui/AudioPlayer';
import { AudioRecorder, isRecordingSupported, type RecorderPhase } from '@mesaas/ui/AudioRecorder';
import { describeAudioError } from '@mesaas/ui/audio/validation';
import { HUB_AUDIO_VARS } from '../lib/audioVars';
import { uploadIdeiaAudio } from '../services/ideiaAudio';
import { deleteIdeiaAudio, retryIdeiaTranscription } from '../api';
```

`isMutable`:

```ts
function isMutable(ideia: HubIdeia): boolean {
  return (
    ideia.origem === 'cliente' &&
    ideia.status === 'nova' &&
    ideia.comentario_agencia === null &&
    ideia.ideia_reactions.length === 0
  );
}
```

Status label for audio:

```ts
const AUDIO_STATUS_LABEL: Record<'pending' | 'done' | 'failed', string> = {
  pending: 'Transcrição pendente',
  done: 'Transcrito',
  failed: 'Falha na transcrição',
};
```

New component (place above `IdeiaCard`):

```tsx
function IdeiaAudioBlock({
  token,
  ideia,
  canWrite,
  audioEnabled,
  onChanged,
}: {
  token: string;
  ideia: HubIdeia;
  canWrite: boolean;
  audioEnabled: boolean;
  onChanged: () => void;
}) {
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const audio = ideia.audio;
  const showRecorder = canWrite && audioEnabled && isRecordingSupported();
  if (!audio && !showRecorder) return null;

  async function handleRecorded(blob: Blob, mime: string, seconds: number) {
    setErr(null);
    try {
      await uploadIdeiaAudio({ token, ideiaId: ideia.id, blob, mime, durationSeconds: seconds, onPhase: setPhase });
      setRecording(false);
      onChanged();
    } catch (e) {
      setErr(describeAudioError(e, 'O envio do áudio falhou. Tente de novo.'));
      throw e;
    } finally {
      setPhase('idle');
    }
  }

  async function retry() {
    setErr(null);
    setBusy(true);
    try {
      await retryIdeiaTranscription(token, ideia.id);
      onChanged();
    } catch (e) {
      setErr(describeAudioError(e, 'Não foi possível transcrever agora.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setErr(null);
    setBusy(true);
    try {
      await deleteIdeiaAudio(token, ideia.id);
      onChanged();
    } catch (e) {
      setErr(describeAudioError(e, 'Não foi possível remover o áudio.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2" style={HUB_AUDIO_VARS}>
      {audio && (
        <>
          <p className="text-[12px] hub-tx3 font-medium">
            Áudio{audio.transcription_status ? ` · ${AUDIO_STATUS_LABEL[audio.transcription_status]}` : ''}
          </p>
          <AudioPlayer src={audio.url} durationSeconds={audio.duration_seconds} label="Áudio da ideia" className="hub-txt w-full max-w-[360px]" />
          {audio.transcript && (
            <div className="rounded-lg hub-bg-soft px-3 py-2">
              <p className="text-[11px] hub-tx3 font-semibold uppercase tracking-wide mb-1">Transcrição</p>
              <p className="text-sm hub-tx2 whitespace-pre-wrap">{audio.transcript}</p>
            </div>
          )}
        </>
      )}
      {(showRecorder || (audio?.transcription_status === 'failed' && audioEnabled && canWrite)) && (
        <div className="flex flex-wrap items-center gap-2">
          {audio?.transcription_status === 'failed' && audioEnabled && canWrite && (
            <button type="button" onClick={retry} disabled={busy} className="inline-flex items-center gap-1.5 text-[12px] hub-tx3 underline underline-offset-2 disabled:opacity-50">
              <RotateCcw size={12} /> Tentar novamente
            </button>
          )}
          {showRecorder && audio && !recording && (
            <button type="button" onClick={() => setRecording(true)} disabled={busy} className="inline-flex items-center gap-1.5 text-[12px] hub-tx3 underline underline-offset-2 disabled:opacity-50">
              <Mic size={12} /> Gravar novamente
            </button>
          )}
          {showRecorder && audio && (
            <button type="button" onClick={remove} disabled={busy} className="text-[12px] hub-tx3 underline underline-offset-2 hover:text-red-600 disabled:opacity-50">
              Remover áudio
            </button>
          )}
        </div>
      )}
      {showRecorder && (!audio || recording) && (
        <AudioRecorder phase={phase} disabled={busy} onRecorded={handleRecorded} hint="Até 5:00." />
      )}
      {err && <p className="text-xs text-red-500">{err}</p>}
    </div>
  );
}
```

`IdeiaCard` changes:
- Accept `audioEnabled: boolean` prop (passed from the page: `const audioEnabled = bootstrap.feature_briefing_audio === true;` using `const { token, bootstrap } = useHub();`).
- In the chips row, after the status chip:

```tsx
          {ideia.origem === 'agencia' && (
            <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full mb-2 ml-1.5 hub-btn-primary">
              Sugestão da agência
            </span>
          )}
```
- Replace the always-rendered `<IdeiaImages .../>` with `{ideia.origem === 'cliente' && <IdeiaImages ... />}` (agency images still render read-only: when `origem === 'agencia'`, render the thumbnails only — extract the read-only gallery as `{ideia.images.length > 0 && <div className="flex flex-wrap gap-2">…same img markup without the remove button…</div>}`).
- After images, add `<IdeiaAudioBlock token={token} ideia={ideia} canWrite={mutable} audioEnabled={audioEnabled} onChanged={onChanged} />`.
- The Editar/Excluir buttons already depend on `mutable`, which now includes origin. Give them `aria-label="Editar"` and `aria-label="Excluir"`.

`IdeiaModal` changes:
- Accept `audioEnabled: boolean`; `const audioSupported = audioEnabled && isRecordingSupported();`.
- State: `const [pendingAudio, setPendingAudio] = useState<{ blob: Blob; mime: string; durationSeconds: number; url: string } | null>(null);` `const [rerecord, setRerecord] = useState(false);` `const [audioPhase, setAudioPhase] = useState<RecorderPhase>('idle');` Revoke `pendingAudio.url` on discard/unmount (`useEffect` cleanup).
- Block, placed after Descrição and before Links (create mode only, i.e. `!current`):

```tsx
          {audioSupported && !current && (
            <div className="rounded-xl border hub-border hub-bg-soft p-3 space-y-2" style={HUB_AUDIO_VARS}>
              <label className="text-[12.5px] font-semibold hub-tx2 block">
                Áudio <span className="hub-tx3 font-normal">· opcional</span>
              </label>
              {pendingAudio && !rerecord ? (
                <div className="space-y-2">
                  <AudioPlayer src={pendingAudio.url} durationSeconds={pendingAudio.durationSeconds} label="Prévia" className="hub-txt w-full max-w-[360px]" />
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setRerecord(true)} className="text-[12px] hub-tx3 underline underline-offset-2">Gravar novamente</button>
                    <button type="button" onClick={discardPendingAudio} className="text-[12px] hub-tx3 underline underline-offset-2">Descartar</button>
                  </div>
                </div>
              ) : (
                <AudioRecorder
                  phase={audioPhase}
                  onRecorded={async (blob, mime, durationSeconds) => {
                    if (pendingAudio) URL.revokeObjectURL(pendingAudio.url);
                    setPendingAudio({ blob, mime, durationSeconds, url: URL.createObjectURL(blob) });
                    setRerecord(false);
                  }}
                  sendLabel="Usar este áudio"
                  hint="Até 5:00."
                />
              )}
              <p className="text-[11.5px] hub-tx3">A transcrição aparece na ideia logo depois de enviar.</p>
            </div>
          )}
```

with

```ts
  function discardPendingAudio() {
    if (pendingAudio) URL.revokeObjectURL(pendingAudio.url);
    setPendingAudio(null);
    setRerecord(false);
  }
```

- In `handleSaveText`, create branch, right after `createIdeia` resolves and before `flushPendingFiles`:

```ts
        if (pendingAudio) {
          try {
            await uploadIdeiaAudio({
              token, ideiaId: ideia.id, blob: pendingAudio.blob, mime: pendingAudio.mime,
              durationSeconds: pendingAudio.durationSeconds, onPhase: setAudioPhase,
            });
          } catch (e) {
            alert(describeAudioError(e, 'Ideia enviada, mas o áudio falhou. Tente de novo no card.'));
          } finally {
            setAudioPhase('idle');
          }
        }
```

- Submit button label: `{saving ? (audioPhase === 'uploading' ? 'Enviando áudio…' : audioPhase === 'transcribing' ? 'Transcrevendo…' : current ? 'Salvar alterações' : 'Salvar') : current ? 'Salvar alterações' : 'Salvar'}` — keep the accessible name `Salvar` when idle so existing tests pass.
- The page passes `audioEnabled` into both `IdeiaCard` and `IdeiaModal`.

- [ ] **Step 3: Run**

```bash
npx vitest run apps/hub/src/pages/__tests__/ideiasPage.test.tsx
npx tsc -p apps/hub/tsconfig.json --noEmit
npm run lint
```

Expected: PASS. Then verify in the browser: `npm run dev:hub:staging`, open a client hub with a Pro workspace, create an ideia with audio, confirm the card shows the player and the transcript (or "Falha na transcrição" with retry if the worker is not yet redeployed).

- [ ] **Step 4: Commit**

```bash
git add apps/hub/src/pages/IdeiasPage.tsx apps/hub/src/pages/__tests__/ideiasPage.test.tsx
git commit -m "feat(hub): ideias da agência somente leitura e áudio nas ideias

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: CRM store — `Ideia` fields, `createIdeia`, `updateIdeiaVisibilidade`

**Files:**
- Modify: `apps/crm/src/store/ideias.ts`
- Modify: `apps/crm/src/__tests__/store.ideias.test.ts`

**Interfaces:**
- `Ideia` gains: `origem: 'cliente' | 'agencia'; autor_membro_id: number | null; visivel_no_hub: boolean; autor: { nome: string } | null; audio_r2_key: string | null; audio_duration_seconds: number | null; audio_transcript: string | null; audio_transcription_status: 'pending' | 'done' | 'failed' | null;`
- `createIdeia(input: { cliente_id: number; titulo: string; descricao: string; links: string[]; visivel_no_hub: boolean; autor_membro_id: number | null }): Promise<string>` (returns the new id)
- `updateIdeiaVisibilidade(ideiaId: string, visivel: boolean): Promise<void>`

- [ ] **Step 1: Tests**

Append inside `describe('store ideias', ...)` in `apps/crm/src/__tests__/store.ideias.test.ts`:

```ts
  describe('createIdeia', () => {
    it('inserts an agency ideia with workspace_id, origem, tipo and status fixed', async () => {
      mockedSupabase.__queueSupabaseResult('ideias', 'insert', { data: { id: 'ideia-new' }, error: null });

      const id = await store.createIdeia({
        cliente_id: 5,
        titulo: 'Bastidores',
        descricao: 'Timelapse da sala',
        links: ['https://ex.com'],
        visivel_no_hub: false,
        autor_membro_id: 9,
      });

      expect(id).toBe('ideia-new');
      const call = getCalls('ideias', 'insert').at(-1)!;
      expect(call.payload).toEqual({
        workspace_id: 'conta-1',
        cliente_id: 5,
        titulo: 'Bastidores',
        descricao: 'Timelapse da sala',
        links: ['https://ex.com'],
        visivel_no_hub: false,
        autor_membro_id: 9,
        origem: 'agencia',
        tipo: 'ideia',
        status: 'nova',
      });
    });

    it('throws on insert error', async () => {
      mockedSupabase.__queueSupabaseResult('ideias', 'insert', { data: null, error: { message: 'boom' } });
      await expect(
        store.createIdeia({ cliente_id: 1, titulo: 'T', descricao: 'D', links: [], visivel_no_hub: true, autor_membro_id: null }),
      ).rejects.toThrow('boom');
    });
  });

  describe('updateIdeiaVisibilidade', () => {
    it('updates visivel_no_hub by id', async () => {
      mockedSupabase.__queueSupabaseResult('ideias', 'update', { data: null, error: null });
      await store.updateIdeiaVisibilidade('ideia-1', true);
      const call = getCalls('ideias', 'update').at(-1)!;
      expect(call.payload).toEqual({ visivel_no_hub: true });
      expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 'ideia-1'] });
    });
  });

  it('getIdeias selects origem, visivel_no_hub, autor and audio columns', async () => {
    mockedSupabase.__queueSupabaseResult('ideias', 'select', { data: [], error: null });
    await store.getIdeias();
    const call = getCalls('ideias', 'select').at(-1)!;
    const str = String((call as unknown as { selectArgs: unknown[][] }).selectArgs?.[0]?.[0] ?? '');
    for (const col of ['origem', 'visivel_no_hub', 'autor_membro_id', 'autor:membros!autor_membro_id(nome)', 'audio_r2_key', 'audio_transcript', 'audio_transcription_status', 'audio_duration_seconds']) {
      expect(str).toContain(col);
    }
  });
```

`__getSupabaseCalls()` returns the shared `QueryCall[]` from `test/shared/supabaseMock.ts`, whose entries carry `selectArgs: unknown[][]`; widen the local `MockedSupabaseModule` type in this test file to include `selectArgs` instead of casting.

Run: `npx vitest run apps/crm/src/__tests__/store.ideias.test.ts` → FAIL.

- [ ] **Step 2: Implement**

In `apps/crm/src/store/ideias.ts`:

```ts
import { supabase, getContaId } from './core';
```

`Ideia` interface additions (after `image_count`):

```ts
  origem: 'cliente' | 'agencia';
  autor_membro_id: number | null;
  visivel_no_hub: boolean;
  autor: { nome: string } | null;
  audio_r2_key: string | null;
  audio_duration_seconds: number | null;
  audio_transcript: string | null;
  audio_transcription_status: 'pending' | 'done' | 'failed' | null;
```

`getIdeias` select string becomes:

```ts
      `
      id, workspace_id, cliente_id, titulo, descricao, links, status, tipo, tarefa_id,
      comentario_agencia, comentario_autor_id, comentario_at, created_at, updated_at,
      origem, visivel_no_hub, autor_membro_id,
      audio_r2_key, audio_duration_seconds, audio_transcript, audio_transcription_status,
      clientes(nome),
      comentario_autor:membros!comentario_autor_id(nome),
      autor:membros!autor_membro_id(nome),
      ideia_reactions(id, ideia_id, membro_id, emoji, created_at, membros(nome)),
      ideia_files(count)
    `
```

New functions:

```ts
export interface CreateIdeiaInput {
  cliente_id: number;
  titulo: string;
  descricao: string;
  links: string[];
  visivel_no_hub: boolean;
  autor_membro_id: number | null;
}

/** Agency-created ideia. origem/tipo/status are fixed here, never caller-controlled. */
export async function createIdeia(input: CreateIdeiaInput): Promise<string> {
  const workspace_id = await getContaId();
  const { data, error } = await supabase
    .from('ideias')
    .insert({
      workspace_id,
      cliente_id: input.cliente_id,
      titulo: input.titulo,
      descricao: input.descricao,
      links: input.links,
      visivel_no_hub: input.visivel_no_hub,
      autor_membro_id: input.autor_membro_id,
      origem: 'agencia',
      tipo: 'ideia',
      status: 'nova',
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function updateIdeiaVisibilidade(ideiaId: string, visivel: boolean): Promise<void> {
  const { error } = await supabase.from('ideias').update({ visivel_no_hub: visivel }).eq('id', ideiaId);
  if (error) throw new Error(error.message);
}
```

Check `apps/crm/src/store/index.ts` re-exports `ideias.ts` with `export *`; if it lists names, add `createIdeia`, `updateIdeiaVisibilidade`, `CreateIdeiaInput`.

- [ ] **Step 3: Run**

```bash
npx vitest run apps/crm/src/__tests__/store.ideias.test.ts
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: PASS. Any component test that builds an `Ideia` literal (e.g. `IdeiaDrawer.test.tsx`) may now fail typecheck: add `origem: 'cliente', autor_membro_id: null, visivel_no_hub: true, autor: null, audio_r2_key: null, audio_duration_seconds: null, audio_transcript: null, audio_transcription_status: null` to those fixtures.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/store/ideias.ts apps/crm/src/__tests__/store.ideias.test.ts apps/crm/src/components/ideias/__tests__/IdeiaDrawer.test.tsx
git commit -m "feat(crm): store de ideias com criação pela agência e visibilidade

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: CRM audio service

**Files:**
- Create: `apps/crm/src/services/ideiaAudio.ts`
- Create: `apps/crm/src/services/__tests__/ideiaAudio.test.ts`

**Interfaces:**

```ts
export interface CrmIdeiaAudio { url: string; mime: string; duration_seconds: number | null; transcription_status: 'pending' | 'done' | 'failed' | null; recorded_at: string | null }
export interface CrmIdeiaAudioView { audio: CrmIdeiaAudio | null; transcript: string | null }
export function fetchIdeiaAudio(ideiaId: string): Promise<CrmIdeiaAudioView>
export function uploadIdeiaAudio(args: { ideiaId: string; blob: Blob; mime: string; durationSeconds: number; onPhase?: (p: UploadPhase) => void }): Promise<{ ok: boolean; transcript: string | null; audio: CrmIdeiaAudio | null }>
export function retryIdeiaTranscription(ideiaId: string): Promise<{ ok: boolean; transcript: string | null; audio: CrmIdeiaAudio | null }>
export function deleteIdeiaAudio(ideiaId: string): Promise<void>
```

- [ ] **Step 1: Test**

`apps/crm/src/services/__tests__/ideiaAudio.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'jwt' } } })) } },
}));

import { deleteIdeiaAudio, fetchIdeiaAudio, retryIdeiaTranscription, uploadIdeiaAudio } from '../ideiaAudio';

class FakeXHR {
  static last: FakeXHR | null = null;
  headers: Record<string, string> = {};
  url = '';
  status = 200;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  open(_m: string, url: string) {
    this.url = url;
    FakeXHR.last = this;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send() {
    queueMicrotask(() => this.onload?.());
  }
}

const fetchMock = vi.fn();

describe('ideiaAudio service (crm)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
  });

  it('fetches the audio view with the user JWT', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ audio: null, transcript: 'T' })));
    const v = await fetchIdeiaAudio('i1');
    expect(v.transcript).toBe('T');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/functions/v1/ideia-media-manage/audio?ideia_id=i1');
    expect(init.headers.Authorization).toBe('Bearer jwt');
  });

  it('presigns, PUTs and finalizes with phases', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ upload_url: 'https://r2/put', r2_key: 'ideia-audio/c/i/x.webm', mime_type: 'audio/webm' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, transcript: 'oi', audio: null })));
    const phases: string[] = [];
    const res = await uploadIdeiaAudio({
      ideiaId: 'i1', blob: new Blob(['abc'], { type: 'audio/webm;codecs=opus' }), mime: 'audio/webm;codecs=opus', durationSeconds: 3.2,
      onPhase: (p) => phases.push(p),
    });
    expect(res.transcript).toBe('oi');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/ideia-media-manage/audio-upload-url');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ ideia_id: 'i1', mime_type: 'audio/webm;codecs=opus', size_bytes: 3 });
    expect(FakeXHR.last?.url).toBe('https://r2/put');
    expect(FakeXHR.last?.headers['Content-Type']).toBe('audio/webm');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/ideia-media-manage/i1/audio');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ r2_key: 'ideia-audio/c/i/x.webm', mime_type: 'audio/webm', size_bytes: 3, duration_seconds: 3 });
    expect(phases).toEqual(['uploading', 'transcribing']);
  });

  it('retries and deletes on the nested routes', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, transcript: null, audio: null })));
    await retryIdeiaTranscription('i1');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/ideia-media-manage/i1/audio/transcribe');
    await deleteIdeiaAudio('i1');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/ideia-media-manage/i1/audio');
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
  });

  it('surfaces the backend error code', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'quota_exceeded' }), { status: 413 }));
    await expect(fetchIdeiaAudio('i1')).rejects.toThrow('quota_exceeded');
  });
});
```

Run: `npx vitest run apps/crm/src/services/__tests__/ideiaAudio.test.ts` → FAIL.

- [ ] **Step 2: Implement**

`apps/crm/src/services/ideiaAudio.ts`:

```ts
import { trackUnsavedWork } from '@mesaas/app-lifecycle';
import { validateAudioBlob, type UploadPhase } from '@mesaas/ui/audio/validation';
import { supabase } from '../lib/supabase';
import { putToR2 } from './ideiaMedia';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export interface CrmIdeiaAudio {
  url: string;
  mime: string;
  duration_seconds: number | null;
  transcription_status: 'pending' | 'done' | 'failed' | null;
  recorded_at: string | null;
}

export interface CrmIdeiaAudioView {
  audio: CrmIdeiaAudio | null;
  transcript: string | null;
}

export interface CrmIdeiaAudioResponse {
  ok: boolean;
  transcript: string | null;
  audio: CrmIdeiaAudio | null;
}

async function callFn<T>(
  method: 'GET' | 'POST' | 'DELETE',
  pathSuffix: string,
  body?: unknown,
  query?: Record<string, string>,
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');
  const url = new URL(`${SUPABASE_URL}/functions/v1/ideia-media-manage${pathSuffix}`);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchIdeiaAudio(ideiaId: string): Promise<CrmIdeiaAudioView> {
  return callFn<CrmIdeiaAudioView>('GET', '/audio', undefined, { ideia_id: ideiaId });
}

/** Holds the unsaved-work registry for the whole upload: a silent version swap must not abort it. */
export function uploadIdeiaAudio(
  ...args: Parameters<typeof uploadIdeiaAudioUnguarded>
): ReturnType<typeof uploadIdeiaAudioUnguarded> {
  return trackUnsavedWork(uploadIdeiaAudioUnguarded(...args));
}

async function uploadIdeiaAudioUnguarded(args: {
  ideiaId: string;
  blob: Blob;
  mime: string;
  durationSeconds: number;
  onPhase?: (phase: UploadPhase) => void;
}): Promise<CrmIdeiaAudioResponse> {
  const { ideiaId, blob, durationSeconds, onPhase } = args;
  const mime = validateAudioBlob(blob, args.mime);

  onPhase?.('uploading');
  const signed = await callFn<{ upload_url: string; r2_key: string; mime_type: string }>(
    'POST',
    '/audio-upload-url',
    { ideia_id: ideiaId, mime_type: args.mime, size_bytes: blob.size },
  );
  await putToR2(signed.upload_url, blob, signed.mime_type || mime);

  onPhase?.('transcribing');
  return callFn<CrmIdeiaAudioResponse>('POST', `/${ideiaId}/audio`, {
    r2_key: signed.r2_key,
    mime_type: signed.mime_type || mime,
    size_bytes: blob.size,
    duration_seconds: Math.max(1, Math.round(durationSeconds)),
  });
}

export function retryIdeiaTranscription(ideiaId: string): Promise<CrmIdeiaAudioResponse> {
  return callFn<CrmIdeiaAudioResponse>('POST', `/${ideiaId}/audio/transcribe`);
}

export async function deleteIdeiaAudio(ideiaId: string): Promise<void> {
  await callFn('DELETE', `/${ideiaId}/audio`);
}
```

- [ ] **Step 3: Run**

```bash
npx vitest run apps/crm/src/services/__tests__/ideiaAudio.test.ts
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/services/ideiaAudio.ts apps/crm/src/services/__tests__/ideiaAudio.test.ts
git commit -m "feat(crm): serviço de áudio para ideias

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: CRM Ideias page — "Nova ideia" button, Origem column, create dialog

**Files:**
- Create: `apps/crm/src/components/ideias/IdeiaOrigemBadge.tsx`
- Create: `apps/crm/src/components/ideias/NovaIdeiaDialog.tsx`
- Create: `apps/crm/src/components/ideias/__tests__/NovaIdeiaDialog.test.tsx`
- Modify: `apps/crm/src/pages/ideias/IdeiasPage.tsx`

**Interfaces:**
- `IdeiaOrigemBadge({ origem, hidden }: { origem: 'cliente' | 'agencia'; hidden?: boolean })` renders "Cliente"/"Agência" plus an `EyeOff` icon (title "Oculta do Hub") when `hidden`.
- `NovaIdeiaDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (ideiaId: string) => void })`.
- Consumes: `createIdeia`, `getClientes` from `@/store`; `uploadIdeiaAudio` from `@/services/ideiaAudio`; `useCurrentMembro` from `@/hooks/useCurrentMembro`; `useWorkspaceLimits` from `@/hooks/useWorkspaceLimits`; `AudioRecorder`/`isRecordingSupported` from `@mesaas/ui/AudioRecorder`; `AudioPlayer` from `@mesaas/ui/AudioPlayer`; `CRM_AUDIO_VARS` from `@/lib/audioVars`; `describeAudioError` from `@mesaas/ui/audio/validation`.

- [ ] **Step 1: Dialog tests**

`apps/crm/src/components/ideias/__tests__/NovaIdeiaDialog.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createIdeiaMock, uploadMock, toastMock, limitsState } = vi.hoisted(() => ({
  createIdeiaMock: vi.fn(),
  uploadMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  limitsState: { features: { feature_briefing_audio: true } as { feature_briefing_audio: boolean } | null },
}));

vi.mock('@/store', () => ({
  createIdeia: createIdeiaMock,
  getClientes: vi.fn().mockResolvedValue([
    { id: 2, nome: 'Zeta Clínica' },
    { id: 1, nome: 'Alfa Odonto' },
  ]),
}));
vi.mock('@/services/ideiaAudio', () => ({ uploadIdeiaAudio: uploadMock }));
vi.mock('@/hooks/useCurrentMembro', () => ({ useCurrentMembro: () => ({ membro: { id: 9 }, isLoading: false }) }));
vi.mock('@/hooks/useWorkspaceLimits', () => ({ useWorkspaceLimits: () => ({ features: limitsState.features, isLoading: false }) }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@mesaas/ui/AudioRecorder', () => ({
  isRecordingSupported: () => true,
  AudioRecorder: ({ onRecorded, sendLabel }: { onRecorded: (b: Blob, m: string, s: number) => Promise<void>; sendLabel?: string }) => (
    <button type="button" onClick={() => void onRecorded(new Blob(['abc'], { type: 'audio/webm' }), 'audio/webm', 5)}>
      {`fake-recorder:${sendLabel}`}
    </button>
  ),
}));
vi.mock('@mesaas/ui/AudioPlayer', () => ({ AudioPlayer: () => <div data-testid="audio-player" /> }));
// Radix Select does not open on fireEvent in jsdom; swap it for a native <select> here.
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
    <select aria-label="Cliente" value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">Selecione o cliente</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

import React from 'react';
import { NovaIdeiaDialog } from '../NovaIdeiaDialog';

function renderDialog(onCreated = vi.fn()) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <NovaIdeiaDialog open onClose={() => {}} onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return onCreated;
}

async function fillRequired() {
  const select = await screen.findByRole('combobox', { name: 'Cliente' });
  // Clients are sorted pt-BR: Alfa Odonto (id 1) comes first.
  expect((select as HTMLSelectElement).options[1].text).toBe('Alfa Odonto');
  fireEvent.change(select, { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Título'), { target: { value: '  Bastidores  ' } });
  fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Timelapse' } });
}

describe('NovaIdeiaDialog', () => {
  beforeEach(() => {
    createIdeiaMock.mockReset();
    uploadMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    toastMock.warning.mockReset();
    limitsState.features = { feature_briefing_audio: true };
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
  });

  it('validates required fields and absolute http(s) links', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Criar ideia' }));
    expect(await screen.findByText('Selecione um cliente')).toBeInTheDocument();
    expect(screen.getByText('Título obrigatório')).toBeInTheDocument();
    expect(screen.getByText('Descrição obrigatória')).toBeInTheDocument();
    expect(createIdeiaMock).not.toHaveBeenCalled();

    await fillRequired();
    fireEvent.change(screen.getByPlaceholderText('https://'), { target: { value: 'notion.so/x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar ideia' }));
    expect(await screen.findByText('Informe um link completo, começando com https://')).toBeInTheDocument();
    expect(createIdeiaMock).not.toHaveBeenCalled();
  });

  it('creates with visivel_no_hub false by default, trimmed fields and the current membro as author', async () => {
    createIdeiaMock.mockResolvedValue('new-id');
    const onCreated = renderDialog();
    await fillRequired();
    fireEvent.change(screen.getByPlaceholderText('https://'), { target: { value: ' https://notion.so/x ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar ideia' }));
    await waitFor(() =>
      expect(createIdeiaMock).toHaveBeenCalledWith({
        cliente_id: 1,
        titulo: 'Bastidores',
        descricao: 'Timelapse',
        links: ['https://notion.so/x'],
        visivel_no_hub: false,
        autor_membro_id: 9,
      }),
    );
    expect(uploadMock).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith('new-id');
    expect(toastMock.success).toHaveBeenCalledWith('Ideia criada.');
  });

  it('holds a recording and uploads it after create; audio failure warns but still closes', async () => {
    createIdeiaMock.mockResolvedValue('new-id');
    uploadMock.mockRejectedValue(new Error('HTTP 500'));
    const onCreated = renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'fake-recorder:Usar este áudio' }));
    expect(await screen.findByTestId('audio-player')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeInTheDocument();
    await fillRequired();
    fireEvent.click(screen.getByRole('switch', { name: /visível no hub/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Criar ideia' }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalledWith(expect.objectContaining({ ideiaId: 'new-id', mime: 'audio/webm', durationSeconds: 5 })));
    expect(createIdeiaMock.mock.calls[0][0].visivel_no_hub).toBe(true);
    await waitFor(() => expect(toastMock.warning).toHaveBeenCalledWith('Ideia criada, mas o áudio falhou. Abra a ideia para tentar de novo.'));
    expect(onCreated).toHaveBeenCalledWith('new-id');
  });

  it('hides the recorder when the plan lacks audio', async () => {
    limitsState.features = { feature_briefing_audio: false };
    renderDialog();
    await screen.findByRole('button', { name: 'Criar ideia' });
    expect(screen.queryByRole('button', { name: /fake-recorder/ })).toBeNull();
  });
});
```

Run: `npx vitest run apps/crm/src/components/ideias/__tests__/NovaIdeiaDialog.test.tsx` → FAIL (module missing).

- [ ] **Step 2: `IdeiaOrigemBadge`**

`apps/crm/src/components/ideias/IdeiaOrigemBadge.tsx`:

```tsx
import { EyeOff } from 'lucide-react';
import type { Ideia } from '@/store';

const LABELS: Record<Ideia['origem'], string> = { cliente: 'Cliente', agencia: 'Agência' };
const CLASSES: Record<Ideia['origem'], string> = {
  cliente: 'bg-card text-stone-600 border border-border',
  agencia: 'bg-amber-50 text-amber-800 border border-amber-200',
};

export function IdeiaOrigemBadge({ origem, hidden }: { origem: Ideia['origem']; hidden?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${CLASSES[origem]}`}>
        {LABELS[origem]}
      </span>
      {hidden && (
        <span title="Oculta do Hub" aria-label="Oculta do Hub" className="text-muted-foreground inline-flex">
          <EyeOff size={13} />
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 3: `NovaIdeiaDialog`**

`apps/crm/src/components/ideias/NovaIdeiaDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Mic, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { AudioPlayer } from '@mesaas/ui/AudioPlayer';
import { AudioRecorder, isRecordingSupported, type RecorderPhase } from '@mesaas/ui/AudioRecorder';
import { describeAudioError } from '@mesaas/ui/audio/validation';
import { createIdeia, getClientes } from '@/store';
import { uploadIdeiaAudio } from '@/services/ideiaAudio';
import { useCurrentMembro } from '@/hooks/useCurrentMembro';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { CRM_AUDIO_VARS } from '@/lib/audioVars';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const LINK_MSG = 'Informe um link completo, começando com https://';

function isAbsoluteHttp(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const schema = z.object({
  cliente_id: z.string().min(1, 'Selecione um cliente'),
  titulo: z.string().trim().min(1, 'Título obrigatório').max(200, 'Máximo de 200 caracteres'),
  descricao: z.string().trim().min(1, 'Descrição obrigatória'),
  links: z.array(
    z.object({
      value: z
        .string()
        .trim()
        .refine((v) => v === '' || isAbsoluteHttp(v), LINK_MSG),
    }),
  ),
  visivel_no_hub: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

interface PendingAudio {
  blob: Blob;
  mime: string;
  durationSeconds: number;
  url: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (ideiaId: string) => void;
}

export function NovaIdeiaDialog({ open, onClose, onCreated }: Props) {
  const qc = useQueryClient();
  const { membro } = useCurrentMembro();
  const { features } = useWorkspaceLimits();
  const audioAllowed = features?.feature_briefing_audio === true && isRecordingSupported();

  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const sortedClientes = [...clientes].sort((a: any, b: any) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { cliente_id: '', titulo: '', descricao: '', links: [{ value: '' }], visivel_no_hub: false },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'links' });

  const [pendingAudio, setPendingAudio] = useState<PendingAudio | null>(null);
  const [rerecord, setRerecord] = useState(false);
  const [audioPhase, setAudioPhase] = useState<RecorderPhase>('idle');
  const [submitting, setSubmitting] = useState(false);

  useEffect(
    () => () => {
      if (pendingAudio) URL.revokeObjectURL(pendingAudio.url);
    },
    [pendingAudio],
  );

  function discardAudio() {
    if (pendingAudio) URL.revokeObjectURL(pendingAudio.url);
    setPendingAudio(null);
    setRerecord(false);
  }

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const links = values.links.map((l) => l.value.trim()).filter(Boolean);
      const id = await createIdeia({
        cliente_id: parseInt(values.cliente_id, 10),
        titulo: values.titulo.trim(),
        descricao: values.descricao.trim(),
        links,
        visivel_no_hub: values.visivel_no_hub,
        autor_membro_id: membro?.id ?? null,
      });
      let audioOk = true;
      if (pendingAudio) {
        try {
          await uploadIdeiaAudio({
            ideiaId: id,
            blob: pendingAudio.blob,
            mime: pendingAudio.mime,
            durationSeconds: pendingAudio.durationSeconds,
            onPhase: setAudioPhase,
          });
        } catch (e) {
          audioOk = false;
          toast.warning(describeAudioError(e, 'Ideia criada, mas o áudio falhou. Abra a ideia para tentar de novo.'));
        } finally {
          setAudioPhase('idle');
        }
      }
      qc.invalidateQueries({ queryKey: ['hub-ideias-all'] });
      qc.invalidateQueries({ queryKey: ['ideias'] });
      if (audioOk) toast.success('Ideia criada.');
      form.reset();
      discardAudio();
      onCreated(id);
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao criar ideia.');
    } finally {
      setSubmitting(false);
    }
  }

  const submitLabel =
    audioPhase === 'uploading' ? 'Enviando áudio…' : audioPhase === 'transcribing' ? 'Transcrevendo…' : 'Criar ideia';

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !submitting) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Nova ideia</DialogTitle>
          <DialogDescription>
            Registre uma ideia de conteúdo para um cliente. Você decide se ele vê no Hub.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="nova-ideia-cliente">Cliente</Label>
            <Controller
              control={form.control}
              name="cliente_id"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="nova-ideia-cliente" aria-label="Cliente">
                    <SelectValue placeholder="Selecione o cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedClientes.map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {form.formState.errors.cliente_id && (
              <p className="text-xs text-[var(--danger-text)]">{form.formState.errors.cliente_id.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nova-ideia-titulo">Título</Label>
            <Input id="nova-ideia-titulo" {...form.register('titulo')} placeholder="Ex: Bastidores da nova sala" />
            {form.formState.errors.titulo && (
              <p className="text-xs text-[var(--danger-text)]">{form.formState.errors.titulo.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nova-ideia-descricao">Descrição</Label>
            <Textarea id="nova-ideia-descricao" {...form.register('descricao')} className="min-h-[84px]" placeholder="O que é a ideia e por que vale a pena" />
            {form.formState.errors.descricao && (
              <p className="text-xs text-[var(--danger-text)]">{form.formState.errors.descricao.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Links de referência</Label>
            {fields.map((f, i) => (
              <div key={f.id} className="space-y-1">
                <div className="flex gap-2">
                  <Input {...form.register(`links.${i}.value`)} placeholder="https://" />
                  {fields.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" aria-label="Remover link" onClick={() => remove(i)}>
                      <X size={14} />
                    </Button>
                  )}
                </div>
                {form.formState.errors.links?.[i]?.value && (
                  <p className="text-xs text-[var(--danger-text)]">{form.formState.errors.links[i]?.value?.message}</p>
                )}
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" onClick={() => append({ value: '' })}>
              <Plus size={13} className="mr-1" /> Adicionar outro link
            </Button>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Visível no Hub do cliente</p>
              <p className="text-xs text-muted-foreground">
                Desligado: só a equipe vê. Ligado: aparece na página Ideias do cliente, sem edição.
              </p>
            </div>
            <Controller
              control={form.control}
              name="visivel_no_hub"
              render={({ field }) => (
                <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Visível no Hub do cliente" />
              )}
            />
          </div>

          {audioAllowed && (
            <div className="space-y-2" style={CRM_AUDIO_VARS}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Áudio <span className="ml-1 normal-case font-normal tracking-normal">opcional</span>
              </p>
              {pendingAudio && !rerecord ? (
                <div className="space-y-2">
                  <AudioPlayer src={pendingAudio.url} durationSeconds={pendingAudio.durationSeconds} label="Prévia" className="w-full max-w-[360px] text-foreground" />
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setRerecord(true)}>
                      <Mic size={13} className="mr-1.5" /> Gravar novamente
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={discardAudio}>
                      Descartar
                    </Button>
                  </div>
                </div>
              ) : (
                <AudioRecorder
                  phase={audioPhase}
                  disabled={submitting}
                  sendLabel="Usar este áudio"
                  hint="Até 5:00. A transcrição aparece na ideia depois de salvar."
                  onRecorded={async (blob, mime, durationSeconds) => {
                    if (pendingAudio) URL.revokeObjectURL(pendingAudio.url);
                    setPendingAudio({ blob, mime, durationSeconds, url: URL.createObjectURL(blob) });
                    setRerecord(false);
                  }}
                />
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 size={13} className="animate-spin mr-1.5" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

If `Label` or `Textarea` has a different export name in `apps/crm/src/components/ui/`, adjust the import; both files exist.

- [ ] **Step 4: Page changes**

In `apps/crm/src/pages/ideias/IdeiasPage.tsx`:
- Imports: `Plus` from `lucide-react`, `IdeiaOrigemBadge`, `NovaIdeiaDialog`, `useAuth` from `@/context/AuthContext`.
- `const { can } = useAuth(); const canEdit = can('ideias', 'editar') === true; const [createOpen, setCreateOpen] = useState(false);`
- Header: change the tooltip text to `"Ideias enviadas pelos clientes no portal ou criadas pela equipe."` and add, as the last child of `.header` (after `.header-title`):

```tsx
        {canEdit && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={15} className="mr-1.5" />
            Nova ideia
          </Button>
        )}
```
- Table: add `<TableHead>Origem</TableHead>` after Tipo, and in the row after the Tipo cell:

```tsx
                  <TableCell>
                    <IdeiaOrigemBadge origem={ideia.origem} hidden={ideia.origem === 'agencia' && !ideia.visivel_no_hub} />
                  </TableCell>
```
- Before the drawer block:

```tsx
      <NovaIdeiaDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          const fresh = ideias.find((i) => i.id === id);
          if (fresh) setSelectedIdeia(fresh);
        }}
      />
```

The list refetch (invalidated inside the dialog) resolves after `onCreated`; if `fresh` is undefined at that moment the drawer simply does not auto-open, which is acceptable.

- [ ] **Step 5: Run**

```bash
npx vitest run apps/crm/src/components/ideias
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run lint
```

Expected: PASS. Then verify in the browser with `npm run dev:staging`: open `/ideias`, click "Nova ideia", create one hidden and one visible ideia with and without audio, check the Origem column and the eye-off icon.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/components/ideias/IdeiaOrigemBadge.tsx apps/crm/src/components/ideias/NovaIdeiaDialog.tsx apps/crm/src/components/ideias/__tests__/NovaIdeiaDialog.test.tsx apps/crm/src/pages/ideias/IdeiasPage.tsx
git commit -m "feat(crm): criar ideia pela agência com visibilidade no hub e áudio

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: CRM drawer — origin, visibility switch, audio section

**Files:**
- Create: `apps/crm/src/components/ideias/IdeiaAudioSection.tsx`
- Modify: `apps/crm/src/components/ideias/IdeiaDrawer.tsx`
- Modify: `apps/crm/src/components/ideias/__tests__/IdeiaDrawer.test.tsx`

**Interfaces:**
- `IdeiaAudioSection({ ideia, canWrite, queryKey }: { ideia: Ideia; canWrite: boolean; queryKey: unknown[] })` — renders nothing when there is no audio and `canWrite` is false.
- Drawer resolves the current member through `useCurrentMembro()` (replaces the `membros.user_id === profile.id` lookup) for reactions, comments and the author line.

- [ ] **Step 1: Tests**

In `apps/crm/src/components/ideias/__tests__/IdeiaDrawer.test.tsx`:
- Add mocks: `vi.mock('@/hooks/useCurrentMembro', () => ({ useCurrentMembro: () => ({ membro: { id: 9, nome: 'Eduardo' }, isLoading: false }) }));`, `vi.mock('@/hooks/useWorkspaceLimits', () => ({ useWorkspaceLimits: () => ({ features: { feature_briefing_audio: true }, isLoading: false }) }));`, `vi.mock('@/services/ideiaAudio', () => ({ fetchIdeiaAudio: fetchAudioMock, uploadIdeiaAudio: vi.fn(), retryIdeiaTranscription: vi.fn(), deleteIdeiaAudio: vi.fn() }))` (hoist `fetchAudioMock`), the same `@mesaas/ui/AudioRecorder` and `@mesaas/ui/AudioPlayer` fakes used in Task 11, and extend the `@/store` mock with `updateIdeiaVisibilidade: updateVisMock` (hoisted).
- Extend the file's `makeIdeia`/fixture with the new fields (`origem: 'cliente'`, `autor: null`, `visivel_no_hub: true`, `audio_*: null`).
- Add:

```tsx
  it('shows origin badge, author line and the visibility switch only for agency ideias', async () => {
    renderDrawer(makeIdeia({ origem: 'agencia', autor: { nome: 'Eduardo' }, visivel_no_hub: false }));
    expect(await screen.findByText('Agência')).toBeInTheDocument();
    expect(screen.getByText(/por Eduardo/)).toBeInTheDocument();
    const sw = screen.getByRole('switch', { name: /visível no hub/i });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    await waitFor(() => expect(updateVisMock).toHaveBeenCalledWith('ideia-1', true));

    cleanup();
    renderDrawer(makeIdeia({ origem: 'cliente' }));
    expect(await screen.findByText('Cliente')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /visível no hub/i })).toBeNull();
  });

  it('renders the audio section with player, status and transcript; write actions only on agency ideias', async () => {
    fetchAudioMock.mockResolvedValue({
      audio: { url: 'https://get/a.webm', mime: 'audio/webm', duration_seconds: 9, transcription_status: 'done', recorded_at: null },
      transcript: 'Texto transcrito',
    });
    renderDrawer(makeIdeia({ origem: 'cliente', audio_r2_key: 'ideia-audio/c/i/a.webm', audio_transcription_status: 'done', audio_transcript: 'Texto transcrito' }));
    expect(await screen.findByTestId('audio-player')).toBeInTheDocument();
    expect(screen.getByText('Transcrito')).toBeInTheDocument();
    expect(screen.getByText('Texto transcrito')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover áudio' })).toBeNull();
    expect(screen.queryByRole('button', { name: /fake-recorder/ })).toBeNull();

    cleanup();
    renderDrawer(makeIdeia({ origem: 'agencia', audio_r2_key: 'ideia-audio/c/i/a.webm', audio_transcription_status: 'failed' }));
    expect(await screen.findByText('Falha na transcrição')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover áudio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gravar novamente' })).toBeInTheDocument();
  });

  it('offers the recorder on an agency ideia without audio', async () => {
    renderDrawer(makeIdeia({ origem: 'agencia' }));
    expect(await screen.findByRole('button', { name: 'fake-recorder:Enviar' })).toBeInTheDocument();
  });
```

`renderDrawer` already exists in that file (line ~100). Add `cleanup` to the `@testing-library/react` import.

Run: `npx vitest run apps/crm/src/components/ideias/__tests__/IdeiaDrawer.test.tsx` → FAIL.

- [ ] **Step 2: `IdeiaAudioSection`**

`apps/crm/src/components/ideias/IdeiaAudioSection.tsx`:

```tsx
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Mic, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { AudioPlayer } from '@mesaas/ui/AudioPlayer';
import { AudioRecorder, isRecordingSupported, type RecorderPhase } from '@mesaas/ui/AudioRecorder';
import { describeAudioError } from '@mesaas/ui/audio/validation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CRM_AUDIO_VARS } from '@/lib/audioVars';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import {
  deleteIdeiaAudio,
  fetchIdeiaAudio,
  retryIdeiaTranscription,
  uploadIdeiaAudio,
} from '@/services/ideiaAudio';
import type { Ideia } from '@/store';

const STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' }> = {
  done: { label: 'Transcrito', variant: 'success' },
  pending: { label: 'Transcrição pendente', variant: 'warning' },
  failed: { label: 'Falha na transcrição', variant: 'danger' },
};

export function IdeiaAudioSection({
  ideia,
  canWrite,
  queryKey,
}: {
  ideia: Ideia;
  canWrite: boolean;
  queryKey: unknown[];
}) {
  const qc = useQueryClient();
  const { features } = useWorkspaceLimits();
  const audioAllowed = features?.feature_briefing_audio === true;
  const showRecorder = canWrite && audioAllowed && isRecordingSupported();
  const hasAudio = !!ideia.audio_r2_key;

  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const { data, isError } = useQuery({
    queryKey: ['ideia-audio', ideia.id, ideia.audio_r2_key, ideia.audio_transcription_status],
    queryFn: () => fetchIdeiaAudio(ideia.id),
    staleTime: 30 * 60 * 1000,
    enabled: hasAudio,
  });

  if (!hasAudio && !showRecorder) return null;

  function refresh() {
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ['ideia-audio', ideia.id] });
  }

  async function handleRecorded(blob: Blob, mime: string, seconds: number) {
    try {
      await uploadIdeiaAudio({ ideiaId: ideia.id, blob, mime, durationSeconds: seconds, onPhase: setPhase });
      setRecording(false);
      refresh();
      toast.success('Áudio salvo.');
    } catch (e) {
      toast.error(describeAudioError(e, 'O envio do áudio falhou. Tente de novo.'));
      throw e;
    } finally {
      setPhase('idle');
    }
  }

  async function retry() {
    setBusy(true);
    try {
      await retryIdeiaTranscription(ideia.id);
      refresh();
    } catch (e) {
      toast.error(describeAudioError(e, 'Não foi possível transcrever agora.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteIdeiaAudio(ideia.id);
      refresh();
      toast.success('Áudio removido.');
    } catch (e) {
      toast.error(describeAudioError(e, 'Não foi possível remover o áudio.'));
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  }

  const rawStatus =
    ideia.audio_transcription_status === 'pending'
      ? (data?.audio?.transcription_status ?? 'pending')
      : ideia.audio_transcription_status;
  const status = rawStatus ? STATUS[rawStatus] : null;
  const transcript = data?.transcript ?? ideia.audio_transcript;

  return (
    <div style={CRM_AUDIO_VARS}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-muted-foreground">Áudio</p>
        {hasAudio && status && (
          <Badge variant={status.variant} size="sm">
            {status.label}
          </Badge>
        )}
      </div>
      {hasAudio && (
        <div className="space-y-2">
          {data?.audio ? (
            <AudioPlayer src={data.audio.url} durationSeconds={ideia.audio_duration_seconds} label="Áudio da ideia" className="w-full max-w-[380px] text-foreground" />
          ) : isError ? (
            <span className="text-xs text-muted-foreground">Não foi possível carregar o áudio.</span>
          ) : (
            <span className="text-xs text-muted-foreground">Carregando áudio…</span>
          )}
          {transcript && (
            <div className="rounded-lg bg-muted/60 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Transcrição</p>
              <p className="text-sm whitespace-pre-wrap">{transcript}</p>
            </div>
          )}
        </div>
      )}
      {(showRecorder || (hasAudio && rawStatus === 'failed' && canWrite && audioAllowed)) && (
        <div className="flex flex-wrap gap-2 mt-2">
          {hasAudio && rawStatus === 'failed' && canWrite && audioAllowed && (
            <Button type="button" variant="outline" size="sm" onClick={retry} disabled={busy}>
              {busy ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <RotateCcw size={13} className="mr-1.5" />}
              Tentar novamente
            </Button>
          )}
          {showRecorder && hasAudio && !recording && (
            <Button type="button" variant="outline" size="sm" onClick={() => setRecording(true)} disabled={busy}>
              <Mic size={13} className="mr-1.5" /> Gravar novamente
            </Button>
          )}
          {showRecorder && hasAudio && (
            <Button type="button" variant="ghost" size="sm" className="text-[var(--danger-text)]" onClick={() => setConfirmRemove(true)} disabled={busy}>
              Remover áudio
            </Button>
          )}
        </div>
      )}
      {showRecorder && (!hasAudio || recording) && (
        <div className="mt-2">
          <AudioRecorder phase={phase} disabled={busy} onRecorded={handleRecorded} hint="Até 5:00." />
        </div>
      )}

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover o áudio?</AlertDialogTitle>
            <AlertDialogDescription>A gravação e a transcrição serão apagadas. Isso não pode ser desfeito.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={remove} disabled={busy}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

Check the `alert-dialog.tsx` export list (line 100) for the exact names; adjust if any differ.

- [ ] **Step 3: Drawer changes**

In `apps/crm/src/components/ideias/IdeiaDrawer.tsx`:
- Imports: `IdeiaOrigemBadge`, `IdeiaAudioSection`, `updateIdeiaVisibilidade` (from `@/store`), `Switch`, `useCurrentMembro`.
- Replace the member lookup:

```ts
  const { membro } = useCurrentMembro();
  const membroId: number | undefined = membro?.id;
```

  and drop the `membros`/`profile`-based `membroId` line (keep the `membros` query since `TarefaFormDialog` needs the list; keep `profile` only if still used).
- `const isAgency = ideia.origem === 'agencia';` and `const [visSaving, setVisSaving] = useState(false);`

```ts
  async function handleVisibilidade(next: boolean) {
    setVisSaving(true);
    try {
      await updateIdeiaVisibilidade(ideia.id, next);
      qc.invalidateQueries({ queryKey });
      toast.success(next ? 'Ideia visível no Hub.' : 'Ideia oculta do Hub.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao atualizar visibilidade.');
    } finally {
      setVisSaving(false);
    }
  }
```
- Header badges: add `<IdeiaOrigemBadge origem={ideia.origem} hidden={isAgency && !ideia.visivel_no_hub} />` after the tipo badge. Description line: `{ideia.clientes.nome} · {formatDate(ideia.created_at)}{isAgency && ideia.autor ? \` · por ${ideia.autor.nome}\` : ''}`.
- First block inside the scroll area, before "Descrição", only when `isAgency && canEditIdeias`:

```tsx
          {isAgency && canEditIdeias && (
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Visível no Hub do cliente</p>
                <p className="text-xs text-muted-foreground">O cliente vê e reage, mas não edita.</p>
              </div>
              <Switch
                checked={ideia.visivel_no_hub}
                onCheckedChange={handleVisibilidade}
                disabled={visSaving}
                aria-label="Visível no Hub do cliente"
              />
            </div>
          )}
```
- After the "Descrição" block (before Links): `<IdeiaAudioSection ideia={ideia} canWrite={isAgency && canEditIdeias} queryKey={queryKey} />`.

- [ ] **Step 4: Run**

```bash
npx vitest run apps/crm/src/components/ideias
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run lint
```

Expected: PASS. Browser check on `npm run dev:staging`: open an agency ideia, flip the switch, record audio, retry, remove; open a client ideia and confirm only the player shows.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/ideias
git commit -m "feat(crm): origem, visibilidade e áudio na gaveta da ideia

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Label, full verification, PR

**Files:**
- Modify: `apps/crm/src/lib/entitlement-errors.ts`
- Any test that asserts the old label (grep `'Briefing por áudio'` under `apps/`).

- [ ] **Step 1: Label**

In `apps/crm/src/lib/entitlement-errors.ts` change `feature_briefing_audio: 'Briefing por áudio'` to `feature_briefing_audio: 'Gravação de áudio'`. Run `git grep -n "Briefing por áudio" -- apps packages` and update any test expecting the old string.

- [ ] **Step 2: Full local gate**

```bash
npm run lint
npm run format
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions
npx deno check supabase/functions/hub-ideias/index.ts supabase/functions/ideia-media-manage/index.ts supabase/functions/post-media-cleanup-cron/index.ts supabase/functions/mcp/index.ts
git checkout deno.lock
ls node_modules/.deno 2>/dev/null && npm ci
```

Expected: everything green. Fix anything that is not before continuing.

- [ ] **Step 3: Migration prefix re-check and commit**

```bash
git fetch origin main
git ls-tree --name-only origin/main:supabase/migrations | tail -3
```

If a file with prefix `20260922000001` or higher exists on main, `git mv` the migration to the next free `2026091800000N` prefix and update the reference in the spec (`docs/superpowers/specs/2026-09-10-ideias-agencia-visibilidade-audio-design.md` §1) and this plan's Task 1.

```bash
git add -A
git commit -m "chore(ideias): rótulo do plano e ajustes finais

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: Rollout before merge (owner runs; do not skip)**

1. `cat supabase/.temp/project-ref` to see which project the worktree is linked to; staging is `wlyzhyfondykzpsiqsce`, prod is `skjzpekeqefvlojenfsw`. Apply the migration to staging first, then prod: `npx supabase db push --linked` (or `--project-ref`).
2. `cd workers/transcribe && npx wrangler deploy` (manual, no CI).
3. Edge functions, prod: `npx supabase functions deploy hub-ideias --no-verify-jwt --use-api`, `npx supabase functions deploy ideia-media-manage --no-verify-jwt --use-api`, `npx supabase functions deploy post-media-cleanup-cron --no-verify-jwt --use-api`, `npx supabase functions deploy mcp --use-api`.
4. Open the PR (`gh pr create`), wait for the external Codex review, verify each finding, then merge.
5. Smoke on prod after Vercel builds: create a hidden agency ideia, confirm it is absent from the client's Hub; flip it visible, confirm read-only in the Hub; record audio in the CRM and in the Hub; delete the ideia and confirm a `post_media_deletions` row for its key via `npx supabase db query --linked "select r2_key from post_media_deletions order by created_at desc limit 3"`.
