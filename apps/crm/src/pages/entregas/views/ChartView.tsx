import { useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Bar, getElementAtEvent } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from 'chart.js';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, UserCheck } from 'lucide-react';

import { StatCard } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import { getChartTheme, useIsDark, type ChartTheme } from '@/lib/chartTheme';
import type { BoardCard } from '../hooks/useEntregasData';
import {
  DEADLINE_STATUS,
  DEADLINE_STATUS_ORDER,
  computeDeadlineStats,
  type DeadlineStatus,
} from '../deadlineStatus';
import { formatEtapaPrazo, matchesEtapaPrazo } from '../etapaPrazo';
import type { FilterState } from '../components/EntregasFilters';
import {
  ROW_CAP,
  aguardandoClienteCount,
  aguardandoClienteEtapaNames,
  buildAgingBuckets,
  buildClienteRows,
  buildEtapaRows,
  buildResponsavelRows,
  selectUpcoming,
  type AgingBucket,
  type StackedRow,
  type UpcomingTab,
} from './chartViewData';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

/** Most chips the "Próximos vencimentos" row shows before the "+N" button. */
const CHIP_CAP = 12;

const STATUS_SEMANTIC: Record<DeadlineStatus, keyof ChartTheme['semantic']> = {
  em_dia: 'success',
  urgente: 'warning',
  atrasado: 'danger',
};

const UPCOMING_TABS: { value: UpcomingTab; label: string; empty: string }[] = [
  { value: 'hoje', label: 'Hoje', empty: 'Nada vence hoje. Bom sinal.' },
  { value: 'semana', label: 'Esta semana', empty: 'Semana livre de vencimentos.' },
  { value: 'atrasadas', label: 'Atrasadas', empty: 'Nenhuma entrega atrasada.' },
];

const EMPTY_ROWS = 'Nenhuma entrega encontrada. Ajuste os filtros.';

export interface ChartViewProps {
  /** Cards already narrowed by the page filters. */
  cards: BoardCard[];
  /** Unfiltered card count, for the "de N fluxos" captions. */
  totalCards: number;
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  onCardClick: (card: BoardCard) => void;
  onGoToView: (view: 'kanban' | 'list') => void;
}

/** today - n days as 'YYYY-MM-DD', in local time (the filter inputs' format). */
function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v) => b.includes(v));
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function SectionCard({
  title,
  caption,
  action,
  footer,
  children,
}: {
  title: string;
  caption: string;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card animate-up" style={{ padding: '1rem 1.15rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '0.75rem',
        }}
      >
        <div>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 600, margin: 0 }}>{title}</h3>
          <p
            style={{
              fontSize: '0.72rem',
              color: 'var(--text-muted)',
              margin: '0.15rem 0 0',
            }}
          >
            {caption}
          </p>
        </div>
        {action}
      </div>
      <div style={{ marginTop: '0.9rem' }}>{children}</div>
      {footer && (
        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '0.75rem 0 0' }}>
          {footer}
        </p>
      )}
    </div>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        fontSize: '0.8rem',
        color: 'var(--text-muted)',
        margin: 0,
        padding: '2rem 0',
        textAlign: 'center',
      }}
    >
      {children}
    </p>
  );
}

