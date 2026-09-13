-- Processos individuais de producao (spec 2026-09-10-posts-individuais-
-- fluxos-design.md, secao 8). Evolucao aditiva: workflow_posts.workflow_id
-- continua significando so pertencimento a um fluxo; um post avulso pode ter
-- no maximo UMA execucao vigente (ativo ou concluido) aqui. Escrita de
-- cliente e negada por RLS; toda mutacao vem das RPCs SECURITY DEFINER da
-- fase 2. Nenhum backfill: nada cria processos para posts existentes.

-- ------------------------------------------------------------------
-- 0. FKs compostas de tenant para os alvos externos (template, fluxo de
-- origem, responsavel). Sem isso um RPC poderia ligar um processo da
-- conta A a um recurso da conta B (precedente: clientes_id_conta_uq,
-- 20260815000002; ideias_tarefa_fk, 20260730000009).
-- ------------------------------------------------------------------
ALTER TABLE public.workflow_templates ADD CONSTRAINT workflow_templates_id_conta_uq UNIQUE (id, conta_id);
ALTER TABLE public.workflows          ADD CONSTRAINT workflows_id_conta_uq          UNIQUE (id, conta_id);
ALTER TABLE public.membros            ADD CONSTRAINT membros_id_conta_uq            UNIQUE (id, conta_id);

-- ------------------------------------------------------------------
-- 1. post_processes: a execucao individual
-- ------------------------------------------------------------------
CREATE TABLE public.post_processes (
  id                  bigserial PRIMARY KEY,
  conta_id            uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  post_id             bigint NOT NULL,
  template_id         bigint,
  template_nome       text,
  assinatura          text NOT NULL,
  origem_workflow_id  bigint,
  origem_descricao    text,
  estado              text NOT NULL DEFAULT 'ativo'
                        CHECK (estado IN ('ativo', 'concluido', 'encerrado')),
  motivo_encerramento text CHECK (motivo_encerramento IN ('removido', 'vinculado')),
  etapa_atual         integer NOT NULL DEFAULT 0,
  modo_prazo          text NOT NULL DEFAULT 'padrao'
                        CHECK (modo_prazo IN ('padrao', 'data_fixa', 'data_entrega')),
  board_position      integer NOT NULL DEFAULT 0,
  revisao             integer NOT NULL DEFAULT 1,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  concluido_em        timestamptz,
  -- Alvo de FK composta (id, conta_id) para steps.
  CONSTRAINT post_processes_id_conta_uq UNIQUE (id, conta_id),
  -- Alvo de FK composta (id, conta_id, post_id) para events: garante que um
  -- evento nao possa apontar para o post A e para um processo do post B.
  CONSTRAINT post_processes_id_conta_post_uq UNIQUE (id, conta_id, post_id),
  -- O post precisa ser da mesma conta (workflow_posts_id_conta_uq, 20260820000002).
  CONSTRAINT post_processes_post_same_tenant
    FOREIGN KEY (post_id, conta_id) REFERENCES public.workflow_posts (id, conta_id) ON DELETE CASCADE,
  -- encerrado <=> motivo presente
  CONSTRAINT post_processes_encerrado_motivo
    CHECK ((estado = 'encerrado') = (motivo_encerramento IS NOT NULL)),
  -- MATCH SIMPLE ignora a FK quando a coluna e NULL: template_id e
  -- origem_workflow_id seguem opcionais.
  CONSTRAINT post_processes_template_same_tenant
    FOREIGN KEY (template_id, conta_id) REFERENCES public.workflow_templates (id, conta_id) ON DELETE SET NULL (template_id),
  CONSTRAINT post_processes_origem_same_tenant
    FOREIGN KEY (origem_workflow_id, conta_id) REFERENCES public.workflows (id, conta_id) ON DELETE SET NULL (origem_workflow_id)
);

-- Um so processo vigente por post; encerrados podem se acumular.
CREATE UNIQUE INDEX post_processes_one_vigente_per_post
  ON public.post_processes (post_id) WHERE estado IN ('ativo', 'concluido');
CREATE INDEX idx_post_processes_conta_estado ON public.post_processes (conta_id, estado);
CREATE INDEX idx_post_processes_post ON public.post_processes (post_id);

