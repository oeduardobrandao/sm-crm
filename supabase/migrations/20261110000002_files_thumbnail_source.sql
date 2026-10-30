-- Estado da capa do vídeo (follow-up of 20261110000001; spec
-- docs/superpowers/specs/2026-10-30-tiktok-cover-follows-thumbnail-design.md).
--
-- files.thumbnail_source: where the current thumbnail came from, so the CRM can tell people
-- whether a video still has its default cover or one they chose:
--   'auto'  = the frame generated at upload (or by an edit that regenerates it)
--   'frame' = a frame the user picked ("Usar este frame")
--   'image' = an image (uploaded in the editor, "Usar como capa do Reel", Estúdio cover)
--   NULL    = unknown (rows from before this column)
-- thumbnail_frame_ms alone cannot tell this: the auto frame and a frame picked at the same
-- millisecond look the same.
--
-- No backfill, for the same reason as thumbnail_frame_ms: an old row may hold the auto frame
-- or a cover the user picked.

ALTER TABLE public.files
  ADD COLUMN thumbnail_source text
    CONSTRAINT files_thumbnail_source_valid
      CHECK (thumbnail_source IS NULL OR thumbnail_source IN ('auto', 'frame', 'image'));

COMMENT ON COLUMN public.files.thumbnail_source IS
  'Origin of the current thumbnail: auto (generated frame), frame (user-picked frame), image; NULL = unknown. Set to image by trg_files_thumbnail_frame_reset whenever thumbnail_r2_key changes.';

-- Same trigger as 20261110000001, now also resetting the source. A thumbnail swapped by a
-- writer that says nothing (Estúdio's finalize_design_render, "Usar como capa do Reel",
-- post-media-backfill-thumbnails) has no frame, and the only kind of thumbnail without a frame
-- is an image. Writers that know better (a picked frame) set thumbnail_frame_ms and
-- thumbnail_source in a FOLLOWING update, which leaves thumbnail_r2_key alone and so never
-- fires the trigger.
CREATE OR REPLACE FUNCTION public.files_thumbnail_frame_reset()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.thumbnail_r2_key IS DISTINCT FROM OLD.thumbnail_r2_key THEN
    NEW.thumbnail_frame_ms := NULL;
    NEW.thumbnail_source := CASE WHEN NEW.thumbnail_r2_key IS NULL THEN NULL ELSE 'image' END;
  END IF;
  RETURN NEW;
END;
$$;
