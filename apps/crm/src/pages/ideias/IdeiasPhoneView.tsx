import { useRef, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Lightbulb, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import type { Ideia } from '@/store';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { PhoneFiltersSheet, type FilterSection } from '@/components/mobile/PhoneFiltersSheet';
import { Chip, ChipRow } from '@/components/mobile/ChipRow';
import { GroupedList } from '@/components/mobile/GroupedList';
import { FormRow } from '@/components/mobile/FormRow';
import { IdeiaStatusPill } from '@/components/ideias/IdeiaStatusPill';
import { IDEIA_STATUS_LABELS } from './ideiaLabels';
import './ideiasPhone.css';

const HELP_TEXT = 'Ideias enviadas pelos clientes no portal ou criadas pela equipe.';

const TIPO_LABELS: Record<Ideia['tipo'], string> = { ideia: 'Ideia', solicitacao: 'Solicitação' };
const ORIGEM_LABELS: Record<Ideia['origem'], string> = { cliente: 'Cliente', agencia: 'Agência' };

type PeriodMode = 'todos' | 'mes' | 'intervalo';

function pad(n: number) {
  return String(n).padStart(2, '0');
}
/** `YYYY-MM-DD` of a local date, for `<input type="date">`. */
function toInputDate(d: Date | undefined): string {
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '';
}
/** Local midnight of a `YYYY-MM-DD` value (`new Date(str)` would read it as UTC). */
function fromInputDate(value: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
/** The whole calendar month of a `YYYY-MM` value. */
function monthRange(value: string): DateRange | undefined {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  return { from: new Date(year, month, 1), to: new Date(year, month + 1, 0) };
}
function isWholeMonth(range: DateRange | undefined): boolean {
  const { from, to } = range ?? {};
  if (!from || !to) return false;
  const last = new Date(from.getFullYear(), from.getMonth() + 1, 0);
  return (
    from.getDate() === 1 &&
    to.getFullYear() === last.getFullYear() &&
    to.getMonth() === last.getMonth() &&
    to.getDate() === last.getDate()
  );
}
function modeOf(range: DateRange | undefined): PeriodMode {
  if (isWholeMonth(range)) return 'mes';
  return range?.from || range?.to ? 'intervalo' : 'todos';
}
function periodLabel(range: DateRange | undefined): string | null {
  const { from, to } = range ?? {};
  if (!from && !to) return null;
  if (isWholeMonth(range) && from) {
    const label = format(from, "MMMM 'de' yyyy", { locale: ptBR });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  const short = (d: Date) => format(d, 'dd/MM/yyyy');
  if (from && to) return `${short(from)} a ${short(to)}`;
  if (from) return `A partir de ${short(from)}`;
  return `Até ${short(to as Date)}`;
}

export interface IdeiasPhoneViewProps {
  /** Already filtered, in the page's order. */
  ideias: Ideia[];
  isLoading: boolean;
  canEdit: boolean;
  onNew: () => void;
  onOpen: (ideia: Ideia) => void;
  search: string;
  onSearchChange: (value: string) => void;
  clientes: { id: number; nome: string }[];
  statuses: readonly Ideia['status'][];
  clienteFilter: string;
  onClienteFilterChange: (value: string) => void;
  tipoFilter: string;
  onTipoFilterChange: (value: string) => void;
  statusFilters: string[];
  onStatusFiltersChange: (value: string[]) => void;
  dateRange: DateRange | undefined;
  onDateRangeChange: (value: DateRange | undefined) => void;
  activeFilterCount: number;
  onClearFilters: () => void;
}

/**
 * /ideias on phones (FIdeias mockup): page header with the help text as subtitle and
 * Buscar / Filtros / "+" in its row, the active filters as removable chips, and the
 * ideias as grouped rows instead of the 8-column table. Filtering lives in the page;
 * this only draws it.
 */
export function IdeiasPhoneView(props: IdeiasPhoneViewProps) {
  const {
    ideias,
    isLoading,
    canEdit,
    onNew,
    onOpen,
    search,
    onSearchChange,
    clientes,
    statuses,
    clienteFilter,
    onClienteFilterChange,
    tipoFilter,
    onTipoFilterChange,
    statusFilters,
    onStatusFiltersChange,
    dateRange,
    onDateRangeChange,
    activeFilterCount,
    onClearFilters,
  } = props;
  const [searchOpen, setSearchOpen] = useState(() => search !== '');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [periodMode, setPeriodMode] = useState<PeriodMode>(() => modeOf(dateRange));
  const searchRef = useRef<HTMLInputElement>(null);
  const filtersRef = useRef<HTMLButtonElement>(null);

  const sortedClientes = [...clientes].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const clienteName = sortedClientes.find((c) => String(c.id) === clienteFilter)?.nome;
  const period = periodLabel(dateRange);

  const choosePeriodMode = (mode: PeriodMode) => {
    setPeriodMode(mode);
    if (mode === 'todos') onDateRangeChange(undefined);
    else if (mode === 'mes') {
      // Picking "Mês" filters right away, by the current month (or the one already set).
      const base = dateRange?.from ?? new Date();
      onDateRangeChange(monthRange(`${base.getFullYear()}-${pad(base.getMonth() + 1)}`));
    }
  };

  const sections: FilterSection[] = [
    {
      type: 'lists',
      key: 'cliente',
      lists: [
        {
          key: 'cliente',
          title: 'Cliente',
          allLabel: 'Todos os clientes',
          options: sortedClientes.map((c) => ({ value: String(c.id), label: c.nome })),
          selected: clienteFilter === 'all' ? [] : [clienteFilter],
          // One cliente at a time, as on desktop: a second pick replaces the first.
          onChange: (next) => {
            const added = next.find((v) => String(v) !== clienteFilter);
            onClienteFilterChange(added != null ? String(added) : 'all');
          },
        },
      ],
    },
    {
      type: 'chips',
      key: 'tipo',
      label: 'Tipo',
      chips: (['ideia', 'solicitacao'] as const).map((tipo) => ({
        key: tipo,
        label: TIPO_LABELS[tipo],
        selected: tipoFilter === tipo,
        onToggle: () => onTipoFilterChange(tipoFilter === tipo ? 'all' : tipo),
      })),
    },
    {
      type: 'chips',
      key: 'status',
      label: 'Status',
      chips: statuses.map((s) => ({
        key: s,
        label: IDEIA_STATUS_LABELS[s],
        selected: statusFilters.includes(s),
        onToggle: () =>
          onStatusFiltersChange(
            statusFilters.includes(s)
              ? statusFilters.filter((x) => x !== s)
              : [...statusFilters, s],
          ),
      })),
    },
    {
      type: 'chips',
      key: 'periodo',
      label: 'Período',
      chips: [
        { key: 'todos', label: 'Qualquer data' },
        { key: 'mes', label: 'Um mês' },
        { key: 'intervalo', label: 'Intervalo' },
      ].map((c) => ({
        key: c.key,
        label: c.label,
        selected: periodMode === c.key,
        onToggle: () => choosePeriodMode(c.key as PeriodMode),
      })),
      after:
        periodMode === 'todos' ? undefined : (
          <div className="phone-ideias__period">
            <GroupedList aria-label="Período">
              {periodMode === 'mes' ? (
                <FormRow
                  label="Mês"
                  input={{
                    type: 'month',
                    value: dateRange?.from
                      ? `${dateRange.from.getFullYear()}-${pad(dateRange.from.getMonth() + 1)}`
                      : '',
                    onChange: (e) => onDateRangeChange(monthRange(e.target.value)),
                  }}
                />
              ) : (
                <>
                  <FormRow
                    label="De"
                    input={{
                      type: 'date',
                      value: toInputDate(dateRange?.from),
                      max: toInputDate(dateRange?.to) || undefined,
                      onChange: (e) => {
                        const from = fromInputDate(e.target.value);
                        const to = dateRange?.to;
                        onDateRangeChange(from || to ? { from, to } : undefined);
                      },
                    }}
                  />
                  <FormRow
                    label="Até"
                    input={{
                      type: 'date',
                      value: toInputDate(dateRange?.to),
                      min: toInputDate(dateRange?.from) || undefined,
                      onChange: (e) => {
                        const to = fromInputDate(e.target.value);
                        const from = dateRange?.from;
                        onDateRangeChange(from || to ? { from, to } : undefined);
                      },
                    }}
                  />
                </>
              )}
            </GroupedList>
          </div>
        ),
    },
  ];

  const statusChipLabel =
    statusFilters.length > 0
      ? `Status: ${statusFilters.map((s) => IDEIA_STATUS_LABELS[s] ?? s).join(', ')}`
      : null;

  return (
    <div className="phone-ideias">
      <PhonePageHeader
        title="Ideias"
        subtitle={HELP_TEXT}
        actions={
          <>
            <PhoneIconButton
              label={searchOpen ? 'Fechar busca' : 'Buscar'}
              aria-expanded={searchOpen}
              onClick={() => {
                if (searchOpen) {
                  onSearchChange('');
                  setSearchOpen(false);
                } else {
                  setSearchOpen(true);
                  requestAnimationFrame(() => searchRef.current?.focus());
                }
              }}
            >
              {searchOpen ? <X aria-hidden="true" /> : <Search aria-hidden="true" />}
            </PhoneIconButton>
            <PhoneIconButton
              ref={filtersRef}
              label={
                activeFilterCount > 0
                  ? `Filtros, ${activeFilterCount} ${activeFilterCount === 1 ? 'ativo' : 'ativos'}`
                  : 'Filtros'
              }
              badge={activeFilterCount}
              aria-haspopup="dialog"
              onClick={() => setFiltersOpen(true)}
            >
              <SlidersHorizontal aria-hidden="true" />
            </PhoneIconButton>
            {canEdit && (
              <PhoneIconButton label="Nova ideia" variant="ink" onClick={onNew}>
                <Plus aria-hidden="true" />
              </PhoneIconButton>
            )}
          </>
        }
      >
        {searchOpen && (
          <label className="phone-ideias__search">
            <Search aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              enterKeyHint="search"
              aria-label="Buscar por título ou cliente"
              placeholder="Buscar por título ou cliente..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </label>
        )}
      </PhonePageHeader>

      {!isLoading && (
        <div className="phone-ideias__summary">
          {activeFilterCount > 0 && (
            <ChipRow aria-label="Filtros ativos">
              {statusChipLabel && (
                <Chip
                  label={statusChipLabel}
                  removeLabel="Remover filtro de status"
                  onRemove={() => onStatusFiltersChange([])}
                />
              )}
              {clienteName && (
                <Chip
                  label={clienteName}
                  removeLabel="Remover filtro de cliente"
                  onRemove={() => onClienteFilterChange('all')}
                />
              )}
              {tipoFilter !== 'all' && (
                <Chip
                  label={TIPO_LABELS[tipoFilter as Ideia['tipo']] ?? tipoFilter}
                  removeLabel="Remover filtro de tipo"
                  onRemove={() => onTipoFilterChange('all')}
                />
              )}
              {period && (
                <Chip
                  label={period}
                  removeLabel="Remover filtro de período"
                  onRemove={() => {
                    setPeriodMode('todos');
                    onDateRangeChange(undefined);
                  }}
                />
              )}
            </ChipRow>
          )}
          <span className="phone-ideias__count" aria-live="polite">
            {ideias.length} {ideias.length === 1 ? 'ideia' : 'ideias'}
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="phone-ideias__empty" role="status">
          Carregando ideias…
        </div>
      ) : ideias.length === 0 ? (
        <div className="phone-ideias__empty">
          <Lightbulb aria-hidden="true" />
          Nenhuma ideia encontrada.
        </div>
      ) : (
        <ul className="phone-kit phone-ideias__list" aria-label="Ideias">
          {ideias.map((ideia) => {
            const reactions = ideia.ideia_reactions.length;
            const meta = [
              reactions === 0
                ? 'Sem reações'
                : `${reactions} ${reactions === 1 ? 'reação' : 'reações'}`,
              ideia.comentario_agencia ? 'Respondida' : null,
              ideia.origem === 'agencia' && !ideia.visivel_no_hub ? 'Oculta do Hub' : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <li key={ideia.id} className="phone-ideias__row">
                <button
                  type="button"
                  className="phone-ideias__row-button"
                  onClick={() => onOpen(ideia)}
                >
                  <span className="phone-ideias__text">
                    <strong className="phone-ideias__title">{ideia.titulo}</strong>
                    <span className="phone-ideias__line">
                      {ideia.clientes.nome} · {TIPO_LABELS[ideia.tipo]} ·{' '}
                      {ORIGEM_LABELS[ideia.origem]}
                    </span>
                    <span className="phone-ideias__line">{meta}</span>
                  </span>
                  <span className="phone-ideias__aside">
                    <IdeiaStatusPill status={ideia.status} />
                    <span className="phone-ideias__date">
                      {format(new Date(ideia.created_at), 'dd/MM')}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <PhoneFiltersSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        description="Filtre as ideias"
        sections={sections}
        activeCount={activeFilterCount}
        onClear={() => {
          setPeriodMode('todos');
          onClearFilters();
        }}
        resultCount={ideias.length}
        returnFocusRef={filtersRef}
      />
    </div>
  );
}
