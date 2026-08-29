-- Posts avulsos (fora de fluxo): fundacao. Adiciona cliente_id a workflow_posts
-- e torna workflow_id opcional, para que um post exista sem estar preso a um
-- fluxo. Task 1 do plano .superpowers/sdd/2026-08-29-posts-avulsos-plan.
--
-- Invariantes que esta migration estabelece (consumidas pelas tasks seguintes):
--   - cliente_id sempre presente; quando workflow_id NOT NULL, cliente_id
--     sempre igual ao cliente do workflow (nunca diverge).
--   - Trocar workflow_id ou cliente_id de um post existente fora do caminho
--     sancionado (RPC dedicada, tasks futuras) e bloqueado.

-- 1) Coluna nova (nullable por enquanto, para permitir o backfill abaixo).
ALTER TABLE workflow_posts ADD COLUMN cliente_id bigint;

-- 2) Backfill: todo post hoje pertence a um workflow, entao cliente_id vem do
-- workflow apontado.
-- Suprime workflow_posts_updated_at (20260402_workflow_posts.sql) so para este
-- UPDATE: e um BEFORE UPDATE incondicional que grava NEW.updated_at = now(), e
-- sem a supressao o backfill carimbaria todo post historico como recem-editado,
-- corrompendo ordenacao por recencia e semantica de auditoria. Precedente:
-- 20260425000003_file_system_backfill.sql (DISABLE/ENABLE TRIGGER ao redor de
-- um backfill em massa, mesma transacao que ja detem a tabela).
ALTER TABLE workflow_posts DISABLE TRIGGER workflow_posts_updated_at;
UPDATE workflow_posts wp
   SET cliente_id = w.cliente_id
  FROM workflows w
 WHERE w.id = wp.workflow_id;
ALTER TABLE workflow_posts ENABLE TRIGGER workflow_posts_updated_at;

-- 3) FK composta tenant-safe (precedente: clientes_id_conta_uq, 20260815000002).
-- Garante estruturalmente que cliente_id e conta_id do post apontam para o
-- mesmo par em clientes, nao so via RLS.
ALTER TABLE workflow_posts
  ADD CONSTRAINT workflow_posts_cliente_same_tenant
  FOREIGN KEY (cliente_id, conta_id) REFERENCES clientes (id, conta_id) ON DELETE CASCADE;

-- 4) cliente_id passa a ser obrigatorio (backfill acima garante que nenhuma
-- linha existente fica NULL); workflow_id deixa de ser obrigatorio para que um
-- post avulso possa existir sem fluxo.
ALTER TABLE workflow_posts ALTER COLUMN cliente_id SET NOT NULL;
ALTER TABLE workflow_posts ALTER COLUMN workflow_id DROP NOT NULL;

-- 5) Index para consultas por cliente (posts avulsos e agregados por cliente).
CREATE INDEX idx_workflow_posts_cliente ON workflow_posts (cliente_id);

-- ============================================================
-- 6) post_a0_sync_cliente: preenche/valida cliente_id a partir do workflow, e
-- bloqueia PATCH direto de workflow_id/cliente_id fora do caminho sancionado.
--
-- O nome do trigger importa: BEFORE triggers disparam em ordem alfabetica.
-- 'post_a0_sync_cliente' ('p') precisa ordenar antes de 'trg_limit_posts' ('t')
-- e dos 'workflow_posts_z1/z2' ('w') -- os limitadores de plano e os
-- reconciliadores de status leem/contam cliente_id/workflow_id ja resolvidos.
-- NOT NULL e checado depois dos BEFORE triggers, entao um INSERT que so
-- manda workflow_id (todo writer atual) continua funcionando: este trigger
-- preenche cliente_id antes da checagem de NOT NULL rodar.
-- ============================================================
CREATE OR REPLACE FUNCTION sync_workflow_post_cliente()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cliente_id bigint;
  v_conta_id   uuid;