/** Horizontal stacked bar: one row per grupo, one dataset per status. */
function StackedBarChart({
  rows,
  theme,
  ariaLabel,
  onSegment,
}: {
  rows: StackedRow[];
  theme: ChartTheme;
  ariaLabel: string;
  onSegment: (row: StackedRow, status: DeadlineStatus) => void;
}) {
  const chartRef = useRef<ChartJS<'bar'>>(null);

  const data = useMemo(
    () => ({
      labels: rows.map((r) => r.label),
      datasets: DEADLINE_STATUS_ORDER.map((status) => ({
        label: DEADLINE_STATUS[status].label,
        data: rows.map((r) => r.counts[status]),
        backgroundColor: theme.semantic[STATUS_SEMANTIC[status]],
        borderWidth: 0,
        maxBarThickness: 18,
      })),
    }),
    [rows, theme],
  );

  const options = useMemo<ChartOptions<'bar'>>(
    () => ({
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true,
          ticks: { color: theme.text, font: theme.font, precision: 0 },
          grid: { color: theme.grid },
        },
        y: {
          stacked: true,
          ticks: { color: theme.text, font: theme.font },
          grid: { display: false },
        },
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: theme.text, font: theme.font, boxWidth: 10 },
        },
        tooltip: theme.tooltip,
      },
    }),
    [theme],
  );

  function handleClick(event: MouseEvent<HTMLCanvasElement>) {
    const chart = chartRef.current;
    if (!chart) return;
    const [element] = getElementAtEvent(chart, event);
    if (!element) return;
    const row = rows[element.index];
    const status = DEADLINE_STATUS_ORDER[element.datasetIndex];
    if (!row || !status) return;
    onSegment(row, status);
  }

  if (rows.length === 0) return <EmptyLine>{EMPTY_ROWS}</EmptyLine>;

  return (
    <div style={{ position: 'relative', height: Math.max(200, rows.length * 34) }}>
      <Bar
        ref={chartRef}
        data={data}
        options={options}
        onClick={handleClick}
        role="img"
        aria-label={ariaLabel}
      />
    </div>
  );
}

/** Vertical bar with one column per faixa de atraso. */
function AgingBarChart({
  buckets,
  theme,
  onBucket,
}: {
  buckets: AgingBucket[];
  theme: ChartTheme;
  onBucket: (bucket: AgingBucket) => void;
}) {
  const chartRef = useRef<ChartJS<'bar'>>(null);

  const data = useMemo(
    () => ({
      labels: buckets.map((b) => b.label),
      datasets: [
        {
          label: 'Atrasadas',
          data: buckets.map((b) => b.count),
          backgroundColor: theme.semantic.danger,
          borderWidth: 0,
          maxBarThickness: 46,
        },
      ],
    }),
    [buckets, theme],
  );

  const options = useMemo<ChartOptions<'bar'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: { color: theme.text, font: theme.font },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { color: theme.text, font: theme.font, precision: 0 },
          grid: { color: theme.grid },
        },
      },
      plugins: { legend: { display: false }, tooltip: theme.tooltip },
    }),
    [theme],
  );

  function handleClick(event: MouseEvent<HTMLCanvasElement>) {
    const chart = chartRef.current;
    if (!chart) return;
    const [element] = getElementAtEvent(chart, event);
    if (!element) return;
    const bucket = buckets[element.index];
    if (!bucket) return;
    onBucket(bucket);
  }

  return (
    <div style={{ position: 'relative', height: 220 }}>
      <Bar
        ref={chartRef}
        data={data}
        options={options}
        onClick={handleClick}
        role="img"
        aria-label="Gráfico de barras: idade das entregas atrasadas"
      />
    </div>
  );
}

