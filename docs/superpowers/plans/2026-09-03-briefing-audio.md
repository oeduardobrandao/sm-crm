# Briefing por áudio (Hub) com transcrição Whisper: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O cliente grava um áudio por pergunta do briefing no Hub; o áudio vai para o R2, é transcrito por Whisper (Cloudflare Workers AI) e a transcrição é anexada ao texto da resposta. A agência ouve o áudio no CRM.

**Architecture:** Colunas `audio_*` na própria `hub_briefing_questions` + prefixo R2 `briefing-audio/{conta_id}/{question_id}/{uuid}.{ext}` (fora de `contas/`, que o cron de órfãos varre). Quota via RPCs `SECURITY DEFINER` com lock de linha; decremento e enfileiramento de exclusão R2 só por trigger. A edge function `hub-briefing` ganha rotas por segmento (presign, finalize, retry, delete) e chama um Worker Cloudflare (`workers/transcribe`) que lê o objeto pelo binding R2 e roda `@cf/openai/whisper-large-v3-turbo`. Uma edge function `briefing-audio` (JWT) assina a URL para o CRM.

**Tech Stack:** Deno edge functions (Supabase), Postgres/RLS, Cloudflare R2 + Workers AI (wrangler v3), React 19 + TanStack Query (Hub e CRM), MediaRecorder API, Vitest, `deno test`, psql (SQL suites).

Spec: `docs/superpowers/specs/2026-09-03-briefing-audio-design.md`.

## Global Constraints

