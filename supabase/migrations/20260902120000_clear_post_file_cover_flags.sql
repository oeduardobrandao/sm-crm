-- A capa de um post agora é derivada: primeira mídia por sort_order.
-- (A UI de "definir como capa" foi removida; todos os leitores — CRM covers,
-- Hub, MCP — já usam a regra "is_cover se existir, senão a primeira".)
-- Limpa as flags legadas para que nenhum post fique preso a uma capa que a UI
-- não consegue mais alterar. Seguro em um único UPDATE: o índice parcial
-- post_file_links_one_cover só indexa linhas true, e aqui só escrevemos false.
update post_file_links set is_cover = false where is_cover = true;
