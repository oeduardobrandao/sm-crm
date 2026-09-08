-- kb-images recebe uploads diretos por URL assinada (mcp-admin upload_kb_image modo B), onde
-- o servidor não vê os bytes. O Storage impõe tipo e tamanho por bucket.
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
       file_size_limit = 10485760
 WHERE id = 'kb-images';
