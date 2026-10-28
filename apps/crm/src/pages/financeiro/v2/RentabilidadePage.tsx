import { useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ChartColumn,
  Download,
  Maximize2,
  Percent,
  UserPlus,
  UserX,
  Users,
  Wallet,
} from 'lucide-react';
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { TableSkeleton } from '@/components/ui/skeletons';
import { useAuth } from '@/context/AuthContext';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { downloadCsv } from '@/lib/csvExport';
import { handleEntitlementMutationError } from '@/lib/entitlement-toast';
import { formatFinancialBRL } from '@/lib/financialAccess';
import { fecharPeriodo, getPeriodos, getRentabilidade, reabrirPeriodo } from '@/store';
import type { PeriodoFinanceiro, RentabilidadeSeeded } from '@/store/financeiroV2';
import { anualizar, formatMargem, separadorDecimal } from './format';
import { MensalAnualToggle } from './MensalAnualToggle';
import { PeriodoSelect } from './PeriodoSelect';
import { rotuloPeriodo } from './periodos';
import {
  direcaoInicial,
  montarCsv,
  montarLinhas,
  nomeArquivoCsv,
  ORDEM_PADRAO,
  ordenarLinhas,
  somarLinhas,
  type ColunaOrdem,
  type Ordenacao,
} from './rentabilidade';
import { RentabilidadeDetalhe } from './RentabilidadeDetalhe';
import { RentabilidadePhone } from './RentabilidadePhone';
import { RentabilidadeTabela } from './RentabilidadeTabela';
import { avisarErroFinanceiro } from './erros';

// Copy of the period actions lives under `rentabilidade.acao.<reabrir|fechar>.*`.
type AcaoPeriodo = 'reabrir' | 'fechar';

/**
 * Financeiro › Rentabilidade: KPIs, the per-client profitability table (A-Z by default,
 * any column sortable, paused clients last) with its side panel and an expanded view, and the
 * period controls. Renders inside the v2 layout,
 * which owns the title, the tab bar and the not-seeded onboarding.
 */
