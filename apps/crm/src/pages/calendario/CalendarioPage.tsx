import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Globe, Flag } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getClientes,
  getMembros,
  getTransacoes,
  getWorkflows,
  getWorkflowEtapas,
  addTransacao,
  formatDate,
  getAllClienteDatas,
  type Cliente,
  type Membro,
  type Transacao,
  type ClienteData,
} from '../../store';
import { useAuth } from '../../context/AuthContext';
import { formatFinancialBRL, type FinancialAccess } from '@/lib/financialAccess';
import { formatDeadlineStatus } from './deadlineStatus';
import { dotColorMap, type NicheCalendarDef } from './nicheCalendars/types';
import {
  NICHE_CALENDARS,
  DEFAULT_NICHE_KEY,
  readStoredNicheKey,
  writeStoredNicheKey,
} from './nicheCalendars/registry';

// ---- Types ----
interface DeadlineEvent {
  workflowTitle: string;
  etapaNome: string;
  clienteNome: string;
  clienteCor: string;
  deadlineDate: Date;
  diasRestantes: number;
  estourado: boolean;
}

// ---- Financeiro Calendar ----
function FinanceiroCalendar({
  clientes,
  membros,
  transacoes,
  deadlineEvents,
  datasImportantes,
  canSeeFinancials,
}: {
  clientes: Cliente[];
  membros: Membro[];
  transacoes: Transacao[];
  deadlineEvents: DeadlineEvent[];
  datasImportantes: ClienteData[];
  canSeeFinancials: FinancialAccess;
}) {
  const qc = useQueryClient();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(new Date().getDate());
  const [confirmPayload, setConfirmPayload] = useState<{
    refId: string;
    desc: string;
    val: number;
    cat: string;
    tipo: 'entrada' | 'saida';
  } | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthNames = [
    'Janeiro',
    'Fevereiro',
    'Março',
    'Abril',
    'Maio',
    'Junho',
    'Julho',
    'Agosto',
    'Setembro',
    'Outubro',
    'Novembro',
    'Dezembro',
  ];
  const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  const today = new Date();
  const isSameMonth =
    currentDate.getMonth() === today.getMonth() &&
    currentDate.getFullYear() === today.getFullYear();
  const isToday = (d: number) => today.getDate() === d && isSameMonth;

  const isPaid = (refId: string) => transacoes.some((t) => t.referencia_agendamento === refId);

  // Branch on the explicit capability, never on a nullable financial value: a
  // legitimately null retainer is indistinguishable from a masked one, and
  // Number(null) is 0, so inference would render phantom R$ 0 entries.
  const selectedIncomes =
    canSeeFinancials !== true
      ? []
      : clientes.filter(
          (c) =>
            c.data_pagamento === selectedDay &&
            c.status === 'ativo' &&
            currentDate.getMonth() === currentDate.getMonth(),
        );
  const selectedExpenses =
    canSeeFinancials !== true ? [] : membros.filter((m) => m.data_pagamento === selectedDay);
  const selectedDeadlines = deadlineEvents.filter(
    (d) =>
      d.deadlineDate.getDate() === selectedDay &&
      d.deadlineDate.getMonth() === month &&
      d.deadlineDate.getFullYear() === year,
  );

  // Birthday events for this month (recurring annually by month+day — stored as MM-DD)
  const birthdayClients = clientes.filter((c) => {
    if (!c.data_aniversario) return false;
    const [bdMm, bdDd] = c.data_aniversario.split('-').map(Number);
    return bdMm - 1 === month && bdDd === selectedDay;
  });

  // Important dates for this month/day
  const selectedDatas = datasImportantes.filter((d) => {
    const dt = new Date(d.data + 'T00:00:00');
    return dt.getMonth() === month && dt.getDate() === selectedDay && dt.getFullYear() === year;
  });

  const handleConfirm = (
    refId: string,
    desc: string,
    val: number,
    cat: string,
    tipo: 'entrada' | 'saida',
  ) => {
    setConfirmPayload({ refId, desc, val, cat, tipo });
  };

  const handleConfirmExecute = async () => {
    if (!confirmPayload) return;
    const { refId, desc, val, cat, tipo } = confirmPayload;
    try {
      await addTransacao({
        descricao: desc,
        detalhe: 'Baixa efetuada pelo Calendário',
        categoria: cat,
        valor: val,
        data: new Date().toISOString().split('T')[0],
        tipo,
        status: 'pago',
        referencia_agendamento: refId,
      });
      toast.success('Pagamento confirmado!');
      qc.invalidateQueries({ queryKey: ['transacoes'] });
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro');
    } finally {
      setConfirmPayload(null);
    }
  };

  return (
    <>
      <div className="calendar-layout">
        <div className="calendar-main">
          <div className="calendar-header">
            <div className="calendar-title-group">
              <h2>{monthNames[month]}</h2>
              <span>{year}</span>
            </div>
            <div className="calendar-nav">
              <button
                onClick={() =>
                  setCurrentDate((d) => {
                    const n = new Date(d);
                    n.setMonth(n.getMonth() - 1);
                    return n;
                  })
                }
              >
                ‹
              </button>
              <button
                onClick={() =>
                  setCurrentDate((d) => {
                    const n = new Date(d);
                    n.setMonth(n.getMonth() + 1);
                    return n;
                  })
                }
              >
                ›
              </button>
            </div>
          </div>
          <div className="calendar-weekdays">
            {weekDays.map((wd) => (
              <div key={wd}>{wd}</div>
            ))}
          </div>
          <div className="calendar-grid">
            {Array.from({ length: firstDay }, (_, i) => (
              <div key={`e${i}`} className="calendar-day empty" />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const d = i + 1;
              const dayIncomes =
                canSeeFinancials !== true
                  ? []
                  : clientes.filter((c) => c.data_pagamento === d && c.status === 'ativo');
              const dayExpenses =
                canSeeFinancials !== true ? [] : membros.filter((m) => m.data_pagamento === d);
              const dayDeadlines = deadlineEvents.filter(
                (de) =>
                  de.deadlineDate.getDate() === d &&
                  de.deadlineDate.getMonth() === month &&
                  de.deadlineDate.getFullYear() === year,
              );
              const dayBirthdays = clientes.filter((c) => {
                if (!c.data_aniversario) return false;
                const [bdMm, bdDd] = c.data_aniversario.split('-').map(Number);
                return bdMm - 1 === month && bdDd === d;
              });
              const dayDatas = datasImportantes.filter((di) => {
                const dt = new Date(di.data + 'T00:00:00');
                return dt.getMonth() === month && dt.getDate() === d && dt.getFullYear() === year;
              });
              const hasEvents =
                dayIncomes.length > 0 ||
                dayExpenses.length > 0 ||
                dayDeadlines.length > 0 ||
                dayBirthdays.length > 0 ||
                dayDatas.length > 0;
              return (
                <div
                  key={d}
                  className={`calendar-day ${isToday(d) ? 'today' : ''} ${selectedDay === d ? 'selected' : ''} ${hasEvents ? 'has-events' : ''}`}
                  onClick={() => setSelectedDay(d)}
                >
                  <span className="day-number">{d}</span>
                  <div className="day-events">
                    {dayIncomes.length > 0 && (
                      <div className="event-pill income">↗ {dayIncomes.length} Receb.</div>
                    )}
                    {dayExpenses.length > 0 && (
                      <div className="event-pill expense">↘ {dayExpenses.length} Desp.</div>
                    )}
                    {dayDeadlines.length > 0 && (
                      <div
                        className={`event-pill deadline${dayDeadlines.some((dl) => dl.estourado) ? ' overdue' : ''}`}
                      >
                        ⚑ {dayDeadlines.length} Entrega{dayDeadlines.length > 1 ? 's' : ''}
                      </div>
                    )}
                    {dayBirthdays.length > 0 && (
                      <div
                        className="event-pill"
                        style={{
                          background: 'rgba(236, 72, 153, 0.12)',
                          color: '#ec4899',
                          fontWeight: 600,
                        }}
                      >
                        🎂 {dayBirthdays.length} Aniv.
                      </div>
                    )}
                    {dayDatas.length > 0 && (
                      <div
                        className="event-pill"
                        style={{
                          background: 'rgba(99, 102, 241, 0.12)',
                          color: '#6366f1',
                          fontWeight: 600,
                        }}
                      >
                        📅 {dayDatas.length} Data{dayDatas.length > 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="scheduled-panel">
          <div className="scheduled-header">
            <h3>Agendado</h3>
            <p>
              {selectedDay} de {monthNames[month]}, {year}
            </p>
          </div>
          <div className="scheduled-list">
            {selectedIncomes.length === 0 &&
            selectedExpenses.length === 0 &&
            selectedDeadlines.length === 0 &&
            birthdayClients.length === 0 &&
            selectedDatas.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
                <p>Nenhuma movimentação neste dia.</p>
              </div>
            ) : (
              <>
                {selectedIncomes.map((c) => {
                  const refId = `cliente_${c.id}_${year}_${String(month + 1).padStart(2, '0')}`;
                  const paid = isPaid(refId);
                  return (
                    <div key={c.id} className="scheduled-item">
                      <div className="item-top">
                        <div
                          className="item-badge income"
                          style={paid ? { background: 'var(--text-muted)' } : {}}
                        />
                        {paid ? (
                          <span className="badge badge-success">
                            <i className="ph ph-check-circle" /> Pago
                          </span>
                        ) : (
                          <button
                            className="btn-confirmar"
                            onClick={() =>
                              handleConfirm(
                                refId,
                                c.nome,
                                c.valor_mensal,
                                'Mensalidade Cliente',
                                'entrada',
                              )
                            }
                          >
                            <i className="ph ph-check-circle" /> CONFIRMAR
                          </button>
                        )}
                      </div>
                      <div
                        className="item-title"
                        style={
                          paid ? { textDecoration: 'line-through', color: 'var(--text-muted)' } : {}
                        }
                      >
                        {c.nome}
                      </div>
                      <div className="item-subtitle">PLANO: {c.plano?.toUpperCase() || 'N/A'}</div>
                      <div className="item-divider" />
                      <div className="item-meta">
                        <i className="ph ph-money" /> Previsto:{' '}
                        {formatFinancialBRL(c.valor_mensal, canSeeFinancials)}
                      </div>
                    </div>
                  );
                })}

                {selectedExpenses.map((m) => {
                  const refId = `membro_${m.id}_${year}_${String(month + 1).padStart(2, '0')}`;
                  const paid = isPaid(refId);
                  return (
                    <div key={m.id} className="scheduled-item">
                      <div className="item-top">
                        <div
                          className="item-badge expense"
                          style={paid ? { background: 'var(--text-muted)' } : {}}
                        />
                        {paid ? (
                          <span className="badge badge-success">
                            <i className="ph ph-check-circle" /> Pago
                          </span>
                        ) : (
                          <button
                            className="btn-confirmar"
                            onClick={() =>
                              handleConfirm(
                                refId,
                                `Pagto. ${m.nome}`,
                                m.custo_mensal || 0,
                                'Pagamento Equipe',
                                'saida',
                              )
                            }
                          >
                            <i className="ph ph-check-circle" /> CONFIRMAR
                          </button>
                        )}
                      </div>
                      <div
                        className="item-title"
                        style={
                          paid ? { textDecoration: 'line-through', color: 'var(--text-muted)' } : {}
                        }
                      >
                        {m.nome}
                      </div>
                      <div className="item-subtitle">
                        EQUIPE - {m.cargo?.toUpperCase()} ({m.tipo.replace('_', ' ').toUpperCase()})
                      </div>
                      <div className="item-divider" />
                      <div className="item-meta">
                        <i className="ph ph-money" /> Previsto:{' '}
                        {formatFinancialBRL(m.custo_mensal, canSeeFinancials)}
                      </div>
                    </div>
                  );
                })}

                {selectedDeadlines.map((d, i) => {
                  const statusLabel = formatDeadlineStatus(d.diasRestantes, d.estourado);
                  return (
                    <div key={i} className="scheduled-item">
                      <div className="item-top">
                        <div className="item-badge" style={{ background: d.clienteCor }} />
                        <span className="badge badge-neutral badge--sm">⚑ {statusLabel}</span>
                      </div>
                      <div className="item-title">{d.workflowTitle}</div>
                      <div className="item-subtitle">
                        {d.clienteNome} · ETAPA: {d.etapaNome}
                      </div>
                      <div className="item-divider" />
                      <div className="item-meta">
                        <i className="ph ph-flag" /> Prazo da etapa
                      </div>
                    </div>
                  );
                })}

                {birthdayClients.map((c) => (
                  <div key={`bday-${c.id}`} className="scheduled-item">
                    <div className="item-top">
                      <div className="item-badge" style={{ background: '#ec4899' }} />
                      <span
                        className="badge"
                        style={{
                          fontSize: '0.65rem',
                          background: 'rgba(236, 72, 153, 0.12)',
                          color: '#ec4899',
                        }}
                      >
                        🎂 ANIVERSÁRIO
                      </span>
                    </div>
                    <div className="item-title">{c.nome}</div>
                    <div className="item-subtitle">
                      {(() => {
                        if (!c.data_aniversario) return '';
                        const [mm, dd] = c.data_aniversario.split('-');
                        const meses = [
                          'Janeiro',
                          'Fevereiro',
                          'Março',
                          'Abril',
                          'Maio',
                          'Junho',
                          'Julho',
                          'Agosto',
                          'Setembro',
                          'Outubro',
                          'Novembro',
                          'Dezembro',
                        ];
                        return `${parseInt(dd)} de ${meses[parseInt(mm) - 1]}`;
                      })()}
                    </div>
                    <div className="item-divider" />
                    <div className="item-meta">
                      <i className="ph ph-cake" /> Aniversário do cliente
                    </div>
                  </div>
                ))}

                {selectedDatas.map((d) => {
                  const clienteNome = clientes.find((c) => c.id === d.cliente_id)?.nome || '—';
                  return (
                    <div key={`data-${d.id}`} className="scheduled-item">
                      <div className="item-top">
                        <div className="item-badge" style={{ background: '#6366f1' }} />
                        <span
                          className="badge"
                          style={{
                            fontSize: '0.65rem',
                            background: 'rgba(99, 102, 241, 0.12)',
                            color: '#6366f1',
                          }}
                        >
                          📅 DATA IMPORTANTE
                        </span>
                      </div>
                      <div className="item-title">{d.titulo}</div>
                      <div className="item-subtitle">{clienteNome}</div>
                      <div className="item-divider" />
                      <div className="item-meta">
                        <i className="ph ph-calendar" /> {formatDate(d.data)}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>

      <AlertDialog
        open={confirmPayload !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmPayload(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Agendamento</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmPayload &&
                `Confirmar o recebimento/pagamento agendado de ${confirmPayload.desc} (${formatFinancialBRL(confirmPayload.val, canSeeFinancials)})?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmExecute}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---- Niche Calendar (Datas Comemorativas) ----
function NicheCalendar({ niche }: { niche: NicheCalendarDef }) {
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Switching niches shows a different tag vocabulary — a filter/search that made sense
  // for the previous niche can silently hide everything in the new one.
  useEffect(() => {
    setActiveFilter('all');
    setSearchTerm('');
  }, [niche.key]);

  const filterOptions = [
    { key: 'all', label: 'Todos' },
    {
      key: 'br',
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <Flag className="h-3.5 w-3.5" /> Brasil
        </span>
      ),
    },
    {
      key: 'world',
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <Globe className="h-3.5 w-3.5" /> Mundial
        </span>
      ),
    },
    { key: 'prof', label: 'Profissional' },
    ...Object.entries(niche.filterLabels).map(([key, label]) => ({ key, label })),
  ];

  let totalVisible = 0;
  niche.data.forEach((monthData) => {
    monthData.events.forEach((e) => {
      const matchFilter = activeFilter === 'all' || e.tags?.includes(activeFilter);
      const matchSearch =
        !searchTerm ||
        e.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.date.toLowerCase().includes(searchTerm.toLowerCase());
      if (matchFilter && matchSearch) totalVisible++;
    });
  });

  return (
    <div>
      <div className="niche-controls">
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {filterOptions.map((f) => (
            <button
              key={f.key}
              className={`calendar-nav button ${activeFilter === f.key ? 'active' : ''}`}
              style={{
                background:
                  activeFilter === f.key ? 'var(--primary-color)' : 'var(--surface-hover)',
                color: activeFilter === f.key ? '#fff' : 'var(--text-main)',
                border: '1px solid var(--border-color)',
                width: 'auto',
                padding: '0 0.8rem',
                borderRadius: '6px',
                height: 32,
                fontSize: '0.8rem',
                cursor: 'pointer',
                alignItems: 'center',
              }}
              onClick={() => setActiveFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
          <input
            type="text"
            placeholder="Buscar data..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              marginLeft: '0.5rem',
              background: 'var(--surface-main)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-main)',
              fontFamily: 'var(--font-main)',
              fontSize: '0.85rem',
              padding: '0.4rem 1rem',
              borderRadius: 6,
              outline: 'none',
              width: 240,
            }}
          />
        </div>

        <div className="niche-count">
          <span>{totalVisible}</span> DATAS EXIBIDAS
        </div>
      </div>

      <div className="niche-legend" style={{ marginBottom: '2rem' }}>
        <div className="niche-legend-item">
          <div className="niche-legend-dot" style={{ background: dotColorMap.br }} />
          Brasil
        </div>
        <div className="niche-legend-item">
          <div className="niche-legend-dot" style={{ background: dotColorMap.world }} />
          Mundial / OMS / OPAS
        </div>
        <div className="niche-legend-item">
          <div className="niche-legend-dot" style={{ background: dotColorMap.prof }} />
          Profissões
        </div>
        <div className="niche-legend-item">
          <div className="niche-legend-dot" style={{ background: dotColorMap.week }} />
          Semanas
        </div>
        <div className="niche-legend-item">
          <div className="niche-legend-dot" style={{ background: dotColorMap.month }} />
          Meses temáticos
        </div>
      </div>

      <div className="niche-grid">
        {niche.data.map((monthData) => {
          const filtered = monthData.events.filter((e) => {
            const matchFilter = activeFilter === 'all' || e.tags?.includes(activeFilter);
            const matchSearch =
              !searchTerm ||
              e.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
              e.date.toLowerCase().includes(searchTerm.toLowerCase());
            return matchFilter && matchSearch;
          });
          if (filtered.length === 0) return null;

          return (
            <div key={monthData.month} className="niche-month-card">
              <div className="niche-month-header">
                <div>
                  <div className="niche-month-name">{monthData.month}</div>
                  <div className="niche-month-num">{monthData.num}</div>
                </div>
                {monthData.badge && <span className="niche-month-badge">{monthData.badge}</span>}
              </div>
              <div className="niche-events">
                {filtered.map((e, i) => (
                  <div key={i} className="niche-event-item">
                    <div className="niche-event-date">{e.date}</div>
                    <div
                      className="niche-event-dot"
                      style={{ background: dotColorMap[e.type] || '#888' }}
                    />
                    <div className="niche-event-name">{e.name}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Main Page ----
export default function CalendarioPage() {
  const [activeTab, setActiveTab] = useState<'financeiro' | 'comemorativas'>('financeiro');
  const nicheKeys = NICHE_CALENDARS.map((n) => n.key);
  const [activeNicheKey, setActiveNicheKey] = useState(() =>
    readStoredNicheKey(nicheKeys, DEFAULT_NICHE_KEY),
  );
  const activeNiche = NICHE_CALENDARS.find((n) => n.key === activeNicheKey) ?? NICHE_CALENDARS[0];

  function handleNicheChange(key: string) {
    setActiveNicheKey(key);
    writeStoredNicheKey(key);
  }

  const { canSeeFinancials } = useAuth();

  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const { data: membros = [] } = useQuery({ queryKey: ['membros'], queryFn: getMembros });
  // getTransacoes returns raw financial rows: this page is not a financial
  // route, so the route guard never covers it. Gate the fetch itself, not
  // just its rendering — the day/selected-day views below already mask via
  // `canSeeFinancials !== true ? [] : ...`, but that only hid the values from
  // render; the rows still landed in the shared React Query cache otherwise.
  const { data: transacoesRaw = [] } = useQuery({
    queryKey: ['transacoes'],
    queryFn: getTransacoes,
    enabled: canSeeFinancials === true,
  });
  // Guard the read too, not just the query: `enabled: false` only stops a new
  // fetch — a query with the same key already populated elsewhere (matches
  // GlobalSearchTrigger's pattern) can still leave cached data on this hook.
  const transacoes = canSeeFinancials === true ? transacoesRaw : [];
  const { data: workflows = [] } = useQuery({ queryKey: ['workflows'], queryFn: getWorkflows });
  const { data: datasImportantes = [] } = useQuery({
    queryKey: ['allClienteDatas'],
    queryFn: getAllClienteDatas,
  });

  // Build deadline events from active workflows
  const { data: deadlineEvents = [] } = useQuery({
    queryKey: ['calendar-deadlines', workflows.map((w) => w.id).join(',')],
    queryFn: async () => {
      const activeWfs = workflows.filter((w) => w.status === 'ativo');
      const etapasResults = await Promise.all(activeWfs.map((w) => getWorkflowEtapas(w.id!)));
      const events: DeadlineEvent[] = [];
      activeWfs.forEach((w, idx) => {
        const etapas = etapasResults[idx];
        const activeEtapa = etapas.find((e) => e.status === 'ativo');
        if (!activeEtapa || !activeEtapa.iniciado_em) return;
        const cliente = clientes.find((c) => c.id === w.cliente_id);
        const inicio = new Date(activeEtapa.iniciado_em);
        const deadlineDate = new Date(inicio);
        if (activeEtapa.tipo_prazo === 'uteis') {
          let added = 0;
          while (added < activeEtapa.prazo_dias) {
            deadlineDate.setDate(deadlineDate.getDate() + 1);
            const dow = deadlineDate.getDay();
            if (dow !== 0 && dow !== 6) added++;
          }
        } else {
          deadlineDate.setDate(deadlineDate.getDate() + activeEtapa.prazo_dias);
        }
        const now = new Date();
        const diffMs = deadlineDate.getTime() - now.getTime();
        const diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        events.push({
          workflowTitle: w.titulo,
          etapaNome: activeEtapa.nome,
          clienteNome: cliente?.nome || '—',
          clienteCor: cliente?.cor || '#888',
          deadlineDate,
          diasRestantes,
          estourado: diasRestantes < 0,
        });
      });
      return events;
    },
    enabled: workflows.length > 0,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <header className="header animate-up">
        <div className="header-title">
          <h1>{activeTab === 'financeiro' ? 'Calendário' : activeNiche.title}</h1>
          <p style={{ color: 'var(--text-muted)' }}>
            {activeTab === 'financeiro' ? 'Visão geral mensal.' : activeNiche.subtitle}
          </p>
        </div>
      </header>

      <div className="calendar-tabs animate-up">
        <button
          className={`calendar-tab${activeTab === 'financeiro' ? ' active' : ''}`}
          onClick={() => setActiveTab('financeiro')}
        >
          Calendário
        </button>
        <button
          className={`calendar-tab${activeTab === 'comemorativas' ? ' active' : ''}`}
          onClick={() => setActiveTab('comemorativas')}
        >
          Datas Comemorativas
        </button>
      </div>

      <div className="animate-up">
        {activeTab === 'financeiro' ? (
          <FinanceiroCalendar
            clientes={clientes}
            membros={membros}
            transacoes={transacoes}
            deadlineEvents={deadlineEvents}
            datasImportantes={datasImportantes}
            canSeeFinancials={canSeeFinancials}
          />
        ) : (
          <>
            <div style={{ marginBottom: '1.5rem', maxWidth: 280 }}>
              <Select value={activeNicheKey} onValueChange={handleNicheChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NICHE_CALENDARS.map((n) => (
                    <SelectItem key={n.key} value={n.key}>
                      {n.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <NicheCalendar niche={activeNiche} />
          </>
        )}
      </div>
    </div>
  );
}
