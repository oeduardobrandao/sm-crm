SET LOCAL lock_timeout = '5s';

-- Financeiro v2 (rentabilidade por cliente): schema, RLS e grants
-- (spec docs/superpowers/specs/2026-10-23-financeiro-rentabilidade-design.md).
-- Sete tabelas. Escrita so pelas RPCs dos proximos passos (SECURITY DEFINER);
-- o tenant le por SELECT, e so quando o workspace tem feature_financial E
-- feature_financeiro_v2 e quem le enxerga o financeiro (can_see_financials).
-- Toda referencia a clientes, membros ou tabela v2 e FK composta (x_id, conta_id),
-- entao um id de outro workspace nao passa nem pelo service_role.

-- ============ (1) TABELAS ============

-- Uma linha por workspace. periodo_dia = dia do mes em que o periodo comeca.
CREATE TABLE public.financeiro_config (
  conta_id    uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  periodo_dia smallint    NOT NULL DEFAULT 1,
  meta_margem numeric(5,2) NOT NULL DEFAULT 55,
  seeded_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz,
  PRIMARY KEY (conta_id),
  CONSTRAINT financeiro_config_periodo_dia_chk CHECK (periodo_dia BETWEEN 1 AND 28),
  CONSTRAINT financeiro_config_meta_margem_chk CHECK (meta_margem BETWEEN 0 AND 100)
);

CREATE TABLE public.financeiro_funcoes (
  id         bigserial   NOT NULL,
  conta_id   uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  nome       text        NOT NULL,
  ordem      int         NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT financeiro_funcoes_id_conta_uq UNIQUE (id, conta_id),
  CONSTRAINT financeiro_funcoes_nome_chk CHECK (length(trim(nome)) BETWEEN 1 AND 60)
);
CREATE UNIQUE INDEX financeiro_funcoes_conta_nome_uq ON public.financeiro_funcoes (conta_id, lower(nome));

-- Versoes do valor mensal e do status de cada cliente: vale a de maior vale_desde <= dia.
CREATE TABLE public.financeiro_cliente_versoes (
  id            bigserial     NOT NULL,
  conta_id      uuid          NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  cliente_id    bigint        NOT NULL,
  vale_desde    date          NOT NULL,
  valor_mensal  numeric(12,2) NOT NULL,
  dia_pagamento smallint,
  status        text          NOT NULL,
  created_by    uuid,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT financeiro_cliente_versoes_id_conta_uq UNIQUE (id, conta_id),
  CONSTRAINT financeiro_cliente_versoes_cliente_fk FOREIGN KEY (cliente_id, conta_id)
    REFERENCES public.clientes (id, conta_id) ON DELETE CASCADE,
  CONSTRAINT financeiro_cliente_versoes_vigencia_uq UNIQUE (cliente_id, vale_desde),
  CONSTRAINT financeiro_cliente_versoes_valor_chk CHECK (valor_mensal >= 0),
  CONSTRAINT financeiro_cliente_versoes_status_chk CHECK (status IN ('ativo', 'pausado', 'encerrado')),
  CONSTRAINT financeiro_cliente_versoes_dia_chk CHECK (dia_pagamento BETWEEN 1 AND 31)
);
CREATE INDEX financeiro_cliente_versoes_conta_idx ON public.financeiro_cliente_versoes (conta_id);

-- Versoes do acordo de cada membro (modelo de pagamento, valor, meta, limite).
CREATE TABLE public.financeiro_acordo_versoes (
  id              bigserial     NOT NULL,
  conta_id        uuid          NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  membro_id       bigint        NOT NULL,
  vale_desde      date          NOT NULL,
  funcao_id       bigint,
  modelo          text          NOT NULL,
  valor           numeric(12,2) NOT NULL,
  unidade         text,
  meta_quantidade int,
  meta_periodo    text,
  limite_clientes int,
  dia_pagamento   smallint,
  vigencia_inicio date,
  vigencia_fim    date,
  arquivo_path    text,
  created_by      uuid,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT financeiro_acordo_versoes_id_conta_uq UNIQUE (id, conta_id),
  CONSTRAINT financeiro_acordo_versoes_membro_fk FOREIGN KEY (membro_id, conta_id)
    REFERENCES public.membros (id, conta_id) ON DELETE CASCADE,
  -- apagar a funcao so zera funcao_id; conta_id (NOT NULL) fica
  CONSTRAINT financeiro_acordo_versoes_funcao_fk FOREIGN KEY (funcao_id, conta_id)
    REFERENCES public.financeiro_funcoes (id, conta_id) ON DELETE SET NULL (funcao_id),
  CONSTRAINT financeiro_acordo_versoes_vigencia_uq UNIQUE (membro_id, vale_desde),
  CONSTRAINT financeiro_acordo_versoes_modelo_chk CHECK (modelo IN ('mensal_meta', 'mensal_limite', 'por_entrega')),
  CONSTRAINT financeiro_acordo_versoes_meta_periodo_chk CHECK (meta_periodo IN ('dia_util', 'semana', 'mes')),
  CONSTRAINT financeiro_acordo_versoes_valor_chk CHECK (valor >= 0),
  CONSTRAINT financeiro_acordo_versoes_limite_chk CHECK (limite_clientes > 0),
  CONSTRAINT financeiro_acordo_versoes_meta_qtd_chk CHECK (meta_quantidade > 0)
);
CREATE INDEX financeiro_acordo_versoes_conta_idx ON public.financeiro_acordo_versoes (conta_id);
CREATE INDEX financeiro_acordo_versoes_funcao_idx ON public.financeiro_acordo_versoes (funcao_id) WHERE funcao_id IS NOT NULL;