/** One "Próximos vencimentos" chip: cliente, título do fluxo, etapa e prazo. */
function UpcomingChip({ card, onClick }: { card: BoardCard; onClick: () => void }) {
  const prazo = formatEtapaPrazo(card.deadline);
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minWidth: 210,
        maxWidth: 210,
        textAlign: 'left',
        background: 'var(--surface-1)',
        border: '1px solid var(--border-color)',
        borderRadius: 10,
        padding: '0.6rem 0.7rem',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem',
          marginBottom: '0.3rem',
        }}
      >
        {card.clienteAvatarUrl ? (
          <img
            src={card.clienteAvatarUrl}
            alt=""
            loading="lazy"
            decoding="async"
            style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              objectFit: 'cover',
              flexShrink: 0,
            }}
          />
        ) : (
          <span
            aria-hidden
            style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: card.cliente?.cor || 'var(--surface-hover)',
              color: 'var(--dark)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.45rem',
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {card.cliente ? getInitials(card.cliente.nome) : ''}
          </span>
        )}
        <span
          style={{
            fontSize: '0.7rem',
            color: 'var(--text-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {card.cliente?.nome ?? 'Sem cliente'}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '0.65rem',
            fontWeight: 700,
            color: prazo.color,
            flexShrink: 0,
          }}
        >
          {prazo.shortLabel}
        </span>
      </div>
      <div
        style={{
          fontSize: '0.78rem',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {card.workflow.titulo}
      </div>
      <div
        style={{
          fontSize: '0.68rem',
          color: 'var(--text-muted)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        etapa: {card.etapa.nome}
      </div>
    </button>
  );
}

/**
 * "Visão geral": o cockpit operacional das entregas. Cada KPI, barra e chip
 * aplica o filtro correspondente no board, então tudo aqui deriva dos cards já
 * filtrados que a página passa.
 */
export function ChartView({
  cards,
  totalCards,
  filters,
  onFiltersChange,
  onCardClick,
  onGoToView,
}: ChartViewProps) {
  const isDark = useIsDark();
  const theme = useMemo(() => getChartTheme(isDark), [isDark]);

  const [upcomingTab, setUpcomingTab] = useState<UpcomingTab>('hoje');

  const stats = useMemo(() => computeDeadlineStats(cards), [cards]);
  // Counted with the very predicate the card's click applies (filterPrazo
  // 'hoje'), so the number and the board it opens can never disagree. That
  // includes cards já estouradas cujo prazo cai hoje, which the "Próximos
  // vencimentos" tab deliberately leaves out.
  const vencemHoje = useMemo(
    () => cards.filter((card) => matchesEtapaPrazo(card, ['hoje'], '', '')).length,
    [cards],
  );
  const aguardandoTotal = useMemo(() => aguardandoClienteCount(cards), [cards]);
  const aguardandoEtapas = useMemo(() => aguardandoClienteEtapaNames(cards), [cards]);

  const clienteRows = useMemo(() => buildClienteRows(cards), [cards]);
  const responsavelRows = useMemo(() => buildResponsavelRows(cards), [cards]);
  const etapaRows = useMemo(() => buildEtapaRows(cards), [cards]);
  const agingBuckets = useMemo(() => buildAgingBuckets(cards), [cards]);

  const upcoming = useMemo(() => selectUpcoming(cards, upcomingTab), [cards, upcomingTab]);
  const upcomingShown = upcoming.slice(0, CHIP_CAP);
  const upcomingExtra = upcoming.length - upcomingShown.length;
  const activeTab = UPCOMING_TABS.find((t) => t.value === upcomingTab) ?? UPCOMING_TABS[0];

  const sub = `de ${totalCards} fluxos`;
  const statusActive = (status: DeadlineStatus) =>
    filters.filterStatus.length === 1 && filters.filterStatus[0] === status;
  const hojeActive = filters.filterPrazo.length === 1 && filters.filterPrazo[0] === 'hoje';
  const aguardandoActive =
    aguardandoEtapas.length > 0 &&
    filters.filterEtapas.length > 0 &&
    sameSet(filters.filterEtapas, aguardandoEtapas);
  // With nothing waiting on the cliente there is no etapa to filter by, and a
  // click would only blank whatever etapa filter is already applied. The card
  // stays a plain, non-clickable KPI in that case.
  const aguardandoClickable = aguardandoEtapas.length > 0 || aguardandoActive;

  function toggleStatus(status: DeadlineStatus) {
    onFiltersChange({ ...filters, filterStatus: statusActive(status) ? [] : [status] });
  }

  function toggleVencemHoje() {
    onFiltersChange({ ...filters, filterPrazo: hojeActive ? [] : ['hoje'] });
  }

  function toggleAguardandoCliente() {
    onFiltersChange({ ...filters, filterEtapas: aguardandoActive ? [] : aguardandoEtapas });
  }

  function verNaLista() {
    if (upcomingTab === 'atrasadas') {
      onFiltersChange({ ...filters, filterStatus: ['atrasado'] });
    } else {
      onFiltersChange({
        ...filters,
        filterPrazo: [upcomingTab === 'hoje' ? 'hoje' : 'proximos7'],
      });
    }
    onGoToView('list');
  }

  const idadeCaption =
    stats.atrasado === 0
      ? 'nenhum prazo estourado no momento'
      : stats.atrasado === 1
        ? 'há quanto tempo a entrega atrasada está estourada'
        : `há quanto tempo as ${stats.atrasado} atrasadas estão estouradas`;

  // Every section below has an empty state written for a healthy board
  // ("Nenhuma entrega atrasada", "Semana livre de vencimentos"). With nothing
  // left to show they all celebrate at once, which reads as good news when the
  // truth is that the filters excluded everything. One honest card instead.
  if (cards.length === 0) {
    return (
      <div
        className="card animate-up"
        style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}
      >
        <p>{EMPTY_ROWS}</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <StatCardGrid maxCols={5} className="animate-up">
        <StatCard
          label="Atrasadas"
          value={stats.atrasado}
          icon={AlertTriangle}
          tone="red"
          sub={sub}
          onClick={() => toggleStatus('atrasado')}
          active={statusActive('atrasado')}
        />
        <StatCard
          label="Urgentes (24h)"
          value={stats.urgente}
          icon={Clock}
          tone="amber"
          sub={sub}
          onClick={() => toggleStatus('urgente')}
          active={statusActive('urgente')}
        />
        <StatCard
          label="Em dia"
          value={stats.em_dia}
          icon={CheckCircle2}
          tone="green"
          sub={sub}
          onClick={() => toggleStatus('em_dia')}
          active={statusActive('em_dia')}
        />
        <StatCard
          label="Vencem hoje"
          value={vencemHoje}
          icon={CalendarClock}
          tone="amber"
          sub={sub}
          onClick={toggleVencemHoje}
          active={hojeActive}
        />
        <StatCard
          label="Aguardando cliente"
          value={aguardandoTotal}
          icon={UserCheck}
          tone="blue"
          sub={sub}
          onClick={aguardandoClickable ? toggleAguardandoCliente : undefined}
          active={aguardandoActive}
        />
      </StatCardGrid>

      <SectionCard
        title="Próximos vencimentos"
        caption="clique num card para abrir o fluxo"
        action={
          <div
            role="tablist"
            aria-label="Período dos vencimentos"
            style={{
              display: 'flex',
              gap: 2,
              background: 'var(--surface-1)',
              borderRadius: 8,
              padding: 2,
              flexShrink: 0,
            }}
          >
            {UPCOMING_TABS.map((tab) => {
              const selected = tab.value === upcomingTab;
              return (
                <button
                  key={tab.value}
                  id={`vencimentos-tab-${tab.value}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setUpcomingTab(tab.value)}
                  style={{
                    padding: '0.25rem 0.65rem',
                    fontSize: '0.72rem',
                    fontWeight: selected ? 600 : 500,
                    borderRadius: 6,
                    border: 'none',
                    cursor: 'pointer',
                    background: selected ? 'var(--surface-3)' : 'transparent',
                    color: selected ? 'var(--text-main)' : 'var(--text-muted)',
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        }
      >
        <div
          role="tabpanel"
          aria-labelledby={`vencimentos-tab-${upcomingTab}`}
          className={upcomingShown.length === 0 ? undefined : 'no-scrollbar'}
          style={
            upcomingShown.length === 0
              ? undefined
              : { display: 'flex', gap: '0.75rem', overflowX: 'auto' }
          }
        >
          {upcomingShown.length === 0 ? (
            <EmptyLine>{activeTab.empty}</EmptyLine>
          ) : (
            <>
              {upcomingShown.map((card) => (
                <UpcomingChip
                  key={card.workflow.id}
                  card={card}
                  onClick={() => onCardClick(card)}
                />
              ))}
              {upcomingExtra > 0 && (
                <button
                  type="button"
                  onClick={verNaLista}
                  style={{
                    minWidth: 130,
                    flexShrink: 0,
                    border: '1px dashed var(--border-color)',
                    borderRadius: 10,
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    fontSize: '0.72rem',
                    cursor: 'pointer',
                  }}
                >
                  +{upcomingExtra} · ver na lista
                </button>
              )}
            </>
          )}
        </div>
      </SectionCard>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: '1.5rem',
        }}
      >
        <SectionCard
          title="Situação por cliente"
          caption="clique num segmento para filtrar por cliente e status"
          footer={clienteRows.length === ROW_CAP ? 'mostrando os 10 clientes de maior risco' : null}
        >
          <StackedBarChart
            rows={clienteRows}
            theme={theme}
            ariaLabel="Gráfico de barras: situação das entregas por cliente"
            onSegment={(row, status) => {
              if (!row.clickable) return;
              onFiltersChange({
                ...filters,
                filterClientes: [Number(row.key)],
                filterStatus: [status],
              });
            }}
          />
        </SectionCard>

        <SectionCard
          title="Carga por responsável"
          caption="quem está afogado e quem tem folga. Clique para filtrar"
          footer={
            responsavelRows.length === ROW_CAP
              ? 'mostrando os 10 responsáveis de maior risco'
              : null
          }
        >
          <StackedBarChart
            rows={responsavelRows}
            theme={theme}
            ariaLabel="Gráfico de barras: situação das entregas por responsável"
            onSegment={(row, status) => {
              if (!row.clickable) return;
              onFiltersChange({
                ...filters,
                filterMembros: [Number(row.key)],
                filterStatus: [status],
              });
            }}
          />
        </SectionCard>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: '1.5rem',
        }}
      >
        <SectionCard
          title="Fluxos por etapa"
          caption="onde o trabalho está acumulado agora"
          footer={etapaRows.length === ROW_CAP ? 'mostrando as 10 etapas com mais fluxos' : null}
        >
          <StackedBarChart
            rows={etapaRows}
            theme={theme}
            ariaLabel="Gráfico de barras: situação das entregas por etapa"
            onSegment={(row) => {
              if (!row.clickable) return;
              onFiltersChange({ ...filters, filterEtapas: [row.key] });
            }}
          />
        </SectionCard>

        <SectionCard
          title="Idade dos atrasos"
          caption={idadeCaption}
          footer={stats.atrasado > 0 ? 'clique numa faixa para filtrar por atrasado e prazo' : null}
        >
          {stats.atrasado === 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.6rem',
                padding: '2.5rem 0',
              }}
            >
              <CheckCircle2
                style={{ width: 32, height: 32, color: 'var(--success)' }}
                aria-hidden
              />
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Nenhuma entrega atrasada
              </span>
            </div>
          ) : (
            <AgingBarChart
              buckets={agingBuckets}
              theme={theme}
              onBucket={(bucket) =>
                onFiltersChange({
                  ...filters,
                  filterStatus: ['atrasado'],
                  // matchesEtapaPrazo ORs the presets with the custom range, so a
                  // preset still applied from an earlier click (the "Vencem hoje"
                  // KPI, say) would WIDEN this drill-down instead of narrowing it.
                  filterPrazo: [],
                  filterPrazoFrom: bucket.fromDaysAgo == null ? '' : isoDaysAgo(bucket.fromDaysAgo),
                  filterPrazoTo: isoDaysAgo(bucket.toDaysAgo),
                })
              }
            />
          )}
        </SectionCard>
      </div>
    </div>
  );
}
