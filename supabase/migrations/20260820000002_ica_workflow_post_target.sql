-- Alvo "post em producao": a automacao de comentario -> DM passa a poder
-- apontar para um workflow_posts ainda NAO publicado, e o vinculo com o media
-- ID real do Instagram e feito sozinho quando o post publica (triggers na
-- migration 20260820000003).
--
-- Estados representaveis depois desta migration:
--
--   Todos os posts   ig_media_id NULL  workflow_post_id NULL  tombstone NULL
--   Especifico pub.  ig_media_id set   workflow_post_id NULL  tombstone NULL
--   Pendente         ig_media_id NULL  workflow_post_id set   tombstone NULL
--   Ligado           ig_media_id set   workflow_post_id set   tombstone NULL
--   Tombstone        ig_media_id NULL  workflow_post_id NULL  tombstone set
--                    (post excluido antes de publicar; ativo=false forcado)

-- Par exportado para a FK composta tenant-safe abaixo (mesmo padrao de
-- clientes_id_conta_uq, 20260815000002). workflow_posts.id ja e PK; o par
-- (id, conta_id) amarra o ponteiro ao workspace estruturalmente, nao so via RLS.
ALTER TABLE workflow_posts ADD CONSTRAINT workflow_posts_id_conta_uq UNIQUE (id, conta_id);

ALTER TABLE instagram_comment_automations
  ADD COLUMN workflow_post_id bigint,
  ADD COLUMN pending_post_deleted_at timestamptz;

-- Review externo (Codex P2): a migration 20260820000001 repara ig_media_id
-- uuid via join com instagram_posts, mas o disconnect do Instagram APAGA as
-- linhas de instagram_posts (instagram-integration/index.ts:929) -- automacoes
-- de cliente desconectado ficam com uuid irreparavel e nunca casariam no
-- webhook. Marca essas sobras com o estado tombstone novo: desativadas e sem
-- alvo, forcando o usuario a reescolher na UI (mesmo fluxo de post excluido).
-- media_caption fica preservada para o usuario reconhecer a automacao.
UPDATE instagram_comment_automations
   SET ativo = false,
       pending_post_deleted_at = now(),
       ig_media_id = NULL,
       media_permalink = NULL
 WHERE ig_media_id ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$';

-- ON DELETE SET NULL (workflow_post_id): apagar o post NAO pode apagar a
-- automacao nem zerar o conta_id (precedente de SET NULL por coluna em
-- 20260730000009_ideias_solicitacoes.sql:14). O caso "pendente" e capturado
-- antes, pelo trigger workflow_posts_z4, que grava o tombstone.
ALTER TABLE instagram_comment_automations
  ADD CONSTRAINT ica_workflow_post_same_tenant
    FOREIGN KEY (workflow_post_id, conta_id)
    REFERENCES workflow_posts (id, conta_id)
    ON DELETE SET NULL (workflow_post_id);

-- Tombstone e estado terminal ate o usuario escolher um alvo novo: reativar
-- sem reescolher deixaria uma automacao "todos os posts" que ninguem pediu.
ALTER TABLE instagram_comment_automations
  ADD CONSTRAINT ica_tombstone_inactive
    CHECK (NOT (ativo AND pending_post_deleted_at IS NOT NULL));

CREATE INDEX idx_ica_workflow_post ON instagram_comment_automations (workflow_post_id)
  WHERE workflow_post_id IS NOT NULL;
