import { useEffect, useMemo, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { QueryErrorCard } from '@/components/QueryErrorCard';
import { getWorkflowAnalytics, NotEntitledError } from '@/services/workflowAnalytics';
import {
  getClientes,
  sortClientesByNome,
  getMembros,
  getWorkflowTemplates,
  type Cliente,
  type Membro,
} from '../../store';
import { buildAnalyticsCsv, csvFilename, downloadCsv } from './csv';
import { getPeriodos, useFluxosFilters } from './useFluxosFilters';
import { KpiRow } from './sections/KpiRow';
import { RitmoChart } from './sections/RitmoChart';
import { AprovacaoSection, temAtividadeAprovacao } from './sections/AprovacaoSection';
import { GargalosTable } from './sections/GargalosTable';
import { EquipeTable } from './sections/EquipeTable';
import { OrigemCard } from './sections/OrigemCard';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { usePageToolbar } from '@/components/layout/PageToolbarContext';
import { FluxosPhone } from './phone/FluxosPhone';
import { isNativeApp } from '@/native/platform';

/** Placeholder that keeps the page's shape while the first read is in flight. */
function LoadingSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }} aria-busy="true">
      <Skeleton style={{ height: 104 }} />
      <Skeleton style={{ height: 320 }} />
      <Skeleton style={{ height: 260 }} />
      <Skeleton style={{ height: 220 }} />
    </div>
  );
}