-- Quem atende quem. ate IS NULL = atribuicao aberta; no maximo uma por par.
CREATE TABLE public.financeiro_atribuicoes (
  id         bigserial   NOT NULL,
  conta_id   uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  membro_id  bigint      NOT NULL,
  cliente_id bigint      NOT NULL,
  desde      date        NOT NULL,
  ate        date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT financeiro_atribuicoes_id_conta_uq UNIQUE (id, conta_id),
  CONSTRAINT financeiro_atribuicoes_membro_fk FOREIGN KEY (membro_id, conta_id)
    REFERENCES public.membros (id, conta_id) ON DELETE CASCADE,
  CONSTRAINT financeiro_atribuicoes_cliente_fk FOREIGN KEY (cliente_id, conta_id)
    REFERENCES public.clientes (id, conta_id) ON DELETE CASCADE,
  CONSTRAINT financeiro_atribuicoes_ate_chk CHECK (ate IS NULL OR ate > desde)
);
CREATE UNIQUE INDEX financeiro_atribuicoes_aberta_uq ON public.financeiro_atribuicoes (membro_id, cliente_id) WHERE ate IS NULL;
CREATE INDEX financeiro_atribuicoes_conta_idx ON public.financeiro_atribuicoes (conta_id);
CREATE INDEX financeiro_atribuicoes_cliente_idx ON public.financeiro_atribuicoes (cliente_id);

-- Quantidade de entregas informada na mao, por membro, cliente e periodo (modelo por_entrega).
CREATE TABLE public.financeiro_entregas_manuais (
  conta_id       uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  periodo_inicio date        NOT NULL,
  membro_id      bigint      NOT NULL,
  cliente_id     bigint      NOT NULL,
  quantidade     int         NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membro_id, cliente_id, periodo_inicio),
  CONSTRAINT financeiro_entregas_manuais_membro_fk FOREIGN KEY (membro_id, conta_id)
    REFERENCES public.membros (id, conta_id) ON DELETE CASCADE,
  CONSTRAINT financeiro_entregas_manuais_cliente_fk FOREIGN KEY (cliente_id, conta_id)
    REFERENCES public.clientes (id, conta_id) ON DELETE CASCADE,
  CONSTRAINT financeiro_entregas_manuais_quantidade_chk CHECK (quantidade >= 0)
);
CREATE INDEX financeiro_entregas_manuais_conta_idx ON public.financeiro_entregas_manuais (conta_id, periodo_inicio);
CREATE INDEX financeiro_entregas_manuais_cliente_idx ON public.financeiro_entregas_manuais (cliente_id);

-- Periodos de apuracao. Fechado = snapshot imutavel (embute os nomes).
CREATE TABLE public.financeiro_periodos (
  conta_id    uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  inicio      date        NOT NULL,
  fim         date        NOT NULL,
  status      text        NOT NULL DEFAULT 'aberto',
  transicao   boolean     NOT NULL DEFAULT false,
  snapshot    jsonb,
  fechado_em  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conta_id, inicio),
  CONSTRAINT financeiro_periodos_fim_chk CHECK (fim > inicio),
  CONSTRAINT financeiro_periodos_status_chk CHECK (status IN ('aberto', 'fechado', 'reaberto')),
  CONSTRAINT financeiro_periodos_snapshot_chk CHECK (status <> 'fechado' OR snapshot IS NOT NULL)
);

-- ============ (2) RLS ============
-- SELECT-only. There is deliberately no INSERT/UPDATE/DELETE policy: every write
-- goes through the SECURITY DEFINER RPCs. service_role bypasses RLS on its own.
-- A leitura exige as duas flags do workspace E o direito de ver o financeiro
-- (fail closed: o owner tambem sai com zero linhas se a flag estiver desligada).

ALTER TABLE public.financeiro_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY financeiro_config_select ON public.financeiro_config FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id())
         AND (SELECT public.effective_plan_feature(conta_id, 'feature_financial'))
         AND (SELECT public.effective_plan_feature(conta_id, 'feature_financeiro_v2'))
         AND (SELECT public.can_see_financials()));