- Copy em português, **sem travessão** (use ponto, dois pontos ou "·").
- Edge functions nunca devolvem erro bruto ao cliente: `console.error` interno + mensagem genérica. Códigos de domínio conhecidos (`quota_exceeded`, `question_not_found`, `invalid_key`) podem ser expostos.
- CORS sempre via `buildCorsHeaders(req)`.
- MIME de áudio aceito: `audio/webm`, `audio/mp4`, `audio/ogg`, `audio/mpeg`, `audio/wav` (sufixo `;codecs=` é normalizado fora). Máximo **15 MiB** e **300 s**.
- Prefixo R2 obrigatório: `briefing-audio/{conta_id}/{question_id}/`.
- Novas env vars (opcionais, sem default): `TRANSCRIBE_WORKER_URL`, `TRANSCRIBE_SECRET`. Sem elas o áudio salva e a transcrição fica `failed`.
- Rate limit novo: `hub-write:hub-briefing-audio:{conta}:{cliente}` 20 por 3600 s.
- Migration: prefixo `20260907000001` (reconferir `git ls-tree --name-only origin/main:supabase/migrations | tail -1` antes do PR e renumerar acima se preciso).
- Player de áudio: nunca `<audio controls>` nativo nas telas; sempre `@mesaas/ui/AudioPlayer` (decisão do usuário em 2026-09-03).
- Classes `hub-*` do Hub são CSS puro: variantes Tailwind (`hover:`, `md:`) não funcionam nelas.
- Antes de cada commit rode `npm run format` (prettier) nos arquivos de `apps/**`.
- Cada tarefa termina com commit. Mensagens no padrão `feat(briefing): ...` / `test(...)` com trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260907000001_briefing_audio.sql` | colunas, CHECKs, trigger de guarda, trigger de release, RPCs |
| `supabase/tests/briefing_audio_rpcs.sql` | suíte psql das RPCs/triggers (rodada por `scripts/test-entitlements.sh`) |
| `supabase/functions/_shared/briefing-audio.ts` | lógica pura: presign, finalize, transcrição, remoção, transcriber do worker |
| `supabase/functions/__tests__/briefing-audio_test.ts` | testes da lógica pura |
| `supabase/functions/hub-briefing/handler.ts` + `index.ts` | rotas por segmento + GET com `audio` |
| `supabase/functions/__tests__/hub-briefing_test.ts` | testes do handler (existente, estendido) |
| `apps/hub/src/types.ts`, `api.ts` | tipos e wrappers das rotas |
| `apps/hub/src/services/ideiaMedia.ts` | `putToR2` exportado (Blob + contentType) |
| `apps/hub/src/services/briefingAudio.ts` | validação, escolha de mime, orquestração presign → PUT → finalize |
| `packages/ui/AudioPlayer/index.tsx` | player próprio compartilhado (`@mesaas/ui/AudioPlayer`): play/pause, barra com seek, tempo |
| `apps/hub/src/components/AudioRecorder.tsx` | gravador (MediaRecorder) com prévia |
| `apps/hub/src/pages/BriefingPage.tsx` | integra gravador, player, status, erros visíveis |
| `workers/transcribe/*` | Worker Cloudflare: R2 binding + Workers AI Whisper |
| `supabase/functions/briefing-audio/{index,handler}.ts` | URL assinada do áudio para o CRM (JWT) |
| `apps/crm/src/services/briefingAudio.ts` | chamada à function acima |
| `apps/crm/src/pages/cliente-detalhe/BriefingAudioPlayer.tsx` | player + badge de status no CRM |
| `apps/crm/src/pages/cliente-detalhe/HubTab.tsx`, `apps/crm/src/store/hub.ts` | renderiza player; tipos da row |
| `CLAUDE.md`, `README.md`, `supabase/config.toml` | env vars, worker, `verify_jwt = false` |

---

### Task 1: Migration, triggers e RPCs de quota

**Files:**
- Create: `supabase/migrations/20260907000001_briefing_audio.sql`
- Create: `supabase/tests/briefing_audio_rpcs.sql`

**Interfaces:**
- Produces: colunas `audio_r2_key, audio_mime, audio_size_bytes, audio_duration_seconds, audio_transcript, audio_transcription_status, audio_recorded_at` em `hub_briefing_questions`; RPC `briefing_audio_finalize(p_conta_id uuid, p_cliente_id bigint, p_question_id uuid, p_key text, p_bytes bigint, p_mime text, p_duration int) RETURNS jsonb` (`{"reserved": bool, "previous_key": text|null}`); RPC `briefing_audio_release(p_conta_id uuid, p_question_id uuid) RETURNS text` (chave antiga ou NULL). Ambas só para `service_role`. Exceções: `invalid_key`, `invalid_bytes`, `workspace_not_found`, `question_not_found`, `quota_exceeded` (todas `P0001`).

- [ ] **Step 1: Escrever o teste SQL (falha porque as RPCs não existem)**

`supabase/tests/briefing_audio_rpcs.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;
do $$
declare
  v_ws uuid; v_ws2 uuid; v_cli bigint; v_q uuid; v_q2 uuid; v_user uuid := gen_random_uuid();
  v_key text; v_key2 text; v_res jsonb; v_used bigint; v_blocked boolean;
  v_n int;
begin
  -- free = storage_quota_bytes 104857600 (100MB)
  -- As RPCs rodam sob service_role em produção (edge functions). A guarda lê
  -- auth.role() do GUC request.jwt.claims, então o teste precisa simular isso.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_ws := et_make_workspace('free');
  v_ws2 := et_make_workspace('free');
  insert into auth.users (id) values (v_user);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'Cliente Audio', 'CA', '#000000') returning id into v_cli;
  insert into hub_briefing_questions (cliente_id, conta_id, question, display_order)
    values (v_cli, v_ws, 'Qual a história da marca?', 0) returning id into v_q;
  insert into hub_briefing_questions (cliente_id, conta_id, question, display_order)
    values (v_cli, v_ws, 'Público?', 1) returning id into v_q2;
  v_key  := 'briefing-audio/' || v_ws || '/' || v_q || '/a.webm';
  v_key2 := 'briefing-audio/' || v_ws || '/' || v_q || '/b.webm';

  -- 1. finalize reserva bytes e grava colunas
  v_res := briefing_audio_finalize(v_ws, v_cli, v_q, v_key, 1000, 'audio/webm', 12);
  assert (v_res->>'reserved')::boolean, 'first finalize must reserve';
  assert v_res->>'previous_key' is null, 'no previous key on first finalize';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 1000, format('used after finalize: %s', v_used);
  assert (select audio_transcription_status from hub_briefing_questions where id = v_q) = 'pending';

  -- 2. retry com a MESMA chave é idempotente (não soma)
  v_res := briefing_audio_finalize(v_ws, v_cli, v_q, v_key, 1000, 'audio/webm', 12);
  assert not (v_res->>'reserved')::boolean, 'same key retry must not reserve';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 1000, 'retry must not double count';

  -- 3. regravar (chave nova) troca, decrementa a antiga UMA vez e enfileira a antiga
  v_res := briefing_audio_finalize(v_ws, v_cli, v_q, v_key2, 3000, 'audio/webm', 40);
  assert v_res->>'previous_key' = v_key, 'previous_key must be the replaced key';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 3000, format('used after replace: %s', v_used);
  select count(*) into v_n from post_media_deletions where r2_key = v_key;
  assert v_n = 1, 'old key must be enqueued once';
  assert (select audio_transcript from hub_briefing_questions where id = v_q) is null, 'replace resets transcript';

  -- 4. over quota bloqueia e não altera a linha
  update workspaces set storage_used_bytes = 104857600 where id = v_ws;
  v_blocked := false;
  begin
    perform briefing_audio_finalize(v_ws, v_cli, v_q2, 'briefing-audio/' || v_ws || '/' || v_q2 || '/c.webm', 1, 'audio/webm', 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'quota_exceeded%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'over quota must block';
  assert (select audio_r2_key from hub_briefing_questions where id = v_q2) is null, 'blocked finalize must not write';
  update workspaces set storage_used_bytes = 3000 where id = v_ws;

  -- 4b. regravar perto da quota desconta o áudio substituído: used = quota,
  -- sendo 3000 bytes desta própria pergunta; trocar por 2000 tem que passar.
  update workspaces set storage_used_bytes = 104857600 where id = v_ws;
  v_res := briefing_audio_finalize(v_ws, v_cli, v_q, 'briefing-audio/' || v_ws || '/' || v_q || '/d.webm', 2000, 'audio/webm', 20);
  assert (v_res->>'reserved')::boolean, 'replace near quota must net out the old bytes';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 104857600 - 3000 + 2000, format('used after near-quota replace: %s', v_used);
  update workspaces set storage_used_bytes = 2000 where id = v_ws;
  v_key2 := 'briefing-audio/' || v_ws || '/' || v_q || '/d.webm';

  -- 5. chave fora do prefixo da pergunta -> invalid_key
  v_blocked := false;
  begin
    perform briefing_audio_finalize(v_ws, v_cli, v_q2, 'briefing-audio/' || v_ws || '/' || v_q || '/x.webm', 1, 'audio/webm', 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'invalid_key%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'key of another question must be rejected';

  -- 6. pergunta de outro cliente -> question_not_found
  v_blocked := false;
  begin
    perform briefing_audio_finalize(v_ws, v_cli + 1, v_q2, 'briefing-audio/' || v_ws || '/' || v_q2 || '/c.webm', 1, 'audio/webm', 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'question_not_found%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'wrong cliente must be rejected';

  -- 7. release zera colunas, decrementa e enfileira
  assert briefing_audio_release(v_ws, v_q) = v_key2, 'release returns the old key';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 0, format('used after release: %s', v_used);
  assert (select audio_r2_key from hub_briefing_questions where id = v_q) is null;
  select count(*) into v_n from post_media_deletions where r2_key = v_key2;
  assert v_n = 1, 'released key must be enqueued once';
  assert briefing_audio_release(v_ws, v_q) is null, 'second release is a no-op';

  -- 8. DELETE da pergunta com áudio decrementa e enfileira
  v_res := briefing_audio_finalize(v_ws, v_cli, v_q, v_key, 500, 'audio/webm', 5);
  delete from hub_briefing_questions where id = v_q;
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 0, format('used after row delete: %s', v_used);
  select count(*) into v_n from post_media_deletions where r2_key = v_key;
  assert v_n = 2, 'deleted row key enqueued (second time for this key in this test)';

  -- 9. CHECK de tenant: chave de outra workspace não entra nem via service role
  -- (ainda sob claims service_role, então a guarda deixa passar e o CHECK dispara)
  v_blocked := false;
  begin
    update hub_briefing_questions set audio_r2_key = 'briefing-audio/' || v_ws2 || '/' || v_q2 || '/z.webm'
      where id = v_q2;
  exception when check_violation then v_blocked := true; end;
  assert v_blocked, 'cross-tenant key must violate CHECK';

  -- 10. guarda: chamador que não é service_role não escreve audio_*, mas escreve answer.
  -- auth.role() lê o GUC request.jwt.claims; ficamos como postgres (bypass de RLS)
  -- para que o UPDATE atinja a linha e o trigger dispare.
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  v_blocked := false;
  begin
    update hub_briefing_questions set audio_size_bytes = 1 where id = v_q2;
  exception when insufficient_privilege then v_blocked := true; end;
  assert v_blocked, 'authenticated must not write audio_* columns';
  update hub_briefing_questions set answer = 'texto livre' where id = v_q2;
  assert (select answer from hub_briefing_questions where id = v_q2) = 'texto livre', 'answer stays writable';

  -- 11. service role escreve audio_* (caminho das edge functions)
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update hub_briefing_questions set audio_transcription_status = 'failed' where id = v_q2;
  assert (select audio_transcription_status from hub_briefing_questions where id = v_q2) = 'failed';

  -- 12. release em workspace inexistente -> workspace_not_found
  v_blocked := false;
  begin
    perform briefing_audio_release(gen_random_uuid(), v_q2);
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'workspace_not_found%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'release on unknown workspace must raise';
  perform set_config('request.jwt.claims', '', true);

  raise notice 'PASS briefing_audio_rpcs';
end $$;
rollback;
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Precisa de Supabase local (Docker/colima). Se disponível:

```bash
npx supabase start && npx supabase db reset && psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -f supabase/tests/briefing_audio_rpcs.sql
```

Esperado: erro `function briefing_audio_finalize(...) does not exist`. Sem Docker local, pule a execução e siga: o CI (`entitlement-tests`) roda esta suíte.

- [ ] **Step 3: Escrever a migration**

`supabase/migrations/20260907000001_briefing_audio.sql`:

```sql
-- Briefing por áudio (Hub): áudio no R2 em briefing-audio/{conta}/{pergunta}/…,
-- metadados na própria pergunta, transcrição anexada em answer.
-- Spec: docs/superpowers/specs/2026-09-03-briefing-audio-design.md
--
-- Por que fora de contas/: post-media-cleanup-cron (orphan-scan.ts) varre o
-- prefixo contas/ e manda para o lixo qualquer objeto >24h que não esteja em
-- post_media/files. O mesmo motivo de automation-media/ viver fora.

ALTER TABLE hub_briefing_questions
  ADD COLUMN audio_r2_key text,
  ADD COLUMN audio_mime text,
  ADD COLUMN audio_size_bytes bigint,
  ADD COLUMN audio_duration_seconds int,
  ADD COLUMN audio_transcript text,
  ADD COLUMN audio_transcription_status text,
  ADD COLUMN audio_recorded_at timestamptz,
  ADD CONSTRAINT hub_briefing_questions_audio_status_chk
    CHECK (audio_transcription_status IS NULL
           OR audio_transcription_status IN ('pending', 'done', 'failed')),
  ADD CONSTRAINT hub_briefing_questions_audio_size_chk
    CHECK (audio_size_bytes IS NULL OR audio_size_bytes > 0),
  -- Posse por tenant: uma linha nunca aponta para objeto de outra workspace
  -- (mesmo padrão de ig_dm_media_card.sql para dm_media->>'key').
  ADD CONSTRAINT hub_briefing_questions_audio_key_tenant_chk
    CHECK (audio_r2_key IS NULL
           OR audio_r2_key LIKE 'briefing-audio/' || conta_id::text || '/%');

-- Guarda: authenticated tem INSERT/UPDATE na tabela via RLS (o CRM edita
-- question/section/answer/display_order pelo PostgREST). Sem esta guarda um
-- tenant poderia forjar audio_size_bytes e depois anular a chave para drenar
-- storage_used_bytes pelo trigger de release abaixo. auth.role() é GUC-based
-- e funciona dentro de SECURITY DEFINER e com o SET LOCAL ROLE dos testes;
-- current_user/session_user NÃO servem aqui (ver o comentário longo em
-- 20260817000001_cliente_foto_manual_upload.sql). Backfill manual: ALTER
-- TABLE hub_briefing_questions DISABLE TRIGGER trg_hub_briefing_audio_guard.
CREATE OR REPLACE FUNCTION public.hub_briefing_audio_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed boolean;
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
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

CREATE TRIGGER trg_hub_briefing_audio_guard
  BEFORE INSERT OR UPDATE ON hub_briefing_questions
  FOR EACH ROW EXECUTE FUNCTION public.hub_briefing_audio_guard();

-- Release: decremento de quota e enfileiramento da chave antiga vivem SÓ aqui
-- (regravar, remover e DELETE da pergunta/cliente passam todos por este ponto).
-- As RPCs nunca decrementam, então não há dupla contagem. SECURITY DEFINER
-- porque post_media_deletions é service-role-only sob RLS e o DELETE pode
-- vir do CRM (mesmo motivo de post_media_enqueue_delete).
CREATE OR REPLACE FUNCTION public.hub_briefing_audio_after_change()
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
   WHERE id = OLD.conta_id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_hub_briefing_audio_after_change
  AFTER UPDATE OF audio_r2_key OR DELETE ON hub_briefing_questions
  FOR EACH ROW EXECUTE FUNCTION public.hub_briefing_audio_after_change();

-- Finalize: reserva quota e grava metadados. Idempotente por chave (retry do
-- cliente). Lock em workspaces FOR UPDATE antes da pergunta (mesma ordem em
-- release, evita deadlock).
CREATE OR REPLACE FUNCTION public.briefing_audio_finalize(
  p_conta_id uuid, p_cliente_id bigint, p_question_id uuid,
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
  IF p_key IS NULL OR p_key NOT LIKE 'briefing-audio/' || p_conta_id::text || '/' || p_question_id::text || '/%' THEN
    RAISE EXCEPTION 'invalid_key' USING ERRCODE = 'P0001';
  END IF;
  IF p_bytes IS NULL OR p_bytes <= 0 THEN
    RAISE EXCEPTION 'invalid_bytes' USING ERRCODE = 'P0001';
  END IF;

  SELECT storage_used_bytes INTO v_used FROM workspaces WHERE id = p_conta_id FOR UPDATE;
  IF v_used IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT audio_r2_key, audio_size_bytes INTO v_prev, v_prev_bytes
    FROM hub_briefing_questions
   WHERE id = p_question_id AND conta_id = p_conta_id AND cliente_id = p_cliente_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'question_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_prev = p_key THEN
    RETURN jsonb_build_object('reserved', false, 'previous_key', NULL);
  END IF;

  -- Regravar: o áudio anterior é liberado pelo trigger nesta mesma chamada,
  -- então a quota é conferida sobre o uso líquido (sem os bytes antigos).
  v_quota := effective_plan_limit(p_conta_id, 'storage_quota_bytes');
  IF v_quota IS NOT NULL AND v_used - COALESCE(v_prev_bytes, 0) + p_bytes > v_quota THEN
    RAISE EXCEPTION 'quota_exceeded' USING ERRCODE = 'P0001';
  END IF;

  -- O trigger AFTER UPDATE OF audio_r2_key libera a chave anterior (bytes + fila).
  UPDATE hub_briefing_questions
     SET audio_r2_key = p_key,
         audio_mime = p_mime,
         audio_size_bytes = p_bytes,
         audio_duration_seconds = p_duration,
         audio_transcript = NULL,
         audio_transcription_status = 'pending',
         audio_recorded_at = now()
   WHERE id = p_question_id;

  UPDATE workspaces SET storage_used_bytes = storage_used_bytes + p_bytes WHERE id = p_conta_id;

  RETURN jsonb_build_object('reserved', true, 'previous_key', v_prev);
END;
$$;

CREATE OR REPLACE FUNCTION public.briefing_audio_release(p_conta_id uuid, p_question_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev text;
BEGIN
  PERFORM 1 FROM workspaces WHERE id = p_conta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0001';
  END IF;
  SELECT audio_r2_key INTO v_prev
    FROM hub_briefing_questions
   WHERE id = p_question_id AND conta_id = p_conta_id
   FOR UPDATE;
  IF v_prev IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE hub_briefing_questions
     SET audio_r2_key = NULL, audio_mime = NULL, audio_size_bytes = NULL,
         audio_duration_seconds = NULL, audio_transcript = NULL,
         audio_transcription_status = NULL, audio_recorded_at = NULL
   WHERE id = p_question_id;
  RETURN v_prev;
END;
$$;

REVOKE ALL ON FUNCTION public.briefing_audio_finalize(uuid, bigint, uuid, text, bigint, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.briefing_audio_finalize(uuid, bigint, uuid, text, bigint, text, int) TO service_role;
REVOKE ALL ON FUNCTION public.briefing_audio_release(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.briefing_audio_release(uuid, uuid) TO service_role;
```

Observação: `clientes` exige `user_id, conta_id, nome, sigla, cor` NOT NULL (baseline). O INSERT do teste roda como `postgres`, então a allowlist de colunas não interfere.

- [ ] **Step 4: Rodar o teste SQL e confirmar PASS**

```bash
npx supabase db reset && psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -f supabase/tests/briefing_audio_rpcs.sql
```

Esperado: `NOTICE: PASS briefing_audio_rpcs`. Também rode `bash scripts/test-entitlements.sh` para garantir que as suítes antigas seguem verdes.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260907000001_briefing_audio.sql supabase/tests/briefing_audio_rpcs.sql
git commit -m "feat(briefing): colunas, guarda e RPCs de quota para áudio das perguntas

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Lógica pura `_shared/briefing-audio.ts`

**Files:**
- Create: `supabase/functions/_shared/briefing-audio.ts`
- Create: `supabase/functions/__tests__/briefing-audio_test.ts`

**Interfaces:**
- Consumes: RPCs da Task 1; `effectivePlanLimit` de `_shared/entitlements-rpc.ts`.
- Produces (todas devolvem `{ status: number; body: Record<string, unknown> }`):
  - `BRIEFING_AUDIO_MIME`, `MAX_AUDIO_BYTES`, `AUDIO_KEY_PREFIX`
  - `normalizeAudioMime(raw): string | null`, `extFromAudioMime(mime): string`, `appendTranscript(answer, text): string`
  - `type Transcriber = (key: string) => Promise<{ text: string; duration?: number } | null>`
  - `type AudioView = { url: string; mime: string; duration_seconds: number | null; transcription_status: 'pending'|'done'|'failed'|null; recorded_at: string | null }`
  - `buildAudioView(row, signGetUrl): Promise<AudioView | null>`
  - `presignBriefingAudio(args)`, `finalizeBriefingAudio(args)`, `transcribeBriefingAudio(args)`, `removeBriefingAudio(args)`
  - `makeWorkerTranscriber({ url, secret, timeoutMs?, fetchFn? }): Transcriber | null`
  - `AUDIO_COLUMNS = "audio_r2_key, audio_mime, audio_size_bytes, audio_duration_seconds, audio_transcription_status, audio_recorded_at"`

- [ ] **Step 1: Escrever os testes**

`supabase/functions/__tests__/briefing-audio_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import {
  appendTranscript,
  finalizeBriefingAudio,
  makeWorkerTranscriber,
  normalizeAudioMime,
  presignBriefingAudio,
  removeBriefingAudio,
  transcribeBriefingAudio,
} from "../_shared/briefing-audio.ts";

const signPutUrl = async (key: string) => `https://put.example.com/${key}`;
const signGetUrl = async (key: string) => `https://get.example.com/${key}`;
const Q = "11111111-1111-1111-1111-111111111111";
const KEY = `briefing-audio/conta-1/${Q}/fixed-uuid.webm`;

const audioRow = {
  answer: "Já tinha texto.",
  audio_r2_key: KEY, audio_mime: "audio/webm", audio_size_bytes: 5000,
  audio_duration_seconds: 12, audio_transcription_status: "pending", audio_recorded_at: "2026-09-03T00:00:00Z",
};

Deno.test("normalizeAudioMime aceita codecs e rejeita vídeo", () => {
  assertEquals(normalizeAudioMime("audio/webm;codecs=opus"), "audio/webm");
  assertEquals(normalizeAudioMime("AUDIO/MP4"), "audio/mp4");
  assertEquals(normalizeAudioMime("video/mp4"), null);
  assertEquals(normalizeAudioMime(undefined), null);
});

Deno.test("appendTranscript: separa com linha em branco só quando há texto", () => {
  assertEquals(appendTranscript(null, " Olá "), "Olá");
  assertEquals(appendTranscript("   ", "Olá"), "Olá");
  assertEquals(appendTranscript("Antes.\n", "Depois"), "Antes.\n\nDepois");
});

Deno.test("presign: mime inválido 415, tamanho fora 400, pergunta alheia 404", async () => {
  const db = createSupabaseQueryMock();
  const base = { db, conta_id: "conta-1", cliente_id: 14, question_id: Q, signPutUrl, randomUUID: () => "fixed-uuid" };
  assertEquals((await presignBriefingAudio({ ...base, mime_type: "video/mp4", size_bytes: 10 })).status, 415);
  assertEquals((await presignBriefingAudio({ ...base, mime_type: "audio/webm", size_bytes: 16 * 1024 * 1024 })).status, 400);
  db.queue("hub_briefing_questions", "select", { data: null, error: null });
  assertEquals((await presignBriefingAudio({ ...base, mime_type: "audio/webm", size_bytes: 10 })).status, 404);
});

Deno.test("presign: devolve chave no prefixo da pergunta, mime normalizado e 413 sobre quota", async () => {
  const db = createSupabaseQueryMock();
  db.queue("hub_briefing_questions", "select", { data: { id: Q }, error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: null, error: null });
  const ok = await presignBriefingAudio({
    db, conta_id: "conta-1", cliente_id: 14, question_id: Q,
    mime_type: "audio/webm;codecs=opus", size_bytes: 5000, signPutUrl, randomUUID: () => "fixed-uuid",
  });
  assertEquals(ok.status, 200);
  assertEquals(ok.body.r2_key, KEY);
  assertEquals(ok.body.mime_type, "audio/webm");
  assertEquals(ok.body.upload_url, `https://put.example.com/${KEY}`);

  db.queue("hub_briefing_questions", "select", { data: { id: Q }, error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 999 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000, error: null });
  const full = await presignBriefingAudio({
    db, conta_id: "conta-1", cliente_id: 14, question_id: Q, mime_type: "audio/webm", size_bytes: 10, signPutUrl,
  });
  assertEquals(full.status, 413);
  assertEquals(full.body.error, "quota_exceeded");
});

function finalizeArgs(db: ReturnType<typeof createSupabaseQueryMock>, extra: Record<string, unknown> = {}) {
  return {
    db, conta_id: "conta-1", cliente_id: 14, question_id: Q, r2_key: KEY,
    mime_type: "audio/webm", size_bytes: 5000, duration_seconds: 12,
    headObject: async () => ({ contentLength: 5000, contentType: "audio/webm" }),
    signGetUrl, transcribe: null,
    ...extra,
  } as Parameters<typeof finalizeBriefingAudio>[0];
}

Deno.test("finalize: prefixo errado 400, tamanho divergente 400, content-type divergente 400", async () => {
  const db = createSupabaseQueryMock();
  assertEquals((await finalizeBriefingAudio(finalizeArgs(db, { r2_key: "contas/conta-1/files/x.webm" }))).status, 400);
  assertEquals((await finalizeBriefingAudio(finalizeArgs(db, { headObject: async () => ({ contentLength: 1, contentType: "audio/webm" }) }))).status, 400);
  assertEquals((await finalizeBriefingAudio(finalizeArgs(db, { headObject: async () => ({ contentLength: 5000, contentType: "video/mp4" }) }))).status, 400);
  assertEquals((await finalizeBriefingAudio(finalizeArgs(db, { headObject: async () => null }))).status, 400);
});

Deno.test("finalize: mapeia erros da RPC (413/404/400) e 500 genérico", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("briefing_audio_finalize", { data: null, error: { message: "quota_exceeded" } });
  assertEquals((await finalizeBriefingAudio(finalizeArgs(db))).status, 413);
  db.queueRpc("briefing_audio_finalize", { data: null, error: { message: "question_not_found" } });
  assertEquals((await finalizeBriefingAudio(finalizeArgs(db))).status, 404);
  db.queueRpc("briefing_audio_finalize", { data: null, error: { message: "invalid_key" } });
  assertEquals((await finalizeBriefingAudio(finalizeArgs(db))).status, 400);
  db.queueRpc("briefing_audio_finalize", { data: null, error: { message: "relation x does not exist" } });
  const res = await finalizeBriefingAudio(finalizeArgs(db));
  assertEquals(res.status, 500);
  assertEquals(res.body.error, "internal error");
});

Deno.test("finalize sem transcriber: marca failed, mantém áudio e devolve answer atual", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("briefing_audio_finalize", { data: { reserved: true, previous_key: null }, error: null });
  db.queue("hub_briefing_questions", "select", { data: audioRow, error: null });
  db.queue("hub_briefing_questions", "update", { data: null, error: null });
  const res = await finalizeBriefingAudio(finalizeArgs(db));
  assertEquals(res.status, 200);
  assertEquals(res.body.answer, "Já tinha texto.");
  assertEquals(res.body.transcript, null);
  const audio = res.body.audio as Record<string, unknown>;
  assertEquals(audio.transcription_status, "failed");
  assertEquals(audio.url, `https://get.example.com/${KEY}`);
  const upd = db.calls.find((c) => c.table === "hub_briefing_questions" && c.operation === "update");
  assertEquals((upd?.payload as Record<string, unknown>).audio_transcription_status, "failed");
});

Deno.test("finalize com transcriber: anexa transcrição ao answer e marca done", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("briefing_audio_finalize", { data: { reserved: true, previous_key: null }, error: null });
  db.queue("hub_briefing_questions", "select", { data: { ...audioRow, audio_duration_seconds: null }, error: null });
  db.queue("hub_briefing_questions", "update", { data: null, error: null });
  const res = await finalizeBriefingAudio(finalizeArgs(db, {
    transcribe: async (key: string) => ({ text: ` Nossa marca nasceu em 2010. `, duration: 11.6 }),
  }));
  assertEquals(res.status, 200);
  assertEquals(res.body.answer, "Já tinha texto.\n\nNossa marca nasceu em 2010.");
  assertEquals(res.body.transcript, "Nossa marca nasceu em 2010.");
  const upd = db.calls.find((c) => c.table === "hub_briefing_questions" && c.operation === "update");
  const payload = upd?.payload as Record<string, unknown>;
  assertEquals(payload.audio_transcription_status, "done");
  assertEquals(payload.audio_duration_seconds, 12);
  assertEquals((res.body.audio as Record<string, unknown>).transcription_status, "done");
});

Deno.test("finalize: transcriber que lança vira failed sem 500", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("briefing_audio_finalize", { data: { reserved: true, previous_key: null }, error: null });
  db.queue("hub_briefing_questions", "select", { data: audioRow, error: null });
  db.queue("hub_briefing_questions", "update", { data: null, error: null });
  const res = await finalizeBriefingAudio(finalizeArgs(db, { transcribe: async () => { throw new Error("boom"); } }));
  assertEquals(res.status, 200);
  assertEquals((res.body.audio as Record<string, unknown>).transcription_status, "failed");
});

Deno.test("retry: sem áudio 404; já done devolve sem anexar de novo; failed roda de novo", async () => {
  const db = createSupabaseQueryMock();
  const base = { db, conta_id: "conta-1", cliente_id: 14, question_id: Q, signGetUrl, transcribe: async () => ({ text: "X" }) };
  db.queue("hub_briefing_questions", "select", { data: { ...audioRow, audio_r2_key: null }, error: null });
  assertEquals((await transcribeBriefingAudio(base)).status, 404);
  const sel = db.calls.find((c) => c.table === "hub_briefing_questions" && c.operation === "select");
  assert(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "cliente_id" && m.args[1] === 14), "retry must scope by cliente_id");

  db.queue("hub_briefing_questions", "select", { data: { ...audioRow, audio_transcription_status: "done", audio_transcript: "X" }, error: null });
  const done = await transcribeBriefingAudio(base);
  assertEquals(done.status, 200);
  assertEquals(done.body.answer, "Já tinha texto.");
  assert(!db.calls.some((c) => c.operation === "update"), "done must not update");

  db.queue("hub_briefing_questions", "select", { data: { ...audioRow, audio_transcription_status: "failed" }, error: null });
  db.queue("hub_briefing_questions", "select", { data: { ...audioRow, audio_transcription_status: "failed" }, error: null });
  db.queue("hub_briefing_questions", "update", { data: null, error: null });
  const again = await transcribeBriefingAudio(base);
  assertEquals(again.body.answer, "Já tinha texto.\n\nX");
});

Deno.test("remove: pergunta alheia 404; sem áudio ok; com áudio chama release", async () => {
  const db = createSupabaseQueryMock();
  const base = { db, conta_id: "conta-1", cliente_id: 14, question_id: Q };
  db.queue("hub_briefing_questions", "select", { data: null, error: null });
  assertEquals((await removeBriefingAudio(base)).status, 404);
  db.queue("hub_briefing_questions", "select", { data: { id: Q, audio_r2_key: null }, error: null });
  assertEquals((await removeBriefingAudio(base)).status, 200);
  assert(!db.calls.some((c) => c.table === "rpc:briefing_audio_release"));
  db.queue("hub_briefing_questions", "select", { data: { id: Q, audio_r2_key: KEY }, error: null });
  db.queueRpc("briefing_audio_release", { data: KEY, error: null });
  assertEquals((await removeBriefingAudio(base)).status, 200);
  const rel = db.calls.find((c) => c.table === "rpc:briefing_audio_release");
  assertEquals(rel?.payload, { p_conta_id: "conta-1", p_question_id: Q });
});

Deno.test("makeWorkerTranscriber: null sem env; POST com bearer; null em 500 e texto vazio", async () => {
  assertEquals(makeWorkerTranscriber({ url: "", secret: "s" }), null);
  assertEquals(makeWorkerTranscriber({ url: "https://w", secret: undefined }), null);

  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ text: "olá", duration: 3.2 }), { status: 200 });
  }) as typeof fetch;
  const t = makeWorkerTranscriber({ url: "https://w.example", secret: "sec", fetchFn })!;
  assertEquals(await t(KEY), { text: "olá", duration: 3.2 });
  assertEquals(calls[0].url, "https://w.example");
  assertEquals((calls[0].init.headers as Record<string, string>).Authorization, "Bearer sec");
  assertEquals(JSON.parse(calls[0].init.body as string), { key: KEY });

  const bad = makeWorkerTranscriber({ url: "https://w", secret: "s", fetchFn: (async () => new Response("x", { status: 500 })) as typeof fetch })!;
  assertEquals(await bad(KEY), null);
  const empty = makeWorkerTranscriber({ url: "https://w", secret: "s", fetchFn: (async () => new Response(JSON.stringify({ text: "  " }))) as typeof fetch })!;
  assertEquals(await empty(KEY), null);
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
npm run test:functions -- --filter "briefing-audio"
```

Esperado: erro de módulo `../_shared/briefing-audio.ts` não encontrado. (Lembrete: `test:functions` suja `deno.lock`; não commite essa alteração.)

- [ ] **Step 3: Implementar `_shared/briefing-audio.ts`**

```ts
import { effectivePlanLimit } from "./entitlements-rpc.ts";

export const BRIEFING_AUDIO_MIME = ["audio/webm", "audio/mp4", "audio/ogg", "audio/mpeg", "audio/wav"];
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // 15 MiB
export const AUDIO_KEY_PREFIX = "briefing-audio/";
export const AUDIO_COLUMNS =
  "audio_r2_key, audio_mime, audio_size_bytes, audio_duration_seconds, audio_transcription_status, audio_recorded_at";

export type BriefingAudioResult = { status: number; body: Record<string, unknown> };
export type BriefingAudioDb = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  // deno-lint-ignore no-explicit-any
  rpc: (name: string, params: Record<string, unknown>) => any;
};
export type Transcriber = (key: string) => Promise<{ text: string; duration?: number } | null>;
export type TranscriptionStatus = "pending" | "done" | "failed";

export interface AudioRow {
  audio_r2_key: string | null;
  audio_mime: string | null;
  audio_size_bytes: number | null;
  audio_duration_seconds: number | null;
  audio_transcription_status: string | null;
  audio_recorded_at: string | null;
}

export interface AudioView {
  url: string;
  mime: string;
  duration_seconds: number | null;
  transcription_status: TranscriptionStatus | null;
  recorded_at: string | null;
}

export function normalizeAudioMime(raw: string | null | undefined): string | null {
  const base = (raw ?? "").split(";")[0].trim().toLowerCase();
  return BRIEFING_AUDIO_MIME.includes(base) ? base : null;
}

export function extFromAudioMime(mime: string): string {
  const map: Record<string, string> = {
    "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/wav": "wav",
  };
  return map[mime] ?? "bin";
}

export function appendTranscript(answer: string | null | undefined, text: string): string {
  const current = answer ?? "";
  const base = current.trim() ? current.trimEnd() + "\n\n" : "";
  return base + text.trim();
}

export async function buildAudioView(
  row: AudioRow, signGetUrl: (key: string) => Promise<string>,
): Promise<AudioView | null> {
  if (!row.audio_r2_key) return null;
  const status = row.audio_transcription_status;
  return {
    url: await signGetUrl(row.audio_r2_key),
    mime: row.audio_mime ?? "audio/webm",
    duration_seconds: row.audio_duration_seconds ?? null,
    transcription_status: status === "pending" || status === "done" || status === "failed" ? status : null,
    recorded_at: row.audio_recorded_at ?? null,
  };
}

function validSize(n: number | undefined): boolean {
  return typeof n === "number" && Number.isFinite(n) && n > 0 && n <= MAX_AUDIO_BYTES;
}

export interface PresignAudioArgs {
  db: BriefingAudioDb;
  conta_id: string;
  cliente_id: number;
  question_id: string;
  mime_type: string;
  size_bytes: number;
  signPutUrl: (key: string, mime: string) => Promise<string>;
  randomUUID?: () => string;
}

export async function presignBriefingAudio(a: PresignAudioArgs): Promise<BriefingAudioResult> {
  const mime = normalizeAudioMime(a.mime_type);
  if (!mime) return { status: 415, body: { error: "unsupported file type" } };
  if (!validSize(a.size_bytes)) return { status: 400, body: { error: "size_bytes out of range" } };

  const { data: q } = await a.db.from("hub_briefing_questions")
    .select("id").eq("id", a.question_id).eq("cliente_id", a.cliente_id).eq("conta_id", a.conta_id)
    .maybeSingle();
  if (!q) return { status: 404, body: { error: "Pergunta não encontrada." } };

  // Best-effort early quota check (authoritative check is in the RPC at finalize).
  const { data: ws } = await a.db.from("workspaces")
    .select("storage_used_bytes").eq("id", a.conta_id).single();
  const quota = await effectivePlanLimit(a.db as never, a.conta_id, "storage_quota_bytes");
  if (quota !== null) {
    const used = Number(ws?.storage_used_bytes ?? 0);
    if (used + a.size_bytes > quota) {
      return { status: 413, body: { error: "quota_exceeded", used, quota } };
    }
  }

  const id = (a.randomUUID ?? crypto.randomUUID.bind(crypto))();
  const r2_key = `${AUDIO_KEY_PREFIX}${a.conta_id}/${a.question_id}/${id}.${extFromAudioMime(mime)}`;
  const upload_url = await a.signPutUrl(r2_key, mime);
  return { status: 200, body: { upload_url, r2_key, mime_type: mime } };
}

function rpcErrorStatus(msg: string): number {
  if (msg.includes("quota_exceeded")) return 413;
  if (msg.includes("question_not_found")) return 404;
  if (msg.includes("invalid_key") || msg.includes("invalid_bytes")) return 400;
  return 500;
}

interface TranscriptionArgs {
  db: BriefingAudioDb;
  conta_id: string;
  cliente_id: number;
  question_id: string;
  signGetUrl: (key: string) => Promise<string>;
  transcribe: Transcriber | null;
}

type FullRow = AudioRow & { answer: string | null; audio_transcript?: string | null };

async function loadRow(
  db: BriefingAudioDb, conta_id: string, cliente_id: number, question_id: string,
): Promise<FullRow | null> {
  // Escopo por cliente_id além de conta_id: o token do hub é de UM cliente e
  // question_id vem da URL; sem isso um cliente lê a resposta e o áudio de outro
  // cliente da mesma workspace.
  const { data } = await db.from("hub_briefing_questions")
    .select(`answer, audio_transcript, ${AUDIO_COLUMNS}`)
    .eq("id", question_id).eq("conta_id", conta_id).eq("cliente_id", cliente_id)
    .maybeSingle();
  return (data as FullRow | null) ?? null;
}

async function runTranscription(a: TranscriptionArgs): Promise<BriefingAudioResult> {
  const row = await loadRow(a.db, a.conta_id, a.cliente_id, a.question_id);
  if (!row?.audio_r2_key) return { status: 404, body: { error: "Áudio não encontrado." } };

  let result: { text: string; duration?: number } | null = null;
  if (a.transcribe) {
    try {
      result = await a.transcribe(row.audio_r2_key);
    } catch (e) {
      console.error("briefing-audio transcribe error:", (e as Error).message);
      result = null;
    }
  }
  const text = result?.text?.trim() ?? "";
  const where = (q: ReturnType<BriefingAudioDb["from"]>) => q.eq("id", a.question_id).eq("conta_id", a.conta_id);

  if (!text) {
    await where(a.db.from("hub_briefing_questions").update({ audio_transcription_status: "failed" }));
    return {
      status: 200,
      body: {
        ok: true,
        answer: row.answer ?? null,
        transcript: null,
        audio: await buildAudioView({ ...row, audio_transcription_status: "failed" }, a.signGetUrl),
      },
    };
  }

  const answer = appendTranscript(row.answer, text);
  const duration = row.audio_duration_seconds ??
    (typeof result?.duration === "number" && result.duration > 0 ? Math.round(result.duration) : null);
  const { error } = await where(a.db.from("hub_briefing_questions").update({
    answer,
    audio_transcript: text,
    audio_transcription_status: "done",
    audio_duration_seconds: duration,
  }));
  if (error) {
    console.error("briefing-audio save transcript error:", (error as { message?: string }).message ?? error);
    return { status: 500, body: { error: "internal error" } };
  }
  return {
    status: 200,
    body: {
      ok: true,
      answer,
      transcript: text,
      audio: await buildAudioView(
        { ...row, audio_transcription_status: "done", audio_duration_seconds: duration }, a.signGetUrl,
      ),
    },
  };
}

export interface FinalizeAudioArgs extends TranscriptionArgs {
  r2_key: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds?: number | null;
  headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
}

export async function finalizeBriefingAudio(a: FinalizeAudioArgs): Promise<BriefingAudioResult> {
  const mime = normalizeAudioMime(a.mime_type);
  if (!mime) return { status: 415, body: { error: "unsupported file type" } };
  const prefix = `${AUDIO_KEY_PREFIX}${a.conta_id}/${a.question_id}/`;
  if (typeof a.r2_key !== "string" || !a.r2_key.startsWith(prefix)) {
    return { status: 400, body: { error: "invalid r2_key" } };
  }
  if (!validSize(a.size_bytes)) return { status: 400, body: { error: "size_bytes out of range" } };

  const head = await a.headObject(a.r2_key);
  if (!head) return { status: 400, body: { error: "object not found" } };
  if (head.contentLength !== a.size_bytes) return { status: 400, body: { error: "size mismatch" } };
  if (head.contentType && normalizeAudioMime(head.contentType) !== mime) {
    return { status: 400, body: { error: "content-type mismatch" } };
  }

  const duration = typeof a.duration_seconds === "number" && a.duration_seconds > 0
    ? Math.round(a.duration_seconds)
    : null;
  const { error } = await a.db.rpc("briefing_audio_finalize", {
    p_conta_id: a.conta_id,
    p_cliente_id: a.cliente_id,
    p_question_id: a.question_id,
    p_key: a.r2_key,
    p_bytes: a.size_bytes,
    p_mime: mime,
    p_duration: duration,
  });
  if (error) {
    const msg = (error as { message?: string }).message ?? "finalize failed";
    const status = rpcErrorStatus(msg);
    if (status === 500) {
      console.error("briefing_audio_finalize error:", msg);
      return { status: 500, body: { error: "internal error" } };
    }
    return { status, body: { error: msg } };
  }

  return runTranscription(a);
}

export type TranscribeAudioArgs = TranscriptionArgs;

export async function transcribeBriefingAudio(a: TranscribeAudioArgs): Promise<BriefingAudioResult> {
  const row = await loadRow(a.db, a.conta_id, a.cliente_id, a.question_id);
  if (!row?.audio_r2_key) return { status: 404, body: { error: "Áudio não encontrado." } };
  if (row.audio_transcription_status === "done") {
    return {
      status: 200,
      body: {
        ok: true,
        answer: row.answer ?? null,
        transcript: row.audio_transcript ?? null,
        audio: await buildAudioView(row, a.signGetUrl),
      },
    };
  }
  return runTranscription(a);
}

export interface RemoveAudioArgs {
  db: BriefingAudioDb;
  conta_id: string;
  cliente_id: number;
  question_id: string;
}

export async function removeBriefingAudio(a: RemoveAudioArgs): Promise<BriefingAudioResult> {
  const { data: q } = await a.db.from("hub_briefing_questions")
    .select("id, audio_r2_key").eq("id", a.question_id).eq("cliente_id", a.cliente_id).eq("conta_id", a.conta_id)
    .maybeSingle();
  if (!q) return { status: 404, body: { error: "Pergunta não encontrada." } };
  if (!q.audio_r2_key) return { status: 200, body: { ok: true } };
  const { error } = await a.db.rpc("briefing_audio_release", {
    p_conta_id: a.conta_id, p_question_id: a.question_id,
  });
  if (error) {
    console.error("briefing_audio_release error:", (error as { message?: string }).message ?? error);
    return { status: 500, body: { error: "internal error" } };
  }
  return { status: 200, body: { ok: true } };
}

export function makeWorkerTranscriber(opts: {
  url?: string | null;
  secret?: string | null;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}): Transcriber | null {
  const url = (opts.url ?? "").trim();
  const secret = (opts.secret ?? "").trim();
  if (!url || !secret) return null;
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 90_000;
  return async (key: string) => {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.error("briefing-audio worker status:", res.status);
      return null;
    }
    const body = (await res.json().catch(() => null)) as { text?: unknown; duration?: unknown } | null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return null;
    return { text, duration: typeof body?.duration === "number" ? body.duration : undefined };
  };
}
```

- [ ] **Step 4: Rodar e confirmar PASS**

```bash
npm run test:functions -- --filter "briefing-audio"
```

Esperado: todos os testes `briefing-audio` passam. Depois `git checkout deno.lock` se ele apareceu como modificado.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/briefing-audio.ts supabase/functions/__tests__/briefing-audio_test.ts
git commit -m "feat(briefing): lógica de presign, finalize e transcrição de áudio

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Rotas de áudio em `hub-briefing`

**Files:**
- Modify: `supabase/functions/hub-briefing/handler.ts`
- Modify: `supabase/functions/hub-briefing/index.ts`
- Modify: `supabase/functions/__tests__/hub-briefing_test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces (HTTP, token do hub):
  - `GET /hub-briefing?token=` → cada pergunta ganha `audio: AudioView | null`.
  - `POST /hub-briefing/upload-url` body `{ token, question_id, mime_type, size_bytes }` → `{ upload_url, r2_key, mime_type }`.
  - `POST /hub-briefing/{question_id}/audio` body `{ token, r2_key, mime_type, size_bytes, duration_seconds }` → `{ ok, answer, transcript, audio }`.
  - `POST /hub-briefing/{question_id}/audio/transcribe` body `{ token }` → mesmo shape.
  - `DELETE /hub-briefing/{question_id}/audio?token=` → `{ ok: true }`.
  - `HubBriefingHandlerDeps` ganha `signPutUrl, signGetUrl, headObject, transcribe`.

- [ ] **Step 1: Atualizar o `makeHandler` do teste existente e adicionar testes das rotas**

Em `supabase/functions/__tests__/hub-briefing_test.ts`, troque `makeHandler` por:

```ts
function makeHandler(
  db: ReturnType<typeof createSupabaseQueryMock>,
  opts: { transcribe?: ((key: string) => Promise<{ text: string } | null>) | null; rateLimit?: (k: string) => boolean } = {},
) {
  return createHubBriefingHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now: () => "2026-06-16T12:00:00.000Z",
    rateLimit: async (_db, key) => (opts.rateLimit ? opts.rateLimit(key) : true),
    signPutUrl: async (key: string) => `https://put.example.com/${key}`,
    signGetUrl: async (key: string) => `https://get.example.com/${key}`,
    headObject: async () => ({ contentLength: 5000, contentType: "audio/webm" }),
    transcribe: opts.transcribe ?? null,
    randomUUID: () => "fixed-uuid",
  });
}
```

Nos testes de GET existentes, acrescente `audio: null` a cada pergunta esperada (o primeiro teste assere o corpo inteiro). Acrescente ao fim do arquivo:

```ts
const Q = "11111111-1111-1111-1111-111111111111";
const KEY = `briefing-audio/conta-1/${Q}/fixed-uuid.webm`;

function postReq(path: string, body: unknown) {
  return new Request(`https://example.test/hub-briefing${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

Deno.test("hub-briefing GET inclui audio assinado quando a pergunta tem áudio", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("briefings", "select", { data: [{ id: "b1", title: "Briefing", display_order: 0 }], error: null });
  db.queue("hub_briefing_questions", "select", {
    data: [{
      id: Q, question: "Marca?", answer: "texto", section: null, display_order: 0, briefing_id: "b1",
      audio_r2_key: KEY, audio_mime: "audio/webm", audio_size_bytes: 5000, audio_duration_seconds: 12,
      audio_transcription_status: "done", audio_recorded_at: "2026-09-03T00:00:00Z",
    }],
    error: null,
  });
  const body = await readJson(await makeHandler(db)(getReq()));
  assertEquals(body.briefings[0].questions[0].audio, {
    url: `https://get.example.com/${KEY}`, mime: "audio/webm", duration_seconds: 12,
    transcription_status: "done", recorded_at: "2026-09-03T00:00:00Z",
  });
});

Deno.test("hub-briefing POST /upload-url devolve presign no prefixo da pergunta", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("hub_briefing_questions", "select", { data: { id: Q }, error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: null, error: null });
  const res = await makeHandler(db)(postReq("/upload-url", { token: "t", question_id: Q, mime_type: "audio/webm;codecs=opus", size_bytes: 5000 }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.r2_key, KEY);
  assertEquals(body.mime_type, "audio/webm");
});

Deno.test("hub-briefing POST /upload-url sem question_id -> 400; 429 na chave de áudio", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  const res = await makeHandler(db)(postReq("/upload-url", { token: "t", mime_type: "audio/webm", size_bytes: 10 }));
  assertEquals(res.status, 400);

  const db2 = createSupabaseQueryMock();
  setupToken(db2);
  const limited = makeHandler(db2, { rateLimit: (k) => !k.startsWith("hub-write:hub-briefing-audio:") });
  const res2 = await limited(postReq("/upload-url", { token: "t", question_id: Q, mime_type: "audio/webm", size_bytes: 10 }));
  assertEquals(res2.status, 429);
});

Deno.test("hub-briefing POST /{id}/audio finaliza, transcreve e devolve answer", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queueRpc("briefing_audio_finalize", { data: { reserved: true, previous_key: null }, error: null });
  db.queue("hub_briefing_questions", "select", {
    data: {
      answer: null, audio_transcript: null, audio_r2_key: KEY, audio_mime: "audio/webm", audio_size_bytes: 5000,
      audio_duration_seconds: 12, audio_transcription_status: "pending", audio_recorded_at: "2026-09-03T00:00:00Z",
    },
    error: null,
  });
  db.queue("hub_briefing_questions", "update", { data: null, error: null });
  const res = await makeHandler(db, { transcribe: async () => ({ text: "Nossa marca." }) })(
    postReq(`/${Q}/audio`, { token: "t", r2_key: KEY, mime_type: "audio/webm", size_bytes: 5000, duration_seconds: 12 }),
  );
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.answer, "Nossa marca.");
  assertEquals(body.audio.transcription_status, "done");
});

Deno.test("hub-briefing POST /{id}/audio propaga 413 da quota", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queueRpc("briefing_audio_finalize", { data: null, error: { message: "quota_exceeded" } });
  const res = await makeHandler(db)(
    postReq(`/${Q}/audio`, { token: "t", r2_key: KEY, mime_type: "audio/webm", size_bytes: 5000, duration_seconds: 12 }),
  );
  assertEquals(res.status, 413);
});

Deno.test("hub-briefing POST /{id}/audio/transcribe e DELETE /{id}/audio", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("hub_briefing_questions", "select", { data: { answer: "a", audio_r2_key: null }, error: null });
  const r1 = await makeHandler(db)(postReq(`/${Q}/audio/transcribe`, { token: "t" }));
  assertEquals(r1.status, 404);

  const db2 = createSupabaseQueryMock();
  setupToken(db2);
  db2.queue("hub_briefing_questions", "select", { data: { id: Q, audio_r2_key: KEY }, error: null });
  db2.queueRpc("briefing_audio_release", { data: KEY, error: null });
  const r2 = await makeHandler(db2)(
    new Request(`https://example.test/hub-briefing/${Q}/audio?token=t`, { method: "DELETE" }),
  );
  assertEquals(r2.status, 200);
  assertEquals(await readJson(r2), { ok: true });
});

Deno.test("hub-briefing POST simples (sem segmento) segue salvando answer", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("hub_briefing_questions", "select", { data: { id: Q }, error: null });
  db.queue("hub_briefing_questions", "update", { data: null, error: null });
  const res = await makeHandler(db)(postReq("", { token: "t", question_id: Q, answer: "oi" }));
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), { ok: true });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
npm run test:functions -- --filter "hub-briefing"
```

Esperado: falha de tipo em `createHubBriefingHandler` (deps desconhecidas) e/ou rotas devolvendo 405/400.

- [ ] **Step 3: Implementar o handler**

Substitua `supabase/functions/hub-briefing/handler.ts` por:

```ts
import { createJsonResponder, internalServerError } from "../_shared/http.ts";
import { resolveHubToken, type HubToken } from "../_shared/hub-token.ts";
import { getClientIP } from "../_shared/rate-limit.ts";
import {
  AUDIO_COLUMNS,
  buildAudioView,
  finalizeBriefingAudio,
  presignBriefingAudio,
  removeBriefingAudio,
  transcribeBriefingAudio,
  type AudioRow,
  type Transcriber,
} from "../_shared/briefing-audio.ts";

type DbClient = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

interface HubBriefingHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
  signPutUrl: (key: string, mime: string) => Promise<string>;
  signGetUrl: (key: string, expiresSeconds?: number) => Promise<string>;
  headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
  transcribe: Transcriber | null;
  randomUUID?: () => string;
}

const AUDIO_WRITE_MAX = 20;
const AUDIO_WRITE_WINDOW = 3600;

export function createHubBriefingHandler(deps: HubBriefingHandlerDeps) {
  const signGet = (key: string) => deps.signGetUrl(key, 3600);

  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const db = deps.createDb();
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("hub-briefing");
    const seg = idx >= 0 ? parts.slice(idx + 1) : [];
    const isPresign = seg.length === 1 && seg[0] === "upload-url";
    const questionId = seg[0] && seg[0].length === 36 ? seg[0] : null;
    const isAudio = !!questionId && seg.length === 2 && seg[1] === "audio";
    const isTranscribe = !!questionId && seg.length === 3 && seg[1] === "audio" && seg[2] === "transcribe";

    const resolveOrReject = async (token: string | null | undefined): Promise<HubToken | Response> => {
      if (!token) return json({ error: "token required" }, 400);
      const hubToken = await resolveHubToken(db as never, token, deps.now());
      if (!hubToken) {
        const okBadToken = await deps.rateLimit(db, `hub-badtoken:${getClientIP(req)}`, 30, 600);
        if (!okBadToken) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
        return json({ error: "Link inválido." }, 404);
      }
      const okRead = await deps.rateLimit(db, `hub-read:${hubToken.conta_id}:${hubToken.cliente_id}`, 300, 300);
      if (!okRead) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
      return hubToken;
    };

    // ── Rotas de áudio ────────────────────────────────────────────
    if (isPresign || isAudio || isTranscribe) {
      let body: Record<string, unknown> = {};
      if (req.method === "POST") {
        try {
          body = await req.json();
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }
      } else if (req.method !== "DELETE" || !isAudio) {
        return json({ error: "Method not allowed" }, 405);
      }
      const token = req.method === "DELETE"
        ? url.searchParams.get("token")
        : (typeof body.token === "string" ? body.token : null);
      const resolved = await resolveOrReject(token);
      if (resolved instanceof Response) return resolved;
      const hubToken = resolved;

      const okWrite = await deps.rateLimit(
        db, `hub-write:hub-briefing-audio:${hubToken.conta_id}:${hubToken.cliente_id}`,
        AUDIO_WRITE_MAX, AUDIO_WRITE_WINDOW,
      );
      if (!okWrite) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);

      if (isPresign) {
        const question_id = typeof body.question_id === "string" ? body.question_id : "";
        if (!question_id || typeof body.mime_type !== "string" || typeof body.size_bytes !== "number") {
          return json({ error: "question_id, mime_type and size_bytes are required" }, 400);
        }
        const r = await presignBriefingAudio({
          db, conta_id: hubToken.conta_id, cliente_id: hubToken.cliente_id, question_id,
          mime_type: body.mime_type, size_bytes: body.size_bytes,
          signPutUrl: deps.signPutUrl, randomUUID: deps.randomUUID,
        });
        return json(r.body, r.status);
      }

      if (isAudio && req.method === "POST") {
        if (typeof body.r2_key !== "string" || typeof body.mime_type !== "string" || typeof body.size_bytes !== "number") {
          return json({ error: "r2_key, mime_type and size_bytes are required" }, 400);
        }
        const r = await finalizeBriefingAudio({
          db, conta_id: hubToken.conta_id, cliente_id: hubToken.cliente_id, question_id: questionId!,
          r2_key: body.r2_key, mime_type: body.mime_type, size_bytes: body.size_bytes,
          duration_seconds: typeof body.duration_seconds === "number" ? body.duration_seconds : null,
          headObject: deps.headObject, signGetUrl: signGet, transcribe: deps.transcribe,
        });
        return json(r.body, r.status);
      }

      if (isAudio && req.method === "DELETE") {
        const r = await removeBriefingAudio({
          db, conta_id: hubToken.conta_id, cliente_id: hubToken.cliente_id, question_id: questionId!,
        });
        return json(r.body, r.status);
      }

      // isTranscribe
      const r = await transcribeBriefingAudio({
        db, conta_id: hubToken.conta_id, cliente_id: hubToken.cliente_id, question_id: questionId!,
        signGetUrl: signGet, transcribe: deps.transcribe,
      });
      return json(r.body, r.status);
    }

    if (req.method === "GET") {
      const resolved = await resolveOrReject(url.searchParams.get("token"));
      if (resolved instanceof Response) return resolved;
      const hubToken = resolved;

      // Parent query: briefings drive the response so empty briefings still render.
      const { data: briefings, error: bErr } = await db
        .from("briefings")
        .select("id, title, display_order")
        .eq("cliente_id", hubToken.cliente_id)
        .order("display_order")
        .order("created_at");
      if (bErr) return internalServerError(json, "hub-briefing:list-briefings", bErr);

      const { data: questions, error: qErr } = await db
        .from("hub_briefing_questions")
        .select(`id, question, answer, section, display_order, briefing_id, ${AUDIO_COLUMNS}`)
        .eq("cliente_id", hubToken.cliente_id)
        .order("display_order");
      if (qErr) return internalServerError(json, "hub-briefing:list-questions", qErr);

      const list = (briefings ?? []) as Array<{ id: string; title: string; display_order: number }>;
      type QRow = AudioRow & {
        id: string; question: string; answer: string | null; section: string | null;
        display_order: number; briefing_id: string | null;
      };
      const qs = await Promise.all(((questions ?? []) as QRow[]).map(async (q) => ({
        id: q.id,
        question: q.question,
        answer: q.answer,
        section: q.section,
        display_order: q.display_order,
        briefing_id: q.briefing_id,
        audio: await buildAudioView(q, signGet),
      })));
      const strip = ({ briefing_id: _b, ...rest }: (typeof qs)[number]) => rest;

      // Legacy rows with a null briefing_id coalesce into the first briefing.
      const firstId = list[0]?.id ?? null;
      const grouped = list.map((b) => ({
        id: b.id,
        title: b.title,
        display_order: b.display_order,
        questions: qs.filter((q) => (q.briefing_id ?? firstId) === b.id).map(strip),
      }));

      // Backward-compat: orphan questions with no parent briefing row surface under a
      // synthetic default briefing so they never disappear from the portal.
      if (list.length === 0 && qs.length > 0) {
        return json({
          briefings: [{ id: "__default__", title: "Briefing", display_order: 0, questions: qs.map(strip) }],
        });
      }
      return json({ briefings: grouped });
    }

    if (req.method === "POST") {
      let body: { token?: string; question_id?: string; answer?: string };
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      const { token, question_id, answer } = body;
      if (!token || !question_id || answer === undefined) {
        return json({ error: "token, question_id, and answer are required" }, 400);
      }
      const resolved = await resolveOrReject(token);
      if (resolved instanceof Response) return resolved;
      const hubToken = resolved;

      const okWrite = await deps.rateLimit(
        db, `hub-write:hub-briefing:${hubToken.conta_id}:${hubToken.cliente_id}`, 30, 3600,
      );
      if (!okWrite) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);

      const { data: question } = await db
        .from("hub_briefing_questions")
        .select("id")
        .eq("id", question_id)
        .eq("cliente_id", hubToken.cliente_id)
        .maybeSingle();
      if (!question) return json({ error: "Pergunta não encontrada." }, 404);

      const { error } = await db
        .from("hub_briefing_questions")
        .update({ answer })
        .eq("id", question_id)
        .eq("cliente_id", hubToken.cliente_id);
      if (error) return internalServerError(json, "hub-briefing:update-answer", error);
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  };
}
```

Nota: o GET/POST legado mudou só de forma (helper `resolveOrReject`); a ordem das checagens e as chaves de rate limit são as mesmas. Se o teste "hub-briefing POST sem token -> 400" existente esperar a mensagem literal `token, question_id, and answer are required`, ela continua igual.

`supabase/functions/hub-briefing/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { headObjectSigned, signGetUrl, signPutUrl } from "../_shared/r2.ts";
import { makeBoundedFetch } from "../_shared/bounded-fetch.ts";
import { makeWorkerTranscriber } from "../_shared/briefing-audio.ts";
import { createHubBriefingHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createHubBriefingHandler({
  buildCorsHeaders,
  createDb: () =>
    createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      // Handler grava estado (quota RPC + R2 HEAD): teto em toda chamada Supabase.
      global: { fetch: makeBoundedFetch() },
    }),
  now: () => new Date().toISOString(),
  // deno-lint-ignore no-explicit-any
  rateLimit: (db, key, max, win) => checkRateLimit(db as any, key, max, win),
  signPutUrl,
  signGetUrl,
  headObject: headObjectSigned,
  // Sem TRANSCRIBE_WORKER_URL/TRANSCRIBE_SECRET o áudio salva e a transcrição fica "failed".
  transcribe: makeWorkerTranscriber({
    url: Deno.env.get("TRANSCRIBE_WORKER_URL"),
    secret: Deno.env.get("TRANSCRIBE_SECRET"),
  }),
}));
```

Confira a assinatura de `headObjectSigned` em `_shared/r2.ts:87`; se ela devolver um shape diferente de `{ contentLength, contentType }`, adapte com um wrapper em `index.ts`, não no handler.

- [ ] **Step 4: Rodar e confirmar PASS**

```bash
npm run test:functions -- --filter "hub-briefing"
npm run test:functions
```

Esperado: tudo verde (a suíte inteira, porque `hub-briefing_test.ts` existente foi editado). `git checkout deno.lock` depois.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hub-briefing supabase/functions/__tests__/hub-briefing_test.ts
git commit -m "feat(briefing): rotas de upload, finalize, retry e remoção de áudio no hub-briefing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Hub client: tipos, wrappers de API e serviço de upload

**Files:**
- Modify: `apps/hub/src/types.ts:171-177`
- Modify: `apps/hub/src/api.ts`
- Modify: `apps/hub/src/services/ideiaMedia.ts:88-127`
- Create: `apps/hub/src/services/briefingAudio.ts`
- Modify: `apps/hub/src/__tests__/api.test.ts`
- Create: `apps/hub/src/services/__tests__/briefingAudio.test.ts`

**Interfaces:**
- Consumes: rotas da Task 3.
- Produces:
  - `types.ts`: `BriefingAudio`, `BriefingQuestion.audio: BriefingAudio | null`, `BriefingAudioResponse`.
  - `api.ts`: `presignBriefingAudio(token, { question_id, mime_type, size_bytes })`, `finalizeBriefingAudio(token, questionId, { r2_key, mime_type, size_bytes, duration_seconds })`, `retryBriefingTranscription(token, questionId)`, `deleteBriefingAudio(token, questionId)`.
  - `services/ideiaMedia.ts`: `export function putToR2(url: string, body: Blob, contentType: string): Promise<void>`.
  - `services/briefingAudio.ts`: `AUDIO_MIME`, `MAX_AUDIO_BYTES`, `MAX_AUDIO_SECONDS = 300`, `normalizeAudioMime(raw): string | null`, `pickRecorderMime(): string | undefined`, `validateBriefingAudio(blob, mime): string`, `uploadBriefingAudio({ token, questionId, blob, mime, durationSeconds, onPhase? }): Promise<BriefingAudioResponse>`.

- [ ] **Step 1: Escrever os testes**

Acrescente em `apps/hub/src/__tests__/api.test.ts` (dentro do `describe` existente, importando os quatro wrappers novos de `'../api'`):

```ts
  it('presigns and finalizes briefing audio on the nested hub-briefing routes', async () => {
    fetchHarness.queueResponse({ json: { upload_url: 'https://r2/put', r2_key: 'briefing-audio/c/q/x.webm', mime_type: 'audio/webm' } });
    const signed = await presignBriefingAudio('tok', { question_id: 'q1', mime_type: 'audio/webm;codecs=opus', size_bytes: 10 });
    expect(signed.mime_type).toBe('audio/webm');
    expect(String(fetchHarness.calls[0].input)).toContain('/functions/v1/hub-briefing/upload-url');
    expect(JSON.parse(String(fetchHarness.calls[0].init?.body))).toEqual({
      token: 'tok', question_id: 'q1', mime_type: 'audio/webm;codecs=opus', size_bytes: 10,
    });

    fetchHarness.queueResponse({ json: { ok: true, answer: 'oi', transcript: 'oi', audio: null } });
    const fin = await finalizeBriefingAudio('tok', 'q1', { r2_key: 'k', mime_type: 'audio/webm', size_bytes: 10, duration_seconds: 3 });
    expect(fin.answer).toBe('oi');
    expect(String(fetchHarness.calls[1].input)).toContain('/functions/v1/hub-briefing/q1/audio');
  });

  it('retries transcription and deletes audio', async () => {
    fetchHarness.queueResponse({ json: { ok: true, answer: 'a', transcript: 'a', audio: null } });
    await retryBriefingTranscription('tok', 'q1');
    expect(String(fetchHarness.calls[0].input)).toContain('/hub-briefing/q1/audio/transcribe');
    expect(JSON.parse(String(fetchHarness.calls[0].init?.body))).toEqual({ token: 'tok' });

    fetchHarness.queueResponse({ json: { ok: true } });
    await deleteBriefingAudio('tok', 'q1');
    expect(fetchHarness.calls[1].init?.method).toBe('DELETE');
    expect(String(fetchHarness.calls[1].input)).toContain('/hub-briefing/q1/audio?token=tok');
  });
```

`apps/hub/src/services/__tests__/briefingAudio.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({
  presignBriefingAudio: vi.fn(),
  finalizeBriefingAudio: vi.fn(),
}));

import { finalizeBriefingAudio, presignBriefingAudio } from '../../api';
import { normalizeAudioMime, uploadBriefingAudio, validateBriefingAudio } from '../briefingAudio';

class FakeXHR {
  static last: FakeXHR | null = null;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  status = 200;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  body: unknown;
  open(method: string, url: string) { this.method = method; this.url = url; FakeXHR.last = this; }
  setRequestHeader(k: string, v: string) { this.headers[k] = v; }
  send(body: unknown) { this.body = body; queueMicrotask(() => this.onload?.()); }
}

describe('briefingAudio service', () => {
  beforeEach(() => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    vi.mocked(presignBriefingAudio).mockReset();
    vi.mocked(finalizeBriefingAudio).mockReset();
  });

  it('normalizes recorder mime and validates size', () => {
    expect(normalizeAudioMime('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(normalizeAudioMime('audio/mp4')).toBe('audio/mp4');
    expect(normalizeAudioMime('video/mp4')).toBeNull();
    expect(() => validateBriefingAudio(new Blob(['x']), 'video/mp4')).toThrow('Formato de áudio não suportado');
    expect(() => validateBriefingAudio(new Blob([]), 'audio/webm')).toThrow('Gravação vazia');
    expect(validateBriefingAudio(new Blob(['abc']), 'audio/webm;codecs=opus')).toBe('audio/webm');
  });

  it('presigns, PUTs with the normalized content type and finalizes', async () => {
    vi.mocked(presignBriefingAudio).mockResolvedValue({ upload_url: 'https://r2/put', r2_key: 'briefing-audio/c/q/x.webm', mime_type: 'audio/webm' });
    vi.mocked(finalizeBriefingAudio).mockResolvedValue({ ok: true, answer: 'texto', transcript: 'texto', audio: null });
    const phases: string[] = [];
    const blob = new Blob(['abc'], { type: 'audio/webm;codecs=opus' });

    const res = await uploadBriefingAudio({
      token: 'tok', questionId: 'q1', blob, mime: 'audio/webm;codecs=opus', durationSeconds: 7,
      onPhase: (p) => phases.push(p),
    });

    expect(res.answer).toBe('texto');
    expect(FakeXHR.last?.method).toBe('PUT');
    expect(FakeXHR.last?.url).toBe('https://r2/put');
    expect(FakeXHR.last?.headers['Content-Type']).toBe('audio/webm');
    expect(finalizeBriefingAudio).toHaveBeenCalledWith('tok', 'q1', {
      r2_key: 'briefing-audio/c/q/x.webm', mime_type: 'audio/webm', size_bytes: 3, duration_seconds: 7,
    });
    expect(phases).toEqual(['uploading', 'transcribing']);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
npx vitest run apps/hub/src/__tests__/api.test.ts apps/hub/src/services/__tests__/briefingAudio.test.ts
```

Esperado: falha por export inexistente.

- [ ] **Step 3: Implementar**

`apps/hub/src/types.ts`: substitua o bloco `BriefingQuestion` por:

```ts
export interface BriefingAudio {
  url: string;
  mime: string;
  duration_seconds: number | null;
  transcription_status: 'pending' | 'done' | 'failed' | null;
  recorded_at: string | null;
}

export interface BriefingQuestion {
  id: string;
  question: string;
  answer: string | null;
  section: string | null;
  display_order: number;
  audio: BriefingAudio | null;
}

export interface BriefingAudioResponse {
  ok: boolean;
  answer: string | null;
  transcript: string | null;
  audio: BriefingAudio | null;
}
```

Se algum fixture de teste no Hub construir `BriefingQuestion` sem `audio` (`grep -rn "display_order" apps/hub/src --include='*.test.tsx' | grep -i brief`), acrescente `audio: null`.

`apps/hub/src/api.ts`: importe `BriefingAudioResponse` de `./types` e acrescente após `submitBriefingAnswer`:

```ts
export function presignBriefingAudio(
  token: string,
  payload: { question_id: string; mime_type: string; size_bytes: number },
) {
  return post<{ upload_url: string; r2_key: string; mime_type: string }>('hub-briefing/upload-url', {
    token,
    ...payload,
  });
}

export function finalizeBriefingAudio(
  token: string,
  questionId: string,
  payload: { r2_key: string; mime_type: string; size_bytes: number; duration_seconds: number },
) {
  return post<BriefingAudioResponse>(`hub-briefing/${questionId}/audio`, { token, ...payload });
}

export function retryBriefingTranscription(token: string, questionId: string) {
  return post<BriefingAudioResponse>(`hub-briefing/${questionId}/audio/transcribe`, { token });
}

export function deleteBriefingAudio(token: string, questionId: string) {
  return del<{ ok: boolean }>('hub-briefing', `${questionId}/audio`, token);
}
```

`apps/hub/src/services/ideiaMedia.ts`: troque `putToR2` por

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

e os dois call sites em `uploadIdeiaImage` para `putToR2(signed.upload_url, file, file.type)` e `putToR2(signed.thumbnail_upload_url, thumb, 'image/webp')`.

`apps/hub/src/services/briefingAudio.ts`:

```ts
import { finalizeBriefingAudio, presignBriefingAudio } from '../api';
import type { BriefingAudioResponse } from '../types';
import { putToR2 } from './ideiaMedia';

export const AUDIO_MIME = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav'];
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 300;

const RECORDER_MIME_PREFERENCE = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];

export function normalizeAudioMime(raw: string): string | null {
  const base = raw.split(';')[0].trim().toLowerCase();
  return AUDIO_MIME.includes(base) ? base : null;
}

/** First MediaRecorder mime the browser supports (Chrome: webm/opus, Safari: mp4). */
export function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  return RECORDER_MIME_PREFERENCE.find((m) => MediaRecorder.isTypeSupported(m));
}

