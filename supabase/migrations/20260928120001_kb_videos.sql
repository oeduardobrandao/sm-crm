-- Tutoriais em vídeo da Central de Ajuda (spec 2026-09-28-ajuda-video-playlist-design).
-- Séries e vídeos são conteúdo da plataforma (como kb_articles): escritos só pelo service role
-- via platform-admin; authenticated lê o que está publicado. kb_videos.id é bigint porque o
-- orphan reap do post-media-cleanup-cron pagina os uids conhecidos por um cursor numérico.

CREATE TABLE IF NOT EXISTS kb_video_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  display_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kb_video_series_status_check CHECK (status IN ('draft', 'published')),
  CONSTRAINT kb_video_series_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE TABLE IF NOT EXISTS kb_videos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  series_id uuid NOT NULL REFERENCES kb_video_series(id) ON DELETE RESTRICT,
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  article_id uuid REFERENCES kb_articles(id) ON DELETE SET NULL,
  display_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  stream_uid text UNIQUE,
  stream_upload_expires_at timestamptz,
  stream_status text NOT NULL DEFAULT 'pending',
  duration_seconds numeric,
  hls_url text,
  thumbnail_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kb_videos_status_check CHECK (status IN ('draft', 'published')),
  CONSTRAINT kb_videos_stream_status_check CHECK (stream_status IN ('pending', 'ready', 'error')),
  CONSTRAINT kb_videos_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT kb_videos_ready_has_hls CHECK (stream_status <> 'ready' OR hls_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS kb_videos_series_order ON kb_videos (series_id, display_order);

CREATE TABLE IF NOT EXISTS kb_video_progress (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id bigint NOT NULL REFERENCES kb_videos(id) ON DELETE CASCADE,
  position_seconds numeric NOT NULL DEFAULT 0,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, video_id)
);

-- Reusa o trigger genérico de updated_at criado para kb_articles (20260519000001).
CREATE TRIGGER kb_video_series_updated_at
  BEFORE UPDATE ON kb_video_series
  FOR EACH ROW EXECUTE FUNCTION update_kb_articles_updated_at();
CREATE TRIGGER kb_videos_updated_at
  BEFORE UPDATE ON kb_videos
  FOR EACH ROW EXECUTE FUNCTION update_kb_articles_updated_at();

ALTER TABLE kb_video_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_video_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read published video series"
  ON kb_video_series FOR SELECT TO authenticated
  USING (status = 'published');

CREATE POLICY "Authenticated users can read published ready videos"
  ON kb_videos FOR SELECT TO authenticated
  USING (
    status = 'published'
    AND stream_status = 'ready'
    AND EXISTS (
      SELECT 1 FROM kb_video_series s
      WHERE s.id = kb_videos.series_id AND s.status = 'published'
    )
  );

CREATE POLICY "Users read own video progress"
  ON kb_video_progress FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Users insert own video progress"
  ON kb_video_progress FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own video progress"
  ON kb_video_progress FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT ON kb_video_series, kb_videos TO authenticated;
GRANT SELECT, INSERT, UPDATE ON kb_video_progress TO authenticated;

-- Grava a posição de um vídeo para o usuário atual. SECURITY INVOKER: a RLS de kb_videos
-- decide se o vídeo é visível (invisível = no_data_found) e a de kb_video_progress garante
-- que só a própria linha é escrita. completed_at é preservado atomicamente (coalesce),
-- então saves fora de ordem nunca "desconcluem" um vídeo. A posição é última-gravação-vence
-- de propósito: o usuário pode voltar no vídeo e retomar dali.
CREATE OR REPLACE FUNCTION public.save_kb_video_progress(
  p_video_id bigint,
  p_position numeric,
  p_completed boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_duration numeric;
  v_found boolean;
  v_position numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT duration_seconds, true INTO v_duration, v_found FROM kb_videos WHERE id = p_video_id;
  IF v_found IS NULL THEN
    RAISE EXCEPTION 'video not found' USING ERRCODE = 'P0002';
  END IF;

  v_position := greatest(0, coalesce(p_position, 0));
  IF v_duration IS NOT NULL THEN
    v_position := least(v_position, v_duration);
  END IF;

  INSERT INTO kb_video_progress (user_id, video_id, position_seconds, completed_at, updated_at)
  VALUES (v_uid, p_video_id, v_position, CASE WHEN p_completed THEN now() END, now())
  ON CONFLICT (user_id, video_id) DO UPDATE SET
    position_seconds = excluded.position_seconds,
    completed_at = coalesce(kb_video_progress.completed_at, excluded.completed_at),
    updated_at = now();
END;
$$;

-- Supabase concede funções novas direto a anon/authenticated/service_role: REVOKE FROM PUBLIC
-- sozinho não basta, então todos os papéis são enumerados.
REVOKE ALL ON FUNCTION public.save_kb_video_progress(bigint, numeric, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_kb_video_progress(bigint, numeric, boolean)
  TO authenticated;
