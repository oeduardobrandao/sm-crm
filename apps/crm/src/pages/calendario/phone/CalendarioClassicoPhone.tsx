import { useEffect, useMemo, useState } from 'react';
import { addMonths, format, isSameDay, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import type { Cliente, ClienteData, Membro, Transacao } from '../../../store';
import { formatDate } from '../../../store';
import { cn } from '@/lib/utils';
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
import { dotColorMap, type NicheCalendarDef } from '../nicheCalendars/types';
import './calendarioPhone.css';

type Aba = 'financeiro' | 'comemorativas';

const WEEK_DAYS = [
  { short: 'D', long: 'domingo' },
  { short: 'S', long: 'segunda' },
  { short: 'T', long: 'terça' },
  { short: 'Q', long: 'quarta' },
  { short: 'Q', long: 'quinta' },
  { short: 'S', long: 'sexta' },
  { short: 'S', long: 'sábado' },
];

/** Dot colours of the month grid, one per kind of item (the desktop pills' colours). */
const DOT = {
  income: 'var(--success)',
  expense: 'var(--danger)',
  deadline: '#a855f7',
  overdue: 'var(--danger)',
  birthday: '#ec4899',
  data: '#6366f1',
} as const;

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
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
  return (
    <div className="phone-cal">
      <PhonePageHeader
        title={p.aba === 'financeiro' ? 'Calendário' : p.niche.title}
        subtitle={p.aba === 'financeiro' ? 'Visão geral mensal.' : p.niche.subtitle}
      >
        <SegmentedControl<Aba>
          aria-label="Visão do calendário"
          className="phone-cal-tabs"
          options={[
            { value: 'financeiro', label: 'Calendário' },
            { value: 'comemorativas', label: 'Datas comemorativas' },
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
  const [mes, setMes] = useState(() => new Date());
  const [dia, setDia] = useState(() => new Date().getDate());
  const { pedirConfirmacao, dialog } = useConfirmarPagamento(p.canSeeFinancials);
  const year = mes.getFullYear();
  const month = mes.getMonth();
  const hoje = new Date();
  const fontes: FinanceiroFontes = {
    clientes: p.clientes,
    membros: p.membros,
    deadlineEvents: p.deadlineEvents,
    datasImportantes: p.datasImportantes,
    canSeeFinancials: p.canSeeFinancials,
  };
  const diasNoMes = new Date(year, month + 1, 0).getDate();
  const primeiro = new Date(year, month, 1).getDay();
  const nomeMes = format(mes, 'MMMM', { locale: ptBR });
  const isPaid = (refId: string) => p.transacoes.some((t) => t.referencia_agendamento === refId);

  // A month change keeps the day only when it exists there (31 -> February).
  const mudarMes = (novo: Date) => {
    setMes(novo);
    setDia((d) => Math.min(d, new Date(novo.getFullYear(), novo.getMonth() + 1, 0).getDate()));
  };

  const selecionado = itensDoDia(fontes, year, month, dia);
  const dataSelecionada = new Date(year, month, dia);

  return (
    <>
      <div className="phone-cal-month">
        <div className="phone-cal-month__head">
          <h2 className="phone-cal-month__title">
            {maiuscula(format(mes, "MMMM 'de' yyyy", { locale: ptBR }))}
          </h2>
          <span className="phone-cal-month__nav">
            <PhoneIconButton label="Mês anterior" onClick={() => mudarMes(subMonths(mes, 1))}>
              <ChevronLeft aria-hidden="true" />
            </PhoneIconButton>
            <PhoneIconButton label="Próximo mês" onClick={() => mudarMes(addMonths(mes, 1))}>
              <ChevronRight aria-hidden="true" />
            </PhoneIconButton>
          </span>
        </div>
        <div className="phone-cal-month__weekdays" aria-hidden="true">
          {WEEK_DAYS.map((d) => (
            <span key={d.long}>{d.short}</span>
          ))}
        </div>
        <div className="phone-cal-month__grid">
          {Array.from({ length: primeiro }, (_, i) => (
            <span key={`vazio-${i}`} />
          ))}
          {Array.from({ length: diasNoMes }, (_, i) => {
            const d = i + 1;
            const itens = itensDoDia(fontes, year, month, d);
            const dots: string[] = [];
            if (itens.incomes.length) dots.push(DOT.income);
            if (itens.expenses.length) dots.push(DOT.expense);
            if (itens.deadlines.length)
              dots.push(itens.deadlines.some((x) => x.estourado) ? DOT.overdue : DOT.deadline);
            if (itens.birthdays.length) dots.push(DOT.birthday);
            if (itens.datas.length) dots.push(DOT.data);
            const partes = [
              itens.incomes.length
                ? plural(itens.incomes.length, 'recebimento', 'recebimentos')
                : '',
              itens.expenses.length ? plural(itens.expenses.length, 'pagamento', 'pagamentos') : '',
              itens.deadlines.length ? plural(itens.deadlines.length, 'entrega', 'entregas') : '',
              itens.birthdays.length
                ? plural(itens.birthdays.length, 'aniversário', 'aniversários')
                : '',
              itens.datas.length ? plural(itens.datas.length, 'data', 'datas') : '',
            ].filter(Boolean);
            const selected = dia === d;
            return (
              <button
                key={d}
                type="button"
                className={cn(
                  'phone-cal-month__day',
                  isSameDay(new Date(year, month, d), hoje) && 'phone-cal-month__day--today',
                  selected && 'phone-cal-month__day--selected',
                )}
                aria-pressed={selected}
                aria-label={`${d} de ${nomeMes}${partes.length ? `, ${partes.join(', ')}` : ''}`}
                onClick={() => setDia(d)}
              >
                {d}
                <span className="phone-cal-month__dots" aria-hidden="true">
                  {dots.slice(0, 4).map((cor, j) => (
                    <i key={j} style={{ background: cor }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {diaVazio(selecionado) ? (
        <p className="phone-cal-empty">Nenhuma movimentação neste dia.</p>
      ) : (
        <GroupedList
          header={maiuscula(format(dataSelecionada, "EEEE, d 'de' MMMM", { locale: ptBR }))}
        >
          {selecionado.incomes.map((c) => {
            const refId = refPagamento('cliente', c.id, year, month);
            const pago = isPaid(refId);
            return (
              <Cell
                key={`in-${c.id}`}
                icon={<i className="phone-cal-dot" style={{ background: DOT.income }} />}
                label={<span className={pago ? 'phone-cal-pago' : undefined}>{c.nome}</span>}
                subtitle={`Plano: ${c.plano?.toUpperCase() || 'N/A'} · Previsto ${formatFinancialBRL(c.valor_mensal, p.canSeeFinancials)}`}
                accessory={
                  pago ? (
                    <span className="phone-cal-badge phone-cal-badge--ok">Pago</span>
                  ) : (
                    <button
                      type="button"
                      className="phone-cal-confirm"
                      aria-label={`Confirmar ${c.nome}`}
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
                      Confirmar
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
                subtitle={`Equipe · ${[m.cargo, m.tipo?.replace('_', ' ')].filter(Boolean).join(', ')} · Previsto ${formatFinancialBRL(m.custo_mensal, p.canSeeFinancials)}`}
                accessory={
                  pago ? (
                    <span className="phone-cal-badge phone-cal-badge--ok">Pago</span>
                  ) : (
                    <button
                      type="button"
                      className="phone-cal-confirm"
                      aria-label={`Confirmar ${m.nome}`}
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
                      Confirmar
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
              subtitle={`${d.clienteNome} · Etapa: ${d.etapaNome}`}
              value={formatDeadlineStatus(d.diasRestantes, d.estourado)}
            />
          ))}
          {selecionado.birthdays.map((c) => (
            <Cell
              key={`bd-${c.id}`}
              icon={<i className="phone-cal-dot" style={{ background: DOT.birthday }} />}
              label={c.nome}
              subtitle="Aniversário do cliente"
            />
          ))}
          {selecionado.datas.map((d) => (
            <Cell
              key={`dt-${d.id}`}
              icon={<i className="phone-cal-dot" style={{ background: DOT.data }} />}
              label={d.titulo}
              subtitle={`${p.clientes.find((c) => c.id === d.cliente_id)?.nome || 'Sem cliente'} · ${formatDate(d.data)}`}
            />
          ))}
        </GroupedList>
      )}
      <p className="phone-cal-legend" aria-hidden="true">
        <span>
          <i className="phone-cal-dot" style={{ background: DOT.income }} /> Recebimento
        </span>
        <span>
          <i className="phone-cal-dot" style={{ background: DOT.expense }} /> Pagamento
        </span>
        <span>
          <i className="phone-cal-dot" style={{ background: DOT.deadline }} /> Entrega
        </span>
        <span>
          <i className="phone-cal-dot" style={{ background: DOT.birthday }} /> Aniversário
        </span>
        <span>
          <i className="phone-cal-dot" style={{ background: DOT.data }} /> Data importante
        </span>
      </p>
      {dialog}
    </>
  );
}

const LEGENDA: { type: keyof typeof dotColorMap; label: string }[] = [
  { type: 'br', label: 'Brasil' },
  { type: 'world', label: 'Mundial / OMS / OPAS' },
  { type: 'prof', label: 'Profissões' },
  { type: 'week', label: 'Semanas' },
  { type: 'month', label: 'Meses temáticos' },
];

function DatasComemorativas({
  niche,
  onNicheChange,
}: {
  niche: NicheCalendarDef;
  onNicheChange: (key: string) => void;
}) {
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
    { key: 'all', label: 'Todos' },
    { key: 'br', label: 'Brasil' },
    { key: 'world', label: 'Mundial' },
    { key: 'prof', label: 'Profissional' },
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

  return (
    <>
      <GroupedList aria-label="Nicho">
        <PickerCell
          label="Nicho"
          value={niche.key}
          options={NICHE_CALENDARS.map((n) => ({ value: n.key, label: n.label }))}
          onChange={(v) => v && onNicheChange(v)}
        />
      </GroupedList>

      <div className="phone-cal-filters">
        <ChipRow aria-label="Filtrar datas" className="phone-cal-chips">
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
          label={buscaAberta ? 'Fechar busca' : 'Buscar data'}
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
            placeholder="Buscar data..."
            aria-label="Buscar data"
          />
        </div>
      )}

      <p className="phone-cal-count">
        {total} {total === 1 ? 'data exibida' : 'datas exibidas'}
      </p>
      <p className="phone-cal-legend">
        {LEGENDA.map((l) => (
          <span key={l.type}>
            <i className="phone-cal-dot" style={{ background: dotColorMap[l.type] }} /> {l.label}
          </span>
        ))}
      </p>

      {meses.length === 0 && <p className="phone-cal-empty">Nenhuma data encontrada.</p>}
      {meses.map((m) => (
        <GroupedList
          key={m.month}
          header={m.badge ? `${m.month} · ${m.badge}` : m.month}
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