/** Returns the normalized mime or throws a user-facing message. */
export function validateBriefingAudio(blob: Blob, mime: string): string {
  const normalized = normalizeAudioMime(mime);
  if (!normalized) throw new Error(`Formato de áudio não suportado: ${mime || 'desconhecido'}`);
  if (blob.size <= 0) throw new Error('Gravação vazia. Tente de novo.');
  if (blob.size > MAX_AUDIO_BYTES) throw new Error('Áudio maior que 15 MB. Grave um trecho mais curto.');
  return normalized;
}

export type UploadPhase = 'uploading' | 'transcribing';

export async function uploadBriefingAudio(args: {
  token: string;
  questionId: string;
  blob: Blob;
  mime: string;
  durationSeconds: number;
  onPhase?: (phase: UploadPhase) => void;
}): Promise<BriefingAudioResponse> {
  const { token, questionId, blob, durationSeconds, onPhase } = args;
  const mime = validateBriefingAudio(blob, args.mime);

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

- [ ] **Step 4: Rodar e confirmar PASS + typecheck**

```bash
npx vitest run apps/hub/src
npx tsc -p apps/hub/tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
npm run format
git add apps/hub/src/types.ts apps/hub/src/api.ts apps/hub/src/services apps/hub/src/__tests__/api.test.ts
git commit -m "feat(hub): cliente de upload e transcrição de áudio do briefing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Player de áudio próprio `@mesaas/ui/AudioPlayer`

**Files:**
- Create: `packages/ui/AudioPlayer/index.tsx`
- Create: `packages/ui/AudioPlayer/__tests__/index.test.tsx`

**Interfaces:**
- Consumes: nada do projeto (arquivo standalone, sem imports `@/`, como `packages/ui/VideoPlayer`; ambos os apps já aliasam `@mesaas/ui/*` para `packages/ui/*`, e o vitest da raiz também).
- Produces: `export function AudioPlayer(props: { src: string; durationSeconds?: number | null; className?: string; style?: CSSProperties; label?: string })` e `export function formatClock(seconds: number): string` (`m:ss`). Estilo via variáveis CSS com fallback: `--audio-btn-bg` (fundo do play, padrão `currentColor`), `--audio-btn-fg` (ícone, padrão `#fff`), `--audio-track` (trilha, padrão `rgba(0,0,0,.1)`), `--audio-fill` (progresso, padrão `currentColor`). Importado nos apps como `@mesaas/ui/AudioPlayer`.

Motivação: o `<audio controls>` nativo muda de cara entre Chrome e Safari e não segue o whitelabel. Este player é mínimo e nosso: botão redondo de 36px, trilha de 4px com seek por clique e teclado, `atual / total` em tabular. Gotcha real: um `.webm` gravado pelo `MediaRecorder` reporta `duration = Infinity`; por isso `durationSeconds` (o timer do gravador, salvo no banco) é a fonte do total quando a mídia não informa.

- [ ] **Step 1: Escrever o teste**

`packages/ui/AudioPlayer/__tests__/index.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer, formatClock } from '../index';

const play = vi.fn(async () => {});
const pause = vi.fn();

beforeEach(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: play });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: pause });
});
afterEach(() => vi.clearAllMocks());

describe('AudioPlayer', () => {
  it('formats clocks as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65.4)).toBe('1:05');
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('0:00');
  });

  it('shows the given duration when the media reports none and toggles play/pause', () => {
    render(<AudioPlayer src="blob:x" durationSeconds={58} />);
    expect(screen.getByText('0:00 / 0:58')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /reproduzir/i }));
    expect(play).toHaveBeenCalledTimes(1);
    const audio = document.querySelector('audio') as HTMLAudioElement;
    fireEvent(audio, new Event('play'));
    expect(screen.getByRole('button', { name: /pausar/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /pausar/i }));
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('updates the clock on timeupdate and seeks on track click and keyboard', () => {
    render(<AudioPlayer src="blob:x" durationSeconds={100} />);
    const audio = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 25 });
    fireEvent(audio, new Event('timeupdate'));
    expect(screen.getByText('0:25 / 1:40')).toBeInTheDocument();

    const slider = screen.getByRole('slider');
    slider.getBoundingClientRect = () =>
      ({ left: 0, width: 200, top: 0, height: 4, right: 200, bottom: 4, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.click(slider, { clientX: 100 });
    expect(audio.currentTime).toBe(50);
    expect(slider).toHaveAttribute('aria-valuenow', '50');

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(audio.currentTime).toBe(55);
  });

  it('resets to paused at the end', () => {
    render(<AudioPlayer src="blob:x" durationSeconds={10} />);
    const audio = document.querySelector('audio') as HTMLAudioElement;
    fireEvent(audio, new Event('play'));
    expect(screen.getByRole('button', { name: /pausar/i })).toBeInTheDocument();
    fireEvent(audio, new Event('ended'));
    expect(screen.getByRole('button', { name: /reproduzir/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
npx vitest run packages/ui/AudioPlayer
```

Esperado: falha por módulo `../index` inexistente.

- [ ] **Step 3: Implementar `packages/ui/AudioPlayer/index.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';

// Shared across the CRM and Hub apps as '@mesaas/ui/AudioPlayer' (standalone
// file pattern from packages/ui/index.ts: no '@/' imports, never in the barrel).
//
// Minimal player the apps control: round play/pause, a seekable track and
// "current / total". Styled by CSS custom properties so each app maps its own
// tokens: --audio-btn-bg, --audio-btn-fg, --audio-track, --audio-fill.
//
// MediaRecorder .webm files report duration = Infinity, so `durationSeconds`
// (the recorder's timer, stored server-side) is the total when the media has none.

export interface AudioPlayerProps {
  src: string;
  durationSeconds?: number | null;
  className?: string;
  style?: CSSProperties;
  /** Accessible name prefix for the controls, e.g. "Resposta em áudio". */
  label?: string;
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const SEEK_STEP = 5;

export function AudioPlayer({ src, durationSeconds, className, style, label }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);

  const total =
    mediaDuration && Number.isFinite(mediaDuration) && mediaDuration > 0
      ? mediaDuration
      : typeof durationSeconds === 'number' && durationSeconds > 0
        ? durationSeconds
        : 0;
  const ratio = total > 0 ? Math.min(1, current / total) : 0;

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setMediaDuration(null);
  }, [src]);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) el.pause();
    else void el.play().catch(() => setPlaying(false));
  }

  function seekTo(seconds: number) {
    const el = audioRef.current;
    if (!el || total <= 0) return;
    const next = Math.max(0, Math.min(total, seconds));
    el.currentTime = next;
    setCurrent(next);
  }

  function onTrackClick(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    seekTo(((e.clientX - rect.left) / rect.width) * total);
  }

  function onTrackKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      seekTo(current + SEEK_STEP);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      seekTo(current - SEEK_STEP);
    } else if (e.key === 'Home') {
      e.preventDefault();
      seekTo(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      seekTo(total);
    }
  }

  const name = label ? `${label}: ` : '';

  return (
    <div className={className} style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, ...style }}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setMediaDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setMediaDuration(e.currentTarget.duration)}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? `${name}Pausar` : `${name}Reproduzir`}
        style={{
          flexShrink: 0,
          width: 36,
          height: 36,
          borderRadius: 9999,
          border: 0,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--audio-btn-bg, currentColor)',
          color: 'var(--audio-btn-fg, #fff)',
        }}
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M8 5.5v13l10-6.5z" />
          </svg>
        )}
      </button>
      <div
        role="slider"
        tabIndex={0}
        aria-label={`${name}Posição`}
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(current)}
        aria-valuetext={`${formatClock(current)} de ${formatClock(total)}`}
        onClick={onTrackClick}
        onKeyDown={onTrackKey}
        style={{ flex: '1 1 0', minWidth: 80, height: 24, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: 4,
            borderRadius: 9999,
            background: 'var(--audio-track, rgba(0,0,0,.1))',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${ratio * 100}%`,
              borderRadius: 9999,
              background: 'var(--audio-fill, currentColor)',
            }}
          />
        </div>
      </div>
      <span style={{ flexShrink: 0, fontSize: 12, fontVariantNumeric: 'tabular-nums', opacity: 0.7 }}>
        {formatClock(current)} / {formatClock(total)}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Rodar testes e typecheck dos dois apps**

```bash
npx vitest run packages/ui/AudioPlayer
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Se o `tsc` do Hub ou do CRM não enxergar `packages/ui/AudioPlayer` (tsconfig `include`), confira como `VideoPlayer` entra e siga o mesmo caminho.

- [ ] **Step 5: Commit**

```bash
npm run format
git add packages/ui/AudioPlayer
git commit -m "feat(ui): AudioPlayer compartilhado com seek e tempo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Hub UI: `AudioRecorder` e integração na `BriefingPage`

**Files:**
- Create: `apps/hub/src/components/AudioRecorder.tsx`
- Modify: `apps/hub/src/pages/BriefingPage.tsx`
- Create: `apps/hub/src/components/__tests__/AudioRecorder.test.tsx`
- Create: `apps/hub/src/pages/__tests__/briefingPage.test.tsx`

**Interfaces:**
- Consumes: Task 4 e `AudioPlayer` da Task 5 (`import { AudioPlayer } from '@mesaas/ui/AudioPlayer'`). No Hub, aplique as variáveis `HUB_AUDIO_VARS` (definidas e exportadas em `AudioRecorder.tsx`, ver código) para o player seguir o whitelabel.
- Produces: `AudioRecorder` com props `{ phase: 'idle' | 'uploading' | 'transcribing'; disabled?: boolean; onRecorded: (blob: Blob, mime: string, durationSeconds: number) => Promise<void> }`; helpers exportados `isRecordingSupported(): boolean`, `formatDuration(seconds: number): string`.

- [ ] **Step 1: Escrever os testes**

`apps/hub/src/components/__tests__/AudioRecorder.test.tsx`:

```tsx
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@mesaas/ui/AudioPlayer', () => ({
  AudioPlayer: ({ durationSeconds }: { durationSeconds?: number | null }) => (
    <div data-testid="audio-player">{`player ${durationSeconds ?? 0}s`}</div>
  ),
}));

