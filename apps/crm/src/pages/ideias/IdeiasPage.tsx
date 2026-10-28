import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '@mesaas/i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DateRange } from 'react-day-picker';
import { getIdeias, getClientes, type Ideia } from '@/store';
import { IdeiaStatusBadge } from '@/components/ideias/IdeiaStatusBadge';
import { IdeiaTipoBadge } from '@/components/ideias/IdeiaTipoBadge';
import { IdeiaOrigemBadge } from '@/components/ideias/IdeiaOrigemBadge';
import { IdeiaDrawer } from '@/components/ideias/IdeiaDrawer';
import { NovaIdeiaDialog } from '@/components/ideias/NovaIdeiaDialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, Info, Lightbulb, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/skeletons';
import { useAuth } from '@/context/AuthContext';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { usePageToolbar } from '@/components/layout/PageToolbarContext';
import { IDEIA_STATUS_LABELS } from './ideiaLabels';
import { IdeiasPhoneView } from './IdeiasPhoneView';

const ALL_STATUSES = [
  'nova',
  'em_analise',
  'aprovada',
  'descartada',
  'convertida',
  'concluida',
] as const;
const STATUS_LABELS = IDEIA_STATUS_LABELS;

function startOfDayIso(d: Date): string {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy.toISOString();
}

function endOfDayIso(d: Date): string {
  const copy = new Date(d);
  copy.setHours(23, 59, 59, 999);
  return copy.toISOString();
}

