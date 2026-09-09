-- Preserve the post link identity and both files when saving a media adjustment.
-- Deploy before the post-media-manage replacement route. Rollback: drop only
-- post_file_link_replace(uuid,uuid,bigint,bigint,text); retain the count trigger.

CREATE OR REPLACE FUNCTION public.file_update_reference_count() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE files SET reference_count = reference_count + 1 WHERE id = NEW.file_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE files SET reference_count = GREATEST(0, reference_count - 1) WHERE id = OLD.file_id;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.file_id IS DISTINCT FROM OLD.file_id THEN
      -- Deterministic ordering also covers two concurrent replacements sharing files.
      PERFORM id FROM files WHERE id IN (OLD.file_id, NEW.file_id) ORDER BY id FOR UPDATE;
      UPDATE files SET reference_count = GREATEST(0, reference_count - 1) WHERE id = OLD.file_id;
      UPDATE files SET reference_count = reference_count + 1 WHERE id = NEW.file_id;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_file_ref_count_upd ON public.post_file_links;
CREATE TRIGGER trg_file_ref_count_upd
  AFTER UPDATE OF file_id ON public.post_file_links
  FOR EACH ROW EXECUTE FUNCTION public.file_update_reference_count();

CREATE OR REPLACE FUNCTION public.post_file_link_replace(
  p_conta_id uuid,
  p_user_id uuid,
  p_link_id bigint,
  p_file_id bigint,
  p_expected_r2_key text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_post_id bigint;
  v_post public.workflow_posts%ROWTYPE;
  v_link public.post_file_links%ROWTYPE;
  v_source public.files%ROWTYPE;
  v_target public.files%ROWTYPE;
BEGIN
  -- p_user_id is the validated JWT subject supplied by the service-role handler.
  -- Recheck both selectors and membership under locks, preventing revocation or
  -- workspace switching between the handler's authentication and the actual swap.
  PERFORM p.id FROM public.profiles p
    JOIN public.workspace_members m ON m.user_id = p.id AND m.workspace_id = p_conta_id
    WHERE p.id = p_user_id AND p.active_workspace_id = p_conta_id
    FOR SHARE OF p, m;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'workspace_unavailable';
  END IF;
  IF p_link_id IS NULL OR p_link_id <= 0 OR p_file_id IS NULL OR p_file_id <= 0 OR
     p_expected_r2_key IS NULL OR btrim(p_expected_r2_key) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0400', MESSAGE = 'invalid_replacement';
  END IF;

  SELECT post_id INTO v_post_id FROM public.post_file_links
    WHERE id = p_link_id AND conta_id = p_conta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'media_not_found';
  END IF;
  -- Publishers claim/lock this same row before reading media. Serialize with them.
  SELECT * INTO v_post FROM public.workflow_posts
    WHERE id = v_post_id AND conta_id = p_conta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'media_not_found';
  END IF;
  SELECT * INTO v_link FROM public.post_file_links
    WHERE id = p_link_id AND post_id = v_post_id AND conta_id = p_conta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'media_not_found';
  END IF;

  PERFORM id FROM public.files WHERE id IN (v_link.file_id, p_file_id) ORDER BY id FOR UPDATE;
  SELECT * INTO v_source FROM public.files WHERE id = v_link.file_id AND conta_id = p_conta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'media_not_found';
  END IF;
  SELECT * INTO v_target FROM public.files WHERE id = p_file_id AND conta_id = p_conta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'media_not_found';
  END IF;
  IF v_source.media_lost_at IS NOT NULL OR v_target.media_lost_at IS NOT NULL OR
     v_source.kind NOT IN ('image', 'video') OR v_source.kind <> v_target.kind OR
     v_target.r2_key NOT LIKE 'contas/' || p_conta_id::text || '/files/%' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0400', MESSAGE = 'invalid_replacement';
  END IF;

  -- An uncertain response may be retried after the transaction already committed,
  -- even if the post has since been scheduled. This branch never changes any row.
  IF v_link.file_id = p_file_id THEN RETURN true; END IF;

  IF v_post.status IN ('agendado', 'postado') OR v_post.published_at IS NOT NULL OR
     v_post.instagram_media_id IS NOT NULL OR v_post.publish_processing_at IS NOT NULL OR
     v_post.tiktok_publish_processing_at IS NOT NULL OR
     v_post.tiktok_publish_status IN ('initiated', 'processing', 'published') OR
     v_post.instagram_container_id IS NOT NULL OR v_post.story_segments IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0409', MESSAGE = 'post_not_editable';
  END IF;
  IF v_source.r2_key IS DISTINCT FROM p_expected_r2_key THEN
    RAISE EXCEPTION USING ERRCODE = 'P0409', MESSAGE = 'source_changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.post_file_links WHERE post_id = v_post_id AND file_id = p_file_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0409', MESSAGE = 'target_already_linked';
  END IF;

  -- Only file_id changes. Cover, ordering and link identity stay intact, while the
  -- UPDATE trigger transfers the reference count. Never garbage-collect the source.
  UPDATE public.post_file_links SET file_id = p_file_id WHERE id = p_link_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.post_file_link_replace(uuid, uuid, bigint, bigint, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_file_link_replace(uuid, uuid, bigint, bigint, text)
  TO service_role;