import { AudioRecorder, formatDuration, isRecordingSupported } from '../AudioRecorder';

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = (m: string) => m === 'audio/webm;codecs=opus';
  mimeType: string;
  state = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: MediaStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? 'audio/webm';
    FakeMediaRecorder.instances.push(this);
  }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['abc'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const stopTrack = vi.fn();

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('isSecureContext', true);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) },
  });
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('AudioRecorder', () => {
  it('formats durations as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65)).toBe('1:05');
  });

  it('is unsupported in insecure contexts', () => {
    vi.stubGlobal('isSecureContext', false);
    expect(isRecordingSupported()).toBe(false);
  });

  it('records, previews and hands the blob with elapsed seconds to onRecorded', async () => {
    vi.useFakeTimers();
    const onRecorded = vi.fn(async () => {});
    render(<AudioRecorder phase="idle" onRecorded={onRecorded} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /gravar áudio/i }));
    });
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(FakeMediaRecorder.instances[0].mimeType).toBe('audio/webm;codecs=opus');

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText('0:03')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /parar/i }));
    });
    expect(stopTrack).toHaveBeenCalled();
    expect(screen.getByTestId('audio-player')).toHaveTextContent('player 3s');
    expect(screen.getByRole('button', { name: /enviar/i })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /enviar/i }));
    });
    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
    const [blob, mime, seconds] = onRecorded.mock.calls[0] as unknown as [Blob, string, number];
    expect(blob.size).toBe(3);
    expect(mime).toBe('audio/webm;codecs=opus');
    expect(seconds).toBe(3);
  });

  it('shows a message when the microphone permission is denied', async () => {
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
    );
    render(<AudioRecorder phase="idle" onRecorded={vi.fn(async () => {})} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /gravar áudio/i }));
    });
    expect(screen.getByText(/permita o acesso ao microfone/i)).toBeInTheDocument();
  });
});
```

`apps/hub/src/pages/__tests__/briefingPage.test.tsx`:

```tsx
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HubContext } from '../../HubContext';

