import { useState, type ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getInitials } from '@/lib/initials';
import type { ChartTheme } from '@/lib/chartTheme';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import type { BoardCard } from '../hooks/useEntregasData';
import { DEADLINE_STATUS, DEADLINE_STATUS_ORDER, type DeadlineStatus } from '../deadlineStatus';
import { formatEtapaPrazo } from '../etapaPrazo';
import {
  ROW_CAP,
  type AgingBucket,
  type StackedRow,
  type UpcomingTab,
} from '../views/chartViewData';
import './viewsPhone.css';
import { ClienteFoto } from '@/components/ClienteFoto';

const STATUS_SEMANTIC: Record<DeadlineStatus, keyof ChartTheme['semantic']> = {
  em_dia: 'success',
  urgente: 'warning',
  atrasado: 'danger',
};

/** Riskiest first in the text, as the eye reads a row. */
const STATUS_TEXT_ORDER: DeadlineStatus[] = ['atrasado', 'urgente', 'em_dia'];

export interface ChartViewPhoneProps {
  /** Filters excluded every card: one honest empty note instead of the sections. */
  empty: boolean;
  emptyText: string;
  postProcessesEnabled?: boolean;
  onGoToKanban?: () => void;
  theme: ChartTheme;

  stats: Record<DeadlineStatus, number>;
  vencemHoje: number;
  aguardandoTotal: number;
  statusActive: (status: DeadlineStatus) => boolean;
  hojeActive: boolean;
  aguardandoActive: boolean;
  aguardandoClickable: boolean;
  onToggleStatus: (status: DeadlineStatus) => void;
  onToggleVencemHoje: () => void;
  onToggleAguardando: () => void;

  upcomingTabs: { value: UpcomingTab; label: string; empty: string }[];
  upcomingTab: UpcomingTab;
  onUpcomingTabChange: (tab: UpcomingTab) => void;
  upcomingShown: BoardCard[];
  upcomingExtra: number;
  onVerNaLista: () => void;
  onCardClick: (card: BoardCard) => void;

  clienteRows: StackedRow[];
  responsavelRows: StackedRow[];
  etapaRows: StackedRow[];
  agingBuckets: AgingBucket[];
  idadeCaption: string;
  onClienteSegment: (row: StackedRow, status: DeadlineStatus) => void;
  onResponsavelSegment: (row: StackedRow, status: DeadlineStatus) => void;
  onEtapaRow: (row: StackedRow) => void;
  onAgingBucket: (bucket: AgingBucket) => void;
}

function Tile({
  label,
  value,
  tone,
  active,
  wide,
  onClick,
}: {
  label: string;
  value: number;
  tone?: 'red' | 'amber' | 'green' | 'blue';
  active: boolean;
  wide?: boolean;
  onClick?: () => void;
}) {
  const cls = cn(
    'phone-ent-v-tile',
    wide && 'phone-ent-v-tile--wide',
    active && 'phone-ent-v-tile--active',
  );
  const content = (
    <>
      <span className={cn('phone-ent-v-tile__value', tone && `phone-ent-v-tone--${tone}`)}>
        {value}
      </span>
      <span className="phone-ent-v-tile__label">{label}</span>
    </>
  );
  // Same rule as the desktop KPI: without a filter to apply it is a plain number.
  if (!onClick) return <div className={cls}>{content}</div>;
  return (
    <button type="button" className={cls} aria-pressed={active} onClick={onClick}>
      {content}
    </button>
  );
}

function Section({
  title,
  caption,
  footer,
  children,
}: {
  title: string;
  caption: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="phone-ent-v-section">
      <h2 className="phone-ent-v-title">{title}</h2>
      <p className="phone-ent-v-caption">{caption}</p>
      {children}
      {footer && <p className="phone-ent-v-footnote">{footer}</p>}
    </section>
  );
}

const STATUS_COUNT_WORD: Record<DeadlineStatus, [string, string]> = {
  atrasado: ['atrasada', 'atrasadas'],
  urgente: ['urgente', 'urgentes'],
  em_dia: ['em dia', 'em dia'],
};

function countsText(row: StackedRow): string {
  return STATUS_TEXT_ORDER.filter((s) => row.counts[s] > 0)
    .map((s) => {
      const n = row.counts[s];
      return `${n} ${STATUS_COUNT_WORD[s][n === 1 ? 0 : 1]}`;
    })
    .join(' · ');
}