export default function IdeiasPage() {
  const { t } = useTranslation('ideas');
  const intlLocale = useIntlLocale();
  const { can } = useAuth();
  const isPhone = !useIsDesktop(768);
  const qc = useQueryClient();
  const canEdit = can('ideias', 'editar') === true;
  const queryKey = ['hub-ideias-all'];
  const { data: ideias = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => getIdeias(),
  });
  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: getClientes,
  });

  const [selectedIdeia, setSelectedIdeia] = useState<Ideia | null>(null);

  // Deep link: /ideias?ideia=<id> abre o drawer (busca global, padrão do
  // ?tarefa= em Tarefas). Espera a lista carregar; id desconhecido só some da URL.
  const [searchParams, setSearchParams] = useSearchParams();
  const ideiaParam = searchParams.get('ideia');
  useEffect(() => {
    if (!ideiaParam || isLoading) return;
    const match = ideias.find((i) => i.id === ideiaParam);
    if (match) setSelectedIdeia(match);
    setSearchParams(
      (prev) => {
        prev.delete('ideia');
        return prev;
      },
      { replace: true },
    );
  }, [ideiaParam, isLoading, ideias, setSearchParams]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingIdeia, setEditingIdeia] = useState<Ideia | null>(null);
  const [search, setSearch] = useState('');
  const [clienteFilter, setClienteFilter] = useState<string>('all');
  const [tipoFilter, setTipoFilter] = useState<string>('all');
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const ideiasActiveFilterCount = [
    clienteFilter !== 'all',
    tipoFilter !== 'all',
    statusFilters.length > 0,
    !!(dateRange?.from || dateRange?.to),
  ].filter(Boolean).length;

  const filtered = ideias.filter((i) => {
    if (clienteFilter !== 'all' && String(i.cliente_id) !== clienteFilter) return false;
    if (tipoFilter !== 'all' && i.tipo !== tipoFilter) return false;
    if (statusFilters.length > 0 && !statusFilters.includes(i.status)) return false;
    if (dateRange?.from && i.created_at < startOfDayIso(dateRange.from)) return false;
    if (dateRange?.to && i.created_at > endOfDayIso(dateRange.to)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!i.titulo.toLowerCase().includes(q) && !i.clientes.nome.toLowerCase().includes(q))
        return false;
    }
    return true;
  });

  const clearFilters = () => {
    setClienteFilter('all');
    setTipoFilter('all');
    setStatusFilters([]);
    setDateRange(undefined);
  };

  // The dialog and the drawer are shared by both layouts (on phones the drawer is a
  // pushed screen of its own).
  const overlays = (
    <>
      <NovaIdeiaDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editing={editingIdeia}
        onSaved={async (id) => {
          setFormOpen(false);
          setEditingIdeia(null);
          // NovaIdeiaDialog already invalidates `queryKey` before calling us, but
          // that refetch is fire-and-forget from its side -- `ideias` here is still
          // the pre-save snapshot this closure was built from. Await our own
          // invalidation so the cache is guaranteed fresh before we look the row up.
          await qc.invalidateQueries({ queryKey });
          const fresh = qc.getQueryData<Ideia[]>(queryKey)?.find((i) => i.id === id);
          if (fresh) setSelectedIdeia(fresh);
        }}
      />

      {selectedIdeia &&
        (() => {
          // The drawer keeps a prop snapshot; once a conversion refetches the list, resolve
          // the fresh row so the drawer's derived-state UI (locked status, "Ver tarefa") updates
          // without the user having to close and reopen the drawer.
          const current = ideias.find((i) => i.id === selectedIdeia.id) ?? selectedIdeia;
          return (
            <IdeiaDrawer
              ideia={current}
              queryKey={queryKey}
              onClose={() => setSelectedIdeia(null)}
              onEdit={() => {
                setSelectedIdeia(null);
                setEditingIdeia(current);
                setFormOpen(true);
              }}
            />
          );
        })()}
    </>
  );

  const infoTooltip = (
    <span data-tooltip={t('shared.helpText')} data-tooltip-dir="right" style={{ display: 'flex' }}>
      <Info className="h-5 w-5 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
    </span>
  );
  const primaryAction = canEdit ? (
    <Button
      onClick={() => {
        setEditingIdeia(null);
        setFormOpen(true);
      }}
    >
      <Plus size={15} className="mr-1.5" />
      {t('shared.newIdea')}
    </Button>
  ) : null;
  const inToolbar = usePageToolbar({
    title: t('shared.title'),
    titleAccessory: infoTooltip,
    primary: primaryAction,
  });

  if (isPhone) {
    return (
      <>
        <IdeiasPhoneView
          ideias={filtered}
          isLoading={isLoading}
          canEdit={canEdit}
          onNew={() => {
            setEditingIdeia(null);
            setFormOpen(true);
          }}
          onOpen={setSelectedIdeia}
          search={search}
          onSearchChange={setSearch}
          clientes={clientes
            .filter((c: any) => typeof c.id === 'number')
            .map((c: any) => ({ id: c.id as number, nome: c.nome as string }))}
          statuses={ALL_STATUSES}
          clienteFilter={clienteFilter}
          onClienteFilterChange={setClienteFilter}
          tipoFilter={tipoFilter}
          onTipoFilterChange={setTipoFilter}
          statusFilters={statusFilters}
          onStatusFiltersChange={setStatusFilters}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          activeFilterCount={ideiasActiveFilterCount}
          onClearFilters={clearFilters}
        />
        {overlays}
      </>
    );
  }

  return (
    // Under Vidro the panel already pads the content.
    <div style={inToolbar ? undefined : { padding: '1.5rem' }}>
      {!inToolbar && (
        <div className="header">
          <div
            className="header-title"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <h1>{t('shared.title')}</h1>
            {infoTooltip}
          </div>
          {primaryAction}
        </div>
      )}

      {/* Filters. Desktop keeps every control inline; below 901px it's just
          search + a single "Filtros" button opening a sheet, same pattern as
          Tarefas/Entregas -- otherwise cliente/tipo/status/período wrap across
          the whole first fold on a phone before any ideia is visible. */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: '320px' }}>
          <Search
            className="h-4 w-4"
            style={{
              position: 'absolute',
              left: '0.625rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}
          />
          <Input
            placeholder={t('shared.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: '2rem' }}
          />
        </div>

        <div className="hidden min-[901px]:contents">
          <Select value={clienteFilter} onValueChange={setClienteFilter}>
            <SelectTrigger className="!rounded-full !text-xs h-9 px-4 w-auto min-w-[160px] mb-0">
              <SelectValue placeholder={t('shared.allClients')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('shared.allClients')}</SelectItem>
              {[...clientes]
                .sort((a: any, b: any) => a.nome.localeCompare(b.nome, 'pt-BR'))
                .map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nome}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>

          <Select value={tipoFilter} onValueChange={setTipoFilter}>
            <SelectTrigger className="!rounded-full !text-xs h-9 px-4 w-auto min-w-[130px] mb-0">
              <SelectValue placeholder={t('page.typePlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('page.allTypes')}</SelectItem>
              <SelectItem value="ideia">{t('tipo.ideia')}</SelectItem>
              <SelectItem value="solicitacao">{t('tipo.solicitacao')}</SelectItem>
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="h-9 rounded-full px-4 text-xs gap-1.5 font-normal shadow-sm mb-0"
              >
                {statusFilters.length === 0
                  ? t('shared.status')
                  : statusFilters.length === 1
                    ? STATUS_LABELS[statusFilters[0]]
                    : t('page.statusCount', { count: statusFilters.length })}
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              {ALL_STATUSES.map((s) => (
                <DropdownMenuCheckboxItem
                  key={s}
                  checked={statusFilters.includes(s)}
                  onCheckedChange={(checked) => {
                    setStatusFilters((prev) =>
                      checked ? [...prev, s] : prev.filter((x) => x !== s),
                    );
                  }}
                  onSelect={(e) => e.preventDefault()}
                >
                  {STATUS_LABELS[s]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DateRangePicker
            value={dateRange}
            onChange={setDateRange}
            className="rounded-full text-xs px-4 mb-0"
          />
        </div>

        <Button
          variant="outline"
          className="flex min-[901px]:hidden h-9 rounded-full px-3 text-xs gap-1.5 font-normal shadow-sm mb-0 shrink-0"
          onClick={() => setFilterSheetOpen(true)}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {t('shared.filters')}
          {ideiasActiveFilterCount > 0 && (
            <span
              className="inline-flex items-center justify-center rounded-full text-[0.6rem] font-semibold leading-none"
              style={{
                background: 'var(--primary-color)',
                color: '#000',
                width: '1.1rem',
                height: '1.1rem',
              }}
            >
              {ideiasActiveFilterCount}
            </span>
          )}
        </Button>
      </div>

      <Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
        <SheetContent side="bottom" className="rounded-t-[24px] max-h-[85vh] overflow-y-auto pb-24">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-base">{t('shared.filters')}</SheetTitle>
            <SheetDescription className="sr-only">
              {t('shared.filtersDescription')}
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3">
            <Select value={clienteFilter} onValueChange={setClienteFilter}>
              <SelectTrigger className="!text-xs h-9 w-full mb-0">
                <SelectValue placeholder={t('shared.allClients')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('shared.allClients')}</SelectItem>
                {[...clientes]
                  .sort((a: any, b: any) => a.nome.localeCompare(b.nome, 'pt-BR'))
                  .map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>

            <Select value={tipoFilter} onValueChange={setTipoFilter}>
              <SelectTrigger className="!text-xs h-9 w-full mb-0">
                <SelectValue placeholder={t('page.typePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('page.allTypes')}</SelectItem>
                <SelectItem value="ideia">{t('tipo.ideia')}</SelectItem>
                <SelectItem value="solicitacao">{t('tipo.solicitacao')}</SelectItem>
              </SelectContent>
            </Select>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="h-9 w-full justify-between text-xs font-normal"
                >
                  {statusFilters.length === 0
                    ? t('shared.status')
                    : statusFilters.length === 1
                      ? STATUS_LABELS[statusFilters[0]]
                      : t('page.statusCount', { count: statusFilters.length })}
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[calc(100vw-3rem)]">
                {ALL_STATUSES.map((s) => (
                  <DropdownMenuCheckboxItem
                    key={s}
                    checked={statusFilters.includes(s)}
                    onCheckedChange={(checked) => {
                      setStatusFilters((prev) =>
                        checked ? [...prev, s] : prev.filter((x) => x !== s),
                      );
                    }}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {STATUS_LABELS[s]}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DateRangePicker value={dateRange} onChange={setDateRange} className="text-xs w-full" />
          </div>
          {ideiasActiveFilterCount > 0 && (
            <Button variant="ghost" className="w-full mt-4 text-xs" onClick={clearFilters}>
              {t('page.clearFilters')}
            </Button>
          )}
        </SheetContent>
      </Sheet>

      {isLoading ? (
        <TableSkeleton columns={6} />
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: '2.5rem', textAlign: 'center' }}>
          <Lightbulb
            className="h-6 w-6"
            style={{ margin: '0 auto 0.5rem', color: 'var(--text-light)' }}
          />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {t('shared.empty')}
          </p>
        </div>
      ) : (
        <div data-slot="card" className="border rounded-xl bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('page.columns.client')}</TableHead>
                <TableHead>{t('page.columns.type')}</TableHead>
                <TableHead>{t('page.columns.source')}</TableHead>
                <TableHead>{t('page.columns.title')}</TableHead>
                <TableHead>{t('page.columns.status')}</TableHead>
                <TableHead>{t('page.columns.reactions')}</TableHead>
                <TableHead>{t('page.columns.reply')}</TableHead>
                <TableHead>{t('page.columns.date')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((ideia) => (
                <TableRow
                  key={ideia.id}
                  onClick={() => setSelectedIdeia(ideia)}
                  className="cursor-pointer"
                >
                  <TableCell className="text-muted-foreground">{ideia.clientes.nome}</TableCell>
                  <TableCell>
                    <IdeiaTipoBadge tipo={ideia.tipo} />
                  </TableCell>
                  <TableCell>
                    <IdeiaOrigemBadge
                      origem={ideia.origem}
                      hidden={ideia.origem === 'agencia' && !ideia.visivel_no_hub}
                    />
                  </TableCell>
                  <TableCell className="font-medium max-w-[200px] truncate">
                    {ideia.titulo}
                  </TableCell>
                  <TableCell>
                    <IdeiaStatusBadge status={ideia.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {ideia.ideia_reactions.length || '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {ideia.comentario_agencia ? '✓' : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(ideia.created_at).toLocaleDateString(intlLocale)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {overlays}
    </div>
  );
}