vi.mock('../../api', () => ({
  fetchBriefing: vi.fn(),
  submitBriefingAnswer: vi.fn(),
  presignBriefingAudio: vi.fn(),
  finalizeBriefingAudio: vi.fn(),
  retryBriefingTranscription: vi.fn(),
  deleteBriefingAudio: vi.fn(),
}));
vi.mock('../../services/briefingAudio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/briefingAudio')>()),
  uploadBriefingAudio: vi.fn(),
}));
vi.mock('@mesaas/ui/AudioPlayer', () => ({
  AudioPlayer: ({ durationSeconds }: { durationSeconds?: number | null }) => (
    <div data-testid="audio-player">{`player ${durationSeconds ?? 0}s`}</div>
  ),
}));
vi.mock('../../components/AudioRecorder', () => ({
  isRecordingSupported: () => true,
  HUB_AUDIO_VARS: {},
  AudioRecorder: ({ onRecorded, phase }: { onRecorded: (b: Blob, m: string, s: number) => Promise<void>; phase: string }) => (
    <button type="button" data-phase={phase} onClick={() => void onRecorded(new Blob(['abc']), 'audio/webm', 3)}>
      fake-record
    </button>
  ),
}));

import { deleteBriefingAudio, fetchBriefing, retryBriefingTranscription, submitBriefingAnswer } from '../../api';
import { uploadBriefingAudio } from '../../services/briefingAudio';
import { BriefingPage } from '../BriefingPage';