export default function RentabilidadePage() {
  const { t } = useTranslation('financeV2');
  /** "Meta: 55%" with the UI language's decimal mark when the goal has decimals. */
  const metaTexto = (meta: number) =>
    t('rentabilidade.meta', { meta: String(meta).replace('.', separadorDecimal()) });
  const { canSeeFinancials, can, workspaceRole, profile } = useAuth();
  const isDesktop = useIsDesktop(768);
  const qc = useQueryClient();
  const [inicio, setInicio] = useState<string | undefined>(undefined);
  const [anual, setAnual] = useState(false);
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);
  const [acao, setAcao] = useState<AcaoPeriodo | null>(null);
  const [busy, setBusy] = useState(false);
  const [ordem, setOrdem] = useState<Ordenacao>(ORDEM_PADRAO);
  const [expandido, setExpandido] = useState(false);

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
  // The table, the phone list and the CSV all read the rows in the order chosen here.
  const linhas = useMemo(
    () => (data ? ordenarLinhas(montarLinhas(data, anual), ordem) : []),
    [data, anual, ordem],
  );
  const ordenar = (coluna: ColunaOrdem) =>
    setOrdem((atual) =>
      atual.coluna === coluna
        ? { coluna, direcao: atual.direcao === 'asc' ? 'desc' : 'asc' }
        : { coluna, direcao: direcaoInicial(coluna) },
    );
  const total = useMemo(() => somarLinhas(linhas, data?.funcoes ?? []), [linhas, data]);

  const periodos: PeriodoFinanceiro[] = useMemo(() => {
    const lista = periodosQuery.data ?? [];
    if (!data || lista.some((p) => p.inicio === data.periodo.inicio)) return lista;
    return [data.periodo, ...lista];
  }, [periodosQuery.data, data]);

  // Closed/reopened state comes from the period list (the payload of a closed period also
  // reads 'fechado', but the list is what the select and the period actions use).
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
      toast.success(t(`rentabilidade.acao.${qual}.ok`));
    } catch (e) {
      if (!handleEntitlementMutationError(e, profile?.conta_id ?? null))
        avisarErroFinanceiro(e, t(`rentabilidade.acao.${qual}.erro`), qc);
    } finally {
      setBusy(false);
    }
  };

  const exportar = () => {
    if (!data) return;
    downloadCsv(
      montarCsv(linhas, data.funcoes, anual),
      nomeArquivoCsv(rotuloPeriodo(data.periodo), anual),
    );
  };

  const barraPeriodo = (
    <div className="flex flex-wrap items-center gap-2">
      <PeriodoSelect
        aria-label={t('shared.periodo')}
        value={inicio ?? inicioExibido}
        onChange={escolherPeriodo}
        periodos={periodos}
      />
      {data && status === 'fechado' && <Badge variant="neutral">{t('shared.fechado')}</Badge>}
      {data && podeGerirPeriodo && status === 'fechado' && (
        <Button
          variant="outline"
          size="sm"
          className="mb-0"
          disabled={busy}
          onClick={() => setAcao('reabrir')}
        >
          {t('rentabilidade.reabrirPeriodo')}
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
          {t('rentabilidade.fecharPeriodo')}
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
          <p className="text-sm text-muted-foreground">{t('rentabilidade.loadError')}</p>
          <Button
            variant="outline"
            size="sm"
            className="mb-0"
            onClick={() => void rentabilidade.refetch()}
          >
            {t('shared.tentarNovamente')}
          </Button>
          {inicio && (
            <Button
              variant="ghost"
              size="sm"
              className="mb-0"
              onClick={() => escolherPeriodo(undefined)}
            >
              {t('shared.voltarAtual')}
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

  // Right after "Montar" nobody is on a client yet: every row would read 100% margin and
  // the whole team cost sits in "Sem cliente". Say so and point to the matrix.
  const semAtribuicao =
    data.clientes.length > 0 &&
    data.membros.length > 0 &&
    data.clientes.every((c) => c.pessoas.length === 0);
  const avisoAtribuir = semAtribuicao && (
    <div
      role="status"
      aria-label={t('rentabilidade.semAtribuicao.label')}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm"
    >
      <UserPlus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <Trans
          t={t}
          i18nKey="rentabilidade.semAtribuicao.texto"
          components={{ b: <span className="font-semibold" /> }}
        />
      </span>
      <Button asChild size="sm" className="mb-0">
        <Link to="/financeiro/atribuicao">
          {can('financeiro', 'editar') === true
            ? t('rentabilidade.atribuirEquipe')
            : t('rentabilidade.verEquipe')}
        </Link>
      </Button>
    </div>
  );

  const aviso = data.incompleto && (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{t('rentabilidade.incompleto.texto')}</span>
      {status === 'fechado' ? (
        <span className="font-semibold">{t('rentabilidade.incompleto.reabra')}</span>
      ) : (
        <Link to="/financeiro/equipe" className="font-semibold underline">
          {t('rentabilidade.incompleto.informar')}
        </Link>
      )}
    </p>
  );

  const dialogo = (
    <AlertDialog open={acao !== null} onOpenChange={(open) => !open && setAcao(null)}>
      <AlertDialogContent>
        {acao && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{t(`rentabilidade.acao.${acao}.title`)}</AlertDialogTitle>
              <AlertDialogDescription>
                {t(`rentabilidade.acao.${acao}.body`)}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
              <AlertDialogAction disabled={busy} onClick={() => void executarAcao(acao)}>
                {t(`rentabilidade.acao.${acao}.confirm`)}
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
        {avisoAtribuir}
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
          label={t('rentabilidade.kpi.receita')}
          value={brl(totais.receita)}
          sub={t('rentabilidade.kpi.receitaSub', {
            count: ativos,
            arr: brl(totais.receita * 12),
          })}
          icon={Users}
          tone="green"
          compactValue
        />
        <StatCard
          label={t('shared.custoEquipe')}
          value={brl(totais.custo_total)}
          sub={t('rentabilidade.kpi.custoSub', { count: data.membros.length, pct: pctCusto })}
          icon={Wallet}
          tone="amber"
          compactValue
        />
        <StatCard
          label={t('rentabilidade.kpi.lucro')}
          value={brl(totais.lucro)}
          sub={t('rentabilidade.kpi.lucroSub', { valor: brl(totais.lucro * 12) })}
          icon={ChartColumn}
          tone="violet"
          compactValue
        />
        <StatCard
          label={t('rentabilidade.kpi.margem')}
          value={formatMargem(totais.margem)}
          sub={metaTexto(data.meta_margem)}
          icon={Percent}
          tone="slate"
        />
        {totais.custo_sem_cliente > 0 && (
          <StatCard
            label={t('shared.semCliente')}
            value={brl(totais.custo_sem_cliente)}
            sub={t('rentabilidade.kpi.semClienteSub')}
            icon={UserX}
            tone="red"
            compactValue
          />
        )}
      </StatCardGrid>

      {avisoAtribuir}
      {aviso}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <MensalAnualToggle anual={anual} onChange={setAnual} />
          <span className="text-[13px] text-muted-foreground">{t('rentabilidade.dica')}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" className="mb-0" onClick={() => setExpandido(true)}>
            <Maximize2 aria-hidden="true" />
            {t('rentabilidade.expandir')}
          </Button>
          <Button asChild variant="outline" size="sm" className="mb-0">
            <Link to="/financeiro/atribuicao">{t('rentabilidade.atribuirEquipe')}</Link>
          </Button>
          {canSeeFinancials === true && (
            <Button variant="ghost" size="sm" className="mb-0" onClick={exportar}>
              <Download aria-hidden="true" />
              {t('rentabilidade.exportar')}
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
            ordem={ordem}
            onOrdenar={ordenar}
          />
          {/* The footer sums the clients: the KPIs also count the cost outside them. */}
          {totais.custo_sem_cliente > 0 && (
            <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              {t(anual ? 'rentabilidade.custoSemClienteAnual' : 'rentabilidade.custoSemCliente', {
                valor: brl(anualizar(totais.custo_sem_cliente, anual)),
              })}
            </p>
          )}
        </div>
        <aside
          aria-label={t('rentabilidade.detalheLabel')}
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
      <Dialog open={expandido} onOpenChange={setExpandido}>
        <DialogContent layout="fullscreen" className="flex flex-col">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-3">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base font-semibold">
                {t('rentabilidade.expandidoTitle')}
              </DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground">
                {t('rentabilidade.expandidoDescricao', { periodo: rotuloPeriodo(data.periodo) })}
              </DialogDescription>
            </div>
            <MensalAnualToggle anual={anual} onChange={setAnual} />
            <DialogClose asChild>
              <Button variant="outline" size="sm" className="mb-0">
                {t('actions.close')}
              </Button>
            </DialogClose>
          </div>
          {/* The table's own container is the scroller, so its header row and client column stick. */}
          <div className="min-h-0 flex-1 p-4 [&_[data-slot=table-container]]:h-full">
            <div className="h-full overflow-hidden rounded-xl border border-border bg-card">
              <RentabilidadeTabela
                linhas={linhas}
                total={total}
                funcoes={data.funcoes}
                anual={anual}
                access={access}
                selecionadoId={null}
                ordem={ordem}
                onOrdenar={ordenar}
                fixarCabecalho
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {dialogo}
    </div>
  );
}