BEGIN
  IF NEW.workflow_id IS NOT NULL THEN
    -- FOR SHARE serializa contra workflows_sync_posts_cliente (que faz UPDATE
    -- na linha do workflow): sem o lock, um INSERT concorrente pode ler o
    -- cliente ANTIGO enquanto uma troca de cliente do workflow commita no
    -- meio, e o sync do mover nao enxerga a linha ainda nao commitada deste
    -- INSERT -- o post fica preso permanentemente com o cliente errado. Com
    -- FOR SHARE, quem chegar depois espera e re-le a versao mais recente da
    -- linha (comportamento padrao de locking read em READ COMMITTED); FOR
    -- SHARE (nao FOR UPDATE) porque e auto-compativel, entao INSERTs
    -- concorrentes no MESMO workflow continuam em paralelo entre si.
    SELECT w.cliente_id, w.conta_id INTO v_cliente_id, v_conta_id
      FROM workflows w
     WHERE w.id = NEW.workflow_id
       FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'workflow not found for post';
    END IF;

    IF v_conta_id IS DISTINCT FROM NEW.conta_id THEN
      RAISE EXCEPTION 'workflow belongs to another workspace';
    END IF;

    NEW.cliente_id := v_cliente_id;
  ELSIF NEW.cliente_id IS NULL THEN
    RAISE EXCEPTION 'independent post requires cliente_id';
  END IF;

  -- Guarda contra PATCH direto: a policy RLS de workflow_posts e FOR ALL por
  -- conta_id (workspace inteiro), entao sem esta guarda um PATCH via
  -- PostgREST poderia anexar o post a um fluxo/cliente de outro cliente do
  -- MESMO workspace. current_setting precisa do coalesce: quando a GUC nunca
  -- foi setada na transacao ele retorna NULL, e 'NULL <> ''on''' e NULL (nao
  -- true) em plpgsql -- sem o coalesce a guarda nunca dispararia.
  IF TG_OP = 'UPDATE'
     AND (NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
          OR NEW.cliente_id IS DISTINCT FROM OLD.cliente_id)
     AND coalesce(current_setting('app.allow_post_move', true), '') <> 'on' THEN
    RAISE EXCEPTION 'post_move_requires_rpc';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS post_a0_sync_cliente ON workflow_posts;
CREATE TRIGGER post_a0_sync_cliente
  BEFORE INSERT OR UPDATE OF workflow_id, cliente_id ON workflow_posts
  FOR EACH ROW EXECUTE FUNCTION sync_workflow_post_cliente();

-- ============================================================
-- 7) workflows_sync_posts_cliente: mover um fluxo inteiro para outro cliente e
-- caminho real e ja documentado (20260820000003, mesma logica de deriva).
-- Quando isso acontece, os posts anexados a esse fluxo precisam seguir o
-- cliente novo; a GUC app.allow_post_move e setada ANTES do UPDATE para que
-- post_a0_sync_cliente (acima) nao rejeite esta propagacao como PATCH direto.
-- ============================================================
CREATE OR REPLACE FUNCTION propagate_workflow_cliente_to_posts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.allow_post_move', 'on', true);

  UPDATE workflow_posts
     SET cliente_id = NEW.cliente_id
   WHERE workflow_id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflows_sync_posts_cliente ON workflows;
CREATE TRIGGER workflows_sync_posts_cliente
  AFTER UPDATE OF cliente_id ON workflows
  FOR EACH ROW
  WHEN (OLD.cliente_id IS DISTINCT FROM NEW.cliente_id)
  EXECUTE FUNCTION propagate_workflow_cliente_to_posts();

-- ============================================================
-- 8) Limites de plano (limitador generico: enforce_plan_count_limit,
-- 20260611130002). Com workflow_id agora opcional, o bucket "posts por
-- fluxo" precisa de um WHEN explicito, e posts avulsos ganham um segundo
-- bucket ("posts avulsos por cliente") para nao ficarem de fora do limite.
-- ============================================================

-- Recriado: mesmos args de 20260611130003, so ganha o WHEN para nao contar
-- (nem travar o advisory lock) em inserts avulsos, que nao tem workflow_id.
DROP TRIGGER IF EXISTS trg_limit_posts ON workflow_posts;
CREATE TRIGGER trg_limit_posts
  BEFORE INSERT ON workflow_posts
  FOR EACH ROW WHEN (NEW.workflow_id IS NOT NULL)
  EXECUTE FUNCTION enforce_plan_count_limit(
    'max_posts_per_workflow', 'direct', 'conta_id', 'workflow_id');

-- Bucket separado: conta posts avulsos por cliente. O predicado extra
-- (TG_ARGV[4]) e obrigatorio aqui -- sem "workflow_id is null" o count
-- incluiria tambem os posts ja anexados a fluxos daquele cliente.
DROP TRIGGER IF EXISTS trg_limit_posts_avulsos ON workflow_posts;
CREATE TRIGGER trg_limit_posts_avulsos
  BEFORE INSERT ON workflow_posts
  FOR EACH ROW WHEN (NEW.workflow_id IS NULL)
  EXECUTE FUNCTION enforce_plan_count_limit(
    'max_posts_per_workflow', 'direct', 'conta_id', 'cliente_id', 'workflow_id is null');
