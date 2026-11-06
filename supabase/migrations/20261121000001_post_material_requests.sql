-- supabase/migrations/20261121000001_post_material_requests.sql
-- Posts aguardando material (spec
-- docs/superpowers/specs/2026-11-06-posts-aguardando-material-design.md).
--
-- 1. post_material_requests / post_material_items (tabelas, chaves, CHECKs, triggers, ACL)
-- 2. post_references.material_item_id (FK composta, índice)
-- (as seções seguintes, RPCs, entram nas próximas tarefas)

-- =====================================================================
-- 1. tabelas
-- =====================================================================
CREATE TABLE post_material_requests (
  id         bigserial PRIMARY KEY,
  post_id    bigint NOT NULL,
  conta_id   uuid   NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status     text   NOT NULL CHECK (status IN ('aberto', 'concluido', 'cancelado')),
  closed_by  text   CHECK (closed_by IN ('auto', 'client', 'team', 'system')),
  closed_at  timestamptz,
  -- Nulo de propósito: excluir o usuário não pode travar. Reescrito, junto com
  -- opened_at, a cada reabertura.
  opened_by  uuid   REFERENCES auth.users(id) ON DELETE SET NULL,
  opened_at  timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_material_requests_post_fk
    FOREIGN KEY (post_id, conta_id) REFERENCES workflow_posts(id, conta_id) ON DELETE CASCADE,
  CONSTRAINT post_material_requests_post_uq UNIQUE (post_id),
  -- alvo da FK composta dos itens
  CONSTRAINT post_material_requests_id_post_conta_uq UNIQUE (id, post_id, conta_id),
  -- closed_by e closed_at são nulos se e somente se o pedido está aberto
  CONSTRAINT post_material_requests_closed_state CHECK (
    (status = 'aberto' AND closed_by IS NULL AND closed_at IS NULL) OR
    (status <> 'aberto' AND closed_by IS NOT NULL AND closed_at IS NOT NULL))
);

CREATE INDEX post_material_requests_conta_status_idx
  ON post_material_requests (conta_id, status);

CREATE TABLE post_material_items (
  id         bigserial PRIMARY KEY,
  request_id bigint NOT NULL,
  post_id    bigint NOT NULL,
  conta_id   uuid   NOT NULL,
  label      text   NOT NULL
    CONSTRAINT post_material_items_label_len CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
  detail     text
    CONSTRAINT post_material_items_detail_len CHECK (detail IS NULL OR char_length(detail) <= 300),
  position   int    NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- post_id e conta_id denormalizados, presos ao pedido pela FK composta
  CONSTRAINT post_material_items_request_fk
    FOREIGN KEY (request_id, post_id, conta_id)
    REFERENCES post_material_requests(id, post_id, conta_id) ON DELETE CASCADE,
  -- alvo da FK composta de post_references
  CONSTRAINT post_material_items_id_post_conta_uq UNIQUE (id, post_id, conta_id)
);

CREATE INDEX post_material_items_request_pos_idx
  ON post_material_items (request_id, position);
-- conta_id e post_id: cascatas de workspace e de post
CREATE INDEX post_material_items_post_idx ON post_material_items (post_id);
CREATE INDEX post_material_items_conta_idx ON post_material_items (conta_id);
CREATE INDEX post_material_requests_conta_idx ON post_material_requests (conta_id);

-- updated_at
CREATE OR REPLACE FUNCTION set_post_material_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION set_post_material_updated_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER post_material_requests_updated_at
  BEFORE UPDATE ON post_material_requests
  FOR EACH ROW EXECUTE FUNCTION set_post_material_updated_at();
CREATE TRIGGER post_material_items_updated_at
  BEFORE UPDATE ON post_material_items
  FOR EACH ROW EXECUTE FUNCTION set_post_material_updated_at();

-- Só service role: RLS ligada, sem policy, sem grant para os papéis de cliente.
-- Toda leitura e escrita passa pelas edge functions (que aplicam o escopo).
ALTER TABLE post_material_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_material_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON post_material_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON post_material_items FROM PUBLIC, anon, authenticated;
GRANT ALL ON post_material_requests TO service_role;
GRANT ALL ON post_material_items TO service_role;

REVOKE ALL ON SEQUENCE post_material_requests_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE post_material_items_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE post_material_requests_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE post_material_items_id_seq TO service_role;

-- =====================================================================
-- 2. post_references.material_item_id
-- =====================================================================
ALTER TABLE post_references ADD COLUMN material_item_id bigint;

-- Postgres 15+: a lista de colunas zera só material_item_id ao apagar o item,
-- nunca post_id nem conta_id (que são NOT NULL).
ALTER TABLE post_references ADD CONSTRAINT post_references_material_item_fk
  FOREIGN KEY (material_item_id, post_id, conta_id)
  REFERENCES post_material_items(id, post_id, conta_id)
  ON DELETE SET NULL (material_item_id);

CREATE INDEX post_references_material_item_idx
  ON post_references (material_item_id) WHERE material_item_id IS NOT NULL;

COMMENT ON COLUMN post_references.material_item_id IS
  'Item do pedido de material a que este arquivo ou link responde. Apagar o item mantém a referência (material_item_id vira nulo).';
