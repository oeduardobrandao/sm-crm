import { useState, type ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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

/** Plural keys under `chart.statusCount`, one per status. */
const STATUS_COUNT_KEY: Record<DeadlineStatus, string> = {
  atrasado: 'chart.statusCount.atrasado',
  urgente: 'chart.statusCount.urgente',
  em_dia: 'chart.statusCount.emDia',
};

function countsText(row: StackedRow, t: TFunction<'entregasPhone'>): string {
  return STATUS_TEXT_ORDER.filter((s) => row.counts[s] > 0)
    .map((s) => t(STATUS_COUNT_KEY[s], { count: row.counts[s] }))
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
  const { t } = useTranslation('entregasPhone');
  const body = (
    <span className="phone-cell__body phone-ent-v-bar-row">
      <span className="phone-ent-v-bar-row__top">
        <span className="phone-ent-v-bar-row__label">{row.label}</span>
        <span className="phone-ent-v-bar-row__counts">{countsText(row, t)}</span>
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
  const { t } = useTranslation('entregasPhone');
  return (
    <p className="phone-ent-v-note phone-ent-v-note--inline">
      <Trans
        t={t}
        i18nKey="shared.somenteFluxos"
        components={{
          btn: <button type="button" className="phone-ent-v-link" onClick={onGoToKanban} />,
        }}
      />
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
  const { t } = useTranslation('entregasPhone');
  const [segmentTarget, setSegmentTarget] = useState<SegmentTarget | null>(null);

  if (p.empty) {
    return (
      <div className="phone-ent-v">
        <p className="phone-ent-v-note">{p.emptyText}</p>
        {p.postProcessesEnabled && <SomenteFluxos onGoToKanban={p.onGoToKanban} />}
      </div>
    );
  }

  const activeTab = p.upcomingTabs.find((tab) => tab.value === p.upcomingTab) ?? p.upcomingTabs[0];
  const target = segmentTarget;

  return (
    <div className="phone-ent-v">
      {p.postProcessesEnabled && <SomenteFluxos onGoToKanban={p.onGoToKanban} />}

      <div className="phone-ent-v-tiles">
        <Tile
          label={t('chart.tiles.atrasadas')}
          value={p.stats.atrasado}
          tone="red"
          active={p.statusActive('atrasado')}
          onClick={() => p.onToggleStatus('atrasado')}
        />
        <Tile
          label={t('chart.tiles.urgentes')}
          value={p.stats.urgente}
          tone="amber"
          active={p.statusActive('urgente')}
          onClick={() => p.onToggleStatus('urgente')}
        />
        <Tile
          label={t('chart.tiles.vencemHoje')}
          value={p.vencemHoje}
          active={p.hojeActive}
          onClick={p.onToggleVencemHoje}
        />
        <Tile
          label={t('chart.tiles.aguardandoCliente')}
          value={p.aguardandoTotal}
          tone="blue"
          active={p.aguardandoActive}
          onClick={p.aguardandoClickable ? p.onToggleAguardando : undefined}
        />
        <Tile
          label={t('chart.tiles.emDia')}
          value={p.stats.em_dia}
          tone="green"
          wide
          active={p.statusActive('em_dia')}
          onClick={() => p.onToggleStatus('em_dia')}
        />
      </div>

      <Section title={t('chart.upcoming.title')} caption={t('chart.upcoming.caption')}>
        <SegmentedControl
          aria-label={t('chart.upcoming.periodAria')}
          semantics="tablist"
          className="phone-ent-v-segmented"
          options={p.upcomingTabs.map((tab) => ({
            value: tab.value,
            label: tab.label,
            id: `vencimentos-phone-tab-${tab.value}`,
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
            <GroupedList aria-label={t('chart.upcoming.title')} className="phone-ent-v-group">
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
                    subtitle={t('chart.upcoming.subtitle', {
                      cliente: card.cliente?.nome ?? t('shared.noCliente'),
                      etapa: card.etapa.nome,
                    })}
                    value={<span style={{ color: prazo.color }}>{prazo.label}</span>}
                    onClick={() => p.onCardClick(card)}
                  />
                );
              })}
              {p.upcomingExtra > 0 && (
                <Cell
                  label={t('chart.upcoming.seeInList', { count: p.upcomingExtra })}
                  chevron
                  onClick={p.onVerNaLista}
                />
              )}
            </GroupedList>
          )}
        </div>
      </Section>

      <Section
        title={t('chart.byCliente.title')}
        caption={t('chart.byCliente.caption')}
        footer={p.clienteRows.length === ROW_CAP ? t('chart.byCliente.footer') : null}
      >
        <GroupedList aria-label={t('chart.byCliente.title')} className="phone-ent-v-group">
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
        title={t('chart.byResponsavel.title')}
        caption={t('chart.byResponsavel.caption')}
        footer={p.responsavelRows.length === ROW_CAP ? t('chart.byResponsavel.footer') : null}
      >
        <GroupedList aria-label={t('chart.byResponsavel.title')} className="phone-ent-v-group">
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
        title={t('chart.byEtapa.title')}
        caption={t('chart.byEtapa.caption')}
        footer={p.etapaRows.length === ROW_CAP ? t('chart.byEtapa.footer') : null}
      >
        <GroupedList aria-label={t('chart.byEtapa.title')} className="phone-ent-v-group">
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
        title={t('chart.aging.title')}
        caption={p.idadeCaption}
        footer={p.stats.atrasado > 0 ? t('chart.aging.footer') : null}
      >
        {p.stats.atrasado === 0 ? (
          <p className="phone-ent-v-empty phone-ent-v-empty--ok">
            <CheckCircle2 aria-hidden="true" />
            {t('chart.aging.none')}
          </p>
        ) : (
          <GroupedList aria-label={t('chart.aging.title')} className="phone-ent-v-group">
            {p.agingBuckets.map((bucket) => (
              <Cell
                key={bucket.label}
                // The single-day bucket's label already says "1 dia"; ranges get the unit.
                label={
                  bucket.fromDaysAgo === 1
                    ? bucket.label
                    : t('chart.aging.rangeDays', { range: bucket.label })
                }
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
            ? t('chart.segment.responsavelMessage')
            : t('chart.segment.clienteMessage')
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
