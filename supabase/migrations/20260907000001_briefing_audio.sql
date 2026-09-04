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

CREATE OR REPLACE FUNCTION public.briefing_audio_release(p_conta_id uuid, p_cliente_id bigint, p_question_id uuid)
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
  -- Mesmo escopo do finalize: conta + cliente (defesa em profundidade; o
  -- token do hub é de UM cliente e question_id vem da URL).
  SELECT audio_r2_key INTO v_prev
    FROM hub_briefing_questions
   WHERE id = p_question_id AND conta_id = p_conta_id AND cliente_id = p_cliente_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'question_not_found' USING ERRCODE = 'P0001';
  END IF;
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

-- Append da transcrição: UPDATE atômico, feito INTEIRO no banco.
-- Antes isso era um compare-and-swap no cliente (.eq("answer", <valor lido>)
-- + laço de retry). O supabase-js manda .eq() na query string, então uma
-- resposta longa — segunda gravação numa pergunta que já carrega uma
-- transcrição — estourava o limite da request-line: 500, transcrição perdida
-- e linha travada em 'pending'. Aqui o append e a condição vivem na mesma
-- instrução, sem nada do texto antigo passar pela URL.
--
-- Separador igual ao de appendTranscript (_shared/briefing-audio.ts):
-- answer.trimEnd() + "\n\n" + text.trim(), e answer só de espaços conta como
-- vazia. rtrim/btrim precisam do conjunto explícito de brancos porque o
-- padrão do Postgres corta apenas espaço — não \n, que é justamente o caso
-- de 'Antes.\n' virar 'Antes.\n\nDepois'.
--
-- Devolve NULL (linha composta toda nula) quando nada casou: já 'done',
-- pergunta sem áudio, ou cliente/conta errados.
CREATE OR REPLACE FUNCTION public.briefing_audio_apply_transcript(
  p_conta_id uuid, p_cliente_id bigint, p_question_id uuid, p_text text, p_duration int
) RETURNS hub_briefing_questions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws constant text := E' \t\n\r\f\v';
  v_text text := btrim(p_text, v_ws);
  v_row hub_briefing_questions;
BEGIN
  -- Defensivo: texto vazio nunca deve zerar a resposta que já está lá.
  IF v_text = '' OR v_text IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE hub_briefing_questions
     SET answer = CASE
                    WHEN coalesce(btrim(answer, v_ws), '') = '' THEN v_text
                    ELSE rtrim(answer, v_ws) || E'\n\n' || v_text
                  END,
         audio_transcript = v_text,
         audio_transcription_status = 'done',
         audio_duration_seconds = coalesce(audio_duration_seconds, p_duration)
   WHERE id = p_question_id
     AND conta_id = p_conta_id
     AND cliente_id = p_cliente_id
     AND audio_r2_key IS NOT NULL
     AND audio_transcription_status IS DISTINCT FROM 'done'
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.briefing_audio_finalize(uuid, bigint, uuid, text, bigint, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.briefing_audio_finalize(uuid, bigint, uuid, text, bigint, text, int) TO service_role;
REVOKE ALL ON FUNCTION public.briefing_audio_release(uuid, bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.briefing_audio_release(uuid, bigint, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.briefing_audio_apply_transcript(uuid, bigint, uuid, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.briefing_audio_apply_transcript(uuid, bigint, uuid, text, int) TO service_role;