-- ------------------------------------------------------------------
-- 2. post_process_steps: etapas instanciadas (snapshot)
-- ------------------------------------------------------------------
CREATE TABLE public.post_process_steps (
  id                  bigserial PRIMARY KEY,
  conta_id            uuid NOT NULL,
  process_id          bigint NOT NULL,
  ordem               integer NOT NULL,
  nome                text NOT NULL,
  tipo                text NOT NULL DEFAULT 'padrao' CHECK (tipo IN ('padrao', 'aprovacao_cliente')),
  responsavel_id      bigint,
  prazo_dias          integer,
  tipo_prazo          text CHECK (tipo_prazo IN ('uteis', 'corridos')),
  prazo_efetivo       timestamptz,
  estado              text NOT NULL DEFAULT 'pendente'
                        CHECK (estado IN ('pendente', 'ativo', 'concluido', 'herdado', 'ignorado', 'interrompido')),
  iniciado_em         timestamptz,
  concluido_em        timestamptz,
  interrompido_em     timestamptz,
  -- Proveniencia herdada por snapshot: ids de workflow_etapas nao sao
  -- estaveis (migrate_workflow_template apaga e reinsere).
  origem_etapa_ordem  integer,
  origem_etapa_nome   text,
  CONSTRAINT post_process_steps_id_conta_uq UNIQUE (id, conta_id),
  CONSTRAINT post_process_steps_process_same_tenant
    FOREIGN KEY (process_id, conta_id) REFERENCES public.post_processes (id, conta_id) ON DELETE CASCADE,
  CONSTRAINT post_process_steps_ordem_uq UNIQUE (process_id, ordem),
  -- MATCH SIMPLE ignora a FK quando responsavel_id e NULL: campo opcional.
  CONSTRAINT post_process_steps_responsavel_same_tenant
    FOREIGN KEY (responsavel_id, conta_id) REFERENCES public.membros (id, conta_id) ON DELETE SET NULL (responsavel_id)
);
CREATE UNIQUE INDEX post_process_steps_one_active
  ON public.post_process_steps (process_id) WHERE estado = 'ativo';
-- A FK de tenant de membros dispara SET NULL nesse caminho quando um membro sai.
CREATE INDEX idx_post_process_steps_responsavel ON public.post_process_steps (responsavel_id);

-- ------------------------------------------------------------------
-- 3. post_process_events: historico
-- ------------------------------------------------------------------
CREATE TABLE public.post_process_events (
  id             bigserial PRIMARY KEY,
  conta_id       uuid NOT NULL,
  post_id        bigint NOT NULL,
  process_id     bigint NOT NULL,
  evento         text NOT NULL CHECK (evento IN (
                   'desmembrado', 'aplicado', 'avancou', 'voltou', 'concluido',
                   'reaberto', 'removido', 'vinculado', 'etapa_editada')),
  actor_user_id  uuid,
  actor_name     text,
  origem         text NOT NULL DEFAULT 'workspace_user' CHECK (origem IN ('workspace_user', 'system')),
  antes          jsonb,
  depois         jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_process_events_post_same_tenant
    FOREIGN KEY (post_id, conta_id) REFERENCES public.workflow_posts (id, conta_id) ON DELETE CASCADE,
  -- O processo precisa apontar para o MESMO post do evento, nao so para a
  -- mesma conta: sem isso um evento podia citar o post A e o processo de um
  -- post B da mesma conta.
  CONSTRAINT post_process_events_process_same_post
    FOREIGN KEY (process_id, conta_id, post_id) REFERENCES public.post_processes (id, conta_id, post_id) ON DELETE CASCADE
);
-- Empates de now() na mesma transacao desempatam por id.
CREATE INDEX idx_post_process_events_post ON public.post_process_events (post_id, created_at, id);
-- Lidera o cascade de delete de processo (express-post-cleanup-cron apaga
-- rascunhos avulsos em lote); sem indice, o DELETE varre a tabela toda.
CREATE INDEX idx_post_process_events_process ON public.post_process_events (process_id);