ALTER TABLE public.financeiro_funcoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY financeiro_funcoes_select ON public.financeiro_funcoes FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id())
         AND (SELECT public.effective_plan_feature(conta_id, 'feature_financial'))
         AND (SELECT public.effective_plan_feature(conta_id, 'feature_financeiro_v2'))
         AND (SELECT public.can_see_financials()));

ALTER TABLE public.financeiro_cliente_versoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY financeiro_cliente_versoes_select ON public.financeiro_cliente_versoes FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id())
         AND (SELECT public.effective_plan_feature(conta_id, 'feature_financial'))
         AND (SELECT public.effective_plan_feature(conta_id, 'feature_financeiro_v2'))
         AND (SELECT public.can_see_financials()));

ALTER TABLE public.financeiro_acordo_versoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY financeiro_acordo_versoes_select ON public.financeiro_acordo_versoes FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id())
         AND (SELECT public.effective_plan_feature(conta_id, 'feature_financial'))
         AND (SELECT public.effective_plan_feature(conta_id, 'feature_financeiro_v2'))
         AND (SELECT public.can_see_financials()));

ALTER TABLE public.financeiro_atribuicoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY financeiro_atribuicoes_select ON public.financeiro_atribuicoes FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id())
         AND (SELECT public.effective_plan_feature(conta_id, 'feature_financial'))
         AND (SELECT public.effective_plan_feature(conta_id, 'feature_financeiro_v2'))
         AND (SELECT public.can_see_financials()));

ALTER TABLE public.financeiro_entregas_manuais ENABLE ROW LEVEL SECURITY;
CREATE POLICY financeiro_entregas_manuais_select ON public.financeiro_entregas_manuais FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id())
         AND (SELECT public.effective_plan_feature(conta_id, 'feature_financial'))
         AND (SELECT public.effective_plan_feature(conta_id, 'feature_financeiro_v2'))
         AND (SELECT public.can_see_financials()));

ALTER TABLE public.financeiro_periodos ENABLE ROW LEVEL SECURITY;
CREATE POLICY financeiro_periodos_select ON public.financeiro_periodos FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id())
         AND (SELECT public.effective_plan_feature(conta_id, 'feature_financial'))
         AND (SELECT public.effective_plan_feature(conta_id, 'feature_financeiro_v2'))
         AND (SELECT public.can_see_financials()));

-- ============ (3) GRANTS ============
-- The hosted default ACL grants ALL on new tables. Revoke everything and re-grant
-- exactly what is needed (TRUNCATE/REFERENCES/TRIGGER would otherwise stay with
-- authenticated, and TRUNCATE ignores RLS). Same shape as 20261005000001.
REVOKE ALL ON TABLE public.financeiro_config, public.financeiro_funcoes, public.financeiro_cliente_versoes,
  public.financeiro_acordo_versoes, public.financeiro_atribuicoes, public.financeiro_entregas_manuais,
  public.financeiro_periodos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.financeiro_config, public.financeiro_funcoes, public.financeiro_cliente_versoes,
  public.financeiro_acordo_versoes, public.financeiro_atribuicoes, public.financeiro_entregas_manuais,
  public.financeiro_periodos TO authenticated;
GRANT ALL ON TABLE public.financeiro_config, public.financeiro_funcoes, public.financeiro_cliente_versoes,
  public.financeiro_acordo_versoes, public.financeiro_atribuicoes, public.financeiro_entregas_manuais,
  public.financeiro_periodos TO service_role;
REVOKE ALL ON SEQUENCE public.financeiro_funcoes_id_seq, public.financeiro_cliente_versoes_id_seq,
  public.financeiro_acordo_versoes_id_seq, public.financeiro_atribuicoes_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.financeiro_funcoes_id_seq, public.financeiro_cliente_versoes_id_seq,
  public.financeiro_acordo_versoes_id_seq, public.financeiro_atribuicoes_id_seq TO service_role;

DO $$
DECLARE
  v_table text;
  v_extra text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['financeiro_config','financeiro_funcoes','financeiro_cliente_versoes',
      'financeiro_acordo_versoes','financeiro_atribuicoes','financeiro_entregas_manuais','financeiro_periodos'] LOOP
    SELECT string_agg(privilege_type, ', ' ORDER BY privilege_type) INTO v_extra
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = v_table
       AND grantee = 'authenticated' AND privilege_type <> 'SELECT';
    IF v_extra IS NOT NULL THEN
      RAISE EXCEPTION '%: authenticated holds more than SELECT (%)', v_table, v_extra;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name = v_table
         AND grantee = 'authenticated' AND privilege_type = 'SELECT'
    ) THEN
      RAISE EXCEPTION '%: authenticated lost SELECT', v_table;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name = v_table
         AND grantee = 'anon'
    ) THEN
      RAISE EXCEPTION '%: anon holds a privilege', v_table;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_table)::regclass) THEN
      RAISE EXCEPTION '%: row level security is off', v_table;
    END IF;
  END LOOP;
END
$$;
