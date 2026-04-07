-- Extend workflow_posts status check to include 'agendado' and 'postado'
-- These values are used by the post calendar scheduling flow.

ALTER TABLE workflow_posts
  DROP CONSTRAINT IF EXISTS workflow_posts_status_check;

ALTER TABLE workflow_posts
  ADD CONSTRAINT workflow_posts_status_check
  CHECK (status IN (
    'rascunho',
    'revisao_interna',
    'aprovado_interno',
    'enviado_cliente',
    'aprovado_cliente',
    'correcao_cliente',
    'agendado',
    'postado'
  ));
