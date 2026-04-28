-- Move files linked to posts into their auto-created post folders.
-- The file_system_triggers migration auto-creates a folder per post
-- (source_type='post', source_id=post_id), but uploadPostMedia was
-- not passing folder_id, so files ended up with folder_id = NULL.

UPDATE files f
SET folder_id = pf.id
FROM post_file_links pfl
JOIN folders pf
  ON pf.source_type = 'post'
 AND pf.source_id = pfl.post_id
 AND pf.conta_id = pfl.conta_id
WHERE f.id = pfl.file_id
  AND (f.folder_id IS NULL OR f.folder_id != pf.id);