/** One stacked-bar row: label, counts as text, and the proportional bar. */
function BarRow({
  row,
  theme,
  onClick,
}: {
  row: StackedRow;
  theme: ChartTheme;
  onClick?: () => void;
}) {
  const body = (
    <span className="phone-cell__body phone-ent-v-bar-row">
      <span className="phone-ent-v-bar-row__top">
        <span className="phone-ent-v-bar-row__label">{row.label}</span>
        <span className="phone-ent-v-bar-row__counts">{countsText(row)}</span>
      </span>
      <span className="phone-ent-v-bar" aria-hidden="true">
        {DEADLINE_STATUS_ORDER.map((s) =>
          row.counts[s] > 0 ? (
            <span
              key={s}
              className="phone-ent-v-bar__seg"
              style={{
                width: `${(row.counts[s] / Math.max(1, row.total)) * 100}%`,
                background: theme.semantic[STATUS_SEMANTIC[s]],
              }}
            />
          ) : null,
        )}
      </span>
    </span>
  );
  return (
    <li className="phone-cell">
      {onClick ? (
        <button type="button" className="phone-cell__main" onClick={onClick}>
          {body}
        </button>
      ) : (
        <div className="phone-cell__main">{body}</div>
      )}
    </li>
  );
}

function Legend({ theme }: { theme: ChartTheme }) {
  return (
    <p className="phone-ent-v-legend" aria-hidden="true">
      {DEADLINE_STATUS_ORDER.map((s) => (
        <span key={s} className="phone-ent-v-legend__item">
          <span
            className="phone-ent-v-legend__dot"
            style={{ background: theme.semantic[STATUS_SEMANTIC[s]] }}
          />
          {DEADLINE_STATUS[s].label}
        </span>
      ))}
    </p>
  );
}

function SomenteFluxos({ onGoToKanban }: { onGoToKanban?: () => void }) {
  return (
    <p className="phone-ent-v-note phone-ent-v-note--inline">
      Somente fluxos. Posts individuais aparecem no{' '}
      <button type="button" className="phone-ent-v-link" onClick={onGoToKanban}>
        quadro
      </button>
      .
    </p>
  );
}

type SegmentTarget = { kind: 'cliente' | 'responsavel'; row: StackedRow };

/**
 * "Visão geral" below 768px: the same KPIs, vencimentos and breakdowns as the desktop
 * cockpit, as tiles and grouped rows. Every tap applies the very filter the desktop
 * control applies (the handlers come from ChartView). A stacked bar's segments are too
 * small to tap on a phone, so a cliente/responsável row opens an action sheet with one
 * choice per non-empty status instead.
 */
