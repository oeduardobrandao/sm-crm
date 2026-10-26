import { useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
  UserPlus,
} from 'lucide-react';
import {
  ActionSheet,
  CheckList,
  Cell,
  Chip,
  ChipRow,
  GroupedList,
  PhoneFiltersSheet,
  PhoneIconButton,
  type FilterSection,
} from '@mesaas/ios-kit';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { PageHeader } from '../../components/PageHeader';
import type { WorkspaceSummary } from '../../lib/api';
import { avatarColor, avatarLetter } from '../../lib/avatar-color';
import { workspaceDetailPath } from '../../lib/routes';
import {
  STATUS_GROUPS,
  STATUS_GROUP_LABELS,
  hasSubscription,
  statusMeta,
  type StatusTone,
} from '../../lib/subscription';
import { ACTIVITY_TONE_CLASS, describeActivity } from '../workspace-activity';
import { WORKSPACE_COLUMNS } from '../workspaces-columns';
import {
  ACTIVITY_LABELS,
  CREATED_LABELS,
  OVERRIDES_LABELS,
  clearSheetFiltersPatch,
  countSheetFilters,
  type WorkspacesListParams,
} from '../workspaces-params';
import { CreateDemoDialog } from './CreateDemoDialog';
import { filterChipsFor } from './WorkspacesFilterChips';
import { WorkspacesListState } from './WorkspacesListState';
import { PlanCell } from './WorkspacesTable';
import { useDebouncedSearch } from './WorkspacesToolbar';
import type { WorkspacesViewProps } from './view-props';

const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
  muted: 'text-muted-foreground',
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Radix-style single choice on top of the kit's multi-select drill-in list. */
function singleFromMulti(current: string, next: (string | number)[]): string {
  return next.map(String).find((v) => v !== current) ?? '';
}

interface SheetChip {
  key: string;
  label: string;
  selected: boolean;
  onToggle: () => void;
}

/**
 * The filters sheet's chip group, but wrapping onto more lines (board WorkspacesFiltros): the
 * kit's chip sections scroll sideways and clipped "Cancelado" and the longer plan names.
 */
function WrappingChips({ label, chips }: { label: string; chips: SheetChip[] }) {
  return (
    <section className="phone-filters__group">
      <h3 className="phone-filters__label">{label}</h3>
      <ChipRow aria-label={label} className="phone-filters__chips flex-wrap">
        {chips.map((chip) => (
          <Chip
            key={chip.key}
            label={chip.label}
            selected={chip.selected}
            onClick={chip.onToggle}
          />
        ))}
      </ChipRow>
    </section>
  );
}

function WorkspaceCell({ ws, now }: { ws: WorkspaceSummary; now: Date }) {
  const activity = describeActivity(ws.last_activity_at, ws.created_at, now);
  const sub = hasSubscription(ws.subscription) ? statusMeta(ws.subscription.status) : null;
  return (
    <Cell
      to={workspaceDetailPath(ws.id)}
      icon={
        <span
          aria-hidden="true"
          className="-m-[5px] flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white"
          style={{ background: avatarColor(ws.name) }}
        >
          {avatarLetter(ws.name)}
        </span>
      }
      label={
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{ws.name}</span>
          {ws.has_overrides ? (
            <Badge variant="warning" size="sm" className="shrink-0">
              overrides
            </Badge>
          ) : null}
        </span>
      }
      subtitle={
        <>
          <span className="block truncate">{ws.owner?.email || 'Sem dono'}</span>
          {/* The meta line wraps to a second line at word breaks instead of ellipsizing
              "há 4 …" mid-word. */}
          <span className="mt-0.5 flex min-w-0 items-start gap-1.5">
            {ws.plan_name ? (
              <span className="shrink-0 whitespace-nowrap">
                <PlanCell ws={ws} />
              </span>
            ) : null}
            <span className="line-clamp-2 min-w-0 whitespace-normal">
              <span className={sub ? STATUS_TONE_CLASS[sub.tone] : 'text-muted-foreground'}>
                {sub ? sub.label : 'Sem assinatura'}
              </span>
              {' · '}
              {plural(ws.client_count, 'cliente', 'clientes')}
              {' · '}
              <span className={ACTIVITY_TONE_CLASS[activity.tone]}>{activity.label}</span>
            </span>
          </span>
        </>
      }
    />
  );
}