const hubValue = {
  bootstrap: {
    workspace: { name: 'Mesaas', logo_url: null, brand_color: '#0f766e' },
    cliente_nome: 'Clínica Aurora', is_active: true, cliente_id: 14, feature_mensagens: true,
  },
  token: 'token-publico',
  workspace: 'mesaas',
};

function renderPage(page: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HubContext.Provider value={hubValue}>
        <MemoryRouter>{page}</MemoryRouter>
      </HubContext.Provider>
    </QueryClientProvider>,
  );
}

const audio = {
  url: 'https://get/x.webm', mime: 'audio/webm', duration_seconds: 65,
  transcription_status: 'failed' as const, recorded_at: '2026-09-03T00:00:00Z',
};

beforeEach(() => {
  vi.mocked(fetchBriefing).mockResolvedValue({
    briefings: [{
      id: 'b1', title: 'Briefing', display_order: 0,
      questions: [
        { id: 'q1', question: 'Marca?', answer: 'Antes.', section: null, display_order: 0, audio: null },
        { id: 'q2', question: 'Público?', answer: null, section: null, display_order: 1, audio },
      ],
    }],
  });
});
afterEach(() => vi.clearAllMocks());

describe('BriefingPage audio', () => {
  it('locks the textarea while uploading and fills it with the returned answer', async () => {
    let resolveUpload!: (v: unknown) => void;
    vi.mocked(uploadBriefingAudio).mockImplementation(
      () => new Promise((r) => { resolveUpload = r; }) as never,
    );
    renderPage(<BriefingPage />);
    await screen.findByText('Marca?');
    const textareas = screen.getAllByRole('textbox');

    await act(async () => {
      fireEvent.click(screen.getAllByText('fake-record')[0]);
    });
    expect(textareas[0]).toBeDisabled();

    await act(async () => {
      resolveUpload({ ok: true, answer: 'Antes.\n\nTranscrito.', transcript: 'Transcrito.', audio: { ...audio, transcription_status: 'done' } });
    });
    await waitFor(() => expect(textareas[0]).not.toBeDisabled());
    expect(textareas[0]).toHaveValue('Antes.\n\nTranscrito.');
  });

  it('shows the audio player, failed status with retry, and remove', async () => {
    vi.mocked(retryBriefingTranscription).mockResolvedValue({ ok: true, answer: 'Novo', transcript: 'Novo', audio: { ...audio, transcription_status: 'done' } });
    vi.mocked(deleteBriefingAudio).mockResolvedValue({ ok: true });
    renderPage(<BriefingPage />);
    await screen.findByText('Público?');

    expect(screen.getByText('player 65s')).toBeInTheDocument();
    expect(screen.getByText(/não foi possível transcrever/i)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    });
    expect(retryBriefingTranscription).toHaveBeenCalledWith('token-publico', 'q2');
    await waitFor(() => expect(screen.getAllByRole('textbox')[1]).toHaveValue('Novo'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /remover áudio/i }));
    });
    expect(deleteBriefingAudio).toHaveBeenCalledWith('token-publico', 'q2');
  });

  it('surfaces text-save failures instead of swallowing them', async () => {
    vi.useFakeTimers();
    vi.mocked(submitBriefingAnswer).mockRejectedValue(new Error('HTTP 500'));
    renderPage(<BriefingPage />);
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    await screen.findByText('Marca?');
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Novo texto' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(screen.getByText(/não foi possível salvar/i)).toBeInTheDocument();
    vi.useRealTimers();
  });
});
```

Ajuste o mock de `AudioRecorder` se a `BriefingPage` importar helpers com outros nomes; a intenção do teste é fixa.

- [ ] **Step 2: Rodar e confirmar falha**

```bash
npx vitest run apps/hub/src/components/__tests__/AudioRecorder.test.tsx apps/hub/src/pages/__tests__/briefingPage.test.tsx
```

- [ ] **Step 3: Implementar `AudioRecorder.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AudioPlayer } from '@mesaas/ui/AudioPlayer';
import { MAX_AUDIO_SECONDS, pickRecorderMime } from '../services/briefingAudio';

/** Hub tokens for the shared player (whitelabel-aware). */
export const HUB_AUDIO_VARS = {
  '--audio-btn-bg': 'var(--hub-primary)',
  '--audio-btn-fg': 'var(--hub-primary-fg)',
  '--audio-track': 'var(--hub-bd)',
  '--audio-fill': 'var(--hub-txt)',
} as CSSProperties;

export type RecorderPhase = 'idle' | 'uploading' | 'transcribing';

export function isRecordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const WARN_AT_SECONDS = 270;
const BTN = 'inline-flex items-center gap-2 px-3.5 py-2 text-[13px] font-semibold rounded-[var(--hub-r-ctl)] disabled:opacity-50';

interface Props {
  phase: RecorderPhase;
  disabled?: boolean;
  onRecorded: (blob: Blob, mime: string, durationSeconds: number) => Promise<void>;
}

type Mode = 'idle' | 'recording' | 'preview';

