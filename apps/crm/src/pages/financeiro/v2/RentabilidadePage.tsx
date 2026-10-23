import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ChartColumn, Download, Percent, UserX, Users, Wallet } from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableSkeleton } from '@/components/ui/skeletons';
import { useAuth } from '@/context/AuthContext';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { downloadCsv } from '@/lib/csvExport';
import { handleEntitlementMutationError } from '@/lib/entitlement-toast';
import { formatFinancialBRL } from '@/lib/financialAccess';
import { fecharPeriodo, getPeriodos, getRentabilidade, reabrirPeriodo } from '@/store';
import type { PeriodoFinanceiro, RentabilidadeSeeded } from '@/store/financeiroV2';
import { formatMargem } from './format';
import { MensalAnualToggle } from './MensalAnualToggle';
import { PeriodoSelect } from './PeriodoSelect';
import { montarCsv, montarLinhas, nomeArquivoCsv, somarLinhas } from './rentabilidade';
import { RentabilidadeDetalhe } from './RentabilidadeDetalhe';
import { RentabilidadePhone } from './RentabilidadePhone';
import { RentabilidadeTabela } from './RentabilidadeTabela';

type AcaoPeriodo = 'reabrir' | 'fechar';

const ACAO_COPY: Record<
  AcaoPeriodo,
  { title: string; body: string; confirm: string; ok: string; erro: string }
> = {
  reabrir: {
    title: 'Reabrir período?',
    body: 'Os números deste período voltam a ser calculados até você fechar de novo.',
    confirm: 'Reabrir',
    ok: 'Período reaberto.',
    erro: 'Erro ao reabrir o período',
  },
  fechar: {
    title: 'Fechar período?',
    body: 'Os números deste período ficam guardados como estão até alguém reabrir.',
    confirm: 'Fechar',
    ok: 'Período fechado.',
    erro: 'Erro ao fechar o período',
  },
};

/** "Meta: 55%" with a pt-BR comma when the goal has decimals. */
const metaTexto = (meta: number) => `Meta: ${String(meta).replace('.', ',')}%`;

/**
 * Financeiro › Rentabilidade: KPIs, the per-client profitability table (lowest margin
 * first) with its side panel, and the period controls. Renders inside the v2 layout,
 * which owns the title, the tab bar and the not-seeded onboarding.
 */
