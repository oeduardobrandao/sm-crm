import { useEffect, useMemo, useState } from 'react';
import { addMonths, format, subMonths } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useDateFnsLocale } from '@mesaas/i18n';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import type { Cliente, ClienteData, Membro, Transacao } from '../../../store';
import { formatDate } from '../../../store';
import { formatFinancialBRL, type FinancialAccess } from '@/lib/financialAccess';
import { Chip, ChipRow } from '@/components/mobile/ChipRow';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { PickerCell } from '@/components/mobile/PickerSheet';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import type { DeadlineEvent } from '../camadas/prazos';
import { useConfirmarPagamento } from '../camadas/useConfirmarPagamento';
import { formatDeadlineStatus } from '../deadlineStatus';
import { diaVazio, itensDoDia, refPagamento, type FinanceiroFontes } from '../financeiroDia';
import { NICHE_CALENDARS } from '../nicheCalendars/registry';
import { MesGridPhone } from './MesGridPhone';
import { dotColorMap, type NicheCalendarDef } from '../nicheCalendars/types';
import './calendarioPhone.css';

type Aba = 'financeiro' | 'comemorativas';

/** Dot colours of the month grid, one per kind of item (the desktop pills' colours). */
const DOT = {
  income: 'var(--success)',
  expense: 'var(--danger)',
  deadline: '#a855f7',
  overdue: 'var(--danger)',
  birthday: '#ec4899',
  data: '#6366f1',
} as const;

const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface CalendarioClassicoPhoneProps {
  aba: Aba;
  onAbaChange: (aba: Aba) => void;
  clientes: Cliente[];
  membros: Membro[];
  transacoes: Transacao[];
  deadlineEvents: DeadlineEvent[];
  datasImportantes: ClienteData[];
  canSeeFinancials: FinancialAccess;
  niche: NicheCalendarDef;
  onNicheChange: (key: string) => void;
}

/**
 * The classic Calendário below 768px (Free plans, no Agenda): page header with the
 * Calendário / Datas comemorativas segmented control. Calendário is a compact month
 * grid with one dot per kind of item and the selected day's list under it, receivables
 * and payments confirmable in place (same confirm and payload as desktop). Datas
 * comemorativas is the niche picker, the filters as chips, search, and one grouped list
 * per month.
 */
export function CalendarioClassicoPhone(p: CalendarioClassicoPhoneProps) {
  const { t } = useTranslation('calendario');
  return (
    <div className="phone-cal">
      <PhonePageHeader
        title={p.aba === 'financeiro' ? t('shared.calendarTitle') : p.niche.title}
        subtitle={p.aba === 'financeiro' ? t('shared.monthlyOverview') : p.niche.subtitle}
      >
        <SegmentedControl<Aba>
          aria-label={t('phone.viewAria')}
          className="phone-cal-tabs"
          options={[
            { value: 'financeiro', label: t('shared.calendarTitle') },
            { value: 'comemorativas', label: t('phone.commemorativeTab') },
          ]}
          value={p.aba}
          onChange={p.onAbaChange}
        />
      </PhonePageHeader>
      {p.aba === 'financeiro' ? (
        <MesFinanceiro {...p} />
      ) : (
        <DatasComemorativas niche={p.niche} onNicheChange={p.onNicheChange} />
      )}
    </div>
  );
}