export function AudioRecorder({ phase, disabled, onRecorded }: Props) {
  const [mode, setMode] = useState<Mode>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  }, []);

  const discard = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setBlob(null);
    setElapsed(0);
    setMode('idle');
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      releaseStream();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  }, []);

  async function start() {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = (e as { name?: string }).name;
      setError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Permita o acesso ao microfone no navegador para gravar.'
          : 'Não foi possível acessar o microfone.',
      );
      return;
    }
    streamRef.current = stream;
    const mime = pickRecorderMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorderRef.current = rec;
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const seconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
      const type = rec.mimeType || mime || 'audio/webm';
      const out = new Blob(chunksRef.current, { type });
      releaseStream();
      setElapsed(seconds);
      setBlob(out);
      setPreviewUrl(URL.createObjectURL(out));
      setMode('preview');
    };
    startedAtRef.current = Date.now();
    setElapsed(0);
    setMode('recording');
    rec.start(1000);
    tickRef.current = setInterval(() => {
      const s = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsed(s);
      if (s >= MAX_AUDIO_SECONDS) stop();
    }, 250);
  }

  async function send() {
    if (!blob) return;
    const mime = blob.type || 'audio/webm';
    const seconds = elapsed;
    try {
      await onRecorded(blob, mime, seconds);
      discard();
    } catch (e) {
      setError((e as Error).message || 'Não foi possível enviar o áudio.');
    }
  }

  if (!isRecordingSupported()) return null;
  const busy = phase !== 'idle';

  return (
    <div className="space-y-2">
      {mode === 'idle' && (
        <button
          type="button"
          className={`${BTN} hub-btn-secondary`}
          disabled={disabled || busy}
          onClick={() => void start()}
          aria-label="Gravar áudio"
        >
          <MicIcon />
          {busy ? (phase === 'uploading' ? 'Enviando áudio…' : 'Transcrevendo…') : 'Gravar áudio'}
        </button>
      )}

      {mode === 'recording' && (
        <div className="flex items-center gap-3">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" aria-hidden />
          <span className="text-[13px] tabular-nums hub-txt">{formatDuration(elapsed)}</span>
          <button type="button" className={`${BTN} hub-btn-primary`} onClick={stop} aria-label="Parar gravação">
            Parar
          </button>
          {elapsed >= WARN_AT_SECONDS && (
            <span className="text-xs hub-tx3">Limite de 5 minutos. A gravação para sozinha.</span>
          )}
        </div>
      )}

      {mode === 'preview' && previewUrl && (
        <div className="flex flex-wrap items-center gap-3">
          <AudioPlayer src={previewUrl} durationSeconds={elapsed} label="Prévia" className="hub-txt w-full max-w-[360px]" style={HUB_AUDIO_VARS} />
          <button type="button" className={`${BTN} hub-btn-primary`} disabled={busy} onClick={() => void send()}>
            {phase === 'uploading' ? 'Enviando…' : phase === 'transcribing' ? 'Transcrevendo…' : 'Enviar'}
          </button>
          <button type="button" className={`${BTN} hub-btn-secondary`} disabled={busy} onClick={discard}>
            Descartar
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}
```

(O Hub não usa `lucide-react` no `package.json`? Confira com `grep lucide apps/hub/package.json`. Se usar, troque `MicIcon` por `<Mic size={16} />` de `lucide-react`.)

- [ ] **Step 4: Integrar na `BriefingPage.tsx`**

Substitua `QuestionItem` e o map que o renderiza:

```tsx
import { useState, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useHub } from '../HubContext';
import { deleteBriefingAudio, fetchBriefing, retryBriefingTranscription, submitBriefingAnswer } from '../api';
import { uploadBriefingAudio } from '../services/briefingAudio';
import { AudioPlayer } from '@mesaas/ui/AudioPlayer';
import { AudioRecorder, HUB_AUDIO_VARS, isRecordingSupported, type RecorderPhase } from '../components/AudioRecorder';
import { PageHeader } from '../components/PageHeader';
import { ScrollableTabs } from '../components/ScrollableTabs';
import type { BriefingAudio, BriefingAudioResponse, BriefingQuestion } from '../types';
```

No `BriefingPage`, troque o map por:

```tsx
{visibleQuestions.map((q) => (
  <QuestionItem
    key={q.id}
    token={token}
    question={q}
    onSave={handleSave(q.id)}
    onAudioChanged={() => qc.invalidateQueries({ queryKey: ['hub-briefing', token] })}
  />
))}
```

E o componente:

```tsx
function QuestionItem({
  token,
  question,
  onSave,
  onAudioChanged,
}: {
  token: string;
  question: BriefingQuestion;
  onSave: (answer: string) => Promise<void>;
  onAudioChanged: () => void;
}) {
  const [answer, setAnswer] = useState(question.answer ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [audio, setAudio] = useState<BriefingAudio | null>(question.audio);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'retry' | 'remove' | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locked = phase !== 'idle';

  const handleChange = useCallback(
    (value: string) => {
      setAnswer(value);
      setStatus('saving');
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          await onSave(value);
          setStatus('saved');
          setTimeout(() => setStatus('idle'), 2000);
        } catch {
          setStatus('error');
        }
      }, 800);
    },
    [onSave],
  );

  function applyResponse(res: BriefingAudioResponse) {
    if (res.answer !== null) setAnswer(res.answer);
    setAudio(res.audio);
    onAudioChanged();
  }

  async function handleRecorded(blob: Blob, mime: string, durationSeconds: number) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setAudioError(null);
    setPhase('uploading');
    try {
      const res = await uploadBriefingAudio({
        token, questionId: question.id, blob, mime, durationSeconds, onPhase: setPhase,
      });
      applyResponse(res);
    } catch (e) {
      setAudioError((e as Error).message || 'Não foi possível enviar o áudio.');
      throw e;
    } finally {
      setPhase('idle');
    }
  }

  async function handleRetry() {
    setBusyAction('retry');
    setAudioError(null);
    try {
      applyResponse(await retryBriefingTranscription(token, question.id));
    } catch (e) {
      setAudioError((e as Error).message || 'Não foi possível transcrever.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRemove() {
    setBusyAction('remove');
    setAudioError(null);
    try {
      await deleteBriefingAudio(token, question.id);
      setAudio(null);
      onAudioChanged();
    } catch (e) {
      setAudioError((e as Error).message || 'Não foi possível remover o áudio.');
    } finally {
      setBusyAction(null);
    }
  }

  const transcriptionLabel =
    audio?.transcription_status === 'done'
      ? 'Transcrição adicionada à resposta.'
      : audio?.transcription_status === 'pending'
        ? 'Transcrição pendente.'
        : audio
          ? 'Não foi possível transcrever este áudio.'
          : null;

  return (
    <div className="hub-card p-5 sm:p-6 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[14px] font-semibold hub-txt leading-snug">{question.question}</p>
        <span className="shrink-0 text-[11px] font-medium min-w-[56px] text-right">
          {status === 'saving' && <span className="hub-tx3">Salvando…</span>}
          {status === 'saved' && <span className="text-emerald-600">✓ Salvo</span>}
          {status === 'error' && <span className="text-red-500">Não foi possível salvar. Tente de novo.</span>}
        </span>
      </div>
      <textarea
        className="hub-focus-accent w-full border hub-border rounded-lg px-3.5 py-3 text-[14px] resize-none min-h-[112px] bg-[color-mix(in_srgb,var(--hub-soft)_40%,transparent)] hub-txt placeholder:text-[var(--hub-tx3)] focus:outline-none focus:bg-[var(--hub-card)] focus:border-[var(--hub-bd2)] focus:ring-4 transition-all disabled:opacity-60"
        value={answer}
        disabled={locked}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Digite sua resposta ou grave um áudio…"
      />

      {audio && (
        <div className="space-y-2 rounded-lg border hub-border p-3">
          <AudioPlayer
            src={audio.url}
            durationSeconds={audio.duration_seconds}
            label="Resposta em áudio"
            className="hub-txt w-full max-w-[420px]"
            style={HUB_AUDIO_VARS}
          />
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className={audio.transcription_status === 'failed' ? 'text-red-500' : 'hub-tx3'}>
              {transcriptionLabel}
            </span>
            {audio.transcription_status !== 'done' && (
              <button
                type="button"
                className="font-semibold underline hub-txt disabled:opacity-50"
                disabled={busyAction !== null || locked}
                onClick={() => void handleRetry()}
              >
                {busyAction === 'retry' ? 'Transcrevendo…' : 'Tentar novamente'}
              </button>
            )}
            <button
              type="button"
              className="font-semibold underline hub-tx3 disabled:opacity-50"
              disabled={busyAction !== null || locked}
              onClick={() => void handleRemove()}
              aria-label="Remover áudio"
            >
              {busyAction === 'remove' ? 'Removendo…' : 'Remover áudio'}
            </button>
          </div>
        </div>
      )}

      {isRecordingSupported() && (
        <AudioRecorder phase={phase} disabled={busyAction !== null} onRecorded={handleRecorded} />
      )}
      {audioError && <p className="text-xs text-red-500">{audioError}</p>}
    </div>
  );
}
```

Quando já existe áudio, o botão do gravador funciona como "Regravar": o finalize com chave nova substitui o anterior no servidor.

- [ ] **Step 5: Rodar testes, typecheck e verificar no browser**

```bash
npx vitest run apps/hub/src
npx tsc -p apps/hub/tsconfig.json --noEmit
npm run lint
```

No browser (Hub em staging, `npm run dev:hub:staging`, abrir o link de hub de um cliente de teste na página Briefing): gravar 5 s, ver prévia, enviar. Como o worker ainda não existe nesta task, a resposta vem com status `failed` e o áudio aparece com o player e "Tentar novamente". Confirmar no Chrome e, se disponível, no Safari (mime `audio/mp4`).

- [ ] **Step 6: Commit**

```bash
npm run format
git add apps/hub/src
git commit -m "feat(hub): gravação de áudio por pergunta no briefing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Worker `workers/transcribe` (Workers AI Whisper) + spike

**Files:**
- Create: `workers/transcribe/wrangler.toml`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `workers/transcribe/src/index.ts`, `src/index.test.ts`

**Interfaces:**
- Consumes: objeto no R2 em `briefing-audio/…`.
- Produces: `POST /` com `Authorization: Bearer <TRANSCRIBE_SECRET>` e body `{ key }` → `200 { text, duration }`; `401` segredo errado; `400` chave fora do prefixo; `404` objeto ausente; `413` >15 MiB; `502` falha do modelo. Exporta `handleTranscribe(request, env)` para testes.

- [ ] **Step 1: Scaffold (copiado do media-proxy)**

```bash
mkdir -p workers/transcribe/src
cp workers/media-proxy/tsconfig.json workers/transcribe/tsconfig.json
```

`workers/transcribe/package.json`:

```json
{
  "name": "transcribe",
  "private": true,
  "version": "1.0.0",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240512.0",
    "typescript": "^5.5.0",
    "vitest": "^3.2.4",
    "wrangler": "^3.60.0"
  }
}
```

`workers/transcribe/wrangler.toml`:

```toml
name = "transcribe"
main = "src/index.ts"
compatibility_date = "2024-05-12"

[ai]
binding = "AI"

[[r2_buckets]]
binding = "MEDIA_BUCKET"
bucket_name = "mesaas"

# TRANSCRIBE_SECRET: `wrangler secret put TRANSCRIBE_SECRET` (mesmo valor no
# Supabase como TRANSCRIBE_SECRET). Sem CORS: só a edge function chama.
```

`workers/transcribe/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

// Isolado, como workers/media-proxy: a suíte da raiz não globa workers/**.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
```

`workers/transcribe/.gitignore`: `node_modules` e `.wrangler`.

- [ ] **Step 2: Escrever os testes**

`workers/transcribe/src/index.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { handleTranscribe, type Env } from './index';

const SECRET = 'test-secret';

function makeEnv(opts: { object?: Uint8Array | null; run?: (model: string, input: unknown) => Promise<unknown> } = {}): Env {
  const bytes = opts.object === undefined ? new Uint8Array([1, 2, 3]) : opts.object;
  return {
    TRANSCRIBE_SECRET: SECRET,
    MEDIA_BUCKET: {
      get: vi.fn(async () =>
        bytes
          ? { size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(0) }
          : null,
      ),
    } as unknown as Env['MEDIA_BUCKET'],
    AI: { run: vi.fn(opts.run ?? (async () => ({ text: ' olá mundo ', transcription_info: { duration: 2.5 } }))) } as unknown as Env['AI'],
  };
}

function req(body: unknown, secret = SECRET, method = 'POST') {
  return new Request('https://transcribe.example/', {
    method,
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

const KEY = 'briefing-audio/conta/q/a.webm';

describe('transcribe worker', () => {
  it('401 on wrong or missing secret', async () => {
    expect((await handleTranscribe(req({ key: KEY }, 'nope'), makeEnv())).status).toBe(401);
    const noAuth = new Request('https://t/', { method: 'POST', body: '{}' });
    expect((await handleTranscribe(noAuth, makeEnv())).status).toBe(401);
  });

  it('405 on GET, 400 on bad key', async () => {
    expect((await handleTranscribe(req({}, SECRET, 'GET'), makeEnv())).status).toBe(405);
    expect((await handleTranscribe(req({ key: 'contas/x/files/a.webm' }), makeEnv())).status).toBe(400);
    expect((await handleTranscribe(req({ key: 'briefing-audio/../x' }), makeEnv())).status).toBe(400);
  });

  it('404 when the object is missing, 413 when too large', async () => {
    expect((await handleTranscribe(req({ key: KEY }), makeEnv({ object: null }))).status).toBe(404);
    const big = makeEnv();
    (big.MEDIA_BUCKET.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ size: 16 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) });
    expect((await handleTranscribe(req({ key: KEY }), big)).status).toBe(413);
  });

  it('200 with trimmed text and duration, calling whisper turbo in pt', async () => {
    const env = makeEnv();
    const res = await handleTranscribe(req({ key: KEY }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'olá mundo', duration: 2.5 });
    const [model, input] = (env.AI.run as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(model).toBe('@cf/openai/whisper-large-v3-turbo');
    expect(input.language).toBe('pt');
    expect(input.task).toBe('transcribe');
    expect(input.audio).toBe(btoa(String.fromCharCode(1, 2, 3)));
  });

  it('502 when the model throws', async () => {
    const env = makeEnv({ run: async () => { throw new Error('model down'); } });
    const res = await handleTranscribe(req({ key: KEY }), env);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'transcription failed' });
  });
});
```

- [ ] **Step 3: Rodar e confirmar falha**

```bash
cd workers/transcribe && npm install && npm test; cd -
```

- [ ] **Step 4: Implementar `src/index.ts`**

```ts
interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface Env {
  AI: AiBinding;
  MEDIA_BUCKET: R2Bucket;
  TRANSCRIBE_SECRET: string;
}

const MODEL = '@cf/openai/whisper-large-v3-turbo';
const KEY_PREFIX = 'briefing-audio/';
const MAX_BYTES = 15 * 1024 * 1024;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handleTranscribe(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const auth = request.headers.get('Authorization') ?? '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!env.TRANSCRIBE_SECRET || !presented || !timingSafeEqual(presented, env.TRANSCRIBE_SECRET)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let key = '';
  try {
    const body = (await request.json()) as { key?: unknown };
    key = typeof body.key === 'string' ? body.key : '';
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  if (!key.startsWith(KEY_PREFIX) || key.includes('..')) return json({ error: 'invalid key' }, 400);

  const object = await env.MEDIA_BUCKET.get(key);
  if (!object) return json({ error: 'not found' }, 404);
  if (object.size > MAX_BYTES) return json({ error: 'too large' }, 413);

  const bytes = new Uint8Array(await object.arrayBuffer());
  try {
    const out = (await env.AI.run(MODEL, {
      audio: toBase64(bytes),
      task: 'transcribe',
      language: 'pt',
    })) as { text?: unknown; transcription_info?: { duration?: unknown } };
    const text = typeof out.text === 'string' ? out.text.trim() : '';
    const duration =
      typeof out.transcription_info?.duration === 'number' ? out.transcription_info.duration : null;
    return json({ text, duration });
  } catch (e) {
    console.error('transcribe: model error', (e as Error).message);
    return json({ error: 'transcription failed' }, 502);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleTranscribe(request, env);
  },
};
```

- [ ] **Step 5: Rodar testes e typecheck**

```bash
cd workers/transcribe && npm run typecheck && npm test; cd -
```

- [ ] **Step 6: Spike com gravações reais (staging)**

```bash
cd workers/transcribe && npx wrangler login && npx wrangler secret put TRANSCRIBE_SECRET && npx wrangler deploy; cd -
```

Depois configure no Supabase de **staging** (`cat supabase/.temp/project-ref` para conferir o link; ver memória sobre project refs): `TRANSCRIBE_WORKER_URL=https://transcribe.<subdomínio>.workers.dev` e `TRANSCRIBE_SECRET` com o mesmo valor, e faça `npx supabase functions deploy hub-briefing --no-verify-jwt`. No Hub de staging, grave 10 s no Chrome (webm/opus) e no Safari (mp4). Anote no PR: texto voltou? `duration` veio? latência para um clipe de 5 min (deve ficar bem abaixo de 90 s). Se o mp4 do Safari falhar no Whisper, remova `audio/mp4` da preferência do gravador em `pickRecorderMime` e da allowlist, e registre no PR.

- [ ] **Step 7: Commit**

```bash
git add workers/transcribe
git commit -m "feat(workers): worker transcribe com Whisper turbo no Workers AI

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: CRM: edge function `briefing-audio`, serviço e player no HubTab

**Files:**
- Create: `supabase/functions/briefing-audio/index.ts`, `handler.ts`
- Create: `supabase/functions/__tests__/briefing-audio-fn_test.ts`
- Modify: `supabase/config.toml` (adicionar `[functions.briefing-audio] verify_jwt = false` ao lado de `ideia-media-manage`)
- Modify: `apps/crm/src/store/hub.ts:36-46`
- Create: `apps/crm/src/services/briefingAudio.ts`
- Create: `apps/crm/src/pages/cliente-detalhe/BriefingAudioPlayer.tsx`
- Modify: `apps/crm/src/pages/cliente-detalhe/HubTab.tsx:1238-1247`

**Interfaces:**
- Produces: `GET /briefing-audio?question_id=` (JWT do usuário) → `{ url, mime, duration_seconds, transcription_status, recorded_at }`; `fetchBriefingAudio(questionId)` no CRM; `HubBriefingQuestionRow` com os sete campos `audio_*` (nullable).

- [ ] **Step 1: Testes da edge function**

`supabase/functions/__tests__/briefing-audio-fn_test.ts`:

```ts
import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createBriefingAudioHandler } from "../briefing-audio/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });
const Q = "11111111-1111-1111-1111-111111111111";
const KEY = `briefing-audio/conta-1/${Q}/a.webm`;