export function ChartViewPhone(p: ChartViewPhoneProps) {
  const [segmentTarget, setSegmentTarget] = useState<SegmentTarget | null>(null);

  if (p.empty) {
    return (
      <div className="phone-ent-v">
        <p className="phone-ent-v-note">{p.emptyText}</p>
        {p.postProcessesEnabled && <SomenteFluxos onGoToKanban={p.onGoToKanban} />}
      </div>
    );
  }

  const activeTab = p.upcomingTabs.find((t) => t.value === p.upcomingTab) ?? p.upcomingTabs[0];
  const target = segmentTarget;

  return (
    <div className="phone-ent-v">
      {p.postProcessesEnabled && <SomenteFluxos onGoToKanban={p.onGoToKanban} />}

      <div className="phone-ent-v-tiles">
        <Tile
          label="Atrasadas"
          value={p.stats.atrasado}
          tone="red"
          active={p.statusActive('atrasado')}
          onClick={() => p.onToggleStatus('atrasado')}
        />
        <Tile
          label="Urgentes (24h)"
          value={p.stats.urgente}
          tone="amber"
          active={p.statusActive('urgente')}
          onClick={() => p.onToggleStatus('urgente')}
        />
        <Tile
          label="Vencem hoje"
          value={p.vencemHoje}
          active={p.hojeActive}
          onClick={p.onToggleVencemHoje}
        />
        <Tile
          label="Aguardando cliente"
          value={p.aguardandoTotal}
          tone="blue"
          active={p.aguardandoActive}
          onClick={p.aguardandoClickable ? p.onToggleAguardando : undefined}
        />
        <Tile
          label="Em dia"
          value={p.stats.em_dia}
          tone="green"
          wide
          active={p.statusActive('em_dia')}
          onClick={() => p.onToggleStatus('em_dia')}
        />
      </div>

      <Section title="Próximos vencimentos" caption="toque num fluxo para abri-lo">
        <SegmentedControl
          aria-label="Período dos vencimentos"
          semantics="tablist"
          className="phone-ent-v-segmented"
          options={p.upcomingTabs.map((t) => ({
            value: t.value,
            label: t.label,
            id: `vencimentos-phone-tab-${t.value}`,
            controls: 'vencimentos-phone-panel',
          }))}
          value={p.upcomingTab}
          onChange={p.onUpcomingTabChange}
        />
        <div
          id="vencimentos-phone-panel"
          role="tabpanel"
          aria-labelledby={`vencimentos-phone-tab-${p.upcomingTab}`}
        >
          {p.upcomingShown.length === 0 ? (
            <p className="phone-ent-v-empty">{activeTab.empty}</p>
          ) : (
            <GroupedList aria-label="Próximos vencimentos" className="phone-ent-v-group">
              {p.upcomingShown.map((card) => {
                const prazo = formatEtapaPrazo(card.deadline);
                return (
                  <Cell
                    key={card.workflow.id}
                    icon={
                      <ClienteFoto
                        srcs={[card.clienteAvatarUrl, card.cliente?.foto_url]}
                        alt=""
                        className="phone-ent-v-avatar"
                        fallback={
                          <span
                            className="phone-ent-v-avatar phone-ent-v-avatar--initials"
                            style={{ background: card.cliente?.cor || undefined }}
                          >
                            {card.cliente ? getInitials(card.cliente.nome) : ''}
                          </span>
                        }
                      />
                    }
                    label={card.workflow.titulo}
                    subtitle={`${card.cliente?.nome ?? 'Sem cliente'} · etapa: ${card.etapa.nome}`}
                    value={<span style={{ color: prazo.color }}>{prazo.label}</span>}
                    onClick={() => p.onCardClick(card)}
                  />
                );
              })}
              {p.upcomingExtra > 0 && (
                <Cell
                  label={`+${p.upcomingExtra} · ver na lista`}
                  chevron
                  onClick={p.onVerNaLista}
                />
              )}
            </GroupedList>
          )}
        </div>
      </Section>

      <Section
        title="Situação por cliente"
        caption="toque num cliente para filtrar por cliente e status"
        footer={p.clienteRows.length === ROW_CAP ? 'mostrando os 10 clientes de maior risco' : null}
      >
        <GroupedList aria-label="Situação por cliente" className="phone-ent-v-group">
          {p.clienteRows.map((row) => (
            <BarRow
              key={row.key || 'sem'}
              row={row}
              theme={p.theme}
              onClick={row.clickable ? () => setSegmentTarget({ kind: 'cliente', row }) : undefined}
            />
          ))}
        </GroupedList>
        <Legend theme={p.theme} />
      </Section>

      <Section
        title="Carga por responsável"
        caption="quem está afogado e quem tem folga. Toque para filtrar"
        footer={
          p.responsavelRows.length === ROW_CAP
            ? 'mostrando os 10 responsáveis de maior risco'
            : null
        }
      >
        <GroupedList aria-label="Carga por responsável" className="phone-ent-v-group">
          {p.responsavelRows.map((row) => (
            <BarRow
              key={row.key || 'sem'}
              row={row}
              theme={p.theme}
              onClick={
                row.clickable ? () => setSegmentTarget({ kind: 'responsavel', row }) : undefined
              }
            />
          ))}
        </GroupedList>
        <Legend theme={p.theme} />
      </Section>

      <Section
        title="Fluxos por etapa"
        caption="onde o trabalho está acumulado agora"
        footer={p.etapaRows.length === ROW_CAP ? 'mostrando as 10 etapas com mais fluxos' : null}
      >
        <GroupedList aria-label="Fluxos por etapa" className="phone-ent-v-group">
          {p.etapaRows.map((row) => (
            <BarRow
              key={row.key || 'sem'}
              row={row}
              theme={p.theme}
              onClick={row.clickable ? () => p.onEtapaRow(row) : undefined}
            />
          ))}
        </GroupedList>
      </Section>

      <Section
        title="Idade dos atrasos"
        caption={p.idadeCaption}
        footer={p.stats.atrasado > 0 ? 'toque numa faixa para filtrar por atrasado e prazo' : null}
      >
        {p.stats.atrasado === 0 ? (
          <p className="phone-ent-v-empty phone-ent-v-empty--ok">
            <CheckCircle2 aria-hidden="true" />
            Nenhuma entrega atrasada
          </p>
        ) : (
          <GroupedList aria-label="Idade dos atrasos" className="phone-ent-v-group">
            {p.agingBuckets.map((bucket) => (
              <Cell
                key={bucket.label}
                label={bucket.label === '1 dia' ? '1 dia' : `${bucket.label} dias`}
                value={
                  <span className={bucket.count > 0 ? 'phone-ent-v-tone--red' : undefined}>
                    {bucket.count}
                  </span>
                }
                chevron
                onClick={() => p.onAgingBucket(bucket)}
              />
            ))}
          </GroupedList>
        )}
      </Section>

      <ActionSheet
        open={target !== null}
        onOpenChange={(next) => {
          if (!next) setSegmentTarget(null);
        }}
        title={target?.row.label ?? ''}
        message={
          target?.kind === 'responsavel'
            ? 'Filtrar as entregas deste responsável por situação'
            : 'Filtrar as entregas deste cliente por situação'
        }
        actions={
          target
            ? STATUS_TEXT_ORDER.filter((s) => target.row.counts[s] > 0).map((s) => ({
                label: `${DEADLINE_STATUS[s].label} · ${target.row.counts[s]}`,
                onSelect: () =>
                  target.kind === 'cliente'
                    ? p.onClienteSegment(target.row, s)
                    : p.onResponsavelSegment(target.row, s),
              }))
            : []
        }
      />
    </div>
  );
}