function WorkspaceSkeletonList() {
  return (
    <GroupedList aria-label="Carregando workspaces">
      {Array.from({ length: 6 }, (_, i) => (
        <Cell
          key={i}
          label={<Skeleton className="my-1 h-4 w-40" />}
          subtitle={<Skeleton className="mt-1.5 h-3 w-28" />}
        />
      ))}
    </GroupedList>
  );
}

export function WorkspacesPhone({
  params,
  set,
  reset,
  plans,
  workspaces,
  total,
  filtered,
  state,
  fetching,
  onRetry,
  onSort,
  now,
  headerDescription,
}: WorkspacesViewProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const { text, setText } = useDebouncedSearch(params.q, set);

  // Every change made from inside the open sheet REPLACEs the history entry: the sheet
  // already owns one entry (Back closes it), and a push per tap would make Back replay
  // each filter instead of closing the sheet.
  const setInSheet = (patch: Partial<WorkspacesListParams>) => set(patch, { replace: true });
  const activeCount = countSheetFilters(params);
  const chips = filterChipsFor(params, plans).filter((chip) => chip.key !== 'q');

  const sortColumn = WORKSPACE_COLUMNS.find((c) => c.sortKey === params.ord);
  const SortArrow = params.dir === 'asc' ? ArrowUp : ArrowDown;
  const sortableColumns = WORKSPACE_COLUMNS.filter((c) => c.sortKey !== undefined);

  const description =
    filtered && total !== undefined ? plural(total, 'resultado', 'resultados') : headerDescription;

  const statusChips: SheetChip[] = STATUS_GROUPS.map((g) => ({
    key: g,
    label: STATUS_GROUP_LABELS[g],
    selected: params.status === g,
    onToggle: () => setInSheet({ status: params.status === g ? '' : g }),
  }));
  const planChips: SheetChip[] = [
    {
      key: 'todos',
      label: 'Todos',
      selected: params.plano === '',
      onToggle: () => setInSheet({ plano: '' }),
    },
    ...plans.map((p) => ({
      key: p.id,
      label: p.name,
      selected: params.plano === p.id,
      onToggle: () => setInSheet({ plano: params.plano === p.id ? '' : p.id }),
    })),
  ];

  const sections: FilterSection[] = [
    {
      type: 'custom',
      key: 'status',
      content: <WrappingChips label="Status" chips={statusChips} />,
    },
    { type: 'custom', key: 'plano', content: <WrappingChips label="Plano" chips={planChips} /> },
    {
      type: 'custom',
      key: 'atividade',
      content: (
        <CheckList
          header="Atividade"
          emptyOption={{ label: 'Qualquer' }}
          options={(Object.keys(ACTIVITY_LABELS) as (keyof typeof ACTIVITY_LABELS)[]).map((k) => ({
            value: k,
            label: ACTIVITY_LABELS[k],
          }))}
          value={params.atividade || null}
          // The kit's single list re-picks the current value; tapping it again deselects.
          onChange={(v) =>
            setInSheet({
              atividade: (v === params.atividade
                ? ''
                : (v ?? '')) as WorkspacesListParams['atividade'],
            })
          }
        />
      ),
    },
    {
      type: 'lists',
      key: 'mais',
      lists: [
        {
          key: 'overrides',
          title: 'Overrides',
          allLabel: 'Todos',
          options: (Object.keys(OVERRIDES_LABELS) as (keyof typeof OVERRIDES_LABELS)[]).map(
            (k) => ({ value: k, label: OVERRIDES_LABELS[k] }),
          ),
          selected: params.overrides ? [params.overrides] : [],
          onChange: (next) =>
            setInSheet({
              overrides: singleFromMulti(
                params.overrides,
                next,
              ) as WorkspacesListParams['overrides'],
            }),
        },
        {
          key: 'criado',
          title: 'Criado',
          allLabel: 'Qualquer data',
          options: (Object.keys(CREATED_LABELS) as (keyof typeof CREATED_LABELS)[]).map((k) => ({
            value: k,
            label: CREATED_LABELS[k],
          })),
          selected: params.criado ? [params.criado] : [],
          onChange: (next) =>
            setInSheet({
              criado: singleFromMulti(params.criado, next) as WorkspacesListParams['criado'],
            }),
        },
      ],
    },
  ];

  const por = params.por;
  const totalPages = Math.max(1, Math.ceil((total ?? 0) / por));
  const current = Math.min(Math.max(1, params.pag), totalPages);

  let body: JSX.Element;
  if (state === 'pending') {
    body = <WorkspaceSkeletonList />;
  } else if (state === 'error' || workspaces.length === 0) {
    body = (
      <WorkspacesListState
        kind={state === 'error' ? 'error' : 'empty'}
        total={total ?? 0}
        filtered={filtered}
        onRetry={onRetry}
        onFirstPage={() => set({ pag: 1 })}
        onClearFilters={reset}
      />
    );
  } else {
    body = (
      <div
        aria-busy={fetching ? 'true' : undefined}
        className={fetching ? 'opacity-60' : undefined}
      >
        <GroupedList
          header={
            <button
              ref={sortButtonRef}
              type="button"
              aria-haspopup="dialog"
              aria-label={`Ordenar por ${sortColumn?.label ?? 'Criado em'}, ordem ${
                params.dir === 'asc' ? 'crescente' : 'decrescente'
              }`}
              className="inline-flex items-center gap-1 uppercase tracking-[0.02em]"
              onClick={() => setSortOpen(true)}
            >
              {sortColumn?.label}
              <SortArrow size={13} aria-hidden="true" />
            </button>
          }
        >
          {workspaces.map((ws) => (
            <WorkspaceCell key={ws.id} ws={ws} now={now} />
          ))}
        </GroupedList>
        <nav
          aria-label="Paginação"
          className="phone-kit mb-2 flex items-center justify-between gap-3 px-1 text-[13px] text-muted-foreground"
        >
          <span className="tabular-nums">
            {(current - 1) * por + 1}–{Math.min(total ?? 0, current * por)} de {total ?? 0}
          </span>
          {totalPages > 1 ? (
            <span className="flex items-center gap-2">
              <PhoneIconButton
                label="Página anterior"
                disabled={current <= 1}
                onClick={() => set({ pag: current - 1 })}
              >
                <ChevronLeft aria-hidden="true" />
              </PhoneIconButton>
              <PhoneIconButton
                label="Próxima página"
                disabled={current >= totalPages}
                onClick={() => set({ pag: current + 1 })}
              >
                <ChevronRight aria-hidden="true" />
              </PhoneIconButton>
            </span>
          ) : null}
        </nav>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Workspaces"
        description={description}
        phoneActions={
          <>
            <PhoneIconButton label="Criar conta demo" onClick={() => setDemoOpen(true)}>
              <UserPlus aria-hidden="true" />
            </PhoneIconButton>
            <PhoneIconButton
              ref={filterButtonRef}
              label={
                activeCount > 0 ? `Filtros, ${plural(activeCount, 'ativo', 'ativos')}` : 'Filtros'
              }
              badge={activeCount}
              aria-haspopup="dialog"
              onClick={() => setFiltersOpen(true)}
            >
              <SlidersHorizontal aria-hidden="true" />
            </PhoneIconButton>
          </>
        }
      >
        <label className="phone-kit mt-1 flex h-[38px] items-center gap-2 rounded-[10px] bg-[var(--phone-fill)] px-2.5 text-muted-foreground">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            enterKeyHint="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Nome ou e-mail do dono"
            aria-label="Buscar workspaces"
            className="min-w-0 flex-1 border-0 bg-transparent text-[17px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        {chips.length > 0 ? (
          <ChipRow aria-label="Filtros ativos" className="mt-2.5">
            {chips.map((chip) => (
              <Chip
                key={chip.key}
                label={`${chip.label}: ${chip.value}`}
                removeLabel={`Remover filtro ${chip.label}`}
                onRemove={() => set({ [chip.key]: '' } as Partial<WorkspacesListParams>)}
              />
            ))}
            <button
              type="button"
              className="phone-text-button"
              onClick={() => set(clearSheetFiltersPatch())}
            >
              Limpar
            </button>
          </ChipRow>
        ) : null}
      </PageHeader>

      {body}

      <CreateDemoDialog plans={plans} open={demoOpen} onOpenChange={setDemoOpen} />
      <PhoneFiltersSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        sections={sections}
        activeCount={activeCount}
        onClear={() => setInSheet(clearSheetFiltersPatch())}
        resultCount={total ?? 0}
        returnFocusRef={filterButtonRef}
      />
      <ActionSheet
        open={sortOpen}
        onOpenChange={setSortOpen}
        title="Ordenar por"
        returnFocusRef={sortButtonRef}
        actions={sortableColumns.map((col) => ({
          label:
            col.sortKey === params.ord
              ? `${col.label} ${params.dir === 'asc' ? '↑' : '↓'}`
              : col.label,
          onSelect: () => onSort(col.sortKey!),
        }))}
      />
    </div>
  );
}
