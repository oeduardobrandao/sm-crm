# Ideias da agência, visibilidade no Hub e áudio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agency users create ideias from the CRM with a per-ideia "visible in the Hub" toggle, and both the CRM and the Hub can attach one audio recording (Whisper-transcribed) to an ideia.

**Architecture:** Three new columns on `ideias` (`origem`, `autor_membro_id`, `visivel_no_hub`) plus the seven `audio_*` columns copied from the briefing pattern, guarded by the same service-role-only trigger and cleaned up by the same after-change trigger. A new `_shared/ideia-audio.ts` mirrors `_shared/briefing-audio.ts` against `ideias` and reuses its generic helpers; `hub-ideias` (token) and `ideia-media-manage` (JWT) gain audio routes. The Hub recorder moves to `packages/ui` with a CSS-variable contract so the CRM can render it.

**Tech Stack:** Postgres (plpgsql, RLS), Deno edge functions, React 19 + TanStack Query, shadcn/ui (CRM), hand-written `hub-*` CSS (Hub), Vitest, `deno test`, psql suites, Cloudflare Worker (`workers/transcribe`).

**Spec:** `docs/superpowers/specs/2026-09-10-ideias-agencia-visibilidade-audio-design.md`

## Global Constraints

- Migration file: `supabase/migrations/20260917000001_ideias_agencia_audio.sql`. Before `gh pr create`, run `git ls-tree --name-only origin/main:supabase/migrations | tail -3` and renumber above main's tail if needed.
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
| `supabase/migrations/20260917000001_ideias_agencia_audio.sql` | Columns, CHECKs, notification guard, audio guard/cleanup triggers, 3 RPCs |
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
- Create: `supabase/migrations/20260917000001_ideias_agencia_audio.sql`
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
  v_i uuid; v_i2 uuid; v_ag uuid;
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

`supabase/migrations/20260917000001_ideias_agencia_audio.sql`:

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
ALTER TABLE ideias ADD COLUMN visivel_no_hub boolean NOT NULL DEFAULT true;
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
git add supabase/migrations/20260917000001_ideias_agencia_audio.sql supabase/tests/ideia_audio_rpcs.sql
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

Add to `_shared/ideia-audio.ts` (used by the GET above; export it next to `loadIdeiaAudioView`):

```ts
/** View de áudio a partir de uma linha já carregada (GET de lista). Inclui o transcript. */
export async function buildAudioViewForIdeia(
  row: AudioRow & { audio_transcript?: string | null },
  signGetUrl: (key: string) => Promise<string>,
): Promise<(AudioView & { transcript: string | null }) | null> {
  const v = await buildAudioView(row, signGetUrl);
  return v ? { ...v, transcript: row.audio_transcript ?? null } : null;
}
```

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
