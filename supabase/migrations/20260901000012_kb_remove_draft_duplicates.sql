-- Remove os 9 rascunhos criados via admin em 2026-08-24 que cobrem os MESMOS
-- topicos dos artigos novos seedados por 20260831000010, com slugs e
-- categorias diferentes -- deixa-los viraria duplicata dormente no admin.
--
-- Guardas deliberadas: lista explicita de slugs, status = 'draft' E corte
-- temporal no dia da criacao verificada (2026-08-24, conferido no banco):
-- um rascunho FUTURO que por acaso reutilize um destes slugs nao e tocado, e
-- um artigo desta lista que tenha sido publicado tambem nao (o upsert
-- canonico nao usa nenhum destes slugs, entao nao ha risco de apagar o
-- conteudo novo). kb_context_links cascateia via FK (ON DELETE CASCADE).

DELETE FROM kb_articles
WHERE status = 'draft'
  AND created_at < '2026-08-25'
  AND slug IN (
    'relatorio-de-blocos-como-montar',
    'relatorio-de-blocos-temas-fontes-exportacao-pdf',
    'assinatura-anual-parcelada-12x',
    'como-trocar-plano-mensal-anual-12x',
    'mensagens-feed-consolidado-cliente',
    'tarefas-gerenciando-backlog-equipe',
    'automacoes-comentario-instagram-dm-automatica',
    'entendendo-indicadores-uso-plano',
    'configurando-notificacoes-por-email'
  );