function MesFinanceiro(p: CalendarioClassicoPhoneProps) {
  const { t } = useTranslation('calendario');
  const locale = useDateFnsLocale();
  const [mes, setMes] = useState(() => new Date());
  const [dia, setDia] = useState(() => new Date().getDate());
  const { pedirConfirmacao, dialog } = useConfirmarPagamento(p.canSeeFinancials);
  const year = mes.getFullYear();
  const month = mes.getMonth();
  const fontes: FinanceiroFontes = {
    clientes: p.clientes,
    membros: p.membros,
    deadlineEvents: p.deadlineEvents,
    datasImportantes: p.datasImportantes,
    canSeeFinancials: p.canSeeFinancials,
  };
  const isPaid = (refId: string) => p.transacoes.some((t) => t.referencia_agendamento === refId);

  // A month change keeps the day only when it exists there (31 -> February).
  const mudarMes = (novo: Date) => {
    setMes(novo);
    setDia((d) => Math.min(d, new Date(novo.getFullYear(), novo.getMonth() + 1, 0).getDate()));
  };

  const selecionado = itensDoDia(fontes, year, month, dia);
  const dataSelecionada = new Date(year, month, dia);

  const dotsDoDia = (d: Date) => {
    const itens = itensDoDia(fontes, year, month, d.getDate());
    const dots: string[] = [];
    if (itens.incomes.length) dots.push(DOT.income);
    if (itens.expenses.length) dots.push(DOT.expense);
    if (itens.deadlines.length)
      dots.push(itens.deadlines.some((x) => x.estourado) ? DOT.overdue : DOT.deadline);
    if (itens.birthdays.length) dots.push(DOT.birthday);
    if (itens.datas.length) dots.push(DOT.data);
    return dots;
  };
  const resumoDoDia = (d: Date) => {
    const itens = itensDoDia(fontes, year, month, d.getDate());
    return [
      itens.incomes.length ? t('shared.count.receivables', { count: itens.incomes.length }) : '',
      itens.expenses.length ? t('shared.count.payments', { count: itens.expenses.length }) : '',
      itens.deadlines.length ? t('shared.count.deliveries', { count: itens.deadlines.length }) : '',
      itens.birthdays.length ? t('shared.count.birthdays', { count: itens.birthdays.length }) : '',
      itens.datas.length ? t('shared.count.dates', { count: itens.datas.length }) : '',
    ]
      .filter(Boolean)
      .join(', ');
  };

  return (
    <>
      <MesGridPhone
        mes={mes}
        weekStartsOn={0}
        selecionado={dataSelecionada}
        onSelect={(d) => setDia(d.getDate())}
        dotsDoDia={dotsDoDia}
        resumoDoDia={resumoDoDia}
        cabecalho={
          <div className="phone-cal-month__head">
            <h2 className="phone-cal-month__title">
              {maiuscula(format(mes, t('dateFormat.monthYear'), { locale }))}
            </h2>
            <span className="phone-cal-month__nav">
              <PhoneIconButton
                label={t('ui.previousMonth')}
                onClick={() => mudarMes(subMonths(mes, 1))}
              >
                <ChevronLeft aria-hidden="true" />
              </PhoneIconButton>
              <PhoneIconButton
                label={t('ui.nextMonth')}
                onClick={() => mudarMes(addMonths(mes, 1))}
              >
                <ChevronRight aria-hidden="true" />
              </PhoneIconButton>
            </span>
          </div>
        }
      />

      {diaVazio(selecionado) ? (
        <p className="phone-cal-empty">{t('shared.noActivity')}</p>
      ) : (
        <GroupedList
          header={maiuscula(format(dataSelecionada, t('dateFormat.weekdayDayMonth'), { locale }))}
        >
          {selecionado.incomes.map((c) => {
            const refId = refPagamento('cliente', c.id, year, month);
            const pago = isPaid(refId);
            return (
              <Cell
                key={`in-${c.id}`}
                icon={<i className="phone-cal-dot" style={{ background: DOT.income }} />}
                label={<span className={pago ? 'phone-cal-pago' : undefined}>{c.nome}</span>}
                subtitle={t('phone.incomeSubtitle', {
                  plan: c.plano?.toUpperCase() || 'N/A',
                  value: formatFinancialBRL(c.valor_mensal, p.canSeeFinancials),
                })}
                accessory={
                  pago ? (
                    <span className="phone-cal-badge phone-cal-badge--ok">{t('shared.paid')}</span>
                  ) : (
                    <button
                      type="button"
                      className="phone-cal-confirm"
                      aria-label={t('shared.confirmNamed', { name: c.nome })}
                      onClick={() =>
                        pedirConfirmacao({
                          refId,
                          desc: c.nome,
                          val: c.valor_mensal,
                          cat: 'Mensalidade Cliente',
                          tipo: 'entrada',
                        })
                      }
                    >
                      {t('actions.confirm')}
                    </button>
                  )
                }
              />
            );
          })}
          {selecionado.expenses.map((m) => {
            const refId = refPagamento('membro', m.id, year, month);
            const pago = isPaid(refId);
            return (
              <Cell
                key={`out-${m.id}`}
                icon={<i className="phone-cal-dot" style={{ background: DOT.expense }} />}
                label={<span className={pago ? 'phone-cal-pago' : undefined}>{m.nome}</span>}
                subtitle={t('phone.expenseSubtitle', {
                  details: [m.cargo, m.tipo?.replace('_', ' ')].filter(Boolean).join(', '),
                  value: formatFinancialBRL(m.custo_mensal, p.canSeeFinancials),
                })}
                accessory={
                  pago ? (
                    <span className="phone-cal-badge phone-cal-badge--ok">{t('shared.paid')}</span>
                  ) : (
                    <button
                      type="button"
                      className="phone-cal-confirm"
                      aria-label={t('shared.confirmNamed', { name: m.nome })}
                      onClick={() =>
                        pedirConfirmacao({
                          refId,
                          desc: `Pagto. ${m.nome}`,
                          val: m.custo_mensal || 0,
                          cat: 'Pagamento Equipe',
                          tipo: 'saida',
                        })
                      }
                    >
                      {t('actions.confirm')}
                    </button>
                  )
                }
              />
            );
          })}
          {selecionado.deadlines.map((d, i) => (
            <Cell
              key={`dl-${d.workflowId}-${i}`}
              icon={
                <i
                  className="phone-cal-dot"
                  style={{ background: d.estourado ? DOT.overdue : DOT.deadline }}
                />
              }
              label={d.workflowTitle}
              subtitle={t('phone.stage', { client: d.clienteNome, stage: d.etapaNome })}
              value={formatDeadlineStatus(d.diasRestantes, d.estourado)}
            />
          ))}
          {selecionado.birthdays.map((c) => (
            <Cell
              key={`bd-${c.id}`}
              icon={<i className="phone-cal-dot" style={{ background: DOT.birthday }} />}
              label={c.nome}
              subtitle={t('shared.clientBirthday')}
            />
          ))}
          {selecionado.datas.map((d) => (
            <Cell
              key={`dt-${d.id}`}
              icon={<i className="phone-cal-dot" style={{ background: DOT.data }} />}
              label={d.titulo}
              subtitle={`${p.clientes.find((c) => c.id === d.cliente_id)?.nome || t('phone.noClient')} · ${formatDate(d.data)}`}
            />
          ))}
        </GroupedList>
      )}
      <p className="phone-cal-legend" aria-hidden="true">
        <span>
          <i className="phone-cal-dot" style={{ background: DOT.income }} />{' '}
          {t('phone.legend.income')}
        </span>
        <span>
          <i className="phone-cal-dot" style={{ background: DOT.expense }} />{' '}
          {t('phone.legend.expense')}
        </span>
        <span>
          <i className="phone-cal-dot" style={{ background: DOT.deadline }} />{' '}
          {t('phone.legend.deadline')}
        </span>
        <span>
          <i className="phone-cal-dot" style={{ background: DOT.birthday }} />{' '}
          {t('shared.birthday')}
        </span>
        <span>
          <i className="phone-cal-dot" style={{ background: DOT.data }} />{' '}
          {t('phone.legend.importantDate')}
        </span>
      </p>
      {dialog}
    </>
  );
}