export default function RentabilidadePage() {
  const { canSeeFinancials, can, workspaceRole, profile } = useAuth();
  const isDesktop = useIsDesktop(768);
  const qc = useQueryClient();
  const [inicio, setInicio] = useState<string | undefined>(undefined);
  const [anual, setAnual] = useState(false);
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);
  const [acao, setAcao] = useState<AcaoPeriodo | null>(null);
  const [busy, setBusy] = useState(false);

  const rentabilidade = useQuery({
    queryKey: ['financeiro-v2', 'rentabilidade', inicio ?? 'atual'],
    queryFn: () => (inicio ? getRentabilidade(inicio) : getRentabilidade()),
    placeholderData: keepPreviousData,
  });
  const periodosQuery = useQuery({
    queryKey: ['financeiro-v2', 'periodos'],
    queryFn: getPeriodos,
  });

  const data: RentabilidadeSeeded | null =
    rentabilidade.data?.seeded === true ? rentabilidade.data : null;
  const linhas = useMemo(() => (data ? montarLinhas(data, anual) : []), [data, anual]);
  const total = useMemo(() => somarLinhas(linhas, data?.funcoes ?? []), [linhas, data]);

  const periodos: PeriodoFinanceiro[] = useMemo(() => {
    const lista = periodosQuery.data ?? [];
    if (!data || lista.some((p) => p.inicio === data.periodo.inicio)) return lista;
    return [data.periodo, ...lista];
  }, [periodosQuery.data, data]);

  // Closed/reopened state comes from the period list: a closed period's snapshot reads 'aberto'.
  const inicioExibido = data?.periodo.inicio;
  // While another period loads, the previous payload is still on screen: no badge or action
  // for it, since the select already names the new one.
  const status = rentabilidade.isPlaceholderData
    ? undefined
    : periodosQuery.data?.find((p) => p.inicio === inicioExibido)?.status;
  const podeGerirPeriodo =
    (workspaceRole === 'owner' || workspaceRole === 'admin') &&
    can('financeiro', 'editar') === true;

  const escolherPeriodo = (novo: string | undefined) => {
    setInicio(novo);
    setSelecionadoId(null);
  };

  const executarAcao = async (qual: AcaoPeriodo) => {
    if (!inicioExibido) return;
    setBusy(true);
    try {
      if (qual === 'reabrir') await reabrirPeriodo(inicioExibido);
      else await fecharPeriodo(inicioExibido);
      await qc.invalidateQueries({ queryKey: ['financeiro-v2'] });
      toast.success(ACAO_COPY[qual].ok);
    } catch (e) {
      if (!handleEntitlementMutationError(e, profile?.conta_id ?? null))
        toast.error(ACAO_COPY[qual].erro);
    } finally {
      setBusy(false);
    }
  };

  const exportar = () => {
    if (!data) return;
    downloadCsv(montarCsv(linhas, data.funcoes, anual), nomeArquivoCsv(data.periodo.rotulo, anual));
  };

  const barraPeriodo = (
    <div className="flex flex-wrap items-center gap-2">
      <PeriodoSelect
        aria-label="Período"
        value={inicio ?? inicioExibido}
        onChange={escolherPeriodo}
        periodos={periodos}
      />
      {data && status === 'fechado' && <Badge variant="neutral">Fechado</Badge>}
      {data && podeGerirPeriodo && status === 'fechado' && (
        <Button
          variant="outline"
          size="sm"
          className="mb-0"
          disabled={busy}
          onClick={() => setAcao('reabrir')}
        >
          Reabrir período
        </Button>
      )}
      {data && podeGerirPeriodo && status === 'reaberto' && (
        <Button
          variant="outline"
          size="sm"
          className="mb-0"
          disabled={busy}
          onClick={() => setAcao('fechar')}
        >
          Fechar período
        </Button>
      )}
    </div>
  );

  if (rentabilidade.isPending) return <TableSkeleton rows={8} columns={6} />;

  if (!data) {
    // seeded:false is the layout's onboarding; render nothing harmful if it reaches here.
    if (!rentabilidade.isError) return null;
    return (
      <div className="flex flex-col gap-4">
        {barraPeriodo}
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted-foreground">
            Não foi possível carregar a rentabilidade.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mb-0"
            onClick={() => void rentabilidade.refetch()}
          >
            Tentar novamente
          </Button>
          {inicio && (
            <Button
              variant="ghost"
              size="sm"
              className="mb-0"
              onClick={() => escolherPeriodo(undefined)}
            >
              Voltar ao período atual
            </Button>
          )}
        </div>
      </div>
    );
  }

  const access = canSeeFinancials;
  const brl = (v: number) => formatFinancialBRL(v, access);
  const { totais } = data;
  const ativos = data.clientes.filter((c) => c.status === 'ativo').length;
  const pctCusto = totais.receita > 0 ? formatMargem(totais.custo_total / totais.receita) : '-';
  const selecionado =
    linhas.find((l) => l.cliente.cliente_id === selecionadoId)?.cliente ??
    linhas[0]?.cliente ??
    null;

  const aviso = data.incompleto && (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>Há entregas a informar neste período.</span>
      <Link to="/financeiro/equipe" className="font-semibold underline">
        Informar entregas
      </Link>
    </p>
  );

  const dialogo = (
    <AlertDialog open={acao !== null} onOpenChange={(open) => !open && setAcao(null)}>
      <AlertDialogContent>
        {acao && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{ACAO_COPY[acao].title}</AlertDialogTitle>
              <AlertDialogDescription>{ACAO_COPY[acao].body}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction disabled={busy} onClick={() => void executarAcao(acao)}>
                {ACAO_COPY[acao].confirm}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );

  if (!isDesktop) {
    return (
      <div className="flex flex-col gap-4">
        {barraPeriodo}
        {aviso}
        <RentabilidadePhone
          data={data}
          linhas={linhas}
          anual={anual}
          onAnualChange={setAnual}
          access={access}
        />
        {dialogo}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {barraPeriodo}

      <StatCardGrid>
        <StatCard
          label="Receita recorrente"
          value={brl(totais.receita)}
          sub={`${ativos} ${ativos === 1 ? 'cliente' : 'clientes'} · ARR ${brl(totais.receita * 12)}`}
          icon={Users}
          tone="green"
          compactValue
        />
        <StatCard
          label="Custo da equipe"
          value={brl(totais.custo_total)}
          sub={`${data.membros.length} ${data.membros.length === 1 ? 'pessoa' : 'pessoas'} · ${pctCusto} da receita`}
          icon={Wallet}
          tone="amber"
          compactValue
        />
        <StatCard
          label="Lucro recorrente"
          value={brl(totais.lucro)}
          sub={`LL anual ${brl(totais.lucro * 12)}`}
          icon={ChartColumn}
          tone="violet"
          compactValue
        />
        <StatCard
          label="Margem média"
          value={formatMargem(totais.margem)}
          sub={metaTexto(data.meta_margem)}
          icon={Percent}
          tone="slate"
        />
        {totais.custo_sem_cliente > 0 && (
          <StatCard
            label="Sem cliente"
            value={brl(totais.custo_sem_cliente)}
            sub="Pessoas sem cliente ou sem função"
            icon={UserX}
            tone="red"
            compactValue
          />
        )}
      </StatCardGrid>

      {aviso}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <MensalAnualToggle anual={anual} onChange={setAnual} />
          <span className="text-[13px] text-muted-foreground">
            Ordenado por margem, menor primeiro. Clique num cliente para ver de onde vem o custo.
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="mb-0">
            <Link to="/financeiro/atribuicao">Atribuir equipe</Link>
          </Button>
          {canSeeFinancials === true && (
            <Button variant="ghost" size="sm" className="mb-0" onClick={exportar}>
              <Download aria-hidden="true" />
              Exportar CSV
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <div className="min-w-0 flex-[999_1_640px] overflow-hidden rounded-xl border border-border bg-card">
          <RentabilidadeTabela
            linhas={linhas}
            total={total}
            funcoes={data.funcoes}
            anual={anual}
            access={access}
            selecionadoId={selecionado?.cliente_id ?? null}
            onSelect={setSelecionadoId}
          />
        </div>
        <aside
          aria-label="Detalhe do cliente"
          className="min-w-0 flex-[1_1_340px] rounded-xl border border-border bg-card p-5"
        >
          <RentabilidadeDetalhe
            cliente={selecionado}
            funcoes={data.funcoes}
            metaMargem={data.meta_margem}
            access={access}
          />
        </aside>
      </div>
      {dialogo}
    </div>
  );
}