// deno-lint-ignore no-explicit-any
function makeHandler(db: any) {
  return createBriefingAudioHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    signGetUrl: async (key: string) => `https://get.example.com/${key}`,
  });
}

function req(questionId: string | null, token: string | null = "jwt") {
  const url = new URL("https://example.test/briefing-audio");
  if (questionId) url.searchParams.set("question_id", questionId);
  return new Request(url.toString(), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

// deno-lint-ignore no-explicit-any
function setupAuth(db: any, member = true) {
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { active_workspace_id: "conta-1" }, error: null });
  db.queue("workspace_members", "select", { data: member ? { user_id: "user-1", role: "agent" } : null, error: null });
}

Deno.test("briefing-audio: 401 sem token, 403 sem membership, 400 sem question_id", async () => {
  const db = createSupabaseQueryMock();
  assertEquals((await makeHandler(db)(req(Q, null))).status, 401);
  const db2 = createSupabaseQueryMock();
  setupAuth(db2, false);
  assertEquals((await makeHandler(db2)(req(Q))).status, 403);
  const db3 = createSupabaseQueryMock();
  setupAuth(db3);
  assertEquals((await makeHandler(db3)(req(null))).status, 400);
});

Deno.test("briefing-audio: 404 sem áudio ou pergunta de outra workspace; 200 com url assinada", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("hub_briefing_questions", "select", { data: { audio_r2_key: null }, error: null });
  assertEquals((await makeHandler(db)(req(Q))).status, 404);

  const db2 = createSupabaseQueryMock();
  setupAuth(db2);
  db2.queue("hub_briefing_questions", "select", {
    data: {
      audio_r2_key: KEY, audio_mime: "audio/webm", audio_duration_seconds: 12,
      audio_transcription_status: "done", audio_recorded_at: "2026-09-03T00:00:00Z",
    },
    error: null,
  });
  const res = await makeHandler(db2)(req(Q));
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), {
    url: `https://get.example.com/${KEY}`, mime: "audio/webm", duration_seconds: 12,
    transcription_status: "done", recorded_at: "2026-09-03T00:00:00Z",
  });
  const sel = db2.calls.find((c) => c.table === "hub_briefing_questions");
  assertEquals(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "conta_id" && m.args[1] === "conta-1"), true);
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
npm run test:functions -- --filter "briefing-audio:"
```

- [ ] **Step 3: Implementar a function**

`supabase/functions/briefing-audio/handler.ts`:

```ts
import { createJsonResponder } from "../_shared/http.ts";
import { AUDIO_COLUMNS, buildAudioView, type AudioRow } from "../_shared/briefing-audio.ts";

interface Deps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  // deno-lint-ignore no-explicit-any
  createDb: () => any;
  signGetUrl: (key: string, expiresSeconds?: number) => Promise<string>;
}

export function createBriefingAudioHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const svc = deps.createDb();
    const { data: { user } = { user: null }, error: authErr } = await svc.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);
    // Tenant = workspace ATIVA + membership confirmada (padrão automation-media).
    const { data: profile } = await svc.from("profiles").select("active_workspace_id").eq("id", user.id).single();
    const contaId = profile?.active_workspace_id as string | undefined;
    if (!contaId) return json({ error: "Profile not found" }, 403);
    const { data: member } = await svc.from("workspace_members")
      .select("user_id, role").eq("workspace_id", contaId).eq("user_id", user.id).maybeSingle();
    if (!member) return json({ error: "Forbidden" }, 403);

    const questionId = new URL(req.url).searchParams.get("question_id");
    if (!questionId || questionId.length !== 36) return json({ error: "question_id required" }, 400);

    const { data: row } = await svc.from("hub_briefing_questions")
      .select(AUDIO_COLUMNS).eq("id", questionId).eq("conta_id", contaId).maybeSingle();
    const view = row ? await buildAudioView(row as AudioRow, (k) => deps.signGetUrl(k, 3600)) : null;
    if (!view) return json({ error: "Áudio não encontrado." }, 404);
    return json(view);
  };
}
```

`supabase/functions/briefing-audio/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { signGetUrl } from "../_shared/r2.ts";
import { createBriefingAudioHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createBriefingAudioHandler({
  buildCorsHeaders,
  createDb: () =>
    createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } }),
  signGetUrl,
}));
```

`supabase/config.toml`: após o bloco `[functions.ideia-media-manage]` adicione

```toml
[functions.briefing-audio]
verify_jwt = false
```

- [ ] **Step 4: Rodar e confirmar PASS**

```bash
npm run test:functions -- --filter "briefing-audio"
```

- [ ] **Step 5: CRM store, serviço e player**

`apps/crm/src/store/hub.ts`: em `HubBriefingQuestionRow` acrescente

```ts
  audio_r2_key?: string | null;
  audio_mime?: string | null;
  audio_size_bytes?: number | null;
  audio_duration_seconds?: number | null;
  audio_transcript?: string | null;
  audio_transcription_status?: 'pending' | 'done' | 'failed' | null;
  audio_recorded_at?: string | null;
```

`apps/crm/src/services/briefingAudio.ts`:

```ts
import { supabase } from '../lib/supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export interface CrmBriefingAudio {
  url: string;
  mime: string;
  duration_seconds: number | null;
  transcription_status: 'pending' | 'done' | 'failed' | null;
  recorded_at: string | null;
}

export async function fetchBriefingAudio(questionId: string): Promise<CrmBriefingAudio> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');
  const url = new URL(`${SUPABASE_URL}/functions/v1/briefing-audio`);
  url.searchParams.set('question_id', questionId);
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<CrmBriefingAudio>;
}
```

`apps/crm/src/pages/cliente-detalhe/BriefingAudioPlayer.tsx`:

```tsx
import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AudioPlayer } from '@mesaas/ui/AudioPlayer';
import { Badge } from '@/components/ui/badge';
import { fetchBriefingAudio } from '@/services/briefingAudio';
import type { HubBriefingQuestionRow } from '@/store/hub';

/** CRM tokens for the shared player: ink CTA button, subtle track. */
const CRM_AUDIO_VARS = {
  '--audio-btn-bg': 'var(--cta-bg)',
  '--audio-btn-fg': 'var(--cta-fg)',
  '--audio-track': 'var(--surface-2)',
  '--audio-fill': 'var(--text-main)',
} as CSSProperties;

const STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' }> = {
  done: { label: 'Transcrito', variant: 'success' },
  pending: { label: 'Transcrição pendente', variant: 'warning' },
  failed: { label: 'Falha na transcrição', variant: 'danger' },
};

export function BriefingAudioPlayer({ question }: { question: HubBriefingQuestionRow }) {
  const { data, isError } = useQuery({
    queryKey: ['briefing-audio-url', question.id, question.audio_r2_key],
    queryFn: () => fetchBriefingAudio(question.id),
    staleTime: 50 * 60 * 1000,
    enabled: !!question.audio_r2_key,
  });
  if (!question.audio_r2_key) return null;
  const status = question.audio_transcription_status ? STATUS[question.audio_transcription_status] : null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      {data ? (
        <AudioPlayer
          src={data.url}
          durationSeconds={question.audio_duration_seconds}
          label="Resposta em áudio"
          className="w-full max-w-[380px] text-foreground"
          style={CRM_AUDIO_VARS}
        />
      ) : isError ? (
        <span className="text-xs text-muted-foreground">Não foi possível carregar o áudio.</span>
      ) : (
        <span className="text-xs text-muted-foreground">Carregando áudio…</span>
      )}
      {status && (
        <Badge variant={status.variant} size="sm">
          {status.label}
        </Badge>
      )}
    </div>
  );
}
```

`HubTab.tsx`: importe `BriefingAudioPlayer` de `./BriefingAudioPlayer` e, no bloco que renderiza a resposta (`{q.answer ? (...) : (...)}`), logo após ele e dentro da mesma `<div className="flex-1 min-w-0">`, acrescente `<BriefingAudioPlayer question={q} />`.

- [ ] **Step 6: Typecheck, testes e verificação no browser**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npx vitest run apps/crm/src/pages/cliente-detalhe
npm run lint
```

Browser (CRM staging, `npm run dev:staging`, cliente de teste → aba Hub → Briefing): a pergunta com áudio mostra player, duração e badge. Tocar o áudio.

- [ ] **Step 7: Commit**

```bash
npm run format
git add supabase/functions/briefing-audio supabase/functions/__tests__/briefing-audio-fn_test.ts supabase/config.toml apps/crm/src/store/hub.ts apps/crm/src/services/briefingAudio.ts apps/crm/src/pages/cliente-detalhe
git commit -m "feat(crm): player do áudio do briefing com URL assinada

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Docs, verificação completa e PR

**Files:**
- Modify: `CLAUDE.md` (seção "Edge functions (Deno.env)")
- Modify: `README.md` (tabela de pastas e seção de deploy)

- [ ] **Step 1: Documentar**

Em `CLAUDE.md`, após a entrada `META_WEBHOOK_VERIFY_TOKEN`, adicione:

```markdown
- `TRANSCRIBE_WORKER_URL`, `TRANSCRIBE_SECRET` -- Worker Cloudflare `workers/transcribe`
  (Workers AI, Whisper turbo) que transcreve os áudios do briefing do Hub. Ambas
  opcionais, sem default: sem elas `hub-briefing` salva o áudio e marca a
  transcrição como `failed` (o cliente vê "Tentar novamente"). O segredo é o
  mesmo configurado no worker via `wrangler secret put TRANSCRIBE_SECRET`
```

Em `README.md`, na tabela de pastas, troque a linha do worker por:

```markdown
| `workers/media-proxy/`, `workers/transcribe/` | Cloudflare Workers (deploy manual com `wrangler deploy` dentro da pasta; testes com `npm test` lá) |
```

- [ ] **Step 2: Verificação completa**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json --noEmit
npm run lint
npm run format:check
npm run test
npm run test:functions
(cd workers/transcribe && npm run typecheck && npm test)
git checkout deno.lock
git ls-tree --name-only origin/main:supabase/migrations | tail -1
```

Se a última linha for maior que `20260907000001`, renomeie a migration para um prefixo acima e ajuste o nome no commit.

- [ ] **Step 3: Commit e PR**

```bash
git add CLAUDE.md README.md
git commit -m "docs(briefing): env vars do worker de transcrição

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin claude/audio-recording-briefing-4802d8
gh pr create --title "feat(briefing): resposta por áudio no Hub com transcrição Whisper" --body-file - <<'EOF'
## O que muda
- Cliente grava um áudio por pergunta do briefing no Hub; áudio vai para o R2 (`briefing-audio/…`) e é transcrito por Whisper turbo (Cloudflare Workers AI). A transcrição é anexada ao texto da resposta.
- CRM mostra player + status na aba Hub → Briefing.
- Novo worker `workers/transcribe` (deploy manual) e nova edge function `briefing-audio`.

## Rollout (nesta ordem, ANTES do merge)
1. `npx supabase db push --linked` (migration `20260907000001_briefing_audio.sql`)
2. `cd workers/transcribe && wrangler deploy && wrangler secret put TRANSCRIBE_SECRET`
3. Secrets no Supabase: `TRANSCRIBE_WORKER_URL`, `TRANSCRIBE_SECRET`
4. `npx supabase functions deploy hub-briefing --no-verify-jwt` e `npx supabase functions deploy briefing-audio --no-verify-jwt`
5. Merge (Vercel publica o frontend)

## Notas
- `hub-briefing` agora usa `makeBoundedFetch()` (teto de 20 s) também no GET/POST antigos.
- Uploads abandonados em `briefing-audio/` não são varridos pelo cron de órfãos (só olha `contas/`). Follow-up.
- Spike Whisper: (preencher com resultado do Chrome/Safari e latência de 5 min)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Depois do PR: rodar a review externa do Codex (padrão do repo) e tratar os findings.

---

## Self-review

- **Cobertura do spec:** áudio por pergunta (T5), um por pergunta com substituição (T1 RPC + T5), anexar ao final (T2 `appendTranscript`), Whisper no Workers AI sem limite por plano (T6, nenhum medidor), prefixo fora de `contas/` (T1/T2), transcrição síncrona com 90 s e fallback `failed` + retry (T2/T3/T5), 5 min/15 MB (T2/T4/T5/T6), erros visíveis no Hub (T5), player próprio compartilhado (T5) usado no Hub (T6) e CRM (T8), env vars opcionais (T3/T9), rate limit próprio (T3), guarda de colunas (T1), rollout (T9).
- **Placeholders:** nenhum "TBD"; os pontos abertos (mp4 no Safari, latência) são medidos no spike da T6 com ação definida.
- **Consistência de tipos:** `AudioView`/`BriefingAudio` têm os mesmos cinco campos em Deno, Hub e CRM; `finalize`/`transcribe` devolvem `{ ok, answer, transcript, audio }` nos três lugares; rotas de `api.ts` batem com o roteamento de T3; `putToR2(url, blob, contentType)` é a única assinatura usada.