/** Legend order; labels under `shared.legend.<type>`. */
const LEGENDA = ['br', 'world', 'prof', 'week', 'month'] as const;

function DatasComemorativas({
  niche,
  onNicheChange,
}: {
  niche: NicheCalendarDef;
  onNicheChange: (key: string) => void;
}) {
  const { t } = useTranslation('calendario');
  const [filtro, setFiltro] = useState('all');
  const [busca, setBusca] = useState('');
  const [buscaAberta, setBuscaAberta] = useState(false);

  // Another niche has another tag vocabulary: a filter or search from the previous one
  // could hide everything (same reset as desktop).
  useEffect(() => {
    setFiltro('all');
    setBusca('');
  }, [niche.key]);

  const filtros = [
    { key: 'all', label: t('shared.filters.all') },
    { key: 'br', label: t('shared.filters.br') },
    { key: 'world', label: t('shared.filters.world') },
    { key: 'prof', label: t('shared.filters.prof') },
    ...Object.entries(niche.filterLabels).map(([key, label]) => ({ key, label })),
  ];

  const meses = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return niche.data
      .map((m) => ({
        ...m,
        events: m.events.filter(
          (e) =>
            (filtro === 'all' || e.tags?.includes(filtro)) &&
            (!q || e.name.toLowerCase().includes(q) || e.date.toLowerCase().includes(q)),
        ),
      }))
      .filter((m) => m.events.length > 0);
  }, [niche.data, filtro, busca]);
  const total = meses.reduce((n, m) => n + m.events.length, 0);
  // The month name in the UI language (`num` is "01".."12"); the pt data name is the fallback.
  const nomeDoMes = (m: { month: string; num: string }) =>
    t(`months.${Number(m.num) - 1}`, { defaultValue: m.month });

  return (
    <>
      <GroupedList aria-label={t('shared.niche')}>
        <PickerCell
          label={t('shared.niche')}
          value={niche.key}
          options={NICHE_CALENDARS.map((n) => ({ value: n.key, label: n.label }))}
          onChange={(v) => v && onNicheChange(v)}
        />
      </GroupedList>

      <div className="phone-cal-filters">
        <ChipRow aria-label={t('phone.filterAria')} className="phone-cal-chips">
          {filtros.map((f) => (
            <Chip
              key={f.key}
              label={f.label}
              selected={filtro === f.key}
              onClick={() => setFiltro(f.key)}
            />
          ))}
        </ChipRow>
        <PhoneIconButton
          label={buscaAberta ? t('phone.closeSearch') : t('phone.searchDate')}
          aria-expanded={buscaAberta}
          onClick={() => {
            if (buscaAberta) setBusca('');
            setBuscaAberta(!buscaAberta);
          }}
        >
          {buscaAberta ? <X aria-hidden="true" /> : <Search aria-hidden="true" />}
        </PhoneIconButton>
      </div>
      {buscaAberta && (
        <div className="phone-cal-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            autoFocus
            enterKeyHint="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={t('shared.searchPlaceholder')}
            aria-label={t('phone.searchDate')}
          />
        </div>
      )}

      <p className="phone-cal-count">{t('phone.shown', { count: total })}</p>
      <p className="phone-cal-legend">
        {LEGENDA.map((tipo) => (
          <span key={tipo}>
            <i className="phone-cal-dot" style={{ background: dotColorMap[tipo] }} />{' '}
            {t(`shared.legend.${tipo}`)}
          </span>
        ))}
      </p>

      {meses.length === 0 && <p className="phone-cal-empty">{t('phone.noDates')}</p>}
      {meses.map((m) => (
        <GroupedList
          key={m.month}
          header={m.badge ? `${nomeDoMes(m)} · ${m.badge}` : nomeDoMes(m)}
          className="phone-cal-niche-month"
        >
          {m.events.map((e, i) => (
            <Cell
              key={i}
              icon={
                <i
                  className="phone-cal-dot"
                  style={{ background: dotColorMap[e.type] || '#888' }}
                />
              }
              label={e.name}
              value={e.date}
            />
          ))}
        </GroupedList>
      ))}
    </>
  );
}