export default function AnalyticsFluxosPage() {
  const { t: tc } = useTranslation();
  const { t } = useTranslation('analyticsFlows');
  const PERIODOS = getPeriodos();
  const EMPTY_WORKSPACE = t('page.emptyWorkspace');
  const {
    periodo,
    clienteId,
    templateId,
    from,
    to,
    anchorDay,
    hasFilters,
    setPeriodo,
    setClienteId,
    setTemplateId,
  } = useFluxosFilters();
  // Phones (below 768px) get the FFluxos layout; tablet and desktop keep this one.
  const isPhone = !useIsDesktop(768);

  // Same inline pattern as EntregasPage: an app route, not one of the
  // manifest-driven public pages usePageMeta covers, so nothing else would set
  // the tab title and it would keep whatever the previous route left behind.
  // Restoring the prior title on unmount is what stops THIS page's title from
  // leaking into every other route the same way.
  useEffect(() => {
    const previousTitle = document.title;
    document.title = t('page.docTitle');
    return () => {
      document.title = previousTitle;
    };
  }, [t]);

  // Every number on this page comes from this one RPC. The three lists below are
  // for the filter selects and for turning a membro_id into a name; they are
  // never a metric source.
  // `anchorDay` is in the key on purpose. The from/to window re-anchors at
  // midnight, but React Query keys on the queryKey alone and never notices a
  // changed queryFn closure, so without it a tab left open overnight would keep
  // refetching yesterday's window. keepPreviousData covers the swap: the new
  // day's key shows yesterday's numbers until the fresh read lands.
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['workflow-analytics', periodo, clienteId, templateId, anchorDay],
    queryFn: () => getWorkflowAnalytics({ from, to, clienteId, templateId }),
    placeholderData: keepPreviousData,
  });

  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const { data: templates = [] } = useQuery({
    queryKey: ['workflow-templates'],
    queryFn: getWorkflowTemplates,
  });
  const { data: membros = [] } = useQuery({ queryKey: ['membros'], queryFn: getMembros });

  const membrosById = useMemo(() => {
    const map = new Map<number, Membro>();
    for (const membro of membros) {
      if (membro.id !== undefined) map.set(membro.id, membro);
    }
    return map;
  }, [membros]);

  const clientesById = useMemo(() => {
    const map = new Map<number, Cliente>();
    for (const cliente of clientes) {
      if (cliente.id !== undefined) map.set(cliente.id, cliente);
    }
    return map;
  }, [clientes]);

  function handleExport() {
    if (!data) return;
    const nomes = new Map<number, string>();
    for (const [id, membro] of membrosById) nomes.set(id, membro.nome);
    const clienteNomes = new Map<number, string>();
    for (const [id, cliente] of clientesById) clienteNomes.set(id, cliente.nome);
    downloadCsv(buildAnalyticsCsv(data, nomes, clienteNomes), csvFilename(periodo));
  }

  // The print sheet drops the toolbar, so the filters that produced these
  // numbers would vanish with it and the paper would state a period it cannot
  // name. This line is the echo, hidden on screen by `.print-only`.
  const periodoLabel = PERIODOS.find((p) => p.value === periodo)?.label ?? periodo;
  const NAO_IDENTIFICADO = t('page.unidentified');
  const clienteLabel =
    clienteId !== null ? (clientesById.get(clienteId)?.nome ?? NAO_IDENTIFICADO) : t('page.all');
  const templateLabel =
    templateId !== null
      ? (templates.find((tpl) => tpl.id === templateId)?.nome ?? NAO_IDENTIFICADO)
      : t('page.all');

  // "No data" is not "no flows". Approval cycles hang off posts, and a post
  // needs no workflow, so a workspace running entirely on posts avulsos (Post
  // Express) reports zero concluídos and zero ativos while the RPC computed a
  // full aprovacao_cliente block for it. Gating on the KPIs alone would answer
  // that workspace with the onboarding copy and hide the one section that
  // actually had something to say.
  const semDados = data
    ? data.kpis.concluidos === 0 &&
      data.kpis.ativos === 0 &&
      !temAtividadeAprovacao(data.aprovacao_cliente)
    : false;
  // The split below is unchanged: with filters applied, a zero-match still
  // renders the zeroed body (captioned "nenhum fluxo no filtro"), never the
  // onboarding state, which would accuse an established workspace of being new.
  const workspaceVazio = semDados && !hasFilters;
  const filtroSemMatch = semDados && hasFilters;

  const subtitle = (
    <p
      style={{ color: 'var(--text-muted)' }}
      data-tooltip={t('page.hint')}
      data-tooltip-dir="bottom"
    >
      {t('page.subtitle')}
    </p>
  );
  const periodTabs = (
    <div className="page-tabs page-tabs--inline" role="tablist" aria-label={t('page.period')}>
      {PERIODOS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={opt.value === periodo}
          className={`page-tab${opt.value === periodo ? ' active' : ''}`}
          onClick={() => setPeriodo(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
  const headerActions = (
    <>
      <Button variant="outline" onClick={handleExport} disabled={!data}>
        <Download className="h-4 w-4" />
        {t('page.exportCsv')}
      </Button>
      <Button variant="outline" onClick={() => window.print()}>
        <Printer className="h-4 w-4" />
        {t('page.print')}
      </Button>
    </>
  );
  // Inside the iOS app the locked state never mentions plans or upgrades
  // (apps/mobile DECISIONS.md D33).
  const notEntitledCard = isNativeApp() ? (
    <QueryErrorCard
      title={tc('native.lockedTitle', { feature: t('page.lockedFeature') })}
      description={tc('native.lockedBody')}
    />
  ) : (
    <QueryErrorCard title={t('page.notEntitledTitle')} description={t('page.notEntitledDesc')} />
  );
  const inToolbar = usePageToolbar({
    title: t('page.title'),
    subtitle,
    segmented: periodTabs,
    actions: headerActions,
  });

  if (isPhone) {
    let status: ReactNode = null;
    if (isError) {
      status =
        error instanceof NotEntitledError ? (
          notEntitledCard
        ) : (
          <QueryErrorCard onRetry={() => refetch()} />
        );
    } else if (isPending || !data) {
      status = <LoadingSkeleton />;
    } else if (workspaceVazio) {
      status = <p className="phone-an-empty">{EMPTY_WORKSPACE}</p>;
    }
    return (
      <FluxosPhone
        periodo={periodo}
        onPeriodo={setPeriodo}
        clientes={sortClientesByNome(clientes)}
        clienteId={clienteId}
        onClienteId={setClienteId}
        templates={templates}
        templateId={templateId}
        onTemplateId={setTemplateId}
        status={status}
        data={data}
        emptyFiltered={filtroSemMatch}
        clientesById={clientesById}
        membrosById={membrosById}
        canExport={!!data}
        onExport={handleExport}
      />
    );
  }

  return (
    <div
      className="page-content analytics-fluxos-page"
      style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
    >
      {!inToolbar && (
        <header className="header header--flush animate-up">
          <div className="header-title">
            <h1>{t('page.title')}</h1>
            {subtitle}
          </div>
          <div
            className="header-actions analytics-fluxos-actions"
            style={{ display: 'flex', gap: '0.5rem' }}
          >
            {headerActions}
          </div>
        </header>
      )}

      <p className="print-only analytics-fluxos-print-echo">
        {t('page.printEcho', {
          periodo: periodoLabel,
          cliente: clienteLabel,
          template: templateLabel,
        })}
      </p>

      <div
        className="animate-up analytics-fluxos-toolbar"
        style={{
          display: 'flex',
          gap: '0.75rem',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        {!inToolbar && periodTabs}

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Select
            value={clienteId !== null ? String(clienteId) : 'all'}
            onValueChange={(v) => setClienteId(v === 'all' ? null : Number(v))}
          >
            <SelectTrigger aria-label={t('page.client')} style={{ minWidth: 160, width: 'auto' }}>
              <SelectValue placeholder={t('page.clientAll')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('page.clientAll')}</SelectItem>
              {sortClientesByNome(clientes).map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={templateId !== null ? String(templateId) : 'all'}
            onValueChange={(v) => setTemplateId(v === 'all' ? null : Number(v))}
          >
            <SelectTrigger aria-label={t('page.template')} style={{ minWidth: 160, width: 'auto' }}>
              <SelectValue placeholder={t('page.templateAll')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('page.templateAll')}</SelectItem>
              {templates.map((tpl) => (
                <SelectItem key={tpl.id} value={String(tpl.id)}>
                  {tpl.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isError ? (
        error instanceof NotEntitledError ? (
          // The route gate (ProtectedRoute) normally catches this first; reaching
          // here means the plan changed under an open tab, so say what is wrong
          // instead of offering a retry that cannot fix it.
          notEntitledCard
        ) : (
          <QueryErrorCard onRetry={() => refetch()} />
        )
      ) : isPending || !data ? (
        <LoadingSkeleton />
      ) : workspaceVazio ? (
        <div
          className="card animate-up"
          style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}
        >
          <p style={{ margin: 0 }}>{EMPTY_WORKSPACE}</p>
        </div>
      ) : (
        <>
          <KpiRow kpis={data.kpis} emptyFiltered={filtroSemMatch} />
          <RitmoChart
            semanas={data.semanas}
            criadosSemConclusao={data.semanas_criados_sem_conclusao}
          />
          <AprovacaoSection
            aprovacao={data.aprovacao_cliente}
            clientesById={clientesById}
            postEventsSince={data.horizonte.post_events_since}
          />
          <GargalosTable etapas={data.etapas} eventosDesde={data.horizonte.workflow_events_since} />
          <EquipeTable
            equipe={data.equipe}
            membrosById={membrosById}
            eventosDesde={data.horizonte.workflow_events_since}
          />
          <OrigemCard origem={data.origem} />
        </>
      )}
    </div>
  );
}
