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
-- membros_id_conta_uq já existe desde 20260918000002 (post_processes_schema);
-- não recriar aqui.
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