-- ------------------------------------------------------------------
-- 4. post_process_batch_requests: idempotencia do desmembrar em lote
-- ------------------------------------------------------------------
CREATE TABLE public.post_process_batch_requests (
  request_id  uuid PRIMARY KEY,
  conta_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  resultado   jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------
-- 5. Triggers de invariante
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_processes_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  new.updated_at := now();
  RETURN new;
END;
$$;
CREATE TRIGGER post_processes_set_updated_at
  BEFORE UPDATE ON public.post_processes
  FOR EACH ROW EXECUTE FUNCTION public.post_processes_set_updated_at();

-- Mesmo desenho de set_workflow_concluido_em (20260903000010).
CREATE OR REPLACE FUNCTION public.set_post_process_concluido_em()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF old.estado IS DISTINCT FROM new.estado THEN
    IF new.estado = 'concluido' THEN
      new.concluido_em := now();
    ELSIF old.estado = 'concluido' AND new.estado = 'ativo' THEN
      new.concluido_em := NULL;
    END IF;
  END IF;
  RETURN new;
END;
$$;
CREATE TRIGGER post_processes_set_concluido_em
  BEFORE UPDATE ON public.post_processes
  FOR EACH ROW EXECUTE FUNCTION public.set_post_process_concluido_em();

-- Um processo so nasce, reabre ou muda de post para post avulso.
CREATE OR REPLACE FUNCTION public.post_processes_requires_avulso()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_workflow_id bigint;
BEGIN
  -- Em UPDATE so interessa quando o processo passa a ser vigente (reabrir um
  -- encerrado) ou muda de post/conta; transicoes ativo<->concluido e edicoes
  -- de outras colunas nao relem o post.
  IF TG_OP = 'UPDATE'
     AND NOT (
       (new.estado IN ('ativo', 'concluido') AND old.estado = 'encerrado')
       OR new.post_id IS DISTINCT FROM old.post_id
       OR new.conta_id IS DISTINCT FROM old.conta_id
     ) THEN
    RETURN new;
  END IF;
  IF new.estado NOT IN ('ativo', 'concluido') THEN
    RETURN new;  -- inserir/atualizar ja encerrado nao precisa de post avulso
  END IF;
  -- Lock compartilhado na linha do post: serializa com qualquer UPDATE de
  -- workflow_posts (attach/move fazem UPDATE, que pega FOR NO KEY UPDATE e
  -- conflita com FOR SHARE). Em READ COMMITTED a linha e relida depois da
  -- espera, entao a checagem abaixo ve o attach que acabou de commitar; e o
  -- attach que esperar por nos roda post_a1_process_guard com snapshot novo
  -- e ve o processo. Post inexistente/de outra conta cai na FK composta.
  SELECT wp.workflow_id INTO v_workflow_id
    FROM workflow_posts wp
   WHERE wp.id = new.post_id AND wp.conta_id = new.conta_id
     FOR SHARE;
  IF v_workflow_id IS NOT NULL THEN
    RAISE EXCEPTION 'post_in_workflow' USING ERRCODE = 'P0001';
  END IF;
  RETURN new;
END;
$$;
-- Ordem alfabetica dos triggers BEFORE UPDATE em post_processes:
-- post_processes_requires_avulso < post_processes_set_concluido_em <
-- post_processes_set_updated_at; nenhum deles altera estado/post_id/conta_id,
-- entao a ordem entre eles nao importa.
CREATE TRIGGER post_processes_requires_avulso
  BEFORE INSERT OR UPDATE OF estado, post_id, conta_id ON public.post_processes
  FOR EACH ROW EXECUTE FUNCTION public.post_processes_requires_avulso();

-- Gate de plano, so em INSERT: desligar a flag bloqueia execucoes novas e
-- mantem as existentes (politica pos-downgrade da casa, 20260611140002).
CREATE TRIGGER trg_feature_post_processes
  BEFORE INSERT ON public.post_processes
  FOR EACH ROW EXECUTE FUNCTION enforce_plan_feature('feature_post_processes', 'direct', 'conta_id');

-- ------------------------------------------------------------------
-- 6. RLS e grants (padrao workspace_roles, 20260903000002)
-- ------------------------------------------------------------------
ALTER TABLE public.post_processes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_process_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_process_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_process_batch_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY pp_select_member ON public.post_processes
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY pp_no_client_insert ON public.post_processes FOR INSERT WITH CHECK (false);
CREATE POLICY pp_no_client_update ON public.post_processes FOR UPDATE USING (false);
CREATE POLICY pp_no_client_delete ON public.post_processes FOR DELETE USING (false);
CREATE POLICY service_role_bypass_post_processes ON public.post_processes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY pps_select_member ON public.post_process_steps
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY pps_no_client_insert ON public.post_process_steps FOR INSERT WITH CHECK (false);
CREATE POLICY pps_no_client_update ON public.post_process_steps FOR UPDATE USING (false);
CREATE POLICY pps_no_client_delete ON public.post_process_steps FOR DELETE USING (false);
CREATE POLICY service_role_bypass_post_process_steps ON public.post_process_steps
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY ppe_select_member ON public.post_process_events
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY ppe_no_client_insert ON public.post_process_events FOR INSERT WITH CHECK (false);
CREATE POLICY ppe_no_client_update ON public.post_process_events FOR UPDATE USING (false);
CREATE POLICY ppe_no_client_delete ON public.post_process_events FOR DELETE USING (false);
CREATE POLICY service_role_bypass_post_process_events ON public.post_process_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Recibos de lote nao sao lidos pelo cliente: sem SELECT para membros.
CREATE POLICY service_role_bypass_post_process_batch_requests ON public.post_process_batch_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Grants explicitos (o default ACL hosted daria ALL a authenticated; o
-- REVOKE abaixo tambem tira do service_role, por isso o re-GRANT).
REVOKE ALL ON TABLE public.post_processes, public.post_process_steps,
  public.post_process_events, public.post_process_batch_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.post_processes, public.post_process_steps, public.post_process_events TO authenticated;
GRANT ALL ON TABLE public.post_processes, public.post_process_steps,
  public.post_process_events, public.post_process_batch_requests TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.post_processes_id_seq, public.post_process_steps_id_seq,
  public.post_process_events_id_seq TO service_role;
