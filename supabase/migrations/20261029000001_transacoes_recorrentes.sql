-- Lançamentos recorrentes: a template that shows up every month in Financeiro as an
-- "agendado" entry to confirm (taxes, software, rent), the same way client fees and team
-- pay already do. Nothing is generated server-side: the CRM projects the current month's
-- occurrence (store/computed.ts projetarAgendamentos) and confirming it writes a normal
-- transacoes row with referencia_agendamento = 'recorrente_<id>_<yyyy>_<mm>'.
--
-- Same access as transacoes: rows of the active workspace, read with can_see_financials(),
-- written with has_permission('financeiro','editar'), inserts gated by feature_financial.

CREATE TABLE public.transacoes_recorrentes (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conta_id   uuid          NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id    uuid          NOT NULL,
  tipo       text          NOT NULL CHECK (tipo IN ('entrada', 'saida')),
  descricao  text          NOT NULL CHECK (length(trim(descricao)) > 0),
  categoria  text          NOT NULL DEFAULT '',
  valor      numeric(12,2) NOT NULL CHECK (valor > 0),
  -- Day of the month; months shorter than it use their last day.
  dia        int           NOT NULL CHECK (dia BETWEEN 1 AND 31),
  -- First and last month it occurs in (always the 1st of the month); fim NULL = no end.
  inicio     date          NOT NULL CHECK (extract(day FROM inicio) = 1),
  fim        date          CHECK (fim IS NULL OR (extract(day FROM fim) = 1 AND fim >= inicio)),
  created_at timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX transacoes_recorrentes_conta_idx ON public.transacoes_recorrentes (conta_id);

ALTER TABLE public.transacoes_recorrentes ENABLE ROW LEVEL SECURITY;

CREATE POLICY transacoes_recorrentes_select ON public.transacoes_recorrentes FOR SELECT USING (
  conta_id IN (SELECT public.get_my_conta_id())
  AND (SELECT public.can_see_financials())
);

CREATE POLICY transacoes_recorrentes_insert ON public.transacoes_recorrentes FOR INSERT WITH CHECK (
  conta_id IN (SELECT public.get_my_conta_id())
  AND (SELECT public.can_see_financials())
  AND (SELECT public.has_permission('financeiro', 'editar'))
);

CREATE POLICY transacoes_recorrentes_update ON public.transacoes_recorrentes FOR UPDATE USING (
  conta_id IN (SELECT public.get_my_conta_id())
  AND (SELECT public.can_see_financials())
  AND (SELECT public.has_permission('financeiro', 'editar'))
) WITH CHECK (
  conta_id IN (SELECT public.get_my_conta_id())
  AND (SELECT public.can_see_financials())
  AND (SELECT public.has_permission('financeiro', 'editar'))
);

CREATE POLICY transacoes_recorrentes_delete ON public.transacoes_recorrentes FOR DELETE USING (
  conta_id IN (SELECT public.get_my_conta_id())
  AND (SELECT public.can_see_financials())
  AND (SELECT public.has_permission('financeiro', 'editar'))
);

CREATE TRIGGER trg_feature_financial BEFORE INSERT ON public.transacoes_recorrentes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_feature('feature_financial', 'direct', 'conta_id');

REVOKE ALL ON public.transacoes_recorrentes FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transacoes_recorrentes TO authenticated;
GRANT ALL ON public.transacoes_recorrentes TO service_role;
