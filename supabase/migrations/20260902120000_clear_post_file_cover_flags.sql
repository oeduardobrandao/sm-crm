-- A capa de um post agora é derivada: a mídia com is_cover se existir (apenas
-- via RPC post_file_link_set_cover, ex.: MCP), senão a primeira por sort_order.
-- Todos os leitores (post-media-manage nos três branches, hub-posts, MCP e a
-- galeria do CRM) aplicam essa resolução.
--
-- 1) Remove os triggers que mantinham o modelo antigo de flag manual:
--    - auto_cover flagava o próximo insert quando o post não tinha capa; depois
--      da limpeza abaixo, ele flagaria a mídia recém-anexada (a última da
--      ordem), e o flag venceria a regra da primeira. Reordenar não corrigiria.
--    - reassign_cover repassava o flag ao deletar a capa flagada, mantendo o
--      flag vivo indefinidamente.
drop trigger if exists trg_post_file_link_auto_cover on post_file_links;
drop function if exists post_file_link_auto_cover();
drop trigger if exists trg_post_file_link_reassign_cover on post_file_links;
drop function if exists post_file_link_reassign_cover();

-- 2) Limpa as flags legadas. Seguro em um único UPDATE: o índice parcial
--    post_file_links_one_cover só indexa linhas true, e aqui só escrevemos false.
--
-- Ordem de deploy: publique a function post-media-manage (fallback por ordem no
-- branch de workflow_ids) ANTES de rodar "supabase db push", senão as thumbnails
-- dos boards ficam em branco até o deploy.
update post_file_links set is_cover = false where is_cover = true;
