-- Capa do TikTok segue a miniatura do vídeo
-- (spec docs/superpowers/specs/2026-10-30-tiktok-cover-follows-thumbnail-design.md).
--
-- files.thumbnail_frame_ms: the moment of the video (ms) the current thumbnail was taken from.
-- NULL = the thumbnail is not a frame of the video (uploaded image, Estúdio cover) or nobody
-- knows (rows from before this column). The TikTok publishers send it as
-- post_info.video_cover_timestamp_ms, since TikTok only accepts a frame offset as the cover.
--
-- No backfill: an old row may hold the 0.5 s auto frame or a frame the user picked, and
-- there is no way to tell which.

ALTER TABLE public.files
  ADD COLUMN thumbnail_frame_ms integer
  CONSTRAINT files_thumbnail_frame_ms_nonnegative
    CHECK (thumbnail_frame_ms IS NULL OR thumbnail_frame_ms >= 0);

COMMENT ON COLUMN public.files.thumbnail_frame_ms IS
  'Moment of the video (ms) the current thumbnail was captured from; NULL when the thumbnail is not a video frame or is unknown. Cleared by trg_files_thumbnail_frame_reset whenever thumbnail_r2_key changes.';

-- Any write that swaps the thumbnail without knowing the frame (Estúdio's
-- finalize_design_render, post-media-backfill-thumbnails, future paths) must not leave the
-- old frame behind, or TikTok would publish a cover that no longer matches the thumbnail.
-- So changing thumbnail_r2_key always clears the frame. Writers that do know it set
-- thumbnail_frame_ms in a FOLLOWING update, which leaves thumbnail_r2_key alone and so never
-- fires this trigger. (One combined update cannot work: the trigger could not tell "new frame
-- given" from "same frame as before" when the user re-captures at the same millisecond.)
CREATE OR REPLACE FUNCTION public.files_thumbnail_frame_reset()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.thumbnail_r2_key IS DISTINCT FROM OLD.thumbnail_r2_key THEN
    NEW.thumbnail_frame_ms := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_files_thumbnail_frame_reset
  BEFORE UPDATE OF thumbnail_r2_key ON public.files
  FOR EACH ROW
  EXECUTE FUNCTION public.files_thumbnail_frame_reset();
